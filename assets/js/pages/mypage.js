// /assets/js/pages/mypage.js
// MyPage: profile / wallet / on-chain status / deposit & payment history

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
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

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

function renderWallet(userData) {
  const addr = userData?.wallet?.address;
  const isMetaMask = userData?.wallet?.type === "metamask" || (addr && !userData?.wallet?.encryptedKey);

  if (!addr) {
    show("noWallet", true);
    show("walletInfo", false);
    show("btnCreateWallet", true);
    show("btnConnectMetaMask", false);
    setText("onChainStatus", "-");
    return;
  }

  show("noWallet", false);
  show("walletInfo", true);
  show("btnConnectMetaMask", false);
  show("metamaskWarning", isMetaMask);
  show("btnCreateWallet", isMetaMask);
  if (!isMetaMask) show("btnCreateWallet", false);
  setText("walletAddress", addr);
}

async function loadOnChainData(uid) {
  const addr = (await getDoc(doc(db, "users", uid))).data()?.wallet?.address;
  if (!addr) return;

  setText("onChainStatus", "\uC870\uD68C \uC911...");

  try {
    const getMyOnChain = httpsCallable(functions, "getMyOnChain");
    const res = await getMyOnChain();
    const d = res.data;

    if (d.level > 0) {
      setText("onChainStatus", "\uB4F1\uB85D \uC644\uB8CC \u2713");
      $("onChainStatus").style.color = "var(--accent)";

      show("levelRow", true);
      show("pointRow", true);

      const fmtBalance = (krw, usd, vnd, hex) => {
        if (krw == null) return (hex || "0") + " HEX";
        const parts = [Number(krw).toLocaleString() + "\uC6D0"];
        if (usd != null) parts.push("$" + Number(usd).toFixed(2));
        if (vnd != null) parts.push(Number(vnd).toLocaleString() + " VND");
        return parts.join(" / ");
      };

      setText("levelDisplay", "Lv." + d.level);
      setText("pointDisplay", fmtBalance(d.pointKrw, d.pointUsd, d.pointVnd, d.pointDisplay));

      show("expRow", true);
      show("expBarRow", true);

      const expPct = d.requiredExp > 0
        ? Math.min(100, Math.round((d.exp / d.requiredExp) * 100))
        : 0;

      setText("expDisplay", `${d.exp.toLocaleString()} / ${d.requiredExp.toLocaleString()}`);

      const barFill = $("expBarFill");
      if (barFill) barFill.style.width = expPct + "%";

      const expReqEl = $("expRequired");
      if (expReqEl) {
        const remain = Math.max(0, d.requiredExp - d.exp);
        expReqEl.textContent = remain > 0
          ? `\uB2E4\uC74C \uB808\uBCA8\uAE4C\uC9C0 ${remain.toLocaleString()} EXP \uD544\uC694`
          : "\uB808\uBCA8\uC5C5 \uAC00\uB2A5";
      }

      show("levelUpRow", d.exp >= d.requiredExp);

      const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
      const isZeroMentor = !d.mentor || d.mentor === ZERO_ADDR;
      show("mentorAddrRow", true);

      let mentorText = "\uBBF8\uC5F0\uACB0 (\uAE30\uBCF8 \uBA58\uD1A0)";
      if (!isZeroMentor) {
        try {
          const mentorSnap = await getDocs(
            query(collection(db, "mentors"), where("address", "==", d.mentor), limit(1))
          );
          mentorText = !mentorSnap.empty
            ? (mentorSnap.docs[0].data()?.email || d.mentor)
            : d.mentor.slice(0, 6) + "..." + d.mentor.slice(-4);
        } catch {
          mentorText = d.mentor.slice(0, 6) + "..." + d.mentor.slice(-4);
        }
      }

      const mentorEl = $("mentorAddrDisplay");
      if (mentorEl) {
        mentorEl.textContent = mentorText;
        const isEmail = mentorText.includes("@");
        mentorEl.classList.toggle("mono", !isEmail);
        mentorEl.style.fontSize = isEmail ? "0.95em" : "0.78em";
      }

      show("mentorNotice", isZeroMentor);
      show("mentorRequestBox", isZeroMentor);

      const walletHexBig = BigInt(d.walletHexWei || "0");
      show("walletHexRow", walletHexBig > 0n);
      if (walletHexBig > 0n) {
        setText("walletHexDisplay", fmtBalance(d.walletHexKrw, d.walletHexUsd, d.walletHexVnd, d.walletHexDisplay));
      }

      show("onChainRegBox", false);
    } else {
      setText("onChainStatus", "\uBBF8\uB4F1\uB85D");
      $("onChainStatus").style.color = "var(--muted)";
      show("onChainRegBox", true);
      // 기존 멘토 주소 자동 입력 (이전 컨트랙트에서 가져옴)
      try {
        const prevMentor = (await getDoc(doc(db, "users", uid))).data()?.onChain?.mentorAddress;
        const inputEl = $("mentorAddrInput");
        if (prevMentor && inputEl && !inputEl.value) {
          inputEl.value = prevMentor;
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn("getMyOnChain failed:", err.message);
    try {
      const cached = (await getDoc(doc(db, "users", uid))).data()?.onChain;
      if (cached?.registered) {
        setText("onChainStatus", "\uB4F1\uB85D \uC644\uB8CC \u2713");
        $("onChainStatus").style.color = "var(--accent)";
        show("onChainRegBox", false);
      } else {
        setText("onChainStatus", "\uBBF8\uB4F1\uB85D");
        $("onChainStatus").style.color = "var(--muted)";
        show("onChainRegBox", true);
      }
    } catch {
      setText("onChainStatus", "\uC870\uD68C \uC2E4\uD328");
      $("onChainStatus").style.color = "var(--muted)";
    }
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
      wrap.innerHTML = '<p class="hint">\uCDA9\uC804 \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.</p>';
      return;
    }

    const statusLabel = {
      pending:    { text: "대기중",  color: "#f59e0b" },
      processing: { text: "처리중",  color: "#3b82f6" },
      approved:   { text: "완료 ✓", color: "#10b981" },
      rejected:   { text: "반려",    color: "#ef4444" },
    };

    const rows = snap.docs.map((d) => {
      const data = d.data();
      const dateStr = data.requestedAt?.toDate
        ? data.requestedAt.toDate().toLocaleString("ko")
        : "-";

      const amountParts = [];
      if (data.amountKrw) amountParts.push((data.amountKrw || 0).toLocaleString() + "원");
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
          ${data.status === "rejected" && data.rejectReason ? `<div style="font-size:0.8em; color:#ef4444; margin-top:4px;">사유: ${data.rejectReason}</div>` : ""}
        </div>
      `;
    }).join("");

    wrap.innerHTML = rows;
  } catch (err) {
    wrap.innerHTML = '<p class="hint muted">\uCDA9\uC804 \uB0B4\uC5ED \uC870\uD68C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.</p>';
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
      wrap.innerHTML = '<p class="hint">\uB4F1\uB85D\uB41C \uBA58\uD2F0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</p>';
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
            <span class="muted" style="font-size:0.85em;">\uAC00\uC785\uC77C: ${dateStr}</span>
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `<p class="hint muted" style="margin-bottom:8px;">\uCD1D ${mentees.length}\uBA85</p>` + rows;
  } catch (err) {
    show("menteeSection", true);
    wrap.innerHTML = '<p class="hint muted">\uBA58\uD2F0 \uBAA9\uB85D \uC870\uD68C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.</p>';
    console.warn("getMyMentees failed", err.message);
  }
}

const TX_CONFIG = {
  buy:             { label: "충전",          dir: "income",  icon: "💰" },
  credit:          { label: "포인트 지급",   dir: "income",  icon: "⭐" },
  p2p:             { label: "P2P 수령",      dir: "income",  icon: "📥" },
  p2p_merge:       { label: "P2P 합산",      dir: "income",  icon: "📥" },
  withdraw:        { label: "인출",          dir: "expense", icon: "📤" },
  pay_merchant:    { label: "가맹점 결제",   dir: "expense", icon: "🛒" },
  merchant_income: { label: "가맹점 수익",   dir: "income",  icon: "🏪" },
};

function txAmountHex(tx) {
  if (tx.amountHex)    return Number(tx.amountHex);
  // merchant_income 은 순수익(netAmountWei) 우선 표시
  if (tx.netAmountWei) return Number(formatWei(tx.netAmountWei));
  if (tx.amountWei)    return Number(formatWei(tx.amountWei));
  if (tx.priceWei)     return Number(formatWei(tx.priceWei));
  return 0;
}

function renderTxItem({ label, icon, dir, amountHex, dateStr, txHash, statusBadge }) {
  const amtSign = dir === "income" ? "+" : dir === "expense" ? "−" : "";
  const amtClass = dir === "income" ? "income" : dir === "expense" ? "expense" : dir;
  const amtText = amountHex > 0
    ? `${amtSign}${amountHex.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} HEX`
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
const OPBNB_RPC        = "https://opbnb-mainnet-rpc.bnbchain.org";

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

async function loadMenteeIncome(uid) {
  const section  = $("menteeIncomeSection");
  const summaryEl = $("menteeIncomeSummary");
  const listEl   = $("menteeIncomeList");
  if (!listEl) return;

  listEl.innerHTML = '<p class="hint">불러오는 중...</p>';
  if (summaryEl) summaryEl.innerHTML = "";

  try {
    // Cloud Function으로 멘티 수익 집계 (Admin SDK → Firestore 권한 제한 없음)
    const fn = httpsCallable(functions, "getMenteeIncome");
    const res = await fn();
    const { mentees, myAddress } = res.data;

    if (!mentees || mentees.length === 0) {
      listEl.innerHTML = '<div class="mi-empty">등록된 멘티가 없습니다.</div>';
      if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      return;
    }

    // 내 온체인 포인트 잔액
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
          <div class="mi-summary-label">멘티 수</div>
          <div class="mi-summary-val">${totalMentees}명</div>
        </div>
        <div class="mi-summary-card">
          <div class="mi-summary-label">총 결제 건수</div>
          <div class="mi-summary-val">${totalTxCount}건</div>
        </div>
        <div class="mi-summary-card" style="background:linear-gradient(135deg,#faf5ff,#f3e8ff);border-color:#d8b4fe;">
          <div class="mi-summary-label">누적 수익 (추정)</div>
          <div class="mi-summary-val" style="color:#7c3aed;">${totalEarning.toFixed(4)} HEX</div>
          <div class="mi-summary-sub">fee × 30% 합산</div>
        </div>
        <div class="mi-summary-card" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-color:#93c5fd;">
          <div class="mi-summary-label">현재 포인트 잔액</div>
          <div class="mi-summary-val" style="color:#1d4ed8;">${myPointsHex.toFixed(6)} HEX</div>
          <div class="mi-summary-sub">온체인 실시간</div>
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
            <span class="mi-tx-amt">결제 ${(t.amountHex || 0).toFixed(4)} HEX → 내 수익 ${earning > 0 ? earning.toFixed(6) : "?"} HEX</span>
          </div>`;
      }).join("") || '<div class="mi-tx-row"><span>결제 내역 없음</span></div>';

      const card = document.createElement("div");
      card.className = "mi-mentee-card";
      card.innerHTML = `
        <div class="mi-mentee-head">
          <div>
            <div class="mi-mentee-name">${m.name}</div>
            <div class="mi-mentee-addr">${addrShort} · 가입 ${regDate}</div>
          </div>
          <div class="mi-mentee-total">
            <div class="mi-mentee-total-val">${m.myEstimatedEarningHex > 0 ? m.myEstimatedEarningHex.toFixed(6) + " HEX" : "-"}</div>
            <div class="mi-mentee-total-label">누적 수익 (추정)</div>
          </div>
        </div>
        <div class="mi-stat-row">
          <div class="mi-stat">
            <div class="mi-stat-val">${m.txCount}건</div>
            <div class="mi-stat-label">결제 횟수</div>
          </div>
          <div class="mi-stat">
            <div class="mi-stat-val">${(m.totalAmountHex || 0).toFixed(4)}</div>
            <div class="mi-stat-label">총 결제액 HEX</div>
          </div>
          <div class="mi-stat">
            <div class="mi-stat-val">${m.myEstimatedEarningHex > 0 ? m.myEstimatedEarningHex.toFixed(6) : "-"}</div>
            <div class="mi-stat-label">내 멘토 수익</div>
          </div>
        </div>
        ${m.recentTxs.length > 0 ? `
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;">
            <div style="font-size:0.72rem;color:#94a3b8;font-weight:700;margin-bottom:4px;">최근 결제 내역</div>
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
    listEl.innerHTML = `<div class="mi-empty">오류: ${err.message}</div>`;
    if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
    console.warn("loadMenteeIncome failed:", err);
  }
}

async function loadJackpotHistory(uid) {
  const wrap    = $("jackpotHistList");
  const section = $("jackpotHistSection");
  if (!wrap) return;

  wrap.innerHTML = '<p class="hint">불러오는 중...</p>';

  try {
    const q = query(
      collection(db, "jackpot_wins"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(30)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      wrap.innerHTML = '<div class="jp-hist-empty">아직 잭팟 당첨 내역이 없습니다.</div>';
      if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      return;
    }

    const frag = document.createDocumentFragment();
    snap.docs.forEach((d) => {
      const v = d.data();
      const ts = v.createdAt?.toDate ? v.createdAt.toDate() : (v.createdAt ? new Date(v.createdAt) : null);
      const dateStr = ts ? ts.toLocaleString("ko-KR") : "-";

      const items = [];
      if ((v.potionCount    || 0) > 0) items.push(`빨간약 +${v.potionCount}`);
      if ((v.mpPotionCount  || 0) > 0) items.push(`마법약 +${v.mpPotionCount}`);
      if ((v.reviveAdded    || 0) > 0) items.push(`부활권 +${v.reviveAdded}`);

      const onchainPtsWei = BigInt(v.onchainJackpotPointsWei || '0');
      let ptsLine = '';
      if (onchainPtsWei > 0n) {
        const ptsHex = (Number(onchainPtsWei) / 1e18).toFixed(6);
        ptsLine = `<span class="jp-onchain-badge">온체인</span> ${ptsHex} HEX 포인트`;
      }

      const subText = [ptsLine, ...items].filter(Boolean).join(' · ') || '아이템 보상';

      const el = document.createElement('div');
      el.className = 'jp-hist-item';
      el.innerHTML = `
        <div class="jp-hist-icon">🎰</div>
        <div class="jp-hist-body">
          <div class="jp-hist-title">잭팟 당첨 · ${v.merchantName || '가맹점'}</div>
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
          wrap.innerHTML = '<div class="jp-hist-empty">아직 잭팟 당첨 내역이 없습니다.<br><small style="color:#c4b5fd;">인덱스 빌드 중 (1~5분 소요)</small></div>';
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
            if ((v.potionCount   || 0) > 0) items.push(`빨간약 +${v.potionCount}`);
            if ((v.mpPotionCount || 0) > 0) items.push(`마법약 +${v.mpPotionCount}`);
            if ((v.reviveAdded   || 0) > 0) items.push(`부활권 +${v.reviveAdded}`);
            const onchainPtsWei = BigInt(v.onchainJackpotPointsWei || '0');
            let ptsLine = '';
            if (onchainPtsWei > 0n) {
              const ptsHex = (Number(onchainPtsWei) / 1e18).toFixed(6);
              ptsLine = `<span class="jp-onchain-badge">온체인</span> ${ptsHex} HEX 포인트`;
            }
            const subText = [ptsLine, ...items].filter(Boolean).join(' · ') || '아이템 보상';
            const el = document.createElement('div');
            el.className = 'jp-hist-item';
            el.innerHTML = `
              <div class="jp-hist-icon">🎰</div>
              <div class="jp-hist-body">
                <div class="jp-hist-title">잭팟 당첨 · ${v.merchantName || '가맹점'}</div>
                <div class="jp-hist-sub">${subText}</div>
                <div class="jp-hist-date">${dateStr}</div>
              </div>
            `;
            frag2.appendChild(el);
          });
          wrap.innerHTML = '';
          wrap.appendChild(frag2);
        }
        if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      } catch (e2) {
        wrap.innerHTML = `<div class="jp-hist-empty">인덱스 빌드 중입니다. 잠시 후 새로고침 해주세요.</div>`;
        if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      }
    } else {
      wrap.innerHTML = `<div class="jp-hist-empty">오류: ${err.message}</div>`;
      if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
    }
  }
}

async function loadTxHistory(uid, walletAddress) {
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
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const tx = d.data();
      const cfg = TX_CONFIG[tx.type] || { label: tx.type, dir: "expense", icon: "📋" };

      // merchant_income: 가맹점명 + 수수료 정보를 label에 포함
      let label = cfg.label;
      if (tx.type === "merchant_income" && tx.merchantName) {
        const feePct = tx.feeBps != null ? ` (수수료 ${(tx.feeBps / 100).toFixed(0)}%)` : "";
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
  } catch (err) {
    console.warn("loadTxHistory Firestore:", err.message);
  }

  if (unified.length === 0) {
    if (section) section.style.display = "none";
    return;
  }

  // 날짜 내림차순 정렬
  unified.sort((a, b) => b.sortTs - a.sortTs);

  show("txSection", true);

  // 수입 / 지출 합계
  let totalIncome = 0, totalExpense = 0, incomeCount = 0, expenseCount = 0;
  unified.forEach((t) => {
    if (t.dir === "income") { totalIncome += t.amountHex; incomeCount++; }
    else if (t.dir === "expense") { totalExpense += t.amountHex; expenseCount++; }
  });

  const fmtSum = (v) => v.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) + " HEX";

  const summary = $("txSummary");
  if (summary) {
    summary.style.display = "";
    const el = (id) => document.getElementById(id);
    if (el("txTotalIncome")) el("txTotalIncome").textContent = "+" + fmtSum(totalIncome);
    if (el("txTotalExpense")) el("txTotalExpense").textContent = "−" + fmtSum(totalExpense);
    if (el("txTotalIncomeCount")) el("txTotalIncomeCount").textContent = incomeCount + "건";
    if (el("txTotalExpenseCount")) el("txTotalExpenseCount").textContent = expenseCount + "건";
  }

  wrap.innerHTML = unified.map(renderTxItem).join("");
}

function formatWei(weiStr) {
  try {
    const n = parseFloat(BigInt(weiStr).toString()) / 1e18;
    return n.toFixed(4);
  } catch {
    return weiStr;
  }
}

function bindCreateWallet() {
  const btn = $("btnCreateWallet");
  if (!btn) return;

  btn.onclick = async () => {
    const mentorAddress = String($("createWalletMentorAddr")?.value || "").trim();
    if (!mentorAddress || !/^0x[0-9a-fA-F]{40}$/i.test(mentorAddress)) {
      alert("\uBA58\uD1A0 \uC9C0\uAC11 \uC8FC\uC18C\uB97C \uC62C\uBC14\uB974\uAC8C \uC785\uB825\uD558\uC138\uC694.\n\uC608: 0x\uB85C \uC2DC\uC791\uD558\uB294 42\uC790\uB9AC \uC8FC\uC18C");
      return;
    }

    btn.disabled = true;
    btn.textContent = "\uC0DD\uC131 \uC911...";
    try {
      const createWalletFn = httpsCallable(functions, "createWallet");
      const res = await createWalletFn({ mentorAddress });
      setText("walletAddress", res.data?.address || "\uC0DD\uC131\uB428");
      show("noWallet", false);
      show("walletInfo", true);
      show("metamaskWarning", false);
      btn.style.display = "none";
      alert("\uC218\uD0C1 \uC9C0\uAC11\uC774 \uC0DD\uC131\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    } catch (err) {
      alert("\uC9C0\uAC11 \uC0DD\uC131 \uC2E4\uD328: " + err.message);
      btn.disabled = false;
      btn.textContent = "\uC9C0\uAC11 \uC0DD\uC131";
    }
  };
}

function bindConnectMetaMask(uid) {
  const btn = $("btnConnectMetaMask");
  if (!btn) return;

  // window.ethereum 없음 → 모바일/데스크톱 분기
  if (!window.ethereum) {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      // 모바일: MetaMask 앱 인앱 브라우저로 딥링크 유도
      const deepLink = "https://metamask.app.link/dapp/" +
        location.host + location.pathname + location.search;
      btn.style.display = "";
      btn.textContent = "MetaMask 앱으로 열기";
      btn.onclick = () => { location.href = deepLink; };
    } else {
      // 데스크톱: MetaMask 미설치
      btn.style.display = "";
      btn.textContent = "MetaMask 설치 필요";
      btn.onclick = () => {
        window.open("https://metamask.io/download/", "_blank");
      };
    }
    return;
  }

  // window.ethereum 있음 (MetaMask 인앱 브라우저 or 확장 프로그램)
  btn.style.display = "";
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "연결 중...";
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];

      const msg = `Jump Platform 지갑 연결 확인\nUID: ${uid}`;
      const msgHex = "0x" + Array.from(new TextEncoder().encode(msg))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      await window.ethereum.request({ method: "personal_sign", params: [msgHex, address] });

      await setDoc(doc(db, "users", uid), { wallet: { address, type: "metamask" } }, { merge: true });

      setText("walletAddress", address);
      show("noWallet", false);
      show("walletInfo", true);
      show("btnCreateWallet", false);
      show("btnConnectMetaMask", false);
      loadOnChainData(uid);
    } catch (err) {
      if (err.code === 4001) {
        alert("서명이 취소되었습니다.");
      } else {
        alert("MetaMask 연결 실패: " + err.message);
      }
      btn.disabled = false;
      btn.textContent = "MetaMask 연결";
    }
  };
}

function bindLevelUp(uid) {
  const btn = $("btnLevelUp");
  if (!btn || btn._bound) return;
  btn._bound = true;

  btn.onclick = async () => {
    if (!confirm("\uB808\uBCA8\uC5C5\uC744 \uC9C4\uD589\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?\n\uC870\uAC74 \uCDA9\uC871 \uC2DC \uB808\uBCA8\uC774 \uC0C1\uC2B9\uD569\uB2C8\uB2E4.")) return;

    btn.disabled = true;
    btn.textContent = "\uCC98\uB9AC \uC911...";
    try {
      const fn = httpsCallable(functions, "requestLevelUp");
      const res = await fn();
      alert(`\uB808\uBCA8\uC5C5 \uC644\uB8CC! Lv.${res.data.newLevel}`);
      await loadOnChainData(uid);
    } catch (err) {
      alert("\uB808\uBCA8\uC5C5 \uC2E4\uD328: " + err.message);
      btn.disabled = false;
      btn.textContent = "Level Up";
    }
  };
}

function bindOnChainRegister(uid) {
  const btn = $("btnRegisterOnChain");
  if (!btn) return;

  btn.onclick = async () => {
    const mentorAddress = String($("mentorAddrInput")?.value || "").trim();
    if (!mentorAddress || !/^0x[0-9a-fA-F]{40}$/i.test(mentorAddress)) {
      alert("\uBA58\uD1A0 \uC9C0\uAC11 \uC8FC\uC18C\uB97C \uC62C\uBC14\uB974\uAC8C \uC785\uB825\uD558\uC138\uC694.\n\uC608: 0x\uB85C \uC2DC\uC791\uD558\uB294 42\uC790\uB9AC \uC8FC\uC18C");
      return;
    }

    btn.disabled = true;
    btn.textContent = "\uB4F1\uB85D \uC911...";
    try {
      const registerMember = httpsCallable(functions, "registerMember");
      await registerMember({ mentorAddress });
      show("onChainRegBox", false);
      setText("onChainStatus", "\uB4F1\uB85D \uC644\uB8CC \u2713");
      $("onChainStatus").style.color = "var(--accent)";
      await loadOnChainData(uid);
    } catch (err) {
      alert("\uC628\uCCB4\uC778 \uB4F1\uB85D \uC2E4\uD328: " + err.message);
      btn.disabled = false;
      btn.textContent = "\uB4F1\uB85D";
    }
  };
}

function bindDepositForm() {
  const form = $("depositForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amountKrw = Number($("depositAmount")?.value);
    const depositorName = String($("depositorName")?.value || "").trim();
    const btn = $("btnDeposit");

    if (!amountKrw || amountKrw < 10000) {
      alert("\uC785\uAE08 \uAE08\uC561\uC740 10,000\uC6D0 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.");
      return;
    }
    if (!depositorName) {
      alert("\uC785\uAE08\uC790\uBA85\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "\uC694\uCCAD \uC911...";

    try {
      const requestDeposit = httpsCallable(functions, "requestDeposit");
      const res = await requestDeposit({ amountKrw, depositorName });
      const d = res.data;

      show("depositResult", true);
      setText("drRefCode", d.refCode);
      setText("drBank", d.bankInfo?.bank || "-");
      setText("drAccount", d.bankInfo?.account || "-");
      setText("drHolder", d.bankInfo?.holder || "-");
      setText("drAmount", (d.amountKrw || 0).toLocaleString() + "\uC6D0");

      const drParts = [(d.amountKrw || 0).toLocaleString() + "\uC6D0"];
      if (d.estimatedUsd != null) drParts.push("$" + Number(d.estimatedUsd).toFixed(2));
      if (d.estimatedVnd) drParts.push(d.estimatedVnd);
      setText("drHex", drParts.join(" / "));

      form.reset();

      // 충전 내역 자동 새로고침 + 스크롤
      const currentUid = auth.currentUser?.uid;
      if (currentUid) await loadDepositHistory(currentUid);
      const histEl = $("depositHistory");
      if (histEl) histEl.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      alert("\uCDA9\uC804 \uC694\uCCAD \uC2E4\uD328: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "\uC785\uAE08 \uC694\uCCAD";
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
      alert("\uBA58\uD1A0 \uC774\uBA54\uC77C\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "\uC694\uCCAD \uC911...";
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
      alert("\uBA58\uD1A0 \uC694\uCCAD \uC2E4\uD328: " + err.message);
      btn.disabled = false;
      btn.textContent = "\uBA58\uD1A0 \uC694\uCCAD";
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
      sel.innerHTML = '<option value="">\uACB0\uC81C \uAC00\uB2A5\uD55C \uAC00\uB9F9\uC810\uC774 \uC5C6\uC2B5\uB2C8\uB2E4</option>';
      return;
    }

    sel.innerHTML =
      '<option value="">\uAC00\uB9F9\uC810\uC744 \uC120\uD0DD\uD558\uC138\uC694</option>' +
      list.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  } catch (err) {
    sel.innerHTML = '<option value="">\uAC00\uB9F9\uC810 \uBAA9\uB85D \uC870\uD68C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4</option>';
    console.warn("loadMerchantsForSelect:", err.message);
  }
}

function buildMypageDropHtml(d) {
  const items = [];
  if (d.potionsAdded   > 0) items.push(`<img src="/assets/images/item/hp.png" style="width:24px;height:24px;vertical-align:middle;"> 빨간약 <b>+${d.potionsAdded}</b>`);
  if (d.mpPotionsAdded > 0) items.push(`<img src="/assets/images/item/mp.png" style="width:24px;height:24px;vertical-align:middle;"> 마법약 <b>+${d.mpPotionsAdded}</b>`);
  if (d.reviveAdded    > 0) items.push(`<img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:24px;height:24px;vertical-align:middle;"> 부활권 <b>+${d.reviveAdded}</b>`);
  if (!items.length) return '';
  return `
    <div class="drop-box">
      <div class="drop-box-title">🎁 득템!</div>
      ${items.map(i=>`<div class="drop-item">${i}</div>`).join('')}
    </div>`;
}

function showJackpotResult(d) {
  const modal   = $("jackpotModal");
  if (!modal) return;

  const hasItems = (d.potionsAdded > 0) || (d.mpPotionsAdded > 0) || (d.reviveAdded > 0);
  const jackpotPtsWei = BigInt(d.onchainJackpotPointsWei || '0');
  const hasOnchainJackpot = jackpotPtsWei > 0n;
  if (!d.isJackpot && !hasItems && !hasOnchainJackpot) return;

  const emojiEl = $("jmEmoji");
  const titleEl = $("jmTitle");
  const descEl  = $("jmDesc");
  const itemsEl = $("jmItems");
  const closeBtn = $("jmCloseBtn");

  if (d.isJackpot) {
    if (emojiEl) emojiEl.textContent = "🎉";
    if (titleEl) titleEl.textContent = "JACKPOT!! 🎰";
    if (descEl)  descEl.textContent  = "잭팟 당첨! 아이템을 획득했습니다.";
  } else if (hasOnchainJackpot) {
    if (emojiEl) emojiEl.textContent = "🪙";
    if (titleEl) { titleEl.textContent = "잭팟 포인트 당첨!"; titleEl.style.color = "#fde68a"; }
    const ptsHex = (Number(jackpotPtsWei) / 1e18).toFixed(6);
    if (descEl)  descEl.textContent  = `온체인 복권 당첨! ${ptsHex} HEX 포인트 적립`;
  } else {
    if (emojiEl) emojiEl.textContent = "🎁";
    if (titleEl) { titleEl.textContent = "아이템 획득!"; titleEl.style.color = "#fef08a"; }
    if (descEl)  descEl.textContent  = "결제 보상으로 아이템을 받았습니다.";
  }

  if (itemsEl) {
    const lines = [];
    if (hasOnchainJackpot) {
      const ptsHex = (Number(jackpotPtsWei) / 1e18).toFixed(6);
      lines.push(`<div class="jm-item">🪙 잭팟 포인트 <b>+${ptsHex} HEX</b><br><small style="color:#a3a3a3;font-size:0.75rem;">마이페이지 → 포인트 전환에서 HEX로 교환 가능</small></div>`);
    }
    if (d.potionsAdded   > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/hp.png" style="width:22px;height:22px;"> 빨간약 <b>+${d.potionsAdded}</b></div>`);
    if (d.mpPotionsAdded > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/mp.png" style="width:22px;height:22px;"> 마법약 <b>+${d.mpPotionsAdded}</b></div>`);
    if (d.reviveAdded    > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:22px;height:22px;"> 부활권 <b>+${d.reviveAdded}</b></div>`);
    itemsEl.innerHTML = lines.join('');
    itemsEl.style.display = lines.length ? '' : 'none';
  }

  modal.classList.add("active");

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.remove("active");
  }
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("active"); };
}

function bindMerchantPay(uid, walletAddress) {
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
      const hidden  = $("merchantPayCurrency");
      if (labelEl) labelEl.textContent = isVnd ? "결제 금액 (동 VND) *" : "결제 금액 (원 KRW) *";
      if (inputEl) {
        inputEl.min         = isVnd ? "10000" : "1000";
        inputEl.step        = isVnd ? "1000"  : "100";
        inputEl.placeholder = isVnd ? "예: 200000" : "예: 30000";
        inputEl.value       = "";
      }
      if (hidden) hidden.value = r.value;
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const merchantId = $("merchantPaySelect")?.value;
    const amount     = Number($("merchantPayAmount")?.value);
    const currency   = $("merchantPayCurrency")?.value || "VND";
    const isVnd      = currency === "VND";
    const btn        = $("btnMerchantPay");
    const resultBox  = $("merchantPayResult");

    if (!merchantId) {
      alert("가맹점을 선택해 주세요.");
      return;
    }

    if (isVnd) {
      if (!amount || amount < 10000) { alert("VND 최소 결제 금액은 10,000동입니다."); return; }
    } else {
      if (!amount || amount < 1000)  { alert("KRW 최소 결제 금액은 1,000원입니다."); return; }
    }

    const confirmMsg = isVnd
      ? `${amount.toLocaleString()}동 (VND)을 결제하시겠습니까?`
      : `${amount.toLocaleString()}원 (KRW)을 결제하시겠습니까?`;
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;
    btn.textContent = "결제 중...";
    if (resultBox) resultBox.style.display = "none";

    const payload = isVnd
      ? { merchantId: Number(merchantId), amountVnd: amount, currency: "VND" }
      : { merchantId: Number(merchantId), amountKrw: amount, currency: "KRW" };

    try {
      const payFn = httpsCallable(functions, "payMerchantHex");
      const res = await payFn(payload);
      const d = res.data;

      const amountDisp = isVnd
        ? `${amount.toLocaleString()}동 (${d.amountHex} HEX)`
        : `${amount.toLocaleString()}원 (${d.amountHex} HEX)`;

      if (resultBox) {
        const jackpotPtsWei = BigInt(d.onchainJackpotPointsWei || '0');
        const jackpotLine = jackpotPtsWei > 0n
          ? `<div class="mp-kv"><span class="k">잭팟 포인트</span><span class="v" style="color:#7c3aed;font-weight:700;">🪙 +${(Number(jackpotPtsWei) / 1e18).toFixed(6)} HEX</span></div>`
          : '';

        resultBox.style.display = "";
        resultBox.innerHTML = `
          <div class="mp-kv"><span class="k">가맹점</span><span class="v">${d.merchantName || ""}</span></div>
          <div class="mp-kv"><span class="k">결제 금액</span><span class="v accent">${amountDisp}</span></div>
          ${jackpotLine}
          <div class="mp-kv"><span class="k">트랜잭션</span><span class="v mono" style="font-size:0.8em;">${(d.txHash || "").slice(0, 20)}...</span></div>
          <p class="hint" style="color:var(--accent); margin-top:6px;">결제가 완료되었습니다.</p>
          ${buildMypageDropHtml(d)}
        `;
      }

      form.reset();
      showJackpotResult(d);
      loadTxHistory(uid);
      loadJackpotHistory(uid);
      loadOnChainData(uid);
    } catch (err) {
      alert("\uACB0\uC81C \uC2E4\uD328: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "\uACB0\uC81C";
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
  } catch {}

  try {
    const u = new URL(text);
    return {
      merchantId: String(u.searchParams.get("merchant") || u.searchParams.get("merchantId") || u.searchParams.get("id") || "").trim(),
      merchantName: String(u.searchParams.get("name") || "").trim(),
      amount: Number(u.searchParams.get("amount") || 0) || null,
      currency: String(u.searchParams.get("currency") || "").toUpperCase() || null,
    };
  } catch {}

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
  const sel          = $("merchantPaySelect");
  const amountInput  = $("merchantPayAmount");
  const currencyHidden = $("merchantPayCurrency");
  const radioVnd     = $("merchantPayCurrencyVND");
  const radioKrw     = $("merchantPayCurrencyKRW");

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
    if (labelEl) labelEl.textContent = isVnd ? "결제 금액 (동 VND) *" : "결제 금액 (원 KRW) *";
    if (inputEl) {
      inputEl.min         = isVnd ? "10000" : "1000";
      inputEl.step        = isVnd ? "1000"  : "100";
      inputEl.placeholder = isVnd ? "예: 200000" : "예: 30000";
    }
  }

  // ── 가맹점 매칭 ──
  const mid = String(payload.merchantId || "").trim();
  if (!mid || !sel) {
    showQrResult(`✅ 금액 ${payload.amount ? payload.amount.toLocaleString() : "-"} 반영 완료. 가맹점을 직접 선택해 주세요.`, false);
    sel?.focus();
    return true;
  }

  // 1) 이미 select에 있으면 바로 선택
  const existing = Array.from(sel.options).find(
    (o) => o.value && (String(o.value) === mid || Number(o.value) === Number(mid))
  );
  if (existing) {
    sel.value = existing.value;
    showQrResult(`✅ QR 스캔 완료 — 가맹점: ${existing.textContent}, 금액: ${payload.amount?.toLocaleString() || "-"}`, false);
    sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return true;
  }

  // 2) Firestore에서 직접 조회
  showQrResult("가맹점 정보 조회 중...", false);
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
      showQrResult(`✅ QR 스캔 완료 — 가맹점: ${mName}, 금액: ${payload.amount?.toLocaleString() || "-"}`, false);
      sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return true;
    }
  } catch (e) {
    console.warn("QR merchant fetch failed:", e.message);
    showQrResult("가맹점 조회 실패 — 직접 선택해 주세요.", true);
    return false;
  }

  showQrResult(`가맹점(ID: ${mid})을 찾을 수 없습니다 — 직접 선택해 주세요.`, true);
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
      if (state) state.textContent = "카메라 시작 중...";
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
        if (state) state.textContent = `인식: ${raw.slice(0, 60)} | ID: ${payload?.merchantId || "없음"}`;
        if (payload && (payload.merchantId || payload.amount)) {
          await applyQrResult(payload);
        } else {
          showQrResult(`QR 파싱 실패 — 원본: ${raw.slice(0, 100)}`, true);
        }
        setTimeout(() => stopQrScan(), 800);
      };

      // ── BarcodeDetector (Android Chrome 83+ / 하드웨어 가속) ──
      if ("BarcodeDetector" in window) {
        if (state) state.textContent = "QR 코드를 사각형 안에 맞춰주세요";
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
          } catch {}
          detecting = false;
          __qrRaf = requestAnimationFrame(detectTick);
        };
        __qrRaf = requestAnimationFrame(detectTick);
        return;
      }

      // ── jsQR 폴백 ──
      if (!window.jsQR) {
        if (state) state.textContent = "jsQR 라이브러리 로드 실패 — 페이지를 새로고침 해주세요.";
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
          state.textContent = `스캔 중... (${Math.floor(frameCount / 20)}) QR 코드를 사각형 안에 맞춰주세요`;
        }
        __qrRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      if (state) state.textContent = "카메라 사용 실패";
      stopQrScan();
      alert("카메라 접근 실패: " + (err?.message || err));
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
    bindCreateWallet();
    bindConnectMetaMask(user.uid);
    bindOnChainRegister(user.uid);
    bindLevelUp(user.uid);
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
  } catch (err) {
    console.error("\uB9C8\uC774\uD398\uC774\uC9C0 \uCD08\uAE30\uD654 \uC2E4\uD328", err);
  }
});

// ── 앱 캐시 초기화 ──
(function bindClearCache() {
  const btn = $("btnClearCache");
  const msg = $("clearCacheMsg");
  if (!btn) return;

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "초기화 중...";

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
        msg.textContent = "캐시가 삭제되었습니다. 3초 후 새로고침...";
      }

      setTimeout(() => {
        // 강제 새로고침 (캐시 무시)
        location.href = location.pathname + "?v=" + Date.now();
      }, 3000);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "🔄 앱 캐시 초기화 (문제 발생 시)";
      if (msg) { msg.style.display = ""; msg.textContent = "초기화 실패: " + err.message; }
    }
  };
})();
