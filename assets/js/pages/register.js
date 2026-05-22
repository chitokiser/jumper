// /assets/js/pages/register.js
// 회원가입: 전화번호 OTP 인증 → 정보 저장 → 수탁 지갑 생성 → 온체인 등록

import { watchAuth, login } from "../auth.js";
import { auth, db, functions } from "/assets/js/firebase-init.js";

import {
  signInWithPhoneNumber,
  RecaptchaVerifier,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
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
  const el = $("regState");
  if (el) el.textContent = msg || "";
}

function setStep(id, status) {
  const el = $(id);
  if (!el) return;
  el.dataset.status = status;
}

function setAuthMsg(msg, type) {
  const el = $("authMsg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = type === "ok" ? "#16a34a" : type === "error" ? "#dc2626" : "#888";
}

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/[^0-9]/g, "");
  // E.164 형식 보장: + 없으면 그대로, + 있으면 유지
  return s.startsWith("+") ? "+" + digits : digits;
}

function isValidPhone(p) {
  return String(p || "").replace(/[^0-9]/g, "").length >= 9;
}

// ── 전화번호 인증 ──────────────────────────────────
let _confirmationResult = null;
let _recaptchaVerifier  = null;
let _authDone           = false;

async function initRecaptcha() {
  try { _recaptchaVerifier?.clear(); } catch (_) {}
  _recaptchaVerifier = new RecaptchaVerifier(auth, "recaptchaContainer", {
    size: "normal",
    callback: () => {},
    "expired-callback": () => {},
  });
  try { await _recaptchaVerifier.render(); } catch (_) {}
}

async function sendOtp() {
  const raw = ($("inputPhone")?.value || "").trim();
  if (!raw) { setAuthMsg("전화번호를 입력해 주세요.", "error"); return; }
  if (!raw.startsWith("+")) {
    setAuthMsg("국가코드(+84, +82 등)를 포함해서 입력해 주세요. 예: +84 912 345 678", "error");
    return;
  }
  const phone = "+" + raw.replace(/[^0-9]/g, "");
  if (!isValidPhone(phone)) {
    setAuthMsg("올바른 전화번호를 입력해 주세요. (예: +84 912 345 678)", "error");
    return;
  }

  const btn = $("btnSendOtp");
  btn.disabled = true;
  btn.textContent = "전송 중...";
  setAuthMsg("");

  try {
    if (!_recaptchaVerifier) await initRecaptcha();
    _confirmationResult = await signInWithPhoneNumber(auth, phone, _recaptchaVerifier);
    setAuthMsg("인증번호를 전송했습니다. 문자를 확인해 주세요. ✓", "ok");
    show("otpSection", true);
    $("inputOtp")?.focus();
  } catch (err) {
    const code = err?.code || "";
    const rawMsg = err?.message || String(err);
    let msg = "전송 실패: " + rawMsg;
    if (code === "auth/invalid-phone-number")    msg = "전화번호 형식이 올바르지 않습니다. (예: +84 912 345 678)";
    if (code === "auth/too-many-requests")        msg = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    if (code === "auth/captcha-check-failed")     msg = "보안 인증 실패. 페이지를 새로고침 후 다시 시도해 주세요.";
    if (code === "auth/invalid-app-credential")   msg = "앱 인증 오류입니다. Firebase Console → Authentication → 승인된 도메인에 현재 도메인을 추가해 주세요.";
    if (rawMsg.includes("error-code:-39"))        msg = "도메인 인증 오류 (error-code:-39). Firebase Console → Authentication → Settings → 승인된 도메인에 현재 도메인을 추가해 주세요.";
    setAuthMsg(msg, "error");
    _recaptchaVerifier = null;
    await initRecaptcha();
  } finally {
    btn.disabled = false;
    btn.textContent = "인증번호 받기";
  }
}

async function verifyOtp() {
  const otp = ($("inputOtp")?.value || "").trim();
  if (otp.length < 6) { setAuthMsg("6자리 인증번호를 입력해 주세요.", "error"); return; }
  if (!_confirmationResult) { setAuthMsg("먼저 인증번호를 요청해 주세요.", "error"); return; }

  const btn = $("btnVerifyOtp");
  btn.disabled = true;
  btn.textContent = "확인 중...";
  setAuthMsg("");

  try {
    await _confirmationResult.confirm(otp);
    setAuthMsg("인증 완료! 잠시 기다려 주세요...", "ok");
    // watchAuth가 로그인 상태를 감지해서 자동으로 다음 단계 진행
  } catch (err) {
    const code = err?.code || "";
    let msg = "인증 실패: 코드를 다시 확인해 주세요.";
    if (code === "auth/code-expired")                msg = "인증번호가 만료되었습니다. 다시 요청해 주세요.";
    if (code === "auth/invalid-verification-code")   msg = "인증번호가 올바르지 않습니다.";
    if (code === "auth/missing-verification-code")   msg = "인증번호를 입력해 주세요.";
    setAuthMsg(msg, "error");
    btn.disabled = false;
    btn.textContent = "확인";
  }
}

// ── 탭 전환 ────────────────────────────────────────
function initTabs() {
  const tabPhone  = $("tabPhone");
  const tabGoogle = $("tabGoogle");

  if (tabPhone) tabPhone.onclick = () => {
    tabPhone.classList.add("auth-tab--active");
    tabGoogle?.classList.remove("auth-tab--active");
    show("panelPhone",  true);
    show("panelGoogle", false);
  };

  if (tabGoogle) tabGoogle.onclick = () => {
    tabGoogle.classList.add("auth-tab--active");
    tabPhone?.classList.remove("auth-tab--active");
    show("panelGoogle", true);
    show("panelPhone",  false);
  };

  $("btnSendOtp")?.addEventListener("click", sendOtp);
  $("btnVerifyOtp")?.addEventListener("click", verifyOtp);
  $("inputPhone")?.addEventListener("keydown", (e) => { if (e.key === "Enter") sendOtp(); });
  $("inputOtp")?.addEventListener("keydown",   (e) => { if (e.key === "Enter") verifyOtp(); });

  $("btnGoogleLogin")?.addEventListener("click", async () => {
    const msgEl = $("googleMsg");
    try {
      if (msgEl) { msgEl.textContent = "로그인 중..."; msgEl.style.color = "#888"; }
      await login();
    } catch (err) {
      const code = err?.code || "";
      let msg = "로그인 실패: " + err.message;
      if (code === "auth/inapp-browser") msg = "인앱 브라우저에서는 Google 로그인이 차단됩니다. 기본 브라우저로 열어 주세요.";
      if (msgEl) { msgEl.textContent = msg; msgEl.style.color = "#dc2626"; }
    }
  });
}

// ── 이미 가입한 경우 표시 ──────────────────────────
function showAlreadyDone(userData, uid) {
  show("authSection", false);
  show("alreadyDone", true);
  show("regForm",     false);

  const phone = userData?.phone;
  show("phoneRow", true);
  const phoneEl = $("phoneDisplay");
  if (phoneEl) phoneEl.textContent = phone || "(미등록)";
  bindPhoneEdit(uid, phone || "");

  const wallet = userData?.wallet?.address;
  if (wallet) {
    show("walletRow", true);
    const el = $("walletAddr");
    if (el) el.textContent = wallet;
  }

  const registered = userData?.onChain?.registered;
  show("onChainRow", true);
  const statusEl = $("onChainStatus");
  if (statusEl) {
    statusEl.textContent = registered ? "등록 완료 ✓" : "미등록 (나중에 진행 가능)";
    statusEl.style.color  = registered ? "var(--accent)" : "var(--muted)";
  }
}

function bindPhoneEdit(uid, currentPhone) {
  const btnEdit   = $("btnEditPhone");
  const input     = $("phoneEditInput");
  const btnSave   = $("btnSavePhone");
  const btnCancel = $("btnCancelPhone");
  const msg       = $("phoneSaveMsg");

  if (btnEdit) btnEdit.onclick = () => {
    if (input) input.value = currentPhone;
    show("phoneEditBox", true);
    show("btnEditPhone", false);
    if (input) input.focus();
  };

  if (btnCancel) btnCancel.onclick = () => {
    show("phoneEditBox", false);
    show("btnEditPhone", true);
    if (msg) msg.textContent = "";
  };

  if (btnSave) btnSave.onclick = async () => {
    const newPhone = normalizePhone(input?.value);
    if (!isValidPhone(newPhone)) {
      if (msg) { msg.textContent = "올바른 전화번호를 입력해 주세요 (10자리 이상)."; msg.style.color = "var(--danger, #e53e3e)"; }
      return;
    }
    btnSave.disabled = true;
    btnSave.textContent = "저장 중...";
    try {
      await setDoc(doc(db, "users", uid), { phone: newPhone, updatedAt: serverTimestamp() }, { merge: true });
      const phoneEl = $("phoneDisplay");
      if (phoneEl) phoneEl.textContent = newPhone;
      currentPhone = newPhone;
      if (msg) { msg.textContent = "저장되었습니다 ✓"; msg.style.color = "var(--accent)"; }
      setTimeout(() => {
        show("phoneEditBox", false);
        show("btnEditPhone", true);
        if (msg) msg.textContent = "";
      }, 1200);
    } catch (err) {
      if (msg) { msg.textContent = "저장 실패: " + err.message; msg.style.color = "var(--danger, #e53e3e)"; }
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "저장";
    }
  };
}

// ── 가입 실행 ──────────────────────────────────────
async function doRegister(uid, user) {
  const name          = String($("userName")?.value    || "").trim();
  const phone         = normalizePhone($("userPhone")?.value);
  const mentorAddress = String($("mentorAddress")?.value || "").trim();
  const agreeTerms    = Boolean($("agreeTerms")?.checked);
  const agreeWallet   = Boolean($("agreeWallet")?.checked);

  if (!name)  throw new Error("이름을 입력해 주세요.");
  if (!phone || !isValidPhone(phone)) throw new Error("올바른 휴대폰 번호를 입력해 주세요.");
  if (mentorAddress && !/^0x[0-9a-fA-F]{40}$/.test(mentorAddress))
    throw new Error("올바른 지갑 주소를 입력해 주세요. (0x로 시작하는 42자리 hex)");
  if (!agreeTerms)  throw new Error("이용약관에 동의해 주세요.");
  if (!agreeWallet) throw new Error("수탁 지갑 생성에 동의해 주세요.");

  show("stepBox", true);

  // ① Firestore 저장
  setStep("step1", "doing");
  await setDoc(doc(db, "users", uid), {
    name,
    phone,
    email:              user?.email || "",
    mentorAddressInput: mentorAddress,
    agreeTerms:         true,
    agreeWallet:        true,
    registeredAt:       serverTimestamp(),
    updatedAt:          serverTimestamp(),
  }, { merge: true });
  setStep("step1", "done");

  // ② 수탁 지갑 생성 + ③ 온체인 등록 (createWallet이 두 작업 처리)
  setStep("step2", "doing");
  setStep("step3", "doing");
  const createWallet = httpsCallable(functions, "createWallet");
  const walletResult = await createWallet({ mentorAddress });
  const walletAddress = walletResult.data?.address;
  setStep("step2", "done");
  setStep("step3", "done");

  return walletAddress;
}

// ── 폼 이벤트 바인딩 ──────────────────────────────
function bindForm(uid, user) {
  const form = $("regForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("btnRegister");
    if (btn) { btn.disabled = true; btn.textContent = "처리 중..."; }

    try {
      setState("가입 처리 중...");
      const walletAddress = await doRegister(uid, user);
      setState("가입 완료!");

      show("regForm",    false);
      show("alreadyDone", true);
      show("walletRow",  true);
      const addrEl = $("walletAddr");
      if (addrEl) addrEl.textContent = walletAddress || "생성됨";
      show("onChainRow", true);
      const onChainEl = $("onChainStatus");
      if (onChainEl) { onChainEl.textContent = "등록 완료 ✓"; onChainEl.style.color = "var(--accent)"; }
    } catch (err) {
      setState("오류 발생");
      const box  = $("stepBox");
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.style.color = "var(--danger, #e53e3e)";
      hint.textContent = err?.message || "오류가 발생했습니다. 다시 시도해 주세요.";
      if (box) box.after(hint);
      if (btn) { btn.disabled = false; btn.textContent = "가입 완료"; }
    }
  });
}

// ── 로그인 후 사용자 초기화 ────────────────────────
async function _initForUser(user) {
  try {
    setState("내 정보 확인 중...");
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : null;

    if (data?.name) {
      // 이미 가입 완료
      setState("이미 가입된 계정입니다.");
      showAlreadyDone(data, user.uid);
      return;
    }

    // 신규 사용자 → 폼 표시
    setState("");
    show("authSection", false);
    show("regForm", true);

    // 전화번호 인증 사용자: 번호 자동 채우기 + 읽기전용
    const phoneEl = $("userPhone");
    if (phoneEl) {
      phoneEl.value = user.phoneNumber || data?.phone || "";
      if (user.phoneNumber) {
        phoneEl.readOnly = true;
        phoneEl.style.background = "rgba(0,0,0,.08)";
        phoneEl.style.color = "var(--muted)";
      }
    }

    // 멘토 주소: URL 파라미터 > 기본값
    const DEFAULT_MENTOR = "0xc662c3B58bE7345DE30dd8188B2Acc977943186A";
    const mentorEl = $("mentorAddress");
    if (mentorEl && !mentorEl.value) {
      const urlMentor = new URLSearchParams(location.search).get("mentor") || "";
      mentorEl.value = /^0x[0-9a-fA-F]{40}$/.test(urlMentor) ? urlMentor : DEFAULT_MENTOR;
    }

    bindForm(user.uid, user);
  } catch (err) {
    setState("오류");
    show("authSection", false);
    show("regForm", true);
    bindForm(user.uid, user);
  }
}

// ── 진입점 ────────────────────────────────────────
initTabs();
initRecaptcha();

watchAuth(async (ctx) => {
  if (_authDone) return;
  if (!ctx.loggedIn || !ctx.user) return;
  if (ctx.user.isAnonymous) return; // 익명 사용자는 전화/구글 인증 유도

  _authDone = true;
  show("authSection", false);
  await _initForUser(ctx.user);
});
