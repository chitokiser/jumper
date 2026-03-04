// /assets/js/header-auth.js
// 헤더의 로그인/로그아웃 + 역할별 메뉴 노출 + 모바일 햄버거

import {
  handleRedirectResult,
  login,
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

function show(el, on){
  if(!el) return;
  el.style.display = on ? "" : "none";
}

function applyRoleToMenu(role){
  const badge = document.getElementById("roleBadge");
  if(badge){
    const text =
      role === "admin"    ? "관리자" :
      role === "guide"    ? "조합원" :
      role === "merchant" ? "가맹점" :
      role === "user"     ? "비회원" :
      "게스트";
    badge.textContent = text;
    show(badge, role !== "guest");
  }

  // data-role이 있는 요소만 필터링. (a, div.nav-group 등)
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
  groups.forEach((g)=>{
    const btn = g.querySelector(".nav-group-title");
    if(!btn) return;

    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      // 다른 그룹 닫기
      groups.forEach((other)=>{
        if(other !== g) other.classList.remove("open");
      });
      g.classList.toggle("open");
    });
  });

  // 바깥 클릭시 닫기
  document.addEventListener("click", (e)=>{
    const nav = document.getElementById("hdrNav");
    if(!nav) return;
    if(nav.contains(e.target)) return;
    groups.forEach((g)=>g.classList.remove("open"));
  });
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

  if(!header || !btn || !nav) return;

  window.__pg_burger_bound = true;

  function openMenu(){
    header.classList.add("nav-open");
    btn.setAttribute("aria-expanded", "true");
  }

  function closeMenu(){
    header.classList.remove("nav-open");
    btn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu(){
    header.classList.contains("nav-open") ? closeMenu() : openMenu();
  }

  btn.addEventListener("click", (e)=>{
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

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
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const nav = document.getElementById("hdrNav");

  // partial이 아직 안 붙었으면 스킵 (다음 이벤트에서 재시도)
  if(!btnLogin && !btnLogout && !nav) return;

  // 중복 바인딩 방지
  if(window.__pg_hdr_bound) return;
  window.__pg_hdr_bound = true;

  // redirect 로그인 흐름 처리(모바일/팝업차단 대비)
  await handleRedirectResult();

  if(btnLogin){
    // 카카오톡 등 인앱브라우저에서는 Google 로그인이 차단되므로 안내 버튼으로 바꿔줌
    if(isInAppBrowser()){
      btnLogin.textContent = "브라우저에서 열기";
    }
    btnLogin.onclick = async ()=>{
      try{
        if(isInAppBrowser()){
          alert(
            "카카오톡/인스타/페이스북 같은 인앱브라우저에서는 Google 로그인이 차단될 수 있습니다.\n\n해결 방법:\n1) 우측 상단 메뉴(⋮) → '다른 브라우저로 열기'\n2) 또는 Chrome/Safari에서 jovialtravel.netlify.app 직접 접속\n\n(오류: 403 disallowed_useragent)"
          );
          return;
        }
        await login();
      }catch(e){
        const code = e?.code || "";
        // 카카오/인스타/페북 등 인앱브라우저에서 Google 로그인은 차단될 수 있습니다.
        if(code === "auth/inapp-browser" || code === "auth/operation-not-supported-in-this-environment"){
          alert(
            "카카오톡/인스타/페이스북 같은 인앱브라우저에서는 Google 로그인이 차단될 수 있습니다.\n\n해결 방법:\n1) 우측 상단 메뉴(⋮) → '다른 브라우저로 열기'\n2) 또는 Chrome/Safari에서 직접 jovialtravel.netlify.app 접속\n\n(오류: 403 disallowed_useragent)"
          );
          return;
        }
        console.warn(e);
      }
    };
  }

  if(btnLogout){
    btnLogout.onclick = async ()=>{
      try{ await logout(); }catch(e){ console.warn(e); }
    };
  }

  // 햄버거 바인딩 (partials 주입 후에만 가능)
  initHamburger();

  // 드롭다운 그룹 바인딩
  initNavGroups();

  // 기본은 guest 메뉴
  applyRoleToMenu("guest");
  show(btnLogin, true);
  show(btnLogout, false);

  watchAuth(({ loggedIn, role, profile })=>{
    show(btnLogin, !loggedIn);
    show(btnLogout, loggedIn);
    applyRoleToMenu(role || (loggedIn ? "user" : "guest"));
    applyUserBadge(loggedIn ? profile : null);

    if(loggedIn && role === "user" && profile?.uid){
      checkRegistration(profile.uid);
    }
  });
}

// users/{uid}.name 존재 여부로 회원가입 완료 여부 판정
// 완료 → 배지 "일반" + 안내 숨김 / 미완료 → 배지 "비회원" + 안내 표시
async function checkRegistration(uid){
  try{
    const snap = await getDoc(doc(db, "users", uid));
    if(snap.exists() && snap.data()?.name){
      // 등록 완료 회원: 배지 텍스트를 "일반"으로 교정
      const badge = document.getElementById("roleBadge");
      if(badge) badge.textContent = "일반";
      return; // 회원가입 안내 불필요
    }
  }catch(e){
    console.warn("checkRegistration:", e?.message || e);
  }
  // 미등록(name 없음) → 안내 표시
  showRegisterNotice();
}

function showRegisterNotice(){
  // register.html 자체에서는 표시 안 함
  if(location.pathname.includes("register")) return;
  // 이미 표시 중이면 중복 생성 방지
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
    <span style="color:#4c1d95;">구글 로그인은 됐지만 아직 <strong>회원가입</strong>이 완료되지 않았습니다.</span>
    <a href="/register.html"
       style="background:#7c3aed;color:#fff;border-radius:6px;padding:5px 16px;
              text-decoration:none;font-weight:600;white-space:nowrap;font-size:0.85rem;">
      회원가입 하기 →
    </a>
    <button type="button"
            onclick="document.getElementById('registerNotice').remove()"
            style="background:none;border:none;cursor:pointer;font-size:1.1rem;
                   color:#7c3aed;padding:0 4px;line-height:1;" aria-label="닫기">✕</button>
  `;

  const header = document.getElementById("siteHeader");
  if(header && header.nextSibling){
    header.parentNode.insertBefore(bar, header.nextSibling);
  } else {
    document.body.prepend(bar);
  }
}

// partials가 붙은 뒤에 바인딩
window.addEventListener("partials:mounted", bindHeader);
window.addEventListener("partials:loaded", bindHeader);
// 혹시 이벤트를 못 받았을 때를 대비
document.addEventListener("DOMContentLoaded", bindHeader);

// 일부 페이지는 partials.js가 defer 없이 먼저 실행되어(이벤트가 이미 지나감)
// 로그인/햄버거 바인딩이 누락될 수 있습니다. 즉시 1회 시도 + 짧은 재시도로 보강합니다.
bindHeader();
setTimeout(bindHeader, 250);
