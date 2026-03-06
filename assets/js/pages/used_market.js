// /assets/js/pages/used_market.js
import { db } from "/assets/js/firebase-init.js";
import {
  collection,
  getDocs,
  orderBy,
  query,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(v) {
  try {
    const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : null);
    return d ? d.toLocaleDateString("ko-KR") : "-";
  } catch {
    return "-";
  }
}

function statusText(s) {
  return s === "sold" ? "판매완료" : s === "reserved" ? "예약중" : "판매중";
}

function getThumb(post) {
  if (Array.isArray(post?.imageUrls) && post.imageUrls.length) return post.imageUrls[0];
  if (post?.imageUrl) return post.imageUrl;
  return "/assets/images/jump/BI.png";
}

let ALL = [];

function render() {
  const q = ($("umSearch")?.value || "").trim().toLowerCase();
  const st = $("umStatus")?.value || "all";
  const grid = $("umGrid");
  const state = $("umState");
  if (!grid || !state) return;

  const list = ALL.filter((x) => {
    if (st !== "all" && x.status !== st) return false;
    if (!q) return true;
    return [x.title, x.region, x.description].some((v) => String(v || "").toLowerCase().includes(q));
  });

  state.textContent = `총 ${list.length}개`;

  if (!list.length) {
    grid.innerHTML = '<div class="muted">등록된 중고거래 글이 없습니다.</div>';
    return;
  }

  grid.innerHTML = list.map((x) => `
    <a class="um-card" href="/used-market-item.html?id=${encodeURIComponent(x.id)}">
      <img class="um-thumb" src="${esc(getThumb(x))}" alt="${esc(x.title)}" />
      <div class="um-body">
        <div class="um-title">${esc(x.title)}</div>
        <div><span class="um-badge ${esc(x.status || "on_sale")}">${statusText(x.status)}</span></div>
        <div class="um-price">${Number(x.price || 0).toLocaleString()}원</div>
        <div class="um-meta">
          <span>${esc(x.region || "-")}</span>
          <span>${fmtDate(x.createdAt)}</span>
        </div>
      </div>
    </a>
  `).join("");
}

async function boot() {
  const state = $("umState");
  if (state) state.textContent = "불러오는 중...";

  try {
    const snap = await getDocs(query(collection(db, "usedMarketPosts"), orderBy("createdAt", "desc"), limit(100)));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    ALL = rows;
    render();
  } catch (e) {
    if (state) state.textContent = "목록을 불러오지 못했습니다.";
    console.warn(e);
  }
}

["umSearch", "umStatus"].forEach((id) => {
  document.addEventListener("input", (e) => {
    if (e.target?.id === id) render();
  });
  document.addEventListener("change", (e) => {
    if (e.target?.id === id) render();
  });
});

boot();
