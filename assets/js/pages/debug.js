// /assets/js/pages/debug.js
import { onAuthReady } from "../auth.js";
import { db } from "../firebase-init.js";

import {
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs, limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function log(line){
  const el = $("dbgLog");
  const prev = el.textContent === "준비중..." ? "" : el.textContent;
  el.textContent = (prev ? (prev + "\n") : "") + line;
}

function hr(){
  log("------------------------------------------------------------");
}

async function readAdminDoc(uid){
  const ref = doc(db, "admins", uid);
  const snap = await getDoc(ref);
  return snap.exists();
}

async function getRoleFromUser(uid){
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if(!snap.exists()) return "";
  const d = snap.data() || {};
  return String(d.role || "");
}

async function runRulesCheck(uid){
  hr();
  log("[Rules 점검] 시작");

  // 1) users/{uid} get
  try{
    const uref = doc(db, "users", uid);
    await getDoc(uref);
    log("OK: users/{uid} 읽기");
  }catch(e){
    log("FAIL: users/{uid} 읽기 -> " + (e?.code || e?.message || e));
  }

  // 2) notices list (공개/관리자)
  try{
    const q1 = query(collection(db, "notices"), limit(3));
    await getDocs(q1);
    log("OK: notices 리스트(상위 3) 읽기");
  }catch(e){
    log("FAIL: notices 리스트 읽기 -> " + (e?.code || e?.message || e));
  }

  // 3) items list (상위 3)
  try{
    const q2 = query(collection(db, "items"), limit(3));
    await getDocs(q2);
    log("OK: items 리스트(상위 3) 읽기");
  }catch(e){
    log("FAIL: items 리스트 읽기 -> " + (e?.code || e?.message || e));
  }

  // 4) orders list (상위 3) - 권한에 따라 실패 가능
  try{
    const q3 = query(collection(db, "orders"), limit(3));
    await getDocs(q3);
    log("OK: orders 리스트(상위 3) 읽기");
  }catch(e){
    log("WARN: orders 리스트 읽기(권한 제한 가능) -> " + (e?.code || e?.message || e));
  }

  // 5) 쓰기 테스트 (debugPing/{uid}) - 관리자만 통과하도록 rules 설정한 경우 실패 가능
  try{
    const ref = doc(db, "debugPing", uid);
    await setDoc(ref, { ok:true, at: Date.now() }, { merge:true });
    log("OK: debugPing/{uid} 쓰기(merge)");
  }catch(e){
    log("WARN: debugPing 쓰기(권한 제한 가능) -> " + (e?.code || e?.message || e));
  }

  log("[Rules 점검] 완료");
}

async function findOrderMismatch(){
  hr();
  log("[주문 불일치] status vs paymentStatus 체크");
  const q1 = query(collection(db, "orders"), limit(200));
  const snap = await getDocs(q1);
  let bad = 0;
  snap.forEach((d)=>{
    const o = d.data() || {};
    const s = String(o.status || "");
    const p = String(o.paymentStatus || "");
    if((s === "confirmed" && p !== "confirmed") || (p === "confirmed" && s !== "confirmed")){
      bad++;
      log(`- ${d.id}  status=${s}  paymentStatus=${p}  item=${o.itemTitle || ""}`);
    }
  });
  log(`총 ${snap.size}건 중 불일치 ${bad}건`);
}

async function findSlotAnomaly(){
  hr();
  log("[슬롯 이상치] booked > capacity");
  const q1 = query(collection(db, "slots"), limit(400));
  const snap = await getDocs(q1);

  let bad = 0;
  snap.forEach((d)=>{
    const s = d.data() || {};
    const booked = Number(s.booked || 0);
    const cap = Number(s.capacity || 0);
    if(Number.isFinite(booked) && Number.isFinite(cap) && cap > 0 && booked > cap){
      bad++;
      log(`- ${d.id}  booked=${booked}  cap=${cap}`);
    }
  });
  log(`총 ${snap.size}건 중 이상치 ${bad}건`);
}

async function findLegacyItems(){
  hr();
  log("[구형 상품] booking 누락 items 찾기");
  const q1 = query(collection(db, "items"), limit(300));
  const snap = await getDocs(q1);

  let bad = 0;
  snap.forEach((d)=>{
    const it = d.data() || {};
    if(!it.booking || typeof it.booking !== "object"){
      bad++;
      log(`- ${d.id}  title=${it.title || it.name || ""}  category=${it.category || ""}`);
    }
  });
  log(`총 ${snap.size}건 중 booking 누락 ${bad}건`);
  return bad;
}

async function fixLegacyBooking(){
  hr();
  log("[구형 상품 자동 보정] 시작");
  const q1 = query(collection(db, "items"), limit(400));
  const snap = await getDocs(q1);

  let fixed = 0;
  for(const d of snap.docs){
    const it = d.data() || {};
    if(!it.booking || typeof it.booking !== "object"){
      try{
        await updateDoc(doc(db, "items", d.id), {
          booking: { mode: "date_single", weekdays: [], capacity: 0 },
          updatedAt: new Date(),
        });
        fixed++;
        log(`OK: ${d.id} booking 기본값 적용`);
      }catch(e){
        log(`FAIL: ${d.id} -> ` + (e?.code || e?.message || e));
      }
    }
  }
  log(`[구형 상품 자동 보정] 완료: ${fixed}건 업데이트`);
}

(async function init(){
  $("dbgLog").textContent = "준비중...";

  const user = await onAuthReady();
  if(!user){
    $("dbgUid").textContent = "-";
    $("dbgEmail").textContent = "-";
    $("dbgRole").textContent = "guest";
    $("dbgAdminDoc").textContent = "NO";
    $("dbgLog").textContent = "로그인이 필요합니다. (관리자 계정)";
    return;
  }

  $("dbgUid").textContent = user.uid;
  $("dbgEmail").textContent = user.email || "-";

  let role = "";
  try{ role = await getRoleFromUser(user.uid); }catch(e){ role = ""; }
  $("dbgRole").textContent = role || "-";

  let isAdminDoc = false;
  try{ isAdminDoc = await readAdminDoc(user.uid); }catch(e){ isAdminDoc = false; }
  $("dbgAdminDoc").textContent = isAdminDoc ? "YES" : "NO";

  $("dbgLog").textContent = "준비 완료. 버튼을 눌러 점검을 시작하세요.";

  $("btnRules").onclick = () => runRulesCheck(user.uid);
  $("btnOrders").onclick = () => findOrderMismatch();
  $("btnSlots").onclick = () => findSlotAnomaly();
  $("btnItems").onclick = () => findLegacyItems();

  $("btnFixBooking").onclick = async () => {
    if(!isAdminDoc){
      hr();
      log("관리자만 실행 가능합니다.");
      return;
    }
    await fixLegacyBooking();
  };
})();
