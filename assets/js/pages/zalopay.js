// /assets/js/pages/zalopay.js
// ZaloPay 포인트 시스템 — 유저 페이지

import { onAuthReady, login } from "../auth.js";
import { db, functions } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, collection, query, where,
  orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);
const setText = (id, v) => { const el=$(id); if(el) el.textContent = v ?? "-"; };

// ── 환율 캐시 ──────────────────────────────────────────
let _rates = null;
async function getRates() {
  if (_rates) return _rates;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    const d = await r.json();
    if (d.result === "success") {
      _rates = { krwPerUsd: d.rates.KRW, vndPerUsd: d.rates.VND };
      return _rates;
    }
  } catch (_) {}
  _rates = { krwPerUsd: 1350, vndPerUsd: 25400 };
  return _rates;
}

function vndToKrw(vnd, rates) {
  return Math.round((vnd / rates.vndPerUsd) * rates.krwPerUsd);
}

// ── 탭 전환 ────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".zp-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".zp-tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".zp-section").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.dataset.tab;
      const tabEl = $(  "tab" + key.charAt(0).toUpperCase() + key.slice(1));
      if (tabEl) tabEl.classList.add("active");
    });
  });
}

// ── 진입점 ────────────────────────────────────────────
let _ready = false;

onAuthReady(async ({ loggedIn, user }) => {
  if (_ready) return;
  if (!loggedIn) {
    $("needLoginPanel").style.display = "";
    $("btnLogin").onclick = async () => { try { await login(); } catch(e) { console.warn(e); } };
    return;
  }
  _ready = true;
  await initPage(user.uid);
});

setTimeout(() => {
  if (!_ready) {
    $("needLoginPanel").style.display = "";
    $("btnLogin").onclick = async () => { try { await login(); } catch(e) { console.warn(e); } };
  }
}, 4000);

// ── 페이지 초기화 ─────────────────────────────────────
let _uid = null;

async function initPage(uid) {
  _uid = uid;
  $("mainPanel").style.display = "";
  initTabs();

  await refreshBalance();
  loadHexInfo();

  $("inputHexAmount")?.addEventListener("input", updateRateHint);

  bindConvertForm();
  bindUseForm();

  document.querySelector('[data-tab="history"]')?.addEventListener("click", () => loadHistory());
  document.querySelector('[data-tab="use"]')?.addEventListener("click", () => loadPendingUsage());
}

// ── 잔액 갱신 ─────────────────────────────────────────
async function refreshBalance() {
  const snap    = await getDoc(doc(db, "users", _uid));
  const balance = snap.data()?.zaloBalance || 0;
  setText("zpBalance", balance.toLocaleString());
  setText("useBalanceHint", balance.toLocaleString());
  const rates = await getRates();
  setText("zpBalanceKrw", vndToKrw(balance, rates).toLocaleString());
}

// ── HEX 보유량 + 시세 로드 ────────────────────────────
let _cachedPriceKrw = 0;
let _cachedVndPerHex = 0;

async function loadHexInfo() {
  setText("zpHexBalance",  "조회 중...");
  setText("zpHexPriceKrw", "조회 중...");
  setText("zpHexTotalKrw", "-");
  setText("zpHexTotalVnd", "-");

  try {
    const statusRes = await httpsCallable(functions, "getJumpBankStatus")();
    const data = statusRes.data || {};

    const hexWei   = BigInt(data.hexBalance || "0");
    const hexAmt   = Number(hexWei) / 1e18;
    const priceKrw = data.usdKrwRate || 0;   // 1 HEX ≈ 1 USD → KRW
    _cachedPriceKrw = priceKrw;

    const rates    = await getRates();
    const priceVnd = priceKrw > 0
      ? Math.round((priceKrw / rates.krwPerUsd) * rates.vndPerUsd)
      : 0;
    _cachedVndPerHex = priceVnd;

    setText("zpHexBalance", `${hexAmt.toFixed(4)} HEX`);

    if (priceKrw > 0) {
      setText("zpHexPriceKrw", `${priceKrw.toLocaleString()}원 / ${priceVnd.toLocaleString()}동`);
      setText("zpHexTotalKrw", `${Math.round(hexAmt * priceKrw).toLocaleString()}원`);
      setText("zpHexTotalVnd", `${Math.round(hexAmt * priceVnd).toLocaleString()}동`);
    } else {
      setText("zpHexPriceKrw", "시세 없음");
    }
  } catch (err) {
    console.warn("loadHexInfo:", err);
    setText("zpHexBalance",  "조회 실패");
    setText("zpHexPriceKrw", "-");
  }
}

// ── 수수료·수령액 미리보기 ─────────────────────────────
async function updateRateHint() {
  const hexAmt = parseFloat($("inputHexAmount")?.value || 0);
  const hint   = $("rateHint");
  if (!hexAmt || hexAmt <= 0) { if (hint) hint.style.display = "none"; return; }
  if (hint) hint.style.display = "";

  const feeHex = Math.round(hexAmt * 200) / 10000;  // 2%
  const netHex = hexAmt - feeHex;

  setText("hintFeeHex", `${feeHex.toFixed(4)} HEX`);
  setText("hintNetHex", `${netHex.toFixed(4)} HEX`);

  let vndPerHex = _cachedVndPerHex;
  if (!vndPerHex) {
    const rates = await getRates();
    if (_cachedPriceKrw > 0) {
      vndPerHex = Math.round((_cachedPriceKrw / rates.krwPerUsd) * rates.vndPerUsd);
      _cachedVndPerHex = vndPerHex;
    }
  }

  if (vndPerHex > 0) {
    const vnd = Math.floor(netHex * vndPerHex);
    setText("hintVnd", `${vnd.toLocaleString()}동`);
  } else {
    setText("hintVnd", "시세 조회 중...");
  }
}

// ── 충전 폼 바인딩 ────────────────────────────────────
function bindConvertForm() {
  $("convertForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hexAmount = parseFloat($("inputHexAmount")?.value || 0);
    const note      = $("inputConvertNote")?.value?.trim() || "";

    if (!hexAmount || hexAmount <= 0) { alert("HEX 수량을 입력해 주세요."); return; }

    const btn = e.submitter;
    btn.disabled = true;
    btn.textContent = "전환 중... (블록체인 처리)";

    try {
      const res = await httpsCallable(functions, "requestZaloConvert")({ hexAmount, note });
      const d   = res.data;
      toast(
        `✅ 전환 완료! +${Number(d.vndAmount).toLocaleString()}동 적립\n` +
        `(수수료: ${d.feeHex.toFixed(4)} HEX)`
      );
      $("convertForm").reset();
      $("rateHint").style.display = "none";
      await refreshBalance();
      await loadHexInfo();
    } catch (err) {
      alert("오류: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = "즉시 전환하기";
    }
  });
}

// ── 사용 폼 바인딩 ────────────────────────────────────
function bindUseForm() {
  $("useForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const vndAmount     = parseFloat($("inputUseVnd")?.value || 0);
    const purpose       = $("inputUsePurpose")?.value?.trim() || "";
    const recipientInfo = $("inputUseRecipient")?.value?.trim() || "";

    if (!vndAmount || vndAmount <= 0) { alert("사용 금액을 입력해 주세요."); return; }
    if (!purpose) { alert("사용 목적을 입력해 주세요."); return; }

    const btn = e.submitter;
    btn.disabled = true;
    btn.textContent = "처리 중...";

    try {
      await httpsCallable(functions, "useZaloBalance")({ vndAmount, purpose, recipientInfo });
      toast(`✅ 사용 신청 완료! 관리자 정산 후 처리됩니다.`);
      $("useForm").reset();
      await refreshBalance();
      await loadPendingUsage();
    } catch (err) {
      alert("오류: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = "포인트 사용 신청";
    }
  });
}

// ── 미정산 사용 내역 ──────────────────────────────────
async function loadPendingUsage() {
  const list = $("pendingUsageList");
  if (!list) return;
  list.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;">불러오는 중...</div>`;

  const snap = await getDocs(query(
    collection(db, "zalo_usage"),
    where("uid", "==", _uid),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc"),
    limit(10)
  ));

  if (snap.empty) {
    list.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;">미정산 사용 내역이 없습니다.</div>`;
    return;
  }

  list.innerHTML = snap.docs.map((d) => {
    const r  = d.data();
    const ts = r.createdAt?.toDate?.() ?? new Date();
    return `
      <div class="zp-item">
        <div class="zp-item-icon">⏳</div>
        <div class="zp-item-body">
          <div class="zp-item-title">${escHtml(r.purpose || "사용")}</div>
          ${r.recipientInfo ? `<div class="zp-item-sub">${escHtml(r.recipientInfo)}</div>` : ""}
          <div class="zp-item-sub">${ts.toLocaleString("ko-KR")} · <span class="badge badge-pending">정산 대기</span></div>
        </div>
        <div class="zp-item-right">
          <div class="zp-item-amount" style="color:var(--danger,#e53e3e);">-${Number(r.vndAmount).toLocaleString()}동</div>
        </div>
      </div>`;
  }).join("");
}

// ── 전체 내역 ─────────────────────────────────────────
async function loadHistory() {
  const list = $("historyList");
  if (!list) return;
  list.innerHTML = `<div class="empty-state"><div class="icon">⏳</div>불러오는 중...</div>`;

  const [txSnap, useSnap] = await Promise.all([
    getDocs(query(
      collection(db, "zalo_transactions"),
      where("uid", "==", _uid),
      orderBy("createdAt", "desc"),
      limit(30)
    )),
    getDocs(query(
      collection(db, "zalo_usage"),
      where("uid", "==", _uid),
      orderBy("createdAt", "desc"),
      limit(20)
    )),
  ]);

  // convert_in은 zalo_transactions에서, use는 zalo_usage에서
  const items = [
    ...txSnap.docs
      .filter(d => d.data().type === "convert_in")
      .map(d => ({ ...d.data(), _type: "convert", _id: d.id })),
    ...useSnap.docs.map(d => ({ ...d.data(), _type: "use", _id: d.id })),
  ].sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📋</div>내역이 없습니다.</div>`;
    return;
  }

  list.innerHTML = items.map((r) => {
    const ts = r.createdAt?.toDate?.() ?? new Date();
    const timeStr = ts.toLocaleString("ko-KR");

    if (r._type === "convert") {
      return `
        <div class="zp-item">
          <div class="zp-item-icon">🔵</div>
          <div class="zp-item-body">
            <div class="zp-item-title">HEX → 포인트 전환</div>
            <div class="zp-item-sub">${timeStr}</div>
            <div class="zp-item-sub">${r.hexAmount} HEX → 수수료 ${r.feeHex?.toFixed(4)||"?"} HEX</div>
            ${r.txHash ? `<div class="zp-item-sub" style="font-family:monospace;font-size:0.7rem;">${r.txHash.slice(0,20)}...</div>` : ""}
          </div>
          <div class="zp-item-right">
            <div class="zp-item-amount">+${Number(r.vndAmount).toLocaleString()}동</div>
          </div>
        </div>`;
    } else {
      const badgeCls = r.status === "settled" ? "badge-settled" : "badge-pending";
      const label    = r.status === "settled" ? "정산완료" : "정산대기";
      return `
        <div class="zp-item">
          <div class="zp-item-icon">💸</div>
          <div class="zp-item-body">
            <div class="zp-item-title">${escHtml(r.purpose || "포인트 사용")}</div>
            ${r.recipientInfo ? `<div class="zp-item-sub">${escHtml(r.recipientInfo)}</div>` : ""}
            <div class="zp-item-sub">${timeStr} · <span class="badge ${badgeCls}">${label}</span></div>
          </div>
          <div class="zp-item-right">
            <div class="zp-item-amount" style="color:var(--danger,#e53e3e);">-${Number(r.vndAmount).toLocaleString()}동</div>
          </div>
        </div>`;
    }
  }).join("");
}

// ── 토스트 알림 ───────────────────────────────────────
function toast(msg, duration = 5000) {
  document.getElementById("zpToast")?.remove();
  const el = document.createElement("div");
  el.id = "zpToast";
  el.style.cssText = [
    "position:fixed","top:76px","left:50%","transform:translateX(-50%)",
    "background:#111","color:#fff","border-radius:10px",
    "padding:12px 22px","z-index:9999","font-size:0.9rem",
    "box-shadow:0 4px 20px rgba(0,0,0,.3)","white-space:pre-line","text-align:center",
    "animation:fadeInDown .25s ease",
  ].join(";");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
