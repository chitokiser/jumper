// /assets/js/pages/admin_coop.js
// 조합전용몰 관리자 페이지

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

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

// ─────────────────────────────────────────────────────────
// 설정 로드 + 저장
// ─────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const fn  = httpsCallable(functions, 'listCoopProducts');
    const res = await fn();
    const input = $('inputMinStake');
    if (input) input.value = res.data.minStake ?? 10000;
  } catch (_) {}
}

function bindConfigSave() {
  const btn = $('btnSaveConfig');
  if (!btn) return;
  btn.onclick = async () => {
    const val = parseInt($('inputMinStake')?.value, 10);
    if (isNaN(val) || val < 0) { setStatus('configStatus', '올바른 숫자를 입력하세요', 'err'); return; }
    btn.disabled = true;
    setStatus('configStatus', '저장 중...');
    try {
      const fn = httpsCallable(functions, 'adminSetCoopConfig');
      await fn({ minStake: val });
      setStatus('configStatus', `저장 완료 — 최소 스테이킹: ${val.toLocaleString()} JUMP`, 'ok');
    } catch (err) {
      setStatus('configStatus', '실패: ' + (err.message || '서버 오류'), 'err');
    } finally {
      btn.disabled = false;
    }
  };
}

// ─────────────────────────────────────────────────────────
// 상품 목록 로드
// ─────────────────────────────────────────────────────────
async function loadProducts() {
  setStatus('productListState', '로딩 중...');
  try {
    const fn  = httpsCallable(functions, 'listCoopProducts');
    const res = await fn();
    renderProductTable(res.data.products || []);
    setStatus('productListState', '');
  } catch (err) {
    setStatus('productListState', '오류: ' + (err.message || '조회 실패'), 'err');
  }
}

function renderProductTable(products) {
  const tbody = $('productTbody');
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = '';
    show('productListEmpty', true);
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
        <td>${imgHtml}</td>
        <td>${typeBadge} <strong>${esc(p.name)}</strong>${p.description ? `<br><span style="font-size:0.78rem;color:#888;">${esc(p.description).slice(0,40)}${p.description.length>40?'…':''}</span>` : ''}</td>
        <td>${p.price.toLocaleString()}원</td>
        <td>${stockTxt}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap;">
          <button class="ac-btn ac-btn-ghost" style="font-size:0.8rem;padding:5px 10px;" data-edit="${p.id}">수정</button>
          <button class="ac-btn ac-btn-danger" style="font-size:0.8rem;padding:5px 10px;margin-left:4px;" data-del="${p.id}">삭제</button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => startEdit(btn.dataset.edit, products));
  });
  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteProduct(btn.dataset.del));
  });
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────
// 상품 등록/수정 폼
// ─────────────────────────────────────────────────────────
function bindProductForm() {
  const btn = $('btnSaveProduct');
  if (!btn) return;

  btn.onclick = async () => {
    const id       = $('editProductId')?.value || '';
    const type     = document.querySelector('input[name="productType"]:checked')?.value || 'general';
    const name     = $('inputName')?.value.trim();
    const price    = parseInt($('inputPrice')?.value, 10);
    const desc     = $('inputDesc')?.value.trim();
    const imageUrl = $('inputImageUrl')?.value.trim();
    const stock    = parseInt($('inputStock')?.value, 10);
    const active   = $('inputActive')?.checked !== false;

    if (!name) { setStatus('productFormStatus', '상품명을 입력하세요', 'err'); return; }
    if (!price || price <= 0) { setStatus('productFormStatus', '올바른 가격을 입력하세요', 'err'); return; }

    btn.disabled = true;
    setStatus('productFormStatus', '저장 중...');
    try {
      const fn = httpsCallable(functions, 'adminSaveCoopProduct');
      await fn({ id: id || undefined, type, name, price, description: desc, imageUrl, stock: isNaN(stock) ? -1 : stock, active });
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
}

function startEdit(id, products) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  $('editProductId').value  = id;
  const typeVal = p.type === 'voucher' ? 'voucher' : 'general';
  document.querySelectorAll('input[name="productType"]').forEach(r => { r.checked = r.value === typeVal; });
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
// 초기화
// ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    show('notAdminMsg', true);
    return;
  }

  // 관리자 여부는 서버에서 판단 — 우선 UI 표시, 관리자가 아니면 API 호출 시 에러남
  show('adminContent', true);

  bindConfigSave();
  bindProductForm();
  await loadConfig();
  await loadProducts();
});
