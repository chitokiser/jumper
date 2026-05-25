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

const BET_MIN      = 10;
const BET_MAX      = 1000;
const BETTING_SEC  = 30;
const RACE_LAPS    = 2;
const LAP_SCALE    = 0.040; // baseSpd=1.0 → ~25s/lap → 2 laps ≈ 50s
const HOUSE_TAKE   = 0.15;
const SIM_POOL_BASE = 5000;
const PLACE_MULT   = 0.55;
const SHOW_MULT    = 0.35;

// Simulated pool weights — inverse-odds so distribution mirrors static odds
const _simWeights = (() => {
  const raw = MDEFS.map(m => ({ id: m.id, w: 1 / m.odds }));
  const sum  = raw.reduce((s, x) => s + x.w, 0);
  const out  = {};
  raw.forEach(x => { out[x.id] = x.w / sum; });
  return out;
})();

// ── Web Audio 사운드 엔진 ──────────────────────────────────────────────────────

class RaceAudio {
  constructor() { this._ac = null; this._drumTimer = null; this._loopNext = 0; this._loopStep = 0; }

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
    const len = Math.ceil(ac.sampleRate * Math.max(dur, 0.01));
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

  _bass(when, freq = 55, vol = 0.38) {
    const ac = this._ctx(), now = when ?? ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(freq * 0.48, now + 0.38);
    f.type = 'lowpass'; f.frequency.value = 180; f.Q.value = 0.7;
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    o.connect(f); f.connect(g); g.connect(ac.destination);
    o.start(now); o.stop(now + 0.46);
  }

  _kick(when, vol = 1) {
    this._osc(160, 'sine', vol * 1.2, 0.38, when, 0.01);
    this._noise(80, 0.8, vol * 0.3, 0.07, when);
  }

  _snare(when, vol = 1) {
    this._osc(200, 'triangle', vol * 0.6, 0.13, when, 80);
    this._noise(3200, 0.5, vol * 0.55, 0.18, when);
  }

  _hihat(when, vol = 0.15)   { this._noise(9500, 2.5, vol, 0.04, when); }
  _openHat(when, vol = 0.2)  { this._noise(7500, 1.5, vol, 0.14, when); }
  _rim(when, vol = 0.3) {
    this._osc(650, 'square', vol * 0.4, 0.04, when);
    this._noise(5000, 3, vol * 0.28, 0.05, when);
  }

  betPlaced() {
    const ac = this._ctx(), now = ac.currentTime;
    [880, 1100, 1320].forEach((f, i) => this._osc(f, 'sine', 0.22, 0.08, now + i * 0.045));
    this._noise(9000, 3, 0.08, 0.14, now);
  }

  countdown(secsLeft) {
    const ac = this._ctx(), now = ac.currentTime;
    const urgent = secsLeft <= 5;
    const freq = urgent ? 880 + (5 - secsLeft) * 110 : 440 + (BETTING_SEC - secsLeft) * 12;
    this._osc(freq, 'square', urgent ? 0.22 : 0.1, urgent ? 0.11 : 0.07, now);
    if (urgent) {
      this._osc(freq * 2, 'sine', 0.1, 0.06, now + 0.03);
      this._noise(6000, 2, 0.08, 0.08, now);
    }
  }

  raceStart() {
    const ac = this._ctx(), now = ac.currentTime;
    this._osc(80, 'sawtooth', 0.3, 1.8, now, 600);
    this._noise(800, 0.3, 0.5, 2.0, now);
    [523, 659, 784].forEach((f, i) => this._osc(f, 'square', 0.22, 0.9, now + 0.65 + i * 0.04, f * 1.4));
    this._osc(1400, 'sawtooth', 0.4, 0.38, now + 1.15, 1900);
    this._noise(2500, 0.5, 0.7, 0.65, now + 1.15);
    setTimeout(() => this.crowd(0.38), 1250);
  }

  crowd(vol = 0.28, dur = 2.5) {
    const ac = this._ctx(), now = ac.currentTime;
    [350, 700, 1400].forEach((f, i) => this._noise(f, 0.25, vol * (0.9 - i * 0.2), dur, now + i * 0.08));
    this._osc(180, 'sine', vol * 0.15, dur * 0.8, now, 225);
    this._osc(184, 'sine', vol * 0.1,  dur * 0.8, now, 228);
  }

  startDrumLoop() {
    const ac = this._ctx();
    const stepSec = (60 / 130) / 4;
    this._loopNext = ac.currentTime + 0.05;
    this._loopStep = 0;
    const tick = () => {
      const now = ac.currentTime;
      while (this._loopNext < now + 0.32) {
        const s = this._loopStep % 32;
        // Kick
        if (s === 0 || s === 16)           this._kick(this._loopNext);
        if (s === 11 || s === 27)          this._kick(this._loopNext, 0.55);
        // Snare
        if (s === 8  || s === 24)          this._snare(this._loopNext);
        // Bass
        if (s === 0  || s === 16)          this._bass(this._loopNext, 55);
        if (s === 11 || s === 27)          this._bass(this._loopNext, 44, 0.28);
        if (s === 6  || s === 22)          this._bass(this._loopNext, 73, 0.22);
        // Rim
        if (s === 4  || s === 12 || s === 20 || s === 28) this._rim(this._loopNext);
        // Hi-hat (8th notes)
        if (s % 2 === 0)                   this._hihat(this._loopNext);
        // Open hat
        if (s === 6  || s === 14 || s === 22 || s === 30) this._openHat(this._loopNext);
        // Drum fill (every 2 bars, last 4 steps)
        if (s === 28) this._snare(this._loopNext, 0.4);
        if (s === 29) this._snare(this._loopNext, 0.5);
        if (s === 30) { this._snare(this._loopNext, 0.65); this._hihat(this._loopNext, 0.35); }
        if (s === 31) { this._snare(this._loopNext, 0.8);  this._kick(this._loopNext, 0.3); }

        this._loopNext += stepSec;
        this._loopStep++;
      }
      this._drumTimer = setTimeout(tick, 50);
    };
    tick();
  }

  stopDrumLoop() { clearTimeout(this._drumTimer); this._drumTimer = null; }

  evBoost() {
    const ac = this._ctx(), now = ac.currentTime;
    [220, 330, 440, 660, 880].forEach((f, i) => this._osc(f, 'sawtooth', 0.18, 0.18, now + i * 0.055));
    this._noise(2500, 1, 0.3, 0.45, now + 0.05);
    this._osc(80, 'sine', 0.45, 0.45, now, 160);
  }

  evTrap() {
    const ac = this._ctx(), now = ac.currentTime;
    this._noise(2500, 0.6, 0.55, 0.35, now);
    this._osc(110, 'sawtooth', 0.45, 0.5, now, 50);
    this._osc(220, 'sawtooth', 0.3,  0.3, now + 0.05, 80);
  }

  evStun() {
    const ac = this._ctx(), now = ac.currentTime;
    this._noise(7500, 3.5, 0.6, 0.18, now);
    this._noise(4000, 2,   0.35, 0.3, now + 0.1);
    this._osc(80, 'sine', 0.55, 0.6, now, 35);
  }

  evBerserk() {
    const ac = this._ctx(), now = ac.currentTime;
    [80, 120, 160, 240, 320].forEach((f, i) => this._osc(f, 'sawtooth', 0.38 - i * 0.04, 0.5, now + i * 0.018));
    this._noise(1200, 0.5, 0.65, 0.5, now);
  }

  monsterFinish(place) {
    const ac = this._ctx(), now = ac.currentTime;
    if (place === 1) {
      [523, 659, 784, 1047, 1568].forEach((f, i) => this._osc(f, 'square', 0.24, 0.22, now + i * 0.08));
      this._noise(3000, 1, 0.4, 0.9, now);
      setTimeout(() => this.crowd(0.5, 3.2), 200);
    } else if (place === 2) {
      [440, 554, 659].forEach((f, i) => this._osc(f, 'sine', 0.2, 0.18, now + i * 0.09));
    } else if (place === 3) {
      [330, 415, 494].forEach((f, i) => this._osc(f, 'triangle', 0.15, 0.14, now + i * 0.08));
    } else {
      this._osc(220, 'triangle', 0.1, 0.1);
    }
  }

  win() {
    const ac = this._ctx(), now = ac.currentTime;
    [523, 659, 784, 659, 784, 1047, 784, 1047, 1568].forEach((f, i) =>
      this._osc(f, 'square', 0.24, 0.22, now + i * 0.1));
    setTimeout(() => {
      [523, 659, 784].forEach(f => this._osc(f, 'sine', 0.14, 2.0, ac.currentTime));
    }, 900);
    this.crowd(0.58, 3.8);
    for (let i = 0; i < 14; i++) setTimeout(() => this._noise(9500, 3.5, 0.1, 0.05), 380 + i * 75);
  }

  lose() {
    const ac = this._ctx(), now = ac.currentTime;
    // Classic sad trombone: D C B♭ A♭
    [294, 262, 233, 208].forEach((f, i) => this._osc(f, 'sawtooth', 0.28, 0.38, now + i * 0.31, f * 0.9));
    this._osc(55, 'sine', 0.2, 1.5, now, 44);
    this._noise(500, 0.5, 0.1, 1.2, now + 0.85);
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
    this._pool        = {};
    this._totalPool   = 0;
    this._lockedOdds  = 0;

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

  // ── 파리뮤추얼 풀 ────────────────────────────────────────────────────────────

  _initPool() {
    this._pool = {};
    MDEFS.forEach(m => { this._pool[m.id] = Math.round(SIM_POOL_BASE * _simWeights[m.id]); });
    this._totalPool = Object.values(this._pool).reduce((s, v) => s + v, 0);
  }

  _calcOdds(id, extraBet = 0) {
    const poolForId = (this._pool[id] || 0) + extraBet;
    const total     = this._totalPool + extraBet;
    if (!poolForId) return 99;
    return Math.max(1.05, (total * (1 - HOUSE_TAKE)) / poolForId);
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
    this._lockedOdds  = 0;
    this._initPool();

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
        <div class="rc-odds" data-mid="${m.id}" style="color:${m.clr}">${this._calcOdds(m.id).toFixed(2)}x</div>
        <div class="rc-pool" data-mid="${m.id}">🪙${(this._pool[m.id]||0).toLocaleString()}</div>
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
    // Update live odds in each card
    MDEFS.forEach(m => {
      const simBet = m.id === this._betMonster ? this._betAmount : 0;
      const odds   = this._calcOdds(m.id, simBet);
      const el = document.querySelector(`.rc-odds[data-mid="${m.id}"]`);
      if (el) el.textContent = odds.toFixed(2) + 'x';
    });
    const btn = document.getElementById('racePlaceBet');
    if (this._betLocked) return;
    if (!this._betMonster) {
      btn.textContent = '몬스터를 선택하세요';
      btn.disabled = true;
    } else {
      const m    = MDEFS.find(x => x.id === this._betMonster);
      const odds = this._calcOdds(this._betMonster, this._betAmount);
      const mult = this._betType === 'win' ? 1 : this._betType === 'place' ? PLACE_MULT : SHOW_MULT;
      const est  = Math.floor(this._betAmount * odds * mult);
      const tl   = { win:'단승', place:'복승', show:'삼복승' }[this._betType];
      btn.textContent = `${m.label}에 ${this._betAmount}코인 (${tl}) → 예상 +${est}`;
      btn.disabled = false;
    }
  }

  _placeBet() {
    if (!this._spend(this._betAmount)) {
      const btn = document.getElementById('racePlaceBet');
      btn.textContent = `❌ Not enough coins! (Need ${this._betAmount})`;
      btn.style.background = '#7f1d1d';
      setTimeout(() => {
        btn.style.background = '';
        this._updateBetUI();
      }, 2000);
      this._showModalMsg(`❌ Not enough coins!\nYou need ${this._betAmount} coins to place this bet.`);
      return;
    }
    this._lockedOdds = this._calcOdds(this._betMonster, this._betAmount);
    this._pool[this._betMonster] = (this._pool[this._betMonster] || 0) + this._betAmount;
    this._totalPool += this._betAmount;
    this._betLocked = true;
    this._audio.betPlaced();
    const btn  = document.getElementById('racePlaceBet');
    const m    = MDEFS.find(x => x.id === this._betMonster);
    const mult = this._betType === 'win' ? 1 : this._betType === 'place' ? PLACE_MULT : SHOW_MULT;
    const est  = Math.floor(this._betAmount * this._lockedOdds * mult);
    btn.textContent = `✅ Bet placed! Est. +${est} coins`;
    btn.disabled = true;
    this._showModalMsg(`✅ Bet placed on ${m.label}!\n${this._betAmount} coins · odds ${this._lockedOdds.toFixed(2)}x`);
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

    this._elapsed        = 0;
    this._raceParticles  = [];
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
      _trail:          [],
      _speed:          0,
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
    this._elapsed = (this._elapsed || 0) + dt;
    this._dt = dt;
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
      r._speed = spd;

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
    const elapsed = this._elapsed || 0;
    const dt      = this._dt      || 0.016;

    ctx.clearRect(0, 0, W, H);

    // Background radial gradient
    const bgGrad = ctx.createRadialGradient(cx, cy, innerRx * 0.4, cx, cy, outerRx * 1.4);
    bgGrad.addColorStop(0, '#1c0a00');
    bgGrad.addColorStop(1, '#080200');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Crowd silhouettes
    this._drawCrowd(ctx, cx, cy, outerRx, outerRy, elapsed);

    // Track
    this._drawTrack(ctx, cx, cy, outerRx, outerRy, innerRx, innerRy);

    // Dashed lane dividers
    ctx.save();
    ctx.setLineDash([5, 8]);
    for (let l = 1; l < MDEFS.length; l++) {
      const t = l / MDEFS.length;
      ctx.beginPath();
      ctx.ellipse(cx, cy, innerRx + t * (outerRx - innerRx), innerRy + t * (outerRy - innerRy), 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,200,100,0.10)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Finish line
    this._drawFinishLine(ctx, cx, cy, innerRx, innerRy, outerRx, outerRy, elapsed);

    // Torches
    this._drawTorches(ctx, cx, cy, outerRx, outerRy, elapsed);

    // Inner grass
    const grassGrad = ctx.createRadialGradient(cx, cy - innerRy * 0.2, 4, cx, cy, innerRx * 0.95);
    grassGrad.addColorStop(0, '#166534');
    grassGrad.addColorStop(1, '#0f3d22');
    ctx.beginPath();
    ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = grassGrad;
    ctx.fill();
    ctx.strokeStyle = '#1a7a3a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner label
    ctx.save();
    ctx.font = `bold ${Math.round(W * 0.021)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillText('🏟️ MONSTER RACE', cx, cy);
    ctx.restore();

    // Update & render particles
    this._updateParticles(dt);
    (this._raceParticles || []).forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Progress bars
    const barAreaW = innerRx * 2 - 16;
    const barH     = Math.min(10, (innerRy * 2 - 12) / MDEFS.length);
    const leader   = this._runners.reduce((a, b) => a.progress > b.progress ? a : b);

    this._runners.forEach((r, i) => {
      const bx   = cx - innerRx + 8;
      const by   = cy - innerRy + 5 + i * (barH + 2);
      const fill = Math.min(r.progress / RACE_LAPS, 1) * barAreaW;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, barAreaW, barH);
      if (fill > 0) {
        const bg = ctx.createLinearGradient(bx, by, bx + fill, by);
        bg.addColorStop(0, r.clr + 'aa');
        bg.addColorStop(1, r.id === leader.id && !r.finished ? r.clr + 'ff' : r.clr + 'cc');
        ctx.fillStyle = bg;
        ctx.fillRect(bx, by, fill, barH);
      }
      if (barH >= 7) {
        ctx.font = `bold ${Math.min(7, barH)}px sans-serif`;
        ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
        const placeStr = r.finishPlace ? ` ${r.finishPlace}위` : (r.id === leader.id ? ' 선두' : '');
        ctx.fillText(`${r.label}${placeStr}`, bx + 2, by + barH / 2 + 0.5);
      }
    });

    // Runners
    const R = Math.max(14, Math.min(20, W * 0.026));
    this._runners.forEach((r, i) => {
      const t     = (i + 0.5) / MDEFS.length;
      const rx    = innerRx + t * (outerRx - innerRx);
      const ry    = innerRy + t * (outerRy - innerRy);
      const angle = -Math.PI / 2 + r.startOffset + (r.progress / RACE_LAPS) * 2 * Math.PI;
      const baseX = cx + rx * Math.cos(angle);
      const baseY = cy + ry * Math.sin(angle);
      const bounce = r.effectType === 'stun' ? 0 : Math.sin(elapsed * 13 + i * 1.4) * 3;
      const px = baseX;
      const py = baseY + bounce;

      // Update motion trail
      if (!r._trail) r._trail = [];
      r._trail.push({ x: px, y: py });
      if (r._trail.length > 5) r._trail.shift();

      // Draw trail
      r._trail.forEach((pos, ti) => {
        const ta = ((ti + 1) / r._trail.length) * 0.3;
        ctx.save();
        ctx.globalAlpha = ta;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, R * 0.52, 0, Math.PI * 2);
        ctx.fillStyle = r.clr;
        ctx.fill();
        ctx.restore();
      });

      // Shadow ellipse
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.ellipse(px, py + R * 0.65, R * 0.65, R * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();

      // Effect radial glow
      if (r.effectType) {
        const glowCols = {
          boost:   ['#f97316', '#f9731600'],
          trap:    ['#ef4444', '#ef444400'],
          stun:    ['#a78bfa', '#a78bfa00'],
          berserk: ['#dc2626', '#dc262600'],
        };
        const [c0, c1] = glowCols[r.effectType] || ['#ffffff', '#ffffff00'];
        const gg = ctx.createRadialGradient(px, py, R * 0.4, px, py, R + 11);
        gg.addColorStop(0, c0 + 'bb');
        gg.addColorStop(1, c1);
        ctx.beginPath();
        ctx.arc(px, py, R + 11, 0, Math.PI * 2);
        ctx.fillStyle = gg;
        ctx.fill();

        // Emit particles
        if ((r.effectType === 'boost' || r.effectType === 'berserk') && Math.random() < 0.45) {
          this._emitParticle(px, py, r.effectType === 'berserk' ? '#dc2626' : '#f97316');
        } else if (r.effectType === 'stun' && Math.random() < 0.25) {
          this._emitParticle(px, py, '#a78bfa');
        }
      }

      // Leader pulsing ring
      if (r.id === leader.id && !r.finished) {
        const pr = R + 4 + Math.sin(elapsed * 5) * 2;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Monster image (clipped)
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, R, 0, Math.PI * 2);
      ctx.clip();
      const img = this._imgs[r.id];
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, px - R, py - R, R * 2, R * 2);
      } else {
        ctx.fillStyle = r.clr;
        ctx.fill();
      }
      ctx.restore();

      // Outline
      ctx.beginPath();
      ctx.arc(px, py, R, 0, Math.PI * 2);
      ctx.strokeStyle = r.finished ? '#fbbf24' : (r.id === this._betMonster ? '#fff' : 'rgba(255,255,255,0.45)');
      ctx.lineWidth   = r.finished ? 2.5 : (r.id === this._betMonster ? 2.5 : 1.5);
      ctx.stroke();

      // Bet arrow
      if (r.id === this._betMonster) {
        ctx.font = `bold ${Math.min(9, R * 0.55)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('▲', px, py - R - 2);
      }

      // Leader crown (floating, pulsing)
      if (r.id === leader.id && !r.finished) {
        const ca = 0.65 + Math.sin(elapsed * 3) * 0.35;
        ctx.save();
        ctx.globalAlpha = ca;
        ctx.font = `${Math.round(R * 0.9)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('👑', px, py - R - 4);
        ctx.restore();
      }

      // Finish medal overlay
      if (r.finishPlace) {
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'];
        ctx.font = `${Math.round(R * 0.85)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(medals[r.finishPlace - 1], px, py - R - 2);
      }
    });
  }

  _updateParticles(dt) {
    if (!this._raceParticles) return;
    this._raceParticles = this._raceParticles.filter(p => {
      p.x += p.vx * dt * 55;
      p.y += p.vy * dt * 55;
      p.vy += 0.09;
      p.alpha -= dt * 2.8;
      p.r *= 0.96;
      return p.alpha > 0.02 && p.r > 0.4;
    });
  }

  _emitParticle(x, y, color) {
    if (!this._raceParticles) this._raceParticles = [];
    if (this._raceParticles.length >= 80) return;
    const angle = Math.random() * Math.PI * 2;
    const spd   = 0.5 + Math.random() * 1.8;
    this._raceParticles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 1.6,
      alpha: 0.85 + Math.random() * 0.15,
      r: 2 + Math.random() * 2.5,
      color,
    });
  }

  _drawTrack(ctx, cx, cy, outerRx, outerRy, innerRx, innerRy) {
    // Outer border glow
    ctx.beginPath();
    ctx.ellipse(cx, cy, outerRx + 22, outerRy + 22, 0, 0, Math.PI * 2);
    const borderGrad = ctx.createRadialGradient(cx, cy, outerRx, cx, cy, outerRx + 24);
    borderGrad.addColorStop(0, '#3d1c08');
    borderGrad.addColorStop(1, '#160800');
    ctx.fillStyle = borderGrad;
    ctx.fill();

    // Dirt track surface
    ctx.beginPath();
    ctx.ellipse(cx, cy, outerRx, outerRy, 0, 0, Math.PI * 2);
    const trackGrad = ctx.createRadialGradient(cx - outerRx * 0.25, cy - outerRy * 0.2, 8, cx, cy, outerRx * 1.05);
    trackGrad.addColorStop(0, '#8b4513');
    trackGrad.addColorStop(0.45, '#7b3a1a');
    trackGrad.addColorStop(1, '#4e2208');
    ctx.fillStyle = trackGrad;
    ctx.fill();
  }

  _drawCrowd(ctx, cx, cy, outerRx, outerRy, elapsed) {
    const n = 28;
    const palette = ['#e74c3c','#3498db','#f39c12','#2ecc71','#9b59b6','#e67e22','#1abc9c','#e91e63'];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const er  = outerRx + 32 + Math.sin(i * 1.7) * 6;
      const ery = outerRy + 30 + Math.cos(i * 2.3) * 5;
      const bx  = cx + er  * Math.cos(ang);
      const by  = cy + ery * Math.sin(ang);
      const h   = 13 + Math.sin(i * 0.8) * 3;
      const ww  = 5 + Math.cos(i * 1.2) * 1.3;
      const wave = Math.sin(elapsed * 2.2 + i * 0.55) * 3;
      ctx.fillStyle = palette[i % palette.length] + '77';
      ctx.fillRect(bx - ww / 2, by - h - wave, ww, h);
      ctx.beginPath();
      ctx.arc(bx, by - h - wave, ww * 0.58, 0, Math.PI * 2);
      ctx.fillStyle = '#c8a882aa';
      ctx.fill();
    }
  }

  _drawTorches(ctx, cx, cy, outerRx, outerRy, elapsed) {
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
      const tx = cx + dx * (outerRx + 16);
      const ty = cy + dy * (outerRy + 16);
      const flicker = 0.82 + Math.random() * 0.36;
      const gr = ctx.createRadialGradient(tx, ty, 2, tx, ty, 20 * flicker);
      gr.addColorStop(0,   'rgba(255,170,20,0.88)');
      gr.addColorStop(0.4, 'rgba(255,80,10,0.38)');
      gr.addColorStop(1,   'rgba(255,40,0,0)');
      ctx.beginPath();
      ctx.arc(tx, ty, 20 * flicker, 0, Math.PI * 2);
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.font = `${Math.round(15 * flicker)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🔥', tx, ty);
    });
  }

  _drawFinishLine(ctx, cx, cy, innerRx, innerRy, outerRx, outerRy, elapsed) {
    const yTop = cy - outerRy + 4;
    const yBot = cy - innerRy - 4;
    const lineH = yBot - yTop;
    const lineW = Math.max(6, (outerRx - innerRx) * 0.22);
    const segs  = 6;
    const segH  = lineH / segs;
    for (let s = 0; s < segs; s++) {
      const bright = (s % 2 === 0)
        ? 0.75 + Math.sin(elapsed * 5 + s) * 0.2
        : 0.15 + Math.cos(elapsed * 5 + s) * 0.08;
      const v = Math.round(bright * 255);
      ctx.fillStyle = `rgba(${v},${v},${v},0.92)`;
      ctx.fillRect(cx - lineW / 2, yTop + s * segH, lineW, segH);
    }
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
      const multMap = { win: place === 1 ? 1 : 0, place: place >= 1 && place <= 2 ? PLACE_MULT : 0, show: place >= 1 && place <= 3 ? SHOW_MULT : 0 };
      const mult    = multMap[this._betType] ?? 0;
      if (mult > 0) {
        payout = Math.floor(this._betAmount * (this._lockedOdds || m.odds) * mult);
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
      const betM   = MDEFS.find(x => x.id === this._betMonster);
      const place  = this._finishOrder.indexOf(this._betMonster) + 1;
      const net    = won ? payout - this._betAmount : -this._betAmount;
      const netStr = net >= 0 ? `+${net}` : `${net}`;
      if (won) {
        betMsg = `
          <div class="race-win-msg">
            🎉 ${betM.label} finished ${place}${_ordinal(place)}!
            <div style="font-size:14px;margin-top:6px;opacity:.85">
              Received: +${payout} 🪙 &nbsp;|&nbsp; Bet: −${this._betAmount} 🪙
            </div>
            <div style="font-size:22px;margin-top:4px">Net: ${netStr} 🪙</div>
          </div>`;
      } else {
        betMsg = `
          <div class="race-lose-msg">
            😢 ${betM.label} finished ${place}${_ordinal(place)}
            <div style="font-size:18px;font-weight:800;margin-top:6px">Net: ${netStr} 🪙</div>
          </div>`;
      }
    } else if (!this._betLocked) {
      betMsg = `<div class="race-no-bet-msg">👀 You didn't place a bet this round.</div>`;
    }

    const orderRows = this._finishOrder.map((id, i) => {
      const m    = MDEFS.find(x => x.id === id);
      const mine = id === this._betMonster;
      const oddsLabel = mine && this._lockedOdds ? `${this._lockedOdds.toFixed(2)}x ★` : `${this._calcOdds(m.id).toFixed(2)}x`;
      return `<div class="race-order-row${mine ? ' my-bet' : ''}">
        <img src="${m.img}" class="race-order-icon" alt="${m.label}">
        <span>${medals[i]} ${m.label}</span>
        <span style="color:${m.clr};margin-left:auto">${oddsLabel}</span>
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

  _showModalMsg(msg) {
    // Shows inside the race panel so it's always visible above the modal overlay
    const existing = this._modal?.querySelector('.race-inline-msg');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'race-inline-msg';
    el.innerHTML = msg.replace(/\n/g, '<br>');
    this._modal?.querySelector('.race-panel')?.appendChild(el);
    setTimeout(() => el.remove(), 2800);
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

function _ordinal(n) {
  const v = n % 10, h = n % 100;
  if (h >= 11 && h <= 13) return 'th';
  return ['th','st','nd','rd'][v] || 'th';
}

// ── Public API ────────────────────────────────────────────────────────────────

let _instance = null;
export function initRaceGame(opts) { _instance = new MonsterRace(opts); }
export function openRaceGame()     { _instance?.open(); }
