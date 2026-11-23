// /assets/js/bc-ai-concierge.js
// 베스트클럽 AI 하노이 컨시어지 (실시간 Firestore 상품·가맹점·내 잔액·환율·게임 랭킹 안내)

import { auth, db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

function shouldMount() {
  const path = location.pathname.toLowerCase();
  if (path.includes("admin")) return false;
  if (HIDDEN_PATHS.some((p) => path.endsWith(p))) return false;
  return true;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let _cacheProducts = null;
let _cacheMerchants = null;

async function fetchPublishedProducts() {
  if (_cacheProducts) return _cacheProducts;
  try {
    const q = query(collection(db, "merchant_products"), where("sale_status", "==", "published"), limit(30));
    const snap = await getDocs(q);
    _cacheProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return _cacheProducts;
  } catch (_) {
    return [];
  }
}

async function fetchMerchants() {
  if (_cacheMerchants) return _cacheMerchants;
  try {
    const snap = await getDocs(query(collection(db, "merchants"), limit(30)));
    _cacheMerchants = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return _cacheMerchants;
  } catch (_) {
    return [];
  }
}

async function getFxText() {
  try {
    const raw = localStorage.getItem("bc_live_fx_v1");
    if (raw) {
      const fx = JSON.parse(raw);
      if (fx?.krwPerUsd && fx?.vndPerUsd) {
        const vnd10k = Math.round((10000 / fx.krwPerUsd) * fx.vndPerUsd);
        return `💱 <b>현재 환율 기준</b><br/>• 10,000원 ≈ <b>${vnd10k.toLocaleString("ko-KR")}₫</b><br/>• 1 USD = ${Math.round(fx.krwPerUsd).toLocaleString("ko-KR")}원 / ${Math.round(fx.vndPerUsd).toLocaleString("ko-KR")}₫`;
      }
    }
  } catch (_) {}
  const fx = window.__jackpotFx || { krw: 1380, vnd: 25400 };
  const vnd10k = Math.round((10000 / fx.krw) * fx.vnd);
  return `💱 <b>기준 환율</b><br/>• 10,000원 ≈ <b>${vnd10k.toLocaleString("ko-KR")}₫</b><br/>• 1 USD ≈ ${fx.krw.toLocaleString("ko-KR")}원 / ${fx.vnd.toLocaleString("ko-KR")}₫`;
}

async function buildAnswer(inputRaw) {
  const qText = String(inputRaw || "").trim();
  const lower = qText.toLowerCase();

  // 1. 매일 무료 럭키 룰렛 / 출석 문의
  if (/룰렛|럭키|출석|무료\s*gp|돌리/.test(lower)) {
    const openAction = typeof window.openBestClubRoulette === "function"
      ? `<a href="#" class="bc-ai-link" onclick="event.preventDefault();window.openBestClubRoulette();">🎰 지금 바로 럭키 룰렛 열기 →</a>`
      : `<a href="/#hanoiUtilityBarSection" class="bc-ai-link">🎰 홈에서 무료 럭키 룰렛 돌리기 →</a>`;
    return `🎰 <b>매일 1회 무료 럭키 룰렛</b><br/>• 로그인 회원은 <b>하루 1회(베트남 00:00 리셋)</b> 100% 당첨!<br/>• 당첨 구간: <b>100 ~ 3,000 GP</b> (서버 공정 추첨)<br/>• 🔥 <b>7일 연속 출석</b> 시 <b>+2,000 GP</b> 추가 보너스!<br/>${openAction}`;
  }

  // 1-2. GP → Point 전환 / 5,000 GP 유보 문의
  if (/전환|교환|5000|5,000|gp.*p|포인트.*바꾸/.test(lower)) {
    return `🔄 <b>게임 GP → Point 전환 안내</b><br/>• 게임 참여용 <b>5,000 GP</b>는 남겨 두고 나머지 GP를 전환합니다.<br/>• 공식: <b>(전환 GP × 게임 레벨) ÷ 10 = Point</b> (최소 10 GP)<br/>• 전환 내역은 마이페이지 <b>GP 획득내역</b>에서 바로 확인 가능합니다.<br/><a href="/mypage.html" class="bc-ai-link">마이페이지에서 전환하기 →</a>`;
  }

  // 2. 환율 문의
  if (/환율|원화|vnd|krw|달러|usd/.test(lower)) {
    const fx = await getFxText();
    return `${fx}<br/><a href="/#hanoiUtilityBarSection" class="bc-ai-link">홈 환율 계산기 열기 →</a>`;
  }

  // 3. 내 포인트 / 잔액
  if (/포인트|잔액|지갑|내 정보|bt|bm|gp|얼마/.test(lower) && !/게임|랭킹|3억/.test(lower)) {
    const user = auth?.currentUser;
    if (!user || user.isAnonymous) {
      return `🔐 아직 로그인하지 않으셨어요!<br/>로그인하면 내 <b>BM · 포인트(P) · BT · GP</b> 잔액을 바로 확인할 수 있고, 신규 가입 시 <b>1,000 GP</b>가 즉시 지급됩니다.<br/><a href="/register.html" class="bc-ai-link">로그인 / 10초 가입하기 →</a>`;
    }
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const d = snap.exists() ? snap.data() : {};
      return `💰 <b>${escapeHtml(d.name || user.displayName || "회원")}님 현재 보유 자산</b><br/>• 결제 머니(BM): <b>${Number(d.pointBalanceVnd || 0).toLocaleString("ko-KR")} BM</b><br/>• 포인트(P): <b>${Number(d.pointBalance || 0).toLocaleString("ko-KR")} P</b><br/>• 게임 포인트(GP): <b>${Number(d.gpBalance || d.gamePoints || 0).toLocaleString("ko-KR")} GP</b><br/><a href="/mypage.html" class="bc-ai-link">마이페이지 자세히 보기 →</a>`;
    } catch (_) {
      return `마이페이지에서 보유 BM · 포인트 · BT 내역을 확인하실 수 있습니다.<br/><a href="/mypage.html" class="bc-ai-link">마이페이지 이동 →</a>`;
    }
  }

  // 4. 게임 / 주간 3억 GP
  if (/게임|랭킹|당구|테트리스|수이카|수박|2048|뱅크패닉|3억|토너먼트/.test(lower)) {
    return `🎮 <b>주간 3억 GP 게임 토너먼트</b><br/>매주 일요일 00:00(베트남 시간) 마감 즉시 TOP 10 자동 지급!<br/>• 🎱 베스트당구장(S티어): 1위 5,000만 GP<br/>• 🧱 네온테트리스(A티어): 1위 180만 GP<br/>• 🤠 뱅크패닉(라이프 3개 · FEVER ×2 · 보스전) · 🔢 2048 · 🍉 수이카<br/><a href="/games.html" class="bc-ai-link">게임 전체보기 →</a>`;
  }

  // 4. 중고 / 당근
  if (/중고|당근|직거래|장터/.test(lower)) {
    return `🥕 <b>하노이 한인 당근 중고장터</b><br/>미딩·서호·하동·오션파크 동네 직거래와 BM 안전결제를 지원합니다.<br/><a href="/used.html" class="bc-ai-link">중고장터 바로가기 →</a>`;
  }

  // 5. 가맹점주 / QR / 리포트
  if (/qr|리포트|사장|멘티|가맹점주/.test(lower)) {
    return `🏪 <b>가맹점주 전용 도구</b><br/>• 결제 QR · BT 발급 · 카운터용 멘티 자동가입 포스터 생성<br/>• 직속 멘티 &amp; 제휴회원 주문 1분 모바일 리포트<br/><a href="/merchant-qr.html" class="bc-ai-link">결제·멘티 QR 만들기 →</a> &nbsp; <a href="/merchant-report.html" class="bc-ai-link">1분 리포트 →</a>`;
  }

  // 6. 공동구매 / 특가 / 쇼핑몰
  if (/공동구매|특가|쇼핑|상품|몰|구매|살|김치|주문/.test(lower)) {
    const products = await fetchPublishedProducts();
    const matched = qText.length >= 2 && !/공동구매|특가|쇼핑|상품|몰/.test(lower)
      ? products.filter((p) => String(p.product_name || "").toLowerCase().includes(lower))
      : products;
    const list = (matched.length ? matched : products).slice(0, 4);

    if (list.length > 0) {
      const rows = list
        .map((p) => `• <b>${escapeHtml(p.product_name || "상품")}</b> — ${Number(p.price || 0).toLocaleString("ko-KR")} VND`)
        .join("<br/>");
      return `🔥 <b>현재 판매 중인 인기 상품</b><br/>${rows}<br/><a href="/mall.html" class="bc-ai-link">통합 쇼핑몰 전체보기 →</a>`;
    }
    return `🔥 하노이 교민 공동구매와 타임특가 상품을 쇼핑몰에서 확인해 보세요!<br/><a href="/mall.html" class="bc-ai-link">통합 쇼핑몰 이동 →</a>`;
  }

  // 7. 제휴 가맹점 추천 / 맛집 / 매장
  if (/가맹점|매장|식당|맛집|추천|미딩|하노이/.test(lower)) {
    const merchants = await fetchMerchants();
    const list = merchants.filter((m) => m.name).slice(0, 5);
    if (list.length > 0) {
      const rows = list
        .map((m) => {
          const rate = Number(m.btPerVnd || 100000).toLocaleString("ko-KR");
          return `• <b>${escapeHtml(m.name)}</b> <span style="color:#64748b;font-size:0.76rem;">(${rate}₫당 1 BT)</span>`;
        })
        .join("<br/>");
      return `🏪 <b>베스트클럽 제휴 가맹점</b><br/>${rows}<br/><a href="/find_merchants.html" class="bc-ai-link">지도에서 가맹점 찾기 →</a>`;
    }
    return `🏪 내 주변 베스트클럽 제휴 가맹점을 지도에서 바로 찾아보세요!<br/><a href="/find_merchants.html" class="bc-ai-link">가맹점 찾기 →</a>`;
  }

  // 8. 일반 키워드 상품/가맹점 통합 검색
  const [products, merchants] = await Promise.all([fetchPublishedProducts(), fetchMerchants()]);
  const hitProducts = products.filter((p) => String(p.product_name || "").toLowerCase().includes(lower)).slice(0, 3);
  const hitMerchants = merchants.filter((m) => String(m.name || "").toLowerCase().includes(lower)).slice(0, 3);

  if (hitProducts.length || hitMerchants.length) {
    const parts = [`🔎 <b>"${escapeHtml(qText)}" 검색 결과</b>`];
    if (hitMerchants.length) {
      parts.push("<b>가맹점:</b> " + hitMerchants.map((m) => escapeHtml(m.name)).join(", "));
    }
    if (hitProducts.length) {
      parts.push(
        hitProducts
          .map((p) => `• ${escapeHtml(p.product_name)} (${Number(p.price || 0).toLocaleString("ko-KR")} VND)`)
          .join("<br/>")
      );
    }
    parts.push(`<a href="/mall.html" class="bc-ai-link">쇼핑몰 보기 →</a> &nbsp; <a href="/find_merchants.html" class="bc-ai-link">가맹점 찾기 →</a>`);
    return parts.join("<br/>");
  }

  return `안녕하세요! 아래 메뉴 중 궁금한 내용을 선택하거나 키워드(예: <b>특가, 가맹점, 환율, 게임, 내 포인트</b>)를 입력해 보세요.<br/><a href="/mall.html" class="bc-ai-link">쇼핑몰</a> · <a href="/used.html" class="bc-ai-link">중고장터</a> · <a href="/games.html" class="bc-ai-link">3억 GP 게임</a>`;
}

function mountConcierge() {
  if (!shouldMount()) return;
  if (document.getElementById("bcAiConciergeRoot")) return;

  const style = document.createElement("style");
  style.textContent = `
    .bc-ai-fab {
      position: fixed;
      left: 16px;
      bottom: 18px;
      z-index: 9990;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 11px 16px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.22);
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      color: #fff;
      font-size: 0.86rem;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(79, 70, 229, 0.38);
      transition: transform 0.16s ease, box-shadow 0.16s ease;
    }
    .bc-ai-fab:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(79, 70, 229, 0.5);
    }
    @media (max-width: 820px) {
      .bc-ai-fab {
        left: 12px;
        padding: 9px 13px;
        font-size: 0.78rem;
        gap: 5px;
      }
    }
    .bc-ai-panel {
      position: fixed;
      left: 16px;
      bottom: 72px;
      width: min(360px, calc(100vw - 32px));
      max-height: min(520px, calc(100vh - 110px));
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
      z-index: 9991;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: inherit;
    }
    .bc-ai-panel.is-open { display: flex; }
    .bc-ai-head {
      padding: 14px 16px;
      background: linear-gradient(135deg, #1e1b4b 0%, #4f46e5 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .bc-ai-head-title { font-weight: 800; font-size: 0.94rem; }
    .bc-ai-head-sub { font-size: 0.72rem; color: #c7d2fe; margin-top: 2px; }
    .bc-ai-close {
      background: rgba(255,255,255,0.16);
      border: none;
      color: #fff;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 700;
    }
    .bc-ai-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      background: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .bc-ai-msg {
      max-width: 88%;
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 0.84rem;
      line-height: 1.5;
      word-break: break-word;
    }
    .bc-ai-msg--bot {
      align-self: flex-start;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      color: #0f172a;
    }
    .bc-ai-msg--user {
      align-self: flex-end;
      background: #4f46e5;
      color: #ffffff;
    }
    .bc-ai-link {
      display: inline-block;
      margin-top: 6px;
      color: #4f46e5;
      font-weight: 800;
      text-decoration: none;
    }
    .bc-ai-link:hover { text-decoration: underline; }
    .bc-ai-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
      background: #fff;
      border-top: 1px solid #eef2f7;
    }
    .bc-ai-chip {
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid #ddd6fe;
      background: #f5f3ff;
      color: #5b21b6;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
    }
    .bc-ai-chip:hover { background: #ede9fe; }
    .bc-ai-form {
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      background: #fff;
      border-top: 1px solid #e2e8f0;
    }
    .bc-ai-input {
      flex: 1;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      font-size: 0.85rem;
      outline: none;
    }
    .bc-ai-input:focus { border-color: #7c3aed; }
    .bc-ai-send {
      padding: 8px 14px;
      border-radius: 10px;
      border: none;
      background: #4f46e5;
      color: #fff;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "bcAiConciergeRoot";
  root.innerHTML = `
    <button type="button" class="bc-ai-fab" id="bcAiFab" aria-label="베스트클럽 AI 도우미 열기">
      <span>✨</span><span>AI 도우미</span>
    </button>
    <div class="bc-ai-panel" id="bcAiPanel" role="dialog" aria-label="베스트클럽 AI 컨시어지">
      <div class="bc-ai-head">
        <div>
          <div class="bc-ai-head-title">✨ 베스트클럽 AI 도우미</div>
          <div class="bc-ai-head-sub">가맹점 · 공동구매 · 환율 · 내 리워드 즉시 안내</div>
        </div>
        <button type="button" class="bc-ai-close" id="bcAiClose" aria-label="닫기">✕</button>
      </div>
      <div class="bc-ai-body" id="bcAiMessages">
        <div class="bc-ai-msg bc-ai-msg--bot">
          안녕하세요! <b>베스트클럽 AI 도우미</b>입니다.<br/>하노이 제휴 가맹점, 오늘의 공동구매 특가, 환율, 주간 3억 GP 게임까지 바로 찾아드릴게요.
        </div>
      </div>
      <div class="bc-ai-chips">
        <button type="button" class="bc-ai-chip" id="bcAiOpenShareBtn" style="background:#fff7ed;border-color:#fed7aa;color:#c2410c;">🎁 초대·공유</button>
        <button type="button" class="bc-ai-chip" data-q="매일 무료 룰렛">🎰 무료 룰렛</button>
        <button type="button" class="bc-ai-chip" data-q="오늘 공동구매 특가">🔥 공동구매 특가</button>
        <button type="button" class="bc-ai-chip" data-q="제휴 가맹점 추천">🏪 가맹점 추천</button>
        <button type="button" class="bc-ai-chip" data-q="내 포인트 잔액">💰 내 리워드</button>
        <button type="button" class="bc-ai-chip" data-q="지금 환율">💱 환율</button>
        <button type="button" class="bc-ai-chip" data-q="주간 3억 GP 게임">🎮 3억 GP 게임</button>
      </div>
      <form class="bc-ai-form" id="bcAiForm">
        <input type="text" class="bc-ai-input" id="bcAiInput" placeholder="궁금한 내용을 입력하세요..." autocomplete="off" />
        <button type="submit" class="bc-ai-send">전송</button>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const fab = document.getElementById("bcAiFab");
  const panel = document.getElementById("bcAiPanel");
  const closeBtn = document.getElementById("bcAiClose");
  const msgBox = document.getElementById("bcAiMessages");
  const form = document.getElementById("bcAiForm");
  const input = document.getElementById("bcAiInput");

  const appendMsg = (html, isUser) => {
    const div = document.createElement("div");
    div.className = `bc-ai-msg ${isUser ? "bc-ai-msg--user" : "bc-ai-msg--bot"}`;
    div.innerHTML = isUser ? escapeHtml(html) : html;
    msgBox.appendChild(div);
    msgBox.scrollTop = msgBox.scrollHeight;
  };

  const ask = async (text) => {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    appendMsg(trimmed, true);
    const reply = await buildAnswer(trimmed);
    appendMsg(reply, false);
  };

  fab?.addEventListener("click", () => {
    panel?.classList.toggle("is-open");
    if (panel?.classList.contains("is-open")) input?.focus();
  });
  closeBtn?.addEventListener("click", () => panel?.classList.remove("is-open"));

  document.getElementById("bcAiOpenShareBtn")?.addEventListener("click", () => {
    panel?.classList.remove("is-open");
    if (typeof window.openBestClubShareModal === "function") {
      window.openBestClubShareModal();
    } else {
      ask("초대 공유");
    }
  });

  root.querySelectorAll(".bc-ai-chip[data-q]").forEach((chip) => {
    chip.addEventListener("click", () => ask(chip.dataset.q || ""));
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = input?.value || "";
    if (!val.trim()) return;
    input.value = "";
    ask(val);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountConcierge);
} else {
  mountConcierge();
}
