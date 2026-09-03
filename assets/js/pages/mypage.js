// /assets/js/pages/mypage.js
// MyPage: profile / wallet / on-chain status / deposit & payment history

import { _t, initLang, renderLangSwitcher } from './mypage.i18n.js';
import { esc } from '/assets/js/esc.js';
import { onAuthReady } from "../auth.js";
import { db, functions, auth } from "/assets/js/firebase-init.js";
import { login } from "../auth.js";

import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

let _pointHexAmount = 0; // loadOnChainData에서 갱신, bindRedeemPoints에서 참조

function show(id, on) {
  const el = $(id);
  if (!el) return;
  el.style.display = on ? "" : "none";
  // 아코디언 섹션이 처음 표시될 때 자동 펼치기
  if (on && el.classList.contains('collapsible')) {
    el.classList.remove('is-collapsed');
  }
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

function renderProfile(userData, fireUser) {
  setText("infoName", userData?.name || "-");
  setText("infoEmail", fireUser?.email || userData?.email || "-");
  setText("infoPhone", userData?.phone || "-");
}

// ── 친구 초대 QR ──────────────────────────────────────────────────────────────
function renderReferralSection(uid) {
  const section = $('referralSection');
  if (!section || !uid) return;
  section.style.display = '';

  const inviteUrl = `${location.origin}/register.html?mentor=${encodeURIComponent(uid)}`;
  const linkEl = $('referralLink');
  const qrWrap = $('referralQrWrap');
  const copyBtn = $('btnCopyReferral');
  const copyMsg = $('referralCopyMsg');

  if (linkEl) linkEl.value = inviteUrl;

  // QR 코드 생성 (뷰포트 진입 시 lazy load)
  const observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    observer.disconnect();
    import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm').then(mod => {
      const canvas = document.createElement('canvas');
      mod.default.toCanvas(canvas, inviteUrl, { width: 200, margin: 1 }, () => {
        if (qrWrap) { qrWrap.innerHTML = ''; qrWrap.appendChild(canvas); }
      });
    }).catch(() => {
      if (qrWrap) qrWrap.innerHTML =
        `<a href="${inviteUrl}" style="font-size:0.75rem;word-break:break-all;">${inviteUrl}</a>`;
    });
  }, { threshold: 0.1 });
  if (qrWrap) observer.observe(qrWrap);

  // 복사 버튼
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {
      if (linkEl) { linkEl.select(); document.execCommand('copy'); }
    }).finally(() => {
      if (copyMsg) {
        copyMsg.textContent = '✅ 링크가 복사되었습니다!';
        setTimeout(() => { copyMsg.textContent = ''; }, 2000);
      }
    });
  }, { once: false });

  // 섹션 헤더 클릭 토글
  section.querySelector('.mp-section-head')?.addEventListener('click', () => {
    section.classList.toggle('is-collapsed');
  }, { once: true });
}

function renderWallet(userData) {
  // 포인트 계좌 기능 완전 제거
  show("walletInfo", false);
  show("btnCreateWallet", false);
  show("btnConnectMetaMask", false);
  show("noWallet", false);
}

async function loadOnChainData(uid) {
  // 서비스 연동 완전히 제거 - 순수 파이어베이스에서 필요한 정보만 로드
  show("walletHexRow", false);
  show("onChainRegBox", false);
  setText("onChainStatus", "활성화 됨 (Firebase)");
  $("onChainStatus").style.color = "var(--accent)";

  try {
    const bpSnap = await getDoc(doc(db, 'battle_players', uid));
    if (bpSnap.exists()) {
      const bp = bpSnap.data();
      const displayExp = typeof bp.gsExp === 'number' ? bp.gsExp : 0;
      const displayLevel = typeof bp.gsLevel === 'number' ? bp.gsLevel : 0;
      const displayRequired = Math.pow(Math.max(1, typeof bp.gsLevel === "number" ? bp.gsLevel : 1), 2) * 10000;

      show("levelRow", true);
      setText("levelDisplay", "Lv." + displayLevel);
      show("expRow", true);
      show("expBarRow", true);

      const expPct = displayRequired > 0
        ? Math.min(100, Math.round((displayExp / displayRequired) * 100))
        : 0;

      setText("expDisplay", `${displayExp.toLocaleString()} / ${displayRequired.toLocaleString()}`);

      const barFill = $("expBarFill");
      if (barFill) barFill.style.width = expPct + "%";

      const expReqEl = $("expRequired");
      if (expReqEl) {
        const remain = Math.max(0, displayRequired - displayExp);
        expReqEl.textContent = remain > 0
          ? _t('exp_remain', remain.toLocaleString())
          : _t('exp_can_levelup');
      }
      show("levelUpRow", false); // 렙업도 오프체인 전환 전까지 숨김
    }
  } catch (err) {
    console.error("Firebase status load failed", err);
  }
}

async function loadKCultureBalances(uid) {
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    show("paymentBalanceRow", true);
    show("pointRow", true);
    if (userSnap.exists()) {
      const d = userSnap.data();
      const pointBal = d.pointBalance || 0;
      const payBal = d.pointBalanceVnd || 0;

      const elPoint = $("pointDisplay");
      const elPay = $("paymentBalanceDisplay");

      // Set up realtime snapshot listener for automatic balance updates
      import("https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js").then((fStore) => {
        fStore.onSnapshot(fStore.doc(db, "users", uid), (snap) => {
          if (!snap.exists()) return;
          const updatedD = snap.data();
          const pBal = updatedD.pointBalance || 0;
          const kBal = updatedD.pointBalanceVnd || 0;
          if (elPoint) {
            const btnHtml = `<button id="btnExchangePoint" class="btn btn--sm" style="margin-top:4px; padding:6px 12px; font-size:0.8rem; font-weight:700; background:linear-gradient(135deg, #7c3aed, #4f46e5); color:#fff; border:none; border-radius:8px; box-shadow:0 4px 10px rgba(124,58,237,0.3); outline:none; cursor:pointer;">💸 포인트(Point)를 머니로 전환</button>`;
            if (!elPoint.innerHTML.includes("btnExchangePoint")) {
              elPoint.innerHTML = `<span id="ptSpan" style="font-size:1.6rem;">${pBal.toLocaleString("ko-KR")} P</span>` + btnHtml;
            } else {
              const ptSpan = elPoint.querySelector("span");
              if (ptSpan) ptSpan.textContent = pBal.toLocaleString("ko-KR") + " P";
            }
          }
          if (elPay) {
            elPay.innerHTML = `<span>${kBal.toLocaleString("ko-KR")} KM</span>` +
              `<div style="font-size:0.8rem; color:#15803d; opacity:0.8; margin-top:2px;">(K-MOA 가맹점 전용 머니)</div>`;
          }
        });
      }).catch(err => console.error(err));

      if (elPoint) {
        elPoint.innerHTML = `<span id="ptSpan" style="font-size:1.6rem;">${pointBal.toLocaleString("ko-KR")} P</span>` +
          `<button id="btnExchangePoint" class="btn btn--sm" style="margin-top:4px; padding:6px 12px; font-size:0.8rem; font-weight:700; background:linear-gradient(135deg, #7c3aed, #4f46e5); color:#fff; border:none; border-radius:8px; box-shadow:0 4px 10px rgba(124,58,237,0.3); outline:none; cursor:pointer;">💸 머니(Money)로 전환</button>`;
        setTimeout(() => {
          const btnExc = document.getElementById("btnExchangePoint");
          if (btnExc) {
            btnExc.addEventListener("click", async () => {
              try {
                const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js");
                const bpSnap = await getDoc(doc(db, "battle_players", uid));
                const lv = bpSnap.exists() ? Math.max(1, bpSnap.data().gsLevel || 1) : 1;
                const expectedVnd = Math.floor(pointBal * lv / 10);
                const ok = confirm(`현재 회원님의 레벨은 Lv.${lv} 입니다.\n보유하신 ${pointBal.toLocaleString()} 포인트를 전환하면\n${expectedVnd.toLocaleString()} KRW (결제 머니)로 전환됩니다.\n전환하시겠습니까?`);
                if (!ok) return;
                btnExc.disabled = true;
                btnExc.textContent = "처리 중...";
                const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.11.0/firebase-functions.js");
                const fn = httpsCallable(functions, "exchangePointsToFiat");
                const res = await fn({ amount: pointBal });
                alert(`성공적으로 전환되었습니다!\n잔고: ${res.data.convertedVnd.toLocaleString()} KRW 추가됨`);
                location.reload();
              } catch (err) {
                alert("전환 실패: " + err.message);
                btnExc.disabled = false;
                btnExc.textContent = "💸 포인트 전환";
              }
            });
          }
        }, 100);
      }
      // elPay Render
      if (elPay) {
        elPay.innerHTML = `<span id="paySpan">${payBal.toLocaleString("ko-KR")} KM</span>` +
          `<div style="font-size:0.8rem; color:#15803d; opacity:0.8; margin-top:2px;">(K-MOA 가맹점 전용 머니)</div>`;
      }
    } else {
      if ($("pointDisplay")) $("pointDisplay").textContent = "0 P";
      if ($("paymentBalanceDisplay")) $("paymentBalanceDisplay").textContent = "0 KM";
    }
  } catch (err) {
    console.error("Failed to load K-CULTURE balances:", err);
  }
}

async function loadDepositHistory(uid) {
  const wrap = $("depositHistory");
  if (!wrap) return;

  try {
    const q = query(
      collection(db, "deposits"),
      where("uid", "==", uid),
      orderBy("requestedAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      wrap.innerHTML = `<p class="hint">${_t('deposit_empty')}</p>`;
      return;
    }

    const statusLabel = {
      pending: { text: _t('status_pending'), color: "#f59e0b" },
      processing: { text: _t('status_processing'), color: "#3b82f6" },
      approved: { text: _t('status_approved'), color: "#10b981" },
      rejected: { text: _t('status_rejected'), color: "#ef4444" },
    };

    const rows = snap.docs.map((d) => {
      const data = d.data();
      const dateStr = data.requestedAt?.toDate
        ? data.requestedAt.toDate().toLocaleString("ko")
        : "-";

      const amountParts = [];
      if (data.amountKrw) amountParts.push((data.amountKrw || 0).toLocaleString() + _t('krw_unit'));
      if (data.vndAmount) amountParts.push(Number(data.vndAmount).toLocaleString() + " VND");
      if (!amountParts.length) amountParts.push("-");
      const amountStr = amountParts.join(" / ");

      const st = statusLabel[data.status] || { text: data.status, color: "#6b7280" };
      const depositorStr = data.depositorName ? ` · ${data.depositorName}` : "";

      return `
        <div class="mp-hist-row" style="border-left:3px solid ${st.color}; padding-left:10px; margin-bottom:10px;">
          <div class="mp-hist-main" style="display:flex; justify-content:space-between; align-items:center;">
            <span class="mp-hist-code" style="font-size:0.78em; color:var(--muted);">${data.refCode || "-"}${depositorStr}</span>
            <span style="font-weight:700; color:${st.color}; font-size:0.88em;">${st.text}</span>
          </div>
          <div class="mp-hist-detail" style="display:flex; justify-content:space-between; margin-top:4px;">
            <span style="font-weight:600; color:var(--accent);">${amountStr}</span>
            <span style="font-size:0.78em; color:var(--muted);">${dateStr}</span>
          </div>
          ${data.txHash ? `<div style="font-size:0.72em; color:var(--muted); margin-top:2px;" class="mono">TX: ${data.txHash.slice(0, 20)}...</div>` : ""}
          ${data.status === "rejected" && data.rejectReason ? `<div style="font-size:0.8em; color:#ef4444; margin-top:4px;">${_t('reject_reason')} ${data.rejectReason}</div>` : ""}
        </div>
      `;
    }).join("");

    wrap.innerHTML = rows;
  } catch (err) {
    wrap.innerHTML = `<p class="hint muted">${_t('deposit_hist_error')}</p>`;
    console.warn("depositHistory failed", err.message);
  }
}

async function loadMentees() {
  const section = $("menteeSection");
  const wrap = $("menteeList");
  if (!section || !wrap) return;

  try {
    const fn = httpsCallable(functions, "getMyMentees");
    const res = await fn();
    const { mentees } = res.data;

    show("menteeSection", true);

    if (!mentees || mentees.length === 0) {
      wrap.innerHTML = `<p class="hint">${_t('mentee_empty')}</p>`;
      return;
    }

    const rows = mentees.map((m) => {
      const addrShort = m.address ? m.address.slice(0, 6) + "..." + m.address.slice(-4) : "-";
      const dateStr = m.registeredAt ? new Date(m.registeredAt).toLocaleDateString("ko") : "-";
      return `
        <div class="mp-hist-row">
          <div class="mp-hist-main">
            <span style="font-weight:600;">${m.name}</span>
            <span class="mono muted" style="font-size:0.82em;">${addrShort}</span>
          </div>
          <div class="mp-hist-detail">
            <span class="muted" style="font-size:0.85em;">${_t('mentee_join_date')} ${dateStr}</span>
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `<p class="hint muted" style="margin-bottom:8px;">${_t('mentee_count', mentees.length)}</p>` + rows;
  } catch (err) {
    show("menteeSection", true);
    wrap.innerHTML = `<p class="hint muted">${_t('mentee_error')}</p>`;
    console.warn("getMyMentees failed", err.message);
  }
}

const TX_CONFIG = {
  buy: { labelKey: 'tx_buy', dir: "income", icon: "💰" },
  credit: { labelKey: 'tx_credit', dir: "income", icon: "⭐" },
  p2p: { labelKey: 'tx_p2p', dir: "income", icon: "📥" },
  p2p_merge: { labelKey: 'tx_p2p_merge', dir: "income", icon: "📥" },
  withdraw: { labelKey: 'tx_withdraw', dir: "expense", icon: "📤" },
  pay_merchant: { labelKey: 'tx_pay_merchant', dir: "expense", icon: "🛒" },
  merchant_income: { labelKey: 'tx_merchant_income', dir: "income", icon: "🏪" },
};

function txAmountHex(tx) {
  if (tx.amountHex) return Number(tx.amountHex);
  // merchant_income 은 순수익(netAmountWei) 우선 표시
  if (tx.netAmountWei) return Number(formatWei(tx.netAmountWei));
  if (tx.amountWei) return Number(formatWei(tx.amountWei));
  if (tx.priceWei) return Number(formatWei(tx.priceWei));
  return 0;
}

function renderTxItem({ label, icon, dir, amountHex, dateStr, txHash, statusBadge }) {
  const amtSign = dir === "income" ? "+" : dir === "expense" ? "−" : "";
  const amtClass = dir === "income" ? "income" : dir === "expense" ? "expense" : dir;
  const amtText = amountHex > 0
    ? `${amtSign}${amountHex.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} Point`
    : "-";
  const hashHtml = txHash
    ? `<div class="tx-hash">${txHash.slice(0, 10)}...${txHash.slice(-6)}</div>`
    : "";
  const badgeHtml = statusBadge
    ? `<span class="tx-status-badge ${statusBadge.cls}">${statusBadge.text}</span>`
    : "";
  return `
    <div class="tx-item">
      <div class="tx-icon ${amtClass}">${icon}</div>
      <div class="tx-body">
        <div class="tx-label">${label}</div>
        <div class="tx-date">${dateStr}</div>
        ${hashHtml}
      </div>
      <div class="tx-right">
        <div class="tx-amount ${amtClass}">${amtText}</div>
        ${badgeHtml}
      </div>
    </div>`;
}

// ── 멘티 수익 분석 ─────────────────────────────────────────────────────────
const JACKPOT_CONTRACT = "0x4d83A7764428fd1c116062aBb60c329E0E29f490";
const OPBNB_RPC = "https://opbnb-mainnet-rpc.bnbchain.org";

async function fetchMemberPoints(address) {
  try {
    // members(address) public mapping getter
    // selector = keccak256('members(address)')[0:4]
    // 미리 계산: 0x08ae4b0c
    const padded = "0x" + address.slice(2).toLowerCase().padStart(64, "0");
    const res = await fetch(OPBNB_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: JACKPOT_CONTRACT, data: "0x08ae4b0c" + padded.slice(2) }, "latest"],
      }),
    });
    const json = await res.json();
    if (!json.result || json.result === "0x") return 0n;
    // members struct: level(uint32) mentor(address) exp(uint256) points(uint256) blocked(bool)
    // ABI-encoded: [0]level 32B [1]mentor 32B [2]exp 32B [3]points 32B [4]blocked 32B
    const data = json.result.slice(2);
    const pointsHex = data.slice(3 * 64, 4 * 64);
    return BigInt("0x" + pointsHex);
  } catch { return 0n; }
}

async function loadMenteeIncome(_uid) {
  const section = $("menteeIncomeSection");
  const summaryEl = $("menteeIncomeSummary");
  const listEl = $("menteeIncomeList");
  if (!listEl) return;

  listEl.innerHTML = `<p class="hint">${_t('mi_loading')}</p>`;
  if (summaryEl) summaryEl.innerHTML = "";

  try {
    // Cloud Function으로 멘티 수익 집계 (Admin SDK → Firestore 권한 제한 없음)
    const fn = httpsCallable(functions, "getMenteeIncome");
    const res = await fn();
    const { mentees, myAddress } = res.data;

    if (!mentees || mentees.length === 0) {
      listEl.innerHTML = `<div class="mi-empty">${_t('mi_empty')}</div>`;
      if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      return;
    }

    // 내 서비스 포인트 잔액
    let myPointsWei = 0n;
    if (myAddress) myPointsWei = await fetchMemberPoints(myAddress);
    const myPointsHex = Number(myPointsWei) / 1e18;

    // menteeMap 형태로 변환 (렌더링용)
    const menteeMap = {};
    mentees.forEach((m) => { menteeMap[m.uid] = m; });

    // 5. 요약 카드
    const totalMentees = mentees.length;
    const totalEarning = Object.values(menteeMap).reduce((s, m) => s + m.myEstimatedEarningHex, 0);
    const totalTxCount = Object.values(menteeMap).reduce((s, m) => s + m.txCount, 0);

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="mi-summary-card">
          <div class="mi-summary-label">${_t('mi_mentee_count')}</div>
          <div class="mi-summary-val">${totalMentees}${_t('mi_mentees_label')}</div>
        </div>
        <div class="mi-summary-card">
          <div class="mi-summary-label">${_t('mi_tx_count')}</div>
          <div class="mi-summary-val">${totalTxCount}${_t('mi_payments_label')}</div>
        </div>
        <div class="mi-summary-card" style="background:linear-gradient(135deg,#faf5ff,#f3e8ff);border-color:#d8b4fe;">
          <div class="mi-summary-label">${_t('mi_total_earning')}</div>
          <div class="mi-summary-val" style="color:#7c3aed;">${totalEarning.toFixed(4)} Point</div>
          <div class="mi-summary-sub">${_t('mi_fee_note')}</div>
        </div>
        <div class="mi-summary-card" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-color:#93c5fd;">
          <div class="mi-summary-label">${_t('mi_points_balance')}</div>
          <div class="mi-summary-val" style="color:#1d4ed8;">${myPointsHex.toFixed(6)} Point</div>
          <div class="mi-summary-sub">${_t('mi_onchain_realtime')}</div>
        </div>
      `;
    }

    // 6. 멘티별 카드 렌더링 (수익 높은 순 정렬)
    const sortedMentees = Object.values(menteeMap).sort(
      (a, b) => b.myEstimatedEarningHex - a.myEstimatedEarningHex
    );

    const frag = document.createDocumentFragment();
    sortedMentees.forEach((m) => {
      const addrShort = m.address
        ? m.address.slice(0, 6) + "..." + m.address.slice(-4)
        : "-";
      const regDate = m.registeredAt
        ? new Date(m.registeredAt).toLocaleDateString("ko-KR")
        : "-";

      const recentRows = (m.recentTxs || []).map((t) => {
        const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString("ko-KR") : "-";
        const earning = t.myEst ?? t.myEarning ?? 0;
        return `
          <div class="mi-tx-row">
            <span>${dateStr}</span>
            <span class="mi-tx-amt">${_t('mi_tx_row', (t.amountHex || 0).toFixed(4), earning > 0 ? earning.toFixed(6) : "?")}</span>
          </div>`;
      }).join("") || `<div class="mi-tx-row"><span>${_t('mi_tx_no_data')}</span></div>`;

      const card = document.createElement("div");
      card.className = "mi-mentee-card";
      card.innerHTML = `
        <div class="mi-mentee-head">
          <div>
            <div class="mi-mentee-name">${m.name}</div>
            <div class="mi-mentee-addr">${addrShort} · ${_t('mi_join_short', regDate)}</div>
          </div>
          <div class="mi-mentee-total">
            <div class="mi-mentee-total-val">${m.myEstimatedEarningHex > 0 ? m.myEstimatedEarningHex.toFixed(6) + " Point" : "-"}</div>
            <div class="mi-mentee-total-label">${_t('mi_cumulative_earn')}</div>
          </div>
        </div>
        <div class="mi-stat-row">
          <div class="mi-stat">
            <div class="mi-stat-val">${m.txCount}${_t('mi_payments_label')}</div>
            <div class="mi-stat-label">${_t('mi_stat_tx_count')}</div>
          </div>
          <div class="mi-stat">
            <div class="mi-stat-val">${(m.totalAmountHex || 0).toFixed(4)}</div>
            <div class="mi-stat-label">${_t('mi_stat_total_hex')}</div>
          </div>
          <div class="mi-stat">
            <div class="mi-stat-val">${m.myEstimatedEarningHex > 0 ? m.myEstimatedEarningHex.toFixed(6) : "-"}</div>
            <div class="mi-stat-label">${_t('mi_stat_mentor_earn')}</div>
          </div>
        </div>
        ${m.recentTxs.length > 0 ? `
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;">
            <div style="font-size:0.72rem;color:#94a3b8;font-weight:700;margin-bottom:4px;">${_t('mi_recent_tx')}</div>
            ${recentRows}
          </div>
        ` : ""}
      `;
      frag.appendChild(card);
    });

    listEl.innerHTML = "";
    listEl.appendChild(frag);
    if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }

  } catch (err) {
    listEl.innerHTML = `<div class="mi-empty">${_t('mi_error', esc(err.message))}</div>`;
    if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
    console.warn("loadMenteeIncome failed:", err);
  }
}

async function loadCoopOrders(uid) {
  const section = $('coopOrderSection');
  const listEl = $('coopOrderList');
  if (!listEl) return;

  try {
    const q = query(
      collection(db, 'coopOrders'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    show('coopOrderSection', true);

    const TYPE_LABEL = { membership: '정회원', voucher: '바우처', general: '일반' };
    const rows = snap.docs.map((d) => {
      const o = d.data();
      const hexAmt = (Number(BigInt(o.hexWei || '0')) / 1e18).toFixed(4);
      const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('ko-KR') : '-';
      const typeLbl = TYPE_LABEL[o.type] || o.type || '일반';
      const txLink = o.txHash
        ? `<a href="https://opbnb.bscscan.com/tx/${o.txHash}" target="_blank" rel="noopener" style="font-size:0.72em;color:var(--accent);">TX ↗</a>`
        : '';
      return `<tr>
        <td style="font-size:0.82em;">${date}</td>
        <td>${o.productName || '-'} <span style="font-size:0.7em;background:#f3e8ff;color:#7c3aed;padding:1px 5px;border-radius:8px;font-weight:600;">${typeLbl}</span></td>
        <td style="text-align:right;font-weight:600;color:#dc2626;">${hexAmt} Point</td>
        <td style="text-align:center;">${txLink}</td>
      </tr>`;
    }).join('');

    listEl.innerHTML = `<table class="mp-table" style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-size:0.78em;color:#94a3b8;">
        <th style="text-align:left;padding:4px 6px;">날짜</th>
        <th style="text-align:left;padding:4px 6px;">상품</th>
        <th style="text-align:right;padding:4px 6px;">금액</th>
        <th style="text-align:center;padding:4px 6px;">TX</th>
      </tr></thead>
      <tbody style="font-size:0.88em;">${rows}</tbody>
    </table>`;
  } catch (_) {
    if (listEl) listEl.innerHTML = '<p class="hint muted">구매 내역을 불러올 수 없습니다.</p>';
  }
}

async function loadJackpotHistory(uid) {
  const wrap = $("jackpotHistList");
  const section = $("jackpotHistSection");
  if (!wrap) return;

  wrap.innerHTML = `<p class="hint">${_t('jackpot_loading')}</p>`;

  try {
    const q = query(
      collection(db, "jackpot_wins"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(30)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      wrap.innerHTML = `<div class="jp-hist-empty">${_t('jackpot_empty')}</div>`;
      if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      const statRow = $("jackpotStatRow");
      if (statRow) statRow.style.display = "none";
      return;
    }

    // 통계 계산
    let totalWei = 0n;
    snap.docs.forEach((d) => {
      totalWei += BigInt(d.data().onchainJackpotPointsWei || '0');
    });
    const totalHex = (Number(totalWei) / 1e18).toFixed(4);
    const totalCount = snap.docs.length;

    const statRow = $("jackpotStatRow");
    const totalHexEl = $("jackpotTotalHex");
    const totalCountEl = $("jackpotTotalCount");
    const redeemableEl = $("jackpotRedeemable");

    if (statRow) statRow.style.display = "";
    if (totalHexEl) totalHexEl.textContent = totalHex + " Point";
    if (totalCountEl) totalCountEl.textContent = _t('jackpot_total_count', totalCount);
    if (redeemableEl) {
      redeemableEl.textContent = _pointHexAmount.toFixed(4) + " Point";
      redeemableEl.style.color = _pointHexAmount >= 10 ? "#a78bfa" : "var(--muted)";
    }

    const frag = document.createDocumentFragment();
    snap.docs.forEach((d) => {
      const v = d.data();
      const ts = v.createdAt?.toDate ? v.createdAt.toDate() : (v.createdAt ? new Date(v.createdAt) : null);
      const dateStr = ts ? ts.toLocaleString("ko-KR") : "-";

      const items = [];
      if ((v.potionCount || 0) > 0) items.push(`${_t('item_potion')} +${v.potionCount}`);
      if ((v.mpPotionCount || 0) > 0) items.push(`${_t('item_mp_potion')} +${v.mpPotionCount}`);
      if ((v.reviveAdded || 0) > 0) items.push(`${_t('item_revive')} +${v.reviveAdded}`);

      const onchainPtsWei = BigInt(v.onchainJackpotPointsWei || '0');
      let ptsLine = '';
      if (onchainPtsWei > 0n) {
        const ptsHex = (Number(onchainPtsWei) / 1e18).toFixed(6);
        ptsLine = `<span class="jp-onchain-badge">${_t('jp_onchain_badge')}</span> ${ptsHex} Point ${_t('jp_pts_label')}`;
      }

      const subText = [ptsLine, ...items].filter(Boolean).join(' · ') || _t('jackpot_item_reward');

      const el = document.createElement('div');
      el.className = 'jp-hist-item';
      el.innerHTML = `
        <div class="jp-hist-icon">🎰</div>
        <div class="jp-hist-body">
          <div class="jp-hist-title">${_t('jackpot_hist_title', v.merchantName || _t('jackpot_merchant_default'))}</div>
          <div class="jp-hist-sub">${subText}</div>
          <div class="jp-hist-date">${dateStr}</div>
        </div>
      `;
      frag.appendChild(el);
    });
    wrap.innerHTML = '';
    wrap.appendChild(frag);
    if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
  } catch (err) {
    // 인덱스 빌드 중인 경우 fallback: uid 필터만 사용하고 클라이언트 정렬
    if (err.message && err.message.includes('index') && err.message.includes('building')) {
      try {
        const q2 = query(
          collection(db, "jackpot_wins"),
          where("uid", "==", uid),
          limit(30)
        );
        const snap2 = await getDocs(q2);
        if (snap2.empty) {
          wrap.innerHTML = `<div class="jp-hist-empty">${_t('jackpot_empty')}<br><small style="color:#c4b5fd;">${_t('jackpot_building')}</small></div>`;
        } else {
          const docs = snap2.docs.slice().sort((a, b) => {
            const ta = a.data().createdAt?.seconds || 0;
            const tb = b.data().createdAt?.seconds || 0;
            return tb - ta;
          });
          const fakeSnap = { docs, empty: false };
          // re-render
          const frag2 = document.createDocumentFragment();
          fakeSnap.docs.forEach((d) => {
            const v = d.data();
            const ts = v.createdAt?.toDate ? v.createdAt.toDate() : null;
            const dateStr = ts ? ts.toLocaleString("ko-KR") : "-";
            const items = [];
            if ((v.potionCount || 0) > 0) items.push(`${_t('item_potion')} +${v.potionCount}`);
            if ((v.mpPotionCount || 0) > 0) items.push(`${_t('item_mp_potion')} +${v.mpPotionCount}`);
            if ((v.reviveAdded || 0) > 0) items.push(`${_t('item_revive')} +${v.reviveAdded}`);
            const onchainPtsWei = BigInt(v.onchainJackpotPointsWei || '0');
            let ptsLine = '';
            if (onchainPtsWei > 0n) {
              const ptsHex = (Number(onchainPtsWei) / 1e18).toFixed(6);
              ptsLine = `<span class="jp-onchain-badge">${_t('jp_onchain_badge')}</span> ${ptsHex} Point ${_t('jp_pts_label')}`;
            }
            const subText = [ptsLine, ...items].filter(Boolean).join(' · ') || _t('jackpot_item_reward');
            const el = document.createElement('div');
            el.className = 'jp-hist-item';
            el.innerHTML = `
              <div class="jp-hist-icon">🎰</div>
              <div class="jp-hist-body">
                <div class="jp-hist-title">${_t('jackpot_hist_title', v.merchantName || _t('jackpot_merchant_default'))}</div>
                <div class="jp-hist-sub">${subText}</div>
                <div class="jp-hist-date">${dateStr}</div>
              </div>
            `;
            frag2.appendChild(el);
          });
          wrap.innerHTML = '';
          wrap.appendChild(frag2);

          // 통계 계산 (fallback)
          let totalWei2 = 0n;
          docs.forEach((d) => { totalWei2 += BigInt(d.data().onchainJackpotPointsWei || '0'); });
          const statRow2 = $("jackpotStatRow");
          const totalHexEl2 = $("jackpotTotalHex");
          const totalCountEl2 = $("jackpotTotalCount");
          const redeemableEl2 = $("jackpotRedeemable");
          if (statRow2) statRow2.style.display = "";
          if (totalHexEl2) totalHexEl2.textContent = (Number(totalWei2) / 1e18).toFixed(4) + " Point";
          if (totalCountEl2) totalCountEl2.textContent = _t('jackpot_total_count', docs.length);
          if (redeemableEl2) {
            redeemableEl2.textContent = _pointHexAmount.toFixed(4) + " Point";
            redeemableEl2.style.color = _pointHexAmount >= 10 ? "#a78bfa" : "var(--muted)";
          }
        }
        if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      } catch (e2) {
        wrap.innerHTML = `<div class="jp-hist-empty">${_t('jackpot_retry_msg')}</div>`;
        if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      }
    } else {
      wrap.innerHTML = `<div class="jp-hist-empty">${_t('jackpot_err', esc(err.message))}</div>`;
      if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
    }
  }
}

async function loadTxHistory(uid, _walletAddress) {
  const wrap = $("txHistory");
  const section = $("txSection");
  if (!wrap) return;

  const unified = [];

  // ── Firestore 거래 내역 ──
  try {
    const q = query(
      collection(db, "transactions"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    import("https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js").then((fStore) => {
      fStore.onSnapshot(q, (snap) => {
        const unified = [];
        snap.forEach((d) => {
          const tx = d.data();
          const cfg = TX_CONFIG[tx.type] || { labelKey: null, label: tx.type, dir: "expense", icon: "📋" };

          let label = cfg.labelKey ? _t(cfg.labelKey) : cfg.label;
          if (tx.type === "merchant_income" && tx.merchantName) {
            const feePct = tx.feeBps != null ? ` (${_t('fee_pct', (tx.feeBps / 100).toFixed(0))})` : "";
            label = `🏪 ${tx.merchantName}${feePct}`;
          }
          if (tx.type === "pay_merchant" && tx.merchantName) {
            label = `🛒 ${tx.merchantName}`;
          }

          unified.push({
            sortTs: tx.createdAt?.toDate ? tx.createdAt.toDate().getTime() : 0,
            label,
            icon: cfg.icon,
            dir: cfg.dir,
            amountHex: txAmountHex(tx),
            dateStr: tx.createdAt?.toDate ? tx.createdAt.toDate().toLocaleString("ko-KR") : "-",
            txHash: tx.txHash || null,
            statusBadge: null,
          });
        });

        if (unified.length === 0) {
          if (section) section.style.display = "none";
          return;
        }

        unified.sort((a, b) => b.sortTs - a.sortTs);
        show("txSection", true);

        let totalIncome = 0, totalExpense = 0, incomeCount = 0, expenseCount = 0;
        unified.forEach((t) => {
          if (t.dir === "income") { totalIncome += t.amountHex; incomeCount++; }
          else if (t.dir === "expense") { totalExpense += t.amountHex; expenseCount++; }
        });

        const fmtSum = (v) => v.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) + " Point";

        const summary = $("txSummary");
        if (summary) {
          summary.style.display = "";
          const el = (id) => document.getElementById(id);
          if (el("txTotalIncome")) el("txTotalIncome").textContent = "+" + fmtSum(totalIncome);
          if (el("txTotalExpense")) el("txTotalExpense").textContent = "−" + fmtSum(totalExpense);
          if (el("txTotalIncomeCount")) el("txTotalIncomeCount").textContent = incomeCount + _t('mi_payments_label');
          if (el("txTotalExpenseCount")) el("txTotalExpenseCount").textContent = expenseCount + _t('mi_payments_label');
        }

        wrap.innerHTML = unified.map(renderTxItem).join("");
      }, (err) => {
        console.warn("loadTxHistory onSnapshot error:", err.message);
        wrap.innerHTML = `<p class="hint muted">${_t('status_loading')} failed.</p>`;
      });
    });
  } catch (err) {
    console.warn("loadTxHistory try block:", err.message);
  }
}



function formatWei(weiStr) {
  try {
    const n = parseFloat(BigInt(weiStr).toString()) / 1e18;
    return n.toFixed(4);
  } catch {
    return weiStr;
  }
}

function bindCreateWallet() { }
function bindConnectMetaMask(uid) { }
function bindLevelUp(uid) { }
function bindRedeemPoints(uid) { }
function bindOnChainRegister(uid) { }

function bindDepositForm() {
  const form = $("depositForm");
  if (!form) return;

  // 통화 선택 라디오 버튼 이벤트
  const radios = document.getElementsByName("depositCurrencyRadio");
  const currencyHidden = $("depositCurrency");
  const accKRW = $("depositAccountKRW");
  const accVND = $("depositAccountVND");
  const amountInput = $("depositAmount");
  const labelAmount = $("labelDepositAmount");

  if (radios.length > 0) {
    radios.forEach(r => {
      r.addEventListener("change", (e) => {
        if (!e.target.checked) return;
        const cur = e.target.value;
        if (currencyHidden) currencyHidden.value = cur;

        if (cur === "VND") {
          if (accKRW) accKRW.style.display = "none";
          if (accVND) accVND.style.display = "block";
          if (labelAmount) labelAmount.textContent = "충전 금액 (동)";
          if (amountInput) {
            amountInput.min = "200000";
            amountInput.step = "10000";
            amountInput.placeholder = "최소 200,000 VND";
            amountInput.value = "";
          }
        } else {
          if (accKRW) accKRW.style.display = "block";
          if (accVND) accVND.style.display = "none";
          if (labelAmount) labelAmount.textContent = "충전 금액 (원)";
          if (amountInput) {
            amountInput.min = "10000";
            amountInput.step = "1000";
            amountInput.placeholder = "최소 10,000원";
            amountInput.value = "";
          }
        }
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amountVal = Number(amountInput?.value);
    const currency = currencyHidden?.value || "KRW";
    const depositorName = String($("depositorName")?.value || "").trim();
    const btn = $("btnDeposit");

    if (currency === "VND") {
      if (!amountVal || amountVal < 200000) { alert("최소 충전 금액은 200,000 VND 입니다."); return; }
    } else {
      if (!amountVal || amountVal < 10000) { alert(_t('deposit_min_error') || "최소 충전 금액은 10,000원 입니다."); return; }
    }

    if (!depositorName) {
      alert(_t('deposit_name_error') || "입금자명을 입력해주세요.");
      return;
    }

    btn.disabled = true;
    btn.textContent = _t('deposit_loading') || "진행중...";

    try {
      const payload = currency === "VND"
        ? { amountVnd: amountVal, currency: "VND", depositorName }
        : { amountKrw: amountVal, currency: "KRW", depositorName };

      const requestDeposit = httpsCallable(functions, "requestDeposit");
      const res = await requestDeposit(payload);
      const d = res.data;

      show("depositResult", true);
      setText("drRefCode", d.refCode);

      if (currency === "VND") {
        setText("drBankVnd", d.bankInfoVnd?.bank || "-");
        setText("drAccountVnd", d.bankInfoVnd?.account || "-");
        setText("drHolderVnd", d.bankInfoVnd?.holder || "-");
        setText("drAmount", (d.amountVnd || 0).toLocaleString() + " VND");
      } else {
        setText("drBank", d.bankInfo?.bank || "-");
        setText("drAccount", d.bankInfo?.account || "-");
        setText("drHolder", d.bankInfo?.holder || "-");
        setText("drAmount", (d.amountKrw || 0).toLocaleString() + " 원");
      }

      const drParts = [];
      if (d.amountKrw) drParts.push((d.amountKrw || 0).toLocaleString() + "원");
      if (d.amountVnd) drParts.push((d.amountVnd || 0).toLocaleString() + " VND");
      if (d.estimatedUsd != null) drParts.push("$" + Number(d.estimatedUsd).toFixed(2));
      setText("drHex", drParts.join(" / "));

      form.reset();

      // 충전 내역 자동 새로고침 + 스크롤
      const currentUid = auth.currentUser?.uid;
      if (currentUid) await loadDepositHistory(currentUid);
      const histEl = $("depositHistory");
      if (histEl) histEl.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      alert((_t('deposit_error_alert') || "Error: ") + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = _t('deposit_btn_after') || "충전 요청";
    }
  });
}

function bindMentorRequest(uid) {
  const btn = $("btnMentorRequest");
  if (!btn || btn._bound) return;
  btn._bound = true;

  btn.onclick = async () => {
    const email = String($("mentorReqEmail")?.value || "").trim().toLowerCase();
    if (!email) {
      alert(_t('mentor_email_error'));
      return;
    }

    btn.disabled = true;
    btn.textContent = _t('alert_requesting');
    try {
      await setDoc(doc(db, "mentorRequests", uid), {
        uid,
        mentorEmail: email,
        requestedAt: serverTimestamp(),
        status: "pending",
      });
      show("mentorReqDone", true);
      show("btnMentorRequest", false);
      const emailEl = $("mentorReqEmail");
      if (emailEl) emailEl.disabled = true;
    } catch (err) {
      alert(_t('mentor_req_error', err.message));
      btn.disabled = false;
      btn.textContent = _t('mentor_req_btn_label');
    }
  };
}

async function loadMerchantsForSelect() {
  const sel = $("merchantPaySelect");
  if (!sel) return;

  try {
    const snap = await getDocs(collection(db, "merchants"));
    const list = [];

    snap.forEach((d) => {
      const m = d.data() || {};
      if (m.active !== false) {
        list.push({ id: d.id, name: m.name || d.id });
      }
    });

    if (!list.length) {
      sel.innerHTML = `<option value="">${_t('merchant_empty_list')}</option>`;
      return;
    }

    sel.innerHTML =
      `<option value="">${_t('merchant_select_placeholder')}</option>` +
      list.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  } catch (err) {
    sel.innerHTML = `<option value="">${_t('merchant_load_error')}</option>`;
    console.warn("loadMerchantsForSelect:", err.message);
  }
}

function buildMypageDropHtml(d) {
  const items = [];
  if (d.potionsAdded > 0) items.push(`<img src="/assets/images/item/hp.png" style="width:24px;height:24px;vertical-align:middle;"> ${_t('item_potion')} <b>+${d.potionsAdded}</b>`);
  if (d.mpPotionsAdded > 0) items.push(`<img src="/assets/images/item/mp.png" style="width:24px;height:24px;vertical-align:middle;"> ${_t('item_mp_potion')} <b>+${d.mpPotionsAdded}</b>`);
  if (d.reviveAdded > 0) items.push(`<img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:24px;height:24px;vertical-align:middle;"> ${_t('item_revive')} <b>+${d.reviveAdded}</b>`);
  if (!items.length) return '';
  return `
    <div class="drop-box">
      <div class="drop-box-title">${_t('item_drop_title')}</div>
      ${items.map(i => `<div class="drop-item">${i}</div>`).join('')}
    </div>`;
}

function showJackpotResult(d) {
  const modal = $("jackpotModal");
  if (!modal) return;

  const hasItems = (d.potionsAdded > 0) || (d.mpPotionsAdded > 0) || (d.reviveAdded > 0);
  const jackpotPtsWei = BigInt(d.onchainJackpotPointsWei || '0');
  const hasOnchainJackpot = jackpotPtsWei > 0n;
  if (!d.isJackpot && !hasItems && !hasOnchainJackpot) return;

  const emojiEl = $("jmEmoji");
  const titleEl = $("jmTitle");
  const descEl = $("jmDesc");
  const itemsEl = $("jmItems");
  const closeBtn = $("jmCloseBtn");

  if (d.isJackpot) {
    if (emojiEl) emojiEl.textContent = "🎉";
    if (titleEl) titleEl.textContent = "JACKPOT!! 🎰";
    if (descEl) descEl.textContent = _t('jm_jackpot_desc');
  } else if (hasOnchainJackpot) {
    if (emojiEl) emojiEl.textContent = "🪙";
    if (titleEl) { titleEl.textContent = _t('jm_onchain_title'); titleEl.style.color = "#fde68a"; }
    const ptsHex = (Number(jackpotPtsWei) / 1e18).toFixed(6);
    if (descEl) descEl.textContent = _t('jm_onchain_desc', ptsHex);
  } else {
    if (emojiEl) emojiEl.textContent = "🎁";
    if (titleEl) { titleEl.textContent = _t('jm_item_title'); titleEl.style.color = "#fef08a"; }
    if (descEl) descEl.textContent = _t('jm_item_desc');
  }

  if (itemsEl) {
    const lines = [];
    if (hasOnchainJackpot) {
      const ptsHex = (Number(jackpotPtsWei) / 1e18).toFixed(6);
      lines.push(`<div class="jm-item">🪙 ${_t('jm_jackpot_pts')} <b>+${ptsHex} Point</b></div>`);
    }
    if (d.potionsAdded > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/hp.png" style="width:22px;height:22px;"> ${_t('item_potion')} <b>+${d.potionsAdded}</b></div>`);
    if (d.mpPotionsAdded > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/mp.png" style="width:22px;height:22px;"> ${_t('item_mp_potion')} <b>+${d.mpPotionsAdded}</b></div>`);
    if (d.reviveAdded > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:22px;height:22px;"> ${_t('item_revive')} <b>+${d.reviveAdded}</b></div>`);
    itemsEl.innerHTML = lines.join('');
    itemsEl.style.display = lines.length ? '' : 'none';
  }

  modal.classList.add("active");

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.remove("active");
  }
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("active"); };
}

function bindMerchantPay(uid, _walletAddress) {
  const form = $("merchantPayForm");
  if (!form || form._bound) return;
  form._bound = true;

  // 통화 변경 시 레이블/min/placeholder 업데이트
  form.querySelectorAll("input[name='merchantPayCurrencyRadio']").forEach((r) => {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      const isVnd = r.value === "VND";
      const labelEl = $("merchantPayAmountLabel");
      const inputEl = $("merchantPayAmount");
      const hidden = $("merchantPayCurrency");
      if (labelEl) labelEl.textContent = isVnd ? _t('label_pay_amount_vnd') : _t('label_pay_amount_krw');
      if (inputEl) {
        inputEl.min = isVnd ? "10000" : "1000";
        inputEl.step = isVnd ? "1000" : "100";
        inputEl.placeholder = isVnd ? _t('placeholder_vnd_amount') : _t('placeholder_krw_amount');
        inputEl.value = "";
      }
      if (hidden) hidden.value = r.value;
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const merchantId = $("merchantPaySelect")?.value;
    const amount = Number($("merchantPayAmount")?.value);
    const currency = $("merchantPayCurrency")?.value || "VND";
    const isVnd = currency === "VND";
    const btn = $("btnMerchantPay");
    const resultBox = $("merchantPayResult");

    if (!merchantId) {
      alert(_t('merchant_select_error'));
      return;
    }

    if (isVnd) {
      if (!amount || amount < 10000) { alert(_t('pay_vnd_min_error')); return; }
    } else {
      if (!amount || amount < 1000) { alert(_t('pay_krw_min_error')); return; }
    }

    const confirmMsg = isVnd
      ? _t('pay_confirm_vnd', amount.toLocaleString())
      : _t('pay_confirm_krw', amount.toLocaleString());
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;
    btn.textContent = _t('pay_loading');
    if (resultBox) resultBox.style.display = "none";

    const payload = isVnd
      ? { merchantId: Number(merchantId), amountVnd: amount, currency: "VND" }
      : { merchantId: Number(merchantId), amountKrw: amount, currency: "KRW" };

    try {
      const payFn = httpsCallable(functions, "payMerchantFirebase");
      const res = await payFn(payload);
      const d = res.data;

      const krwStr = `${(d.amountKrw || 0).toLocaleString()}${_t('krw_unit')}`;
      const vndStr = d.amountVnd ? `${Math.round(d.amountVnd).toLocaleString()}${_t('vnd_unit')}` : '';
      const amountDisp = [krwStr, vndStr].filter(Boolean).join(' / ');

      if (resultBox) {
        resultBox.style.display = "";
        resultBox.innerHTML = `
          <div class="mp-kv"><span class="k">${_t('pay_result_merchant')}</span><span class="v">${d.merchantName || ""}</span></div>
          <div class="mp-kv"><span class="k">${_t('pay_result_amount')}</span><span class="v accent">${amountDisp}</span></div>
          <p class="hint" style="color:var(--accent); margin-top:6px;">${_t('pay_done')}</p>
          ${buildMypageDropHtml(d)}
        `;
      }

      form.reset();
      showJackpotResult(d);
      loadTxHistory(uid);
      loadJackpotHistory(uid);
      loadOnChainData(uid);
    } catch (err) {
      alert(_t('pay_error', err.message));
    } finally {
      btn.disabled = false;
      btn.textContent = _t('pay_btn_label');
    }
  });
}


let __qrStream = null;
let __qrRaf = 0;

function stopQrScan() {
  if (__qrRaf) cancelAnimationFrame(__qrRaf);
  __qrRaf = 0;
  if (__qrStream) {
    __qrStream.getTracks().forEach((t) => t.stop());
    __qrStream = null;
  }
  const overlay = $("qrScanOverlay");
  if (overlay) overlay.classList.remove("active");
}

function parseQrPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  try {
    const j = JSON.parse(text);
    return {
      merchantId: String(j.merchantId || j.merchant_id || j.id || "").trim(),
      merchantName: String(j.name || j.merchantName || j.merchant_name || "").trim(),
      amount: Number(j.amount || j.krw || j.vnd || 0) || null,
      currency: String(j.currency || "").toUpperCase() || null,
    };
  } catch { }

  try {
    const u = new URL(text);
    return {
      merchantId: String(u.searchParams.get("merchant") || u.searchParams.get("merchantId") || u.searchParams.get("id") || "").trim(),
      merchantName: String(u.searchParams.get("name") || "").trim(),
      amount: Number(u.searchParams.get("amount") || 0) || null,
      currency: String(u.searchParams.get("currency") || "").toUpperCase() || null,
    };
  } catch { }

  const mId =
    /merchantId\s*[:=]\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1] ||
    /id\s*[:=]\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1] ||
    "";
  const amount = Number(/amount\s*[:=]\s*([0-9.]+)/i.exec(text)?.[1] || 0) || null;
  const currency = (/(currency|cur)\s*[:=]\s*([A-Za-z]{3})/i.exec(text)?.[2] || "").toUpperCase() || null;
  if (!mId && !amount && !currency) return null;
  return { merchantId: mId, merchantName: "", amount, currency };
}

function showQrResult(msg, isError) {
  const box = $("qrResultState");
  if (!box) return;
  box.textContent = msg;
  box.style.cssText = `display:block!important;margin:8px 0;padding:10px 14px;border-radius:8px;border:1px solid;font-size:0.88rem;${isError ? "background:#fef2f2;border-color:#fca5a5;color:#991b1b;" : "background:#f0fdf4;border-color:#86efac;color:#166534;"}`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function applyQrResult(payload) {
  if (!payload) return false;
  const sel = $("merchantPaySelect");
  const amountInput = $("merchantPayAmount");
  const currencyHidden = $("merchantPayCurrency");
  const radioVnd = $("merchantPayCurrencyVND");
  const radioKrw = $("merchantPayCurrencyKRW");

  // 스캔 시 무조건 결제 섹션 펼치기
  const merchantPaySection = $("merchantPaySection");
  if (merchantPaySection) {
    merchantPaySection.classList.remove("is-collapsed");
  }

  // ── 금액 즉시 반영 ──
  if (payload.amount && amountInput) {
    amountInput.value = String(Math.round(payload.amount));
  }

  // ── 통화 즉시 반영 ──
  if (payload.currency) {
    const cur = payload.currency === "KRW" ? "KRW" : "VND";
    if (currencyHidden) currencyHidden.value = cur;
    if (cur === "KRW" && radioKrw) radioKrw.checked = true;
    if (cur === "VND" && radioVnd) radioVnd.checked = true;
    const labelEl = $("merchantPayAmountLabel");
    const inputEl = amountInput;
    const isVnd = cur === "VND";
    if (labelEl) labelEl.textContent = isVnd ? _t('label_pay_amount_vnd') : _t('label_pay_amount_krw');
    if (inputEl) {
      inputEl.min = isVnd ? "10000" : "1000";
      inputEl.step = isVnd ? "1000" : "100";
      inputEl.placeholder = isVnd ? _t('placeholder_vnd_amount') : _t('placeholder_krw_amount');
    }
  }

  // ── 가맹점 매칭 ──
  const mid = String(payload.merchantId || "").trim();
  if (!mid || !sel) {
    showQrResult(_t('qr_amount_only', payload.amount ? payload.amount.toLocaleString() : "-"), false);
    sel?.focus();
    return true;
  }

  // 1) 이미 select에 있으면 바로 선택
  const existing = Array.from(sel.options).find(
    (o) => o.value && (String(o.value) === mid || Number(o.value) === Number(mid))
  );
  if (existing) {
    sel.value = existing.value;
    showQrResult(_t('qr_success', existing.textContent, payload.amount?.toLocaleString() || "-"), false);
    sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return true;
  }

  // 2) Firestore에서 직접 조회
  showQrResult(_t('qr_loading_merchant'), false);
  try {
    const mSnap = await getDoc(doc(db, "merchants", mid));
    if (mSnap.exists()) {
      const mName = mSnap.data()?.name || mid;
      // 셀렉트에 옵션 추가 (없을 경우)
      let opt = Array.from(sel.options).find((o) => String(o.value) === mid);
      if (!opt) {
        opt = document.createElement("option");
        opt.value = mid;
        opt.textContent = mName;
        sel.appendChild(opt);
      }
      sel.value = mid;
      showQrResult(_t('qr_success', mName, payload.amount?.toLocaleString() || "-"), false);
      sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return true;
    }
  } catch (e) {
    console.warn("QR merchant fetch failed:", e.message);
    showQrResult(_t('qr_merchant_fail'), true);
    return false;
  }

  showQrResult(_t('qr_merchant_not_found', mid), true);
  return false;
}

function bindQrScan() {
  const btnOpen = $("btnQrScan");
  const btnClose = $("btnCloseQr");
  const overlay = $("qrScanOverlay");
  const video = $("qrVideo");
  const canvas = $("qrCanvas");
  const state = $("qrScanState");
  if (!btnOpen || !btnClose || !overlay || !video || !canvas) return;

  btnClose.onclick = () => stopQrScan();

  btnOpen.onclick = async () => {
    try {
      if (state) state.textContent = _t('qr_start');
      overlay.classList.add("active");

      __qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = __qrStream;
      await video.play();

      const onDetected = async (raw) => {
        if (__qrRaf) { cancelAnimationFrame(__qrRaf); __qrRaf = 0; }
        const payload = parseQrPayload(raw);
        console.log("[QR] raw:", raw, "parsed:", JSON.stringify(payload));
        if (state) state.textContent = _t('qr_recognized', raw.slice(0, 60), payload?.merchantId || "");
        if (payload && (payload.merchantId || payload.amount)) {
          await applyQrResult(payload);
        } else {
          showQrResult(_t('qr_parse_fail', raw.slice(0, 100)), true);
        }
        setTimeout(() => stopQrScan(), 800);
      };

      // ── BarcodeDetector (Android Chrome 83+ / 하드웨어 가속) ──
      if ("BarcodeDetector" in window) {
        if (state) state.textContent = _t('qr_hint');
        const bd = new BarcodeDetector({ formats: ["qr_code"] });
        let detecting = false;
        const detectTick = async () => {
          if (detecting) { __qrRaf = requestAnimationFrame(detectTick); return; }
          if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(detectTick); return; }
          detecting = true;
          try {
            const codes = await bd.detect(video);
            if (codes.length > 0) {
              await onDetected(codes[0].rawValue);
              return;
            }
          } catch { }
          detecting = false;
          __qrRaf = requestAnimationFrame(detectTick);
        };
        __qrRaf = requestAnimationFrame(detectTick);
        return;
      }

      // ── jsQR 폴백 ──
      if (!window.jsQR) {
        if (state) state.textContent = _t('qr_jsqr_fail');
        return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let frameCount = 0;
      const tick = () => {
        if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(tick); return; }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
        if (qr?.data) {
          onDetected(qr.data);
          return;
        }
        frameCount++;
        if (frameCount % 20 === 0 && state) {
          state.textContent = _t('qr_scan_progress', Math.floor(frameCount / 20));
        }
        __qrRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      if (state) state.textContent = _t('qr_camera_fail');
      stopQrScan();
      alert(_t('qr_camera_error_alert', err?.message || err));
    }
  };
}

// ── 아코디언 초기화 ──────────────────────────────────────────────────────────
function initAccordion() {
  document.querySelectorAll('.mp-section.collapsible').forEach((section) => {
    const head = section.querySelector('.mp-section-head');
    if (!head) return;

    // 제목에 chevron 추가
    const title = head.querySelector('.mp-section-title');
    if (title && !title.querySelector('.mp-chevron')) {
      const chevron = document.createElement('span');
      chevron.className = 'mp-chevron';
      chevron.textContent = '▾';
      title.appendChild(chevron);
    }

    // 헤더 이후 모든 자식을 .mp-body로 감싸기
    if (!section.querySelector('.mp-body')) {
      const body = document.createElement('div');
      body.className = 'mp-body';
      [...section.children].filter((c) => c !== head).forEach((c) => body.appendChild(c));
      section.appendChild(body);
    }

    // 토글 핸들러 (버튼/링크 클릭 시 전파 방지)
    head.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      section.classList.toggle('is-collapsed');
    });
  });
}

onAuthReady(async (ctx) => {
  initLang();
  window.addEventListener('lang:change', () => initLang());

  const loggedIn = (ctx?.loggedIn ?? ctx?.loggedin) === true;
  const user = ctx?.user;

  if (!loggedIn || !user) {
    show("needLoginPanel", true);
    const btn = $("btnLoginPage");
    if (btn) {
      btn.onclick = async () => {
        try {
          await login();
        } catch (e) {
          console.warn(e);
        }
      };
    }
    return;
  }

  show("mainContent", true);
  initAccordion();

  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target?.classList.contains('collapsible')) {
      target.classList.remove('is-collapsed');
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    if (!data.name) {
      show("noProfilePanel", true);
      return;
    }

    const walletAddress = data?.wallet?.address ? String(data.wallet.address) : '';

    renderProfile(data, user);
    renderWallet(data);
    renderReferralSection(user.uid);
    bindCreateWallet();
    bindConnectMetaMask(user.uid);
    bindOnChainRegister(user.uid);
    bindLevelUp(user.uid);
    bindRedeemPoints(user.uid);
    bindMentorRequest(user.uid);
    bindDepositForm();
    await loadMerchantsForSelect();
    bindMerchantPay(user.uid, walletAddress);
    bindQrScan();

    // URL 파라미터 처리 (앱 네이티브 카메라로 QR 스캔 시 merchant=?&amount=?&currency=? 진입)
    (async () => {
      const p = new URLSearchParams(location.search);
      const mid = (p.get("merchant") || p.get("merchantId") || p.get("id") || "").trim();
      const amt = Number(p.get("amount") || 0) || null;
      const cur = (p.get("currency") || "").toUpperCase() || null;
      if (mid || amt) {
        await applyQrResult({ merchantId: mid, merchantName: "", amount: amt, currency: cur });
        $("qrResultState")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    })();

    loadKCultureBalances(user.uid);
    loadOnChainData(user.uid);
    loadDepositHistory(user.uid);
    loadMentees();

    loadTxHistory(user.uid, walletAddress);
    loadJackpotHistory(user.uid);

    const btnRefresh = $("btnRefreshDeposits");
    if (btnRefresh) btnRefresh.onclick = () => loadDepositHistory(user.uid);

    const btnRefreshTx = $("btnRefreshTx");
    if (btnRefreshTx) btnRefreshTx.onclick = () => loadTxHistory(user.uid, walletAddress);

    const btnRefreshJackpotHist = $("btnRefreshJackpotHist");
    if (btnRefreshJackpotHist) btnRefreshJackpotHist.onclick = () => loadJackpotHistory(user.uid);

    const btnRefreshMentees = $("btnRefreshMentees");
    if (btnRefreshMentees) btnRefreshMentees.onclick = () => loadMentees();

    loadMenteeIncome(user.uid);
    const btnRefreshMenteeIncome = $("btnRefreshMenteeIncome");
    if (btnRefreshMenteeIncome) btnRefreshMenteeIncome.onclick = () => loadMenteeIncome(user.uid);

    loadCoopOrders(user.uid);
    const btnRefreshCoopOrders = $("btnRefreshCoopOrders");
    if (btnRefreshCoopOrders) btnRefreshCoopOrders.onclick = () => loadCoopOrders(user.uid);
  } catch (err) {
    console.error("\uB9C8\uC774\uD398\uC774\uC9C0 \uCD08\uAE30\uD654 \uC2E4\uD328", err);
  }
});

// ─────────────────────────────────────────────────────────
// 바우처 지갑
// ─────────────────────────────────────────────────────────
(function initVoucherWallet() {
  const grid = $('voucherCardGrid');
  const emptyEl = $('voucherCardEmpty');
  const loadingEl = $('voucherCardLoading');
  const transferPanel = $('voucherTransferPanel');
  const burnPanel = $('voucherBurnPanel');
  const vwMyQrPanel = $('vwMyQrPanel');
  const vwQrCanvas = $('vwQrCanvas');
  const vwWalletAddr = $('vwWalletAddr');
  const btnVwCopyAddr = $('btnVwCopyAddr');
  const btnVwShowQr = $('btnVwShowQr');
  const btnVwHideQr = $('btnVwHideQr');

  if (!grid) return;  // 섹션이 없으면 건너뜀

  let _pendingVoucherId = null;
  let _pendingDocId = null;
  let _pendingCollection = null;
  let _pendingHexPrice = null;

  // ── 내 지갑 QR 렌더 ─────────────────────────────────────────────────────
  let _myWalletAddress = null;
  let _qrRendered = false;

  function drawQrPanel(address) {
    if (!vwMyQrPanel || !vwQrCanvas) return;
    if (vwWalletAddr) vwWalletAddr.textContent = address;
    if (!_qrRendered && window.QRCode) {
      QRCode.toCanvas(vwQrCanvas, address, { width: 180, margin: 2 }, (err) => {
        if (err) vwQrCanvas.style.display = 'none';
      });
      _qrRendered = true;
    }
    vwMyQrPanel.style.display = '';
    if (btnVwShowQr) btnVwShowQr.style.display = 'none';
  }

  // API 응답에 walletAddress가 있으면 캐시만 해둠 (패널은 버튼 클릭 시 열림)
  function renderWalletQr(address) {
    _myWalletAddress = address;
  }

  if (btnVwShowQr) {
    btnVwShowQr.addEventListener('click', async () => {
      // 이미 캐시된 주소 있으면 바로 표시
      if (_myWalletAddress) { drawQrPanel(_myWalletAddress); return; }
      // 없으면 Firestore에서 직접 조회
      btnVwShowQr.textContent = _t('voucher_wallet_loading');
      btnVwShowQr.disabled = true;
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error(_t('voucher_no_login'));
        const snap = await getDoc(doc(db, 'users', uid));
        const addr = snap.data()?.wallet?.address;
        if (!addr) throw new Error(_t('voucher_no_wallet'));
        _myWalletAddress = addr;
        drawQrPanel(addr);
      } catch (err) {
        btnVwShowQr.textContent = _t('voucher_wallet_btn_label');
        btnVwShowQr.disabled = false;
        alert(err.message || _t('addr_lookup_fail'));
      }
    });
  }

  if (btnVwHideQr) {
    btnVwHideQr.addEventListener('click', () => {
      if (vwMyQrPanel) vwMyQrPanel.style.display = 'none';
      if (btnVwShowQr) {
        btnVwShowQr.textContent = _t('voucher_wallet_btn_label');
        btnVwShowQr.disabled = false;
        btnVwShowQr.style.display = '';
      }
    });
  }

  if (btnVwCopyAddr) {
    btnVwCopyAddr.addEventListener('click', () => {
      const addr = vwWalletAddr?.textContent?.trim();
      if (!addr) return;
      navigator.clipboard.writeText(addr).then(() => {
        const orig = btnVwCopyAddr.textContent;
        btnVwCopyAddr.textContent = _t('btn_copy_done');
        setTimeout(() => { btnVwCopyAddr.textContent = orig; }, 1500);
      });
    });
  }

  // ── 이체 패널: QR 스캔으로 수신자 주소 입력 ────────────────────────────
  const btnVwQrScan = $('btnVwQrScan');
  if (btnVwQrScan) {
    btnVwQrScan.addEventListener('click', async () => {
      const overlay = $('qrScanOverlay');
      const video = $('qrVideo');
      const canvas = $('qrCanvas');
      const state = $('qrScanState');
      if (!overlay || !video || !canvas) return;

      // 기존 스캔 중지 후 재시작
      stopQrScan();

      try {
        if (state) state.textContent = _t('qr_start');
        overlay.classList.add('active');

        __qrStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        video.srcObject = __qrStream;
        await video.play();

        const onWalletDetected = (raw) => {
          const addr = raw.trim();
          const toInput = $('vtToAddress');
          if (toInput) toInput.value = addr;
          if (state) state.textContent = _t('qr_recognized_short', addr.slice(0, 20));
          setTimeout(() => stopQrScan(), 400);
        };

        if ('BarcodeDetector' in window) {
          if (state) state.textContent = _t('qr_hint');
          const bd = new BarcodeDetector({ formats: ['qr_code'] });
          let detecting = false;
          const detectTick = async () => {
            if (detecting) { __qrRaf = requestAnimationFrame(detectTick); return; }
            if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(detectTick); return; }
            detecting = true;
            try {
              const codes = await bd.detect(video);
              if (codes.length > 0) { onWalletDetected(codes[0].rawValue); return; }
            } catch { }
            detecting = false;
            __qrRaf = requestAnimationFrame(detectTick);
          };
          __qrRaf = requestAnimationFrame(detectTick);
          return;
        }

        if (!window.jsQR) { if (state) state.textContent = _t('qr_jsqr_fail'); return; }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let frameCount = 0;
        const tick = () => {
          if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(tick); return; }
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
          if (qr?.data) { onWalletDetected(qr.data); return; }
          frameCount++;
          if (frameCount % 20 === 0 && state) state.textContent = _t('qr_scan_progress2');
          __qrRaf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (state) state.textContent = _t('qr_camera_fail');
        stopQrScan();
      }
    });
  }

  function setVtStatus(msg, ok) {
    const el = $('vtStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#16a34a' : ok === false ? '#e53e3e' : '#6b7280';
  }
  function setVbStatus(msg, ok) {
    const el = $('vbStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#16a34a' : ok === false ? '#e53e3e' : '#6b7280';
  }

  function fmtHexShort(weiStr) {
    try { return (Number(BigInt(weiStr)) / 1e18).toFixed(4); }
    catch { return weiStr; }
  }

  // FX 헬퍼 — coopGetMyVouchers 응답의 fxKrwPerHexScaled / fxScale 사용
  let _vFx = { krw: 0, vnd: 0, scale: 1 };
  function hexWeiToKrwStr(weiStr) {
    if (!_vFx.krw || !weiStr || weiStr === '0') return '';
    const hex = Number(BigInt(weiStr)) / 1e18;
    return Math.round(hex * _vFx.krw).toLocaleString() + ' ₩';
  }
  function hexWeiToVndStr(weiStr) {
    if (!_vFx.vnd || !weiStr || weiStr === '0') return '';
    const hex = Number(BigInt(weiStr)) / 1e18;
    return Math.round(hex * _vFx.vnd).toLocaleString() + ' ₫';
  }

  function renderVoucherCards(vouchers) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (!vouchers.length) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const frag = document.createDocumentFragment();
    vouchers.forEach(v => {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--border,#e5e7eb);border-radius:10px;overflow:hidden;background:var(--surface,#fff);';
      const imgSrc = v.imageUrl || '';
      const imgTag = imgSrc
        ? `<img src="${imgSrc}" alt="${_t('voucher_default_name')}" style="width:100%;height:110px;object-fit:cover;display:block;background:#f3f4f6;" onerror="this.style.display='none'">`
        : `<div style="width:100%;height:60px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.4rem;">🎫</div>`;
      const isGameVoucher = v.source === 'game';
      const isProductVoucher = v.source === 'product';
      const isCommunityVoucher = v.source === 'community';
      // 서비스 바우처는 voucherId(숫자), 나머지는 docId(Firestore 문서 ID) 사용
      const vid = (isProductVoucher || isGameVoucher || isCommunityVoucher) ? null : v.voucherId;
      const docId = v.id;
      const col = isGameVoucher ? 'treasure_voucher_logs'
        : isCommunityVoucher ? 'community_event_vouchers'
          : 'coop';
      const hp = v.hexPrice ?? '0';
      const refundWei = (!isGameVoucher && hp !== '0')
        ? String(BigInt(hp) - BigInt(hp) * BigInt(v.burnFeeBps ?? 0) / BigInt(10000))
        : '0';

      // 소스 배지
      const sourceBadge = isGameVoucher
        ? `<span style="font-size:0.7rem;background:#d1fae5;color:#065f46;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:5px;">${_t('voucher_game_badge')}</span>`
        : isCommunityVoucher
          ? `<span style="font-size:0.7rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:5px;">행사</span>`
          : `<span style="font-size:0.7rem;background:#ede9fe;color:#5b21b6;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:5px;">${_t('voucher_shop_badge')}</span>`;

      // 가격 영역
      let priceHtml;
      if (isGameVoucher) {
        priceHtml = `<div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:6px;">${_t('voucher_game_src')}</div>`;
      } else if (isCommunityVoucher) {
        const vndStr = v.priceVnd ? v.priceVnd.toLocaleString() + ' ₫' : '';
        const krwStr = hexWeiToKrwStr(hp);
        const fxLine = (krwStr || vndStr) ? `<span style="color:#9ca3af;">${[krwStr, vndStr].filter(Boolean).join(' / ')}</span>` : '';
        const refundLine = refundWei !== '0' ? `<br>${_t('voucher_refund', fmtHexShort(refundWei))}` : '';
        priceHtml = `<div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:6px;">${_t('voucher_price', fmtHexShort(hp))}${refundLine}<br>${fxLine}</div>`;
      } else {
        const krwStr = hexWeiToKrwStr(hp);
        const vndStr = hexWeiToVndStr(hp);
        const fxLine = (krwStr || vndStr)
          ? `<span style="color:#9ca3af;">${[krwStr, vndStr].filter(Boolean).join(' / ')}</span>`
          : '';
        const refundLine = refundWei !== '0' ? `<br>${_t('voucher_refund', fmtHexShort(refundWei))}` : '';
        priceHtml = `<div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:6px;">${_t('voucher_price', fmtHexShort(hp))}${refundLine}<br>${fxLine}</div>`;
      }

      // 이체/소각 버튼
      const actionHtml = `<div style="display:flex;gap:6px;">
           <button data-docid="${docId}" data-vid="${vid ?? ''}" data-collection="${col}" data-action="transfer"
             style="flex:1;padding:6px 0;background:var(--accent,#7c3aed);color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">
             ${_t('btn_voucher_transfer')}
           </button>
           <button data-docid="${docId}" data-vid="${vid ?? ''}" data-collection="${col}" data-hex-price="${hp}" data-burn-fee-bps="${v.burnFeeBps ?? 0}" data-action="burn"
             style="flex:1;padding:6px 0;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">
             ${_t('btn_voucher_burn')}
           </button>
         </div>`;

      card.innerHTML = `
        ${imgTag}
        <div style="padding:10px 12px;">
          ${sourceBadge}
          <div style="font-weight:700;font-size:0.92rem;margin-bottom:3px;">${v.description || _t('voucher_default_name')}</div>
          <div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:2px;">${_t('voucher_usage_label')} ${v.usagePlace || '—'}</div>
          ${priceHtml}
          ${actionHtml}
        </div>`;
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);

    // 이체 버튼
    grid.querySelectorAll('[data-action="transfer"]').forEach(btn => {
      btn.addEventListener('click', () => {
        _pendingDocId = btn.dataset.docid || null;
        _pendingVoucherId = btn.dataset.vid ? Number(btn.dataset.vid) : null;
        _pendingCollection = btn.dataset.collection || null;
        const label = _pendingVoucherId ? `#${_pendingVoucherId}` : (_pendingDocId ? _pendingDocId.slice(0, 8) + '…' : '?');
        if ($('vtVoucherId')) $('vtVoucherId').textContent = label;
        if ($('vtToAddress')) $('vtToAddress').value = '';
        setVtStatus('');
        transferPanel.style.display = '';
        burnPanel.style.display = 'none';
        transferPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    // 소각 버튼
    grid.querySelectorAll('[data-action="burn"]').forEach(btn => {
      btn.addEventListener('click', () => {
        _pendingDocId = btn.dataset.docid || null;
        _pendingVoucherId = btn.dataset.vid ? Number(btn.dataset.vid) : null;
        _pendingCollection = btn.dataset.collection || null;
        _pendingHexPrice = btn.dataset.hexPrice ?? '0';
        const hp = _pendingHexPrice;
        const bps = Number(btn.dataset.burnFeeBps ?? 0);
        const isGame = _pendingCollection === 'treasure_voucher_logs'
          || (_pendingCollection === 'community_event_vouchers' && (!hp || hp === '0'));
        const label = _pendingVoucherId ? `#${_pendingVoucherId}` : _t('burn_selected_voucher');
        if ($('vbInfo')) {
          if (isGame) {
            $('vbInfo').innerHTML = _t('burn_game_info', label);
          } else {
            const fee = BigInt(hp) * BigInt(bps) / BigInt(10000);
            const refund = BigInt(hp) - fee;
            const refundKrw = hexWeiToKrwStr(String(refund));
            const refundVnd = hexWeiToVndStr(String(refund));
            const fxNote = (refundKrw || refundVnd)
              ? ` <span style="font-size:0.8em;color:#9ca3af;">(${[refundKrw, refundVnd].filter(Boolean).join(' / ')})</span>`
              : '';
            $('vbInfo').innerHTML = _t('burn_info', label, fmtHexShort(String(refund)), fxNote, fmtHexShort(String(fee)));
          }
        }
        // 게임 바우처는 단계 레이블 교체
        if (isGame) {
          if ($('vbStep2Label')) $('vbStep2Label').textContent = _t('burn_step2_game');
          if ($('vbStep3Label')) $('vbStep3Label').textContent = _t('burn_step3_game');
          if ($('vbStep2')) $('vbStep2').style.display = '';
          if ($('vbStep3')) $('vbStep3').style.display = '';
        } else {
          if ($('vbStep2Label')) $('vbStep2Label').textContent = _t('burn_step2_onchain');
          if ($('vbStep3Label')) $('vbStep3Label').textContent = _t('burn_step3_onchain');
        }
        setVbStatus('');
        burnPanel.style.display = '';
        transferPanel.style.display = 'none';
        burnPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }

  async function loadMyVouchers() {
    if (loadingEl) loadingEl.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';
    grid.innerHTML = '';
    try {
      const fn = httpsCallable(functions, 'coopGetMyVouchers');
      const res = await fn();
      const d = res.data ?? {};
      // FX 환율 저장
      if (d.fxScale) {
        _vFx.krw = d.fxKrwPerHexScaled ? Number(d.fxKrwPerHexScaled) / d.fxScale : 0;
        _vFx.vnd = d.fxVndPerHexScaled ? Number(d.fxVndPerHexScaled) / d.fxScale : 0;
        _vFx.scale = d.fxScale;
      }
      if (d.walletAddress) renderWalletQr(d.walletAddress);
      renderVoucherCards(d.vouchers ?? []);
    } catch (err) {
      if (loadingEl) { loadingEl.textContent = _t('voucher_load_error', err.message || _t('server_error')); }
    }
  }

  // 이체 확인
  $('btnVtConfirm')?.addEventListener('click', async () => {
    const toAddress = ($('vtToAddress')?.value ?? '').trim();
    if (!toAddress) { setVtStatus(_t('transfer_no_addr'), false); return; }
    if (!_pendingDocId && _pendingVoucherId === null) return;
    const btn = $('btnVtConfirm');
    btn.disabled = true;
    setVtStatus(_t('transfer_pending'));
    try {
      const fn = httpsCallable(functions, 'coopTransferVoucher');
      await fn({
        docId: _pendingDocId || undefined,
        voucherId: _pendingVoucherId ?? undefined,
        toAddress,
        sourceCollection: _pendingCollection || undefined,
      });
      setVtStatus(_t('transfer_done'), true);
      transferPanel.style.display = 'none';
      _pendingVoucherId = null;
      _pendingDocId = null;
      _pendingCollection = null;
      await loadMyVouchers();
    } catch (err) {
      setVtStatus(_t('transfer_error', err.message || _t('server_error')), false);
    } finally {
      btn.disabled = false;
    }
  });

  $('btnVtCancel')?.addEventListener('click', () => {
    transferPanel.style.display = 'none';
    _pendingVoucherId = null;
    _pendingDocId = null;
    _pendingCollection = null;
    _pendingHexPrice = null;
  });

  // 소각 확인
  $('btnVbConfirm')?.addEventListener('click', async () => {
    if (!_pendingDocId && _pendingVoucherId === null) return;
    const btn = $('btnVbConfirm');
    const cancelBtn = $('btnVbCancel');
    const stepsEl = $('vbSteps');
    const buttonsEl = $('vbButtons');

    // 단계 아이콘 갱신 헬퍼
    const stepState = (n, state) => {
      const icon = $(`vbStep${n}Icon`);
      const row = $(`vbStep${n}`);
      if (!icon || !row) return;
      const map = { wait: ['⏳', '#9ca3af'], active: ['🔄', '#d97706'], done: ['✅', '#16a34a'], error: ['❌', '#ef4444'] };
      const [emoji, color] = map[state] || map.wait;
      icon.textContent = emoji;
      row.style.color = color;
      if (state === 'active') row.style.fontWeight = '700';
    };

    // UI → 진행 모드
    btn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (buttonsEl) buttonsEl.style.opacity = '0.4';
    if (stepsEl) stepsEl.style.display = '';
    setVbStatus('');
    [1, 2, 3, 4].forEach(n => stepState(n, 'wait'));

    // community 바우처는 hexPrice > 0 이면 서비스 환급 흐름 (product와 동일)
    const isGameBurnFlow = _pendingCollection === 'treasure_voucher_logs'
      || (_pendingCollection === 'community_event_vouchers' && (!_pendingHexPrice || _pendingHexPrice === '0'));
    let progressTimer = null;
    try {
      stepState(1, 'active');
      const fn = httpsCallable(functions, 'coopBurnVoucher', { timeout: 120000 });

      if (!isGameBurnFlow) {
        // 상품 바우처: 타이머로 단계 시각적 전진
        let step = 1;
        progressTimer = setInterval(() => {
          if (step >= 3) return;
          stepState(step, 'done');
          step++;
          stepState(step, 'active');
        }, 4000);
      }

      await fn({
        docId: _pendingDocId || undefined,
        voucherId: _pendingVoucherId ?? undefined,
        sourceCollection: _pendingCollection || undefined,
      });

      clearInterval(progressTimer);

      // 남은 단계 완료 처리
      for (let n = 1; n <= 3; n++) stepState(n, 'done');
      stepState(4, 'active');
      await new Promise(r => setTimeout(r, 400));
      stepState(4, 'done');

      setVbStatus(isGameBurnFlow ? _t('burn_done_game') : _t('burn_done_onchain'), true);
      setTimeout(async () => {
        burnPanel.style.display = 'none';
        if (stepsEl) stepsEl.style.display = 'none';
        _pendingVoucherId = null;
        _pendingDocId = null;
        _pendingCollection = null;
        _pendingHexPrice = null;
        await loadMyVouchers();
      }, 1800);
    } catch (err) {
      clearInterval(progressTimer);
      // 현재 활성 단계를 에러로
      [1, 2, 3, 4].forEach(n => {
        const icon = $(`vbStep${n}Icon`);
        if (icon?.textContent === '🔄') stepState(n, 'error');
      });
      setVbStatus(_t('burn_error', err.message || _t('server_error')), false);
      btn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (buttonsEl) buttonsEl.style.opacity = '';
    }
  });

  $('btnVbCancel')?.addEventListener('click', () => {
    burnPanel.style.display = 'none';
    _pendingVoucherId = null;
    _pendingDocId = null;
    _pendingCollection = null;
    _pendingHexPrice = null;
  });

  // 섹션 열릴 때 첫 로드
  const section = $('voucherWalletSection');
  if (section) {
    section.querySelector('.mp-section-head')?.addEventListener('click', () => {
      const isCollapsed = section.classList.contains('is-collapsed');
      if (isCollapsed && !grid.children.length) loadMyVouchers();
    }, { once: true });
  }
})();

// ── 앱 캐시 초기화 ──
(function bindClearCache() {
  const btn = $("btnClearCache");
  const msg = $("clearCacheMsg");
  if (!btn) return;

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = _t('cache_loading');

    try {
      // 1) Service Worker 캐시 전체 삭제
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }

      // 2) Service Worker 등록 해제
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }

      // 3) localStorage / sessionStorage 초기화
      localStorage.clear();
      sessionStorage.clear();

      if (msg) {
        msg.style.display = "";
        msg.textContent = _t('cache_done');
      }

      setTimeout(() => {
        // 강제 새로고침 (캐시 무시)
        location.href = location.pathname + "?v=" + Date.now();
      }, 3000);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = _t('btn_cache_reset');
      if (msg) { msg.style.display = ""; msg.textContent = _t('cache_error', err.message); }
    }
  };
})();

// ── 서비스 경험치 동기화 상태 UI ────────────────────────────────────────────────
// 레벨업 → Firestore 플래그 → 6시간 배치 또는 수동 동기화 → adminSetLevel() 1tx
function _renderOnChainSyncStatus(bp, uid) {
  const row = document.getElementById('onChainSyncRow');
  const container = document.getElementById('onChainSyncStatus');
  if (!row || !container) return;
  row.classList.remove('hidden');

  const pending = bp.pendingOnChainSync === true;
  const pendingLevel = bp.pendingOnChainLevel || null;
  const onChainLevel = bp.onChainLevel || null;
  const lastSyncAt = bp.lastOnChainSyncAt?.toDate?.() || null;
  const lastTxHash = bp.lastOnChainSyncTxHash || null;

  let statusHtml;
  if (pending && pendingLevel) {
    const lastSyncStr = lastSyncAt ? lastSyncAt.toLocaleDateString() : '—';
    statusHtml = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="background:#f59e0b;color:#000;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">
          ⏳ 동기화 대기 Lv.${pendingLevel}
        </span>
        <span style="font-size:11px;color:#9ca3af;">자동 동기화: 최대 6시간 이내</span>
        <button id="btnManualSync" style="
          padding:4px 12px;background:#3b82f6;color:#fff;border:none;
          border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
          지금 동기화
        </button>
      </div>`;
  } else if (onChainLevel) {
    const syncStr = lastSyncAt ? lastSyncAt.toLocaleDateString() : '—';
    const txShort = lastTxHash ? lastTxHash.slice(0, 10) + '…' : '';
    statusHtml = `
      <span style="background:#10b981;color:#fff;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">
        ✅ 서비스 Lv.${onChainLevel} 동기화됨
      </span>
      <span style="font-size:11px;color:#9ca3af;margin-left:6px;">${syncStr}${txShort ? ' · ' + txShort : ''}</span>`;
  } else {
    statusHtml = `<span style="font-size:11px;color:#6b7280;">서비스 레벨 미기록 (레벨업 후 자동 저장)</span>`;
  }

  container.innerHTML = statusHtml;

  // 수동 동기화 버튼 이벤트
  const manualBtn = document.getElementById('btnManualSync');
  if (!manualBtn) return;
  manualBtn.addEventListener('click', async () => {
    manualBtn.disabled = true;
    manualBtn.textContent = '동기화 중…';
    try {
      const fn = httpsCallable(functions, 'requestOnChainLevelSync');
      const res = await fn();
      if (res.data?.already) {
        manualBtn.textContent = '대기 없음';
      } else if (res.data?.skipped) {
        manualBtn.textContent = '이미 최신';
      } else {
        manualBtn.textContent = `✅ Lv.${res.data?.newLevel} 저장 완료`;
      }
    } catch (e) {
      manualBtn.disabled = false;
      manualBtn.textContent = '실패: ' + (e.message || '오류');
    }
  });
}
