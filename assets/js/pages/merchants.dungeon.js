// merchants.dungeon.js — 던전 v5 (dungeon.png 맵, A* AI, 벽 충돌)
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

// ── 몬스터 종류 ───────────────────────────────────────────────────────────
const MON_TYPES = {
  zombie:   {sp:'zombie', sz:2.2, maxHp:320, atk:38, spd:80,  xp:22, coins:5,  detect:65, atk_range:4},
  orc:      {sp:'orc1',   sz:2.4, maxHp:480, atk:55, spd:62,  xp:30, coins:7,  detect:65, atk_range:4},
  skeleton: {sp:'orc2',   sz:2.2, maxHp:360, atk:44, spd:90,  xp:25, coins:6,  detect:70, atk_range:4},
  goblin:   {sp:'pirate1',sz:2.0, maxHp:240, atk:32, spd:105, xp:18, coins:4,  detect:60, atk_range:3.5},
  elite:    {sp:'orc3',   sz:2.6, maxHp:700, atk:75, spd:58,  xp:55, coins:12, detect:75, atk_range:5},
  boss:     {sp:'dragon', sz:4.0, maxHp:4000,atk:150,spd:42,  xp:200,coins:80, detect:90, atk_range:8, isBoss:true},
};
// 방별 몬스터 조합 (복수 타입 혼합)
const ROOM_CONFIGS = [
  ['zombie','zombie','goblin','goblin','zombie'],
  ['orc','orc','skeleton','skeleton','goblin'],
  ['skeleton','skeleton','zombie','orc','goblin'],
  ['orc','orc','orc','elite','skeleton'],
  ['goblin','goblin','zombie','zombie','orc'],
  ['elite','orc','orc','skeleton','skeleton'],
  ['elite','elite','orc','orc','zombie'],
  ['elite','elite','skeleton','goblin','orc'],
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
    m.id='dungeonModal'; m.className='dg-modal hidden';
    m.innerHTML=`<style>
.dg-modal{position:fixed;inset:0;z-index:3000;background:#0d0d1a;display:flex;flex-direction:column;
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
  position:absolute;top:46px;left:50%;transform:translateX(-50%);
  background:rgba(15,8,28,.88);border:1px solid rgba(124,58,237,.45);
  color:#e2e8f0;font-size:11px;font-weight:700;
  padding:4px 14px;border-radius:20px;line-height:1.3;
  pointer-events:none;white-space:nowrap;z-index:10;
  width:auto;height:auto;max-width:85%;overflow:hidden;text-overflow:ellipsis;
  box-shadow:0 2px 12px rgba(0,0,0,.55);
}
.dg-toast.hidden{display:none}
.dg-overlay-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:rgba(0,0,0,.78);z-index:20;gap:10px}
.dg-overlay-msg.hidden{display:none!important}
.dg-res-scr{text-align:center;gap:12px}
.dg-stat-row{display:flex;justify-content:space-between;width:100%;max-width:260px;font-size:13px;padding:3px 0}
.dg-stat-row .k{color:#6b7280}.dg-stat-row .v{font-weight:700;color:#f59e0b}
</style>
<div class="dg-panel">
  <div class="dg-scr" id="dgEntry">
    <div style="font-size:52px">🏰</div>
    <div class="dg-title">Dungeon</div>
    <div style="font-size:11px;color:#6b7280;text-align:center;line-height:1.7">
      500×500 맵 · 8개 방 · 100+ 몬스터<br>WASD 또는 클릭 이동 · Q/W/E/R/T 스킬
    </div>
    <div class="dg-fee" id="dgFeeLabel">입장료: ${BASE_FEE} GP</div>
    <div style="font-size:10px;color:#6b7280" id="dgFeeInfo">오늘 첫 입장</div>
    <button class="dg-btn dg-btn-go" id="dgEnterBtn">⚔️ 던전 입장</button>
    <button class="dg-btn dg-btn-ghost" id="dgCloseEntry">취소</button>
  </div>
  <div class="dg-scr dg-game-wrap hidden" id="dgGame" style="padding:0">
    <div class="dg-hud">
      <div class="dg-hud-seg">❤️<div class="dg-bar-bg"><div class="dg-bar-fill" id="dgHpFill" style="background:#22c55e;width:100%"></div></div><span id="dgHpTxt" style="font-size:9px">—</span></div>
      <div class="dg-hud-seg">💧<div class="dg-bar-bg"><div class="dg-bar-fill" id="dgMpFill" style="background:#3b82f6;width:100%"></div></div></div>
      <div class="dg-hud-seg" style="font-size:10px;color:#fbbf24" id="dgKills">💀0</div>
      <div class="dg-hud-seg" style="color:#fbbf24" id="dgCoins">💰0</div>
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
      <div class="dg-title" style="color:#f87171">전멸</div>
      <div style="font-size:12px;color:#6b7280" id="dgDeathTxt">3초 후 퇴장</div>
    </div>
  </div>
  <div class="dg-scr dg-res-scr hidden" id="dgResult">
    <div id="dgResIcon" style="font-size:50px">🏆</div>
    <div class="dg-title" id="dgResTitle">클리어!</div>
    <div id="dgResStats" style="width:100%;max-width:260px;margin-top:8px"></div>
    <button class="dg-btn dg-btn-go" id="dgReEnterBtn" style="margin-top:12px">다시 도전!</button>
    <button class="dg-btn dg-btn-ghost" id="dgLeaveBtn">던전 나가기</button>
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
    q('dgExitBtn')?.addEventListener('click',()=>{if(confirm('던전에서 나가시겠습니까?'))this.close();});
    q('dgReEnterBtn')?.addEventListener('click',()=>this._show('dgEntry'));
    q('dgLeaveBtn')?.addEventListener('click',()=>this.close());
    q('dgHpPotBtn')?.addEventListener('click',()=>this._usePot('hp'));
    q('dgMpPotBtn')?.addEventListener('click',()=>this._usePot('mp'));
    this._canvas.addEventListener('click',e=>this._onClick(e));
    this._canvas.addEventListener('touchend',e=>{e.preventDefault();if(e.changedTouches[0])this._onClick(e.changedTouches[0]);},{passive:false});
    ['fire','ice','bolt','meteor','wind'].forEach(id=>{
      q(`dgSk_${id}`)?.addEventListener('click',()=>this._useSkill(id));
    });
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
    setTimeout(()=>{
      this._stop();
      this._modal.classList.add('hidden');
      this._opts?.onExit?.();
    },460);
  }

  _show(id) {
    ['dgEntry','dgGame','dgResult'].forEach(s=>
      this._modal.querySelector('#'+s)?.classList.toggle('hidden',s!==id));
  }

  _updateEntryUI() {
    const lbl=document.getElementById('dgFeeLabel');
    const btn=document.getElementById('dgEnterBtn');
    const info=document.getElementById('dgFeeInfo');
    if (lbl) lbl.textContent=`입장료: ${this._entryFee} GP`;
    if (btn) btn.textContent=`⚔️ 던전 입장 (${this._entryFee} GP)`;
    if (info) info.textContent=this._entryCount===0?'오늘 첫 입장·24h 후 리셋':`오늘 ${this._entryCount}번째`;
  }

  // ── 입장 ─────────────────────────────────────────────────────────────────
  async _tryEnter() {
    const btn=document.getElementById('dgEnterBtn');
    if (btn) btn.disabled=true;
    await this._loadDB();
    if (!this._opts.onSpendGold(this._entryFee)){
      this._toast(`GP 부족 (${this._entryFee}GP 필요)`);
      if (btn) btn.disabled=false; return;
    }
    await this._recordEntry();

    this._toast('맵 로딩 중...');
    if (!this._mapData) {
      if (!this._spritesLoaded) {
        await loadAllDungeonSprites();
        this._spritesLoaded=true;
      }
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

    // 플레이어: 가장 큰 방 중앙 스폰
    const spawnRoom=rooms[0]||{cx:WORLD_W/2,cy:WORLD_H/2};
    this._p={
      x:spawnRoom.cx, y:spawnRoom.cy,
      hp:snap.hp??this._dbHp, maxHp:snap.maxHp??this._dbMaxHp,
      mp:snap.mp??this._dbMp, maxMp:snap.maxMp??this._dbMaxMp,
      atk:(snap.attack??this._dbAtk)+5, def:snap.defense??this._dbDef,
      path:[], pathIdx:0,
      animState:'idle', facing:1, animT:0,
      kills:0, coins:0, xp:0,
    };

    // 몬스터: 방당 8~15마리, 최소 100마리 이상
    this._monsters=[];
    const roomCount=Math.min(rooms.length,10);
    for (let ri=0; ri<roomCount; ri++) {
      const room=rooms[ri];
      const isBossRoom=(ri===roomCount-1&&ri>=4);

      if (isBossRoom) {
        // 보스방: 보스 1 + 수호자 8마리
        this._monsters.push(this._makeMon('boss',MON_TYPES.boss,room.cx,room.cy,ri));
        const guards=['elite','elite','orc','orc','skeleton','skeleton','goblin','goblin'];
        guards.forEach((t,i)=>{
          const sp=room.spawnPoints[i%Math.max(1,room.spawnPoints.length)];
          const ox=(Math.random()-.5)*10, oy=(Math.random()-.5)*10;
          this._monsters.push(this._makeMon(t,MON_TYPES[t],(sp?.x??room.cx)+ox,(sp?.y??room.cy)+oy,ri));
        });
      } else {
        // 일반방: 방 크기 비례 (최소 8, 최대 15)
        const count=Math.min(15,Math.max(8,Math.floor(room.size/6)));
        const cfg=ROOM_CONFIGS[ri%ROOM_CONFIGS.length];
        for (let i=0;i<count;i++) {
          const typeKey=cfg[i%cfg.length];
          const sp=room.spawnPoints[i%Math.max(1,room.spawnPoints.length)];
          const ox=(Math.random()-.5)*12, oy=(Math.random()-.5)*12;
          this._monsters.push(this._makeMon(typeKey,MON_TYPES[typeKey],(sp?.x??room.cx)+ox,(sp?.y??room.cy)+oy,ri));
        }
      }
    }

    this._skills={fire:0,ice:0,bolt:0,meteor:0,wind:0};
    this._skillCds={fire:0,ice:0,bolt:0,meteor:0,wind:0};
    const SKILL_CDS={fire:8,ice:10,bolt:7,meteor:15,wind:20};
    this._SKILL_CDS=SKILL_CDS;
    this._projs=[]; this._floats=[]; this._effects=[];
    this._drops=[];
    this._dying=false;
    this._cam={x:spawnRoom.cx, y:spawnRoom.cy};
    this._running=true;
    this._ts=0;
    this._pathStagger=0;
    this._updateHUD();
    this._updateSkillUI();
    this._updatePotUI();
  }

  _makeMon(typeKey,def,x,y,roomIdx) {
    return {
      typeKey, def,
      x,y, homeX:x, homeY:y, roomIdx,
      hp:def.maxHp, atkCd:0,
      state:'idle',   // idle|patrol|chase|attack|return|die
      path:[], pathIdx:0,
      pathTimer:0,
      frame:0, frameTimer:0, facing:1,
      aggroTimer:0,
      respawnAt:0,
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
        ts,
        debug:this._debug,
        skills:this._skills,
        skillCds:this._skillCds,
        SKILL_CDS:this._SKILL_CDS,
        worldW:WORLD_W, worldH:WORLD_H,
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

    // 스킬 쿨다운
    for (const k in this._skillCds) if(this._skillCds[k]>0) this._skillCds[k]=Math.max(0,this._skillCds[k]-dt);

    // 플레이어 WASD 이동
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
      p.path=[]; p.pathIdx=0; // WASD 사용 시 클릭 경로 취소
    }

    // 클릭 경로 추종
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

    // 플레이어 자동공격 — 가장 가까운 몬스터에 화살 발사 (0.8초 쿨다운)
    p.atkCd=Math.max(0,(p.atkCd||0)-dt);
    if (!this._dying && p.atkCd<=0) {
      let tgt=null, nd=55; // 공격 범위 55 world units
      for (const m of this._monsters) {
        if(m.state==='die') continue;
        const d=Math.hypot(m.x-p.x,m.y-p.y);
        if(d<nd){nd=d;tgt=m;}
      }
      if (tgt) {
        const adx=tgt.x-p.x, ady=tgt.y-p.y, al=Math.hypot(adx,ady)||1;
        const spd=140;
        this._projs.push({
          x:p.x, y:p.y,
          vx:adx/al*spd, vy:ady/al*spd,
          ttl:al/spd+0.6,
          dmg:p.atk, atk:p.atk,
          color:'#fde68a', src:'player', isArrow:true,
        });
        p.atkCd=0.75;
        p.animState='atk';
        p.facing=adx>0?1:-1;
        this._sfx('hit');
      }
    }

    // 카메라 부드럽게 추종
    this._cam.x+=(p.x-this._cam.x)*Math.min(1,dt*6);
    this._cam.y+=(p.y-this._cam.y)*Math.min(1,dt*6);

    // 몬스터 AI (스태거 업데이트)
    this._pathStagger=(this._pathStagger+1)%Math.max(1,this._monsters.length);
    for (let i=0;i<this._monsters.length;i++) {
      const m=this._monsters[i];
      if (m.state==='die') { this._updateDead(m,dt,now); continue; }
      const distToPlayer=Math.hypot(m.x-p.x,m.y-p.y);
      const tick=(distToPlayer>150)?1.0:(distToPlayer>100)?0.4:dt;
      if (i===this._pathStagger||tick===dt) this._updateMon(m,dt,p,now,distToPlayer);
    }

    // 발사체
    this._projs=this._projs.filter(pr=>{
      pr.x+=pr.vx*dt; pr.y+=pr.vy*dt; pr.ttl-=dt;
      if (pr.ttl<=0||!isWalkable(pr.x,pr.y)) return false;
      if (pr.src==='player') {
        for (const m of this._monsters) {
          if(m.state==='die') continue;
          if(Math.hypot(pr.x-m.x,pr.y-m.y)<m.def.sz+1){
            this._hitMon(m,pr.dmg); return false;
          }
        }
      } else {
        if(Math.hypot(pr.x-p.x,pr.y-p.y)<2.5){
          const red=Math.max(1,pr.atk-Math.floor(p.def*0.4));
          p.hp-=red; this._addFloat(`-${red}`,p.x,p.y-8,'#ff5555'); this._sfx('damage');
          return false;
        }
      }
      return true;
    });

    // 드롭 픽업
    this._drops=this._drops.filter(d=>{
      if(Math.hypot(d.x-p.x,d.y-p.y)<4){
        if(d.skillId){
          this._skills[d.skillId]=(this._skills[d.skillId]||0)+1;
          this._addFloat(`${d.emoji}+1`,p.x,p.y-10,'#e879f9');
          this._updateSkillUI();
        } else if(d.hp){
          const h=Math.min(d.hp,p.maxHp-p.hp); p.hp+=h;
          this._addFloat(`+${h}❤️`,p.x,p.y-10,'#4ade80');
        } else if(d.mp){
          const r=Math.min(d.mp,p.maxMp-p.mp); p.mp+=r;
          this._addFloat(`+${r}💙`,p.x,p.y-10,'#60a5fa');
        } else if(d.coins){
          p.coins+=d.coins; this._opts.onAddGold(d.coins);
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
        if (Math.random()<0.002) { // 랜덤 패트롤
          const rnd=m.def.sz*10;
          m.path=findPath(m.x,m.y, m.homeX+(Math.random()-.5)*rnd, m.homeY+(Math.random()-.5)*rnd)||[];
          m.pathIdx=0; m.state='patrol';
        }
      }
    }

    if (m.state==='chase'||m.state==='patrol') {
      if (m.state==='chase'&&dist>def.detect*2) {
        m.state='return';
        m.path=findPath(m.x,m.y,m.homeX,m.homeY)||[];
        m.pathIdx=0;
      } else if (m.state==='chase'&&dist<def.atk_range) {
        m.state='attack';
      } else {
        // 경로 갱신 (chase: 1초마다, patrol: 5초마다)
        const interval=m.state==='chase'?0.8:3;
        if (m.pathTimer<=0) {
          const tx=m.state==='chase'?p.x:m.homeX+(Math.random()-.5)*20;
          const ty=m.state==='chase'?p.y:m.homeY+(Math.random()-.5)*20;
          m.path=findPath(m.x,m.y,tx,ty)||[];
          m.pathIdx=0; m.pathTimer=interval;
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
        this._addFloat(`-${dmg}`,p.x,p.y-8,'#ff5555'); this._sfx('damage');
      }
    }

    if (m.state==='return') {
      this._followPath(m,dt,12);
      if (Math.hypot(m.x-m.homeX,m.y-m.homeY)<3) { m.state='idle'; m.path=[]; }
    }

    // 애니메이션
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
    if (!m.respawnAt) m.respawnAt=now+12000;
    if (now>m.respawnAt) {
      // 리스폰
      m.hp=m.def.maxHp; m.state='idle'; m.frame=0; m.frameTimer=0;
      m.x=m.homeX+(Math.random()-.5)*8; m.y=m.homeY+(Math.random()-.5)*8;
      // 유효한 위치로 보정
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
    const res=tryMove(m.x,m.y,(wp.x-m.x)/d*s,(wp.y-m.y)/d*s,m.def.sz*0.5);
    m.x=res.x; m.y=res.y;
    m.facing=wp.x>m.x?1:-1;
  }

  _aggroNearby(triggerMon, p) {
    const R=15;
    for (const m of this._monsters) {
      if (m.state==='die'||m===triggerMon) continue;
      if (Math.hypot(m.x-triggerMon.x,m.y-triggerMon.y)<R) {
        m.state='chase';
        m.path=findPath(m.x,m.y,p.x,p.y)||[];
        m.pathIdx=0;
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
      m.path=findPath(m.x,m.y,this._p.x,this._p.y)||[];
      m.pathIdx=0;
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
    if (Math.random()<0.25) {
      const skills=['fire','ice','bolt','meteor','wind'];
      const emojis=['🔥','❄️','⚡','☄️','🌪️'];
      const idx=Math.floor(Math.random()*skills.length);
      this._drops.push({x:m.x+(Math.random()-.5)*6,y:m.y+(Math.random()-.5)*6,
        skillId:skills[idx],emoji:emojis[idx]});
    }
    if (Math.random()<0.2) this._drops.push({x:m.x+(Math.random()-.5)*6,y:m.y+(Math.random()-.5)*6,hp:Math.round(this._p.maxHp*0.12)});
    if (Math.random()<0.15) this._drops.push({x:m.x+(Math.random()-.5)*6,y:m.y+(Math.random()-.5)*6,mp:Math.round(this._p.maxMp*0.12)});
    this._effects.push({type:'kill',x:m.x,y:m.y,r:m.def.sz*3,at:Date.now(),dur:400,color:'#fbbf24'});
  }

  // ── 스킬 ─────────────────────────────────────────────────────────────────
  _useSkill(id) {
    if (!this._running||!this._p) return;
    if (!(this._skills[id]>0)){this._toast(`${id} 스킬 없음`);return;}
    if ((this._skillCds[id]||0)>0){this._toast('쿨다운 중');return;}
    const p=this._p, s=this._SKILL_CDS[id], now=Date.now();
    this._skills[id]--; this._skillCds[id]=s; this._sfx('skill');
    const range=30;
    if (id==='fire') {
      this._effects.push({type:'fire',x:p.x,y:p.y,r:range,at:now,dur:700,color:'#f97316'});
      for (const m of this._monsters) { if(m.state==='die') continue; if(Math.hypot(m.x-p.x,m.y-p.y)<range){this._hitMon(m,80);} }
    } else if (id==='ice') {
      this._effects.push({type:'ice',x:p.x,y:p.y,r:range*1.2,at:now,dur:700,color:'#38bdf8'});
      for (const m of this._monsters) { if(m.state==='die') continue; if(Math.hypot(m.x-p.x,m.y-p.y)<range*1.2){this._hitMon(m,40);m.state='patrol';m.path=[];} }
    } else if (id==='bolt') {
      let src={x:p.x,y:p.y}; const used=new Set(),segs=[];
      for (let c=0;c<5;c++){let best=null,bd=40;for(const m of this._monsters){if(m.state==='die'||used.has(m.id))continue;const d=Math.hypot(m.x-src.x,m.y-src.y);if(d<bd){bd=d;best=m;}}if(!best)break;used.add(best.id);segs.push({from:{...src},to:{x:best.x,y:best.y}});this._hitMon(best,110);src={x:best.x,y:best.y};}
      if(segs.length)this._effects.push({type:'bolt',segs,at:now,dur:500,color:'#facc15'});
    } else if (id==='meteor') {
      const tx=p.x,ty=p.y;
      this._effects.push({type:'meteor_warn',x:tx,y:ty,r:22,at:now,dur:800,color:'#fb923c'});
      setTimeout(()=>{if(!this._running)return;this._effects.push({type:'meteor_hit',x:tx,y:ty,r:22,at:Date.now(),dur:400,color:'#ef4444'});for(const m of this._monsters){if(m.state==='die')continue;if(Math.hypot(m.x-tx,m.y-ty)<22)this._hitMon(m,200);}},800);
    } else if (id==='wind') {
      this._effects.push({type:'wind',x:p.x,y:p.y,r:18,at:now,dur:5000,color:'#a78bfa'});
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
    const EMOJIS={fire:'🔥',ice:'❄️',bolt:'⚡',meteor:'☄️',wind:'🌪️'};
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
  _toast(msg){const el=document.getElementById('dgToast');if(!el)return;el.textContent=msg;el.classList.remove('hidden');clearTimeout(this._toastTmr);this._toastTmr=setTimeout(()=>el?.classList.add('hidden'),2400);}

  // ── 사운드 시스템 (Web Audio API) ──────────────────────────────────────
  _ac(){
    if(!this._audio){try{this._audio=new(window.AudioContext||window.webkitAudioContext)();}catch{}}
    if(this._audio?.state==='suspended') this._audio.resume();
    return this._audio;
  }
  _tone(freq,type,dur,vol=0.18,sweep=0){
    const a=this._ac(); if(!a) return;
    try{
      const o=a.createOscillator(), g=a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type=type; g.gain.setValueAtTime(vol,a.currentTime);
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
      const src=a.createBufferSource(), g=a.createGain();
      src.buffer=buf; g.gain.value=vol;
      src.connect(g); g.connect(a.destination); src.start();
    }catch{}
  }
  _sfx(type){
    switch(type){
      case 'hit':     this._noise(0.09,0.14); break;
      case 'kill':    this._tone(523,'sine',.1,.22); setTimeout(()=>this._tone(784,'sine',.15,.22),90); break;
      case 'skill':   this._tone(880,'sine',.12,.2); break;
      case 'damage':  this._noise(0.12,0.18); this._tone(120,'sawtooth',.15,.12); break;
      case 'death':   [220,160,100].forEach((f,i)=>setTimeout(()=>this._tone(f,'sawtooth',.35,.2),i*150)); break;
      case 'walk':    this._tone(200,'sine',.04,.04); break;
      case 'potion':  this._tone(660,'sine',.08,.15); this._tone(880,'sine',.12,.12); break;
      case 'step':    this._tone(80+Math.random()*40,'sine',.06,.05); break;
    }
  }
  _startAmbient(){
    const a=this._ac(); if(!a||this._ambNodes) return;
    try{
      const o=a.createOscillator(), g=a.createGain(), lfo=a.createOscillator(), lg=a.createGain();
      o.type='sawtooth'; o.frequency.value=48; g.gain.value=0.025;
      lfo.frequency.value=0.18; lg.gain.value=0.01;
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
    const scale=this._canvas.width/120; // VIEWPORT=120
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
      // Debug: F1-F4
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
      n--; if(txt) txt.textContent=n>0?`${n}초 후 퇴장`:'퇴장 중...';
      if(n<=0){clearInterval(iv);this._showResult(false);}
    },1000);
  }

  _showResult(cleared) {
    this._stop();
    const p=this._p;
    const ov=document.getElementById('dgDeathOv'); if(ov)ov.classList.add('hidden');
    document.getElementById('dgResIcon').textContent=cleared?'🏆':'💀';
    document.getElementById('dgResTitle').textContent=cleared?'던전 클리어!':'전멸!';
    document.getElementById('dgResTitle').style.color=cleared?'#22c55e':'#f87171';
    document.getElementById('dgResStats').innerHTML=`
      <div class="dg-stat-row"><span class="k">처치 수</span><span class="v">${p.kills}마리</span></div>
      <div class="dg-stat-row"><span class="k">획득 코인</span><span class="v">${p.coins}💰</span></div>
      <div class="dg-stat-row"><span class="k">획득 XP</span><span class="v">${p.xp}XP</span></div>`;
    this._updateEntryUI();
    this._show('dgResult');
  }
}
