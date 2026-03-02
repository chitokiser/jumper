// /assets/js/pages/register.js
// 회원가입: 기본 정보 저장 + 수탁 지갑 생성 + 온체인 등록

import { watchAuth, login } from "../auth.js";
import { db, functions } from "/assets/js/firebase-init.js";

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
  // status: "wait" | "doing" | "done" | "error"
  const el = $(id);
  if (!el) return;
  el.dataset.status = status;
}

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^0-9]/g, "");
  return plus ? plus + digits : digits;
}

function isValidPhone(p) {
  return String(p || "").replace(/[^0-9]/g, "").length >= 10;
}

// ── 이미 가입한 경우 표시 ──────────────────────────
function showAlreadyDone(userData) {
  show("alreadyDone", true);
  show("regForm", false);

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
    statusEl.style.color = registered ? "var(--accent)" : "var(--muted)";
  }
}

// ── 가입 실행 ──────────────────────────────────────
async function doRegister(uid, email) {
  const name        = String($("userName")?.value  || "").trim();
  const phone       = normalizePhone($("userPhone")?.value);
  const mentorEmail = String($("mentorEmail")?.value || "").trim().toLowerCase();
  const agreeTerms  = Boolean($("agreeTerms")?.checked);
  const agreeWallet = Boolean($("agreeWallet")?.checked);

  // 유효성 검사
  if (!name)          throw new Error("이름을 입력해 주세요.");
  if (!phone)         throw new Error("휴대폰 번호를 입력해 주세요.");
  if (!isValidPhone(phone)) throw new Error("올바른 전화번호를 입력해 주세요. (10자리 이상)");
  if (!agreeTerms)    throw new Error("이용약관에 동의해 주세요.");
  if (!agreeWallet)   throw new Error("수탁 지갑 생성에 동의해 주세요.");

  // 진행 표시
  show("stepBox", true);

  // ── 1단계: Firestore 저장 ──
  setStep("step1", "doing");
  await setDoc(doc(db, "users", uid), {
    name,
    phone,
    email: email || "",
    mentorEmailInput: mentorEmail || null,
    agreeTerms:  true,
    agreeWallet: true,
    registeredAt: serverTimestamp(),
    updatedAt:    serverTimestamp(),
  }, { merge: true });
  setStep("step1", "done");

  // ── 2단계: 수탁 지갑 생성 ──
  setStep("step2", "doing");
  let walletAddress = null;
  try {
    const createWallet = httpsCallable(functions, "createWallet");
    const walletResult = await createWallet();
    walletAddress = walletResult.data?.address;
    setStep("step2", "done");
  } catch (err) {
    // 함수 미배포 또는 오류 → 건너뜀 (배포 후 재시도 가능)
    setStep("step2", "error");
    console.warn("수탁 지갑 생성 실패 (배포 후 재시도):", err.message);
  }

  // ── 3단계: 온체인 등록 (멘토 이메일 있을 때만) ──
  setStep("step3", "doing");
  if (mentorEmail) {
    try {
      const registerMember = httpsCallable(functions, "registerMember");
      await registerMember({ mentorEmail });
      setStep("step3", "done");
    } catch (err) {
      setStep("step3", "error");
      console.warn("온체인 등록 실패 (나중에 재시도 가능):", err.message);
    }
  } else {
    setStep("step3", "done"); // 멘토 없으면 skip
  }

  return walletAddress;
}

// ── 이벤트 바인딩 ──────────────────────────────────
function bindForm(uid, email) {
  const form = $("regForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("btnRegister");
    if (btn) { btn.disabled = true; btn.textContent = "처리 중..."; }

    try {
      setState("가입 처리 중...");
      const walletAddress = await doRegister(uid, email);
      setState("가입 완료!");

      // 완료 화면으로 전환
      show("regForm", false);
      show("alreadyDone", true);
      show("walletRow", true);
      const addrEl = $("walletAddr");
      if (addrEl) addrEl.textContent = walletAddress || "생성됨";
      show("onChainRow", true);
      const onChainEl = $("onChainStatus");
      const mentorEmail = String($("mentorEmail")?.value || "").trim();
      if (onChainEl) {
        onChainEl.textContent = mentorEmail ? "등록 완료 ✓" : "미등록 (나중에 진행 가능)";
        onChainEl.style.color = mentorEmail ? "var(--accent)" : "var(--muted)";
      }
    } catch (err) {
      console.error(err);
      setState("오류 발생");
      const box = $("stepBox");
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.style.color = "var(--danger, #e53e3e)";
      hint.textContent = err?.message || "오류가 발생했습니다. 다시 시도해 주세요.";
      if (box) box.after(hint);
      if (btn) { btn.disabled = false; btn.textContent = "가입 완료"; }
    }
  });
}

// ── 진입점 ────────────────────────────────────────
// onAuthReady(1회성)가 아닌 watchAuth(상시 구독)를 사용:
// 팝업 로그인 후 페이지 새로고침 없이도 인증 상태 변화를 감지해 폼을 표시합니다.
let _authDone = false;

async function _initForUser(user) {
  try {
    setState("내 정보 확인 중...");

    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : null;

    if (data?.name) {
      setState("이미 가입된 계정입니다.");
      showAlreadyDone(data);
      return;
    }

    setState("");
    show("regForm", true);

    if (data?.phone) {
      const el = $("userPhone");
      if (el) el.value = data.phone;
    }

    bindForm(user.uid, user.email);
  } catch (err) {
    console.error(err);
    setState("오류");
    show("regForm", true);
    bindForm(user.uid, user.email);
  }
}

function _showNeedLogin() {
  setState("로그인이 필요합니다.");
  show("needLogin", true);
  const btnLogin = $("btnLoginPage");
  if (btnLogin) {
    btnLogin.onclick = async () => {
      try { await login(); } catch (e) { console.warn(e); }
      // watchAuth가 로그인 완료를 감지해서 자동으로 폼을 표시합니다.
    };
  }
}

// 로그인 상태 변화를 구독 — 팝업 로그인 후에도 즉시 반응
watchAuth(async (ctx) => {
  if (_authDone) return;
  if (!ctx.loggedIn || !ctx.user) return; // 아직 로그인 전 → 대기

  _authDone = true;
  show("needLogin", false); // 로그인 안내가 표시됐었다면 숨기기
  await _initForUser(ctx.user);
});

// 4초 이내에 로그인이 확인되지 않으면 미로그인 안내 표시
setTimeout(() => {
  if (!_authDone) {
    _showNeedLogin();
  }
}, 4000);
