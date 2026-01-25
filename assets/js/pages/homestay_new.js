// /assets/js/pages/homestay_new.js
// homestay_new.html에서 홈스테이 기본값 세팅(기존 product_new.js 재사용)

function setValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNumber(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function tweakLabels() {
  const titleLabel = document.querySelector("label.field span.label");
  if (titleLabel && titleLabel.textContent.trim() === "상품명") {
    titleLabel.textContent = "홈스테이 이름";
  }

  const titleInput = document.getElementById("pTitle");
  if (titleInput && titleInput.getAttribute("placeholder") === "예: 다낭 야경 투어") {
    titleInput.setAttribute("placeholder", "예: 오션파크3 101동 스튜디오");
  }

  const regionInput = document.getElementById("pRegion");
  if (regionInput && regionInput.getAttribute("placeholder") === "예: 다낭 / 호이안") {
    regionInput.setAttribute("placeholder", "예: 오션파크1 / 오션파크2 / 오션파크3");
  }
}

function initDefaults() {
  // 1) 카테고리 기본값: hotel
  setValue("pCategory", "hotel");

  // 2) 기간 예약 기본값
  setValue("pBookMode", "date_range");

  // 3) 정원/객실 수: 1
  setNumber("pCapacity", 1);

  // 4) 가격 통화: VND 기본 (원하면 KRW로 바꿔도 됨)
  setValue("pCurrency", "VND");

  tweakLabels();
}

// product_new.js가 DOM을 바인딩한 뒤에 적용되도록 약간 지연
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(initDefaults, 50);
  setTimeout(initDefaults, 250);
});
