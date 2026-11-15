// /assets/js/pages/events.zalo.js - Zalo 친구추가 BT 보상 이벤트 (events.html 전용)
// 지급·풀·코드 판정은 모두 서버(functions/handlers/zaloFriend.js)에서 한다. 이 파일은 표시와 호출만 한다.
import { db, functions } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

const fnCreate = httpsCallable(functions, "createZaloFriendEvent");
const fnUpdate = httpsCallable(functions, "updateZaloFriendEvent");
const fnCharge = httpsCallable(functions, "chargeZaloFriendPool");
const fnGenCodes = httpsCallable(functions, "generateZaloFriendCodes");
const fnClaim = httpsCallable(functions, "claimZaloFriendBt");

let _user = null;
let _isAdmin = false;
let _campaign = null;
let _onChanged = null;

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function errMsg(err) {
  return (err && (err.message || err.details)) || "요청을 처리하지 못했습니다.";
}

function fmtTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    return d ? d.toLocaleString("ko-KR") : "-";
  } catch (_) {
    return "-";
  }
}

async function loadEvent(campaignId) {
  const snap = await getDoc(doc(db, "zalo_friend_events", campaignId));
  return snap.exists() ? snap.data() : null;
}

async function loadMyClaim(campaignId) {
  if (!_user) return null;
  try {
    const snap = await getDoc(doc(db, "zalo_friend_claims", `${campaignId}_${_user.uid}`));
    return snap.exists() ? snap.data() : null;
  } catch (_) {
    return null;
  }
}

/** 상세 모달 안의 Zalo 섹션 렌더 */
async function renderDetail(campaign) {
  _campaign = campaign;
  const box = $("detailZaloSection");
  if (!box) return;
  box.style.display = "block";
  box.innerHTML = `<div class="ev-review-empty">⏳ Zalo 이벤트 정보를 불러오는 중입니다...</div>`;

  let ev = null;
  try {
    ev = await loadEvent(campaign.id);
  } catch (err) {
    box.innerHTML = `<div class="ev-review-empty">이벤트 정보를 불러오지 못했습니다: ${esc(errMsg(err))}</div>`;
    return;
  }
  if (_campaign?.id !== campaign.id) return; // 그새 다른 카드를 열었음
  if (!ev) {
    box.innerHTML = `<div class="ev-review-empty">이벤트 설정이 없습니다.</div>`;
    return;
  }

  const myClaim = await loadMyClaim(campaign.id);
  if (_campaign?.id !== campaign.id) return;

  const rewardBt = Number(ev.rewardBt || 1);
  const pool = Math.max(0, Number(ev.btPool || 0));
  const soldOut = pool < rewardBt;
  const paused = ev.status !== "active" || campaign.status !== "active";

  let claimHtml;
  if (myClaim) {
    claimHtml = `<div class="ev-zalo-done">✅ ${esc(fmtTime(myClaim.createdAt))}에 <b>${Number(myClaim.rewardBt || rewardBt)} BT</b>를 받으셨습니다. (1계정 1회)</div>`;
  } else if (paused) {
    claimHtml = `<div class="ev-zalo-done ev-zalo-done--off">⏸️ 이벤트가 일시 중단되었습니다.</div>`;
  } else if (soldOut) {
    claimHtml = `<div class="ev-zalo-done ev-zalo-done--off">준비된 BT가 모두 소진되어 이벤트가 마감되었습니다.</div>`;
  } else if (!_user) {
    claimHtml = `<div class="ev-zalo-done ev-zalo-done--off">🔒 로그인 후 코드를 입력할 수 있습니다.</div>`;
  } else {
    claimHtml = `
      <form id="zaloClaimForm" class="ev-review-form">
        <label class="ev-label" for="inpZaloCode">② Zalo 메시지로 받은 코드 입력</label>
        <input id="inpZaloCode" class="ev-input ev-zalo-code-input" maxlength="14" autocomplete="off"
               placeholder="ZL-XXXX-XXXX" required />
        <button id="btnZaloClaim" type="submit" class="ev-btn ev-btn--primary ev-btn--full" style="margin-top:10px;">
          🎁 ${rewardBt} BT 무료로 받기
        </button>
      </form>`;
  }

  box.innerHTML = `
    <div class="ev-review-header">
      <div class="ev-review-title-row">
        <span class="ev-review-badge ev-zalo-badge">💬 Zalo 친구추가 이벤트 (1계정 1회)</span>
        <span class="ev-review-count">남은 BT ${pool.toLocaleString()}</span>
      </div>
      <p class="ev-review-guide">
        ① 운영자 Zalo <b>${esc(ev.zaloName || "")}</b>를 친구추가하세요.<br/>
        운영자가 확인 후 Zalo 메시지로 <b>일회용 코드</b>를 보내 드립니다. 코드를 입력하면 <b>${rewardBt} BT</b>가 무료로 바로 지급됩니다.
      </p>
      ${ev.qrImageUrl ? `
        <div class="ev-zalo-qr">
          ${ev.zaloUrl ? `<a href="${esc(ev.zaloUrl)}" target="_blank" rel="noopener noreferrer">` : ""}
            <img src="${esc(ev.qrImageUrl)}" alt="운영자 Zalo QR 코드" loading="lazy" />
          ${ev.zaloUrl ? `</a>` : ""}
          <span>${ev.zaloUrl ? "QR을 누르거나" : "Zalo 앱에서"} 스캔해서 친구추가하세요</span>
        </div>` : ""}
      ${ev.zaloUrl ? `
        <a class="ev-btn-gmap ev-btn-zalo" href="${esc(ev.zaloUrl)}" target="_blank" rel="noopener noreferrer">
          💬 Zalo 친구추가 하러 가기 &nearr;
        </a>` : ""}
    </div>
    ${claimHtml}
    <div id="zaloAdminPanel"></div>
  `;

  const form = $("zaloClaimForm");
  if (form) form.addEventListener("submit", (e) => handleClaim(e, campaign));

  if (_isAdmin) renderAdminPanel(campaign, ev);
}

async function handleClaim(e, campaign) {
  e.preventDefault();
  const inp = $("inpZaloCode");
  const btn = $("btnZaloClaim");
  const code = (inp?.value || "").trim();
  if (!code) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ 확인 중...";
  }
  try {
    const res = await fnClaim({ campaignId: campaign.id, code });
    alert(`🎉 ${res.data.btReceived} BT가 지급되었습니다!\n마이페이지에서 BT 룰렛을 돌려 보세요.`);
    if (_onChanged) _onChanged();
    renderDetail(campaign);
  } catch (err) {
    alert(`❌ ${errMsg(err)}`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🎁 BT 무료로 받기 (다시 시도)";
    }
  }
}

/** 관리자 패널: 풀 충전, 코드 발급, 코드/수령 내역 */
async function renderAdminPanel(campaign, ev) {
  const wrap = $("zaloAdminPanel");
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="ev-zalo-admin">
      <div class="ev-zalo-admin-head">🛡️ Zalo 이벤트 관리자</div>
      <div class="ev-zalo-stats">
        <div><span>남은 풀</span><b>${Number(ev.btPool || 0).toLocaleString()} BT</b></div>
        <div><span>총 충전</span><b>${Number(ev.btCharged || 0).toLocaleString()} BT</b></div>
        <div><span>지급 완료</span><b>${Number(ev.claimCount || 0).toLocaleString()}명 / ${Number(ev.btPaid || 0).toLocaleString()} BT</b></div>
        <div><span>1인 지급</span><b>${Number(ev.rewardBt || 1)} BT</b></div>
      </div>
      <div class="ev-zalo-row">
        <input id="inpZaloCharge" class="ev-input" type="number" min="1" step="1" placeholder="충전할 BT" />
        <button id="btnZaloCharge" class="ev-btn-admin ev-btn-admin--edit" type="button">➕ 풀 충전</button>
      </div>
      <div class="ev-zalo-row">
        <input id="inpZaloCodeCount" class="ev-input" type="number" min="1" max="50" step="1" value="5" />
        <button id="btnZaloGen" class="ev-btn-admin ev-btn-admin--toggle" type="button">🔑 코드 만들기</button>
      </div>
      <div class="ev-zalo-row">
        <input id="inpZaloEditUrl" class="ev-input" type="url" value="${esc(ev.zaloUrl || "")}" placeholder="Zalo 링크 (선택)" />
        <input id="inpZaloEditQr" class="ev-input" type="text" value="${esc(ev.qrImageUrl || "")}" placeholder="QR 이미지 주소 (선택)" />
        <button id="btnZaloSaveUrl" class="ev-btn-admin ev-btn-admin--edit" type="button">💾 저장</button>
      </div>
      <p class="ev-zalo-hint">친구추가를 확인한 회원에게 아래 미사용 코드 하나를 Zalo 메시지로 보내세요. 코드는 한 번만 쓸 수 있습니다.</p>
      <div id="zaloCodeList" class="ev-zalo-codes">⏳ 코드 목록을 불러오는 중...</div>
    </div>
  `;

  $("btnZaloCharge").onclick = async () => {
    const amount = Math.floor(Number($("inpZaloCharge").value));
    if (!amount || amount < 1) return alert("충전할 BT를 입력해 주세요.");
    if (!confirm(`이 이벤트 풀에 ${amount.toLocaleString()} BT를 충전할까요?`)) return;
    try {
      await fnCharge({ campaignId: campaign.id, amount });
      if (_onChanged) _onChanged();
      renderDetail(campaign);
    } catch (err) {
      alert(`❌ ${errMsg(err)}`);
    }
  };

  $("btnZaloGen").onclick = async () => {
    const count = Math.floor(Number($("inpZaloCodeCount").value)) || 1;
    try {
      const res = await fnGenCodes({ campaignId: campaign.id, count });
      const codes = res.data.codes || [];
      try { await navigator.clipboard.writeText(codes.join("\n")); } catch (_) {}
      alert(`🔑 코드 ${codes.length}개를 만들었습니다 (클립보드에 복사됨)\n\n${codes.join("\n")}`);
      renderCodeList(campaign);
    } catch (err) {
      alert(`❌ ${errMsg(err)}`);
    }
  };

  $("btnZaloSaveUrl").onclick = async () => {
    try {
      await fnUpdate({ campaignId: campaign.id, zaloUrl: $("inpZaloEditUrl").value, qrImageUrl: $("inpZaloEditQr").value });
      alert("✅ Zalo 링크/QR을 저장했습니다.");
      renderDetail(campaign);
    } catch (err) {
      alert(`❌ ${errMsg(err)}`);
    }
  };

  renderCodeList(campaign);
}

async function renderCodeList(campaign) {
  const el = $("zaloCodeList");
  if (!el) return;
  try {
    const snap = await getDocs(query(collection(db, "zalo_friend_codes"), where("campaignId", "==", campaign.id)));
    const rows = [];
    snap.forEach((d) => rows.push(d.data()));
    rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "unused" ? -1 : 1));
    if (!rows.length) {
      el.innerHTML = `<div class="ev-review-empty">아직 만든 코드가 없습니다.</div>`;
      return;
    }
    el.innerHTML = rows.map((r) => r.status === "unused"
      ? `<div class="ev-zalo-code"><code>${esc(r.code)}</code><button type="button" class="ev-zalo-copy" data-code="${esc(r.code)}">복사</button></div>`
      : `<div class="ev-zalo-code is-used"><code>${esc(r.code)}</code><span>사용됨 · ${esc(r.usedByEmail || r.usedBy || "")} · ${esc(fmtTime(r.usedAt))}</span></div>`
    ).join("");
    el.querySelectorAll(".ev-zalo-copy").forEach((b) => {
      b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.code);
          b.textContent = "복사됨";
        } catch (_) {
          prompt("코드를 복사하세요", b.dataset.code);
        }
      };
    });
  } catch (err) {
    el.innerHTML = `<div class="ev-review-empty">코드 목록을 불러오지 못했습니다: ${esc(errMsg(err))}</div>`;
  }
}

function hideDetail() {
  _campaign = null;
  const box = $("detailZaloSection");
  if (box) {
    box.style.display = "none";
    box.innerHTML = "";
  }
}

/** 이벤트 만들기 모달 (최고 관리자) */
function openCreateModal() {
  const m = $("zaloCreateModal");
  if (!m) return;
  m.classList.add("active");
  m.setAttribute("aria-hidden", "false");
}

function closeCreateModal() {
  const m = $("zaloCreateModal");
  if (!m) return;
  m.classList.remove("active");
  m.setAttribute("aria-hidden", "true");
}

async function handleCreate(e) {
  e.preventDefault();
  const btn = $("btnZaloCreateSubmit");
  if (btn) btn.disabled = true;
  try {
    await fnCreate({
      zaloUrl: $("inpZaloUrl").value,
      qrImageUrl: $("inpZaloQr") ? $("inpZaloQr").value : "",
      zaloName: $("inpZaloName").value,
      rewardBt: Number($("inpZaloReward").value || 1),
      initialPool: Number($("inpZaloPool").value || 0),
      title: $("inpZaloTitle").value,
    });
    alert("✅ Zalo 친구추가 이벤트를 등록했습니다.");
    e.target.reset();
    closeCreateModal();
    if (_onChanged) _onChanged();
  } catch (err) {
    alert(`❌ ${errMsg(err)}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function init({ onChanged } = {}) {
  _onChanged = onChanged || null;
  const btnOpen = $("btnOpenZaloCreate");
  if (btnOpen) btnOpen.onclick = openCreateModal;
  const btnClose = $("btnZaloCreateClose");
  if (btnClose) btnClose.onclick = closeCreateModal;
  const form = $("zaloCreateForm");
  if (form) form.addEventListener("submit", handleCreate);
}

function setAuth(user, isAdmin) {
  _user = user || null;
  _isAdmin = !!isAdmin;
  const btnOpen = $("btnOpenZaloCreate");
  if (btnOpen) btnOpen.style.display = _isAdmin ? "inline-flex" : "none";
  if (_campaign) renderDetail(_campaign);
}

export const ZaloEvent = { init, setAuth, renderDetail, hideDetail };
