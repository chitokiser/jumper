// /assets/js/pages/coop.js
// 조합 전용몰 — CoopMall 스마트컨트랙트 기반

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ─────────────────────────────────────────────────────────
// DOM 캐시
// ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  loading:         $('coopLoading'),
  noticeBanner:    $('coopNoticeBanner'),
  noticeText:      $('coopNoticeText'),
  joinPanel:       $('coopJoinPanel'),
  joinFee:         $('coopJoinFeeDisplay'),
  joinFeeNote:     $('coopJoinFeeNote'),
  joinBtn:         $('coopJoinBtn'),
  joinMsg:         $('coopJoinMsg'),
  main:            $('coopMain'),
  accessBadge:     $('coopAccessBadge'),
  pointsPanel:     $('coopPointsPanel'),
  pointsAmount:    $('coopPointsAmount'),
  convertBtn:      $('coopConvertBtn'),
  grid:            $('coopGrid'),
  empty:           $('coopEmpty'),
  // 상품 상세 모달
  detailModal:     $('coopDetailModal'),
  detailBd:        $('coopDetailBd'),
  detailClose:     $('coopDetailClose'),
  detailImg:       $('coopDetailImg'),
  detailBadge:     $('coopDetailBadge'),
  detailName:      $('coopDetailName'),
  detailDesc:      $('coopDetailDesc'),
  detailPrice:     $('coopDetailPrice'),
  detailStock:     $('coopDetailStock'),
  detailBuyBtn:    $('coopDetailBuyBtn'),
  // 구매완료 모달
  doneModal:       $('coopDoneModal'),
  doneModalBd:     $('coopModalBd'),
  doneModalClose:  $('coopModalClose'),
  doneKvs:         $('coopDoneKvs'),
  // 포인트 전환 모달
  convertModal:    $('coopConvertModal'),
  convertBd:       $('coopConvertBd'),
  convertAvail:    $('coopConvertAvail'),
  convertInput:    $('coopConvertInput'),
  convertAll:      $('coopConvertAll'),
  convertMsg:      $('coopConvertMsg'),
  convertCancel:   $('coopConvertCancel'),
  convertSubmit:   $('coopConvertSubmit'),
  // 이미지 라이트박스
  imgLightbox:      $('coopImgLightbox'),
  imgLightboxImg:   $('coopLightboxImg'),
  imgLightboxClose: $('coopLightboxClose'),
};

// ─────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────
let _products = [];
let _pointsWei = 0n;
let _membershipFeeWei = 0n;
let _fx = null;         // { fxKrwPerHexScaled, fxVndPerHexScaled, fxScale }
let _memberStatus = 'loading'; // 'guest' | 'no-wallet' | 'not-member' | 'expired' | 'member'
let _coopVouchers = [];

// ─────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────
function show(elRef, on) {
  if (elRef) elRef.style.display = on ? '' : 'none';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHtml(str) {
  return String(str || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function openImgLightbox(url, alt) {
  el.imgLightboxImg.src = url;
  el.imgLightboxImg.alt = alt || '';
  show(el.imgLightbox, true);
  el.imgLightbox.onclick    = closeImgLightbox;
  el.imgLightboxClose.onclick = closeImgLightbox;
  const onKey = (e) => {
    if (e.key === 'Escape') { closeImgLightbox(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);
}

function closeImgLightbox() {
  show(el.imgLightbox, false);
}

function fmtHex(wei) {
  return (Number(wei) / 1e18).toFixed(4) + ' HEX';
}

// FX 변환 헬퍼 — _fx 설정 후 사용
function _krwPerHex()  { return _fx ? Number(_fx.fxKrwPerHexScaled) / _fx.fxScale : 0; }
function _vndPerHex()  { return _fx ? Number(_fx.fxVndPerHexScaled) / _fx.fxScale : 0; }

/** KRW 정수 → HEX 표시 */
function krwToHexDisplay(krw) {
  const r = _krwPerHex();
  if (!r) return '—';
  return (krw / r).toFixed(4) + ' HEX';
}
/** KRW 정수 → VND 표시 */
function krwToVndDisplay(krw) {
  const krwR = _krwPerHex(), vndR = _vndPerHex();
  if (!krwR) return '—';
  return Math.round(krw * vndR / krwR).toLocaleString() + ' ₫';
}
/** HEX wei 문자열 → KRW 표시 */
function hexWeiToKrw(weiStr) {
  const r = _krwPerHex();
  if (!r) return '—';
  return Math.round(Number(weiStr) / 1e18 * r).toLocaleString() + ' ₩';
}
/** HEX wei 문자열 → VND 표시 */
function hexWeiToVnd(weiStr) {
  const r = _vndPerHex();
  if (!r) return '—';
  return Math.round(Number(weiStr) / 1e18 * r).toLocaleString() + ' ₫';
}

function hideAll() {
  show(el.loading, false);
  show(el.main, false);
}

// ─────────────────────────────────────────────────────────
// Cloud Function 헬퍼
// ─────────────────────────────────────────────────────────
const cf = {
  getMembership:        httpsCallable(functions, 'coopGetMembership'),
  joinMall:             httpsCallable(functions, 'coopJoinMall'),
  listProducts:         httpsCallable(functions, 'listCoopProducts'),
  buy:                  httpsCallable(functions, 'coopBuyOnChain'),
  buyTreasurePackage:   httpsCallable(functions, 'coopBuyTreasurePackage'),
  convert:              httpsCallable(functions, 'coopConvertPoints'),
  randomAutoReferrer:   httpsCallable(functions, 'getRandomAutoReferrer'),
  getMyVouchers:        httpsCallable(functions, 'coopGetMyVouchers'),
  submitVoucherOrder:   httpsCallable(functions, 'submitVoucherOrder'),
};

// ─────────────────────────────────────────────────────────
// 초기화 흐름
// ─────────────────────────────────────────────────────────
async function init(user) {
  show(el.loading, true);

  // 항상 상품 목록 먼저 로드 (비로그인도 열람 가능)
  await loadProducts();

  if (!user) {
    _memberStatus = 'guest';
    el.noticeText.innerHTML =
      '로그인 후 구매할 수 있습니다. &nbsp;<a href="#" id="coopLoginLink" style="color:#7c3aed;font-weight:600;">로그인하기 →</a>';
    show(el.noticeBanner, true);
    show(el.loading, false);
    show(el.main, true);
    document.getElementById('coopLoginLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('btnLogin')?.click();
    });
    return;
  }

  let membership;
  try {
    const res = await cf.getMembership();
    membership = res.data;
  } catch (err) {
    show(el.loading, false);
    show(el.main, true);
    return;
  }

  if (!membership.hasWallet) {
    _memberStatus = 'no-wallet';
    el.noticeText.innerHTML =
      '수탁 지갑이 없습니다. &nbsp;<a href="/mypage.html" style="color:#7c3aed;font-weight:600;">마이페이지에서 지갑 생성 →</a>';
    show(el.noticeBanner, true);
    show(el.loading, false);
    show(el.main, true);
    return;
  }

  // 지갑 있는 유저: 바우쳐 섹션 비동기 로드
  loadCoopVouchers();

  _membershipFeeWei = BigInt(membership.membershipFeeHex || '0');
  if (membership.fxKrwPerHexScaled) {
    _fx = {
      fxKrwPerHexScaled: membership.fxKrwPerHexScaled,
      fxVndPerHexScaled: membership.fxVndPerHexScaled,
      fxScale:           membership.fxScale,
    };
  }

  if (!membership.activeMember) {
    const isExpired = !!membership.member;
    _memberStatus = isExpired ? 'expired' : 'not-member';

    if (isExpired) {
      const titleEl = document.getElementById('coopJoinTitle');
      const subEl   = document.getElementById('coopJoinSub');
      if (titleEl) titleEl.textContent = '정회원 갱신';
      if (subEl)   subEl.textContent   = '회원 기간이 만료되었습니다. 재가입하여 혜택을 계속 누리세요.';
      if (el.joinBtn) el.joinBtn.textContent = '재가입하기';
    }

    el.joinFee.innerHTML =
      `${fmtHex(_membershipFeeWei)}<br>` +
      `<small style="font-size:0.82rem;color:var(--muted,#6b7280);">` +
      `${hexWeiToKrw(_membershipFeeWei)} / ${hexWeiToVnd(_membershipFeeWei)}` +
      `</small>`;
    show(el.joinPanel, true);
    show(el.loading, false);
    show(el.main, true);
    return;
  }

  // 활성 정회원
  _memberStatus = 'member';
  _pointsWei = BigInt(membership.pointsWei || '0');
  renderPointsPanel();
  show(el.pointsPanel, true);
  show(el.accessBadge, true);

  const expiryTs = Number(membership.expiry || '0');
  if (expiryTs > 0) {
    const expiryDate = new Date(expiryTs * 1000).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const expiryEl = document.getElementById('coopExpiryInfo');
    if (expiryEl) { expiryEl.textContent = `만료: ${expiryDate}`; expiryEl.style.display = ''; }
  }

  show(el.loading, false);
  show(el.main, true);
}

// ─────────────────────────────────────────────────────────
// 포인트 패널
// ─────────────────────────────────────────────────────────
function renderPointsPanel() {
  const hexAmt = Number(_pointsWei) / 1e18;
  el.pointsAmount.innerHTML =
    `${hexAmt.toFixed(4)} HEX<br>` +
    `<small style="font-size:0.78rem;color:var(--muted,#6b7280);font-weight:400;">` +
    `${hexWeiToKrw(_pointsWei)} / ${hexWeiToVnd(_pointsWei)}` +
    `</small>`;
  el.convertBtn.disabled = _pointsWei <= 0n;
}

// ─────────────────────────────────────────────────────────
// 상품 목록
// ─────────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await cf.listProducts();
    _products = (res.data?.products || []);
  } catch {
    _products = [];
  }

  const grid = el.grid;
  if (_products.length === 0) {
    show(el.empty, true);
    return;
  }
  show(el.empty, false);

  const frag = document.createDocumentFragment();
  _products.forEach(p => {
    const div = document.createElement('div');
    div.innerHTML = renderCard(p);
    const card = div.firstElementChild;
    card.querySelector('[data-detail]')?.addEventListener('click', (e) => {
      showDetailModal(e.currentTarget.dataset.detail);
    });
    card.querySelectorAll('[data-lightbox]').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openImgLightbox(img.dataset.lightbox, img.dataset.lightalt);
      });
    });
    frag.appendChild(card);
  });
  grid.innerHTML = '';
  grid.appendChild(frag);
}

function renderCard(p) {
  const sold = p.stock === 0;
  const imgHtml = p.imageUrl
    ? `<img class="coop-card-img" src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" loading="lazy"
         style="cursor:zoom-in;" data-lightbox="${escHtml(p.imageUrl)}" data-lightalt="${escHtml(p.name)}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
       <div class="coop-card-img-ph" style="display:none;">🛍</div>`
    : `<div class="coop-card-img-ph">🛍</div>`;

  const stockTxt = p.stock === -1 ? '' : sold ? '품절' : `재고 ${p.stock}개`;
  const typeBadge = p.type === 'voucher'
    ? `<span style="font-size:0.72rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:1px 8px;display:inline-block;margin-bottom:4px;">바우처</span>`
    : p.type === 'treasure_package'
    ? `<span style="font-size:0.72rem;background:#dcfce7;color:#15803d;border-radius:99px;padding:1px 8px;display:inline-block;margin-bottom:4px;">보물패키지</span>`
    : `<span style="font-size:0.72rem;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:1px 8px;display:inline-block;margin-bottom:4px;">일반상품</span>`;

  const hexAmt   = p.hexPrice ? (Number(p.hexPrice) / 1e18).toFixed(4) : '—';
  const priceKrw = hexWeiToKrw(p.hexPrice || '0');
  const priceVnd = hexWeiToVnd(p.hexPrice || '0');

  return `
    <div class="coop-card">
      ${imgHtml}
      <div class="coop-card-body">
        ${typeBadge}
        <div class="coop-card-name">${escHtml(p.name)}</div>
        ${p.description ? `<div class="coop-card-desc">${escHtml(stripHtml(p.description))}</div>` : ''}
        <div class="coop-card-price">${hexAmt} HEX</div>
        <div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-top:2px;line-height:1.6;">
          ${priceKrw} &nbsp;·&nbsp; ${priceVnd}
        </div>
        ${stockTxt ? `<div class="coop-card-stock ${sold ? 'out' : ''}">${stockTxt}</div>` : ''}
        <button class="coop-btn-buy" data-detail="${escHtml(p.id)}" ${sold ? 'disabled' : ''}>
          ${sold ? '품절' : '상세보기'}
        </button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────
// 상품 상세 모달
// ─────────────────────────────────────────────────────────
function showDetailModal(productId) {
  const p = _products.find(x => x.id === productId);
  if (!p) return;

  const sold = p.stock === 0;

  el.detailImg.innerHTML = p.imageUrl
    ? `<img class="coop-detail-img" src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" loading="lazy"
         style="cursor:zoom-in;"
         onerror="this.outerHTML='<div class=\\'coop-detail-img-ph\\'>🛍</div>'">`
    : `<div class="coop-detail-img-ph">🛍</div>`;

  if (p.imageUrl) {
    const detImgEl = el.detailImg.querySelector('img');
    if (detImgEl) detImgEl.onclick = () => openImgLightbox(p.imageUrl, p.name);
  }

  el.detailBadge.innerHTML = p.type === 'voucher'
    ? `<span style="font-size:0.75rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:2px 10px;display:inline-block;margin-bottom:6px;">바우처</span>`
    : p.type === 'treasure_package'
    ? `<span style="font-size:0.75rem;background:#dcfce7;color:#15803d;border-radius:99px;padding:2px 10px;display:inline-block;margin-bottom:6px;">보물패키지</span>`
    : `<span style="font-size:0.75rem;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:2px 10px;display:inline-block;margin-bottom:6px;">일반상품</span>`;

  el.detailName.textContent  = p.name || '';
  el.detailDesc.innerHTML     = p.description || '';
  el.detailDesc.style.display = p.description ? '' : 'none';

  const hexAmtDet = p.hexPrice ? (Number(p.hexPrice) / 1e18).toFixed(4) : '—';
  el.detailPrice.innerHTML =
    `${hexAmtDet} HEX` +
    `<br><span style="font-size:0.82rem;color:var(--muted,#6b7280);font-weight:400;">` +
    `${hexWeiToKrw(p.hexPrice||'0')} &nbsp;·&nbsp; ${hexWeiToVnd(p.hexPrice||'0')}` +
    `</span>`;

  const stockTxt = p.stock === -1 ? '' : sold ? '품절' : `재고 ${p.stock}개`;
  el.detailStock.textContent = stockTxt;
  el.detailStock.className   = 'coop-detail-stock' + (sold ? ' out' : '');

  if (sold) {
    el.detailBuyBtn.disabled    = true;
    el.detailBuyBtn.textContent = '품절';
    el.detailBuyBtn.onclick     = null;
  } else if (_memberStatus === 'guest') {
    el.detailBuyBtn.disabled    = false;
    el.detailBuyBtn.textContent = '로그인 후 구매 가능';
    el.detailBuyBtn.onclick     = (e) => {
      e.preventDefault();
      closeDetailModal();
      document.getElementById('btnLogin')?.click();
    };
  } else if (_memberStatus === 'no-wallet') {
    el.detailBuyBtn.disabled    = false;
    el.detailBuyBtn.textContent = '지갑 생성 후 구매 가능';
    el.detailBuyBtn.onclick     = () => { location.href = '/mypage.html'; };
  } else if (_memberStatus === 'not-member') {
    el.detailBuyBtn.disabled    = false;
    el.detailBuyBtn.textContent = '정회원 전용 상품';
    el.detailBuyBtn.onclick     = () => {
      closeDetailModal();
      el.joinPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  } else if (_memberStatus === 'expired') {
    el.detailBuyBtn.disabled    = false;
    el.detailBuyBtn.textContent = '회원 갱신 후 구매 가능';
    el.detailBuyBtn.onclick     = () => {
      closeDetailModal();
      el.joinPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  } else if (_memberStatus === 'loading') {
    el.detailBuyBtn.disabled    = true;
    el.detailBuyBtn.textContent = '회원 확인 중...';
    el.detailBuyBtn.onclick     = null;
  } else if (_memberStatus === 'member') {
    el.detailBuyBtn.disabled    = false;
    el.detailBuyBtn.textContent = '구매하기';
    el.detailBuyBtn.onclick     = () => handleBuy(productId);
  } else {
    el.detailBuyBtn.disabled    = true;
    el.detailBuyBtn.textContent = '구매 불가';
    el.detailBuyBtn.onclick     = null;
  }

  el.detailBd.onclick    = closeDetailModal;
  el.detailClose.onclick = closeDetailModal;

  const onKey = (e) => {
    if (e.key === 'Escape') { closeDetailModal(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);

  // 자동추천인 상품: 랜덤 멘토 주소 표시
  const isAutoReferrer = p.productCode === 'auto_referrer' || p.name === '자동추천인 등록';
  let autoReferrerEl = document.getElementById('coopAutoReferrerInfo');
  if (!autoReferrerEl) {
    autoReferrerEl = document.createElement('div');
    autoReferrerEl.id = 'coopAutoReferrerInfo';
    autoReferrerEl.style.cssText =
      'margin-top:12px;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;' +
      'border-radius:10px;font-size:0.82rem;color:#065f46;line-height:1.7;';
    el.detailBuyBtn.insertAdjacentElement('beforebegin', autoReferrerEl);
  }
  if (isAutoReferrer) {
    autoReferrerEl.style.display = '';
    autoReferrerEl.innerHTML = '⏳ 자동추천인 명단 조회 중…';
    cf.randomAutoReferrer().then(res => {
      const addr  = res.data?.address;
      const count = res.data?.count ?? 0;
      if (!addr) {
        autoReferrerEl.innerHTML =
          `<b>현재 자동추천인 명단</b>: 0명<br>` +
          `<span style="color:#6b7280;">아직 등록된 자동추천인이 없습니다.<br>첫 번째로 등록해보세요!</span>`;
      } else {
        autoReferrerEl.innerHTML =
          `<b>현재 자동추천인 명단</b>: ${count}명<br>` +
          `예시 배정 멘토: <code style="background:#dcfce7;padding:1px 6px;border-radius:4px;font-size:0.8rem;">` +
          `${addr.slice(0,6)}…${addr.slice(-4)}</code>`;
      }
    }).catch(() => { autoReferrerEl.style.display = 'none'; });
  } else {
    autoReferrerEl.style.display = 'none';
  }

  show(el.detailModal, true);
}

function closeDetailModal() {
  show(el.detailModal, false);
}

// ─────────────────────────────────────────────────────────
// 구매 처리
// ─────────────────────────────────────────────────────────
async function handleBuy(productId) {
  const product = _products.find(p => p.id === productId);
  if (!product) return;

  // 보물 패키지는 별도 모달로 처리
  if (product.type === 'treasure_package') {
    closeDetailModal();
    showTreasurePackageModal(productId);
    return;
  }

  const confirmHex = product.hexPrice ? (Number(product.hexPrice) / 1e18).toFixed(4) : '?';
  if (!confirm(
    `${product.name}\n` +
    `가격: ${confirmHex} HEX\n` +
    `      ${hexWeiToKrw(product.hexPrice||'0')} / ${hexWeiToVnd(product.hexPrice||'0')}\n` +
    `(수탁 지갑 HEX로 결제됩니다)\n\n구매하시겠습니까?`
  )) return;

  const btn = el.detailBuyBtn;
  btn.disabled    = true;
  btn.textContent = '처리 중...';

  try {
    const res = await cf.buy({ productId });
    closeDetailModal();
    showDoneModal(res.data, product.type === 'voucher');
    // 재고 감소 반영
    const idx = _products.findIndex(p => p.id === productId);
    if (idx !== -1 && _products[idx].stock > 0) _products[idx].stock--;
  } catch (err) {
    alert('구매 실패: ' + (err?.message || '서버 오류'));
    btn.disabled    = false;
    btn.textContent = '구매하기';
  }
}

// ─────────────────────────────────────────────────────────
// 보물 패키지 구매 모달
// ─────────────────────────────────────────────────────────
let _tpProductId = null;

function showTreasurePackageModal(productId) {
  _tpProductId = productId;
  const tpModal   = document.getElementById('coopTreasureModal');
  const tpBd      = document.getElementById('coopTreasureBd');
  const tpCancel  = document.getElementById('tpCancelBtn');
  const tpSubmit  = document.getElementById('tpSubmitBtn');
  const tpGpsBtn  = document.getElementById('tpGpsBtn');
  const tpNpcUrl  = document.getElementById('tpNpcImageUrl');
  const tpNpcPrev = document.getElementById('tpNpcPreview');
  const tpNpcImg  = document.getElementById('tpNpcImg');
  const tpMsg     = document.getElementById('tpMsg');

  // 초기화
  document.getElementById('tpTreasureName').value = '';
  document.getElementById('tpLatLng').value = '';
  tpNpcUrl.value = '';
  tpNpcPrev.style.display = 'none';
  tpMsg.textContent = '';
  tpSubmit.disabled = false;
  tpSubmit.textContent = '구매하기';

  // NPC 이미지 미리보기
  tpNpcUrl.oninput = () => {
    const url = tpNpcUrl.value.trim();
    if (url) {
      tpNpcImg.src = url;
      tpNpcPrev.style.display = '';
    } else {
      tpNpcPrev.style.display = 'none';
    }
  };

  // 현재 GPS 위치
  tpGpsBtn.onclick = () => {
    tpGpsBtn.textContent = '위치 가져오는 중...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('tpLatLng').value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        tpGpsBtn.textContent = '📍 현재 위치 사용';
      },
      () => {
        tpMsg.textContent = 'GPS 위치를 가져올 수 없습니다. 직접 입력해주세요.';
        tpGpsBtn.textContent = '📍 현재 위치 사용';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const closeModal = () => { show(tpModal, false); };
  tpBd.onclick     = closeModal;
  tpCancel.onclick = closeModal;

  tpSubmit.onclick = async () => {
    const treasureName = document.getElementById('tpTreasureName').value.trim();
    const [latStr, lngStr] = (document.getElementById('tpLatLng').value.trim()).split(',').map(s => s.trim());
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    const npcImageUrl = tpNpcUrl.value.trim();

    if (!treasureName) { tpMsg.textContent = '보물 이름을 입력하세요'; return; }
    if (!isFinite(lat) || lat < -90 || lat > 90) { tpMsg.textContent = '좌표를 올바르게 입력하세요 (예: 21.110101, 106.393556)'; return; }
    if (!isFinite(lng) || lng < -180 || lng > 180) { tpMsg.textContent = '좌표를 올바르게 입력하세요 (예: 21.110101, 106.393556)'; return; }

    const product = _products.find(p => p.id === _tpProductId);
    const confirmHex = product?.hexPrice ? (Number(product.hexPrice) / 1e18).toFixed(4) : '?';
    if (!confirm(
      `[보물 패키지 구매 확인]\n\n` +
      `보물 이름: ${treasureName}\n` +
      `위치: ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` +
      `결제 금액: ${confirmHex} HEX\n` +
      `           ${hexWeiToKrw(product?.hexPrice||'0')} / ${hexWeiToVnd(product?.hexPrice||'0')}\n\n` +
      `보물박스 5개 + 숨겨진 박스 2개 + 몬스터 5마리 + 타워 1기가 생성됩니다.\n` +
      `(관리자 승인 후 활성화)\n\n구매하시겠습니까?`
    )) return;

    tpSubmit.disabled    = true;
    tpSubmit.textContent = '처리 중...';
    tpMsg.textContent    = '';

    try {
      const res = await cf.buyTreasurePackage({ productId: _tpProductId, treasureName, lat, lng, npcImageUrl });
      closeModal();
      const d = res.data;
      showDoneModal({
        ...d,
        productName: d.productName,
        amountHex:   d.amountHex,
        hexWei:      d.hexWei,
      }, false, true);
      const idx = _products.findIndex(p => p.id === _tpProductId);
      if (idx !== -1 && _products[idx].stock > 0) _products[idx].stock--;
    } catch (err) {
      tpMsg.textContent    = '구매 실패: ' + (err?.message || '서버 오류');
      tpSubmit.disabled    = false;
      tpSubmit.textContent = '구매하기';
    }
  };

  show(tpModal, true);
}

function showDoneModal(d, isVoucher = false, isTreasure = false) {
  const voucherNote = isVoucher
    ? `<div style="margin-top:14px;padding:10px 14px;background:#fef3c7;border-radius:10px;font-size:0.85rem;color:#92400e;line-height:1.6;">
        🎫 바우처가 지갑에 발급되었습니다.<br>
        <a href="mypage.html#voucherWallet" style="color:#b45309;font-weight:600;text-decoration:underline;">
          마이페이지 › 바우처 지갑 바로가기 →
        </a>
      </div>`
    : '';
  const treasureNote = isTreasure
    ? `<div style="margin-top:14px;padding:10px 14px;background:#dcfce7;border-radius:10px;font-size:0.85rem;color:#15803d;line-height:1.6;">
        🗺️ 보물박스 ${d.boxCount||7}개 · 몬스터 ${d.monsterCount||5}마리 · 타워 1기가 생성되었습니다.<br>
        관리자 승인 후 지도에 활성화됩니다.
      </div>`
    : '';
  el.doneKvs.innerHTML = `
    <div class="coop-modal-kv"><span class="k">상품명</span><span class="v">${escHtml(d.productName)}</span></div>
    <div class="coop-modal-kv"><span class="k">결제금액</span><span class="v">${d.amountHex||'?'} HEX<br><small style="font-size:0.82rem;color:var(--muted,#6b7280);">${hexWeiToKrw(d.hexWei||'0')} / ${hexWeiToVnd(d.hexWei||'0')}</small></span></div>
    <div class="coop-modal-kv"><span class="k">TxHash</span><span class="v" style="font-size:0.75em;">${(d.txHash||'').slice(0,22)}…</span></div>
    ${voucherNote}${treasureNote}
  `;
  show(el.doneModal, true);
  el.doneModalBd.onclick    = closeDoneModal;
  el.doneModalClose.onclick = closeDoneModal;
}

function closeDoneModal() {
  show(el.doneModal, false);
}

// ─────────────────────────────────────────────────────────
// 회비 납부 (joinMall)
// ─────────────────────────────────────────────────────────
el.joinBtn.addEventListener('click', async () => {
  const feeHex = (Number(_membershipFeeWei) / 1e18).toFixed(4);
  const feeKrw = hexWeiToKrw(_membershipFeeWei);
  const feeVnd = hexWeiToVnd(_membershipFeeWei);
  if (!confirm(
    `회비 ${feeHex} HEX를 납부하고 전용몰 회원이 됩니다.\n` +
    `(약 ${feeKrw} / ${feeVnd})\n\n계속하시겠습니까?`
  )) return;

  el.joinBtn.disabled    = true;
  el.joinBtn.textContent = '처리 중...';
  el.joinMsg.textContent = '';

  try {
    const res = await cf.joinMall();
    const txHash = res.data?.txHash || '';
    el.joinMsg.style.color = '#059669';
    el.joinMsg.textContent = `가입 완료! (Tx: ${txHash.slice(0, 14)}…)`;
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    el.joinBtn.disabled    = false;
    el.joinBtn.textContent = _memberStatus === 'expired' ? '재가입하기' : '회원 가입하기';
    el.joinMsg.style.color = '';
    el.joinMsg.textContent = err?.message || '처리 실패';
  }
});

// ─────────────────────────────────────────────────────────
// 포인트 전환 모달
// ─────────────────────────────────────────────────────────
el.convertBtn.addEventListener('click', () => {
  el.convertAvail.innerHTML =
    `${fmtHex(_pointsWei)}<br>` +
    `<small style="font-size:0.78rem;color:var(--muted,#6b7280);">` +
    `${hexWeiToKrw(_pointsWei)} / ${hexWeiToVnd(_pointsWei)}` +
    `</small>`;
  el.convertInput.value = '';
  el.convertMsg.textContent = '';
  show(el.convertModal, true);
  el.convertBd.onclick     = closeConvertModal;
  el.convertCancel.onclick  = closeConvertModal;
});

el.convertAll.addEventListener('click', () => {
  el.convertInput.value = (Number(_pointsWei) / 1e18).toFixed(4);
});

el.convertSubmit.addEventListener('click', async () => {
  const hexVal = parseFloat(el.convertInput.value);
  if (!hexVal || hexVal <= 0) {
    el.convertMsg.textContent = '전환 금액을 입력하세요';
    return;
  }
  const ptsWei = BigInt(Math.floor(hexVal * 1e18)).toString();
  if (BigInt(ptsWei) > _pointsWei) {
    el.convertMsg.textContent = '포인트 잔액을 초과합니다';
    return;
  }

  el.convertSubmit.disabled    = true;
  el.convertSubmit.textContent = '처리 중...';
  el.convertMsg.textContent    = '';

  try {
    const res = await cf.convert({ ptsWei });
    closeConvertModal();
    const txHash = res.data?.txHash || '';
    alert(
      `전환 완료! ${hexVal.toFixed(4)} HEX가 지급되었습니다.\n` +
      `약 ${hexWeiToKrw(ptsWei)} / ${hexWeiToVnd(ptsWei)}\n` +
      `Tx: ${txHash.slice(0, 22)}…`
    );
    // 포인트 업데이트
    _pointsWei -= BigInt(ptsWei);
    renderPointsPanel();
  } catch (err) {
    el.convertMsg.textContent = err?.message || '전환 실패';
  } finally {
    el.convertSubmit.disabled    = false;
    el.convertSubmit.textContent = '전환하기';
  }
});

function closeConvertModal() {
  show(el.convertModal, false);
}

// ─────────────────────────────────────────────────────────
// 바우쳐 사용하기
// ─────────────────────────────────────────────────────────
function loadCoopVouchers() {
  const section = $('coopVoucherSection');
  const listEl  = $('coopVoucherList');
  if (section) section.style.display = '';
  if (listEl) listEl.innerHTML = '<span style="color:var(--muted,#6b7280);">불러오는 중...</span>';
  cf.getMyVouchers().then(res => {
    const vouchers = res.data?.vouchers || [];
    _coopVouchers = vouchers;
    if (!listEl) return;
    if (!vouchers.length) {
      listEl.innerHTML = '<span style="color:var(--muted,#6b7280);">보유 바우쳐가 없습니다</span>';
    } else {
      listEl.innerHTML = vouchers.map(v =>
        `<div style="padding:6px 10px;border-radius:8px;background:rgba(124,58,237,.12);margin-bottom:4px;">` +
        `<span style="font-weight:600;">${escHtml(v.description || '바우쳐')}</span> ` +
        `<span style="color:#9ca3af;font-size:0.8rem;">[${v.source === 'game' ? '게임' : '상품'}]</span>` +
        `</div>`
      ).join('');
    }
  }).catch(() => {
    if (listEl) listEl.innerHTML = '<span style="color:#ef4444;">바우쳐 불러오기 실패</span>';
  });
}

function openCoopVoucherOrderModal() {
  const modal  = $('coopVoucherOrderModal');
  const sel    = $('coopVoVoucherSel');
  const status = $('coopVoStatus');
  if (!modal) return;
  modal.style.display = 'flex';
  if (status) { status.style.color = ''; status.textContent = ''; }
  if (sel) sel.innerHTML = '<option value="">불러오는 중...</option>';
  cf.getMyVouchers().then(res => {
    const vouchers = res.data?.vouchers || [];
    _coopVouchers = vouchers;
    if (!sel) return;
    if (!vouchers.length) {
      sel.innerHTML = '<option value="">보유 바우쳐가 없습니다</option>';
    } else {
      sel.innerHTML = vouchers.map((v, i) =>
        `<option value="${i}">${escHtml(v.description || '바우쳐')} [${v.source === 'game' ? '게임' : '상품'}]</option>`
      ).join('');
    }
  }).catch(() => {
    if (sel) sel.innerHTML = '<option value="">불러오기 실패</option>';
  });
}

function closeCoopVoucherOrderModal() {
  const modal = $('coopVoucherOrderModal');
  if (modal) modal.style.display = 'none';
}

$('coopBtnOpenVoucherOrder')?.addEventListener('click', openCoopVoucherOrderModal);
$('coopBtnCloseVoucherOrder')?.addEventListener('click', closeCoopVoucherOrderModal);
$('coopVoucherOrderModal')?.addEventListener('click', e => {
  if (e.target === $('coopVoucherOrderModal')) closeCoopVoucherOrderModal();
});

$('coopBtnVoGps')?.addEventListener('click', () => {
  const inp = $('coopVoLatLng');
  if (!inp) return;
  navigator.geolocation.getCurrentPosition(
    pos => { inp.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`; },
    () => {
      const s = $('coopVoStatus');
      if (s) { s.style.color = '#ef4444'; s.textContent = 'GPS 위치를 가져올 수 없습니다. 직접 입력해주세요.'; }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

$('coopBtnSubmitVoucherOrder')?.addEventListener('click', async () => {
  const btn    = $('coopBtnSubmitVoucherOrder');
  const sel    = $('coopVoVoucherSel');
  const status = $('coopVoStatus');
  const idx    = parseInt(sel?.value ?? '', 10);
  if (isNaN(idx) || !_coopVouchers[idx]) {
    if (status) { status.style.color = '#ef4444'; status.textContent = '바우쳐를 선택하세요'; }
    return;
  }
  const latLng = $('coopVoLatLng')?.value?.trim();
  if (!latLng) {
    if (status) { status.style.color = '#ef4444'; status.textContent = '설치 위치를 입력하세요'; }
    return;
  }
  const [latStr, lngStr] = latLng.split(',').map(s => s.trim());
  if (isNaN(parseFloat(latStr)) || isNaN(parseFloat(lngStr))) {
    if (status) { status.style.color = '#ef4444'; status.textContent = '좌표를 올바르게 입력하세요 (예: 21.110101, 106.393556)'; }
    return;
  }
  const voucher = _coopVouchers[idx];
  if (!confirm(`"${voucher.description || '바우쳐'}"를 관리자에게 이체하고 서비스를 신청합니다.\n취소할 수 없습니다. 계속하시겠습니까?`)) return;
  if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
  if (status) { status.style.color = '#6b7280'; status.textContent = ''; }
  try {
    const params = {
      docId:            voucher.id || null,
      sourceCollection: voucher.source === 'game' ? 'treasure_voucher_logs' : null,
      voucherId:        voucher.voucherId != null ? voucher.voucherId : undefined,
      requestedName:    $('coopVoName')?.value?.trim() || '',
      latLng,
      imageUrl:         $('coopVoImageUrl')?.value?.trim() || '',
    };
    const res = await cf.submitVoucherOrder(params);
    if (status) { status.style.color = '#22c55e'; status.textContent = `✅ 주문 완료! (주문ID: ${res.data.orderId?.slice(0, 8)}…)`; }
    loadCoopVouchers();
    setTimeout(closeCoopVoucherOrderModal, 2500);
  } catch (err) {
    if (status) { status.style.color = '#ef4444'; status.textContent = '오류: ' + (err.message || err); }
    if (btn) { btn.disabled = false; btn.textContent = '주문 제출'; }
  }
});

// ─────────────────────────────────────────────────────────
// 인증 감시 → 초기화
// ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  init(user);
});
