// /assets/js/header-auth.js
import {
  handleRedirectResult,
  logout,
  watchAuth,
  db,
} from "./auth.js";

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function isInAppBrowser(){
  const ua = (navigator.userAgent || "").toLowerCase();
  return ua.includes("kakaotalk") || ua.includes("instagram") || ua.includes("fbav") || ua.includes("fban") || ua.includes("line");
}

// ── Jump 원클릭 SSO: 팝업으로 열린 경우 로그인 완료 후 opener에 전달 ──
const _SSO_ALLOWED = [
  'https://zenyentu.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
];
let _ssoNotified = false;

async function notifyOpenerIfPopup(firebaseUser, role, profile) {
  if (_ssoNotified) return;
  if (!window.opener || window.opener.closed) return;

  let openerOrigin;
  try { openerOrigin = window.opener.origin; } catch { return; }
  if (!_SSO_ALLOWED.includes(openerOrigin)) return;

  _ssoNotified = true;
  try {
    const token = await firebaseUser.getIdToken();
    window.opener.postMessage(
      {
        type: 'jump_auth',
        user: {
          id:      profile.uid,
          loginId: profile.email || profile.uid,
          name:    profile.displayName || '',
          email:   profile.email || '',
          avatar:  profile.photoURL  || null,
          role,
        },
        token,
      },
      openerOrigin
    );
    setTimeout(() => window.close(), 300);
  } catch(e) {
    console.warn('SSO notify failed:', e);
  }
}

function openExternalBrowser(){
  const url = location.href;
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if(isAndroid){
    const noScheme = url.replace(/^https?:\/\//i, "");
    location.href = `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`;
    return;
  }

  if(isIOS){
    const noScheme = url.replace(/^https?:\/\//i, "");
    location.href = `x-safari-https://${noScheme}`;
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
function show(el, on){
  if(!el) return;
  el.style.display = on ? "" : "none";
}

function applyRoleToMenu(role){
  const badge = document.getElementById("roleBadge");
  if(badge){
    const text =
      role === "admin" ? "관리자" :
      role === "guide" ? "판매자" :
      role === "merchant" ? "가맹점" :
      role === "user" ? "일반" :
      "게스트";
    badge.textContent = text;
    show(badge, role !== "guest");
  }

  const nodes = document.querySelectorAll("#hdrNav [data-role]");
  nodes.forEach((node)=>{
    const rule = (node.getAttribute("data-role") || "").trim();
    if(!rule){
      show(node, true);
      return;
    }
    const allow = rule.split(/\s+/).includes(role);
    show(node, allow);
  });
}

function initNavGroups(){
  const groups = document.querySelectorAll("#hdrNav .nav-group");

  function setOpen(group, on){
    const btn = group.querySelector(".nav-group-title");
    group.classList.toggle("open", on);
    if(btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function setSubOpen(sub, on){
    const btn = sub.querySelector(".nav-sub-title");
    sub.classList.toggle("open", on);
    if(btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  groups.forEach((g)=>{
    const btn = g.querySelector(".nav-group-title");
    if(!btn) return;

    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const willOpen = !g.classList.contains("open");
      groups.forEach((other)=> setOpen(other, false));
      setOpen(g, willOpen);
    });

    g.querySelectorAll(".nav-sub-group").forEach((sub)=>{
      const subBtn = sub.querySelector(".nav-sub-title");
      if(!subBtn) return;
      subBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !sub.classList.contains("open");
        g.querySelectorAll(".nav-sub-group").forEach((s)=> setSubOpen(s, false));
        setSubOpen(sub, willOpen);
      });
    });
  });

  document.addEventListener("click", (e)=>{
    const nav = document.getElementById("hdrNav");
    if(!nav) return;
    if(nav.contains(e.target)) return;
    groups.forEach((g)=> setOpen(g, false));
  });
}

function applyMemberBadge(isMember) {
  const el = document.getElementById("memberBadge");
  if (!el) return;
  show(el, !!isMember);
}

function applyMemberJoinLink(visible) {
  const el = document.getElementById("memberJoinLink");
  if (!el) return;
  show(el, !!visible);
}

async function checkMembership(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) { applyMemberBadge(false); applyMemberJoinLink(true); return; }
    const until = snap.data()?.coopMemberUntil;
    const isMember = !!until && until.toDate() > new Date();
    applyMemberBadge(isMember);
    applyMemberJoinLink(!isMember);
  } catch(e) {
    applyMemberBadge(false);
    applyMemberJoinLink(false);
  }
}

function applyUserBadge(profile){
  const el = document.getElementById("userBadge");
  if(!el) return;
  if(!profile){
    el.textContent = "";
    el.title = "";
    show(el, false);
    return;
  }
  const id = profile.email || profile.displayName || profile.uid || "";
  el.textContent = id;
  el.title = `uid: ${profile.uid}${profile.email ? `\nemail: ${profile.email}` : ""}`;
  show(el, true);
}

function initHamburger(){
  if(window.__pg_burger_bound) return;

  const header = document.getElementById("siteHeaderBar");
  const btn = document.getElementById("btnBurger");
  const nav = document.getElementById("hdrNav");
  const backdrop = document.getElementById("hdrNavBackdrop");

  if(!header || !btn || !nav) return;

  window.__pg_burger_bound = true;

  function setBodyLock(on){
    document.body.classList.toggle("nav-open", on);
  }

  function openMenu(){
    header.classList.add("nav-open");
    btn.setAttribute("aria-expanded", "true");
    if(backdrop) backdrop.hidden = false;
    setBodyLock(true);
  }

  function closeMenu(){
    header.classList.remove("nav-open");
    btn.setAttribute("aria-expanded", "false");
    if(backdrop) backdrop.hidden = true;
    setBodyLock(false);

    const groups = document.querySelectorAll("#hdrNav .nav-group");
    groups.forEach((g)=>{
      g.classList.remove("open");
      const title = g.querySelector(".nav-group-title");
      if(title) title.setAttribute("aria-expanded", "false");
    });
  }

  function toggleMenu(){
    header.classList.contains("nav-open") ? closeMenu() : openMenu();
  }

  btn.addEventListener("click", (e)=>{
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

  if(backdrop){
    backdrop.addEventListener("click", closeMenu);
  }

  nav.addEventListener("click", (e)=>{
    if(e.target && e.target.closest && e.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (e)=>{
    if(!header.classList.contains("nav-open")) return;
    if(!header.contains(e.target)) closeMenu();
  });

  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape") closeMenu();
  });

  window.addEventListener("resize", ()=>{
    if(window.matchMedia("(min-width: 861px)").matches){
      closeMenu();
    }
  });
}

async function bindHeader(){
  const btnLogin  = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const nav = document.getElementById("hdrNav");

  if(!btnLogin && !btnLogout && !nav) return;
  if(window.__pg_hdr_bound) return;
  window.__pg_hdr_bound = true;

  await handleRedirectResult();

  if(btnLogout){
    btnLogout.onclick = async ()=>{
      try{ await logout(); }catch(e){ console.warn(e); }
    };
  }

  initHamburger();
  initNavGroups();

  applyRoleToMenu("guest");
  show(btnLogin, true);
  show(btnLogout, false);

  watchAuth(({ loggedIn, role, profile, user })=>{
    show(btnLogin, !loggedIn);
    show(btnLogout, loggedIn);
    applyRoleToMenu(role || (loggedIn ? "user" : "guest"));
    applyUserBadge(loggedIn ? profile : null);

    if (!loggedIn) { applyMemberBadge(false); applyMemberJoinLink(false); }
    if (loggedIn && profile?.uid) { checkMembership(profile.uid); }

    if(loggedIn && user) {
      notifyOpenerIfPopup(user, role, profile);
      return;
    }

    if(loggedIn && role === "user" && profile?.uid){
      checkRegistration(profile.uid);
    }
  });
}

async function checkRegistration(uid){
  try{
    const snap = await getDoc(doc(db, "users", uid));
    if(snap.exists() && snap.data()?.name){
      const badge = document.getElementById("roleBadge");
      if(badge) badge.textContent = "일반";
      return;
    }
  }catch(e){
    console.warn("checkRegistration:", e?.message || e);
  }
  showRegisterNotice();
}

function showRegisterNotice(){
  if(location.pathname.includes("register")) return;
  if(document.getElementById("registerNotice")) return;

  const bar = document.createElement("div");
  bar.id = "registerNotice";
  bar.style.cssText = [
    "background:#ede9fe",
    "border-bottom:2px solid #c4b5fd",
    "padding:10px 16px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "gap:12px",
    "font-size:0.88rem",
    "position:sticky",
    "top:0",
    "z-index:998",
    "flex-wrap:wrap",
  ].join(";");

  bar.innerHTML = `
    <span style="color:#4c1d95;">구글 로그인은 완료되었지만 아직 <strong>회원가입</strong>이 완료되지 않았습니다.</span>
    <a href="/register.html"
       style="background:#7c3aed;color:#fff;border-radius:6px;padding:5px 16px;
              text-decoration:none;font-weight:600;white-space:nowrap;font-size:0.85rem;">
      회원가입 하러가기
    </a>
    <button type="button"
            onclick="document.getElementById('registerNotice').remove()"
            style="background:none;border:none;cursor:pointer;font-size:1.1rem;
                   color:#7c3aed;padding:0 4px;line-height:1;" aria-label="닫기">×</button>
  `;

  const header = document.getElementById("siteHeader");
  if(header && header.nextSibling){
    header.parentNode.insertBefore(bar, header.nextSibling);
  } else {
    document.body.prepend(bar);
  }
}

window.addEventListener("partials:mounted", bindHeader);
window.addEventListener("partials:loaded", bindHeader);
document.addEventListener("DOMContentLoaded", bindHeader);

bindHeader();
setTimeout(bindHeader, 250);

