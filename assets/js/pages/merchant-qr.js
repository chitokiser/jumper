// /assets/js/pages/merchant-qr.js
// Í∞ÄÎßπÏ†ê??QR ÏΩîÎìú ?ùÏÑ± ?òÏù¥ÏßÄ

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
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { functions } from "/assets/js/firebase-init.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}

// ?Ä?Ä ?òÏú® (?úÏãú ?ÑÏö©) ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
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
  _rates = { krwPerUsd: 1350, vndPerUsd: 25400 }; // Í∏∞Î≥∏Í∞?fallback
  return _rates;
}

function vndToKrw(vnd, rates) {
  return Math.round((vnd / rates.vndPerUsd) * rates.krwPerUsd);
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

// ?Ä?Ä ÏßÑÏûÖ???Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
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
    alert("Í∞ÄÎßπÏ†ê Í≥ÑÏ†ïÎß??¥Ïö© Í∞Ä?•Ìï©?àÎã§.");
    location.href = "/family-register.html";
    return;
  }

  _authDone = true;
  _currentUid = user.uid;
  await initPage(user.uid);
});

// 4Ï¥??¥ÎÇ¥ Î°úÍ∑∏???ÜÏúºÎ©?Î°úÍ∑∏???àÎÇ¥
setTimeout(() => {
  if (!_authDone) {
    show("needLoginPanel", true);
    const btn = $("btnLogin");
    if (btn) btn.onclick = () => { location.href = "/register.html"; };
  }
}, 4000);

// ?Ä?Ä ?òÏù¥ÏßÄ Ï¥àÍ∏∞???Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
async function initPage(uid) {
  // ?†Ï? Î¨∏ÏÑú?êÏÑú merchantId Ï°∞Ìöå
  const userSnap = await getDoc(doc(db, "users", uid));
  const merchantId = userSnap.data()?.merchantId;

  if (merchantId == null) {
    show("needMerchantPanel", true);
    return;
  }

  // Í∞ÄÎßπÏ†ê ?ïÎ≥¥ Ï°∞Ìöå
  const mSnap = await getDoc(doc(db, "merchants", String(merchantId)));
  const merchantName = mSnap.exists() ? (mSnap.data()?.name || "Í∞ÄÎßπÏ†ê") : "Í∞ÄÎßπÏ†ê";

  // ?îÎ©¥ ?úÏãú
  setText("qrMerchantName", merchantName);

  // ?§ÏãúÍ∞?K-Culture Balance & Payment Balance Î™®Îãà?∞ÎßÅ
  onSnapshot(doc(db, "users", uid), (docS) => {
    const el = document.getElementById("merchBal");
    if (el && docS.exists()) el.textContent = Number(docS.data().pointBalanceVnd || 0).toLocaleString() + " KM";
  });

  // ?Ä?Ä Í∞ÄÎßπÏ†ê BT ?îÍ≥†: merchants/{merchantId}.btBalance ?§ÏãúÍ∞?Ï°∞Ìöå ?Ä?Ä
  // (adminChargeBtÍ∞Ä ?Ä?•Ìïò???ÑÏπò?Ä ?ôÏùº?¥Ïïº ??
  onSnapshot(doc(db, "merchants", String(merchantId)), (mSnap2) => {
    if (mSnap2.exists()) {
      const btBal = Number(mSnap2.data().btBalance || 0);
      setText("qrMerchantBtBal", btBal.toLocaleString("ko-KR") + " BT");
    }
  });

  // Í∞ÄÎßπÏ†êÏ£?KM/?¨Ïù∏???îÍ≥† (merchant owner)
  const mOwner = mSnap.exists() ? mSnap.data()?.ownerUid : null;
  if (mOwner) {
    onSnapshot(doc(db, "users", mOwner), (snap) => {
      if (snap.exists()) {
        const { pointBalanceVnd = 0 } = snap.data();
        setText("qrMerchantPaymentBal", pointBalanceVnd.toLocaleString("ko-KR") + " KM (Í≤∞Ï†ú?ÄÍ∏?");
        setText("qrMerchantPointBal", (snap.data().pointBalance || 0).toLocaleString("ko-KR") + " P");
      }
    });
  }


  show("mainPanel", true);

  // ??Î∞îÏù∏??
  bindQrForm(merchantId, merchantName);
}

// ?Ä?Ä QR ??Î∞îÏù∏???Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
function bindQrForm(merchantId, merchantName) {
  const form = $("qrForm");
  if (!form) return;

  // ?òÏÇ∞ ?úÏãú ?ÖÎç∞?¥Ìä∏ ?®Ïàò
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
    krwEl.textContent = "Í≥ÑÏÇ∞ Ï§?..";
    const rates = await loadRates();
    krwEl.textContent = vndToKrw(val, rates).toLocaleString();
  }

  // ?µÌôî UI: Î¨¥Ï°∞Í±?VND
  const labelEl = $("qrAmountLabel");
  const helpEl = $("qrAmountHelp");
  const inputEl = $("qrAmount");
  if (labelEl) labelEl.textContent = "Í≤∞Ï†ú Í∏àÏï° (?? VND)";
  if (helpEl) helpEl.textContent = "ÏµúÏÜå 10,000???¥ÏÉÅ ?ÖÎ†•??Ï£ºÏÑ∏??";
  if (inputEl) {
    if (!inputEl.value) { // Ï¥àÍ∏∞ ?∏ÌåÖ ?úÏóêÎß?
      inputEl.min = "10000";
      inputEl.step = "1000";
      inputEl.placeholder = "?? 200000";
      inputEl.value = "";
    }
  }
  updateConvert();

  // Í∏àÏï° ?ÖÎ†• ???òÏÇ∞ ?úÏãú
  $("qrAmount")?.addEventListener("input", updateConvert);


  const modePay = $("modePay");
  const modeBt = $("modeBt");
  const btCalcResult = $("qrBtCalcResult");
  const btCountText = $("qrBtCount");



  function updateModeAndBt() {
    const isBt = modeBt?.checked;
    const amount = Number($("qrAmount")?.value || 0);
    const currency = "VND";

    const labelEl = $("qrAmountLabel");
    const helpEl = $("qrAmountHelp");
    if (isBt) {
      if (labelEl) labelEl.textContent = "?ÑÎ£å??Í≤∞Ï†ú Í∏àÏï° (VND)";
      if (helpEl) helpEl.textContent = "Í≥†Í∞ù???Ä ?òÎã®?ºÎ°ú Í≤∞Ï†ú??Í∏àÏï°???ÖÎ†•?òÎ©¥ ÎπÑÎ??òÏó¨ BT Î¨¥Î£å Î≥¥ÏÉÅ???ùÏÑ±?©Îãà??";
    } else {
      if (labelEl) labelEl.textContent = "Í≤∞Ï†ú Ï≤?µ¨ Í∏àÏï° (?? VND)";
      if (helpEl) helpEl.textContent = "ÏµúÏÜå 10,000???¥ÏÉÅ ?ÖÎ†•??Ï£ºÏÑ∏??";
    }

    if (isBt && amount > 0) {
      if (btCalcResult) btCalcResult.style.display = "";
      if (btCountText) btCountText.textContent = getBtAmount(amount, currency) + " ??;
    } else {
      if (btCalcResult) btCalcResult.style.display = "none";
    }

    // Î™®Îìú???∞Îùº Î≤ÑÌäº ?çÏä§??Î≥ÄÍ≤?
    const btnGen = $("btnGenQr");
    if (btnGen) {
      btnGen.textContent = isBt ? "Î¨¥Î£å BT Î≥¥ÏÉÅ QR Î∞úÍ∏â" : "Í≤∞Ï†ú QR ?ùÏÑ±";
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

    if (!amount || amount < 10000) { alert("ÏµúÏÜå 10,000???¥ÏÉÅ ?ÖÎ†•??Ï£ºÏÑ∏??"); return; }


    const mode = form.querySelector("input[name='qrMode']:checked")?.value || "pay";
    generateQr(merchantId, merchantName, amount, currency, mode);
  });
}

// ?Ä?Ä Point Î≥Ä???Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
function weiToHex(weiStr) {
  if (!weiStr) return null;
  try {
    const n = BigInt(weiStr);
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    return Number(whole) + Number(frac) / 1e18;
  } catch (_) { return null; }
}

// ?Ä?Ä ?ÖÍ∏à ?¥Ïó≠ ?ÅÌÉú ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
let _receiptTotalVnd = 0;
let _receiptCount = 0;

function resetReceipts() {
  _receiptTotalVnd = 0;
  _receiptCount = 0;
  const list = $("receiptList");
  if (list) list.innerHTML = "";
  show("receiptWaiting", true);
  setText("receiptTotal", "?©Í≥Ñ: 0 VND");
}

function addReceiptItem(data, isNew = false) {
  const vndVal = data.amountVnd || (data.amountKrw ? vndToKrw(data.amountKrw, _rates || { krwPerUsd: 1350, vndPerUsd: 25400 }) : 0);
  if (!vndVal) return;

  _receiptTotalVnd += vndVal;
  _receiptCount += 1;

  // ?ÄÍ∏??àÎÇ¥ ?®Í∏∞Í∏?
  show("receiptWaiting", false);

  // ?©Í≥Ñ Í∞±Ïã†
  setText("receiptTotal", `?©Í≥Ñ: ${_receiptTotalVnd.toLocaleString("ko-KR")} VND`);

  // ?úÍ∞Å ?¨Îß∑
  const ts = data.createdAt?.toDate?.() ?? new Date();
  const time = ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // Î≤ïÏ†ï?îÌèê ?úÏãú
  const cur = data.currency || "VND";
  const fiatAmt = cur === "VND" ? data.amountVnd : data.amountKrw;
  const fiatDisp = fiatAmt
    ? (cur === "VND" ? `${Number(fiatAmt).toLocaleString()}?? : `${Number(fiatAmt).toLocaleString()}??)
    : "";

  // Ïπ¥Îìú ?ùÏÑ±
  const item = document.createElement("div");
  item.className = `receipt-item${isNew ? " new-item" : ""}`;
  item.innerHTML = `
    <div class="ri-icon">${isNew ? "?? : "?í≥"}</div>
    <div class="ri-body">
      <div class="ri-hex">+${vndVal.toLocaleString("ko-KR")} VND</div>
      ${fiatDisp ? `<div class="ri-fiat">Í≤∞Ï†ú: ${fiatDisp}</div>` : ""}
    </div>
    <div class="ri-time">${time}</div>
  `;

  // ÏµúÏã† ??™©??Îß???
  const list = $("receiptList");
  if (list) list.prepend(item);

  // new ?§Ì??ºÏ? 5Ï¥????¥Ï†ú
  if (isNew) setTimeout(() => item.classList.remove("new-item"), 5000);
}

// ?Ä?Ä QR ?ùÏÑ± ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
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
    if (btnGen) { btnGen.disabled = true; btnGen.textContent = "QR ?ùÏÑ± Ï§?.."; }

    try {
      const createSession = httpsCallable(functions, "createBtRewardSession");
      const res = await createSession({ amount });
      const { rewardId, btAmount } = res.data;

      url = `${baseOrigin}/bt_receive.html?merchant=${merchantId}&amount=${amount}&currency=${currency}&bt=${btAmount}&rewardId=${rewardId}&nonce=${Date.now()}`;
      setText("qrCardAmount", `BT Î≥¥ÏÉÅ (${btAmount}??`);
    } catch (err) {
      if (btnGen) { btnGen.disabled = false; btnGen.textContent = "BT Î¨¥Î£å Î≥¥ÏÉÅ QR ?ùÏÑ±"; }
      alert("BT QR ?ùÏÑ± ?§Î•ò: " + (err?.message || "?úÎ≤Ñ ?µÏã† ?§Ìå®"));
      return;
    }
    if (btnGen) { btnGen.disabled = false; btnGen.textContent = "BT Î¨¥Î£å Î≥¥ÏÉÅ QR ?ùÏÑ±"; }
  }

  // qrcode.js (CDN) API
  /* global QRCode */
  QRCode.toCanvas(canvas, url, { width: 280, margin: 2, color: { dark: "#1a1a2e", light: "#ffffff" } }, (err) => {
    if (err) {
      console.error("QR ?ùÏÑ± ?§Î•ò:", err);
      alert("QR ?ùÏÑ±???§Ìå®?àÏäµ?àÎã§.");
      return;
    }

    // Ïπ¥Îìú ?ïÎ≥¥ ?ÖÎç∞?¥Ìä∏
    const amountDisp = currency === "VND"
      ? `${amount.toLocaleString()}??(VND)`
      : `${amount.toLocaleString()}??(KRW)`;
    setText("qrCardMerchant", merchantName);
    setText("qrCardAmount", amountDisp);
    show("qrSection", true);

    // ?§Ïö¥Î°úÎìú Î≤ÑÌäº
    const btnDl = $("btnDownloadQr");
    if (btnDl) {
      btnDl.onclick = () => {
        const link = document.createElement("a");
        link.download = `qr-${merchantId}-${amount}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      };
    }

    // ?ÖÍ∏à ?ïÏù∏ ?®ÎÑê ?úÏãú (Î¶¨ÏÖã ??
    resetReceipts();
    show("receiptSection", true);

    // ?ùÏÑ±??QR ?ÅÏó≠?ºÎ°ú ?§ÌÅ¨Î°?
    $("qrSection")?.scrollIntoView({ behavior: "smooth", block: "center" });

    // ?§ÏãúÍ∞?Í≤∞Ï†ú Í∞êÏ? ?úÏûë
    listenPayments(amount, currency);
  });
}

// ?Ä?Ä ?§ÏãúÍ∞?Í≤∞Ï†ú Í∞êÏ? ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
let _unsubscribe = null;

function listenPayments(amount, currency = "KRW") {
  // ?¥Ï†Ñ Î¶¨Ïä§???¥Ï†ú
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  // QR ?ùÏÑ± ?úÍ∞Å Í∏∞Ï? ???¥ÌõÑ ?ÑÏ∞©?òÎäî Í≤∞Ï†úÎß?Í∞êÏ?
  const since = Timestamp.now();

  // uid ?ÑÌÑ∞Î•??¨Ìï®?¥Ïïº Firestore Î≥¥Ïïà Í∑úÏπô(resource.data.uid == request.auth.uid) ?µÍ≥º
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
    // ?∏Îç±??ÎØ∏ÏÉù????fallback ??type ?ÑÌÑ∞ ?ÜÏù¥ ?¨Ïãú??
    if (err?.code === "failed-precondition" || err?.message?.includes("index")) {
      console.warn("?∏Îç±??ÎØ∏Ï?Îπ???type ?ÑÌÑ∞ ?ÜÏù¥ fallback Î¶¨Ïä§??);
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
  // Í∏∞Ï°¥ ?åÎ¶º ?úÍ±∞
  document.getElementById("paymentAlert")?.remove();

  const netHex = data.netAmountWei
    ? parseFloat((BigInt(data.netAmountWei) / 10n ** 14n) / 10000).toFixed(4)
    : data.amountHex || "?";

  const cur = data.currency || currency;
  const amountDisp = cur === "VND"
    ? `${(data.amountVnd || expectedAmount || 0).toLocaleString()}??
    : `${(data.amountKrw || expectedAmount || 0).toLocaleString()}??;

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
    <div style="font-size:2rem;margin-bottom:4px;">??/div>
    <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">Í≤∞Ï†ú ?ÑÎ£å!</div>
    <div style="font-size:0.95rem;opacity:.9;">Í≥†Í∞ù Î™ÖÏùòÎ°?${amountDisp} Í≤∞Ï†ú??/div>
    <div style="font-size:0.8rem;opacity:.7;margin-top:4px;">?ïÏÇ∞ Í∏àÏï°: ${vndVal.toLocaleString("ko-KR")} VND</div>
    <button onclick="document.getElementById('paymentAlert').remove()"
      style="margin-top:10px;background:rgba(255,255,255,.2);border:none;color:#fff;
             border-radius:6px;padding:4px 16px;cursor:pointer;font-size:0.85rem;">?´Í∏∞</button>
  `;

  document.body.appendChild(el);

  // ?åÎ¶¨ (ÏßÄ????
  try { new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAA==").play().catch(() => { }); } catch (_) { }

  // 10Ï¥????êÎèô ?úÍ±∞
  setTimeout(() => { document.getElementById("paymentAlert")?.remove(); }, 10000);
}


function getBtAmount(amount, currency) {
  let vnd = amount;
  if (currency === "KRW") vnd = amount * 18;
  return Math.floor(vnd / 100000);
}


// ?Ä?Ä ?êÍ≤© ?∞Í≤∞ ?Ä?Ä //
const btnRemoteBtSend = $("btnRemoteBtSend");
if (btnRemoteBtSend) {
  btnRemoteBtSend.onclick = async () => {
    const email = $("remoteUserEmail")?.value.trim();
    const amountVal = Number($("remoteVndAmount")?.value);
    const resBox = $("remoteBtResult");
    if (!email) return alert("Í≥†Í∞ù ?¥Î©î?ºÏùÑ ?ÖÎ†•?òÏÑ∏??");
    if (!amountVal || amountVal < 10000) return alert("Í≤∞Ï†ú Í∏àÏï°?Ä ÏµúÏÜå 10,000 VND ?¥ÏÉÅ?¥Ïñ¥???©Îãà??");

    try {
      btnRemoteBtSend.disabled = true;
      btnRemoteBtSend.textContent = "?ÑÏÜ° Ï§?..";
      
      

      const fn = httpsCallable(functions, "merchantSendBtDirect");
      const res = await fn({ customerEmail: email, amountVnd: amountVal });
      if (resBox) {
        resBox.style.color = "blue";
        resBox.innerHTML = `?ÑÏÜ° ?±Í≥µ! ${res.data.customerEmail}?òÏóêÍ≤?${res.data.btIssued} BTÍ∞Ä ÏßÄÍ∏âÎêò?àÏäµ?àÎã§.`;
      }
      $("remoteUserEmail").value = "";
      $("remoteVndAmount").value = "";
    } catch (err) {
      if (resBox) {
        resBox.style.color = "red";
        resBox.innerText = "?§Î•ò: " + err.message;
      }
    } finally {
      btnRemoteBtSend.disabled = false;
      btnRemoteBtSend.innerHTML = `<i class="fa-solid fa-gift me-2"></i>BT ?ÑÏÜ°?òÍ∏∞`;
    }
  };
}
