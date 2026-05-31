// assets/js/pages/merchants.dungeon.js — Dungeon Survival v3
import { db, auth } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const BASE_FEE   = 100;
const FEE_STEP   = 50;
const RESET_MS   = 24 * 60 * 60 * 1000;
const GAME_KEY   = 'dungeonEntry';
const D_WORLD_R  = 950;
const D_MAX_STAGE= 20;

// ── 스프라이트 경로 정의 ───────────────────────────────────────────────────────
const S3 = n => String(n).padStart(3,'0');
const FS  = (dir,pfx,anim,n) => Array.from({length:n},(_,i)=>`/assets/images/monsters/${dir}/${pfx}${anim}_${S3(i)}.png`);
const FN  = (dir,pfx,n)      => Array.from({length:n},(_,i)=>`/assets/images/monsters/${dir}/${pfx}${i+1}.png`);

const MSPRITES = {
  orc1:    { walk:FS('orc','ORK_01_','WALK',6),    atk:FS('orc','ORK_01_','ATTAK',6),   hurt:FS('orc','ORK_01_','HURT',6),   die:FS('orc','ORK_01_','DIE',6)   },
  orc2:    { walk:FS('orc2','ORK_02_','WALK',6),   atk:FS('orc2','ORK_02_','ATTAK',6),  hurt:FS('orc2','ORK_02_','HURT',6),  die:FS('orc2','ORK_02_','DIE',6)  },
  orc3:    { walk:FS('orc3','ORK_03_','WALK',6),   atk:FS('orc3','ORK_03_','ATTAK',6),  hurt:FS('orc3','ORK_03_','HURT',6),  die:FS('orc3','ORK_03_','DIE',6)  },
  pirate1: { walk:FS('pirate','1_entity_000_','WALK',6), atk:FS('pirate','1_entity_000_','ATTACK',6), hurt:FS('pirate','1_entity_000_','HURT',6), die:FS('pirate','1_entity_000_','DIE',6) },
  pirate2: { walk:FS('pirate2','2_entity_000_','WALK',6), atk:FS('pirate2','2_entity_000_','ATTACK',6), hurt:FS('pirate2','2_entity_000_','HURT',6), die:FS('pirate2','2_entity_000_','DIE',6) },
  pirate3: { walk:FS('pirate3','3_3-PIRATE_','WALK',6),   atk:FS('pirate3','3_3-PIRATE_','ATTACK',6),  hurt:FS('pirate3','3_3-PIRATE_','HURT',6),  die:FS('pirate3','3_3-PIRATE_','DIE',6) },
  zombie:  { walk:FN('zombie1/animation','Run',8),  atk:FN('zombie1/animation','Attack',6), hurt:FN('zombie1/animation','Hurt',5),  die:FN('zombie1/animation','Dead',8) },
  dragon:  { walk:Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/fly${S3(i)}.png`),
             atk: Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/attak${S3(i)}.png`),
             hurt:Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/idle${S3(i)}.png`),
             die: Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/attak${S3(i)}.png`) },
};

// ── 몬스터 정의 ───────────────────────────────────────────────────────────────
const D_MDEFS = [
  { id:'orc1',    label:'Orc',          sp:'orc1',    sz:50, minStage:1,  maxHp:240, atk:22, spd:72,  range:70,  ranged:false, xp:20, coins:4  },
  { id:'pirate1', label:'Pirate',        sp:'pirate1', sz:48, minStage:1,  maxHp:180, atk:18, spd:90,  range:65,  ranged:false, xp:15, coins:3  },
  { id:'zombie',  label:'Zombie',        sp:'zombie',  sz:52, minStage:2,  maxHp:160, atk:24, spd:108, range:68,  ranged:false, xp:22, coins:5  },
  { id:'orc2',    label:'Orc Elite',     sp:'orc2',    sz:56, minStage:3,  maxHp:320, atk:30, spd:65,  range:75,  ranged:false, xp:35, coins:7  },
  { id:'pirate2', label:'Pirate Capt',   sp:'pirate2', sz:52, minStage:4,  maxHp:260, atk:28, spd:80,  range:150, ranged:true,  xp:30, coins:8  },
  { id:'orc3',    label:'Dark Orc',      sp:'orc3',    sz:58, minStage:6,  maxHp:420, atk:38, spd:58,  range:78,  ranged:false, xp:55, coins:10 },
  { id:'pirate3', label:'Pirate Brsrk',  sp:'pirate3', sz:54, minStage:7,  maxHp:350, atk:42, spd:68,  range:130, ranged:true,  xp:60, coins:12 },
  { id:'dragon',  label:'Dragon',        sp:'dragon',  sz:84, minStage:10, maxHp:800, atk:75, spd:55,  range:220, ranged:true,  xp:120,coins:20 },
];

// ── 타워 정의 (대포·아처 모두 플레이어 공격) ─────────────────────────────────
const D_TOWER_DEF = {
  cannon: { maxHp:380, atk:30, range:240, rate:0.22, img:'tower',  sz:48, label:'대포 타워', color:'#ef4444' },
  archer: { maxHp:260, atk:22, range:310, rate:2.0,  img:'tower2', sz:42, label:'아처 타워', color:'#fbbf24' },
};

const D_TOWER_SLOTS = (() => {
  const s=[];
  for (let i=0;i<8;  i++) { const a=(i/8)*Math.PI*2;   s.push({x:Math.cos(a)*420,y:Math.sin(a)*420,kind:'cannon'}); }
  for (let i=0;i<12; i++) { const a=(i/12)*Math.PI*2;  s.push({x:Math.cos(a)*720,y:Math.sin(a)*720,kind:'archer'}); }
  return s;
})();

// ── 스킬 정의 ─────────────────────────────────────────────────────────────────
const D_SKILLS = [
  { id:'fire',   emoji:'🔥', label:'Fire Storm',   key:'Q', color:'#f97316', cd:8  },
  { id:'ice',    emoji:'❄️', label:'Ice Freeze',   key:'W', color:'#38bdf8', cd:10 },
  { id:'bolt',   emoji:'⚡', label:'Chain Bolt',   key:'E', color:'#facc15', cd:7  },
  { id:'meteor', emoji:'☄️', label:'Meteor',       key:'R', color:'#fb923c', cd:15 },
  { id:'wind',   emoji:'🌪️', label:'Whirlwind',   key:'T', color:'#a78bfa', cd:20 },
];

// ── 스테이지 헬퍼 ─────────────────────────────────────────────────────────────
const stageMult     = s => 0.25 + s * 0.09;
const stageCount    = s => Math.min(5, Math.max(1, Math.round(s / 2)));
const stageRespawn  = s => Math.max(5000, 20000 - (s-1)*800);
const stageKills    = s => 5 + s * 3;

function scaleDef(base, stage) {
  const m = stageMult(stage);
  return { ...base, maxHp:Math.round(base.maxHp*m), atk:Math.max(1,Math.round(base.atk*m)),
    spd:Math.round(base.spd*(1+(stage-1)*0.04)), coins:Math.max(1,Math.round(base.coins*(1+(stage-1)*0.1))),
    xp:Math.round(base.xp*(1+(stage-1)*0.05)) };
}

// ── 싱글톤 ───────────────────────────────────────────────────────────────────
let _instance = null;
export function initDungeonGame(opts) { _instance = new DungeonGame(opts); }
export function openDungeonGame()     { _instance?.open(); }

// ══════════════════════════════════════════════════════════════════════════════
class DungeonGame {
  constructor({ onSpendGold, onAddGold, onPlaySound }) {
    this._spend  = onSpendGold;
    this._add    = onAddGold;
    this._snd    = onPlaySound;
    this._uid    = null;
    this._imgs   = {};        // 스프라이트 이미지 캐시
    this._tImgs  = {};        // 타워 이미지
    this._audio  = null;
    this._ambNodes = null;
    this._running  = false;
    this._raf      = null;
    this._keyHandler = null;
    this._entryFee   = BASE_FEE;
    this._entryCount = 0;
    this._entryResetAt = 0;
    // player DB stats
    this._dbHp  = 200; this._dbMaxHp = 200;
    this._dbAtk = 25;  this._dbDef   = 0;
    this._buildDOM();
    // auth uid 캐시
    auth.onAuthStateChanged?.(u => { this._uid = u?.uid||null; });
    if (!auth.onAuthStateChanged && auth.currentUser) this._uid = auth.currentUser.uid;
  }

  // ── DB ─────────────────────────────────────────────────────────────────────
  async _loadDB() {
    if (!this._uid) return;
    try {
      const d = (await getDoc(doc(db,'battle_players',this._uid))).data()||{};
      this._dbHp  = d.hp   ||200; this._dbMaxHp = d.maxHp||this._dbHp;
      this._dbAtk = d.attack||25; this._dbDef   = d.defense||0;
      const entry = d[GAME_KEY]||{};
      const now = Date.now();
      if (!entry.resetAt || now-entry.resetAt>RESET_MS) {
        this._entryCount=0; this._entryResetAt=0;
      } else {
        this._entryCount=entry.count||0; this._entryResetAt=entry.resetAt;
      }
      this._entryFee = BASE_FEE + this._entryCount * FEE_STEP;
    } catch {}
    this._updateEntryUI();
  }

  async _recordEntry() {
    if (!this._uid) return;
    try {
      const now = Date.now();
      const isReset = !this._entryResetAt || now-this._entryResetAt>RESET_MS;
      const newCount   = isReset ? 1 : this._entryCount+1;
      const newResetAt = isReset ? now : this._entryResetAt;
      await updateDoc(doc(db,'battle_players',this._uid),{
        gold: increment(-this._entryFee),
        [`${GAME_KEY}.count`]:   newCount,
        [`${GAME_KEY}.resetAt`]: newResetAt,
      });
      this._entryCount   = newCount;
      this._entryResetAt = newResetAt;
      this._entryFee     = BASE_FEE + newCount * FEE_STEP;
    } catch {}
  }

  // ── 스프라이트 로딩 ─────────────────────────────────────────────────────────
  _loadSprites() {
    const ld = src => new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src; });
    const allPaths = [];
    for (const [key, def] of Object.entries(MSPRITES)) {
      for (const anim of ['walk','atk','hurt','die']) {
        def[anim].forEach((src,fi) => {
          allPaths.push(ld(src).then(img=>{ if(!this._imgs[key]) this._imgs[key]={walk:[],atk:[],hurt:[],die:[]}; this._imgs[key][anim][fi]=img; }));
        });
      }
    }
    allPaths.push(ld('/assets/images/shops/tower.png').then(img=>this._tImgs.tower=img));
    allPaths.push(ld('/assets/images/shops/tower2.png').then(img=>this._tImgs.tower2=img));
    return Promise.all(allPaths);
  }

  // ── DOM 빌드 ───────────────────────────────────────────────────────────────
  _buildDOM() {
    if (document.getElementById('dungeonModal')) {
      this._modal  = document.getElementById('dungeonModal');
      this._canvas = document.getElementById('dgCanvas');
      this._ctx    = this._canvas.getContext('2d');
      return;
    }
    const skillBarHtml = D_SKILLS.map(sk=>`
      <button class="dg-sk" id="dgSk_${sk.id}" title="${sk.label} (${sk.key})" style="border-color:${sk.color}22">
        <span>${sk.emoji}</span><span class="dg-sk-cnt" id="dgSkC_${sk.id}">0</span>
        <span class="dg-sk-key">${sk.key}</span>
        <div class="dg-sk-cd" id="dgSkD_${sk.id}"></div>
      </button>`).join('');

    const m = document.createElement('div');
    m.id='dungeonModal'; m.className='dg-modal hidden';
    m.innerHTML=`
<style>
.dg-modal{position:fixed;inset:0;z-index:8000;display:flex;align-items:center;justify-content:center}
.dg-modal.hidden{display:none!important}
.dg-ov{position:absolute;inset:0;background:rgba(0,0,0,.82)}
.dg-panel{position:relative;width:min(98vw,520px);max-height:96vh;background:#0d0d1a;border:1px solid #2d2d4a;
  border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 60px rgba(99,102,241,.25)}
.dg-scr{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px 18px;gap:10px;overflow-y:auto}
.dg-scr.hidden{display:none!important}
.dg-title{font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px}
.dg-sub{font-size:12px;color:#6b7280;text-align:center;line-height:1.6}
.dg-fee{background:#1e1e3a;border:1px solid #3730a3;border-radius:10px;padding:8px 18px;font-size:14px;font-weight:700;color:#a78bfa}
.dg-fee-info{font-size:10px;color:#6b7280;text-align:center}
.dg-btn{padding:10px 28px;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;width:100%;max-width:260px}
.dg-btn-go{background:#7c3aed;color:#fff;box-shadow:0 4px 18px rgba(124,58,237,.4)}
.dg-btn-go:disabled{opacity:.4;cursor:not-allowed}
.dg-btn-ghost{background:transparent;color:#6b7280;border:1px solid #374151}
/* 게임 */
.dg-game-wrap{position:relative;padding:0;overflow:hidden;display:flex;flex-direction:column}
.dg-hud{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;
  background:rgba(0,0,0,.85);border-bottom:1px solid #1f2937;gap:6px;flex-shrink:0}
.dg-hud-seg{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700}
.dg-bar-bg{width:80px;height:6px;background:#1f2937;border-radius:3px;overflow:hidden}
.dg-bar-fill{height:100%;border-radius:3px;transition:width .2s}
.dg-stg{background:#3730a3;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700}
.dg-xbtn{background:rgba(239,68,68,.2);border:none;color:#f87171;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:13px}
canvas#dgCanvas{display:block;flex:1;cursor:crosshair}
.dg-skills{display:flex;gap:5px;padding:5px 8px;background:rgba(0,0,0,.88);justify-content:center;flex-shrink:0}
.dg-sk{position:relative;background:rgba(0,0,0,.9);border:2px solid #374151;border-radius:10px;
  padding:5px 8px;font-size:18px;cursor:pointer;color:#fff;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:44px}
.dg-sk-cnt{font-size:11px;font-weight:700;color:#a78bfa}
.dg-sk-key{font-size:8px;color:#4b5563}
.dg-sk-cd{position:absolute;inset:0;background:rgba(0,0,0,.55);border-radius:8px;display:none;
  align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fbbf24}
.dg-toast{position:absolute;top:52px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.88);
  color:#fff;font-size:12px;font-weight:700;padding:5px 14px;border-radius:8px;pointer-events:none;
  white-space:nowrap;opacity:1;transition:opacity .3s}
.dg-toast.hidden{display:none}
/* 결과 화면 */
.dg-stat-row{display:flex;justify-content:space-between;width:100%;max-width:260px;font-size:13px;padding:3px 0}
.dg-stat-row .k{color:#6b7280}.dg-stat-row .v{font-weight:700;color:#f59e0b}
</style>
<div class="dg-ov"></div>
<div class="dg-panel">
  <!-- 입장 화면 -->
  <div class="dg-scr" id="dgEntry">
    <div style="font-size:52px">🏰</div>
    <div class="dg-title">Dungeon Survival</div>
    <div class="dg-sub">타워를 파괴해 안전지역 확보<br>몬스터 처치 → Stage 진급<br>클릭 이동 · 스킬 Q/W/E/R/T</div>
    <div class="dg-fee" id="dgFeeLabel">입장료: ${BASE_FEE} GP</div>
    <div class="dg-fee-info" id="dgFeeInfo">오늘 첫 입장</div>
    <button class="dg-btn dg-btn-go" id="dgEnterBtn">⚔️ 던전 입장</button>
    <button class="dg-btn dg-btn-ghost" id="dgCloseEntry">취소</button>
  </div>
  <!-- 게임 화면 -->
  <div class="dg-scr dg-game-wrap hidden" id="dgGame" style="padding:0">
    <div class="dg-hud" id="dgHud">
      <div class="dg-hud-seg">
        ❤️
        <div class="dg-bar-bg"><div class="dg-bar-fill" id="dgHpFill" style="background:#22c55e;width:100%"></div></div>
        <span id="dgHpTxt" style="font-size:10px">—</span>
      </div>
      <div class="dg-hud-seg">
        <span class="dg-stg" id="dgStageBadge">Stage 1</span>
        <span style="font-size:10px;color:#9ca3af" id="dgStageProg">0/8</span>
      </div>
      <div class="dg-hud-seg">
        <span id="dgCoins" style="color:#fbbf24">💰 0</span>
        <span id="dgKills" style="color:#a78bfa">⚔️ 0</span>
        <button class="dg-xbtn" id="dgExitBtn">✕</button>
      </div>
    </div>
    <canvas id="dgCanvas"></canvas>
    <div class="dg-skills" id="dgSkillBar">${skillBarHtml}</div>
    <div class="dg-toast hidden" id="dgToast"></div>
  </div>
  <!-- 결과 화면 -->
  <div class="dg-scr hidden" id="dgResult">
    <div id="dgResIcon" style="font-size:52px">💀</div>
    <div class="dg-title" id="dgResTitle">전멸!</div>
    <div id="dgResStats" style="width:100%;max-width:260px;margin-top:8px"></div>
    <button class="dg-btn dg-btn-go" id="dgReEnterBtn" style="margin-top:12px">다시 도전!</button>
    <button class="dg-btn dg-btn-ghost" id="dgLeaveBtn">던전 나가기</button>
  </div>
</div>`;
    document.body.appendChild(m);
    this._modal  = m;
    this._canvas = m.querySelector('#dgCanvas');
    this._ctx    = this._canvas.getContext('2d');
    this._bindUI();
  }

  _bindUI() {
    const q = id => this._modal.querySelector('#'+id);
    q('dgEnterBtn')  ?.addEventListener('click', ()=>this._tryEnter());
    q('dgCloseEntry')?.addEventListener('click', ()=>this.close());
    q('dgExitBtn')   ?.addEventListener('click', ()=>{ if(confirm('던전에서 나가시겠습니까?')) this.close(); });
    q('dgReEnterBtn')?.addEventListener('click', ()=>this._show('dgEntry'));
    q('dgLeaveBtn')  ?.addEventListener('click', ()=>this.close());
    this._canvas.addEventListener('click',    e=>this._onCanvasClick(e));
    this._canvas.addEventListener('touchend', e=>{ e.preventDefault(); if(e.changedTouches[0]) this._onCanvasClick(e.changedTouches[0]); },{passive:false});
    D_SKILLS.forEach(sk=>{ q(`dgSk_${sk.id}`)?.addEventListener('click',()=>this._useSkill(sk.id)); });
  }

  // ── 공개 API ────────────────────────────────────────────────────────────────
  open() {
    this._modal.classList.remove('hidden');
    this._show('dgEntry');
    this._loadDB();
  }
  close() { this._stop(); this._modal.classList.add('hidden'); }

  _show(id) {
    ['dgEntry','dgGame','dgResult'].forEach(s=>
      this._modal.querySelector('#'+s)?.classList.toggle('hidden',s!==id));
  }

  _updateEntryUI() {
    const lbl  = document.getElementById('dgFeeLabel');
    const info = document.getElementById('dgFeeInfo');
    const btn  = document.getElementById('dgEnterBtn');
    if (lbl)  lbl.textContent  = `입장료: ${this._entryFee} GP`;
    if (info) {
      if (this._entryCount===0) { info.textContent='오늘 첫 입장 · 24시간 후 리셋'; }
      else { const h=Math.ceil((this._entryResetAt+RESET_MS-Date.now())/3_600_000); info.textContent=`오늘 ${this._entryCount}번째 · ${h}h 후 ${BASE_FEE}GP 리셋`; }
    }
    if (btn) btn.textContent = `⚔️ 던전 입장 (${this._entryFee} GP)`;
  }

  // ── 입장 ────────────────────────────────────────────────────────────────────
  async _tryEnter() {
    const btn = document.getElementById('dgEnterBtn');
    if (btn) btn.disabled = true;
    await this._loadDB(); // refresh fee + stats
    if (!this._spend(this._entryFee)) {
      this._toast(`GP 부족 (${this._entryFee} GP 필요)`);
      if (btn) btn.disabled = false;
      return;
    }
    await this._recordEntry();
    if (!this._spritesLoaded) {
      this._toast('스프라이트 로딩 중...');
      await this._loadSprites();
      this._spritesLoaded = true;
    }
    this._initState();
    this._initAudio();
    this._show('dgGame');
    this._resizeCanvas();
    this._registerKeyboard();
    this._run();
    if (btn) btn.disabled = false;
  }

  // ── 게임 초기화 ──────────────────────────────────────────────────────────────
  _initState() {
    this._stage      = 1;
    this._stageKills = 0;
    this._skills     = { fire:0, ice:0, bolt:0, meteor:0, wind:0 };
    this._skillCds   = { fire:0, ice:0, bolt:0, meteor:0, wind:0 };
    this._effects    = [];
    this._burnMap    = new Map();
    this._freezeSet  = new Set();
    this._windActive = false; this._windEndAt = 0;

    this._p = {
      x:0, y:0,
      hp: this._dbHp, maxHp: this._dbMaxHp,
      atk: this._dbAtk + 10, def: this._dbDef,
      atkRange:80, atkRate:1.2, atkCd:0,
      tx:0, ty:0, moving:false, targeting:null,
      coins:0, kills:0, xp:0,
    };
    this._monsters = [];
    this._queues   = {};
    this._towers   = D_TOWER_SLOTS.map(s=>({
      x:s.x, y:s.y, kind:s.kind, atkCd:0, alive:true,
      ...D_TOWER_DEF[s.kind], hp:D_TOWER_DEF[s.kind].maxHp,
    }));
    this._projs  = [];
    this._drops  = [];
    this._floats = [];
    this._cam    = { x:0, y:0 };
    this._running = true;
    this._spawnStage(1);
    this._updateSkillUI();
    this._updateStageUI();
  }

  // ── 몬스터 스폰 ─────────────────────────────────────────────────────────────
  _spawnStage(stage) {
    const cnt = stageCount(stage);
    for (const base of D_MDEFS.filter(d=>d.minStage<=stage)) {
      const def = scaleDef(base, stage);
      for (let i=0; i<cnt; i++) this._spawnMonster(base, def, 0);
    }
  }

  _spawnMonster(base, scaledDef, delay) {
    if (delay>0) {
      (this._queues[base.id]||(this._queues[base.id]=[])).push({base,at:Date.now()+delay});
      return;
    }
    const a=Math.random()*Math.PI*2, r=280+Math.random()*(D_WORLD_R*0.65);
    const def = scaledDef ?? scaleDef(base, this._stage);
    this._monsters.push({
      base, def, id:Math.random().toString(36).slice(2),
      x:Math.cos(a)*r, y:Math.sin(a)*r,
      hp:def.maxHp, atkCd:0, state:'walk',
      frame:0, frameTimer:0, hurtTimer:0, facing:1,
    });
  }

  _killMonster(m) {
    if (m.state==='die') return;
    m.state='die'; m.frame=0; m.frameTimer=0;
    this._p.kills++; this._p.xp+=m.def.xp; this._stageKills++;
    this._burnMap.delete(m.id); this._freezeSet.delete(m.id);
    this._drops.push({x:m.x+(Math.random()-.5)*30,y:m.y+(Math.random()-.5)*30,coins:m.def.coins});
    this._addFloat(`+${m.def.coins}💰`,m.x,m.y-25,'#4ade80');
    this._addFloat(`+${m.def.xp}XP`,m.x,m.y-44,'#a78bfa');
    this._sfx('kill');
    if (Math.random()<0.22) {
      const sk=D_SKILLS[Math.floor(Math.random()*D_SKILLS.length)];
      this._drops.push({x:m.x+(Math.random()-.5)*40,y:m.y+(Math.random()-.5)*40,skillId:sk.id});
      this._addFloat(sk.emoji,m.x,m.y-64,'#e879f9');
    }
    if (Math.random()<0.20) {
      const heal=Math.round(15+this._stage*2);
      this._drops.push({x:m.x+(Math.random()-.5)*40,y:m.y+(Math.random()-.5)*40,potion:true,heal});
      this._addFloat('🧪',m.x,m.y-54,'#f87171');
    }
    this._spawnMonster(m.base, null, stageRespawn(this._stage));
    this._checkStageUp();
    this._updateStageUI();
  }

  _checkStageUp() {
    if (this._stage>=D_MAX_STAGE) return;
    if (this._stageKills >= stageKills(this._stage)) {
      this._stage++; this._stageKills=0;
      this._toast(`⬆️ Stage ${this._stage}!`); this._sfx('skill');
      const newTypes = D_MDEFS.filter(d=>d.minStage===this._stage);
      const cnt = stageCount(this._stage);
      for (const base of newTypes) {
        const def=scaleDef(base,this._stage);
        for (let i=0;i<cnt;i++) this._spawnMonster(base,def,0);
      }
      this._updateStageUI();
    }
  }

  _updateStageUI() {
    const b=document.getElementById('dgStageBadge'), p=document.getElementById('dgStageProg');
    if(b) b.textContent=`Stage ${this._stage}`;
    if(p) p.textContent=`${this._stageKills}/${stageKills(this._stage)}`;
  }

  // ── 스킬 ────────────────────────────────────────────────────────────────────
  _useSkill(id) {
    if (!this._running) return;
    if (!(this._skills[id]>0)) { this._toast(`${id} 스킬 없음`); return; }
    if ((this._skillCds[id]||0)>0) { this._toast('쿨다운 중'); return; }
    this._skills[id]--;
    const p=this._p, now=Date.now(), s=this._stage;
    if (id==='fire') {
      const r=260,dmg=80+s*12,dps=15+s*2;
      this._effects.push({type:'fire',x:p.x,y:p.y,r,startAt:now,dur:700,color:'#f97316'});
      for(const m of this._monsters){ if(m.state==='die') continue; if(Math.hypot(m.x-p.x,m.y-p.y)<=r){ m.hp-=dmg; this._addFloat(`-${dmg}🔥`,m.x,m.y-18,'#f97316'); this._burnMap.set(m.id,{dps,endAt:now+3000}); if(m.hp<=0)this._killMonster(m); } }
      this._skillCds[id]=D_SKILLS.find(sk=>sk.id===id).cd;
    } else if (id==='ice') {
      const r=320,dmg=40+s*8;
      this._effects.push({type:'ice',x:p.x,y:p.y,r,startAt:now,dur:700,color:'#38bdf8'});
      for(const m of this._monsters){ if(m.state==='die') continue; if(Math.hypot(m.x-p.x,m.y-p.y)<=r){ m.hp-=dmg; this._freezeSet.add(m.id); setTimeout(()=>this._freezeSet.delete(m.id),3000); if(m.hp<=0)this._killMonster(m); } }
      this._skillCds[id]=D_SKILLS.find(sk=>sk.id===id).cd;
    } else if (id==='bolt') {
      const chainR=220,dmg=100+s*18; let src={x:p.x,y:p.y}; const used=new Set(),segs=[];
      for(let c=0;c<5;c++){ let best=null,bestD=chainR; for(const m of this._monsters){ if(m.state==='die'||used.has(m.id))continue; const d=Math.hypot(m.x-src.x,m.y-src.y); if(d<bestD){bestD=d;best=m;} } if(!best)break; used.add(best.id); segs.push({from:{...src},to:{x:best.x,y:best.y}}); best.hp-=dmg; this._addFloat(`-${dmg}⚡`,best.x,best.y-18,'#facc15'); if(best.hp<=0)this._killMonster(best); src={x:best.x,y:best.y}; }
      this._effects.push({type:'bolt',targets:segs,startAt:now,dur:500,color:'#facc15'});
      this._skillCds[id]=D_SKILLS.find(sk=>sk.id===id).cd;
    } else if (id==='meteor') {
      const tx=p.x,ty=p.y,r=200,dmg=200+s*25;
      this._effects.push({type:'meteor_warn',x:tx,y:ty,r,startAt:now,dur:800,color:'#fb923c'});
      setTimeout(()=>{ if(!this._running)return; this._effects.push({type:'meteor_hit',x:tx,y:ty,r,startAt:Date.now(),dur:400,color:'#ef4444'}); for(const m of this._monsters){ if(m.state==='die')continue; if(Math.hypot(m.x-tx,m.y-ty)<=r){ m.hp-=dmg; this._addFloat(`-${dmg}☄️`,m.x,m.y-18,'#fb923c'); if(m.hp<=0)this._killMonster(m); } } this._sfx('skill'); },800);
      this._skillCds[id]=D_SKILLS.find(sk=>sk.id===id).cd;
    } else if (id==='wind') {
      this._windActive=true; this._windEndAt=now+5000;
      this._effects.push({type:'wind',x:p.x,y:p.y,r:160,startAt:now,dur:5000,color:'#a78bfa'});
      this._skillCds[id]=D_SKILLS.find(sk=>sk.id===id).cd;
    }
    this._sfx('skill'); this._updateSkillUI();
  }

  _updateSkillUI() {
    D_SKILLS.forEach(sk=>{
      const cnt=document.getElementById(`dgSkC_${sk.id}`);
      const cd=document.getElementById(`dgSkD_${sk.id}`);
      const btn=document.getElementById(`dgSk_${sk.id}`);
      const count=this._skills[sk.id]||0, cooldown=this._skillCds[sk.id]||0;
      if(cnt) cnt.textContent=count;
      if(btn){ btn.style.opacity=(count>0&&cooldown<=0)?'1':'0.4'; btn.style.borderColor=count>0?sk.color:'#374151'; }
      if(cd){ if(cooldown>0){ cd.style.display='flex'; cd.textContent=Math.ceil(cooldown)+'s'; } else cd.style.display='none'; }
    });
  }

  // ── 메인 업데이트 ────────────────────────────────────────────────────────────
  _update(dt) {
    const p=this._p, now=Date.now();

    // 스킬 쿨다운
    for(const id in this._skillCds) if(this._skillCds[id]>0) this._skillCds[id]=Math.max(0,this._skillCds[id]-dt);

    // 리스폰 큐
    for(const id in this._queues){
      this._queues[id]=this._queues[id].filter(q=>{ if(now>=q.at){this._spawnMonster(q.base,null,0);return false;} return true; });
    }

    // 바람 틱
    if(this._windActive){
      if(now>=this._windEndAt) this._windActive=false;
      else {
        const dps=(25+this._stage*6)*dt;
        for(const m of this._monsters){ if(m.state==='die')continue; if(Math.hypot(m.x-p.x,m.y-p.y)<=160){ m.hp-=dps; if(m.hp<=0)this._killMonster(m); } }
        for(const ef of this._effects) if(ef.type==='wind'){ef.x=p.x;ef.y=p.y;}
      }
    }

    // 번 DoT
    for(const [mid,burn] of this._burnMap){
      if(now>=burn.endAt){this._burnMap.delete(mid);continue;}
      const m=this._monsters.find(x=>x.id===mid&&x.state!=='die');
      if(!m){this._burnMap.delete(mid);continue;}
      m.hp-=burn.dps*dt; if(m.hp<=0)this._killMonster(m);
    }

    // 이펙트 만료
    this._effects=this._effects.filter(ef=>now-ef.startAt<ef.dur);

    // 플레이어 이동
    if(p.moving){
      const dx=p.tx-p.x,dy=p.ty-p.y,d=Math.hypot(dx,dy);
      if(d<6) p.moving=false;
      else { const sp=Math.min(185*dt,d); p.x+=dx/d*sp; p.y+=dy/d*sp; }
    }
    const pd=Math.hypot(p.x,p.y);
    if(pd>D_WORLD_R-22){p.x=p.x/pd*(D_WORLD_R-22);p.y=p.y/pd*(D_WORLD_R-22);p.moving=false;}

    // 플레이어 공격
    p.atkCd=Math.max(0,p.atkCd-dt);
    if(p.atkCd===0){
      let tgt=p.targeting;
      // 타워 우선 타겟팅
      if(tgt&&tgt._isTower&&!tgt.alive) { tgt=null; p.targeting=null; }
      if(!tgt||(!tgt._isTower&&tgt.state==='die')){
        tgt=null; let minD=p.atkRange;
        for(const t of this._towers){ if(!t.alive)continue; const d=Math.hypot(t.x-p.x,t.y-p.y); if(d<minD){minD=d;tgt=t;tgt._isTower=true;} }
        for(const m of this._monsters){ if(m.state==='die')continue; const d=Math.hypot(m.x-p.x,m.y-p.y); if(d<minD){minD=d;tgt=m;} }
        p.targeting=tgt;
      }
      if(tgt){
        const tx=tgt._isTower?tgt.x:tgt.x, ty=tgt._isTower?tgt.y:tgt.y;
        const d=Math.hypot(tx-p.x,ty-p.y);
        if(d<=p.atkRange){
          p.moving=false;
          const dmg=Math.max(1,p.atk-(tgt._isTower?D_TOWER_DEF[tgt.kind].maxHp*0.01:0));
          if(tgt._isTower){
            tgt.hp-=dmg; this._addFloat(`-${Math.round(dmg)}🔨`,tgt.x,tgt.y-30,'#f59e0b');
            if(tgt.hp<=0){ tgt.alive=false; tgt.hp=0; this._addFloat('💥 타워 파괴!',tgt.x,tgt.y-50,'#ef4444'); this._toast(`🏚 ${D_TOWER_DEF[tgt.kind].label} 파괴!`); this._sfx('kill'); p.targeting=null; }
          } else {
            tgt.hp-=dmg; tgt.state='hurt'; tgt.hurtTimer=0.18; tgt.frame=0; tgt.frameTimer=0;
            this._addFloat(`-${Math.round(dmg)}`,tgt.x,tgt.y-18,'#f87171'); this._sfx('hit');
            if(tgt.hp<=0) this._killMonster(tgt);
          }
          p.atkCd=1/p.atkRate;
        } else { p.tx=tx; p.ty=ty; p.moving=true; }
      }
    }

    // 몬스터 AI + 애니메이션
    for(const m of this._monsters){
      if(m.state==='die'){
        // 죽는 애니메이션 후 제거
        const sp=MSPRITES[m.base.sp]; const nf=sp?.die.length||6;
        m.frameTimer+=dt;
        if(m.frameTimer>0.11){ m.frameTimer=0; m.frame++; }
        if(m.frame>=nf) m.state='gone';
        continue;
      }
      if(m.state==='gone') continue;
      if(this._freezeSet.has(m.id)){ this._animateSpr(m,'walk',0.13,dt); continue; }

      m.atkCd=Math.max(0,m.atkCd-dt);
      if(m.hurtTimer>0){ m.hurtTimer-=dt; this._animateSpr(m,'hurt',0.085,dt); continue; }

      const dx=p.x-m.x,dy=p.y-m.y,dist=Math.hypot(dx,dy);
      m.facing = dx>0?1:-1;

      if(dist<=m.def.range){
        m.state='atk';
        this._animateSpr(m,'atk',0.1,dt);
        if(m.atkCd===0){
          if(m.def.ranged){ this._fireProj(m.x,m.y,p.x,p.y,{atk:m.def.atk,src:'mob',spd:230,color:'#f87171',r:7}); }
          else { const red=Math.max(1,m.def.atk-p.def); p.hp-=red; this._addFloat(`-${red}`,p.x,p.y-30,'#ff5555'); this._sfx('hit'); }
          m.atkCd=1.1;
        }
      } else {
        m.state='walk';
        this._animateSpr(m,'walk',0.13,dt);
        const sp2=m.def.spd*dt; m.x+=dx/dist*sp2; m.y+=dy/dist*sp2;
      }
      const md=Math.hypot(m.x,m.y);
      if(md>D_WORLD_R-15){m.x=m.x/md*(D_WORLD_R-15);m.y=m.y/md*(D_WORLD_R-15);}
    }
    // 사망 상태 제거
    this._monsters=this._monsters.filter(m=>m.state!=='gone');

    // 타워 공격 (모두 플레이어 공격)
    for(const t of this._towers){
      if(!t.alive) continue;
      t.atkCd=Math.max(0,t.atkCd-dt);
      if(t.atkCd>0) continue;
      const dp=Math.hypot(p.x-t.x,p.y-t.y);
      if(dp<=t.range){
        this._fireProj(t.x,t.y,p.x,p.y,{atk:t.atk,src:'tower',spd:220,color:t.color,r:t.kind==='cannon'?9:6});
        t.atkCd=1/t.rate;
      }
    }

    // 발사체
    this._projs=this._projs.filter(proj=>{
      proj.x+=proj.vx*dt; proj.y+=proj.vy*dt; proj.ttl-=dt;
      if(proj.ttl<=0) return false;
      if(proj.src==='mob'||proj.src==='tower'){
        if(Math.hypot(proj.x-p.x,proj.y-p.y)<22){ const red=Math.max(1,proj.atk-Math.floor(p.def*0.4)); p.hp-=red; this._addFloat(`-${red}`,p.x,p.y-30,'#ff5555'); this._sfx('hit'); return false; }
      }
      return true;
    });

    // 드롭 픽업
    this._drops=this._drops.filter(drop=>{
      if(Math.hypot(drop.x-p.x,drop.y-p.y)<36){
        if(drop.skillId){ this._skills[drop.skillId]=(this._skills[drop.skillId]||0)+1; const sk=D_SKILLS.find(s=>s.id===drop.skillId); this._addFloat(`${sk?.emoji}+1`,p.x,p.y-48,'#e879f9'); this._toast(`${sk?.emoji} ${sk?.label}!`); this._updateSkillUI(); }
        else if(drop.potion){ const h=Math.min(drop.heal,p.maxHp-p.hp); p.hp+=drop.heal; this._addFloat(`+${h}❤️`,p.x,p.y-48,'#f87171'); this._toast(`🧪 +${drop.heal}HP`); }
        else { p.coins+=drop.coins; this._add(drop.coins); }
        return false;
      }
      return true;
    });

    this._floats=this._floats.filter(f=>{f.life-=dt;f.wy-=42*dt;return f.life>0;});
    this._cam.x=p.x; this._cam.y=p.y;

    // HUD
    const hpP=Math.max(0,p.hp/p.maxHp*100);
    const hpFill=document.getElementById('dgHpFill');
    const hpTxt =document.getElementById('dgHpTxt');
    const coEl  =document.getElementById('dgCoins');
    const klEl  =document.getElementById('dgKills');
    if(hpFill) hpFill.style.width=hpP+'%';
    if(hpFill) hpFill.style.background=hpP>50?'#22c55e':hpP>25?'#f59e0b':'#ef4444';
    if(hpTxt)  hpTxt.textContent=`${Math.max(0,Math.floor(p.hp))}/${p.maxHp}`;
    if(coEl)   coEl.textContent=`💰${p.coins}`;
    if(klEl)   klEl.textContent=`⚔️${p.kills}`;
    this._updateSkillUI();

    if(p.hp<=0 && this._running){ this._sfx('death'); this._stop(); this._showResult(false); }
  }

  _animateSpr(m, anim, spd, dt) {
    m.frameTimer+=dt;
    if(m.frameTimer>=spd){
      m.frameTimer=0;
      const sp=MSPRITES[m.base.sp];
      const nf=sp?.[anim]?.length||6;
      m.frame=(m.frame+1)%nf;
    }
  }

  _fireProj(fx,fy,tx,ty,{atk,src,spd,color,r}) {
    const dx=tx-fx,dy=ty-fy,d=Math.hypot(dx,dy)||1;
    this._projs.push({x:fx,y:fy,vx:dx/d*spd,vy:dy/d*spd,atk,src,color,r,ttl:d/spd+0.5});
  }
  _addFloat(text,wx,wy,color){ this._floats.push({text,wx,wy,color,life:1.2}); }

  // ── 렌더링 ───────────────────────────────────────────────────────────────────
  _draw() {
    const cv=this._canvas,ctx=this._ctx,W=cv.width,H=cv.height;
    const cx=W/2-this._cam.x, cy=H/2-this._cam.y;
    const now=Date.now();
    ctx.fillStyle='#080814'; ctx.fillRect(0,0,W,H);

    // 그리드
    ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
    const gs=80,gx0=Math.floor((this._cam.x-W/2)/gs)*gs,gy0=Math.floor((this._cam.y-H/2)/gs)*gs;
    for(let gx=gx0;gx<this._cam.x+W/2+gs;gx+=gs){const sx=gx+cx;ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,H);ctx.stroke();}
    for(let gy=gy0;gy<this._cam.y+H/2+gs;gy+=gs){const sy=gy+cy;ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(W,sy);ctx.stroke();}

    // 경계
    ctx.save();ctx.strokeStyle='rgba(255,70,30,.5)';ctx.lineWidth=3;ctx.setLineDash([12,8]);
    ctx.beginPath();ctx.arc(cx,cy,D_WORLD_R,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.restore();

    // 파괴된 타워 잔해
    for(const t of this._towers){
      if(t.alive) continue;
      const sx=t.x+cx,sy=t.y+cy;
      if(sx<-60||sx>W+60||sy<-60||sy>H+60) continue;
      ctx.save();ctx.globalAlpha=0.35;ctx.fillStyle='#374151';
      ctx.beginPath();ctx.arc(sx,sy,18,0,Math.PI*2);ctx.fill();
      ctx.font='16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.globalAlpha=0.5;
      ctx.fillText('🪨',sx,sy+1);ctx.restore();
    }

    // 이펙트
    for(const ef of this._effects){
      const age=(now-ef.startAt)/ef.dur,alpha=Math.max(0,1-age),esx=ef.x+cx,esy=ef.y+cy;
      if(ef.type==='fire'||ef.type==='ice'){
        ctx.save();ctx.globalAlpha=alpha*0.32;ctx.fillStyle=ef.color;
        ctx.beginPath();ctx.arc(esx,esy,ef.r*(0.5+age*0.5),0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=alpha*0.75;ctx.strokeStyle=ef.color;ctx.lineWidth=2.5;
        ctx.beginPath();ctx.arc(esx,esy,ef.r,0,Math.PI*2);ctx.stroke();ctx.restore();
      } else if(ef.type==='bolt'){
        ctx.save();ctx.strokeStyle=ef.color;ctx.lineWidth=2.5;ctx.globalAlpha=alpha;ctx.shadowColor=ef.color;ctx.shadowBlur=10;
        for(const seg of ef.targets){ctx.beginPath();ctx.moveTo(seg.from.x+cx,seg.from.y+cy);ctx.lineTo(seg.to.x+cx,seg.to.y+cy);ctx.stroke();}
        ctx.restore();
      } else if(ef.type==='meteor_warn'){
        const pulse=Math.sin(age*Math.PI*6)*0.3+0.7;ctx.save();ctx.globalAlpha=0.45*pulse;
        ctx.strokeStyle='#fb923c';ctx.lineWidth=2;ctx.setLineDash([7,5]);
        ctx.beginPath();ctx.arc(esx,esy,ef.r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.restore();
      } else if(ef.type==='meteor_hit'){
        ctx.save();ctx.globalAlpha=alpha*0.55;ctx.fillStyle='#ef4444';
        ctx.beginPath();ctx.arc(esx,esy,ef.r*(1+age*0.5),0,Math.PI*2);ctx.fill();ctx.restore();
      } else if(ef.type==='wind'){
        ctx.save();const spin=(now*0.004%(Math.PI*2));ctx.globalAlpha=alpha*0.22;ctx.fillStyle='#a78bfa';
        ctx.beginPath();ctx.arc(esx,esy,ef.r,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=alpha*0.65;ctx.strokeStyle='#a78bfa';ctx.lineWidth=2;
        for(let wi=0;wi<6;wi++){const wa=spin+(wi/6)*Math.PI*2;ctx.beginPath();ctx.arc(esx+Math.cos(wa)*ef.r*0.6,esy+Math.sin(wa)*ef.r*0.6,5,0,Math.PI*2);ctx.stroke();}
        ctx.restore();
      }
    }

    // 드롭
    ctx.textAlign='center';ctx.textBaseline='middle';
    for(const d of this._drops){
      const sx=d.x+cx,sy=d.y+cy;
      ctx.save();ctx.font='15px sans-serif';
      if(d.skillId){const sk=D_SKILLS.find(s=>s.id===d.skillId);ctx.shadowColor=sk?.color||'#e879f9';ctx.shadowBlur=12;ctx.fillText(sk?.emoji||'✨',sx,sy);}
      else if(d.potion){ctx.shadowColor='#f87171';ctx.shadowBlur=10;ctx.fillText('🧪',sx,sy);}
      else{ctx.fillText('💰',sx,sy);}
      ctx.restore();
    }

    // 타워 렌더링 (이미지 + HP바)
    for(const t of this._towers){
      if(!t.alive) continue;
      const sx=t.x+cx,sy=t.y+cy;
      if(sx<-80||sx>W+80||sy<-80||sy>H+80) continue;
      ctx.save();
      // 사정거리 원
      ctx.globalAlpha=0.07;ctx.fillStyle=t.color;ctx.beginPath();ctx.arc(sx,sy,t.range,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=0.4;ctx.strokeStyle=t.color;ctx.lineWidth=1;ctx.setLineDash([5,5]);
      ctx.beginPath();ctx.arc(sx,sy,t.range,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      ctx.globalAlpha=1;
      // 타워 이미지
      const timg=this._tImgs[t.img];
      const th=t.sz, tw2=timg&&timg.naturalWidth?th*(timg.naturalWidth/timg.naturalHeight):th;
      if(timg&&timg.naturalWidth){ ctx.drawImage(timg,sx-tw2/2,sy-th,tw2,th); }
      else {
        ctx.fillStyle=t.kind==='cannon'?'#7f1d1d':'#78716c';ctx.strokeStyle=t.color;ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(sx,sy,t.sz/2,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.font=`${t.sz/2+2}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(t.kind==='cannon'?'💣':'🏹',sx,sy+1);
      }
      // HP바
      const bw=44,bh=5,hpR=t.hp/t.maxHp;
      ctx.fillStyle='#111';ctx.fillRect(sx-bw/2,sy-th-8,bw,bh);
      ctx.fillStyle=hpR>0.5?'#22c55e':hpR>0.25?'#f59e0b':'#ef4444';
      ctx.fillRect(sx-bw/2,sy-th-8,bw*hpR,bh);
      ctx.restore();
    }

    // 몬스터 렌더링 (스프라이트 + HP바)
    for(const m of this._monsters){
      if(m.state==='gone') continue;
      const sx=m.x+cx,sy=m.y+cy;
      if(sx<-80||sx>W+80||sy<-80||sy>H+80) continue;
      const sz=m.def.sz, sp=MSPRITES[m.base.sp];
      const isFrz=this._freezeSet.has(m.id), isBrn=this._burnMap.has(m.id);
      const animKey=m.state==='die'?'die':m.state==='hurt'?'hurt':m.state==='atk'?'atk':'walk';
      const frames=sp?.[animKey]||[];
      const fi=Math.min(m.frame, frames.length-1);
      const img=frames[fi];
      ctx.save();
      if(isFrz) ctx.filter='hue-rotate(180deg)brightness(1.3)saturate(0.5)';
      else if(isBrn) ctx.filter='hue-rotate(-30deg)saturate(2.5)';
      ctx.translate(sx,sy);
      if(m.facing<0) ctx.scale(-1,1);
      if(img&&img.complete&&img.naturalWidth){ ctx.drawImage(img,-sz/2,-sz,sz,sz); }
      else { ctx.fillStyle='#f87171';ctx.beginPath();ctx.arc(0,-sz/2,sz/2,0,Math.PI*2);ctx.fill(); }
      ctx.filter='none';
      if(isFrz){ctx.globalAlpha=0.35;ctx.fillStyle='#38bdf8';ctx.beginPath();ctx.arc(0,-sz/2,sz/2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
      else if(isBrn){ctx.globalAlpha=0.25;ctx.fillStyle='#f97316';ctx.beginPath();ctx.arc(0,-sz/2,sz/2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
      ctx.restore();
      // HP바
      if(m.state!=='die'){
        const bw=sz*.85,bh=4,hpR=Math.max(0,m.hp/m.def.maxHp);
        ctx.fillStyle='#111';ctx.fillRect(sx-bw/2,sy-sz-8,bw,bh);
        ctx.fillStyle=hpR>0.5?'#4ade80':hpR>0.25?'#fbbf24':'#ef4444';
        ctx.fillRect(sx-bw/2,sy-sz-8,bw*hpR,bh);
        if(sz>45){ ctx.font=`bold ${Math.round(9*sz/50)}px sans-serif`;ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText(m.def.label,sx,sy-sz-12); }
      }
    }

    // 발사체
    for(const proj of this._projs){
      const sx=proj.x+cx,sy=proj.y+cy;
      ctx.save();ctx.fillStyle=proj.color;ctx.shadowColor=proj.color;ctx.shadowBlur=8;
      ctx.beginPath();ctx.arc(sx,sy,proj.r,0,Math.PI*2);ctx.fill();ctx.restore();
    }

    // 플레이어
    const p=this._p,psx=p.x+cx,psy=p.y+cy;
    ctx.save();
    ctx.strokeStyle='#93c5fd';ctx.lineWidth=2.5;ctx.fillStyle='#1e3a5f';
    ctx.beginPath();ctx.arc(psx,psy,20,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(this._windActive){ctx.globalAlpha=0.4+Math.sin(now*0.008)*0.2;ctx.strokeStyle='#a78bfa';ctx.lineWidth=3;ctx.beginPath();ctx.arc(psx,psy,25,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
    ctx.font='16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🧙',psx,psy+1);
    ctx.restore();
    if(p.moving){ctx.save();ctx.strokeStyle='rgba(99,102,241,.5)';ctx.lineWidth=1;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(psx,psy);ctx.lineTo(p.tx+cx,p.ty+cy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(99,102,241,.8)';ctx.beginPath();ctx.arc(p.tx+cx,p.ty+cy,4,0,Math.PI*2);ctx.fill();ctx.restore();}

    // 플로팅 텍스트
    for(const f of this._floats){
      ctx.save();ctx.globalAlpha=Math.min(1,f.life*1.3);ctx.fillStyle=f.color;
      ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.textBaseline='alphabetic';
      ctx.fillText(f.text,f.wx+cx,f.wy+cy);ctx.restore();
    }
  }

  // ── 입력 ─────────────────────────────────────────────────────────────────────
  _onCanvasClick(e) {
    if(!this._running) return;
    const rect=this._canvas.getBoundingClientRect();
    const px=(e.clientX??e.pageX)-rect.left, py=(e.clientY??e.pageY)-rect.top;
    const sx=px*(this._canvas.width/rect.width), sy=py*(this._canvas.height/rect.height);
    const wx=sx-this._canvas.width/2+this._cam.x, wy=sy-this._canvas.height/2+this._cam.y;
    // 타워 클릭 우선
    for(const t of this._towers){
      if(!t.alive) continue;
      if(Math.hypot(t.x-wx,t.y-wy)<t.sz/2+10){ this._p.targeting=t; t._isTower=true; return; }
    }
    // 몬스터 클릭
    let hit=null,bestD=36;
    for(const m of this._monsters){ if(m.state==='die')continue; const d=Math.hypot(m.x-wx,m.y-wy); if(d<bestD){bestD=d;hit=m;} }
    if(hit){ this._p.targeting=hit; return; }
    this._p.tx=wx; this._p.ty=wy; this._p.moving=true; this._p.targeting=null;
  }

  _registerKeyboard() {
    if(this._keyHandler) document.removeEventListener('keydown',this._keyHandler);
    const map={q:'fire',w:'ice',e:'bolt',r:'meteor',t:'wind'};
    this._keyHandler=e=>{
      if(!this._running)return;
      const sk=map[e.key.toLowerCase()];
      if(sk){e.preventDefault();this._useSkill(sk);}
    };
    document.addEventListener('keydown',this._keyHandler);
  }

  // ── 오디오 ───────────────────────────────────────────────────────────────────
  _initAudio() {
    try{ if(!this._audio)this._audio=new AudioContext(); if(this._audio.state==='suspended')this._audio.resume(); this._startAmbient(); }catch{}
  }
  _startAmbient() {
    if(!this._audio||this._ambNodes)return;
    const ctx=this._audio;
    const osc=ctx.createOscillator();osc.type='sawtooth';osc.frequency.value=52;
    const g=ctx.createGain();g.gain.value=0.03;
    const lfo=ctx.createOscillator();lfo.frequency.value=0.22;
    const lg=ctx.createGain();lg.gain.value=0.014;
    lfo.connect(lg);lg.connect(g.gain);
    osc.connect(g);g.connect(ctx.destination);
    lfo.start();osc.start();
    this._ambNodes={osc,lfo,g};
  }
  _stopAmbient(){ if(!this._ambNodes)return; try{this._ambNodes.osc.stop();this._ambNodes.lfo.stop();}catch{} this._ambNodes=null; }
  _sfx(type){
    if(!this._audio)return;
    const ctx=this._audio,sr=ctx.sampleRate;
    const dur=type==='death'?0.42:0.12;
    const buf=ctx.createBuffer(1,Math.ceil(sr*dur),sr);const ch=buf.getChannelData(0);
    if(type==='hit')       for(let i=0;i<ch.length;i++)ch[i]=(Math.random()*2-1)*Math.exp(-i/sr*28);
    else if(type==='kill') for(let i=0;i<ch.length;i++)ch[i]=Math.sin(i*440/sr*Math.PI*2)*Math.exp(-i/sr*16);
    else if(type==='skill')for(let i=0;i<ch.length;i++)ch[i]=Math.sin(i*880/sr*Math.PI*2)*Math.exp(-i/sr*11);
    else                   for(let i=0;i<ch.length;i++)ch[i]=(Math.random()*2-1)*Math.exp(-i/sr*5);
    const src=ctx.createBufferSource();src.buffer=buf;
    const g=ctx.createGain();g.gain.value=0.22;
    src.connect(g);g.connect(ctx.destination);src.start();
  }

  // ── 루프 / 정지 ──────────────────────────────────────────────────────────────
  _run() {
    if(!this._running)return;
    this._lastTs=performance.now();
    const loop=ts=>{
      if(!this._running)return;
      const dt=Math.min((ts-this._lastTs)/1000,.1);
      this._lastTs=ts;
      this._update(dt);
      this._draw();
      this._raf=requestAnimationFrame(loop);
    };
    this._raf=requestAnimationFrame(loop);
  }
  _stop(){
    this._running=false;
    if(this._raf){cancelAnimationFrame(this._raf);this._raf=null;}
    this._stopAmbient();
    if(this._keyHandler){document.removeEventListener('keydown',this._keyHandler);this._keyHandler=null;}
  }

  _resizeCanvas(){
    const gw=this._modal.querySelector('#dgGame');if(!gw)return;
    const hud=this._modal.querySelector('#dgHud'),bar=this._modal.querySelector('#dgSkillBar');
    const r=gw.getBoundingClientRect();
    const hh=hud?hud.getBoundingClientRect().height:44;
    const bh=bar?bar.getBoundingClientRect().height:52;
    this._canvas.width =Math.max(280,Math.floor(r.width));
    this._canvas.height=Math.max(160,Math.floor(r.height-hh-bh));
  }

  // ── 결과 화면 ────────────────────────────────────────────────────────────────
  _showResult(cleared=false) {
    const p=this._p;
    const icon=document.getElementById('dgResIcon');
    const title=document.getElementById('dgResTitle');
    const stats=document.getElementById('dgResStats');
    if(icon)  icon.textContent=cleared?'🏆':'💀';
    if(title) { title.textContent=cleared?'클리어!':'전멸!'; title.style.color=cleared?'#22c55e':'#f87171'; }
    if(stats) stats.innerHTML=`
      <div class="dg-stat-row"><span class="k">도달 스테이지</span><span class="v">Stage ${this._stage}</span></div>
      <div class="dg-stat-row"><span class="k">처치 수</span><span class="v">${p.kills}마리</span></div>
      <div class="dg-stat-row"><span class="k">획득 코인</span><span class="v">${p.coins} 💰</span></div>
      <div class="dg-stat-row"><span class="k">획득 XP</span><span class="v">${p.xp} XP</span></div>`;
    this._updateEntryUI();
    this._show('dgResult');
  }

  _toast(msg){
    const el=document.getElementById('dgToast');if(!el)return;
    el.textContent=msg;el.classList.remove('hidden');
    clearTimeout(this._toastTmr);
    this._toastTmr=setTimeout(()=>el.classList.add('hidden'),2800);
  }
}
