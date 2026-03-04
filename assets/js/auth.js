// /assets/js/auth.js
// Firebase Auth + 역할(role) 판정 + 공통 헬퍼

import { auth, googleProvider, db } from "/assets/js/firebase-init.js";

import {
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export { auth, googleProvider, db };
export { onAuthStateChanged, signOut };

// 로그인 유지(persistence) 설정: 페이지 이동/새로고침에서도 로그인 상태가 유지되도록
// (일부 인앱 브라우저는 스토리지 제약이 있어 실패할 수 있으므로 try/catch)
try{
  await setPersistence(auth, browserLocalPersistence);
}catch(e){
  console.warn("setPersistence failed:", e?.code || e?.message || e);
}

function isInAppBrowser(){
  const ua = (navigator.userAgent || "").toLowerCase();
  // 카카오톡/인스타/페북 등 대표 인앱 브라우저
  return ua.includes("kakaotalk") || ua.includes("instagram") || ua.includes("fbav") || ua.includes("fban") || ua.includes("line");
}

// 로그인 (팝업 우선, 실패 시 리다이렉트)
// iOS Safari는 redirect 시 storage를 초기화해서 redirect 결과를 잃어버리는 경우가 많으므로
// 모바일 포함 모든 환경에서 팝업을 먼저 시도하고, 팝업이 차단된 경우에만 redirect로 폴백합니다.
export async function login(){
  // 카카오톡/인스타/페북 인앱 브라우저에서는 Google OAuth가 403(disallowed_useragent)로 차단될 수 있음
  if(isInAppBrowser()){
    const err = new Error("Google login blocked in in-app browser");
    err.code = "auth/inapp-browser";
    throw err;
  }

  try{
    await signInWithPopup(auth, googleProvider);
  }catch(e){
    const code = e?.code || "";
    // 사용자가 직접 팝업 창을 닫은 경우 → 재시도 안 함
    if(code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"){
      return;
    }
    // auth/unauthorized-domain, auth/popup-blocked 은 그대로 throw해서 호출자가 처리
    // (unauthorized-domain은 redirect도 실패하므로 폴백 불필요)
    // web-storage-unsupported 등 완전 미지원 환경만 redirect 시도
    const redirectLike =
      code === "auth/operation-not-supported-in-this-environment" ||
      code === "auth/web-storage-unsupported";
    if(redirectLike){
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    throw e;
  }
}

export async function handleRedirectResult(){
  try{
    await getRedirectResult(auth);
  }catch(e){
    console.warn("redirect result:", e?.code || e?.message || e);
  }
}

export function logout(){
  return signOut(auth);
}

// 역할 결정 규칙
// 1) admins/{uid} 있으면 그 role (기본 admin)
// 2) guides/{uid}.approved === true 이면 guide
// 3) users/{uid}.role 있으면 그 role
// 4) 로그인만 되어 있으면 user
export async function getUserRole(uid, email){
  if(!uid) return "guest";

  // 운영자 이메일은 admins 문서가 없어도 admin 취급
  if(typeof email === "string" && email && email.toLowerCase() === "daguri75@gmail.com"){
    return "admin";
  }

  // 1) admins
  try{
    const aRef = doc(db, "admins", uid);
    const aSnap = await getDoc(aRef);
    if(aSnap.exists()){
      const data = aSnap.data() || {};
      return data.role || "admin";
    }
  }catch(e){
    console.warn("admins read failed:", e?.code || e?.message || e);
  }

  // 2) guides/{uid} (승인된 가이드는 role=guide)
  try{
    const gRef = doc(db, "guides", uid);
    const gSnap = await getDoc(gRef);
    if(gSnap.exists()){
      const g = gSnap.data() || {};
      if(g.approved === true) return "guide";
    }
  }catch(e){
    console.warn("guides read failed:", e?.code || e?.message || e);
  }

  // 3) users + merchant 체크
  try{
    const uRef = doc(db, "users", uid);
    const uSnap = await getDoc(uRef);
    if(uSnap.exists()){
      const u = uSnap.data() || {};
      // 3-a) 가맹점 체크 (등록 완료 = active !== false)
      if(u.merchantId != null){
        try{
          const mRef = doc(db, "merchants", String(u.merchantId));
          const mSnap = await getDoc(mRef);
          if(mSnap.exists()){
            const m = mSnap.data() || {};
            if(m.active !== false) return "merchant";
          }
        }catch(me){
          console.warn("merchant read failed:", me?.code || me?.message || me);
        }
      }
      // 3-b) users.role 필드
      if(typeof u.role === "string" && u.role) return u.role;
    }
  }catch(e){
    console.warn("users read failed:", e?.code || e?.message || e);
  }

  return "user";
}

// 화면에서 쓰기 좋은 profile 오브젝트를 구성
export async function getUserProfile(user){
  if(!user) return null;
  const role = await getUserRole(user.uid, user.email || "");

  return {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    role,
  };
}

export function watchAuth(cb){
  return onAuthStateChanged(auth, async (user)=>{
    if(!user){
      cb({ loggedIn:false, role:"guest", user:null, profile:null });
      return;
    }

    const profile = await getUserProfile(user);
    cb({ loggedIn:true, role: profile?.role || "user", user, profile });
  });
}

// auth 상태 준비되면 1회 호출되는 헬퍼
export async function onAuthReady(cb){
  // redirect 로그인(특히 모바일)에서는 초기 콜백이 null로 한번 찍힌 뒤,
  // 잠시 후 user가 들어오는 케이스가 있습니다.
  // 기존처럼 "첫 콜백에서 바로 unsubscribe" 하면 guest로 고정되는 버그가 생깁니다.
  let unsub = null;
  let settled = false;
  let timer = null;

  // redirect 결과를 먼저 처리 (안 하면 일부 환경에서 user가 늦게 잡힘)
  try{
    await handleRedirectResult();
  }catch(e){
    // handleRedirectResult 내부에서 경고만 찍으므로 여기서는 무시
  }

  function done(payload){
    if(settled) return;
    settled = true;
    if(timer) clearTimeout(timer);
    if(unsub) unsub();
    cb(payload);
  }

  unsub = onAuthStateChanged(auth, async (user)=>{
    // user가 잡히면 즉시 완료
    if(user){
      const profile = await getUserProfile(user);
      done({ loggedIn:true, role: profile?.role || "user", user, profile });
      return;
    }

    // user가 아직 없으면 잠깐 더 기다렸다가 없을 때만 guest 처리
    if(!timer){
      timer = setTimeout(()=>{
        done({ loggedIn:false, role:"guest", user:null, profile:null });
      }, 1500);
    }
  });
}
