// /assets/js/pages/community.js
// 소셜 커뮤니티 – 행사 목록 / 상세 / 평점 / 댓글

import { getFirestore, collection, doc,
  addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, where, limit, startAfter,
  serverTimestamp, increment }
  from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';

const db   = getFirestore();
const auth = getAuth();

const PAGE_SIZE = 12;

// ── 상태 ─────────────────────────────────────────────────────
let _user         = null;
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

// ── 목록 로드 ─────────────────────────────────────────────────
async function loadEvents(reset = false) {
  if (reset) { _lastDoc = null; _hasMore = false; }

  const grid = $('commGrid');
  if (reset) grid.innerHTML = '<div class="comm-empty"><div class="comm-empty-icon">⏳</div><div class="comm-empty-text">불러오는 중...</div></div>';

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
  if (snap.empty && reset) {
    grid.innerHTML = '<div class="comm-empty"><div class="comm-empty-icon">📭</div><div class="comm-empty-text">등록된 행사가 없습니다.</div></div>';
    $('commCount').textContent = '';
    $('btnCommMore').style.display = 'none';
    return;
  }

  snap.docs.forEach(d => grid.appendChild(buildCard(d.id, d.data())));

  _lastDoc = snap.docs[snap.docs.length - 1];
  _hasMore = snap.docs.length === PAGE_SIZE;
  $('btnCommMore').style.display = _hasMore ? '' : 'none';

  const total = reset ? snap.docs.length : (parseInt($('commCount').textContent) || 0) + snap.docs.length;
  $('commCount').textContent = `총 ${total}개의 행사`;
}

function buildCard(id, d) {
  const status = eventStatus(d.eventDate);
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
  const dateEl = el('span', 'comm-card-date', fmtDate(d.eventDate));
  top.append(badge, dateEl);

  const title = el('div', 'comm-card-title', escHtml(d.name || ''));

  // 칩
  const chips = el('div', 'comm-card-chips');
  if (d.stakeRequired > 0) chips.appendChild(el('span', 'comm-chip comm-chip--stake', `🪙 JUMP ${d.stakeRequired.toLocaleString()} 이상`));
  if (d.fee > 0)           chips.appendChild(el('span', 'comm-chip comm-chip--fee', `💵 ${d.fee.toLocaleString()} VND`));
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
  const status = eventStatus(d.eventDate);

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
    { icon:'📅', label:'행사 날짜', val: fmtDate(d.eventDate) },
    { icon:'🪙', label:'스테이킹 조건', val: d.stakeRequired > 0 ? `JUMP ${d.stakeRequired.toLocaleString()} 이상` : '제한 없음' },
    { icon:'💵', label:'참석 회비', val: d.fee > 0 ? `${d.fee.toLocaleString()} VND` : '무료' },
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

  // 댓글폼
  if (_user) $('commCommentForm').style.display = '';
  else $('commCommentForm').style.display = 'none';

  loadComments(d.id);
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
  if (snap.empty) { cont.innerHTML = '<p style="font-size:0.85rem;color:var(--muted);margin:0 24px;">아직 후기가 없습니다.</p>'; return; }
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
    const eventRef = doc(db, 'community_events', _currentEvent.id);
    await addDoc(collection(db, 'community_events', _currentEvent.id, 'reviews'), {
      uid: _user.uid,
      displayName: _user.displayName || '익명',
      rating,
      text,
      createdAt: serverTimestamp(),
    });
    // 평균 갱신
    await updateDoc(eventRef, {
      ratingSum:   increment(rating),
      ratingCount: increment(1),
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

// ── 행사 등록 모달 ────────────────────────────────────────────
function openEventModal(editData = null) {
  $('commEventModal').style.display = '';
  $('commModalTitle').textContent = editData ? '행사 수정' : '행사 등록';
  $('commModalSubmit').textContent = editData ? '수정' : '등록';
  $('fldEventName').value    = editData?.name    || '';
  $('fldStakeReq').value     = editData?.stakeRequired ?? '';
  $('fldFee').value          = editData?.fee     ?? '';
  $('fldPhotoUrl').value     = editData?.photoUrl || '';
  $('fldEventContent').value = editData?.content || '';
  if (editData?.eventDate) {
    const d = editData.eventDate.toDate ? editData.eventDate.toDate() : new Date(editData.eventDate);
    $('fldEventDate').value = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  } else {
    $('fldEventDate').value = '';
  }
  updatePhotoPreview();
  $('commModalError').style.display = 'none';
}

function closeEventModal() { $('commEventModal').style.display = 'none'; }

$('btnCreateEvent').addEventListener('click', () => openEventModal());
$('commModalClose').addEventListener('click', closeEventModal);
$('commModalCancel').addEventListener('click', closeEventModal);
$('commModalBackdrop').addEventListener('click', closeEventModal);

// 사진 미리보기
$('fldPhotoUrl').addEventListener('input', updatePhotoPreview);
function updatePhotoPreview() {
  const url = $('fldPhotoUrl').value.trim();
  const prev = $('fldPhotoPreview');
  prev.innerHTML = url ? `<img src="${escHtml(url)}" alt="미리보기" onerror="this.style.display='none'" />` : '';
}

// 등록 제출
$('commModalSubmit').addEventListener('click', async () => {
  const name    = $('fldEventName').value.trim();
  const dateVal = $('fldEventDate').value;
  const content = $('fldEventContent').value.trim();
  const errEl   = $('commModalError');

  if (!name)    { errEl.textContent = '행사명을 입력해 주세요.';  errEl.style.display=''; return; }
  if (!dateVal) { errEl.textContent = '행사 날짜를 선택해 주세요.'; errEl.style.display=''; return; }
  if (!content) { errEl.textContent = '행사 내용을 입력해 주세요.'; errEl.style.display=''; return; }

  errEl.style.display = 'none';
  const btn = $('commModalSubmit');
  btn.disabled = true; btn.textContent = '처리 중...';

  try {
    const data = {
      name,
      eventDate:     new Date(dateVal),
      stakeRequired: parseInt($('fldStakeReq').value) || 0,
      fee:           parseInt($('fldFee').value) || 0,
      photoUrl:      $('fldPhotoUrl').value.trim(),
      content,
      authorUid:     _user.uid,
      authorName:    _user.displayName || '익명',
      ratingSum:     0,
      ratingCount:   0,
      updatedAt:     serverTimestamp(),
    };

    await addDoc(collection(db, 'community_events'), { ...data, createdAt: serverTimestamp() });
    closeEventModal();
    loadEvents(true);
  } catch (err) {
    errEl.textContent = '오류: ' + err.message;
    errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = '등록';
  }
});

// ── 인증 상태 감시 ────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  _user = user;
  // 관리자/로그인 유저는 행사 등록 버튼 노출 (간단히 로그인=등록가능 처리)
  $('btnCreateEvent').style.display = user ? '' : 'none';
  if (_currentEvent) {
    const isPast = ['past','ongoing'].includes(eventStatus(_currentEvent.eventDate));
    if (isPast) $('myRatingArea').style.display = user ? '' : 'none';
    $('commCommentForm').style.display = user ? '' : 'none';
  }
});

// ── 초기 로드 ────────────────────────────────────────────────
loadEvents(true);
