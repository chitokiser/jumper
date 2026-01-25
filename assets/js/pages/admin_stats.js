// /assets/js/pages/admin_stats.js
import {
  db,
  collection,
  query,
  getDocs,
  where,
  limit,
} from "../firestore-bridge.js";

import { onAuthReady } from "../auth.js";
import { isAdmin } from "../roles.js";

function isHomestayCategory(cat){
  // 모바일/데스크탑/관리자 입력값이 섞여도 안전하게 판정
  const raw = String(cat || "").trim();
  const c = raw.toLowerCase();
  if (!c) return false;

  // 영문 코드(권장)
  if (c === "hotel" || c === "homestay" || c === "guesthouse") return true;

  // 한글(운영 중 혼재 가능)
  if (raw.includes("홈스테이") || raw.includes("숙박") || raw.includes("게스트하우스") || raw.includes("호텔") || raw.includes("민박")) {
    return true;
  }

  // 기타 흔한 표기
  if (c.includes("hotel") || c.includes("guest") || c.includes("stay") || c.includes("apartment") || c.includes("condo")) return true;

  return false;
}
function $(sel){ return document.querySelector(sel); }
function n(v,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function esc(s=""){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function fmt2(v){ return (Math.round(v*100)/100).toFixed(2); }

function rowHTML(title, sub, value, hint=""){
  return `
  <div class="row">
    <div class="l">
      <div class="t">${esc(title)}</div>
      <div class="sub">${esc(sub)}</div>
    </div>
    <div class="r">${esc(String(value))}${hint ? `<span>${esc(hint)}</span>` : ""}</div>
  </div>`;
}

function computeGuideLeaders(items){
  const map = new Map();
  for(const it of items){
    const guideUid = it.guideUid || it.ownerUid || it.uid || "unknown";
    const guideName = it.guideName || it.ownerName || it.displayName || "";
    if(!map.has(guideUid)){
      map.set(guideUid, { guideUid, guideName, items:0, reviewCount:0, weightedSum:0 });
    }
    const g = map.get(guideUid);
    g.items += 1;
    g.guideName = g.guideName || guideName;

    const c = n(it.reviewCount,0);
    const a = n(it.reviewAvg,0);
    g.reviewCount += c;
    g.weightedSum += a * c;
  }
  const arr = Array.from(map.values()).map(g=>{
    const weightedAvg = g.reviewCount>0 ? (g.weightedSum/g.reviewCount) : 0;
    return { ...g, weightedAvg };
  });
  arr.sort((a,b)=>{
    if((b.weightedAvg||0)!==(a.weightedAvg||0)) return (b.weightedAvg||0)-(a.weightedAvg||0);
    if((b.reviewCount||0)!==(a.reviewCount||0)) return (b.reviewCount||0)-(a.reviewCount||0);
    return (b.items||0)-(a.items||0);
  });
  return arr.slice(0,10);
}

async function loadAllItemsLite(){
  // 통계는 전체를 보고 싶지만, 인덱스/비용/성능을 위해 500개까지만
  const q = query(collection(db,"items"), limit(500));
  const snap = await getDocs(q);
  return snap.docs.map(d=>{
    const x=d.data();
    return {
      id:d.id,
      status:x.status||"",
      type:(x.type||""),
      category:x.category||"기타",
      guideUid:x.guideUid||x.ownerUid||x.uid||"",
      guideName:x.guideName||x.ownerName||x.displayName||"",
      reviewAvg:n(x.reviewAvg,0),
      reviewCount:n(x.reviewCount,0),
    };
  });
}

async function loadOrdersLite(){
  // orders 통계도 500개까지만
  const q = query(collection(db,"orders"), limit(500));
  const snap = await getDocs(q);
  return snap.docs.map(d=>{
    const x=d.data();
    return {
      id:d.id,
      payMethod: x.payMethod || x.paymentMethod || "unknown",
      status: x.status || "",
    };
  });
}

function countBy(arr, keyFn){
  const m = new Map();
  for(const a of arr){
    const k = keyFn(a) || "unknown";
    m.set(k, (m.get(k)||0) + 1);
  }
  return Array.from(m.entries()).sort((a,b)=>b[1]-a[1]);
}

async function render(){
  $("#state").textContent = "로딩중...";

  const items = await loadAllItemsLite();
  const orders = await loadOrdersLite();

  const totalItems = items.length;
  const published = items.filter(x=>x.status==="published").length;
  const pending = items.filter(x=>x.status==="pending").length;

  $("#kItems").textContent = String(totalItems);
  $("#kPublished").textContent = String(published);
  $("#kPending").textContent = String(pending);
  $("#kOrders").textContent = String(orders.length);

  // 카테고리 분포(전체 기준)
  const cat = countBy(items, x=>x.category);
  $("#catHint").textContent = `상위 ${Math.min(10, cat.length)}개`;
  $("#catList").innerHTML = cat.slice(0,10).map(([k,v])=>rowHTML(k, "items", v, "개")).join("");

  // 결제방법 분포(orders 기준)
  const pay = countBy(orders, x=>x.payMethod);
  $("#payHint").textContent = `상위 ${Math.min(10, pay.length)}개`;
  $("#payList").innerHTML = pay.slice(0,10).map(([k,v])=>rowHTML(k, "orders", v, "건")).join("");

  // 가이드 리더보드(공개상품 기준으로 계산)
  const pubItems = items.filter(x=>x.status==="published").filter(x=>{
    const t = String(x.type || "").toLowerCase();
    if (t) return t === "experience";
    return !isHomestayCategory(x.category);
  });
  const leaders = computeGuideLeaders(pubItems);
  $("#guideList").innerHTML = leaders.map((g, i)=>rowHTML(
    `${i+1}. ${g.guideName || g.guideUid || "unknown"}`,
    `공개상품 ${g.items} · 리뷰 ${g.reviewCount}`,
    g.reviewCount>0 ? fmt2(g.weightedAvg) : "-",
    "가중"
  )).join("");

  $("#state").textContent = `집계 완료 (items 최대 500, orders 최대 500)`;
}

onAuthReady(async ({ user, profile })=>{
  if(!user){
    $("#state").textContent = "로그인 필요";
    return;
  }
  if(!isAdmin(profile)){
    $("#state").textContent = "관리자만 접근 가능합니다.";
    return;
  }
  try{
    await render();
  }catch(e){
    console.error(e);
    $("#state").textContent = "오류: " + (e?.message || String(e));
  }
});
