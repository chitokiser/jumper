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
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const tabMerchantOrders = $("tabMerchantOrders");
const tabCoop           = $("tabCoop");
const tabOrders         = $("tabOrders");
const tabReviews        = $("tabReviews");

const viewMerchantOrders = $("viewMerchantOrders");
const viewCoop           = $("viewCoop");
const viewOrders         = $("viewOrders");
const viewReviews        = $("viewReviews");

const btnReload          = $("btnReload");
const stateEl            = $("state");

const merchantOrdersList = $("merchantOrdersList");
const coopOrdersList     = $("coopOrdersList");
const ordersList         = $("ordersList");
const myReviewsList      = $("myReviewsList");

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
  tabMerchantOrders?.classList.toggle("tab--active", which === "merchant");
  tabCoop?.classList.toggle("tab--active",           which === "coop");
  tabOrders?.classList.toggle("tab--active",         which === "orders");
  tabReviews?.classList.toggle("tab--active",        which === "reviews");

  viewMerchantOrders?.classList.toggle("hidden", which !== "merchant");
  viewCoop?.classList.toggle("hidden",           which !== "coop");
  viewOrders?.classList.toggle("hidden",         which !== "orders");
  viewReviews?.classList.toggle("hidden",        which !== "reviews");
}

function toMs(v) {
  if (!v) return 0;
  // Firestore Timestamp
  if (typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate().getTime();
    if (typeof v.toMillis === "function") return v.toMillis();
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

// ── 가맹점 캐시 ──────────────────────────────────────
const merchantCache = new Map();

async function getMerchant(mid) {
  if (!mid) return null;
  const key = String(mid);
  if (merchantCache.has(key)) return merchantCache.get(key);
  try {
    const snap = await getDoc(doc(db, "merchants", key));
    if (snap.exists()) {
      const data = { id: snap.id, ...snap.data() };
      merchantCache.set(key, data);
      return data;
    }
  } catch (_) { }
  return null;
}

// ── 가맹점 주문 상태 칩 ──────────────────────────────────
function getMerchantOrderStatusChip(status) {
  const s = String(status || "pending").toLowerCase();
  switch (s) {
    case "pending":
      return '<span class="chip" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:700;">주문 접수 (확인 대기)</span>';
    case "payment_confirmed":
      return '<span class="chip chip--ok" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:700;">입금 확인 완료 (발송 준비)</span>';
    case "shipped":
      return '<span class="chip chip--ok" style="background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe; font-weight:700;">🚀 배송/발송 완료</span>';
    case "completed":
      return '<span class="chip chip--ok" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-weight:700;">🎉 구매 확정 완료</span>';
    case "cancelled":
      return '<span class="chip chip--bad" style="font-weight:700;">❌ 주문 취소</span>';
    default:
      return `<span class="chip">${esc(s.toUpperCase())}</span>`;
  }
}

function getMerchantPaymentStatusChip(payStatus, payMethod) {
  const ps = String(payStatus || "awaiting_payment").toLowerCase();
  const pm = String(payMethod || "").toLowerCase();
  const pmLabel = pm === "bm_wallet" ? "BM 지갑" : (pm === "bank_transfer" ? "계좌이체" : "");

  switch (ps) {
    case "paid":
      return `<span class="chip chip--ok" style="font-weight:700;">✅ 결제 완료 ${pmLabel ? `(${pmLabel})` : ''}</span>`;
    case "deposit_requested":
      return '<span class="chip" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-weight:700;">🏦 계좌이체 확인 요청 중</span>';
    case "awaiting_payment":
    default:
      return '<span class="chip chip--warn" style="font-weight:700;">⏳ 결제 대기</span>';
  }
}

// ── 가맹점 주문 카드 렌더링 ──────────────────────────────
function renderMerchantOrderCard(o) {
  const mName = o.merchant_name || o.merchant_id || "가맹점";
  const orderId = o.id;
  const when = fmtTs(o.created_at || o.createdAt);
  const total = Number(o.total_amount || 0);
  const items = Array.isArray(o.items) ? o.items : [];
  const status = String(o.status || "pending").toLowerCase();
  const payStatus = String(o.payment_status || "awaiting_payment").toLowerCase();

  const payUrl = `/pay.html?merchant=${encodeURIComponent(o.merchant_id)}&amount=${encodeURIComponent(total)}&currency=VND&orderId=${encodeURIComponent(orderId)}`;

  // 상품 목록 HTML
  const itemsHtml = items.map((it) => {
    const itName = it.name || it.product_name || "상품";
    const itPrice = Number(it.price || it.unit_price || 0);
    const itQty = Number(it.qty || 1);
    const itTotal = itPrice * itQty;
    const itOpt = it.selected_option || it.option;
    return `
      <div class="morder-item-row">
        <div class="morder-item-name">
          ${esc(itName)}
          ${itOpt ? `<span style="font-size:0.8rem; color:#6b7280; margin-left:4px;">(${esc(itOpt)})</span>` : ""}
        </div>
        <div class="morder-item-qty">${itQty}개</div>
        <div class="morder-item-price">${itTotal.toLocaleString()} VND</div>
      </div>
    `;
  }).join("");

  // 상태 안내 배너
  let bannerHtml = "";
  if (status === "cancelled") {
    bannerHtml = `<div class="morder-info-banner warn">❌ 취소된 주문입니다.</div>`;
  } else if (payStatus === "deposit_requested") {
    bannerHtml = `
      <div class="morder-info-banner warn">
        🏦 <strong>계좌이체 확인 요청 완료</strong> (입금자 성명: <strong>${esc(o.depositor_name || "미입력")}</strong>)<br>
        가맹점 직원이 통장 입금 내역을 확인한 후 상품 배송 처리가 진행됩니다.
      </div>
    `;
  } else if (payStatus === "paid" && status !== "completed" && status !== "cancelled") {
    bannerHtml = `
      <div class="morder-info-banner success">
        ✅ 결제가 확인되었습니다. 가맹점에서 상품을 준비하여 발송합니다.
      </div>
    `;
  } else if (status === "shipped") {
    bannerHtml = `
      <div class="morder-info-banner info">
        🚀 상품이 발송/제공되었습니다. 상품을 정상 수령하셨다면 아래 <strong>[수령 확인]</strong> 버튼을 눌러주세요.
      </div>
    `;
  } else if (status === "completed") {
    bannerHtml = `
      <div class="morder-info-banner success">
        🎉 구매 확정이 완료된 주문입니다. 이용해 주셔서 감사합니다!
      </div>
    `;
  }

  // 액션 버튼
  const actionBtns = [];
  if (status !== "cancelled" && status !== "completed") {
    if (payStatus === "awaiting_payment") {
      actionBtns.push(`
        <a href="${payUrl}" class="btn btn--sm" style="background:#4f46e5; color:white; font-weight:700; text-decoration:none; padding:8px 14px; border-radius:8px;">
          💳 내 지갑 BM 결제
        </a>
      `);
      actionBtns.push(`
        <button type="button" class="btn btn--sm" data-action="open-transfer-modal" data-id="${orderId}" data-merchant-id="${esc(o.merchant_id)}" data-amount="${total}" style="background:#2563eb; color:white; font-weight:700; padding:8px 14px; border-radius:8px; border:none; cursor:pointer;">
          🏦 계좌이체 확인 요청
        </button>
      `);
      actionBtns.push(`
        <button type="button" class="btn btn--sm btn-ghost" data-action="cancel-morder" data-id="${orderId}" style="color:#ef4444; border:1px solid #fca5a5; padding:8px 12px; border-radius:8px; cursor:pointer;">
          주문 취소
        </button>
      `);
    } else if (payStatus === "deposit_requested") {
      actionBtns.push(`
        <button type="button" class="btn btn--sm btn-ghost" data-action="cancel-morder" data-id="${orderId}" style="color:#ef4444; border:1px solid #fca5a5; padding:8px 12px; border-radius:8px; cursor:pointer;">
          주문 취소
        </button>
      `);
    }

    if (status === "shipped") {
      actionBtns.push(`
        <button type="button" class="btn btn--sm" data-action="confirm-receipt" data-id="${orderId}" style="background:#10b981; color:white; font-weight:700; padding:8px 14px; border-radius:8px; border:none; cursor:pointer;">
          ✅ 상품 수령 확인 (구매 확정)
        </button>
      `);
    }
  }

  actionBtns.push(`
    <a href="/mall.html" class="btn btn--sm btn-ghost" style="text-decoration:none; padding:8px 12px; border-radius:8px;">
      🛍️ 쇼핑몰 둘러보기
    </a>
  `);

  return `
    <article class="morder-card" data-order-id="${orderId}">
      <div class="morder-header">
        <div class="morder-merchant-info">
          <span class="morder-merchant-badge">🏪 ${esc(mName)}</span>
          <span class="morder-id">#${esc(orderId)}</span>
        </div>
        <div class="morder-date">${esc(when)}</div>
      </div>

      <div class="morder-status-row">
        ${getMerchantOrderStatusChip(status)}
        ${getMerchantPaymentStatusChip(payStatus, o.payment_method)}
      </div>

      ${bannerHtml}

      <div class="morder-items-list">
        ${itemsHtml || '<div style="color:#94a3b8; font-size:0.85rem;">주문 상품 상세 정보가 없습니다.</div>'}
      </div>

      <div class="morder-total-bar">
        <span class="morder-total-label">총 결제 금액</span>
        <span class="morder-total-val">${total.toLocaleString()} VND</span>
      </div>

      <div class="morder-actions">
        ${actionBtns.join("")}
      </div>
    </article>
  `;
}

// ── 계좌이체 확인 요청 모달 ──────────────────────────────
function openTransferModal(orderId, merchantId, amount, bankName, accountNo, accountHolder) {
  const existing = $("ordersTransferModalWrap");
  if (existing) existing.remove();

  const user = auth.currentUser;
  const defaultDepositor = user?.displayName || user?.email?.split("@")[0] || "";

  const wrap = document.createElement("div");
  wrap.id = "ordersTransferModalWrap";
  wrap.className = "orders-modal-backdrop";
  wrap.innerHTML = `
    <div class="orders-modal">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0; font-size:1.2rem; color:#1e293b;">🏦 계좌 자동이체 입금 확인 요청</h3>
        <button type="button" id="btnCloseTransferModal" style="background:none; border:none; font-size:1.5rem; color:#64748b; cursor:pointer;">&times;</button>
      </div>

      <p style="font-size:0.88rem; color:#475569; margin:0 0 14px 0; line-height:1.4;">
        주문번호: <code>#${esc(orderId.slice(0, 8))}</code> | 입금액: <strong style="color:#ef4444;">${amount.toLocaleString()} VND</strong>
      </p>

      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px; margin-bottom:14px; font-size:0.88rem; line-height:1.6;">
        <div>🏦 <strong>은행:</strong> ${esc(bankName)}</div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span>🔢 <strong>계좌번호:</strong> <code style="font-size:0.95rem; font-weight:bold; color:#1d4ed8;">${esc(accountNo)}</code></span>
          <button type="button" id="btnCopyAcc" style="font-size:0.75rem; padding:3px 8px; border:1px solid #cbd5e1; border-radius:4px; background:#fff; cursor:pointer;">복사</button>
        </div>
        <div>👤 <strong>예금주:</strong> ${esc(accountHolder)}</div>
        <div>🏷️ <strong>입금 메모:</strong> <strong style="color:#ef4444;">${esc(orderId.slice(0, 8))}</strong> (주문번호 앞자리)</div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; font-size:0.85rem; font-weight:700; color:#334155; margin-bottom:6px;">실제 송금자 성명</label>
        <input type="text" id="inputModalDepositor" value="${esc(defaultDepositor)}" placeholder="은행 이체 시 보낸 분 이름" style="width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:0.92rem;" />
      </div>

      <div style="display:flex; gap:8px;">
        <button type="button" id="btnCancelTransferModal" class="btn" style="flex:1; padding:10px; border-radius:8px; background:#f1f5f9; color:#475569; border:none; cursor:pointer;">닫기</button>
        <button type="button" id="btnSubmitTransferReq" class="btn btn--primary" style="flex:2; padding:10px; border-radius:8px; background:#2563eb; color:#fff; font-weight:700; border:none; cursor:pointer;">💰 확인 요청 제출</button>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  $("btnCloseTransferModal")?.addEventListener("click", () => wrap.remove());
  $("btnCancelTransferModal")?.addEventListener("click", () => wrap.remove());

  $("btnCopyAcc")?.addEventListener("click", () => {
    navigator.clipboard.writeText(accountNo).then(() => {
      alert("계좌번호가 복사되었습니다: " + accountNo);
    }).catch(() => {
      alert("계좌번호: " + accountNo);
    });
  });

  $("btnSubmitTransferReq")?.addEventListener("click", async () => {
    const depositor = ($("inputModalDepositor")?.value || "").trim();
    if (!depositor) {
      alert("송금자 성명을 입력해 주세요.");
      return;
    }

    const submitBtn = $("btnSubmitTransferReq");
    submitBtn.disabled = true;
    submitBtn.textContent = "전송 중...";

    try {
      await updateDoc(doc(db, "merchant_orders", orderId), {
        payment_method: "bank_transfer",
        payment_status: "deposit_requested",
        depositor_name: depositor,
        deposit_requested_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });

      alert("가맹점에 입금 확인 요청이 전송되었습니다.\n통장 확인 후 배송이 시작됩니다.");
      wrap.remove();
      await reload();
    } catch (e) {
      alert("입금 확인 요청 실패: " + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "💰 확인 요청 제출";
    }
  });
}

function bindMerchantOrderActions() {
  // 1. 주문 취소
  merchantOrdersList.querySelectorAll("[data-action='cancel-morder']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      if (!confirm("정말 이 주문을 취소하시겠습니까?")) return;

      btn.disabled = true;
      btn.textContent = "취소 중...";
      try {
        await updateDoc(doc(db, "merchant_orders", id), {
          status: "cancelled",
          cancelled_at: serverTimestamp(),
          updated_at: serverTimestamp()
        });
        alert("주문이 취소되었습니다.");
        await reload();
      } catch (err) {
        alert("주문 취소 실패: " + err.message);
        btn.disabled = false;
        btn.textContent = "주문 취소";
      }
    });
  });

  // 2. 수령 확인 (구매 확정)
  merchantOrdersList.querySelectorAll("[data-action='confirm-receipt']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      if (!confirm("상품을 정상적으로 수령하셨습니까?\n구매를 확정하고 정산 처리를 완료합니다.")) return;

      btn.disabled = true;
      btn.textContent = "확정 중...";
      try {
        await updateDoc(doc(db, "merchant_orders", id), {
          status: "completed",
          completed_at: serverTimestamp(),
          updated_at: serverTimestamp()
        });
        alert("구매가 확정되었습니다! 감사합니다.");
        await reload();
      } catch (err) {
        alert("구매 확정 실패: " + err.message);
        btn.disabled = false;
        btn.textContent = "✅ 상품 수령 확인 (구매 확정)";
      }
    });
  });

  // 3. 계좌이체 확인 요청 모달
  merchantOrdersList.querySelectorAll("[data-action='open-transfer-modal']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.getAttribute("data-id");
      const merchantId = btn.getAttribute("data-merchant-id");
      const amount = Number(btn.getAttribute("data-amount") || 0);

      const m = await getMerchant(merchantId);
      const bankName = m?.bank_name || "베트남 신한은행";
      const accountNo = m?.account_no || "700-012-345678";
      const accountHolder = m?.account_holder || (m?.name ? `BESTCLUB / ${m.name}` : "BESTCLUB");

      openTransferModal(orderId, merchantId, amount, bankName, accountNo, accountHolder);
    });
  });
}

// ── 가맹점 주문 로드 ──────────────────────────────────────
async function loadMerchantOrders(uid) {
  merchantOrdersList.innerHTML = "";
  setState("가맹점 상품 주문 내역을 불러오는 중...");

  try {
    const q = query(
      collection(db, "merchant_orders"),
      where("buyer_uid", "==", uid),
      limit(100)
    );

    const snap = await getDocs(q);
    const rows = [];
    snap.forEach((d) => {
      const data = d.data();
      rows.push({
        id: d.id,
        ...data,
        _t: toMs(data.created_at || data.createdAt)
      });
    });

    rows.sort((a, b) => (b._t || 0) - (a._t || 0));

    if (!rows.length) {
      setState("");
      merchantOrdersList.innerHTML = `
        <div class="empty" style="text-align:center; padding:40px 20px; background:#fff; border:1px dashed #cbd5e1; border-radius:14px;">
          <div style="font-size:2.4rem; margin-bottom:12px;">🛍️</div>
          <h3 style="margin:0 0 8px 0; color:#1e293b; font-size:1.15rem;">주문한 상품이 없습니다.</h3>
          <p style="color:#64748b; font-size:0.9rem; margin:0 0 16px 0;">BestClub 공식 쇼핑몰에서 베트남 엄선 가맹점 상품을 주문해 보세요!</p>
          <a href="/mall.html" class="btn btn--primary" style="display:inline-block; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:700;">🛍️ 쇼핑몰 구경하러 가기</a>
        </div>
      `;
      return;
    }

    setState("");
    merchantOrdersList.innerHTML = rows.map(renderMerchantOrderCard).join("");
    bindMerchantOrderActions();
  } catch (err) {
    console.error("loadMerchantOrders error:", err);
    setState("가맹점 주문을 불러오지 못했습니다: " + err.message, "bad");
  }
}

// ── 레거시 코압몰 주문 ────────────────────────────────────
function statusChip(status) {
  const v = String(status || "").toLowerCase();
  const vv = (v === "submitted" || v === "requested") ? "pending" : v;
  const label =
    (vv === "paid" || vv === "pending") ? "결제확인 대기" :
    (vv === "confirmed") ? "결제 완료" :
    (vv === "settled" || vv === "completed") ? "정산 완료" :
    (vv === "burned") ? "사용 완료" :
    (vv === "canceled") ? "취소" :
    (vv ? vv.toUpperCase() : "UNKNOWN");

  const cls =
    (vv === "canceled") ? "chip chip--bad" :
    (vv === "burned") ? "chip chip--warn" :
    (vv === "paid" || vv === "pending" || vv === "confirmed" || vv === "settled" || vv === "completed") ? "chip chip--ok" :
    "chip";

  return `<span class="${cls}">${esc(label)}</span>`;
}

const COOP_TYPE_LABEL = {
  membership:       '정회원',
  general:          '일반상품',
  voucher:          '바우처',
  treasure_package: '보물패키지',
};
const OPBNB_TX = 'https://mainnet.opbnbscan.com/tx/';

function renderCoopOrderCard(o) {
  const title     = o.productName || '(상품명 없음)';
  const typeLabel = COOP_TYPE_LABEL[o.type] || (o.type || '');
  const hexPrice  = o.hexPrice != null ? `${o.hexPrice} Point` : '';
  const when      = fmtTs(o.createdAt);
  const txHash    = o.txHash || '';
  const pkgId     = o.packageId || '';

  return `
  <article class="card card--row">
    <div class="card-body">
      <div class="card-title">${esc(title)} ${statusChip(o.status)} ${typeLabel ? `<span class="chip">${esc(typeLabel)}</span>` : ''}</div>
      <div class="card-meta">
        ${when ? `<span>${esc(when)}</span>` : ''}
        ${hexPrice ? `<span>· ${esc(hexPrice)}</span>` : ''}
      </div>
      ${pkgId ? `<div class="card-meta"><span>패키지 ID: <code>${esc(pkgId)}</code></span></div>` : ''}
      ${txHash ? `<div class="card-meta"><a href="${OPBNB_TX}${esc(txHash)}" target="_blank" rel="noopener noreferrer" class="link-muted">TX: ${esc(txHash.slice(0, 12))}…</a></div>` : ''}
    </div>
  </article>`;
}

async function loadCoopOrders(uid) {
  coopOrdersList.innerHTML = '';
  setState('코압몰 구매내역 불러오는 중...');

  const q = query(
    collection(db, 'coopOrders'),
    where('uid', '==', uid),
    limit(100)
  );

  const snap = await getDocs(q);
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data(), _t: toMs(d.data()?.createdAt) }));

  rows.sort((a, b) => (b._t || 0) - (a._t || 0));

  if (!rows.length) {
    setState('코압몰 구매내역이 없습니다.', 'muted');
    return;
  }

  setState('');
  coopOrdersList.innerHTML = rows.map(renderCoopOrderCard).join('');
}

// ── 레거시 일반 주문 ──────────────────────────────────────
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

async function loadOrders(uid) {
  ordersList.innerHTML = "";
  setState("일반 주문 불러오는 중...");

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
    setState("일반 주문이 없습니다.", "muted");
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

// ── 레거시 내 리뷰 ────────────────────────────────────────
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

async function loadMyReviews(uid) {
  myReviewsList.innerHTML = "";
  setState("내 리뷰 불러오는 중...");

  const q1 = query(
    collection(db, "reviews"),
    where("authorUid", "==", uid),
    limit(300)
  );

  const snap1 = await getDocs(q1);
  const rows1 = [];
  snap1.forEach((d) => rows1.push({ id: d.id, ...d.data(), _t: toMs(d.data()?.createdAt) }));

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

// ── 탭 제어 및 데이터 로드 ────────────────────────────────
function activeTab() {
  if (tabMerchantOrders?.classList.contains("tab--active")) return "merchant";
  if (tabCoop?.classList.contains("tab--active"))           return "coop";
  if (tabReviews?.classList.contains("tab--active"))        return "reviews";
  return "orders";
}

async function reload() {
  const user = auth.currentUser;
  if (!user) {
    setState("로그인이 필요합니다.", "bad");
    merchantOrdersList.innerHTML = "";
    coopOrdersList.innerHTML     = "";
    ordersList.innerHTML         = "";
    myReviewsList.innerHTML      = "";
    return;
  }

  const tab = activeTab();
  if (tab === "merchant")    await loadMerchantOrders(user.uid);
  else if (tab === "coop")   await loadCoopOrders(user.uid);
  else if (tab === "reviews")await loadMyReviews(user.uid);
  else                       await loadOrders(user.uid);
}

tabMerchantOrders?.addEventListener("click", async () => {
  setTab("merchant");
  await reload();
});

tabCoop?.addEventListener("click", async () => {
  setTab("coop");
  await reload();
});

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
    setTab("merchant");
    await reload();
  } catch (e) {
    setState("권한 또는 네트워크 문제로 데이터를 읽지 못했습니다.", "bad");
  }
});
