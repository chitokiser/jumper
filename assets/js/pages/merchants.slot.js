// /assets/js/pages/merchants.slot.js
// 슬롯 머신 미니게임 — merchants.js에서 initSlotMachine()으로 초기화
'use strict';

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { functions }     from '../firebase-init.js';

// ── 심볼 정의 (서버와 동일 순서) ────────────────────────────────────────────
const SYMBOLS = {
  // normal
  arms:    { img: '/assets/images/shops/arms.png',    label: 'Arms Shop',     rarity: 'normal' },
  bakery:  { img: '/assets/images/shops/bakery.png',  label: 'Bakery',        rarity: 'normal' },
  cafe:    { img: '/assets/images/shops/cafe.png',    label: 'Cafe',          rarity: 'normal' },
  eat:     { img: '/assets/images/shops/eat.png',     label: 'Restaurant',    rarity: 'normal' },
  info:    { img: '/assets/images/shops/info.png',    label: 'Info',          rarity: 'normal' },
  korea:   { img: '/assets/images/shops/korea.png',   label: 'Korean BBQ',    rarity: 'normal' },
  pub:     { img: '/assets/images/shops/pub.png',     label: 'Pub',           rarity: 'normal' },
  shop2:   { img: '/assets/images/shops/shop2.png',   label: 'General Store', rarity: 'normal' },
  // rare
  golf:    { img: '/assets/images/shops/golf.png',    label: 'Golf',          rarity: 'rare'   },
  japan:   { img: '/assets/images/shops/japan.png',   label: 'Japanese',      rarity: 'rare'   },
  massage: { img: '/assets/images/shops/massage.png', label: 'Massage',       rarity: 'rare'   },
  park:    { img: '/assets/images/shops/park.png',    label: 'Park',          rarity: 'rare'   },
  pool:    { img: '/assets/images/shops/pool.png',    label: 'Pool',          rarity: 'rare'   },
  sanghai: { img: '/assets/images/shops/sanghai.png', label: 'Shanghai',      rarity: 'hero'   },
  // hero
  castle:  { img: '/assets/images/shops/castle.png',  label: 'Castle',        rarity: 'hero'   },
  ship:    { img: '/assets/images/shops/ship.png',    label: 'Ship',          rarity: 'hero'   },
  tower:   { img: '/assets/images/shops/tower.png',   label: 'Tower',         rarity: 'hero'   },
  venice:  { img: '/assets/images/shops/venice.png',  label: 'Venice',        rarity: 'hero'   },
  // legend
  tower2:  { img: '/assets/images/shops/tower2.png',  label: 'Golden Tower',  rarity: 'legend' },
};
const SYMBOL_IDS = Object.keys(SYMBOLS);

const BET_OPTIONS    = [10, 20, 50, 100];
const DEFAULT_BET    = 10;
const AUTO_SPIN_COUNT = 10;
const REEL_GAP_MS    = 500;
const MIN_SPIN_MS    = 1800;
const CYCLE_MS       = 100;

const RARITY_COLOR = { normal: '#ccc', rare: '#4af', hero: '#fa4', legend: '#fd1' };
// Outcome labels use {bet} placeholder — filled at runtime with actual reward
const OUTCOME_LABELS = {
  normal_match: (r) => `Normal Triple! +${r} 💰`,
  rare_match:   (r) => `Rare Triple! +${r} 💰`,
  hero_match:   (r) => `Hero Triple! +${r} 💰`,
  jackpot:      (r) => `🎉 Jackpot! +${r} 💰`,
  two_normal:   (r) => `2 Match! +${r} 💰`,
  two_match:    (r) => `Rare 2 Match! +${r} 💰`,
  miss:         ()  => 'So close...',
};

// ── SlotMachine 클래스 ───────────────────────────────────────────────────────
class SlotMachine {
  constructor({ onSpendGold, onAddGold, onPlaySound }) {
    this._spendGold  = onSpendGold;
    this._addGold    = onAddGold;
    this._playSound  = onPlaySound;
    this._spinFn     = httpsCallable(functions, 'spinSlot');
    this._jackpotFn  = httpsCallable(functions, 'getSlotJackpot');

    this._modal      = null;
    this._reelEls    = [];
    this._jackpotEl  = null;
    this._toastEl    = null;
    this._spinBtn    = null;
    this._freeBtn    = null;
    this._autoBtn    = null;

    this._cycling    = [null, null, null];
    this._spinning   = false;
    this._autoMode   = false;
    this._autoLeft   = 0;
    this._bet        = DEFAULT_BET;

    this._buildModal();
    this._bindEvents();
    this._refreshJackpot();
  }

  // ── 모달 생성 ──────────────────────────────────────────────────────────────
  _buildModal() {
    const existing = document.getElementById('slotModal');
    if (existing) { this._modal = existing; this._cacheRefs(); return; }

    const m = document.createElement('div');
    m.id = 'slotModal';
    m.className = 'sm-modal hidden';
    m.innerHTML = `
      <div class="sm-overlay" id="smOverlay"></div>
      <div class="sm-panel">
        <div class="sm-header">
          <span class="sm-title">🎰 Slot Machine</span>
          <div class="sm-jackpot-display">
            <span class="sm-jackpot-label">JACKPOT</span>
            <span class="sm-jackpot-val" id="smJackpot">1000</span>
          </div>
          <button class="sm-close-btn" id="smCloseBtn">✕</button>
        </div>

        <div class="sm-reels" id="smReels">
          <div class="sm-reel" id="smReel0"><img src="" alt=""></div>
          <div class="sm-reel" id="smReel1"><img src="" alt=""></div>
          <div class="sm-reel" id="smReel2"><img src="" alt=""></div>
        </div>

        <div class="sm-toast hidden" id="smToast"></div>

        <div class="sm-paytable">
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#fd1">🏆 Golden Tower × 3</span><span class="sm-pay-val">JACKPOT</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#fa4">⭐ Hero Shop × 3</span><span class="sm-pay-val">×500 bet</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#4af">💎 Rare Shop × 3</span><span class="sm-pay-val">×100 bet</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#ccc">🏪 Normal Shop × 3</span><span class="sm-pay-val">×30 bet</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#4af">💎 Rare+ 2 Match</span><span class="sm-pay-val">×15 bet</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#aaa">🏪 Normal 2 Match</span><span class="sm-pay-val">×3 bet</span></div>
        </div>

        <div class="sm-bet-row" id="smBetRow">
          <span class="sm-bet-label">Bet:</span>
          ${BET_OPTIONS.map(b => `<button class="sm-bet-btn${b===DEFAULT_BET?' active':''}" data-bet="${b}">${b} 💰</button>`).join('')}
        </div>

        <div class="sm-controls">
          <button class="sm-btn sm-btn-free" id="smFreeBtn">🎁 Free Spin</button>
          <button class="sm-btn sm-btn-spin" id="smSpinBtn">🎰 Spin (−${DEFAULT_BET} 💰)</button>
          <button class="sm-btn sm-btn-auto" id="smAutoBtn">⚡ Auto ×${AUTO_SPIN_COUNT}</button>
        </div>

        <div class="sm-jackpot-anim hidden" id="smJackpotAnim">
          <div class="sm-jackpot-text">🏆 JACKPOT 🏆</div>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    this._modal = m;
    this._cacheRefs();
  }

  _cacheRefs() {
    this._reelEls   = [0, 1, 2].map(i => document.getElementById(`smReel${i}`));
    this._jackpotEl = document.getElementById('smJackpot');
    this._toastEl   = document.getElementById('smToast');
    this._spinBtn   = document.getElementById('smSpinBtn');
    this._freeBtn   = document.getElementById('smFreeBtn');
    this._autoBtn   = document.getElementById('smAutoBtn');
    this._jackpotAnim = document.getElementById('smJackpotAnim');

    // 초기 심볼 설정
    this._reelEls.forEach(el => this._setReelSymbol(el, 'arms'));
  }

  _bindEvents() {
    document.getElementById('smCloseBtn')?.addEventListener('click', () => this.close());
    document.getElementById('smOverlay')?.addEventListener('click',  () => this.close());
    document.getElementById('smSpinBtn')?.addEventListener('click',  () => this._doSpin(false));
    document.getElementById('smFreeBtn')?.addEventListener('click',  () => this._doSpin(true));
    document.getElementById('smAutoBtn')?.addEventListener('click',  () => this._startAuto());
    document.getElementById('smBetRow')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bet]');
      if (!btn || this._spinning) return;
      this._bet = parseInt(btn.dataset.bet, 10);
      document.querySelectorAll('.sm-bet-btn').forEach(b => b.classList.toggle('active', b === btn));
      const spinBtn = document.getElementById('smSpinBtn');
      if (spinBtn) spinBtn.textContent = `🎰 Spin (−${this._bet} 💰)`;
    });
  }

  // ── 공개 API ───────────────────────────────────────────────────────────────
  open() {
    if (!this._modal) return;
    this._modal.classList.remove('hidden');
    this._checkFreeSpinAvail();
    this._refreshJackpot();
  }

  close() {
    if (!this._modal) return;
    this._stopAllCycling();
    this._autoMode = false;
    this._autoLeft = 0;
    this._modal.classList.add('hidden');
  }

  // ── 무료 스핀 가용성 확인 (localStorage 캐시) ───────────────────────────────
  _checkFreeSpinAvail() {
    const today = new Date().toISOString().slice(0, 10);
    const used  = localStorage.getItem('slotFreeDate');
    if (this._freeBtn) {
      this._freeBtn.disabled = (used === today);
      this._freeBtn.textContent = (used === today) ? '🎁 Free Used' : '🎁 Free Spin';
    }
  }

  _markFreeUsed() {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('slotFreeDate', today);
    this._checkFreeSpinAvail();
  }

  // ── 잭팟 표시 갱신 ─────────────────────────────────────────────────────────
  async _refreshJackpot() {
    try {
      const res = await this._jackpotFn();
      if (this._jackpotEl) this._jackpotEl.textContent = res.data.pool;
    } catch (_) {}
  }

  // ── 릴 심볼 설정 ──────────────────────────────────────────────────────────
  _setReelSymbol(el, id) {
    const sym = SYMBOLS[id] ?? SYMBOLS.arms;
    const img = el.querySelector('img');
    if (img) {
      img.src = sym.img;
      img.alt = sym.label;
    }
    el.dataset.rarity = sym.rarity;
    el.style.borderColor = RARITY_COLOR[sym.rarity] ?? '#ccc';
  }

  _randomSymbolId() {
    return SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
  }

  // ── 사이클링 (스핀 중 애니메이션) ─────────────────────────────────────────
  _startCycling(reelEl) {
    return setInterval(() => {
      reelEl.classList.add('sm-spinning');
      this._setReelSymbol(reelEl, this._randomSymbolId());
    }, CYCLE_MS);
  }

  _stopAllCycling() {
    this._cycling.forEach(id => { if (id) clearInterval(id); });
    this._cycling = [null, null, null];
    this._reelEls.forEach(el => el.classList.remove('sm-spinning'));
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── 스핀 실행 ──────────────────────────────────────────────────────────────
  async _doSpin(isFree) {
    if (this._spinning) return;

    const betAmt = isFree ? 10 : this._bet; // free spin always uses min bet for reward calc

    if (!isFree) {
      const ok = this._spendGold(betAmt);
      if (!ok) {
        this._showToast('Not enough gold!');
        return;
      }
    }

    this._spinning = true;
    this._setControls(false);

    // 모든 릴 사이클링 시작
    this._cycling = this._reelEls.map(el => this._startCycling(el));

    let result;
    try {
      const [res] = await Promise.all([
        this._spinFn({ isFree }),
        this._delay(MIN_SPIN_MS),
      ]);
      result = res.data;
    } catch (err) {
      this._stopAllCycling();
      this._spinning = false;
      this._setControls(true);
      const msg = err.message === 'FREE_USED' ? 'Free spin already used today.' : 'An error occurred.';
      this._showToast(msg);
      if (!isFree) this._addGold(betAmt);
      return;
    }

    // 릴 하나씩 정지
    for (let i = 0; i < 3; i++) {
      clearInterval(this._cycling[i]);
      this._cycling[i] = null;
      const reelEl = this._reelEls[i];
      reelEl.classList.remove('sm-spinning');
      this._setReelSymbol(reelEl, result.reels[i].id);
      this._playSound('hit');
      if (i < 2) await this._delay(REEL_GAP_MS);
    }

    await this._delay(200);

    // 결과 처리 — reward scaled by bet multiplier (server base = 10 coins)
    const mult = betAmt / 10;
    if (result.outcome === 'jackpot') {
      this._onJackpot(result, mult);
    } else if (result.reward > 0) {
      const actualReward = Math.round(result.reward * mult);
      this._addGold(actualReward);
      this._playSound('slot_win');
      const labelFn = OUTCOME_LABELS[result.outcome];
      this._showToast(labelFn ? labelFn(actualReward) : `+${actualReward} 💰`);
    } else {
      this._playSound('miss');
      this._showToast(OUTCOME_LABELS.miss());
    }

    if (isFree) this._markFreeUsed();
    if (this._jackpotEl) this._jackpotEl.textContent = result.jackpotPool;

    this._spinning = false;
    this._setControls(true);

    // 자동 스핀 계속
    if (this._autoMode && this._autoLeft > 0) {
      this._autoLeft--;
      if (this._autoLeft === 0) {
        this._autoMode = false;
        this._showToast('Auto-spin complete!');
      } else {
        await this._delay(600);
        this._doSpin(false);
      }
    }
  }

  // ── 자동 스핀 ──────────────────────────────────────────────────────────────
  _startAuto() {
    if (this._spinning) return;
    this._autoMode = true;
    this._autoLeft = AUTO_SPIN_COUNT - 1; // 첫 스핀 포함
    this._doSpin(false);
  }

  // ── 잭팟 연출 ──────────────────────────────────────────────────────────────
  _onJackpot(result, mult = 1) {
    const won = Math.round(result.jackpotWon * mult);
    this._addGold(won);
    this._playSound('levelup');
    if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 100, 50, 200]);

    if (this._jackpotAnim) {
      this._jackpotAnim.classList.remove('hidden');
      this._jackpotAnim.querySelector('.sm-jackpot-text').textContent =
        `🏆 JACKPOT +${won} 💰 🏆`;
      setTimeout(() => this._jackpotAnim?.classList.add('hidden'), 3500);
    }

    const panel = this._modal?.querySelector('.sm-panel');
    panel?.classList.add('sm-shake');
    setTimeout(() => panel?.classList.remove('sm-shake'), 600);

    this._showToast(`🎉 Jackpot! +${won} 💰`);
  }

  // ── UI 헬퍼 ───────────────────────────────────────────────────────────────
  _setControls(enabled) {
    if (this._spinBtn) this._spinBtn.disabled = !enabled;
    if (this._autoBtn) this._autoBtn.disabled = !enabled;
    const today = new Date().toISOString().slice(0, 10);
    const freeUsed = localStorage.getItem('slotFreeDate') === today;
    if (this._freeBtn) this._freeBtn.disabled = !enabled || freeUsed;
  }

  _showToast(msg) {
    if (!this._toastEl) return;
    this._toastEl.textContent = msg;
    this._toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._toastEl?.classList.add('hidden'), 2500);
  }
}

// ── 싱글톤 ──────────────────────────────────────────────────────────────────
let _machine = null;

export function initSlotMachine({ onSpendGold, onAddGold, onPlaySound }) {
  _machine = new SlotMachine({ onSpendGold, onAddGold, onPlaySound });
}

export function openSlotMachine() {
  _machine?.open();
}
