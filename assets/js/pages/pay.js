// /assets/js/pages/pay.js
// 가맹점 QR 결제 — 고객 결제 확인 페이지

import { onAuthReady } from "../auth.js";
import { login } from "../auth.js";
import { db, functions } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
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

// ── URL 파라미터 파싱 ─────────────────────────────────
const params = new URLSearchParams(location.search);
const merchantIdRaw = params.get("merchant");
const amountRaw     = params.get("amount");

const merchantId = Number(merchantIdRaw);
const amountKrw  = Number(amountRaw);

// 유효성 검증
if (!merchantId || !Number.isInteger(merchantId) || merchantId <= 0 ||
    !amountKrw  || !Number.isFinite(amountKrw)   || amountKrw < 1000) {
  show("invalidPanel", true);
  throw new Error("invalid pay params");
}

// ── 가맹점 정보 로드 ──────────────────────────────────
let merchantName = "";

async function loadMerchant() {
  const mSnap = await getDoc(doc(db, "merchants", String(merchantId)));
  if (!mSnap.exists()) {
    show("invalidPanel", true);
    throw new Error("merchant not found");
  }
  const data = mSnap.data() || {};
  if (data.active === false) {
    show("invalidPanel", true);
    const el = $("invalidPanel")?.querySelector("p");
    if (el) el.textContent = "비활성 가맹점입니다.";
    throw new Error("merchant inactive");
  }
  merchantName = data.name || "가맹점";
  document.title = `${merchantName} 결제 확인 | Jovial Travel`;

  const amountStr = `${amountKrw.toLocaleString()}원`;
  ["payMerchantNameLogin", "payMerchantNameReg", "payMerchantName"].forEach((id) => setText(id, merchantName));
  ["payAmountLogin",       "payAmountReg",       "payAmountDisp"].forEach((id)   => setText(id, amountStr));
  setText("payHeroDesc", `${merchantName} — ${amountStr}`);
}

// ── 인증 처리 ─────────────────────────────────────────
let _authDone = false;

async function init() {
  try {
    await loadMerchant();
  } catch (_) {
    return; // 이미 invalidPanel 표시됨
  }

  onAuthReady(({ loggedIn, role }) => {
    if (_authDone) return;
    _authDone = true;

    if (!loggedIn) {
      show("needLoginPanel", true);
      const btn = $("btnLogin");
      if (btn) {
        btn.onclick = async () => {
          try { await login(); } catch (e) { console.warn(e); }
          // watchAuth → page reload 후 재진입
        };
      }
      return;
    }

    if (role === "user") {
      // 구글 로그인은 됐지만 회원가입(온체인) 미완
      show("needRegisterPanel", true);
      return;
    }

    // 정상 사용자 → 결제 패널 표시
    show("payPanel", true);
    bindPayButton();
  });

  // 4초 이내 로그인 없으면 로그인 안내
  setTimeout(() => {
    if (!_authDone) {
      _authDone = true;
      show("needLoginPanel", true);
      const btn = $("btnLogin");
      if (btn) {
        btn.onclick = async () => { try { await login(); } catch (e) { console.warn(e); } };
      }
    }
  }, 4000);
}

// ── 결제 버튼 바인딩 ──────────────────────────────────
function bindPayButton() {
  const btn = $("btnPay");
  if (!btn) return;

  btn.onclick = async () => {
    if (!confirm(`${merchantName}에 ${amountKrw.toLocaleString()}원을 결제하시겠습니까?\n(수탁 지갑 HEX로 결제됩니다)`)) return;

    btn.disabled = true;
    btn.textContent = "결제 중...";
    const stateEl = $("payState");
    if (stateEl) { stateEl.textContent = "블록체인 처리 중입니다. 잠시 기다려 주세요..."; stateEl.style.display = ""; }

    try {
      const payFn = httpsCallable(functions, "payMerchantHex");
      const res   = await payFn({ merchantId: Number(merchantId), amountKrw: Number(amountKrw) });
      const d     = res.data;

      // 완료 패널 표시
      show("payPanel", false);
      show("donePanel", true);

      const resultEl = $("payResult");
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="mp-kv"><span class="k">가맹점</span><span class="v">${d.merchantName || merchantName}</span></div>
          <div class="mp-kv"><span class="k">결제 금액</span><span class="v">${amountKrw.toLocaleString()}원 (${d.amountHex || "?"} HEX)</span></div>
          <div class="mp-kv"><span class="k">TX</span><span class="v mono" style="font-size:0.78em;">${(d.txHash || "").slice(0, 22)}…</span></div>
        `;
      }
    } catch (err) {
      if (stateEl) stateEl.style.display = "none";
      alert("결제 실패: " + (err?.message || "서버 오류가 발생했습니다."));
      btn.disabled = false;
      btn.textContent = "결제하기";
    }
  };
}

// ── 시작 ─────────────────────────────────────────────
init();
