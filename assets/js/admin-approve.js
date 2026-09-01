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
import { BrowserProvider, Contract } from 'https://cdn.jsdelivr.net/npm/ethers@6.13.0/dist/ethers.min.js';

import { db, functions } from "/assets/js/firebase-init.js";

// jumpPlatform — onlyOwner 함수만 포함
const PLATFORM_ADDRESS = '0x4d83A7764428fd1c116062aBb60c329E0E29f490';
const PLATFORM_OWNER_ABI = [
  'function adminSetLevel(address user, uint32 level_) external',
  'function adminChangeMentor(address user, address newMentor) external',
];

let _ownerSigner = null;  // Rabby/MetaMask 연결 후 저장
let _cachedItems = [];    // treasure_items 캐시 (아이템 풀 드롭다운용)


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
const btnTabDao        = $("btnTabDao");
const btnTabTreasure   = $("btnTabTreasure");
const btnTabChat       = $("btnTabChat");
const btnTabShops      = $("btnTabShops");
const tabGuides        = $("tabGuides");
const tabMerchants     = $("tabMerchants");
const tabItems         = $("tabItems");
const tabDeposits      = $("tabDeposits");
const tabHex           = $("tabHex");
const tabMembers       = $("tabMembers");
const tabDao           = $("tabDao");
const tabTreasure      = $("tabTreasure");
const tabChat          = $("tabChat");
const tabShops         = $("tabShops");
const daoApproveList   = $("daoApproveList");
const btnReloadDao     = $("btnReloadDao");
const itemsFilter      = $("itemsFilter");
const merchantList     = $("merchantList");
const btnReloadMerchants = $("btnReloadMerchants");
const depositList      = $("depositList");
const hexAllowanceDisplay = $("hexAllowanceDisplay");
const userList         = $("userList");

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
    ["지갑주소(Point 정산)", v.walletAddress || v.profile?.walletAddress],
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

  // ownerUid → email 맵을 일괄 조회
  const docs = [];
  snap.forEach(d => docs.push({ id: d.id, data: d.data() }));

  const ownerUids = [...new Set(docs.map(d => d.data.ownerUid).filter(Boolean))];
  const emailMap = {};
  await Promise.all(ownerUids.map(async uid => {
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (userSnap.exists()) emailMap[uid] = userSnap.data().email || "";
    } catch (_) {}
  }));

  setState(`가맹점 ${snap.size}건`);

  docs.forEach(({ id: mid, data: v }) => {
    const ownerEmail = emailMap[v.ownerUid] || "";
    const feeBps = Number(v.feeBps) || 0;
    const isDormant = v.dormant === true;
    const feeBadge = feeBps > 0
      ? `<span class="badge" style="background:var(--accent, #22c55e);">수수료 ${feeBps / 100}%</span>`
      : '<span class="badge" style="background:#f59e0b;">미승인 (feeBps=0)</span>';
    const dormantBadge = isDormant
      ? '<span class="badge" style="background:#6b7280;color:#fff;">😴 휴면</span>'
      : '';
    const dormantBtn = isDormant
      ? `<button class="btn btn-sm" type="button" data-act="toggleDormant" data-mid="${esc(mid)}" data-dormant="1" style="background:#16a34a;color:#fff;border-color:#16a34a;">▶ 활성화</button>`
      : `<button class="btn btn-sm" type="button" data-act="toggleDormant" data-mid="${esc(mid)}" data-dormant="0" style="background:#64748b;color:#fff;border-color:#64748b;">😴 휴면 처리</button>`;

    const el = cardWrap(`
      <details class="expander" data-mid="${esc(mid)}">
        <summary>
          <div class="sum-left">
            <div class="sum-title">${esc(v.name || "(이름없음)")} · ID: ${esc(mid)}</div>
            <div class="sum-sub">${esc([v.career, v.region, ownerEmail || ("uid:" + (v.ownerUid || "-"))].filter(Boolean).join(" · "))}</div>
          </div>
          <div class="sum-right">
            ${dormantBadge}
            ${feeBadge}
            <button class="btn btn-sm" type="button" data-act="viewMerchant" data-mid="${esc(mid)}">상세(JSON)</button>
            ${isAdminUser ? `
              <button class="btn btn-sm" type="button" data-act="renameMerchant" data-mid="${esc(mid)}" data-name="${esc(v.name || '')}">✏️ 이름변경</button>
              <button class="btn btn-sm" type="button" data-act="editMerchantInfo" data-mid="${esc(mid)}" data-career="${esc(v.career||'')}" data-region="${esc(v.region||'')}" data-desc="${esc(v.description||'')}">📝 정보수정</button>
              ${dormantBtn}
              <button class="btn btn-sm" type="button" data-act="approveMerchant" data-mid="${esc(mid)}" data-feebps="${feeBps}">수수료 설정</button>
              <button class="btn btn-sm" type="button" data-act="setMerchantGmap" data-mid="${esc(mid)}" data-gmap="${esc(v.gmap || '')}" style="background:${v.gmap ? '#fef3c7' : '#f3f4f6'};color:${v.gmap ? '#92400e' : '#6b7280'};">🗺️ ${v.gmap ? "지도수정" : "지도등록"}</button>
              <button class="btn btn-sm" type="button" data-act="setMerchantImage" data-mid="${esc(mid)}" data-imageurl="${esc(v.imageUrl || '')}" style="background:${v.imageUrl ? '#ede9fe' : '#f3f4f6'};color:${v.imageUrl ? '#5b21b6' : '#6b7280'};">🖼️ ${v.imageUrl ? "이미지수정" : "이미지등록"}</button>
            ` : ""}
          </div>
        </summary>
        <div class="expander-body">
          <div class="kv">
            <div class="k">merchantId</div><div class="v">${esc(mid)}</div>
            <div class="k">가게명</div><div class="v">${esc(fmt(v.name))}</div>
            <div class="k">구글 계정 (이메일)</div><div class="v" style="font-weight:600;color:var(--accent,#2563eb);">${esc(ownerEmail || "-")}</div>
            <div class="k">업종/카테고리</div><div class="v">${esc(fmt(v.career))}</div>
            <div class="k">활동지역</div><div class="v">${esc(fmt(v.region))}</div>
            <div class="k">소개/상세</div><div class="v">${esc(fmt(v.description))}</div>
            <div class="k">전화</div><div class="v">${esc(fmt(v.phone))}</div>
            <div class="k">카카오ID</div><div class="v">${esc(fmt(v.kakaoId))}</div>
            <div class="k">활성 여부</div><div class="v">${isDormant ? "😴 휴면" : v.active === false ? "비활성" : "활성"}</div>
            <div class="k">수수료 (feeBps)</div><div class="v">${esc(fmt(feeBps))} bps = ${feeBps / 100}%</div>
            <div class="k">ownerUid</div><div class="v" style="word-break:break-all;">${esc(fmt(v.ownerUid))}</div>
            <div class="k">ownerAddress</div><div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(fmt(v.ownerAddress))}</div>
            <div class="k">등록 txHash</div><div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(fmt(v.txHash))}</div>
            <div class="k">등록일 (createdAt)</div><div class="v">${esc(fmt(v.createdAt))}</div>
            <div class="k">승인일 (approvedAt)</div><div class="v">${esc(fmt(v.approvedAt))}</div>
          </div>
          ${isAdminUser ? `
          <div class="row-actions">
            <button class="btn btn-sm" type="button" data-act="renameMerchant" data-mid="${esc(mid)}" data-name="${esc(v.name || '')}">✏️ 이름변경</button>
            <button class="btn btn-sm" type="button" data-act="editMerchantInfo" data-mid="${esc(mid)}" data-career="${esc(v.career||'')}" data-region="${esc(v.region||'')}" data-desc="${esc(v.description||'')}">📝 정보수정</button>
            ${dormantBtn}
            <button class="btn btn-sm" type="button" data-act="approveMerchant" data-mid="${esc(mid)}" data-feebps="${feeBps}">수수료 설정</button>
            <button class="btn btn-sm" type="button" data-act="setMerchantGmap" data-mid="${esc(mid)}" data-gmap="${esc(v.gmap || '')}" style="background:#fef3c7;color:#92400e;">🗺️ 지도 URL 설정</button>
            <button class="btn btn-sm" type="button" data-act="setMerchantImage" data-mid="${esc(mid)}" data-imageurl="${esc(v.imageUrl || '')}" style="background:#ede9fe;color:#5b21b6;">🖼️ 이미지 URL 설정</button>
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

function parseGmapLatLng(url) {
  if (!url) return null;
  try {
    // @lat,lng 패턴 (구글지도 주소창 URL)
    const m1 = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
    // q=lat,lng 파라미터
    const u = new URL(url);
    const q = u.searchParams.get("q");
    if (q) {
      const m2 = q.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
  } catch { /* ignore */ }
  return null;
}

async function setMerchantGmap(mid, currentGmap) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const input = prompt(
    `[가맹점 ID: ${mid}] 구글 지도 URL 또는 위도,경도를 입력하세요.\n비우면 지도에서 제거됩니다.\n\n방법 1 — 구글지도 주소창 URL 복사 붙여넣기\n  (maps.app.goo.gl 단축 URL은 불가)\n\n방법 2 — 위도,경도 직접 입력\n  예: 21.0285,105.8542\n  (구글지도에서 원하는 위치를 오른쪽 클릭 → 좌표 복사)`,
    currentGmap || ""
  );
  if (input === null) return;

  const val = input.trim();

  // 비우면 삭제
  if (!val) {
    setState("지도 정보 삭제 중…");
    try {
      await updateDoc(doc(db, "merchants", mid), { gmap: null, lat: null, lng: null, updatedAt: serverTimestamp() });
      alert("지도 정보가 삭제되었습니다.");
      await loadMerchants();
      setState("지도 정보 삭제 완료");
    } catch (err) {
      alert("삭제 실패: " + (err.message || String(err)));
    }
    return;
  }

  let lat = null, lng = null, gmap = val;

  // URL에서 좌표 파싱 시도
  const parsed = parseGmapLatLng(val);
  if (parsed) {
    lat = parsed.lat;
    lng = parsed.lng;
  } else if (/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(val)) {
    // "위도,경도" 직접 입력
    const parts = val.split(",");
    lat = parseFloat(parts[0].trim());
    lng = parseFloat(parts[1].trim());
    gmap = `https://www.google.com/maps?q=${lat},${lng}`;
  } else {
    alert(
      "⚠️ 좌표를 파싱할 수 없습니다.\n\n" +
      "단축 URL(maps.app.goo.gl)은 지원하지 않습니다.\n\n" +
      "구글지도 주소창 전체 URL을 붙여넣거나,\n" +
      "위도,경도를 직접 입력하세요.\n예: 21.0285,105.8542"
    );
    return;
  }

  setState("지도 정보 저장 중…");
  try {
    await updateDoc(doc(db, "merchants", mid), { gmap, lat, lng, updatedAt: serverTimestamp() });
    alert(`저장 완료! 위도: ${lat}, 경도: ${lng}\n가맹점 지도에서 마커를 확인하세요.`);
    await loadMerchants();
    setState("지도 정보 저장 완료");
  } catch (err) {
    setState("지도 정보 저장 실패");
    console.error("setMerchantGmap:", err);
    alert("저장 실패: " + (err.message || String(err)));
  }
}

async function setMerchantImage(mid, currentUrl) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const val = prompt("이미지 URL을 입력하세요 (비우면 삭제):", currentUrl || "");
  if (val === null) return;

  try {
    await updateDoc(doc(db, "merchants", mid), {
      imageUrl: val.trim() || null,
      updatedAt: serverTimestamp(),
    });
    alert(val.trim() ? "이미지 URL이 저장되었습니다." : "이미지 URL이 삭제되었습니다.");
    await loadMerchants();
  } catch (err) {
    console.error("setMerchantImage:", err);
    alert("저장 실패: " + (err.message || String(err)));
  }
}

async function renameMerchant(mid, currentName) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const val = prompt("새 가게명을 입력하세요:", currentName || "");
  if (val === null) return;
  const name = val.trim();
  if (!name) { alert("가게명은 비울 수 없습니다."); return; }
  if (name === currentName) return;

  try {
    await updateDoc(doc(db, "merchants", mid), { name, updatedAt: serverTimestamp() });
    alert(`가게명이 "${name}"으로 변경되었습니다.`);
    await loadMerchants();
  } catch (err) {
    console.error("renameMerchant:", err);
    alert("저장 실패: " + (err.message || String(err)));
  }
}

async function toggleMerchantDormant(mid, isDormant) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const action = isDormant ? "활성화" : "휴면 처리";
  if (!confirm(`가맹점 ID ${mid}를 ${action}하시겠습니까?`)) return;

  try {
    await updateDoc(doc(db, "merchants", mid), {
      dormant: !isDormant,
      active: isDormant,   // 휴면→active:false, 활성화→active:true
      updatedAt: serverTimestamp(),
    });
    alert(`${action} 완료되었습니다.`);
    await loadMerchants();
  } catch (err) {
    console.error("toggleMerchantDormant:", err);
    alert("저장 실패: " + (err.message || String(err)));
  }
}

async function editMerchantInfo(mid, career, region, description) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }

  const dlgEdit   = $("dlgMerchantEdit");
  const inCareer  = $("meCareer");
  const inRegion  = $("meRegion");
  const inDesc    = $("meDesc");
  const btnClose  = $("dlgMerchantEditClose");
  const btnCancel = $("dlgMerchantEditCancel");
  const form      = $("frmMerchantEdit");
  if (!dlgEdit || !inCareer || !inRegion || !inDesc || !form) return;

  inCareer.value = career;
  inRegion.value = region;
  inDesc.value   = description;

  dlgEdit.showModal();
  inCareer.focus();

  await new Promise((resolve) => {
    function cleanup() {
      form.removeEventListener("submit", onSave);
      btnClose.removeEventListener("click", onCancel);
      btnCancel.removeEventListener("click", onCancel);
    }

    async function onSave(e) {
      e.preventDefault();
      const c = inCareer.value.trim();
      const r = inRegion.value.trim();
      const d = inDesc.value.trim();
      cleanup();
      dlgEdit.close();
      if (c === career && r === region && d === description) { resolve(); return; }
      try {
        setState("가맹점 정보 수정 중…");
        await updateDoc(doc(db, "merchants", mid), {
          career: c, region: r, description: d, updatedAt: serverTimestamp(),
        });
        alert("정보가 수정되었습니다.");
        await loadMerchants();
        setState("");
      } catch (err) {
        console.error("editMerchantInfo:", err);
        alert("수정 실패: " + (err.message || String(err)));
        setState("수정 실패");
      }
      resolve();
    }

    function onCancel() {
      cleanup();
      dlgEdit.close();
      resolve();
    }

    form.addEventListener("submit", onSave);
    btnClose.addEventListener("click", onCancel);
    btnCancel.addEventListener("click", onCancel);
  });
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

      <div class="k">컨트랙트 Point 잔액</div>
      <div class="v accent">${esc(d.contractHexDisplay)}${esc(fmtKrw(d.contractHexKrw))}</div>

      <div class="k">관리자 지갑 주소</div>
      <div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(d.adminAddress)}</div>

      <div class="k">관리자 Point 잔액</div>
      <div class="v">${esc(d.adminHexDisplay)}${esc(fmtKrw(d.adminHexKrw))}</div>

      <div class="k">관리자 BNB 잔액 (가스)</div>
      <div class="v">${esc(d.adminBnbDisplay)}</div>

      <div class="k">Point Allowance</div>
      <div class="v ${d.isMaxUint ? "accent" : ""}">${esc(d.ownerHexAllowanceDisplay)}</div>

      <div class="k">환율 (KRW/USD)</div>
      <div class="v muted">${d.krwPerUsd != null ? "₩" + d.krwPerUsd.toLocaleString() : "-"} (${esc(d.rateSource)})</div>
    `;
  } catch (err) {
    if (grid) grid.innerHTML = `<div class="k">오류</div><div class="v muted">${esc(err.message)}</div>`;
    console.error("loadContractStatus:", err);
  }
}

// ── Point 관리 탭 ──────────────────────────────────────────────────────────

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
    "jumpPlatform 컨트랙트에 Point 무한 승인(MaxUint256)을 실행합니다.\n" +
    "이 작업은 관리자 지갑에서 서명됩니다. 계속하시겠습니까?"
  );
  if (!ok) return;

  setState("Point approve 실행 중…");
  try {
    const fn = httpsCallable(functions, "adminApproveHex");
    const res = await fn({ amountWei: null });
    alert("Point approve 완료!\ntxHash: " + (res.data.txHash || "").slice(0, 22) + "…");
    await checkHexAllowance();
    setState("Point approve 완료");
  } catch (err) {
    setState("Point approve 실패");
    console.error("execApproveHex:", err);
    alert("Point approve 실패: " + err.message);
  }
}

// ── DAO 승인 탭 ───────────────────────────────────────────────────────────

async function loadDaoProposals() {
  if (!daoApproveList) return;
  daoApproveList.innerHTML = "";
  setState("DAO 승인 대기 목록 로딩중…");

  try {
    const q = query(
      collection(db, "dao_proposals"),
      where("status", "==", "pending_admin"),
      limit(100)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      setState("승인 대기 DAO 안건 없음");
      daoApproveList.innerHTML = '<p class="muted" style="padding:12px 0;">승인 대기 중인 안건이 없습니다.</p>';
      return;
    }

    setState(`DAO 승인 대기 ${snap.size}건`);
    const docs = snap.docs.sort((a, b) => {
      const ta = a.data().createdAt?.seconds ?? 0;
      const tb = b.data().createdAt?.seconds ?? 0;
      return tb - ta;
    });
    docs.forEach((d) => {
      const v  = d.data();
      const id = d.id;
      const dateStr = v.createdAt?.seconds
        ? new Date(v.createdAt.seconds * 1000).toLocaleString("ko")
        : "-";
      const shortWallet = v.authorWallet
        ? v.authorWallet.slice(0, 8) + "…" + v.authorWallet.slice(-4)
        : "-";

      const el = cardWrap(`
        <details class="expander" data-dao="${esc(id)}">
          <summary>
            <div class="sum-left">
              <div class="sum-title">${esc(v.title || "(제목없음)")}</div>
              <div class="sum-sub">${esc(shortWallet)} · ${esc(dateStr)}</div>
            </div>
            <div class="sum-right">
              <span class="badge">pending_admin</span>
              <button class="btn btn-sm" type="button" data-act="viewDao" data-id="${esc(id)}">상세(JSON)</button>
              <button class="btn btn-sm" type="button" data-act="approveDao" data-id="${esc(id)}">승인 (심의)</button>
              <button class="btn btn-sm" type="button" data-act="rejectDao" data-id="${esc(id)}">반려</button>
            </div>
          </summary>
          <div class="expander-body">
            <div class="kv">
              <div class="k">제목</div><div class="v">${esc(v.title || "-")}</div>
              <div class="k">내용</div><div class="v" style="white-space:pre-wrap;">${esc(v.content || "-")}</div>
              <div class="k">작성자 지갑</div><div class="v" style="font-family:monospace;font-size:12px;word-break:break-all;">${esc(v.authorWallet || "-")}</div>
              <div class="k">등록 시 스테이킹</div><div class="v">${esc(String(v.authorStaked || 0))} JUMP</div>
              <div class="k">등록일</div><div class="v">${esc(dateStr)}</div>
            </div>
            <div class="row-actions">
              <button class="btn btn-sm" type="button" data-act="approveDao" data-id="${esc(id)}">승인 (심의 단계로)</button>
              <button class="btn btn-sm" type="button" data-act="rejectDao" data-id="${esc(id)}">반려</button>
            </div>
          </div>
        </details>
      `);
      daoApproveList.appendChild(el);
    });
  } catch (err) {
    setState("로딩 실패: " + err.message);
    daoApproveList.innerHTML = `<p class="muted">오류: ${esc(err.message)}</p>`;
    console.error("loadDaoProposals:", err);
  }
}

async function approveDaoProposal(id) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  if (!confirm("이 안건을 승인하여 심의(review) 단계로 전환하시겠습니까?")) return;

  setState("DAO 안건 승인 중…");
  try {
    const fn  = httpsCallable(functions, "daoAdminApproveProposal");
    await fn({ proposalId: id });
    alert("승인 완료. 심의 단계로 전환되었습니다.");
    await loadDaoProposals();
    setState("DAO 승인 완료");
  } catch (err) {
    setState("DAO 승인 실패");
    console.error("approveDaoProposal:", err);
    alert("승인 실패: " + (err.message || String(err)));
  }
}

async function rejectDaoProposal(id) {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  if (!confirm("이 안건을 반려하시겠습니까?")) return;
  const reason = prompt("반려 사유를 입력하세요 (선택, 빈 칸도 가능):") ?? '';

  setState("DAO 안건 반려 중…");
  try {
    const fn  = httpsCallable(functions, "daoAdminRejectProposal");
    await fn({ proposalId: id, reason });
    alert("반려 처리되었습니다.");
    await loadDaoProposals();
    setState("DAO 반려 완료");
  } catch (err) {
    setState("DAO 반려 실패");
    console.error("rejectDaoProposal:", err);
    alert("반려 실패: " + (err.message || String(err)));
  }
}

daoApproveList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const id  = btn.dataset.id;
  try {
    if (act === "approveDao") {
      await approveDaoProposal(id);
    } else if (act === "rejectDao") {
      await rejectDaoProposal(id);
    } else if (act === "viewDao") {
      const snap = await getDoc(doc(db, "dao_proposals", id));
      if (!snap.exists()) return alert("안건을 찾을 수 없습니다.");
      openDialog("DAO 안건 상세(JSON)", { id, ...snap.data() });
    }
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});

btnReloadDao?.addEventListener("click", () => loadDaoProposals());

// ── 회원 목록 ─────────────────────────────────────────────────────────────

let _allUsers    = [];
let _userSearch  = "";
let _userFilter  = "all";
let _userSort    = "date_desc";
let _userSearchTimer = null;

async function loadUsersList() {
  if (!userList) return;
  userList.innerHTML = "<div class='muted'>불러오는 중...</div>";
  setState("회원 목록 로딩중…");

  try {
    const q = query(
      collection(db, "users"),
      limit(500)
    );
    const snap = await getDocs(q);
    _allUsers = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    setState(`전체 ${_allUsers.length}명`);
    renderUsersList();
  } catch (err) {
    setState("회원 목록 로딩 실패");
    userList.innerHTML = `<p class="muted">오류: ${esc(err.message)}</p>`;
    console.error("loadUsersList:", err);
  }
}

function renderUsersList() {
  if (!userList) return;
  const today = new Date().toISOString().slice(0, 10);
  const srch  = _userSearch.toLowerCase();

  const filtered = _allUsers.filter(u => {
    if (srch) {
      const hit = (u.name || "").toLowerCase().includes(srch) ||
                  (u.displayName || "").toLowerCase().includes(srch) ||
                  (u.email || "").toLowerCase().includes(srch) ||
                  (u.username ? ("@" + u.username).toLowerCase().includes(srch) : false);
      if (!hit) return false;
    }
    if (_userFilter === "telegram")    return u.source === "telegram";
    if (_userFilter === "member")      return !!(u.coopMemberUntil && u.coopMemberUntil > today);
    if (_userFilter === "blacklisted") return !!u.blacklisted;
    return true;
  });

  // 정렬
  const _ts = u => u.createdAt?.seconds ?? u.registeredAt?.seconds ?? 0;
  const _seen = u => u.lastSeenAt?.seconds ?? _ts(u);
  const _name = u => (u.name || u.displayName || "").toLowerCase();
  filtered.sort((a, b) => {
    if (_userSort === "date_asc")  return _ts(a) - _ts(b);
    if (_userSort === "seen_desc") return _seen(b) - _seen(a);
    if (_userSort === "name_asc")  return _name(a).localeCompare(_name(b), "ko");
    return _ts(b) - _ts(a); // date_desc (기본)
  });

  // 상단 카운트 표시
  const isTgFilter = _userFilter === "telegram";
  const tgTotal = isTgFilter ? filtered.length : filtered.filter(u => u.source === "telegram").length;
  const countLabel = isTgFilter
    ? `📱 텔레그램 ${filtered.length}명`
    : `전체 ${filtered.length}명 (텔레그램 ${tgTotal}명 포함)`;
  setState(countLabel);

  if (!filtered.length) {
    userList.innerHTML = '<p class="muted" style="padding:12px 0;">조건에 맞는 회원이 없습니다.</p>';
    return;
  }

  const html = filtered.map(u => {
    const uid      = u._id;
    const name     = esc(u.name || u.displayName || "(이름없음)");
    const email    = esc(u.email || "-");
    const wallet   = u.wallet?.address
      ? esc(u.wallet.address.slice(0, 6) + "…" + u.wallet.address.slice(-4))
      : "-";
    const role     = u.role || "user";
    const isMember = !!(u.coopMemberUntil && u.coopMemberUntil > today);
    const isBlack  = !!u.blacklisted;
    const isTg     = u.source === "telegram";

    const dateVal  = u.createdAt?.seconds ?? u.registeredAt?.seconds ?? null;
    const dateStr  = dateVal ? new Date(dateVal * 1000).toLocaleDateString("ko") : "-";
    const seenVal  = u.lastSeenAt?.seconds ?? null;
    const seenStr  = seenVal ? new Date(seenVal * 1000).toLocaleString("ko") : null;

    const roleBadge = role === "admin"
      ? '<span class="badge" style="background:#7c3aed;color:#fff;">관리자</span>'
      : role === "guide"
        ? '<span class="badge" style="background:#0284c7;color:#fff;">판매회원</span>'
        : '';
    const tgBadge    = isTg
      ? '<span class="badge" style="background:#229ed9;color:#fff;">📱 텔레그램</span>'
      : '';
    const memberBadge = isMember
      ? '<span class="badge" style="background:#16a34a;color:#fff;">👑 정회원</span>'
      : '';
    const blackBadge  = isBlack
      ? '<span class="badge" style="background:#dc2626;color:#fff;">⛔ 차단</span>'
      : '';
    const memberExp   = isMember
      ? `<div class="muted" style="font-size:11px;">정회원 만료: ${esc(u.coopMemberUntil)}</div>`
      : '';
    const tgInfo = isTg
      ? `<div class="muted" style="font-size:11px;">
           TG ID: ${esc(u.telegramId || "-")}
           ${u.username ? ` · @${esc(u.username)}` : ""}
           ${seenStr ? ` · 최근 접속: ${esc(seenStr)}` : ""}
         </div>`
      : (seenStr ? `<div class="muted" style="font-size:11px;">최근 접속: ${esc(seenStr)}</div>` : "");

    return `<div class="card" style="display:flex;gap:12px;align-items:center;padding:10px 14px;${isTg ? "border-left:3px solid #229ed9;" : ""}">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;">${name} ${tgBadge}${roleBadge}${memberBadge}${blackBadge}</div>
        <div class="muted" style="font-size:12px;margin-top:2px;">${email} · 가입: ${esc(dateStr)}</div>
        <div class="muted" style="font-size:11px;font-family:monospace;">UID: ${esc(uid)} · 지갑: ${wallet}</div>
        ${tgInfo}${memberExp}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
        <button class="btn btn-sm" data-act="viewUser"    data-uid="${esc(uid)}" style="font-size:12px;">상세</button>
        <button class="btn btn-sm" data-act="viewGp"      data-uid="${esc(uid)}" data-name="${name}" style="font-size:12px;background:#f0fdf4;border-color:#16a34a;color:#15803d;">🪙 GP 내역</button>
        <button class="btn btn-sm" data-act="chargeGp"    data-uid="${esc(uid)}" data-name="${name}" style="font-size:12px;background:#fffbeb;border-color:#d97706;color:#b45309;">💰 GP 충전</button>
      </div>
    </div>`;
  }).join("");

  userList.innerHTML = html;

  userList.querySelectorAll("[data-act='viewUser']").forEach(btn => {
    btn.addEventListener("click", () => {
      const uid = btn.dataset.uid;
      const u   = _allUsers.find(x => x._id === uid);
      if (!u) return;
      const { _id, ...data } = u;
      openDialog(`회원 상세 — ${u.name || u.displayName || u.email || uid}`, { uid: _id, ...data });
    });
  });

  userList.querySelectorAll("[data-act='viewGp']").forEach(btn => {
    btn.addEventListener("click", () => showGpHistory(btn.dataset.uid, btn.dataset.name));
  });

  userList.querySelectorAll("[data-act='chargeGp']").forEach(btn => {
    btn.addEventListener("click", () => showGpChargeModal(btn.dataset.uid, btn.dataset.name));
  });
}

// ── GP 내역 모달 ─────────────────────────────────────────────────────────────
async function showGpHistory(uid, userName) {
  // 기존 모달 제거
  document.getElementById("gpHistoryModal")?.remove();

  const TYPE_COLOR = {
    game:       "#3b82f6",
    topup:      "#16a34a",
    bonus:      "#f59e0b",
    membership: "#8b5cf6",
  };
  const TYPE_ICON = {
    game:       "🎮",
    topup:      "🎁",
    bonus:      "⭐",
    membership: "👑",
  };

  const modal = document.createElement("div");
  modal.id = "gpHistoryModal";
  modal.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);
    display:flex;align-items:center;justify-content:center;padding:16px;`;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(560px,100%);
      max-height:80vh;display:flex;flex-direction:column;
      box-shadow:0 8px 40px rgba(0,0,0,.2);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:16px 20px;border-bottom:1px solid #e5e7eb;">
        <div>
          <div style="font-size:16px;font-weight:700;">🪙 GP 내역 — ${esc(userName || uid)}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:2px;font-family:monospace;">${esc(uid)}</div>
        </div>
        <button id="gpHistoryClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px 8px;">✕</button>
      </div>
      <div id="gpHistoryBody" style="overflow-y:auto;padding:16px 20px;flex:1;">
        <div style="color:#6b7280;text-align:center;padding:24px;">불러오는 중...</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.querySelector("#gpHistoryClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

  const body = modal.querySelector("#gpHistoryBody");

  try {
    const fn   = httpsCallable(functions, "adminGetUserGpHistory");
    const res  = await fn({ targetUid: uid });
    const data = res.data;

    if (!data?.history?.length) {
      body.innerHTML = `<div style="color:#9ca3af;text-align:center;padding:24px;">
        현재 보유 GP: <strong>${(data?.currentGold || 0).toLocaleString()} GP</strong><br>
        <span style="font-size:12px;margin-top:8px;display:block;">기록된 내역이 없습니다.</span>
      </div>`;
      return;
    }

    // 요약 카드
    let html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;">
          <div style="font-size:11px;color:#16a34a;font-weight:600;">현재 보유 GP</div>
          <div style="font-size:20px;font-weight:800;color:#15803d;margin-top:4px;">
            ${(data.currentGold || 0).toLocaleString()}
          </div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 14px;">
          <div style="font-size:11px;color:#2563eb;font-weight:600;">누적 획득 GP</div>
          <div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-top:4px;">
            ${(data.totalEarned || 0).toLocaleString()}
          </div>
        </div>
      </div>
      <div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:8px;
        padding-bottom:6px;border-bottom:1px solid #f3f4f6;">
        내역 ${data.history.length}건
      </div>`;

    // 내역 테이블
    html += data.history.map(r => {
      const color = TYPE_COLOR[r.type] || "#6b7280";
      const icon  = TYPE_ICON[r.type]  || "•";
      const gpStr = r.gp > 0
        ? `<span style="font-weight:700;color:${color};">+${r.gp.toLocaleString()} GP</span>`
        : `<span style="color:#9ca3af;font-size:11px;">(GP 없음)</span>`;
      const extra = r.tonAmount
        ? `<span style="font-size:10px;color:#8b5cf6;margin-left:4px;">${r.tonAmount} TON · 만료: ${r.expiresAt || "-"}</span>`
        : "";
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;
          border-bottom:1px solid #f9fafb;">
          <span style="font-size:18px;flex-shrink:0;">${icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:#111;">
              ${esc(r.label)}${extra}
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-top:1px;">${esc(r.date)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">${gpStr}</div>
        </div>`;
    }).join("");

    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div style="color:#dc2626;padding:16px;">오류: ${esc(err.message)}</div>`;
  }
}

// ── GP 충전 모달 ──────────────────────────────────────────────────────────────
function showGpChargeModal(uid, userName) {
  document.getElementById("gpChargeModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "gpChargeModal";
  modal.style.cssText = `position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);
    display:flex;align-items:center;justify-content:center;padding:16px;`;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(420px,100%);
      box-shadow:0 8px 40px rgba(0,0,0,.25);overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#fffbeb;">
        <div>
          <div style="font-size:16px;font-weight:700;">💰 GP 충전</div>
          <div style="font-size:12px;color:#92400e;margin-top:2px;font-weight:600;">${esc(userName || uid)}</div>
          <div style="font-size:10px;color:#9ca3af;font-family:monospace;">${esc(uid)}</div>
        </div>
        <button id="gpChargeClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px 8px;">✕</button>
      </div>
      <div style="padding:20px;">
        <div id="gpChargeCurrentBal" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
          padding:10px 14px;font-size:13px;color:#15803d;font-weight:600;margin-bottom:16px;">
          현재 GP 조회 중...
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">충전 금액 (GP)</label>
          <input id="gpChargeAmount" type="number" min="1" max="10000000" step="1000"
            placeholder="예: 10000"
            style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;
              font-size:15px;font-weight:700;box-sizing:border-box;">
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
            ${[1000,5000,10000,50000,100000].map(v =>
              `<button class="gp-preset" data-v="${v}"
                style="padding:4px 10px;border:1px solid #d97706;border-radius:6px;background:#fffbeb;
                  color:#b45309;font-size:11px;font-weight:700;cursor:pointer;">
                +${v.toLocaleString()}
              </button>`
            ).join("")}
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">사유 (선택)</label>
          <input id="gpChargeNote" type="text" maxlength="200"
            placeholder="예: 이벤트 보상, CS 처리 등"
            style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;
              font-size:13px;box-sizing:border-box;">
        </div>
        <div id="gpChargeResult" style="display:none;padding:10px 14px;border-radius:8px;
          font-size:13px;font-weight:600;margin-bottom:12px;"></div>
        <button id="gpChargeConfirm"
          style="width:100%;padding:12px;border:none;border-radius:10px;font-size:15px;font-weight:700;
            cursor:pointer;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;">
          💰 충전 실행
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector("#gpChargeClose").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  // 프리셋 버튼
  modal.querySelectorAll(".gp-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const inp = modal.querySelector("#gpChargeAmount");
      inp.value = btn.dataset.v;
    });
  });

  // 현재 GP 조회
  const balEl = modal.querySelector("#gpChargeCurrentBal");
  httpsCallable(functions, "adminGetUserGpHistory")({ targetUid: uid })
    .then(r => {
      balEl.textContent = `현재 보유 GP: ${(r.data?.currentGold || 0).toLocaleString()} GP`;
    })
    .catch(() => { balEl.textContent = "현재 GP 조회 실패"; balEl.style.background = "#fef2f2"; });

  // 충전 실행
  modal.querySelector("#gpChargeConfirm").addEventListener("click", async () => {
    const amount = parseInt(modal.querySelector("#gpChargeAmount").value);
    const note   = modal.querySelector("#gpChargeNote").value.trim();
    const resEl  = modal.querySelector("#gpChargeResult");
    const btn    = modal.querySelector("#gpChargeConfirm");

    if (!amount || amount < 1) {
      resEl.style.cssText = "display:block;background:#fef2f2;border:1px solid #fca5a5;color:#dc2626;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:12px;";
      resEl.textContent = "충전 금액을 입력하세요.";
      return;
    }

    btn.disabled = true;
    btn.textContent = "처리 중...";
    resEl.style.display = "none";

    try {
      const fn = httpsCallable(functions, "adminChargeGp");
      const { data } = await fn({ targetUid: uid, amount, note });
      resEl.style.cssText = "display:block;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:12px;";
      resEl.textContent = `✅ 충전 완료! +${data.charged.toLocaleString()} GP → 잔액: ${data.newBalance.toLocaleString()} GP`;
      balEl.textContent = `현재 보유 GP: ${data.newBalance.toLocaleString()} GP`;
      modal.querySelector("#gpChargeAmount").value = "";
      modal.querySelector("#gpChargeNote").value = "";
    } catch (err) {
      resEl.style.cssText = "display:block;background:#fef2f2;border:1px solid #fca5a5;color:#dc2626;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:12px;";
      resEl.textContent = `오류: ${esc(err.message || "충전 실패")}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "💰 충전 실행";
    }
  });
}

{
  const inputSearch = $("inputUserSearch");
  const selFilter   = $("selUserFilter");
  const selSort     = $("selUserSort");
  const btnReload   = $("btnReloadUsers");

  inputSearch?.addEventListener("input", () => {
    clearTimeout(_userSearchTimer);
    _userSearchTimer = setTimeout(() => {
      _userSearch = (inputSearch.value || "").trim();
      renderUsersList();
    }, 350);
  });

  selFilter?.addEventListener("change", () => {
    _userFilter = selFilter.value;
    renderUsersList();
  });

  selSort?.addEventListener("change", () => {
    _userSort = selSort.value;
    renderUsersList();
  });

  btnReload?.addEventListener("click", () => loadUsersList());
}

// ── 탭 전환 ──────────────────────────────────────────────────────────────

function showTab(which) {
  if (tabGuides)    tabGuides.style.display    = which === "guides"    ? "" : "none";
  if (tabMerchants) tabMerchants.style.display = which === "merchants" ? "" : "none";
  if (tabItems)     tabItems.style.display     = which === "items"     ? "" : "none";
  if (tabDeposits)  tabDeposits.style.display  = which === "deposits"  ? "" : "none";
  if (tabHex)       tabHex.style.display       = which === "hex"       ? "" : "none";
  if (tabMembers)   tabMembers.style.display   = which === "members"   ? "" : "none";
  if (tabDao)       tabDao.style.display       = which === "dao"       ? "" : "none";
  if (tabTreasure)  tabTreasure.style.display  = which === "treasure"  ? "" : "none";
  if (tabChat)      tabChat.style.display      = which === "chat"      ? "" : "none";
  if (tabShops)     tabShops.style.display     = which === "shops"     ? "" : "none";

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
  btnTabMembers?.classList.toggle("is-active",   which === "members");
  btnTabDao?.classList.toggle("is-active",       which === "dao");
  btnTabTreasure?.classList.toggle("is-active",  which === "treasure");
  btnTabChat?.classList.toggle("is-active",      which === "chat");
  btnTabShops?.classList.toggle("is-active",     which === "shops");
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

  const validTab = ["guides", "merchants", "items", "deposits", "hex", "members", "dao", "chat"].includes(tab) ? tab : "guides";
  showTab(validTab);

  if (validTab === "merchants") {
    await loadMerchants();
  } else if (validTab === "items") {
    await loadItemsByStatus(selItemStatus?.value || "pending");
  } else if (validTab === "deposits") {
    await loadDeposits();
  } else if (validTab === "hex") {
    await Promise.all([loadContractStatus(), checkHexAllowance()]);
  } else if (validTab === "dao") {
    await loadDaoProposals();
  } else if (validTab === "members") {
    await loadUsersList();
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
btnTabMembers?.addEventListener("click", () => { showTab("members"); loadUsersList(); });
btnTabDao?.addEventListener("click", () => { showTab("dao"); loadDaoProposals(); });

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

// ── 온체인 지갑 연결 ──
$("btnConnectOwnerWallet")?.addEventListener("click", async () => {
  if (!window.ethereum) { alert("Rabby 또는 MetaMask가 설치되어 있지 않습니다."); return; }
  try {
    const provider = new BrowserProvider(window.ethereum, { chainId: 204, name: 'opBNB' });
    await provider.send('eth_requestAccounts', []);
    _ownerSigner = await provider.getSigner();
    const addr = await _ownerSigner.getAddress();
    const label = $("ownerWalletLabel");
    if (label) label.textContent = `연결됨: ${addr.slice(0,6)}…${addr.slice(-4)}`;
    $("btnConnectOwnerWallet").textContent = "✅ 연결됨";
  } catch (err) {
    alert("지갑 연결 실패: " + (err.message || ""));
  }
});

// ── 멘토 일괄 변경 (Rabby 서명) ──
$("btnBulkChangeMentor")?.addEventListener("click", async () => {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  if (!_ownerSigner) { alert("먼저 지갑을 연결하세요."); return; }

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
  btn.textContent = "주소 조회 중...";
  resultBox.style.display = "none";

  try {
    // Cloud Function으로 Firestore에서 대상 주소 목록만 조회
    const fn  = httpsCallable(functions, "adminGetMentorTargets");
    const res = await fn({ targetUids });
    const targets = res.data.targets;  // [{ uid, address }]

    const platform = new Contract(PLATFORM_ADDRESS, PLATFORM_OWNER_ABI, _ownerSigner);
    let updated = 0, skipped = 0, failed = 0;
    const failDetails = [];

    btn.textContent = `서명 중... (0/${targets.length})`;
    for (let i = 0; i < targets.length; i++) {
      const { uid, address } = targets[i];
      btn.textContent = `서명 중... (${i + 1}/${targets.length})`;
      try {
        const tx = await platform.adminChangeMentor(address, mentorAddress);
        await tx.wait();
        updated++;
      } catch (err) {
        if (err.code === 4001) throw err;  // 사용자 거절 → 전체 중단
        failed++;
        failDetails.push({ uid, error: err.reason || err.message });
      }
    }

    resultBox.style.display = "";
    resultBox.innerHTML = `
      <div style="color:var(--accent); font-weight:600;">✓ 완료</div>
      <div>변경됨: <strong>${updated}</strong>명 / 스킵: ${skipped}명 / 실패: ${failed}명</div>
      ${failDetails.length ? `<div style="color:#ef4444; margin-top:6px;">실패: ${JSON.stringify(failDetails)}</div>` : ""}
    `;
    setState(`멘토 일괄 변경 완료 — ${updated}명 업데이트`);
  } catch (err) {
    alert("실패: " + (err.message || String(err)));
    setState("멘토 일괄 변경 실패");
  } finally {
    btn.disabled = false;
    btn.textContent = "멘토 일괄 변경 실행";
  }
});

// ── 유저 레벨 설정 (Rabby 서명) ──
$("btnSetUserLevel")?.addEventListener("click", async () => {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  if (!_ownerSigner) { alert("먼저 지갑을 연결하세요."); return; }

  const emailOrUid = ($("inputSetLevelUser")?.value || "").trim();
  if (!emailOrUid) { alert("이메일 또는 UID를 입력하세요."); return; }

  const level = parseInt($("inputSetLevel")?.value || "0", 10);
  if (!level || level < 1 || level > 10) { alert("레벨은 1~10 사이 정수여야 합니다."); return; }

  const btn = $("btnSetUserLevel");
  const resultBox = $("setLevelResult");
  btn.disabled = true;
  btn.textContent = "주소 조회 중...";
  resultBox.style.display = "none";

  try {
    // Cloud Function으로 uid/이메일 → 지갑 주소 조회
    const fn  = httpsCallable(functions, "adminLookupUserAddress");
    const res = await fn({ emailOrUid });
    const { uid, address } = res.data;

    if (!confirm(`[${uid}]\n주소: ${address.slice(0,10)}…\n온체인 레벨을 ${level}로 설정합니다.\n계속하시겠습니까?`)) {
      btn.disabled = false;
      btn.textContent = "레벨 설정 실행";
      return;
    }

    btn.textContent = "서명 요청 중...";
    const platform = new Contract(PLATFORM_ADDRESS, PLATFORM_OWNER_ABI, _ownerSigner);
    const tx = await platform.adminSetLevel(address, level);
    btn.textContent = "Tx 확인 중...";
    const receipt = await tx.wait();

    resultBox.style.display = "";
    resultBox.innerHTML = `
      <div style="color:var(--accent); font-weight:600;">✓ 완료</div>
      <div>UID: ${esc(uid)}</div>
      <div>주소: <span style="font-family:monospace;font-size:12px;">${esc(address)}</span></div>
      <div>레벨: <strong>${level}</strong></div>
      <div>txHash: <span style="font-family:monospace;font-size:12px;">${esc(receipt.hash.slice(0, 30))}…</span></div>
    `;
    setState(`레벨 설정 완료 — ${uid} → Lv.${level}`);
  } catch (err) {
    alert("실패: " + (err.reason || err.message || String(err)));
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
    if (act === "renameMerchant") {
      await renameMerchant(mid, btn.dataset.name || "");
    } else if (act === "editMerchantInfo") {
      await editMerchantInfo(mid, btn.dataset.career || "", btn.dataset.region || "", btn.dataset.desc || "");
    } else if (act === "toggleDormant") {
      await toggleMerchantDormant(mid, btn.dataset.dormant === "1");
    } else if (act === "approveMerchant") {
      await approveMerchant(mid, Number(btn.dataset.feebps) || 0);
    } else if (act === "setMerchantGmap") {
      await setMerchantGmap(mid, btn.dataset.gmap || "");
    } else if (act === "setMerchantImage") {
      await setMerchantImage(mid, btn.dataset.imageurl || "");
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
      `P2P 기록 완료!\n수신 UID: ${d.uid}\n금액: ${d.amountHex} Point${krwStr}\n발신: ${(d.from || "").slice(0, 20)}…`
    );
    if ($("inputP2pTxHash")) $("inputP2pTxHash").value = "";
    setState("P2P 기록 완료");
  } catch (err) {
    setState("P2P 기록 실패");
    console.error("recordP2p:", err);
    alert("P2P 기록 실패: " + err.message);
  }
}

// ── 컨트랙트 Point 충전 ─────────────────────────────────────────────────────

async function execOwnerDepositHex() {
  if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
  const input     = $("inputOwnerDepositHex");
  const amountHex = parseFloat(input?.value || "0");
  if (!amountHex || amountHex <= 0) { alert("충전할 Point 수량을 입력하세요."); return; }

  // Point → wei (18 decimals)
  const amountWei = (BigInt(Math.round(amountHex * 1e9)) * BigInt(1e9)).toString();

  if (!confirm(`${amountHex} Point를 jumpPlatform 컨트랙트에 충전합니다.\n계속하시겠습니까?`)) return;

  setState("컨트랙트 Point 충전 중…");
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

// Point 관리 버튼
$("btnRefreshContractStatus")?.addEventListener("click", () => loadContractStatus());
$("btnOwnerDepositHex")?.addEventListener("click", () => execOwnerDepositHex());
$("btnCheckAllowance")?.addEventListener("click", () => checkHexAllowance());
$("btnApproveHex")?.addEventListener("click", () => execApproveHex());
$("btnRecordP2p")?.addEventListener("click", () => recordP2pTransferAction());

// ── 보물찾기 관리 ──────────────────────────────────────────────────────────

// ── 아이템 풀 편집기 ────────────────────────────────────────────────────────
let _boxItemPool = [];  // 현재 편집 중인 item pool

// 보물박스 목록 상태
let _allBoxes  = [];
let _boxPage   = 0;
const BOX_PAGE_SIZE = 20;

function syncItemPoolTextarea() {
  const ta = $("tBoxItemPool");
  if (ta) ta.value = JSON.stringify(_boxItemPool);
}

function renderItemPool() {
  const el = $("tBoxItemPoolDisplay");
  if (!el) return;
  if (_boxItemPool.length === 0) {
    el.innerHTML = "<div class='muted' style='font-size:12px;padding:4px 0;'>추가된 아이템 없음</div>";
    syncItemPoolTextarea();
    return;
  }
  el.innerHTML = _boxItemPool.map((entry, idx) => {
    const item = _cachedItems.find(i => i.id === String(entry.itemId));
    const label = item ? `#${entry.itemId} ${item.name}` : `#${entry.itemId}`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;background:#f1f5f9;border-radius:6px;font-size:12px;">
      <span style="flex:1;font-weight:600;">${esc(label)}</span>
      <span class="muted">가중치 <strong>${entry.weight}</strong></span>
      <button type="button" class="btn btn-sm" data-poolidx="${idx}" data-act="removePoolItem"
        style="padding:2px 8px;font-size:11px;background:#ef4444;color:#fff;">✕</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-act='removePoolItem']").forEach(btn => {
    btn.addEventListener("click", () => {
      _boxItemPool.splice(Number(btn.dataset.poolidx), 1);
      renderItemPool();
    });
  });
  syncItemPoolTextarea();
}

function populateItemSelect() {
  const sel = $("tBoxItemSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">아이템 선택...</option>' +
    _cachedItems.map(i => `<option value="${esc(i.id)}">#${esc(i.id)} ${esc(i.name)}</option>`).join("");
}

async function loadTreasureItemsList() {
  const el = $("treasureItemList");
  if (!el) return;
  el.innerHTML = "<div class='muted'>불러오는 중...</div>";
  const snap = await getDocs(collection(db, "treasure_items"));
  _cachedItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  populateItemSelect();
  if (snap.empty) { el.innerHTML = "<div class='muted'>등록된 아이템 없음</div>"; return; }
  el.innerHTML = snap.docs.map(d => {
    const r = d.data();
    return `<div class="card" style="display:flex;gap:12px;align-items:center;">
      <div style="flex:1;">
        <strong>#${esc(d.id)}</strong> ${esc(r.name)}
        <span class="muted" style="font-size:12px;margin-left:6px;">(${esc(r.image || "")})</span>
        ${r.description ? `<div class="muted" style="font-size:12px;">${esc(r.description)}</div>` : ""}
      </div>
      <button class="btn btn-sm" data-act="editItem"
        data-id="${esc(d.id)}" data-name="${esc(r.name)}"
        data-image="${esc(r.image||"")}" data-desc="${esc(r.description||"")}">수정</button>
      <button class="btn btn-sm" data-act="deleteItem"
        data-id="${esc(d.id)}" data-name="${esc(r.name)}"
        style="background:#ef4444;color:#fff;">삭제</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-act='editItem']").forEach(btn => {
    btn.addEventListener("click", () => {
      $("tItemId").value    = btn.dataset.id;
      $("tItemName").value  = btn.dataset.name;
      $("tItemImage").value = btn.dataset.image;
      $("tItemDesc").value  = btn.dataset.desc;
    });
  });
  el.querySelectorAll("[data-act='deleteItem']").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`"${btn.dataset.name}" (${btn.dataset.id}) 을(를) 삭제하시겠습니까?`)) return;
      try {
        await deleteDoc(doc(db, "treasure_items", btn.dataset.id));
        await loadTreasureItemsList();
      } catch (err) { alert("삭제 오류: " + (err.message || err)); }
    });
  });
}

async function loadTreasureBoxesList() {
  const el = $("treasureBoxList");
  if (!el) return;
  el.innerHTML = "<div class='muted'>불러오는 중...</div>";
  const snap = await getDocs(collection(db, "treasure_boxes"));
  _allBoxes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _boxPage = 0;
  renderBoxPage();
}

function _getFilteredBoxes() {
  const q   = ($("tBoxSearch")?.value || "").trim().toLowerCase();
  const srt = $("tBoxSortSel")?.value || "name";
  const activeOnly = $("tBoxFilterActive")?.checked;
  let list = _allBoxes.filter(b => {
    if (activeOnly && b.active === false) return false;
    if (!q) return true;
    return (b.name || "").toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
  });
  list.sort((a, b) => {
    if (srt === "active") return (b.active !== false ? 1 : 0) - (a.active !== false ? 1 : 0);
    if (srt === "member") return (b.memberOnly ? 1 : 0) - (a.memberOnly ? 1 : 0);
    if (srt === "scan")   return (b.scanRadius ?? 100) - (a.scanRadius ?? 100);
    return (a.name || "").localeCompare(b.name || "");
  });
  return list;
}

function _fillBoxForm(b, keepId) {
  if ($("tBoxId")) $("tBoxId").value = keepId ? b.id : "";
  if ($("tBoxName")) $("tBoxName").value = b.name || "";
  if ($("tBoxCoords")) $("tBoxCoords").value = b.lat && b.lng ? `${b.lat}, ${b.lng}` : "";
  const prev = $("tBoxCoordsPreview");
  if (prev) { prev.textContent = b.lat ? `위도 ${Number(b.lat).toFixed(6)}, 경도 ${Number(b.lng).toFixed(6)}` : ""; prev.style.color = "#16a34a"; }
  _updateBoxMap(b.lat && b.lng ? { lat: Number(b.lat), lng: Number(b.lng) } : null);
  if ($("tBoxStartHour")) $("tBoxStartHour").value = b.startHour ?? 0;
  if ($("tBoxEndHour"))   $("tBoxEndHour").value   = b.endHour   ?? 24;
  _boxItemPool = Array.isArray(b.itemPool)
    ? b.itemPool.map(e => (typeof e === 'string' ? { itemId: e, weight: 1 } : e))
    : [];
  renderItemPool();
  if ($("tBoxActive"))      $("tBoxActive").value      = String(b.active !== false);
  if ($("tBoxMemberOnly"))  $("tBoxMemberOnly").value  = String(b.memberOnly === true);
  if ($("tBoxHiddenBox"))   $("tBoxHiddenBox").value   = String(b.hiddenBox === true);
  if ($("tBoxKeyId"))       $("tBoxKeyId").value       = b.keyId || "";
  if ($("tBoxClaimRadius")) $("tBoxClaimRadius").value = b.radius     ?? 30;
  if ($("tBoxScanRadius"))  $("tBoxScanRadius").value  = b.scanRadius ?? 100;
  const kRow = $("tBoxKeyIdRow"), kVal = $("tBoxKeyIdVal");
  if (kRow && kVal) { const show = b.hiddenBox === true; kRow.style.display = show ? "" : "none"; kVal.style.display = show ? "" : "none"; }
}

function renderBoxPage() {
  const el    = $("treasureBoxList");
  const pager = $("treasureBoxPager");
  if (!el) return;

  const filtered   = _getFilteredBoxes();
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / BOX_PAGE_SIZE));
  _boxPage = Math.min(_boxPage, totalPages - 1);
  const pageItems  = filtered.slice(_boxPage * BOX_PAGE_SIZE, (_boxPage + 1) * BOX_PAGE_SIZE);

  if (!pageItems.length) {
    el.innerHTML = "<div class='muted'>해당 조건의 박스 없음</div>";
    if (pager) pager.innerHTML = "";
    return;
  }

  el.innerHTML = pageItems.map(b => {
    const active = b.active !== false;
    return `<div class="card" style="display:flex;gap:12px;align-items:center;">
      <div style="flex:1;min-width:0;">
        <strong>${esc(b.name || "(이름없음)")}</strong>
        <span class="muted" style="font-size:12px;margin-left:6px;">${active ? "✅ 활성" : "❌ 비활성"}${b.memberOnly ? " · 👑 정회원" : ""}${b.hiddenBox ? " · 🔮 숨김" : ""}${b.keyId ? ` · 🔑 Key ${esc(String(b.keyId))}` : ""} · ${(b.lat||0).toFixed(5)}, ${(b.lng||0).toFixed(5)} · ${b.startHour ?? 0}:00~${b.endHour ?? 24}:00</span>
        <div class="muted" style="font-size:11px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;">${esc(b.id)}</div>
      </div>
      <button class="btn btn-sm" data-act="copyBox"   data-id="${esc(b.id)}" title="이 박스를 복사해 새 박스로 등록">복사</button>
      <button class="btn btn-sm" data-act="editBox"   data-id="${esc(b.id)}">수정</button>
      <button class="btn btn-sm" data-act="deleteBox" data-id="${esc(b.id)}" style="color:var(--danger,#e53e3e);">비활성화</button>
    </div>`;
  }).join("");

  el.querySelectorAll("[data-act='editBox']").forEach(btn => {
    const b = pageItems.find(x => x.id === btn.dataset.id);
    if (b) btn.addEventListener("click", () => _fillBoxForm(b, true));
  });

  el.querySelectorAll("[data-act='copyBox']").forEach(btn => {
    const b = pageItems.find(x => x.id === btn.dataset.id);
    if (b) btn.addEventListener("click", () => {
      _fillBoxForm(b, false);
      if ($("tBoxName")) $("tBoxName").value = (b.name || "") + " (복사)";
    });
  });

  el.querySelectorAll("[data-act='deleteBox']").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 박스를 비활성화하시겠습니까?")) return;
      try {
        await httpsCallable(functions, "adminDeleteTreasureBox")({ boxId: btn.dataset.id });
        await loadTreasureBoxesList();
      } catch (err) { alert("오류: " + (err.message || err)); }
    });
  });

  if (pager) {
    const start = _boxPage * BOX_PAGE_SIZE + 1;
    const end   = Math.min((_boxPage + 1) * BOX_PAGE_SIZE, total);
    pager.innerHTML = `
      <button class="btn btn-sm" id="tBoxPrevPage" ${_boxPage === 0 ? "disabled" : ""}>◀</button>
      <span style="font-size:12px;">${start}–${end} / 총 ${total}개</span>
      <button class="btn btn-sm" id="tBoxNextPage" ${_boxPage >= totalPages - 1 ? "disabled" : ""}>▶</button>`;
    $("tBoxPrevPage")?.addEventListener("click", () => { _boxPage--; renderBoxPage(); });
    $("tBoxNextPage")?.addEventListener("click", () => { _boxPage++; renderBoxPage(); });
  }
}

async function loadVouchersList() {
  const el = $("voucherMgmtList");
  if (!el) return;
  el.innerHTML = "<div class='muted'>불러오는 중...</div>";
  const snap = await getDocs(collection(db, "treasure_vouchers"));
  if (snap.empty) { el.innerHTML = "<div class='muted'>등록된 바우처 없음</div>"; return; }
  el.innerHTML = snap.docs.map(d => {
    const r = d.data();
    return `<div class="card" style="display:flex;gap:12px;align-items:center;">
      <div style="flex:1;">
        <strong>${esc(r.name)}</strong> ${r.active !== false ? "✅" : "❌"}
        <div class="muted" style="font-size:12px;">${esc(r.reward || "")}${r.gpRewardMin > 0 ? ` · 🪙GP ${r.gpRewardMin}~${r.gpRewardMax || r.gpRewardMin}` : ""}${r.image ? ` · 🖼 ${esc(r.image)}` : ""}${r.minCoins ? ` · 💰≥${r.minCoins}` : ""}${r.minLevel ? ` · LV≥${r.minLevel}` : ""}</div>
        <div class="muted" style="font-size:11px;font-family:monospace;">${esc(d.id)}</div>
      </div>
      <button class="btn btn-sm" data-act="editVoucher" data-id="${esc(d.id)}">수정</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-act='editVoucher']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const s = await getDoc(doc(db, "treasure_vouchers", btn.dataset.id));
      if (!s.exists()) return;
      const r = s.data();
      $("tVoucherId").value        = btn.dataset.id;
      $("tVoucherName").value      = r.name   || "";
      $("tVoucherReqs").value      = JSON.stringify(r.requirements || [], null, 2);
      $("tVoucherReward").value    = r.reward || "";
      $("tVoucherGpMin").value     = r.gpRewardMin || 0;
      $("tVoucherGpMax").value     = r.gpRewardMax || 0;
      $("tVoucherImage").value     = r.image  || "";
      $("tVoucherMinCoins").value  = r.minCoins || 0;
      $("tVoucherMinLevel").value  = r.minLevel || 0;
      $("tVoucherActive").value    = String(r.active !== false);
    });
  });
}

$("btnSaveTreasureItem")?.addEventListener("click", async () => {
  const itemId = $("tItemId")?.value.trim();
  const name   = $("tItemName")?.value.trim();
  if (!itemId || !name) return alert("아이템 ID와 이름은 필수입니다.");
  try {
    await httpsCallable(functions, "adminSaveTreasureItem")({
      itemId,
      name,
      image:       $("tItemImage")?.value.trim() || `${itemId}.png`,
      description: $("tItemDesc")?.value.trim()  || "",
    });
    alert("아이템 저장 완료!");
    ["tItemId","tItemName","tItemImage","tItemDesc"].forEach(id => { const e=$(`${id}`); if(e) e.value=""; });
    await loadTreasureItemsList();
  } catch (err) { alert("오류: " + (err.message || err)); }
});

function parseCoords(str) {
  // "20.948991, 105.974279" 또는 "20.948991 105.974279" 등 허용
  const m = String(str || "").trim().match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

// 좌표 미리보기 지도
let _boxMap = null;
let _boxMarker = null;

function _updateBoxMap(c) {
  const el = $("tBoxMapPreview");
  if (!el) return;
  if (!c) { el.style.display = "none"; return; }
  el.style.display = "block";
  if (!_boxMap) {
    _boxMap = L.map(el, { zoomControl: true, attributionControl: false }).setView([c.lat, c.lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(_boxMap);
    _boxMarker = L.marker([c.lat, c.lng]).addTo(_boxMap);
    // 지도 클릭 → 좌표 자동 입력
    _boxMap.on('click', function(e) {
      const lat = parseFloat(e.latlng.lat.toFixed(7));
      const lng = parseFloat(e.latlng.lng.toFixed(7));
      _boxMarker.setLatLng([lat, lng]);
      const coordsEl = $('tBoxCoords');
      if (coordsEl) coordsEl.value = `${lat}, ${lng}`;
      const preview = $('tBoxCoordsPreview');
      if (preview) {
        preview.textContent = `위도 ${lat.toFixed(6)}, 경도 ${lng.toFixed(6)}`;
        preview.style.color = '#16a34a';
      }
    });
  } else {
    _boxMap.setView([c.lat, c.lng], 17);
    _boxMarker.setLatLng([c.lat, c.lng]);
    // 컨테이너가 숨겨졌다가 표시될 때 타일 갱신
    _boxMap.invalidateSize();
  }
}

function _initBoxMapDefault() {
  if (_boxMap) { _boxMap.invalidateSize(); return; }
  _updateBoxMap({ lat: 20.9488, lng: 105.9743 });
}

// 좌표 입력 시 실시간 미리보기
$("tBoxCoords")?.addEventListener("input", () => {
  const preview = $("tBoxCoordsPreview");
  if (!preview) return;
  const c = parseCoords($("tBoxCoords")?.value);
  preview.textContent = c ? `위도 ${c.lat.toFixed(6)}, 경도 ${c.lng.toFixed(6)}` : "좌표 형식 오류";
  preview.style.color = c ? "#16a34a" : "#dc2626";
  _updateBoxMap(c);
});

$("tBoxItemAdd")?.addEventListener("click", () => {
  const sel = $("tBoxItemSelect");
  const wtEl = $("tBoxItemWeight");
  const itemId = sel?.value;
  if (!itemId) return alert("아이템을 선택하세요.");
  const weight = Math.max(1, parseInt(wtEl?.value || "10", 10) || 10);
  const exists = _boxItemPool.find(e => String(e.itemId) === String(itemId));
  if (exists) { exists.weight = weight; }
  else { _boxItemPool.push({ itemId, weight }); }
  renderItemPool();
  if (sel) sel.value = "";
  if (wtEl) wtEl.value = "10";
});

$("btnSaveTreasureBox")?.addEventListener("click", async () => {
  const coords = parseCoords($("tBoxCoords")?.value);
  if (!coords) return alert("좌표를 입력해 주세요.\n예: 20.948991, 105.974279");
  const itemPool = _boxItemPool.slice();
  try {
    const res = await httpsCallable(functions, "adminSaveTreasureBox")({
      boxId:     $("tBoxId")?.value.trim() || undefined,
      name:      $("tBoxName")?.value.trim() || "",
      lat: coords.lat, lng: coords.lng,
      startHour: Number($("tBoxStartHour")?.value) || 0,
      endHour:   Number($("tBoxEndHour")?.value)   || 24,
      itemPool,
      active:      $("tBoxActive")?.value === "true",
      memberOnly:  $("tBoxMemberOnly")?.value === "true",
      hiddenBox:   $("tBoxHiddenBox")?.value === "true",
      keyId:       $("tBoxKeyId")?.value.trim() || null,
      radius:      Number($("tBoxClaimRadius")?.value) || 30,
      scanRadius:  Number($("tBoxScanRadius")?.value)  || 100,
    });
    alert(`박스 저장 완료!\nboxId: ${res.data.boxId}`);
    _boxItemPool = [];
    renderItemPool();
    ["tBoxId","tBoxName","tBoxCoords","tBoxKeyId"].forEach(id => { const e=$(id); if(e) e.value=""; });
    const prev = $("tBoxCoordsPreview"); if (prev) prev.textContent = "";
    _updateBoxMap(null);
    if ($("tBoxStartHour"))   $("tBoxStartHour").value   = "0";
    if ($("tBoxEndHour"))     $("tBoxEndHour").value     = "24";
    if ($("tBoxActive"))      $("tBoxActive").value      = "true";
    if ($("tBoxMemberOnly"))  $("tBoxMemberOnly").value  = "false";
    if ($("tBoxHiddenBox"))   $("tBoxHiddenBox").value   = "false";
    if ($("tBoxClaimRadius")) $("tBoxClaimRadius").value = "30";
    if ($("tBoxScanRadius"))  $("tBoxScanRadius").value  = "100";
    const kRow = $("tBoxKeyIdRow"), kVal = $("tBoxKeyIdVal");
    if (kRow) kRow.style.display = "none"; if (kVal) kVal.style.display = "none";
    await loadTreasureBoxesList();
  } catch (err) { alert("오류: " + (err.message || err)); }
});

$("btnSaveVoucher")?.addEventListener("click", async () => {
  const name = $("tVoucherName")?.value.trim();
  if (!name) return alert("바우처 이름은 필수입니다.");
  let requirements = [];
  try   { requirements = JSON.parse($("tVoucherReqs")?.value || "[]"); }
  catch { return alert('재료 JSON 오류\n예: [{"itemId":"1","count":3}]'); }
  const minCoins   = parseInt($("tVoucherMinCoins")?.value || "0", 10) || 0;
  const minLevel   = parseInt($("tVoucherMinLevel")?.value || "0", 10) || 0;
  const gpRewardMin = parseInt($("tVoucherGpMin")?.value || "0", 10) || 0;
  const gpRewardMax = Math.max(gpRewardMin, parseInt($("tVoucherGpMax")?.value || "0", 10) || 0);
  if (gpRewardMin > 0 && gpRewardMax < gpRewardMin)
    return alert("GP 최댓값은 최솟값보다 크거나 같아야 합니다.");
  try {
    const res = await httpsCallable(functions, "adminSaveVoucher")({
      voucherId:    $("tVoucherId")?.value.trim() || undefined,
      name,
      requirements,
      reward:       $("tVoucherReward")?.value.trim() || "",
      gpRewardMin,
      gpRewardMax,
      image:        $("tVoucherImage")?.value.trim()  || "",
      minCoins,
      minLevel,
      active: $("tVoucherActive")?.value === "true",
    });
    const gpInfo = gpRewardMin > 0 ? ` (GP 보상: ${gpRewardMin}~${gpRewardMax})` : "";
    alert(`바우처 저장 완료!\nvoucherId: ${res.data.voucherId}${gpInfo}`);
    ["tVoucherId","tVoucherName","tVoucherReqs","tVoucherReward","tVoucherGpMin","tVoucherGpMax","tVoucherImage","tVoucherMinCoins","tVoucherMinLevel"].forEach(id => { const e=$(`${id}`); if(e) e.value=""; });
    if ($("tVoucherActive")) $("tVoucherActive").value = "true";
    await loadVouchersList();
  } catch (err) { alert("오류: " + (err.message || err)); }
});

async function loadTreasureKeysList() {
  const el = $("treasureKeyList");
  if (!el) return;
  el.innerHTML = "<div class='muted'>불러오는 중...</div>";
  const snap = await getDocs(collection(db, "treasure_keys"));
  if (snap.empty) { el.innerHTML = "<div class='muted'>등록된 열쇠 없음</div>"; return; }
  el.innerHTML = snap.docs.map(d => {
    const r = d.data();
    return `<div class="card" style="display:flex;gap:12px;align-items:center;">
      <div style="flex:1;">
        <strong>🔑 ${esc(r.name || "(이름없음)")}</strong>
        <span class="muted" style="font-size:12px;margin-left:6px;">Key ID: ${esc(d.id)} · 드랍율: ${((r.dropRate||0)*100).toFixed(1)}% · ${r.active !== false ? "✅ 활성" : "❌ 비활성"}</span>
      </div>
      <button class="btn btn-sm" data-act="editKey" data-id="${esc(d.id)}">수정</button>
      <button class="btn btn-sm" data-act="deleteKey" data-id="${esc(d.id)}" style="color:var(--danger,#e53e3e);">비활성화</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-act='editKey']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const s = await getDoc(doc(db, "treasure_keys", btn.dataset.id));
      if (!s.exists()) return;
      const r = s.data();
      if ($("tKeyId"))       $("tKeyId").value       = btn.dataset.id;
      if ($("tKeyName"))     $("tKeyName").value     = r.name  || "";
      if ($("tKeyDropRate")) $("tKeyDropRate").value = r.dropRate ?? 0.1;
      if ($("tKeyActive"))   $("tKeyActive").value   = String(r.active !== false);
    });
  });
  el.querySelectorAll("[data-act='deleteKey']").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Key ID ${btn.dataset.id} 열쇠를 비활성화하시겠습니까?`)) return;
      try {
        await httpsCallable(functions, "adminDeleteTreasureKey")({ keyId: btn.dataset.id });
        await loadTreasureKeysList();
      } catch (err) { alert("오류: " + (err.message || err)); }
    });
  });
}

$("btnSaveTreasureKey")?.addEventListener("click", async () => {
  const keyId = $("tKeyId")?.value.trim();
  if (!keyId) return alert("Key ID는 필수입니다.");
  const dropRate = parseFloat($("tKeyDropRate")?.value || "0.1");
  if (isNaN(dropRate) || dropRate < 0 || dropRate > 1) return alert("드랍 확률은 0~1 사이 숫자를 입력하세요.");
  try {
    await httpsCallable(functions, "adminSaveTreasureKey")({
      keyId,
      name:     $("tKeyName")?.value.trim()  || "",
      dropRate,
      active:   $("tKeyActive")?.value !== "false",
    });
    alert("열쇠 저장 완료!");
    ["tKeyId","tKeyName"].forEach(id => { const e=$(`${id}`); if(e) e.value=""; });
    if ($("tKeyDropRate")) $("tKeyDropRate").value = "0.1";
    if ($("tKeyActive"))   $("tKeyActive").value   = "true";
    await loadTreasureKeysList();
  } catch (err) { alert("오류: " + (err.message || err)); }
});

// 숨김 보물박스 선택 시 열쇠 Key ID 입력 필드 표시/숨김
$("tBoxHiddenBox")?.addEventListener("change", () => {
  const isHidden = $("tBoxHiddenBox")?.value === "true";
  const kRow = $("tBoxKeyIdRow"), kVal = $("tBoxKeyIdVal");
  if (kRow) kRow.style.display = isHidden ? "" : "none";
  if (kVal) kVal.style.display = isHidden ? "" : "none";
  if (!isHidden && $("tBoxKeyId")) $("tBoxKeyId").value = "";
});

$("btnReloadTItems")?.addEventListener("click",    () => loadTreasureItemsList());
$("btnReloadTBoxes")?.addEventListener("click",    () => loadTreasureBoxesList());
$("tBoxSearch")?.addEventListener("input",  () => { _boxPage = 0; renderBoxPage(); });
$("tBoxSortSel")?.addEventListener("change", () => { _boxPage = 0; renderBoxPage(); });
$("tBoxFilterActive")?.addEventListener("change", () => { _boxPage = 0; renderBoxPage(); });
$("btnReloadTVouchers")?.addEventListener("click", () => loadVouchersList());
$("btnReloadTKeys")?.addEventListener("click",     () => loadTreasureKeysList());
btnTabTreasure?.addEventListener("click", () => {
  showTab("treasure");
  _initBoxMapDefault();
  loadTreasureItemsList();
  loadTreasureBoxesList();
  loadVouchersList();
  loadTreasureKeysList();
});
btnTabChat?.addEventListener("click", () => showTab("chat"));
btnTabShops?.addEventListener("click", () => { showTab("shops"); window._adminLoadShops?.(); });

// ── 무기 등록 ──────────────────────────────────────────────────────────────────
function updateWeaponPreview() {
  const bonus = $("wBonusSelect")?.value;
  const img   = $("wPreview");
  if (!img || !bonus) return;
  img.src = `/assets/images/weapon/${bonus}.png`;
  img.style.display = "";
  img.onerror = () => { img.style.display = "none"; };
}
$("wBonusSelect")?.addEventListener("change", updateWeaponPreview);
updateWeaponPreview();

$("btnSaveWeapon")?.addEventListener("click", async () => {
  const bonus  = $("wBonusSelect")?.value;
  const name   = $("wName")?.value.trim();
  const result = $("wSaveResult");
  if (!name) { alert("무기 이름을 입력하세요."); return; }
  try {
    if (result) { result.textContent = "저장 중..."; result.style.color = ""; }
    await httpsCallable(functions, "adminSaveTreasureItem")({
      itemId:      `weapon_${bonus}`,
      name,
      image:       `${bonus}.png`,
      description: `추가공격력 +${bonus} (총공격력 ${100 + parseInt(bonus)})`,
      category:    "weapon",
    });
    if (result) { result.textContent = `✅ weapon_${bonus} 저장 완료`; result.style.color = "#16a34a"; }
    if ($("wName")) $("wName").value = "";
    await loadTreasureItemsList();
  } catch (err) {
    if (result) { result.textContent = "❌ " + (err.message || err); result.style.color = "#dc2626"; }
  }
});

// ── 방어구 등록 ────────────────────────────────────────────────────────────────
function updateArmorPreview() {
  const def    = $("aBonusSelect")?.value;
  const img    = $("aPreview");
  if (!img || !def) return;
  const folder = Math.floor(parseInt(def) / 10);
  img.src = `/assets/images/armo/${folder}/${def}.png`;
  img.style.display = "";
  img.onerror = () => { img.style.display = "none"; };
}
$("aBonusSelect")?.addEventListener("change", updateArmorPreview);
updateArmorPreview();

$("btnSaveArmor")?.addEventListener("click", async () => {
  const def    = $("aBonusSelect")?.value;
  const name   = $("aName")?.value.trim();
  const result = $("aSaveResult");
  const folder = Math.floor(parseInt(def) / 10);
  if (!name) { alert("방어구 이름을 입력하세요."); return; }
  try {
    if (result) { result.textContent = "저장 중..."; result.style.color = ""; }
    await httpsCallable(functions, "adminSaveTreasureItem")({
      itemId:      `armo_${def}`,
      name,
      image:       `armo_${def}.png`,
      description: `방어력 ${def} (몬스터 피해 -${def})`,
      category:    "armor",
      armoFolder:  folder,
    });
    if (result) { result.textContent = `✅ armo_${def} 저장 완료`; result.style.color = "#16a34a"; }
    if ($("aName")) $("aName").value = "";
    await loadTreasureItemsList();
  } catch (err) {
    if (result) { result.textContent = "❌ " + (err.message || err); result.style.color = "#dc2626"; }
  }
});

// ── 유저 직접 지급 ─────────────────────────────────────────────────────────────
$("btnGrantItem")?.addEventListener("click", async () => {
  const target  = $("grantTarget")?.value.trim();
  const itemId  = $("grantItemId")?.value.trim();
  const count   = parseInt($("grantCount")?.value) || 1;
  const result  = $("grantResult");
  if (!target) { alert("유저 이메일 또는 UID를 입력하세요."); return; }
  if (!itemId) { alert("아이템 ID를 입력하세요."); return; }
  if (!confirm(`${target} 에게\n${itemId} × ${count}개\n지급하시겠습니까?`)) return;
  try {
    if (result) { result.textContent = "처리 중..."; result.style.color = ""; }
    const isUid   = !target.includes("@");
    const payload = isUid
      ? { targetUid: target,   itemId, count }
      : { targetEmail: target, itemId, count };
    const res = await httpsCallable(functions, "adminGrantItem")(payload);
    if (result) {
      result.textContent = `✅ ${res.data.uid} 에게 ${itemId} × ${count}개 지급 완료`;
      result.style.color = "#16a34a";
    }
  } catch (err) {
    if (result) { result.textContent = "❌ " + (err.message || err); result.style.color = "#dc2626"; }
  }
});

// ── 블랙리스트 관리 ──────────────────────────────────────────────────────────
{
  let _blacklistTargetUid = null;

  const inputEl    = $("inputBlacklistUser");
  const infoBox    = $("blacklistUserInfo");
  const resultBox  = $("blacklistResult");
  const btnSearch  = $("btnBlacklistSearch");
  const btnAdd     = $("btnBlacklistAdd");
  const btnRemove  = $("btnBlacklistRemove");

  function showBlacklistInfo(data) {
    if (!infoBox) return;
    const isBlocked = !!data.blacklisted || !!data.authDisabled;
    infoBox.style.display = "";
    infoBox.innerHTML = `
      <div><strong>${esc(data.name || "-")}</strong> &nbsp;
        <span style="font-size:12px; color:#64748b;">${esc(data.email || "-")}</span>
        ${isBlocked
          ? '<span style="margin-left:8px;padding:2px 8px;border-radius:99px;background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;">블랙리스트</span>'
          : '<span style="margin-left:8px;padding:2px 8px;border-radius:99px;background:#dcfce7;color:#16a34a;font-size:11px;font-weight:700;">정상</span>'}
      </div>
      <div style="margin-top:4px; font-size:12px; color:#94a3b8;">
        UID: ${esc(data.uid || "-")}<br>
        지갑: <span style="font-family:monospace;">${esc(data.walletAddress || "없음")}</span>
      </div>`;
    if (btnAdd)    btnAdd.style.display    = isBlocked ? "none" : "";
    if (btnRemove) btnRemove.style.display = isBlocked ? ""     : "none";
  }

  btnSearch?.addEventListener("click", async () => {
    if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
    const emailOrUid = (inputEl?.value || "").trim();
    if (!emailOrUid) { alert("이메일 또는 UID를 입력하세요."); return; }

    btnSearch.disabled = true;
    btnSearch.textContent = "조회 중...";
    if (infoBox)   infoBox.style.display = "none";
    if (resultBox) resultBox.style.display = "none";
    if (btnAdd)    btnAdd.style.display = "none";
    if (btnRemove) btnRemove.style.display = "none";
    _blacklistTargetUid = null;

    try {
      const fn  = httpsCallable(functions, "adminGetUserInfo");
      const res = await fn({ emailOrUid });
      const d   = res.data;
      _blacklistTargetUid = d.uid;
      showBlacklistInfo(d);
    } catch (err) {
      alert("조회 실패: " + (err.message || err));
    } finally {
      btnSearch.disabled = false;
      btnSearch.textContent = "조회";
    }
  });

  async function doBlacklist(blocked) {
    if (!isAdminUser) { alert("관리자 권한이 없습니다."); return; }
    if (!_blacklistTargetUid) { alert("먼저 유저를 조회하세요."); return; }
    const label = blocked ? "블랙리스트 등록" : "블랙리스트 해제";
    if (!confirm(`[${_blacklistTargetUid}]\n${label} 하시겠습니까?`)) return;

    const btn = blocked ? btnAdd : btnRemove;
    if (btn) { btn.disabled = true; btn.textContent = "처리 중..."; }
    if (resultBox) resultBox.style.display = "none";

    try {
      const fn  = httpsCallable(functions, "adminSetBlacklist");
      const res = await fn({ emailOrUid: _blacklistTargetUid, blocked });
      const d   = res.data;
      if (resultBox) {
        resultBox.style.display = "";
        resultBox.innerHTML = `
          <div style="color:${blocked ? "#dc2626" : "#16a34a"};font-weight:700;">
            ✓ ${blocked ? "블랙리스트 등록 완료" : "블랙리스트 해제 완료"}
          </div>
          <div>이름: ${esc(d.name || "-")} &nbsp; 이메일: ${esc(d.email || "-")}</div>
          ${d.txHash ? `<div>txHash: <span style="font-family:monospace;font-size:11px;">${esc(d.txHash.slice(0, 30))}…</span></div>` : ""}`;
      }
      // 버튼 전환
      showBlacklistInfo({ ...d, blacklisted: blocked, authDisabled: blocked });
      setState(`${label} 완료 — ${d.uid}`);
    } catch (err) {
      alert("실패: " + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  btnAdd?.addEventListener("click",    () => doBlacklist(true));
  btnRemove?.addEventListener("click", () => doBlacklist(false));
}

onAuthReady(async ({ loggedIn, user }) => {
  if (!loggedIn || !user) {
    setState("로그인 필요");
    return;
  }
  await bootAdmin(user);
});
