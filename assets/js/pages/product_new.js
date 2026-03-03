// /assets/js/pages/product_new.js
// 가이드 상품 등록 (입력 안되는 문제 해결 + 운영용 UX)
//
// 원인/해결
// - 기존: firestore-bridge.js에 없는 export(getMyProfile 등)를 import → 모듈 로드 실패 → 폼 동작 안함
// - 수정: auth.js(onAuthReady)로 권한 확인, firestore-bridge.js에서 제공하는 함수만 import
// - 준비물 id 불일치: pPreparations / pPreps 둘 다 지원
// - item.js 호환: includes/excludes/preps는 배열(string[]) 저장
// - 상세 지역 호환: region + location 둘 다 저장

import { onAuthReady, db } from "../auth.js";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "../firestore-bridge.js";

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

function setMsg(t) {
  const el = $("saveMsg");
  if (el) el.textContent = t || "";
}

function v(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function parseLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[-•*]+\s*/, ""));
}

async function getGuideName(uid, fallback) {
  try {
    const gRef = doc(db, "guides", uid);
    const gSnap = await getDoc(gRef);
    if (gSnap.exists()) {
      const g = gSnap.data() || {};
      if (g.name) return g.name;
    }
  } catch (e) {
    console.warn("guides read:", e?.code || e?.message || e);
  }
  return fallback || "가이드";
}

function fillTemplate() {
  const inc = $("pIncludes");
  const exc = $("pExcludes");
  const pre = $("pPreparations");

  if (inc && !inc.value.trim()) {
    inc.value = [
      "- 호텔 픽업(또는 지정장소 집결)",
      "- 가이드/스태프",
      "- 기본 입장권/이용권(해당 시)",
    ].join("\n");
  }
  if (exc && !exc.value.trim()) {
    exc.value = [
      "- 개인 경비",
      "- 개인 식사/음료",
      "- 여행자 보험",
    ].join("\n");
  }
  if (pre && !pre.value.trim()) {
    pre.value = [
      "- 여권/신분증(필요 시)",
      "- 편한 복장/신발",
      "- 선크림/모자(야외 시)",
    ].join("\n");
  }
}

function clearForm() {
  [
    "pTitle","pRegion","pPrice","pDesc",
    "pIncludes","pExcludes","pPreparations",
    "pCapacity",
    ...Array.from({ length: 20 }, (_, i) => `pImage${i + 1}`),
  ].forEach((id) => { const el = $(id); if (el) el.value = ""; });

  const cat = $("pCategory"); if (cat) cat.value = "";

  const bm = $("pBookMode"); if (bm) bm.value = "date_single";
  const cap = $("pCapacity"); if (cap) cap.value = "10";
  ["pWd0","pWd1","pWd2","pWd3","pWd4","pWd5","pWd6"].forEach((id)=>{
    const c = $(id);
    if (c) c.checked = false;
  });
}

function readWeekdays(){
  const ids = ["pWd0","pWd1","pWd2","pWd3","pWd4","pWd5","pWd6"];
  const out = [];
  for(const id of ids){
    const el = $(id);
    if (el && el.checked){
      const n = Number(el.value);
      if (Number.isInteger(n) && n >= 0 && n <= 6) out.push(n);
    }
  }
  // 월~일 순서로 보이게 정렬 (1..6,0)
  const order = [1,2,3,4,5,6,0];
  out.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  return out;
}

function bindBookingUI(){
  const mode = v("pBookMode") || "date_single";
  const box = $("pWeekdaysBox");
  if (box) box.style.display = (mode === "fixed_weekdays") ? "block" : "none";
}

onAuthReady(async ({ loggedIn, role, user }) => {
  if (!loggedIn) {
    alert("로그인이 필요합니다.");
    location.href = "./guide.html";
    return;
  }
  if (!(role === "guide" || role === "merchant" || role === "admin")) {
    alert("가이드 또는 가맹점 승인 후 상품 등록이 가능합니다.");
    location.href = "./guide.html";
    return;
  }

  const form = $("formProduct");
  if (!form) return;

  $("btnFillTemplate")?.addEventListener("click", fillTemplate);
  $("btnClearForm")?.addEventListener("click", () => {
    if (!confirm("입력값을 모두 지울까요?")) return;
    clearForm();
  });

  $("pBookMode")?.addEventListener("change", bindBookingUI);
  bindBookingUI();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setMsg("");

    const btn = $("btnSave");
    if (btn) btn.disabled = true;

    try {
      const title = v("pTitle");
      const category = v("pCategory");
      const region = v("pRegion");
      const price = Number(v("pPrice") || "0");
      const currency = "KRW";
      const desc = v("pDesc");

      // 예약 설정
      const bookMode = v("pBookMode") || "date_single";
      const capacityRaw = v("pCapacity");
      const capacity = capacityRaw === "" ? 0 : Number(capacityRaw);
      const weekdays = readWeekdays();

      const includes = parseLines(v("pIncludes"));
      const excludes = parseLines(v("pExcludes"));

      // 준비물 id 불일치 방어: pPreparations가 표준, pPreps는 레거시
      const prepsText = v("pPreparations") || v("pPreps");
      const preps = parseLines(prepsText);

      // 이미지 URL: 최대 20개
      const imagesRaw = Array.from({ length: 20 }, (_, i) => v(`pImage${i + 1}`)).filter(Boolean);
      const images = [...new Set(imagesRaw)];
      const imageUrl = images[0] || "";

      if (!title || !category || !region) {
        alert("상품명/카테고리/지역은 필수입니다.");
        return;
      }
      if (!Number.isFinite(price) || price <= 0) {
        alert("가격을 올바르게 입력해 주세요.");
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

      const guideName = await getGuideName(user.uid, user.displayName || "");

      const payload = {
        title,
        category,
        type: deriveItemType(category),
        region,
        location: region,          // item.js가 location을 쓰는 화면 호환
        price,
        currency,
        desc,

        includes,
        excludes,
        preps,

        images,
        imageUrl,

        status: "pending",
        guideUid: user.uid,
        ownerUid: user.uid,
        guideName,

        reviewCount: 0,
        reviewSum: 0,
        reviewAvg: 0,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        // 예약/스케줄 설정
        booking: {
          mode: bookMode,                  // date_single | fixed_weekdays | date_range
          weekdays,                        // fixed_weekdays에서 사용 (0=일..6=토)
          capacity: Number.isFinite(capacity) ? capacity : 0, // 0=무제한
        },
      };

      const ref = await addDoc(collection(db, "items"), payload);

      setMsg("등록 완료: 검수 대기(pending)");
      location.href = "./my_products.html?created=" + encodeURIComponent(ref.id);
    } catch (err) {
      console.error(err);
      alert("등록 실패: " + (err?.message || String(err)));
      setMsg("");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
});
