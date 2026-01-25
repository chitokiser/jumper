// /assets/js/pages/my_products.js
import { db, onAuthReady } from "../auth.js";
import { collection, query, where, getDocs } from "../firestore-bridge.js";

function $(id){ return document.getElementById(id); }

function esc(s){ return String(s||"").replace(/[&<>"']/g,(m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }


const CATEGORY_LABEL = {
  spa: "스파",
  massage: "마사지",
  beauty: "뷰티/에스테틱",
  ticket: "티켓/입장권",
  tour: "투어",
  nature: "자연/액티비티",
  cruise: "크루즈/요트",
  food: "맛집",
  cafe: "카페",
  night: "나이트/클럽",
  show: "공연/쇼",
  city: "도시/랜드마크",
  shopping: "쇼핑",
  hotel: "호텔/리조트",
  transport: "교통/렌트",
  etc: "기타",
};
function catLabel(code){
  const k = String(code || "").trim();
  return CATEGORY_LABEL[k] || k || "기타";
}
function thumbUrl(d){
  if(Array.isArray(d.images) && d.images.length) return String(d.images[0]||"").trim();
  if(d.imageUrl) return String(d.imageUrl).trim();
  return "";
}

function statusBadge(status){
  const t = status || "draft";
  const cls =
    t === "published" ? "pill pill-ok" :
    t === "pending" ? "pill pill-warn" :
    "pill";
  return `<span class="${cls}">${esc(t)}</span>`;
}

function cardHTML(id, it){
  const title = esc(it.title || "(제목 없음)");
  const region = esc(it.region || "");
  const cat = esc(catLabel(it.category || ""));
  const price = (it.price || 0);
  const cur = esc(it.currency || "");
  const u = thumbUrl(it);
  const img = u ? `<img class="card-cover" src="${esc(u)}" alt="" loading="lazy">` : "";
  const href = `./item.html?id=${encodeURIComponent(id)}`;
  const editHref = `./product_edit.html?id=${encodeURIComponent(id)}`;

  return `
  <article class="card">
    ${img}
    <div class="card-body">
      <div class="card-top">
        <div class="card-title">${title}</div>
        ${statusBadge(it.status)}
      </div>
      <div class="card-meta">
        <span class="chip">${cat}</span>
        <span class="chip">${region}</span>
      </div>
      <div class="card-bottom">
        <div class="card-price">${price.toLocaleString()} ${cur}</div>
        <div class="btn-row">
          <a class="btn" href="${href}">상세보기</a>
          <a class="btn" href="${editHref}">수정</a>
        </div>
      </div>
    </div>
  </article>`;
}



function toMs(v){
  if(!v) return 0;
  if(typeof v === "number") return v;
  if(typeof v === "string"){
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if(typeof v === "object"){
    if(typeof v.toDate === "function") return v.toDate().getTime();
    if(typeof v.seconds === "number") return v.seconds * 1000;
  }
  return 0;
}

async function loadList(uid, status){
  const col = collection(db, "items");

  // 1) 최신 필드: ownerUid
  let snap = await getDocs(query(col, where("ownerUid", "==", uid)));

  // 2) 과거 데이터 호환: guideUid만 있는 경우
  if(snap.empty){
    snap = await getDocs(query(col, where("guideUid", "==", uid)));
  }

  const rows = [];
  snap.forEach((d)=>{
    const data = d.data() || {};
    if(status && status !== "all"){
      if((data.status || "draft") !== status) return;
    }
    rows.push({ id: d.id, data });
  });

  // createdAt 최신순 (인덱스 없이 클라이언트 정렬)
  rows.sort((a,b)=>toMs(b.data.createdAt || b.data.updatedAt) - toMs(a.data.createdAt || a.data.updatedAt));
  return rows;
}

function render(rows){
  const grid = $("listGrid");
  const state = $("listState");
  if(!grid || !state) return;

  if(!rows.length){
    state.textContent = "등록된 상품이 없습니다.";
    grid.innerHTML = "";
    return;
  }

  state.textContent = "";
  grid.innerHTML = rows.map(r=>cardHTML(r.id, r.data)).join("");
}

onAuthReady(async ({ loggedIn, role, user })=>{
  if(!loggedIn){
    alert("로그인이 필요합니다.");
    location.href = "./index.html";
    return;
  }
  if(!(role === "guide" || role === "admin")){
    // 승인 전이라도 본인이 만든게 있을 수 있지만, 기본 정책상 접근은 제한
    alert("가이드 승인 후 이용 가능합니다. 먼저 가이드 신청을 해주세요.");
    location.href = "./guide.html";
    return;
  }

  const sel = $("qStatus");
  const reload = async ()=>{
    try{
      $("listState").textContent = "로딩중...";
      const status = sel ? sel.value : "all";
      const rows = await loadList(user.uid, status);
      render(rows);
    }catch(e){
      console.error(e);
      $("listState").textContent = "불러오기 실패: " + (e?.message || String(e));
    }
  };

  if(sel) sel.addEventListener("change", reload);
  await reload();
});
