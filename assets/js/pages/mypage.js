// /assets/js/pages/mypage.js
// 마이페이지: 기본 정보 / 수탁 지갑 / 포인트 충전 / 내역 조회

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

// ── 기본 정보 표시 ────────────────────────────────
function renderProfile(userData, fireUser) {
  setText("infoName",  userData?.name  || "-");
  setText("infoEmail", fireUser?.email || userData?.email || "-");
  setText("infoPhone", userData?.phone || "-");
}

// ── 수탁 지갑 표시 ───────────────────────────────
function renderWallet(userData) {
  const addr       = userData?.wallet?.address;
  const isMetaMask = userData?.wallet?.type === "metamask" || (addr && !userData?.wallet?.encryptedKey);

  if (!addr) {
    show("noWallet", true);
    show("walletInfo", false);
    show("btnCreateWallet", true);
    show("btnConnectMetaMask", false);   // MetaMask 연결은 수탁 지갑 생성 전 차단
    setText("onChainStatus", "-");
    return;
  }

  show("noWallet", false);
  show("walletInfo", true);
  show("btnConnectMetaMask", false);
  show("metamaskWarning", isMetaMask);  // 개인지갑 경고 배너
  show("btnCreateWallet", isMetaMask);  // 수탁 지갑으로 전환 버튼
  if (!isMetaMask) show("btnCreateWallet", false);
  setText("walletAddress", addr);

  // 지갑 주소 복사 버튼
  const btnCopy = $("btnCopyWallet");
  if (btnCopy) {
    btnCopy.style.display = "";
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(addr).then(() => {
        btnCopy.textContent = "✓ 복사됨";
        setTimeout(() => { btnCopy.textContent = "📋 복사"; }, 2000);
      }).catch(() => {
        // clipboard API 미지원 fallback
        const ta = document.createElement("textarea");
        ta.value = addr;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        btnCopy.textContent = "✓ 복사됨";
        setTimeout(() => { btnCopy.textContent = "📋 복사"; }, 2000);
      });
    };
  }
}

// ── 온체인 데이터 조회 + 표시 ────────────────────
async function loadOnChainData(uid) {
  const addr = (await getDoc(doc(db, "users", uid))).data()?.wallet?.address;
  if (!addr) return;

  setText("onChainStatus", "조회 중...");

  try {
    const getMyOnChain = httpsCallable(functions, "getMyOnChain");
    const res = await getMyOnChain();
    const d = res.data;

    if (d.level > 0) {
      setText("onChainStatus", "등록 완료 ✓");
      $("onChainStatus").style.color = "var(--accent)";

      show("levelRow", true);
      show("pointRow", true);

      // KRW / USD / VND 동시 표시
      const fmtBalance = (krw, usd, vnd, hex) => {
        if (krw == null) return (hex || "0") + " HEX";
        const parts = [krw.toLocaleString() + "원"];
        if (usd != null) parts.push("$" + usd.toFixed(2));
        if (vnd != null) parts.push(vnd.toLocaleString() + " VND");
        return parts.join(" / ");
      };

      setText("levelDisplay", "Lv." + d.level);
      setText("pointDisplay", fmtBalance(d.pointKrw, d.pointUsd, d.pointVnd, d.pointDisplay));

      // EXP 및 진행바
      show("expRow",    true);
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
          ? `다음 레벨까지 ${remain.toLocaleString()} EXP 필요`
          : "레벨업 가능!";
      }

      // 레벨업 버튼
      show("levelUpRow", d.exp >= d.requiredExp);

      // 멘토 주소
      const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
      const isZeroMentor = !d.mentor || d.mentor === ZERO_ADDR;
      show("mentorAddrRow", true);

      let mentorText = "미연결 (기본 멘토)";
      if (!isZeroMentor) {
        try {
          const mentorSnap = await getDocs(
            query(collection(db, "mentors"), where("address", "==", d.mentor), limit(1))
          );
          mentorText = !mentorSnap.empty
            ? (mentorSnap.docs[0].data()?.email || d.mentor)
            : d.mentor.slice(0, 6) + "…" + d.mentor.slice(-4);
        } catch (_) {
          mentorText = d.mentor.slice(0, 6) + "…" + d.mentor.slice(-4);
        }
      }
      const mentorEl = $("mentorAddrDisplay");
      if (mentorEl) {
        mentorEl.textContent = mentorText;
        const isEmail = mentorText.includes("@");
        mentorEl.classList.toggle("mono", !isEmail);
        mentorEl.style.fontSize = isEmail ? "0.95em" : "0.78em";
      }
      // 기본 멘토면 배너 + 등록 요청 폼 표시
      show("mentorNotice", isZeroMentor);
      show("mentorRequestBox", isZeroMentor);

      // 보유 HEX (수탁 지갑 실제 잔액 — 충전 후 가맹점 결제에 사용)
      const walletHexBig = BigInt(d.walletHexWei || "0");
      show("walletHexRow", walletHexBig > 0n);
      if (walletHexBig > 0n) {
        setText("walletHexDisplay", fmtBalance(d.walletHexKrw, d.walletHexUsd, d.walletHexVnd, d.walletHexDisplay));
      }

      // 보유 JUMP 토큰 (getJumpBankStatus에서 jumpBalance 조회)
      try {
        const getJumpStatus = httpsCallable(functions, "getJumpBankStatus");
        const jr = await getJumpStatus();
        const jumpRaw   = BigInt(jr.data?.jumpBalance || "0");
        const stakedRaw = BigInt(jr.data?.staked      || "0");
        if (jumpRaw > 0n) {
          setText("walletJumpDisplay", Number(jumpRaw).toLocaleString("ko-KR") + " JUMP");
          show("walletJumpRow", true);
        }
        if (stakedRaw > 0n) {
          setText("walletJumpStakedDisplay", Number(stakedRaw).toLocaleString("ko-KR") + " JUMP");
          show("walletJumpStakedRow", true);
        }
      } catch (_) { /* JUMP 조회 실패 시 숨김 유지 */ }

      // 레벨 4 이상 → 개인 지갑 이체 섹션 표시
      if (d.level >= 4) {
        show("hexTransferSection", true);
        const hexDisplay = d.walletHexDisplay || (Number(walletHexBig) / 1e18).toFixed(4) + " HEX";
        setText("hexTransferBalance", hexDisplay);
      } else {
        show("hexTransferSection", false);
      }

      show("onChainRegBox", false);
    } else {
      setText("onChainStatus", "미등록");
      $("onChainStatus").style.color = "var(--muted)";
      show("onChainRegBox", true);
    }
  } catch (err) {
    // Functions 미배포 / 호출 실패 → Firestore 캐시 폴백
    console.warn("getMyOnChain 실패 (Functions 미배포?):", err.message);
    try {
      const cached = (await getDoc(doc(db, "users", uid))).data()?.onChain;
      if (cached?.registered) {
        setText("onChainStatus", "등록 완료 ✓");
        $("onChainStatus").style.color = "var(--accent)";
        show("onChainRegBox", false);
      } else {
        setText("onChainStatus", "미등록");
        $("onChainStatus").style.color = "var(--muted)";
        show("onChainRegBox", true);
      }
    } catch {
      setText("onChainStatus", "조회 실패");
      $("onChainStatus").style.color = "var(--muted)";
    }
  }
}

// ── 충전 내역 ─────────────────────────────────────
async function loadDepositHistory(uid) {
  const wrap = $("depositHistory");
  if (!wrap) return;

  try {
    // Cloud Function 대신 Firestore 직접 조회 (CORS 우회)
    const q = query(
      collection(db, "deposits"),
      where("uid", "==", uid),
      orderBy("requestedAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      wrap.innerHTML = '<p class="hint">충전 내역이 없습니다.</p>';
      return;
    }

    const statusLabel = { pending: "대기", processing: "처리중", approved: "완료", rejected: "반려" };
    const rows = snap.docs.map((d) => {
      const data = d.data();
      const dateStr = data.requestedAt?.toDate
        ? data.requestedAt.toDate().toLocaleDateString("ko")
        : "-";

      // KRW / USD / VND 동시 표시
      const amountParts = [(data.amountKrw || 0).toLocaleString() + "원"];
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
          ${data.txHash ? `<div class="mp-hist-tx mono">${data.txHash.slice(0, 16)}…</div>` : ""}
        </div>
      `;
    }).join("");

    wrap.innerHTML = rows;
  } catch (err) {
    wrap.innerHTML = '<p class="hint muted">내역을 불러올 수 없습니다.</p>';
    console.warn("depositHistory 실패:", err.message);
  }
}

// ── 나의 멘티 목록 ────────────────────────────────
async function loadMentees() {
  const section = $("menteeSection");
  const wrap    = $("menteeList");
  if (!section || !wrap) return;

  try {
    const fn  = httpsCallable(functions, "getMyMentees");
    const res = await fn();
    const { mentees } = res.data;

    show("menteeSection", true);

    if (!mentees || mentees.length === 0) {
      wrap.innerHTML = '<p class="hint">아직 멘티가 없습니다.</p>';
      return;
    }

    const rows = mentees.map((m) => {
      const addrShort = m.address
        ? m.address.slice(0, 6) + "…" + m.address.slice(-4)
        : "-";
      const dateStr = m.registeredAt
        ? new Date(m.registeredAt).toLocaleDateString("ko")
        : "-";
      return `
        <div class="mp-hist-row">
          <div class="mp-hist-main">
            <span style="font-weight:600;">${m.name}</span>
            <span class="mono muted" style="font-size:0.82em;">${addrShort}</span>
          </div>
          <div class="mp-hist-detail">
            <span class="muted" style="font-size:0.85em;">가입일: ${dateStr}</span>
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `<p class="hint muted" style="margin-bottom:8px;">총 ${mentees.length}명</p>` + rows;
  } catch (err) {
    show("menteeSection", true);
    wrap.innerHTML = '<p class="hint muted">멘티 목록을 불러올 수 없습니다.</p>';
    console.warn("getMyMentees 실패:", err.message);
  }
}

// ── 거래 내역 (Firestore 직접 쿼리 + 가맹점 수입 합산) ──
async function loadTxHistory(uid) {
  try {
    // 1) 내 발신 트랜잭션 + 2) 판매 수입(orders) + 3) 내 가맹점 수수료 조회 — 병렬
    const userSnap = await getDoc(doc(db, "users", uid));
    const merchantId = userSnap.data()?.merchantId ?? null;

    const [txSnap, orderSnap, merchantSnap] = await Promise.all([
      getDocs(query(
        collection(db, "transactions"),
        where("uid", "==", uid),
        orderBy("createdAt", "desc"),
        limit(30)
      )),
      // orderBy 제거 → 복합 인덱스 불필요, 클라이언트 정렬로 대체
      getDocs(query(
        collection(db, "orders"),
        where("ownerUid", "==", uid),
        limit(50)
      )).catch(() => ({ docs: [] })),
      merchantId != null
        ? getDoc(doc(db, "merchants", String(merchantId))).catch(() => null)
        : Promise.resolve(null),
    ]);

    // 가맹점 수수료율 (feeBps: 3000 = 30%)
    const feeBps = merchantSnap?.data?.()?.feeBps ?? 0;

    // 두 결과 합산
    const entries = [];
    txSnap.docs.forEach((d) => {
      const tx = d.data();
      entries.push({ kind: "tx", data: tx, date: tx.createdAt?.toDate?.() ?? null });
    });
    orderSnap.docs.forEach((d) => {
      const o = d.data();
      if (o.hexAmountWei && o.status === "confirmed") {
        entries.push({ kind: "income", data: o, date: o.paidAt?.toDate?.() ?? o.createdAt?.toDate?.() ?? null });
      }
    });

    if (!entries.length) return;
    entries.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

    show("txSection", true);
    const wrap = $("txHistory");

    const DEBIT  = new Set(["buy", "pay_merchant", "pay_product", "buyJump", "stakeJump", "hex_transfer"]);
    const CREDIT = new Set(["credit", "p2p", "p2p_merge", "withdraw", "sellJump", "claimDividend", "unstakeJump", "merchant_income"]);

    const TYPE_LABEL = {
      buy:           "상품 구매",
      withdraw:      "HEX 인출",
      credit:        "HEX 충전",
      p2p:           "P2P 수령",
      p2p_merge:     "P2P 합산",
      pay_merchant:  "가맹점 결제",
      pay_product:   "상품 결제",
      buyJump:       "JUMP 매수",
      sellJump:      "JUMP 매도",
      stakeJump:       "JUMP 스테이킹",
      unstakeJump:     "JUMP 언스테이킹",
      claimDividend:   "배당 수령",
      merchant_income: "가맹점 수입",
      hex_transfer:    "HEX 외부이체",
    };

    // ── 합계 집계 ──
    let totalIn  = 0;
    let totalOut = 0;

    // 각 entry의 HEX 순 금액 계산 (합계용)
    function entryNetHex(entry) {
      if (entry.kind === "income") {
        const gross = Number(BigInt(entry.data.hexAmountWei)) / 1e18;
        return gross * (1 - feeBps / 10000);
      }
      const tx  = entry.data;
      // merchant_income: netAmountWei = 수수료 공제 후 순 수입
      if (tx.type === "merchant_income" && tx.netAmountWei) {
        return Number(BigInt(tx.netAmountWei)) / 1e18;
      }
      const hex = tx.amountHex
        || (tx.amountWei ? formatWei(tx.amountWei) : null)
        || (tx.hexCost   ? formatWei(tx.hexCost)   : null)
        || (tx.hexAmount ? formatWei(tx.hexAmount)  : null)
        || "0";
      return parseFloat(hex) || 0;
    }

    entries.forEach((e) => {
      const n = entryNetHex(e);
      if (e.kind === "income" || CREDIT.has(e.data?.type)) totalIn  += n;
      else if (DEBIT.has(e.data?.type))                    totalOut += n;
    });

    const net    = totalIn - totalOut;
    const netColor = net >= 0 ? "#16a34a" : "#dc2626";
    const netSign  = net >= 0 ? "+" : "";

    const summaryHtml = `
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;
                  background:var(--surface2,#f9f5ff); border-radius:10px;
                  padding:12px 14px; margin-bottom:14px; font-size:0.88em;">
        <div style="text-align:center;">
          <div class="muted" style="font-size:0.82em; margin-bottom:2px;">총 수입</div>
          <div style="color:#16a34a; font-weight:700;">+${totalIn.toFixed(4)}<br><small>HEX</small></div>
        </div>
        <div style="text-align:center; border-left:1px solid var(--border,#e5e7eb); border-right:1px solid var(--border,#e5e7eb);">
          <div class="muted" style="font-size:0.82em; margin-bottom:2px;">총 지출</div>
          <div style="color:#dc2626; font-weight:700;">−${totalOut.toFixed(4)}<br><small>HEX</small></div>
        </div>
        <div style="text-align:center;">
          <div class="muted" style="font-size:0.82em; margin-bottom:2px;">순 변동</div>
          <div style="color:${netColor}; font-weight:700;">${netSign}${net.toFixed(4)}<br><small>HEX</small></div>
        </div>
      </div>
    `;

    // ── 행 렌더링 ──
    const rows = entries.map((entry) => {
      const dateStr = entry.date
        ? entry.date.toLocaleDateString("ko", { year: "numeric", month: "2-digit", day: "2-digit" })
        : "-";

      // ── 판매 수입 (가맹점으로 받은 결제, 수수료 공제 후 순 금액 표시) ──
      if (entry.kind === "income") {
        const o        = entry.data;
        const hexWei   = BigInt(o.hexAmountWei);
        const feeWei   = (hexWei * BigInt(feeBps)) / 10000n;
        const netWei   = hexWei - feeWei;
        const netHex   = (Number(netWei)  / 1e18).toFixed(4);
        const grossHex = (Number(hexWei)  / 1e18).toFixed(4);
        const feeHex   = (Number(feeWei)  / 1e18).toFixed(4);
        const krwStr   = o.amount ? `${o.amount.toLocaleString()} ${o.currency || "KRW"}` : "";
        const txShort  = o.txHash ? o.txHash.slice(0, 16) + "…" : "-";
        return `
          <div class="mp-hist-row">
            <div class="mp-hist-main">
              <span class="mp-hist-badge" style="background:#dcfce7; color:#15803d;">판매 수입</span>
              <span class="mono">${txShort}</span>
            </div>
            <div class="mp-hist-detail">
              <span style="color:#16a34a; font-weight:700; font-size:1.05em;">+${netHex} HEX</span>
              <span class="muted" style="font-size:0.79em;">
                총 ${grossHex} HEX − 수수료 ${(feeBps / 100).toFixed(0)}%(${feeHex} HEX)
              </span>
              ${krwStr ? `<span class="muted" style="font-size:0.82em;">${krwStr} 결제분</span>` : ""}
              <span class="muted">${dateStr}</span>
            </div>
          </div>
        `;
      }

      // ── 가맹점 수입 (payMerchantHexOnChain 수신) ──
      if (entry.data?.type === "merchant_income") {
        const tx       = entry.data;
        const grossWei = BigInt(tx.amountWei    || "0");
        const feeWeiB  = BigInt(tx.feeWei       || "0");
        const netWeiB  = BigInt(tx.netAmountWei || "0");
        const netHex   = (Number(netWeiB)  / 1e18).toFixed(4);
        const grossHex = (Number(grossWei) / 1e18).toFixed(4);
        const feeHex   = (Number(feeWeiB)  / 1e18).toFixed(4);
        const feePct   = tx.feeBps != null ? (tx.feeBps / 100).toFixed(0) : "?";
        const krwStr   = tx.amountKrw ? `${tx.amountKrw.toLocaleString()}원` : "";
        const txShort  = tx.txHash ? tx.txHash.slice(0, 16) + "…" : "-";
        return `
          <div class="mp-hist-row">
            <div class="mp-hist-main">
              <span class="mp-hist-badge" style="background:#dcfce7; color:#15803d;">가맹점 수입</span>
              <span class="mono">${txShort}</span>
            </div>
            <div class="mp-hist-detail">
              <span style="color:#16a34a; font-weight:700; font-size:1.05em;">+${netHex} HEX</span>
              <span class="muted" style="font-size:0.79em;">
                총 ${grossHex} HEX − 수수료 ${feePct}%(${feeHex} HEX)
              </span>
              ${krwStr ? `<span class="muted" style="font-size:0.82em;">${krwStr} 결제분</span>` : ""}
              <span class="muted">${dateStr}</span>
            </div>
          </div>
        `;
      }

      // ── 일반 트랜잭션 ──
      const tx      = entry.data;
      const label   = TYPE_LABEL[tx.type] || tx.type;
      const isDebit = DEBIT.has(tx.type);
      const isCred  = CREDIT.has(tx.type);

      const hex = tx.amountHex
        || (tx.amountWei ? formatWei(tx.amountWei) : null)
        || (tx.priceWei  ? formatWei(tx.priceWei)  : null)
        || (tx.hexCost   ? formatWei(tx.hexCost)   : null)   // buyJump
        || (tx.hexAmount ? formatWei(tx.hexAmount)  : null);  // claimDividend

      const amtHtml = hex
        ? isDebit
          ? `<span style="color:#dc2626; font-weight:700; font-size:1.05em;">−${hex} HEX</span>`
          : isCred
            ? `<span style="color:#16a34a; font-weight:700; font-size:1.05em;">+${hex} HEX</span>`
            : `<span style="font-weight:600;">${hex} HEX</span>`
        : "";

      const jumpHtml = tx.jumpAmount
        ? `<span class="muted" style="font-size:0.82em;">JUMP ${
            tx.type === "buyJump" ? "+" : tx.type === "sellJump" ? "−" : ""
          }${tx.jumpAmount}</span>`
        : "";

      const krwHtml = tx.amountKrw != null
        ? `<span class="muted" style="font-size:0.82em;">${tx.amountKrw.toLocaleString()}원</span>`
        : "";
      const txShort = tx.txHash ? tx.txHash.slice(0, 16) + "…" : "-";

      return `
        <div class="mp-hist-row">
          <div class="mp-hist-main">
            <span class="mp-hist-badge ${tx.type}">${label}</span>
            <span class="mono">${txShort}</span>
          </div>
          <div class="mp-hist-detail">
            ${amtHtml}
            ${jumpHtml}
            ${krwHtml}
            ${tx.fromAddress ? `<span class="muted" style="font-size:0.82em;">from: ${tx.fromAddress.slice(0, 8)}…</span>` : ""}
            <span class="muted">${dateStr}</span>
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = summaryHtml + (rows || '<p class="hint">거래 내역이 없습니다.</p>');
  } catch (err) {
    console.warn("거래 내역 조회 실패:", err.message);
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

// ── 지갑 생성 버튼 ────────────────────────────────
function bindCreateWallet() {
  const btn = $("btnCreateWallet");
  if (!btn) return;
  btn.onclick = async () => {
    const mentorAddress = String($("createWalletMentorAddr")?.value || "").trim();
    if (!mentorAddress || !/^0x[0-9a-fA-F]{40}$/i.test(mentorAddress)) {
      alert("멘토 지갑 주소를 올바르게 입력하세요.\n예) 0x로 시작하는 42자리 주소");
      return;
    }
    btn.disabled = true;
    btn.textContent = "생성 중...";
    try {
      const createWalletFn = httpsCallable(functions, "createWallet");
      const res = await createWalletFn({ mentorAddress });
      setText("walletAddress", res.data?.address || "생성됨");
      show("noWallet", false);
      show("walletInfo", true);
      show("metamaskWarning", false);
      btn.style.display = "none";
      alert("수탁 지갑이 생성됐습니다.");
    } catch (err) {
      alert("지갑 생성 실패: " + err.message);
      btn.disabled = false;
      btn.textContent = "지갑 생성";
    }
  };
}

// ── MetaMask 직접 연결 ────────────────────────────
function bindConnectMetaMask(uid) {
  const btn = $("btnConnectMetaMask");
  if (!btn) return;
  if (!window.ethereum) { btn.style.display = "none"; return; }

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "연결 중...";
    try {
      // 1) MetaMask 계정 요청
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];

      // 2) 소유권 증명 서명
      const msg = `Jump Platform 지갑 연결\nUID: ${uid}`;
      const msgHex = "0x" + Array.from(new TextEncoder().encode(msg))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      await window.ethereum.request({ method: "personal_sign", params: [msgHex, address] });

      // 3) Firestore 저장 (merge 방식으로 기존 데이터 유지)
      await setDoc(doc(db, "users", uid), { wallet: { address, type: "metamask" } }, { merge: true });

      // 4) UI 업데이트
      setText("walletAddress", address);
      show("noWallet", false);
      show("walletInfo", true);
      show("btnCreateWallet", false);
      show("btnConnectMetaMask", false);
      loadOnChainData(uid);
    } catch (err) {
      if (err.code === 4001) {
        alert("서명을 취소했습니다.");
      } else {
        alert("MetaMask 연결 실패: " + err.message);
      }
      btn.disabled = false;
      btn.textContent = "MetaMask 연결";
    }
  };
}

// ── 레벨업 버튼 ──────────────────────────────────
function bindLevelUp(uid) {
  const btn = $("btnLevelUp");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.onclick = async () => {
    if (!confirm("레벨업을 진행하시겠습니까?\n레벨업에 사용된 EXP는 차감됩니다.")) return;
    btn.disabled = true;
    btn.textContent = "처리 중...";
    try {
      const fn = httpsCallable(functions, "requestLevelUp");
      const res = await fn();
      alert(`레벨업 완료! Lv.${res.data.newLevel} 달성!`);
      await loadOnChainData(uid);
    } catch (err) {
      alert("레벨업 실패: " + err.message);
      btn.disabled = false;
      btn.textContent = "레벨업 가능! →";
    }
  };
}

// ── 온체인 등록 버튼 ──────────────────────────────
function bindOnChainRegister(uid) {
  const btn = $("btnRegisterOnChain");
  if (!btn) return;
  btn.onclick = async () => {
    const mentorAddress = String($("mentorAddrInput")?.value || "").trim();
    if (!mentorAddress || !/^0x[0-9a-fA-F]{40}$/i.test(mentorAddress)) {
      alert("멘토 지갑 주소를 올바르게 입력하세요.\n예) 0x로 시작하는 42자리 주소");
      return;
    }
    btn.disabled = true;
    btn.textContent = "등록 중...";
    try {
      const registerMember = httpsCallable(functions, "registerMember");
      await registerMember({ mentorAddress });
      show("onChainRegBox", false);
      setText("onChainStatus", "등록 완료 ✓");
      $("onChainStatus").style.color = "var(--accent)";
      await loadOnChainData(uid);
    } catch (err) {
      alert("온체인 등록 실패: " + err.message);
      btn.disabled = false;
      btn.textContent = "온체인 등록";
    }
  };
}

// ── 충전 요청 폼 ──────────────────────────────────
function bindDepositForm() {
  const form = $("depositForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amountKrw    = Number($("depositAmount")?.value);
    const depositorName = String($("depositorName")?.value || "").trim();
    const btn = $("btnDeposit");

    if (!amountKrw || amountKrw < 10000) {
      alert("최소 10,000원 이상 입력해 주세요.");
      return;
    }
    if (!depositorName) {
      alert("입금자명을 입력해 주세요.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "요청 중...";

    try {
      const requestDeposit = httpsCallable(functions, "requestDeposit");
      const res = await requestDeposit({ amountKrw, depositorName });
      const d = res.data;

      // 결과 표시
      show("depositResult", true);
      setText("drRefCode",  d.refCode);
      setText("drBank",     d.bankInfo?.bank    || "-");
      setText("drAccount",  d.bankInfo?.account || "-");
      setText("drHolder",   d.bankInfo?.holder  || "-");
      setText("drAmount",   (d.amountKrw || 0).toLocaleString() + "원");
      // KRW / USD / VND 동시 표시
      const drParts = [(d.amountKrw || 0).toLocaleString() + "원"];
      if (d.estimatedUsd != null) drParts.push("$" + Number(d.estimatedUsd).toFixed(2));
      if (d.estimatedVnd)         drParts.push(d.estimatedVnd);
      setText("drHex", drParts.join(" / "));

      // 폼 초기화
      form.reset();
    } catch (err) {
      alert("충전 요청 실패: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "충전 요청";
    }
  });
}

// ── 멘토 등록 요청 버튼 ───────────────────────────
function bindMentorRequest(uid) {
  const btn = $("btnMentorRequest");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.onclick = async () => {
    const email = String($("mentorReqEmail")?.value || "").trim().toLowerCase();
    if (!email) { alert("멘토 이메일을 입력해주세요."); return; }
    btn.disabled = true;
    btn.textContent = "요청 중...";
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
      alert("요청 실패: " + err.message);
      btn.disabled = false;
      btn.textContent = "멘토 등록 요청";
    }
  };
}

// ── 가맹점 목록 (select 용) ────────────────────────
async function loadMerchantsForSelect() {
  const sel = $("merchantPaySelect");
  if (!sel) return;
  try {
    const snap = await getDocs(collection(db, "merchants"));
    const list = [];
    snap.forEach((d) => {
      const m = d.data() || {};
      // 승인된(active) 가맹점만 포함
      if (m.active !== false && (m.approvedAt || Number(m.feeBps) > 0)) {
        list.push({ id: d.id, name: m.name || d.id });
      }
    });
    if (!list.length) {
      sel.innerHTML = '<option value="">등록된 가맹점이 없습니다</option>';
      return;
    }
    sel.innerHTML =
      '<option value="">가맹점을 선택하세요</option>' +
      list.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  } catch (err) {
    sel.innerHTML = '<option value="">가맹점 목록 로드 실패</option>';
    console.warn("loadMerchantsForSelect:", err.message);
  }
}

// ── HEX 개인 지갑 이체 폼 (레벨 4+) ───────────────
function bindHexTransfer(uid) {
  const form = $("hexTransferForm");
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const toAddress = ($("hexTransferTo")?.value || "").trim();
    const amountVal = ($("hexTransferAmount")?.value || "").trim();
    const btn       = $("btnHexTransfer");
    const resultBox = $("hexTransferResult");

    if (!toAddress) { alert("수령 지갑 주소를 입력해 주세요."); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
      alert("올바른 지갑 주소 형식이 아닙니다. (0x로 시작하는 42자리)");
      return;
    }

    // amountWei 계산: 입력값이 있으면 HEX → wei 변환, 없으면 "all"
    let amountWei = "all";
    if (amountVal) {
      const hexNum = parseFloat(amountVal);
      if (isNaN(hexNum) || hexNum <= 0) { alert("이체 수량이 올바르지 않습니다."); return; }
      amountWei = BigInt(Math.floor(hexNum * 1e18)).toString();
    }

    const confirmed = confirm(
      `${toAddress.slice(0,6)}…${toAddress.slice(-4)} 주소로\n` +
      `${amountWei === "all" ? "전액" : amountVal + " HEX"} 이체하시겠습니까?\n\n` +
      `⚠️ 이체 후 취소 불가합니다.`
    );
    if (!confirmed) return;

    if (btn) { btn.disabled = true; btn.textContent = "이체 중..."; }
    if (resultBox) resultBox.style.display = "none";

    try {
      const fn = httpsCallable(functions, "transferHexToPersonal");
      const res = await fn({ toAddress, amountWei });
      const d = res.data;
      if (resultBox) {
        resultBox.style.display = "";
        resultBox.innerHTML = `
          <div class="mp-kv"><span class="k">상태</span><span class="v" style="color:#16a34a; font-weight:700;">✓ 이체 완료</span></div>
          <div class="mp-kv"><span class="k">이체 금액</span><span class="v accent">${d.amountHex} HEX</span></div>
          <div class="mp-kv"><span class="k">수령 주소</span><span class="v mono" style="font-size:0.82em; word-break:break-all;">${d.toAddress}</span></div>
          <div class="mp-kv"><span class="k">TX Hash</span><span class="v mono" style="font-size:0.82em;">${d.txHash.slice(0, 20)}…</span></div>
        `;
      }
      form.reset();
      loadOnChainData(uid);
      loadTxHistory(uid);
    } catch (err) {
      alert("이체 실패: " + (err.message || "서버 오류"));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "이체"; }
    }
  });
}

// ── 가맹점 직접 결제 폼 ────────────────────────────
function bindMerchantPay(uid) {
  const form = $("merchantPayForm");
  if (!form || form._bound) return;
  form._bound = true;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const merchantId = $("merchantPaySelect")?.value;
    const amountKrw  = Number($("merchantPayAmount")?.value);
    const btn        = $("btnMerchantPay");
    const resultBox  = $("merchantPayResult");

    if (!merchantId) { alert("가맹점을 선택해 주세요."); return; }
    if (!amountKrw || amountKrw < 1000) { alert("최소 1,000원 이상 입력해 주세요."); return; }
    if (!confirm(`${amountKrw.toLocaleString()}원을 결제하시겠습니까?`)) return;

    btn.disabled     = true;
    btn.textContent  = "결제 중...";
    if (resultBox) resultBox.style.display = "none";

    try {
      const payFn = httpsCallable(functions, "payMerchantHex");
      const res   = await payFn({ merchantId: Number(merchantId), amountKrw });
      const d     = res.data;

      if (resultBox) {
        resultBox.style.display = "";
        resultBox.innerHTML = `
          <div class="mp-kv"><span class="k">가맹점</span><span class="v">${d.merchantName || ""}</span></div>
          <div class="mp-kv"><span class="k">결제 금액</span><span class="v accent">${amountKrw.toLocaleString()}원 (${d.amountHex} HEX)</span></div>
          <div class="mp-kv"><span class="k">트랜잭션</span><span class="v mono" style="font-size:0.8em;">${(d.txHash || "").slice(0, 20)}…</span></div>
          <p class="hint" style="color:var(--accent); margin-top:6px;">✓ 결제 완료</p>
        `;
      }
      form.reset();
      loadTxHistory(uid);
      loadOnChainData(uid);
    } catch (err) {
      alert("결제 실패: " + err.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = "결제";
    }
  });
}

// ── QR 스캐너 ────────────────────────────────────
function bindQrScanner() {
  const btnOpen  = $("btnQrScan");
  const btnClose = $("btnCloseQr");
  const overlay  = $("qrScanOverlay");
  const video    = $("qrVideo");
  const canvas   = $("qrCanvas");
  const stateEl  = $("qrScanState");

  if (!btnOpen || !overlay || !video || !canvas) return;
  if (btnOpen._qrBound) return;
  btnOpen._qrBound = true;

  let stream    = null;
  let rafId     = null;
  let scanning  = false;

  function stopScanner() {
    scanning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    overlay.classList.remove("active");
  }

  function tick() {
    if (!scanning) return;
    if (video.readyState < video.HAVE_ENOUGH_DATA) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) { rafId = requestAnimationFrame(tick); return; }

    canvas.width  = w;
    canvas.height = h;
    const ctx2d = canvas.getContext("2d");
    ctx2d.drawImage(video, 0, 0, w, h);
    const imageData = ctx2d.getImageData(0, 0, w, h);

    const code = window.jsQR?.(imageData.data, w, h, { inversionAttempts: "dontInvert" });
    if (code && code.data) {
      const url = code.data;
      // pay.html URL인지 확인
      if (url.includes("/pay.html") && url.includes("merchant=") && url.includes("amount=")) {
        if (stateEl) stateEl.textContent = "QR 인식됨! 결제 페이지로 이동합니다...";
        stopScanner();
        setTimeout(() => { location.href = url; }, 300);
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  async function openScanner() {
    if (scanning) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("이 브라우저에서는 카메라를 사용할 수 없습니다.");
      return;
    }
    try {
      stream   = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      await video.play();
      scanning = true;
      overlay.classList.add("active");
      if (stateEl) stateEl.textContent = "QR 코드를 사각형 안에 맞춰주세요";
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      alert("카메라 접근 실패: " + (err.message || err));
    }
  }

  btnOpen.addEventListener("click", openScanner);
  btnClose.addEventListener("click", stopScanner);

  // 오버레이 바깥 터치 시 닫기
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) stopScanner();
  });

  // ESC 키
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && scanning) stopScanner();
  });
}

// ── 진입점 ────────────────────────────────────────
onAuthReady(async (ctx) => {
  const loggedIn = (ctx?.loggedIn ?? ctx?.loggedin) === true;
  const user     = ctx?.user;

  if (!loggedIn || !user) {
    show("needLoginPanel", true);
    const btn = $("btnLoginPage");
    if (btn) btn.onclick = async () => { try { await login(); } catch (e) { console.warn(e); } };
    return;
  }

  show("mainContent", true);

  try {
    // Firestore 기본 데이터 로드
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    // 회원가입 미완료 시 → 안내 후 종료
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
    bindHexTransfer(user.uid);
    loadMerchantsForSelect();
    bindMerchantPay(user.uid);
    bindQrScanner();

    // 비동기로 추가 데이터 로드
    loadOnChainData(user.uid);
    loadDepositHistory(user.uid);
    loadTxHistory(user.uid);
    loadMentees();

    // 충전 내역 새로고침 버튼
    const btnRefresh = $("btnRefreshDeposits");
    if (btnRefresh) {
      btnRefresh.onclick = () => loadDepositHistory(user.uid);
    }

    // 멘티 새로고침 버튼
    const btnRefreshMentees = $("btnRefreshMentees");
    if (btnRefreshMentees) {
      btnRefreshMentees.onclick = () => loadMentees();
    }
  } catch (err) {
    console.error("마이페이지 로드 실패:", err);
  }
});
