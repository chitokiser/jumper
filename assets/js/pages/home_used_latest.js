// /assets/js/pages/home_used_latest.js
// 홈 화면: 중고거래(/used) 최신 등록 상품 10개를 가로 스크롤 카드로 보여 준다.
// usedMarketPosts 는 공개 읽기(allow get, list: if true)라 로그인 없이 조회된다.
import { db } from "/assets/js/firebase-init.js";
import { formatUsedPrice } from "/assets/js/used-market-currency.js";
import {
  collection,
  getDocs,
  orderBy,
  query,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const COUNT = 10;
const STORAGE_KEY = "town_lang";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function lang() {
  const l = (document.documentElement.lang || localStorage.getItem(STORAGE_KEY) || "ko").slice(0, 2);
  return l === "vi" || l === "en" ? l : "ko";
}

const TEXT = {
  title: { ko: "🛒 중고거래 최신 상품", vi: "🛒 Hàng cũ mới đăng", en: "🛒 Latest used items" },
  more: { ko: "전체 보기 →", vi: "Xem tất cả →", en: "See all →" },
  reserved: { ko: "예약중", vi: "Đã đặt", en: "Reserved" },
  empty: { ko: "아직 등록된 상품이 없습니다.", vi: "Chưa có sản phẩm nào.", en: "No items yet." },
  untitled: { ko: "제목 없음", vi: "Không có tiêu đề", en: "Untitled" },
};
const T = (k) => TEXT[k][lang()];

function thumb(post) {
  if (Array.isArray(post?.imageUrls) && post.imageUrls[0]) return post.imageUrls[0];
  if (post?.imageUrl) return post.imageUrl;
  return "/assets/images/jump/logo2.png";
}

function cardHtml(p) {
  const reserved = p.status === "reserved";
  return `
    <a class="ul-card" href="/used-market-item.html?id=${encodeURIComponent(p.id)}">
      <div class="ul-thumb">
        <img src="${esc(thumb(p))}" alt="${esc(p.title)}" loading="lazy" onerror="this.src='/assets/images/jump/logo2.png'" />
        ${reserved ? `<span class="ul-badge">${esc(T("reserved"))}</span>` : ""}
      </div>
      <div class="ul-body">
        <div class="ul-title">${esc(p.title || T("untitled"))}</div>
        <div class="ul-price">${esc(formatUsedPrice(p))}</div>
        <div class="ul-region">📍 ${esc(p.region || "-")}</div>
      </div>
    </a>`;
}

function ensureSection() {
  let sec = document.getElementById("usedLatestSection");
  if (sec) return sec;
  // 스폰서 배너 섹션 바로 아래에 넣는다 (없으면 main 맨 끝)
  sec = document.createElement("section");
  sec.className = "section";
  sec.id = "usedLatestSection";
  sec.hidden = true;
  sec.innerHTML = `
    <div class="section-h" style="display:flex; justify-content:space-between; align-items:center;">
      <h2 class="section-title" id="usedLatestTitle"></h2>
      <a class="ul-more" id="usedLatestMore" href="/used.html"></a>
    </div>
    <div class="ul-row" id="usedLatestRow"></div>`;
  const anchor = document.getElementById("sponsorSection");
  if (anchor) anchor.insertAdjacentElement("afterend", sec);
  else (document.querySelector("main") || document.body).appendChild(sec);
  return sec;
}

async function boot() {
  const sec = ensureSection();
  try {
    const snap = await getDocs(query(collection(db, "usedMarketPosts"), orderBy("createdAt", "desc"), limit(40)));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    // 숨김·판매완료는 제외하고 판매중/예약중만 최신순 10개
    const list = rows.filter((x) => x.status !== "hidden" && x.status !== "sold").slice(0, COUNT);
    if (!list.length) {
      sec.hidden = true;
      return;
    }
    sec.querySelector("#usedLatestTitle").textContent = T("title");
    sec.querySelector("#usedLatestMore").textContent = T("more");
    sec.querySelector("#usedLatestRow").innerHTML = list.map(cardHtml).join("");
    sec.hidden = false;
  } catch (e) {
    console.warn("[home_used_latest]", e);
    sec.hidden = true; // 실패해도 홈 화면을 깨뜨리지 않는다
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else void boot();
