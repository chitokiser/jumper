// /assets/js/pages/guide_orders.js
// 가이드 주문관리 (임시 결제완료 패치)
// - 기존 설계: admin 결제확인(confirmed) 시 guideOrders/{guideUid}/orders 로 미러링 후 가이드가 그 컬렉션을 조회
// - 문제: 현재 firestore.rules에는 guideOrders 규칙이 없어(기본 deny) 미러링/조회가 모두 실패합니다.
// - 임시 해결: guideOrders를 사용하지 않고 orders 컬렉션에서 guideUid==내 uid 인 주문을 직접 조회합니다.
//   (rules에서 orders.list는 signedIn 허용, orders.get는 isOrderGuide 허용)

import { onAuthReady } from "../auth.js";
import { db } from "/assets/js/firebase-init.js";
import { isGuide, isAdmin } from "../roles.js";

import {
  collection,
  query,
  where,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate().getTime();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function fmtDT(ts) {
  const ms = toMs(ts);
  if (!ms) return "";
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function statusLabel(s) {
  const v = String(s || "").toLowerCase();
  if (v === "confirmed") return "결제확인 완료";
  if (v === "settled" || v === "completed") return "정산 완료";
  if (v === "paid" || v === "pending") return "결제확인 대기";
  if (v === "canceled") return "취소";
  return v || "-";
}

function rowHTML(o) {
  const created = fmtDT(o.createdAt);
  const paidAt = fmtDT(o.paidAt);
  const confirmedAt = fmtDT(o.confirmedAt);
  const status = statusLabel(o.status);

  const title = o.itemTitle || "(상품)";
  const amount = (o.amount != null && o.amount !== "") ? String(o.amount) : "";
  const ym = o.settlementMonth || "";
  const orderId = o._id || o.orderId || "";

  return `
    <div class="row">
      <div class="top">
        <h3 class="title">${esc(title)}</h3>
        <div class="meta">
          <span class="pill">${esc(status)}</span>
          ${created ? `<span>${esc(created)}</span>` : ""}
        </div>
      </div>

      <div class="kv"><div class="k">주문ID</div><div class="v">${esc(orderId)}</div></div>
      <div class="kv"><div class="k">금액</div><div class="v">${esc(amount)}</div></div>
      <div class="kv"><div class="k">정산월</div><div class="v">${esc(ym)}</div></div>
      <div class="kv"><div class="k">결제시각</div><div class="v">${esc(paidAt || "-")}</div></div>
      <div class="kv"><div class="k">확인시각</div><div class="v">${esc(confirmedAt || "-")}</div></div>
      <div class="kv"><div class="k">구매자</div><div class="v">${esc(o.buyerUid || o.buyerEmail || "")}</div></div>

      <div class="actions">
        <a class="linkbtn" href="/item.html?id=${encodeURIComponent(o.itemId || "")}" target="_blank" rel="noopener">상품 보기</a>
        <a class="linkbtn" href="/order_detail.html?id=${encodeURIComponent(orderId)}" target="_blank" rel="noopener">주문 상세</a>
      </div>
    </div>
  `;
}

function normalizeOrder(raw) {
  const o = { ...(raw || {}) };
  if (!o.guideUid && o.ownerUid) o.guideUid = o.ownerUid;
  return o;
}

async function loadGuideOrders(guideUid) {
  const state = $("#ordersState");
  const list = $("#ordersList");

  state.textContent = "불러오는 중...";
  list.innerHTML = "";

  // 복합 인덱스 회피: where만 사용, 정렬은 클라이언트에서 처리
  const q = query(
    collection(db, "orders"),
    where("guideUid", "==", guideUid),
    limit(500)
  );

  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => {
    const o = normalizeOrder(d.data() || {});
    arr.push({ _id: d.id, ...o, _ms: toMs(o.confirmedAt) || toMs(o.paidAt) || toMs(o.createdAt) });
  });

  // 가이드 화면은 "결제확인(confirmed) 이후"가 중요하지만,
  // 임시 운영 편의를 위해 paid도 함께 보여줍니다.
  const rows = arr
    .filter((o) => {
      const st = String(o.status || "").toLowerCase();
      return ["paid", "pending", "confirmed", "settled", "completed"].includes(st);
    })
    .sort((a, b) => (b._ms || 0) - (a._ms || 0))
    .slice(0, 200);

  state.textContent = "";

  if (!rows.length) {
    list.innerHTML = `<div class="empty">주문이 없습니다.</div>`;
    return;
  }

  list.innerHTML = rows.map(rowHTML).join("");
}

onAuthReady(async ({ user, profile }) => {
  if (!user) {
    $("#ordersState").textContent = "로그인 필요";
    return;
  }
  if (!(isGuide(profile) || isAdmin(profile))) {
    $("#ordersState").textContent = "가이드/관리자만 접근 가능합니다.";
    return;
  }

  $("#btnReload")?.addEventListener("click", () => loadGuideOrders(user.uid));
  await loadGuideOrders(user.uid);
});
