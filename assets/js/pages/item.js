// /assets/js/pages/item.js
import { onAuthReady } from "../auth.js";
import { auth, db, functions } from "/assets/js/firebase-init.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

import { isAdmin } from "../roles.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  addDoc,
  runTransaction,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function $(s) {
  if (!s) return null;
  const c = s[0];
  if (c === '#' || c === '.' || c === '[') return document.querySelector(s);
  return document.getElementById(s);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^0-9]/g, "");
  return plus ? "+" + digits : digits;
}

function isValidPhone(p) {
  const digits = String(p || "").replace(/[^0-9]/g, "");
  return digits.length >= 10;
}

function normalizeInfoLines(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map(x => String(x ?? '').trim()).filter(Boolean).map(s => s.replace(/^[-•*]+\s*/, ''));
  }
  if (typeof v === 'string') {
    return v.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/^[-•*]+\s*/, ''));
  }
  return [];
}

function safeText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? "";
}

function setRatingInline(id, avg, count){
  const el = document.getElementById(id);
  if(!el) return;
  const a = Number(avg) || 0;
  const c = Number(count) || 0;
  const pct = Math.max(0, Math.min(100, (a / 5) * 100));
  const avgText = (Math.round(a * 10) / 10).toFixed(1);
  el.innerHTML = `
    <span class="rating-inline">
      <span class="rating-num">${esc(avgText)}</span>
      <span class="starbar" style="--pct:${pct.toFixed(0)}%"></span>
      <span class="rating-count">(${esc(c)})</span>
    </span>
  `;
}


const CART_KEY = "jump_cart_v1";

function loadCart(){
  try{
    const raw = localStorage.getItem(CART_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    return [];
  }
}

function saveCart(arr){
  localStorage.setItem(CART_KEY, JSON.stringify(arr || []));
}

function addToCart(item){
  const cart = loadCart();
  const exists = cart.some(x => x && x.itemId === item.itemId);
  if (!exists){
    cart.push(item);
    saveCart(cart);
  }
  return { count: cart.length, existed: exists };
}

function setState(t) {
  const el = $("#itemState");
  if (el) el.textContent = t || "";
}

function showBox(show) {
  const box = $("#itemBox");
  if (!box) return;
  box.classList.toggle("hide", !show);
}

function showBlock(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  if (text) {
    el.style.display = "block";
    el.textContent = text;
  } else {
    el.style.display = "none";
    el.textContent = "";
  }
}

function toTextCategory(v) {
  const map = {
    tour_city: "시내 투어 / 시티워크",
    tour_nature: "자연 / 근교 투어",
    tour_island: "섬 / 호핑 / 해양투어",
    tour_night: "야간 / 야시장 / 야경 투어",
    activity_water: "워터 액티비티",
    activity_adventure: "어드벤처",
    spa_massage: "스파 / 마사지",
    beauty_wellness: "웰니스",
    food_restaurant: "맛집 / 레스토랑 예약",
    food_class: "쿠킹 클래스 / 로컬 푸드",
    show_event: "공연 / 이벤트",
    photo_video: "스냅사진 / 영상",
    transport_pickup: "픽업 / 차량",
    ticket_pass: "입장권 / 패스",
    cruise_boat: "크루즈 / 보트",
    stay_homestay: "홈스테이",
    stay_guesthouse: "게스트하우스",
    stay_hostel: "호스텔",
    stay_sharedhouse: "쉐어하우스 / 장기체류",
    stay_villa: "풀빌라 / 단독 숙소",
    party_local: "로컬 파티",
    party_home: "홈 파티",
    party_club: "클럽 / DJ 파티",
    party_networking: "네트워킹 모임",
  };
  return map[v] || v || "-";
}

function getIdFromQuery() {
  const id = new URLSearchParams(location.search).get("id");
  return id ? id.trim() : "";
}

function renderItem({ id, data, viewerUid, viewerIsAdmin, ownerEmail }) {
  const title = data.title || "(제목 없음)";
  const status = data.status || "-";
  const ownerUid = data.ownerUid || data.guideUid || "-";
  const category = toTextCategory(data.category);
  const price = Number.isFinite(data.price) ? data.price : (Number.isFinite(data.amount) ? data.amount : 0);
  const currency = data.currency || "KRW";
  const location = data.location || data.region || "-";
  const desc = data.desc || data.summary || "";

  // 포함/불포함/준비물: 배열(string[]) / 여러줄 문자열(string) 모두 지원
  const includes = normalizeInfoLines(data.includes ?? data.included ?? data.include ?? data.includeItems);
  const excludes = normalizeInfoLines(data.excludes ?? data.excluded ?? data.exclude ?? data.excludeItems);
  const preps = normalizeInfoLines(data.preps ?? data.preparations ?? data.preparation ?? data.prepsText);

  // 이미지: string[] 또는 {url}[] 모두 지원
  const rawImages = Array.isArray(data.images) ? data.images : [];
  const images = rawImages
    .map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? (x.url || x.src || '') : '')))
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const rejectedReason = data.rejectedReason || "";

  const isOwner = viewerUid && ownerUid === viewerUid;

  safeText("itTitle", title);
  safeText("itStatus", status);
  safeText("itCategory", category);
  safeText("itPrice", price.toLocaleString() + " " + currency);
  safeText("itLocation", location);
  safeText("itSellerEmail", ownerEmail || "-");
  safeText("itDesc", desc || "(설명 없음)");

  // 전체 데이터(운영/디버그): Firestore Timestamp 등을 보기 쉽게 변환
  const rawEl = $("itRaw");
  if (rawEl) {
    const toPlain = (v) => {
      if (v && typeof v === "object") {
        // Firestore Timestamp {seconds,nanoseconds}
        if (typeof v.seconds === "number" && typeof v.nanoseconds === "number") {
          return { _type: "Timestamp", seconds: v.seconds, nanoseconds: v.nanoseconds };
        }
        // Date
        if (v instanceof Date) return v.toISOString();
        // Array
        if (Array.isArray(v)) return v.map(toPlain);
        // Plain object
        const out = {};
        for (const k of Object.keys(v)) out[k] = toPlain(v[k]);
        return out;
      }
      return v;
    };

    try {
      rawEl.textContent = JSON.stringify(toPlain(data), null, 2);
    } catch (e) {
      rawEl.textContent = String(e?.message || e);
    }
  }

  // 포함/불포함/준비물
  const hasInfo3 = (includes.length + excludes.length + preps.length) > 0;
  const box3 = $("itInfo3");
  if (box3) box3.style.display = hasInfo3 ? "grid" : "none";

  function renderUl(targetId, arr){
    const el = $(targetId);
    if (!el) return;
    const list = (arr || []).map(v=>String(v || "").trim()).filter(Boolean);
    if (!list.length){
      el.innerHTML = `<div class="empty">-</div>`;
      return;
    }
    el.innerHTML = `<ul class="info-list">${list.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>`;
  }

  renderUl("itIncludes", includes);
  renderUl("itExcludes", excludes);
  renderUl("itPreps", preps);

  const meta = $("#itMeta");
  if (meta) {
    meta.innerHTML = `
      <span class="pill">${esc(status)}</span>
      <span class="mono">id: ${esc(id)}</span>
      ${(viewerIsAdmin || isOwner) ? `<span class="mono">ownerUid: ${esc(ownerUid)}</span>` : ""}
    `;
  }

  if (status === "rejected" && rejectedReason) {
    showBlock("itReject", "거절 사유: " + rejectedReason);
  } else {
    showBlock("itReject", "");
  }

  const okStatuses = new Set(["draft", "pending", "published", "rejected"]);
  if (!okStatuses.has(status)) {
    showBlock("itWarn", `경고: status="${status}" (표준: draft/pending/published/rejected)`);
  } else {
    showBlock("itWarn", "");
  }

  const imgWrap = $("#itImages");
  const imgCount = $("itImageCount");

  function renderSlider(container, arr){
    const list = (arr || []).map(v => String(v || "").trim()).filter(Boolean).slice(0, 20);
    if (!container) return;
    if (!list.length){
      container.innerHTML = `<div class="empty">이미지가 없습니다.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="slider-main" id="itSliderMain">
        <div class="slider-track" id="itSliderTrack">
          ${list.map((u)=>`
            <div class="slider-slide">
              <img src="${esc(u)}" alt="image" loading="lazy" draggable="false" />
            </div>
          `).join("")}
        </div>
        <div class="slider-nav" aria-hidden="true">
          <button class="slider-btn prev" type="button" id="itSlidePrev" aria-label="prev">‹</button>
          <button class="slider-btn next" type="button" id="itSlideNext" aria-label="next">›</button>
          <div class="slider-count" id="itSlideCount"></div>
        </div>
      </div>
      <div class="slider-thumbs" id="itSliderThumbs">
        ${list.map((u,i)=>`
          <div class="slider-thumb ${i===0?"is-active":""}" data-idx="${i}" title="${i+1}">
            <img src="${esc(u)}" alt="thumb" loading="lazy" draggable="false" />
          </div>
        `).join("")}
      </div>
    `;

    let idx = 0;
    const main = $("itSliderMain");
    const track = $("itSliderTrack");
    const btnPrev = $("itSlidePrev");
    const btnNext = $("itSlideNext");
    const countEl = $("itSlideCount");
    const thumbs = Array.from(container.querySelectorAll(".slider-thumb"));

    function setActiveThumb(k){
      thumbs.forEach((t) => t.classList.toggle("is-active", Number(t.dataset.idx) === k));
    }

    function update(){
      if (!track) return;
      const w = main ? main.clientWidth : 0;
      track.style.transform = `translateX(${-idx * w}px)`;
      setActiveThumb(idx);
      if (countEl) countEl.textContent = `${idx + 1} / ${list.length}`;
    }

    function go(n){
      idx = Math.max(0, Math.min(list.length - 1, n));
      update();
    }

    btnPrev?.addEventListener("click", () => go(idx - 1));
    btnNext?.addEventListener("click", () => go(idx + 1));

    thumbs.forEach((t) => {
      t.addEventListener("click", () => {
        const k = Number(t.dataset.idx || 0);
        go(k);
      });
    });

    // Drag/Swipe (pointer events)
    if (main && track){
      let isDown = false;
      let startX = 0;
      let startT = 0;

      const getX = (ev) => (typeof ev.clientX === "number" ? ev.clientX : 0);

      const onDown = (ev) => {
        if (list.length <= 1) return;
        isDown = true;
        startX = getX(ev);
        startT = -idx * main.clientWidth;
        track.classList.add("is-dragging");
        try { main.setPointerCapture(ev.pointerId); } catch(_){ }
      };

      const onMove = (ev) => {
        if (!isDown) return;
        const dx = getX(ev) - startX;
        track.style.transform = `translateX(${startT + dx}px)`;
      };

      const onUp = (ev) => {
        if (!isDown) return;
        isDown = false;
        track.classList.remove("is-dragging");
        const dx = getX(ev) - startX;
        const threshold = Math.max(50, main.clientWidth * 0.18);
        if (dx <= -threshold) go(idx + 1);
        else if (dx >= threshold) go(idx - 1);
        else update();
      };

      main.addEventListener("pointerdown", onDown);
      main.addEventListener("pointermove", onMove);
      main.addEventListener("pointerup", onUp);
      main.addEventListener("pointercancel", onUp);
      main.addEventListener("lostpointercapture", onUp);

      window.addEventListener("resize", () => update());
    }

    update();
  }

  if (imgWrap) {
    if (imgCount) imgCount.textContent = images.length ? `(${images.slice(0,20).length}장)` : "";
    renderSlider(imgWrap, images);
  }

  return { ownerUid, status, title, price, booking: getBooking(data) };
}

function tsSeconds(v) {
  if (!v) return 0;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds;
  return 0;
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}


function fmtDate(ts) {
  const s = tsSeconds(ts);
  if (!s) return "";
  const d = new Date(s * 1000);
  return d.toISOString().slice(0, 10);
}

function starText(n) {
  const k = Math.max(1, Math.min(5, Number(n) || 0));
  return "★★★★★☆☆☆☆☆".slice(0, k) + "☆☆☆☆☆".slice(0, 5 - k);
}

async function loadReviews(itemId) {
  // SSOT: top-level reviews/{orderId}
  // NOTE: where+orderBy 조합은 복합 인덱스가 필요할 수 있어, where만 사용하고 클라이언트에서 정렬합니다.
  const q = query(
    collection(db, "reviews"),
    where("itemId", "==", itemId),
    limit(300)
  );

  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => out.push({ _id: d.id, ...d.data() }));

  // visible=false(숨김) 은 사용자 화면에서 제외
  const visible = out.filter((r) => r.visible !== false);

  // createdAt 내림차순 정렬
  const toSec = (v) => {
    if (!v) return 0;
    if (typeof v === "object" && typeof v.seconds === "number") return v.seconds;
    return 0;
  };
  visible.sort((a, b) => toSec(b.createdAt) - toSec(a.createdAt));

  return visible.slice(0, 30);
}

function renderReviews(list) {
  const wrap = $("#rvList");
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `<div class="empty">아직 리뷰가 없습니다.</div>`;
    setRatingInline("rvAvg", 0, 0);
    return;
  }

  const sum = list.reduce((a, r) => a + (Number(r.rating) || 0), 0);
  const avg = Math.round((sum / list.length) * 10) / 10;

  setRatingInline("rvAvg", avg, list.length);

  wrap.innerHTML = list.map((r) => {
    const name = r.authorName || r.displayName || "익명";
    const rating = Number(r.rating) || 0;
    const date = fmtDate(r.updatedAt || r.createdAt);
    const text = r.text || "";
    return `
      <div class="review-item">
        <div class="review-top">
          <div class="review-name">${esc(name)}</div>
          <div class="review-meta">
            <span>${esc(starText(rating))}</span>
            <span>${esc(date)}</span>
          </div>
        </div>
        <div class="review-text">${esc(text)}</div>
      </div>
    `;
  }).join("");
}

// 리뷰 작성은 주문 기반(review.html)으로만 진행

/* 주문 저장 */
function setOrderState(t) {
  const el = $("#orderState");
  if (el) el.textContent = t || "";
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso, days){
  const t = Date.parse(iso + "T00:00:00Z");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + days * 86400000);
  return d.toISOString().slice(0,10);
}

function isoToMsLocal(iso){
  const t = Date.parse(iso + "T00:00:00");
  return Number.isFinite(t) ? t : 0;
}

function datesInRange(startISO, endISO){
  // 레거시: start~end inclusive
  const out = [];
  const s = isoToMsLocal(startISO);
  const e = isoToMsLocal(endISO);
  if(!s || !e) return out;
  if(e < s) return out;
  const days = Math.min(90, Math.floor((e - s) / 86400000));
  for(let i=0;i<=days;i++) out.push(addDaysISO(startISO, i));
  return out;
}

function nightsBetween(startISO, endISO){
  const s = isoToMsLocal(startISO);
  const e = isoToMsLocal(endISO);
  if(!s || !e) return 0;
  const diff = Math.floor((e - s) / 86400000);
  return diff > 0 ? diff : 0;
}

function datesInStay(startISO, endISO){
  // 숙박 기준: 체크아웃 날짜는 포함하지 않음
  const out = [];
  const nights = nightsBetween(startISO, endISO);
  if(nights <= 0) return out;
  const maxN = Math.min(90, nights);
  for(let i=0;i<maxN;i++) out.push(addDaysISO(startISO, i));
  return out;
}

function getBooking(data){
  const b = (data && typeof data.booking === "object" && data.booking) ? data.booking : {};
  const mode = String(b.mode || "date_single");
  const weekdays = Array.isArray(b.weekdays) ? b.weekdays.filter(n=>Number.isInteger(n) && n>=0 && n<=6) : [];
  const capacity = Number.isFinite(Number(b.capacity)) ? Number(b.capacity) : 0;
  return { mode, weekdays, capacity };
}

function weekdayKorean(n){
  return ({0:"일",1:"월",2:"화",3:"수",4:"목",5:"금",6:"토"})[n] || "-";
}

function weekdaysText(arr){
  const list = Array.isArray(arr) ? arr : [];
  return list.map(weekdayKorean).join("/");
}

function initOrderDefault(mode){
  const t = todayISO();
  const od = $("#odDate");
  const os = $("#odStart");
  const oe = $("#odEnd");

  if (mode === "date_range"){
    if (os && !os.value) os.value = t;
    if (oe && !oe.value) oe.value = addDaysISO(t, 1);
  } else {
    if (od && !od.value) od.value = t;
  }
}

function setBookingUI(booking){
  const m = String(booking?.mode || "date_single");
  const rowSingle = $("#odRowSingle");
  const rowRange = $("#odRowRange");
  const rowFixed = $("#odRowFixed");

  if (rowSingle) rowSingle.style.display = (m === "date_single") ? "flex" : "none";
  if (rowRange) rowRange.style.display = (m === "date_range") ? "flex" : "none";
  if (rowFixed) rowFixed.style.display = (m === "fixed_weekdays") ? "flex" : "none";

  const info = $("#odFixedInfo");
  if (info && m === "fixed_weekdays"){
    const wd = weekdaysText(booking.weekdays || []);
    info.textContent = wd ? `운영 요일: ${wd} (자동 배정)` : "운영 요일 기준 자동 배정";
  }
}

function fmtMoney(v){
  const n = Number(v);
  if(!Number.isFinite(n)) return "0";
  try{ return n.toLocaleString("ko-KR"); }catch{ return String(Math.round(n)); }
}

function updatePayUI({ booking, unitPrice }){
  const mode = String(booking?.mode || "date_single");
  const people = parseInt($("odPeople")?.value || "1", 10);
  const startDate = ($("odStart")?.value || "").trim();
  const endDate = ($("odEnd")?.value || "").trim();

  const totalEl = $("odPayTotal");
  const breakEl = $("odPayBreak");
  if(!totalEl || !breakEl) return;

  const u = Number(unitPrice) || 0;

  if(mode === "date_range"){
    const nights = nightsBetween(startDate, endDate);
    const total = nights > 0 ? (u * nights) : 0;
    totalEl.textContent = `${fmtMoney(total)} 원`;
    breakEl.textContent = nights > 0
      ? `1박당 ${fmtMoney(u)}원 × ${nights}박 = ${fmtMoney(total)}원 → HEX 자동 환산`
      : "체크인/체크아웃을 선택하세요";
    return;
  }

  // 단일/요일고정
  totalEl.textContent = `${fmtMoney(u)} 원`;
  breakEl.textContent = (Number.isFinite(people) && people > 1)
    ? `기본 금액 ${fmtMoney(u)}원 (인원 ${people}명) → HEX 자동 환산`
    : "현재 환율 기준 HEX로 자동 환산됩니다";
}

function pickNextDateByWeekdays(weekdays, startISO){
  const base = startISO || todayISO();
  const set = new Set((weekdays || []).map(Number));
  if (!set.size) return "";
  // 최대 60일 안에서 찾기
  for (let i=0;i<60;i++){
    const iso = addDaysISO(base, i);
    const d = new Date(Date.parse(iso + "T00:00:00"));
    const wd = d.getDay(); // 0..6
    if (set.has(wd)) return iso;
  }
  return "";
}

async function createOrder({ itemId, itemTitle, ownerUid, price, user, booking }) {
  const mode = String(booking?.mode || "date_single");
  const cap = Number(booking?.capacity || 0); // 0=무제한

  const people = parseInt($("#odPeople")?.value || "1", 10);
  const phone = normalizePhone($("#odPhone")?.value || "");
  const kakaoId = ($("#odKakaoId")?.value || "").trim();
  const agreeKakao = Boolean($("#odAgreeKakao")?.checked);
  const payment = ($("#odPay")?.value || "card").trim();
  const memo = ($("#odMemo")?.value || "").trim();

  let date = "";
  let startDate = "";
  let endDate = "";
  let bookingDates = [];
  let weekdayCandidates = [];

  if (!Number.isFinite(people) || people < 1) throw new Error("인원은 1 이상이어야 합니다.");
  if (!isValidPhone(phone)) throw new Error("휴대폰 번호를 입력하세요. (예: +82 10 1234 5678)");
  if (agreeKakao && !isValidPhone(phone)) throw new Error("알림 수신 동의 시 휴대폰 번호가 필요합니다.");

  if (mode === "date_range"){
    startDate = ($("#odStart")?.value || "").trim();
    endDate = ($("#odEnd")?.value || "").trim();
    if (!startDate || !endDate) throw new Error("예약 기간(시작/종료)을 입력하세요.");
    if (isoToMsLocal(endDate) < isoToMsLocal(startDate)) throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
    bookingDates = datesInStay(startDate, endDate);
    if (!bookingDates.length) throw new Error("체크아웃은 체크인 다음날 이후로 선택하세요.");
    date = startDate;
  } else if (mode === "fixed_weekdays"){
    // 후보일(운영 요일) 목록 생성: 오늘~60일
    const start = todayISO();
    const set = new Set((booking.weekdays || []).map(Number));
    if (!set.size) throw new Error("운영 요일이 설정되지 않았습니다.");
    for (let i=0;i<60;i++){
      const iso = addDaysISO(start, i);
      const d = new Date(Date.parse(iso + "T00:00:00"));
      if (set.has(d.getDay())) weekdayCandidates.push(iso);
    }
    if (!weekdayCandidates.length) throw new Error("운영 요일 기준으로 예약 가능한 날짜를 찾을 수 없습니다.");
    // 실제 확정은 트랜잭션에서(정원 체크 포함)
  } else {
    date = ($("#odDate")?.value || "").trim();
    if (!date) throw new Error("예약 날짜를 입력하세요.");
    bookingDates = [date];
  }

  const now = new Date();
  const settlementMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // 금액 계산
  const unitPrice = Number.isFinite(price) ? price : 0;
  const nights = (mode === "date_range") ? nightsBetween(startDate, endDate) : 0;
  const totalAmount = (mode === "date_range") ? (unitPrice * nights) : unitPrice;

  // 슬롯(날짜별 정원) 예약 + 주문 저장을 트랜잭션으로 처리
  const ordersCol = collection(db, "orders");
  const slotsCol = collection(db, "slots");
  const orderRef = doc(ordersCol);

  const basePayload = {
    itemId,
    itemTitle: String(itemTitle || ""),

    // guide
    ownerUid,                 // legacy
    guideUid: ownerUid || "", // SSOT

    // buyer
    buyerUid: user.uid,
    buyerName: user.displayName || user.email || "buyer",
    buyerEmail: user.email || "",

    // contact
    buyerPhone: phone,
    buyerKakaoId: kakaoId,
    agreeKakao,

    // booking (최종 확정은 트랜잭션에서)
    bookingMode: mode,
    date: date || "",
    startDate: startDate || "",
    endDate: endDate || "",
    bookingDates: bookingDates,
    people,
    payment,
    memo,

    // amount
    unitPrice,
    nights,
    amount: totalAmount,
    price: totalAmount,
    currency: "KRW",

    // settlement flow
    // NOTE:
    // - 예약 생성 시점에는 결제가 확정되지 않은 상태가 일반적입니다.
    // - 일부 Firestore rules(이전 버전)에서는 buyer가 status/paymentStatus를 "paid"로 저장하는 것을 막을 수 있어
    //   기본값을 pending으로 둡니다.
    status: "pending",
    paymentStatus: "pending",
    settlementMonth,

    // 결제 확정 시점에만 채움(관리자 결제확인/카드결제 연동 시)
    paidAt: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const oid = await runTransaction(db, async (tx) => {
    let finalDate = date;
    let finalBookingDates = bookingDates;

    if (mode === "fixed_weekdays"){
      // 정원 제한이 없으면 가장 빠른 후보일로 확정
      if (cap <= 0){
        finalDate = weekdayCandidates[0];
        finalBookingDates = [finalDate];
      } else {
        // 정원 체크하면서 가능한 날짜를 찾기
        let picked = "";
        for (const c of weekdayCandidates){
          const slotId = `${itemId}__${c}`;
          const slotRef = doc(slotsCol, slotId);
          const snap = await tx.get(slotRef);
          const s = snap.exists() ? (snap.data() || {}) : {};
          const booked = Number(s.booked || 0);
          const capacity = Number.isFinite(Number(s.capacity)) ? Number(s.capacity) : cap;
          if (booked + people <= capacity){
            picked = c;
            break;
          }
        }
        if (!picked) throw new Error("운영 요일의 모든 날짜가 예약 마감입니다.");
        finalDate = picked;
        finalBookingDates = [picked];
      }
    }

    // 정원 제한이 있을 때만 슬롯 체크
    // 중요: Firestore 트랜잭션은 "모든 read -> 그 다음 write" 순서를 강제합니다.
    // 따라서 날짜가 여러 개일 때 "읽고 쓰고 읽고 쓰기"를 하면 오류가 납니다.
    // (Firestore transactions require all reads to be executed before all writes.)
    if (cap > 0){
      const slots = [];

      // 1) 먼저 모든 슬롯을 읽는다
      for (const d of finalBookingDates){
        const slotId = `${itemId}__${d}`;
        const slotRef = doc(slotsCol, slotId);
        const snap = await tx.get(slotRef);
        const s = snap.exists() ? (snap.data() || {}) : {};
        const booked = Number(s.booked || 0);
        const capacity = Number.isFinite(Number(s.capacity)) ? Number(s.capacity) : cap;
        slots.push({ d, slotRef, snapExists: snap.exists(), booked, capacity });
      }

      // 2) 읽은 결과로 모두 검증(하나라도 마감이면 전체 실패)
      for (const s of slots){
        if (s.booked + people > s.capacity){
          throw new Error(`해당 날짜는 예약이 마감되었습니다: ${s.d}`);
        }
      }

      // 3) 이제 write를 수행(여기부터는 추가 read 금지)
      for (const s of slots){
        if (!s.snapExists){
          tx.set(s.slotRef, {
            itemId,
            date: s.d,
            capacity: s.capacity,
            booked: s.booked + people,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          });
        } else {
          tx.update(s.slotRef, {
            booked: s.booked + people,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    const orderPayload = {
      ...basePayload,
      date: finalDate,
      bookingDates: finalBookingDates,
    };

    tx.set(orderRef, orderPayload);
    return orderRef.id;
  });

  return oid;
}

function bindOrder({ itemId, itemTitle, ownerUid, status, price, user, booking }) {
  const form = $("#orderForm");
  const hint = $("#orderHint");
  const mini = $("#orderMini");

  if (mini) mini.textContent = "HEX 토큰 결제 전용 · 원화 기준 자동 환산";

  if (!user) {
    if (form) form.style.display = "none";
    if (hint) {
      hint.style.display = "block";
      hint.textContent = "예약/구매는 로그인 후 가능합니다.";
    }
    return;
  }

  if (ownerUid === user.uid) {
    if (form) form.style.display = "none";
    if (hint) {
      hint.style.display = "block";
      hint.textContent = "본인 상품에는 예약/구매 요청을 할 수 없습니다.";
    }
    return;
  }

  if (!["published","approved"].includes(status)) {
    if (form) form.style.display = "none";
    if (hint) {
      hint.style.display = "block";
      hint.textContent = "공개(published)된 상품만 예약/구매 요청이 가능합니다.";
    }
    return;
  }

  if (hint) hint.style.display = "none";
  if (form) form.style.display = "block";
  setBookingUI(booking);
  initOrderDefault(String(booking?.mode || "date_single"));

  // 결제 금액 표시
  updatePayUI({ booking, unitPrice: price });

  // 입력 변경 시 자동 갱신
  const refresh = () => updatePayUI({ booking, unitPrice: price });
  $("odPeople")?.addEventListener("change", refresh);
  $("odPeople")?.addEventListener("input", refresh);
  $("odStart")?.addEventListener("change", refresh);
  $("odEnd")?.addEventListener("change", refresh);
  $("odDate")?.addEventListener("change", refresh);

  // 요일 고정 상품: 미리보기(정원 고려 전)
  if (String(booking?.mode || "") === "fixed_weekdays"){
    const prev = $("#odFixedPreview");
    if (prev){
      const next = pickNextDateByWeekdays(booking.weekdays || [], todayISO());
      prev.textContent = next ? (`예상 예약일: ${next}`) : "";
    }
  }

  // ── HEX 결제 ──────────────────────────────────────
  const btnHexPay  = $("#btnHexPay");
  const hexPayInfo = $("#hexPayInfo");

  function getBookingParams() {
    const mode      = String(booking?.mode || "date_single");
    const people    = parseInt($("#odPeople")?.value || "1", 10);
    const phone     = normalizePhone($("#odPhone")?.value || "");
    const memo      = ($("#odMemo")?.value || "").trim();
    const date      = mode !== "date_range" ? ($("#odDate")?.value || "").trim() : "";
    const startDate = mode === "date_range"  ? ($("#odStart")?.value || "").trim() : "";
    const endDate   = mode === "date_range"  ? ($("#odEnd")?.value || "").trim()   : "";
    return { mode, people, phone, memo, date, startDate, endDate };
  }

  // 금액 미리보기 (버튼 클릭 전 안내)
  function updateHexInfo() {
    if (!hexPayInfo) return;
    const { mode, startDate, endDate } = getBookingParams();
    const u = Number(price) || 0;
    if (mode === "date_range") {
      const n = nightsBetween(startDate, endDate);
      const total = n > 0 ? u * n : 0;
      hexPayInfo.textContent = total > 0
        ? `HEX 즉시결제 예상 금액: ${fmtMoney(total)} KRW (현재 환율로 HEX 자동 환산)`
        : "체크인/체크아웃 날짜를 선택하세요.";
    } else {
      hexPayInfo.textContent = u > 0
        ? `HEX 즉시결제 예상 금액: ${fmtMoney(u)} KRW (현재 환율로 HEX 자동 환산)`
        : "금액 정보가 없습니다.";
    }
    hexPayInfo.style.display = "block";
  }

  if (btnHexPay) {
    // 날짜 변경 시 안내 갱신
    $("#odDate")?.addEventListener("change",  updateHexInfo);
    $("#odStart")?.addEventListener("change", updateHexInfo);
    $("#odEnd")?.addEventListener("change",   updateHexInfo);
    updateHexInfo();

    btnHexPay.addEventListener("click", async () => {
      const { mode, people, phone, memo, date, startDate, endDate } = getBookingParams();

      // 기본 검증
      if (!isValidPhone(phone)) {
        alert("휴대폰 번호를 입력하세요.");
        return;
      }
      if (mode === "date_range" && (!startDate || !endDate)) {
        alert("체크인/체크아웃 날짜를 선택하세요.");
        return;
      }
      if (mode === "date_single" && !date) {
        alert("예약 날짜를 선택하세요.");
        return;
      }

      // 확인
      const { mode: _m, startDate: s, endDate: e } = { mode, startDate, endDate };
      const nights = mode === "date_range" ? nightsBetween(s, e) : 0;
      const total  = mode === "date_range" ? (Number(price) * nights) : Number(price);
      const confirm_msg =
        `HEX 즉시결제를 진행합니다.\n` +
        `금액: ${fmtMoney(total)} KRW (현재 환율로 HEX 자동 환산)\n` +
        `수탁 지갑 HEX 잔액에서 차감됩니다.\n\n계속하시겠습니까?`;
      if (!confirm(confirm_msg)) return;

      try {
        btnHexPay.disabled = true;
        setOrderState("HEX 결제 처리 중... (온체인 서명, 잠시 기다려 주세요)");

        const callFn = httpsCallable(functions, "payProductWithHex");
        const result = await callFn({
          itemId,
          bookingMode: mode,
          date,
          startDate,
          endDate,
          people,
          phone,
          memo,
        });

        const data = result?.data || {};
        setOrderState("");
        alert(
          `결제 완료!\n` +
          `결제 금액: ${data.hexAmountDisplay || ""}\n` +
          `TX: ${(data.txHash || "").slice(0, 18)}...`
        );

        if (data.orderId) {
          location.href = `./order_detail.html?id=${encodeURIComponent(data.orderId)}`;
        }
      } catch (e) {
        console.error(e);
        const msg = e?.message || String(e);
        setOrderState("HEX 결제 실패: " + msg);
        alert("HEX 결제 실패:\n" + msg);
      } finally {
        btnHexPay.disabled = false;
      }
    });
  }
}

async function main({ user, profile }) {
  const id = getIdFromQuery();
  if (!id) {
    setState("오류: id 파라미터가 없습니다. 예) /item.html?id=문서ID");
    showBox(false);
    return;
  }

  setState("불러오는 중...");
  showBox(false);

  try {
    const snap = await getDoc(doc(db, "items", id));
    if (!snap.exists()) {
      setState("상품이 존재하지 않습니다.");
      showBox(false);
      return;
    }

    const data = snap.data();
    const viewerUid = user?.uid || "";
    const viewerIsAdmin = isAdmin(profile);

    // 판매자 이메일 조회
    const ownerUidForEmail = data.ownerUid || data.guideUid || "";
    let ownerEmail = "-";
    if (ownerUidForEmail) {
      try {
        const ownerSnap = await getDoc(doc(db, "users", ownerUidForEmail));
        ownerEmail = ownerSnap.data()?.email || "-";
      } catch (_) { /* 권한 없으면 무시 */ }
    }

    const itemInfo = renderItem({ id, data, viewerUid, viewerIsAdmin, ownerEmail });

    setState("");
    showBox(true);

    const reviews = await loadReviews(id);
    renderReviews(reviews);

    // 리뷰 작성(주문 기반) 안내
    const form = $("#rvFormWrap");
    const hint = $("#rvHint");
    if (form) form.style.display = "none";
    if (hint) {
      hint.style.display = "block";
      hint.textContent = "리뷰 작성은 주문 완료 후 '내 주문'에서 진행됩니다.";
    }

    // 예약/구매
    bindOrder({
      itemId: id,
      itemTitle: itemInfo.title,
      ownerUid: itemInfo.ownerUid,
      status: itemInfo.status,
      price: itemInfo.price,
      booking: itemInfo.booking,
      user,
    });

  } catch (e) {
    console.error(e);
    const msg = e?.message || String(e);

    if (msg.includes("Missing or insufficient permissions")) {
      setState("권한 문제: 현재 계정이 이 상품을 읽을 권한이 없습니다. (rules 확인)");
    } else {
      setState("오류: " + msg);
    }
    showBox(false);
  }
}

onAuthReady(async ({ user, profile }) => {
  await main({ user, profile });
});