// /assets/js/pages/merchants.slot.js
// 슬롯 머신 미니게임 — merchants.js에서 initSlotMachine()으로 초기화
'use strict';

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { functions }     from '../firebase-init.js';

// ── 심볼 정의 (서버와 동일 순서) ────────────────────────────────────────────
const SYMBOLS = {
  // normal
  arms:    { img: '/assets/images/shops/arms.png',    label: '무기상점', rarity: 'normal' },
  bakery:  { img: '/assets/images/shops/bakery.png',  label: '베이커리', rarity: 'normal' },
  cafe:    { img: '/assets/images/shops/cafe.png',    label: '카페',     rarity: 'normal' },
  eat:     { img: '/assets/images/shops/eat.png',     label: '식당',     rarity: 'normal' },
  info:    { img: '/assets/images/shops/info.png',    label: '안내소',   rarity: 'normal' },
  korea:   { img: '/assets/images/shops/korea.png',   label: '한식당',   rarity: 'normal' },
  pub:     { img: '/assets/images/shops/pub.png',     label: '펍',       rarity: 'normal' },
  shop2:   { img: '/assets/images/shops/shop2.png',   label: '잡화점',   rarity: 'normal' },
  // rare
  golf:    { img: '/assets/images/shops/golf.png',    label: '골프장',   rarity: 'rare'   },
  japan:   { img: '/assets/images/shops/japan.png',   label: '일식당',   rarity: 'rare'   },
  massage: { img: '/assets/images/shops/massage.png', label: '마사지',   rarity: 'rare'   },
  park:    { img: '/assets/images/shops/park.png',    label: '파크',     rarity: 'rare'   },
  pool:    { img: '/assets/images/shops/pool.png',    label: '풀장',     rarity: 'rare'   },
  sanghai: { img: '/assets/images/shops/sanghai.png', label: '상하이',   rarity: 'hero'   },
  // hero
  castle:  { img: '/assets/images/shops/castle.png',  label: '성',       rarity: 'hero'   },
  ship:    { img: '/assets/images/shops/ship.png',    label: '선박',     rarity: 'hero'   },
  tower:   { img: '/assets/images/shops/tower.png',   label: '타워',     rarity: 'hero'   },
  venice:  { img: '/assets/images/shops/venice.png',  label: '베니스',   rarity: 'hero'   },
  // legend
  tower2:  { img: '/assets/images/shops/tower2.png',  label: '황금탑',   rarity: 'legend' },
};
const SYMBOL_IDS = Object.keys(SYMBOLS);

const ENTRY_COST     = 10;
const AUTO_SPIN_COUNT = 10;
const REEL_GAP_MS    = 500;
const MIN_SPIN_MS    = 1800;
const CYCLE_MS       = 100;

const RARITY_COLOR = { normal: '#ccc', rare: '#4af', hero: '#fa4', legend: '#fd1' };
const OUTCOME_LABELS = {
  normal_match: '일반 트리플! +300',
  rare_match:   '레어 트리플! +1000',
  hero_match:   '영웅 트리플! +5000',
  jackpot:      '🎉 잭팟!!!',
  two_match:    '2개 일치! +150',
  miss:         '아쉽네요...',
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
          <span class="sm-title">🎰 슬롯 머신</span>
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
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#fd1">🏆 황금탑 × 3</span><span class="sm-pay-val">JACKPOT</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#fa4">⭐ 영웅상점 × 3</span><span class="sm-pay-val">+5000</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#4af">💎 레어상점 × 3</span><span class="sm-pay-val">+1000</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#ccc">🏪 일반상점 × 3</span><span class="sm-pay-val">+300</span></div>
          <div class="sm-pay-row"><span class="sm-pay-sym" style="color:#aaa">2개 일치</span><span class="sm-pay-val">+150</span></div>
        </div>

        <div class="sm-controls">
          <button class="sm-btn sm-btn-free" id="smFreeBtn">🎁 무료 스핀</button>
          <button class="sm-btn sm-btn-spin" id="smSpinBtn">🎰 스핀 (−${ENTRY_COST} 💰)</button>
          <button class="sm-btn sm-btn-auto" id="smAutoBtn">⚡ 자동 ×${AUTO_SPIN_COUNT}</button>
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
      this._freeBtn.textContent = (used === today) ? '🎁 무료 사용됨' : '🎁 무료 스핀';
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

    if (!isFree) {
      const ok = this._spendGold(ENTRY_COST);
      if (!ok) {
        this._showToast('골드가 부족합니다!');
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
      const msg = err.message === 'FREE_USED' ? '오늘 무료 스핀은 이미 사용했습니다.' : '오류가 발생했습니다.';
      this._showToast(msg);
      // 골드 환불
      if (!isFree) this._addGold(ENTRY_COST);
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

    // 결과 처리
    if (result.outcome === 'jackpot') {
      this._onJackpot(result);
    } else if (result.reward > 0) {
      this._addGold(result.reward);
      this._playSound('slot_win');
      this._showToast(OUTCOME_LABELS[result.outcome] ?? `+${result.reward}`);
    } else {
      this._playSound('miss');
      this._showToast(OUTCOME_LABELS.miss);
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
        this._showToast('자동 스핀 완료!');
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
  _onJackpot(result) {
    this._addGold(result.jackpotWon);
    this._playSound('levelup');
    if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 100, 50, 200]);

    // 잭팟 전체화면 연출
    if (this._jackpotAnim) {
      this._jackpotAnim.classList.remove('hidden');
      this._jackpotAnim.querySelector('.sm-jackpot-text').textContent =
        `🏆 JACKPOT +${result.jackpotWon} 💰 🏆`;
      setTimeout(() => this._jackpotAnim?.classList.add('hidden'), 3500);
    }

    // 패널 흔들기
    const panel = this._modal?.querySelector('.sm-panel');
    panel?.classList.add('sm-shake');
    setTimeout(() => panel?.classList.remove('sm-shake'), 600);

    this._showToast(`🎉 잭팟! +${result.jackpotWon} 골드!`);
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
