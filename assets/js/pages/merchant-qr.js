// /assets/js/pages/merchant-qr.js
// 가맹점용 QR 코드 생성 페이지

import { onAuthReady } from "../auth.js";
import { login } from "../auth.js";
import { db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}

// ── 환율 (표시 전용) ──────────────────────────────────
let _rates = null; // { krwPerUsd, vndPerUsd }

async function loadRates() {
  if (_rates) return _rates;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    const d = await r.json();
    if (d.result === "success" && d.rates?.KRW && d.rates?.VND) {
      _rates = { krwPerUsd: d.rates.KRW, vndPerUsd: d.rates.VND };
      return _rates;
    }
  } catch (_) { }
  _rates = { krwPerUsd: 1350, vndPerUsd: 25400 }; // 기본값 fallback
  return _rates;
}

function vndToKrw(vnd, rates) {
  return Math.round((vnd / rates.vndPerUsd) * rates.krwPerUsd);
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

// ── 진입점 ────────────────────────────────────────────
let _authDone = false;
let _currentUid = null;

onAuthReady(async ({ loggedIn, role, user }) => {
  if (_authDone) return;

  if (!loggedIn) {
    show("needLoginPanel", true);
    const btn = $("btnLogin");
    if (btn) btn.onclick = () => { location.href = "/register.html"; };
    return;
  }

  if (role !== "merchant" && role !== "admin") {
    alert("가맹점 계정만 이용 가능합니다.");
    location.href = "/family-register.html";
    return;
  }

  _authDone = true;
  _currentUid = user.uid;
  await initPage(user.uid);
});

// 4초 이내 로그인 없으면 로그인 안내
setTimeout(() => {
  if (!_authDone) {
    show("needLoginPanel", true);
    const btn = $("btnLogin");
    if (btn) btn.onclick = () => { location.href = "/register.html"; };
  }
}, 4000);

// ── 페이지 초기화 ─────────────────────────────────────
async function initPage(uid) {
  // 유저 문서에서 merchantId 조회
  const userSnap = await getDoc(doc(db, "users", uid));
  const merchantId = userSnap.data()?.merchantId;

  if (merchantId == null) {
    show("needMerchantPanel", true);
    return;
  }

  // 가맹점 정보 조회
  const mSnap = await getDoc(doc(db, "merchants", String(merchantId)));
  const merchantName = mSnap.exists() ? (mSnap.data()?.name || "가맹점") : "가맹점";

  // 화면 표시
  setText("qrMerchantName", merchantName);

  // 실시간 K-Culture Balance & Payment Balance 모니터링
  onSnapshot(doc(db, "users", uid), (docS) => {
    const el = document.getElementById("merchBal");
    if (el && docS.exists()) el.textContent = Number(docS.data().pointBalanceVnd || 0).toLocaleString() + " KM";
  });

  // ── 가맹점 BT 잔고: merchants/{merchantId}.btBalance 실시간 조회 ──
  // (adminChargeBt가 저장하는 위치와 동일해야 함)
  onSnapshot(doc(db, "merchants", String(merchantId)), (mSnap2) => {
    if (mSnap2.exists()) {
      const btBal = Number(mSnap2.data().btBalance || 0);
      setText("qrMerchantBtBal", btBal.toLocaleString("ko-KR") + " BT");
    }
  });

  // 가맹점주 KM/포인트 잔고 (merchant owner)
  const mOwner = mSnap.exists() ? mSnap.data()?.ownerUid : null;
  if (mOwner) {
    onSnapshot(doc(db, "users", mOwner), (snap) => {
      if (snap.exists()) {
        const { pointBalanceVnd = 0 } = snap.data();
        setText("qrMerchantPaymentBal", pointBalanceVnd.toLocaleString("ko-KR") + " KM (결제대금)");
        setText("qrMerchantPointBal", (snap.data().pointBalance || 0).toLocaleString("ko-KR") + " P");
      }
    });
  }


  show("mainPanel", true);

  // 폼 바인딩
  bindQrForm(merchantId, merchantName);
}

// ── QR 폼 바인딩 ─────────────────────────────────────
function bindQrForm(merchantId, merchantName) {
  const form = $("qrForm");
  if (!form) return;

  // 환산 표시 업데이트 함수
  async function updateConvert() {
    const isVnd = true;
    const inputEl = $("qrAmount");
    const convEl = $("qrAmountConvert");
    const krwEl = $("qrAmountKrw");
    if (!convEl || !krwEl) return;

    if (!isVnd) { convEl.style.display = "none"; return; }

    const val = Number(inputEl?.value);
    if (!val || val <= 0) { convEl.style.display = "none"; return; }

    convEl.style.display = "";
    krwEl.textContent = "계산 중...";
    const rates = await loadRates();
    krwEl.textContent = vndToKrw(val, rates).toLocaleString();
  }

  // 통화 UI: 무조건 VND
  const labelEl = $("qrAmountLabel");
  const helpEl = $("qrAmountHelp");
  const inputEl = $("qrAmount");
  if (labelEl) labelEl.textContent = "결제 금액 (동, VND)";
  if (helpEl) helpEl.textContent = "최소 10,000동 이상 입력해 주세요.";
  if (inputEl) {
    if (!inputEl.value) { // 초기 세팅 시에만
      inputEl.min = "10000";
      inputEl.step = "1000";
      inputEl.placeholder = "예: 200000";
      inputEl.value = "";
    }
  }
  updateConvert();

  // 금액 입력 시 환산 표시
  $("qrAmount")?.addEventListener("input", updateConvert);


  const modePay = $("modePay");
  const modeBt = $("modeBt");
  const btCalcResult = $("qrBtCalcResult");
  const btCountText = $("qrBtCount");



  function updateModeAndBt() {
    const isBt = modeBt?.checked;
    const amount = Number($("qrAmount")?.value || 0);
    const currency = form.querySelector("input[name='qrCurrency']:checked")?.value || "KRW";

    const labelEl = $("qrAmountLabel");
    const helpEl = $("qrAmountHelp");
    if (isBt) {
      if (labelEl) labelEl.textContent = "완료된 결제 금액 (VND)";
      if (helpEl) helpEl.textContent = "고객이 타 수단으로 결제한 금액을 입력하면 비례하여 BT 무료 보상이 생성됩니다.";
    } else {
      if (labelEl) labelEl.textContent = "결제 청구 금액 (동, VND)";
      if (helpEl) helpEl.textContent = "최소 10,000동 이상 입력해 주세요.";
    }

    if (isBt && amount > 0) {
      if (btCalcResult) btCalcResult.style.display = "";
      if (btCountText) btCountText.textContent = getBtAmount(amount, currency) + " 장";
    } else {
      if (btCalcResult) btCalcResult.style.display = "none";
    }

    // 모드에 따라 버튼 텍스트 변경
    const btnGen = $("btnGenQr");
    if (btnGen) {
      btnGen.textContent = isBt ? "무료 BT 보상 QR 발급" : "결제 QR 생성";
    }
  }

  modePay?.addEventListener("change", updateModeAndBt);
  modeBt?.addEventListener("change", updateModeAndBt);
  $("qrAmount")?.addEventListener("input", updateModeAndBt);

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const currency = "VND";
    const amountRaw = $("qrAmount")?.value || "";
    const amount = Number(amountRaw);

    if (!amount || amount < 10000) { alert("최소 10,000동 이상 입력해 주세요."); return; }


    const mode = form.querySelector("input[name='qrMode']:checked")?.value || "pay";
    generateQr(merchantId, merchantName, amount, currency, mode);
  });
}

// ── Point 변환 ──────────────────────────────────────────
function weiToHex(weiStr) {
  if (!weiStr) return null;
  try {
    const n = BigInt(weiStr);
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    return Number(whole) + Number(frac) / 1e18;
  } catch (_) { return null; }
}

// ── 입금 내역 상태 ─────────────────────────────────────
let _receiptTotalVnd = 0;
let _receiptCount = 0;

function resetReceipts() {
  _receiptTotalVnd = 0;
  _receiptCount = 0;
  const list = $("receiptList");
  if (list) list.innerHTML = "";
  show("receiptWaiting", true);
  setText("receiptTotal", "합계: 0 VND");
}

function addReceiptItem(data, isNew = false) {
  const vndVal = data.amountVnd || (data.amountKrw ? vndToKrw(data.amountKrw, _rates || { krwPerUsd: 1350, vndPerUsd: 25400 }) : 0);
  if (!vndVal) return;

  _receiptTotalVnd += vndVal;
  _receiptCount += 1;

  // 대기 안내 숨기기
  show("receiptWaiting", false);

  // 합계 갱신
  setText("receiptTotal", `합계: ${_receiptTotalVnd.toLocaleString("ko-KR")} VND`);

  // 시각 포맷
  const ts = data.createdAt?.toDate?.() ?? new Date();
  const time = ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // 법정화폐 표시
  const cur = data.currency || "KRW";
  const fiatAmt = cur === "VND" ? data.amountVnd : data.amountKrw;
  const fiatDisp = fiatAmt
    ? (cur === "VND" ? `${Number(fiatAmt).toLocaleString()}동` : `${Number(fiatAmt).toLocaleString()}원`)
    : "";

  // 카드 생성
  const item = document.createElement("div");
  item.className = `receipt-item${isNew ? " new-item" : ""}`;
  item.innerHTML = `
    <div class="ri-icon">${isNew ? "✅" : "💳"}</div>
    <div class="ri-body">
      <div class="ri-hex">+${vndVal.toLocaleString("ko-KR")} VND</div>
      ${fiatDisp ? `<div class="ri-fiat">결제: ${fiatDisp}</div>` : ""}
    </div>
    <div class="ri-time">${time}</div>
  `;

  // 최신 항목이 맨 위
  const list = $("receiptList");
  if (list) list.prepend(item);

  // new 스타일은 5초 후 해제
  if (isNew) setTimeout(() => item.classList.remove("new-item"), 5000);
}

// ── QR 생성 ────────────────────────────────────────────
async function generateQr(merchantId, merchantName, amount, currency = "KRW", mode = "pay") {
  const canvas = $("qrCanvas");
  if (!canvas) return;

  const PROD_ORIGIN = "https://kmoa.netlify.app";
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const baseOrigin = isLocal ? PROD_ORIGIN : location.origin;

  let url = `${baseOrigin}/pay.html?merchant=${merchantId}&amount=${amount}&currency=${currency}`;
  if (mode === "bt") {
    // Generate reward session on the server
    const btnGen = $("btnGenQr");
    if (btnGen) { btnGen.disabled = true; btnGen.textContent = "QR 생성 중..."; }

    try {
      const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js");
      const { functions } = await import("/assets/js/firebase-init.js");
      const createSession = httpsCallable(functions, "createBtRewardSession");
      const res = await createSession({ amount });
      const { rewardId, btAmount } = res.data;

      url = `${baseOrigin}/bt_receive.html?merchant=${merchantId}&amount=${amount}&currency=${currency}&bt=${btAmount}&rewardId=${rewardId}&nonce=${Date.now()}`;
      setText("qrCardAmount", `BT 보상 (${btAmount}장)`);
    } catch (err) {
      if (btnGen) { btnGen.disabled = false; btnGen.textContent = "BT 무료 보상 QR 생성"; }
      alert("BT QR 생성 오류: " + (err?.message || "서버 통신 실패"));
      return;
    }
    if (btnGen) { btnGen.disabled = false; btnGen.textContent = "BT 무료 보상 QR 생성"; }
  }

  // qrcode.js (CDN) API
  /* global QRCode */
  QRCode.toCanvas(canvas, url, { width: 280, margin: 2, color: { dark: "#1a1a2e", light: "#ffffff" } }, (err) => {
    if (err) {
      console.error("QR 생성 오류:", err);
      alert("QR 생성에 실패했습니다.");
      return;
    }

    // 카드 정보 업데이트
    const amountDisp = currency === "VND"
      ? `${amount.toLocaleString()}동 (VND)`
      : `${amount.toLocaleString()}원 (KRW)`;
    setText("qrCardMerchant", merchantName);
    setText("qrCardAmount", amountDisp);
    show("qrSection", true);

    // 다운로드 버튼
    const btnDl = $("btnDownloadQr");
    if (btnDl) {
      btnDl.onclick = () => {
        const link = document.createElement("a");
        link.download = `qr-${merchantId}-${amount}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      };
    }

    // 입금 확인 패널 표시 (리셋 후)
    resetReceipts();
    show("receiptSection", true);

    // 생성된 QR 영역으로 스크롤
    $("qrSection")?.scrollIntoView({ behavior: "smooth", block: "center" });

    // 실시간 결제 감지 시작
    listenPayments(amount, currency);
  });
}

// ── 실시간 결제 감지 ───────────────────────────────────
let _unsubscribe = null;

function listenPayments(amount, currency = "KRW") {
  // 이전 리스너 해제
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  // QR 생성 시각 기준 — 이후 도착하는 결제만 감지
  const since = Timestamp.now();

  // uid 필터를 포함해야 Firestore 보안 규칙(resource.data.uid == request.auth.uid) 통과
  const q = query(
    collection(db, "transactions"),
    where("uid", "==", _currentUid),
    where("type", "==", "merchant_income"),
    where("createdAt", ">=", since),
    orderBy("createdAt", "desc"),
  );

  _unsubscribe = onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const d = change.doc.data();
      addReceiptItem(d, true);
      showPaymentAlert(d, amount, currency);
    });
  }, (err) => {
    console.error("listenPayments error:", err);
    // 인덱스 미생성 시 fallback — type 필터 없이 재시도
    if (err?.code === "failed-precondition" || err?.message?.includes("index")) {
      console.warn("인덱스 미준비 — type 필터 없이 fallback 리스닝");
      const q2 = query(
        collection(db, "transactions"),
        where("uid", "==", _currentUid),
        where("createdAt", ">=", since),
        orderBy("createdAt", "desc"),
      );
      _unsubscribe = onSnapshot(q2, (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const d = change.doc.data();
          if (d.type !== "merchant_income") return;
          addReceiptItem(d, true);
          showPaymentAlert(d, amount, currency);
        });
      }, (err2) => console.error("listenPayments fallback error:", err2));
    }
  });
}

function showPaymentAlert(data, expectedAmount, currency = "KRW") {
  // 기존 알림 제거
  document.getElementById("paymentAlert")?.remove();

  const netHex = data.netAmountWei
    ? parseFloat((BigInt(data.netAmountWei) / 10n ** 14n) / 10000).toFixed(4)
    : data.amountHex || "?";

  const cur = data.currency || currency;
  const amountDisp = cur === "VND"
    ? `${(data.amountVnd || expectedAmount || 0).toLocaleString()}동`
    : `${(data.amountKrw || expectedAmount || 0).toLocaleString()}원`;

  const el = document.createElement("div");
  el.id = "paymentAlert";
  el.style.cssText = [
    "position:fixed", "top:80px", "left:50%", "transform:translateX(-50%)",
    "background:#16a34a", "color:#fff", "border-radius:12px",
    "padding:18px 28px", "z-index:9999", "box-shadow:0 4px 24px rgba(0,0,0,.3)",
    "text-align:center", "min-width:260px", "animation:fadeInDown .3s ease",
  ].join(";");

  const vndVal = data.amountVnd || (expectedAmount ? (cur === "VND" ? expectedAmount : vndToKrw(expectedAmount, _rates)) : 0);

  el.innerHTML = `
    <div style="font-size:2rem;margin-bottom:4px;">✅</div>
    <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">결제 완료!</div>
    <div style="font-size:0.95rem;opacity:.9;">고객 명의로 ${amountDisp} 결제됨</div>
    <div style="font-size:0.8rem;opacity:.7;margin-top:4px;">정산 금액: ${vndVal.toLocaleString("ko-KR")} VND</div>
    <button onclick="document.getElementById('paymentAlert').remove()"
      style="margin-top:10px;background:rgba(255,255,255,.2);border:none;color:#fff;
             border-radius:6px;padding:4px 16px;cursor:pointer;font-size:0.85rem;">닫기</button>
  `;

  document.body.appendChild(el);

  // 소리 (지원 시)
  try { new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAA==").play().catch(() => { }); } catch (_) { }

  // 10초 후 자동 제거
  setTimeout(() => { document.getElementById("paymentAlert")?.remove(); }, 10000);
}


function getBtAmount(amount, currency) {
  let vnd = amount;
  if (currency === "KRW") vnd = amount * 18;
  return Math.floor(vnd / 100000);
}
