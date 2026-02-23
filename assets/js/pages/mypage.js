// /assets/js/pages/mypage.js
// 마이페이지: 기본 정보 / 수탁 지갑 / 포인트 충전 / 내역 조회

import { onAuthReady } from "../auth.js";
import { db, functions } from "/assets/js/firebase-init.js";
import { login } from "../auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}
function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

// ── 기본 정보 표시 ────────────────────────────────
function renderProfile(userData, fireUser) {
  setText("infoName",  userData?.name  || "-");
  setText("infoEmail", fireUser?.email || userData?.email || "-");
  setText("infoPhone", userData?.phone || "-");
}

// ── 수탁 지갑 표시 ───────────────────────────────
function renderWallet(userData) {
  const addr = userData?.wallet?.address;
  if (!addr) {
    show("noWallet", true);
    show("walletInfo", false);
    show("btnCreateWallet", true);
    setText("onChainStatus", "-");
    return;
  }

  show("noWallet", false);
  show("walletInfo", true);
  show("btnCreateWallet", false);
  setText("walletAddress", addr);
}

// ── 온체인 데이터 조회 + 표시 ────────────────────
async function loadOnChainData(uid) {
  const addr = (await getDoc(doc(db, "users", uid))).data()?.wallet?.address;
  if (!addr) return;

  setText("onChainStatus", "조회 중...");

  try {
    const getMyOnChain = httpsCallable(functions, "getMyOnChain");
    const res = await getMyOnChain();
    const d = res.data;

    if (d.level > 0) {
      setText("onChainStatus", "등록 완료 ✓");
      $("onChainStatus").style.color = "var(--accent)";

      show("pointRow",   true);
      show("payableRow", true);
      show("levelRow",   true);
      setText("pointDisplay",   (d.pointDisplay   || "0") + " HEX");
      setText("payableDisplay", (d.payableDisplay || "0") + " HEX");
      setText("levelDisplay",   "Lv." + d.level);
      show("onChainRegBox", false);
    } else {
      setText("onChainStatus", "미등록");
      $("onChainStatus").style.color = "var(--muted)";
      show("onChainRegBox", true);
    }
  } catch (err) {
    setText("onChainStatus", "조회 실패 (Functions 미배포)");
    $("onChainStatus").style.color = "var(--muted)";
    console.warn("getMyOnChain 실패:", err.message);
  }
}

// ── 충전 내역 ─────────────────────────────────────
async function loadDepositHistory(uid) {
  const wrap = $("depositHistory");
  if (!wrap) return;

  try {
    // Cloud Function 대신 Firestore 직접 조회 (CORS 우회)
    const q = query(
      collection(db, "deposits"),
      where("uid", "==", uid),
      orderBy("requestedAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      wrap.innerHTML = '<p class="hint">충전 내역이 없습니다.</p>';
      return;
    }

    const statusLabel = { pending: "대기", processing: "처리중", approved: "완료", rejected: "반려" };
    const rows = snap.docs.map((d) => {
      const data = d.data();
      const hexDisplay = data.hexAmountWei
        ? parseFloat(BigInt(data.hexAmountWei).toString()) / 1e18
        : null;
      const hexStr = hexDisplay != null ? hexDisplay.toFixed(4) + " HEX" : "-";
      const dateStr = data.requestedAt?.toDate
        ? data.requestedAt.toDate().toLocaleDateString("ko")
        : "-";
      return `
        <div class="mp-hist-row">
          <div class="mp-hist-main">
            <span class="mp-hist-code">${data.refCode || "-"}</span>
            <span class="mp-hist-badge ${data.status}">${statusLabel[data.status] || data.status}</span>
          </div>
          <div class="mp-hist-detail">
            <span>${(data.amountKrw || 0).toLocaleString()}원</span>
            <span class="accent">${hexStr}</span>
            <span class="muted">${dateStr}</span>
          </div>
          ${data.txHash ? `<div class="mp-hist-tx mono">${data.txHash.slice(0, 16)}…</div>` : ""}
        </div>
      `;
    }).join("");

    wrap.innerHTML = rows;
  } catch (err) {
    wrap.innerHTML = '<p class="hint muted">내역을 불러올 수 없습니다.</p>';
    console.warn("depositHistory 실패:", err.message);
  }
}

// ── 거래 내역 (Firestore 직접 쿼리) ──────────────
async function loadTxHistory(uid) {
  try {
    const q = query(
      collection(db, "transactions"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    show("txSection", true);
    const wrap = $("txHistory");
    const typeLabel = { buy: "구매", withdraw: "인출", credit: "포인트 지급" };

    const rows = snap.docs.map((d) => {
      const tx = d.data();
      return `
        <div class="mp-hist-row">
          <div class="mp-hist-main">
            <span class="mp-hist-badge ${tx.type}">${typeLabel[tx.type] || tx.type}</span>
            <span class="mono">${(tx.txHash || "").slice(0, 16)}…</span>
          </div>
          <div class="mp-hist-detail">
            ${tx.priceWei  ? `<span>${formatWei(tx.priceWei)} HEX</span>` : ""}
            ${tx.amountWei ? `<span>${formatWei(tx.amountWei)} HEX</span>` : ""}
            <span class="muted">${tx.createdAt?.toDate ? tx.createdAt.toDate().toLocaleDateString("ko") : "-"}</span>
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = rows;
  } catch (err) {
    console.warn("거래 내역 조회 실패:", err.message);
  }
}

function formatWei(weiStr) {
  try {
    const n = parseFloat(BigInt(weiStr).toString()) / 1e18;
    return n.toFixed(4);
  } catch {
    return weiStr;
  }
}

// ── 지갑 생성 버튼 ────────────────────────────────
function bindCreateWallet() {
  const btn = $("btnCreateWallet");
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "생성 중...";
    try {
      const createWallet = httpsCallable(functions, "createWallet");
      const res = await createWallet();
      setText("walletAddress", res.data?.address || "생성됨");
      show("noWallet", false);
      show("walletInfo", true);
      btn.style.display = "none";
      alert("수탁 지갑이 생성됐습니다.");
    } catch (err) {
      alert("지갑 생성 실패: " + err.message);
      btn.disabled = false;
      btn.textContent = "지갑 생성";
    }
  };
}

// ── 온체인 등록 버튼 ──────────────────────────────
function bindOnChainRegister(uid) {
  const btn = $("btnRegisterOnChain");
  if (!btn) return;
  btn.onclick = async () => {
    const mentorEmail = String($("mentorEmailInput")?.value || "").trim().toLowerCase() || null;
    btn.disabled = true;
    btn.textContent = "등록 중...";
    try {
      const registerMember = httpsCallable(functions, "registerMember");
      await registerMember({ mentorEmail });
      show("onChainRegBox", false);
      setText("onChainStatus", "등록 완료 ✓");
      $("onChainStatus").style.color = "var(--accent)";
      // 온체인 데이터 재조회
      await loadOnChainData(uid);
    } catch (err) {
      alert("온체인 등록 실패: " + err.message);
      btn.disabled = false;
      btn.textContent = "온체인 등록";
    }
  };
}

// ── 충전 요청 폼 ──────────────────────────────────
function bindDepositForm() {
  const form = $("depositForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amountKrw    = Number($("depositAmount")?.value);
    const depositorName = String($("depositorName")?.value || "").trim();
    const btn = $("btnDeposit");

    if (!amountKrw || amountKrw < 10000) {
      alert("최소 10,000원 이상 입력해 주세요.");
      return;
    }
    if (!depositorName) {
      alert("입금자명을 입력해 주세요.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "요청 중...";

    try {
      const requestDeposit = httpsCallable(functions, "requestDeposit");
      const res = await requestDeposit({ amountKrw, depositorName });
      const d = res.data;

      // 결과 표시
      show("depositResult", true);
      setText("drRefCode",  d.refCode);
      setText("drBank",     d.bankInfo?.bank    || "-");
      setText("drAccount",  d.bankInfo?.account || "-");
      setText("drHolder",   d.bankInfo?.holder  || "-");
      setText("drAmount",   (d.amountKrw || 0).toLocaleString() + "원");
      setText("drHex",      (d.estimatedHex || "-") + " HEX");

      // 폼 초기화
      form.reset();
    } catch (err) {
      alert("충전 요청 실패: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "충전 요청";
    }
  });
}

// ── 진입점 ────────────────────────────────────────
onAuthReady(async (ctx) => {
  const loggedIn = (ctx?.loggedIn ?? ctx?.loggedin) === true;
  const user     = ctx?.user;

  if (!loggedIn || !user) {
    show("needLoginPanel", true);
    const btn = $("btnLoginPage");
    if (btn) btn.onclick = async () => { try { await login(); } catch (e) { console.warn(e); } };
    return;
  }

  show("mainContent", true);

  try {
    // Firestore 기본 데이터 로드
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    renderProfile(data, user);
    renderWallet(data);
    bindCreateWallet();
    bindOnChainRegister(user.uid);
    bindDepositForm();

    // 비동기로 추가 데이터 로드
    loadOnChainData(user.uid);
    loadDepositHistory(user.uid);
    loadTxHistory(user.uid);

    // 충전 내역 새로고침 버튼
    const btnRefresh = $("btnRefreshDeposits");
    if (btnRefresh) {
      btnRefresh.onclick = () => loadDepositHistory(user.uid);
    }
  } catch (err) {
    console.error("마이페이지 로드 실패:", err);
  }
});
