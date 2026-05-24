// /assets/js/pages/merchants.race.js
// 몬스터 레이스 베팅 미니게임

// baseSpd는 trait 보너스를 포함한 평균속도가 1.00이 되도록 역산해 정규화:
//   sprinter (+20% for first 30%) → effective avg = baseSpd * (0.70 + 0.30*1.20) = baseSpd * 1.06  → baseSpd = 0.943
//   charger  (+35% for 30-65%)   → effective avg = baseSpd * (0.65 + 0.35*1.35) = baseSpd * 1.1225 → baseSpd = 0.891
//   finisher (+45% for last 35%) → effective avg = baseSpd * (0.65 + 0.35*1.45) = baseSpd * 1.1575 → baseSpd = 0.864
//   steady / chaos → baseSpd = 1.00
// 위 정규화로 trait 없이 순수 luck만 승패를 결정하게 함.

const MDEFS = [
  { id:'wolf',   label:'늑대인간',   img:'/assets/images/slot/5.png',  clr:'#f97316', odds:1.8,  baseSpd:0.94, vr:0.12, trait:'sprinter' },
  { id:'orc',    label:'오크',       img:'/assets/images/slot/1.png',  clr:'#8b5cf6', odds:2.5,  baseSpd:1.00, vr:0.10, trait:'steady'   },
  { id:'demon',  label:'암흑악마',   img:'/assets/images/slot/8.png',  clr:'#94a3b8', odds:3.5,  baseSpd:1.00, vr:0.10, trait:'steady'   },
  { id:'troll',  label:'트롤',       img:'/assets/images/slot/6.png',  clr:'#a16207', odds:5.0,  baseSpd:0.89, vr:0.22, trait:'charger'  },
  { id:'dragon', label:'드래곤',     img:'/assets/images/slot/9.png',  clr:'#dc2626', odds:7.0,  baseSpd:0.86, vr:0.15, trait:'finisher' },
  { id:'cerb',   label:'케르베로스', img:'/assets/images/slot/7.png',  clr:'#16a34a', odds:15.0, baseSpd:1.00, vr:0.48, trait:'chaos'    },
];

const BET_MIN     = 10;
const BET_MAX     = 1000;
const BETTING_SEC = 30;
const RACE_LAPS   = 2;
const LAP_SCALE   = 0.040; // baseSpd=1.0 → ~25s/lap → 2 laps ≈ 50s

// ── Web Audio 사운드 엔진 ──────────────────────────────────────────────────────

class RaceAudio {
  constructor() { this._ac = null; this._drumTimer = null; }

  _ctx() {
    if (!this._ac) this._ac = new (window.AudioContext || window.webkitAudioContext)();
    if (this._ac.state === 'suspended') this._ac.resume();
    return this._ac;
  }

  _osc(freq, type, gain, dur, when, pitchEnd) {
    const ac = this._ctx(), now = when ?? ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    if (pitchEnd) o.frequency.exponentialRampToValueAtTime(pitchEnd, now + dur);
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(now); o.stop(now + dur + 0.01);
  }

  _noise(bandFreq, q, gain, dur, when) {
    const ac = this._ctx(), now = when ?? ac.currentTime;
    const len = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = ac.createGain();
    flt.type = 'bandpass'; flt.frequency.value = bandFreq; flt.Q.value = q;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.buffer = buf;
    src.connect(flt); flt.connect(g); g.connect(ac.destination);
    src.start(now); src.stop(now + dur + 0.01);
  }

  _kick(when, vol = 1) {
    this._osc(150, 'sine', vol * 1.2, 0.35, when, 0.01);
    this._noise(80, 0.8, vol * 0.3, 0.06, when);
  }

  _snare(when, vol = 1) {
    this._osc(200, 'triangle', vol * 0.6, 0.12, when, 80);
    this._noise(3000, 0.5, vol * 0.5, 0.15, when);
  }

  _hihat(when, vol = 0.18)   { this._noise(8000, 2,   vol, 0.04, when); }
  _openHat(when, vol = 0.22) { this._noise(7000, 1.5, vol, 0.12, when); }

  betPlaced() {
    this._osc(660, 'sine', 0.3, 0.08);
    setTimeout(() => this._osc(880, 'sine', 0.3, 0.08), 80);
  }

  countdown(secsLeft) {
    const freq = 440 + (BETTING_SEC - secsLeft) * 14;
    this._osc(freq, 'square', 0.15, secsLeft <= 5 ? 0.12 : 0.07);
  }

  raceStart() {
    const ac = this._ctx(), now = ac.currentTime;
    this._osc(1200, 'square', 0.25, 0.5, now, 1800);
    this._noise(800, 0.3, 0.5, 1.4, now + 0.1);
    this._noise(1200, 0.4, 0.35, 1.0, now + 0.3);
  }

  startDrumLoop() {
    const ac = this._ctx();
    const stepSec = (60 / 128) / 4;
    this._loopNext = ac.currentTime + 0.05;
    this._loopStep = 0;
    const tick = () => {
      const now = ac.currentTime;
      while (this._loopNext < now + 0.3) {
        const s = this._loopStep % 16;
        if (s === 0 || s === 8)  this._kick(this._loopNext);
        if (s === 13)            this._kick(this._loopNext, 0.6);
        if (s === 4 || s === 12) this._snare(this._loopNext);
        if (s % 2 === 0)         this._hihat(this._loopNext);
        if (s === 6 || s === 14) this._openHat(this._loopNext);
        this._loopNext += stepSec;
        this._loopStep++;
      }
      this._drumTimer = setTimeout(tick, 50);
    };
    tick();
  }

  stopDrumLoop() { clearTimeout(this._drumTimer); this._drumTimer = null; }

  evBoost()   {
    const ac = this._ctx(), now = ac.currentTime;
    this._osc(200, 'sawtooth', 0.25, 0.35, now, 900);
    this._noise(2000, 1, 0.2, 0.2, now + 0.05);
  }
  evTrap()    {
    const ac = this._ctx(), now = ac.currentTime;
    this._osc(600, 'sawtooth', 0.3, 0.3, now, 80);
    this._noise(400, 1.5, 0.25, 0.25, now);
  }
  evStun()    {
    const ac = this._ctx(), now = ac.currentTime;
    this._osc(120, 'sine', 0.4, 0.4, now, 60);
    this._noise(300, 2, 0.2, 0.3, now);
  }
  evBerserk() {
    const ac = this._ctx(), now = ac.currentTime;
    this._osc(80,  'sawtooth', 0.5, 0.15, now);
    this._osc(160, 'sawtooth', 0.4, 0.15, now + 0.05);
    this._osc(240, 'sawtooth', 0.3, 0.15, now + 0.10);
    this._noise(500, 0.5, 0.5, 0.3, now);
  }

  monsterFinish(place) {
    const ac = this._ctx(), now = ac.currentTime;
    if (place === 1) {
      [523, 659, 784, 1047].forEach((f, i) => this._osc(f, 'square', 0.22, 0.15, now + i * 0.12));
      this._noise(1000, 0.5, 0.3, 0.5, now);
    } else {
      const freq = [440, 392, 349, 330, 294][Math.min(place - 2, 4)];
      this._osc(freq, 'sine', 0.2, 0.18);
    }
  }

  win() {
    const ac = this._ctx(), now = ac.currentTime;
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => this._osc(f, 'square', 0.25, 0.18, now + i * 0.1));
    for (let i = 0; i < 8; i++) setTimeout(() => this._noise(4000, 3, 0.15, 0.06), 600 + i * 60);
  }

  lose() {
    const ac = this._ctx(), now = ac.currentTime;
    this._osc(440, 'sawtooth', 0.2, 0.25, now, 380);
    this._osc(330, 'sawtooth', 0.2, 0.25, now + 0.28, 290);
    this._osc(220, 'sawtooth', 0.2, 0.5,  now + 0.58, 180);
  }
}

// ── 메인 게임 클래스 ──────────────────────────────────────────────────────────

class MonsterRace {
  constructor(opts) {
    this._spend = opts.onSpendGold;
    this._add   = opts.onAddGold;
    this._audio = new RaceAudio();

    this._modal       = null;
    this._canvas      = null;
    this._ctx         = null;
    this._imgs        = {};
    this._phase       = 'idle';
    this._betType     = 'win';
    this._betMonster  = null;
    this._betAmount   = 100;
    this._betLocked   = false;
    this._betTimer    = null;
    this._secsLeft    = BETTING_SEC;
    this._runners     = [];
    this._finishOrder = [];
    this._raf         = null;
    this._lastTs      = 0;
    this._msgTimeout  = null;

    this._preloadImages();
    this._buildDOM();
  }

  _preloadImages() {
    MDEFS.forEach(m => {
      const img = new Image();
      img.src = m.img;
      this._imgs[m.id] = img;
    });
  }

  _buildDOM() {
    const existing = document.getElementById('raceModal');
    if (existing) {
      this._modal  = existing;
      this._canvas = document.getElementById('raceCanvas');
      return;
    }
    const m = document.createElement('div');
    m.id = 'raceModal';
    m.className = 'race-modal hidden';
    m.innerHTML = `
      <div class="race-overlay"></div>
      <div class="race-panel">
        <div class="race-hdr">
          <span class="race-title">🏟️ Monster Race</span>
          <button id="raceClose" class="race-close-btn">✕</button>
        </div>
        <div id="raceBetting" class="race-betting">
          <div class="race-bet-timer" id="raceBetTimer">⏱ ${BETTING_SEC}초</div>
          <div class="race-grid" id="raceGrid"></div>
          <div class="race-bet-ctrl">
            <div class="race-bet-types" id="raceBetTypes">
              <button class="rbt active" data-type="win">단승 (1위)</button>
              <button class="rbt" data-type="place">복승 (1~2위)</button>
              <button class="rbt" data-type="show">삼복승 (1~3위)</button>
            </div>
            <div class="race-amount-row">
              <button class="race-amt-btn" id="raceBetMinus">−</button>
              <span class="race-amt-val" id="raceBetAmt">100</span>
              <button class="race-amt-btn" id="raceBetPlus">+</button>
              <span style="color:#9ca3af;font-size:12px;margin-left:4px;">코인</span>
            </div>
            <div class="race-preset-row">
              <button class="race-amt-preset" data-v="50">50</button>
              <button class="race-amt-preset" data-v="100">100</button>
              <button class="race-amt-preset" data-v="300">300</button>
              <button class="race-amt-preset" data-v="500">500</button>
              <button class="race-amt-preset" data-v="1000">MAX</button>
            </div>
            <button id="racePlaceBet" class="race-bet-submit" disabled>몬스터를 선택하세요</button>
          </div>
        </div>
        <div id="raceArena" class="race-arena hidden">
          <div class="race-event-bar">
            <span id="raceEventMsg" class="race-event-msg"></span>
          </div>
          <canvas id="raceCanvas" class="race-canvas"></canvas>
        </div>
        <div id="raceResult" class="race-result hidden"></div>
      </div>
    `;
    document.body.appendChild(m);
    this._modal  = m;
    this._canvas = document.getElementById('raceCanvas');
    document.getElementById('raceClose').addEventListener('click', () => this.close());
  }

  open() {
    this._modal.classList.remove('hidden');
    this._startBetting();
  }

  close() {
    this._stopAll();
    this._audio.stopDrumLoop();
    this._modal.classList.add('hidden');
    this._phase = 'idle';
  }

  _stopAll() {
    if (this._betTimer)   { clearInterval(this._betTimer);    this._betTimer   = null; }
    if (this._raf)        { cancelAnimationFrame(this._raf);  this._raf        = null; }
    if (this._msgTimeout) { clearTimeout(this._msgTimeout);   this._msgTimeout = null; }
  }

  // ── 베팅 페이즈 ──────────────────────────────────────────────────────────────

  _startBetting() {
    this._stopAll();
    this._audio.stopDrumLoop();
    this._phase      = 'betting';
    this._betMonster = null;
    this._betType    = 'win';
    this._betAmount  = 100;
    this._betLocked  = false;
    this._secsLeft   = BETTING_SEC;
    this._finishOrder = [];

    document.getElementById('raceBetting').classList.remove('hidden');
    document.getElementById('raceArena').classList.add('hidden');
    document.getElementById('raceResult').classList.add('hidden');

    this._renderGrid();
    this._updateBetUI();

    const timerEl = document.getElementById('raceBetTimer');
    timerEl.textContent = `⏱ ${this._secsLeft}초`;
    timerEl.style.color = '#fbbf24';

    this._betTimer = setInterval(() => {
      this._secsLeft--;
      timerEl.textContent = `⏱ ${this._secsLeft}초`;
      if (this._secsLeft <= 10) {
        timerEl.style.color = '#ef4444';
        this._audio.countdown(this._secsLeft);
      }
      if (this._secsLeft <= 0) {
        clearInterval(this._betTimer);
        this._betTimer = null;
        this._startRace();
      }
    }, 1000);

    document.getElementById('raceBetMinus').onclick = () => {
      if (this._betLocked) return;
      this._betAmount = Math.max(BET_MIN, this._betAmount - 50);
      this._updateBetUI();
    };
    document.getElementById('raceBetPlus').onclick = () => {
      if (this._betLocked) return;
      this._betAmount = Math.min(BET_MAX, this._betAmount + 50);
      this._updateBetUI();
    };
    document.querySelectorAll('.race-amt-preset').forEach(btn => {
      btn.onclick = () => {
        if (this._betLocked) return;
        this._betAmount = Math.min(BET_MAX, parseInt(btn.dataset.v) || BET_MAX);
        this._updateBetUI();
      };
    });
    document.getElementById('raceBetTypes').querySelectorAll('.rbt').forEach(btn => {
      btn.onclick = () => {
        if (this._betLocked) return;
        document.querySelectorAll('.rbt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._betType = btn.dataset.type;
        this._updateBetUI();
      };
    });
    document.getElementById('racePlaceBet').onclick = () => {
      if (!this._betMonster || this._betLocked) return;
      this._placeBet();
    };
  }

  _renderGrid() {
    const grid = document.getElementById('raceGrid');
    grid.innerHTML = MDEFS.map(m => `
      <div class="race-card" data-id="${m.id}" style="--mc:${m.clr}">
        <img class="rc-img" src="${m.img}" alt="${m.label}" loading="eager">
        <div class="rc-name">${m.label}</div>
        <div class="rc-trait">${_traitLabel(m.trait)}</div>
        <div class="rc-odds" style="color:${m.clr}">${m.odds.toFixed(1)}x</div>
      </div>
    `).join('');
    grid.querySelectorAll('.race-card').forEach(card => {
      card.addEventListener('click', () => {
        if (this._betLocked) return;
        grid.querySelectorAll('.race-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this._betMonster = card.dataset.id;
        this._updateBetUI();
      });
    });
  }

  _updateBetUI() {
    document.getElementById('raceBetAmt').textContent = this._betAmount;
    const btn = document.getElementById('racePlaceBet');
    if (this._betLocked) return;
    if (!this._betMonster) {
      btn.textContent = '몬스터를 선택하세요';
      btn.disabled = true;
    } else {
      const m  = MDEFS.find(x => x.id === this._betMonster);
      const tl = { win:'단승', place:'복승', show:'삼복승' }[this._betType];
      btn.textContent = `${m.label}에 ${this._betAmount}코인 베팅 (${tl})`;
      btn.disabled = false;
    }
  }

  _placeBet() {
    if (!this._spend(this._betAmount)) {
      this._showToast('코인이 부족합니다!');
      return;
    }
    this._betLocked = true;
    this._audio.betPlaced();
    const btn = document.getElementById('racePlaceBet');
    btn.textContent = '✅ 베팅 완료!';
    btn.disabled = true;
    const m = MDEFS.find(x => x.id === this._betMonster);
    this._showToast(`${m.label}에 ${this._betAmount}코인 베팅 완료!`);
  }

  // ── 레이스 페이즈 ─────────────────────────────────────────────────────────────

  // 배당률 기반 가중 랜덤으로 순위를 미리 결정하고 luck 배수를 할당.
  // score = random * (1/odds) → 배당률이 낮을수록(강자일수록) 높은 score가 자주 나옴.
  _rollLuckMults() {
    const entries = MDEFS.map(m => ({
      id:    m.id,
      score: Math.random() * (1 / m.odds),
    }));
    entries.sort((a, b) => b.score - a.score); // 높은 score = 선호 순위 1위
    const map = {};
    entries.forEach((e, i) => {
      const t = i / (entries.length - 1); // 0(1위) → 1(꼴찌)
      map[e.id] = 1.05 - t * 0.10;        // 1.05 → 0.95
    });
    return map;
  }

  _startRace() {
    this._stopAll();
    this._phase = 'racing';
    document.getElementById('raceBetting').classList.add('hidden');
    const arena = document.getElementById('raceArena');
    arena.classList.remove('hidden');

    const luckMults = this._rollLuckMults();

    this._runners = MDEFS.map((m, i) => ({
      ...m,
      progress:        0,
      startOffset:     (i - 2.5) * 0.07,
      effectType:      null,
      effectRemaining: 0,
      eventTimer:      2 + Math.random() * 4,
      chargerUsed:     false,
      finished:        false,
      finishPlace:     0,
      luckMult:        luckMults[m.id],
    }));
    this._finishOrder = [];

    requestAnimationFrame(() => {
      const cv   = this._canvas;
      const rect = cv.getBoundingClientRect();
      cv.width   = Math.round(rect.width  || 500);
      cv.height  = Math.round(rect.height || 400);
      this._ctx  = cv.getContext('2d');
      this._audio.raceStart();
      setTimeout(() => this._audio.startDrumLoop(), 600);
      this._lastTs = performance.now();
      this._raf = requestAnimationFrame(ts => this._loop(ts));
    });
  }

  _loop(ts) {
    const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
    this._lastTs = ts;
    this._updateRunners(dt);
    this._drawFrame();
    if (this._finishOrder.length === MDEFS.length) {
      this._audio.stopDrumLoop();
      this._showResult();
      return;
    }
    this._raf = requestAnimationFrame(ts => this._loop(ts));
  }

  _updateRunners(dt) {
    this._runners.forEach(r => {
      if (r.finished) return;

      if (r.effectType) {
        r.effectRemaining -= dt;
        if (r.effectRemaining <= 0) r.effectType = null;
      }
      r.eventTimer -= dt;
      if (r.eventTimer <= 0) {
        this._applyEvent(r);
        r.eventTimer = 3 + Math.random() * 6;
      }

      const p01 = r.progress / RACE_LAPS;
      let spd = r.baseSpd;

      // trait 보너스 (baseSpd가 정규화되어 있으므로 전체 평균속도는 동일)
      if      (r.trait === 'sprinter' && p01 < 0.30)  spd *= 1.20;
      else if (r.trait === 'finisher' && p01 > 0.65)  spd *= 1.45;
      else if (r.trait === 'charger'  && p01 > 0.30 && p01 < 0.65 && !r.chargerUsed) {
        spd *= 1.35;
        if (p01 > 0.50) r.chargerUsed = true;
      } else if (r.trait === 'chaos') {
        spd *= 0.55 + Math.random() * 0.90; // avg ≈ 1.00
      }

      // 배당률 기반 luck 배수 적용 (승패 확률 조정의 핵심)
      spd *= r.luckMult;

      // 프레임별 미세 랜덤 (레이스 박진감)
      spd += (Math.random() - 0.5) * r.vr;
      spd  = Math.max(0.10, spd);

      // 이벤트 효과
      if (r.effectType === 'boost')   spd *= 1.45;
      if (r.effectType === 'berserk') spd *= 1.80;
      if (r.effectType === 'trap')    spd *= 0.45;
      if (r.effectType === 'stun')    spd  = 0;

      r.progress += spd * LAP_SCALE * dt;

      if (r.progress >= RACE_LAPS && !r.finished) {
        r.progress    = RACE_LAPS;
        r.finished    = true;
        r.finishPlace = this._finishOrder.length + 1;
        this._finishOrder.push(r.id);
        this._audio.monsterFinish(r.finishPlace);
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'];
        this._showEventMsg(`${r.label} ${medals[r.finishPlace - 1]} 완주!`);
      }
    });
  }

  _applyEvent(r) {
    const roll = Math.random() * 100;
    let type, dur;
    if      (roll < 40) { type = 'boost';   dur = 2.0; this._audio.evBoost();   }
    else if (roll < 74) { type = 'trap';    dur = 1.5; this._audio.evTrap();    }
    else if (roll < 94) { type = 'stun';    dur = 0.8; this._audio.evStun();    }
    else                { type = 'berserk'; dur = 1.0; this._audio.evBerserk(); }
    r.effectType      = type;
    r.effectRemaining = dur;
    const icons = { boost:'🔥 가속!', trap:'⚠️ 함정!', stun:'💫 기절!', berserk:'💀 광란!' };
    this._showEventMsg(`${r.label} ${icons[type]}`);
  }

  _showEventMsg(msg) {
    const el = document.getElementById('raceEventMsg');
    if (!el) return;
    el.textContent   = msg;
    el.style.opacity = '1';
    clearTimeout(this._msgTimeout);
    this._msgTimeout = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  }

  // ── 캔버스 렌더링 ─────────────────────────────────────────────────────────────

  _drawFrame() {
    const cv  = this._canvas, ctx = this._ctx;
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2;
    const outerRx = W * 0.44, outerRy = H * 0.43;
    const innerRx = W * 0.23, innerRy = H * 0.22;

    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#150800';
    ctx.fillRect(0, 0, W, H);

    ctx.beginPath();
    ctx.ellipse(cx, cy, outerRx + 22, outerRy + 22, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1400';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx, cy, outerRx, outerRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#6b3a1a';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#14532d';
    ctx.fill();
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let l = 1; l < MDEFS.length; l++) {
      const t = l / MDEFS.length;
      ctx.beginPath();
      ctx.ellipse(cx, cy, innerRx + t * (outerRx - innerRx), innerRy + t * (outerRy - innerRy), 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,200,100,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy - innerRy - 2);
    ctx.lineTo(cx, cy - outerRy + 2);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const flicker = 0.85 + Math.random() * 0.3;
    ctx.font = `${Math.round(15 * flicker)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [[0,-1],[1,0],[0,1],[-1,0]].forEach(([dx, dy]) => {
      ctx.fillText('🔥', cx + dx * (outerRx + 16), cy + dy * (outerRy + 16));
    });

    const barAreaW = innerRx * 2 - 16;
    const barH     = Math.min(10, (innerRy * 2 - 12) / MDEFS.length);
    const leader   = this._runners.reduce((a, b) => a.progress > b.progress ? a : b);

    this._runners.forEach((r, i) => {
      const bx   = cx - innerRx + 8;
      const by   = cy - innerRy + 5 + i * (barH + 2);
      const fill = Math.min(r.progress / RACE_LAPS, 1) * barAreaW;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, by, barAreaW, barH);
      ctx.fillStyle = r.id === leader.id && !r.finished ? r.clr + 'ff' : r.clr + 'cc';
      ctx.fillRect(bx, by, fill, barH);
      if (barH >= 7) {
        ctx.font = `bold ${Math.min(7, barH)}px sans-serif`;
        ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
        const placeStr = r.finishPlace ? ` ${r.finishPlace}위` : (r.id === leader.id ? ' 선두' : '');
        ctx.fillText(`${r.label}${placeStr}`, bx + 2, by + barH / 2 + 0.5);
      }
    });

    const R = Math.max(14, Math.min(20, W * 0.026));
    this._runners.forEach((r, i) => {
      const t     = (i + 0.5) / MDEFS.length;
      const rx    = innerRx + t * (outerRx - innerRx);
      const ry    = innerRy + t * (outerRy - innerRy);
      const angle = -Math.PI / 2 + r.startOffset + (r.progress / RACE_LAPS) * 2 * Math.PI;
      const px    = cx + rx * Math.cos(angle);
      const py    = cy + ry * Math.sin(angle);

      if (r.effectType) {
        const glows = {
          boost:   'rgba(249,115,22,0.5)',
          trap:    'rgba(239,68,68,0.5)',
          stun:    'rgba(167,139,250,0.55)',
          berserk: 'rgba(220,38,38,0.75)',
        };
        ctx.beginPath();
        ctx.arc(px, py, R + 7, 0, Math.PI * 2);
        ctx.fillStyle = glows[r.effectType];
        ctx.fill();
      }

      if (r.id === leader.id && !r.finished) {
        ctx.beginPath();
        ctx.arc(px, py, R + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      const img = this._imgs[r.id];
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, R, 0, Math.PI * 2);
      ctx.clip();
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, px - R, py - R, R * 2, R * 2);
      } else {
        ctx.fillStyle = r.clr;
        ctx.fill();
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(px, py, R, 0, Math.PI * 2);
      ctx.strokeStyle = r.finished ? '#fbbf24' : (r.id === this._betMonster ? '#fff' : 'rgba(255,255,255,0.45)');
      ctx.lineWidth   = r.finished ? 2.5 : (r.id === this._betMonster ? 2.5 : 1.5);
      ctx.stroke();

      if (r.id === this._betMonster) {
        ctx.font = `bold ${Math.min(9, R * 0.55)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('▲', px, py - R - 2);
      }
    });
  }

  // ── 결과 페이즈 ──────────────────────────────────────────────────────────────

  _showResult() {
    this._stopAll();
    this._phase = 'result';
    document.getElementById('raceArena').classList.add('hidden');
    const result = document.getElementById('raceResult');
    result.classList.remove('hidden');

    let payout = 0, won = false;
    if (this._betLocked && this._betMonster) {
      const m     = MDEFS.find(x => x.id === this._betMonster);
      const place = this._finishOrder.indexOf(this._betMonster) + 1;
      // 베팅 타입별 당첨 배수 (place=0이면 indexOf 못찾음 → 안전하게 0으로 처리)
      const multMap = { win: place === 1 ? 1 : 0, place: place >= 1 && place <= 2 ? 0.5 : 0, show: place >= 1 && place <= 3 ? 0.25 : 0 };
      const mult    = multMap[this._betType] ?? 0;
      if (mult > 0) {
        payout = Math.floor(this._betAmount * m.odds * mult);
        won    = true;
        this._add(payout);
        setTimeout(() => this._audio.win(), 300);
      } else {
        setTimeout(() => this._audio.lose(), 300);
      }
    }

    const medals     = ['🥇','🥈','🥉','4위','5위','6위'];
    const podiumHTML = this._finishOrder.slice(0, 3).map((id, i) => {
      const m = MDEFS.find(x => x.id === id);
      return `<div class="race-podium-row">
        <img src="${m.img}" class="race-result-icon" alt="${m.label}">
        <span>${medals[i]} ${m.label}</span>
      </div>`;
    }).join('');

    // 코인 결과 메시지 (베팅한 경우만 표시)
    let betMsg = '';
    if (this._betLocked && this._betMonster) {
      const betM  = MDEFS.find(x => x.id === this._betMonster);
      const place = this._finishOrder.indexOf(this._betMonster) + 1;
      if (won) {
        betMsg = `<div class="race-win-msg">🎉 ${betM.label} ${place}위! +${payout} 코인 획득!</div>`;
      } else {
        betMsg = `<div class="race-lose-msg">😢 ${betM.label} ${place}위... ${this._betAmount}코인 손실</div>`;
      }
    }

    const orderRows = this._finishOrder.map((id, i) => {
      const m    = MDEFS.find(x => x.id === id);
      const mine = id === this._betMonster;
      return `<div class="race-order-row${mine ? ' my-bet' : ''}">
        <img src="${m.img}" class="race-order-icon" alt="${m.label}">
        <span>${medals[i]} ${m.label}</span>
        <span style="color:${m.clr};margin-left:auto">${m.odds}x</span>
      </div>`;
    }).join('');

    result.innerHTML = `
      <div class="race-result-inner">
        <div class="race-result-title">🏁 레이스 결과</div>
        <div class="race-podium">${podiumHTML}</div>
        ${betMsg}
        <div class="race-order">${orderRows}</div>
        <div class="race-result-btns">
          <button id="raceRestart" class="race-restart-btn">🔄 다시 베팅</button>
          <button id="raceCloseResult" class="race-close-result-btn">✕ 닫기</button>
        </div>
      </div>
    `;
    document.getElementById('raceRestart').addEventListener('click', () => {
      this._betLocked = false;
      this._startBetting();
    });
    document.getElementById('raceCloseResult').addEventListener('click', () => this.close());
  }

  _showToast(msg) {
    const t = document.createElement('div');
    t.className   = 'race-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function _traitLabel(t) {
  return { sprinter:'⚡ 초반 강자', steady:'🛡️ 안정형', charger:'💥 중반 돌진', finisher:'🔥 후반 강자', chaos:'🎲 랜덤' }[t] || t;
}

// ── Public API ────────────────────────────────────────────────────────────────

let _instance = null;
export function initRaceGame(opts) { _instance = new MonsterRace(opts); }
export function openRaceGame()     { _instance?.open(); }
