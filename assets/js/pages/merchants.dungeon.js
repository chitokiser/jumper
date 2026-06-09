// merchants.dungeon.js — v7 hardcore (z-index fix, 3x monsters, zoom, shake, lighting)
import { db, auth } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  loadDungeonMap, findPath, tryMove, isWalkable,
  WORLD_W, WORLD_H, GRID_W, GRID_H, CELL, getWalkable,
} from './merchants.dungeon.map.js';
import {
  initDungeonRenderer, renderDungeonFrame,
  loadAllDungeonSprites, MSPRITE_DEFS,
} from './merchants.dungeon.render.js';

const BASE_FEE=100, FEE_STEP=50, RESET_MS=86400000, GAME_KEY='dungeonEntry';

// ── 몬스터 종류 (HP×2 / ATK×3 / SPD×1.5) ─────────────────────────────────
const MON_TYPES = {
  zombie:   {sp:'zombie', sz:2.2, maxHp:640,  atk:114, spd:120, xp:22, coins:5,  detect:65, atk_range:4},
  orc:      {sp:'orc1',   sz:2.4, maxHp:960,  atk:165, spd:93,  xp:30, coins:7,  detect:65, atk_range:4},
  skeleton: {sp:'orc2',   sz:2.2, maxHp:720,  atk:132, spd:135, xp:25, coins:6,  detect:70, atk_range:4},
  goblin:   {sp:'pirate1',sz:2.0, maxHp:480,  atk:96,  spd:158, xp:18, coins:4,  detect:60, atk_range:3.5},
  elite:    {sp:'orc3',   sz:2.6, maxHp:1400, atk:225, spd:87,  xp:55, coins:12, detect:75, atk_range:5},
  boss:     {sp:'dragon', sz:4.0, maxHp:8000, atk:450, spd:63,  xp:200,coins:80, detect:90, atk_range:8, isBoss:true},
};
const ROOM_CONFIGS = [
  ['zombie','zombie','goblin','goblin','zombie','goblin','orc'],
  ['orc','orc','skeleton','skeleton','goblin','orc','zombie'],
  ['skeleton','skeleton','zombie','orc','goblin','skeleton','goblin'],
  ['orc','orc','orc','elite','skeleton','orc','goblin'],
  ['goblin','goblin','zombie','zombie','orc','goblin','skeleton'],
  ['elite','orc','orc','skeleton','skeleton','elite','zombie'],
  ['elite','elite','orc','orc','zombie','skeleton','goblin'],
  ['elite','elite','skeleton','goblin','orc','elite','orc'],
];

// ── 싱글톤 ────────────────────────────────────────────────────────────────
let _instance = null;
export function initDungeonGame(opts)  { _instance = new DungeonGame(opts); }
export function openDungeonGame()      { _instance?.open(); }

// ══════════════════════════════════════════════════════════════════════════
class DungeonGame {
  constructor(opts) {
    this._opts = opts;
    this._uid  = null;
    this._entryFee=BASE_FEE; this._entryCount=0; this._entryResetAt=0;
    this._dbHp=1000; this._dbMaxHp=1000; this._dbAtk=50; this._dbDef=0;
    this._dbMp=1000; this._dbMaxMp=1000;
    this._entrySnapshot = null;
    this._mapData = null;
    this._spritesLoaded = false;
    this._running = false; this._dying = false;
    this._raf = null; this._keyHandler = null;
    this._debug = { navmesh:false, detect:false, path:false, rooms:false };
    this._keys = {};
    this._zoom = 1.0; this._zoomTarget = 1.0;
    this._shake = { x:0, y:0, end:0 };
    this._sndLimits = {};   // audio pool
    this._itemsObtained = 0;
    auth.onAuthStateChanged?.(u=>{ this._uid=u?.uid||null; });
    if (!auth.onAuthStateChanged&&auth.currentUser) this._uid=auth.currentUser.uid;
    this._buildDOM();
  }

  // ── DB ─────────────────────────────────────────────────────────────────
  async _loadDB() {
    if (!this._uid) return;
    try {
      const d = (await getDoc(doc(db,'battle_players',this._uid))).data()||{};
      this._dbHp=d.hp||1000; this._dbMaxHp=d.maxHp||this._dbHp;
      this._dbMp=d.mp||1000; this._dbMaxMp=d.maxMp||this._dbMp;
      this._dbAtk=d.attack||50; this._dbDef=d.defense||0;
      const e=d[GAME_KEY]||{}, now=Date.now();
      if (!e.resetAt||now-e.resetAt>RESET_MS){this._entryCount=0;this._entryResetAt=0;}
      else {this._entryCount=e.count||0;this._entryResetAt=e.resetAt;}
      this._entryFee=BASE_FEE+this._entryCount*FEE_STEP;
    } catch {}
    this._updateEntryUI();
  }

  async _recordEntry() {
    if (!this._uid) return;
    try {
      const now=Date.now(), isR=!this._entryResetAt||now-this._entryResetAt>RESET_MS;
      const nc=isR?1:this._entryCount+1, nr=isR?now:this._entryResetAt;
      await updateDoc(doc(db,'battle_players',this._uid),{
        gold:increment(-this._entryFee),
        [`${GAME_KEY}.count`]:nc,[`${GAME_KEY}.resetAt`]:nr,
      });
      this._entryCount=nc; this._entryResetAt=nr;
      this._entryFee=BASE_FEE+nc*FEE_STEP;
    } catch {}
  }

  // ── DOM ─────────────────────────────────────────────────────────────────
  _buildDOM() {
    if (document.getElementById('dungeonModal')) {
      this._modal=document.getElementById('dungeonModal');
      this._canvas=document.getElementById('dgCanvas');
      return;
    }
    const m=document.createElement('div');
    m.id='dungeonModal'; m.className='dg-modal hidden'; m.setAttribute('data-fs-modal','');
    m.innerHTML=`<style>
.dg-modal{position:fixed;inset:0;z-index:99999;background:#0d0d1a;display:flex;flex-direction:column;
  align-items:center;opacity:0;transition:opacity .45s ease;}
.dg-modal.dg-visible{opacity:1}
.dg-modal.hidden{display:none!important}
.dg-panel{position:relative;flex:1;width:100%;max-width:520px;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.dg-scr{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 16px;gap:10px;overflow-y:auto}
.dg-scr.hidden{display:none!important}
.dg-title{font-size:22px;font-weight:900;color:#fff}
.dg-fee{background:#1e1e3a;border:1px solid #3730a3;border-radius:10px;padding:8px 18px;font-size:13px;font-weight:700;color:#a78bfa}
.dg-btn{padding:10px 28px;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;width:100%;max-width:260px}
.dg-btn-go{background:#7c3aed;color:#fff;box-shadow:0 4px 18px rgba(124,58,237,.4)}
.dg-btn-go:disabled{opacity:.4;cursor:not-allowed}
.dg-btn-ghost{background:transparent;color:#6b7280;border:1px solid #374151}
.dg-game-wrap{position:relative;padding:0;overflow:hidden;display:flex;flex-direction:column;flex:1;width:100%;align-self:stretch}
.dg-hud{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;
  background:rgba(0,0,0,.9);border-bottom:1px solid #1f2937;gap:6px;flex-shrink:0}
.dg-hud-seg{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700}
.dg-bar-bg{width:68px;height:5px;background:#1f2937;border-radius:3px;overflow:hidden}
.dg-bar-fill{height:100%;border-radius:3px;transition:width .15s}
.dg-xbtn{background:rgba(239,68,68,.2);border:none;color:#f87171;cursor:pointer;border-radius:6px;padding:2px 8px;font-size:13px}
.dg-zoom-btn{background:rgba(255,255,255,.1);border:1px solid #374151;color:#d1d5db;cursor:pointer;border-radius:6px;padding:1px 7px;font-size:13px;font-weight:700}
canvas#dgCanvas{display:block;flex:1;width:100%;cursor:crosshair;touch-action:none}
.dg-skills{display:flex;gap:4px;padding:4px 6px;background:rgba(0,0,0,.9);
  justify-content:center;flex-shrink:0;border-top:1px solid #1f2937}
.dg-sk{position:relative;background:rgba(0,0,0,.9);border:2px solid #374151;border-radius:9px;
  padding:4px 8px;font-size:17px;cursor:pointer;color:#fff;display:flex;flex-direction:column;
  align-items:center;gap:1px;min-width:42px}
.dg-sk-cnt{font-size:10px;font-weight:700;color:#a78bfa}
.dg-sk-cd{position:absolute;inset:0;background:rgba(0,0,0,.55);border-radius:7px;
  display:none;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fbbf24}
.dg-pot-btn{background:rgba(0,0,0,.85);border:2px solid #374151;border-radius:9px;
  padding:4px 7px;font-size:14px;cursor:pointer;color:#fff;display:flex;flex-direction:column;
  align-items:center;gap:1px;min-width:38px}
.dg-pot-btn:disabled{opacity:.35}
.dg-pot-cnt{font-size:9.5px;font-weight:700;color:#4ade80}
.dg-toast{
  position:absolute;top:8px;right:8px;left:auto;transform:none;
  background:rgba(15,8,28,.92);border:1px solid rgba(124,58,237,.5);
  color:#e2e8f0;font-size:11px;font-weight:700;
  padding:4px 12px;border-radius:12px;line-height:1.5;
  pointer-events:none;white-space:nowrap;z-index:10;
  max-width:200px;text-align:center;overflow:hidden;text-overflow:ellipsis;
  box-shadow:0 2px 12px rgba(0,0,0,.6);
}
.dg-toast.hidden{display:none}
.dg-overlay-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:rgba(0,0,0,.78);z-index:20;gap:10px}
.dg-overlay-msg.hidden{display:none!important}
.dg-res-scr{text-align:center;gap:12px}
.dg-stat-row{display:flex;justify-content:space-between;width:100%;max-width:280px;font-size:13px;padding:4px 0;border-bottom:1px solid #1f2937}
.dg-stat-row .k{color:#6b7280}.dg-stat-row .v{font-weight:700;color:#f59e0b}
.dg-res-divider{width:100%;max-width:280px;border-top:1px solid #374151;margin:6px 0}
</style>
<div class="dg-panel">
  <div class="dg-scr" id="dgEntry">
    <div style="font-size:52px">🏰</div>
    <div class="dg-title">Dungeon</div>
    <div style="font-size:11px;color:#6b7280;text-align:center;line-height:1.7">
      500×500 map · 8 rooms · 300+ monsters<br>WASD or tap to move · Q/W/E/R/T skills<br>
      <span style="color:#ef4444;font-weight:700">⚠ Hardcore — potions required to survive</span>
    </div>
    <div class="dg-fee" id="dgFeeLabel">Entry fee: ${BASE_FEE} GP</div>
    <div style="font-size:10px;color:#6b7280" id="dgFeeInfo">First entry today</div>
    <button class="dg-btn dg-btn-go" id="dgEnterBtn">⚔️ Enter Dungeon</button>
    <button class="dg-btn dg-btn-ghost" id="dgCloseEntry">Cancel</button>
  </div>
  <div class="dg-scr dg-game-wrap hidden" id="dgGame" style="padding:0">
    <div class="dg-hud">
      <div class="dg-hud-seg">❤️<div class="dg-bar-bg"><div class="dg-bar-fill" id="dgHpFill" style="background:#22c55e;width:100%"></div></div><span id="dgHpTxt" style="font-size:9px">—</span></div>
      <div class="dg-hud-seg">💧<div class="dg-bar-bg"><div class="dg-bar-fill" id="dgMpFill" style="background:#3b82f6;width:100%"></div></div></div>
      <div class="dg-hud-seg" style="font-size:10px;color:#fbbf24" id="dgKills">💀0</div>
      <div class="dg-hud-seg" style="color:#fbbf24" id="dgCoins">💰0</div>
      <button class="dg-zoom-btn" id="dgZoomOut">−</button>
      <button class="dg-zoom-btn" id="dgZoomIn">+</button>
      <button class="dg-xbtn" id="dgExitBtn">✕</button>
    </div>
    <canvas id="dgCanvas"></canvas>
    <div class="dg-skills">
      <button class="dg-sk" id="dgSk_fire"  style="border-color:#f9731633">🔥<span class="dg-sk-cnt" id="dgSkC_fire">0</span><span style="font-size:7px;color:#4b5563">Q</span><div class="dg-sk-cd" id="dgSkD_fire"></div></button>
      <button class="dg-sk" id="dgSk_ice"   style="border-color:#38bdf833">❄️<span class="dg-sk-cnt" id="dgSkC_ice">0</span><span style="font-size:7px;color:#4b5563">W</span><div class="dg-sk-cd" id="dgSkD_ice"></div></button>
      <button class="dg-sk" id="dgSk_bolt"  style="border-color:#facc1533">⚡<span class="dg-sk-cnt" id="dgSkC_bolt">0</span><span style="font-size:7px;color:#4b5563">E</span><div class="dg-sk-cd" id="dgSkD_bolt"></div></button>
      <button class="dg-sk" id="dgSk_meteor"style="border-color:#fb923c33">☄️<span class="dg-sk-cnt" id="dgSkC_meteor">0</span><span style="font-size:7px;color:#4b5563">R</span><div class="dg-sk-cd" id="dgSkD_meteor"></div></button>
      <button class="dg-sk" id="dgSk_wind"  style="border-color:#a78bfa33">🌪️<span class="dg-sk-cnt" id="dgSkC_wind">0</span><span style="font-size:7px;color:#4b5563">T</span><div class="dg-sk-cd" id="dgSkD_wind"></div></button>
      <button class="dg-pot-btn" id="dgHpPotBtn" disabled>🧪<span class="dg-pot-cnt" id="dgHpPotCnt">0</span></button>
      <button class="dg-pot-btn" id="dgMpPotBtn" disabled>💙<span class="dg-pot-cnt" id="dgMpPotCnt">0</span></button>
    </div>
    <div class="dg-toast hidden" id="dgToast"></div>
    <div class="dg-overlay-msg hidden" id="dgDeathOv">
      <div style="font-size:48px">💀</div>
      <div class="dg-title" style="color:#f87171">Defeated</div>
      <div style="font-size:12px;color:#6b7280" id="dgDeathTxt">Exiting in 3s</div>
    </div>
  </div>
  <div class="dg-scr dg-res-scr hidden" id="dgResult">
    <div id="dgResIcon" style="font-size:50px">🏆</div>
    <div class="dg-title" id="dgResTitle">Cleared!</div>
    <div class="dg-res-divider"></div>
    <div id="dgResStats" style="width:100%;max-width:280px;margin-top:4px"></div>
    <div class="dg-res-divider"></div>
    <button class="dg-btn dg-btn-go" id="dgReEnterBtn" style="margin-top:10px">⚔️ Try Again</button>
    <button class="dg-btn dg-btn-ghost" id="dgLeaveBtn">Exit Dungeon</button>
  </div>
</div>`;
    document.body.appendChild(m);
    this._modal=m; this._canvas=m.querySelector('#dgCanvas');
    this._bindUI();
  }

  _bindUI() {
    const q=id=>this._modal.querySelector('#'+id);
    q('dgEnterBtn')?.addEventListener('click',()=>this._tryEnter());
    q('dgCloseEntry')?.addEventListener('click',()=>this.close());
    q('dgExitBtn')?.addEventListener('click',e=>{e.stopPropagation();if(this._running&&this._p){this._showResult(false,true);}else{this.close();}});
    q('dgReEnterBtn')?.addEventListener('click',()=>this._show('dgEntry'));
    q('dgLeaveBtn')?.addEventListener('click',()=>this.close());
    q('dgHpPotBtn')?.addEventListener('click',e=>{e.stopPropagation();this._usePot('hp');});
    q('dgMpPotBtn')?.addEventListener('click',e=>{e.stopPropagation();this._usePot('mp');});
    q('dgZoomIn')?.addEventListener('click',e=>{e.stopPropagation();this._zoomTarget=Math.min(2.0,this._zoomTarget+0.25);});
    q('dgZoomOut')?.addEventListener('click',e=>{e.stopPropagation();this._zoomTarget=Math.max(0.5,this._zoomTarget-0.25);});
    this._canvas.addEventListener('wheel',e=>{
      e.preventDefault();
      this._zoomTarget=Math.min(2.0,Math.max(0.5,this._zoomTarget-(e.deltaY>0?0.15:-0.15)));
    },{passive:false});
    this._canvas.addEventListener('click',e=>{e.stopPropagation();this._onClick(e);});
    this._canvas.addEventListener('touchend',e=>{e.stopPropagation();e.preventDefault();if(e.changedTouches[0])this._onClick(e.changedTouches[0]);},{passive:false});
    ['fire','ice','bolt','meteor','wind'].forEach(id=>{
      q(`dgSk_${id}`)?.addEventListener('click',e=>{e.stopPropagation();this._useSkill(id);});
    });
    this._modal.addEventListener('click',e=>e.stopPropagation());
    this._modal.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
    this._modal.addEventListener('touchend',e=>e.stopPropagation(),{passive:true});
  }

  // ── 열기/닫기 ───────────────────────────────────────────────────────────
  open() {
    this._modal.classList.remove('hidden');
    this._show('dgEntry');
    this._loadDB();
    requestAnimationFrame(()=>requestAnimationFrame(()=>this._modal.classList.add('dg-visible')));
  }

  close() {
    if (this._p) this._opts.onSyncPlayer?.({hp:this._p.hp,mp:this._p.mp});
    this._modal.classList.remove('dg-visible');
    setTimeout(()=>{ this._stop(); this._modal.classList.add('hidden'); this._opts?.onExit?.(); },460);
  }

  _show(id) {
    ['dgEntry','dgGame','dgResult'].forEach(s=>
      this._modal.querySelector('#'+s)?.classList.toggle('hidden',s!==id));
  }

  _updateEntryUI() {
    const lbl=document.getElementById('dgFeeLabel');
    const btn=document.getElementById('dgEnterBtn');
    const info=document.getElementById('dgFeeInfo');
    if (lbl) lbl.textContent=`Entry fee: ${this._entryFee} GP`;
    if (btn) btn.textContent=`⚔️ Enter Dungeon (${this._entryFee} GP)`;
    if (info) info.textContent=this._entryCount===0?'First entry today · resets in 24h':`Today: ${this._entryCount} entries`;
  }

  // ── 입장 ─────────────────────────────────────────────────────────────────
  async _tryEnter() {
    const btn=document.getElementById('dgEnterBtn');
    if (btn) btn.disabled=true;
    if (!this._uid) {
      this._toast('📍 Start the game first (▶ button on map)');
      if (btn) btn.disabled=false; return;
    }
    await this._loadDB();
    if (!this._opts.onSpendGold(this._entryFee)){
      this._toast(`💰 Not enough GP (need ${this._entryFee})`);
      if (btn) btn.disabled=false; return;
    }
    await this._recordEntry();
    this._toast('Loading map...');
    if (!this._mapData) {
      if (!this._spritesLoaded) { await loadAllDungeonSprites(); this._spritesLoaded=true; }
      this._mapData = await loadDungeonMap('/assets/images/monsters/dungeon.png');
    }
    this._entrySnapshot = this._opts.getPlayerSnapshot?.() || {
      hp:this._dbHp, maxHp:this._dbMaxHp, mp:this._dbMp, maxMp:this._dbMaxMp,
      attack:this._dbAtk, defense:this._dbDef,
    };
    this._modal.classList.remove('dg-visible');
    await new Promise(r=>setTimeout(r,460));
    this._initGame();
    this._show('dgGame');
    this._resizeCv();
    this._registerKeys();
    this._startAmbient();
    this._run();
    if (btn) btn.disabled=false;
    requestAnimationFrame(()=>requestAnimationFrame(()=>this._modal.classList.add('dg-visible')));
  }

  // ── 게임 초기화 ────────────────────────────────────────────────────────
  _initGame() {
    const snap=this._entrySnapshot||{};
    const rooms=this._mapData?.rooms||[];
    const spawnRoom=rooms[0]||{cx:WORLD_W/2,cy:WORLD_H/2};
    this._p={
      x:spawnRoom.cx, y:spawnRoom.cy,
      hp:snap.hp??this._dbHp, maxHp:snap.maxHp??this._dbMaxHp,
      mp:snap.mp??this._dbMp, maxMp:snap.maxMp??this._dbMaxMp,
      atk:(snap.attack??this._dbAtk)+5, def:snap.defense??this._dbDef,
      path:[], pathIdx:0,
      animState:'idle', facing:1, animT:0,
      kills:0, coins:0, xp:0, gpGained:0,
    };
    this._dungeonStartTime = Date.now();
    this._itemsObtained = 0;

    // 몬스터: 방당 45~80마리 (기존 3-5배)
    this._monsters=[];
    const roomCount=Math.min(rooms.length,10);
    for (let ri=0; ri<roomCount; ri++) {
      const room=rooms[ri];
      const isBossRoom=(ri===roomCount-1&&ri>=4);
      if (isBossRoom) {
        this._monsters.push(this._makeMon('boss',MON_TYPES.boss,room.cx,room.cy,ri));
        const guards=['elite','elite','elite','orc','orc','orc','skeleton','skeleton','skeleton','goblin','goblin','goblin','zombie','zombie','zombie','elite','orc','skeleton'];
        guards.forEach((t,i)=>{
          const sp=room.spawnPoints[i%Math.max(1,room.spawnPoints.length)];
          const ox=(Math.random()-.5)*16, oy=(Math.random()-.5)*16;
          this._monsters.push(this._makeMon(t,MON_TYPES[t],(sp?.x??room.cx)+ox,(sp?.y??room.cy)+oy,ri));
        });
      } else {
        const count=Math.min(80,Math.max(45,Math.floor(room.size/1.5)));
        const cfg=ROOM_CONFIGS[ri%ROOM_CONFIGS.length];
        for (let i=0;i<count;i++) {
          const typeKey=cfg[i%cfg.length];
          const sp=room.spawnPoints[i%Math.max(1,room.spawnPoints.length)];
          const ox=(Math.random()-.5)*16, oy=(Math.random()-.5)*16;
          this._monsters.push(this._makeMon(typeKey,MON_TYPES[typeKey],(sp?.x??room.cx)+ox,(sp?.y??room.cy)+oy,ri));
        }
      }
    }

    this._skills={fire:99,ice:99,bolt:99,meteor:99,wind:99};
    this._skillCds={fire:0,ice:0,bolt:0,meteor:0,wind:0};
    this._SKILL_CDS={fire:8,ice:10,bolt:7,meteor:15,wind:20};
    this._SKILL_MP={fire:30,ice:40,bolt:25,meteor:60,wind:50};
    this._projs=[]; this._floats=[]; this._effects=[]; this._drops=[];
    this._dying=false;
    this._cam={x:spawnRoom.cx, y:spawnRoom.cy};
    this._zoom=1.0; this._zoomTarget=1.0;
    this._running=true; this._ts=0; this._pathStagger=0;
    this._updateHUD(); this._updateSkillUI(); this._updatePotUI();
  }

  _makeMon(typeKey,def,x,y,roomIdx) {
    return {
      typeKey, def,
      x,y, homeX:x, homeY:y, roomIdx,
      hp:def.maxHp, atkCd:0,
      state:'idle', path:[], pathIdx:0, pathTimer:0,
      frame:0, frameTimer:0, facing:1, aggroTimer:0, respawnAt:0,
      id:Math.random().toString(36).slice(2),
    };
  }

  // ── 게임 루프 ────────────────────────────────────────────────────────────
  _run() {
    if (!this._running) return;
    this._lastTs=performance.now();
    const loop=ts=>{
      if (!this._running) return;
      const dt=Math.min((ts-this._lastTs)/1000,0.08); this._lastTs=ts; this._ts=ts;
      this._update(dt);
      // 줌 부드러운 보간
      this._zoom+=(this._zoomTarget-this._zoom)*Math.min(1,dt*8);
      // 화면 흔들림 계산
      const shakeNow=Date.now();
      const shk=shakeNow<this._shake.end?{x:this._shake.x,y:this._shake.y}:{x:0,y:0};
      if (shakeNow<this._shake.end) {
        const intensity=Math.max(0,(this._shake.end-shakeNow)/this._shake.dur)*this._shake.maxI;
        this._shake.x=(Math.random()-.5)*intensity;
        this._shake.y=(Math.random()-.5)*intensity;
      }
      renderDungeonFrame({
        mapImg:this._mapData?.img,
        walkable:getWalkable(),
        player:this._p,
        monsters:this._monsters,
        projs:this._projs,
        floats:this._floats,
        effects:this._effects,
        drops:this._drops,
        rooms:this._mapData?.rooms||[],
        cam:this._cam,
        ts, debug:this._debug,
        skills:this._skills,
        skillCds:this._skillCds,
        SKILL_CDS:this._SKILL_CDS,
        worldW:WORLD_W, worldH:WORLD_H,
        zoom:this._zoom,
        shake:shk,
      });
      this._raf=requestAnimationFrame(loop);
    };
    this._raf=requestAnimationFrame(loop);
  }

  _stop() {
    this._running=false; this._dying=false;
    if (this._raf){cancelAnimationFrame(this._raf);this._raf=null;}
    this._stopAmbient();
    if (this._keyHandler){document.removeEventListener('keydown',this._keyHandler);this._keyHandler=null;}
    document.removeEventListener('keyup',this._keyupHandler);
  }

  // ── 업데이트 ──────────────────────────────────────────────────────────
  _update(dt) {
    const p=this._p, now=Date.now();
    for (const k in this._skillCds) if(this._skillCds[k]>0) this._skillCds[k]=Math.max(0,this._skillCds[k]-dt);

    let moved=false;
    const spd=18*dt;
    let dx=0,dy=0;
    if (this._keys['w']||this._keys['arrowup'])    dy=-1;
    if (this._keys['s']||this._keys['arrowdown'])  dy=+1;
    if (this._keys['a']||this._keys['arrowleft'])  dx=-1;
    if (this._keys['d']||this._keys['arrowright']) dx=+1;
    if (dx!==0||dy!==0) {
      const len=Math.hypot(dx,dy)||1;
      const res=tryMove(p.x,p.y,dx/len*spd,dy/len*spd,1.0);
      if(res.x!==p.x||res.y!==p.y){p.x=res.x;p.y=res.y;moved=true;}
      p.facing=dx>0?1:(dx<0?-1:p.facing);
      p.path=[]; p.pathIdx=0;
    }
    if (!moved && p.path.length > p.pathIdx) {
      const wp=p.path[p.pathIdx];
      const d=Math.hypot(wp.x-p.x,wp.y-p.y);
      if (d<3) {
        p.pathIdx++; if(p.pathIdx>=p.path.length){p.path=[];p.pathIdx=0;}
      } else {
        const s=Math.min(18*dt,d);
        const res=tryMove(p.x,p.y,(wp.x-p.x)/d*s,(wp.y-p.y)/d*s,1.0);
        if(res.x!==p.x||res.y!==p.y){p.x=res.x;p.y=res.y;moved=true;}
        p.facing=wp.x>p.x?1:-1;
      }
    }
    p.animState=moved?'walk':'idle';
    p.animT+=dt;

    // 자동공격
    p.atkCd=Math.max(0,(p.atkCd||0)-dt);
    if (!this._dying && p.atkCd<=0) {
      let tgt=null, nd=55;
      for (const m of this._monsters) {
        if(m.state==='die') continue;
        const d=Math.hypot(m.x-p.x,m.y-p.y);
        if(d<nd){nd=d;tgt=m;}
      }
      if (tgt) {
        const adx=tgt.x-p.x, ady=tgt.y-p.y, al=Math.hypot(adx,ady)||1;
        const spd=140;
        this._projs.push({x:p.x,y:p.y,vx:adx/al*spd,vy:ady/al*spd,ttl:al/spd+0.6,dmg:p.atk,atk:p.atk,color:'#fde68a',src:'player',isArrow:true});
        p.atkCd=0.75; p.animState='atk'; p.facing=adx>0?1:-1;
        this._sfx('hit');
      }
    }

    this._cam.x+=(p.x-this._cam.x)*Math.min(1,dt*6);
    this._cam.y+=(p.y-this._cam.y)*Math.min(1,dt*6);

    this._pathStagger=(this._pathStagger+1)%Math.max(1,this._monsters.length);
    for (let i=0;i<this._monsters.length;i++) {
      const m=this._monsters[i];
      if (m.state==='die') { this._updateDead(m,dt,now); continue; }
      const distToPlayer=Math.hypot(m.x-p.x,m.y-p.y);
      const tick=(distToPlayer>150)?1.0:(distToPlayer>100)?0.4:dt;
      if (i===this._pathStagger||tick===dt) this._updateMon(m,dt,p,now,distToPlayer);
    }

    this._projs=this._projs.filter(pr=>{
      pr.x+=pr.vx*dt; pr.y+=pr.vy*dt; pr.ttl-=dt;
      if (pr.ttl<=0||!isWalkable(pr.x,pr.y)) return false;
      if (pr.src==='player') {
        for (const m of this._monsters) {
          if(m.state==='die') continue;
          if(Math.hypot(pr.x-m.x,pr.y-m.y)<m.def.sz+1){this._hitMon(m,pr.dmg); return false;}
        }
      } else {
        if(Math.hypot(pr.x-p.x,pr.y-p.y)<2.5){
          const red=Math.max(1,pr.atk-Math.floor(p.def*0.4));
          p.hp-=red;
          this._addFloat(`-${red}`,p.x,p.y-8,'#ff5555');
          this._sfx('damage');
          if (red > 100) this._screenShake(4, 250); // 강타 시 화면 흔들림
          return false;
        }
      }
      return true;
    });

    this._drops=this._drops.filter(d=>{
      if(Math.hypot(d.x-p.x,d.y-p.y)<4){
        if(d.skillId){
          this._skills[d.skillId]=(this._skills[d.skillId]||0)+1;
          this._addFloat(`${d.emoji}+1`,p.x,p.y-10,'#e879f9');
          this._updateSkillUI(); this._itemsObtained++;
        } else if(d.hp){
          const h=Math.min(d.hp,p.maxHp-p.hp); p.hp+=h;
          this._addFloat(`+${h}❤️`,p.x,p.y-10,'#4ade80'); this._itemsObtained++;
        } else if(d.mp){
          const r=Math.min(d.mp,p.maxMp-p.mp); p.mp+=r;
          this._addFloat(`+${r}💙`,p.x,p.y-10,'#60a5fa'); this._itemsObtained++;
        } else if(d.coins){
          p.coins+=d.coins; p.gpGained=(p.gpGained||0)+d.coins;
          this._opts.onAddGold(d.coins);
        }
        return false;
      }
      return true;
    });

    this._effects=this._effects.filter(e=>now-e.at<e.dur);
    this._floats=this._floats.filter(f=>{f.life-=dt;f.wy-=30*dt;return f.life>0;});
    this._updateHUD();
    if (p.hp<=0&&!this._dying) { this._dying=true; this._sfx('death'); this._deathSeq(); }
  }

  _updateMon(m, dt, p, now, dist) {
    const def=m.def;
    m.atkCd=Math.max(0,m.atkCd-dt);
    m.pathTimer=Math.max(0,m.pathTimer-dt);

    if (m.state==='idle'||m.state==='patrol') {
      if (dist<def.detect) { m.state='chase'; this._aggroNearby(m,p); }
      else if (m.state==='idle') {
        if (Math.random()<0.002) {
          const rnd=m.def.sz*10;
          m.path=findPath(m.x,m.y, m.homeX+(Math.random()-.5)*rnd, m.homeY+(Math.random()-.5)*rnd)||[];
          m.pathIdx=0; m.state='patrol';
        }
      }
    }

    if (m.state==='chase'||m.state==='patrol') {
      if (m.state==='chase'&&dist>def.detect*2) {
        m.state='return'; m.path=findPath(m.x,m.y,m.homeX,m.homeY)||[]; m.pathIdx=0;
      } else if (m.state==='chase'&&dist<def.atk_range) {
        m.state='attack';
      } else {
        const interval=m.state==='chase'?0.8:3;
        if (m.pathTimer<=0) {
          const tx=m.state==='chase'?p.x:m.homeX+(Math.random()-.5)*20;
          const ty=m.state==='chase'?p.y:m.homeY+(Math.random()-.5)*20;
          m.path=findPath(m.x,m.y,tx,ty)||[]; m.pathIdx=0; m.pathTimer=interval;
        }
        this._followPath(m,dt, Math.min(19, m.def.spd*0.21));
      }
    }

    if (m.state==='attack') {
      m.facing=p.x>m.x?1:-1;
      if (dist>def.atk_range+2) { m.state='chase'; return; }
      if (m.atkCd<=0) {
        const dmg=Math.max(1,def.atk-Math.floor(p.def*0.4));
        p.hp-=dmg; m.atkCd=1.4;
        this._addFloat(`-${dmg}`,p.x,p.y-8,'#ff5555');
        this._sfx('damage');
        if (dmg > 80) this._screenShake(3, 200);
      }
    }

    if (m.state==='return') {
      this._followPath(m,dt,12);
      if (Math.hypot(m.x-m.homeX,m.y-m.homeY)<3) { m.state='idle'; m.path=[]; }
    }

    m.frameTimer+=dt;
    if (m.frameTimer>0.1) {
      m.frameTimer=0;
      const anim=m.state==='attack'?'atk':m.state==='idle'?'idle':'walk';
      const frames=MSPRITE_DEFS[def.sp]?.[anim]?.length||6;
      m.frame=(m.frame+1)%frames;
    }
  }

  _updateDead(m,dt,now) {
    m.frameTimer+=dt;
    if (m.frameTimer>0.1) {
      m.frameTimer=0;
      const nf=MSPRITE_DEFS[m.def.sp]?.die?.length||6;
      m.frame=Math.min(m.frame+1,nf-1);
    }
    if (!m.respawnAt) m.respawnAt=now+4000; // 4초 후 리스폰 (기존 12초)
    if (now>m.respawnAt) {
      m.hp=m.def.maxHp; m.state='idle'; m.frame=0; m.frameTimer=0;
      m.x=m.homeX+(Math.random()-.5)*8; m.y=m.homeY+(Math.random()-.5)*8;
      if(!isWalkable(m.x,m.y)){m.x=m.homeX;m.y=m.homeY;}
      m.respawnAt=0; m.path=[]; m.pathIdx=0; m.atkCd=0;
    }
  }

  _followPath(m,dt,spd) {
    if (!m.path||m.pathIdx>=m.path.length) return;
    const wp=m.path[m.pathIdx];
    const d=Math.hypot(wp.x-m.x,wp.y-m.y);
    if (d<2.5) { m.pathIdx++; return; }
    const s=Math.min(spd*dt,d);
    const res=tryMove(m.x,m.y,(wp.x-m.x)/d*s,(wp.y-m.y)/d*s,0.6);
    m.x=res.x; m.y=res.y; m.facing=wp.x>m.x?1:-1;
  }

  _aggroNearby(triggerMon, p) {
    const R=15;
    for (const m of this._monsters) {
      if (m.state==='die'||m===triggerMon) continue;
      if (Math.hypot(m.x-triggerMon.x,m.y-triggerMon.y)<R) {
        m.state='chase';
        m.path=findPath(m.x,m.y,p.x,p.y)||[]; m.pathIdx=0;
      }
    }
  }

  _hitMon(m, dmg) {
    if (m.state==='die') return;
    const red=Math.max(1,dmg-Math.floor(m.def.spd*0.05));
    m.hp-=red;
    this._addFloat(`-${red}`,m.x,m.y-m.def.sz*2,'#f87171');
    if (m.state!=='chase'&&m.state!=='attack') {
      m.state='chase';
      m.path=findPath(m.x,m.y,this._p.x,this._p.y)||[]; m.pathIdx=0;
    }
    if (m.hp<=0) this._killMon(m);
  }

  _killMon(m) {
    if (m.state==='die') return;
    m.state='die'; m.frame=0; m.frameTimer=0;
    this._sfx('kill');
    this._p.kills++; this._p.xp+=m.def.xp;
    this._drops.push({x:m.x,y:m.y,coins:m.def.coins});
    this._opts.onAddGold(m.def.coins);
    this._p.gpGained=(this._p.gpGained||0)+m.def.coins;
    if (Math.random()<0.25) {
      const skills=['fire','ice','bolt','meteor','wind'];
      const emojis=['🔥','❄️','⚡','☄️','🌪️'];
      const idx=Math.floor(Math.random()*skills.length);
      this._drops.push({x:m.x+(Math.random()-.5)*6,y:m.y+(Math.random()-.5)*6,skillId:skills[idx],emoji:emojis[idx]});
    }
    if (Math.random()<0.45) this._drops.push({x:m.x+(Math.random()-.5)*6,y:m.y+(Math.random()-.5)*6,hp:Math.round(this._p.maxHp*0.12)});
    if (Math.random()<0.35) this._drops.push({x:m.x+(Math.random()-.5)*6,y:m.y+(Math.random()-.5)*6,mp:Math.round(this._p.maxMp*0.12)});
    this._effects.push({type:'kill',x:m.x,y:m.y,r:m.def.sz*4,at:Date.now(),dur:500,color:'#fbbf24'});
    if (m.def.isBoss) this._screenShake(10, 600);
    else if (m.def===MON_TYPES.elite) this._screenShake(4, 250);
  }

  // ── 스킬 ─────────────────────────────────────────────────────────────────
  _useSkill(id) {
    if (!this._running||!this._p) return;
    if ((this._skillCds[id]||0)>0){this._toast('⏳ Cooldown');return;}
    const mpCost=this._SKILL_MP?.[id]||30;
    if (this._p.mp<mpCost){this._toast(`💧 MP needed: ${mpCost}`);return;}
    const p=this._p, s=this._SKILL_CDS[id], now=Date.now();
    p.mp=Math.max(0,p.mp-mpCost);
    this._skillCds[id]=s;
    this._sfxSkill(id);
    const range=30;
    if (id==='fire') {
      this._effects.push({type:'fire',x:p.x,y:p.y,r:range,at:now,dur:700,color:'#f97316'});
      this._effects.push({type:'fire',x:p.x,y:p.y,r:range*0.6,at:now,dur:500,color:'#fbbf24'});
      this._screenShake(5, 300);
      for (const m of this._monsters) { if(m.state==='die') continue; if(Math.hypot(m.x-p.x,m.y-p.y)<range){this._hitMon(m,80);} }
    } else if (id==='ice') {
      this._effects.push({type:'ice',x:p.x,y:p.y,r:range*1.2,at:now,dur:700,color:'#38bdf8'});
      this._effects.push({type:'ice',x:p.x,y:p.y,r:range*0.5,at:now,dur:500,color:'#bae6fd'});
      this._screenShake(3, 250);
      for (const m of this._monsters) { if(m.state==='die') continue; if(Math.hypot(m.x-p.x,m.y-p.y)<range*1.2){this._hitMon(m,40);m.state='patrol';m.path=[];} }
    } else if (id==='bolt') {
      let src={x:p.x,y:p.y}; const used=new Set(),segs=[];
      for (let c=0;c<8;c++){let best=null,bd=60;for(const m of this._monsters){if(m.state==='die'||used.has(m.id))continue;const d=Math.hypot(m.x-src.x,m.y-src.y);if(d<bd){bd=d;best=m;}}if(!best)break;used.add(best.id);segs.push({from:{...src},to:{x:best.x,y:best.y}});this._hitMon(best,110);src={x:best.x,y:best.y};}
      if(segs.length){this._effects.push({type:'bolt',segs,at:now,dur:500,color:'#facc15'});this._screenShake(4,300);}
    } else if (id==='meteor') {
      const tx=p.x,ty=p.y;
      this._effects.push({type:'meteor_warn',x:tx,y:ty,r:28,at:now,dur:800,color:'#fb923c'});
      setTimeout(()=>{
        if(!this._running)return;
        this._effects.push({type:'meteor_hit',x:tx,y:ty,r:28,at:Date.now(),dur:600,color:'#ef4444'});
        this._effects.push({type:'fire',x:tx,y:ty,r:14,at:Date.now(),dur:400,color:'#fbbf24'});
        this._screenShake(8, 450);
        for(const m of this._monsters){if(m.state==='die')continue;if(Math.hypot(m.x-tx,m.y-ty)<28)this._hitMon(m,200);}
      },800);
    } else if (id==='wind') {
      this._effects.push({type:'wind',x:p.x,y:p.y,r:18,at:now,dur:5000,color:'#a78bfa'});
      this._screenShake(2, 200);
      const windTick=setInterval(()=>{if(!this._running){clearInterval(windTick);return;}for(const m of this._monsters){if(m.state==='die')continue;if(Math.hypot(m.x-p.x,m.y-p.y)<18)this._hitMon(m,8);}},200);
      setTimeout(()=>clearInterval(windTick),5000);
    }
    this._updateSkillUI();
  }

  _usePot(type) {
    const inv=this._opts.getInventory?.()??{};
    const id=type==='hp'?'potion_red':'potion_mp';
    if(!(inv[id]>0)) return;
    if(!this._opts.onUseItem?.(id)) return;
    this._sfx('potion');
    if(type==='hp'){const h=Math.round(this._p.maxHp*0.35);this._p.hp=Math.min(this._p.maxHp,this._p.hp+h);this._addFloat(`+${h}❤️`,this._p.x,this._p.y-8,'#4ade80');}
    else{const r=Math.round(this._p.maxMp*0.35);this._p.mp=Math.min(this._p.maxMp,this._p.mp+r);this._addFloat(`+${r}💙`,this._p.x,this._p.y-8,'#60a5fa');}
    this._updatePotUI();
  }

  // ── 화면 흔들림 ──────────────────────────────────────────────────────────
  _screenShake(maxI, dur) {
    this._shake = { x:0, y:0, end:Date.now()+dur, dur, maxI };
  }

  // ── HUD ─────────────────────────────────────────────────────────────────
  _updateHUD() {
    const p=this._p; if(!p) return;
    const hf=document.getElementById('dgHpFill');
    const mf=document.getElementById('dgMpFill');
    const ht=document.getElementById('dgHpTxt');
    if(hf){const r=Math.max(0,p.hp/p.maxHp*100);hf.style.width=r+'%';hf.style.background=r>50?'#22c55e':r>25?'#f59e0b':'#ef4444';}
    if(mf) mf.style.width=Math.max(0,p.mp/p.maxMp*100)+'%';
    if(ht) ht.textContent=`${Math.max(0,Math.floor(p.hp))}/${p.maxHp}`;
    const kills=document.getElementById('dgKills'); if(kills) kills.textContent=`💀${p.kills}`;
    const coins=document.getElementById('dgCoins'); if(coins) coins.textContent=`💰${p.coins}`;
  }

  _updateSkillUI() {
    for (const id in this._skills) {
      const cnt=document.getElementById(`dgSkC_${id}`);
      const cd=document.getElementById(`dgSkD_${id}`);
      const btn=document.getElementById(`dgSk_${id}`);
      const count=this._skills[id]||0, cooldown=this._skillCds[id]||0;
      if(cnt) cnt.textContent=count;
      if(btn) btn.style.opacity=(count>0&&cooldown<=0)?'1':'0.4';
      if(cd){if(cooldown>0){cd.style.display='flex';cd.textContent=Math.ceil(cooldown)+'s';}else cd.style.display='none';}
    }
  }

  _updatePotUI() {
    const inv=this._opts.getInventory?.()??{};
    const hp=inv['potion_red']||0, mp=inv['potion_mp']||0;
    const hb=document.getElementById('dgHpPotBtn'),mb=document.getElementById('dgMpPotBtn');
    const hc=document.getElementById('dgHpPotCnt'),mc=document.getElementById('dgMpPotCnt');
    if(hb)hb.disabled=!hp;if(hc)hc.textContent=hp;
    if(mb)mb.disabled=!mp;if(mc)mc.textContent=mp;
  }

  _addFloat(text,wx,wy,color){this._floats.push({text,wx,wy,color,life:1.2});}

  _toast(msg) {
    const el=document.getElementById('dgToast'); if(!el) return;
    el.textContent=msg; el.classList.remove('hidden');
    clearTimeout(this._toastTmr);
    this._toastTmr=setTimeout(()=>el?.classList.add('hidden'),2000);
  }

  // ── 사운드 시스템 (Audio Pool — 동시 재생 제한) ──────────────────────────
  _ac(){
    if(!this._audio){try{this._audio=new(window.AudioContext||window.webkitAudioContext)();}catch{}}
    if(this._audio?.state==='suspended') this._audio.resume();
    return this._audio;
  }

  _canPlay(type) {
    const now=Date.now(), MAX=3, WIN=200;
    this._sndLimits[type]=(this._sndLimits[type]||[]).filter(t=>now-t<WIN);
    if(this._sndLimits[type].length>=MAX) return false;
    this._sndLimits[type].push(now); return true;
  }

  _tone(freq,type,dur,vol=0.18,sweep=0){
    const a=this._ac(); if(!a) return;
    try{
      const o=a.createOscillator(), g=a.createGain(), comp=a.createDynamicsCompressor();
      o.connect(g); g.connect(comp); comp.connect(a.destination);
      comp.threshold.value=-24; comp.ratio.value=4;
      o.type=type; g.gain.setValueAtTime(Math.min(0.4,vol),a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+dur);
      if(sweep){o.frequency.setValueAtTime(sweep,a.currentTime);o.frequency.linearRampToValueAtTime(freq,a.currentTime+dur*.7);}
      else o.frequency.value=freq;
      o.start(); o.stop(a.currentTime+dur);
    }catch{}
  }

  _noise(dur,vol=0.12){
    const a=this._ac(); if(!a) return;
    try{
      const sr=a.sampleRate, buf=a.createBuffer(1,Math.ceil(sr*dur),sr);
      const ch=buf.getChannelData(0);
      for(let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.exp(-i/sr*22);
      const src=a.createBufferSource(), g=a.createGain(), comp=a.createDynamicsCompressor();
      src.buffer=buf; g.gain.value=Math.min(0.3,vol);
      src.connect(g); g.connect(comp); comp.connect(a.destination); src.start();
    }catch{}
  }

  _sfx(type){
    if(!this._canPlay(type)) return;
    switch(type){
      case 'hit':     this._noise(0.09,0.14); break;
      case 'kill':    this._tone(523,'sine',.1,.22); setTimeout(()=>this._tone(784,'sine',.15,.22),90); break;
      case 'damage':  this._noise(0.12,0.18); this._tone(120,'sawtooth',.15,.1); break;
      case 'death':   [220,160,100].forEach((f,i)=>setTimeout(()=>this._tone(f,'sawtooth',.35,.2),i*150)); break;
      case 'potion':  this._tone(660,'sine',.08,.15); this._tone(880,'sine',.12,.12); break;
    }
  }

  _sfxSkill(id){
    if(!this._canPlay('skill_'+id)) return;
    switch(id){
      case 'fire':   this._tone(200,'sawtooth',.25,.25,80); this._noise(0.2,0.18); break;
      case 'ice':    this._tone(1200,'triangle',.3,.2,1800); this._noise(0.1,0.08); break;
      case 'bolt':   this._tone(880,'square',.15,.25); this._noise(0.08,0.15); break;
      case 'meteor': this._tone(80,'sawtooth',.5,.3,200); this._noise(0.4,0.25); break;
      case 'wind':   this._tone(400,'sine',.4,.15,600); this._noise(0.3,0.12); break;
    }
  }

  _startAmbient(){
    const a=this._ac(); if(!a||this._ambNodes) return;
    try{
      const o=a.createOscillator(), g=a.createGain(), lfo=a.createOscillator(), lg=a.createGain();
      o.type='sawtooth'; o.frequency.value=48; g.gain.value=0.022;
      lfo.frequency.value=0.18; lg.gain.value=0.008;
      lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(a.destination);
      lfo.start(); o.start(); this._ambNodes={o,lfo,g};
    }catch{}
  }
  _stopAmbient(){if(!this._ambNodes)return;try{this._ambNodes.o.stop();this._ambNodes.lfo.stop();}catch{}this._ambNodes=null;}

  // ── 입력 ────────────────────────────────────────────────────────────────
  _onClick(e) {
    if (!this._running) return;
    const rect=this._canvas.getBoundingClientRect();
    const sx=((e.clientX??e.pageX)-rect.left)*(this._canvas.width/rect.width);
    const sy=((e.clientY??e.pageY)-rect.top)*(this._canvas.height/rect.height);
    const vp=120/this._zoom;
    const scale=this._canvas.width/vp;
    const wx=this._cam.x+(sx-this._canvas.width/2)/scale;
    const wy=this._cam.y+(sy-this._canvas.height/2)/scale;
    if (!isWalkable(wx,wy)) return;
    const path=findPath(this._p.x,this._p.y,wx,wy);
    if (path) { this._p.path=path; this._p.pathIdx=0; }
  }

  _registerKeys() {
    if (this._keyHandler) document.removeEventListener('keydown',this._keyHandler);
    const skillMap={q:'fire',w:'ice',e:'bolt',r:'meteor',t:'wind'};
    this._keyHandler=ev=>{
      if (!this._running) return;
      const k=ev.key.toLowerCase();
      this._keys[k]=true;
      if (skillMap[k]){ev.preventDefault();this._useSkill(skillMap[k]);}
      if (ev.key==='F1'){ev.preventDefault();this._debug.navmesh=!this._debug.navmesh;}
      if (ev.key==='F2'){ev.preventDefault();this._debug.detect=!this._debug.detect;}
      if (ev.key==='F3'){ev.preventDefault();this._debug.path=!this._debug.path;}
      if (ev.key==='F4'){ev.preventDefault();this._debug.rooms=!this._debug.rooms;}
    };
    this._keyupHandler=ev=>{this._keys[ev.key.toLowerCase()]=false;};
    document.addEventListener('keydown',this._keyHandler);
    document.addEventListener('keyup',this._keyupHandler);
  }

  _resizeCv() {
    const gw=this._modal.querySelector('#dgGame'); if(!gw) return;
    const hud=this._modal.querySelector('.dg-hud');
    const bar=this._modal.querySelector('.dg-skills');
    const r=gw.getBoundingClientRect();
    const hh=hud?.offsetHeight||38, bh=bar?.offsetHeight||46;
    this._canvas.width=Math.max(280,Math.floor(r.width));
    this._canvas.height=Math.max(200,Math.floor(r.height-hh-bh));
    initDungeonRenderer(this._canvas);
  }

  // ── 사망 시퀀스 ───────────────────────────────────────────────────────
  _deathSeq() {
    const ov=document.getElementById('dgDeathOv'); if(ov)ov.classList.remove('hidden');
    let n=3;
    const iv=setInterval(()=>{
      const txt=document.getElementById('dgDeathTxt');
      n--; if(txt) txt.textContent=n>0?`Exiting in ${n}s`:'Exiting...';
      if(n<=0){clearInterval(iv);this._showResult(false);}
    },1000);
  }

  _showResult(cleared, manualExit=false) {
    this._stop();
    const p=this._p;
    const ov=document.getElementById('dgDeathOv'); if(ov)ov.classList.add('hidden');
    const elapsed=Math.floor((Date.now()-(this._dungeonStartTime||Date.now()))/1000);
    const mm=Math.floor(elapsed/60), ss=elapsed%60;
    const timeStr=`${mm}m ${ss.toString().padStart(2,'0')}s`;
    const gp = p.gpGained||p.coins||0;

    let icon, title, titleColor;
    if (manualExit)      { icon='🚪'; title='Exited';         titleColor='#94a3b8'; }
    else if (cleared)    { icon='🏆'; title='Cleared!';        titleColor='#22c55e'; }
    else                 { icon='💀'; title='Defeated!';       titleColor='#f87171'; }

    document.getElementById('dgResIcon').textContent=icon;
    document.getElementById('dgResTitle').textContent=title;
    document.getElementById('dgResTitle').style.color=titleColor;
    document.getElementById('dgResStats').innerHTML=`
      <div class="dg-stat-row"><span class="k">GP Earned</span><span class="v" style="color:#4ade80">+${gp} GP</span></div>
      <div class="dg-stat-row"><span class="k">Monsters Defeated</span><span class="v">${p.kills}</span></div>
      <div class="dg-stat-row"><span class="k">Survival Time</span><span class="v">${timeStr}</span></div>
      <div class="dg-stat-row"><span class="k">Items Obtained</span><span class="v">${this._itemsObtained}</span></div>
      <div class="dg-stat-row"><span class="k">XP Gained</span><span class="v">${p.xp} XP</span></div>`;
    this._updateEntryUI();
    this._show('dgResult');
    if (gp >= 50) this._opts.onDungeonEnd?.({ gp, kills: p.kills, cleared, manualExit });
  }
}
