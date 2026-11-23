// 온라인 주문(merchant_orders) 결제 확인 → 메뉴 레시피(menu_recipes)대로 자재(materials) 재고 자동 차감
// BestERP 의 assets/js/recipeEngine.js 와 같은 규칙. 같은 주문은 sales_deductions/order_{id} 로 한 번만 뺀다.
'use strict';

const admin = require('firebase-admin');

const DEDUCT_STATUSES = ['paid', 'payment_confirmed', 'completed', 'shipped'];

function isDeductible(order) {
  if (!order) return false;
  const s = String(order.status || '').toLowerCase();
  const ps = String(order.payment_status || '').toLowerCase();
  return DEDUCT_STATUSES.includes(s) || ps === 'paid' || ps === 'confirmed';
}

function planFromOrder(order, recipesById, materialsById) {
  const byMaterial = new Map();
  const matched = [];
  const unmatched = [];
  for (const it of Array.isArray(order?.items) ? order.items : []) {
    const qty = Number(it?.qty) || 0;
    if (!(qty > 0)) continue;
    const pid = String(it?.product_id || it?.productId || '');
    const recipe = recipesById[pid];
    const items = (recipe?.items || []).filter((r) => r && r.materialId && Number(r.qty) > 0);
    if (!recipe || items.length === 0) { unmatched.push({ name: String(it?.name || pid), qty }); continue; }
    matched.push({ name: recipe.productName || it.name || pid, qty, productId: pid });
    for (const r of items) {
      const prev = byMaterial.get(r.materialId) || { materialId: r.materialId, materialName: r.materialName || '', unit: r.unit || '', qty: 0 };
      prev.qty += Number(r.qty) * qty;
      byMaterial.set(r.materialId, prev);
    }
  }
  const lines = [...byMaterial.values()]
    .map((l) => ({ ...l, qty: Math.round(l.qty * 1000) / 1000, materialName: materialsById[l.materialId]?.name || l.materialName, missing: !materialsById[l.materialId] }));
  return { lines, matched, unmatched };
}

async function deductForOrder(orderId, order, { db = admin.firestore() } = {}) {
  if (!isDeductible(order)) return { skipped: 'not_paid' };
  const pids = [...new Set((order.items || []).map((i) => String(i?.product_id || i?.productId || '')).filter(Boolean))];
  if (pids.length === 0) return { skipped: 'no_items' };

  const recipeSnaps = await db.getAll(...pids.map((p) => db.collection('menu_recipes').doc(p)));
  const recipesById = {};
  recipeSnaps.forEach((s) => { if (s.exists) recipesById[s.id] = s.data(); });
  if (Object.keys(recipesById).length === 0) return { skipped: 'no_recipes' };

  const matIds = [...new Set(Object.values(recipesById).flatMap((r) => (r.items || []).map((i) => i.materialId)).filter(Boolean))];
  const matSnaps = matIds.length ? await db.getAll(...matIds.map((m) => db.collection('materials').doc(m))) : [];
  const materialsById = {};
  matSnaps.forEach((s) => { if (s.exists) materialsById[s.id] = s.data(); });

  const plan = planFromOrder(order, recipesById, materialsById);
  const lines = plan.lines.filter((l) => !l.missing && l.qty > 0);
  const FieldValue = admin.firestore.FieldValue;
  const dedRef = db.collection('sales_deductions').doc(`order_${orderId}`);
  const merchantId = String(order.merchant_id || order.merchantId || '');

  return db.runTransaction(async (tx) => {
    const ex = await tx.get(dedRef);
    if (ex.exists) return { skipped: 'already' };
    for (const l of lines) {
      tx.update(db.collection('materials').doc(l.materialId), { stock: FieldValue.increment(-l.qty), lastUsedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.set(db.collection('material_usage_logs').doc(), {
        materialId: l.materialId, materialName: l.materialName, quantity: l.qty, unit: l.unit || '',
        reason: `판매 자동 차감 (온라인 주문 ${orderId})`, source: 'online_order', sourceKey: `order_${orderId}`,
        merchantId, userEmail: 'system', userName: '레시피 자동차감', createdAt: FieldValue.serverTimestamp()
      });
    }
    tx.set(dedRef, {
      source: 'online_order', ref: orderId, merchantId,
      matched: plan.matched, unmatched: plan.unmatched,
      lines: lines.map(({ materialId, materialName, unit, qty }) => ({ materialId, materialName, unit, qty })),
      createdBy: 'system', createdAt: FieldValue.serverTimestamp()
    });
    return { deducted: lines.length };
  });
}

module.exports = { deductForOrder, planFromOrder, isDeductible };
