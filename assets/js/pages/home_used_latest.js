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
  title: { ko: "🥕 하노이 당근 중고장터 실시간 매물", vi: "🥕 Chợ đồ cũ Hà Nội mới đăng", en: "🥕 Hanoi Used Market Latest Items" },
  sell: { ko: "+ 내 물건 판매하기", vi: "+ Đăng bán", en: "+ Sell Item" },
  more: { ko: "장터 전체 보기 →", vi: "Xem tất cả →", en: "See all →" },
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

function relTime(post) {
  const raw = post.bumpedAt || post.createdAt;
  const ms = typeof raw?.toMillis === "function" ? raw.toMillis() : (raw?.seconds ? raw.seconds * 1000 : Number(raw) || 0);
  if (!ms) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  const bumpPrefix = post.bumpedAt ? "끌올 · " : "";
  if (diffMin < 2) return `${bumpPrefix}방금 전`;
  if (diffMin < 60) return `${bumpPrefix}${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${bumpPrefix}${diffHr}시간 전`;
  return `${bumpPrefix}${Math.floor(diffHr / 24)}일 전`;
}

function cardHtml(p) {
  const reserved = p.status === "reserved";
  const likes = Array.isArray(p.likedBy) ? p.likedBy.length : Number(p.likeCount || 0);
  const offers = Number(p.offerCount || p.requestCount || 0);
  const temp = Number(p.sellerMannerTemp || 36.5).toFixed(1);
  const timeStr = relTime(p);
  return `
    <a class="ul-card" href="/used-market-item.html?id=${encodeURIComponent(p.id)}">
      <div class="ul-thumb">
        <img src="${esc(thumb(p))}" alt="${esc(p.title)}" loading="lazy" onerror="this.src='/assets/images/jump/logo2.png'" />
        ${reserved ? `<span class="ul-badge">${esc(T("reserved"))}</span>` : (p.allowPriceOffer !== false ? `<span class="ul-badge" style="background:rgba(15,23,42,.72);font-size:10px;">💬 가격제안</span>` : "")}
      </div>
      <div class="ul-body">
        <div class="ul-title">${esc(p.title || T("untitled"))}</div>
        <div class="ul-price" style="color:#ea580c;">${esc(formatUsedPrice(p))}</div>
        <div class="ul-region">📍 ${esc(p.neighborhood || p.region || "하노이")}${timeStr ? ` · ${esc(timeStr)}` : ""}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#64748b;margin-top:2px;">
          <span style="color:#ea580c;font-weight:700;">🌡️ ${temp}°C</span>
          <span>${likes > 0 ? `❤️ ${likes} ` : ""}${offers > 0 ? `💬 ${offers}` : ""}</span>
        </div>
      </div>
    </a>`;
}

function ensureSection() {
  let sec = document.getElementById("usedLatestSection");
  if (sec) return sec;
  sec = document.createElement("section");
  sec.className = "section";
  sec.id = "usedLatestSection";
  sec.hidden = true;
  sec.innerHTML = `
    <div class="section-h" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <h2 class="section-title" id="usedLatestTitle"></h2>
      <div style="display:flex; align-items:center; gap:8px;">
        <a id="usedLatestSell" href="/used-market-new.html" style="font-size:12px;font-weight:800;text-decoration:none;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;padding:5px 11px;border-radius:99px;box-shadow:0 2px 8px rgba(234,88,12,.28);"></a>
        <a class="ul-more" id="usedLatestMore" href="/used.html"></a>
      </div>
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
    const list = rows
      .filter((x) => x.status !== "hidden" && x.status !== "sold")
      .sort((a, b) => {
        const ta = (a.bumpedAt?.seconds || a.createdAt?.seconds || 0);
        const tb = (b.bumpedAt?.seconds || b.createdAt?.seconds || 0);
        return tb - ta;
      })
      .slice(0, COUNT);
    if (!list.length) {
      sec.hidden = true;
      return;
    }
    sec.querySelector("#usedLatestTitle").textContent = T("title");
    sec.querySelector("#usedLatestSell").textContent = T("sell");
    sec.querySelector("#usedLatestMore").textContent = T("more");
    sec.querySelector("#usedLatestRow").innerHTML = list.map(cardHtml).join("");
    sec.hidden = false;
  } catch (e) {
    console.warn("[home_used_latest]", e);
    sec.hidden = true;
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else void boot();
