// assets/js/pages/merchants.dungeon.js
// Dungeon Survival Mini-Game
'use strict';

const D_ENTRY        = 100;
const D_WORLD_R      = 1000;
const D_MAX_EACH     = 5;
const D_RESPAWN      = 10000; // ms
const D_FREE_PER_DAY = 3;
const D_FREE_KEY     = 'dg_free_tickets';

const D_MDEFS = [
  { id:'orc',    label:'Orc',    src:'/assets/images/slot/1.png',  maxHp:120, atk:15, spd:65,  range:80,  ranged:false, xp:20, coins:5  },
  { id:'pirate', label:'Pirate', src:'/assets/images/slot/2.png',  maxHp:90,  atk:12, spd:80,  range:70,  ranged:false, xp:15, coins:4  },
  { id:'cabi',   label:'CABI',   src:'/assets/images/slot/4.png',  maxHp:200, atk:25, spd:55,  range:150, ranged:true,  xp:50, coins:15 },
  { id:'wolf',   label:'Wolf',   src:'/assets/images/slot/5.png',  maxHp:80,  atk:18, spd:100, range:75,  ranged:false, xp:25, coins:6  },
  { id:'eye',    label:'Eye',    src:'/assets/images/slot/10.png', maxHp:150, atk:20, spd:55,  range:140, ranged:true,  xp:35, coins:10 },
  { id:'dragon', label:'Dragon', src:'/assets/images/slot/9.png',  maxHp:300, atk:40, spd:45,  range:170, ranged:true,  xp:80, coins:20 },
];

const D_TOWER_DEF = {
  cannon: { emoji:'💣', range:230, atk:55, rate:0.45, pColor:'#94a3b8', aoe:48, rad:18 },
  archer: { emoji:'🏹', range:280, atk:22, rate:2.2,  pColor:'#fbbf24', aoe:0,  rad:14 },
};

// Tower positions: 8 cannon @ r=400, 12 archer @ r=700
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
    D_MDEFS.forEach(d => { const img=new Image(); img.src=d.src; this._imgs[d.id]=img; });
    this._buildDOM();
  }

  // ── Free ticket helpers ───────────────────────────────────────────────────────
  _todayStr() { return new Date().toISOString().slice(0,10); }

  _loadFreeData() {
    try {
      const raw = localStorage.getItem(D_FREE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj.date === this._todayStr()) return obj;
      }
    } catch {}
    return { date: this._todayStr(), used: 0 };
  }

  _getFreeLeft() {
    return Math.max(0, D_FREE_PER_DAY - this._loadFreeData().used);
  }

  _useFreeTicket() {
    const obj = this._loadFreeData();
    obj.used = Math.min(D_FREE_PER_DAY, obj.used + 1);
    localStorage.setItem(D_FREE_KEY, JSON.stringify(obj));
  }

  _updateTicketUI() {
    const left = this._getFreeLeft();
    const badge = document.getElementById('dgTicketBadge');
    const freeBtn = document.getElementById('dgFreeEnterBtn');
    const freeRespBtn = document.getElementById('dgFreeRespawnBtn');
    if (badge) {
      badge.textContent = `🎟️ ${left}/${D_FREE_PER_DAY} Free Today`;
      badge.className = 'dg-ticket-badge' + (left > 0 ? ' dg-ticket-avail' : ' dg-ticket-empty');
    }
    if (freeBtn) {
      freeBtn.textContent = `🎟️ Free Entry (${left} left)`;
      freeBtn.classList.toggle('hidden', left === 0);
    }
    if (freeRespBtn) {
      freeRespBtn.textContent = `🎟️ Free Re-enter (${left} left)`;
      freeRespBtn.classList.toggle('hidden', left === 0);
    }
  }

  // ── DOM ──────────────────────────────────────────────────────────────────────
  _buildDOM() {
    if (document.getElementById('dungeonModal')) {
      this._modal  = document.getElementById('dungeonModal');
      this._canvas = document.getElementById('dgCanvas');
      this._ctx    = this._canvas.getContext('2d');
      return;
    }
    const m = document.createElement('div');
    m.id = 'dungeonModal';
    m.className = 'dg-modal hidden';
    m.innerHTML = `
      <div class="dg-overlay"></div>
      <div class="dg-panel">
        <div class="dg-screen" id="dgEntry">
          <div style="font-size:56px;margin-bottom:8px">🏰</div>
          <div class="dg-entry-title">Dungeon Survival</div>
          <div class="dg-entry-desc">100 💰 entry fee • 6 monster types<br>Cannon &amp; archer towers auto-defend<br>Click to move • Click monster to attack</div>
          <div class="dg-ticket-badge" id="dgTicketBadge">🎟️ 3/3 Free Today</div>
          <button class="dg-btn-free"  id="dgFreeEnterBtn">🎟️ Free Entry (3 left)</button>
          <button class="dg-btn-gold"  id="dgEnterBtn">⚔️ Enter Dungeon (100 💰)</button>
          <button class="dg-btn-ghost" id="dgEntryClose">Cancel</button>
        </div>
        <div class="dg-screen hidden" id="dgGame" style="padding:0;overflow:hidden">
          <div class="dg-hud" id="dgHud">
            <div class="dg-hud-l">
              <span style="font-size:13px">❤️</span>
              <div class="dg-hp-bg"><div class="dg-hp-fill" id="dgHpFill"></div></div>
              <span class="dg-hud-txt" id="dgHpTxt">200</span>
            </div>
            <div class="dg-hud-r">
              <span class="dg-hud-txt" id="dgCoins">💰 0</span>
              <span class="dg-hud-txt" id="dgKills">⚔️ 0</span>
              <button class="dg-x-btn" id="dgExitBtn">✕</button>
            </div>
          </div>
          <canvas id="dgCanvas" class="dg-canvas"></canvas>
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
  }

  // ── Screens ──────────────────────────────────────────────────────────────────
  open() { this._modal.classList.remove('hidden'); this._show('dgEntry'); this._updateTicketUI(); }
  close() { this._stop(); this._modal.classList.add('hidden'); }

  _show(id) {
    ['dgEntry','dgGame','dgDeath'].forEach(s =>
      this._modal.querySelector('#'+s)?.classList.toggle('hidden', s !== id));
  }

  // ── Audio ─────────────────────────────────────────────────────────────────────
  _initAudio() {
    try {
      if (!this._audio) this._audio = new AudioContext();
      if (this._audio.state === 'suspended') this._audio.resume();
      this._startAmbient();
    } catch {}
  }

  _startAmbient() {
    if (!this._audio || this._ambNodes) return;
    const ctx  = this._audio;
    const osc  = ctx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 55;
    const gain = ctx.createGain(); gain.gain.value = 0.035;
    const lfo  = ctx.createOscillator(); lfo.frequency.value = 0.25;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.015;
    const bpf  = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 90; bpf.Q.value = 0.8;
    lfo.connect(lfoG); lfoG.connect(gain.gain);
    osc.connect(bpf); bpf.connect(gain); gain.connect(ctx.destination);
    lfo.start(); osc.start();
    this._ambNodes = { osc, lfo, gain };
  }

  _stopAmbient() {
    if (!this._ambNodes) return;
    try { this._ambNodes.osc.stop(); this._ambNodes.lfo.stop(); } catch {}
    this._ambNodes = null;
  }

  _sfx(type) {
    if (!this._audio) return;
    const ctx = this._audio, sr = ctx.sampleRate;
    const dur = type === 'death' ? 0.4 : 0.12;
    const buf = ctx.createBuffer(1, Math.ceil(sr*dur), sr);
    const ch  = buf.getChannelData(0);
    if (type === 'hit') {
      for (let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.exp(-i/sr*30);
    } else if (type === 'kill') {
      for (let i=0;i<ch.length;i++) ch[i]=Math.sin(i*440/sr*Math.PI*2)*Math.exp(-i/sr*18);
    } else {
      for (let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.exp(-i/sr*6);
    }
    const src=ctx.createBufferSource(); src.buffer=buf;
    const g=ctx.createGain(); g.gain.value=0.25;
    src.connect(g); g.connect(ctx.destination); src.start();
  }

  // ── Game lifecycle ────────────────────────────────────────────────────────────
  _startGame(isFree = false) {
    if (isFree) {
      if (this._getFreeLeft() <= 0) { this._toast('No free tickets left today'); return; }
      this._useFreeTicket();
    } else {
      if (!this._spend(D_ENTRY)) { this._toast('Not enough coins (100 required)'); return; }
    }
    this._initState();
    this._initAudio();
    this._show('dgGame');
    this._resizeCanvas();
    this._run();
  }

  _initState() {
    this._p = {
      x:0, y:0, hp:200, maxHp:200,
      atk:25, atkRange:85, atkRate:1.2, atkCd:0,
      tx:0, ty:0, moving:false, targeting:null,
      coins:0, kills:0, xp:0,
    };
    this._monsters   = [];
    this._queues     = {};   // {typeId:[{def,at}]}
    this._towers     = D_TOWER_SLOTS.map(s => ({
      x:s.x, y:s.y, kind:s.kind, atkCd:0, ...D_TOWER_DEF[s.kind],
    }));
    this._projs      = [];
    this._drops      = [];
    this._floats     = [];
    this._cam        = { x:0, y:0 };
    this._running    = true;
    D_MDEFS.forEach(def => {
      for (let i=0; i<D_MAX_EACH; i++) this._spawnMonster(def, 0);
    });
  }

  _resizeCanvas() {
    const gameEl = this._modal.querySelector('#dgGame');
    const hudEl  = this._modal.querySelector('#dgHud');
    if (!gameEl) return;
    const r    = gameEl.getBoundingClientRect();
    const hudH = hudEl ? hudEl.getBoundingClientRect().height : 48;
    this._canvas.width  = Math.max(300, Math.floor(r.width));
    this._canvas.height = Math.max(200, Math.floor(r.height - hudH));
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
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._stopAmbient();
  }

  // ── Monster management ───────────────────────────────────────────────────────
  _spawnMonster(def, delay=0) {
    if (delay > 0) {
      if (!this._queues[def.id]) this._queues[def.id] = [];
      this._queues[def.id].push({ def, at: Date.now()+delay });
      return;
    }
    const a = Math.random()*Math.PI*2;
    const r = 250 + Math.random()*(D_WORLD_R*0.7);
    this._monsters.push({
      def, id:Math.random().toString(36).slice(2),
      x:Math.cos(a)*r, y:Math.sin(a)*r,
      hp:def.maxHp, atkCd:0, state:'alive',
    });
  }

  _killMonster(m) {
    if (m.state !== 'alive') return;
    m.state = 'dead'; m.hp = 0;
    this._p.kills++;
    this._p.xp += m.def.xp;
    this._drops.push({ x:m.x+(Math.random()-.5)*30, y:m.y+(Math.random()-.5)*30, coins:m.def.coins });
    this._addFloat(`+${m.def.coins}💰`, m.x, m.y-25, '#4ade80');
    this._addFloat(`+${m.def.xp}XP`,   m.x, m.y-45, '#a78bfa');
    this._sfx('kill');
    this._spawnMonster(m.def, D_RESPAWN);
  }

  // ── Update ────────────────────────────────────────────────────────────────────
  _update(dt) {
    const p = this._p;

    // Respawn queues
    const now = Date.now();
    for (const id in this._queues) {
      this._queues[id] = this._queues[id].filter(q => {
        if (now >= q.at) { this._spawnMonster(q.def, 0); return false; }
        return true;
      });
    }

    // Player movement
    if (p.moving) {
      const dx=p.tx-p.x, dy=p.ty-p.y, d=Math.hypot(dx,dy);
      if (d < 6) { p.moving=false; }
      else { const s=Math.min(180*dt,d); p.x+=dx/d*s; p.y+=dy/d*s; }
    }
    const pd = Math.hypot(p.x,p.y);
    if (pd > D_WORLD_R-22) { p.x=p.x/pd*(D_WORLD_R-22); p.y=p.y/pd*(D_WORLD_R-22); p.moving=false; }

    // Player auto-attack
    p.atkCd = Math.max(0, p.atkCd-dt);
    if (p.atkCd === 0) {
      let tgt = p.targeting;
      if (!tgt || tgt.state!=='alive') {
        tgt = null;
        let minD = p.atkRange;
        for (const m of this._monsters) {
          if (m.state!=='alive') continue;
          const d=Math.hypot(m.x-p.x,m.y-p.y);
          if (d<minD) { minD=d; tgt=m; }
        }
        p.targeting = tgt;
      }
      if (tgt) {
        const d=Math.hypot(tgt.x-p.x,tgt.y-p.y);
        if (d<=p.atkRange) {
          p.moving=false;
          tgt.hp-=p.atk;
          this._addFloat(`-${p.atk}`, tgt.x, tgt.y-20, '#f87171');
          this._sfx('hit');
          p.atkCd=1/p.atkRate;
          if (tgt.hp<=0) this._killMonster(tgt);
        } else {
          p.tx=tgt.x; p.ty=tgt.y; p.moving=true;
        }
      }
    }

    // Monster AI
    for (const m of this._monsters) {
      if (m.state!=='alive') continue;
      m.atkCd=Math.max(0,m.atkCd-dt);
      const dx=p.x-m.x, dy=p.y-m.y, dist=Math.hypot(dx,dy);
      if (dist<=m.def.range) {
        if (m.atkCd===0) {
          if (m.def.ranged) {
            this._fireProj(m.x,m.y,p.x,p.y,{atk:m.def.atk,src:'mob',spd:240,color:'#f87171',r:7,aoe:0});
          } else {
            p.hp-=m.def.atk;
            this._addFloat(`-${m.def.atk}`,p.x,p.y-30,'#ff5555');
            this._sfx('hit');
          }
          m.atkCd=1.4;
        }
      } else {
        const s=m.def.spd*dt;
        m.x+=dx/dist*s; m.y+=dy/dist*s;
      }
      const md=Math.hypot(m.x,m.y);
      if (md>D_WORLD_R-15) { m.x=m.x/md*(D_WORLD_R-15); m.y=m.y/md*(D_WORLD_R-15); }
    }

    // Tower attack
    for (const t of this._towers) {
      t.atkCd=Math.max(0,t.atkCd-dt);
      if (t.atkCd>0) continue;
      let tgt=null, minD=t.range;
      for (const m of this._monsters) {
        if (m.state!=='alive') continue;
        const d=Math.hypot(m.x-t.x,m.y-t.y);
        if (d<minD) { minD=d; tgt=m; }
      }
      if (tgt) {
        this._fireProj(t.x,t.y,tgt.x,tgt.y,{atk:t.atk,src:'tower',spd:310,color:t.pColor,r:t.kind==='cannon'?8:5,aoe:t.aoe});
        t.atkCd=1/t.rate;
      }
    }

    // Projectile update
    this._projs = this._projs.filter(proj => {
      proj.x+=proj.vx*dt; proj.y+=proj.vy*dt; proj.ttl-=dt;
      if (proj.ttl<=0) return false;
      if (proj.src==='mob') {
        if (Math.hypot(proj.x-p.x,proj.y-p.y)<22) {
          p.hp-=proj.atk;
          this._addFloat(`-${proj.atk}`,p.x,p.y-30,'#ff5555');
          this._sfx('hit');
          return false;
        }
      } else {
        for (const m of this._monsters) {
          if (m.state!=='alive') continue;
          if (Math.hypot(proj.x-m.x,proj.y-m.y)<26) {
            if (proj.aoe>0) {
              for (const m2 of this._monsters) {
                if (m2.state!=='alive') continue;
                if (Math.hypot(proj.x-m2.x,proj.y-m2.y)<proj.aoe) {
                  m2.hp-=proj.atk;
                  this._addFloat(`-${proj.atk}`,m2.x,m2.y-15,'#f59e0b');
                  if (m2.hp<=0) this._killMonster(m2);
                }
              }
            } else {
              m.hp-=proj.atk;
              this._addFloat(`-${proj.atk}`,m.x,m.y-15,'#f59e0b');
              if (m.hp<=0) this._killMonster(m);
            }
            return false;
          }
        }
      }
      return true;
    });

    // Drop pickup
    this._drops = this._drops.filter(drop => {
      if (Math.hypot(drop.x-p.x,drop.y-p.y)<38) {
        p.coins+=drop.coins;
        this._add(drop.coins);
        return false;
      }
      return true;
    });

    // Float drift
    this._floats = this._floats.filter(f => { f.life-=dt; f.wy-=45*dt; return f.life>0; });

    // Camera
    this._cam.x=p.x; this._cam.y=p.y;

    // HUD
    const hpPct = Math.max(0,p.hp/p.maxHp*100);
    const hpFill = document.getElementById('dgHpFill');
    const hpTxt  = document.getElementById('dgHpTxt');
    const coinsEl= document.getElementById('dgCoins');
    const killsEl= document.getElementById('dgKills');
    if (hpFill) hpFill.style.width=hpPct+'%';
    if (hpTxt)  hpTxt.textContent=`${Math.max(0,Math.floor(p.hp))}/${p.maxHp}`;
    if (coinsEl) coinsEl.textContent=`💰 ${p.coins}`;
    if (killsEl) killsEl.textContent=`⚔️ ${p.kills}`;

    // Death
    if (p.hp<=0 && this._running) { this._sfx('death'); this._stop(); this._showDeathScreen(); }
  }

  _fireProj(fx,fy,tx,ty,{atk,src,spd,color,r,aoe}) {
    const dx=tx-fx, dy=ty-fy, d=Math.hypot(dx,dy)||1;
    this._projs.push({ x:fx,y:fy, vx:dx/d*spd, vy:dy/d*spd, atk,src,color,r,aoe, ttl:d/spd+0.6 });
  }

  _addFloat(text,wx,wy,color) {
    this._floats.push({ text,wx,wy,color,life:1.3 });
  }

  // ── Draw ──────────────────────────────────────────────────────────────────────
  _draw() {
    const cv=this._canvas, ctx=this._ctx;
    const W=cv.width, H=cv.height;
    const cx=W/2-this._cam.x, cy=H/2-this._cam.y;

    // Background
    ctx.fillStyle='#0a0a14';
    ctx.fillRect(0,0,W,H);

    // Grid
    ctx.strokeStyle='rgba(255,255,255,0.035)';
    ctx.lineWidth=1;
    const gs=80;
    const gx0=Math.floor((this._cam.x-W/2)/gs)*gs;
    const gy0=Math.floor((this._cam.y-H/2)/gs)*gs;
    for (let gx=gx0; gx<this._cam.x+W/2+gs; gx+=gs) {
      const sx=gx+cx; ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,H); ctx.stroke();
    }
    for (let gy=gy0; gy<this._cam.y+H/2+gs; gy+=gs) {
      const sy=gy+cy; ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(W,sy); ctx.stroke();
    }

    // World boundary
    ctx.save();
    ctx.strokeStyle='rgba(255,80,40,0.45)';
    ctx.lineWidth=3; ctx.setLineDash([14,9]);
    ctx.beginPath(); ctx.arc(cx,cy,D_WORLD_R,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();

    // Drops
    ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    for (const d of this._drops) ctx.fillText('💰',d.x+cx,d.y+cy);

    // Towers
    for (const t of this._towers) {
      const sx=t.x+cx, sy=t.y+cy;
      if (sx<-25||sx>W+25||sy<-25||sy>H+25) continue;
      ctx.save();
      ctx.fillStyle = t.kind==='cannon'?'#475569':'#78716c';
      ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(sx,sy,t.rad,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.font=`${t.rad+2}px sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(t.emoji,sx,sy+1);
      ctx.restore();
    }

    // Monsters
    for (const m of this._monsters) {
      if (m.state!=='alive') continue;
      const sx=m.x+cx, sy=m.y+cy;
      if (sx<-45||sx>W+45||sy<-45||sy>H+45) continue;
      const sz=38, img=this._imgs[m.def.id];
      ctx.save();
      if (img?.complete && img.naturalWidth) {
        ctx.drawImage(img,sx-sz/2,sy-sz/2,sz,sz);
      } else {
        ctx.fillStyle='#f87171';
        ctx.beginPath(); ctx.arc(sx,sy,sz/2,0,Math.PI*2); ctx.fill();
      }
      // HP bar
      const bw=42, bh=5;
      ctx.fillStyle='#1f2937';
      ctx.fillRect(sx-bw/2,sy-sz/2-10,bw,bh);
      ctx.fillStyle=m.hp>m.def.maxHp*0.5?'#4ade80':'#f87171';
      ctx.fillRect(sx-bw/2,sy-sz/2-10,bw*(m.hp/m.def.maxHp),bh);
      ctx.restore();
    }

    // Projectiles
    for (const proj of this._projs) {
      const sx=proj.x+cx, sy=proj.y+cy;
      ctx.save();
      ctx.fillStyle=proj.color;
      ctx.shadowColor=proj.color; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.arc(sx,sy,proj.r,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // Player
    const p=this._p;
    const psx=p.x+cx, psy=p.y+cy;
    ctx.save();
    ctx.strokeStyle='#93c5fd'; ctx.lineWidth=2.5;
    ctx.fillStyle='#1e3a5f';
    ctx.beginPath(); ctx.arc(psx,psy,18,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('🧙',psx,psy+1);
    ctx.restore();

    // Move indicator
    if (p.moving) {
      ctx.save();
      ctx.strokeStyle='rgba(99,102,241,0.55)'; ctx.lineWidth=1.2; ctx.setLineDash([5,5]);
      ctx.beginPath(); ctx.moveTo(psx,psy); ctx.lineTo(p.tx+cx,p.ty+cy); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle='rgba(99,102,241,0.85)';
      ctx.beginPath(); ctx.arc(p.tx+cx,p.ty+cy,4.5,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // Floating texts
    for (const f of this._floats) {
      ctx.save();
      ctx.globalAlpha=Math.min(1,f.life*1.4);
      ctx.fillStyle=f.color; ctx.font='bold 14px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      ctx.fillText(f.text, f.wx+cx, f.wy+cy);
      ctx.restore();
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

    // Monster click?
    let hit=null, bestD=32;
    for (const m of this._monsters) {
      if (m.state!=='alive') continue;
      const d=Math.hypot(m.x-wx,m.y-wy);
      if (d<bestD) { bestD=d; hit=m; }
    }
    if (hit) { this._p.targeting=hit; return; }

    // Move to point
    this._p.tx=wx; this._p.ty=wy; this._p.moving=true; this._p.targeting=null;
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  _confirmExit() { if (confirm('Leave the dungeon?')) this.close(); }

  _showDeathScreen() {
    const p=this._p;
    const el=document.getElementById('dgDeathStats');
    if (el) el.innerHTML=`
      <div>Kills: <b>${p.kills}</b></div>
      <div>Coins earned: <b>${p.coins} 💰</b></div>
      <div>XP earned: <b>${p.xp}</b></div>`;
    this._show('dgDeath');
    this._updateTicketUI();
  }

  _tryRespawn(isFree = false) {
    if (isFree) {
      if (this._getFreeLeft() <= 0) { this._toast('No free tickets left today'); return; }
      this._useFreeTicket();
    } else {
      if (!this._spend(D_ENTRY)) { this._toast('Not enough coins (100 required)'); return; }
    }
    this._initState();
    this._initAudio();
    this._show('dgGame');
    this._resizeCanvas();
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
