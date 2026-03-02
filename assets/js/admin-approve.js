// /assets/js/admin-approve.js
import { onAuthReady } from "/assets/js/auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

import { db, functions } from "/assets/js/firebase-init.js";


function $(id) {
  return document.getElementById(id);
}

const adminState = $("adminState");
const guideList = $("guideList");
const itemList = $("itemList");

const btnReloadGuides   = $("btnReloadGuides");
const btnReloadItems    = $("btnReloadItems");
const btnReloadDeposits = $("btnReloadDeposits");
const selItemStatus     = $("selItemStatus");

const btnTabGuides     = $("btnTabGuides");
const btnTabMerchants  = $("btnTabMerchants");
const btnTabItems      = $("btnTabItems");
const btnTabDeposits   = $("btnTabDeposits");
const btnTabHex        = $("btnTabHex");
const btnTabMembers    = $("btnTabMembers");
const tabGuides        = $("tabGuides");
const tabMerchants     = $("tabMerchants");
const tabItems         = $("tabItems");
const tabDeposits      = $("tabDeposits");
const tabHex           = $("tabHex");
const tabMembers       = $("tabMembers");
const itemsFilter      = $("itemsFilter");
const merchantList     = $("merchantList");
const btnReloadMerchants = $("btnReloadMerchants");
const depositList      = $("depositList");
const hexAllowanceDisplay = $("hexAllowanceDisplay");

const dlg = $("dlgDetail");
const dlgTitle = $("dlgTitle");
const dlgBody = $("dlgBody");
const dlgClose = $("dlgClose");

let isAdminUser = false;

function qs(name){
  return new URLSearchParams(location.search).get(name);
}

function setState(msg) {
  if (adminState) adminState.textContent = msg || "";
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmt(v) {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string" && v.trim() === "") return "-";
  if (typeof v === "object") {
    if (typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return d.toISOString().replace("T", " ").slice(0, 19);
    }
  }
  return String(v);
}

function pretty(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function openDialog(title, obj) {
  if (!dlg) return;
  dlgTitle.textContent = title || "상세";
  dlgBody.textContent = pretty(obj);
  dlg.showModal();
}

dlgClose?.addEventListener("click", () => dlg?.close());
dlg?.addEventListener("click", (e) => {
  const rect = dlg.querySelector(".dlg-box")?.getBoundingClientRect();
  if (!rect) return;
  const x = e.clientX,
    y = e.clientY;
  const inside =
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom;
  if (!inside) dlg.close();
});

function cardWrap(html) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = html;
  return el;
}

function kvGrid(uid, v) {
  const rows = [
    ["신청자 UID", uid],
    ["이름", v.name || v.displayName],
    ["이메일", v.email],
    ["전화", v.phone || v.tel],
    ["카카오", v.kakao || v.kakaoId],
    ["국가/지역", v.country || v.region],
    ["활동지역", v.area],
    ["지갑주소(HEX 정산)", v.walletAddress || v.profile?.walletAddress],
    ["소개", v.bio || v.intro],
    ["포트폴리오", v.portfolio || v.site],
    ["SNS", v.sns],
    ["메모", v.memo],
    ["createdAt", v.createdAt],
    ["updatedAt", v.updatedAt],
  ];

  const html = rows
    .map(
      ([k, val]) => `
      <div class="k">${esc(k)}</div>
      <div class="v">${esc(fmt(val))}</div>
    `
    )
    .join("");

  return `<div class="kv">${html}</div>`;
}

function pickWalletAddress(v) {
  const w =
    (typeof v?.walletAddress === "string" && v.walletAddress.trim()) ||
    (typeof v?.profile?.walletAddress === "string" &&
      v.profile.walletAddress.trim()) ||
    "";
  return w || "";
}

async function loadGuideApplications() {
  if (!guideList) return;

  guideList.innerHTML = "";
  setState("가이드 신청 목록 로딩중…");

  const snap = await getDocs(collection(db, "guideApplications"));
  if (snap.empty) {
    setState("가이드 신청 없음");
    return;
  }

  setState(`가이드 신청 ${snap.size}건`);
  snap.forEach((d) => {
    const v = d.data();
    const uid = d.id;

    const title = v.name || v.displayName || uid;
    const sub = [v.email, v.phone || v.tel, v.area].filter(Boolean).join(" · ");

    const el = cardWrap(`
      <details class="expander" data-uid="${esc(uid)}">
        <summary>
          <div class="sum-left">
            <div class="sum-title">${esc(title)}</div>
            <div class="sum-sub">${esc(sub || "신청 상세를 펼쳐 확인하세요")}</div>
          </div>
          <div class="sum-right">
            <span class="badge">uid: ${esc(uid.slice(0, 6))}…</span>
            <button class="btn btn-sm" type="button" data-act="viewGuide" data-uid="${esc(uid)}">상세(JSON)</button>
            <button class="btn btn-sm" type="button" data-act="approveGuide" data-uid="${esc(uid)}">승인</button>
            <button class="btn btn-sm" type="button" data-act="rejectGuide" data-uid="${esc(uid)}">반려(삭제)</button>
          </div>
        </summary>

        <div class="expander-body">
          ${kvGrid(uid, v)}
          <div class="row-actions">
            <button class="btn btn-sm" type="button" data-act="approveGuide" data-uid="${esc(uid)}">승인</button>
            <button class="btn btn-sm" type="button" data-act="rejectGuide" data-uid="${esc(uid)}">반려(삭제)</button>
          </div>
        </div>
      </details>
    `);

    guideList.appendChild(el);
  });
}

async function approveGuide(uid) {
  if (!isAdminUser) {
    alert("관리자 권한이 없습니다. (admins/{내 uid} 문서 확인 필요)");
    return;
  }

  const appRef = doc(db, "guideApplications", uid);
  const appSnap = await getDoc(appRef);
  if (!appSnap.exists()) {
    alert("신청서를 찾을 수 없습니다.");
    return;
  }

  const v = appSnap.data();
  const walletAddress = pickWalletAddress(v);

  // guides/{uid} 문서 생성/병합 (create/update 둘 다 가능)
  const guideRef = doc(db, "guides", uid);
  await setDoc(
    guideRef,
    {
      ...v,
      uid,
      approved: true,
      walletAddress, // 요구사항: guides/{uid}.walletAddress
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // users/{uid}는 rules상 "본인만" 수정 가능이라 여기서 건드리면 permission-denied 남
  // role SSOT는 admins + guides.approved 로 처리

  await deleteDoc(appRef);

  alert("승인 완료");
  await loadGuideApplications();
}

async function rejectGuide(uid) {
  if (!isAdminUser) {
    alert("관리자 권한이 없습니다.");
    return;
  }

  const ok = confirm("반려(삭제) 하시겠습니까?");
  if (!ok) return;

  await deleteDoc(doc(db, "guideApplications", uid));
  alert("삭제 완료");
  await loadGuideApplications();
}

async function loadItemsByStatus(status) {
  if (!itemList) return;

  itemList.innerHTML = "";
  setState(`items status=${status} 로딩중…`);

  const q = query(collection(db, "items"), where("status", "==", status));
  const snap = await getDocs(q);

  if (snap.empty) {
    setState(`items status=${status} 없음`);
    return;
  }

  setState(`items status=${status} ${snap.size}건`);
  snap.forEach((d) => {
    const v = d.data();
    const id = d.id;

    const el = cardWrap(`
      <details class="expander" data-item="${esc(id)}">
        <summary>
          <div class="sum-left">
            <div class="sum-title">${esc(v.title || "(제목없음)")}</div>
            <div class="sum-sub">${esc([v.category, v.region, "owner:" + (v.ownerUid || "-")].filter(Boolean).join(" · "))}</div>
          </div>
          <div class="sum-right">
            <span class="badge">status: ${esc(v.status || "-")}</span>
            <button class="btn btn-sm" type="button" data-act="viewItem" data-id="${esc(id)}">상세(JSON)</button>
            <a class="btn btn-sm" href="/product_edit.html?id=${esc(id)}&from=admin" target="_blank" rel="noopener">수정</a>
            ${
              (status === "pending" && isAdminUser)
                ? `<button class="btn btn-sm" type="button" data-act="approveItem" data-id="${esc(id)}">승인</button>`
                : ""
            }
          </div>
        </summary>
        <div class="expander-body">
          <div class="kv">
            <div class="k">itemId</div><div class="v">${esc(id)}</div>
            <div class="k">title</div><div class="v">${esc(fmt(v.title))}</div>
            <div class="k">status</div><div class="v">${esc(fmt(v.status))}</div>
            <div class="k">price</div><div class="v">${esc(fmt(v.price))}</div>
            <div class="k">ownerUid</div><div class="v">${esc(fmt(v.ownerUid))}</div>
            <div class="k">guideUid</div><div class="v">${esc(fmt(v.guideUid))}</div>
            <div class="k">createdAt</div><div class="v">${esc(fmt(v.createdAt))}</div>
          </div>
          <div class="row-actions">
            <a class="btn btn-sm" href="/product_edit.html?id=${esc(id)}&from=admin" target="_blank" rel="noopener">수정</a>
          </div>
        </div>
      </details>
    `);

    itemList.appendChild(el);
  });
}

async function approveItem(id) {
  if (!isAdminUser) {
    alert("관리자 권한이 없습니다.");
    return;
  }

  const ok = confirm("이 상품을 published로 승인할까요?");
  if (!ok) return;

  try {
    await updateDoc(doc(db, "items", id), {
      status: "published",
      updatedAt: serverTimestamp(),
    });

    alert("승인 완료");
    await loadItemsByStatus(selItemStatus?.value || "pending");
  } catch (err) {
    console.error("approveItem failed", err);
    const msg = (err && (err.code || err.message)) ? `${err.code || ""} ${err.message || ""}`.trim() : "unknown error";
    alert("승인 실패: " + msg);
  }
}

// ── 가맹점 관리 탭 ───────────────────────────────────────────────────────

async function loadMerchants() {
  if (!merchantList) return;

  merchantList.innerHTML = "";
  setState("가맹점 목록 로딩중…");

  const snap = await getDocs(collection(db, "merchants"));
  if (snap.empty) {
    setState("등록된 가맹점 없음");
    merchantList.innerHTML = '<p class="muted" style="padding:12px 0;">등록된 가맹점이 없습니다.</p>';
    return;
  }

  setState(`가맹점 ${snap.size}건`);
  snap.forEach((d) => {
    const v   = d.data();
    const mid = d.id;

    const feeBps = Number(v.feeBps) || 0;
    const feeBadge = feeBps > 0
      ? `<span class="badge" style="background:var(--accent, #22c55e);">수수료 ${feeBps / 100}%</span>`
      : '<span class="badge" style="background:#f59e0b;">미승인 (feeBps=0)</span>';

    const el = cardWrap(`
      <details class="expander" data-mid="${esc(mid)}">
        <summary>
          <div class="sum-left">
            <div class="sum-title">${esc(v.name || "(이름없음)")} · ID: ${esc(mid)}</div>
            <div class="sum-sub">${esc([v.career, v.region, "owner:" + (v.ownerUid || "-")].filter(Boolean).join(" · "))}</div>
          </div>
          <div class="sum-right">
            ${feeBadge}
            <button class="btn btn-sm" type="button" data-act="viewMerchant" data-mid="${esc(mid)}">상세(JSON)</button>
            ${isAdminUser
              ? `<button class="btn btn-sm" type="button" data-act="approveMerchant" data-mid="${esc(mid)}" data-feebps="${feeBps}">수수료 설정</button>`
              : ""}
          </div>
        </summary>
        <div class="expander-body">
          <div class="kv">
            <div class="k">merchantId</div><div class="v">${esc(mid)}</div>
            <div class="k">가게명</div><div class="v">${esc(fmt(v.name))}</div>
            <div class="k">업종/카테고리</div><div class="v">${esc(fmt(v.career))}</div>
            <div class="k">활동지역</div><div class="v">${esc(fmt(v.region))}</div>
            <div class="k">소개/상세</div><div class="v">${esc(fmt(v.description))}</div>
            <div class="k">전화</div><div class="v">${esc(fmt(v.phone))}</div>
            <div class="k">카카오ID</div><div class="v">${esc(fmt(v.kakaoId))}</div>
            <div class="k">활성 여부</div><div class="v">${v.active === false ? "비활성" : "활성"}</div>
            <div class="k">수수료 (feeBps)</div><div class="v">${esc(fmt(feeBps))} bps = ${feeBps / 100}%</div>
            <div class="k">ownerUid</div><div class="v" style="word-break:break-all;">${esc(fmt(v.ownerUid))}</div>
            <div class="k">ownerAddress</div><div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(fmt(v.ownerAddress))}</div>
            <div class="k">등록 txHash</div><div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(fmt(v.txHash))}</div>
            <div class="k">등록일 (createdAt)</div><div class="v">${esc(fmt(v.createdAt))}</div>
            <div class="k">승인일 (approvedAt)</div><div class="v">${esc(fmt(v.approvedAt))}</div>
          </div>
          ${isAdminUser ? `
          <div class="row-actions">
            <button class="btn btn-sm" type="button" data-act="approveMerchant" data-mid="${esc(mid)}" data-feebps="${feeBps}">수수료 설정</button>
          </div>` : ""}
        </div>
      </details>
    `);

    merchantList.appendChild(el);
  });
}

async function approveMerchant(mid, currentFeeBps) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const input = prompt(
    `가맹점 ID ${mid} 수수료를 설정하세요.\n현재: ${currentFeeBps / 100}%\n\n수수료(%)를 입력하세요 (0~30%, 컨트랙트 최대 30%)`,
    String(currentFeeBps / 100)
  );
  if (input === null) return; // 취소

  const pct = parseFloat(input);
  if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
    alert("0~30 사이의 숫자를 입력하세요. (컨트랙트 최대 30%)");
    return;
  }
  const feeBps = Math.round(pct * 100); // % → bps

  const ok = confirm(`가맹점 ID ${mid}의 수수료를 ${pct}%(feeBps=${feeBps})로 설정하시겠습니까?`);
  if (!ok) return;

  setState("수수료 설정 중…");
  try {
    const fn  = httpsCallable(functions, "adminSetMerchantFee");
    const res = await fn({ merchantId: Number(mid), feeBps });
    alert(`설정 완료!\nmerchantId: ${res.data.merchantId}\n수수료: ${res.data.feeBps / 100}%\ntxHash: ${(res.data.txHash || "").slice(0, 22)}…`);
    await loadMerchants();
  } catch (err) {
    setState("수수료 설정 실패");
    console.error("approveMerchant:", err);
    alert("수수료 설정 실패: " + (err.message || String(err)));
  }
}

// ── 입금 승인 탭 ──────────────────────────────────────────────────────────

async function loadDeposits() {
  if (!depositList) return;
  depositList.innerHTML = "";
  setState("입금 대기 목록 로딩중…");

  try {
    const q = query(
      collection(db, "deposits"),
      where("status", "in", ["pending", "processing"]),
      orderBy("requestedAt", "desc"),
      limit(100)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      setState("대기중인 입금 요청 없음");
      depositList.innerHTML = '<p class="muted" style="padding:12px 0;">대기중인 입금 요청이 없습니다.</p>';
      return;
    }

    setState(`입금 대기 ${snap.size}건`);
    snap.forEach((d) => {
      const v = d.data();
      const refCode = v.refCode || d.id;
      const dateStr = v.requestedAt?.seconds
        ? new Date(v.requestedAt.seconds * 1000).toLocaleString("ko")
        : "-";
      const statusBadge = v.status === "processing"
        ? '<span class="badge" style="background:#f59e0b;">처리중</span>'
        : '<span class="badge">대기</span>';

      const el = cardWrap(`
        <details class="expander" data-ref="${esc(refCode)}">
          <summary>
            <div class="sum-left">
              <div class="sum-title">${esc(v.depositorName || "-")} · ${esc((v.amountKrw || 0).toLocaleString())}원</div>
              <div class="sum-sub">${esc(refCode)} · ${esc(dateStr)}</div>
            </div>
            <div class="sum-right">
              ${statusBadge}
              <button class="btn btn-sm" type="button" data-act="viewDeposit" data-ref="${esc(refCode)}">상세</button>
              <button class="btn btn-sm" type="button" data-act="approveDeposit" data-ref="${esc(refCode)}"
                ${v.status === "processing" ? "disabled" : ""}>승인 (creditPoints)</button>
            </div>
          </summary>
          <div class="expander-body">
            <div class="kv">
              <div class="k">refCode</div><div class="v">${esc(refCode)}</div>
              <div class="k">입금자명</div><div class="v">${esc(v.depositorName || "-")}</div>
              <div class="k">금액 (KRW)</div><div class="v">${esc((v.amountKrw || 0).toLocaleString())}원</div>
              <div class="k">지갑 주소</div><div class="v" style="word-break:break-all; font-family:monospace; font-size:12px;">${esc(v.userAddress || "-")}</div>
              <div class="k">은행</div><div class="v">${esc(v.bank || "-")}</div>
              <div class="k">신청일</div><div class="v">${esc(dateStr)}</div>
              <div class="k">상태</div><div class="v">${esc(v.status || "-")}</div>
              ${v.rateAtRequest ? `<div class="k">신청 시 환율</div><div class="v">₩${esc(String(v.rateAtRequest.krwPerUsd || "-"))}/USD</div>` : ""}
            </div>
            <div class="row-actions">
              <button class="btn btn-sm" type="button" data-act="approveDeposit" data-ref="${esc(refCode)}"
                ${v.status === "processing" ? "disabled" : ""}>승인 (creditPoints)</button>
            </div>
          </div>
        </details>
      `);
      depositList.appendChild(el);
    });
  } catch (err) {
    setState("로딩 실패: " + err.message);
    depositList.innerHTML = `<p class="muted">오류: ${esc(err.message)}</p>`;
    console.error("loadDeposits:", err);
  }
}

async function approveDepositAction(refCode) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const overrideInput = String($("inputKrwRate")?.value || "").trim();
  const overrideKrwRate = overrideInput ? parseFloat(overrideInput) : null;
  const rateMsg = overrideKrwRate
    ? `\n수동 환율: ₩${overrideKrwRate.toLocaleString()}/USD`
    : "\n환율: 자동 조회";

  const ok = confirm(`[${refCode}]\n입금을 승인하고 온체인 포인트를 적립하시겠습니까?${rateMsg}`);
  if (!ok) return;

  setState("creditPoints 호출 중…");
  try {
    const fn = httpsCallable(functions, "approveDeposit");
    const res = await fn({ refCode, overrideKrwRate });
    const d = res.data;
    alert(
      `승인 완료!\n적립: ${d.hexDisplay}\nUSD: $${d.usdAmount}\nVND: ${(d.vndAmount || 0).toLocaleString()} VND\ntxHash: ${(d.txHash || "").slice(0, 22)}…`
    );
    await loadDeposits();
  } catch (err) {
    setState("승인 실패");
    console.error("approveDeposit:", err);
    alert("승인 실패: " + (err.message || String(err)));
  }
}

// ── 컨트랙트 현황 ─────────────────────────────────────────────────────────

async function loadContractStatus() {
  const grid = $("contractStatusGrid");
  if (!grid) return;

  // 로딩 중 표시
  grid.innerHTML = '<div class="k">상태</div><div class="v" id="contractStatusMsg">조회 중...</div>';

  try {
    const fn  = httpsCallable(functions, "adminGetContractStatus");
    const res = await fn();
    const d   = res.data;

    const fmtKrw = (krw) => krw != null ? " ≈ " + krw.toLocaleString() + "원" : "";

    grid.innerHTML = `
      <div class="k">컨트랙트 주소</div>
      <div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(d.contractAddress)}</div>

      <div class="k">컨트랙트 HEX 잔액</div>
      <div class="v accent">${esc(d.contractHexDisplay)}${esc(fmtKrw(d.contractHexKrw))}</div>

      <div class="k">관리자 지갑 주소</div>
      <div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(d.adminAddress)}</div>

      <div class="k">관리자 HEX 잔액</div>
      <div class="v">${esc(d.adminHexDisplay)}${esc(fmtKrw(d.adminHexKrw))}</div>

      <div class="k">관리자 BNB 잔액 (가스)</div>
      <div class="v">${esc(d.adminBnbDisplay)}</div>

      <div class="k">HEX Allowance</div>
      <div class="v ${d.isMaxUint ? "accent" : ""}">${esc(d.ownerHexAllowanceDisplay)}</div>

      <div class="k">환율 (KRW/USD)</div>
      <div class="v muted">${d.krwPerUsd != null ? "₩" + d.krwPerUsd.toLocaleString() : "-"} (${esc(d.rateSource)})</div>
    `;
  } catch (err) {
    if (grid) grid.innerHTML = `<div class="k">오류</div><div class="v muted">${esc(err.message)}</div>`;
    console.error("loadContractStatus:", err);
  }
}

// ── HEX 관리 탭 ──────────────────────────────────────────────────────────

async function checkHexAllowance() {
  if (hexAllowanceDisplay) hexAllowanceDisplay.textContent = "조회 중...";
  try {
    const fn = httpsCallable(functions, "adminCheckAllowance");
    const res = await fn();
    const d = res.data;
    if (hexAllowanceDisplay) {
      hexAllowanceDisplay.textContent = d.isMaxUint
        ? `∞ MaxUint256 (무한 승인 중)`
        : `${d.allowanceDisplay}`;
    }
  } catch (err) {
    if (hexAllowanceDisplay) hexAllowanceDisplay.textContent = "조회 실패: " + err.message;
    console.error("checkHexAllowance:", err);
  }
}

async function execApproveHex() {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  const ok = confirm(
    "jumpPlatform 컨트랙트에 HEX 무한 승인(MaxUint256)을 실행합니다.\n" +
    "이 작업은 관리자 지갑에서 서명됩니다. 계속하시겠습니까?"
  );
  if (!ok) return;

  setState("HEX approve 실행 중…");
  try {
    const fn = httpsCallable(functions, "adminApproveHex");
    const res = await fn({ amountWei: null });
    alert("HEX approve 완료!\ntxHash: " + (res.data.txHash || "").slice(0, 22) + "…");
    await checkHexAllowance();
    setState("HEX approve 완료");
  } catch (err) {
    setState("HEX approve 실패");
    console.error("execApproveHex:", err);
    alert("HEX approve 실패: " + err.message);
  }
}

// ── 탭 전환 ──────────────────────────────────────────────────────────────

function showTab(which) {
  if (tabGuides)    tabGuides.style.display    = which === "guides"    ? "" : "none";
  if (tabMerchants) tabMerchants.style.display = which === "merchants" ? "" : "none";
  if (tabItems)     tabItems.style.display     = which === "items"     ? "" : "none";
  if (tabDeposits)  tabDeposits.style.display  = which === "deposits"  ? "" : "none";
  if (tabHex)       tabHex.style.display       = which === "hex"       ? "" : "none";
  if (tabMembers)   tabMembers.style.display   = which === "members"   ? "" : "none";

  // 툴바 부속 요소 가시성
  if (itemsFilter)       itemsFilter.style.display       = which === "items"     ? "" : "none";
  if (btnReloadGuides)   btnReloadGuides.style.display   = which === "guides"    ? "" : "none";
  if (btnReloadMerchants)btnReloadMerchants.style.display= which === "merchants" ? "" : "none";
  if (btnReloadItems)    btnReloadItems.style.display    = which === "items"     ? "" : "none";
  if (btnReloadDeposits) btnReloadDeposits.style.display = which === "deposits"  ? "" : "none";

  btnTabGuides?.classList.toggle("is-active",    which === "guides");
  btnTabMerchants?.classList.toggle("is-active", which === "merchants");
  btnTabItems?.classList.toggle("is-active",     which === "items");
  btnTabDeposits?.classList.toggle("is-active",  which === "deposits");
  btnTabHex?.classList.toggle("is-active",       which === "hex");
}

async function checkAdmin(user) {
  // 운영자 이메일 allowlist (부트스트랩)
  if (user?.email && String(user.email).toLowerCase() === "daguri75@gmail.com") {
    return true;
  }

  const a = await getDoc(doc(db, "admins", user.uid));
  return a.exists();
}

async function bootAdmin(user) {
  isAdminUser = await checkAdmin(user);
  if (!isAdminUser) {
    setState("관리자 권한 없음 (admins/{내 uid} 문서 필요)");
    showTab("guides");
    if (guideList) guideList.innerHTML = "";
    if (itemList) itemList.innerHTML = "";
    return;
  }

  setState("관리자 로그인 확인됨");
  // deep-link 지원: /admin.html?tab=items&status=pending
  const tab    = (qs("tab") || "guides").toLowerCase();
  const status = (qs("status") || "").toLowerCase();
  if (status && selItemStatus) {
    const ok = Array.from(selItemStatus.options || []).some(
      (o) => String(o.value).toLowerCase() === status
    );
    if (ok) selItemStatus.value = status;
  }

  const validTab = ["guides", "merchants", "items", "deposits", "hex", "members"].includes(tab) ? tab : "guides";
  showTab(validTab);

  if (validTab === "merchants") {
    await loadMerchants();
  } else if (validTab === "items") {
    await loadItemsByStatus(selItemStatus?.value || "pending");
  } else if (validTab === "deposits") {
    await loadDeposits();
  } else if (validTab === "hex") {
    await Promise.all([loadContractStatus(), checkHexAllowance()]);
  } else {
    await loadGuideApplications();
  }
}

guideList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;

  const act = btn.dataset.act;
  const uid = btn.dataset.uid;

  try {
    if (act === "approveGuide") {
      await approveGuide(uid);
    } else if (act === "rejectGuide") {
      await rejectGuide(uid);
    } else if (act === "viewGuide") {
      const snap = await getDoc(doc(db, "guideApplications", uid));
      if (!snap.exists()) return alert("신청서를 찾을 수 없습니다.");
      openDialog("가이드 신청 상세(JSON)", { uid, ...snap.data() });
    }
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});

itemList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;

  const act = btn.dataset.act;
  const id = btn.dataset.id;

  try {
    if (act === "approveItem") {
      await approveItem(id);
    } else if (act === "viewItem") {
      const snap = await getDoc(doc(db, "items", id));
      if (!snap.exists()) return alert("상품을 찾을 수 없습니다.");
      openDialog("상품 상세(JSON)", { id, ...snap.data() });
    }
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});

// 기존 탭 리로드 버튼
btnReloadGuides?.addEventListener("click", () => loadGuideApplications());
btnReloadMerchants?.addEventListener("click", () => loadMerchants());
btnReloadItems?.addEventListener("click", () =>
  loadItemsByStatus(selItemStatus?.value || "pending")
);
btnReloadDeposits?.addEventListener("click", () => loadDeposits());
selItemStatus?.addEventListener("change", () => loadItemsByStatus(selItemStatus.value));

// 탭 전환
btnTabGuides?.addEventListener("click", () => { showTab("guides"); loadGuideApplications(); });
btnTabMerchants?.addEventListener("click", () => { showTab("merchants"); loadMerchants(); });
btnTabItems?.addEventListener("click", () => { showTab("items"); loadItemsByStatus(selItemStatus?.value || "pending"); });
btnTabDeposits?.addEventListener("click", () => { showTab("deposits"); loadDeposits(); });
btnTabHex?.addEventListener("click", () => { showTab("hex"); loadContractStatus(); checkHexAllowance(); });
btnTabMembers?.addEventListener("click", () => { showTab("members"); });

// ── 관리자 셀프 온보딩 ──
$("btnAdminSelfOnboard")?.addEventListener("click", async () => {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  if (!confirm("ADMIN_PRIVATE_KEY 지갑을 현재 계정에 연결합니다.\n계속하시겠습니까?")) return;

  const btn = $("btnAdminSelfOnboard");
  const resultBox = $("adminSelfOnboardResult");
  btn.disabled = true;
  btn.textContent = "처리 중...";
  resultBox.style.display = "none";

  try {
    const fn  = httpsCallable(functions, "adminSelfOnboard");
    const res = await fn();
    const d   = res.data;
    resultBox.style.display = "";
    resultBox.innerHTML = `
      <div style="color:var(--accent); font-weight:600;">✓ 완료</div>
      <div>주소: <span style="font-family:monospace;font-size:12px;">${esc(d.address)}</span></div>
      <div>레벨: ${esc(String(d.level))}</div>
      ${d.txHash ? `<div>txHash: <span style="font-family:monospace;font-size:12px;">${esc(d.txHash.slice(0,30))}…</span></div>` : "<div>이미 등록됨 (신규 tx 없음)</div>"}
    `;
    setState(`관리자 지갑 연결 완료 — ${(d.address || "").slice(0,10)}…`);
  } catch (err) {
    alert("실패: " + (err.message || String(err)));
    setState("관리자 지갑 연결 실패");
  } finally {
    btn.disabled = false;
    btn.textContent = "관리자 지갑 연결 실행";
  }
});

// ── 멘토 일괄 변경 ──
$("btnBulkChangeMentor")?.addEventListener("click", async () => {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const mentorAddress = ($("inputNewMentorAddr")?.value || "").trim();
  if (!mentorAddress.startsWith("0x")) { alert("유효한 지갑 주소를 입력하세요."); return; }

  const rawUids = ($("inputTargetUids")?.value || "").trim();
  const targetUids = rawUids
    ? rawUids.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    : null;

  const targetLabel = targetUids ? `${targetUids.length}명` : "전체 온체인 등록 유저";
  if (!confirm(`멘토를 ${mentorAddress.slice(0,8)}...로 변경합니다.\n대상: ${targetLabel}\n\n계속하시겠습니까?`)) return;

  const btn = $("btnBulkChangeMentor");
  const resultBox = $("bulkMentorResult");
  btn.disabled = true;
  btn.textContent = "처리 중...";
  resultBox.style.display = "none";

  try {
    const fn  = httpsCallable(functions, "adminBulkChangeMentor");
    const res = await fn({ mentorAddress, targetUids });
    const d   = res.data;
    resultBox.style.display = "";
    resultBox.innerHTML = `
      <div style="color:var(--accent); font-weight:600;">✓ 완료</div>
      <div>변경됨: <strong>${d.updated}</strong>명 / 스킵: ${d.skipped}명 / 실패: ${d.failed}명</div>
      ${d.details?.failed?.length ? `<div style="color:#ef4444; margin-top:6px;">실패: ${JSON.stringify(d.details.failed)}</div>` : ""}
    `;
    setState(`멘토 일괄 변경 완료 — ${d.updated}명 업데이트`);
  } catch (err) {
    alert("실패: " + (err.message || String(err)));
    setState("멘토 일괄 변경 실패");
  } finally {
    btn.disabled = false;
    btn.textContent = "멘토 일괄 변경 실행";
  }
});

// ── 유저 레벨 설정 ──
$("btnSetUserLevel")?.addEventListener("click", async () => {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const emailOrUid = ($("inputSetLevelUser")?.value || "").trim();
  if (!emailOrUid) { alert("이메일 또는 UID를 입력하세요."); return; }

  const level = parseInt($("inputSetLevel")?.value || "0", 10);
  if (!level || level < 1 || level > 10) { alert("레벨은 1~10 사이 정수여야 합니다."); return; }

  if (!confirm(`[${emailOrUid}]\n온체인 레벨을 ${level}로 설정합니다.\n계속하시겠습니까?`)) return;

  const btn = $("btnSetUserLevel");
  const resultBox = $("setLevelResult");
  btn.disabled = true;
  btn.textContent = "처리 중...";
  resultBox.style.display = "none";

  try {
    const fn  = httpsCallable(functions, "adminSetUserLevel");
    const res = await fn({ emailOrUid, level });
    const d   = res.data;
    resultBox.style.display = "";
    resultBox.innerHTML = `
      <div style="color:var(--accent); font-weight:600;">✓ 완료</div>
      <div>UID: ${esc(d.uid)}</div>
      <div>주소: <span style="font-family:monospace;font-size:12px;">${esc(d.address)}</span></div>
      <div>레벨: <strong>${esc(String(d.level))}</strong></div>
      <div>txHash: <span style="font-family:monospace;font-size:12px;">${esc((d.txHash || "").slice(0, 30))}…</span></div>
    `;
    setState(`레벨 설정 완료 — ${d.uid} → Lv.${d.level}`);
  } catch (err) {
    alert("실패: " + (err.message || String(err)));
    setState("레벨 설정 실패");
  } finally {
    btn.disabled = false;
    btn.textContent = "레벨 설정 실행";
  }
});

// 가맹점 목록 이벤트 위임
merchantList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const mid = btn.dataset.mid;
  try {
    if (act === "approveMerchant") {
      await approveMerchant(mid, Number(btn.dataset.feebps) || 0);
    } else if (act === "viewMerchant") {
      const snap = await getDoc(doc(db, "merchants", mid));
      if (!snap.exists()) return alert("가맹점을 찾을 수 없습니다.");
      const mData = snap.data();
      // 소유자 회원 정보도 함께 조회
      let ownerProfile = null;
      if (mData.ownerUid) {
        const uSnap = await getDoc(doc(db, "users", mData.ownerUid));
        if (uSnap.exists()) {
          const u = uSnap.data();
          ownerProfile = {
            name: u.name,
            email: u.email,
            phone: u.phone,
            registeredAt: u.registeredAt,
            onChain_registered: u.onChain?.registered,
            wallet: u.wallet?.address,
          };
        }
      }
      openDialog("가맹점 상세 (JSON)", { merchantId: mid, ...mData, _ownerProfile: ownerProfile });
    }
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});

// 입금 목록 이벤트 위임
depositList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const act     = btn.dataset.act;
  const refCode = btn.dataset.ref;
  try {
    if (act === "approveDeposit") {
      await approveDepositAction(refCode);
    } else if (act === "viewDeposit") {
      const snap = await getDoc(doc(db, "deposits", refCode));
      if (!snap.exists()) return alert("입금 요청을 찾을 수 없습니다.");
      openDialog("입금 상세 (JSON)", { refCode, ...snap.data() });
    }
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});

async function recordP2pTransferAction() {
  const txHash = String($("inputP2pTxHash")?.value || "").trim();
  if (!txHash) { alert("트랜잭션 해시를 입력하세요."); return; }

  const ok = confirm(`P2P 거래를 기록하시겠습니까?\n\ntxHash: ${txHash.slice(0, 30)}…`);
  if (!ok) return;

  setState("P2P 거래 기록 중…");
  try {
    const fn  = httpsCallable(functions, "adminRecordP2pTransfer");
    const res = await fn({ txHash });
    const d   = res.data;
    const krwStr = d.amountKrw ? " ≈ " + d.amountKrw.toLocaleString() + "원" : "";
    alert(
      `P2P 기록 완료!\n수신 UID: ${d.uid}\n금액: ${d.amountHex} HEX${krwStr}\n발신: ${(d.from || "").slice(0, 20)}…`
    );
    if ($("inputP2pTxHash")) $("inputP2pTxHash").value = "";
    setState("P2P 기록 완료");
  } catch (err) {
    setState("P2P 기록 실패");
    console.error("recordP2p:", err);
    alert("P2P 기록 실패: " + err.message);
  }
}

// ── 컨트랙트 HEX 충전 ─────────────────────────────────────────────────────

async function execOwnerDepositHex() {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  const input     = $("inputOwnerDepositHex");
  const amountHex = parseFloat(input?.value || "0");
  if (!amountHex || amountHex <= 0) { alert("충전할 HEX 수량을 입력하세요."); return; }

  // HEX → wei (18 decimals)
  const amountWei = (BigInt(Math.round(amountHex * 1e9)) * BigInt(1e9)).toString();

  if (!confirm(`${amountHex} HEX를 jumpPlatform 컨트랙트에 충전합니다.\n계속하시겠습니까?`)) return;

  setState("컨트랙트 HEX 충전 중…");
  try {
    const fn  = httpsCallable(functions, "adminOwnerDepositHex");
    const res = await fn({ amountWei });
    alert(`충전 완료!\n${res.data.amountDisplay}\ntxHash: ${(res.data.txHash || "").slice(0, 22)}…`);
    await loadContractStatus();
    setState("충전 완료");
  } catch (err) {
    setState("충전 실패");
    console.error("execOwnerDepositHex:", err);
    alert("충전 실패: " + err.message);
  }
}

// HEX 관리 버튼
$("btnRefreshContractStatus")?.addEventListener("click", () => loadContractStatus());
$("btnOwnerDepositHex")?.addEventListener("click", () => execOwnerDepositHex());
$("btnCheckAllowance")?.addEventListener("click", () => checkHexAllowance());
$("btnApproveHex")?.addEventListener("click", () => execApproveHex());
$("btnRecordP2p")?.addEventListener("click", () => recordP2pTransferAction());

onAuthReady(async ({ loggedIn, user }) => {
  if (!loggedIn || !user) {
    setState("로그인 필요");
    return;
  }
  await bootAdmin(user);
});
