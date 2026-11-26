// /assets/js/pages/town_home.js
import { _t, initLang } from "./town_home.i18n.js";
import { auth, db } from "/assets/js/auth.js";
import { functions } from "/assets/js/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ── 가맹점 캐시 (세션 내 1회만 fetch) ────────────────────────────────────────
let _merchantsCache = null;
async function fetchMerchantsOnce() {
  if (!_merchantsCache) _merchantsCache = await getDocs(collection(db, "merchants"));
  return _merchantsCache;
}

const $ = (id) => document.getElementById(id);

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function formatHexForUi(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} Point`;
}

function formatCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("ko-KR")}명`;
}

// ── FX 환율 (jackpot_config/current 캐시, 결제마다 업데이트) ─────────
let _fxCache = null;
async function getFxRates() {
  if (_fxCache) return _fxCache;
  try {
    const snap = await getDoc(doc(db, "jackpot_config", "current"));
    const d = snap.exists() ? snap.data() : {};
    _fxCache = {
      krw: Number(d.krwPerHex) > 0 ? Number(d.krwPerHex) : 1380,
      vnd: Number(d.vndPerHex) > 0 ? Number(d.vndPerHex) : 25000,
    };
  } catch {
    _fxCache = { krw: 1380, vnd: 25000 };
  }
  return _fxCache;
}

function fmtJackpotHex(hexVal) {
  return `${hexVal.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} Point`;
}

function setJackpotUi({ valueText, fiatText, updatedText, winnerCountText, rewardText }) {
  const valueEl = $("jackpotDisplayValue");
  const fiatEl = $("jackpotFiatValue");
  const updatedEl = $("jackpotUpdated");
  const winnerEl = $("jackpotWinnerCount");
  const highestEl = $("jackpotHighestWin");

  if (valueEl) valueEl.textContent = valueText || "-";
  if (fiatEl) fiatEl.textContent = fiatText || "";
  if (updatedEl) updatedEl.innerHTML = `<span class="jackpot-dot"></span>${escHtml(updatedText || "")}`;
  if (winnerEl) winnerEl.textContent = winnerCountText || "-";
  if (highestEl) highestEl.textContent = rewardText || _t('item_jackpot');
}

// ── 잭팟 & 포인트 보상 시드 데이터 & 캐시 헬퍼 ──
const DEFAULT_SEED_JACKPOT = {
  jackpotPoints: 58450000,
  krwPerHex: 1380,
  vndPerHex: 25000,
  winnerCount: 128
};

const DEFAULT_SEED_WINNERS = [
  {
    addrShort: "0x7a3...f91a",
    merchantName: "대한치킨 & 대한김치",
    dateStr: "10월 14일 10:15",
    itemsStr: "🪙 5,000,000 Point (가맹점 바우처 당첨!)",
    amountVnd: 5000000
  },
  {
    addrShort: "0x3f1...e02b",
    merchantName: "K-스킨 에스테틱",
    dateStr: "10월 14일 09:30",
    itemsStr: "🪙 2,000,000 Point (라이프스타일 상품권)",
    amountVnd: 2000000
  },
  {
    addrShort: "0x9c4...118d",
    merchantName: "대한마트 송다점",
    dateStr: "10월 13일 21:40",
    itemsStr: "🪙 1,000,000 Point (식음료 바우처)",
    amountVnd: 1000000
  },
  {
    addrShort: "0x2e8...7a4c",
    merchantName: "미딩 바베큐 하우스",
    dateStr: "10월 13일 18:20",
    itemsStr: "🪙 500,000 Point (가맹점 할인 쿠폰)",
    amountVnd: 500000
  }
];

function applyJackpotStatsToUi(stats) {
  const pts = Number(stats.jackpotPoints || stats.jackpotAccVnd || 58450000);
  const ptsStr = Math.round(pts).toLocaleString("ko-KR");
  const count = Number(stats.winnerCount || 128);
  const now = new Date();
  setJackpotUi({
    valueText: `${ptsStr} Point`,
    fiatText: "",
    updatedText: _t('time_basis', now.toLocaleTimeString([], { hour12: false })),
    winnerCountText: `${count.toLocaleString()}명`,
    rewardText: _t('item_jackpot'),
  });
}

async function loadJackpotStats() {
  // 1. 캐시 우선 0초 렌더링
  let cached = null;
  try {
    const saved = localStorage.getItem("bc_cache_jackpot");
    if (saved) cached = JSON.parse(saved);
  } catch (_) {}

  applyJackpotStatsToUi(cached || DEFAULT_SEED_JACKPOT);

  // 2. 백그라운드 Firestore 갱신 (limit(100) 제거 → 전체 실제 당첨 건수 서버 집계)
  try {
    const [configSnap, countSnap] = await Promise.all([
      getDoc(doc(db, "jackpot_config", "current")),
      getCountFromServer(collection(db, "jackpot_wins")).catch(() => null)
    ]);

    const cfg = configSnap.exists() ? configSnap.data() : {};
    let count = countSnap ? Number(countSnap.data()?.count || 0) : 0;
    if (!count) {
      const allSnap = await getDocs(collection(db, "jackpot_wins")).catch(() => null);
      if (allSnap) count = allSnap.size;
    }
    const statsData = {
      jackpotPoints: Number(cfg.jackpotAccVnd || 58450000),
      krwPerHex: Number(cfg.krwPerHex || 1380),
      vndPerHex: Number(cfg.vndPerHex || 25000),
      winnerCount: count > 0 ? count : (cached?.winnerCount || 0)
    };

    try { localStorage.setItem("bc_cache_jackpot", JSON.stringify(statsData)); } catch (_) {}
    applyJackpotStatsToUi(statsData);
  } catch (e) {
    console.warn("loadJackpotStats background note:", e?.message || e);
    // 쿼타 초과나 일시적 네트워크 에러 시 오류 문구 없이 캐시/시드 유지
  }
}

function initJackpotTicker() {
  if (!$("jackpotSection")) return;
  loadJackpotStats();
  setInterval(loadJackpotStats, 60000); // 60초 주기로 부하 완화
}

// ── 당첨자 목록 & 공유 카드 ──────────────────────────────
let _userLevel = 0;
let _userWalletAddr = "";
let _jackpotWinners = [];

function renderWinnersList(snapOrArray) {
  const wrap = $("jackpotWinnersList");
  if (!wrap) return;

  const rawList = [];
  if (snapOrArray && typeof snapOrArray.forEach === "function") {
    snapOrArray.forEach((d) => {
      rawList.push(typeof d.data === "function" ? d.data() : d);
    });
  } else if (Array.isArray(snapOrArray)) {
    rawList.push(...snapOrArray);
  }

  const itemsToRender = rawList.length > 0 ? rawList : DEFAULT_SEED_WINNERS;
  const winners = [];

  itemsToRender.forEach((r) => {
    let displayName = r.userName || r.userAddress || r.addrShort || "-";
    if (displayName.length > 10 && displayName.startsWith('0x')) {
      displayName = displayName.slice(0, 6) + "..." + displayName.slice(-4);
    }

    const ts = r.timestamp || r.createdAt;
    const createdAt = ts?.toDate ? ts.toDate() : (ts?.seconds ? new Date(ts.seconds * 1000) : (ts ? new Date(ts) : null));
    const dateStr = r.dateStr || (createdAt
      ? createdAt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) +
      " " +
      createdAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "-");

    const items = [];
    const amountKM = Number(r.amountVnd || r.amountKrw || r.pointsEarned || 0);
    const ptsWei = r.onchainJackpotPointsWei ? BigInt(r.onchainJackpotPointsWei) : 0n;
    if (amountKM > 0) items.push(`🪙 ${amountKM.toLocaleString()} Point`);
    else if (ptsWei > 0n) items.push(`🪙 ${(Number(ptsWei) / 1e18).toFixed(6)} Point`);

    if ((r.potionCount || 0) > 0) items.push(_t('red_potion', r.potionCount));
    if ((r.mpPotionCount || 0) > 0) items.push(_t('mp_potion', r.mpPotionCount));
    if ((r.reviveAdded || 0) > 0) items.push(_t('revive', r.reviveAdded));

    let hexVal = 0;
    if (amountKM > 0) hexVal = amountKM;
    else if (ptsWei > 0n) hexVal = Number(ptsWei) / 1e18;

    winners.push({
      addrShort: r.addrShort || displayName,
      merchantName: r.merchantName || `가맹점 #${r.merchantId || ""}`,
      dateStr,
      itemsStr: r.itemsStr || items.join(" / ") || _t('item'),
      hexVal,
      _ts: createdAt ? createdAt.getTime() : 0,
    });
  });

  _jackpotWinners = winners;

  const INITIAL_SHOW = 5;
  const makeRow = (w, i) => `
    <div class="jp-winner-row${i === 0 ? " jp-winner-top" : ""}">
      <div class="jp-winner-info">
        <div class="jp-winner-amount">${i === 0 ? "&#x1F3C6; " : "&#x1F381; "}${escHtml(w.itemsStr)}</div>
        <div class="jp-winner-meta">
          <span class="jp-winner-tag">&#x1F464; ${escHtml(w.addrShort)}</span>
          <span class="jp-winner-tag">&#x1F3EA; ${escHtml(w.merchantName)}</span>
          <span class="jp-winner-tag">&#x1F4C5; ${escHtml(w.dateStr)}</span>
        </div>
      </div>
      <button class="jp-share-btn" data-win-idx="${i}" type="button">${_t('share')}</button>
    </div>`;

  const visibleRows = winners.slice(0, INITIAL_SHOW).map(makeRow).join("");
  const hiddenRows = winners.length > INITIAL_SHOW
    ? `<div id="jpWinnersHidden" style="display:none;">${winners.slice(INITIAL_SHOW).map(makeRow).join("")}</div>
       <button class="jp-winners-more-btn" id="jpWinnersMoreBtn" type="button">${_t('more_winners', winners.length - INITIAL_SHOW)}</button>`
    : "";

  wrap.innerHTML = visibleRows + hiddenRows;

  const moreBtn = $("jpWinnersMoreBtn");
  if (moreBtn) {
    moreBtn.onclick = () => {
      $("jpWinnersHidden").style.display = "";
      moreBtn.style.display = "none";
    };
  }

  wrap.onclick = (e) => {
    const btn = e.target.closest(".jp-share-btn");
    if (!btn) return;
    const idx = parseInt(btn.dataset.winIdx, 10);
    if (Number.isFinite(idx) && _jackpotWinners[idx]) {
      openShareModal(_jackpotWinners[idx]);
    }
  };
}

async function loadJackpotWinners() {
  const wrap = $("jackpotWinnersList");
  if (!wrap) return;

  // 1. 캐시 또는 기본 시드 당첨자 데이터로 즉시(0초) 렌더링
  let cachedWinners = null;
  try {
    const saved = localStorage.getItem("bc_cache_winners");
    if (saved) cachedWinners = JSON.parse(saved);
  } catch (_) {}

  renderWinnersList(cachedWinners && cachedWinners.length > 0 ? cachedWinners : DEFAULT_SEED_WINNERS);

  // 2. 백그라운드 Firestore 갱신
  try {
    const q = query(
      collection(db, "jackpot_wins"),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      renderWinnersList(snap);
      const toCache = [];
      snap.forEach((d) => toCache.push(d.data()));
      try { localStorage.setItem("bc_cache_winners", JSON.stringify(toCache)); } catch (_) {}
    }
  } catch (err) {
    console.warn("loadJackpotWinners background sync note:", err?.message || err);
    // 실패 시에도 에러 메시지로 덮어쓰지 않고 캐시/시드 유지
  }
}

function buildShareCardHTML(winner) {
  const hasRef = _userLevel >= 4 && _userWalletAddr;
  const registerUrl = hasRef
    ? `/register.html?mentor=${encodeURIComponent(_userWalletAddr)}`
    : `/register.html`;

  const refBlock = hasRef
    ? `<hr class="jp-sc-divider">
       <a class="jp-sc-reg-btn" href="${escHtml(registerUrl)}" target="_blank" rel="noopener">
         ${_t('join_now')}
       </a>
       <p class="jp-sc-ref-note">${_t('my_referral')}</p>`
    : `<hr class="jp-sc-divider">
       <a class="jp-sc-reg-btn" href="/register.html" target="_blank" rel="noopener">
         ${_t('join_basic')}
       </a>`;

  const rewardLine = winner.hexVal > 0
    ? `<div class="jp-sc-amount">🪙 ${winner.hexVal.toFixed(6)} ${_t('hex_points')}</div>`
    : `<div class="jp-sc-amount">🎁 ${escHtml(winner.itemsStr)}</div>`;

  return `
    <div class="jp-share-card">
      <button class="jp-sc-x" id="jpShareClose" aria-label="닫기">&#x00D7;</button>
      <div class="jp-share-inner">
        <div class="jp-sc-badge">&#x1F3B0; JUMP MERCHANT PAY JACKPOT</div>
        <img class="jp-sc-logo" src="/assets/images/jump/logo2.png" alt="JUMP" />
        <div class="jp-sc-headline">${_t('jackpot_won')}</div>
        ${rewardLine}
        <div class="jp-sc-fiat">${escHtml(winner.itemsStr)}</div>
        <hr class="jp-sc-divider">
        <div class="jp-sc-kv">
          <span class="k">&#x1F464; ${_t('winner_label')}</span>
          <span class="v" style="font-family:monospace;font-size:12px;">${escHtml(winner.addrShort)}</span>
        </div>
        <div class="jp-sc-kv">
          <span class="k">&#x1F3EA; ${_t('merchant_pay_label')}</span>
          <span class="v">${escHtml(winner.merchantName)}</span>
        </div>
        <div class="jp-sc-kv">
          <span class="k">&#x1F4C5; ${_t('win_date_label')}</span>
          <span class="v">${escHtml(winner.dateStr)}</span>
        </div>
        ${refBlock}
        <button class="jp-sc-kakao-btn" id="jpShareKakao" type="button">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><ellipse cx="9" cy="8.4" rx="8" ry="6.6" fill="#191919"/><path d="M5.1 11.2l1-3.1.9 2.1 1-.4.9 1.4-1.1-3.3 1.2-1.3H7.6l-.5-1.2-.6 1.2H5.3l1.1 1.3-1.3 3.3z" fill="#FEE500"/></svg>
          ${_t('kakao_share')}
        </button>
        <div class="jp-sc-sns-row">
          <button class="jp-sc-sns-btn jp-sc-sns-x" id="jpShareX" type="button">
            <span class="sns-icon">𝕏</span>${_t('share_x')}
          </button>
          <button class="jp-sc-sns-btn jp-sc-sns-fb" id="jpShareFb" type="button">
            <span class="sns-icon">f</span>${_t('share_fb')}
          </button>
          <button class="jp-sc-sns-btn jp-sc-sns-tg" id="jpShareTg" type="button">
            <span class="sns-icon">✈</span>${_t('share_tg')}
          </button>
          <button class="jp-sc-sns-btn jp-sc-sns-line" id="jpShareLine" type="button">
            <span class="sns-icon">💬</span>LINE
          </button>
        </div>
        <div class="jp-sc-actions">
          <button class="jp-sc-img-btn" id="jpShareImg" type="button">${_t('save_image')}</button>
          <button class="jp-sc-copy-btn" id="jpShareCopy" type="button">${_t('copy_link')}</button>
        </div>
        <button class="jp-sc-close-btn" id="jpShareCloseBtn" type="button" style="width:100%;margin-top:6px;">${_t('close')}</button>
      </div>
    </div>`;
}

function openShareModal(winner) {
  const modal = $("jackpotShareModal");
  if (!modal) return;

  modal.innerHTML = buildShareCardHTML(winner);
  modal.style.display = "flex";

  const close = () => { modal.style.display = "none"; };
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); }, { once: true });
  $("jpShareClose").onclick = close;
  $("jpShareCloseBtn").onclick = close;

  const hasRef = _userLevel >= 4 && _userWalletAddr;
  const shareParams = new URLSearchParams({
    addr: winner.addrShort,
    merchant: winner.merchantName,
    date: winner.dateStr,
    items: winner.itemsStr,
    ...(winner.hexVal > 0 ? { hex: winner.hexVal.toFixed(6) } : {}),
    ...(hasRef ? { mentor: _userWalletAddr } : {}),
  });
  const copyUrl = `${location.origin}/index.html`;
  const shareTitle = _t('share_title_text');
  const shareText = winner.hexVal > 0
    ? `🪙 ${winner.hexVal.toFixed(6)} ${_t('hex_points')} · ${winner.itemsStr}\n📍 ${winner.merchantName} · ${winner.dateStr}\n${_t('participate_now')}`
    : `🎁 ${winner.itemsStr}\n📍 ${winner.merchantName} · ${winner.dateStr}\n${_t('participate_now')}`;

  function openSnsUrl(url) { window.open(url, "_blank", "noopener,width=600,height=500"); }

  // 카카오톡: Web Share API (모바일) / 링크 복사 (PC)
  $("jpShareKakao").onclick = async () => {
    const btn = $("jpShareKakao");
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url: copyUrl });
      } catch (err) {
        if (err.name !== "AbortError") console.warn("share failed:", err);
      }
    } else {
      const kakaoText = `${shareTitle}\n${shareText}\n${copyUrl}`;
      navigator.clipboard?.writeText(kakaoText).then(() => {
        btn.textContent = _t('kakao_copied');
        setTimeout(() => {
          btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><ellipse cx="9" cy="8.4" rx="8" ry="6.6" fill="#191919"/><path d="M5.1 11.2l1-3.1.9 2.1 1-.4.9 1.4-1.1-3.3 1.2-1.3H7.6l-.5-1.2-.6 1.2H5.3l1.1 1.3-1.3 3.3z" fill="#FEE500"/></svg> ${_t('kakao_share')}`;
        }, 2500);
      }).catch(() => { btn.textContent = "복사 실패"; });
    }
  };

  // X (트위터)
  $("jpShareX").onclick = () => {
    const tweetText = encodeURIComponent(`${shareTitle}\n${shareText}`);
    openSnsUrl(`https://twitter.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(copyUrl)}`);
  };

  // 페이스북
  $("jpShareFb").onclick = () => {
    openSnsUrl(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(copyUrl)}&quote=${encodeURIComponent(shareText)}`);
  };

  // 텔레그램
  $("jpShareTg").onclick = () => {
    openSnsUrl(`https://t.me/share/url?url=${encodeURIComponent(copyUrl)}&text=${encodeURIComponent(`${shareTitle}\n${shareText}`)}`);
  };

  // LINE
  $("jpShareLine").onclick = () => {
    openSnsUrl(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(copyUrl)}&text=${encodeURIComponent(`${shareTitle}\n${shareText}`)}`);
  };

  // 링크 복사
  $("jpShareCopy").onclick = () => {
    const btn = $("jpShareCopy");
    navigator.clipboard?.writeText(copyUrl).then(() => {
      btn.innerHTML = _t('copied');
      setTimeout(() => { btn.innerHTML = _t('copy_link'); }, 2500);
    }).catch(() => { btn.textContent = _t('copy_failed'); });
  };

  // 이미지 저장
  $("jpShareImg").onclick = async () => {
    const btn = $("jpShareImg");
    const card = document.querySelector(".jp-share-card");
    if (!card || typeof window.html2canvas === "undefined") {
      btn.textContent = _t('unsupported_browser');
      return;
    }
    btn.disabled = true;
    btn.textContent = _t('saving');
    try {
      const canvas = await window.html2canvas(card, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
        ignoreElements: (el) => ["jpShareImg", "jpShareClose", "jpShareKakao", "jpShareX", "jpShareFb", "jpShareTg", "jpShareLine", "jpShareCopy", "jpShareCloseBtn"].includes(el.id),
      });
      const url = URL.createObjectURL(await new Promise(r => canvas.toBlob(r, "image/png")));
      const a = document.createElement("a");
      a.href = url;
      a.download = "jump-jackpot.png";
      a.click();
      URL.revokeObjectURL(url);
      btn.innerHTML = _t('saved');
      btn.disabled = false;
      setTimeout(() => { btn.innerHTML = _t('save_image'); }, 3000);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = _t('capture_error');
      console.warn("html2canvas error:", err);
    }
  };
}

// (2026-11-26) 가짜 예시 랭킹 데이터 삭제 — 실제 서버 데이터만 표시

const DEFAULT_SEED_NOTICES = [
  {
    title: "🎉 [베스트클럽 안내] 가맹점 결제 시 5% 포인트 페이백 & 잭팟 티켓 즉시 발급!",
    text: "베스트클럽 공식 가맹점에서 결제 시 결제액의 5% 포인트가 즉시 적립되며, 100,000 VND 결제당 1장의 잭팟 보너스티켓(BT)이 자동 발급됩니다.",
    pinned: true,
    visible: true,
    createdAt: { seconds: Math.floor(Date.now() / 1000) - 86400 }
  },
  {
    title: "📰 [베스트 매거진 오픈] 하노이 K-컬처 & 가맹점 스토리 웹진 서비스 개시",
    text: "하노이 맛집, K-푸드, 뷰티, 생활정보를 매거진 콘텐츠로 즐기시고 공식 가맹점 특별 혜택을 웹진(kca_webzine)에서 확인해 보세요.",
    pinned: true,
    visible: true,
    createdAt: { seconds: Math.floor(Date.now() / 1000) - 172800 }
  },
  {
    title: "🎁 [이벤트 라운지] 정회원 1초 무료 쿠폰 & 바우처 발급 안내",
    text: "이벤트 라운지(events.html)에서 가맹점별 10~20% 할인 쿠폰과 스페셜 바우처를 무료로 다운로드하여 마이페이지에서 바로 사용할 수 있습니다.",
    pinned: false,
    visible: true,
    createdAt: { seconds: Math.floor(Date.now() / 1000) - 259200 }
  }
];

function _maskPublicDisplayName(raw) {
  const s = String(raw || '익명').trim();
  const at = s.indexOf('@');
  if (at < 0) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const mLocal = local.length <= 2 ? `${local[0] || '*'}***` : `${local.slice(0, 2)}***`;
  const domParts = domain.split('.');
  const mDom = domParts[0] ? `${domParts[0][0]}***${domParts.length > 1 ? '.' + domParts.slice(1).join('.') : ''}` : '***';
  return `${mLocal}@${mDom}`;
}

function renderRankingList(el, rows, valueFn) {
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = `<div class="ranking-empty">${_t('ranking_empty')}</div>`;
    return;
  }
  const MEDALS = ['🥇', '🥈', '🥉'];
  const MEDAL_CLS = ['gold', 'silver', 'bronze'];
  el.innerHTML = rows.map((row, idx) => {
    const rankNum = row.rank || idx + 1;
    const i = rankNum - 1;
    const safeName = _maskPublicDisplayName(row.displayName || '익명');
    const numHtml = i < 3
      ? `<div class="ranking-num ${MEDAL_CLS[i]}">${MEDALS[i]}</div>`
      : `<div class="ranking-num">${rankNum}</div>`;
    const avatarHtml = row.photoURL
      ? `<img class="ranking-avatar" src="${escHtml(row.photoURL)}" alt="" loading="lazy">`
      : `<div class="ranking-avatar-ph">${escHtml(String(safeName || '?')[0].toUpperCase())}</div>`;
    return `<div class="ranking-row">${numHtml}${avatarHtml}<div class="ranking-info"><div class="ranking-name">${escHtml(safeName)}</div><div class="ranking-val">${escHtml(valueFn(row))}</div></div></div>`;
  }).join('');
}

async function loadRankings() {
  const pointEl = $('jumpRankingList');
  const bmEl = $('bmRankingList');
  if (!pointEl && !bmEl) return;
  const pointVal = (r) => `${Number(r.pointBalance || 0).toLocaleString()} Point`;
  const bmVal = (r) => `${Number(r.bmBalance || 0).toLocaleString()} BM`;
  const CACHE_KEY = 'bc_cache_rankings_v2'; // Point + BM (예전 보물상자 캐시와 분리)

  // 1. 마지막으로 받은 실제 랭킹이 있으면 먼저 보여줌 (없으면 Loading 유지)
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached) {
      if (pointEl && Array.isArray(cached.pointRanking)) renderRankingList(pointEl, cached.pointRanking, pointVal);
      if (bmEl && Array.isArray(cached.bmRanking)) renderRankingList(bmEl, cached.bmRanking, bmVal);
    }
  } catch (_) {}

  // 2. 서버(Cloud Function getHomeRankings)에서 최신 랭킹
  try {
    const res = await httpsCallable(functions, 'getHomeRankings')();
    const { pointRanking = [], bmRanking } = res.data || {};
    if (pointEl) renderRankingList(pointEl, pointRanking, pointVal);
    if (bmEl) {
      if (Array.isArray(bmRanking)) renderRankingList(bmEl, bmRanking, bmVal);
      else bmEl.innerHTML = `<div class="ranking-empty">${_t('ranking_empty')}</div>`; // 서버 함수 배포 전
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ pointRanking, bmRanking: Array.isArray(bmRanking) ? bmRanking : [] })); } catch (_) {}
  } catch (e) {
    console.warn('loadRankings background note:', e?.message || e);
    if (pointEl && pointEl.querySelector('.ranking-loading')) pointEl.innerHTML = `<div class="ranking-empty">${_t('ranking_empty')}</div>`;
    if (bmEl && bmEl.querySelector('.ranking-loading')) bmEl.innerHTML = `<div class="ranking-empty">${_t('ranking_empty')}</div>`;
  }
}

async function isAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch {
    return false;
  }
}

function setupAdminUI(admin) {
  const btnAdminPlace = $("btnAdminPlace");
  const noticeAdminLink = $("noticeAdminLink");
  if (btnAdminPlace) btnAdminPlace.style.display = admin ? "" : "none";
  if (noticeAdminLink) noticeAdminLink.style.display = admin ? "" : "none";
}

function makeNoticeRow(v) {
  const li = document.createElement("li");
  li.className = "notice-row";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "notice-head";
  head.textContent = v.title || v.text || _t('no_notice_title');

  const body = document.createElement("div");
  body.className = "notice-body";
  body.textContent = v.text || "";
  body.style.display = "none";

  head.onclick = () => {
    body.style.display = body.style.display === "none" ? "block" : "none";
  };

  li.appendChild(head);
  li.appendChild(body);
  return li;
}

function renderNoticesToDom(visible) {
  const list = $("noticeList");
  if (!list) return;
  list.innerHTML = "";

  visible.forEach((v, i) => {
    const row = makeNoticeRow(v);
    if (i >= 5) row.style.display = "none";
    list.appendChild(row);
  });

  if (!list.children.length) {
    const li = document.createElement("li");
    li.textContent = _t('no_notices');
    list.appendChild(li);
  }

  const moreBtn = $("noticeMoreBtn");
  if (moreBtn) {
    if (visible.length > 5) {
      moreBtn.style.display = "";
      moreBtn.onclick = () => {
        list.querySelectorAll("li[style*='display: none'], li[style*='display:none']").forEach((el) => (el.style.display = ""));
        moreBtn.style.display = "none";
      };
    } else {
      moreBtn.style.display = "none";
    }
  }
}

async function loadNotices() {
  const list = $("noticeList");
  if (!list) return;

  // 1. 캐시 또는 기본 공지 데이터로 즉시(0초) 렌더링
  let cachedNotices = null;
  try {
    const saved = localStorage.getItem("bc_cache_notices");
    if (saved) cachedNotices = JSON.parse(saved);
  } catch (_) {}

  const initialDocs = (cachedNotices && cachedNotices.length > 0) ? cachedNotices : DEFAULT_SEED_NOTICES;
  renderNoticesToDom(initialDocs);

  // 2. 백그라운드 Firestore 갱신
  try {
    const snap = await getDocs(
      query(collection(db, "notices"), orderBy("createdAt", "desc"), limit(30))
    );

    const docs = [];
    snap.forEach((d) => docs.push(d.data() || {}));

    if (docs.length > 0) {
      const visible = docs
        .filter((v) => v.visible !== false)
        .sort((a, b) => {
          const ap = a.pinned ? 1 : 0;
          const bp = b.pinned ? 1 : 0;
          if (ap !== bp) return bp - ap;
          const am = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bm = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bm - am;
        });

      try { localStorage.setItem("bc_cache_notices", JSON.stringify(visible)); } catch (_) {}
      renderNoticesToDom(visible);
    }
  } catch (e) {
    console.warn("loadNotices background note:", e?.message || e);
    // 쿼타 초과나 일시적 장애 시에도 에러 메시지 대신 캐시/시드 공지사항 유지
  }
}

function renderMerchantCard(mid, m) {
  const name = m.name || _t('merchant_name_fallback');
  const career = m.career || "";
  const region = m.region || "";
  const desc = m.description || "";
  const ownerUid = m.ownerUid || "";

  return `
    <div class="merchant-card">
      <div class="merchant-card-head">
        <span class="merchant-name">${escHtml(name)}</span>
        ${career ? `<span class="merchant-career">${escHtml(career)}</span>` : ""}
      </div>
      ${region ? `<div class="merchant-region">📍 ${escHtml(region)}</div>` : ""}
      ${desc ? `<div class="merchant-desc">${escHtml(desc)}</div>` : ""}
      <div class="merchant-id">${_t('merchant_id_prefix')} ${escHtml(String(mid))}</div>
      ${ownerUid ? `<button class="btn-merchant-products" type="button" data-owner-uid="${escHtml(ownerUid)}" data-merchant-name="${escHtml(name)}">${_t('view_products')}</button>` : ""}
    </div>`;
}

let merchantGridBound = false;

async function loadMerchants() {
  const grid = $("merchantListGrid");
  const state = $("merchantListState");
  if (!grid) return;

  if (state) state.textContent = _t('merchants_loading');

  try {
    const snap = await fetchMerchantsOnce();
    const list = [];
    snap.forEach((d) => {
      const m = d.data() || {};
      if (m.active !== false) list.push({ id: d.id, ...m });
    });

    if (state) state.textContent = _t('merchants_count', list.length);

    if (!list.length) {
      grid.innerHTML = `<p class="help">${_t('merchants_none')}</p>`;
      return;
    }

    grid.innerHTML = list.map((m) => renderMerchantCard(m.id, m)).join("");

    if (!merchantGridBound) {
      merchantGridBound = true;
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-merchant-products");
        if (!btn) return;
        const ownerUid = btn.dataset.ownerUid;
        const merchantName = btn.dataset.merchantName;
        if (ownerUid) openMerchantProductModal(ownerUid, merchantName);
      });
    }
  } catch (e) {
    console.warn("loadMerchants failed:", e);
    if (state) state.textContent = _t('merchants_error');
  }
}

const TYPE_COLOR = {
  homestay: "#6366f1",
  restaurant: "#f97316",
  food: "#f97316",
  cafe: "#854d0e",
  hospital: "#ef4444",
  school: "#16a34a",
  park: "#22c55e",
  shopping: "#ec4899",
};

function getMarkerColor(type) {
  return TYPE_COLOR[String(type).toLowerCase()] || "#6b7280";
}

// ── Google Maps 로드 (Leaflet Shim 호환) ───────────────────────────────────
function loadMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.Map) return resolve();
    window.__gmapsCb = resolve;
    let checkCount = 0;
    const timer = setInterval(() => {
      if (window.google?.maps?.Map) {
        clearInterval(timer);
        return resolve();
      }
      checkCount++;
      if (checkCount > 40) {
        clearInterval(timer);
        if (window.__mapsKey && window.__mapsKey !== 'free-leaflet-osm') {
          const s = document.createElement("script");
          s.src = `https://maps.googleapis.com/maps/api/js?key=${window.__mapsKey}&callback=__gmapsCb&language=ko&region=KR`;
          s.async = true;
          s.onerror = () => reject(new Error(_t('maps_load_error')));
          document.head.appendChild(s);
        }
      }
    }, 50);
  });
}

function parseLatLng(gmapUrl) {
  if (!gmapUrl) return null;
  try {
    const m1 = gmapUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
    const url = new URL(gmapUrl);
    const q = url.searchParams.get("q");
    if (q) {
      const m2 = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
  } catch { }
  return null;
}

function makeSvgIcon(emoji, fillColor, size = 36) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${fillColor}" stroke="#fff" stroke-width="2"/>
    <text x="${size / 2}" y="${size * 0.68}" font-size="${size * 0.5}" text-anchor="middle">${emoji}</text></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(size / 2, size)
  };
}

async function loadPlacesMap() {
  const mapEl = $("villageMap");
  if (!mapEl) return;

  if (!window.__mapsKey) {
    mapEl.innerHTML = `<div style="padding:32px;text-align:center;color:#9ca3af;">${_t('maps_no_key')}</div>`;
    return;
  }

  try {
    await loadMapsScript();

    const settle = p => p.then(v => ({ ok: true, v })).catch(() => ({ ok: false }));
    const [placesRes, merchantsRes] = await Promise.all([
      settle(getDocs(collection(db, "places"))),
      settle(fetchMerchantsOnce()),
    ]);

    const map = new google.maps.Map(mapEl, {
      center: { lat: 20.9947, lng: 105.9487 },
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: 'greedy',
      tilt: 0,
      heading: 0,
      rotateControl: false,
      renderingType: google.maps.RenderingType?.RASTER || 'RASTER',
      styles: [
        { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
        { featureType: 'landscape.man_made', elementType: 'all', stylers: [{ visibility: 'off' }] },
        { featureType: 'landscape.man_made.building', elementType: 'all', stylers: [{ visibility: 'off' }] },
      ],
    });
    if (typeof map.setTilt === 'function') map.setTilt(0);
    map.addListener('tilt_changed', () => {
      if (map.getTilt && map.getTilt() !== 0) map.setTilt(0);
    });

    const bounds = new google.maps.LatLngBounds();
    const infoWindow = new google.maps.InfoWindow();
    let markerCount = 0;

    function addMarker(latLng, icon, content, zIndex = 1) {
      const marker = new google.maps.Marker({ position: latLng, map, icon, zIndex });
      bounds.extend(latLng);
      markerCount++;
      marker.addListener("click", () => { infoWindow.setContent(content); infoWindow.open(map, marker); });
    }

    // ── 장소 마커
    if (placesRes.ok) placesRes.v.forEach((d) => {
      const p = d.data() || {};
      if (p.visible === false) return;
      const latLng = (typeof p.lat === "number" && typeof p.lng === "number") ? { lat: p.lat, lng: p.lng } : parseLatLng(p.gmap);
      if (!latLng) return;
      addMarker(latLng,
        { path: google.maps.SymbolPath.CIRCLE, fillColor: getMarkerColor(p.type), fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2, scale: 9 },
        `<div style="max-width:240px;font-size:13px;line-height:1.5;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escHtml(p.name || "")}</div>
          ${p.type ? `<div style="color:#7c3aed;margin-bottom:2px;">${escHtml(p.type)}</div>` : ""}
          ${p.area ? `<div style="color:#6b7280;">${_t('area_label')} ${escHtml(p.area)}</div>` : ""}
          ${p.address ? `<div style="color:#374151;">${escHtml(p.address)}</div>` : ""}
          ${p.phone ? `<div style="color:#374151;">${escHtml(p.phone)}</div>` : ""}
          ${p.note ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(p.note)}</div>` : ""}
          ${p.gmap ? `<a href="${escHtml(p.gmap)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#2563eb;">${_t('view_map')}</a>` : ""}
        </div>`);
    });

    // ── 가맹점 마커 (imageUrl 반영)
    if (merchantsRes.ok) merchantsRes.v.forEach((d) => {
      const m = d.data() || {};
      const hasCoords = (typeof m.lat === "number" && typeof m.lng === "number") || m.gmap;
      if (m.active === false || !hasCoords) return;
      const latLng = (typeof m.lat === "number" && typeof m.lng === "number") ? { lat: m.lat, lng: m.lng } : parseLatLng(m.gmap);
      if (!latLng) return;
      const icon = m.imageUrl
        ? { url: m.imageUrl, scaledSize: new google.maps.Size(36, 36), anchor: new google.maps.Point(18, 36) }
        : { url: "/assets/images/jump/favicon.png", scaledSize: new google.maps.Size(18, 18), anchor: new google.maps.Point(9, 18) };
      addMarker(latLng, icon,
        `<div style="max-width:240px;font-size:13px;line-height:1.5;">
          ${m.imageUrl ? `<img src="${escHtml(m.imageUrl)}" style="width:100%;max-height:100px;object-fit:cover;border-radius:6px;margin-bottom:6px;">` : ""}
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏪 ${escHtml(m.name || _t('merchant_name_fallback'))}</div>
          ${m.career ? `<div style="color:#f59e0b;font-size:12px;">${escHtml(m.career)}</div>` : ""}
          ${m.region ? `<div style="color:#6b7280;">📍 ${escHtml(m.region)}</div>` : ""}
          ${m.phone ? `<div style="color:#374151;">📞 ${escHtml(m.phone)}</div>` : ""}
          ${m.description ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(m.description)}</div>` : ""}
          ${m.gmap ? `<a href="${escHtml(m.gmap)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#2563eb;font-size:12px;">${_t('view_map')} →</a>` : ""}
        </div>`, 10);
    });


    if (markerCount > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds);
      google.maps.event.addListenerOnce(map, "bounds_changed", () => {
        if (map.getZoom() > 17) map.setZoom(17);
      });
    }
  } catch (e) {
    console.warn("loadPlacesMap failed:", e);
    mapEl.innerHTML = `<div style="padding:32px;text-align:center;color:#9ca3af;">${_t('maps_error')}<br><small>${e.message || ""}</small></div>`;
  }
}

function renderProductCard(p) {
  const thumb = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
  const price = p.price ? `${Number(p.price).toLocaleString()}원` : _t('price_inquiry');
  return `
    <a class="mp-product-card" href="/item.html?id=${escHtml(p.id)}" target="_blank" rel="noopener">
      ${thumb ? `<img class="mp-product-thumb" src="${escHtml(thumb)}" alt="${escHtml(p.title || "")}" loading="lazy">` : `<div class="mp-product-thumb-ph">📦</div>`}
      <div class="mp-product-body">
        <div class="mp-product-title">${escHtml(p.title || "")}</div>
        ${p.region ? `<div class="mp-product-region">📍 ${escHtml(p.region)}</div>` : ""}
        <div class="mp-product-price">${escHtml(price)}</div>
      </div>
    </a>`;
}

function closeMerchantProductModal() {
  const modal = $("merchantProductsModal");
  if (modal) modal.style.display = "none";
}

function openMerchantProductModal(ownerUid, merchantName) {
  const modal = $("merchantProductsModal");
  const title = $("mpModalTitle");
  const stateEl = $("mpModalState");
  const grid = $("mpModalGrid");
  if (!modal || !grid) return;

  if (title) title.textContent = _t('modal_products_title', merchantName || _t('merchant_name_fallback'));
  if (stateEl) stateEl.textContent = _t('loading');
  grid.innerHTML = "";
  modal.style.display = "flex";

  const closeBtn = $("mpModalClose");
  const backdrop = $("mpModalBackdrop");
  if (closeBtn) closeBtn.onclick = closeMerchantProductModal;
  if (backdrop) backdrop.onclick = closeMerchantProductModal;

  const onKey = (e) => {
    if (e.key === "Escape") {
      closeMerchantProductModal();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  const qItems = query(
    collection(db, "items"),
    where("ownerUid", "==", ownerUid),
    where("status", "in", ["published", "approved"])
  );
  const qMpByName = merchantName
    ? query(collection(db, "merchant_products"), where("merchant_name", "==", merchantName), where("sale_status", "==", "published"))
    : null;
  const qMpById = query(collection(db, "merchant_products"), where("merchant_id", "==", ownerUid), where("sale_status", "==", "published"));

  Promise.all([
    getDocs(qItems).catch(() => ({ forEach: () => {} })),
    qMpByName ? getDocs(qMpByName).catch(() => ({ forEach: () => {} })) : Promise.resolve({ forEach: () => {} }),
    getDocs(qMpById).catch(() => ({ forEach: () => {} }))
  ])
    .then(([snapItems, snapMpName, snapMpId]) => {
      const seen = new Set();
      const list = [];
      const addMp = (d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const p = d.data() || {};
        list.push({
          id: d.id,
          title: p.product_name || p.name || "상품",
          price: Number(p.price || 0),
          currency: p.currency || "VND",
          description: p.description || "",
          imageUrl: coopProductImage(p),
          category: p.category || "",
          _fromBestErp: true
        });
      };
      snapMpName.forEach(addMp);
      snapMpId.forEach(addMp);
      snapItems.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        list.push({ id: d.id, ...d.data() });
      });

      if (!list.length) {
        if (stateEl) stateEl.textContent = _t('no_products');
        return;
      }

      if (stateEl) {
        stateEl.innerHTML = `${_t('products_count', list.length)} · <a href="/mall.html" style="color:#4f46e5;font-weight:800;text-decoration:underline;">통합 쇼핑몰에서 전체 보기 →</a>`;
      }
      grid.innerHTML = list.map((item) => {
        if (item._fromBestErp) {
          const img = item.imageUrl
            ? `<img src="${item.imageUrl}" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />`
            : `<div style="width:100%;height:130px;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:1.5rem;margin-bottom:8px;">🛍️</div>`;
          return `
            <a href="/mall.html" style="display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px;">
              ${img}
              <div style="font-weight:800;font-size:0.88rem;color:#0f172a;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.title}</div>
              <div style="font-weight:800;font-size:0.9rem;color:#ef4444;">${Number(item.price || 0).toLocaleString()} VND</div>
            </a>`;
        }
        return renderProductCard(item);
      }).join("");
    })
    .catch((e) => {
      console.warn("loadMerchantProducts failed:", e);
      if (stateEl) stateEl.textContent = _t('products_error');
    });
}

// 가맹점 상품&서비스 모음: /mall 과 같은 판매 중 상품(merchant_products)에서 대표 상품을 뽑아 보여줌
const HOME_MALL_MAX = 8;

// 상품 대표 이미지: BestERP 는 images[] (공통 규격), 예전 상품은 image_url/imageUrl/image (몰 coop-mall.js 와 같은 규칙)
function coopProductImage(p) {
  const raw = (Array.isArray(p.images) ? p.images.find((u) => typeof u === "string" && u.trim()) : "")
    || p.image_url || p.imageUrl || p.image || "";
  const u = String(raw).trim();
  if (!u) return "";
  if (/^(https?:|data:image\/)/i.test(u)) return u;
  try { return new URL(u, "https://besterp.netlify.app/admin/").href; } catch (_) { return ""; }
}

function normalizeHomeGroupBuy(p) {
  const gb = (p && typeof p.group_buy === "object" && p.group_buy !== null) ? p.group_buy : {};
  const enabled = gb.enabled === true || p?.group_buy_enabled === true || p?.isGroupBuy === true;
  if (!enabled) return { enabled: false };
  const dealPrice = Number(gb.deal_price || p.group_buy_price || p.groupBuyPrice || p.price || 0);
  const origPrice = Number(gb.original_price || p.original_price || p.originalPrice || p.price || dealPrice);
  const discPct = (origPrice > dealPrice && origPrice > 0) ? Math.round((1 - dealPrice / origPrice) * 100) : 0;
  const minP = Math.max(2, Number(gb.target_count || p.group_buy_target || p.groupBuyMinParticipants || 5));
  const curP = Math.max(0, Number(gb.current_count ?? p.group_buy_current ?? p.groupBuyCurrentParticipants ?? 0));
  const bonusBm = Math.max(0, Number(gb.bonus_point ?? p.group_buy_bonus_point ?? gb.bonus_bm ?? p.group_buy_bonus_bm ?? p.groupBuyBonusBm ?? 0)); // 보상 = Point
  const deadline = gb.deadline_iso || p.group_buy_deadline || p.groupBuyEndAt || "";
  return { enabled: true, dealPrice, origPrice, discPct, minP, curP, bonusBm, deadline };
}

function renderCoopCard(p) {
  const img = coopProductImage(p);
  const imgHtml = img
    ? `<img class="mp-product-thumb" src="${escHtml(img)}" alt="${escHtml(p.product_name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="mp-product-thumb-ph" style="display:none;">📦</div>`
    : `<div class="mp-product-thumb-ph">📦</div>`;

  const gb = normalizeHomeGroupBuy(p);
  const showPrice = gb.enabled ? gb.dealPrice : Number(p.price || 0);

  return `
    <a class="mp-product-card" href="/mall.html?product=${encodeURIComponent(p.id)}" style="position:relative;">
      ${gb.enabled ? `<span style="position:absolute;top:8px;left:8px;z-index:2;background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:99px;box-shadow:0 2px 6px rgba(239,68,68,.35);">🔥 공동구매${gb.discPct > 0 ? ` -${gb.discPct}%` : ""}</span>` : ""}
      ${imgHtml}
      <div class="mp-product-body">
        <span style="font-size:0.7rem;background:#eff6ff;color:#1d4ed8;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:3px;">🏪 ${escHtml(p.merchantName)}</span>
        <div class="mp-product-title">${escHtml(p.product_name)}</div>
        ${gb.enabled && gb.origPrice > gb.dealPrice ? `<div style="font-size:0.72rem;color:#94a3b8;text-decoration:line-through;">${gb.origPrice.toLocaleString()} VND</div>` : ""}
        <div class="mp-product-price" style="${gb.enabled ? "color:#dc2626;font-weight:800;" : ""}">${showPrice.toLocaleString()} VND</div>
      </div>
    </a>`;
}

function renderHomeGroupBuyBanner(gbList) {
  const wrap = $("homeGroupBuyShowcase");
  if (!wrap) return;
  if (!gbList || !gbList.length) {
    wrap.style.display = "none";
    return;
  }
  const cards = gbList.slice(0, 4).map((p) => {
    const img = coopProductImage(p) || "/assets/images/jump/logo2.png";
    const gb = normalizeHomeGroupBuy(p);
    const pct = Math.min(100, Math.round((gb.curP / gb.minP) * 100));
    return `
      <a href="/mall.html?product=${encodeURIComponent(p.id)}" style="display:flex;gap:12px;background:#fff;border:1.5px solid #fecaca;border-radius:14px;padding:12px;text-decoration:none;color:inherit;box-shadow:0 4px 14px rgba(239,68,68,.08);align-items:center;">
        <div style="position:relative;width:84px;height:84px;border-radius:10px;overflow:hidden;flex-shrink:0;background:#f8fafc;">
          <img src="${escHtml(img)}" alt="${escHtml(p.product_name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/assets/images/jump/logo2.png'" />
          ${gb.discPct > 0 ? `<span style="position:absolute;top:4px;left:4px;background:#dc2626;color:#fff;font-size:10px;font-weight:900;padding:1px 6px;border-radius:99px;">-${gb.discPct}%</span>` : ""}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">
            <span style="font-size:10.5px;font-weight:800;background:#fef2f2;color:#dc2626;padding:1px 7px;border-radius:99px;border:1px solid #fecaca;">🔥 공동구매 타임특가</span>
            <span style="font-size:10.5px;color:#64748b;font-weight:600;">🏪 ${escHtml(p.merchantName)}</span>
          </div>
          <div style="font-size:13.5px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(p.product_name)}</div>
          <div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;">
            <span style="font-size:14.5px;font-weight:900;color:#dc2626;">${gb.dealPrice.toLocaleString()} VND</span>
            ${gb.origPrice > gb.dealPrice ? `<span style="font-size:11px;color:#94a3b8;text-decoration:line-through;">${gb.origPrice.toLocaleString()}</span>` : ""}
          </div>
          <div style="margin-top:5px;">
            <div style="display:flex;justify-content:space-between;font-size:10.5px;font-weight:700;color:#b91c1c;margin-bottom:2px;">
              <span>📦 ${gb.curP}/${gb.minP}개 판매 (${pct}%)</span>
              ${gb.bonusBm ? `<span>🎁 달성 시 1개당 +${gb.bonusBm.toLocaleString()} Point</span>` : ''}
            </div>
            <div style="height:6px;background:#fee2e2;border-radius:99px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#ef4444,#f97316);border-radius:99px;"></div>
            </div>
          </div>
        </div>
      </a>`;
  }).join("");

  wrap.innerHTML = `
    <div style="background:linear-gradient(135deg,#fff1f2,#fff7ed);border:1.5px solid #fda4af;border-radius:16px;padding:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <div style="font-size:14px;font-weight:900;color:#9f1239;">⚡ 지금 진행 중인 하노이 교민 공동구매 · 타임특가</div>
        <a href="/mall.html?filter=groupbuy" style="font-size:12px;font-weight:800;color:#e11d48;text-decoration:none;">공동구매 전체 보기 →</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
        ${cards}
      </div>
    </div>`;
  wrap.style.display = "block";
}

// ── 웹매거진 최신 뉴스 (베스트 매거진과 같은 기사 목록: 저장된 기사 최신순 + 기본 기사) ──
const WEBZINE_NEWS_MAX = 10;
const webzineTime = (a) => a.createdAt?.seconds || (typeof a.createdAt === "number" ? a.createdAt : 0);
function webzineDate(a) {
  const t = webzineTime(a);
  if (t) return new Date(t * 1000).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  return a.dateStr || "";
}
function renderWebzineCard(a) {
  const href = `/kca_webzine.html?article=${encodeURIComponent(a.id)}`;
  const thumb = String(a.thumbnailUrl || "").trim();
  const imgHtml = /^(https?:|\/|data:image\/)/i.test(thumb)
    ? `<img class="wzn-thumb" src="${escHtml(thumb)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;wzn-thumb-ph&quot;>📰</div>'">`
    : `<div class="wzn-thumb-ph">📰</div>`;
  return `
    <a class="wzn-card" href="${escHtml(href)}">
      ${imgHtml}
      <div class="wzn-body">
        <span class="wzn-cat">${escHtml(a.category || "매거진")}</span>
        <div class="wzn-title">${escHtml(a.title)}</div>
        <div class="wzn-sum">${escHtml(a.subtitle || a.summary || "")}</div>
        <div class="wzn-date">${escHtml(webzineDate(a))}</div>
      </div>
    </a>`;
}
async function loadWebzineNews() {
  const grid = $("webzineNewsGrid");
  if (!grid) return;
  const hide = () => { const sec = $("webzineNewsSection"); if (sec) sec.style.display = "none"; };
  try {
    const savedIds = new Set();
    const saved = [];
    try {
      const snap = await getDocs(query(collection(db, "webzine_articles"), orderBy("createdAt", "desc"), limit(50)));
      snap.forEach((d) => {
        savedIds.add(d.id);
        const data = d.data() || {};
        if (data.deleted === true || !data.title) return;
        saved.push({ id: d.id, ...data });
      });
    } catch (e) {
      console.warn("webzine_articles 조회 실패:", e?.message || e);
    }
    saved.sort((a, b) => webzineTime(b) - webzineTime(a));
    let presets = [];
    if (saved.length < WEBZINE_NEWS_MAX) {
      try {
        const mod = await import("./webzine-seed-data.js");
        presets = (mod.WEBZINE_20_ARTICLES || []).filter((a) => a && a.id && a.title && !savedIds.has(a.id));
      } catch (_) {}
    }
    const list = [...saved, ...presets].slice(0, WEBZINE_NEWS_MAX);
    if (!list.length) return hide();
    grid.innerHTML = list.map(renderWebzineCard).join("");
  } catch (e) {
    console.warn("loadWebzineNews failed:", e);
    hide();
  }
}

async function loadCoopProducts() {
  const grid = $("coopProductsGrid");
  if (!grid) return;
  const hide = () => { const sec = $("coopProductsSection"); if (sec) sec.style.display = "none"; };

  try {
    const [snap, merchants] = await Promise.all([
      getDocs(query(collection(db, "merchant_products"), where("sale_status", "==", "published"))),
      fetchMerchantsOnce().catch(() => null),
    ]);

    const names = {};
    merchants?.forEach((d) => {
      const m = d.data() || {};
      const name = m.name || m.merchantName || d.id;
      names[String(d.id)] = name;
      if (m.merchantId) names[String(m.merchantId)] = name;
    });
    const merchantName = (id) => names[String(id)] || (String(id) === "1791002036" ? "대한김치" : String(id) === "1791605366" ? "베스트위너" : "가맹점");

    // 사진 있는 상품 우선, 최신순
    const ts = (p) => p.created_at?.seconds || 0;
    const list = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      list.push({ id: d.id, ...data, merchantName: merchantName(data.merchant_id) });
    });
    list.sort((a, b) => (coopProductImage(b) ? 1 : 0) - (coopProductImage(a) ? 1 : 0) || ts(b) - ts(a));

    // 활성화된 공동구매 상품 먼저 상단 쇼케이스에 렌더링
    const now = Date.now();
    const gbItems = list.filter((p) => {
      const gb = normalizeHomeGroupBuy(p);
      if (!gb.enabled) return false;
      const endMs = gb.deadline ? Date.parse(gb.deadline) : 0;
      return !endMs || endMs > now;
    });
    renderHomeGroupBuyBanner(gbItems);

    // 가맹점별로 번갈아 뽑아 한 가맹점이 다 채우지 않게
    const byMerchant = new Map();
    list.forEach((p) => {
      const k = String(p.merchant_id || "");
      if (!byMerchant.has(k)) byMerchant.set(k, []);
      byMerchant.get(k).push(p);
    });
    const picks = [];
    const queues = [...byMerchant.values()];
    while (picks.length < HOME_MALL_MAX && queues.some((q) => q.length)) {
      queues.forEach((q) => { if (q.length && picks.length < HOME_MALL_MAX) picks.push(q.shift()); });
    }

    if (!picks.length) return hide();
    grid.innerHTML = picks.map((p) => renderCoopCard(p)).join("");
  } catch (e) {
    console.warn("loadCoopProducts failed:", e);
    hide();
  }
}

function usedStateText(s) {
  return s === "sold" ? _t('sold') : s === "reserved" ? _t('reserved') : _t('for_sale');
}

function usedThumb(post) {
  if (Array.isArray(post?.imageUrls) && post.imageUrls[0]) return post.imageUrls[0];
  if (post?.imageUrl) return post.imageUrl;
  return "/assets/images/jump/BI.png";
}

function renderUsedCard(post) {
  return `
    <a class="used-card" href="/used-market-item.html?id=${encodeURIComponent(post.id)}">
      <img class="used-thumb" src="${escHtml(usedThumb(post))}" alt="${escHtml(post.title || "중고물품")}" loading="lazy" />
      <div class="used-body">
        <div class="used-title">${escHtml(post.title || "제목 없음")}</div>
        <div class="used-meta">
          <span class="used-price">${Number(post.price || 0).toLocaleString()}원</span>
          <span class="used-state">${usedStateText(post.status)}</span>
        </div>
      </div>
    </a>`;
}

async function loadUsedMarketPreview() {
  const grid = $("usedMarketPreviewGrid");
  const state = $("usedMarketPreviewState");
  if (!grid) return;

  if (state) state.textContent = _t('loading');
  try {
    const snap = await getDocs(query(collection(db, "usedMarketPosts"), orderBy("createdAt", "desc"), limit(8)));
    const list = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.status !== "hidden") list.push({ id: d.id, ...data });
    });

    if (!list.length) {
      if (state) state.textContent = _t('no_used');
      grid.innerHTML = "";
      return;
    }

    if (state) state.textContent = _t('used_count', list.length);
    grid.innerHTML = list.map(renderUsedCard).join("");
  } catch (e) {
    console.warn("loadUsedMarketPreview failed:", e);
    if (state) state.textContent = _t('used_error');
  }
}
const DEFAULT_SEED_BANNERS = [
  {
    id: "coupon_k1",
    isCoupon: true,
    badge: "BEST WINNER",
    title: "k1 방수제 20% 할인권",
    subtitle: "k1 방수제 구매 시 제출하시면 20% 즉시 할인 (10,000 BM)",
    linkUrl: "/events.html",
    active: true,
    sortOrder: -100,
    imageUrl: "https://bestwinnervn.com/images/waterproofing/k1_overview_product.png",
  },
  {
    id: "1",
    isCoupon: false,
    badge: "SPONSOR",
    title: "HEX P2P거래소",
    subtitle: "HEX토큰 KRW&VND P2P 거래",
    linkUrl: "https://vetdao.netlify.app/index.html",
    active: true,
    sortOrder: 1,
    imageUrl: "https://vetdao.netlify.app/assets/img/vet.png",
  },
  {
    id: "2",
    isCoupon: false,
    badge: "SPONSOR",
    title: "Zentaro (젠타로)",
    subtitle: "K-Culture Flavour Portal & Dining",
    linkUrl: "https://zentaro.netlify.app/",
    active: true,
    sortOrder: 2,
    imageUrl: "/assets/images/jump/logo2.png",
  },
  {
    id: "3",
    isCoupon: false,
    badge: "SPONSOR",
    title: "대한김치 (Daehan)",
    subtitle: "100% 핸드메이드 숙성 프리미엄 김치",
    linkUrl: "https://daehankimchi.netlify.app/",
    active: true,
    sortOrder: 3,
    imageUrl: "/assets/images/jump/logo2.png",
  },
];

async function loadSponsorBannersFromDb() {
  try {
    const raw = localStorage.getItem("bc_cache_sponsor_banners");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (_) {}
  return DEFAULT_SEED_BANNERS;
}

function sponsorSlideHtml(row, idx) {
  const title = escHtml(row.title || "스폰서");
  const subtitle = escHtml(row.subtitle || "");
  const imageUrl = escHtml(row.imageUrl || "/assets/images/jump/logo2.png");
  const linkUrl = escHtml(row.linkUrl || "/events.html");
  const activeClass = idx === 0 ? " is-active" : "";
  const isExternal = String(linkUrl).startsWith("http");
  const isCoupon = !!row.isCoupon;
  const badgeText = escHtml(row.badge || (isCoupon ? "COUPON" : "SPONSOR"));
  const badgeClass = isCoupon ? "sponsor-card-badge--coupon" : "sponsor-card-badge--ad";

  return `
    <a class="sponsor-slide${activeClass}" data-idx="${idx}" href="${linkUrl}" ${isExternal ? 'target="_blank" rel="noopener"' : ""}>
      <div class="sponsor-card-inner">
        <div class="sponsor-card-media">
          <img class="sponsor-slide-logo" src="${imageUrl}" alt="${title}" loading="lazy" onerror="this.src='/assets/images/jump/logo2.png'" />
          <span class="sponsor-card-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="sponsor-slide-copy">
          <strong class="sponsor-title">${title}</strong>
          <span class="sponsor-sub">${subtitle}</span>
        </div>
        <div class="sponsor-card-arrow">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    </a>`;
}

async function initSponsorRotator() {
  const root = $("sponsorRotator");
  const dotsWrap = $("sponsorDots");
  if (!root || !dotsWrap) return;

  // 1) 0초 즉시 캐시/시드 배너 렌더링
  let banners = await loadSponsorBannersFromDb();
  function renderAllSlides(list) {
    if (!list || !list.length) return;
    root.innerHTML = list.map((r, i) => sponsorSlideHtml(r, i)).join("");
    const slides = Array.from(root.querySelectorAll(".sponsor-slide"));
    if (!slides.length) return;

    let idx = 0;
    let timer = null;

    function renderDots() {
      dotsWrap.innerHTML = slides
        .map((_, i) => `<span class="sponsor-dot ${i === idx ? "is-active" : ""}" data-idx="${i}" role="button" tabindex="0" aria-label="${_t('sponsor_dot', i + 1)}"></span>`)
        .join("");
    }

    function show(next) {
      idx = ((next % slides.length) + slides.length) % slides.length;
      slides.forEach((el, i) => el.classList.toggle("is-active", i === idx));
      dotsWrap.querySelectorAll(".sponsor-dot").forEach((el, i) => el.classList.toggle("is-active", i === idx));
    }

    function start() {
      stop();
      if (slides.length > 1) {
        timer = setInterval(() => show(idx + 1), 4000);
      }
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    dotsWrap.onclick = (e) => {
      const dot = e.target.closest(".sponsor-dot");
      if (!dot) return;
      const next = Number(dot.dataset.idx);
      if (Number.isFinite(next)) show(next);
    };

    root.onmouseenter = stop;
    root.onmouseleave = start;
    root.onfocusin = stop;
    root.onfocusout = start;

    renderDots();
    show(0);
    start();
  }

  renderAllSlides(banners);

  // 2) 백그라운드에서 이벤트 쿠폰·바우처(coupon_campaigns) + 스폰서 배너(sponsorBanners) 통합 조회
  try {
    const rows = [];

    // 2-a) 활성화된 이벤트 쿠폰 & 바우처 가져오기
    try {
      const cSnap = await getDocs(query(collection(db, "coupon_campaigns"), where("status", "==", "active")));
      cSnap.forEach((d) => {
        const c = d.data() || {};
        const priceStr = Number(c.priceBM || 0) > 0 ? `${Number(c.priceBM).toLocaleString()} BM` : "무료 발급";
        const discountDesc = c.discountValue ? `[${c.discountValue}] ` : "";
        rows.push({
          id: `coupon_${d.id}`,
          campaignId: d.id,
          isCoupon: true,
          badge: c.issuerBadge || (c.campaignType === "VOUCHER" ? "VOUCHER" : "COUPON"),
          title: c.title || "이벤트 쿠폰",
          subtitle: `${discountDesc}${c.description || ""} · ${priceStr}`,
          imageUrl: c.imageUrl || "https://bestwinnervn.com/images/waterproofing/k1_overview_product.png",
          linkUrl: `/events.html`,
          sortOrder: -100, // 최우선 노출
          active: true,
        });
      });
    } catch (ce) {
      console.warn("fetch coupon_campaigns note:", ce?.message || ce);
    }

    // 2-b) 제휴 스폰서 배너 가져오기
    try {
      const snap = await getDocs(query(collection(db, "sponsorBanners")));
      snap.forEach((d) => {
        const data = d.data() || {};
        if (data.active !== false) {
          rows.push({
            id: d.id,
            isCoupon: false,
            badge: "SPONSOR",
            title: data.title || "스폰서",
            subtitle: data.subtitle || "",
            imageUrl: data.imageUrl || "/assets/images/jump/logo2.png",
            linkUrl: data.linkUrl || "/",
            sortOrder: Number(data.sortOrder || 0),
            active: true,
          });
        }
      });
    } catch (be) {
      console.warn("fetch sponsorBanners note:", be?.message || be);
    }

    if (rows.length > 0) {
      rows.sort((a, b) => {
        const aa = Number(a.sortOrder || 0);
        const bb = Number(b.sortOrder || 0);
        return aa - bb;
      });
      try {
        localStorage.setItem("bc_cache_sponsor_banners", JSON.stringify(rows));
      } catch (_) {}
      renderAllSlides(rows);
    }
  } catch (err) {
    console.warn("initSponsorRotator background fetch:", err?.message || err);
  }

  // 3) 수퍼어드민 접속 시 홈 화면에서 바로 배너 관리로 이동하는 버튼 노출
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const email = (user.email || "").toLowerCase().trim();
      let isSuper = email === "daguri75@gmail.com";
      if (!isSuper) {
        const aSnap = await getDoc(doc(db, "admins", user.uid));
        if (aSnap.exists()) isSuper = true;
      }
      if (!isSuper) {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          const ud = uSnap.data() || {};
          if (ud.isAdmin === true || ["SUPER_ADMIN", "ADMIN", "admin"].includes(ud.role)) {
            isSuper = true;
          }
        }
      }
      if (isSuper) {
        const btn = $("btnAdminBannerManage");
        if (btn) btn.style.display = "inline-flex";
      }
    } catch (_) {}
  });
}
function initUISlider() {
  // 기존 슬라이더 섹션이 없으면 아무 작업 안함
}

onAuthStateChanged(auth, async (user) => {
  const admin = await isAdmin(user?.uid);
  setupAdminUI(admin);

  // 레벨·지갑 주소 로드 (공유카드 레퍼럴 기능용)
  if (user?.uid) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.data() || {};
      _userWalletAddr = String(data.wallet?.address || "");
      // onChain 레벨은 Cloud Function으로 조회
      if (_userWalletAddr) {
        try {
          const fn = httpsCallable(functions, "getMyOnChain");
          const res = await fn();
          _userLevel = Number(res.data?.level || 0);
        } catch {
          // 레벨 조회 실패 시 0 유지
        }
      }
    } catch {
      // 유저 정보 조회 실패 시 무시
    }
  }
});

initLang();
loadNotices();
initJackpotTicker();
loadJackpotWinners();
loadRankings();
loadUsedMarketPreview();
loadMerchants();
loadCoopProducts();
loadWebzineNews();
initSponsorRotator().catch((e) => console.warn("sponsor init failed:", e));
initUISlider();
loadPlacesMap();

