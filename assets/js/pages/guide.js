// /assets/js/pages/guide.js
import { db } from "../auth.js";
import { onAuthReady, login } from "../auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "../firestore-bridge.js";

function $(id){ return document.getElementById(id); }
function show(el, on){ if(!el) return; el.style.display = on ? "" : "none"; }

async function loadApplication(uid){
  const ref = doc(db, "guideApplications", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() || {}) : null;
}

async function submitApplication(uid, payload){
  const ref = doc(db, "guideApplications", uid);
  await setDoc(ref, {
    uid,
    status: "pending",
    ...payload,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });
}

function setState(msg){
  const el = $("applyState");
  if(el) el.textContent = msg || "";
}

onAuthReady(async ({ loggedIn, role, user })=>{
  const guestSection = $("guestSection");
  const applySection = $("applySection");
  const approvedSection = $("approvedSection");
  const pendingBox = $("pendingBox");

  // 기본 숨김
  show(guestSection, false);
  show(applySection, false);
  show(approvedSection, false);
  show(pendingBox, false);

  // 게스트
  if(!loggedIn){
    show(guestSection, true);
    const btn = $("btnLoginHere");
    if(btn) btn.onclick = ()=> login();
    return;
  }

  // 이미 guide/admin이면 승인 완료 화면
  if(role === "guide" || role === "admin"){
    show(approvedSection, true);
    return;
  }

  // 일반 user: 신청서 화면
  show(applySection, true);

  // 기존 신청 상태 확인
  try{
    const app = await loadApplication(user.uid);
    if(app && app.status === "pending"){
      show(pendingBox, true);
      // 입력값 채우기(있으면)
      if(app.name) $("fName").value = app.name;
      if(app.phone) $("fPhone").value = app.phone;
      if(app.region) $("fRegion").value = app.region;
      if(app.exp) $("fExp").value = app.exp;
      if(app.bio) $("fBio").value = app.bio;
    }
  }catch(e){
    console.warn(e);
  }

  const form = $("applyForm");
  if(!form) return;

  form.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    setState("");

    const btn = $("btnSubmit");
    if(btn) btn.disabled = true;

    try{
      const payload = {
        name: ($("fName").value || "").trim(),
        phone: ($("fPhone").value || "").trim(),
        region: ($("fRegion").value || "").trim(),
        exp: ($("fExp").value || "").trim(),
        bio: ($("fBio").value || "").trim(),
      };

      if(!payload.name || !payload.region){
        alert("가이드명/활동 지역은 필수입니다.");
        return;
      }

      await submitApplication(user.uid, payload);
      show(pendingBox, true);
      setState("신청이 접수되었습니다.");
    }catch(err){
      console.error(err);
      alert("신청 저장 실패: " + (err?.message || String(err)));
    }finally{
      if(btn) btn.disabled = false;
    }
  });
});
