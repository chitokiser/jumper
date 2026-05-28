// /assets/js/admin_shops.js
// 관리자 게임 패널 — 상점 관리 탭
'use strict';

import { db, functions } from './firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import {
  collection, getDocs, query, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const fldShopId          = document.getElementById('shopId');
const fldShopName        = document.getElementById('shopName');
const fldShopOwnerUid    = document.getElementById('shopOwnerUid');
const fldShopType        = document.getElementById('shopType');
const fldShopCoords      = document.getElementById('shopCoords');
const fldShopLevel       = document.getElementById('shopLevel');
const fldShopImageUrl    = document.getElementById('shopImageUrl');
const fldShopActive      = document.getElementById('shopActive');
const fldShopItems       = document.getElementById('shopItems');
const btnSaveShop        = document.getElementById('btnSaveShop');
const btnClearShopForm   = document.getElementById('btnClearShopForm');
const shopSaveResult     = document.getElementById('shopSaveResult');
const btnReloadShops     = document.getElementById('btnReloadShops');
const shopList           = document.getElementById('shopList');
const shopTransferSection  = document.getElementById('shopTransferSection');
const shopTransferEmail    = document.getElementById('shopTransferEmail');
const shopTransferTargetId = document.getElementById('shopTransferTargetId');
const btnConfirmTransfer   = document.getElementById('btnConfirmTransfer');
const btnCancelTransfer    = document.getElementById('btnCancelTransfer');
const shopTransferResult   = document.getElementById('shopTransferResult');

// ── Callables ─────────────────────────────────────────────────────────────────
const fnAdminSaveShop   = httpsCallable(functions, 'adminSaveShop');
const fnAdminDeleteShop = httpsCallable(functions, 'adminDeleteShop');
const fnTransferShop    = httpsCallable(functions, 'transferShop');
const fnLevelUpShop     = httpsCallable(functions, 'levelUpShop');

// ── In-memory cache ───────────────────────────────────────────────────────────
const shopCache = {};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function setResult(el, msg, ok = true) {
  el.textContent = msg;
  el.style.color = ok ? 'var(--green, #16a34a)' : '#dc2626';
}
function clearResult(el) { el.textContent = ''; }

function hpBar(hp, maxHp) {
  const pct   = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  const color = pct > 60 ? '#16a34a' : pct > 25 ? '#f59e0b' : '#dc2626';
  return `<div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%;margin-top:4px;">
    <div style="background:${color};width:${pct.toFixed(1)}%;height:100%;border-radius:4px;"></div>
  </div>`;
}

function typeLabel(t) {
  if (t === 'weapon_armor') return '무기/방어구';
  if (t === 'potion')       return '포션';
  if (t === 'misc')         return '기타';
  return t || '';
}

// loadShops는 admin-approve.js의 btnTabShops 리스너에서 window._adminLoadShops()로 호출됨
window._adminLoadShops = loadShops;

btnReloadShops?.addEventListener('click', loadShops);

// ── Render shop card ──────────────────────────────────────────────────────────
function renderShopCard(s) {
  const hp        = s.hp    ?? s.maxHp ?? 0;
  const maxHp     = s.maxHp ?? (s.level ?? 1) * 10000;
  const lvl       = s.level ?? 1;
  const nextCost  = lvl * lvl * 10000;
  const itemCount = Array.isArray(s.items) ? s.items.length : 0;
  const activeTag = s.active === false
    ? '<span style="color:#dc2626;font-size:11px;">비활성</span>'
    : '<span style="color:#16a34a;font-size:11px;">활성</span>';
  const idJson   = JSON.stringify(s.id);
  const imgHtml  = s.imageUrl
    ? `<img src="${esc(s.imageUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0;">`
    : '';

  return `
  <div class="card card--row" style="margin-bottom:10px;">
    <div class="card-body">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        ${imgHtml}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="font-size:14px;">${esc(s.name || '(이름없음)')}</strong>
            ${activeTag}
            <span class="chip" style="font-size:11px;">Lv.${lvl}</span>
            <span class="chip" style="font-size:11px;">${typeLabel(s.type)}</span>
          </div>
          <div class="muted" style="font-size:12px;margin-top:2px;">
            ID: <code>${esc(s.id)}</code> &nbsp;|&nbsp; 소유자: <code>${esc(s.ownerUid || '-')}</code>
          </div>
          <div style="font-size:12px;margin-top:2px;">
            HP: <strong>${hp.toLocaleString()}</strong> / ${maxHp.toLocaleString()}
            ${hpBar(hp, maxHp)}
          </div>
          <div class="muted" style="font-size:12px;margin-top:2px;">
            판매 아이템: ${itemCount}개 &nbsp;|&nbsp; 다음 레벨업 비용: ${nextCost.toLocaleString()} 골드
          </div>
          ${s.lat != null ? `<div class="muted" style="font-size:11px;">위치: ${s.lat}, ${s.lng}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-sm" onclick='adminShopEdit(${idJson})'>수정</button>
        <button class="btn btn-sm" onclick='adminShopLevelUp(${idJson},${lvl})'>레벨업 (${nextCost.toLocaleString()}G)</button>
        <button class="btn btn-sm" onclick='adminShopTransfer(${idJson})'>양도</button>
        <button class="btn btn-sm" style="background:#dc2626;color:#fff;border-color:#dc2626;" onclick='adminShopDelete(${idJson})'>삭제</button>
      </div>
    </div>
  </div>`;
}

// ── Load shop list ────────────────────────────────────────────────────────────
async function loadShops() {
  shopList.innerHTML = '<div class="muted" style="padding:12px;">상점 목록 로딩 중...</div>';
  try {
    const snap = await getDocs(
      query(collection(db, 'game_shops'), orderBy('createdAt', 'desc'), limit(200))
    );
    if (snap.empty) {
      shopList.innerHTML = '<div class="muted" style="padding:12px;">등록된 상점이 없습니다.</div>';
      return;
    }
    const rows = [];
    snap.forEach(d => {
      const shop = { id: d.id, ...d.data() };
      shopCache[d.id] = shop;
      rows.push(shop);
    });
    shopList.innerHTML = rows.map(renderShopCard).join('');
  } catch (e) {
    shopList.innerHTML = `<div style="color:#dc2626;padding:12px;">오류: ${esc(e.message)}</div>`;
  }
}

// ── Edit — fill form from cache ───────────────────────────────────────────────
window.adminShopEdit = function(shopId) {
  const s = shopCache[shopId];
  if (!s) { alert('상점 데이터를 찾을 수 없습니다. 목록을 새로고침하세요.'); return; }

  fldShopId.value       = s.id;
  fldShopName.value     = s.name || '';
  fldShopOwnerUid.value = s.ownerUid || '';
  fldShopType.value     = s.type || 'weapon_armor';
  fldShopCoords.value   = s.lat != null ? `${s.lat}, ${s.lng}` : '';
  fldShopLevel.value    = s.level ?? 1;
  fldShopImageUrl.value = s.imageUrl || '';
  fldShopActive.value   = s.active === false ? 'false' : 'true';
  fldShopItems.value    = Array.isArray(s.items) ? JSON.stringify(s.items, null, 2) : '';
  clearResult(shopSaveResult);
  fldShopName.focus();
};

// ── Level up ──────────────────────────────────────────────────────────────────
window.adminShopLevelUp = async function(shopId, currentLevel) {
  const cost = currentLevel * currentLevel * 10000;
  if (!confirm(`Lv.${currentLevel} → Lv.${currentLevel + 1} 레벨업\n비용: ${cost.toLocaleString()} 골드\n관리자는 강제 레벨업합니다. 계속?`)) return;
  try {
    const res = await fnLevelUpShop({ shopId });
    alert(`레벨업 완료: Lv.${res.data?.newLevel} / maxHp ${Number(res.data?.newMaxHp ?? 0).toLocaleString()}`);
    loadShops();
  } catch (e) {
    alert('레벨업 실패: ' + e.message);
  }
};

// ── Transfer ──────────────────────────────────────────────────────────────────
window.adminShopTransfer = function(shopId) {
  shopTransferTargetId.value = shopId;
  shopTransferEmail.value    = '';
  clearResult(shopTransferResult);
  shopTransferSection.style.display = '';
  shopTransferEmail.focus();
};

btnCancelTransfer?.addEventListener('click', () => {
  shopTransferSection.style.display = 'none';
  shopTransferTargetId.value = '';
});

btnConfirmTransfer?.addEventListener('click', async () => {
  const shopId = shopTransferTargetId.value.trim();
  const email  = shopTransferEmail.value.trim();
  if (!shopId || !email) {
    setResult(shopTransferResult, '상점 ID와 이메일이 모두 필요합니다.', false);
    return;
  }
  try {
    await fnTransferShop({ shopId, toEmail: email });
    setResult(shopTransferResult, `양도 완료 → ${email}`);
    shopTransferSection.style.display = 'none';
    shopTransferTargetId.value = '';
    loadShops();
  } catch (e) {
    setResult(shopTransferResult, '양도 실패: ' + e.message, false);
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
window.adminShopDelete = async function(shopId) {
  if (!confirm(`상점 [${shopId}]을 삭제합니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    await fnAdminDeleteShop({ shopId });
    alert('삭제 완료');
    loadShops();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
};

// ── Save shop ─────────────────────────────────────────────────────────────────
btnSaveShop?.addEventListener('click', async () => {
  clearResult(shopSaveResult);

  const coordsRaw = fldShopCoords.value.trim();
  let lat, lng;
  if (coordsRaw) {
    const parts = coordsRaw.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 2 || parts.some(Number.isNaN)) {
      setResult(shopSaveResult, '좌표 형식 오류 (예: 20.948, 105.974)', false);
      return;
    }
    [lat, lng] = parts;
  }

  let items = [];
  if (fldShopItems.value.trim()) {
    try { items = JSON.parse(fldShopItems.value.trim()); }
    catch { setResult(shopSaveResult, '판매 아이템 JSON 형식 오류', false); return; }
  }

  const payload = {
    name:     fldShopName.value.trim(),
    type:     fldShopType.value,
    active:   fldShopActive.value !== 'false',
    imageUrl: fldShopImageUrl.value.trim(),
    level:    parseInt(fldShopLevel.value, 10) || 1,
    items,
    ...(fldShopId.value.trim()       && { shopId:    fldShopId.value.trim() }),
    ...(fldShopOwnerUid.value.trim() && { ownerUid:  fldShopOwnerUid.value.trim() }),
    ...(lat != null                  && { lat, lng }),
  };

  btnSaveShop.disabled = true;
  try {
    const res = await fnAdminSaveShop(payload);
    setResult(shopSaveResult, `저장 완료 (ID: ${res.data?.shopId ?? '신규'})`);
    clearShopForm();
    loadShops();
  } catch (e) {
    setResult(shopSaveResult, '저장 실패: ' + e.message, false);
  } finally {
    btnSaveShop.disabled = false;
  }
});

// ── Clear form ────────────────────────────────────────────────────────────────
function clearShopForm() {
  fldShopId.value       = '';
  fldShopName.value     = '';
  fldShopOwnerUid.value = '';
  fldShopType.value     = 'weapon_armor';
  fldShopCoords.value   = '';
  fldShopLevel.value    = '1';
  fldShopImageUrl.value = '';
  fldShopActive.value   = 'true';
  fldShopItems.value    = '';
  clearResult(shopSaveResult);
}

btnClearShopForm?.addEventListener('click', clearShopForm);
