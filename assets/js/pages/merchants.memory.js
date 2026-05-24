// /assets/js/pages/merchants.memory.js
// 기억력 게임 (Memory Match) — merchants.js에서 initMemoryGame()으로 초기화
'use strict';

// ── 카드 이미지 정의 (45종) ────────────────────────────────────────────────────
// 일부 파일은 .PNG (대문자) — 브라우저는 대소문자 구분하므로 정확히 명시
const CARD_IMAGES = [
  // 숫자 아이템 (0–20)
  ...Array.from({ length: 21 }, (_, i) => `/assets/images/item/${i}.png`),
  // 일반 아이템 (.png)
  '/assets/images/item/armor.png',
  '/assets/images/item/axe.png',
  '/assets/images/item/bag.png',
  '/assets/images/item/belts.png',
  '/assets/images/item/boots.png',
  '/assets/images/item/box.png',
  '/assets/images/item/coins.png',
  '/assets/images/item/frame.png',
  '/assets/images/item/gem.png',
  '/assets/images/item/helmets.png',
  '/assets/images/item/hp.png',
  '/assets/images/item/ingots.png',
  '/assets/images/item/mp.png',
  '/assets/images/item/pants.png',
  '/assets/images/item/scroll.png',
  '/assets/images/item/shield.png',
  '/assets/images/item/shoulders.png',
  '/assets/images/item/sword.png',
  // 대문자 확장자 (.PNG)
  '/assets/images/item/book.PNG',
  '/assets/images/item/bracers.PNG',
  '/assets/images/item/cloaks.PNG',
  '/assets/images/item/gloves.PNG',
  '/assets/images/item/necklace.PNG',
  '/assets/images/item/rings.PNG',
];

const TOTAL_PAIRS = 12; // 12쌍 = 24장
const COLS        = 4;
const ROWS        = 6;  // 4×6 = 24 cards = 12 pairs
const ENTRY_COST  = 100;
const MATCH_REWARD = 20;
const COMBO_BONUS  = 50;
const COMBO_TRIGGER = 3;
const MAX_MISS     = 10;
const CLEAR_BONUS_GOLD = 500;
const CLEAR_BONUS_XP   = 1000;

const LS_KEY = 'memoryGame_stats';

// ── MemoryGame 클래스 ──────────────────────────────────────────────────────────
class MemoryGame {
  constructor({ onSpendGold, onAddGold, onAddExp, onPlaySound }) {
    this._spendGold = onSpendGold;
    this._addGold   = onAddGold;
    this._addExp    = onAddExp;
    this._playSound = onPlaySound;

    // DOM refs (set in _buildModal)
    this._modal      = null;
    this._grid       = null;
    this._hudCoin    = null;
    this._hudMiss    = null;
    this._hudMatch   = null;
    this._hudCombo   = null;

    // game state
    this._cards      = [];   // [{el, img, pairId, flipped, matched}]
    this._flipped    = [];   // currently face-up (up to 2)
    this._locked     = false;
    this._miss       = 0;
    this._match      = 0;
    this._combo      = 0;
    this._coinDelta  = 0;    // net gold earned this game
    this._running    = false;

    this._buildModal();
    this._bindClose();
  }

  // ── 모달 생성 ────────────────────────────────────────────────────────────────
  _buildModal() {
    const existing = document.getElementById('memoryGameModal');
    if (existing) { this._modal = existing; this._cacheRefs(); return; }

    const m = document.createElement('div');
    m.id = 'memoryGameModal';
    m.className = 'mg-modal hidden';
    m.innerHTML = `
      <div class="mg-overlay" id="mgOverlay"></div>
      <div class="mg-panel">
        <div class="mg-header">
          <span class="mg-title">🃏 기억력 게임</span>
          <div class="mg-hud">
            <span class="mg-hud-item"><span class="mg-hud-label">COIN</span><span class="mg-hud-val" id="mgCoin">+0</span></span>
            <span class="mg-hud-sep">|</span>
            <span class="mg-hud-item"><span class="mg-hud-label">MISS</span><span class="mg-hud-val" id="mgMiss">0/10</span></span>
            <span class="mg-hud-sep">|</span>
            <span class="mg-hud-item"><span class="mg-hud-label">MATCH</span><span class="mg-hud-val" id="mgMatch">0/45</span></span>
          </div>
          <button class="mg-close-btn" id="mgCloseBtn">✕</button>
        </div>
        <div class="mg-combo-toast hidden" id="mgComboToast"></div>
        <div class="mg-grid" id="mgGrid"></div>
        <div class="mg-result hidden" id="mgResult">
          <div class="mg-result-content">
            <div class="mg-result-icon" id="mgResultIcon">🏆</div>
            <div class="mg-result-title" id="mgResultTitle">클리어!</div>
            <div class="mg-result-sub" id="mgResultSub"></div>
            <div class="mg-result-stats" id="mgResultStats"></div>
            <button class="mg-btn mg-btn-primary" id="mgPlayAgain">다시 하기 (−10 💰)</button>
            <button class="mg-btn mg-btn-secondary" id="mgResultClose">닫기</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    this._modal = m;
    this._cacheRefs();
  }

  _cacheRefs() {
    this._grid        = document.getElementById('mgGrid');
    this._hudCoin     = document.getElementById('mgCoin');
    this._hudMiss     = document.getElementById('mgMiss');
    this._hudMatch    = document.getElementById('mgMatch');
    this._comboToast  = document.getElementById('mgComboToast');
    this._resultPanel = document.getElementById('mgResult');
  }

  _bindClose() {
    document.getElementById('mgCloseBtn')?.addEventListener('click', () => this.close());
    document.getElementById('mgOverlay')?.addEventListener('click', () => this.close());
    document.getElementById('mgResultClose')?.addEventListener('click', () => this.close());
    document.getElementById('mgPlayAgain')?.addEventListener('click', () => this.start());
  }

  // ── 공개 API ─────────────────────────────────────────────────────────────────
  open() {
    if (!this._modal) return;
    this._modal.classList.remove('hidden');
    if (!this._running) this.start();
  }

  close() {
    if (!this._modal) return;
    this._running = false;
    this._flipped = [];
    this._locked  = false;
    this._modal.classList.add('hidden');
  }

  start() {
    // 입장료 부족 시 모달 안에 안내 표시
    if (!this._spendGold(ENTRY_COST)) {
      this._showNoGoldScreen();
      return;
    }

    this._miss     = 0;
    this._match    = 0;
    this._combo    = 0;
    this._coinDelta = -ENTRY_COST;
    this._flipped  = [];
    this._locked   = false;
    this._running  = true;

    this._resultPanel?.classList.add('hidden');
    this._updateHud();
    this._buildGrid();
  }

  // ── 그리드 생성 ──────────────────────────────────────────────────────────────
  _buildGrid() {
    const grid = this._grid;
    if (!grid) return;
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;

    // TOTAL_PAIRS 쌍만 사용해 셔플
    const imgs  = CARD_IMAGES.slice(0, TOTAL_PAIRS);
    const pairs = [...imgs, ...imgs];
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }

    this._cards = pairs.map((img, idx) => {
      const card = document.createElement('div');
      card.className = 'mg-card';
      card.dataset.idx = idx;
      card.innerHTML = `
        <div class="mg-card-inner">
          <div class="mg-card-back">❓</div>
          <div class="mg-card-front"><img src="${img}" loading="lazy" alt=""></div>
        </div>
      `;
      card.addEventListener('click', () => this._onCardClick(card, img, idx), { passive: true });
      grid.appendChild(card);
      return { el: card, img, pairId: img, flipped: false, matched: false };
    });
  }

  // ── 카드 클릭 ────────────────────────────────────────────────────────────────
  _onCardClick(el, img, idx) {
    if (!this._running || this._locked) return;
    const card = this._cards[idx];
    if (!card || card.flipped || card.matched) return;
    if (this._flipped.length === 2) return;

    card.flipped = true;
    el.classList.add('mg-flipped');
    this._flipped.push(card);

    if (this._flipped.length === 2) {
      this._locked = true;
      const [a, b] = this._flipped;
      if (a.pairId === b.pairId) {
        this._onMatch(a, b);
      } else {
        this._onMiss(a, b);
      }
    }
  }

  _onMatch(a, b) {
    this._match++;
    this._combo++;
    const earned = MATCH_REWARD + (this._combo >= COMBO_TRIGGER ? COMBO_BONUS : 0);
    this._coinDelta += earned;
    this._addGold(earned);

    a.matched = true;
    b.matched = true;
    a.el.classList.add('mg-matched');
    b.el.classList.add('mg-matched');

    if (this._combo >= COMBO_TRIGGER) {
      this._showComboToast(`🔥 ${this._combo}콤보! +${COMBO_BONUS}`);
      if (navigator.vibrate) navigator.vibrate([30, 20, 50]);
    }
    this._playSound('hit');

    this._flipped = [];
    this._locked  = false;
    this._updateHud();

    if (this._match === TOTAL_PAIRS) {
      setTimeout(() => this._onClear(), 400);
    }
  }

  _onMiss(a, b) {
    this._miss++;
    this._combo = 0;
    this._playSound('miss');
    if (navigator.vibrate) navigator.vibrate(80);

    setTimeout(() => {
      a.el.classList.remove('mg-flipped');
      b.el.classList.remove('mg-flipped');
      a.flipped = false;
      b.flipped = false;
      this._flipped = [];
      this._locked  = false;
      this._updateHud();

      if (this._miss >= MAX_MISS) {
        this._onGameOver();
      }
    }, 900);
  }

  // ── 결과 처리 ────────────────────────────────────────────────────────────────
  _onClear() {
    this._running = false;
    this._coinDelta += CLEAR_BONUS_GOLD;
    this._addGold(CLEAR_BONUS_GOLD);
    this._addExp(CLEAR_BONUS_XP);
    this._playSound('levelup');
    if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 100]);
    this._saveStats(true);
    this._showResult(true);
  }

  _onGameOver() {
    this._running = false;
    this._playSound('dead');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    this._saveStats(false);
    this._showResult(false);
  }

  _showNoGoldScreen() {
    const icon  = document.getElementById('mgResultIcon');
    const title = document.getElementById('mgResultTitle');
    const sub   = document.getElementById('mgResultSub');
    const stats = document.getElementById('mgResultStats');
    const again = document.getElementById('mgPlayAgain');
    if (!this._resultPanel) return;
    if (icon)  icon.textContent  = '💰';
    if (title) title.textContent = '골드 부족';
    if (sub)   sub.textContent   = `입장료 ${ENTRY_COST} 골드가 필요합니다`;
    if (stats) stats.textContent = '몬스터를 처치하여 골드를 모은 후 도전하세요!';
    if (again) again.style.display = 'none';
    this._resultPanel.classList.remove('hidden');
    this._resultPanel._noGold = true;
  }

  _showResult(cleared) {
    const icon  = document.getElementById('mgResultIcon');
    const title = document.getElementById('mgResultTitle');
    const sub   = document.getElementById('mgResultSub');
    const stats = document.getElementById('mgResultStats');
    const again = document.getElementById('mgPlayAgain');
    if (!this._resultPanel) return;
    if (again) again.style.display = '';

    const best = this._loadStats();
    if (cleared) {
      if (icon)  icon.textContent  = '🏆';
      if (title) title.textContent = '클리어!';
      if (sub)   sub.textContent   = `+${CLEAR_BONUS_GOLD} 골드 +${CLEAR_BONUS_XP} XP 획득`;
    } else {
      if (icon)  icon.textContent  = '💀';
      if (title) title.textContent = '게임 오버';
      if (sub)   sub.textContent   = `미스 ${this._miss}회로 실패`;
    }
    if (stats) {
      stats.innerHTML =
        `매칭: ${this._match}/${TOTAL_PAIRS} &nbsp;|&nbsp; ` +
        `획득 골드: ${this._coinDelta > 0 ? '+' : ''}${this._coinDelta} &nbsp;|&nbsp; ` +
        `최고 기록: ${best.bestMatch} 매칭 · ${best.plays}회 플레이`;
    }
    this._resultPanel.classList.remove('hidden');
  }

  // ── HUD 업데이트 ─────────────────────────────────────────────────────────────
  _updateHud() {
    if (this._hudCoin)  this._hudCoin.textContent  = (this._coinDelta >= 0 ? '+' : '') + this._coinDelta;
    if (this._hudMiss)  this._hudMiss.textContent  = `${this._miss}/${MAX_MISS}`;
    if (this._hudMatch) this._hudMatch.textContent = `${this._match}/${TOTAL_PAIRS}`;
  }

  _showComboToast(msg) {
    if (!this._comboToast) return;
    this._comboToast.textContent = msg;
    this._comboToast.classList.remove('hidden');
    clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => this._comboToast.classList.add('hidden'), 1500);
  }

  _showToast(msg) {
    const toast = document.getElementById('battleToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  }

  // ── localStorage 통계 ────────────────────────────────────────────────────────
  _saveStats(cleared) {
    const prev = this._loadStats();
    const next = {
      plays:     (prev.plays || 0) + 1,
      clears:    (prev.clears || 0) + (cleared ? 1 : 0),
      bestMatch: Math.max(prev.bestMatch || 0, this._match),
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch (_) {}
  }

  _loadStats() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }
}

// ── 싱글톤 ───────────────────────────────────────────────────────────────────
let _game = null;

export function initMemoryGame({ onSpendGold, onAddGold, onAddExp, onPlaySound }) {
  _game = new MemoryGame({ onSpendGold, onAddGold, onAddExp, onPlaySound });
}

export function openMemoryGame() {
  _game?.open();
}
