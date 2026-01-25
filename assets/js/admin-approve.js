// /assets/js/admin-approve.js
import { onAuthReady } from "/assets/js/auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db } from "/assets/js/firebase-init.js";


function $(id) {
  return document.getElementById(id);
}

const adminState = $("adminState");
const guideList = $("guideList");
const itemList = $("itemList");

const btnReloadGuides = $("btnReloadGuides");
const btnReloadItems = $("btnReloadItems");
const selItemStatus = $("selItemStatus");

const btnTabGuides = $("btnTabGuides");
const btnTabItems = $("btnTabItems");
const tabGuides = $("tabGuides");
const tabItems = $("tabItems");
const itemsFilter = $("itemsFilter");

const dlg = $("dlgDetail");
const dlgTitle = $("dlgTitle");
const dlgBody = $("dlgBody");
const dlgClose = $("dlgClose");

let isAdminUser = false;

function qs(name){
  return new URLSearchParams(location.search).get(name);
}

function setState(msg) {
  if (adminState) adminState.textContent = msg || "";
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmt(v) {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string" && v.trim() === "") return "-";
  if (typeof v === "object") {
    if (typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return d.toISOString().replace("T", " ").slice(0, 19);
    }
  }
  return String(v);
}

function pretty(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function openDialog(title, obj) {
  if (!dlg) return;
  dlgTitle.textContent = title || "상세";
  dlgBody.textContent = pretty(obj);
  dlg.showModal();
}

dlgClose?.addEventListener("click", () => dlg?.close());
dlg?.addEventListener("click", (e) => {
  const rect = dlg.querySelector(".dlg-box")?.getBoundingClientRect();
  if (!rect) return;
  const x = e.clientX,
    y = e.clientY;
  const inside =
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom;
  if (!inside) dlg.close();
});

function cardWrap(html) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = html;
  return el;
}

function kvGrid(uid, v) {
  const rows = [
    ["신청자 UID", uid],
    ["이름", v.name || v.displayName],
    ["이메일", v.email],
    ["전화", v.phone || v.tel],
    ["카카오", v.kakao || v.kakaoId],
    ["국가/지역", v.country || v.region],
    ["활동지역", v.area],
    ["지갑주소(HEX 정산)", v.walletAddress || v.profile?.walletAddress],
    ["소개", v.bio || v.intro],
    ["포트폴리오", v.portfolio || v.site],
    ["SNS", v.sns],
    ["메모", v.memo],
    ["createdAt", v.createdAt],
    ["updatedAt", v.updatedAt],
  ];

  const html = rows
    .map(
      ([k, val]) => `
      <div class="k">${esc(k)}</div>
      <div class="v">${esc(fmt(val))}</div>
    `
    )
    .join("");

  return `<div class="kv">${html}</div>`;
}

function pickWalletAddress(v) {
  const w =
    (typeof v?.walletAddress === "string" && v.walletAddress.trim()) ||
    (typeof v?.profile?.walletAddress === "string" &&
      v.profile.walletAddress.trim()) ||
    "";
  return w || "";
}

async function loadGuideApplications() {
  if (!guideList) return;

  guideList.innerHTML = "";
  setState("가이드 신청 목록 로딩중…");

  const snap = await getDocs(collection(db, "guideApplications"));
  if (snap.empty) {
    setState("가이드 신청 없음");
    return;
  }

  setState(`가이드 신청 ${snap.size}건`);
  snap.forEach((d) => {
    const v = d.data();
    const uid = d.id;

    const title = v.name || v.displayName || uid;
    const sub = [v.email, v.phone || v.tel, v.area].filter(Boolean).join(" · ");

    const el = cardWrap(`
      <details class="expander" data-uid="${esc(uid)}">
        <summary>
          <div class="sum-left">
            <div class="sum-title">${esc(title)}</div>
            <div class="sum-sub">${esc(sub || "신청 상세를 펼쳐 확인하세요")}</div>
          </div>
          <div class="sum-right">
            <span class="badge">uid: ${esc(uid.slice(0, 6))}…</span>
            <button class="btn btn-sm" type="button" data-act="viewGuide" data-uid="${esc(uid)}">상세(JSON)</button>
            <button class="btn btn-sm" type="button" data-act="approveGuide" data-uid="${esc(uid)}">승인</button>
            <button class="btn btn-sm" type="button" data-act="rejectGuide" data-uid="${esc(uid)}">반려(삭제)</button>
          </div>
        </summary>

        <div class="expander-body">
          ${kvGrid(uid, v)}
          <div class="row-actions">
            <button class="btn btn-sm" type="button" data-act="approveGuide" data-uid="${esc(uid)}">승인</button>
            <button class="btn btn-sm" type="button" data-act="rejectGuide" data-uid="${esc(uid)}">반려(삭제)</button>
          </div>
        </div>
      </details>
    `);

    guideList.appendChild(el);
  });
}

async function approveGuide(uid) {
  if (!isAdminUser) {
    alert("관리자 권한이 없습니다. (admins/{내 uid} 문서 확인 필요)");
    return;
  }

  const appRef = doc(db, "guideApplications", uid);
  const appSnap = await getDoc(appRef);
  if (!appSnap.exists()) {
    alert("신청서를 찾을 수 없습니다.");
    return;
  }

  const v = appSnap.data();
  const walletAddress = pickWalletAddress(v);

  // guides/{uid} 문서 생성/병합 (create/update 둘 다 가능)
  const guideRef = doc(db, "guides", uid);
  await setDoc(
    guideRef,
    {
      ...v,
      uid,
      approved: true,
      walletAddress, // 요구사항: guides/{uid}.walletAddress
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // users/{uid}는 rules상 "본인만" 수정 가능이라 여기서 건드리면 permission-denied 남
  // role SSOT는 admins + guides.approved 로 처리

  await deleteDoc(appRef);

  alert("승인 완료");
  await loadGuideApplications();
}

async function rejectGuide(uid) {
  if (!isAdminUser) {
    alert("관리자 권한이 없습니다.");
    return;
  }

  const ok = confirm("반려(삭제) 하시겠습니까?");
  if (!ok) return;

  await deleteDoc(doc(db, "guideApplications", uid));
  alert("삭제 완료");
  await loadGuideApplications();
}

async function loadItemsByStatus(status) {
  if (!itemList) return;

  itemList.innerHTML = "";
  setState(`items status=${status} 로딩중…`);

  const q = query(collection(db, "items"), where("status", "==", status));
  const snap = await getDocs(q);

  if (snap.empty) {
    setState(`items status=${status} 없음`);
    return;
  }

  setState(`items status=${status} ${snap.size}건`);
  snap.forEach((d) => {
    const v = d.data();
    const id = d.id;

    const el = cardWrap(`
      <details class="expander" data-item="${esc(id)}">
        <summary>
          <div class="sum-left">
            <div class="sum-title">${esc(v.title || "(제목없음)")}</div>
            <div class="sum-sub">${esc([v.category, v.region, "owner:" + (v.ownerUid || "-")].filter(Boolean).join(" · "))}</div>
          </div>
          <div class="sum-right">
            <span class="badge">status: ${esc(v.status || "-")}</span>
            <button class="btn btn-sm" type="button" data-act="viewItem" data-id="${esc(id)}">상세(JSON)</button>
            <a class="btn btn-sm" href="/product_edit.html?id=${esc(id)}&from=admin" target="_blank" rel="noopener">수정</a>
            ${
              (status === "pending" && isAdminUser)
                ? `<button class="btn btn-sm" type="button" data-act="approveItem" data-id="${esc(id)}">승인</button>`
                : ""
            }
          </div>
        </summary>
        <div class="expander-body">
          <div class="kv">
            <div class="k">itemId</div><div class="v">${esc(id)}</div>
            <div class="k">title</div><div class="v">${esc(fmt(v.title))}</div>
            <div class="k">status</div><div class="v">${esc(fmt(v.status))}</div>
            <div class="k">price</div><div class="v">${esc(fmt(v.price))}</div>
            <div class="k">ownerUid</div><div class="v">${esc(fmt(v.ownerUid))}</div>
            <div class="k">guideUid</div><div class="v">${esc(fmt(v.guideUid))}</div>
            <div class="k">createdAt</div><div class="v">${esc(fmt(v.createdAt))}</div>
          </div>
          <div class="row-actions">
            <a class="btn btn-sm" href="/product_edit.html?id=${esc(id)}&from=admin" target="_blank" rel="noopener">수정</a>
          </div>
        </div>
      </details>
    `);

    itemList.appendChild(el);
  });
}

async function approveItem(id) {
  if (!isAdminUser) {
    alert("관리자 권한이 없습니다.");
    return;
  }

  const ok = confirm("이 상품을 published로 승인할까요?");
  if (!ok) return;

  try {
    await updateDoc(doc(db, "items", id), {
      status: "published",
      updatedAt: serverTimestamp(),
    });

    alert("승인 완료");
    await loadItemsByStatus(selItemStatus?.value || "pending");
  } catch (err) {
    console.error("approveItem failed", err);
    const msg = (err && (err.code || err.message)) ? `${err.code || ""} ${err.message || ""}`.trim() : "unknown error";
    alert("승인 실패: " + msg);
  }
}

function showTab(which) {
  const isGuides = which === "guides";
  if (tabGuides) tabGuides.style.display = isGuides ? "" : "none";
  if (tabItems) tabItems.style.display = isGuides ? "none" : "";
  if (itemsFilter) itemsFilter.style.display = isGuides ? "none" : "";
  btnTabGuides?.classList.toggle("is-active", isGuides);
  btnTabItems?.classList.toggle("is-active", !isGuides);
}

async function checkAdmin(user) {
  // 운영자 이메일 allowlist (부트스트랩)
  if (user?.email && String(user.email).toLowerCase() === "daguri75@gmail.com") {
    return true;
  }

  const a = await getDoc(doc(db, "admins", user.uid));
  return a.exists();
}

async function bootAdmin(user) {
  isAdminUser = await checkAdmin(user);
  if (!isAdminUser) {
    setState("관리자 권한 없음 (admins/{내 uid} 문서 필요)");
    showTab("guides");
    if (guideList) guideList.innerHTML = "";
    if (itemList) itemList.innerHTML = "";
    return;
  }

  setState("관리자 로그인 확인됨");
    // deep-link 지원: /admin.html?tab=items&status=pending
  const tab = (qs("tab") || "guides").toLowerCase();
  const status = (qs("status") || "").toLowerCase();
  if (status && selItemStatus){
    const ok = Array.from(selItemStatus.options || []).some(o=>String(o.value).toLowerCase()===status);
    if(ok) selItemStatus.value = status;
  }

  showTab(tab === "items" ? "items" : "guides");

  if (tab === "items") {
    await loadItemsByStatus(selItemStatus?.value || "pending");
  } else {
    await loadGuideApplications();
  }
}

guideList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;

  const act = btn.dataset.act;
  const uid = btn.dataset.uid;

  try {
    if (act === "approveGuide") {
      await approveGuide(uid);
    } else if (act === "rejectGuide") {
      await rejectGuide(uid);
    } else if (act === "viewGuide") {
      const snap = await getDoc(doc(db, "guideApplications", uid));
      if (!snap.exists()) return alert("신청서를 찾을 수 없습니다.");
      openDialog("가이드 신청 상세(JSON)", { uid, ...snap.data() });
    }
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});

itemList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;

  const act = btn.dataset.act;
  const id = btn.dataset.id;

  try {
    if (act === "approveItem") {
      await approveItem(id);
    } else if (act === "viewItem") {
      const snap = await getDoc(doc(db, "items", id));
      if (!snap.exists()) return alert("상품을 찾을 수 없습니다.");
      openDialog("상품 상세(JSON)", { id, ...snap.data() });
    }
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});

btnReloadGuides?.addEventListener("click", () => loadGuideApplications());
btnReloadItems?.addEventListener("click", () =>
  loadItemsByStatus(selItemStatus?.value || "pending")
);
selItemStatus?.addEventListener("change", () =>
  loadItemsByStatus(selItemStatus.value)
);

btnTabGuides?.addEventListener("click", () => showTab("guides"));
btnTabItems?.addEventListener("click", () => showTab("items"));

onAuthReady(async ({ loggedIn, user }) => {
  if (!loggedIn || !user) {
    setState("로그인 필요");
    return;
  }
  await bootAdmin(user);
});
