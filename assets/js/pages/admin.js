// /assets/js/pages/admin.js
import { onAuthReady } from "../auth.js";
import { isAdmin } from "../roles.js";
import { approveGuide, rejectGuide } from "../admin-approve.js";
import { auth, db } from "/assets/js/firebase-init.js";


import {
  collection,
  doc,
  query,
  where,
  limit,
  orderBy,
  getDocs,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Firestore Timestamp/ISO/없음 -> ms
function toMs(v){
  if(!v) return 0;
  if(typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  if(typeof v === "string"){
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

const $ = (s)=>document.querySelector(s);

const stateEl = $("#adminState");
const tabGuides = $("#tabGuides");
const tabItems = $("#tabItems");
const btnReload = $("#btnReload");

const guidesState = $("#listGuidesState");
const guidesList = $("#listGuides");

const itemsState = $("#listItemsState");
const itemsList = $("#listItems");

function setState(msg){ if(stateEl) stateEl.textContent = msg || ""; }

function show(el, on){ if(el) el.style.display = on ? "" : "none"; }

function setTab(which){
  const g = which === "guides";
  show(document.querySelector("#panelGuides"), g);
  show(document.querySelector("#panelItems"), !g);
  tabGuides?.classList.toggle("is-active", g);
  tabItems?.classList.toggle("is-active", !g);
}

function esc(s){
  return String(s || "").replace(/[&<>"]/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));
}

function tsToMs(v){
  if(!v) return 0;
  if(typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

async function listGuideApplications(){
  if(guidesState) guidesState.textContent = "로딩중...";
  if(guidesList) guidesList.innerHTML = "";

  const col = collection(db, "guideApplications");

  // 1차: 인덱스가 있으면 status+createdAt 정렬
  let snaps = null;
  try{
    const q1 = query(col, where("status","==","pending"), orderBy("createdAt","desc"), limit(100));
    snaps = await getDocs(q1);
  }catch(e){
    // 인덱스가 없으면 where만 하고 클라이언트에서 정렬
    if(e?.code === "failed-precondition"){
      const q2 = query(col, where("status","==","pending"), limit(300));
      snaps = await getDocs(q2);
    }else{
      throw e;
    }
  }

  const arr = [];
  snaps.forEach((d)=>{
    const x = d.data() || {};
    arr.push({ id:d.id, ...x, _t: tsToMs(x.createdAt) });
  });
  arr.sort((a,b)=>b._t-a._t);

  if(!arr.length){
    if(guidesState) guidesState.textContent = "대기중 신청이 없습니다.";
    return;
  }
  if(guidesState) guidesState.textContent = `${arr.length}건`;

  guidesList.innerHTML = arr.map((x)=>{
    return `
      <div class="admin-card" data-app="${esc(x.id)}">
        <div class="ac-top">
          <div class="ac-title">${esc(x.name || "(이름없음)")}</div>
          <div class="ac-sub">uid: ${esc(x.uid || x.id)}</div>
        </div>
        <div class="ac-body">
          <div class="ac-row"><span>지역</span><b>${esc(x.city || "-")}</b></div>
          <div class="ac-row"><span>연락처</span><b>${esc(x.phone || "-")}</b></div>
          <div class="ac-row"><span>소개</span><div class="ac-desc">${esc(x.intro || "")}</div></div>
        </div>
        <div class="ac-actions">
          <button class="btn btn--sm" data-action="approve-guide" data-id="${esc(x.id)}">승인</button>
          <button class="btn btn--sm btn--ghost" data-action="reject-guide" data-id="${esc(x.id)}">거절</button>
        </div>
      </div>
    `;
  }).join("");
}

async function listPendingItems(){
  if(itemsState) itemsState.textContent = "로딩중...";
  if(itemsList) itemsList.innerHTML = "";

  const col = collection(db, "items");

  // where + orderBy 조합은 복합 인덱스가 필요할 수 있어,
  // 운영 편의를 위해 where만 사용하고 정렬은 클라이언트에서 처리합니다.
  const snaps = await getDocs(query(col, where("status","==","pending"), limit(500)));

  const arr = [];
  snaps.forEach((d)=>{
    const x = d.data() || {};
    arr.push({ id:d.id, ...x, _t: tsToMs(x.createdAt) });
  });
  arr.sort((a,b)=>b._t-a._t);

  if(!arr.length){
    if(itemsState) itemsState.textContent = "대기중 상품이 없습니다.";
    return;
  }
  if(itemsState) itemsState.textContent = `${arr.length}개`;

  itemsList.innerHTML = arr.map((x)=>{
    return `
      <div class="admin-card" data-item="${esc(x.id)}">
        <div class="ac-top">
          <div class="ac-title">${esc(x.title || "(제목없음)")}</div>
          <div class="ac-sub">${esc(x.category || "-")} · ${esc(x.location || "-")}</div>
        </div>
        <div class="ac-body">
          <div class="ac-row"><span>가이드</span><b>${esc(x.guideName || x.guideUid || "-")}</b></div>
          <div class="ac-row"><span>가격</span><b>${esc(x.price || "-")}</b></div>
          <div class="ac-row"><span>상태</span><b>${esc(x.status || "-")}</b></div>
        </div>
        <div class="ac-actions">
          <a class="btn btn--sm btn--ghost" href="./item.html?id=${encodeURIComponent(x.id)}" target="_blank" rel="noopener">미리보기</a>
          <button class="btn btn--sm" data-action="publish-item" data-id="${esc(x.id)}">공개 승인</button>
          <button class="btn btn--sm btn--ghost" data-action="reject-item" data-id="${esc(x.id)}">반려</button>
        </div>
      </div>
    `;
  }).join("");
}

async function publishItem(itemId, adminUid){
  const ref = doc(db, "items", itemId);
  await updateDoc(ref, {
    status: "published",
    publishedAt: serverTimestamp(),
    approvedBy: adminUid,
    updatedAt: serverTimestamp(),
  });
}

async function rejectItem(itemId, adminUid){
  const reason = prompt("반려 사유(선택)") || "";
  const ref = doc(db, "items", itemId);
  await updateDoc(ref, {
    status: "draft",
    rejectReason: reason,
    rejectedBy: adminUid,
    updatedAt: serverTimestamp(),
  });
}

function bindActions({ adminUid }){
  document.addEventListener("click", async (e)=>{
    const btn = e.target?.closest?.("[data-action]");
    if(!btn) return;

    const action = btn.getAttribute("data-action");
    const id = btn.getAttribute("data-id");
    if(!id) return;

    try{
      btn.disabled = true;

      if(action === "approve-guide"){
        await approveGuide(id);
        await listGuideApplications();
        return;
      }
      if(action === "reject-guide"){
        await rejectGuide(id);
        await listGuideApplications();
        return;
      }
      if(action === "publish-item"){
        await publishItem(id, adminUid);
        await listPendingItems();
        return;
      }
      if(action === "reject-item"){
        await rejectItem(id, adminUid);
        await listPendingItems();
        return;
      }
    }catch(err){
      console.error(err);
      alert(err?.message || String(err));
    }finally{
      btn.disabled = false;
    }
  });
}

async function reloadAll(){
  await Promise.all([
    listGuideApplications(),
    listPendingItems(),
  ]);
}

// Tabs

 tabGuides?.addEventListener("click", ()=>setTab("guides"));
 tabItems?.addEventListener("click", ()=>setTab("items"));

// Init

onAuthReady(async ({ loggedIn, role, user, profile })=>{
  if(!loggedIn){
    setState("로그인 후 이용 가능합니다.");
    return;
  }

  if(!isAdmin(profile)){
    setState("관리자만 접근 가능합니다.");
    return;
  }

  setState("준비됨");
  setTab("guides");

  btnReload?.addEventListener("click", reloadAll);
  bindActions({ adminUid: user.uid });

  try{
    await reloadAll();
  }catch(e){
    console.error(e);
    setState(e?.message || String(e));
  }
});
