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
  } catch (_) {}
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

onAuthReady(async ({ loggedIn, role, user }) => {
  if (_authDone) return;

  if (!loggedIn) {
    show("needLoginPanel", true);
    const btn = $("btnLogin");
    if (btn) btn.onclick = async () => { try { await login(); } catch (e) { console.warn(e); } };
    return;
  }

  if (role !== "merchant" && role !== "admin") {
    alert("가맹점 계정만 이용 가능합니다.");
    location.href = "/family-register.html";
    return;
  }

  _authDone = true;
  await initPage(user.uid);
});

// 4초 이내 로그인 없으면 로그인 안내
setTimeout(() => {
  if (!_authDone) {
    show("needLoginPanel", true);
    const btn = $("btnLogin");
    if (btn) btn.onclick = async () => { try { await login(); } catch (e) { console.warn(e); } };
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
  setText("qrMerchantId", String(merchantId));
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
    const isVnd   = form.querySelector("input[name='qrCurrency']:checked")?.value === "VND";
    const inputEl = $("qrAmount");
    const convEl  = $("qrAmountConvert");
    const krwEl   = $("qrAmountKrw");
    if (!convEl || !krwEl) return;

    if (!isVnd) { convEl.style.display = "none"; return; }

    const val = Number(inputEl?.value);
    if (!val || val <= 0) { convEl.style.display = "none"; return; }

    convEl.style.display = "";
    krwEl.textContent = "계산 중...";
    const rates = await loadRates();
    krwEl.textContent = vndToKrw(val, rates).toLocaleString();
  }

  // 통화 전환 시 레이블/플레이스홀더 업데이트
  form.querySelectorAll("input[name='qrCurrency']").forEach((radio) => {
    radio.addEventListener("change", () => {
      const isVnd = radio.value === "VND" && radio.checked;
      const labelEl  = $("qrAmountLabel");
      const helpEl   = $("qrAmountHelp");
      const inputEl  = $("qrAmount");
      if (labelEl)  labelEl.textContent  = isVnd ? "결제 금액 (동, VND)" : "결제 금액 (원, KRW)";
      if (helpEl)   helpEl.textContent   = isVnd ? "최소 10,000동 이상 입력해 주세요." : "최소 1,000원 이상 입력해 주세요.";
      if (inputEl) {
        inputEl.min         = isVnd ? "10000" : "1000";
        inputEl.step        = isVnd ? "1000"  : "100";
        inputEl.placeholder = isVnd ? "예: 200000" : "예: 30000";
        inputEl.value       = "";
      }
      updateConvert();
    });
  });

  // 금액 입력 시 환산 표시
  $("qrAmount")?.addEventListener("input", updateConvert);

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const currency  = form.querySelector("input[name='qrCurrency']:checked")?.value || "KRW";
    const amountRaw = $("qrAmount")?.value || "";
    const amount    = Number(amountRaw);

    if (currency === "VND") {
      if (!amount || amount < 10000) { alert("최소 10,000동 이상 입력해 주세요."); return; }
    } else {
      if (!amount || amount < 1000)  { alert("최소 1,000원 이상 입력해 주세요."); return; }
    }

    generateQr(merchantId, merchantName, amount, currency);
  });
}

// ── QR 생성 ────────────────────────────────────────────
function generateQr(merchantId, merchantName, amount, currency = "KRW") {
  const canvas = $("qrCanvas");
  if (!canvas) return;

  const PROD_ORIGIN = "https://jump22.netlify.app";
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const baseOrigin = isLocal ? PROD_ORIGIN : location.origin;
  const url = `${baseOrigin}/pay.html?merchant=${merchantId}&amount=${amount}&currency=${currency}`;

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

    // 생성된 QR 영역으로 스크롤
    $("qrSection")?.scrollIntoView({ behavior: "smooth", block: "center" });

    // 실시간 결제 감지 시작
    listenPayments(merchantId, amount, currency);
  });
}

// ── 실시간 결제 감지 ───────────────────────────────────
let _unsubscribe = null;

function listenPayments(merchantId, amount, currency = "KRW") {
  // 이전 리스너 해제
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  // QR 생성 시각 기준 — 이후 도착하는 결제만 감지
  const since = Timestamp.now();

  const q = query(
    collection(db, "transactions"),
    where("type",       "==", "merchant_income"),
    where("merchantId", "==", Number(merchantId)),
    where("createdAt",  ">=", since),
    orderBy("createdAt", "desc"),
  );

  _unsubscribe = onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const d = change.doc.data();
      showPaymentAlert(d, amount, currency);
    });
  }, (err) => {
    console.warn("listenPayments error:", err);
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

  el.innerHTML = `
    <div style="font-size:2rem;margin-bottom:4px;">✅</div>
    <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">결제 완료!</div>
    <div style="font-size:0.95rem;opacity:.9;">${amountDisp} 수령</div>
    <div style="font-size:0.8rem;opacity:.7;margin-top:4px;">${netHex} HEX</div>
    <button onclick="document.getElementById('paymentAlert').remove()"
      style="margin-top:10px;background:rgba(255,255,255,.2);border:none;color:#fff;
             border-radius:6px;padding:4px 16px;cursor:pointer;font-size:0.85rem;">닫기</button>
  `;

  document.body.appendChild(el);

  // 소리 (지원 시)
  try { new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAA==").play().catch(() => {}); } catch (_) {}

  // 10초 후 자동 제거
  setTimeout(() => { document.getElementById("paymentAlert")?.remove(); }, 10000);
}
