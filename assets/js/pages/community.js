// /assets/js/pages/community.js
// 소셜 커뮤니티 – 행사 목록 / 상세 / 평점 / 댓글

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, collection, doc,
  addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  runTransaction, query, orderBy, where, limit, startAfter,
  serverTimestamp, increment }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { firebaseConfig }       from '/assets/js/firebase-config.js';
import { watchAuth }            from '/assets/js/auth.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);
const fns = getFunctions(app);

const fnCheckEligibility = httpsCallable(fns, 'checkEventEligibility');
const fnBuyVoucher       = httpsCallable(fns, 'buyEventVoucher');

const PAGE_SIZE = 12;

// ── 상태 ─────────────────────────────────────────────────────
let _user         = null;
let _isAdmin      = false;
let _filter       = 'upcoming';
let _lastDoc      = null;
let _hasMore      = false;
let _currentEvent = null;

// ── DOM 헬퍼 ──────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// ── 날짜 포맷 ─────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function eventStatus(ts) {
  if (!ts) return 'upcoming';
  const d   = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = (d - now) / 3600000; // 시간
  if (diff > 0)   return 'upcoming';
  if (diff > -24) return 'ongoing';
  return 'past';
}
function statusLabel(s) {
  return { upcoming:'예정', ongoing:'진행 중', past:'종료' }[s] || s;
}
function statusClass(s) {
  return `comm-status-badge comm-status-badge--${s}`;
}

function starsHtml(n) {
  const full = Math.round(n || 0);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

// ── 반복 일정 헬퍼 ─────────────────────────────────────────────
const DAY_KO = ['일','월','화','수','목','금','토'];

function fmtSchedule(d) {
  if (!d.scheduleType || d.scheduleType === 'once') return fmtDate(d.eventDate);
  const time = d.scheduleTime || '';
  if (d.scheduleType === 'daily') return `매일 ${time}`;
  if (d.scheduleType === 'weekly') {
    const days = (d.scheduleDays || []).slice().sort((a,b)=>a-b).map(n => DAY_KO[n]).join('·');
    return `매주 ${days} ${time}`;
  }
  return fmtDate(d.eventDate);
}

function getEventStatus(d) {
  if (d.scheduleType === 'daily' || d.scheduleType === 'weekly') return 'ongoing';
  return eventStatus(d.eventDate);
}

// ── 목록 로드 ─────────────────────────────────────────────────
async function loadEvents(reset = false) {
  if (reset) { _lastDoc = null; _hasMore = false; }

  const grid = $('commGrid');
  if (reset) grid.innerHTML = '<div class="comm-empty"><div class="comm-empty-icon">⏳</div><div class="comm-empty-text">불러오는 중...</div></div>';

  // ── 반복 행사(매일·특정요일) - reset 시에만 탭 상관없이 상단 표시 ──
  let recurCards = [];
  if (reset) {
    try {
      const rSnap = await getDocs(
        query(collection(db, 'community_events'), where('scheduleType', 'in', ['daily', 'weekly']))
      );
      rSnap.docs.forEach(d => recurCards.push({ id: d.id, data: d.data() }));
    } catch (_) { /* index 없으면 조용히 무시 */ }
  }

  let q = query(collection(db, 'community_events'), orderBy('eventDate', 'asc'), limit(PAGE_SIZE));

  if (_filter !== 'all') {
    const now = new Date();
    if (_filter === 'upcoming') q = query(collection(db,'community_events'), where('eventDate','>',now), orderBy('eventDate','asc'), limit(PAGE_SIZE));
    else if (_filter === 'past')   q = query(collection(db,'community_events'), where('eventDate','<',now), orderBy('eventDate','desc'), limit(PAGE_SIZE));
    // ongoing: 지난 24시간 내
    else if (_filter === 'ongoing') {
      const cutoff = new Date(Date.now() - 86400000);
      q = query(collection(db,'community_events'), where('eventDate','>=',cutoff), where('eventDate','<=',now), orderBy('eventDate','desc'), limit(PAGE_SIZE));
    }
  }

  if (_lastDoc) q = query(q, startAfter(_lastDoc));

  const snap = await getDocs(q);

  if (reset) grid.innerHTML = '';

  // 반복 행사 카드 먼저 표시
  recurCards.forEach(({ id, data }) => grid.appendChild(buildCard(id, data)));

  if (snap.empty && reset && recurCards.length === 0) {
    grid.innerHTML = '<div class="comm-empty"><div class="comm-empty-icon">📭</div><div class="comm-empty-text">등록된 행사가 없습니다.</div></div>';
    $('commCount').textContent = '';
    $('btnCommMore').style.display = 'none';
    return;
  }

  snap.docs.forEach(d => grid.appendChild(buildCard(d.id, d.data())));

  _lastDoc = snap.docs[snap.docs.length - 1];
  _hasMore = snap.docs.length === PAGE_SIZE;
  $('btnCommMore').style.display = _hasMore ? '' : 'none';

  const total = reset
    ? snap.docs.length + recurCards.length
    : (parseInt($('commCount').textContent) || 0) + snap.docs.length;
  $('commCount').textContent = `총 ${total}개의 행사`;
}

function buildCard(id, d) {
  const status = getEventStatus(d);
  const card = el('div', 'comm-card');
  card.dataset.id = id;

  // 썸네일
  if (d.photoUrl) {
    const img = document.createElement('img');
    img.className = 'comm-card-thumb';
    img.src = d.photoUrl;
    img.alt = d.name;
    img.loading = 'lazy';
    img.onerror = function() { this.replaceWith(thumbPh()); };
    card.appendChild(img);
  } else {
    card.appendChild(thumbPh());
  }

  // 본문
  const body = el('div', 'comm-card-body');

  const top = el('div', 'comm-card-top');
  const badge = el('span', statusClass(status), statusLabel(status));
  const dateEl = el('span', 'comm-card-date', fmtSchedule(d));
  top.append(badge, dateEl);

  const title = el('div', 'comm-card-title', escHtml(d.name || ''));

  // 칩
  const chips = el('div', 'comm-card-chips');
  if (d.location)          chips.appendChild(el('span', 'comm-chip comm-chip--location', `📍 ${escHtml(d.location)}`));
  if (d.stakeRequired > 0) chips.appendChild(el('span', 'comm-chip comm-chip--stake', `🪙 JUMP ${d.stakeRequired.toLocaleString()} 이상`));
  if (d.voucherPrice > 0)  chips.appendChild(el('span', 'comm-chip comm-chip--fee', `🎟 ₫${d.voucherPrice.toLocaleString()} VND`));
  else                     chips.appendChild(el('span', 'comm-chip comm-chip--free', '🎟 무료'));

  const excerpt = el('div', 'comm-card-excerpt', escHtml(d.content || ''));

  const ratingRow = el('div', 'comm-card-rating');
  const avgCount  = d.ratingCount || 0;
  const avgScore  = avgCount > 0 ? (d.ratingSum / avgCount).toFixed(1) : null;
  ratingRow.innerHTML = avgScore
    ? `<span class="comm-stars-display">${starsHtml(Math.round(avgScore))}</span><span>${avgScore} (${avgCount}개 후기)</span>`
    : `<span>후기 없음</span>`;

  body.append(top, title, chips, excerpt, ratingRow);
  card.appendChild(body);

  card.addEventListener('click', () => openDetail(id));
  return card;
}

function thumbPh() {
  return el('div', 'comm-card-thumb-ph', '🎉');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 상세 뷰 ───────────────────────────────────────────────────
async function openDetail(id) {
  const snap = await getDoc(doc(db, 'community_events', id));
  if (!snap.exists()) return;
  _currentEvent = { id, ...snap.data() };
  renderDetail(_currentEvent);
  $('commListView').style.display  = 'none';
  $('commDetailView').style.display = '';
  window.scrollTo(0, 0);
}

function renderDetail(d) {
  const status = getEventStatus(d);

  // 이미지
  const wrap = $('detailImgWrap');
  wrap.innerHTML = '';
  if (d.photoUrl) {
    const img = document.createElement('img');
    img.src = d.photoUrl;
    img.alt = d.name;
    img.onerror = function() { this.parentNode.innerHTML = `<div class="comm-detail-img-wrap-ph">🎉</div>`; };
    wrap.appendChild(img);
  } else {
    wrap.innerHTML = '<div class="comm-detail-img-wrap-ph">🎉</div>';
  }

  // 관리자 수정/삭제 버튼
  $('detailAdminBtns').style.display = _isAdmin ? '' : 'none';

  // 배지 / 날짜
  const badge = $('detailStatusBadge');
  badge.className = statusClass(status);
  badge.textContent = statusLabel(status);
  $('detailDate').textContent = fmtDate(d.eventDate);
  $('detailTitle').textContent = d.name || '';

  // 정보 행
  const infoRow = $('detailInfoRow');
  infoRow.innerHTML = '';
  const infos = [
    { icon:'📅', label:'행사 날짜', val: fmtSchedule(d) },
    { icon:'📍', label:'행사 장소', val: d.location || '-' },
    { icon:'🪙', label:'스테이킹 조건', val: d.stakeRequired > 0 ? `JUMP ${d.stakeRequired.toLocaleString()} 이상` : '제한 없음' },
    { icon:'🎟', label:'바우처 가격', val: d.voucherPrice > 0 ? `₫${d.voucherPrice.toLocaleString()} VND` : '바우처 없음' },
  ];
  infos.forEach(({ icon, label, val }) => {
    infoRow.appendChild(el('div', 'comm-info-item', `<span class="icon">${icon}</span><span>${label}: <strong>${escHtml(val)}</strong></span>`));
  });

  // 본문
  $('detailContent').textContent = d.content || '';

  // 평점/댓글 권한
  const isPast = status === 'past' || status === 'ongoing';
  const ratingSection = $('detailRatingSection');
  ratingSection.style.display = isPast ? '' : 'none';

  if (isPast) {
    renderAvgRating(d);
    loadReviews(d.id);
    if (_user) {
      $('myRatingArea').style.display = '';
      buildStarButtons();
    }
  }

  // 바우처 섹션
  if (d.voucherPrice > 0) {
    $('detailVoucherSection').style.display = '';
    renderVoucherBox(d);
  } else {
    $('detailVoucherSection').style.display = 'none';
  }

  // 댓글폼
  if (_user) $('commCommentForm').style.display = '';
  else $('commCommentForm').style.display = 'none';

  loadComments(d.id);
}

// ── 바우처 박스 렌더 ──────────────────────────────────────────
async function renderVoucherBox(d) {
  const box = $('voucherBox');
  box.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;">확인 중...</p>';

  if (!_user) {
    box.innerHTML = `
      <div class="comm-voucher-price">₫${(d.voucherPrice||0).toLocaleString()} VND</div>
      <div class="comm-voucher-no-access">🔒 로그인 후 구매 가능합니다.</div>`;
    return;
  }

  try {
    const { data } = await fnCheckEligibility({ eventId: d.id });

    const qtyText  = data.voucherQty > 0
      ? `잔여 ${data.remainingQty}/${data.voucherQty}장`
      : '수량 무제한';

    // 사용 가능 판매자 표시
    const sellersHtml = (data.allowedSellers || []).length > 0
      ? `<div class="comm-voucher-sellers">
           📍 사용 가능 판매자:
           <ul>${(data.allowedSellers).map(s => `<li>${escHtml(s)}</li>`).join('')}</ul>
         </div>`
      : '';

    let html = `
      <div class="comm-voucher-price">₫${(d.voucherPrice||0).toLocaleString()} VND</div>
      <div class="comm-voucher-meta">
        <span>🎟 ${qtyText}</span>
        <span>🪙 조건: JUMP ${(data.required||0).toLocaleString()}개 이상</span>
        <span>내 스테이킹: <b>${(data.staked||0).toLocaleString()}개</b></span>
      </div>
      ${sellersHtml}`;

    if (data.soldOut) {
      html += `<div class="comm-voucher-no-access">🚫 매진되었습니다.</div>`;
    } else if (data.alreadyBought) {
      html += `<div class="comm-voucher-owned">✅ 바우처 구매 완료 — 위 지정 판매자에서 제시하세요</div>`;
    } else if (!data.eligible) {
      html += `<div class="comm-voucher-no-access">
        🪙 스테이킹 부족 (필요: ${data.required.toLocaleString()}개 / 보유: ${data.staked.toLocaleString()}개)<br>
        <a href="/exchange.html" style="color:#c2410c;font-weight:700;">→ 거래소에서 스테이킹하기</a>
      </div>`;
    } else {
      html += `<button class="btn--voucher" id="btnBuyVoucher">🎟 바우처 구매</button>`;
    }

    box.innerHTML = html;

    const buyBtn = $('btnBuyVoucher');
    if (buyBtn) {
      buyBtn.addEventListener('click', async () => {
        if (!confirm(`바우처를 구매하시겠습니까?\n가격: ₫${(d.voucherPrice||0).toLocaleString()} VND`)) return;
        buyBtn.disabled = true;
        buyBtn.textContent = '처리 중...';
        try {
          const res = await fnBuyVoucher({ eventId: d.id });
          alert(`✅ 구매 완료!\n${res.data.amountHex} HEX 결제\nTxHash: ${res.data.txHash}`);
          renderVoucherBox(d);
        } catch (err) {
          alert('구매 오류: ' + (err.message || err));
          buyBtn.disabled = false;
          buyBtn.textContent = '🎟 바우처 구매';
        }
      });
    }
  } catch (err) {
    box.innerHTML = `<div class="comm-voucher-no-access">조회 오류: ${escHtml(err.message)}</div>`;
  }
}

function renderAvgRating(d) {
  const count = d.ratingCount || 0;
  const avg   = count > 0 ? (d.ratingSum / count).toFixed(1) : null;
  $('avgRatingRow').innerHTML = avg
    ? `<span class="comm-avg-score">${avg}</span><span class="comm-stars-lg">${starsHtml(Math.round(avg))}</span><span style="color:var(--muted)">(${count}개 후기)</span>`
    : '<span style="color:var(--muted)">아직 후기가 없습니다.</span>';
}

// 별점 버튼
function buildStarButtons() {
  const row = $('myStars');
  row.innerHTML = '';
  row.dataset.val = 0;
  for (let i = 1; i <= 5; i++) {
    const btn = el('button', 'comm-star-btn', '★');
    btn.type = 'button';
    btn.dataset.val = i;
    btn.addEventListener('click', () => {
      row.dataset.val = i;
      row.querySelectorAll('.comm-star-btn').forEach((b, idx) => {
        b.classList.toggle('active', idx < i);
      });
    });
    row.appendChild(btn);
  }
}

// 리뷰 로드
async function loadReviews(eventId) {
  const snap = await getDocs(query(collection(db, 'community_events', eventId, 'reviews'), orderBy('createdAt', 'desc'), limit(20)));
  const cont = $('commReviews');
  cont.innerHTML = '';
  if (snap.empty) { cont.innerHTML = '<p style="font-size:0.85rem;color:var(--muted);margin:0 24px;">아직 후기가 없습니다.</p>'; }
  snap.docs.forEach(d => {
    const r = d.data();
    const item = el('div', 'comm-review-item');
    item.innerHTML = `
      <div class="comm-review-top">
        <span class="comm-review-author">${escHtml(r.displayName || '익명')}</span>
        <span class="comm-review-stars">${starsHtml(r.rating || 0)}</span>
        <span class="comm-review-date">${r.createdAt ? fmtDate(r.createdAt) : ''}</span>
      </div>
      ${r.text ? `<div class="comm-review-text">${escHtml(r.text)}</div>` : ''}
    `;
    cont.appendChild(item);
  });

  // 이미 후기를 남긴 경우 폼 숨김
  if (_user) {
    const myReview = snap.docs.find(d => d.id === _user.uid);
    if (myReview) {
      $('myRatingArea').style.display = 'none';
    }
  }
}

// 댓글 로드
async function loadComments(eventId) {
  const snap = await getDocs(query(collection(db, 'community_events', eventId, 'comments'), orderBy('createdAt', 'asc'), limit(50)));
  const cont = $('commComments');
  cont.innerHTML = '';
  if (snap.empty) { cont.innerHTML = '<p class="comm-empty-text" style="font-size:0.85rem;">댓글이 없습니다.</p>'; return; }
  snap.docs.forEach(d => {
    const c = d.data();
    const item = el('div', 'comm-comment-item');
    item.innerHTML = `
      <div class="comm-comment-top">
        <span class="comm-comment-author">${escHtml(c.displayName || '익명')}</span>
        <span class="comm-comment-date">${c.createdAt ? fmtDate(c.createdAt) : ''}</span>
      </div>
      <div class="comm-comment-text">${escHtml(c.text || '')}</div>
    `;
    cont.appendChild(item);
  });
}

// ── 탭 ───────────────────────────────────────────────────────
document.getElementById('commTabs').addEventListener('click', e => {
  const btn = e.target.closest('.comm-tab');
  if (!btn) return;
  document.querySelectorAll('.comm-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _filter = btn.dataset.filter;
  loadEvents(true);
});

// ── 더보기 ────────────────────────────────────────────────────
$('btnCommMore').addEventListener('click', () => loadEvents(false));

// ── 뒤로가기 ─────────────────────────────────────────────────
$('btnCommBack').addEventListener('click', () => {
  $('commDetailView').style.display = 'none';
  $('commListView').style.display   = '';
});

// ── 후기 등록 ─────────────────────────────────────────────────
$('btnSubmitReview').addEventListener('click', async () => {
  if (!_user || !_currentEvent) return;
  const rating = parseInt($('myStars').dataset.val || '0');
  if (rating < 1) { alert('별점을 선택해 주세요.'); return; }
  const text = $('myReviewInput').value.trim();
  const btn = $('btnSubmitReview');
  btn.disabled = true; btn.textContent = '등록 중...';
  try {
    const eventRef  = doc(db, 'community_events', _currentEvent.id);
    // 문서 ID = uid → 1인 1후기 보장
    const reviewRef = doc(db, 'community_events', _currentEvent.id, 'reviews', _user.uid);

    await runTransaction(db, async (tx) => {
      const existing = await tx.get(reviewRef);
      if (existing.exists()) throw new Error('이미 후기를 작성하셨습니다.');
      tx.set(reviewRef, {
        uid:         _user.uid,
        displayName: _user.displayName || '익명',
        rating,
        text,
        createdAt:   serverTimestamp(),
      });
      tx.update(eventRef, {
        ratingSum:   increment(rating),
        ratingCount: increment(1),
      });
    });

    $('myRatingArea').style.display = 'none';
    const updSnap = await getDoc(eventRef);
    _currentEvent = { id: _currentEvent.id, ...updSnap.data() };
    renderAvgRating(_currentEvent);
    loadReviews(_currentEvent.id);
  } catch (err) {
    alert('후기 등록 중 오류: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '후기 등록';
  }
});

// ── 댓글 등록 ─────────────────────────────────────────────────
$('btnSubmitComment').addEventListener('click', async () => {
  if (!_user || !_currentEvent) return;
  const text = $('commCommentInput').value.trim();
  if (!text) return;
  const btn = $('btnSubmitComment');
  btn.disabled = true; btn.textContent = '등록 중...';
  try {
    await addDoc(collection(db, 'community_events', _currentEvent.id, 'comments'), {
      uid: _user.uid,
      displayName: _user.displayName || '익명',
      text,
      createdAt: serverTimestamp(),
    });
    $('commCommentInput').value = '';
    loadComments(_currentEvent.id);
  } catch (err) {
    alert('댓글 등록 중 오류: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '등록';
  }
});

// ── 날짜 유형 UI 전환 ─────────────────────────────────────────
function updateDateTypeUI(type) {
  $('fldDateOnceWrap').style.display  = type === 'once'   ? '' : 'none';
  $('fldRecurTimeWrap').style.display = type !== 'once'   ? '' : 'none';
  $('fldDaysWrap').style.display      = type === 'weekly' ? '' : 'none';
}

// ── 행사 등록 모달 ────────────────────────────────────────────
function openEventModal(editData = null) {
  $('commEventModal').style.display = '';
  $('commModalTitle').textContent = editData ? '행사 수정' : '행사 등록';
  $('commModalSubmit').textContent = editData ? '수정' : '등록';
  $('fldEventName').value     = editData?.name        || '';
  $('fldStakeReq').value      = editData?.stakeRequired ?? '';
  $('fldVoucherPrice').value  = editData?.voucherPrice  ?? '';
  $('fldVoucherQty').value    = editData?.voucherQty    ?? '';
  $('fldAllowedSellers').value = (editData?.allowedSellers || []).join('\n');
  $('fldEventLocation').value = editData?.location      || '';
  $('fldPhotoUrl').value      = editData?.photoUrl      || '';
  $('fldEventContent').value  = editData?.content       || '';

  // 날짜 유형
  const type = editData?.scheduleType || 'once';
  document.querySelectorAll('input[name="fldDateType"]').forEach(r => { r.checked = r.value === type; });
  updateDateTypeUI(type);

  if (type === 'once') {
    if (editData?.eventDate) {
      const d = editData.eventDate.toDate ? editData.eventDate.toDate() : new Date(editData.eventDate);
      $('fldEventDate').value = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    } else {
      $('fldEventDate').value = '';
    }
  } else {
    $('fldScheduleTime').value = editData?.scheduleTime || '';
    if (type === 'weekly') {
      const days = editData?.scheduleDays || [];
      document.querySelectorAll('input[name="schedDay"]').forEach(cb => {
        cb.checked = days.includes(parseInt(cb.value));
      });
    }
  }

  updatePhotoPreview();
  $('commModalError').style.display = 'none';
}

function closeEventModal() { $('commEventModal').style.display = 'none'; }

$('btnCreateEvent').addEventListener('click', () => openEventModal());
$('commModalClose').addEventListener('click', closeEventModal);
$('commModalCancel').addEventListener('click', closeEventModal);
$('commModalBackdrop').addEventListener('click', closeEventModal);

// 날짜 유형 전환
$('dateTypeGroup').addEventListener('change', e => {
  const r = e.target.closest('input[name="fldDateType"]');
  if (r) updateDateTypeUI(r.value);
});

// 사진 미리보기
$('fldPhotoUrl').addEventListener('input', updatePhotoPreview);
function updatePhotoPreview() {
  const url = $('fldPhotoUrl').value.trim();
  const prev = $('fldPhotoPreview');
  prev.innerHTML = url ? `<img src="${escHtml(url)}" alt="미리보기" onerror="this.style.display='none'" />` : '';
}

// 등록/수정 제출
$('commModalSubmit').addEventListener('click', async () => {
  const name      = $('fldEventName').value.trim();
  const location  = $('fldEventLocation').value.trim();
  const content   = $('fldEventContent').value.trim();
  const errEl     = $('commModalError');
  const isEdit    = $('commModalSubmit').textContent === '수정';
  const schedType = document.querySelector('input[name="fldDateType"]:checked')?.value || 'once';

  if (!name)     { errEl.textContent = '행사명을 입력해 주세요.';   errEl.style.display=''; return; }
  if (!location) { errEl.textContent = '행사 장소를 입력해 주세요.'; errEl.style.display=''; return; }
  if (!content)  { errEl.textContent = '행사 내용을 입력해 주세요.'; errEl.style.display=''; return; }

  // 날짜 유형별 검증
  let eventDate = null;
  let scheduleTime = null;
  let scheduleDays = null;

  if (schedType === 'once') {
    const dateVal = $('fldEventDate').value;
    if (!dateVal) { errEl.textContent = '행사 날짜를 선택해 주세요.'; errEl.style.display=''; return; }
    eventDate = new Date(dateVal);
  } else {
    scheduleTime = $('fldScheduleTime').value;
    if (!scheduleTime) { errEl.textContent = '시간을 입력해 주세요.'; errEl.style.display=''; return; }
    if (schedType === 'weekly') {
      scheduleDays = [...document.querySelectorAll('input[name="schedDay"]:checked')].map(cb => parseInt(cb.value));
      if (scheduleDays.length === 0) { errEl.textContent = '요일을 하나 이상 선택해 주세요.'; errEl.style.display=''; return; }
    }
  }

  errEl.style.display = 'none';
  const btn = $('commModalSubmit');
  btn.disabled = true; btn.textContent = '처리 중...';

  try {
    const data = {
      name,
      scheduleType:  schedType,
      eventDate,
      scheduleTime,
      scheduleDays,
      location,
      stakeRequired: parseInt($('fldStakeReq').value) || 0,
      voucherPrice:  parseInt($('fldVoucherPrice').value) || 0,
      voucherQty:    parseInt($('fldVoucherQty').value)   || 0,
      allowedSellers: $('fldAllowedSellers').value
        .split('\n').map(s => s.trim()).filter(Boolean),
      photoUrl:      $('fldPhotoUrl').value.trim(),
      content,
      updatedAt:     serverTimestamp(),
    };

    if (isEdit && _currentEvent) {
      await updateDoc(doc(db, 'community_events', _currentEvent.id), data);
      closeEventModal();
      await openDetail(_currentEvent.id); // 상세 새로고침
    } else {
      await addDoc(collection(db, 'community_events'), {
        ...data,
        authorUid:   _user.uid,
        authorName:  _user.displayName || '익명',
        ratingSum:   0,
        ratingCount: 0,
        createdAt:   serverTimestamp(),
      });
      closeEventModal();
      loadEvents(true);
    }
  } catch (err) {
    errEl.textContent = '오류: ' + err.message;
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? '수정' : '등록';
  }
});

// 수정 버튼
$('btnEditEvent').addEventListener('click', () => openEventModal(_currentEvent));

// 삭제 버튼
$('btnDeleteEvent').addEventListener('click', async () => {
  if (!_currentEvent) return;
  if (!confirm(`"${_currentEvent.name}" 행사를 삭제하시겠습니까?`)) return;
  try {
    await deleteDoc(doc(db, 'community_events', _currentEvent.id));
    $('commDetailView').style.display = 'none';
    $('commListView').style.display   = '';
    loadEvents(true);
  } catch (err) {
    alert('삭제 오류: ' + err.message);
  }
});

// ── 인증 상태 감시 ────────────────────────────────────────────
watchAuth(({ loggedIn, role, profile }) => {
  _user    = loggedIn ? profile : null;
  _isAdmin = loggedIn && role === 'admin';

  // 관리자 전용 버튼
  $('btnCreateEvent').style.display  = _isAdmin ? '' : 'none';
  $('detailAdminBtns').style.display = (_isAdmin && _currentEvent) ? '' : 'none';

  // 댓글/후기 폼
  if (_currentEvent) {
    const isPast = ['past','ongoing'].includes(getEventStatus(_currentEvent));
    if (isPast) $('myRatingArea').style.display = loggedIn ? '' : 'none';
    $('commCommentForm').style.display = loggedIn ? '' : 'none';
  }
});

// ── 초기 로드 ────────────────────────────────────────────────
loadEvents(true);
