// /assets/js/pages/admin_coop.js
// 조합전용몰 관리자 페이지

import { auth, db, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { collection, getDocs, query, orderBy, where } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? '' : 'none';
}

function setStatus(id, msg, type = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'ac-status' + (type ? ' ' + type : '');
}

function fmtHex(weiStr) {
  try { return (Number(BigInt(weiStr)) / 1e18).toFixed(4) + ' HEX'; }
  catch { return weiStr; }
}

// ─────────────────────────────────────────────────────────
// 컨트랙트 잔고 대시보드
// ─────────────────────────────────────────────────────────
let _stats = null;  // 캐시 (최대값 계산용)

async function loadStats() {
  setStatus('statsStatus', '조회 중...');
  try {
    const fn = httpsCallable(functions, 'coopAdminGetStats');
    const res = await fn();
    _stats = res.data;

    $('statHexBal').textContent      = fmtHex(_stats.hexBalance);
    $('statWithdrawable').textContent = fmtHex(_stats.withdrawableHex);
    $('statJumpBal').textContent      = BigInt(_stats.jumpBalance).toLocaleString() + ' JUMP';
    $('statTotalPts').textContent     = fmtHex(_stats.totalPoints);
    $('statFee').textContent          = fmtHex(_stats.membershipFeeHex);
    $('statMentorBps').textContent    = (_stats.mentorRewardBps / 100).toFixed(1) + '%';

    setStatus('statsStatus', '');
  } catch (err) {
    setStatus('statsStatus', '조회 실패: ' + (err.message || '서버 오류'), 'err');
  }
}

function bindStats() {
  $('btnRefreshStats').onclick = loadStats;

  // HEX 인출
  $('btnWithdrawHexMax').onclick = () => {
    if (!_stats) return;
    $('inputWithdrawHex').value = (Number(BigInt(_stats.withdrawableHex)) / 1e18).toFixed(4);
  };
  $('btnWithdrawHex').onclick = async () => {
    const hexVal = parseFloat($('inputWithdrawHex')?.value);
    if (!hexVal || hexVal <= 0) { setStatus('withdrawHexStatus', '수량을 입력하세요', 'err'); return; }
    const amountWei = BigInt(Math.floor(hexVal * 1e18)).toString();
    const btn = $('btnWithdrawHex');
    btn.disabled = true;
    setStatus('withdrawHexStatus', '처리 중...');
    try {
      const fn = httpsCallable(functions, 'coopAdminWithdrawHex');
      const res = await fn({ amountWei });
      const txHash = res.data?.txHash || '';
      setStatus('withdrawHexStatus', `완료! ${hexVal.toFixed(4)} HEX 인출됨. Tx: ${txHash.slice(0,18)}…`, 'ok');
      $('inputWithdrawHex').value = '';
      await loadStats();
    } catch (err) {
      setStatus('withdrawHexStatus', '실패: ' + (err.message || '서버 오류'), 'err');
    } finally {
      btn.disabled = false;
    }
  };

  // JUMP 인출
  $('btnWithdrawJumpMax').onclick = () => {
    if (!_stats) return;
    $('inputWithdrawJump').value = BigInt(_stats.jumpBalance).toString();
  };
  $('btnWithdrawJump').onclick = async () => {
    const jumpVal = $('inputWithdrawJump')?.value.trim();
    if (!jumpVal || BigInt(jumpVal) <= 0n) { setStatus('withdrawJumpStatus', '수량을 입력하세요', 'err'); return; }
    const btn = $('btnWithdrawJump');
    btn.disabled = true;
    setStatus('withdrawJumpStatus', '처리 중...');
    try {
      const fn = httpsCallable(functions, 'coopAdminWithdrawJump');
      const res = await fn({ amount: jumpVal });
      const txHash = res.data?.txHash || '';
      setStatus('withdrawJumpStatus', `완료! ${BigInt(jumpVal).toLocaleString()} JUMP 인출됨. Tx: ${txHash.slice(0,18)}…`, 'ok');
      $('inputWithdrawJump').value = '';
      await loadStats();
    } catch (err) {
      setStatus('withdrawJumpStatus', '실패: ' + (err.message || '서버 오류'), 'err');
    } finally {
      btn.disabled = false;
    }
  };

  // 회비 변경
  $('btnSetFee').onclick = async () => {
    const hexVal = parseFloat($('inputSetFee')?.value);
    if (!hexVal || hexVal <= 0) { setStatus('setFeeStatus', '회비 수량을 입력하세요', 'err'); return; }
    const feeWei = BigInt(Math.floor(hexVal * 1e18)).toString();
    const btn = $('btnSetFee');
    btn.disabled = true;
    setStatus('setFeeStatus', '처리 중...');
    try {
      const fn = httpsCallable(functions, 'coopAdminSetFee');
      await fn({ feeWei });
      setStatus('setFeeStatus', `회비 변경 완료 → ${hexVal.toFixed(4)} HEX`, 'ok');
      await loadStats();
    } catch (err) {
      setStatus('setFeeStatus', '실패: ' + (err.message || '서버 오류'), 'err');
    } finally {
      btn.disabled = false;
    }
  };

  // 멘토 수당 변경
  $('btnSetMentorBps').onclick = async () => {
    const bps = parseInt($('inputSetMentorBps')?.value, 10);
    if (isNaN(bps) || bps < 0 || bps > 10000) { setStatus('setFeeStatus', 'BPS는 0~10000 범위로 입력하세요', 'err'); return; }
    const btn = $('btnSetMentorBps');
    btn.disabled = true;
    setStatus('setFeeStatus', '처리 중...');
    try {
      const fn = httpsCallable(functions, 'coopAdminSetFee');
      await fn({ mentorBps: bps });
      setStatus('setFeeStatus', `멘토 수당 변경 완료 → ${(bps/100).toFixed(1)}%`, 'ok');
      await loadStats();
    } catch (err) {
      setStatus('setFeeStatus', '실패: ' + (err.message || '서버 오류'), 'err');
    } finally {
      btn.disabled = false;
    }
  };
}

// ─────────────────────────────────────────────────────────
// 상품 목록 로드 (활성/비활성 전체)
// ─────────────────────────────────────────────────────────
async function loadProducts() {
  setStatus('productListState', '로딩 중...');
  try {
    const snap = await getDocs(collection(db, 'coopProducts'));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderProductTable(list);
    setStatus('productListState', `총 ${list.length}개`);
  } catch (err) {
    setStatus('productListState', '오류: ' + (err.message || '조회 실패'), 'err');
  }
}

function updateCopyBtn() {
  const anyChecked = document.querySelectorAll('.chk-product:checked').length > 0;
  const btn = $('btnCopySelected');
  if (btn) btn.style.display = anyChecked ? '' : 'none';
}

function renderProductTable(products) {
  const tbody = $('productTbody');
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = '';
    show('productListEmpty', true);
    show('btnCopySelected', false);
    return;
  }
  show('productListEmpty', false);

  tbody.innerHTML = products.map(p => {
    const stockTxt  = p.stock === -1 ? '무제한' : p.stock === 0 ? '품절' : `${p.stock}개`;
    const imgHtml   = p.imageUrl
      ? `<img class="ac-thumb" src="${esc(p.imageUrl)}" alt="" onerror="this.style.display='none'">`
      : `<span style="font-size:1.5rem;">🛍</span>`;
    const badge     = p.active
      ? `<span class="ac-badge-on">판매중</span>`
      : `<span class="ac-badge-off">비활성</span>`;
    const typeBadge = p.type === 'voucher'
      ? `<span style="font-size:0.72rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:1px 7px;">바우처</span>`
      : `<span style="font-size:0.72rem;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:1px 7px;">일반상품</span>`;

    return `
      <tr>
        <td style="text-align:center;"><input type="checkbox" class="chk-product" data-id="${p.id}" /></td>
        <td>${imgHtml}</td>
        <td>${typeBadge} <strong>${esc(p.name)}</strong>${p.description ? `<br><span style="font-size:0.78rem;color:#888;">${esc(p.description).slice(0,40)}${p.description.length>40?'…':''}</span>` : ''}</td>
        <td>${p.price.toLocaleString()}원<br><span style="font-size:0.75rem;color:#6b7280;">${krwToVnd(p.price)} &nbsp;·&nbsp; ${krwToHex(p.price)}</span></td>
        <td>${stockTxt}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap;">
          <button class="ac-btn ac-btn-ghost" style="font-size:0.8rem;padding:5px 10px;" data-edit="${p.id}">수정</button>
          <button class="ac-btn ac-btn-danger" style="font-size:0.8rem;padding:5px 10px;margin-left:4px;" data-del="${p.id}">삭제</button>
        </td>
      </tr>`;
  }).join('');

  // 개별 체크박스 → 복사 버튼 표시/숨김
  tbody.querySelectorAll('.chk-product').forEach(chk => {
    chk.addEventListener('change', updateCopyBtn);
  });

  // 전체 선택
  const chkAll = $('chkAll');
  if (chkAll) {
    chkAll.checked = false;
    chkAll.onchange = () => {
      tbody.querySelectorAll('.chk-product').forEach(c => { c.checked = chkAll.checked; });
      updateCopyBtn();
    };
  }

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => startEdit(btn.dataset.edit, products));
  });
  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteProduct(btn.dataset.del));
  });

  // 복사 버튼
  const copyBtn = $('btnCopySelected');
  if (copyBtn) {
    copyBtn.onclick = () => copySelectedProducts(products);
  }

  updateCopyBtn();
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────
// 선택 복사
// ─────────────────────────────────────────────────────────
async function copySelectedProducts(products) {
  const checked = [...document.querySelectorAll('.chk-product:checked')];
  if (checked.length === 0) return;

  if (!confirm(`선택한 ${checked.length}개 상품을 복사하시겠습니까?`)) return;

  const copyBtn = $('btnCopySelected');
  if (copyBtn) { copyBtn.disabled = true; copyBtn.textContent = '복사 중...'; }

  const fn = httpsCallable(functions, 'adminSaveCoopProduct');
  let successCount = 0;
  const errors = [];

  for (const chk of checked) {
    const p = products.find(x => x.id === chk.dataset.id);
    if (!p) continue;
    try {
      await fn({
        type:        p.type || 'general',
        name:        p.name + ' (복사)',
        description: p.description || '',
        price:       p.price,
        imageUrl:    p.imageUrl || '',
        stock:       p.stock,
        active:      false,   // 복사본은 기본 비활성
      });
      successCount++;
    } catch (err) {
      errors.push(p.name);
    }
  }

  if (copyBtn) { copyBtn.disabled = false; copyBtn.textContent = '선택 복사'; }

  await loadProducts();

  if (errors.length === 0) {
    setStatus('productListState', `총 ${successCount}개 복사 완료 (비활성 상태로 생성됨)`, 'ok');
  } else {
    setStatus('productListState', `${successCount}개 성공 / ${errors.length}개 실패`, 'err');
    alert(`복사 실패 상품:\n${errors.join('\n')}`);
  }
}

// ─────────────────────────────────────────────────────────
// 상품 등록/수정 폼
// ─────────────────────────────────────────────────────────
function bindProductForm() {
  const btn = $('btnSaveProduct');
  if (!btn) return;

  btn.onclick = async () => {
    const id          = $('editProductId')?.value || '';
    const type        = document.querySelector('input[name="productType"]:checked')?.value || 'general';
    const name        = $('inputName')?.value.trim();
    const price       = parseInt($('inputPrice')?.value, 10);
    const desc        = $('inputDesc')?.value.trim();
    const imageUrl    = $('inputImageUrl')?.value.trim();
    const stock       = parseInt($('inputStock')?.value, 10);
    const active      = $('inputActive')?.checked !== false;
    const burnFeeBps  = type === 'voucher' ? parseInt($('inputBurnFeeBps')?.value || '0', 10) : 0;

    if (!name) { setStatus('productFormStatus', '상품명을 입력하세요', 'err'); return; }
    if (!price || price <= 0) { setStatus('productFormStatus', '올바른 가격을 입력하세요', 'err'); return; }

    btn.disabled = true;
    setStatus('productFormStatus', '저장 중...');
    try {
      const fn = httpsCallable(functions, 'adminSaveCoopProduct');
      await fn({ id: id || undefined, type, name, price, description: desc, imageUrl, stock: isNaN(stock) ? -1 : stock, active, burnFeeBps });
      setStatus('productFormStatus', id ? '수정 완료!' : '등록 완료!', 'ok');
      resetForm();
      await loadProducts();
    } catch (err) {
      setStatus('productFormStatus', '실패: ' + (err.message || '서버 오류'), 'err');
    } finally {
      btn.disabled = false;
    }
  };

  $('btnCancelEdit')?.addEventListener('click', resetForm);

  // 상품 유형 라디오 → 소각 수수료 행 표시/숨기기
  document.querySelectorAll('input[name="productType"]').forEach(r => {
    r.addEventListener('change', () => {
      const isVoucher = document.querySelector('input[name="productType"]:checked')?.value === 'voucher';
      const row = $('burnFeeBpsRow');
      if (row) row.style.display = isVoucher ? '' : 'none';
    });
  });

  // HEX 입력 → KRW/VND/HEX 미리보기 + KRW 자동 입력
  $('inputHexPrice')?.addEventListener('input', () => {
    const hexVal = parseFloat($('inputHexPrice').value);
    const preview = $('pricePreview');
    const krwRate = _krwPerHex();
    const vndRate = _vndPerHex();
    if (!hexVal || hexVal <= 0 || !krwRate) {
      preview?.classList.remove('active');
      return;
    }
    const krw = Math.round(hexVal * krwRate);
    const vnd = Math.round(hexVal * vndRate);

    $('prevKrw').textContent = krw.toLocaleString() + ' ₩';
    $('prevVnd').textContent = vnd.toLocaleString() + ' ₫';
    $('prevHex').textContent = hexVal.toFixed(4) + ' HEX';
    preview?.classList.add('active');

    // KRW 가격 필드 자동 입력
    if ($('inputPrice') && !$('inputPrice').dataset.manualOverride) {
      $('inputPrice').value = krw;
    }
  });

  // 사용자가 KRW 필드를 직접 수정하면 자동 입력 중단
  $('inputPrice')?.addEventListener('input', () => {
    if ($('inputHexPrice')?.value) {
      $('inputPrice').dataset.manualOverride = '1';
    }
  });
}

function startEdit(id, products) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  $('editProductId').value  = id;
  const typeVal = p.type === 'voucher' ? 'voucher' : 'general';
  document.querySelectorAll('input[name="productType"]').forEach(r => { r.checked = r.value === typeVal; });
  const burnFeeRow = $('burnFeeBpsRow');
  if (burnFeeRow) burnFeeRow.style.display = typeVal === 'voucher' ? '' : 'none';
  if ($('inputBurnFeeBps')) $('inputBurnFeeBps').value = p.burnFeeBps ?? 0;
  $('inputName').value      = p.name || '';
  $('inputPrice').value     = p.price || '';
  $('inputDesc').value      = p.description || '';
  $('inputImageUrl').value  = p.imageUrl || '';
  $('inputStock').value     = p.stock ?? -1;
  $('inputActive').checked  = p.active !== false;
  $('formTitle').textContent = '상품 수정';
  $('btnSaveProduct').textContent = '수정 저장';
  show('btnCancelEdit', true);
  document.getElementById('inputName')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetForm() {
  $('editProductId').value  = '';
  $('inputName').value      = '';
  $('inputPrice').value     = '';
  $('inputDesc').value      = '';
  $('inputImageUrl').value  = '';
  $('inputStock').value     = '-1';
  $('inputActive').checked  = true;
  $('inputHexPrice').value  = '';
  if ($('inputBurnFeeBps')) $('inputBurnFeeBps').value = '0';
  const burnFeeRow = $('burnFeeBpsRow');
  if (burnFeeRow) burnFeeRow.style.display = 'none';
  document.querySelectorAll('input[name="productType"]').forEach(r => { r.checked = r.value === 'general'; });
  delete $('inputPrice').dataset.manualOverride;
  $('pricePreview')?.classList.remove('active');
  $('formTitle').textContent = '상품 등록';
  $('btnSaveProduct').textContent = '등록';
  show('btnCancelEdit', false);
  setStatus('productFormStatus', '');
}

async function deleteProduct(id) {
  if (!confirm('이 상품을 삭제하시겠습니까?')) return;
  try {
    const fn = httpsCallable(functions, 'adminDeleteCoopProduct');
    await fn({ id });
    await loadProducts();
  } catch (err) {
    alert('삭제 실패: ' + (err.message || '서버 오류'));
  }
}

// ─────────────────────────────────────────────────────────
// 주문 내역 (일반상품)
// ─────────────────────────────────────────────────────────
const ORDER_STATUS_LABELS = {
  confirmed:  '결제완료',
  processing: '처리중',
  shipped:    '발송완료',
  delivered:  '수령완료',
  cancelled:  '취소',
};
const ORDER_NEXT_STATUSES = {
  confirmed:  ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped:    ['delivered', 'cancelled'],
  delivered:  [],
  cancelled:  [],
};

let _currentOrderFilter = '';

async function loadOrders(statusFilter = _currentOrderFilter) {
  _currentOrderFilter = statusFilter;
  setStatus('orderListState', '로딩 중...');
  try {
    let q;
    const col = collection(db, 'coopOrders');
    if (statusFilter) {
      q = query(col, where('status', '==', statusFilter), orderBy('createdAt', 'desc'));
    } else {
      q = query(col, orderBy('createdAt', 'desc'));
    }
    const snap = await getDocs(q);
    const orders = [];
    snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
    // 일반상품만 표시 (type이 없거나 'general')
    const general = orders.filter(o => !o.type || o.type === 'general');
    renderOrderTable(general);
    setStatus('orderListState', `총 ${general.length}건`);
  } catch (err) {
    setStatus('orderListState', '오류: ' + (err.message || '조회 실패'), 'err');
  }
}

function renderOrderTable(orders) {
  const tbody = $('orderTbody');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = '';
    show('orderListEmpty', true);
    return;
  }
  show('orderListEmpty', false);

  tbody.innerHTML = orders.map(o => {
    const date = o.createdAt?.seconds
      ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('ko-KR')
      : '—';
    const hexAmt = o.hexWei
      ? (Number(BigInt(o.hexWei)) / 1e18).toFixed(4) + ' HEX'
      : '—';
    const statusClass = `os-${o.status || 'confirmed'}`;
    const statusLabel = ORDER_STATUS_LABELS[o.status] || o.status || '—';
    const nextStatuses = ORDER_NEXT_STATUSES[o.status] || [];
    const actionBtns = nextStatuses.length === 0
      ? '<span style="font-size:0.75rem;color:#9ca3af;">완료</span>'
      : nextStatuses.map(s =>
          `<button class="ac-btn ac-btn-ghost" style="font-size:0.75rem;padding:3px 9px;margin:2px;"
            data-order-id="${esc(o.id)}" data-order-status="${s}">${ORDER_STATUS_LABELS[s]}</button>`
        ).join('');
    const noteHtml = o.adminNote
      ? `<div class="ac-order-note">${esc(o.adminNote)}</div>` : '';

    return `
      <tr>
        <td style="white-space:nowrap;font-size:0.8rem;">${date}</td>
        <td><strong>${esc(o.productName || '—')}</strong>${noteHtml}</td>
        <td style="font-size:0.75rem;color:#6b7280;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(o.uid || '')}">${esc((o.uid || '').slice(0, 12))}…</td>
        <td style="white-space:nowrap;">${(o.priceKrw || 0).toLocaleString()}원</td>
        <td style="white-space:nowrap;font-size:0.8rem;">${hexAmt}</td>
        <td><span class="ac-order-status ${statusClass}">${statusLabel}</span></td>
        <td style="white-space:nowrap;">${actionBtns}</td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-order-id]').forEach(btn => {
    btn.addEventListener('click', () => updateOrderStatus(btn.dataset.orderId, btn.dataset.orderStatus));
  });
}

async function updateOrderStatus(orderId, status) {
  try {
    const fn = httpsCallable(functions, 'coopAdminUpdateOrder');
    await fn({ orderId, status });
    await loadOrders();
  } catch (err) {
    alert('상태 변경 실패: ' + (err.message || '서버 오류'));
  }
}

function bindOrders() {
  const tabs = document.querySelectorAll('#orderTabs .ac-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadOrders(tab.dataset.status || '');
    });
  });
  $('btnRefreshOrders')?.addEventListener('click', () => loadOrders());
}

// ─────────────────────────────────────────────────────────
// 바우처 관리
// ─────────────────────────────────────────────────────────

function fmtHexShort(weiStr) {
  try { return (Number(BigInt(weiStr)) / 1e18).toFixed(4); }
  catch { return weiStr; }
}

function _krwPerHex() {
  if (!_stats?.fxKrwPerHexScaled) return 0;
  return Number(_stats.fxKrwPerHexScaled) / _stats.fxScale;
}
function _vndPerHex() {
  if (!_stats?.fxVndPerHexScaled) return 0;
  return Number(_stats.fxVndPerHexScaled) / _stats.fxScale;
}
function hexWeiToKrw(weiStr) {
  const r = _krwPerHex(); if (!r) return '—';
  return Math.round(Number(weiStr) / 1e18 * r).toLocaleString() + ' ₩';
}
function hexWeiToVnd(weiStr) {
  const r = _vndPerHex(); if (!r) return '—';
  return Math.round(Number(weiStr) / 1e18 * r).toLocaleString() + ' ₫';
}
function krwToVnd(krw) {
  const kr = _krwPerHex(), vr = _vndPerHex(); if (!kr) return '—';
  return Math.round(krw * vr / kr).toLocaleString() + ' ₫';
}
function krwToHex(krw) {
  const r = _krwPerHex(); if (!r) return '—';
  return (krw / r).toFixed(4) + ' HEX';
}

async function loadVouchers() {
  try {
    const fn = httpsCallable(functions, 'coopAdminListVouchers');
    const res = await fn();
    const { templates = [], vouchers = [] } = res.data ?? {};
    renderVoucherTemplates(templates);
    renderIssuedVouchers(vouchers, templates);
  } catch (err) {
    setStatus('voucherFormStatus', '바우처 조회 실패: ' + (err.message || '서버 오류'), 'err');
  }
}

function renderVoucherTemplates(templates) {
  const grid = $('voucherTemplateGrid');
  if (!templates.length) {
    grid.innerHTML = '';
    show('voucherTemplateEmpty', true);
    return;
  }
  show('voucherTemplateEmpty', false);
  const frag = document.createDocumentFragment();
  templates.forEach(t => {
    const card = document.createElement('div');
    card.className = 'ac-voucher-card';
    const imgSrc = t.imageUrl || '/assets/img/voucher-placeholder.png';
    const badge  = t.active
      ? '<span class="ac-voucher-badge-active">활성</span>'
      : '<span class="ac-voucher-badge-inactive">비활성</span>';
    card.innerHTML = `
      <img src="${imgSrc}" alt="바우처" onerror="this.style.background='#f3f4f6';this.src=''">
      <div class="ac-voucher-card-body">
        <div class="ac-voucher-card-title">${t.description || '(내용 없음)'} ${badge}</div>
        <div class="ac-voucher-card-meta">
          사용처: ${t.usagePlace || '—'}<br>
          가격: ${fmtHexShort(t.hexPrice)} HEX &nbsp;·&nbsp; ${hexWeiToKrw(t.hexPrice)} &nbsp;·&nbsp; ${hexWeiToVnd(t.hexPrice)}<br>
          소각 수수료: ${(t.burnFeeBps / 100).toFixed(1)}%
        </div>
        <div class="ac-voucher-card-actions">
          <button class="ac-btn ac-btn-ghost" style="font-size:0.78rem;padding:4px 10px;"
            data-vid="${t.id}" data-active="${t.active}" data-action="toggle">
            ${t.active ? '비활성화' : '활성화'}
          </button>
        </div>
      </div>`;
    frag.appendChild(card);
  });
  grid.innerHTML = '';
  grid.appendChild(frag);

  // 활성/비활성 토글
  grid.querySelectorAll('[data-action="toggle"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const templateId = Number(btn.dataset.vid);
      const nextActive = btn.dataset.active === 'false';
      btn.disabled = true;
      try {
        const fn = httpsCallable(functions, 'coopAdminUpdateVoucher');
        await fn({ templateId, active: nextActive });
        await loadVouchers();
      } catch (err) {
        alert('상태 변경 실패: ' + (err.message || '서버 오류'));
        btn.disabled = false;
      }
    });
  });
}

function renderIssuedVouchers(vouchers, templates) {
  const tbody = $('voucherIssuedTbody');
  if (!vouchers.length) {
    tbody.innerHTML = '';
    show('voucherIssuedEmpty', true);
    return;
  }
  show('voucherIssuedEmpty', false);
  const tplMap = Object.fromEntries(templates.map(t => [String(t.id), t]));
  const rows = vouchers.map(v => {
    const tpl = tplMap[String(v.templateId)] ?? {};
    const statusBadge = v.status === 'burned'
      ? '<span class="vs-burned">소각됨</span>'
      : v.status === 'transferred'
        ? '<span class="vs-transferred">이체됨</span>'
        : '<span class="vs-active">보유</span>';
    const date = v.createdAt?.toDate?.()?.toLocaleDateString?.('ko-KR') ?? v.createdAt ?? '—';
    return `<tr>
      <td>#${v.id}</td>
      <td>${tpl.description || v.templateId}</td>
      <td style="font-size:0.75rem;word-break:break-all;">${v.ownerUid || '—'}</td>
      <td>${statusBadge}</td>
      <td>${date}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('');
}

function bindVoucherForm() {
  const form = $('voucherForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hexPrice    = $('voucherHexPrice').value.trim();
    const burnFeeBps  = Number($('voucherBurnFee').value);
    const description = $('voucherDescription').value.trim();
    const usagePlace  = $('voucherUsagePlace').value.trim();
    const imageUrl    = $('voucherImageUrl').value.trim();

    if (!hexPrice || !description || !usagePlace) {
      setStatus('voucherFormStatus', 'HEX 가격, 바우처 내용, 사용처는 필수입니다.', 'err');
      return;
    }
    if (burnFeeBps < 0 || burnFeeBps > 10000) {
      setStatus('voucherFormStatus', '소각 수수료는 0–10000 BPS 범위여야 합니다.', 'err');
      return;
    }

    const btn = $('btnCreateVoucher');
    btn.disabled = true;
    setStatus('voucherFormStatus', '등록 중...', '');
    try {
      const fn = httpsCallable(functions, 'coopAdminCreateVoucher');
      const res = await fn({ hexPrice, burnFeeBps, description, usagePlace, imageUrl });
      setStatus('voucherFormStatus', `바우처 템플릿 등록 완료 (templateId: ${res.data.templateId})`, 'ok');
      form.reset();
      await loadVouchers();
    } catch (err) {
      setStatus('voucherFormStatus', '등록 실패: ' + (err.message || '서버 오류'), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  $('btnCancelVoucher').addEventListener('click', () => {
    $('voucherForm').reset();
    setStatus('voucherFormStatus', '');
  });

  $('btnRefreshVouchers').addEventListener('click', loadVouchers);
}

// ─────────────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    show('notAdminMsg', true);
    return;
  }

  show('adminContent', true);

  bindStats();
  bindProductForm();
  bindOrders();
  bindVoucherForm();
  await loadStats();
  await loadProducts();
  await loadOrders();
  await loadVouchers();
});
