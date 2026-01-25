// /assets/js/pages/admin_orders.js
// 관리자 주문관리
// 임시 결제완료(=결제확인) 처리 패치
// 흐름
// - 구매자 checkout: orders.status = "paid" (결제확인 대기)
// - 관리자 결제확인: orders.status = "confirmed" (여기서 guideOrders 미러 생성은 하지 않음)
//   - 이유: 현재 firestore.rules에 guideOrders 권한 규칙이 없어 batch.commit이 실패함
// - 월정산 락: orders.status = "settled" (admin_settlement.js)

import { onAuthReady } from "../auth.js";
import { auth, db } from "/assets/js/firebase-init.js";
import { isAdmin } from "../roles.js";

import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
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
  if (v === "paid" || v === "pending") return "결제확인 대기";
  if (v === "confirmed") return "결제확인 완료";
  if (v === "settled") return "정산 완료";
  return v || "-";
}

function paymentLabel(o) {
  const p = String(o.payment || "offline");
  if (p === "offline") return "오프라인";
  return p;
}

function normalizeOrder(raw) {
  const o = { ...(raw || {}) };
  // legacy: ownerUid -> guideUid
  if (!o.guideUid && o.ownerUid) o.guideUid = o.ownerUid;
  return o;
}

function rowHTML(orderId, o) {
  const created = fmtDT(o.createdAt);
  const paidAt = fmtDT(o.paidAt);
  const confirmedAt = fmtDT(o.confirmedAt);

  const status = statusLabel(o.status);
  const pay = paymentLabel(o);
  const title = o.itemTitle || "(상품)";
  const amount = (o.amount != null && o.amount !== "") ? String(o.amount) : "";
  const buyer = o.buyerName || o.buyerEmail || o.buyerUid || "";
  const guideUid = o.guideUid || o.ownerUid || "";
  const ym = o.settlementMonth || "";

  const canConfirm = ["paid","pending"].includes(String(o.status || "").toLowerCase());
  const confirmBtn = canConfirm
    ? `<button class="btn btn--sm btn--primary" data-act="confirm" data-id="${esc(orderId)}">결제확인</button>`
    : "";

  return `
    <div class="row">
      <div class="top">
        <h3 class="title">${esc(title)}</h3>
        <div class="meta">
          <span class="pill">${esc(status)}</span>
          <span class="pill">${esc(pay)}</span>
          ${created ? `<span>${esc(created)}</span>` : ""}
        </div>
      </div>

      <div class="kv"><div class="k">주문ID</div><div class="v">${esc(orderId)}</div></div>
      <div class="kv"><div class="k">가이드</div><div class="v">${esc(guideUid)}</div></div>
      <div class="kv"><div class="k">구매자</div><div class="v">${esc(buyer)}</div></div>
      <div class="kv"><div class="k">금액</div><div class="v">${esc(amount)}</div></div>
      <div class="kv"><div class="k">정산월</div><div class="v">${esc(ym)}</div></div>
      <div class="kv"><div class="k">결제시각</div><div class="v">${esc(paidAt || "-")}</div></div>
      <div class="kv"><div class="k">확인시각</div><div class="v">${esc(confirmedAt || "-")}</div></div>

      <div class="actions">
        <a class="linkbtn" href="/item.html?id=${encodeURIComponent(o.itemId || "")}" target="_blank" rel="noopener">상품 보기</a>
        ${confirmBtn}
      </div>
    </div>
  `;
}

function monthFromNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function confirmPaidOrder(orderId) {
  const ref = doc(db, "orders", orderId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("주문을 찾을 수 없습니다.");

  const o0 = normalizeOrder(snap.data() || {});
  const st = String(o0.status || "").toLowerCase();
  if (st !== "paid" && st !== "pending") throw new Error("결제확인 대기 상태만 처리할 수 있습니다.(paid/pending)");

  const guideUid = String(o0.guideUid || "").trim();
  if (!guideUid) throw new Error("guideUid가 없습니다. (상품 ownerUid/guideUid 확인 필요)");

  const settlementMonth = String(o0.settlementMonth || "").trim() || monthFromNow();

  // orders 업데이트 (임시 결제완료 확정)
  // - guideOrders 미러를 만들지 않습니다.
  // - 이유: 현재 firestore.rules에 guideOrders 권한 규칙이 없어 쓰기(배치)가 실패합니다.
  // - 가이드 화면(guide_orders.js)은 orders에서 직접 조회하도록 별도 패치됩니다.
  const patch = {
    status: "confirmed",
    paymentStatus: "confirmed",
    guideUid,
    settlementMonth,
    confirmedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // paidAt이 비어 있는 레거시 주문도 있어 방어
  if (!o0.paidAt) patch.paidAt = serverTimestamp();

  await updateDoc(ref, patch);
}

async function loadAdminOrders() {
  const state = $("#ordersState");
  const list = $("#ordersList");
  const sel = $("#selStatus");
  const filter = String(sel?.value || "all").toLowerCase();

  state.textContent = "불러오는 중...";
  list.innerHTML = "";

  const q = query(
    collection(db, "orders"),
    orderBy("createdAt", "desc"),
    limit(400)
  );

  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => arr.push({ _id: d.id, ...normalizeOrder(d.data()) }));

  const rows = arr.filter((o) => {
    if (filter === "all") return true;
    return String(o.status || "").toLowerCase() === filter;
  });

  state.textContent = "";

  if (!rows.length) {
    list.innerHTML = `<div class="empty">주문이 없습니다.</div>`;
    return;
  }

  list.innerHTML = rows.map((o) => rowHTML(o._id, o)).join("");

  // action binds
  list.querySelectorAll("button[data-act='confirm']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      if (!confirm("이 주문을 '결제확인 완료'로 처리할까요?\n처리 후 가이드 주문관리/정산대상에 즉시 반영됩니다.")) return;

      btn.disabled = true;
      try {
        await confirmPaidOrder(id);
        await loadAdminOrders();
      } catch (e) {
        console.error(e);
        alert(e?.message || String(e));
        btn.disabled = false;
      }
    });
  });
}

onAuthReady(async ({ user, profile }) => {
  if (!user) {
    $("#ordersState").textContent = "로그인 필요";
    return;
  }
  if (!isAdmin(profile)) {
    $("#ordersState").textContent = "관리자만 접근 가능합니다.";
    return;
  }

  $("#btnReload")?.addEventListener("click", loadAdminOrders);
  $("#selStatus")?.addEventListener("change", loadAdminOrders);
  await loadAdminOrders();
});
