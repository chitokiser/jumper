'use strict';
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');

let db;
function getDb() { if (!db) db = admin.firestore(); return db; }

function verifyAuth(req) { /* TODO */ }

// POST /v1/orders
async function createOrder(req, res) {
    // 상품 가격/재고 재검증 및 동시접근 방지 Transaction
    try {
        const { merchant_id, buyer_uid, items } = req.body;
        if (!merchant_id || !items || !items.length) {
            return res.status(400).json({ success: false, error: '필수 주문 정보 누락' });
        }
        
        const db = getDb();
        const orderRef = db.collection('merchant_orders').doc();
        let calculatedTotal = 0;
        const validItems = [];
        
        await db.runTransaction(async (t) => {
            // 1. 철저한 서버 사이드 가격/재고 재검증 로직
            for (let item of items) {
                const pSnap = await t.get(db.collection('merchant_products').doc(item.product_id));
                if (!pSnap.exists) throw new Error('존재하지 않는 상품이 포함되어 있습니다.');
                const p = pSnap.data();
                
                if (p.sale_status !== 'published') throw new Error(\[\] 상품은 현재 판매 중지 또는 미공개 상태입니다.\);
                if (p.merchant_id !== merchant_id) throw new Error(\[\] 타 가맹점 상품을 섞어서 스푸핑할 수 없습니다.\);
                
                let finalItemPrice = Number(p.price) || 0;
                
                // 옵션 처리 로직 (악의적 가격 변조 방어)
                if (item.selected_option && p.options) {
                    const matchedOption = p.options.find(o => o.name === item.selected_option);
                    if (!matchedOption) throw new Error('유효하지 않은 옵션 선택');
                    finalItemPrice += Number(matchedOption.added_price || 0);
                }
                
                // 재고 검증
                if (p.inventory_managed) {
                    if (Number(p.inventory_stock) < Number(item.qty)) {
                        throw new Error(\[\] 재고가 부족합니다 (남은 수량: \)\);
                    }
                    // 임시 재고 감소 이력은 트랜잭션 종료 시 update 처리 (간단 구현)
                    t.update(pSnap.ref, { inventory_stock: admin.firestore.FieldValue.increment(-Number(item.qty)) });
                }
                
                calculatedTotal += finalItemPrice * Number(item.qty);
                validItems.push({
                    product_id: p.product_id,
                    product_name: p.product_name,
                    qty: Number(item.qty),
                    unit_price: finalItemPrice,
                    option: item.selected_option || null
                });
            }
            
            // 2. 주문 원장 등록
            t.set(orderRef, {
                order_id: orderRef.id,
                merchant_id,
                buyer_uid: buyer_uid || 'GUEST',
                items: validItems,
                total_amount: calculatedTotal, // 클라이언트 송신 total_amount 무시, 서버 100% 재계산!
                status: 'pending',
                created_at: admin.firestore.FieldValue.serverTimestamp(),
                updated_at: admin.firestore.FieldValue.serverTimestamp() // 주문 시점 스냅샷
            });
        });
        
        res.json({ success: true, order_id: orderRef.id, total_amount: calculatedTotal });
    } catch(err) {
        logger.error('createOrder', err);
        res.status(500).json({ success: false, error: err.message });
    }
}