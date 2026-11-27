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
  collection,
  query,
  where,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ── 내 가맹점 이름 + AI 경영지원(BestERP) 바로가기 (2026-11-27) ─────────
// 가맹점 주인(ownerUid/ownerEmail) 또는 merchant_members 에 등록된 직원에게만 표시한다.
const BESTERP_DASHBOARD = "https://besterp.netlify.app/admin/dashboard.html";
let _myStoreSeq = 0;

function renderMyStore(store) {
  const chip = document.getElementById("myStoreChip");
  const nav = document.getElementById("navAiErp");
  if (!store) {
    if (chip) { chip.style.display = "none"; chip.textContent = ""; }
    if (nav) nav.style.display = "none";
    return;
  }
  // as=<uid>: BestERP 에 다른 계정이 로그인돼 있으면 계정을 바꿀지 묻게 한다 (BestERP auth.js)
  const url = `${BESTERP_DASHBOARD}?store=${encodeURIComponent(store.id)}${store.uid ? `&as=${encodeURIComponent(store.uid)}` : ""}`;
  if (chip) {
    chip.href = url;
    const roleTxt = store.isOwner ? "" : " · 스태프";
    chip.textContent = `🏪 ${store.name}${roleTxt}`;
    chip.title = `${store.name} (${store.isOwner ? "대표(오너)" : "스태프"}) · AI 경영지원 (BestERP) 열기`;
    chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;padding:4px 10px;border-radius:999px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border:1px solid #c7d2fe;color:#3730a3;font-size:0.8rem;font-weight:800;text-decoration:none;";
  }
  if (nav) {
    nav.href = url;
    nav.textContent = `🧠 AI 경영지원 (BestERP) · ${store.name}${store.isOwner ? "" : " (스태프)"}`;
    nav.style.display = "";
  }
}

async function loadMyStore(profile) {
  const seq = ++_myStoreSeq;
  renderMyStore(null);
  const uid = profile?.uid;
  if (!uid) return;
  const email = String(profile.email || "").toLowerCase();
  const nameOf = (m) => String(m?.name || m?.merchantName || m?.storeName || "").trim();
  try {
    let found = null;
    const uSnap = await getDoc(doc(db, "users", uid));
    const u = uSnap.exists() ? uSnap.data() : {};
    const mid = String(u.merchantId || u.tenantId || "").trim();
    if (mid) {
      const mSnap = await getDoc(doc(db, "merchants", mid));
      if (mSnap.exists()) {
        const m = mSnap.data();
        const isOwner = (m.ownerUid && m.ownerUid === uid)
          || (!m.ownerUid && email && String(m.ownerEmail || "").toLowerCase() === email);
        let isMember = false;
        if (!isOwner && email) {
          try {
            const mm = await getDoc(doc(db, "merchant_members", `${email}_${mid}`));
            isMember = mm.exists() && (mm.data().status || "active") === "active";
          } catch (_) {}
        }
        if ((isOwner || isMember) && nameOf(m)) found = { id: mid, name: nameOf(m), uid, isOwner };
      }
    }
    if (!found) {
      const q = await getDocs(query(collection(db, "merchants"), where("ownerUid", "==", uid), limit(1)));
      q.forEach((d) => { if (!found && nameOf(d.data())) found = { id: d.id, name: nameOf(d.data()), uid, isOwner: true }; });
    }
    if (seq === _myStoreSeq) renderMyStore(found);
  } catch (e) {
    if (seq === _myStoreSeq) renderMyStore(null);
  }
}

function isInAppBrowser() {
  const ua = (navigator.userAgent || "").toLowerCase();
  return ua.includes("kakaotalk") || ua.includes("instagram") || ua.includes("fbav") || ua.includes("fban") || ua.includes("line");
}

// ── Jump 원클릭 SSO: 팝업으로 열린 경우 로그인 완료 후 opener에 전달 ──
const _SSO_ALLOWED = [
  'https://bestclubvn.netlify.app',
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
          id: profile.uid,
          loginId: profile.email || profile.uid,
          name: profile.displayName || '',
          email: profile.email || '',
          avatar: profile.photoURL || null,
          role,
        },
        token,
      },
      openerOrigin
    );
    setTimeout(() => window.close(), 300);
  } catch (e) {
    console.warn('SSO notify failed:', e);
  }
}

function openExternalBrowser() {
  const url = location.href;
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    const noScheme = url.replace(/^https?:\/\//i, "");
    location.href = `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`;
    return;
  }

  if (isIOS) {
    const noScheme = url.replace(/^https?:\/\//i, "");
    location.href = `x-safari-https://${noScheme}`;
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function applyRoleToMenu(role) {
  const badge = document.getElementById("roleBadge");
  if (badge) {
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
  nodes.forEach((node) => {
    const rule = (node.getAttribute("data-role") || "").trim();
    if (!rule) {
      show(node, true);
      return;
    }
    const allow = rule.split(/\s+/).includes(role);
    show(node, allow);
  });
}

function initNavGroups() {
  const groups = document.querySelectorAll("#hdrNav .nav-group");

  function setOpen(group, on) {
    const btn = group.querySelector(".nav-group-title");
    group.classList.toggle("open", on);
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function setSubOpen(sub, on) {
    const btn = sub.querySelector(".nav-sub-title");
    sub.classList.toggle("open", on);
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  groups.forEach((g) => {
    const btn = g.querySelector(".nav-group-title");
    if (!btn) return;

    btn.addEventListener("click", (e) => {
      const menu = g.querySelector(".nav-group-menu, .dropdown-menu");
      if (!menu) return; // 하위 메뉴가 없다면 버튼이 아닌 링크이므로 일반 이동 허용
      e.preventDefault();
      e.stopPropagation();
      const willOpen = !g.classList.contains("open");
      groups.forEach((other) => setOpen(other, false));
      setOpen(g, willOpen);
    });

    g.querySelectorAll(".nav-sub-group").forEach((sub) => {
      const subBtn = sub.querySelector(".nav-sub-title");
      if (!subBtn) return;
      subBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !sub.classList.contains("open");
        g.querySelectorAll(".nav-sub-group").forEach((s) => setSubOpen(s, false));
        setSubOpen(sub, willOpen);
      });
    });
  });

  document.addEventListener("click", (e) => {
    const nav = document.getElementById("hdrNav");
    if (!nav) return;
    if (nav.contains(e.target)) return;
    groups.forEach((g) => setOpen(g, false));
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
  } catch (e) {
    applyMemberBadge(false);
    applyMemberJoinLink(false);
  }
}

function applyUserBadge(profile) {
  const el = document.getElementById("userBadge");
  if (!el) return;
  if (!profile) {
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

function initHamburger() {
  if (window.__pg_burger_bound) return;

  const header = document.getElementById("siteHeaderBar");
  const btn = document.getElementById("btnBurger");
  const nav = document.getElementById("hdrNav");
  const backdrop = document.getElementById("hdrNavBackdrop");

  if (!header || !btn || !nav) return;

  window.__pg_burger_bound = true;

  function setBodyLock(on) {
    document.body.classList.toggle("nav-open", on);
  }

  function openMenu() {
    header.classList.add("nav-open");
    btn.setAttribute("aria-expanded", "true");
    if (backdrop) backdrop.hidden = false;
    setBodyLock(true);
  }

  function closeMenu() {
    header.classList.remove("nav-open");
    btn.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.hidden = true;
    setBodyLock(false);

    const groups = document.querySelectorAll("#hdrNav .nav-group");
    groups.forEach((g) => {
      g.classList.remove("open");
      const title = g.querySelector(".nav-group-title");
      if (title) title.setAttribute("aria-expanded", "false");
    });
  }

  function toggleMenu() {
    header.classList.contains("nav-open") ? closeMenu() : openMenu();
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

  if (backdrop) {
    backdrop.addEventListener("click", closeMenu);
  }

  nav.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (e) => {
    if (!header.classList.contains("nav-open")) return;
    if (!header.contains(e.target)) closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 861px)").matches) {
      closeMenu();
    }
  });
}

async function bindHeader() {
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const nav = document.getElementById("hdrNav");

  if (!btnLogin && !btnLogout && !nav) return;
  if (window.__pg_hdr_bound) return;
  window.__pg_hdr_bound = true;

  await handleRedirectResult();

  if (btnLogout) {
    btnLogout.onclick = async () => {
      try { await logout(); } catch (e) { console.warn(e); }
    };
  }

  initHamburger();
  initNavGroups();

  applyRoleToMenu("guest");
  show(btnLogin, true);
  show(btnLogout, false);

  watchAuth(({ loggedIn, role, profile, user }) => {
    try {
      const isFullyRegistered = loggedIn && role !== "guest";
      show(btnLogin, !isFullyRegistered);
      show(btnLogout, isFullyRegistered);
      applyRoleToMenu(role || (isFullyRegistered ? "user" : "guest"));
      applyUserBadge(isFullyRegistered ? profile : null);
      if (isFullyRegistered && profile?.uid) loadMyStore(profile); else { _myStoreSeq++; renderMyStore(null); }

      if (!loggedIn) { applyMemberBadge(false); applyMemberJoinLink(false); }
      if (loggedIn && profile?.uid) {
        if (role === "admin") {
          applyMemberBadge(true);
          applyMemberJoinLink(false);
        } else {
          checkMembership(profile.uid);
        }
      }

      if (loggedIn && user) {
        notifyOpenerIfPopup(user, role, profile);
        return;
      }

      if (loggedIn && role === "user" && profile?.uid) {
        checkRegistration(profile.uid);
      }
    } catch (e) {
      console.error("watchAuth Error:", e);
    }
  });
}


async function checkRegistration(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists() && snap.data()?.name) {
      const badge = document.getElementById("roleBadge");
      if (badge) badge.textContent = "일반";
      return;
    }
  } catch (e) {
    console.warn("checkRegistration:", e?.message || e);
  }
  showRegisterNotice();
}

function showRegisterNotice() {
  if (location.pathname.includes("register")) return;
  if (document.getElementById("registerNotice")) return;

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
  if (header && header.nextSibling) {
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

