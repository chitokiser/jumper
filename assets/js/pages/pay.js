// /assets/js/pages/pay.js
// 가맹점 QR 결제 — 고객 결제 확인 페이지

import { onAuthReady } from "../auth.js";
import { login } from "../auth.js";
import { db, functions } from "/assets/js/firebase-init.js";
import { initSlot } from "/assets/js/jackpot-anim.js";
import {
  doc,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

// ── URL 파라미터 파싱 ─────────────────────────────────
const params      = new URLSearchParams(location.search);
const merchantId  = Number(params.get("merchant"));
const amount      = Number(params.get("amount"));
const currency    = (params.get("currency") || "VND").toUpperCase();

const isVnd = currency === "VND";

// 유효성 검증
const amountMin = isVnd ? 10000 : 1000;
if (!merchantId || !Number.isInteger(merchantId) || merchantId <= 0 ||
    !amount || !Number.isFinite(amount) || amount < amountMin) {
  show("invalidPanel", true);
  throw new Error("invalid pay params");
}

// 하위 호환: amountKrw 변수명 유지
const amountKrw = isVnd ? 0 : amount;
const amountVnd = isVnd ? amount : undefined;

// ── 환율 (표시 전용) ──────────────────────────────────
async function fetchRates() {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    const d = await r.json();
    if (d.result === "success" && d.rates?.KRW && d.rates?.VND)
      return { krwPerUsd: d.rates.KRW, vndPerUsd: d.rates.VND };
  } catch (_) {}
  return { krwPerUsd: 1350, vndPerUsd: 25400 };
}

// ── 가맹점 정보 로드 ──────────────────────────────────
let merchantName = "";

async function loadMerchant() {
  const mSnap = await getDoc(doc(db, "merchants", String(merchantId)));
  if (!mSnap.exists()) {
    show("invalidPanel", true);
    throw new Error("merchant not found");
  }
  const data = mSnap.data() || {};
  if (data.active === false) {
    show("invalidPanel", true);
    const el = $("invalidPanel")?.querySelector("p");
    if (el) el.textContent = "비활성 가맹점입니다.";
    throw new Error("merchant inactive");
  }
  merchantName = data.name || "가맹점";
  document.title = `${merchantName} 결제 확인 | Jump`;

  let amountStr = isVnd
    ? `${amount.toLocaleString()}동 (VND)`
    : `${amount.toLocaleString()}원 (KRW)`;
  ["payMerchantNameLogin", "payMerchantNameReg", "payMerchantName"].forEach((id) => setText(id, merchantName));
  ["payAmountLogin",       "payAmountReg",       "payAmountDisp"].forEach((id)   => setText(id, amountStr));
  setText("payHeroDesc", `${merchantName} — ${amountStr}`);

  // VND인 경우 KRW 환산 표시
  if (isVnd) {
    fetchRates().then((rates) => {
      const krw = Math.round((amount / rates.vndPerUsd) * rates.krwPerUsd).toLocaleString();
      const withKrw = `${amount.toLocaleString()}동 ≈ ${krw}원`;
      ["payAmountLogin", "payAmountReg", "payAmountDisp"].forEach((id) => setText(id, withKrw));
      setText("payHeroDesc", `${merchantName} — ${withKrw}`);
    });
  }
}

// ── 인증 처리 ─────────────────────────────────────────
let _authDone = false;

async function init() {
  try {
    await loadMerchant();
  } catch (_) {
    return; // 이미 invalidPanel 표시됨
  }

  onAuthReady(({ loggedIn, role }) => {
    if (_authDone) return;
    _authDone = true;

    if (!loggedIn) {
      show("needLoginPanel", true);
      const btn = $("btnLogin");
      if (btn) {
        btn.onclick = async () => {
          try { await login(); } catch (e) { console.warn(e); }
          // watchAuth → page reload 후 재진입
        };
      }
      return;
    }

    if (role === "user") {
      // 구글 로그인은 됐지만 회원가입(온체인) 미완
      show("needRegisterPanel", true);
      return;
    }

    // 정상 사용자 → 결제 패널 표시
    show("payPanel", true);
    bindPayButton();
  });

  // 4초 이내 로그인 없으면 로그인 안내
  setTimeout(() => {
    if (!_authDone) {
      _authDone = true;
      show("needLoginPanel", true);
      const btn = $("btnLogin");
      if (btn) {
        btn.onclick = async () => { try { await login(); } catch (e) { console.warn(e); } };
      }
    }
  }, 4000);
}

// ── 결제 버튼 바인딩 ──────────────────────────────────
function bindPayButton() {
  const btn = $("btnPay");
  if (!btn) return;

  const amountConfirmStr = isVnd
    ? `${amount.toLocaleString()}동 (VND)`
    : `${amount.toLocaleString()}원 (KRW)`;

  btn.onclick = async () => {
    if (!confirm(`${merchantName}에 ${amountConfirmStr}을 결제하시겠습니까?\n(수탁 지갑 HEX로 결제됩니다)`)) return;

    btn.disabled = true;
    btn.textContent = "결제 중...";
    const stateEl = $("payState");
    if (stateEl) { stateEl.textContent = "블록체인 처리 중입니다. 잠시 기다려 주세요..."; stateEl.style.display = ""; }

    try {
      const payFn  = httpsCallable(functions, "payMerchantHex");
      const payload = isVnd
        ? { merchantId: Number(merchantId), amountVnd: Number(amountVnd), currency: "VND" }
        : { merchantId: Number(merchantId), amountKrw: Number(amountKrw) };
      const res = await payFn(payload);
      const d   = res.data;

      // 완료 패널 표시
      show("payPanel", false);
      show("donePanel", true);
      watchJackpotResult(d.txHash);

      const paidAmountStr = isVnd
        ? `${amount.toLocaleString()}동 (${d.amountHex || "?"} HEX)`
        : `${amount.toLocaleString()}원 (${d.amountHex || "?"} HEX)`;

      const resultEl = $("payResult");
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="mp-kv"><span class="k">가맹점</span><span class="v">${d.merchantName || merchantName}</span></div>
          <div class="mp-kv"><span class="k">결제 금액</span><span class="v">${paidAmountStr}</span></div>
          <div class="mp-kv"><span class="k">TX</span><span class="v mono" style="font-size:0.78em;">${(d.txHash || "").slice(0, 22)}…</span></div>
          ${buildDropHtml(d)}
        `;
      }
    } catch (err) {
      if (stateEl) stateEl.style.display = "none";
      alert("결제 실패: " + (err?.message || "서버 오류가 발생했습니다."));
      btn.disabled = false;
      btn.textContent = "결제하기";
    }
  };
}

// ── 결제 아이템 드롭 표시 ──────────────────────────────
function buildDropHtml(d) {
  const items = [];
  if (d.potionsAdded   > 0) items.push(`<img src="/assets/images/item/hp.png"   style="width:28px;height:28px;vertical-align:middle;"> 빨간약 <b>+${d.potionsAdded}</b>`);
  if (d.mpPotionsAdded > 0) items.push(`<img src="/assets/images/item/mp.png"   style="width:28px;height:28px;vertical-align:middle;"> 마법약 <b>+${d.mpPotionsAdded}</b>`);
  if (d.reviveAdded    > 0) items.push(`<img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:28px;height:28px;vertical-align:middle;"> 부활권 <b>+${d.reviveAdded}</b>`);
  if (!items.length) return '';
  const jackpotBanner = d.isJackpot
    ? `<div style="text-align:center;font-size:1.2em;font-weight:800;color:#f59e0b;margin-bottom:6px;letter-spacing:2px;">🎰 JACKPOT!! 🎰</div>`
    : '';
  return `
    <div style="margin-top:10px;background:rgba(251,191,36,.12);border:1.5px solid #f59e0b;border-radius:10px;padding:10px 14px;">
      ${jackpotBanner}
      <div style="font-size:12px;color:#92400e;font-weight:700;margin-bottom:6px;">🎁 득템!</div>
      ${items.map(i=>`<div style="font-size:14px;margin:3px 0;">${i}</div>`).join('')}
    </div>`;
}

// ── 잭팟 결과 감시 ────────────────────────────────────
function weiToHex(weiStr, decimals = 18) {
  const wei = BigInt(weiStr || "0");
  const d = BigInt(decimals);
  const whole = wei / 10n ** d;
  const frac = (wei % 10n ** d).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function watchJackpotResult(txHash) {
  const box = $("jackpotResultBox");
  if (!box || !txHash) return;
  box.style.display = "";

  // 슬롯머신 시작
  const slot = initSlot($("jpWaiting"));

  let unsub = null;
  let retryTimer = null;
  let giveupTimer = null;
  let revealed = false;

  const cleanup = () => {
    if (unsub) { unsub(); unsub = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (giveupTimer) { clearTimeout(giveupTimer); giveupTimer = null; }
  };

  const reveal = (data) => {
    if (revealed) return;
    revealed = true;
    cleanup();
    const isWin = data.isWinner && BigInt(data.finalWinWei || "0") > 0n;
    slot.stop(data.randomValue ?? 0, isWin, () => {
      show("jpWaiting", false);
      if (isWin) {
        setText("jpWinAmount", `${weiToHex(data.finalWinWei)} HEX`);
        show("jpWin", true);
      } else {
        const el = $("jpNoWinRand");
        if (el) el.textContent = `랜덤 번호: ${data.randomValue ?? 0} / 9999`;
        show("jpNoWin", true);
      }
    });
  };

  // 30초 후: 수동 재확인 버튼
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    const snap = await getDoc(doc(db, "jackpot_rounds", txHash));
    if (snap.exists()) { reveal(snap.data()); return; }
    const waitEl = $("jpWaiting");
    if (waitEl) waitEl.insertAdjacentHTML("beforeend",
      `<br><button onclick="window.__jpRetry&&window.__jpRetry()" style="margin-top:8px;padding:5px 14px;border:1px solid #c4b5fd;border-radius:8px;background:#f5f3ff;color:#7c3aed;font-size:0.82rem;cursor:pointer;">결과 다시 확인</button>`
    );
    window.__jpRetry = async () => {
      const s = await getDoc(doc(db, "jackpot_rounds", txHash));
      if (s.exists()) reveal(s.data());
    };
  }, 30000);

  // 120초 후: 최종 안내
  giveupTimer = setTimeout(() => {
    if (revealed) return;
    cleanup();
    const waitEl = $("jpWaiting");
    if (waitEl) waitEl.innerHTML = `<div style="padding:12px;color:#94a3b8;font-size:0.82rem;">잭팟 결과는 마이페이지에서 확인하세요</div>`;
  }, 120000);

  unsub = onSnapshot(
    doc(db, "jackpot_rounds", txHash),
    (snap) => { if (snap.exists()) reveal(snap.data()); },
    (err) => {
      cleanup();
      console.warn("jackpot onSnapshot error:", err.code);
    }
  );
}

// ── 시작 ─────────────────────────────────────────────
init();
