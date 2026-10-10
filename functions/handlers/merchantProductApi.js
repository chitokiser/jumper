'use strict';

const admin = require('firebase-admin');
const { logger } = require('firebase-functions');

let db;
function getDb() {
    if (!db) db = admin.firestore();
    return db;
}

function verifyAdmin(req) {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    if (!apiKey) throw new Error('API 토큰이 필요합니다.');
    const validKey = process.env.PARTNER_API_KEY || 'TEMP_DEV_API_KEY';
    if (apiKey.replace('Bearer ', '') !== validKey) {
        // 실제로는 Firestore에서 가맹점 API KEY 대조 또는 Auth 토큰 검증 필요
        throw new Error('권한이 없습니다.');
    }
}

// POST /v1/products (상품 등록)
async function createProduct(req, res) {
    try {
        verifyAdmin(req);
        const { merchant_id, product_name, price, product_type } = req.body;
        if (!merchant_id || !product_name || price === undefined) {
            return res.status(400).json({ success: false, error: '필수 항목 누락' });
        }
        
        const db = getDb();
        const docRef = db.collection('merchant_products').doc();
        const productData = {
            product_id: docRef.id,
            merchant_id,
            product_type: product_type || 'physical_product',
            product_name,
            price: Number(price),
            sale_status: 'draft', 
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };
        await docRef.set(productData);
        res.json({ success: true, product_id: docRef.id });
    } catch(err) {
        logger.error('createProduct', err);
        res.status(500).json({ success: false, error: err.message });
    }
}

// PATCH /v1/products/{id} (상품 수정)
async function updateProduct(req, res, productId) {
    try {
        verifyAdmin(req);
        const db = getDb();
        const updates = req.body;
        delete updates.product_id;
        updates.updated_at = admin.firestore.FieldValue.serverTimestamp();
        
        await db.collection('merchant_products').doc(productId).update(updates);
        res.json({ success: true });
    } catch(err) {
        logger.error('updateProduct', err);
        res.status(500).json({ success: false, error: err.message });
    }
}

// POST /v1/products/{id}/publish (상품 공개)
async function publishProduct(req, res, productId) {
    try {
        verifyAdmin(req);
        const db = getDb();
        await db.collection('merchant_products').doc(productId).update({
            sale_status: 'published',
            published_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        });
        res.json({ success: true });
    } catch(err) {
        logger.error('publishProduct', err);
        res.status(500).json({ success: false, error: err.message });
    }
}

// GET /v1/storefronts/{merchantId}/products (공개 상품 조회 - 가맹점 홈페이지용)
async function getStorefrontProducts(req, res, merchantId) {
    try {
        const db = getDb();
        const snapshot = await db.collection('merchant_products')
            .where('merchant_id', '==', merchantId)
            .where('sale_status', '==', 'published')
            .orderBy('display_order', 'asc')
            .get();
        
        const products = [];
        snapshot.forEach(doc => products.push(doc.data()));
        res.json({ success: true, products });
    } catch(err) {
        // 인덱스 필요할 수 있음
        logger.error('getStorefrontProducts', err);
        res.status(500).json({ success: false, error: err.message });
    }
}

// GET /v1/products/{id} (개별 상세조회)
async function getProductDetail(req, res, productId) {
    try {
        const db = getDb();
        const doc = await db.collection('merchant_products').doc(productId).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: 'Not found'});
        // 비공개 상품 접근 제한 처리 로직 (고객 vs 관리자)
        res.json({ success: true, product: doc.data() });
    } catch(err) {
        logger.error('getProductDetail', err);
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = {
    createProduct, updateProduct, publishProduct, getStorefrontProducts, getProductDetail
};
