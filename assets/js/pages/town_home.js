// /assets/js/pages/town_home.js
// 우리마을 홈: 관리자 버튼 표시 + 공지(펼침/접기) + 사진관 슬라이더(안정형)

import { auth, db } from "/assets/js/auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

/* =====================
   0) 진단 로그(프로젝트 불일치 체크)
===================== */
try{
  console.log("[town_home] firebase projectId =", db?.app?.options?.projectId);
}catch(e){}

/* =====================
   1) 관리자 버튼 표시
===================== */
async function isAdmin(uid){
  if(!uid) return false;
  try{
    const ref = doc(db, "admins", uid);
    const snap = await getDoc(ref);
    return snap.exists();
  }catch(e){
    console.warn("isAdmin check failed:", e);
    return false;
  }
}

function setupAdminUI(admin){
  const btnAdminPlace = $("btnAdminPlace");
  const noticeAdminLink = $("noticeAdminLink");
  if(btnAdminPlace) btnAdminPlace.style.display = admin ? "" : "none";
  if(noticeAdminLink) noticeAdminLink.style.display = admin ? "" : "none";
}

/* =====================
   2) 공지사항(최신 n개)
===================== */
function makeNoticeRow(v){
  const li = document.createElement("li");
  li.className = "notice-row";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "notice-head";
  head.textContent = v.title || v.text || "(제목 없음)";

  const body = document.createElement("div");
  body.className = "notice-body";
  body.textContent = v.text || "";
  body.style.display = "none";

  head.onclick = () => {
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
  };

  li.appendChild(head);
  li.appendChild(body);
  return li;
}

async function loadNotices(){
  const list = $("noticeList");
  if(!list) return;
  list.innerHTML = "";

  try{
    // 1차: createdAt desc 정렬(표준)
    const q1 = query(
      collection(db, "notices"),
      orderBy("createdAt", "desc"),
      limit(8)
    );

    const snap = await getDocs(q1);

    if(snap.empty){
      const li = document.createElement("li");
      li.textContent = "등록된 공지사항이 없습니다.";
      list.appendChild(li);
      return;
    }

    const docs = [];
    snap.forEach((d) => docs.push(d.data() || {}));

    docs.sort((a,b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if(ap !== bp) return bp - ap;
      const am = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
      const bm = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
      return bm - am;
    });

    docs.forEach((v) => {
      if(v.visible === false) return;
      list.appendChild(makeNoticeRow(v));
    });

    if(!list.children.length){
      const li = document.createElement("li");
      li.textContent = "표시할 공지사항이 없습니다.";
      list.appendChild(li);
    }
  }catch(e){
    // createdAt이 없는 문서가 섞이면 orderBy가 실패할 수 있습니다.
    // 2차: 정렬 없이 가져온 뒤 클라에서 정렬/필터합니다.
    console.warn("loadNotices primary query failed, fallback:", e);

    try{
      const q2 = query(collection(db, "notices"), limit(20));
      const snap2 = await getDocs(q2);

      const docs = [];
      snap2.forEach((d) => docs.push(d.data() || {}));

      docs
        .filter((v) => v.visible !== false)
        .sort((a,b) => {
          const ap = a.pinned ? 1 : 0;
          const bp = b.pinned ? 1 : 0;
          if(ap !== bp) return bp - ap;
          const am = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
          const bm = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
          return bm - am;
        })
        .slice(0, 8)
        .forEach((v) => list.appendChild(makeNoticeRow(v)));

      if(!list.children.length){
        const li = document.createElement("li");
        li.textContent = "표시할 공지사항이 없습니다.";
        list.appendChild(li);
      }
    }catch(e2){
      console.warn("loadNotices fallback failed:", e2);
      const li = document.createElement("li");
      li.textContent = "공지사항을 불러오지 못했습니다.";
      list.appendChild(li);
    }
  }
}

/* =====================
   3) 우리마을 사진관(안정형)
   - 1~UI_MAX 까지 존재하는 파일만 자동 수집
   - png/jpg/jpeg/webp 확장자까지 같이 체크
===================== */
// NOTE:
// - 파일명이 1.png, 2.png ... 처럼 “연속 번호”로 계속 늘어날 수 있으므로
//   상한(UI_MAX)을 넉넉히 잡고, 연속 미존재가 일정 횟수 누적되면 자동 종료합니다.
const UI_MAX  = 250; // 1~250까지 시도 (연속 누락 감지로 조기 종료)
const UI_BASE = "/assets/images/ui/";
const UI_EXTS = ["png", "jpg", "jpeg", "webp"];

// 슬라이더 프레임(배경 블러용)
const uiStage = document.querySelector("#uiSlider .ps-stage");

function setStageBg(src){
  if(!uiStage) return;
  // CSS에서 background-image: var(--ps-bg) 를 사용
  uiStage.style.setProperty("--ps-bg", `url(\"${src}\")`);
}

const uiPrev = $("uiPrev");
const uiNext = $("uiNext");
const uiImg  = $("uiSlideImg");
const uiIdx  = $("uiSlideIndex");
const uiHelp = $("uiSlideHelp");

let uiList = [];
let uiPos  = 0;
let uiBusy = false;

function preload(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 너무 오래 기다리면 초기 로딩이 답답해집니다.
    // 정상 파일은 보통 빠르게 로드되므로 타임아웃을 짧게 둡니다.
    const timer = setTimeout(() => reject(new Error("timeout")), 5000);
    img.onload = () => { clearTimeout(timer); resolve(src); };
    img.onerror = () => { clearTimeout(timer); reject(new Error("error")); };
    img.src = src;
  });
}

function setHelp(msg){
  if(uiHelp) uiHelp.textContent = msg || "";
}

function setIndexLabel(){
  if(!uiIdx) return;
  if(uiList.length === 0) uiIdx.textContent = "-";
  else uiIdx.textContent = `${uiPos + 1} / ${uiList.length}`;
}

async function showAt(nextPos){
  if(!uiImg) return;

  if(uiList.length === 0){
    setHelp("표시할 사진이 없습니다. /assets/images/ui/ 경로를 확인해 주세요.");
    setIndexLabel();
    return;
  }

  if(uiBusy) return;
  uiBusy = true;

  const n = uiList.length;
  const pos = ((nextPos % n) + n) % n;
  const src = uiList[pos];

  try{
    await preload(src);
    uiPos = pos;
    uiImg.src = src;
    setStageBg(src);
    setIndexLabel();
    setHelp("");
  }catch(e){
    setHelp("일부 사진 로드 실패(파일 누락/경로 오류). 존재하는 사진만 표시 중입니다.");
    setIndexLabel();
  }finally{
    uiBusy = false;
  }
}

async function findFirstExisting(i){
  for(const ext of UI_EXTS){
    const src = `${UI_BASE}${i}.${ext}`;
    try{
      await preload(src);
      return src;
    }catch(e){
      // 다음 확장자 시도
    }
  }
  return null;
}

async function initUISlider(){
  if(!uiImg) return;

  uiImg.removeAttribute("src");
  uiImg.alt = "우리마을 사진";
  setHelp("사진을 불러오는 중입니다…");

  // 우선: 정적 매니페스트에서 이미지 목록을 가져옵니다.
  uiList = [];
  try{
    const res = await fetch(`${UI_BASE}manifest.json`);
    if(res && res.ok){
      const data = await res.json();
      if(Array.isArray(data) && data.length) uiList = data.slice();
    }
  }catch(e){
    console.warn("manifest fetch failed:", e);
  }

  // 폴백: 매니페스트가 없으면 기존 방식으로 탐색(호환성 유지)
  if(uiList.length === 0){
    const END_GAP = 8;
    let gap = 0;
    for(let i=1;i<=UI_MAX;i++){
      const src = await findFirstExisting(i);
      if(src){
        uiList.push(src);
        gap = 0;
      }else{
        gap++;
        if(uiList.length > 0 && gap >= END_GAP) break;
      }
    }
  }

  if(uiList.length === 0){
    setHelp("사진을 불러오지 못했습니다. /assets/images/ui/1.png 처럼 실제 파일이 있는지 확인해 주세요.");
    setIndexLabel();
    return;
  }

  uiPos = 0;
  // lazy 로드 속성 설정 (브라우저가 필요할 때 다운로드)
  try{ uiImg.loading = 'lazy'; }catch(e){}
  uiImg.src = uiList[0];
  setStageBg(uiList[0]);
  setIndexLabel();
  setHelp(`${uiList.length}장의 사진을 표시합니다.`);

  if(uiPrev) uiPrev.onclick = () => showAt(uiPos - 1);
  if(uiNext) uiNext.onclick = () => showAt(uiPos + 1);

  // 키보드 좌우도 지원
  window.addEventListener("keydown", (e) => {
    if(e.key === "ArrowLeft") showAt(uiPos - 1);
    if(e.key === "ArrowRight") showAt(uiPos + 1);
  });
}

/* =====================
   4) 가맹점 리스트
===================== */
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMerchantCard(mid, m) {
  const name     = m.name        || "가맹점";
  const career   = m.career      || "";
  const region   = m.region      || "";
  const desc     = m.description || "";
  const ownerUid = m.ownerUid    || "";

  return `
    <div class="merchant-card">
      <div class="merchant-card-head">
        <span class="merchant-name">${escHtml(name)}</span>
        ${career ? `<span class="merchant-career">${escHtml(career)}</span>` : ""}
      </div>
      ${region ? `<div class="merchant-region">📍 ${escHtml(region)}</div>` : ""}
      ${desc   ? `<div class="merchant-desc">${escHtml(desc)}</div>`         : ""}
      <div class="merchant-id">가맹점 ID: ${escHtml(String(mid))}</div>
      ${ownerUid ? `<button class="btn-merchant-products" type="button"
        data-owner-uid="${escHtml(ownerUid)}"
        data-merchant-name="${escHtml(name)}">상품 보기</button>` : ""}
    </div>`;
}

let _merchantGridListening = false;

async function loadMerchants() {
  const grid  = $("merchantListGrid");
  const state = $("merchantListState");
  if (!grid) return;

  if (state) state.textContent = "불러오는 중...";

  try {
    const snap = await getDocs(collection(db, "merchants"));
    const list = [];
    snap.forEach((d) => {
      const m = d.data() || {};
      // active: true 인 가맹점만 표시 (비활성 제외)
      if (m.active !== false) {
        list.push({ id: d.id, ...m });
      }
    });

    if (state) state.textContent = `총 ${list.length}개`;

    if (!list.length) {
      grid.innerHTML = `<p class="help">등록된 가맹점이 없습니다.</p>`;
      return;
    }

    grid.innerHTML = list.map((m) => renderMerchantCard(m.id, m)).join("");

    // 이벤트 위임 (한 번만 등록)
    if (!_merchantGridListening) {
      _merchantGridListening = true;
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-merchant-products");
        if (!btn) return;
        const ownerUid     = btn.dataset.ownerUid;
        const merchantName = btn.dataset.merchantName;
        if (ownerUid) openMerchantProductModal(ownerUid, merchantName);
      });
    }
  } catch (e) {
    console.warn("loadMerchants failed:", e);
    if (state) state.textContent = "가맹점 목록을 불러오지 못했습니다.";
  }
}

/* =====================
   5) 우리마을 지도 (Google Maps + Firestore places)
===================== */
const TYPE_COLOR = {
  homestay:   "#6366f1",
  restaurant: "#f97316",
  food:       "#f97316",
  cafe:       "#854d0e",
  hospital:   "#ef4444",
  school:     "#16a34a",
  park:       "#22c55e",
  shopping:   "#ec4899",
};

function getMarkerColor(type) {
  return TYPE_COLOR[String(type).toLowerCase()] || "#6b7280";
}

function loadMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
    window.__gmapsCb = resolve;
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${window.__mapsKey || ""}&callback=__gmapsCb&language=ko&region=KR`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps 스크립트 로드 실패"));
    document.head.appendChild(s);
  });
}

function parseLatLng(gmapUrl) {
  if (!gmapUrl) return null;
  try {
    // @lat,lng,zoom 패턴 (구글 지도 브라우저 URL, 공유 URL)
    const m1 = gmapUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
    // ?q=lat,lng 패턴
    const url = new URL(gmapUrl);
    const q = url.searchParams.get("q");
    if (q) {
      const m2 = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
  } catch (e) {}
  return null;
}

async function loadPlacesMap() {
  const mapEl = document.getElementById("villageMap");
  if (!mapEl) return;

  const key = window.__mapsKey;
  if (!key) {
    mapEl.innerHTML = `<div style="padding:32px;text-align:center;color:#9ca3af;">Google Maps API 키가 설정되지 않았습니다.</div>`;
    return;
  }

  try {
    await loadMapsScript();

    // Firestore places (visible !== false)
    const [placesSnap, merchantsSnap] = await Promise.all([
      getDocs(collection(db, "places")),
      getDocs(collection(db, "merchants")),
    ]);

    const places = [];
    placesSnap.forEach((d) => {
      const p = d.data() || {};
      if (p.visible !== false) places.push({ id: d.id, _src: "place", ...p });
    });

    // gmap 필드가 있는 활성 가맹점만 지도에 추가
    merchantsSnap.forEach((d) => {
      const m = d.data() || {};
      if (m.active !== false && m.gmap) {
        places.push({ id: d.id, _src: "merchant", name: m.name || "가맹점", type: m.career || "merchant", gmap: m.gmap, phone: m.phone || "", description: m.description || "" });
      }
    });

    // 하노이 오션파크 기본 중심
    const defaultCenter = { lat: 20.9947, lng: 105.9487 };
    const map = new google.maps.Map(mapEl, {
      center: defaultCenter,
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    if (!places.length) return;

    const bounds = new google.maps.LatLngBounds();
    const infoWindow = new google.maps.InfoWindow();
    let markerCount = 0;

    places.forEach((p) => {
      // lat/lng 직접 필드 우선, 없으면 gmap URL 파싱
      let latLng = null;
      if (typeof p.lat === "number" && typeof p.lng === "number") {
        latLng = { lat: p.lat, lng: p.lng };
      } else {
        latLng = parseLatLng(p.gmap);
      }
      if (!latLng) return;

      const isMerchant = p._src === "merchant";
      markerCount++;
      const marker = new google.maps.Marker({
        position: latLng,
        map,
        title: p.name || "",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: isMerchant ? "#f59e0b" : getMarkerColor(p.type),
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: isMerchant ? 3 : 2,
          scale: isMerchant ? 11 : 9,
        },
        zIndex: isMerchant ? 10 : 1,
      });
      bounds.extend(latLng);

      const content = isMerchant
        ? `<div style="max-width:240px;font-size:13px;line-height:1.5;">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;">★ ${escHtml(p.name)}</div>
            <div style="color:#f59e0b;margin-bottom:2px;font-size:12px;">가맹점</div>
            ${p.type        ? `<div style="color:#6b7280;">${escHtml(p.type)}</div>` : ""}
            ${p.phone       ? `<div style="color:#374151;">${escHtml(p.phone)}</div>` : ""}
            ${p.description ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(p.description)}</div>` : ""}
            <a href="${escHtml(p.gmap)}" target="_blank" rel="noopener"
               style="display:inline-block;margin-top:6px;color:#2563eb;">구글 지도에서 열기 ↗</a>
          </div>`
        : `<div style="max-width:240px;font-size:13px;line-height:1.5;">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escHtml(p.name || "")}</div>
            ${p.type    ? `<div style="color:#7c3aed;margin-bottom:2px;">${escHtml(p.type)}</div>` : ""}
            ${p.area    ? `<div style="color:#6b7280;">구역: ${escHtml(p.area)}</div>` : ""}
            ${p.address ? `<div style="color:#374151;">${escHtml(p.address)}</div>` : ""}
            ${p.phone   ? `<div style="color:#374151;">${escHtml(p.phone)}</div>` : ""}
            ${p.note    ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(p.note)}</div>` : ""}
            ${p.gmap    ? `<a href="${escHtml(p.gmap)}" target="_blank" rel="noopener"
                             style="display:inline-block;margin-top:6px;color:#2563eb;">구글 지도에서 열기 ↗</a>` : ""}
          </div>`;

      marker.addListener("click", () => {
        infoWindow.setContent(content);
        infoWindow.open(map, marker);
      });
    });

    if (markerCount > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds);
      google.maps.event.addListenerOnce(map, "bounds_changed", () => {
        if (map.getZoom() > 17) map.setZoom(17);
      });
    }
  } catch (e) {
    console.warn("loadPlacesMap failed:", e);
    mapEl.innerHTML = `<div style="padding:32px;text-align:center;color:#9ca3af;">지도를 불러오지 못했습니다.<br><small>${e.message || ""}</small></div>`;
  }
}

/* =====================
   6) 가맹점 상품 모달
===================== */
function renderProductCard(p) {
  const thumb = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
  const price = p.price ? Number(p.price).toLocaleString() + " 원" : "가격 문의";
  return `
    <a class="mp-product-card" href="/item.html?id=${escHtml(p.id)}" target="_blank" rel="noopener">
      ${thumb
        ? `<img class="mp-product-thumb" src="${escHtml(thumb)}" alt="${escHtml(p.title || "")}" loading="lazy">`
        : `<div class="mp-product-thumb-ph">🛍️</div>`}
      <div class="mp-product-body">
        <div class="mp-product-title">${escHtml(p.title || "")}</div>
        ${p.region ? `<div class="mp-product-region">📍 ${escHtml(p.region)}</div>` : ""}
        <div class="mp-product-price">${escHtml(price)}</div>
      </div>
    </a>`;
}

function closeMerchantProductModal() {
  const modal = $("merchantProductsModal");
  if (modal) modal.style.display = "none";
}

function openMerchantProductModal(ownerUid, merchantName) {
  const modal   = $("merchantProductsModal");
  const title   = $("mpModalTitle");
  const stateEl = $("mpModalState");
  const grid    = $("mpModalGrid");
  if (!modal || !grid) return;

  if (title)   title.textContent = `${merchantName || "가맹점"} 상품 목록`;
  if (stateEl) stateEl.textContent = "불러오는 중...";
  if (grid)    grid.innerHTML = "";
  modal.style.display = "flex";

  // 닫기 버튼 / 배경 클릭
  const closeBtn  = $("mpModalClose");
  const backdrop  = $("mpModalBackdrop");
  if (closeBtn) closeBtn.onclick  = closeMerchantProductModal;
  if (backdrop) backdrop.onclick  = closeMerchantProductModal;

  // ESC 키
  const onKey = (e) => {
    if (e.key === "Escape") { closeMerchantProductModal(); window.removeEventListener("keydown", onKey); }
  };
  window.addEventListener("keydown", onKey);

  // 상품 로드
  const q = query(
    collection(db, "items"),
    where("ownerUid", "==", ownerUid),
    where("status", "in", ["published", "approved"])
  );

  getDocs(q).then((snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));

    if (!list.length) {
      if (stateEl) stateEl.textContent = "등록된 상품이 없습니다.";
      return;
    }

    if (stateEl) stateEl.textContent = `총 ${list.length}개`;
    if (grid)    grid.innerHTML = list.map(renderProductCard).join("");
  }).catch((e) => {
    console.warn("loadMerchantProducts failed:", e);
    if (stateEl) stateEl.textContent = "상품 목록을 불러오지 못했습니다.";
  });
}

/* =====================
   7) 조합전용몰 상품 미리보기
===================== */
function renderCoopCard(p) {
  const imgHtml = p.imageUrl
    ? `<img class="mp-product-thumb" src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
       <div class="mp-product-thumb-ph" style="display:none;">🛍️</div>`
    : `<div class="mp-product-thumb-ph">🛍️</div>`;
  const typeBadge = p.type === 'voucher'
    ? `<span style="font-size:0.7rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:3px;">바우처</span>`
    : `<span style="font-size:0.7rem;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:3px;">일반상품</span>`;
  return `
    <a class="mp-product-card" href="/coop.html">
      ${imgHtml}
      <div class="mp-product-body">
        ${typeBadge}
        <div class="mp-product-title">${escHtml(p.name)}</div>
        <div class="mp-product-price">${(p.price || 0).toLocaleString()} 원</div>
      </div>
    </a>`;
}

async function loadCoopProducts() {
  const grid = $("coopProductsGrid");
  if (!grid) return;
  try {
    const snap = await getDocs(query(collection(db, "coopProducts"), where("active", "==", true)));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (!list.length) {
      const sec = $("coopProductsSection");
      if (sec) sec.style.display = "none";
      return;
    }
    grid.innerHTML = list.map(renderCoopCard).join("");
  } catch (e) {
    console.warn("loadCoopProducts failed:", e);
    const sec = $("coopProductsSection");
    if (sec) sec.style.display = "none";
  }
}

/* =====================
   8) 부팅
===================== */
onAuthStateChanged(auth, async (user) => {
  const admin = await isAdmin(user?.uid);
  setupAdminUI(admin);
});

loadNotices();
loadMerchants();
loadCoopProducts();
initUISlider();
loadPlacesMap();
