// assets/js/pages/merchants.dungeon.js — Dungeon v4
import { db, auth } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  IMGS, initDungeonRenderer, resizeDungeonRenderer, loadAllDungeonSprites,
  renderDungeonFrame, MSPRITE_DEFS,
} from './merchants.dungeon.render.js';

// ── 입장료 ────────────────────────────────────────────────────────────────────
const BASE_FEE  = 100, FEE_STEP = 50, RESET_MS = 24 * 60 * 60 * 1000, GAME_KEY = 'dungeonEntry';
const WORLD_R   = 950;

// ── 몬스터 정의 ───────────────────────────────────────────────────────────────
const D_MDEFS = {
  orc1:    { id:'orc1',   label:'Orc',         sp:'orc1',    sz:50,  maxHp:240, atk:22, spd:72,  range:70,  ranged:false, xp:20, coins:4  },
  orc2:    { id:'orc2',   label:'Orc Elite',   sp:'orc2',    sz:56,  maxHp:320, atk:30, spd:65,  range:75,  ranged:false, xp:35, coins:7  },
  orc3:    { id:'orc3',   label:'Dark Orc',    sp:'orc3',    sz:58,  maxHp:420, atk:38, spd:58,  range:78,  ranged:false, xp:55, coins:10 },
  pirate1: { id:'pirate1',label:'Pirate',      sp:'pirate1', sz:48,  maxHp:180, atk:18, spd:90,  range:65,  ranged:false, xp:15, coins:3  },
  pirate2: { id:'pirate2',label:'Pirate Capt', sp:'pirate2', sz:52,  maxHp:260, atk:28, spd:80,  range:150, ranged:true,  xp:30, coins:8  },
  pirate3: { id:'pirate3',label:'Pirate Brsrk',sp:'pirate3', sz:54,  maxHp:350, atk:42, spd:68,  range:130, ranged:true,  xp:60, coins:12 },
  zombie:  { id:'zombie', label:'Zombie',      sp:'zombie',  sz:52,  maxHp:160, atk:24, spd:108, range:68,  ranged:false, xp:22, coins:5  },
  dragon:  { id:'dragon', label:'Dragon',      sp:'dragon',  sz:84,  maxHp:1200,atk:80, spd:55,  range:240, ranged:true,  xp:180,coins:30, isBoss:true },
};

// ── 타워 정의 (역할 수정: archer=tower.png 관통, cannon=tower2.png 광역) ───────
const D_TOWER_DEF = {
  archer: { maxHp:260, atk:18, range:320, rate:2.5,  img:'tower',  sz:44, color:'#fbbf24', label:'아처 타워',  isPiercing:true },
  cannon: { maxHp:380, atk:32, range:250, rate:0.22, img:'tower2', sz:48, color:'#ef4444', label:'대포 타워',  isAoe:true, aoeR:80, knockback:120, slowDur:2.5 },
};
const D_TOWER_SLOTS = (() => {
  const s = [];
  for (let i = 0; i < 8;  i++) { const a = (i / 8)  * Math.PI * 2; s.push({ x: Math.cos(a) * 430, y: Math.sin(a) * 430, kind: 'cannon' }); }
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; s.push({ x: Math.cos(a) * 720, y: Math.sin(a) * 720, kind: 'archer' }); }
  return s;
})();

// ── 스킬 ─────────────────────────────────────────────────────────────────────
export const D_SKILLS = [
  { id:'fire',   emoji:'🔥', label:'Fire Storm',  key:'Q', color:'#f97316', cd:8  },
  { id:'ice',    emoji:'❄️', label:'Ice Freeze',  key:'W', color:'#38bdf8', cd:10 },
  { id:'bolt',   emoji:'⚡', label:'Chain Bolt',  key:'E', color:'#facc15', cd:7  },
  { id:'meteor', emoji:'☄️', label:'Meteor',      key:'R', color:'#fb923c', cd:15 },
  { id:'wind',   emoji:'🌪️', label:'Whirlwind',  key:'T', color:'#a78bfa', cd:20 },
];

// ── 층 랜덤 생성 ──────────────────────────────────────────────────────────────
function generateFloors() {
  const themes = [
    { types:['orc1','orc2'],    label:'Orc Lair',     theme:'#0e0800', kills:8  },
    { types:['pirate1','pirate2'], label:'Pirate Hold', theme:'#00100a', kills:8  },
    { types:['zombie','orc2'],  label:'Undead Crypt',  theme:'#0a0012', kills:10 },
    { types:['orc3','pirate3'], label:'Elite Guard',   theme:'#12000e', kills:12 },
  ];
  const shuffled = themes.sort(() => Math.random() - 0.5);
  return [
    ...shuffled.map((t, i) => ({ floor: i + 1, ...t })),
    { floor: 5, types: ['dragon'], label: 'Dragon Lair', theme: '#1a0000', kills: 1, boss: true },
  ];
}

function stageMult(floor) { return 0.3 + floor * 0.16; }
function scaleDef(base, floor) {
  const m = stageMult(floor);
  return { ...base, maxHp: Math.round(base.maxHp * m), atk: Math.max(1, Math.round(base.atk * m)),
           spd: Math.round(base.spd * (1 + (floor - 1) * 0.06)),
           coins: Math.max(1, Math.round(base.coins * (1 + (floor - 1) * 0.12))),
           xp: Math.round(base.xp * (1 + (floor - 1) * 0.08)) };
}

// ── 싱글톤 ───────────────────────────────────────────────────────────────────
let _instance = null;
export function initDungeonGame(opts) { _instance = new DungeonGame(opts); }
export function openDungeonGame()     { _instance?.open(); }

// ══════════════════════════════════════════════════════════════════════════════
class DungeonGame {
  constructor(opts) {
    this._opts    = opts;
    this._uid     = null;
    this._entryFee = BASE_FEE; this._entryCount = 0; this._entryResetAt = 0;
    this._dbHp = 200; this._dbMaxHp = 200; this._dbAtk = 25; this._dbDef = 0; this._dbMp = 100; this._dbMaxMp = 100;
    this._running   = false;
    this._raf       = null;
    this._keyHandler = null;
    this._spritesLoaded = false;
    this._floors    = [];
    this._audio     = null; this._ambNodes = null;
    auth.onAuthStateChanged?.(u => { this._uid = u?.uid || null; });
    if (!auth.onAuthStateChanged && auth.currentUser) this._uid = auth.currentUser.uid;
    this._buildDOM();
  }

  // ── DB ─────────────────────────────────────────────────────────────────────
  async _loadDB() {
    if (!this._uid) return;
    try {
      const d = (await getDoc(doc(db, 'battle_players', this._uid))).data() || {};
      this._dbHp = d.hp || 200; this._dbMaxHp = d.maxHp || this._dbHp;
      this._dbAtk = d.attack || 25; this._dbDef = d.defense || 0;
      this._dbMp = d.mp || 100; this._dbMaxMp = d.maxMp || this._dbMp;
      const entry = d[GAME_KEY] || {};
      const now = Date.now();
      if (!entry.resetAt || now - entry.resetAt > RESET_MS) { this._entryCount = 0; this._entryResetAt = 0; }
      else { this._entryCount = entry.count || 0; this._entryResetAt = entry.resetAt; }
      this._entryFee = BASE_FEE + this._entryCount * FEE_STEP;
    } catch {}
    this._updateEntryUI();
  }

  async _recordEntry() {
    if (!this._uid) return;
    try {
      const now = Date.now();
      const isReset = !this._entryResetAt || now - this._entryResetAt > RESET_MS;
      const nc = isReset ? 1 : this._entryCount + 1, nr = isReset ? now : this._entryResetAt;
      await updateDoc(doc(db, 'battle_players', this._uid), {
        gold: increment(-this._entryFee),
        [`${GAME_KEY}.count`]: nc, [`${GAME_KEY}.resetAt`]: nr,
      });
      this._entryCount = nc; this._entryResetAt = nr;
      this._entryFee   = BASE_FEE + nc * FEE_STEP;
    } catch {}
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────
  _buildDOM() {
    if (document.getElementById('dungeonModal')) {
      this._modal = document.getElementById('dungeonModal');
      this._canvas = document.getElementById('dgCanvas');
      return;
    }
    const skillBarHtml = D_SKILLS.map(sk => `
      <button class="dg-sk" id="dgSk_${sk.id}" title="${sk.label}(${sk.key})" style="border-color:${sk.color}33">
        <span>${sk.emoji}</span><span class="dg-sk-cnt" id="dgSkC_${sk.id}">0</span>
        <span class="dg-sk-key">${sk.key}</span>
        <div class="dg-sk-cd" id="dgSkD_${sk.id}"></div>
      </button>`).join('');

    const m = document.createElement('div');
    m.id = 'dungeonModal'; m.className = 'dg-modal hidden';
    m.innerHTML = `
<style>
.dg-modal{position:fixed;inset:0;z-index:8000;display:flex;align-items:center;justify-content:center}
.dg-modal.hidden{display:none!important}
.dg-ov{position:absolute;inset:0;background:rgba(0,0,0,.84)}
.dg-panel{position:relative;width:min(98vw,520px);max-height:96vh;background:#0d0d1a;border:1px solid #2d2d4a;
  border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 60px rgba(99,102,241,.22)}
.dg-scr{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px 18px;gap:10px;overflow-y:auto}
.dg-scr.hidden{display:none!important}
.dg-title{font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px}
.dg-sub{font-size:11px;color:#6b7280;text-align:center;line-height:1.7}
.dg-fee{background:#1e1e3a;border:1px solid #3730a3;border-radius:10px;padding:8px 18px;font-size:14px;font-weight:700;color:#a78bfa}
.dg-fee-info{font-size:10px;color:#6b7280;text-align:center}
.dg-btn{padding:10px 28px;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;width:100%;max-width:260px}
.dg-btn-go{background:#7c3aed;color:#fff;box-shadow:0 4px 18px rgba(124,58,237,.4)}
.dg-btn-go:disabled{opacity:.4;cursor:not-allowed}
.dg-btn-ghost{background:transparent;color:#6b7280;border:1px solid #374151}
.dg-game-wrap{padding:0;overflow:hidden;display:flex;flex-direction:column;flex:1}
.dg-hud{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;
  background:rgba(0,0,0,.88);border-bottom:1px solid #1f2937;gap:5px;flex-shrink:0}
.dg-hud-seg{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700}
.dg-bar-bg{width:72px;height:5px;background:#1f2937;border-radius:3px;overflow:hidden}
.dg-bar-fill{height:100%;border-radius:3px;transition:width .15s}
.dg-stg{background:#3730a3;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700}
.dg-xbtn{background:rgba(239,68,68,.2);border:none;color:#f87171;cursor:pointer;border-radius:6px;padding:2px 7px;font-size:13px}
canvas#dgCanvas{display:block;flex:1;cursor:crosshair}
.dg-skills{display:flex;gap:4px;padding:4px 6px;background:rgba(0,0,0,.9);justify-content:center;flex-shrink:0;align-items:center}
.dg-sk{position:relative;background:rgba(0,0,0,.9);border:2px solid #374151;border-radius:9px;
  padding:4px 7px;font-size:17px;cursor:pointer;color:#fff;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:42px}
.dg-sk-cnt{font-size:10px;font-weight:700;color:#a78bfa}
.dg-sk-key{font-size:7.5px;color:#4b5563}
.dg-sk-cd{position:absolute;inset:0;background:rgba(0,0,0,.55);border-radius:7px;display:none;
  align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fbbf24}
.dg-pot-btn{background:rgba(0,0,0,.85);border:2px solid #374151;border-radius:9px;padding:4px 7px;
  font-size:14px;cursor:pointer;color:#fff;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:38px}
.dg-pot-btn:disabled{opacity:.35;cursor:not-allowed}
.dg-pot-cnt{font-size:9.5px;font-weight:700;color:#4ade80}
.dg-toast{position:absolute;top:50px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.9);
  color:#fff;font-size:12px;font-weight:700;padding:5px 12px;border-radius:8px;pointer-events:none;
  white-space:nowrap;z-index:10}
.dg-toast.hidden{display:none}
.dg-floor-clear{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:rgba(0,0,0,.75);z-index:20;gap:10px}
.dg-floor-clear.hidden{display:none!important}
.dg-floor-clear-title{font-size:32px;font-weight:900;color:#f59e0b;text-shadow:0 0 30px #f59e0baa}
.dg-stat-row{display:flex;justify-content:space-between;width:100%;max-width:260px;font-size:13px;padding:3px 0}
.dg-stat-row .k{color:#6b7280}.dg-stat-row .v{font-weight:700;color:#f59e0b}
.dg-death-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:rgba(0,0,0,.82);z-index:30;gap:8px}
.dg-death-overlay.hidden{display:none!important}
</style>
<div class="dg-ov"></div>
<div class="dg-panel">
  <!-- 입장 -->
  <div class="dg-scr" id="dgEntry">
    <div style="font-size:50px">🏰</div>
    <div class="dg-title">Dungeon Survival</div>
    <div class="dg-sub">5층 랜덤 구성 · 보스: Dragon<br>타워 파괴 → 안전지역 확보<br>클릭이동 · 스킬 Q/W/E/R/T · HP🧪 MP💙</div>
    <div class="dg-fee" id="dgFeeLabel">입장료: ${BASE_FEE} GP</div>
    <div class="dg-fee-info" id="dgFeeInfo">오늘 첫 입장</div>
    <button class="dg-btn dg-btn-go" id="dgEnterBtn">⚔️ 던전 입장</button>
    <button class="dg-btn dg-btn-ghost" id="dgCloseEntry">취소</button>
  </div>
  <!-- 게임 -->
  <div class="dg-scr dg-game-wrap hidden" id="dgGame" style="padding:0">
    <div class="dg-hud">
      <div class="dg-hud-seg">❤️
        <div class="dg-bar-bg"><div class="dg-bar-fill" id="dgHpFill" style="background:#22c55e;width:100%"></div></div>
        <span id="dgHpTxt" style="font-size:9px">—</span>
      </div>
      <div class="dg-hud-seg">💧
        <div class="dg-bar-bg"><div class="dg-bar-fill" id="dgMpFill" style="background:#3b82f6;width:100%"></div></div>
        <span id="dgMpTxt" style="font-size:9px">—</span>
      </div>
      <div class="dg-hud-seg">
        <span class="dg-stg" id="dgFloorBadge">B1F</span>
        <span style="font-size:9.5px;color:#9ca3af" id="dgKillProg">0/8</span>
      </div>
      <div class="dg-hud-seg">
        <span id="dgCoins" style="color:#fbbf24">💰0</span>
        <button class="dg-xbtn" id="dgExitBtn">✕</button>
      </div>
    </div>
    <canvas id="dgCanvas"></canvas>
    <div class="dg-skills">
      ${skillBarHtml}
      <button class="dg-pot-btn" id="dgHpPotBtn" title="HP Potion" disabled>🧪<span class="dg-pot-cnt" id="dgHpPotCnt">0</span></button>
      <button class="dg-pot-btn" id="dgMpPotBtn" title="MP Potion" disabled>💙<span class="dg-pot-cnt" id="dgMpPotCnt">0</span></button>
    </div>
    <div class="dg-toast hidden" id="dgToast"></div>
    <!-- 층 클리어 -->
    <div class="dg-floor-clear hidden" id="dgFloorClear">
      <div class="dg-floor-clear-title" id="dgFloorClearTitle">층 클리어!</div>
      <div style="font-size:13px;color:#9ca3af" id="dgFloorClearSub"></div>
      <button class="dg-btn dg-btn-go" id="dgNextFloorBtn" style="max-width:200px;margin-top:8px">다음 층 →</button>
      <button class="dg-btn dg-btn-ghost" id="dgExitAfterClearBtn" style="max-width:200px">던전 나가기</button>
    </div>
    <!-- 사망 -->
    <div class="dg-death-overlay hidden" id="dgDeathOverlay">
      <div style="font-size:48px">💀</div>
      <div class="dg-title" style="color:#f87171">전멸...</div>
      <div style="font-size:12px;color:#6b7280" id="dgDeathTimer">3초 후 자동 퇴장</div>
    </div>
  </div>
  <!-- 결과 -->
  <div class="dg-scr hidden" id="dgResult">
    <div id="dgResIcon" style="font-size:50px">🏆</div>
    <div class="dg-title" id="dgResTitle">클리어!</div>
    <div id="dgResStats" style="width:100%;max-width:260px;margin-top:8px"></div>
    <button class="dg-btn dg-btn-go" id="dgReEnterBtn" style="margin-top:12px">다시 도전!</button>
    <button class="dg-btn dg-btn-ghost" id="dgLeaveBtn">던전 나가기</button>
  </div>
</div>`;
    document.body.appendChild(m);
    this._modal  = m;
    this._canvas = m.querySelector('#dgCanvas');
    this._bindUI();
  }

  _bindUI() {
    const q = id => this._modal.querySelector('#' + id);
    q('dgEnterBtn')       ?.addEventListener('click', () => this._tryEnter());
    q('dgCloseEntry')     ?.addEventListener('click', () => this.close());
    q('dgExitBtn')        ?.addEventListener('click', () => { if (confirm('던전에서 나가시겠습니까?')) this.close(); });
    q('dgNextFloorBtn')   ?.addEventListener('click', () => this._nextFloor());
    q('dgExitAfterClearBtn')?.addEventListener('click', () => this.close());
    q('dgReEnterBtn')     ?.addEventListener('click', () => this._show('dgEntry'));
    q('dgLeaveBtn')       ?.addEventListener('click', () => this.close());
    q('dgHpPotBtn')       ?.addEventListener('click', () => this._usePot('hp'));
    q('dgMpPotBtn')       ?.addEventListener('click', () => this._usePot('mp'));
    this._canvas.addEventListener('click',    e => this._onCanvasClick(e));
    this._canvas.addEventListener('touchend', e => { e.preventDefault(); if (e.changedTouches[0]) this._onCanvasClick(e.changedTouches[0]); }, { passive: false });
    D_SKILLS.forEach(sk => { q(`dgSk_${sk.id}`)?.addEventListener('click', () => this._useSkill(sk.id)); });
  }

  open() { this._modal.classList.remove('hidden'); this._show('dgEntry'); this._loadDB(); }
  close() {
    this._stop();
    this._modal.classList.add('hidden');
    this._opts?.onExit?.();
  }
  _show(id) { ['dgEntry','dgGame','dgResult'].forEach(s => this._modal.querySelector('#' + s)?.classList.toggle('hidden', s !== id)); }
  _updateEntryUI() {
    const lbl = document.getElementById('dgFeeLabel'), info = document.getElementById('dgFeeInfo'), btn = document.getElementById('dgEnterBtn');
    if (lbl)  lbl.textContent  = `입장료: ${this._entryFee} GP`;
    if (btn)  btn.textContent  = `⚔️ 던전 입장 (${this._entryFee} GP)`;
    if (info) info.textContent = this._entryCount === 0
      ? '오늘 첫 입장 · 24시간 후 리셋'
      : `오늘 ${this._entryCount}번째 · ${Math.ceil((this._entryResetAt + RESET_MS - Date.now()) / 3_600_000)}h 후 ${BASE_FEE}GP 리셋`;
  }

  // ── 입장 ────────────────────────────────────────────────────────────────────
  async _tryEnter() {
    const btn = document.getElementById('dgEnterBtn');
    if (btn) btn.disabled = true;
    await this._loadDB();
    if (!this._opts.onSpendGold(this._entryFee)) { this._toast(`GP 부족 (${this._entryFee}GP 필요)`); if (btn) btn.disabled = false; return; }
    await this._recordEntry();
    if (!this._spritesLoaded) { this._toast('스프라이트 로딩 중...'); await loadAllDungeonSprites(); this._spritesLoaded = true; }
    this._floors = generateFloors();
    this._floorIdx = 0;
    this._initState();
    this._initAudio();
    this._show('dgGame');
    this._resizeCanvas();
    this._registerKeys();
    this._run();
    if (btn) btn.disabled = false;
  }

  // ── 게임 초기화 (층별) ───────────────────────────────────────────────────────
  _initState() {
    const floor = this._floors[this._floorIdx];
    this._floor = floor;
    this._floorKills = 0;
    this._skills     = { fire:0, ice:0, bolt:0, meteor:0, wind:0 };
    this._skillCds   = { fire:0, ice:0, bolt:0, meteor:0, wind:0 };
    this._effects    = []; this._burnMap = new Map(); this._freezeSet = new Set(); this._slowMap = new Map();
    this._windActive = false; this._windEndAt = 0;
    const fl = floor.floor;
    this._p = {
      x: 0, y: 0,
      hp: this._dbHp, maxHp: this._dbMaxHp,
      mp: this._dbMp, maxMp: this._dbMaxMp,
      atk: this._dbAtk + 10, def: this._dbDef,
      atkRange: 85, atkRate: 1.2, atkCd: 0,
      tx: 0, ty: 0, moving: false, targeting: null,
      coins: this._p?.coins || 0, kills: this._p?.kills || 0, xp: this._p?.xp || 0,
      animState: 'idle', facing: 1,
    };
    this._monsters = []; this._queues = {};
    this._towers   = D_TOWER_SLOTS.map(s => ({ ...D_TOWER_DEF[s.kind], x: s.x, y: s.y, kind: s.kind, atkCd: 0, alive: true, hp: D_TOWER_DEF[s.kind].maxHp }));
    this._projs    = []; this._drops = []; this._floats = [];
    this._cam      = { x: 0, y: 0 };
    this._running  = true;
    this._floorCleared = false;
    for (const id of floor.types) {
      const base = D_MDEFS[id]; if (!base) continue;
      const def = scaleDef(base, fl);
      const count = Math.min(4, Math.max(1, Math.round(fl / 2)));
      for (let i = 0; i < count; i++) this._spawnMonster(base, def, 0);
    }
    this._updateSkillUI(); this._updateHUD(); this._updatePotUI();
    document.getElementById('dgFloorBadge').textContent = `B${fl}F`;
    document.getElementById('dgFloorClear')?.classList.add('hidden');
    document.getElementById('dgDeathOverlay')?.classList.add('hidden');
  }

  _spawnMonster(base, scaledDef, delay) {
    if (delay > 0) { (this._queues[base.id] || (this._queues[base.id] = [])).push({ base, at: Date.now() + delay }); return; }
    const a = Math.random() * Math.PI * 2, r = 290 + Math.random() * (WORLD_R * 0.62);
    const def = scaledDef ?? scaleDef(base, this._floor.floor);
    const m = { base, def, id: Math.random().toString(36).slice(2), x: Math.cos(a) * r, y: Math.sin(a) * r,
      hp: def.maxHp, atkCd: 0, state: 'walk', frame: 0, frameTimer: 0, hurtTimer: 0, facing: 1,
      bossPhase: base.isBoss ? 'normal' : null, phaseCd: base.isBoss ? 8 : 0,
      knockbackVx: 0, knockbackVy: 0, isKnockback: false };
    this._monsters.push(m);
  }

  _killMonster(m) {
    if (m.state === 'die') return;
    m.state = 'die'; m.frame = 0; m.frameTimer = 0;
    this._p.kills++; this._p.xp += m.def.xp; this._floorKills++;
    this._burnMap.delete(m.id); this._freezeSet.delete(m.id); this._slowMap.delete(m.id);
    this._drops.push({ x: m.x + (Math.random() - .5) * 30, y: m.y + (Math.random() - .5) * 30, coins: m.def.coins });
    this._addFloat(`+${m.def.coins}💰`, m.x, m.y - 24, '#4ade80');
    this._sfx('kill');
    if (Math.random() < 0.22) { const sk = D_SKILLS[Math.floor(Math.random() * D_SKILLS.length)]; this._drops.push({ x: m.x + (Math.random() - .5) * 40, y: m.y + (Math.random() - .5) * 40, skillId: sk.id }); }
    if (Math.random() < 0.20) this._drops.push({ x: m.x + (Math.random() - .5) * 40, y: m.y + (Math.random() - .5) * 40, potion: true, heal: Math.round(15 + this._floor.floor * 3) });
    if (Math.random() < 0.15) this._drops.push({ x: m.x + (Math.random() - .5) * 40, y: m.y + (Math.random() - .5) * 40, mpPotion: true, restore: Math.round(10 + this._floor.floor * 2) });
    const needed = this._floor.kills;
    document.getElementById('dgKillProg').textContent = `${this._floorKills}/${needed}`;
    if (!m.base.isBoss) this._spawnMonster(m.base, null, Math.max(5000, 20000 - this._floor.floor * 800));
    if (this._floorKills >= needed && !this._floorCleared) { this._floorCleared = true; setTimeout(() => this._showFloorClear(), 600); }
  }

  _showFloorClear() {
    const el = document.getElementById('dgFloorClear');
    const title = document.getElementById('dgFloorClearTitle');
    const sub   = document.getElementById('dgFloorClearSub');
    const next  = document.getElementById('dgNextFloorBtn');
    if (!el) return;
    const isLast = this._floorIdx >= this._floors.length - 1;
    if (title) title.textContent = isLast ? '🏆 던전 클리어!' : `${this._floor.label} 클리어!`;
    if (sub)   sub.textContent   = `처치: ${this._p.kills} · 코인: ${this._p.coins} · XP: ${this._p.xp}`;
    if (next)  next.style.display = isLast ? 'none' : '';
    el.classList.remove('hidden');
    if (isLast) setTimeout(() => this._showResult(true), 2000);
  }

  _nextFloor() {
    const el = document.getElementById('dgFloorClear');
    el?.classList.add('hidden');
    this._floorIdx++;
    if (this._floorIdx >= this._floors.length) { this._showResult(true); return; }
    this._initState();
  }

  // ── 스킬 ────────────────────────────────────────────────────────────────────
  _useSkill(id) {
    if (!this._running || this._floorCleared) return;
    if (!(this._skills[id] > 0)) { this._toast(`${id} 스킬 없음`); return; }
    if ((this._skillCds[id] || 0) > 0) { this._toast('쿨다운 중'); return; }
    this._skills[id]--;
    const p = this._p, now = Date.now(), s = this._floor.floor;
    const sk = D_SKILLS.find(x => x.id === id);
    if (id === 'fire') {
      const r = 260, dmg = 80 + s * 12, dps = 15 + s * 2;
      this._effects.push({ type:'fire', x:p.x, y:p.y, r, startAt:now, dur:700, color:'#f97316' });
      for (const m of this._monsters) { if (m.state === 'die') continue; if (Math.hypot(m.x - p.x, m.y - p.y) <= r) { m.hp -= dmg; this._burnMap.set(m.id, { dps, endAt: now + 3000 }); if (m.hp <= 0) this._killMonster(m); } }
    } else if (id === 'ice') {
      const r = 320, dmg = 40 + s * 8;
      this._effects.push({ type:'ice', x:p.x, y:p.y, r, startAt:now, dur:700, color:'#38bdf8' });
      for (const m of this._monsters) { if (m.state === 'die') continue; if (Math.hypot(m.x - p.x, m.y - p.y) <= r) { m.hp -= dmg; this._freezeSet.add(m.id); setTimeout(() => this._freezeSet.delete(m.id), 3000); if (m.hp <= 0) this._killMonster(m); } }
    } else if (id === 'bolt') {
      const chainR = 220, dmg = 100 + s * 18; let src = { x:p.x, y:p.y }; const used = new Set(), segs = [];
      for (let c = 0; c < 5; c++) { let best = null, bestD = chainR; for (const m of this._monsters) { if (m.state === 'die' || used.has(m.id)) continue; const d = Math.hypot(m.x - src.x, m.y - src.y); if (d < bestD) { bestD = d; best = m; } } if (!best) break; used.add(best.id); segs.push({ from: {...src}, to: {x:best.x,y:best.y} }); best.hp -= dmg; if (best.hp <= 0) this._killMonster(best); src = {x:best.x,y:best.y}; }
      this._effects.push({ type:'bolt', targets:segs, startAt:now, dur:500, color:'#facc15' });
    } else if (id === 'meteor') {
      const tx = p.x, ty = p.y, r = 200, dmg = 200 + s * 25;
      this._effects.push({ type:'meteor_warn', x:tx, y:ty, r, startAt:now, dur:800, color:'#fb923c' });
      setTimeout(() => { if (!this._running) return; this._effects.push({ type:'meteor_hit', x:tx, y:ty, r, startAt:Date.now(), dur:400, color:'#ef4444' }); for (const m of this._monsters) { if (m.state === 'die') continue; if (Math.hypot(m.x - tx, m.y - ty) <= r) { m.hp -= dmg; if (m.hp <= 0) this._killMonster(m); } } this._sfx('skill'); }, 800);
    } else if (id === 'wind') {
      this._windActive = true; this._windEndAt = now + 5000;
      this._effects.push({ type:'wind', x:p.x, y:p.y, r:160, startAt:now, dur:5000, color:'#a78bfa' });
    }
    this._skillCds[id] = sk.cd;
    this._sfx('skill'); this._updateSkillUI();
  }

  _usePot(type) {
    const inventory = this._opts.getInventory?.() || {};
    const itemId = type === 'hp' ? 'potion_red' : 'potion_mp';
    if (!(inventory[itemId] > 0)) return;
    const ok = this._opts.onUseItem?.(itemId);
    if (!ok) return;
    if (type === 'hp') {
      const heal = Math.round(this._p.maxHp * 0.35);
      this._p.hp = Math.min(this._p.maxHp, this._p.hp + heal);
      this._addFloat(`+${heal}❤️`, this._p.x, this._p.y - 40, '#4ade80');
      this._toast(`🧪 HP +${heal}`);
    } else {
      const restore = Math.round(this._p.maxMp * 0.35);
      this._p.mp = Math.min(this._p.maxMp, this._p.mp + restore);
      this._addFloat(`+${restore}💙`, this._p.x, this._p.y - 40, '#60a5fa');
      this._toast(`💙 MP +${restore}`);
    }
    this._sfx('skill'); this._updatePotUI(); this._updateHUD();
  }

  _updatePotUI() {
    const inv = this._opts.getInventory?.() || {};
    const hp = inv['potion_red'] || 0, mp = inv['potion_mp'] || 0;
    const hb = document.getElementById('dgHpPotBtn'), mb = document.getElementById('dgMpPotBtn');
    const hc = document.getElementById('dgHpPotCnt'), mc = document.getElementById('dgMpPotCnt');
    if (hb) hb.disabled = hp === 0; if (hc) hc.textContent = hp;
    if (mb) mb.disabled = mp === 0; if (mc) mc.textContent = mp;
  }

  // ── 메인 업데이트 ────────────────────────────────────────────────────────────
  _update(dt) {
    if (this._floorCleared) { this._updateHUD(); return; }
    const p = this._p, now = Date.now();

    for (const id in this._skillCds) if (this._skillCds[id] > 0) this._skillCds[id] = Math.max(0, this._skillCds[id] - dt);
    for (const id in this._queues) {
      this._queues[id] = this._queues[id].filter(q => { if (now >= q.at) { this._spawnMonster(q.base, null, 0); return false; } return true; });
    }
    if (this._windActive) {
      if (now >= this._windEndAt) this._windActive = false;
      else { const dps = (25 + this._floor.floor * 6) * dt; for (const m of this._monsters) { if (m.state === 'die') continue; if (Math.hypot(m.x - p.x, m.y - p.y) <= 160) { m.hp -= dps; if (m.hp <= 0) this._killMonster(m); } } for (const ef of this._effects) if (ef.type === 'wind') { ef.x = p.x; ef.y = p.y; } }
    }
    for (const [mid, burn] of this._burnMap) { if (now >= burn.endAt) { this._burnMap.delete(mid); continue; } const m = this._monsters.find(x => x.id === mid && x.state !== 'die'); if (!m) { this._burnMap.delete(mid); continue; } m.hp -= burn.dps * dt; if (m.hp <= 0) this._killMonster(m); }
    this._effects = this._effects.filter(ef => now - ef.startAt < ef.dur);

    // 플레이어 이동
    if (p.moving) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      if (d < 6) { p.moving = false; p.animState = 'idle'; }
      else { const sp = Math.min(185 * dt, d); p.x += dx / d * sp; p.y += dy / d * sp; p.animState = 'walk'; p.facing = dx > 0 ? 1 : -1; }
    } else if (!p.targeting) { p.animState = 'idle'; }
    const pd = Math.hypot(p.x, p.y);
    if (pd > WORLD_R - 22) { p.x = p.x / pd * (WORLD_R - 22); p.y = p.y / pd * (WORLD_R - 22); p.moving = false; }

    // 플레이어 공격
    p.atkCd = Math.max(0, p.atkCd - dt);
    if (p.atkCd === 0) {
      let tgt = p.targeting;
      if (tgt && tgt._isTower && !tgt.alive) { tgt = null; p.targeting = null; }
      if (!tgt || (!tgt._isTower && tgt.state === 'die')) {
        tgt = null; let minD = p.atkRange;
        for (const t of this._towers) { if (!t.alive) continue; const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < minD) { minD = d; tgt = t; tgt._isTower = true; } }
        for (const m of this._monsters) { if (m.state === 'die') continue; const d = Math.hypot(m.x - p.x, m.y - p.y); if (d < minD) { minD = d; tgt = m; } }
        p.targeting = tgt;
      }
      if (tgt) {
        const tx = tgt.x, ty = tgt.y;
        const d = Math.hypot(tx - p.x, ty - p.y);
        if (d <= p.atkRange) {
          p.moving = false; p.animState = 'atk'; p.facing = tx > p.x ? 1 : -1;
          const dmg = Math.max(1, p.atk);
          if (tgt._isTower) {
            tgt.hp -= dmg; this._addFloat(`-${Math.round(dmg)}🔨`, tgt.x, tgt.y - 32, '#f59e0b');
            if (tgt.hp <= 0) { tgt.alive = false; tgt.hp = 0; this._addFloat('💥파괴!', tgt.x, tgt.y - 50, '#ef4444'); this._toast(`🏚 ${D_TOWER_DEF[tgt.kind].label} 파괴!`); this._sfx('kill'); p.targeting = null; }
          } else {
            tgt.hp -= dmg; tgt.state = 'hurt'; tgt.hurtTimer = 0.18; tgt.frame = 0; tgt.frameTimer = 0;
            this._addFloat(`-${Math.round(dmg)}`, tgt.x, tgt.y - 18, '#f87171'); this._sfx('hit');
            if (tgt.hp <= 0) this._killMonster(tgt);
          }
          p.atkCd = 1 / p.atkRate;
        } else { p.tx = tx; p.ty = ty; p.moving = true; }
      } else { p.animState = 'idle'; }
    }

    // 몬스터 AI
    for (const m of this._monsters) {
      if (m.state === 'gone') continue;
      if (m.state === 'die') { m.frameTimer += dt; if (m.frameTimer > 0.11) { m.frameTimer = 0; m.frame++; } const nf = MSPRITE_DEFS[m.base.sp]?.die.length || 6; if (m.frame >= nf) m.state = 'gone'; continue; }
      if (this._freezeSet.has(m.id)) { this._animSpr(m, 'walk', 0.13, dt); continue; }
      m.atkCd = Math.max(0, m.atkCd - dt);
      if (m.hurtTimer > 0) { m.hurtTimer -= dt; this._animSpr(m, 'hurt', 0.085, dt); continue; }
      if (m.isKnockback) { m.x += m.knockbackVx * dt; m.y += m.knockbackVy * dt; m.knockbackVx *= Math.pow(0.05, dt); m.knockbackVy *= Math.pow(0.05, dt); if (Math.abs(m.knockbackVx) < 1 && Math.abs(m.knockbackVy) < 1) m.isKnockback = false; }
      const isSlow = (this._slowMap.get(m.id) || 0) > now;
      const dx = p.x - m.x, dy = p.y - m.y, dist = Math.hypot(dx, dy);
      m.facing = dx > 0 ? 1 : -1;

      // 드래곤 보스 패턴
      if (m.base.isBoss) this._updateBoss(m, dt, now, p);

      if (dist <= m.def.range) {
        m.state = 'atk'; this._animSpr(m, 'atk', 0.1, dt);
        if (m.atkCd === 0) {
          if (m.def.ranged) this._fireProj(m.x, m.y, p.x, p.y, { atk: m.def.atk, src: 'mob', spd: 230, color: '#f87171', r: 7 });
          else { const red = Math.max(1, m.def.atk - Math.floor(p.def * 0.4)); p.hp -= red; this._addFloat(`-${red}`, p.x, p.y - 30, '#ff5555'); this._sfx('hit'); }
          m.atkCd = 1.1;
        }
      } else {
        m.state = 'walk'; this._animSpr(m, 'walk', 0.13, dt);
        const spd = m.def.spd * (isSlow ? 0.45 : 1) * dt; m.x += dx / dist * spd; m.y += dy / dist * spd;
      }
      const md = Math.hypot(m.x, m.y); if (md > WORLD_R - 15) { m.x = m.x / md * (WORLD_R - 15); m.y = m.y / md * (WORLD_R - 15); }
    }
    this._monsters = this._monsters.filter(m => m.state !== 'gone');

    // 타워 공격 플레이어
    for (const t of this._towers) {
      if (!t.alive) continue; t.atkCd = Math.max(0, t.atkCd - dt);
      if (t.atkCd > 0) continue;
      const dp = Math.hypot(p.x - t.x, p.y - t.y);
      if (dp <= t.range) {
        if (t.kind === 'archer') {
          this._fireProj(t.x, t.y, p.x, p.y, { atk: t.atk, src: 'tower', spd: 310, color: t.color, r: 6, isPiercing: true });
        } else {
          this._fireProj(t.x, t.y, p.x, p.y, { atk: t.atk, src: 'tower', spd: 200, color: t.color, r: 9, isAoe: true, aoeR: t.aoeR, knockback: t.knockback, slowDur: t.slowDur });
        }
        t.atkCd = 1 / t.rate;
      }
    }

    // 발사체
    this._projs = this._projs.filter(proj => {
      proj.x += proj.vx * dt; proj.y += proj.vy * dt; proj.ttl -= dt;
      if (proj.ttl <= 0) return false;
      if (proj.src === 'mob' || proj.src === 'tower') {
        if (Math.hypot(proj.x - p.x, proj.y - p.y) < 22) {
          const red = Math.max(1, proj.atk - Math.floor(p.def * 0.4));
          p.hp -= red; this._addFloat(`-${red}`, p.x, p.y - 30, '#ff5555'); this._sfx('hit');
          if (proj.isAoe) {
            // 폭발 AoE
            this._effects.push({ type:'explosion', x:proj.x, y:proj.y, r:proj.aoeR||80, startAt:Date.now(), dur:600, color:'#f97316' });
            this._effects.push({ type:'knockback_ring', x:proj.x, y:proj.y, r:proj.aoeR||80, startAt:Date.now(), dur:500, color:'#a78bfa' });
          }
          return false;
        }
      }
      return true;
    });

    // 드롭 픽업
    this._drops = this._drops.filter(drop => {
      if (Math.hypot(drop.x - p.x, drop.y - p.y) < 36) {
        if (drop.skillId) { this._skills[drop.skillId] = (this._skills[drop.skillId] || 0) + 1; const sk = D_SKILLS.find(s => s.id === drop.skillId); this._addFloat(`${sk?.emoji}+1`, p.x, p.y - 46, '#e879f9'); this._toast(`${sk?.emoji} ${sk?.label}!`); this._updateSkillUI(); }
        else if (drop.potion) { const h = Math.min(drop.heal, p.maxHp - p.hp); p.hp += h; this._addFloat(`+${h}❤️`, p.x, p.y - 46, '#f87171'); }
        else if (drop.mpPotion) { const r = Math.min(drop.restore, p.maxMp - p.mp); p.mp += r; this._addFloat(`+${r}💙`, p.x, p.y - 46, '#60a5fa'); }
        else { p.coins += drop.coins; this._opts.onAddGold(drop.coins); }
        return false;
      }
      return true;
    });

    this._floats = this._floats.filter(f => { f.life -= dt; f.wy -= 42 * dt; return f.life > 0; });
    this._cam.x = p.x; this._cam.y = p.y;
    this._updateHUD();
    if (p.hp <= 0 && this._running && !this._dying) { this._sfx('death'); this._dying = true; p.animState = 'death'; this._deathTimer(); }
  }

  _updateBoss(m, dt, now, p) {
    m.phaseCd = Math.max(0, m.phaseCd - dt);
    if (m.phaseCd > 0) return;
    const roll = Math.random();
    if (roll < 0.33) {
      // 화염 브레스
      m.bossPhase = 'breath'; m.breathAngle = Math.atan2(p.y - m.y, p.x - m.x); m.breathTimer = 0;
      const dmg = m.def.atk * 0.6; const now2 = Date.now();
      this._effects.push({ type:'fire', x:m.x, y:m.y, r:180, startAt:now2, dur:800, color:'#f97316' });
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      const adiff = Math.abs(Math.atan2(p.y - m.y, p.x - m.x) - m.breathAngle);
      if (d <= 200 && adiff < 0.55) { p.hp -= dmg; this._burnMap.set('player_burn', { dps: 8, endAt: now2 + 2500 }); this._addFloat(`-${Math.round(dmg)}🔥`, p.x, p.y - 30, '#f97316'); }
      m.bossPhase = 'normal'; m.phaseCd = 5 + Math.random() * 3;
    } else if (roll < 0.66) {
      // 돌진 — 높은 속도로 플레이어 향해 이동
      const dx = p.x - m.x, dy = p.y - m.y, dist = Math.hypot(dx, dy);
      if (dist > 60) { const sp = m.def.spd * 4 * dt; m.x += dx / dist * sp; m.y += dy / dist * sp; }
      const dmg = m.def.atk * 1.5; if (Math.hypot(p.x - m.x, p.y - m.y) < 80) { p.hp -= dmg; this._addFloat(`-${Math.round(dmg)}`, p.x, p.y - 30, '#ef4444'); this._sfx('hit'); }
      m.phaseCd = 4 + Math.random() * 2;
    } else {
      // 광역 슬램
      const dmg = m.def.atk * 1.2; const r = 220; const now2 = Date.now();
      this._effects.push({ type:'meteor_warn', x:m.x, y:m.y, r, startAt:now2, dur:800, color:'#dc2626' });
      setTimeout(() => { if (!this._running) return; this._effects.push({ type:'meteor_hit', x:m.x, y:m.y, r, startAt:Date.now(), dur:500, color:'#ef4444' }); if (Math.hypot(p.x - m.x, p.y - m.y) <= r) { p.hp -= dmg; this._addFloat(`-${Math.round(dmg)}💥`, p.x, p.y - 30, '#ef4444'); this._sfx('hit'); } }, 800);
      m.phaseCd = 6 + Math.random() * 3;
    }
  }

  _deathTimer() {
    const ov = document.getElementById('dgDeathOverlay'), txt = document.getElementById('dgDeathTimer');
    if (ov) ov.classList.remove('hidden');
    let count = 3;
    const iv = setInterval(() => {
      count--;
      if (txt) txt.textContent = count > 0 ? `${count}초 후 자동 퇴장` : '퇴장 중...';
      if (count <= 0) { clearInterval(iv); this._showResult(false); }
    }, 1000);
  }

  _animSpr(m, anim, spd, dt) {
    m.frameTimer += dt; if (m.frameTimer >= spd) { m.frameTimer = 0; const nf = MSPRITE_DEFS[m.base.sp]?.[anim]?.length || 6; m.frame = (m.frame + 1) % nf; }
  }

  _fireProj(fx, fy, tx, ty, opts) {
    const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy) || 1;
    this._projs.push({ x:fx, y:fy, vx:dx/d*opts.spd, vy:dy/d*opts.spd, ttl:d/opts.spd+0.5, ...opts });
  }

  _addFloat(text, wx, wy, color) { this._floats.push({ text, wx, wy, color, life: 1.2 }); }

  // ── 루프 / 렌더 ─────────────────────────────────────────────────────────────
  _run() {
    if (!this._running) return;
    this._lastTs = performance.now();
    const loop = ts => {
      if (!this._running) return;
      const dt = Math.min((ts - this._lastTs) / 1000, 0.1); this._lastTs = ts;
      this._update(dt);
      renderDungeonFrame({
        monsters: this._monsters, towers: this._towers, player: this._p,
        drops: this._drops, floats: this._floats, projs: this._projs, effects: this._effects,
        cam: this._cam, windActive: this._windActive, ts, floorDef: this._floor,
        boss: this._floor?.boss ? this._monsters.find(m => m.base.isBoss && m.state !== 'die') : null,
        freezeSet: this._freezeSet, burnMap: this._burnMap, worldR: WORLD_R,
        skills: D_SKILLS,
      });
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stop() {
    this._running = false; this._dying = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._stopAmbient();
    if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
  }

  _resizeCanvas() {
    const gw = this._modal.querySelector('#dgGame'); if (!gw) return;
    const hud = this._modal.querySelector('.dg-hud'), bar = this._modal.querySelector('.dg-skills');
    const r = gw.getBoundingClientRect();
    const hh = hud?.getBoundingClientRect().height || 38, bh = bar?.getBoundingClientRect().height || 46;
    this._canvas.width  = Math.max(280, Math.floor(r.width));
    this._canvas.height = Math.max(160, Math.floor(r.height - hh - bh));
    initDungeonRenderer(this._canvas);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────
  _updateHUD() {
    const p = this._p;
    const hpP = Math.max(0, p.hp / p.maxHp * 100), mpP = Math.max(0, p.mp / p.maxMp * 100);
    const hf = document.getElementById('dgHpFill'), mf = document.getElementById('dgMpFill');
    const ht = document.getElementById('dgHpTxt'), mt = document.getElementById('dgMpTxt');
    if (hf) { hf.style.width = hpP + '%'; hf.style.background = hpP > 50 ? '#22c55e' : hpP > 25 ? '#f59e0b' : '#ef4444'; }
    if (mf) mf.style.width = mpP + '%';
    if (ht) ht.textContent = `${Math.max(0, Math.floor(p.hp))}/${p.maxHp}`;
    if (mt) mt.textContent = `${Math.max(0, Math.floor(p.mp))}/${p.maxMp}`;
    const co = document.getElementById('dgCoins'); if (co) co.textContent = `💰${p.coins}`;
    this._updateSkillUI();
  }

  _updateSkillUI() {
    D_SKILLS.forEach(sk => {
      const cnt = document.getElementById(`dgSkC_${sk.id}`), cd = document.getElementById(`dgSkD_${sk.id}`), btn = document.getElementById(`dgSk_${sk.id}`);
      const count = this._skills?.[sk.id] || 0, cooldown = this._skillCds?.[sk.id] || 0;
      if (cnt) cnt.textContent = count;
      if (btn) { btn.style.opacity = (count > 0 && cooldown <= 0) ? '1' : '0.4'; btn.style.borderColor = count > 0 ? sk.color : '#374151'; }
      if (cd) { if (cooldown > 0) { cd.style.display = 'flex'; cd.textContent = Math.ceil(cooldown) + 's'; } else cd.style.display = 'none'; }
    });
  }

  // ── 입력 ────────────────────────────────────────────────────────────────────
  _onCanvasClick(e) {
    if (!this._running || this._floorCleared || this._dying) return;
    const rect = this._canvas.getBoundingClientRect();
    const sx = ((e.clientX ?? e.pageX) - rect.left) * (this._canvas.width / rect.width);
    const sy = ((e.clientY ?? e.pageY) - rect.top)  * (this._canvas.height / rect.height);
    const wx = sx - this._canvas.width / 2 + this._cam.x, wy = sy - this._canvas.height / 2 + this._cam.y;
    for (const t of this._towers) { if (!t.alive) continue; if (Math.hypot(t.x - wx, t.y - wy) < (t.sz / 2 + 12)) { this._p.targeting = t; t._isTower = true; return; } }
    let hit = null, bestD = 36;
    for (const m of this._monsters) { if (m.state === 'die') continue; const d = Math.hypot(m.x - wx, m.y - wy); if (d < bestD) { bestD = d; hit = m; } }
    if (hit) { this._p.targeting = hit; return; }
    this._p.tx = wx; this._p.ty = wy; this._p.moving = true; this._p.targeting = null;
  }

  _registerKeys() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    const map = { q:'fire', w:'ice', e:'bolt', r:'meteor', t:'wind' };
    this._keyHandler = ev => { if (!this._running) return; const sk = map[ev.key.toLowerCase()]; if (sk) { ev.preventDefault(); this._useSkill(sk); } };
    document.addEventListener('keydown', this._keyHandler);
  }

  // ── 오디오 ──────────────────────────────────────────────────────────────────
  _initAudio() { try { if (!this._audio) this._audio = new AudioContext(); if (this._audio.state === 'suspended') this._audio.resume(); this._startAmbient(); } catch {} }
  _startAmbient() {
    if (!this._audio || this._ambNodes) return;
    const a = this._audio, osc = a.createOscillator(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 52; g.gain.value = 0.03;
    lfo.frequency.value = 0.22; lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(g.gain); osc.connect(g); g.connect(a.destination);
    lfo.start(); osc.start(); this._ambNodes = { osc, lfo, g };
  }
  _stopAmbient() { if (!this._ambNodes) return; try { this._ambNodes.osc.stop(); this._ambNodes.lfo.stop(); } catch {} this._ambNodes = null; }
  _sfx(type) {
    if (!this._audio) return;
    const a = this._audio, sr = a.sampleRate, dur = type === 'death' ? 0.42 : 0.12;
    const buf = a.createBuffer(1, Math.ceil(sr * dur), sr), ch = buf.getChannelData(0);
    if (type === 'hit')       for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / sr * 28);
    else if (type === 'kill') for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i * 440 / sr * Math.PI * 2) * Math.exp(-i / sr * 16);
    else if (type === 'skill')for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i * 880 / sr * Math.PI * 2) * Math.exp(-i / sr * 11);
    else                      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / sr * 5);
    const src = a.createBufferSource(), g = a.createGain(); src.buffer = buf; g.gain.value = 0.22;
    src.connect(g); g.connect(a.destination); src.start();
  }

  // ── 결과 ────────────────────────────────────────────────────────────────────
  _showResult(cleared) {
    this._stop();
    const p = this._p;
    document.getElementById('dgResIcon').textContent  = cleared ? '🏆' : '💀';
    document.getElementById('dgResTitle').textContent = cleared ? '던전 클리어!' : '전멸!';
    document.getElementById('dgResTitle').style.color = cleared ? '#22c55e' : '#f87171';
    document.getElementById('dgResStats').innerHTML   = `
      <div class="dg-stat-row"><span class="k">도달 층</span><span class="v">B${this._floor.floor}F — ${this._floor.label}</span></div>
      <div class="dg-stat-row"><span class="k">처치 수</span><span class="v">${p.kills}마리</span></div>
      <div class="dg-stat-row"><span class="k">획득 코인</span><span class="v">${p.coins} 💰</span></div>
      <div class="dg-stat-row"><span class="k">획득 XP</span><span class="v">${p.xp} XP</span></div>`;
    this._updateEntryUI();
    this._show('dgResult');
  }

  _toast(msg) {
    const el = document.getElementById('dgToast'); if (!el) return;
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(this._toastTmr);
    this._toastTmr = setTimeout(() => el.classList.add('hidden'), 2600);
  }
}
