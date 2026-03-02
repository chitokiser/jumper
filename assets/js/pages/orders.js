// /assets/js/pages/orders.js
// NOTE: Firestore 복합 인덱스 없이 동작하도록 where + orderBy 조합을 제거했습니다.
//       정렬은 클라이언트에서 createdAt 기준으로 처리합니다.

import { onAuthReady } from "../auth.js";
import { auth, db } from "../firebase-init.js";

import {
  collection,
  query,
  where,
  limit,
  getDocs,
  getDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const tabOrders = $("tabOrders");
const tabReviews = $("tabReviews");
const viewOrders = $("viewOrders");
const viewReviews = $("viewReviews");
const btnReload = $("btnReload");

const stateEl = $("state");
const ordersList = $("ordersList");
const myReviewsList = $("myReviewsList");

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setState(msg, kind = "") {
  if (!stateEl) return;
  stateEl.className = "state " + (kind ? `state--${kind}` : "");
  stateEl.textContent = msg || "";
}

function setTab(which) {
  const isOrders = which === "orders";
  tabOrders?.classList.toggle("tab--active", isOrders);
  tabReviews?.classList.toggle("tab--active", !isOrders);
  if (viewOrders) viewOrders.style.display = isOrders ? "" : "none";
  if (viewReviews) viewReviews.style.display = isOrders ? "none" : "";
}

function toMs(v) {
  if (!v) return 0;
  // Firestore Timestamp
  if (typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate().getTime();
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  // Date or ms
  if (typeof v === "number") return v;
  // ISO string
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function fmtTs(ts) {
  const ms = toMs(ts);
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

function statusChip(status) {
  const v = String(status || "").toLowerCase();

  // 과거 상태값 호환
  const vv = (v === "submitted" || v === "requested") ? "pending" : v;

  // 표시 라벨(사용자 친화)
  const label =
    (vv === "paid" || vv === "pending") ? "결제확인 대기" :
    (vv === "confirmed") ? "결제확인 완료" :
    (vv === "settled" || vv === "completed") ? "정산 완료" :
    (vv === "canceled") ? "취소" :
    (vv ? vv.toUpperCase() : "UNKNOWN");

  const cls =
    (vv === "canceled") ? "chip chip--bad" :
    (vv === "paid" || vv === "pending" || vv === "confirmed" || vv === "settled" || vv === "completed") ? "chip chip--ok" :
    "chip";

  return `<span class="${cls}">${esc(label)}</span>`;
}

async function getItem(itemId) {
  if (!itemId) return null;
  const snap = await getDoc(doc(db, "items", itemId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function renderOrderCard(o, item) {
  const title = item?.title || o.itemTitle || "(상품명 없음)";
  const priceRaw = item?.price ?? o.price ?? "";
  const currency = item?.currency || o.currency || "KRW";
  const priceNum = Number(priceRaw);
  const price = (priceRaw !== "" && Number.isFinite(priceNum))
    ? priceNum.toLocaleString() + " " + currency
    : (priceRaw !== "" ? String(priceRaw) : "");
  const when = fmtTs(o.createdAt);
  // status가 최신 진실 원천(관리자 확인/정산 등). paymentStatus는 레거시 호환.
  const payStatus = String(o.status || o.paymentStatus || "").toLowerCase();

  return `
  <article class="card card--row">
    <div class="card-body">
      <div class="card-title">${esc(title)} ${statusChip(payStatus)}</div>
      <div class="card-meta">
        <span>주문ID: ${esc(o.id)}</span>
        ${when ? `<span>· ${esc(when)}</span>` : ""}
        ${price !== "" ? `<span>· ${esc(price)}</span>` : ""}
      </div>
      <div class="card-actions">
        ${item?.id ? `<a class="btn btn-sm" href="/item.html?id=${encodeURIComponent(item.id)}">상품 보기</a>` : ""}
        ${(["confirmed","settled","completed"].includes(payStatus))
          ? `<a class="btn btn-sm btn-ghost" href="/review.html?order=${encodeURIComponent(o.id)}">리뷰 작성/수정</a>`
          : ""}
      </div>
    </div>
  </article>`;
}

function renderMyReviewCard(r, item) {
  const title = item?.title || "(상품명 없음)";
  const when = fmtTs(r.createdAt);
  const rating = Math.max(0, Math.min(5, Number(r.rating || 0)));
  const stars = "★★★★★".slice(0, rating) + "☆☆☆☆☆".slice(0, 5 - rating);

  return `
  <article class="card card--row">
    <div class="card-body">
      <div class="card-title">${esc(title)}</div>
      <div class="card-meta">
        <span>${esc(stars)} (${esc(rating)})</span>
        ${when ? `<span>· ${esc(when)}</span>` : ""}
        ${r.visible === false ? `<span class="chip chip--warn">비공개</span>` : ""}
      </div>
      ${r.text ? `<div class="card-text">${esc(r.text)}</div>` : ""}
      ${r.guideReply ? `<div class="card-reply">가이드 답변: ${esc(r.guideReply)}</div>` : ""}
      ${r.adminReply ? `<div class="card-reply">관리자 답변: ${esc(r.adminReply)}</div>` : ""}
      <div class="card-actions">
        ${item?.id ? `<a class="btn btn-sm" href="/item.html?id=${encodeURIComponent(item.id)}">상품 보기</a>` : ""}
        <a class="btn btn-sm btn-ghost" href="/review.html?order=${encodeURIComponent(r.orderId || r.id)}">리뷰 열기</a>
      </div>
    </div>
  </article>`;
}

async function loadOrders(uid) {
  ordersList.innerHTML = "";
  setState("주문 불러오는 중...");

  // 복합 인덱스 회피: where만 사용
  const q = query(
    collection(db, "orders"),
    where("buyerUid", "==", uid),
    limit(300)
  );

  const snap = await getDocs(q);
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data(), _t: toMs(d.data()?.createdAt) }));

  rows.sort((a, b) => (b._t || 0) - (a._t || 0));
  const top = rows.slice(0, 50);

  if (!top.length) {
    setState("주문이 없습니다.", "muted");
    return;
  }

  setState("");

  const html = [];
  for (const o of top) {
    let item = null;
    try { item = await getItem(o.itemId); } catch {}
    html.push(renderOrderCard(o, item));
  }
  ordersList.innerHTML = html.join("");
}

async function loadMyReviews(uid) {
  myReviewsList.innerHTML = "";
  setState("내 리뷰 불러오는 중...");

  // 1) SSOT(top-level reviews) 우선 로드
  //    복합 인덱스 회피: where만 사용
  const q1 = query(
    collection(db, "reviews"),
    where("authorUid", "==", uid),
    limit(300)
  );

  const snap1 = await getDocs(q1);
  const rows1 = [];
  snap1.forEach((d) => rows1.push({ id: d.id, ...d.data(), _t: toMs(d.data()?.createdAt) }));

  // 2) 레거시(items/{itemId}/reviews/{uid})에만 존재하는 경우가 있어 fallback
  //    - 내 주문을 기준으로 각 주문의 리뷰를 찾아 수집
  if (rows1.length === 0) {
    try {
      const oq = query(
        collection(db, "orders"),
        where("buyerUid", "==", uid),
        limit(200)
      );
      const os = await getDocs(oq);

      const legacy = [];
      for (const d of os.docs) {
        const o = { id: d.id, ...(d.data() || {}) };
        const orderId = o.id;
        const itemId = o.itemId || "";

        // 혹시 SSOT가 orderId 문서로 존재하면 그걸 우선
        try {
          const rs = await getDoc(doc(db, "reviews", orderId));
          if (rs.exists()) {
            const r = rs.data() || {};
            if ((r.authorUid || "") === uid) {
              legacy.push({ id: rs.id, ...r, _t: toMs(r.createdAt), orderId });
              continue;
            }
          }
        } catch {}

        // 레거시: items/{itemId}/reviews/{uid}
        if (itemId) {
          try {
            const ls = await getDoc(doc(db, "items", itemId, "reviews", uid));
            if (ls.exists()) {
              const r = ls.data() || {};
              // 레거시 데이터는 orderId/authorUid가 없을 수 있으니 보정
              legacy.push({
                id: `${itemId}:${uid}`,
                orderId,
                itemId,
                itemTitle: r.itemTitle || o.itemTitle || "",
                guideUid: r.guideUid || o.guideUid || o.ownerUid || "",
                authorUid: uid,
                authorName: r.authorName || "",
                rating: r.rating || 0,
                text: r.text || r.comment || "",
                visible: r.visible !== false,
                guideReply: r.guideReply || "",
                adminReply: r.adminReply || "",
                createdAt: r.createdAt || o.createdAt || null,
                _t: toMs(r.createdAt || o.createdAt),
              });
            }
          } catch {}
        }
      }

      rows1.push(...legacy);
    } catch (e) {
      // fallback 실패는 조용히 무시하고 "리뷰 없음" 처리
      console.warn("legacy reviews fallback failed", e);
    }
  }

  rows1.sort((a, b) => (b._t || 0) - (a._t || 0));
  const top = rows1.slice(0, 50);

  if (!top.length) {
    setState("작성한 리뷰가 없습니다.", "muted");
    return;
  }

  setState("");

  const html = [];
  for (const r of top) {
    let item = null;
    try { item = await getItem(r.itemId); } catch {}
    html.push(renderMyReviewCard(r, item));
  }
  myReviewsList.innerHTML = html.join("");
}

async function reload() {
  const user = auth.currentUser;
  if (!user) {
    setState("로그인이 필요합니다.", "bad");
    ordersList.innerHTML = "";
    myReviewsList.innerHTML = "";
    return;
  }

  if (tabOrders?.classList.contains("tab--active")) {
    await loadOrders(user.uid);
  } else {
    await loadMyReviews(user.uid);
  }
}

tabOrders?.addEventListener("click", async () => {
  setTab("orders");
  await reload();
});

tabReviews?.addEventListener("click", async () => {
  setTab("reviews");
  await reload();
});

btnReload?.addEventListener("click", reload);

onAuthReady(async () => {
  try {
    setTab("orders");
    await reload();
  } catch (e) {
    console.error(e);
    setState("권한 또는 네트워크 문제로 데이터를 읽지 못했습니다.", "bad");
  }
});
