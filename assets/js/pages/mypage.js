// /assets/js/pages/mypage.js
// MyPage: profile / wallet / on-chain status / deposit & payment history

import { onAuthReady } from "../auth.js";
import { db, functions } from "/assets/js/firebase-init.js";
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

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
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
      pending: "\uB300\uAE30",
      processing: "\uCC98\uB9AC\uC911",
      approved: "\uC644\uB8CC",
      rejected: "\uBC18\uB824",
    };

    const rows = snap.docs.map((d) => {
      const data = d.data();
      const dateStr = data.requestedAt?.toDate
        ? data.requestedAt.toDate().toLocaleDateString("ko")
        : "-";

      const amountParts = [(data.amountKrw || 0).toLocaleString() + "\uC6D0"];
      if (data.usdAmount != null) amountParts.push("$" + Number(data.usdAmount).toFixed(2));
      if (data.vndAmount != null) amountParts.push(Number(data.vndAmount).toLocaleString() + " VND");
      const amountStr = amountParts.join(" / ");

      return `
        <div class="mp-hist-row">
          <div class="mp-hist-main">
            <span class="mp-hist-code">${data.refCode || "-"}</span>
            <span class="mp-hist-badge ${data.status}">${statusLabel[data.status] || data.status}</span>
          </div>
          <div class="mp-hist-detail">
            <span class="accent">${amountStr}</span>
            <span class="muted">${dateStr}</span>
          </div>
          ${data.txHash ? `<div class="mp-hist-tx mono">${data.txHash.slice(0, 16)}...</div>` : ""}
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
  buy:          { label: "충전",        dir: "income",  icon: "💰" },
  credit:       { label: "포인트 지급", dir: "income",  icon: "⭐" },
  p2p:          { label: "P2P 수령",    dir: "income",  icon: "📥" },
  p2p_merge:    { label: "P2P 합산",    dir: "income",  icon: "📥" },
  withdraw:     { label: "인출",        dir: "expense", icon: "📤" },
  pay_merchant: { label: "가맹점 결제", dir: "expense", icon: "🛒" },
  jackpot_paid: { label: "🎰 잭팟 당첨금", dir: "income",  icon: "🏆" },
  jackpot_requested: { label: "잭팟 인출 신청", dir: "pending", icon: "⏳" },
  jackpot_rejected:  { label: "잭팟 인출 거절", dir: "rejected", icon: "✕" },
};

function txAmountHex(tx) {
  if (tx.amountHex) return Number(tx.amountHex);
  if (tx.amountWei) return Number(formatWei(tx.amountWei));
  if (tx.priceWei)  return Number(formatWei(tx.priceWei));
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
      unified.push({
        sortTs: tx.createdAt?.toDate ? tx.createdAt.toDate().getTime() : 0,
        label: cfg.label,
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

  // ── 잭팟 인출 내역 ──
  if (walletAddress) {
    try {
      const j = await fetchJackpotJson(`/jackpot/my-claims?wallet=${encodeURIComponent(walletAddress)}&limit=50`);
      const claims = Array.isArray(j?.data) ? j.data : [];
      claims.forEach((c) => {
        const isPaid = c.status === "paid";
        const isRejected = c.status === "rejected";
        const typeKey = isPaid ? "jackpot_paid" : isRejected ? "jackpot_rejected" : "jackpot_requested";
        const cfg = TX_CONFIG[typeKey];
        const dateTs = isPaid && c.approvedAt ? new Date(c.approvedAt).getTime() : new Date(c.createdAt).getTime();
        const dateStr = (isPaid && c.approvedAt ? new Date(c.approvedAt) : new Date(c.createdAt)).toLocaleString("ko-KR");
        const weiStr = isPaid ? c.approvedWei : c.requestedWei;
        const hex = weiStr ? Number(BigInt(weiStr || "0")) / 1e18 : 0;
        const badge = isPaid ? { cls: "paid", text: "완료" }
          : isRejected ? { cls: "rejected", text: "거절" }
          : { cls: "requested", text: "대기중" };
        unified.push({
          sortTs: dateTs || 0,
          label: cfg.label,
          icon: cfg.icon,
          dir: cfg.dir,
          amountHex: hex,
          dateStr,
          txHash: c.txHash || null,
          statusBadge: badge,
        });
      });
    } catch (err) {
      console.warn("loadTxHistory jackpot claims:", err.message);
    }
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
  if (!window.ethereum) {
    btn.style.display = "none";
    return;
  }

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "\uC5F0\uACB0 \uC911...";
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];

      const msg = `Jump Platform \uC9C0\uAC11 \uC5F0\uACB0 \uD655\uC778\nUID: ${uid}`;
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
        alert("\uC11C\uBA85\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
      } else {
        alert("MetaMask \uC5F0\uACB0 \uC2E4\uD328: " + err.message);
      }
      btn.disabled = false;
      btn.textContent = "MetaMask \uC5F0\uACB0";
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
      if (m.active !== false && (m.approvedAt || Number(m.feeBps) > 0)) {
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

function bindMerchantPay(uid) {
  const form = $("merchantPayForm");
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const merchantId = $("merchantPaySelect")?.value;
    const amountKrw = Number($("merchantPayAmount")?.value);
    const btn = $("btnMerchantPay");
    const resultBox = $("merchantPayResult");

    if (!merchantId) {
      alert("\uAC00\uB9F9\uC810\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      return;
    }

    if (!amountKrw || amountKrw < 1000) {
      alert("\uACB0\uC81C \uAE08\uC561\uC740 1,000\uC6D0 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.");
      return;
    }

    if (!confirm(`${amountKrw.toLocaleString()}\uC6D0\uC744 \uACB0\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?`)) return;

    btn.disabled = true;
    btn.textContent = "\uACB0\uC81C \uC911...";
    if (resultBox) resultBox.style.display = "none";

    try {
      const payFn = httpsCallable(functions, "payMerchantHex");
      const res = await payFn({ merchantId: Number(merchantId), amountKrw });
      const d = res.data;

      if (resultBox) {
        resultBox.style.display = "";
        resultBox.innerHTML = `
          <div class="mp-kv"><span class="k">\uAC00\uB9F9\uC810</span><span class="v">${d.merchantName || ""}</span></div>
          <div class="mp-kv"><span class="k">\uACB0\uC81C \uAE08\uC561</span><span class="v accent">${amountKrw.toLocaleString()}\uC6D0 (${d.amountHex} HEX)</span></div>
          <div class="mp-kv"><span class="k">\uD2B8\uB79C\uC7AD\uC158</span><span class="v mono" style="font-size:0.8em;">${(d.txHash || "").slice(0, 20)}...</span></div>
          <p class="hint" style="color:var(--accent); margin-top:6px;">\uACB0\uC81C\uAC00 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.</p>
        `;
      }

      form.reset();
      loadTxHistory(uid);
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

function applyQrResult(payload) {
  if (!payload) return false;
  const sel = $("merchantPaySelect");
  const amountInput = $("merchantPayAmount");
  const state = $("qrScanState");
  const currencyHidden = $("merchantPayCurrency");
  const radioVnd = $("merchantPayCurrencyVND");
  const radioKrw = $("merchantPayCurrencyKRW");

  let merchantMatched = !(payload.merchantId || payload.merchantName);

  if ((payload.merchantId || payload.merchantName) && sel) {
    const options = Array.from(sel.options || []).filter((o) => o.value);
    // 1. 정확한 value 일치
    let found = payload.merchantId
      ? options.find((o) => String(o.value) === String(payload.merchantId))
      : null;
    // 2. 이름으로 매칭 (대소문자 무시)
    if (!found && payload.merchantName) {
      const nm = payload.merchantName.toLowerCase();
      found = options.find((o) => o.textContent.trim().toLowerCase() === nm);
    }
    // 3. merchantId를 이름으로 간주해서 매칭
    if (!found && payload.merchantId) {
      const mid = String(payload.merchantId).toLowerCase();
      found = options.find((o) => o.textContent.trim().toLowerCase() === mid);
    }
    // 4. 숫자 변환 후 매칭 (예: "2" vs 2)
    if (!found && payload.merchantId) {
      found = options.find((o) => Number(o.value) === Number(payload.merchantId));
    }

    if (found) {
      sel.value = found.value;
      merchantMatched = true;
    } else {
      const hint = payload.merchantName || payload.merchantId;
      if (state) state.textContent = `가맹점을 찾을 수 없음: "${hint}" — 직접 선택해 주세요.`;
    }
  }

  if (payload.amount && amountInput) {
    amountInput.value = String(Math.round(payload.amount));
  }

  if (payload.currency && currencyHidden) {
    const cur = payload.currency === "KRW" ? "KRW" : "VND";
    currencyHidden.value = cur;
    if (cur === "KRW" && radioKrw) radioKrw.checked = true;
    if (cur === "VND" && radioVnd) radioVnd.checked = true;
  }

  if (merchantMatched) {
    if (state) state.textContent = "스캔 완료: 결제 폼에 반영됐습니다.";
    return true;
  }
  // 금액은 채워졌지만 가맹점 미매칭 — 스캐너는 닫되 경고 유지
  return !!(payload.amount || payload.currency);
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
      if (state) state.textContent = "\uCE74\uBA54\uB77C \uC2DC\uC791 \uC911...";
      overlay.classList.add("active");

      __qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = __qrStream;
      await video.play();

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const tick = () => {
        if (!video.videoWidth || !video.videoHeight) {
          __qrRaf = requestAnimationFrame(tick);
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = window.jsQR ? window.jsQR(imageData.data, imageData.width, imageData.height) : null;

        if (qr?.data) {
          const payload = parseQrPayload(qr.data);
          if (applyQrResult(payload)) {
            stopQrScan();
            return;
          }
          if (state) state.textContent = "\uC54C \uC218 \uC5C6\uB294 QR \uD615\uC2DD\uC785\uB2C8\uB2E4.";
        }
        __qrRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      if (state) state.textContent = "\uCE74\uBA54\uB77C \uC0AC\uC6A9 \uC2E4\uD328";
      stopQrScan();
      alert("\uCE74\uBA54\uB77C \uC811\uADFC \uC2E4\uD328: " + (err?.message || err));
    }
  };
}

let __jpClaimableHex = 0;

function jackpotEndpoints(path) {
  const base = String(window.__jackpotApiBase || "").trim().replace(/\/$/, "");
  if (base) return [`${base}${path}`];
  const host = (location.hostname || "").toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (isLocal) return [`http://${host || "127.0.0.1"}:8787${path}`, path];
  return [path];
}

async function fetchJackpotJson(path, options = {}) {
  let lastErr = null;
  for (const url of jackpotEndpoints(path)) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) {
        const msg = json?.message || json?.error || `HTTP_${res.status}`;
        throw new Error(msg);
      }
      if (!json) throw new Error("INVALID_JSON_RESPONSE");
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("JACKPOT_FETCH_FAILED");
}

function fmtHex(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0 HEX";
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} HEX`;
}

function fmtFiat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const fx = window.__jackpotFx || {};
  const krw = Number(fx.krw) > 0 ? Number(fx.krw) : 1480;
  const vnd = Number(fx.vnd) > 0 ? Number(fx.vnd) : 26000;
  const krwVal = Math.round(n * krw).toLocaleString("ko-KR");
  const vndVal = Math.round(n * vnd).toLocaleString("ko-KR");
  return `\uC57D ${krwVal}\uC6D0 / ${vndVal} VND`;
}

function renderJackpotHistory(items) {
  const wrap = $("jackpotHistoryList");
  if (!wrap) return;
  if (!Array.isArray(items) || items.length === 0) {
    wrap.innerHTML = '<p class="hint">\uC7AD\uD31F \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.</p>';
    return;
  }
  wrap.innerHTML = items.map((it) => {
    const win = Number(it.finalWinHex || 0);
    const created = it.createdAt ? new Date(it.createdAt) : null;
    const dateText = created && !Number.isNaN(created.getTime()) ? created.toLocaleString("ko-KR") : "-";
    return `
      <div class="jp-hist-row ${win > 0 ? "jp-hist-win" : ""}">
        <div class="jp-hist-head">
          <span class="jp-hist-status">${win > 0 ? "\uD83C\uDFC6 \uB2F9\uCCA8" : "\uCC38\uC5EC"}</span>
          <span class="jp-hist-date">${dateText}</span>
        </div>
        <div class="jp-hist-body">
          <span>\uACB0\uC81C: ${Number(it.paymentHex || 0).toLocaleString("ko-KR", { maximumFractionDigits: 4 })} HEX</span>
          <span class="jp-hist-win-amt">${win > 0 ? `+${win.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} HEX \uB2F9\uCCA8!` : "\uBBF8\uB2F9\uCCA8"}</span>
          <span class="jp-hist-rand">RND ${it.randomValue ?? "-"}</span>
        </div>
        <div class="jp-hist-tx">${String(it.txHash || "").slice(0, 18)}...</div>
      </div>
    `;
  }).join("");
}

async function loadJackpotWallet(wallet) {
  if (!wallet) return;
  show("jackpotWalletSection", true);
  show("jackpotHistorySection", true);
  try {
    const b = await fetchJackpotJson(`/jackpot/balance?wallet=${encodeURIComponent(wallet)}`);
    const d = b?.data || {};
    const claimable = Number(d.claimableHex || 0);
    const totalWon = Number(d.totalWonHex || 0);
    const totalClaimed = Number(d.totalClaimedHex || 0);
    __jpClaimableHex = claimable;

    setText("jpClaimableHex", fmtHex(claimable));
    setText("jpClaimableRate", fmtFiat(claimable));
    setText("jpTotalWonHex", fmtHex(totalWon));
    setText("jpTotalWonRate", fmtFiat(totalWon));
    setText("jpTotalClaimedHex", fmtHex(totalClaimed));
    show("jpClaimableRateRow", true);
    show("jpTotalWonRateRow", true);
    show("jpWithdrawBox", true);
  } catch (e) {
    setText("jpClaimableHex", "\uC870\uD68C \uC2E4\uD328");
    console.warn("loadJackpotWallet failed:", e.message);
  }
}

async function loadJackpotHistory(wallet) {
  if (!wallet) return;
  show("jackpotHistorySection", true);
  try {
    const h = await fetchJackpotJson(`/jackpot/history?wallet=${encodeURIComponent(wallet)}&limit=50`);
    const items = Array.isArray(h?.data) ? h.data : [];
    renderJackpotHistory(items);
    const total = items.reduce((s, it) => s + (Number(it.finalWinHex || 0) || 0), 0);
    setText("jpHistoryTotalHex", fmtHex(total));
    setText("jpHistoryTotalRate", fmtFiat(total));
    show("jpHistorySummary", true);
  } catch (e) {
    const wrap = $("jackpotHistoryList");
    if (wrap) wrap.innerHTML = `<p class="hint muted">\uC7AD\uD31F \uB0B4\uC5ED \uC870\uD68C \uC2E4\uD328: ${e.message}</p>`;
  }
}

async function requestJackpotWithdraw(wallet, amountHex) {
  const result = $("jpWithdrawResult");
  if (result) {
    result.style.display = "";
    result.innerHTML = "<p class='hint'>\uC778\uCD9C \uC694\uCCAD \uCC98\uB9AC \uC911...</p>";
  }
  const j = await fetchJackpotJson("/jackpot/withdraw", {
    method: "POST",
    body: JSON.stringify({ wallet, amountHex: String(amountHex) }),
  });
  if (result) {
    const tx = j?.data?.txHash ? String(j.data.txHash).slice(0, 18) + "..." : "-";
    result.innerHTML = `<p class=\"hint\" style=\"color:var(--accent)\">\uC778\uCD9C \uC694\uCCAD \uC644\uB8CC (\uC0C1\uD0DC: ${j?.data?.status || "-"}, TX: ${tx})</p>`;
  }
  await loadJackpotWallet(wallet);
  await loadJackpotHistory(wallet);
}

function bindJackpotActions(wallet) {
  const btnRefresh = $("btnRefreshJackpotWallet");
  if (btnRefresh) btnRefresh.onclick = () => loadJackpotWallet(wallet);

  const btnWithdraw = $("btnJackpotWithdraw");
  if (btnWithdraw) {
    btnWithdraw.onclick = async () => {
      const val = String($("jpWithdrawAmount")?.value || "").trim();
      const amount = val ? Number(val) : __jpClaimableHex;
      if (!amount || amount <= 0) {
        alert("\uC778\uCD9C \uAC00\uB2A5 \uC794\uC561\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
        return;
      }
      try {
        await requestJackpotWithdraw(wallet, amount);
      } catch (e) {
        const result = $("jpWithdrawResult");
        if (result) {
          result.style.display = "";
          result.innerHTML = `<p class=\"hint muted\">\uC778\uCD9C \uC2E0\uCCAD \uC2E4\uD328: ${e.message}</p>`;
        }
      }
    };
  }

  const btnConvert = $("btnJackpotConvertInHistory");
  if (btnConvert) {
    btnConvert.onclick = async () => {
      if (!__jpClaimableHex || __jpClaimableHex <= 0) {
        alert("\uC778\uCD9C \uAC00\uB2A5 \uC794\uC561\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
        return;
      }
      try {
        await requestJackpotWithdraw(wallet, __jpClaimableHex);
      } catch (e) {
        alert("HEX \uC804\uD658 \uC2E4\uD328: " + e.message);
      }
    };
  }
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

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    if (!data.name) {
      show("noProfilePanel", true);
      return;
    }

    renderProfile(data, user);
    renderWallet(data);
    bindCreateWallet();
    bindConnectMetaMask(user.uid);
    bindOnChainRegister(user.uid);
    bindLevelUp(user.uid);
    bindMentorRequest(user.uid);
    bindDepositForm();
    loadMerchantsForSelect();
    bindMerchantPay(user.uid);
    bindQrScan();

    loadOnChainData(user.uid);
    loadDepositHistory(user.uid);
    loadMentees();

    const walletAddress = data?.wallet?.address ? String(data.wallet.address) : '';
    loadTxHistory(user.uid, walletAddress);

    if (walletAddress) {
      bindJackpotActions(walletAddress);
      loadJackpotWallet(walletAddress);
      loadJackpotHistory(walletAddress);
    }

    const btnRefresh = $("btnRefreshDeposits");
    if (btnRefresh) btnRefresh.onclick = () => loadDepositHistory(user.uid);

    const btnRefreshTx = $("btnRefreshTx");
    if (btnRefreshTx) btnRefreshTx.onclick = () => loadTxHistory(user.uid, walletAddress);

    const btnRefreshMentees = $("btnRefreshMentees");
    if (btnRefreshMentees) btnRefreshMentees.onclick = () => loadMentees();
  } catch (err) {
    console.error("\uB9C8\uC774\uD398\uC774\uC9C0 \uCD08\uAE30\uD654 \uC2E4\uD328", err);
  }
});
