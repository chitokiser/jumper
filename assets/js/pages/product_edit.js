// /assets/js/pages/product_edit.js
// 상품 수정: 20장 이미지 + 포함/불포함/준비물(배열 저장) 통합

import { db, onAuthReady } from "../auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "../firestore-bridge.js";

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

function deriveItemType(category){
  return isHomestayCategory(category) ? "homestay" : "experience";
}
const $ = (id) => document.getElementById(id);

function setMsg(t){
  const el = $("saveMsg");
  if(el) el.textContent = t || "";
}

function qs(name){
  return new URLSearchParams(location.search).get(name);
}

function v(id){
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function parseLines(text){
  return String(text || "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^[-•*]+\s*/, ""));
}

function linesToText(v){
  if(!v) return "";
  if(Array.isArray(v)) return v.map(x => String(x ?? "").trim()).filter(Boolean).join("\n");
  if(typeof v === "string") return v.trim();
  return "";
}

function uniqNonEmpty(arr){
  const out = [];
  const set = new Set();
  for(const x of (arr || [])){
    const s = String(x || "").trim();
    if(!s) continue;
    if(set.has(s)) continue;
    set.add(s);
    out.push(s);
  }
  return out;
}

function readWeekdays(){
  const ids = ["pWd0","pWd1","pWd2","pWd3","pWd4","pWd5","pWd6"];
  const out = [];
  for (const id of ids){
    const el = $(id);
    if (el && el.checked){
      const n = Number(el.value);
      if (Number.isInteger(n) && n >= 0 && n <= 6) out.push(n);
    }
  }
  const order = [1,2,3,4,5,6,0];
  out.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  return out;
}

function bindBookingUI(){
  const mode = v("pBookMode") || "date_single";
  const box = $("pWeekdaysBox");
  if (box) box.style.display = (mode === "fixed_weekdays") ? "block" : "none";
}

function normalizeImages(data){
  // string[] 또는 {url}[] 모두 지원
  const raw = Array.isArray(data?.images) ? data.images : (data?.imageUrl ? [data.imageUrl] : []);
  return uniqNonEmpty(raw.map(x => (typeof x === "string") ? x : (x && typeof x === "object" ? (x.url || x.src || "") : "")));
}

onAuthReady(async ({ loggedIn, role, user })=>{
  if(!loggedIn){
    alert("로그인이 필요합니다.");
    location.href = "./guide.html";
    return;
  }
  if(!(role === "guide" || role === "merchant" || role === "admin")){
    alert("가이드 또는 가맹점 승인 후 이용 가능합니다.");
    location.href = "./guide.html";
    return;
  }

  const id = qs("id");
  const from = (qs("from") || "").toLowerCase();
  if(!id){
    alert("잘못된 접근입니다. (id 없음)");
    location.href = "./my_products.html";
    return;
  }

  const form = $("formProduct");
  if(!form) return;

  const ref = doc(db, "items", id);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    alert("상품을 찾을 수 없습니다.");
    location.href = "./my_products.html";
    return;
  }

  const data = snap.data() || {};
  const back = $("backLink");
  if(back){
    back.href = (from === "admin") ? "/admin.html?tab=items&status=" + encodeURIComponent(String(data.status || "pending")) : "./my_products.html";
    back.textContent = (from === "admin") ? "← 관리자 상품목록" : "← 내 놀거리";
  }
  const ownerUid = data.ownerUid || data.guideUid || "";
  if(role !== "admin" && ownerUid !== user.uid){
    alert("내 상품만 수정할 수 있습니다.");
    location.href = "./my_products.html";
    return;
  }

  // ===== 폼 채우기 =====
  $("pTitle").value = data.title || "";
  $("pCategory").value = data.category || "";
  $("pRegion").value = data.region || data.location || "";
  $("pPrice").value = (data.price ?? "") === null ? "" : String(data.price ?? "");
  if ($("pCurrency")) $("pCurrency").value = data.currency || "KRW";
  $("pDesc").value = data.desc || "";

  // 관리자 전용: 상태 선택 필드 활성화
  if (role === "admin") {
    const statusBox = $("pStatusBox");
    const statusSel = $("pStatus");
    if (statusBox) statusBox.style.display = "";
    if (statusSel) statusSel.value = data.status || "pending";
  }

  // 예약 설정
  const booking = (data.booking && typeof data.booking === "object") ? data.booking : {};
  const mode = String(booking.mode || "date_single");
  const weekdays = Array.isArray(booking.weekdays) ? booking.weekdays : [];
  const capacity = (booking.capacity ?? "") === null ? "" : String(booking.capacity ?? "");

  const bm = $("pBookMode");
  if (bm) bm.value = mode;
  const capEl = $("pCapacity");
  if (capEl) capEl.value = capacity === "" ? "0" : capacity;

  ["pWd0","pWd1","pWd2","pWd3","pWd4","pWd5","pWd6"].forEach((id)=>{
    const el = $(id);
    if (!el) return;
    const n = Number(el.value);
    el.checked = weekdays.includes(n);
  });

  $("pBookMode")?.addEventListener("change", bindBookingUI);
  bindBookingUI();

  // info3 (여러 키 호환)
  $("pIncludes").value = linesToText(data.includes ?? data.included ?? data.include ?? data.includeItems);
  $("pExcludes").value = linesToText(data.excludes ?? data.excluded ?? data.exclude ?? data.excludeItems);
  $("pPreparations").value = linesToText(data.preps ?? data.preparations ?? data.preparation ?? data.prepsText);

  // images: 최대 20
  const imgs = normalizeImages(data).slice(0, 20);
  for(let i=0;i<20;i++){
    const el = $(`pImage${i+1}`);
    if(el) el.value = imgs[i] || "";
  }

  // ===== 저장 =====
  form.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    setMsg("");

    const btn = $("btnSave");
    if(btn) btn.disabled = true;

    try{
      const title = v("pTitle");
      const category = v("pCategory");
      const region = v("pRegion");
      const priceRaw = v("pPrice");
      const price = priceRaw === "" ? "" : Number(priceRaw);
      const currency = v("pCurrency") || "KRW";
      const desc = v("pDesc");

      // 관리자: 상태 직접 설정 가능
      const newStatus = (role === "admin" && $("pStatus"))
        ? (v("pStatus") || data.status || "pending")
        : ((role === "admin") ? (data.status || "pending") : "pending");

      // 예약 설정
      const bookMode = v("pBookMode") || "date_single";
      const weekdays = readWeekdays();
      const capacityRaw = v("pCapacity");
      const capacity = capacityRaw === "" ? 0 : Number(capacityRaw);

      const includes = parseLines(v("pIncludes"));
      const excludes = parseLines(v("pExcludes"));
      const preps = parseLines(v("pPreparations"));

      const imagesRaw = Array.from({ length: 20 }, (_, i) => v(`pImage${i + 1}`)).filter(Boolean);
      const images = uniqNonEmpty(imagesRaw).slice(0, 20);
      const imageUrl = images[0] || "";

      if(!title || !category || !region){
        alert("상품명/카테고리/지역은 필수입니다.");
        return;
      }
      if(price !== "" && !Number.isFinite(price)){
        alert("가격 입력이 올바르지 않습니다.");
        return;
      }

      if (bookMode === "fixed_weekdays" && !weekdays.length){
        alert("요일 고정 상품은 운영 요일을 1개 이상 선택해 주세요.");
        return;
      }

      if (capacityRaw !== "" && (!Number.isFinite(capacity) || capacity < 0)){
        alert("같은 날짜 예약 가능한 수(정원/객실 수)를 올바르게 입력해 주세요.");
        return;
      }

      await updateDoc(ref, {
        title,
        category,
        type: deriveItemType(category),
        region,
        location: region,
        price,
        currency,
        desc,

        includes,
        excludes,
        preps,

        images,
        imageUrl,

        status: newStatus,

        updatedAt: serverTimestamp(),

        booking: {
          mode: bookMode,
          weekdays: (bookMode === "fixed_weekdays") ? weekdays : [],
          capacity: Number.isFinite(capacity) ? capacity : 0,
        },
      });

      if (role === "admin") {
        setMsg(`저장 완료 (상태: ${newStatus})`);
        alert(`저장되었습니다.\n상태: ${newStatus}`);
        location.href = "/admin.html?tab=items&status=" + encodeURIComponent(newStatus);
      } else {
        setMsg("저장 완료: 검수 대기(pending)");
        alert("저장되었습니다. (검수 대기)");
        location.href = "./my_products.html?updated=" + encodeURIComponent(id);
      }
    }catch(err){
      console.error(err);
      alert("저장 실패: " + (err?.message || String(err)));
    }finally{
      if(btn) btn.disabled = false;
    }
  });
});
