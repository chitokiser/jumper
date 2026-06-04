// /assets/js/pages/register.js
// 회원가입: 소셜 로그인(Google/Facebook/Apple) → 정보 저장 → 수탁 지갑 생성 → 온체인 등록

import { watchAuth, login, loginWithFacebook, loginWithApple } from "../auth.js";
import { loginWithTelegramWidget } from "../telegram-auth.js";
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

function setSocialMsg(msg, type) {
  const el = $("socialMsg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = type === "ok" ? "#16a34a" : type === "error" ? "#dc2626" : "#888";
}

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/[^0-9]/g, "");
  return s.startsWith("+") ? "+" + digits : digits;
}

function isValidPhone(p) {
  return String(p || "").replace(/[^0-9]/g, "").length >= 9;
}

// ── 소셜 로그인 버튼 바인딩 ──────────────────────────
function initSocialButtons() {
  async function handleLogin(loginFn, btnId) {
    const btn = $(btnId);
    if (!btn) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "로그인 중...";
    setSocialMsg("");
    try {
      await loginFn();
    } catch (err) {
      const code = err?.code || "";
      let msg = "로그인 실패: " + (err?.message || code);
      if (code === "auth/inapp-browser")                           msg = "인앱 브라우저에서는 소셜 로그인이 차단됩니다. 기본 브라우저로 열어 주세요.";
      if (code === "auth/popup-blocked")                           msg = "팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.";
      if (code === "auth/unauthorized-domain")                     msg = "허용되지 않은 도메인입니다. 관리자에게 Firebase 도메인 등록을 요청해 주세요.";
      if (code === "auth/network-request-failed")                  msg = "네트워크 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.";
      if (code === "auth/account-exists-with-different-credential") msg = "이미 다른 방식으로 가입된 계정입니다. 처음 가입한 방법으로 로그인해 주세요.";
      setSocialMsg(msg, "error");
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  $("btnGoogleLogin")?.addEventListener("click", () => handleLogin(login, "btnGoogleLogin"));
  $("btnFacebookLogin")?.addEventListener("click", () => handleLogin(loginWithFacebook, "btnFacebookLogin"));
  $("btnAppleLogin")?.addEventListener("click", () => handleLogin(loginWithApple, "btnAppleLogin"));

  // 텔레그램 로그인 위젯
  $("btnTelegramLogin")?.addEventListener("click", () => {
    const btn  = $("btnTelegramLogin");
    const wrap = $("telegramWidgetWrap");
    if (!wrap) return;

    // Telegram Login Widget 스크립트 동적 삽입
    if (!document.getElementById("tgWidgetScript")) {
      const s = document.createElement("script");
      s.id   = "tgWidgetScript";
      s.src  = "https://telegram.org/js/telegram-widget.js?22";
      s.setAttribute("data-telegram-login", "JumpDaoBot");
      s.setAttribute("data-size", "large");
      s.setAttribute("data-radius", "8");
      s.setAttribute("data-request-access", "write");
      s.setAttribute("data-onauth", "window.__onTgWidgetAuth(user)");
      s.async = true;
      wrap.appendChild(s);
      wrap.style.display = "block";
      if (btn) { btn.textContent = "텔레그램 앱에서 인증해주세요…"; btn.disabled = true; }
    } else {
      wrap.style.display = wrap.style.display === "none" ? "block" : "none";
    }
  });

  // 텔레그램 위젯 콜백 (전역 함수로 등록)
  window.__onTgWidgetAuth = async (userData) => {
    const btn  = $("btnTelegramLogin");
    const msg  = $("socialMsg");
    if (btn) { btn.textContent = "텔레그램 인증 중…"; btn.disabled = true; }
    try {
      await loginWithTelegramWidget(userData);
      // watchAuth가 로그인 감지 후 자동으로 다음 단계 처리
    } catch (e) {
      const text = e?.message || "텔레그램 로그인 실패";
      if (msg) msg.textContent = text;
      if (btn) {
        btn.innerHTML = '<span class="social-icon" style="background:#fff;color:#0088cc;font-weight:900;">✈</span> Telegram으로 계속하기';
        btn.disabled = false;
      }
    }
  };
}

// ── 이미 가입한 경우 표시 ──────────────────────────
function showAlreadyDone(userData) {
  show("authSection", false);
  show("alreadyDone", true);
  show("regForm",     false);

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

  setStep("step2", "doing");
  setStep("step3", "doing");
  const createWallet = httpsCallable(functions, "createWallet");
  const walletResult = await createWallet({ mentorAddress });
  const walletAddress  = walletResult.data?.address;
  const referralBonus  = walletResult.data?.referralBonus;
  setStep("step2", "done");
  setStep("step3", "done");

  return { walletAddress, referralBonus };
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
      const { walletAddress, referralBonus } = await doRegister(uid, user);
      setState("가입 완료!");

      show("regForm",    false);
      show("alreadyDone", true);
      show("walletRow",  true);
      const addrEl = $("walletAddr");
      if (addrEl) addrEl.textContent = walletAddress || "생성됨";
      show("onChainRow", true);
      const onChainEl = $("onChainStatus");
      if (onChainEl) { onChainEl.textContent = "등록 완료 ✓"; onChainEl.style.color = "var(--accent)"; }

      // 추천인 보너스 알림
      if (referralBonus) {
        const bonusEl = document.createElement("p");
        bonusEl.style.cssText = "margin-top:12px;padding:10px 14px;background:#fef3c7;border-radius:10px;font-size:0.88rem;color:#92400e;font-weight:600;text-align:center;";
        bonusEl.textContent = "🎁 추천인 보너스! 게임코인 1,000 포인트가 지급되었습니다.";
        $("alreadyDone")?.appendChild(bonusEl);
      }
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
    show("authSection", false);
    show("regForm", true);

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
initSocialButtons();

watchAuth(async (ctx) => {
  if (_authDone) return;
  if (!ctx.loggedIn || !ctx.user) return;
  if (ctx.user.isAnonymous) return;

  _authDone = true;
  show("authSection", false);
  await _initForUser(ctx.user);
});
