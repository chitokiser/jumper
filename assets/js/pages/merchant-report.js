// /assets/js/pages/merchant-report.js
// 가맹점주 1분 모바일 리포트 (테넌트·멘티 격리 준수: 오직 본인 직속 멘티와 본인 매장 주문/입금만 조회)

import { onAuthReady } from "../auth.js";
import { db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

function maskEmail(email) {
  const s = String(email || "").trim();
  const at = s.indexOf("@");
  if (at <= 2) return s ? "***" : "-";
  return s.slice(0, 2) + "***" + s.slice(at);
}

function toDateMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const parsed = Date.parse(String(ts));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatShortDate(ms) {
  if (!ms) return "-";
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

let _ctx = null;

async function loadReport({ uid, email }) {
  show("mrLoading", true);
  show("mrContent", false);

  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const merchantId = userData.merchantId ?? userData.merchant_id;

    if (merchantId == null || merchantId === "") {
      show("mrLoading", false);
      show("mrNeedMerchant", true);
      return;
    }

    const midStr = String(merchantId);
    const midNum = Number(merchantId);
    const ownerEmail = String(email || userData.email || "").toLowerCase();

    const mSnap = await getDoc(doc(db, "merchants", midStr));
    const mData = mSnap.exists() ? mSnap.data() : {};
    const merchantName = mData.name || "내 가맹점";
    const ownerUid = mData.ownerUid || uid;

    // 1. 헤더 & 잔액
    setText("mrMerchantName", merchantName);
    setText("mrMerchantMeta", `가맹점 ID: ${midStr} · 조회: ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`);

    const ownerSnap = ownerUid === uid ? userSnap : await getDoc(doc(db, "users", ownerUid));
    const ownerData = ownerSnap.exists() ? ownerSnap.data() : userData;

    setText("mrBalBm", `${Number(ownerData.pointBalanceVnd || 0).toLocaleString("ko-KR")} BM`);
    setText("mrBalPoint", `보유 포인트: ${Number(ownerData.pointBalance || 0).toLocaleString("ko-KR")} P`);
    setText("mrBalBt", `${Number(mData.btBalance || 0).toLocaleString("ko-KR")} BT`);
    const btRate = Math.max(1000, Number(mData.btPerVnd || mData.btGrantThresholdVnd || 100000));
    setText("mrBtRate", `기준: ${btRate.toLocaleString("ko-KR")} VND당 1장`);

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    // 2. 내 직속 멘티 조회 (테넌트 격리: mentorUid == ownerUid 또는 mentorEmail == ownerEmail)
    const menteeMap = new Map();
    try {
      const qUid = query(collection(db, "users"), where("mentorUid", "==", ownerUid), limit(200));
      const snapUid = await getDocs(qUid);
      snapUid.forEach((d) => {
        if (d.id !== ownerUid) menteeMap.set(d.id, { id: d.id, ...d.data() });
      });
    } catch (_) {}

    if (ownerEmail) {
      try {
        const qEmail = query(collection(db, "users"), where("mentorEmail", "==", ownerEmail), limit(200));
        const snapEmail = await getDocs(qEmail);
        snapEmail.forEach((d) => {
          if (d.id !== ownerUid && !menteeMap.has(d.id)) {
            menteeMap.set(d.id, { id: d.id, ...d.data() });
          }
        });
      } catch (_) {}
    }

    const mentees = Array.from(menteeMap.values()).sort(
      (a, b) => toDateMs(b.registeredAt || b.createdAt) - toDateMs(a.registeredAt || a.createdAt)
    );
    const recentWeekMentees = mentees.filter((m) => toDateMs(m.registeredAt || m.createdAt) >= sevenDaysAgo).length;

    setText("mrMenteeTotal", `${mentees.length.toLocaleString("ko-KR")}명`);
    setText("mrMenteeWeek", `최근 7일 신규: +${recentWeekMentees}명`);

    const listEl = $("mrMenteeList");
    if (listEl) {
      if (mentees.length === 0) {
        listEl.innerHTML = `<div class="mr-empty">아직 등록된 직속 멘티가 없습니다. <a href="/merchant-qr.html" style="color:#4f46e5;font-weight:700;">멘티 초대 QR 포스터</a>를 매장에 비치해 보세요!</div>`;
      } else {
        listEl.innerHTML = mentees
          .slice(0, 10)
          .map((m) => {
            const name = m.name || m.displayName || "회원";
            const dt = formatShortDate(toDateMs(m.registeredAt || m.createdAt));
            return `
              <div class="mr-row">
                <div>
                  <div class="mr-row-name">${name}</div>
                  <div class="mr-row-meta">${maskEmail(m.email)}</div>
                </div>
                <div class="mr-row-meta">${dt}</div>
              </div>`;
          })
          .join("");
      }
    }

    // 3. 최근 7일 QR 입금 (transactions where uid == ownerUid && type == merchant_income)
    let qrWeekSum = 0;
    let qrTodaySum = 0;
    let qrTodayCount = 0;
    try {
      const qTx = query(
        collection(db, "transactions"),
        where("uid", "==", ownerUid),
        where("type", "==", "merchant_income"),
        limit(200)
      );
      const txSnap = await getDocs(qTx);
      txSnap.forEach((d) => {
        const data = d.data() || {};
        const ms = toDateMs(data.createdAt);
        const amt = Number(data.amountVnd || 0);
        if (ms >= sevenDaysAgo) qrWeekSum += amt;
        if (ms >= todayStartMs) {
          qrTodaySum += amt;
          qrTodayCount += 1;
        }
      });
    } catch (_) {}

    setText("mrQrIncomeWeek", `${qrWeekSum.toLocaleString("ko-KR")} VND`);
    setText("mrQrIncomeToday", `오늘 입금: ${qrTodaySum.toLocaleString("ko-KR")} VND (${qrTodayCount}건)`);

    // 4. 온라인 주문 & 직속 멘티 vs 제휴회원(Affiliate) 분류
    let totalOrders = 0;
    let weekOrders = 0;
    let weekSales = 0;
    let menteeOrders = 0;
    let affiliateOrders = 0;

    try {
      const idCandidates = Number.isFinite(midNum) ? [midStr, midNum] : [midStr];
      const qOrders = query(
        collection(db, "merchant_orders"),
        where("merchant_id", "in", idCandidates),
        limit(200)
      );
      const oSnap = await getDocs(qOrders);
      oSnap.forEach((d) => {
        const o = d.data() || {};
        totalOrders += 1;
        const ms = toDateMs(o.created_at || o.createdAt);
        const amt = Number(o.total_amount || o.totalAmount || 0);
        if (ms >= sevenDaysAgo) {
          weekOrders += 1;
          weekSales += amt;
        }
        const buyerUid = o.buyer_uid || o.userId || o.uid || "";
        const memberType = String(o.member_type || o.memberType || "").toLowerCase();
        if (memberType === "mentee" || (buyerUid && menteeMap.has(buyerUid))) {
          menteeOrders += 1;
        } else {
          affiliateOrders += 1;
        }
      });
    } catch (_) {}

    setText("mrOrderTotalBadge", `누적 ${totalOrders}건`);
    setText("mrOrderMentee", `${menteeOrders}건`);
    setText("mrOrderAffiliate", `${affiliateOrders}건`);
    setText("mrOrderWeekSummary", `최근 7일 주문: ${weekOrders}건 · 합계 ${weekSales.toLocaleString("ko-KR")} VND`);

    show("mrLoading", false);
    show("mrContent", true);
  } catch (err) {
    console.error("merchant-report load error:", err);
    show("mrLoading", false);
    const loadingEl = $("mrLoading");
    if (loadingEl) {
      loadingEl.style.display = "";
      loadingEl.style.color = "#dc2626";
      loadingEl.textContent = "리포트를 불러오는 중 오류가 발생했습니다: " + (err?.message || err);
    }
  }
}

let _authDone = false;

onAuthReady(async ({ loggedIn, role, user }) => {
  if (_authDone) return;

  if (!loggedIn || !user) {
    show("mrLoading", false);
    show("mrNeedLogin", true);
    return;
  }

  if (role !== "merchant" && role !== "admin") {
    show("mrLoading", false);
    show("mrNeedMerchant", true);
    return;
  }

  _authDone = true;
  _ctx = { uid: user.uid, email: user.email || "" };
  await loadReport(_ctx);
});

$("mrBtnRefresh")?.addEventListener("click", () => {
  if (_ctx) loadReport(_ctx);
});

setTimeout(() => {
  if (!_authDone) {
    show("mrLoading", false);
    show("mrNeedLogin", true);
  }
}, 4000);
