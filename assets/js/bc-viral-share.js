// /assets/js/bc-viral-share.js
// 바이럴 추천 공유 카드 생성기 (내 추천인 링크 자동 포함 + 카톡/잘로/페북 홍보문구 복사 + 1080x1080 PNG 카드 + 네이티브 공유)

import { auth, db } from "/assets/js/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const HIDDEN_PATHS = [
  "/billiards.html",
  "/tetris.html",
  "/2048.html",
  "/suika.html",
  "/bankpanic.html",
  "/bow.html",
  "/conquest.html",
  "/memory.html",
  "/relay.html",
  "/treasure.html",
];

const THEMES = {
  game: {
    id: "game",
    tabLabel: "🎮 3억 GP 게임",
    badge: "WEEKLY 3억 GP TOURNAMENT",
    title: "매주 총상금 3억 GP!\n같이 랭킹 도전해요",
    sub: "베스트당구장(1위 5천만 GP) · 테트리스 · 2048 · 수이카",
    cta: "내 초대 링크로 가입 시 1,000 GP 즉시 지급!",
    bg1: "#1e1b4b",
    bg2: "#4c1d95",
    accent: "#fde047",
    copyPrefix: "🏆 [베스트클럽 주간 3억 GP 게임 토너먼트]\n매주 일요일 TOP 10 자동 정산! (당구 1위 5,000만 GP)\n아래 내 초대 링크로 10초 가입하면 즉시 1,000 GP 보너스 🎁",
  },
  mall: {
    id: "mall",
    tabLabel: "🔥 공동구매 특가",
    badge: "HANOI BESTCLUB MALL",
    title: "하노이 교민 공동구매\n타임특가 + 추가 BM!",
    sub: "대한김치 · BEST WINNER · 제휴 가맹점 특가 직배송",
    cta: "내 초대 링크로 가입 시 1,000 GP + 특가 혜택!",
    bg1: "#7c2d12",
    bg2: "#c2410c",
    accent: "#fef08a",
    copyPrefix: "🔥 [하노이 베스트클럽 교민 공동구매·타임특가]\n할인가 확정 + 목표 달성 시 전원 추가 BM 보너스!\n아래 초대 링크로 가입하고 1,000 GP 바로 받으세요 🎁",
  },
  member: {
    id: "member",
    tabLabel: "🎟️ 가맹점 잭팟",
    badge: "BESTCLUB ALLIANCE",
    title: "가맹점 결제할 때마다\nBT & 100% 당첨 잭팟!",
    sub: "하노이 제휴 가맹점 리워드 · 당근 중고장터 · 통합 멤버십",
    cta: "내 초대 링크로 가입 시 신규·추천 보너스 즉시 지급!",
    bg1: "#0f172a",
    bg2: "#065f46",
    accent: "#6ee7b7",
    copyPrefix: "🎟️ [베스트클럽 하노이 통합 멤버십 초대]\n제휴 가맹점 결제 시 보너스 티켓(BT) & 100% 당첨 포인트 잭팟!\n아래 초대 링크로 10초 가입하고 1,000 GP 받으세요 🎁",
  },
};

function shouldMount() {
  const path = location.pathname.toLowerCase();
  if (path.includes("admin")) return false;
  if (HIDDEN_PATHS.some((p) => path.endsWith(p))) return false;
  return true;
}

function defaultThemeForPage() {
  const path = location.pathname.toLowerCase();
  if (path.includes("mall") || path.includes("product") || path.includes("coop")) return "mall";
  if (path.includes("game")) return "game";
  return "member";
}

let _userProfile = { email: "", name: "" };

async function loadCurrentUserProfile() {
  const u = auth?.currentUser;
  if (!u || u.isAnonymous) {
    _userProfile = { email: "", name: "" };
    return _userProfile;
  }
  const email = (u.email || "").toLowerCase();
  let name = u.displayName || "";
  try {
    const snap = await getDoc(doc(db, "users", u.uid));
    if (snap.exists()) {
      const d = snap.data() || {};
      if (d.name) name = d.name;
    }
  } catch (_) {}
  _userProfile = { email, name };
  return _userProfile;
}

function buildReferralUrl() {
  const origin = "https://bestclubvn.netlify.app";
  if (_userProfile.email) {
    return `${origin}/register.html?mentor=${encodeURIComponent(_userProfile.email)}`;
  }
  return `${origin}/register.html`;
}

function renderCardCanvas(canvas, themeKey) {
  const theme = THEMES[themeKey] || THEMES.member;
  const W = 1080;
  const H = 1080;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 배경 그라데이션
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bg1);
  grad.addColorStop(1, theme.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 장식 원형 글로우
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.arc(900, 180, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(160, 920, 220, 0, Math.PI * 2);
  ctx.fill();

  // 상단 배지
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(240, 88, 600, 58, 29);
  ctx.fill();
  ctx.fillStyle = theme.accent;
  ctx.font = "900 26px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(theme.badge, W / 2, 126);

  // 메인 타이틀 (줄바꿈 지원)
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 72px 'Pretendard', 'Malgun Gothic', sans-serif";
  const lines = theme.title.split("\n");
  lines.forEach((line, idx) => {
    ctx.fillText(line, W / 2, 275 + idx * 96);
  });

  // 서브 설명
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "700 32px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText(theme.sub, W / 2, 480);

  // 중앙 혜택 카드
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.roundRect(96, 555, 888, 260, 32);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = theme.accent;
  ctx.font = "900 36px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText(theme.cta, W / 2, 635);

  const inviterText = _userProfile.email
    ? `추천인: ${_userProfile.name ? `${_userProfile.name} (${_userProfile.email})` : _userProfile.email}`
    : "베스트클럽 공식 초대장 (10초 간편 가입)";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 28px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText(inviterText, W / 2, 705);

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = "600 25px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText("가입 즉시 1,000 GP + 가맹점 결제 리워드 + 주간 게임 랭킹", W / 2, 765);

  // 하단 URL 바
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(220, 885, 640, 86, 43);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 32px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText("bestclubvn.netlify.app", W / 2, 940);
}

function mountViralShare() {
  if (!shouldMount()) return;
  if (document.getElementById("bcViralShareRoot")) return;

  const style = document.createElement("style");
  style.textContent = `
    .bc-share-fab {
      position: fixed;
      left: 132px;
      bottom: 18px;
      z-index: 9989;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 11px 14px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.22);
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #fff;
      font-size: 0.84rem;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 8px 22px rgba(234, 88, 12, 0.34);
      transition: transform 0.15s ease;
    }
    .bc-share-fab:hover { transform: translateY(-2px); }
    @media (max-width: 820px) {
      .bc-share-fab {
        display: none !important;
      }
    }
    .bc-share-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10010;
      background: rgba(15, 23, 42, 0.65);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .bc-share-backdrop.is-open { display: flex; }
    .bc-share-modal {
      width: min(440px, 100%);
      max-height: 92vh;
      overflow-y: auto;
      background: #fff;
      border-radius: 22px;
      padding: 18px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
    }
    .bc-share-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .bc-share-head h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 900;
      color: #0f172a;
    }
    .bc-share-close {
      background: #f1f5f9;
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-weight: 800;
      cursor: pointer;
      color: #334155;
    }
    .bc-share-tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 12px;
    }
    .bc-share-tab {
      padding: 8px 4px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 0.76rem;
      font-weight: 800;
      color: #475569;
      cursor: pointer;
    }
    .bc-share-tab.is-active {
      background: #4f46e5;
      border-color: #4f46e5;
      color: #fff;
    }
    .bc-share-preview {
      width: 100%;
      aspect-ratio: 1 / 1;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      margin-bottom: 12px;
      background: #0f172a;
    }
    .bc-share-preview canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
    .bc-share-ref-note {
      font-size: 0.78rem;
      padding: 8px 10px;
      border-radius: 10px;
      background: #f5f3ff;
      color: #4c1d95;
      font-weight: 700;
      margin-bottom: 10px;
      word-break: break-all;
    }
    .bc-share-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bc-share-btn {
      width: 100%;
      padding: 11px 14px;
      border-radius: 12px;
      border: none;
      font-size: 0.88rem;
      font-weight: 800;
      cursor: pointer;
    }
    .bc-share-btn--primary {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff;
    }
    .bc-share-btn--gold {
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      color: #fff;
    }
    .bc-share-btn--ghost {
      background: #f1f5f9;
      color: #0f172a;
      border: 1px solid #e2e8f0;
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "bcViralShareRoot";
  root.innerHTML = `
    <button type="button" class="bc-share-fab" id="bcShareFab" aria-label="친구 초대 및 공유 카드 만들기">
      <span>🎁</span><span>초대·공유</span>
    </button>
    <div class="bc-share-backdrop" id="bcShareBackdrop" role="dialog" aria-modal="true" aria-label="베스트클럽 바이럴 공유 카드">
      <div class="bc-share-modal">
        <div class="bc-share-head">
          <h3>🎁 바이럴 초대·공유 카드</h3>
          <button type="button" class="bc-share-close" id="bcShareClose" aria-label="닫기">✕</button>
        </div>
        <div class="bc-share-tabs">
          <button type="button" class="bc-share-tab" data-theme="member">🎟️ 가맹점 잭팟</button>
          <button type="button" class="bc-share-tab" data-theme="mall">🔥 공동구매 특가</button>
          <button type="button" class="bc-share-tab" data-theme="game">🎮 3억 GP 게임</button>
        </div>
        <div class="bc-share-preview">
          <canvas id="bcShareCanvas"></canvas>
        </div>
        <div class="bc-share-ref-note" id="bcShareRefNote">추천 링크 준비 중...</div>
        <div class="bc-share-actions">
          <button type="button" class="bc-share-btn bc-share-btn--primary" id="bcShareBtnNative">📤 카톡 · 잘로 · SNS 바로 공유하기</button>
          <button type="button" class="bc-share-btn bc-share-btn--gold" id="bcShareBtnCopy">📋 홍보 문구 + 내 추천 링크 복사</button>
          <button type="button" class="bc-share-btn bc-share-btn--ghost" id="bcShareBtnDownload">🖼️ 공유 카드 이미지 저장 (PNG)</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const fab = document.getElementById("bcShareFab");
  const backdrop = document.getElementById("bcShareBackdrop");
  const closeBtn = document.getElementById("bcShareClose");
  const canvas = document.getElementById("bcShareCanvas");
  const refNote = document.getElementById("bcShareRefNote");
  const btnNative = document.getElementById("bcShareBtnNative");
  const btnCopy = document.getElementById("bcShareBtnCopy");
  const btnDownload = document.getElementById("bcShareBtnDownload");
  const tabBtns = Array.from(root.querySelectorAll(".bc-share-tab"));

  let currentTheme = defaultThemeForPage();

  const refreshView = () => {
    tabBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.theme === currentTheme));
    renderCardCanvas(canvas, currentTheme);
    const url = buildReferralUrl();
    if (refNote) {
      refNote.textContent = _userProfile.email
        ? `✅ 내 추천인 링크 자동 포함: ${url}`
        : `💡 로그인하면 내 추천인(멘토) 링크가 자동 포함됩니다: ${url}`;
    }
  };

  const openModal = async (themeOverride) => {
    if (themeOverride && THEMES[themeOverride]) currentTheme = themeOverride;
    await loadCurrentUserProfile();
    refreshView();
    backdrop?.classList.add("is-open");
  };

  window.openBestClubShareModal = openModal;

  fab?.addEventListener("click", () => openModal());
  closeBtn?.addEventListener("click", () => backdrop?.classList.remove("is-open"));
  backdrop?.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.classList.remove("is-open");
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTheme = btn.dataset.theme || "member";
      refreshView();
    });
  });

  btnCopy?.addEventListener("click", async () => {
    const theme = THEMES[currentTheme] || THEMES.member;
    const url = buildReferralUrl();
    const text = `${theme.copyPrefix}\n👉 ${url}`;
    try {
      await navigator.clipboard.writeText(text);
      btnCopy.textContent = "✅ 문구와 추천 링크가 복사되었습니다!";
      setTimeout(() => { btnCopy.textContent = "📋 홍보 문구 + 내 추천 링크 복사"; }, 2200);
    } catch (_) {
      prompt("아래 홍보 문구를 복사해 주세요:", text);
    }
  });

  btnDownload?.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = `bestclub-share-${currentTheme}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  btnNative?.addEventListener("click", async () => {
    const theme = THEMES[currentTheme] || THEMES.member;
    const url = buildReferralUrl();
    const shareData = {
      title: "베스트클럽 (BestClub) 초대장",
      text: theme.copyPrefix,
      url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (_) {}
    }
    // Web Share API 미지원 환경(일부 PC 브라우저)에서는 복사로 대체
    btnCopy?.click();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountViralShare);
} else {
  mountViralShare();
}
