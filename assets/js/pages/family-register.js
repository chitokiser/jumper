// /assets/js/pages/family-register.js
// 조합원 신청(=기존 가이드 신청)
// - 관리자 승인 화면 호환: guideApplications/{uid}
// - 사용자 프로필 유지: users/{uid}
// - 기존 가이드(승인완료) 사용자는 재신청 요구하지 않음(approved 판정)
// - 승인완료 사용자가 저장해도 status를 pending으로 덮어쓰지 않음

import { onAuthReady } from "../auth.js";
import { app, auth, db } from "/assets/js/firebase-init.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^0-9]/g, "");
  return plus ? plus + digits : digits;
}
function isValidPhone(p) {
  const digits = String(p || "").replace(/[^0-9]/g, "");
  return digits.length >= 10;
}

function setState(t) {
  const el = $("applyState");
  if (el) el.textContent = t || "";
}
function showForm(show) {
  const form = $("applyForm");
  if (!form) return;
  form.classList.toggle("hide", !show);
}
function showStatus(msg, kind = "info") {
  const box = $("statusBox");
  const text = $("statusText");
  if (!box || !text) return;
  box.style.display = "block";
  box.dataset.kind = kind;
  text.textContent = msg || "";
}

function fillForm(profile) {
  const intro = $("intro"); if (intro) intro.value = profile?.intro || "";
  const phone = $("phone"); if (phone) phone.value = profile?.phone || "";
  const kakaoId = $("kakaoId"); if (kakaoId) kakaoId.value = profile?.kakaoId || "";
  const agreeKakao = $("agreeKakao"); if (agreeKakao) agreeKakao.checked = Boolean(profile?.agreeKakao);
  const walletAddress = $("walletAddress"); if (walletAddress) walletAddress.value = profile?.walletAddress || "";
  const region = $("region"); if (region) region.value = profile?.region || "";
  const career = $("career"); if (career) career.value = profile?.career || "";
  const detail = $("detail"); if (detail) detail.value = profile?.detail || "";
}

function extractProfile(data){
  if (!data) return null;
  return data.profile || data;
}

async function readDoc(path, id){
  try{
    const snap = await getDoc(doc(db, path, id));
    if (!snap.exists()) return null;
    return snap.data() || null;
  }catch(e){
    console.warn("readDoc failed:", path, id, e);
    return null;
  }
}

function normalizeStatus(v){
  const s = String(v || "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "pending") return "pending";
  return "";
}

function isApprovedByDocs({ guidesDoc, usersDoc, appDoc }){
  // 1) 예전 가이드 승인완료: guides/{uid} 존재하면 승인으로 간주
  if (guidesDoc) return true;

  // 2) users.status
  if (normalizeStatus(usersDoc?.status) === "approved") return true;

  // 3) guideApplications.status
  if (normalizeStatus(appDoc?.status) === "approved") return true;

  return false;
}

async function saveFamilyApplication(uid, email, preserveApproved) {
  const intro = String($("intro")?.value || "").trim();
  const phone = normalizePhone($("phone")?.value);
  const kakaoId = String($("kakaoId")?.value || "").trim();
  const agreeKakao = Boolean($("agreeKakao")?.checked);
  const walletAddress = String($("walletAddress")?.value || "").trim();
  const region = String($("region")?.value || "").trim();
  const career = String($("career")?.value || "").trim();
  const detail = String($("detail")?.value || "").trim();

  if (phone && !isValidPhone(phone)) {
    throw new Error("연락처(전화번호)가 올바르지 않습니다. 숫자 10자리 이상을 입력해 주세요.");
  }

  const profile = { intro, phone, kakaoId, agreeKakao, walletAddress, region, career, detail };

  const statusToWrite = preserveApproved ? "approved" : "pending";

  // 1) 관리자 승인 화면이 보는 곳: guideApplications/{uid}
  await setDoc(doc(db, "guideApplications", uid), {
    role: "family",
    status: statusToWrite,
    email: email || "",
    profile,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });

  // 2) 내 프로필 유지: users/{uid}
  await setDoc(doc(db, "users", uid), {
    role: "family",
    status: statusToWrite,
    profile,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });
}

function bindEvents(uid, email, preserveApproved) {
  const form = $("applyForm");
  const btnSave = $("btnSave");

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      setState("저장 중...");
      await saveFamilyApplication(uid, email, preserveApproved);
      setState("저장 완료");

      if (preserveApproved) {
        showStatus("이미 승인된 조합원입니다. 정보가 업데이트되었습니다.", "ok");
      } else {
        showStatus("조합원 신청이 접수되었습니다. 관리자 승인 화면에서 확인 가능합니다.", "ok");
      }
    } catch (err) {
      console.error(err);
      setState("저장 실패");
      showStatus(err?.message || "저장 중 오류가 발생했습니다.", "danger");
    }
  };

  if (form) form.addEventListener("submit", onSubmit);
  if (btnSave) btnSave.addEventListener("click", onSubmit);
}

// ── 멘토 이메일 등록 (linkMentor) ─────────────────────────────────────────
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

  // 이미 연결된 주소 조회 (mentors/{email} 은 로그인 유저 읽기 허용)
  try {
    const snap = await getDoc(doc(db, "mentors", email.toLowerCase()));
    if (snap.exists()) {
      const addr = snap.data()?.address || "";
      const box  = $("mentorCurrentBox");
      const addrEl = $("mentorCurrentAddr");
      if (box)    box.style.display = "";
      if (addrEl) addrEl.textContent = addr;
    }
  } catch (_) {
    // 읽기 실패해도 무시
  }

  const btn = $("btnLinkMentor");
  if (!btn) return;

  btn.onclick = async () => {
    if (!window.ethereum) {
      showMentorMsg("MetaMask가 설치되어 있지 않습니다.", "danger");
      return;
    }

    btn.disabled = true;
    btn.textContent = "서명 중...";

    try {
      // 1) 지갑 연결
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address  = accounts[0];

      // 2) 메시지 서명 (EIP-191 / personal_sign)
      const msg    = `Jump Platform 멘토 등록\nEmail: ${email.toLowerCase()}`;
      const msgHex = "0x" + Array.from(new TextEncoder().encode(msg))
        .map((b) => b.toString(16).padStart(2, "0")).join("");

      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [msgHex, address],
      });

      // 3) Cloud Function 호출 (onRequest + cors:true → 모든 오리진 허용)
      const idToken  = await auth.currentUser.getIdToken();
      const region   = "us-central1";
      const project  = app.options.projectId;
      const fnUrl    = `https://${region}-${project}.cloudfunctions.net/linkMentor`;

      const resp = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({ address, signature }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "서버 오류");

      // 4) 성공 표시
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

// 핵심: loggedIn/loggedin 호환
onAuthReady(async (ctx) => {
  const loggedIn = (ctx?.loggedIn ?? ctx?.loggedin) === true;
  const user = ctx?.user;

  if (!loggedIn || !user) {
    setState("로그인이 필요합니다.");
    showForm(false);
    showStatus("Google 로그인 후 다시 시도해 주세요.", "warn");
    return;
  }

  try {
    setState("내 정보 불러오는 중...");
    showForm(true);

    // 예전 가이드(승인완료) 판정까지 포함해서 읽기
    const [guidesDoc, usersDoc, appDoc] = await Promise.all([
      readDoc("guides", user.uid),
      readDoc("users", user.uid),
      readDoc("guideApplications", user.uid),
    ]);

    const approved = isApprovedByDocs({ guidesDoc, usersDoc, appDoc });

    // 프로필 우선순위: guideApplications -> users -> guides
    const p = extractProfile(appDoc) || extractProfile(usersDoc) || extractProfile(guidesDoc);

    if (p) fillForm(p);

    if (approved) {
      showStatus("이미 승인된 조합원입니다. 정보만 수정/저장하면 됩니다.", "ok");
      setState("승인 완료 (정보 수정 가능)");
    } else {
      showStatus("입력 후 저장해 주세요. 저장 후 관리자 승인 상태가 됩니다.", "info");
      setState("입력 후 저장해 주세요.");
    }

    // 승인완료면 status를 pending으로 덮어쓰지 않게 preserveApproved=true
    bindEvents(user.uid, user.email, approved);

    // 멘토 이메일 등록 패널
    initMentorLink(user.email);
  } catch (e) {
    console.error(e);
    setState("오류");
    showForm(true);
    showStatus("내 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.", "danger");
  }
});
