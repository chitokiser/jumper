// /assets/js/bc-live-hub.js
// BestClubVN 통합 실시간 알림 벨(🔔 중고거래 채팅·가격제안 / 공동구매·가맹점 주문) + 일일 미션 & 출석 허브(🎯)
import { auth, db } from "/assets/js/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { claimFreeDailyGp } from "/assets/js/free-gp.js";

const VN_OFFSET_MS = 7 * 3600 * 1000;
function todayVnStr() {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? n : 0;
}

function relTimeFromMs(ms) {
  if (!ms) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const hr = Math.floor(diffMin / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

// ── 3순위: 일일 퀘스트 / 출석 체크 상태 관리 ──
const QUEST_LIST = [
  {
    key: "attendance",
    icon: "📅",
    title: "오늘의 출석 & 무료 GP 체크",
    sub: "매일 출석 도장 찍고 GP 100 미만 시 +100 GP 즉시 무료 충전",
    actionText: "출석 체크",
    href: "#attendance",
  },
  {
    key: "groupbuy",
    icon: "🔥",
    title: "하노이 공동구매 · 타임특가 구경하기",
    sub: "진행 중인 교민 공동구매 특가와 목표 달성 BM 보너스 확인",
    actionText: "공구 구경 →",
    href: "/mall.html?filter=groupbuy",
  },
  {
    key: "karrot",
    icon: "🥕",
    title: "당근 중고장터 동네 매물 둘러보기",
    sub: "미딩·서호·하동·오션파크 이웃 중고 매물 & 무료나눔 확인",
    actionText: "장터 구경 →",
    href: "/used.html",
  },
  {
    key: "arcade",
    icon: "🎮",
    title: "아케이드 게임 1판 도전하기",
    sub: "당구·테트리스·뱅크패닉·2048·수이카 플레이하고 주간 3억 GP 도전",
    actionText: "게임 도전 →",
    href: "/games.html",
  },
];

function getQuestStorageKey(uid) {
  return `bc_daily_quests_${uid || "guest"}_${todayVnStr()}`;
}

function loadQuestState(uid) {
  try {
    const raw = localStorage.getItem(getQuestStorageKey(uid));
    if (raw) return JSON.parse(raw) || {};
  } catch (_) {}
  return {};
}

function saveQuestState(uid, state) {
  try {
    localStorage.setItem(getQuestStorageKey(uid), JSON.stringify(state));
  } catch (_) {}
}

function autoDetectPageQuest(uid) {
  const path = (window.location.pathname || "").toLowerCase();
  const state = loadQuestState(uid);
  let changed = false;

  if (path.includes("/mall")) {
    if (!state.groupbuy) { state.groupbuy = Date.now(); changed = true; }
  }
  if (path.includes("/used")) {
    if (!state.karrot) { state.karrot = Date.now(); changed = true; }
  }
  if (
    path.includes("/games") ||
    path.includes("/billiards") ||
    path.includes("/tetris") ||
    path.includes("/bankpanic") ||
    path.includes("/suika") ||
    path.includes("/2048") ||
    path.includes("/memory") ||
    path.includes("/relay")
  ) {
    if (!state.arcade) { state.arcade = Date.now(); changed = true; }
  }

  if (changed) saveQuestState(uid, state);
  return state;
}

// ── 스타일 주입 ──
function injectStyles() {
  if (document.getElementById("bcLiveHubCss")) return;
  const st = document.createElement("style");
  st.id = "bcLiveHubCss";
  st.textContent = `
.bc-notif-wrap{position:relative;display:inline-flex;align-items:center;margin-right:8px}
.bc-notif-btn{position:relative;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;transition:all .15s}
.bc-notif-btn:hover{background:#eff6ff;border-color:#93c5fd}
.bc-notif-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:10px;font-weight:900;min-width:17px;height:17px;border-radius:999px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(239,68,68,.4)}
.bc-notif-badge[hidden]{display:none!important}
.bc-hub-pop{position:fixed;top:60px;right:14px;width:min(380px,calc(100vw - 24px));max-height:80vh;background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 16px 42px rgba(15,23,42,.22);z-index:9999;display:flex;flex-direction:column;overflow:hidden;color:#0f172a}
.bc-hub-pop[hidden]{display:none!important}
.bc-hub-tabs{display:flex;background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:6px;gap:6px}
.bc-hub-tab{flex:1;padding:8px 10px;border:none;border-radius:10px;background:transparent;font-size:12.5px;font-weight:800;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px}
.bc-hub-tab.is-active{background:#fff;color:#0f172a;box-shadow:0 2px 6px rgba(15,23,42,.08)}
.bc-hub-body{padding:12px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px}
.bc-notif-item{display:flex;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid #e2e8f0;background:#fff;text-decoration:none;color:inherit;transition:background .15s}
.bc-notif-item:hover{background:#f8fafc}
.bc-notif-item.unread{background:#fff7ed;border-color:#fed7aa}
.bc-notif-ico{font-size:20px;flex-shrink:0;margin-top:1px}
.bc-notif-main{flex:1;min-width:0}
.bc-notif-title{font-size:12.5px;font-weight:800;color:#0f172a;line-height:1.35;margin-bottom:2px}
.bc-notif-sub{font-size:11.5px;color:#475569;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bc-notif-time{font-size:10.5px;color:#94a3b8;margin-top:3px}
.bc-quest-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}
.bc-quest-row.done{background:#f0fdf4;border-color:#bbf7d0}
.bc-quest-btn{padding:6px 11px;border-radius:99px;font-size:11.5px;font-weight:800;text-decoration:none;border:none;cursor:pointer;white-space:nowrap;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff}
.bc-quest-btn.done{background:#16a34a;color:#fff;cursor:default}

/* 홈 화면 일일 퀘스트 위젯 */
.bc-home-quest-bar{background:linear-gradient(135deg,#0f172a,#1e1b4b);border:1px solid rgba(99,102,241,.4);border-radius:16px;padding:14px 16px;color:#fff;margin-top:10px;box-shadow:0 8px 24px rgba(15,23,42,.16)}
.bc-hq-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.bc-hq-title{font-size:15px;font-weight:900;color:#fde047;display:flex;align-items:center;gap:6px}
.bc-hq-prog{font-size:12px;font-weight:800;color:#86efac;background:rgba(255,255,255,.1);padding:3px 10px;border-radius:99px}
.bc-hq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.bc-hq-card{display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:9px 11px;text-decoration:none;color:#fff;transition:transform .15s,border-color .15s;cursor:pointer}
.bc-hq-card:hover{transform:translateY(-1px);border-color:#fde047}
.bc-hq-card.done{border-color:#22c55e;background:rgba(34,197,94,.14)}
`;
  document.head.appendChild(st);
}

let _currentUid = null;
let _notifications = [];
let _unreadCount = 0;
let _activeTab = "notif";

function getLastReadMs(uid) {
  try {
    return Number(localStorage.getItem(`bc_notif_read_${uid}`)) || 0;
  } catch {
    return 0;
  }
}

function markAllRead(uid) {
  if (!uid) return;
  try {
    localStorage.setItem(`bc_notif_read_${uid}`, String(Date.now()));
  } catch {}
  _unreadCount = 0;
  updateBellBadge();
}

function updateBellBadge() {
  const badge = document.getElementById("bcNotifBadge");
  if (!badge) return;
  const qState = loadQuestState(_currentUid);
  const doneCnt = QUEST_LIST.filter((q) => !!qState[q.key]).length;
  const pendingAttendance = _currentUid && !qState.attendance ? 1 : 0;
  const totalBadge = _unreadCount + pendingAttendance;
  if (totalBadge > 0) {
    badge.hidden = false;
    badge.textContent = totalBadge > 99 ? "99+" : String(totalBadge);
  } else {
    badge.hidden = true;
  }
  renderHomeQuestWidget();
}

async function handleAttendanceClick(e) {
  if (e) e.preventDefault();
  const state = loadQuestState(_currentUid);
  state.attendance = Date.now();
  saveQuestState(_currentUid, state);

  if (_currentUid) {
    try {
      const r = await claimFreeDailyGp();
      if (r?.granted) {
        alert("🎉 오늘의 출석 체크 완료! 보유 GP가 100 미만이어서 +100 GP가 무료 충전되었습니다!");
      } else {
        alert("✅ 오늘의 출석 체크 도장이 찍혔습니다! 공동구매·중고장터·아케이드 미션도 달성해 보세요.");
      }
    } catch {
      alert("✅ 오늘의 출석 체크가 완료되었습니다!");
    }
  } else {
    alert("✅ 오늘의 출석 체크 완료! (로그인하시면 무료 GP 충전 및 주간 랭킹 보상을 받을 수 있습니다)");
  }
  updateBellBadge();
  renderHubBody();
}

function renderHubBody() {
  const body = document.getElementById("bcHubBody");
  if (!body) return;

  if (_activeTab === "notif") {
    if (!_currentUid) {
      body.innerHTML = `
        <div style="text-align:center;padding:24px 12px;color:#64748b;font-size:13px;">
          🔒 로그인하시면 <b>당근 중고거래 채팅·가격제안</b>과 <b>공동구매·가맹점 주문 알림</b>을 실시간으로 받을 수 있습니다.<br><br>
          <a href="/login.html" style="display:inline-block;background:#2563eb;color:#fff;padding:7px 16px;border-radius:99px;text-decoration:none;font-weight:800;font-size:12.5px;">로그인하기 →</a>
        </div>`;
      return;
    }
    if (!_notifications.length) {
      body.innerHTML = `
        <div style="text-align:center;padding:22px 12px;color:#64748b;font-size:12.5px;line-height:1.6;">
          🔔 아직 도착한 새 거래·채팅 알림이 없습니다.<br>
          <span style="font-size:11.5px;color:#94a3b8;">내 중고 매물에 채팅/가격제안이 오거나 주문 상태가 변경되면 여기에 즉시 표시됩니다.</span>
        </div>`;
      return;
    }
    const lastRead = getLastReadMs(_currentUid);
    body.innerHTML = _notifications
      .map((n) => {
        const isUnread = n.ms > lastRead;
        return `
          <a class="bc-notif-item${isUnread ? " unread" : ""}" href="${esc(n.href)}">
            <span class="bc-notif-ico">${n.icon}</span>
            <div class="bc-notif-main">
              <div class="bc-notif-title">${esc(n.title)}</div>
              <div class="bc-notif-sub">${esc(n.sub)}</div>
              <div class="bc-notif-time">${esc(relTimeFromMs(n.ms))}</div>
            </div>
          </a>`;
      })
      .join("");
  } else {
    const qState = loadQuestState(_currentUid);
    const doneCnt = QUEST_LIST.filter((q) => !!qState[q.key]).length;
    body.innerHTML = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12.5px;font-weight:800;color:#0f172a;">오늘의 플랫폼 순환 미션</span>
        <span style="font-size:12px;font-weight:900;color:#2563eb;">${doneCnt} / ${QUEST_LIST.length} 완료</span>
      </div>
      ${QUEST_LIST.map((q) => {
        const done = !!qState[q.key];
        return `
          <div class="bc-quest-row${done ? " done" : ""}">
            <span style="font-size:20px;">${q.icon}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12.5px;font-weight:800;color:#0f172a;">${esc(q.title)}</div>
              <div style="font-size:11px;color:#64748b;">${esc(q.sub)}</div>
            </div>
            ${
              q.key === "attendance"
                ? `<button type="button" class="bc-quest-btn${done ? " done" : ""}" data-quest-att="1">${done ? "✅ 완료" : q.actionText}</button>`
                : `<a class="bc-quest-btn${done ? " done" : ""}" href="${esc(q.href)}">${done ? "✅ 완료" : q.actionText}</a>`
            }
          </div>`;
      }).join("")}
    `;
    const attBtn = body.querySelector("[data-quest-att]");
    if (attBtn) attBtn.onclick = handleAttendanceClick;
  }
}

function renderHomeQuestWidget() {
  const gameSec = document.getElementById("gameBannerSection");
  if (!gameSec) return;
  let bar = document.getElementById("bcHomeQuestBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "bcHomeQuestBar";
    bar.className = "bc-home-quest-bar";
    gameSec.appendChild(bar);
  }
  const qState = loadQuestState(_currentUid);
  const doneCnt = QUEST_LIST.filter((q) => !!qState[q.key]).length;
  bar.innerHTML = `
    <div class="bc-hq-head">
      <div class="bc-hq-title">🎯 오늘의 베스트클럽 일일 미션 <small style="font-size:11.5px;color:#cbd5e1;font-weight:600;">(출석 · 공동구매 · 당근장터 · 아케이드)</small></div>
      <span class="bc-hq-prog">${doneCnt === QUEST_LIST.length ? "🎉 오늘 미션 올클리어!" : `오늘 달성 ${doneCnt} / ${QUEST_LIST.length}`}</span>
    </div>
    <div class="bc-hq-grid">
      ${QUEST_LIST.map((q) => {
        const done = !!qState[q.key];
        const tag = q.key === "attendance" ? "div" : "a";
        const hrefAttr = q.key === "attendance" ? `data-home-att="1"` : `href="${esc(q.href)}"`;
        return `
          <${tag} class="bc-hq-card${done ? " done" : ""}" ${hrefAttr}>
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <span style="font-size:18px;">${q.icon}</span>
              <div style="min-width:0;">
                <div style="font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(q.title)}</div>
                <div style="font-size:10.5px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${done ? "✅ 오늘 달성 완료" : esc(q.actionText)}</div>
              </div>
            </div>
            <span style="font-size:11px;font-weight:900;color:${done ? "#4ade80" : "#fde047"};flex-shrink:0;">${done ? "완료" : "GO →"}</span>
          </${tag}>`;
      }).join("")}
    </div>
  `;
  const homeAtt = bar.querySelector("[data-home-att]");
  if (homeAtt) homeAtt.onclick = handleAttendanceClick;
}

async function fetchUserNotifications(uid) {
  if (!uid) {
    _notifications = [];
    _unreadCount = 0;
    updateBellBadge();
    return;
  }
  const items = [];

  // 1) 내 당근 중고장터 매물에 들어온 채팅 & 가격제안 조회
  try {
    const snap = await getDocs(
      query(collection(db, "purchaseRequests"), where("sellerUid", "==", uid), limit(25))
    );
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.senderUid === uid) return; // 내가 쓴 답글 제외
      const ms = toMs(data.createdAt);
      const offer = Number(data.offerPrice || 0);
      items.push({
        id: `chat_${d.id}`,
        icon: offer > 0 ? "💰" : "🥕",
        title: offer > 0
          ? `[가격제안 ${offer.toLocaleString()} VND] ${data.usedPostTitle || "중고 매물"}`
          : `[당근톡 문의] ${data.usedPostTitle || "중고 매물"}`,
        sub: `${data.senderName || "이웃"}: ${data.message || ""}`,
        ms,
        href: `/used-market-item.html?id=${encodeURIComponent(data.usedPostId || "")}#umChatSection`,
      });
    });
  } catch (_) {}

  // 2) 내가 구매자로 주문한 쇼핑몰/공동구매 주문 상태
  try {
    const oSnap = await getDocs(
      query(collection(db, "merchant_orders"), where("buyer_uid", "==", uid), limit(15))
    );
    oSnap.forEach((d) => {
      const o = d.data() || {};
      const ms = toMs(o.updated_at || o.created_at);
      const st = o.status === "paid" || o.payment_status === "paid"
        ? "✅ 결제/승인 완료"
        : o.payment_status === "deposit_requested"
        ? "⏳ 송금 확인 대기 중"
        : "🛍️ 주문 접수";
      const firstItem = (Array.isArray(o.items) && o.items[0]?.name) || o.product_name || "가맹점 상품";
      items.push({
        id: `myorder_${d.id}`,
        icon: o.is_group_buy ? "🔥" : "📦",
        title: `${st} · ${firstItem}`,
        sub: `주문금액 ${Number(o.total_amount || o.total_price || 0).toLocaleString()} VND`,
        ms,
        href: "/orders.html",
      });
    });
  } catch (_) {}

  // 3) 4순위 연동: 가맹점주(merchantId 보유)인 경우 내 가맹점에 들어온 신규/입금요청 주문 알림
  try {
    const uSnap = await getDoc(doc(db, "users", uid));
    const mId = uSnap.exists() ? String(uSnap.data()?.merchantId || "").trim() : "";
    if (mId) {
      const mSnap = await getDocs(
        query(collection(db, "merchant_orders"), where("merchant_id", "==", mId), limit(20))
      );
      mSnap.forEach((d) => {
        const o = d.data() || {};
        if (o.status === "cancelled") return;
        const ms = toMs(o.updated_at || o.created_at);
        const isPending = o.status === "pending" || o.payment_status === "deposit_requested";
        const firstItem = (Array.isArray(o.items) && o.items[0]?.name) || o.product_name || "가맹점 주문";
        items.push({
          id: `morder_${d.id}`,
          icon: isPending ? "🚨" : "🏪",
          title: isPending
            ? `[가맹점 주문 승인 대기] ${firstItem}`
            : `[가맹점 주문 완료] ${firstItem}`,
          sub: `고객: ${o.depositor_name || o.buyer_email || "회원"} · ${Number(o.total_amount || 0).toLocaleString()} VND`,
          ms,
          href: "/admin_merchant_orders.html",
        });
      });
    }
  } catch (_) {}

  items.sort((a, b) => b.ms - a.ms);
  _notifications = items.slice(0, 25);

  const lastRead = getLastReadMs(uid);
  _unreadCount = _notifications.filter((n) => n.ms > lastRead).length;
  updateBellBadge();
}

function mountHeaderBell() {
  injectStyles();
  const hdrRight = document.querySelector("#siteHeaderBar .hdr-right");
  if (!hdrRight || document.getElementById("bcNotifBellWrap")) return;

  const wrap = document.createElement("div");
  wrap.id = "bcNotifBellWrap";
  wrap.className = "bc-notif-wrap";
  wrap.innerHTML = `
    <button type="button" class="bc-notif-btn" id="bcNotifBellBtn" title="실시간 거래·채팅 알림 & 일일 미션">
      🔔
      <span class="bc-notif-badge" id="bcNotifBadge" hidden>0</span>
    </button>
    <div class="bc-hub-pop" id="bcLiveHubPanel" hidden>
      <div class="bc-hub-tabs">
        <button type="button" class="bc-hub-tab is-active" data-hub-tab="notif">🔔 실시간 알림</button>
        <button type="button" class="bc-hub-tab" data-hub-tab="quest">🎯 오늘의 미션</button>
      </div>
      <div class="bc-hub-body" id="bcHubBody"></div>
    </div>
  `;

  hdrRight.insertBefore(wrap, hdrRight.firstChild);

  const btn = document.getElementById("bcNotifBellBtn");
  const panel = document.getElementById("bcLiveHubPanel");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    if (willOpen) {
      markAllRead(_currentUid);
      renderHubBody();
    }
  });

  panel.querySelectorAll("[data-hub-tab]").forEach((tBtn) => {
    tBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _activeTab = tBtn.getAttribute("data-hub-tab") || "notif";
      panel.querySelectorAll("[data-hub-tab]").forEach((b) =>
        b.classList.toggle("is-active", b === tBtn)
      );
      renderHubBody();
    });
  });

  document.addEventListener("click", (e) => {
    if (!panel.hidden && !wrap.contains(e.target)) {
      panel.hidden = true;
    }
  });

  updateBellBadge();
}

function initLiveHub() {
  mountHeaderBell();
  autoDetectPageQuest(_currentUid);
  renderHomeQuestWidget();
}

window.addEventListener("partials:mounted", initLiveHub);
window.addEventListener("partials:loaded", initLiveHub);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLiveHub);
} else {
  initLiveHub();
}

onAuthStateChanged(auth, (user) => {
  _currentUid = user?.uid || null;
  autoDetectPageQuest(_currentUid);
  mountHeaderBell();
  fetchUserNotifications(_currentUid);
});
