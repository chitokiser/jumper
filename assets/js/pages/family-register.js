// /assets/js/pages/family-register.js
// 판매회원 등록: 온체인 registerMerchant + Firestore 저장

import { watchAuth, login } from "../auth.js";
import { app, auth, db, functions } from "/assets/js/firebase-init.js";

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

// ── 유틸 ──────────────────────────────────────────
function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}

function setState(msg) {
  const el = $("applyState");
  if (el) el.textContent = msg || "";
}

function setStep(id, status) {
  const el = $(id);
  if (!el) return;
  el.dataset.status = status; // "wait" | "doing" | "done" | "error"
}

// ── 이미 등록된 가맹점 표시 ──────────────────────
function showAlreadyMerchant(merchantId, feeBps, merchantName) {
  show("alreadyMerchantPanel", true);
  const idEl   = $("existingMerchantId");
  const feeEl  = $("existingFeeBps");
  const nameEl = $("existingMerchantName");
  if (idEl)   idEl.textContent  = String(merchantId);
  if (nameEl) nameEl.textContent = merchantName || "-";
  if (feeEl) {
    if (feeBps != null) {
      feeEl.textContent = `${(Number(feeBps) / 100).toFixed(1)}%`;
    } else {
      feeEl.textContent = "관리자 설정 중 (기본 10% 예정)";
    }
  }
}

// ── 등록 완료 표시 ───────────────────────────────
function showDone(merchantId, txHash) {
  show("merchantForm", false);
  show("merchantDonePanel", true);
  const idEl = $("newMerchantId");
  const txEl = $("doneTxHash");
  if (idEl) idEl.textContent = String(merchantId);
  if (txEl) txEl.textContent = txHash || "";
}

// ── 온체인 등록 실행 ─────────────────────────────
async function doRegisterMerchant() {
  const name    = String($("merchantName")?.value    || "").trim();
  const career  = String($("merchantCareer")?.value  || "").trim();
  const region  = String($("merchantRegion")?.value  || "").trim();
  const detail  = String($("merchantDetail")?.value  || "").trim();
  const phone   = String($("merchantPhone")?.value   || "").trim();
  const kakaoId = String($("merchantKakaoId")?.value || "").trim();
  const gmap    = String($("merchantGmap")?.value    || "").trim();

  if (!name)   throw new Error("가게명을 입력해 주세요.");
  if (!career) throw new Error("업종/카테고리를 입력해 주세요.");
  if (!region) throw new Error("활동 지역을 입력해 주세요.");

  show("stepBox", true);

  // ① 온체인 등록 (Cloud Function → 수탁 지갑 서명 → registerMerchant)
  setStep("step1", "doing");
  let result;
  try {
    const registerFn = httpsCallable(functions, "registerMerchant");
    result = await registerFn({ name, description: detail, phone, kakaoId, region, career, gmap });
    setStep("step1", "done");
  } catch (err) {
    setStep("step1", "error");
    throw new Error(err?.message || "온체인 등록 실패");
  }

  // ② Firestore 저장은 Cloud Function 내부에서 완료됨
  setStep("step2", "done");

  return result.data; // { txHash, merchantId }
}

// ── 폼 바인딩 ───────────────────────────────────
function bindForm() {
  const form = $("merchantForm");
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("btnRegisterMerchant");
    if (btn) { btn.disabled = true; btn.textContent = "등록 중..."; }

    try {
      setState("온체인 등록 중...");
      const { txHash, merchantId } = await doRegisterMerchant();
      setState("등록 완료!");
      showDone(merchantId, txHash);
    } catch (err) {
      console.error(err);
      setState("오류 발생");
      const stepBox = $("stepBox");
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.style.color = "var(--danger, #e53e3e)";
      hint.textContent = err?.message || "오류가 발생했습니다. 다시 시도해 주세요.";
      if (stepBox) stepBox.after(hint);
      if (btn) { btn.disabled = false; btn.textContent = "가맹점 등록"; }
    }
  });
}

// ── 멘토 이메일 등록 ─────────────────────────────
function showMentorMsg(msg, kind) {
  const el = $("mentorLinkMsg");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "";
  el.style.color =
    kind === "danger" ? "rgba(255,77,109,.95)" :
    kind === "ok"     ? "var(--accent)"        :
                        "var(--muted)";
}

async function initMentorLink(email) {
  const panel = $("mentorLinkPanel");
  if (!panel || !email) return;
  panel.style.display = "";

  try {
    const snap = await getDoc(doc(db, "mentors", email.toLowerCase()));
    if (snap.exists()) {
      const addr   = snap.data()?.address || "";
      const box    = $("mentorCurrentBox");
      const addrEl = $("mentorCurrentAddr");
      if (box)    box.style.display = "";
      if (addrEl) addrEl.textContent = addr;
    }
  } catch (_) { /* 읽기 실패 무시 */ }

  const btn = $("btnLinkMentor");
  if (!btn) return;

  btn.onclick = async () => {
    if (!window.ethereum) {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        const deepLink = "https://metamask.app.link/dapp/" +
          location.host + location.pathname + location.search;
        showMentorMsg(
          `모바일에서는 MetaMask 앱 내 브라우저를 사용해야 합니다. ` +
          `<a href="${deepLink}" style="color:#7c3aed;font-weight:700;">MetaMask 앱으로 열기 →</a>`,
          "warning"
        );
      } else {
        showMentorMsg(
          'MetaMask가 설치되어 있지 않습니다. ' +
          '<a href="https://metamask.io/download/" target="_blank" style="color:#7c3aed;">설치하기 →</a>',
          "danger"
        );
      }
      return;
    }
    btn.disabled = true;
    btn.textContent = "서명 중...";

    try {
      const accounts  = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address   = accounts[0];
      const msg       = `Jump Platform 멘토 등록\nEmail: ${email.toLowerCase()}`;
      const msgHex    = "0x" + Array.from(new TextEncoder().encode(msg))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [msgHex, address],
      });

      const idToken = await auth.currentUser.getIdToken();
      const region  = "us-central1";
      const project = app.options.projectId;
      const fnUrl   = `https://${region}-${project}.cloudfunctions.net/linkMentor`;

      const resp = await fetch(fnUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body:    JSON.stringify({ address, signature }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "서버 오류");

      const box    = $("mentorCurrentBox");
      const addrEl = $("mentorCurrentAddr");
      if (box)    box.style.display = "";
      if (addrEl) addrEl.textContent = address;
      showMentorMsg("등록 완료! 신규 사용자가 이 이메일을 멘토로 입력할 수 있습니다.", "ok");
      btn.textContent = "등록 완료 ✓";
    } catch (err) {
      showMentorMsg(err.message || "등록 실패", "danger");
      btn.disabled = false;
      btn.textContent = "MetaMask 서명 후 등록";
    }
  };
}

// ── 진입점 ────────────────────────────────────────
// watchAuth(상시 구독): 팝업 로그인 후에도 즉시 반응
let _authDone = false;

async function _initForUser(ctx) {
  const user = ctx.user;

  try {
    setState("내 정보 확인 중...");

    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? userSnap.data() : null;

    // ② 회원가입(이름) 미완료
    if (!userData?.name) {
      setState("회원가입이 필요합니다.");
      show("needRegisterPanel", true);
      return;
    }

    // ③ 이미 판매자 등록됨 (온체인 등록 여부보다 먼저 체크)
    if (userData?.merchantId != null) {
      setState("이미 판매회원으로 등록되어 있습니다.");
      let feeBps = null;
      let merchantName = null;
      try {
        const mSnap = await getDoc(doc(db, "merchants", String(userData.merchantId)));
        if (mSnap.exists()) {
          feeBps = mSnap.data()?.feeBps ?? null;
          merchantName = mSnap.data()?.name ?? null;
        }
      } catch (_) {}
      showAlreadyMerchant(userData.merchantId, feeBps, merchantName);
      initMentorLink(user.email);
      return;
    }

    // ④ 온체인 등록 미완료
    if (!userData?.onChain?.registered) {
      setState("온체인 회원 등록이 필요합니다.");
      show("needOnChainPanel", true);
      return;
    }

    // ⑤ 폼 표시
    setState("");
    show("merchantForm", true);
    bindForm();
    initMentorLink(user.email);

  } catch (err) {
    console.error(err);
    setState("오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.");
    show("merchantForm", true);
    bindForm();
  }
}

function _showNeedLogin() {
  setState("로그인이 필요합니다.");
  show("needLoginPanel", true);
  const btn = $("btnLogin");
  if (btn) {
    btn.onclick = async () => {
      try { await login(); } catch (e) { console.warn(e); }
      // watchAuth가 로그인 완료를 감지해서 자동으로 폼을 표시합니다.
    };
  }
}

watchAuth(async (ctx) => {
  if (_authDone) return;
  if (!ctx.loggedIn || !ctx.user) return;

  _authDone = true;
  show("needLoginPanel", false);
  await _initForUser(ctx);
});

// 4초 이내 로그인 없으면 미로그인 안내
setTimeout(() => {
  if (!_authDone) {
    _showNeedLogin();
  }
}, 4000);
