// /assets/js/pages/merchant-qr.js
// 가맹점용 QR 코드 생성 페이지

import { onAuthReady } from "../auth.js";
import { login } from "../auth.js";
import { db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const amountRaw = $("qrAmount")?.value || "";
    const amount = Number(amountRaw);

    if (!amount || amount < 1000) {
      alert("최소 1,000원 이상 입력해 주세요.");
      return;
    }

    generateQr(merchantId, merchantName, amount);
  });
}

// ── QR 생성 ────────────────────────────────────────────
function generateQr(merchantId, merchantName, amountKrw) {
  const canvas = $("qrCanvas");
  if (!canvas) return;

  const PROD_ORIGIN = "https://jovialtravel.netlify.app";
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const baseOrigin = isLocal ? PROD_ORIGIN : location.origin;
  const url = `${baseOrigin}/pay.html?merchant=${merchantId}&amount=${amountKrw}`;

  // qrcode.js (CDN) API
  /* global QRCode */
  QRCode.toCanvas(canvas, url, { width: 280, margin: 2, color: { dark: "#1a1a2e", light: "#ffffff" } }, (err) => {
    if (err) {
      console.error("QR 생성 오류:", err);
      alert("QR 생성에 실패했습니다.");
      return;
    }

    // 카드 정보 업데이트
    setText("qrCardMerchant", merchantName);
    setText("qrCardAmount", `${amountKrw.toLocaleString()}원`);
    show("qrSection", true);

    // 다운로드 버튼
    const btnDl = $("btnDownloadQr");
    if (btnDl) {
      btnDl.onclick = () => {
        const link = document.createElement("a");
        link.download = `qr-${merchantId}-${amountKrw}원.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      };
    }

    // 생성된 QR 영역으로 스크롤
    $("qrSection")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
