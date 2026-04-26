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
  needLogin:       $('coopNeedLogin'),
  needLoginTitle:  $('coopNeedLoginTitle'),
  needLoginSub:    $('coopNeedLoginSub'),
  joinPanel:       $('coopJoinPanel'),
  joinFee:         $('coopJoinFeeDisplay'),
  joinFeeNote:     $('coopJoinFeeNote'),
  joinBtn:         $('coopJoinBtn'),
  joinMsg:         $('coopJoinMsg'),
  main:            $('coopMain'),
  accessBadge:     $('coopAccessBadge'),
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
};

// ─────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────
let _products = [];
let _pointsWei = 0n;    // 온체인 포인트 (HEX wei)
let _membershipFeeWei = 0n;
let _fx = null;         // { fxKrwPerHexScaled, fxVndPerHexScaled, fxScale }

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
  show(el.needLogin, false);
  show(el.joinPanel, false);
  show(el.main, false);
}

// ─────────────────────────────────────────────────────────
// Cloud Function 헬퍼
// ─────────────────────────────────────────────────────────
const cf = {
  getMembership:  httpsCallable(functions, 'coopGetMembership'),
  joinMall:       httpsCallable(functions, 'coopJoinMall'),
  listProducts:   httpsCallable(functions, 'listCoopProducts'),
  buy:            httpsCallable(functions, 'coopBuyOnChain'),
  convert:        httpsCallable(functions, 'coopConvertPoints'),
};

// ─────────────────────────────────────────────────────────
// 초기화 흐름
// ─────────────────────────────────────────────────────────
async function init() {
  show(el.loading, true);

  let membership;
  try {
    const res = await cf.getMembership();
    membership = res.data;
  } catch (err) {
    hideAll();
    el.loading.textContent = '오류: ' + (err?.message || '서버 오류');
    show(el.loading, true);
    return;
  }

  hideAll();

  if (!membership.hasWallet) {
    el.needLoginTitle.textContent = '수탁 지갑이 없습니다';
    el.needLoginSub.textContent = '마이페이지에서 지갑을 먼저 생성하세요.';
    show(el.needLogin, true);
    return;
  }

  _membershipFeeWei = BigInt(membership.membershipFeeHex || '0');

  if (membership.fxKrwPerHexScaled) {
    _fx = {
      fxKrwPerHexScaled: membership.fxKrwPerHexScaled,
      fxVndPerHexScaled: membership.fxVndPerHexScaled,
      fxScale:           membership.fxScale,
    };
  }

  if (!membership.member) {
    el.joinFee.innerHTML =
      `${fmtHex(_membershipFeeWei)}<br>` +
      `<small style="font-size:0.82rem;color:var(--muted,#6b7280);">` +
      `${hexWeiToKrw(_membershipFeeWei)} / ${hexWeiToVnd(_membershipFeeWei)}` +
      `</small>`;
    show(el.joinPanel, true);
    return;
  }

  // 회원 → 메인 화면
  _pointsWei = BigInt(membership.pointsWei || '0');
  renderPointsPanel();
  await loadProducts();
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
    frag.appendChild(card);
  });
  grid.innerHTML = '';
  grid.appendChild(frag);
}

function renderCard(p) {
  const sold = p.stock === 0;
  const imgHtml = p.imageUrl
    ? `<img class="coop-card-img" src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" loading="lazy"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
       <div class="coop-card-img-ph" style="display:none;">🛍</div>`
    : `<div class="coop-card-img-ph">🛍</div>`;

  const stockTxt = p.stock === -1 ? '' : sold ? '품절' : `재고 ${p.stock}개`;
  const typeBadge = p.type === 'voucher'
    ? `<span style="font-size:0.72rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:1px 8px;display:inline-block;margin-bottom:4px;">바우처</span>`
    : `<span style="font-size:0.72rem;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:1px 8px;display:inline-block;margin-bottom:4px;">일반상품</span>`;

  const priceKrw = p.price || 0;
  const priceVnd = krwToVndDisplay(priceKrw);
  const priceHex = krwToHexDisplay(priceKrw);

  return `
    <div class="coop-card">
      ${imgHtml}
      <div class="coop-card-body">
        ${typeBadge}
        <div class="coop-card-name">${escHtml(p.name)}</div>
        ${p.description ? `<div class="coop-card-desc">${escHtml(p.description)}</div>` : ''}
        <div class="coop-card-price">${priceKrw.toLocaleString()}원</div>
        <div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-top:2px;line-height:1.6;">
          ${priceVnd} &nbsp;·&nbsp; ${priceHex}
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
         onerror="this.outerHTML='<div class=\\'coop-detail-img-ph\\'>🛍</div>'">`
    : `<div class="coop-detail-img-ph">🛍</div>`;

  el.detailBadge.innerHTML = p.type === 'voucher'
    ? `<span style="font-size:0.75rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:2px 10px;display:inline-block;margin-bottom:6px;">바우처</span>`
    : `<span style="font-size:0.75rem;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:2px 10px;display:inline-block;margin-bottom:6px;">일반상품</span>`;

  el.detailName.textContent  = p.name || '';
  el.detailDesc.textContent  = p.description || '';
  el.detailDesc.style.display = p.description ? '' : 'none';

  const priceKrw = p.price || 0;
  el.detailPrice.innerHTML =
    `${priceKrw.toLocaleString()}원` +
    `<br><span style="font-size:0.82rem;color:var(--muted,#6b7280);font-weight:400;">` +
    `${krwToVndDisplay(priceKrw)} &nbsp;·&nbsp; ${krwToHexDisplay(priceKrw)}` +
    `</span>`;

  const stockTxt = p.stock === -1 ? '' : sold ? '품절' : `재고 ${p.stock}개`;
  el.detailStock.textContent = stockTxt;
  el.detailStock.className   = 'coop-detail-stock' + (sold ? ' out' : '');

  el.detailBuyBtn.disabled   = sold;
  el.detailBuyBtn.textContent = sold ? '품절' : '구매하기';
  el.detailBuyBtn.onclick     = () => handleBuy(productId);

  el.detailBd.onclick    = closeDetailModal;
  el.detailClose.onclick = closeDetailModal;

  const onKey = (e) => {
    if (e.key === 'Escape') { closeDetailModal(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);

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

  const confirmKrw = product.price || 0;
  if (!confirm(
    `${product.name}\n` +
    `가격: ${confirmKrw.toLocaleString()}원\n` +
    `      ${krwToVndDisplay(confirmKrw)} / ${krwToHexDisplay(confirmKrw)}\n` +
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

function showDoneModal(d, isVoucher = false) {
  const voucherNote = isVoucher
    ? `<div style="margin-top:14px;padding:10px 14px;background:#fef3c7;border-radius:10px;font-size:0.85rem;color:#92400e;line-height:1.6;">
        🎫 바우처가 지갑에 발급되었습니다.<br>
        <a href="mypage.html#voucherWallet" style="color:#b45309;font-weight:600;text-decoration:underline;">
          마이페이지 › 바우처 지갑 바로가기 →
        </a>
      </div>`
    : '';
  el.doneKvs.innerHTML = `
    <div class="coop-modal-kv"><span class="k">상품명</span><span class="v">${escHtml(d.productName)}</span></div>
    <div class="coop-modal-kv"><span class="k">결제금액</span><span class="v">${(d.priceKrw||0).toLocaleString()}원<br><small style="font-size:0.82rem;color:var(--muted,#6b7280);">${krwToVndDisplay(d.priceKrw||0)} / ${d.amountHex||'?'} HEX</small></span></div>
    <div class="coop-modal-kv"><span class="k">TxHash</span><span class="v" style="font-size:0.75em;">${(d.txHash||'').slice(0,22)}…</span></div>
    ${voucherNote}
  `;
  show(el.doneModal, true);
  el.doneModalBd.onclick   = closeDoneModal;
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
    el.joinBtn.textContent = '회원 가입하기';
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
// 인증 감시 → 초기화
// ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) {
    hideAll();
    el.needLoginTitle.textContent = '로그인이 필요합니다';
    el.needLoginSub.textContent   = '조합 전용몰을 이용하려면 로그인하세요.';
    show(el.needLogin, true);
    return;
  }
  init();
});
