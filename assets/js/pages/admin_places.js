// /assets/js/pages/admin_places.js
// 관리자 전용 장소 등록/수정/삭제

import { onAuthReady } from "../auth.js";
import { db } from "../firebase-init.js";

import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function $(id){ return document.getElementById(id); }

const stateEl = $("state");
const formEl = $("form");
const listEl = $("list");

const nameEl = $("name");
const typeEl = $("type");
const areaEl = $("area");
const addressEl = $("address");
const gmapEl = $("gmap");
const latEl  = $("lat");
const lngEl  = $("lng");
const phoneEl = $("phone");
const visibleEl = $("visible");
const mustGoEl = $("mustGo");
const noteEl = $("note");

const btnSave = $("btnSave");
const btnNew = $("btnNew");
const btnDelete = $("btnDelete");

let currentId = null;
let myUid = null;

function setState(t){ if(stateEl) stateEl.textContent = t || ""; }
function showForm(on){ if(formEl) formEl.classList.toggle("hide", !on); }

function resetForm(){
  currentId = null;
  if(nameEl) nameEl.value = "";
  if(typeEl) typeEl.value = "homestay";
  if(areaEl) areaEl.value = "op1";
  if(addressEl) addressEl.value = "";
  if(gmapEl) gmapEl.value = "";
  if(latEl)  latEl.value  = "";
  if(lngEl)  lngEl.value  = "";
  if(phoneEl) phoneEl.value = "";
  if(visibleEl) visibleEl.value = "1";
  if(mustGoEl) mustGoEl.value = "0";
  if(noteEl) noteEl.value = "";
  if(btnDelete) btnDelete.style.display = "none";
}

function fillForm(d){
  if(nameEl) nameEl.value = d?.name || "";
  if(typeEl) typeEl.value = d?.type || "homestay";
  if(areaEl) areaEl.value = d?.area || "op1";
  if(addressEl) addressEl.value = d?.address || "";
  if(gmapEl) gmapEl.value = d?.gmap || "";
  if(latEl)  latEl.value  = (d?.lat  != null) ? d.lat  : "";
  if(lngEl)  lngEl.value  = (d?.lng  != null) ? d.lng  : "";
  if(phoneEl) phoneEl.value = d?.phone || "";
  if(visibleEl) visibleEl.value = (d?.visible === false) ? "0" : "1";
  if(mustGoEl) mustGoEl.value = d?.mustGo ? "1" : "0";
  if(noteEl) noteEl.value = d?.note || "";
  if(btnDelete) btnDelete.style.display = "";
}

async function loadList(){
  if(!listEl) return;
  listEl.innerHTML = "";

  const qy = query(
    collection(db, "places"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

  const snap = await getDocs(qy);

  if(snap.empty){
    listEl.innerHTML = `<div class="help small">등록된 장소가 없습니다.</div>`;
    return;
  }

  snap.forEach((s)=>{
    const d = s.data() || {};
    const card = document.createElement("div");
    card.className = "place-card";

    const title = document.createElement("div");
    title.className = "pc-title";
    title.textContent = `${d.mustGo ? "[Must-Go] " : ""}${d.visible === false ? "[숨김] " : ""}${d.name || "(이름없음)"}`;

    const meta = document.createElement("div");
    meta.className = "pc-meta";
    meta.textContent = `${d.area || "-"} · ${d.type || "-"} · ${d.address || ""}`;

    card.appendChild(title);
    card.appendChild(meta);

    card.addEventListener("click", async ()=>{
      try{
        setState("불러오는 중...");
        const ref = doc(db, "places", s.id);
        const snap2 = await getDoc(ref);
        if(!snap2.exists()){
          setState("해당 장소가 없습니다.");
          return;
        }
        currentId = s.id;
        fillForm(snap2.data());
        showForm(true);
        setState("");
      }catch(e){
        console.error(e);
        setState(e?.message || e);
      }
    });

    listEl.appendChild(card);
  });
}

async function save(){
  const name = String(nameEl?.value || "").trim();
  if(!name){ alert("장소 이름을 입력해 주세요"); return; }

  const payload = {
    name,
    type: String(typeEl?.value || "homestay"),
    area: String(areaEl?.value || "op1"),
    address: String(addressEl?.value || "").trim(),
    gmap: String(gmapEl?.value || "").trim(),
    lat: latEl?.value !== "" ? parseFloat(latEl.value) : null,
    lng: lngEl?.value !== "" ? parseFloat(lngEl.value) : null,
    phone: String(phoneEl?.value || "").trim(),
    mustGo: mustGoEl?.value === "1",
    visible: visibleEl?.value !== "0",
    note: String(noteEl?.value || "").trim(),
    updatedAt: serverTimestamp(),
  };

  btnSave.disabled = true;
  try{
    if(!currentId){
      await addDoc(collection(db, "places"), {
        ...payload,
        authorUid: myUid,
        createdAt: serverTimestamp(),
      });
    }else{
      await updateDoc(doc(db, "places", currentId), payload);
    }

    await loadList();
    alert("저장 완료");
  }finally{
    btnSave.disabled = false;
  }
}

async function remove(){
  if(!currentId) return;
  if(!confirm("이 장소를 삭제할까요?")) return;

  btnDelete.disabled = true;
  try{
    await deleteDoc(doc(db, "places", currentId));
    resetForm();
    await loadList();
    alert("삭제 완료");
  }finally{
    btnDelete.disabled = false;
  }
}

onAuthReady(async ({ user, profile })=>{
  if(!user){
    setState("로그인 필요");
    showForm(false);
    return;
  }

  const role = profile?.role || "user";
  if(role !== "admin"){
    setState("관리자만 접근할 수 있습니다.");
    showForm(false);
    return;
  }

  myUid = user.uid;
  setState("로딩...");
  showForm(true);
  resetForm();

  try{
    await loadList();
    setState("");
  }catch(e){
    console.error(e);
    setState(e?.message || e);
  }
});

if(btnNew){
  btnNew.addEventListener("click", ()=>{
    resetForm();
    showForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

if(formEl){
  formEl.addEventListener("submit", async (e)=>{
    e.preventDefault();
    try{ await save(); }
    catch(err){ console.error(err); alert(err?.message || err); }
  });
}

if(btnDelete){
  btnDelete.addEventListener("click", async ()=>{
    try{ await remove(); }
    catch(err){ console.error(err); alert(err?.message || err); }
  });
}
