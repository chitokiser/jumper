// /assets/js/pages/admin_stats.js
import {
  db,
  collection,
  query,
  getDocs,
  where,
  limit,
} from "../firestore-bridge.js";

import { onAuthReady } from "../auth.js";
import { isAdmin } from "../roles.js";

function isHomestayCategory(cat) {
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
function $(sel) { return document.querySelector(sel); }
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function esc(s = "") { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function fmt2(v) { return (Math.round(v * 100) / 100).toFixed(2); }

function rowHTML(title, sub, value, hint = "") {
  return `
  <div class="row">
    <div class="l">
      <div class="t">${esc(title)}</div>
      <div class="sub">${esc(sub)}</div>
    </div>
    <div class="r">${esc(String(value))}${hint ? `<span>${esc(hint)}</span>` : ""}</div>
  </div>`;
}

function computeGuideLeaders(items) {
  const map = new Map();
  for (const it of items) {
    const guideUid = it.guideUid || it.ownerUid || it.uid || "unknown";
    const guideName = it.guideName || it.ownerName || it.displayName || "";
    if (!map.has(guideUid)) {
      map.set(guideUid, { guideUid, guideName, items: 0, reviewCount: 0, weightedSum: 0 });
    }
    const g = map.get(guideUid);
    g.items += 1;
    g.guideName = g.guideName || guideName;

    const c = n(it.reviewCount, 0);
    const a = n(it.reviewAvg, 0);
    g.reviewCount += c;
    g.weightedSum += a * c;
  }
  const arr = Array.from(map.values()).map(g => {
    const weightedAvg = g.reviewCount > 0 ? (g.weightedSum / g.reviewCount) : 0;
    return { ...g, weightedAvg };
  });
  arr.sort((a, b) => {
    if ((b.weightedAvg || 0) !== (a.weightedAvg || 0)) return (b.weightedAvg || 0) - (a.weightedAvg || 0);
    if ((b.reviewCount || 0) !== (a.reviewCount || 0)) return (b.reviewCount || 0) - (a.reviewCount || 0);
    return (b.items || 0) - (a.items || 0);
  });
  return arr.slice(0, 10);
}

async function loadAllItemsLite() {
  // 통계는 전체를 보고 싶지만, 인덱스/비용/성능을 위해 500개까지만
  const q = query(collection(db, "items"), limit(500));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      status: x.status || "",
      type: (x.type || ""),
      category: x.category || "기타",
      guideUid: x.guideUid || x.ownerUid || x.uid || "",
      guideName: x.guideName || x.ownerName || x.displayName || "",
      reviewAvg: n(x.reviewAvg, 0),
      reviewCount: n(x.reviewCount, 0),
    };
  });
}

async function loadOrdersLite() {
  // orders 통계도 500개까지만
  const q = query(collection(db, "orders"), limit(500));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      payMethod: x.payMethod || x.paymentMethod || "unknown",
      status: x.status || "",
    };
  });
}

function countBy(arr, keyFn) {
  const m = new Map();
  for (const a of arr) {
    const k = keyFn(a) || "unknown";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

async function loadAllKCultureLite() {
  const q = query(collection(db, "k_culture_balances"), limit(2000));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    id: d.id,
    paymentBalanceVnd: n(d.data().paymentBalanceVnd, 0),
    pointBalance: n(d.data().pointBalance, 0),
    role: (d.data().role) || "customer" // default assumptions if not fully mapped
  }));
}

async function render() {
  $("#state").textContent = "로딩중...";

  const items = await loadAllItemsLite();
  const orders = await loadOrdersLite();

  const totalItems = items.length;
  const published = items.filter(x => x.status === "published").length;
  const pending = items.filter(x => x.status === "pending").length;

  $("#kItems").textContent = String(totalItems);
  $("#kPublished").textContent = String(published);
  $("#kPending").textContent = String(pending);
  $("#kOrders").textContent = String(orders.length);

  try {
    const balances = await loadAllKCultureLite();
    let totPayment = 0, totPoint = 0;

    // As K-Culture balances may not explicitly have role populated,
    // we can lookup merchants collection or assume non-users are merchants for this demo.
    // Real-world would sync with `users` doc or `merchants` doc.
    const mSnap = await getDocs(collection(db, "merchants"));
    const merchantIds = new Set(mSnap.docs.map(d => d.id));

    let merchCnt = 0, merchPay = 0;
    let custCnt = 0, custPoint = 0;

    for (const b of balances) {
      totPayment += b.paymentBalanceVnd;
      totPoint += b.pointBalance;

      if (merchantIds.has(b.id)) {
        merchCnt++;
        merchPay += b.paymentBalanceVnd;
      } else {
        custCnt++;
        custPoint += b.pointBalance;
      }
    }

    if ($("#kTotalPaymentVnd")) $("#kTotalPaymentVnd").textContent = totPayment.toLocaleString("ko-KR") + " VND";
    if ($("#kTotalPoint")) $("#kTotalPoint").textContent = totPoint.toLocaleString("ko-KR") + " P";

    if ($("#kTotalMerchants")) $("#kTotalMerchants").textContent = merchCnt.toLocaleString("ko-KR") + " 개점";
    if ($("#kMerchantPaymentVnd")) $("#kMerchantPaymentVnd").textContent = merchPay.toLocaleString("ko-KR") + " VND";

    if ($("#kTotalCustomers")) $("#kTotalCustomers").textContent = custCnt.toLocaleString("ko-KR") + " 명";
    if ($("#kCustomerPoint")) $("#kCustomerPoint").textContent = custPoint.toLocaleString("ko-KR") + " P";

  } catch (err) {
    console.error("Failed to load K-culture metrics:", err);
  }

  $("#state").textContent = `집계 완료 (items/orders/balances 최대 limit 집계)`;
}

onAuthReady(async ({ user, profile }) => {
  if (!user) {
    $("#state").textContent = "로그인 필요";
    return;
  }
  if (!isAdmin(profile)) {
    $("#state").textContent = "관리자만 접근 가능합니다.";
    return;
  }
  try {
    await render();
  } catch (e) {
    console.error(e);
    $("#state").textContent = "오류: " + (e?.message || String(e));
  }
});
