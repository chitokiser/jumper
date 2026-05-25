// assets/js/pages/merchants.dungeon.js
// Dungeon Survival Mini-Game — Stage 1~20 difficulty + 5 skill items
'use strict';

const D_ENTRY        = 100;
const D_WORLD_R      = 1000;
const D_FREE_PER_DAY = 3;
const D_FREE_KEY     = 'dg_free_tickets';
const D_MAX_STAGE    = 20;

// ── Stage scaling helpers ─────────────────────────────────────────────────────
function stageStatMult(stage)     { return 0.25 + stage * 0.09; }         // 1→0.34 10→1.15 20→2.05
function stageCountPerType(stage) { return Math.min(6, Math.max(1, Math.round(stage / 2))); }
function stageRespawnMs(stage)    { return Math.max(5000, 20000 - (stage - 1) * 800); }
function stageKillsNeeded(stage)  { return 5 + stage * 3; }

function scaleDef(base, stage) {
  const m = stageStatMult(stage);
  return {
    ...base,
    maxHp:  Math.round(base.maxHp  * m),
    atk:    Math.max(1, Math.round(base.atk * m)),
    spd:    Math.round(base.spd    * (1 + (stage - 1) * 0.04)),
    coins:  Math.max(1, Math.round(base.coins * (1 + (stage - 1) * 0.1))),
    xp:     Math.round(base.xp    * (1 + (stage - 1) * 0.05)),
  };
}

// ── Monster base defs (minStage gates availability) ───────────────────────────
const D_MDEFS = [
  { id:'orc',    label:'Orc',    src:'/assets/images/slot/1.png',  minStage:1,  maxHp:240, atk:22, spd:75,  range:80,  ranged:false, xp:20, coins:4  },
  { id:'pirate', label:'Pirate', src:'/assets/images/slot/2.png',  minStage:1,  maxHp:180, atk:18, spd:92,  range:70,  ranged:false, xp:15, coins:3  },
  { id:'wolf',   label:'Wolf',   src:'/assets/images/slot/5.png',  minStage:1,  maxHp:160, atk:26, spd:115, range:75,  ranged:false, xp:25, coins:5  },
  { id:'cabi',   label:'CABI',   src:'/assets/images/slot/4.png',  minStage:4,  maxHp:400, atk:36, spd:62,  range:150, ranged:true,  xp:50, coins:12 },
  { id:'eye',    label:'Eye',    src:'/assets/images/slot/10.png', minStage:7,  maxHp:300, atk:30, spd:62,  range:140, ranged:true,  xp:35, coins:8  },
  { id:'dragon', label:'Dragon', src:'/assets/images/slot/9.png',  minStage:10, maxHp:600, atk:58, spd:52,  range:170, ranged:true,  xp:80, coins:16 },
];

// ── 5 Skill items ─────────────────────────────────────────────────────────────
const D_SKILLS = [
  { id:'fire',   emoji:'🔥', label:'Fire',      key:'Q', color:'#f97316' },
  { id:'ice',    emoji:'❄️', label:'Ice',       key:'W', color:'#38bdf8' },
  { id:'bolt',   emoji:'⚡', label:'Lightning', key:'E', color:'#facc15' },
  { id:'meteor', emoji:'☄️', label:'Meteor',    key:'R', color:'#fb923c' },
  { id:'wind',   emoji:'🌪️', label:'Whirlwind', key:'T', color:'#a78bfa' },
];

const D_TOWER_DEF = {
  cannon: { emoji:'💣', range:200, atk:20, rate:0.22, pColor:'#ef4444', aoe:0,  rad:18 },
  archer: { emoji:'🏹', range:280, atk:28, rate:2.5,  pColor:'#fbbf24', aoe:0,  rad:14 },
};

const D_TOWER_SLOTS = (() => {
  const s = [];
  for (let i = 0; i < 8;  i++) { const a=(i/8)*Math.PI*2;  s.push({ x:Math.cos(a)*400, y:Math.sin(a)*400, kind:'cannon' }); }
  for (let i = 0; i < 12; i++) { const a=(i/12)*Math.PI*2; s.push({ x:Math.cos(a)*700, y:Math.sin(a)*700, kind:'archer' }); }
  return s;
})();

let _instance = null;
export function initDungeonGame(opts) { _instance = new DungeonGame(opts); }
export function openDungeonGame()     { _instance?.open(); }

// ─── Game class ────────────────────────────────────────────────────────────────
class DungeonGame {
  constructor({ onSpendGold, onAddGold, onPlaySound }) {
    this._spend = onSpendGold;
    this._add   = onAddGold;
    this._snd   = onPlaySound;
    this._imgs  = {};
    this._audio = null;
    this._ambNodes = null;
    this._running  = false;
    this._raf      = null;
    this._lastTs   = 0;
    this._keyHandler = null;
    D_MDEFS.forEach(d => { const img=new Image(); img.src=d.src; this._imgs[d.id]=img; });
    this._buildDOM();
  }

  // ── Free ticket helpers ───────────────────────────────────────────────────────
  _todayStr() { return new Date().toISOString().slice(0,10); }

  _loadFreeData() {
    try {
      const raw = localStorage.getItem(D_FREE_KEY);
      if (raw) { const obj=JSON.parse(raw); if (obj.date===this._todayStr()) return obj; }
    } catch {}
    return { date: this._todayStr(), used: 0 };
  }

  _getFreeLeft() { return Math.max(0, D_FREE_PER_DAY - this._loadFreeData().used); }

  _useFreeTicket() {
    const obj=this._loadFreeData();
    obj.used=Math.min(D_FREE_PER_DAY, obj.used+1);
    localStorage.setItem(D_FREE_KEY, JSON.stringify(obj));
  }

  _updateTicketUI() {
    const left=this._getFreeLeft();
    const badge=document.getElementById('dgTicketBadge');
    const freeBtn=document.getElementById('dgFreeEnterBtn');
    const freeRespBtn=document.getElementById('dgFreeRespawnBtn');
    if (badge) {
      badge.textContent=`🎟️ ${left}/${D_FREE_PER_DAY} Free Today`;
      badge.className='dg-ticket-badge'+(left>0?' dg-ticket-avail':' dg-ticket-empty');
    }
    if (freeBtn)     { freeBtn.textContent=`🎟️ Free Entry (${left} left)`; freeBtn.classList.toggle('hidden',left===0); }
    if (freeRespBtn) { freeRespBtn.textContent=`🎟️ Free Re-enter (${left} left)`; freeRespBtn.classList.toggle('hidden',left===0); }
  }

  // ── DOM ──────────────────────────────────────────────────────────────────────
  _buildDOM() {
    if (document.getElementById('dungeonModal')) {
      this._modal  = document.getElementById('dungeonModal');
      this._canvas = document.getElementById('dgCanvas');
      this._ctx    = this._canvas.getContext('2d');
      return;
    }
    const skillBarHtml = D_SKILLS.map(sk => `
      <button class="dg-skill-btn" id="dgSkBtn_${sk.id}" title="${sk.label} (${sk.key})">
        <span class="dg-skill-icon">${sk.emoji}</span>
        <span class="dg-skill-count" id="dgSkCnt_${sk.id}">0</span>
        <span class="dg-skill-key">${sk.key}</span>
      </button>`).join('');

    const m = document.createElement('div');
    m.id = 'dungeonModal';
    m.className = 'dg-modal hidden';
    m.innerHTML = `
      <div class="dg-overlay"></div>
      <div class="dg-panel">
        <div class="dg-screen" id="dgEntry">
          <div style="font-size:56px;margin-bottom:8px">🏰</div>
          <div class="dg-entry-title">Dungeon Survival</div>
          <div class="dg-entry-desc">100 💰 entry fee · Stage 1–20<br>Skills drop from monsters (Q/W/E/R/T)<br>Click to move · Click monster to attack</div>
          <div class="dg-ticket-badge" id="dgTicketBadge">🎟️ 3/3 Free Today</div>
          <button class="dg-btn-free"  id="dgFreeEnterBtn">🎟️ Free Entry (3 left)</button>
          <button class="dg-btn-gold"  id="dgEnterBtn">⚔️ Enter Dungeon (100 💰)</button>
          <button class="dg-btn-ghost" id="dgEntryClose">Cancel</button>
        </div>
        <div class="dg-screen hidden" id="dgGame" style="padding:0;overflow:hidden;display:flex;flex-direction:column">
          <div class="dg-hud" id="dgHud">
            <div class="dg-hud-l">
              <span style="font-size:13px">❤️</span>
              <div class="dg-hp-bg"><div class="dg-hp-fill" id="dgHpFill"></div></div>
              <span class="dg-hud-txt" id="dgHpTxt">200</span>
            </div>
            <div class="dg-hud-c">
              <span class="dg-stage-badge" id="dgStageBadge">Stage 1</span>
              <span class="dg-stage-prog"  id="dgStageProg">0 / 8 kills</span>
            </div>
            <div class="dg-hud-r">
              <span class="dg-hud-txt" id="dgCoins">💰 0</span>
              <span class="dg-hud-txt" id="dgKills">⚔️ 0</span>
              <button class="dg-x-btn" id="dgExitBtn">✕</button>
            </div>
          </div>
          <canvas id="dgCanvas" class="dg-canvas" style="flex:1;display:block"></canvas>
          <div class="dg-skill-bar" id="dgSkillBar">${skillBarHtml}</div>
          <div class="dg-toast hidden" id="dgToast"></div>
        </div>
        <div class="dg-screen hidden" id="dgDeath">
          <div style="font-size:56px;margin-bottom:8px">💀</div>
          <div class="dg-entry-title" style="color:#f87171">You Died</div>
          <div class="dg-death-stats" id="dgDeathStats"></div>
          <button class="dg-btn-free"  id="dgFreeRespawnBtn">🎟️ Free Re-enter (3 left)</button>
          <button class="dg-btn-gold"  id="dgRespawnBtn">🔄 Re-enter (100 💰)</button>
          <button class="dg-btn-ghost" id="dgLeaveBtn">Leave Dungeon</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    this._modal  = m;
    this._canvas = m.querySelector('#dgCanvas');
    this._ctx    = this._canvas.getContext('2d');
    this._bindUI();
  }

  _bindUI() {
    const $ = id => this._modal.querySelector('#' + id);
    $('dgFreeEnterBtn')  ?.addEventListener('click', () => this._startGame(true));
    $('dgEnterBtn')      ?.addEventListener('click', () => this._startGame(false));
    $('dgEntryClose')    ?.addEventListener('click', () => this.close());
    $('dgExitBtn')       ?.addEventListener('click', () => this._confirmExit());
    $('dgFreeRespawnBtn')?.addEventListener('click', () => this._tryRespawn(true));
    $('dgRespawnBtn')    ?.addEventListener('click', () => this._tryRespawn(false));
    $('dgLeaveBtn')      ?.addEventListener('click', () => this.close());
    this._canvas.addEventListener('click',    e => this._onCanvasClick(e));
    this._canvas.addEventListener('touchend', e => {
      e.preventDefault();
      if (e.changedTouches[0]) this._onCanvasClick(e.changedTouches[0]);
    }, { passive:false });
    D_SKILLS.forEach(sk => {
      $(`dgSkBtn_${sk.id}`)?.addEventListener('click', () => this._useSkill(sk.id));
    });
  }

  // ── Screens ──────────────────────────────────────────────────────────────────
  open()  { this._modal.classList.remove('hidden'); this._show('dgEntry'); this._updateTicketUI(); }
  close() { this._stop(); this._modal.classList.add('hidden'); }

  _show(id) {
    ['dgEntry','dgGame','dgDeath'].forEach(s =>
      this._modal.querySelector('#'+s)?.classList.toggle('hidden', s!==id));
  }

  // ── Audio ─────────────────────────────────────────────────────────────────────
  _initAudio() {
    try {
      if (!this._audio) this._audio = new AudioContext();
      if (this._audio.state==='suspended') this._audio.resume();
      this._startAmbient();
    } catch {}
  }

  _startAmbient() {
    if (!this._audio||this._ambNodes) return;
    const ctx=this._audio;
    const osc=ctx.createOscillator(); osc.type='sawtooth'; osc.frequency.value=55;
    const gain=ctx.createGain(); gain.gain.value=0.035;
    const lfo=ctx.createOscillator(); lfo.frequency.value=0.25;
    const lfoG=ctx.createGain(); lfoG.gain.value=0.015;
    const bpf=ctx.createBiquadFilter(); bpf.type='bandpass'; bpf.frequency.value=90; bpf.Q.value=0.8;
    lfo.connect(lfoG); lfoG.connect(gain.gain);
    osc.connect(bpf); bpf.connect(gain); gain.connect(ctx.destination);
    lfo.start(); osc.start();
    this._ambNodes={osc,lfo,gain};
  }

  _stopAmbient() {
    if (!this._ambNodes) return;
    try { this._ambNodes.osc.stop(); this._ambNodes.lfo.stop(); } catch {}
    this._ambNodes=null;
  }

  _sfx(type) {
    if (!this._audio) return;
    const ctx=this._audio, sr=ctx.sampleRate;
    const dur=type==='death'?0.4:0.12;
    const buf=ctx.createBuffer(1,Math.ceil(sr*dur),sr);
    const ch=buf.getChannelData(0);
    if (type==='hit')        for (let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.exp(-i/sr*30);
    else if (type==='kill')  for (let i=0;i<ch.length;i++) ch[i]=Math.sin(i*440/sr*Math.PI*2)*Math.exp(-i/sr*18);
    else if (type==='skill') for (let i=0;i<ch.length;i++) ch[i]=Math.sin(i*880/sr*Math.PI*2)*Math.exp(-i/sr*12);
    else                     for (let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.exp(-i/sr*6);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const g=ctx.createGain(); g.gain.value=0.25;
    src.connect(g); g.connect(ctx.destination); src.start();
  }

  // ── Game lifecycle ────────────────────────────────────────────────────────────
  _startGame(isFree=false) {
    if (isFree) {
      if (this._getFreeLeft()<=0) { this._toast('No free tickets left today'); return; }
      this._useFreeTicket();
    } else {
      if (!this._spend(D_ENTRY)) { this._toast('Not enough coins (100 required)'); return; }
    }
    this._initState();
    this._initAudio();
    this._show('dgGame');
    this._resizeCanvas();
    this._registerKeyboard();
    this._run();
  }

  _initState() {
    this._stage      = 1;
    this._stageKills = 0;
    this._skills     = { fire:0, ice:0, bolt:0, meteor:0, wind:0 };
    this._skillCds   = { fire:0, ice:0, bolt:0, meteor:0, wind:0 };
    this._activeEffects = [];  // [{type, x, y, r, startAt, dur, color, stage}]
    this._burnMap    = new Map();  // monsterId → {dps, endAt}
    this._freezeSet  = new Set();  // frozen monster ids
    this._windActive = false;
    this._windEndAt  = 0;

    this._p = {
      x:0, y:0, hp:200, maxHp:200,
      atk:25, atkRange:85, atkRate:1.2, atkCd:0,
      tx:0, ty:0, moving:false, targeting:null,
      coins:0, kills:0, xp:0,
    };
    this._monsters   = [];
    this._queues     = {};
    this._towers     = D_TOWER_SLOTS.map(s => ({ x:s.x, y:s.y, kind:s.kind, atkCd:0, ...D_TOWER_DEF[s.kind] }));
    this._projs      = [];
    this._drops      = [];
    this._floats     = [];
    this._cam        = { x:0, y:0 };
    this._running    = true;

    this._spawnStageMonsters(1);
    this._updateSkillBar();
    this._updateStageUI();
  }

  _spawnStageMonsters(stage) {
    const count   = stageCountPerType(stage);
    const avail   = D_MDEFS.filter(d => d.minStage <= stage);
    for (const base of avail) {
      const def = scaleDef(base, stage);
      for (let i=0; i<count; i++) this._spawnMonster(base, def, 0);
    }
  }

  _resizeCanvas() {
    const gameEl=this._modal.querySelector('#dgGame');
    const hudEl=this._modal.querySelector('#dgHud');
    const barEl=this._modal.querySelector('#dgSkillBar');
    if (!gameEl) return;
    const r=gameEl.getBoundingClientRect();
    const hudH=hudEl?hudEl.getBoundingClientRect().height:48;
    const barH=barEl?barEl.getBoundingClientRect().height:56;
    this._canvas.width  = Math.max(300, Math.floor(r.width));
    this._canvas.height = Math.max(200, Math.floor(r.height - hudH - barH));
  }

  _registerKeyboard() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    const map = { q:'fire', w:'ice', e:'bolt', r:'meteor', t:'wind' };
    this._keyHandler = e => {
      if (!this._running) return;
      const sk = map[e.key.toLowerCase()];
      if (sk) { e.preventDefault(); this._useSkill(sk); }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  _run() {
    if (!this._running) return;
    this._lastTs = performance.now();
    const loop = ts => {
      if (!this._running) return;
      const dt = Math.min((ts - this._lastTs)/1000, 0.1);
      this._lastTs = ts;
      this._update(dt);
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stop() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf=null; }
    this._stopAmbient();
    if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler=null; }
  }

  // ── Stage progression ─────────────────────────────────────────────────────────
  _checkStageUp() {
    if (this._stage >= D_MAX_STAGE) return;
    if (this._stageKills >= stageKillsNeeded(this._stage)) {
      this._stage++;
      this._stageKills = 0;
      this._toast(`⬆️ Stage ${this._stage}!`);
      this._sfx('skill');
      // Spawn newly unlocked monster types for this stage
      const prevAvail = D_MDEFS.filter(d => d.minStage <= this._stage-1).map(d => d.id);
      const newTypes  = D_MDEFS.filter(d => d.minStage === this._stage);
      const count     = stageCountPerType(this._stage);
      for (const base of newTypes) {
        const def = scaleDef(base, this._stage);
        for (let i=0; i<count; i++) this._spawnMonster(base, def, 0);
      }
      this._updateStageUI();
    }
  }

  _updateStageUI() {
    const badge=document.getElementById('dgStageBadge');
    const prog =document.getElementById('dgStageProg');
    if (badge) badge.textContent=`Stage ${this._stage}`;
    if (prog)  prog.textContent=`${this._stageKills} / ${stageKillsNeeded(this._stage)} kills`;
  }

  // ── Monster management ───────────────────────────────────────────────────────
  _spawnMonster(base, scaledDef, delay=0) {
    if (delay > 0) {
      if (!this._queues[base.id]) this._queues[base.id]=[];
      this._queues[base.id].push({ base, at:Date.now()+delay });
      return;
    }
    const a=Math.random()*Math.PI*2;
    const r=250+Math.random()*(D_WORLD_R*0.7);
    const def = scaledDef ?? scaleDef(base, this._stage);
    this._monsters.push({
      base, def,
      id:Math.random().toString(36).slice(2),
      x:Math.cos(a)*r, y:Math.sin(a)*r,
      hp:def.maxHp, atkCd:0, state:'alive',
    });
  }

  _killMonster(m) {
    if (m.state!=='alive') return;
    m.state='dead'; m.hp=0;
    this._p.kills++;
    this._p.xp += m.def.xp;
    this._stageKills++;
    this._burnMap.delete(m.id);
    this._freezeSet.delete(m.id);
    this._drops.push({ x:m.x+(Math.random()-.5)*30, y:m.y+(Math.random()-.5)*30, coins:m.def.coins });
    this._addFloat(`+${m.def.coins}💰`, m.x, m.y-25, '#4ade80');
    this._addFloat(`+${m.def.xp}XP`,   m.x, m.y-45, '#a78bfa');
    this._sfx('kill');

    // 20% skill drop
    if (Math.random() < 0.20) {
      const sk=D_SKILLS[Math.floor(Math.random()*D_SKILLS.length)];
      this._drops.push({ x:m.x+(Math.random()-.5)*40, y:m.y+(Math.random()-.5)*40, skillId:sk.id });
      this._addFloat(sk.emoji, m.x, m.y-65, '#e879f9');
    }
    // 20% potion drop
    if (Math.random() < 0.20) {
      const heal=Math.round(15+this._stage*2);
      this._drops.push({ x:m.x+(Math.random()-.5)*40, y:m.y+(Math.random()-.5)*40, potion:true, heal });
      this._addFloat('🧪', m.x, m.y-55, '#f87171');
    }

    const respawnMs=stageRespawnMs(this._stage);
    this._spawnMonster(m.base, null, respawnMs);
    this._checkStageUp();
    this._updateStageUI();
  }

  // ── Skill system ──────────────────────────────────────────────────────────────
  _useSkill(id) {
    if (!this._running) return;
    if ((this._skills[id]||0) <= 0) { this._toast(`No ${id} skill`); return; }
    if ((this._skillCds[id]||0) > 0) { this._toast(`Skill on cooldown`); return; }

    this._skills[id]--;
    const s=this._stage, p=this._p;
    const now=Date.now();

    if (id==='fire') {
      const r=250, dmg=80+s*12, dps=15+s*2;
      this._activeEffects.push({ type:'fire', x:p.x, y:p.y, r, startAt:now, dur:800, color:'#f97316', stage:s });
      for (const m of this._monsters) {
        if (m.state!=='alive') continue;
        if (Math.hypot(m.x-p.x,m.y-p.y)<=r) {
          m.hp-=dmg;
          this._addFloat(`-${dmg}🔥`,m.x,m.y-20,'#f97316');
          this._burnMap.set(m.id,{dps,endAt:now+3000});
          if (m.hp<=0) this._killMonster(m);
        }
      }
      this._skillCds[id]=8;
    }
    else if (id==='ice') {
      const r=320, dmg=40+s*8;
      this._activeEffects.push({ type:'ice', x:p.x, y:p.y, r, startAt:now, dur:800, color:'#38bdf8', stage:s });
      for (const m of this._monsters) {
        if (m.state!=='alive') continue;
        if (Math.hypot(m.x-p.x,m.y-p.y)<=r) {
          m.hp-=dmg;
          this._addFloat(`-${dmg}❄️`,m.x,m.y-20,'#38bdf8');
          this._freezeSet.add(m.id);
          setTimeout(()=>this._freezeSet.delete(m.id), 3000);
          if (m.hp<=0) this._killMonster(m);
        }
      }
      this._skillCds[id]=10;
    }
    else if (id==='bolt') {
      const chainR=220, dmg=100+s*18;
      let targets=[], src={ x:p.x, y:p.y };
      const used=new Set();
      for (let c=0;c<5;c++) {
        let best=null, bestD=chainR;
        for (const m of this._monsters) {
          if (m.state!=='alive'||used.has(m.id)) continue;
          const d=Math.hypot(m.x-src.x,m.y-src.y);
          if (d<bestD) { bestD=d; best=m; }
        }
        if (!best) break;
        used.add(best.id);
        targets.push({ from:{...src}, to:{x:best.x,y:best.y} });
        best.hp-=dmg;
        this._addFloat(`-${dmg}⚡`,best.x,best.y-20,'#facc15');
        if (best.hp<=0) this._killMonster(best);
        src={x:best.x,y:best.y};
      }
      this._activeEffects.push({ type:'bolt', targets, startAt:now, dur:500, color:'#facc15', stage:s });
      this._skillCds[id]=7;
    }
    else if (id==='meteor') {
      const tx=p.x, ty=p.y, warningR=200, dmg=200+s*25;
      this._activeEffects.push({ type:'meteor_warn', x:tx, y:ty, r:warningR, startAt:now, dur:800, color:'#fb923c', stage:s });
      setTimeout(()=>{
        if (!this._running) return;
        this._activeEffects.push({ type:'meteor_hit', x:tx, y:ty, r:warningR, startAt:Date.now(), dur:400, color:'#ef4444', stage:s });
        for (const m of this._monsters) {
          if (m.state!=='alive') continue;
          if (Math.hypot(m.x-tx,m.y-ty)<=warningR) {
            m.hp-=dmg;
            this._addFloat(`-${dmg}☄️`,m.x,m.y-20,'#fb923c');
            if (m.hp<=0) this._killMonster(m);
          }
        }
        this._sfx('skill');
      }, 800);
      this._skillCds[id]=15;
    }
    else if (id==='wind') {
      this._windActive=true;
      this._windEndAt=now+5000;
      this._activeEffects.push({ type:'wind', x:p.x, y:p.y, r:160, startAt:now, dur:5000, color:'#a78bfa', stage:s });
      this._skillCds[id]=20;
    }

    this._sfx('skill');
    this._updateSkillBar();
  }

  _updateSkillBar() {
    D_SKILLS.forEach(sk => {
      const cnt=document.getElementById(`dgSkCnt_${sk.id}`);
      const btn=document.getElementById(`dgSkBtn_${sk.id}`);
      const count=this._skills[sk.id]||0;
      const cd=this._skillCds[sk.id]||0;
      if (cnt) cnt.textContent=count;
      if (btn) {
        btn.style.opacity=count>0&&cd<=0?'1':'0.45';
        btn.style.borderColor=count>0?sk.color:'#374151';
      }
    });
  }

  // ── Update ────────────────────────────────────────────────────────────────────
  _update(dt) {
    const p=this._p;
    const now=Date.now();

    // Skill cooldowns
    for (const id of Object.keys(this._skillCds)) {
      if (this._skillCds[id]>0) this._skillCds[id]=Math.max(0,this._skillCds[id]-dt);
    }

    // Respawn queues
    for (const id in this._queues) {
      this._queues[id]=this._queues[id].filter(q => {
        if (now>=q.at) { this._spawnMonster(q.base, null, 0); return false; }
        return true;
      });
    }

    // Whirlwind tick
    if (this._windActive) {
      if (now>=this._windEndAt) { this._windActive=false; }
      else {
        const dps=25+this._stage*6;
        for (const m of this._monsters) {
          if (m.state!=='alive') continue;
          if (Math.hypot(m.x-p.x,m.y-p.y)<=160) {
            const dmg=dps*dt;
            m.hp-=dmg;
            if (m.hp<=0) this._killMonster(m);
          }
        }
        // Update wind effect position
        for (const ef of this._activeEffects) {
          if (ef.type==='wind') { ef.x=p.x; ef.y=p.y; }
        }
      }
    }

    // Burn DoT
    for (const [mid, burn] of this._burnMap) {
      if (now>=burn.endAt) { this._burnMap.delete(mid); continue; }
      const m=this._monsters.find(x=>x.id===mid&&x.state==='alive');
      if (!m) { this._burnMap.delete(mid); continue; }
      const dmg=burn.dps*dt;
      m.hp-=dmg;
      if (m.hp<=0) this._killMonster(m);
    }

    // Expire active effects
    this._activeEffects=this._activeEffects.filter(ef=>now-ef.startAt<ef.dur);

    // Player movement
    if (p.moving) {
      const dx=p.tx-p.x, dy=p.ty-p.y, d=Math.hypot(dx,dy);
      if (d<6) { p.moving=false; }
      else { const s=Math.min(180*dt,d); p.x+=dx/d*s; p.y+=dy/d*s; }
    }
    const pd=Math.hypot(p.x,p.y);
    if (pd>D_WORLD_R-22) { p.x=p.x/pd*(D_WORLD_R-22); p.y=p.y/pd*(D_WORLD_R-22); p.moving=false; }

    // Player auto-attack
    p.atkCd=Math.max(0,p.atkCd-dt);
    if (p.atkCd===0) {
      let tgt=p.targeting;
      if (!tgt||tgt.state!=='alive') {
        tgt=null; let minD=p.atkRange;
        for (const m of this._monsters) {
          if (m.state!=='alive') continue;
          const d=Math.hypot(m.x-p.x,m.y-p.y);
          if (d<minD) { minD=d; tgt=m; }
        }
        p.targeting=tgt;
      }
      if (tgt) {
        const d=Math.hypot(tgt.x-p.x,tgt.y-p.y);
        if (d<=p.atkRange) {
          p.moving=false;
          tgt.hp-=p.atk; this._addFloat(`-${p.atk}`,tgt.x,tgt.y-20,'#f87171'); this._sfx('hit');
          p.atkCd=1/p.atkRate;
          if (tgt.hp<=0) this._killMonster(tgt);
        } else { p.tx=tgt.x; p.ty=tgt.y; p.moving=true; }
      }
    }

    // Monster AI
    for (const m of this._monsters) {
      if (m.state!=='alive') continue;
      if (this._freezeSet.has(m.id)) continue; // frozen — skip
      m.atkCd=Math.max(0,m.atkCd-dt);
      const dx=p.x-m.x, dy=p.y-m.y, dist=Math.hypot(dx,dy);
      if (dist<=m.def.range) {
        if (m.atkCd===0) {
          if (m.def.ranged) {
            this._fireProj(m.x,m.y,p.x,p.y,{atk:m.def.atk,src:'mob',spd:240,color:'#f87171',r:7,aoe:0});
          } else {
            p.hp-=m.def.atk; this._addFloat(`-${m.def.atk}`,p.x,p.y-30,'#ff5555'); this._sfx('hit');
          }
          m.atkCd=1.1;
        }
      } else {
        const s=m.def.spd*dt; m.x+=dx/dist*s; m.y+=dy/dist*s;
      }
      const md=Math.hypot(m.x,m.y);
      if (md>D_WORLD_R-15) { m.x=m.x/md*(D_WORLD_R-15); m.y=m.y/md*(D_WORLD_R-15); }
    }

    // Tower attack
    for (const t of this._towers) {
      t.atkCd=Math.max(0,t.atkCd-dt);
      if (t.atkCd>0) continue;
      if (t.kind==='cannon') {
        const dp=Math.hypot(p.x-t.x,p.y-t.y);
        if (dp<=t.range) {
          this._fireProj(t.x,t.y,p.x,p.y,{atk:t.atk,src:'cannon',spd:200,color:t.pColor,r:9,aoe:0});
          t.atkCd=1/t.rate;
        }
      } else {
        let tgt=null, minD=t.range;
        for (const m of this._monsters) {
          if (m.state!=='alive') continue;
          const d=Math.hypot(m.x-t.x,m.y-t.y);
          if (d<minD) { minD=d; tgt=m; }
        }
        if (tgt) { this._fireProj(t.x,t.y,tgt.x,tgt.y,{atk:t.atk,src:'tower',spd:310,color:t.pColor,r:5,aoe:0}); t.atkCd=1/t.rate; }
      }
    }

    // Projectile update
    this._projs=this._projs.filter(proj => {
      proj.x+=proj.vx*dt; proj.y+=proj.vy*dt; proj.ttl-=dt;
      if (proj.ttl<=0) return false;
      if (proj.src==='mob' || proj.src==='cannon') {
        if (Math.hypot(proj.x-p.x,proj.y-p.y)<22) { p.hp-=proj.atk; this._addFloat(`-${proj.atk}`,p.x,p.y-30,'#ff5555'); this._sfx('hit'); return false; }
      } else {
        for (const m of this._monsters) {
          if (m.state!=='alive') continue;
          if (Math.hypot(proj.x-m.x,proj.y-m.y)<26) {
            if (proj.aoe>0) {
              for (const m2 of this._monsters) {
                if (m2.state!=='alive') continue;
                if (Math.hypot(proj.x-m2.x,proj.y-m2.y)<proj.aoe) { m2.hp-=proj.atk; this._addFloat(`-${proj.atk}`,m2.x,m2.y-15,'#f59e0b'); if (m2.hp<=0) this._killMonster(m2); }
              }
            } else { m.hp-=proj.atk; this._addFloat(`-${proj.atk}`,m.x,m.y-15,'#f59e0b'); if (m.hp<=0) this._killMonster(m); }
            return false;
          }
        }
      }
      return true;
    });

    // Drop pickup
    this._drops=this._drops.filter(drop => {
      if (Math.hypot(drop.x-p.x,drop.y-p.y)<38) {
        if (drop.skillId) {
          this._skills[drop.skillId]=(this._skills[drop.skillId]||0)+1;
          const sk=D_SKILLS.find(s=>s.id===drop.skillId);
          this._addFloat(`${sk?.emoji||'✨'}+1`,p.x,p.y-50,'#e879f9');
          this._toast(`${sk?.emoji} ${sk?.label} skill acquired! Press ${sk?.key}`);
          this._updateSkillBar();
        } else if (drop.potion) {
          const healed=Math.min(drop.heal,p.maxHp-p.hp);
          p.hp=Math.min(p.maxHp,p.hp+drop.heal);
          this._addFloat(`+${healed}❤️`,p.x,p.y-50,'#f87171');
          this._toast(`🧪 Potion! +${drop.heal} HP`);
        } else {
          p.coins+=drop.coins; this._add(drop.coins);
        }
        return false;
      }
      return true;
    });

    // Float drift
    this._floats=this._floats.filter(f => { f.life-=dt; f.wy-=45*dt; return f.life>0; });

    // Camera
    this._cam.x=p.x; this._cam.y=p.y;

    // HUD
    const hpPct=Math.max(0,p.hp/p.maxHp*100);
    const hpFill=document.getElementById('dgHpFill');
    const hpTxt =document.getElementById('dgHpTxt');
    const coinsEl=document.getElementById('dgCoins');
    const killsEl=document.getElementById('dgKills');
    const prog   =document.getElementById('dgStageProg');
    if (hpFill) hpFill.style.width=hpPct+'%';
    if (hpTxt)  hpTxt.textContent=`${Math.max(0,Math.floor(p.hp))}/${p.maxHp}`;
    if (coinsEl) coinsEl.textContent=`💰 ${p.coins}`;
    if (killsEl) killsEl.textContent=`⚔️ ${p.kills}`;
    if (prog)    prog.textContent=`${this._stageKills} / ${stageKillsNeeded(this._stage)} kills`;

    if (p.hp<=0 && this._running) { this._sfx('death'); this._stop(); this._showDeathScreen(); }
  }

  _fireProj(fx,fy,tx,ty,{atk,src,spd,color,r,aoe}) {
    const dx=tx-fx, dy=ty-fy, d=Math.hypot(dx,dy)||1;
    this._projs.push({x:fx,y:fy,vx:dx/d*spd,vy:dy/d*spd,atk,src,color,r,aoe,ttl:d/spd+0.6});
  }

  _addFloat(text,wx,wy,color) { this._floats.push({text,wx,wy,color,life:1.3}); }

  // ── Draw ──────────────────────────────────────────────────────────────────────
  _draw() {
    const cv=this._canvas, ctx=this._ctx;
    const W=cv.width, H=cv.height;
    const cx=W/2-this._cam.x, cy=H/2-this._cam.y;
    const now=Date.now();

    ctx.fillStyle='#0a0a14'; ctx.fillRect(0,0,W,H);

    // Grid
    ctx.strokeStyle='rgba(255,255,255,0.035)'; ctx.lineWidth=1;
    const gs=80;
    const gx0=Math.floor((this._cam.x-W/2)/gs)*gs;
    const gy0=Math.floor((this._cam.y-H/2)/gs)*gs;
    for (let gx=gx0; gx<this._cam.x+W/2+gs; gx+=gs) { const sx=gx+cx; ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,H); ctx.stroke(); }
    for (let gy=gy0; gy<this._cam.y+H/2+gs; gy+=gs) { const sy=gy+cy; ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(W,sy); ctx.stroke(); }

    // World boundary
    ctx.save(); ctx.strokeStyle='rgba(255,80,40,0.45)'; ctx.lineWidth=3; ctx.setLineDash([14,9]);
    ctx.beginPath(); ctx.arc(cx,cy,D_WORLD_R,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();

    // ── Active effects (behind monsters) ────────────────────────────────────────
    for (const ef of this._activeEffects) {
      const age=(now-ef.startAt)/ef.dur; // 0→1
      const alpha=Math.max(0,1-age);
      const esx=ef.x+cx, esy=ef.y+cy;

      if (ef.type==='fire'||ef.type==='ice') {
        ctx.save();
        ctx.globalAlpha=alpha*0.35;
        ctx.fillStyle=ef.color;
        ctx.beginPath(); ctx.arc(esx,esy,ef.r*(0.5+age*0.5),0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=ef.color; ctx.lineWidth=3; ctx.globalAlpha=alpha*0.8;
        ctx.beginPath(); ctx.arc(esx,esy,ef.r,0,Math.PI*2); ctx.stroke();
        ctx.restore();
      }
      else if (ef.type==='bolt') {
        ctx.save();
        ctx.strokeStyle=ef.color; ctx.lineWidth=3; ctx.globalAlpha=alpha;
        ctx.shadowColor=ef.color; ctx.shadowBlur=12;
        for (const seg of ef.targets) {
          ctx.beginPath();
          ctx.moveTo(seg.from.x+cx,seg.from.y+cy);
          ctx.lineTo(seg.to.x+cx,seg.to.y+cy);
          ctx.stroke();
        }
        ctx.restore();
      }
      else if (ef.type==='meteor_warn') {
        ctx.save();
        const pulse=Math.sin(age*Math.PI*6)*0.3+0.7;
        ctx.globalAlpha=0.5*pulse;
        ctx.strokeStyle='#fb923c'; ctx.lineWidth=2; ctx.setLineDash([8,6]);
        ctx.beginPath(); ctx.arc(esx,esy,ef.r,0,Math.PI*2); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }
      else if (ef.type==='meteor_hit') {
        ctx.save();
        ctx.globalAlpha=alpha*0.6;
        ctx.fillStyle='#ef4444';
        ctx.beginPath(); ctx.arc(esx,esy,ef.r*(1+age*0.5),0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
      else if (ef.type==='wind') {
        ctx.save();
        const spin=((now*0.004)%(Math.PI*2));
        ctx.globalAlpha=alpha*0.25;
        ctx.fillStyle='#a78bfa';
        ctx.beginPath(); ctx.arc(esx,esy,ef.r,0,Math.PI*2); ctx.fill();
        ctx.globalAlpha=alpha*0.7;
        ctx.strokeStyle='#a78bfa'; ctx.lineWidth=2;
        for (let wi=0;wi<6;wi++) {
          const wa=spin+(wi/6)*Math.PI*2;
          const wx=esx+Math.cos(wa)*ef.r*0.6, wy=esy+Math.sin(wa)*ef.r*0.6;
          ctx.beginPath(); ctx.arc(wx,wy,6,0,Math.PI*2); ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Drops
    ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    for (const d of this._drops) {
      if (d.skillId) {
        const sk=D_SKILLS.find(s=>s.id===d.skillId);
        ctx.save();
        ctx.shadowColor=sk?.color||'#e879f9'; ctx.shadowBlur=14;
        ctx.fillText(sk?.emoji||'✨',d.x+cx,d.y+cy);
        ctx.restore();
      } else if (d.potion) {
        ctx.save();
        ctx.shadowColor='#f87171'; ctx.shadowBlur=12;
        ctx.fillText('🧪',d.x+cx,d.y+cy);
        ctx.restore();
      } else {
        ctx.fillText('💰',d.x+cx,d.y+cy);
      }
    }

    // Towers
    for (const t of this._towers) {
      const sx=t.x+cx, sy=t.y+cy;
      if (sx<-25||sx>W+25||sy<-25||sy>H+25) continue;
      ctx.save();
      if (t.kind==='cannon') {
        ctx.globalAlpha=0.12;
        ctx.fillStyle='#ef4444';
        ctx.beginPath(); ctx.arc(sx,sy,t.range,0,Math.PI*2); ctx.fill();
        ctx.globalAlpha=1;
        ctx.strokeStyle='#ef4444'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.arc(sx,sy,t.range,0,Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle=t.kind==='cannon'?'#7f1d1d':'#78716c';
      ctx.strokeStyle=t.kind==='cannon'?'#ef4444':'rgba(255,255,255,0.6)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(sx,sy,t.rad,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.font=`${t.rad+2}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(t.emoji,sx,sy+1);
      ctx.restore();
    }

    // Monsters
    for (const m of this._monsters) {
      if (m.state!=='alive') continue;
      const sx=m.x+cx, sy=m.y+cy;
      if (sx<-45||sx>W+45||sy<-45||sy>H+45) continue;
      const sz=38, img=this._imgs[m.def.id||m.base.id];
      const isFrozen=this._freezeSet.has(m.id);
      const isBurning=this._burnMap.has(m.id);
      ctx.save();
      if (isFrozen)       ctx.filter='hue-rotate(180deg) brightness(1.4) saturate(0.6)';
      else if (isBurning) ctx.filter='hue-rotate(-40deg) saturate(2.5) brightness(1.1)';
      if (img?.complete&&img.naturalWidth) {
        ctx.drawImage(img,sx-sz/2,sy-sz/2,sz,sz);
      } else {
        ctx.fillStyle='#f87171'; ctx.beginPath(); ctx.arc(sx,sy,sz/2,0,Math.PI*2); ctx.fill();
      }
      ctx.filter='none';
      // Status tint overlay
      if (isFrozen) {
        ctx.globalAlpha=0.35; ctx.fillStyle='#38bdf8';
        ctx.beginPath(); ctx.arc(sx,sy,sz/2,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
      } else if (isBurning) {
        ctx.globalAlpha=0.25; ctx.fillStyle='#f97316';
        ctx.beginPath(); ctx.arc(sx,sy,sz/2,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
      }
      // HP bar
      const bw=42, bh=5;
      ctx.fillStyle='#1f2937'; ctx.fillRect(sx-bw/2,sy-sz/2-10,bw,bh);
      ctx.fillStyle=m.hp>m.def.maxHp*0.5?'#4ade80':'#f87171';
      ctx.fillRect(sx-bw/2,sy-sz/2-10,bw*(m.hp/m.def.maxHp),bh);
      ctx.restore();
    }

    // Projectiles
    for (const proj of this._projs) {
      const sx=proj.x+cx, sy=proj.y+cy;
      ctx.save(); ctx.fillStyle=proj.color; ctx.shadowColor=proj.color; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.arc(sx,sy,proj.r,0,Math.PI*2); ctx.fill(); ctx.restore();
    }

    // Player
    const p=this._p;
    const psx=p.x+cx, psy=p.y+cy;
    ctx.save();
    ctx.strokeStyle='#93c5fd'; ctx.lineWidth=2.5; ctx.fillStyle='#1e3a5f';
    ctx.beginPath(); ctx.arc(psx,psy,18,0,Math.PI*2); ctx.fill(); ctx.stroke();
    // Whirlwind aura
    if (this._windActive) {
      ctx.globalAlpha=0.4+Math.sin(now*0.008)*0.2;
      ctx.strokeStyle='#a78bfa'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(psx,psy,22,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=1;
    }
    ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('🧙',psx,psy+1);
    ctx.restore();

    // Move indicator
    if (p.moving) {
      ctx.save(); ctx.strokeStyle='rgba(99,102,241,0.55)'; ctx.lineWidth=1.2; ctx.setLineDash([5,5]);
      ctx.beginPath(); ctx.moveTo(psx,psy); ctx.lineTo(p.tx+cx,p.ty+cy); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle='rgba(99,102,241,0.85)';
      ctx.beginPath(); ctx.arc(p.tx+cx,p.ty+cy,4.5,0,Math.PI*2); ctx.fill(); ctx.restore();
    }

    // Floating texts
    for (const f of this._floats) {
      ctx.save(); ctx.globalAlpha=Math.min(1,f.life*1.4);
      ctx.fillStyle=f.color; ctx.font='bold 14px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      ctx.fillText(f.text,f.wx+cx,f.wy+cy); ctx.restore();
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────────────
  _onCanvasClick(e) {
    if (!this._running) return;
    const rect=this._canvas.getBoundingClientRect();
    const px=(e.clientX??e.pageX)-rect.left;
    const py=(e.clientY??e.pageY)-rect.top;
    const sx=px*(this._canvas.width/rect.width);
    const sy=py*(this._canvas.height/rect.height);
    const wx=sx-this._canvas.width/2+this._cam.x;
    const wy=sy-this._canvas.height/2+this._cam.y;

    let hit=null, bestD=32;
    for (const m of this._monsters) {
      if (m.state!=='alive') continue;
      const d=Math.hypot(m.x-wx,m.y-wy);
      if (d<bestD) { bestD=d; hit=m; }
    }
    if (hit) { this._p.targeting=hit; return; }
    this._p.tx=wx; this._p.ty=wy; this._p.moving=true; this._p.targeting=null;
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  _confirmExit() { if (confirm('Leave the dungeon?')) this.close(); }

  _showDeathScreen() {
    const p=this._p;
    const el=document.getElementById('dgDeathStats');
    if (el) el.innerHTML=`
      <div>Stage reached: <b>${this._stage}</b></div>
      <div>Kills: <b>${p.kills}</b></div>
      <div>Coins earned: <b>${p.coins} 💰</b></div>
      <div>XP earned: <b>${p.xp}</b></div>`;
    this._show('dgDeath');
    this._updateTicketUI();
  }

  _tryRespawn(isFree=false) {
    if (isFree) {
      if (this._getFreeLeft()<=0) { this._toast('No free tickets left today'); return; }
      this._useFreeTicket();
    } else {
      if (!this._spend(D_ENTRY)) { this._toast('Not enough coins (100 required)'); return; }
    }
    this._initState();
    this._initAudio();
    this._show('dgGame');
    this._resizeCanvas();
    this._registerKeyboard();
    this._run();
    this._updateTicketUI();
  }

  _toast(msg) {
    const el=document.getElementById('dgToast');
    if (!el) return;
    el.textContent=msg; el.classList.remove('hidden');
    clearTimeout(this._toastTmr);
    this._toastTmr=setTimeout(()=>el.classList.add('hidden'),2800);
  }
}
