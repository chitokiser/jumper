// /assets/js/pages/events.invite.js - 친구초대 BT 이벤트 (events.html 전용)
// 초대 인원 집계와 BT 지급은 모두 서버(functions/handlers/friendInvite.js)에서 한다. 이 파일은 표시와 호출만 한다.
import { functions } from "/assets/js/firebase-init.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

const fnCreate = httpsCallable(functions, "createFriendInviteEvent");
const fnUpdate = httpsCallable(functions, "updateFriendInviteEvent");
const fnCharge = httpsCallable(functions, "chargeFriendInvitePool");
const fnStatus = httpsCallable(functions, "getFriendInviteStatus");

const QR_LIB = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";

let _user = null;
let _isAdmin = false;
let _campaign = null;
let _onChanged = null;
let _qrLibPromise = null;

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function errMsg(err) {
  return (err && (err.message || err.details)) || "요청을 처리하지 못했습니다.";
}

function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!_qrLibPromise) {
    _qrLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = QR_LIB;
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error("QR 라이브러리 없음")));
      s.onerror = () => { _qrLibPromise = null; reject(new Error("QR 라이브러리를 불러오지 못했습니다.")); };
      document.head.appendChild(s);
    });
  }
  return _qrLibPromise;
}

async function qrDataUrl(text) {
  const qrcode = await loadQrLib();
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 2);
}

function inviteLink(email, campaignId) {
  const u = new URL("/register.html", location.origin);
  u.searchParams.set("mentor", email);
  u.searchParams.set("invite", campaignId);
  return u.href;
}

/** 상세 모달 안의 친구초대 섹션 */
async function renderDetail(campaign) {
  _campaign = campaign;
  const box = $("detailInviteSection");
  if (!box) return;
  box.style.display = "block";
  box.innerHTML = `<div class="ev-review-empty">⏳ 친구초대 이벤트 정보를 불러오는 중입니다...</div>`;

  let st;
  try {
    st = (await fnStatus({ campaignId: campaign.id })).data;
  } catch (err) {
    box.innerHTML = `<div class="ev-review-empty">이벤트 정보를 불러오지 못했습니다: ${esc(errMsg(err))}</div>`;
    return;
  }
  if (_campaign?.id !== campaign.id) return; // 그새 다른 카드를 열었음

  const ev = st.event || {};
  const per = Number(ev.perFriends || 3);
  const reward = Number(ev.rewardBt || 1);
  const cap = Number(ev.maxBtPerUser || 0);
  const pool = Math.max(0, Number(ev.btPool || 0));
  const paused = ev.status !== "active" || campaign.status === "paused";
  const mine = st.mine;

  let mineHtml;
  if (!_user) {
    mineHtml = `<div class="ev-zalo-done ev-zalo-done--off">🔒 로그인하면 내 초대 QR을 받을 수 있습니다.</div>`;
  } else if (paused) {
    mineHtml = `<div class="ev-zalo-done ev-zalo-done--off">⏸️ 이벤트가 일시 중단되었습니다. 지금 가입한 친구는 초대로 세지 않습니다.</div>`;
  } else if (!mine?.email) {
    mineHtml = `<div class="ev-zalo-done ev-zalo-done--off">회원 정보에 이메일이 없어 초대 QR을 만들 수 없습니다.</div>`;
  } else {
    const link = inviteLink(mine.email, campaign.id);
    const progressPct = Math.round(((per - mine.toNext) / per) * 100);
    mineHtml = `
      <div class="ev-invite-mine">
        <div class="ev-invite-qr" id="inviteQrBox">⏳ QR 만드는 중...</div>
        <div class="ev-invite-info">
          <div class="ev-invite-stat"><span>초대한 친구</span><b>${Number(mine.invitedCount || 0).toLocaleString()}명</b></div>
          <div class="ev-invite-stat"><span>받은 BT</span><b>${Number(mine.paidBt || 0).toLocaleString()} BT</b></div>
          ${mine.capReached
            ? `<div class="ev-invite-next">🎉 1인 최대 ${cap} BT를 모두 받으셨습니다.</div>`
            : `<div class="ev-invite-next">다음 ${reward} BT까지 친구 <b>${mine.toNext}명</b> 남음</div>
               <div class="ev-invite-bar"><i style="width:${progressPct}%"></i></div>`}
          ${mine.pendingBt > 0 ? `<div class="ev-invite-pending">⏳ 준비된 BT가 부족해 ${mine.pendingBt} BT 지급이 밀려 있습니다. 충전되면 이 화면을 열 때 지급됩니다.</div>` : ""}
          ${mine.paidNow > 0 ? `<div class="ev-invite-paid">🎁 밀려 있던 ${mine.paidNow} BT가 방금 지급되었습니다!</div>` : ""}
        </div>
      </div>
      <div class="ev-zalo-row">
        <input id="inpInviteLink" class="ev-input" type="text" readonly value="${esc(link)}" />
        <button id="btnInviteCopy" class="ev-btn-admin ev-btn-admin--edit" type="button">🔗 링크 복사</button>
        ${navigator.share ? `<button id="btnInviteShare" class="ev-btn-admin ev-btn-admin--toggle" type="button">📤 공유</button>` : ""}
      </div>`;
  }

  box.innerHTML = `
    <div class="ev-review-header">
      <div class="ev-review-title-row">
        <span class="ev-review-badge ev-zalo-badge">👥 친구초대 이벤트 · ${per}명당 ${reward} BT</span>
        <span class="ev-review-count">남은 BT ${pool.toLocaleString()}</span>
      </div>
      <p class="ev-review-guide">
        아래 <b>내 초대 QR</b>을 친구에게 보여 주거나 링크를 보내 주세요.<br/>
        친구가 그 링크로 베스트클럽에 <b>새로 가입</b>하면 초대 1명으로 세고, <b>${per}명마다 ${reward} BT</b>가 자동으로 지급됩니다.
        ${cap > 0 ? `(1인 최대 ${cap} BT)` : ""}
      </p>
    </div>
    ${mineHtml}
    <div id="inviteAdminPanel"></div>
  `;

  if (mine?.email && !paused && _user) {
    const link = inviteLink(mine.email, campaign.id);
    qrDataUrl(link).then((src) => {
      const qb = $("inviteQrBox");
      if (qb) qb.innerHTML = `<img src="${src}" alt="내 친구초대 QR 코드" /><span>친구가 휴대폰 카메라로 스캔</span>`;
    }).catch((err) => {
      const qb = $("inviteQrBox");
      if (qb) qb.textContent = errMsg(err);
    });
    const btnCopy = $("btnInviteCopy");
    if (btnCopy) btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        btnCopy.textContent = "✅ 복사됨";
      } catch (_) {
        prompt("링크를 복사하세요", link);
      }
    };
    const btnShare = $("btnInviteShare");
    if (btnShare) btnShare.onclick = () => {
      navigator.share({ title: "베스트클럽 가입 초대", text: "베스트클럽에 가입하고 혜택을 받아 보세요!", url: link }).catch(() => {});
    };
  }

  if (mine?.paidNow > 0 && _onChanged) _onChanged();
  if (_isAdmin && st.admin) renderAdminPanel(campaign, ev, st.admin);
}

function renderAdminPanel(campaign, ev, a) {
  const wrap = $("inviteAdminPanel");
  if (!wrap) return;
  const paused = ev.status !== "active";
  wrap.innerHTML = `
    <div class="ev-zalo-admin">
      <div class="ev-zalo-admin-head">🛡️ 친구초대 이벤트 관리자</div>
      <div class="ev-zalo-stats">
        <div><span>남은 풀</span><b>${Number(ev.btPool || 0).toLocaleString()} BT</b></div>
        <div><span>총 충전</span><b>${Number(a.btCharged || 0).toLocaleString()} BT</b></div>
        <div><span>지급 완료</span><b>${Number(a.btPaid || 0).toLocaleString()} BT</b></div>
        <div><span>초대 가입</span><b>${Number(a.inviteCount || 0).toLocaleString()}명 (초대자 ${Number(a.inviterCount || 0).toLocaleString()}명)</b></div>
      </div>
      <div class="ev-zalo-row">
        <input id="inpInviteCharge" class="ev-input" type="number" min="1" step="1" placeholder="충전할 BT" />
        <button id="btnInviteCharge" class="ev-btn-admin ev-btn-admin--edit" type="button">➕ 풀 충전</button>
        <button id="btnInviteToggle" class="ev-btn-admin ev-btn-admin--toggle" type="button">${paused ? "▶️ 다시 시작" : "⏸️ 일시 중단"}</button>
      </div>
      <p class="ev-zalo-hint">초대 많이 한 회원 (최대 30명)</p>
      <div class="ev-zalo-codes">
        ${a.inviters.length ? a.inviters.map((r) => `
          <div class="ev-zalo-code"><code>${esc(r.name || r.email || "-")}</code><span>${esc(r.email)} · 초대 ${r.invitedCount}명 · ${r.paidBt} BT</span></div>
        `).join("") : `<div class="ev-review-empty">아직 초대로 가입한 회원이 없습니다.</div>`}
      </div>
    </div>`;

  $("btnInviteCharge").onclick = async () => {
    const amount = Math.floor(Number($("inpInviteCharge").value));
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
  $("btnInviteToggle").onclick = async () => {
    try {
      await fnUpdate({ campaignId: campaign.id, status: paused ? "active" : "paused" });
      renderDetail(campaign);
    } catch (err) {
      alert(`❌ ${errMsg(err)}`);
    }
  };
}

function hideDetail() {
  _campaign = null;
  const box = $("detailInviteSection");
  if (box) {
    box.style.display = "none";
    box.innerHTML = "";
  }
}

function openCreateModal() {
  const m = $("inviteCreateModal");
  if (!m) return;
  m.classList.add("active");
  m.setAttribute("aria-hidden", "false");
}

function closeCreateModal() {
  const m = $("inviteCreateModal");
  if (!m) return;
  m.classList.remove("active");
  m.setAttribute("aria-hidden", "true");
}

async function handleCreate(e) {
  e.preventDefault();
  const btn = $("btnInviteCreateSubmit");
  if (btn) btn.disabled = true;
  try {
    await fnCreate({
      title: $("inpInviteTitle").value,
      perFriends: Number($("inpInvitePer").value || 3),
      rewardBt: Number($("inpInviteReward").value || 1),
      maxBtPerUser: Number($("inpInviteMax").value || 0),
      initialPool: Number($("inpInvitePool").value || 0),
    });
    alert("✅ 친구초대 이벤트를 등록했습니다.");
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
  const btnOpen = $("btnOpenInviteCreate");
  if (btnOpen) btnOpen.onclick = openCreateModal;
  const btnClose = $("btnInviteCreateClose");
  if (btnClose) btnClose.onclick = closeCreateModal;
  const form = $("inviteCreateForm");
  if (form) form.addEventListener("submit", handleCreate);
}

function setAuth(user, isAdmin) {
  _user = user || null;
  _isAdmin = !!isAdmin;
  const btnOpen = $("btnOpenInviteCreate");
  if (btnOpen) btnOpen.style.display = _isAdmin ? "inline-flex" : "none";
  if (_campaign) renderDetail(_campaign);
}

export const InviteEvent = { init, setAuth, renderDetail, hideDetail };
