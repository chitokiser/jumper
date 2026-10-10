'use strict';

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const apiApp = express();

// CORS를 허용하여 가맹점 홈페이지(외부 도메인)에서 API를 호출할 수 있도록 합니다.
apiApp.use(cors({ origin: true }));
apiApp.use(express.json());

// ────────────────────────────────────────────────────────
// [보안 미들웨어] API KEY 검증
// ────────────────────────────────────────────────────────
apiApp.use(async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'] || req.query.apiKey;
        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'API 키가 필요합니다. (x-api-key 헤더)' });
        }

        const db = admin.firestore();
        // 가맹점(merchants) 컬렉션에서 해당 apiKey를 가진 가맹점 조회
        const snap = await db.collection('merchants').where('apiKey', '==', apiKey).limit(1).get();

        if (snap.empty) {
            return res.status(403).json({ success: false, error: '유효하지 않은 API 키입니다.' });
        }

        req.merchantDoc = snap.docs[0];
        req.merchantId = snap.docs[0].id;
        req.db = db;

        next();
    } catch (err) {
        console.error('API 미들웨어 에러:', err);
        return res.status(500).json({ success: false, error: '서버 인증 오류가 발생했습니다.' });
    }
});

// ────────────────────────────────────────────────────────
// 1. [가맹점 잔여 포인트 & BT 조회 API]
// ────────────────────────────────────────────────────────
apiApp.get('/v1/balance', async (req, res) => {
    try {
        const data = req.merchantDoc.data();
        return res.json({
            success: true,
            merchantId: req.merchantId,
            merchantName: data.name || '알 수 없음',
            balance: {
                points: data.points || 0, // Platform 충전 포인트 (VND 환산 등)
                bt: data.btBalance || 0   // 가맹점 인벤토리 내 BT 잔여량
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: '잔액 조회 중 오류가 발생했습니다.' });
    }
});

// ────────────────────────────────────────────────────────
// 2. [해당 가맹점에서 유치/관리 중인 회원 DB 조회 API]
// ────────────────────────────────────────────────────────
apiApp.get('/v1/members', async (req, res) => {
    try {
        const limitCount = parseInt(req.query.limit) || 50;

        // 가맹점의 레퍼럴로 가입했거나, 해당 가맹점에 소속된 유저 탐색
        const snap = await req.db.collection('users')
            .where('referredBy', '==', req.merchantId)
            .orderBy('createdAt', 'desc')
            .limit(limitCount)
            .get();

        const members = [];
        snap.forEach(doc => {
            const d = doc.data();
            members.push({
                uid: doc.id,
                email: d.email || '',
                displayName: d.displayName || '이름 없음',
                userLevel: d.userLevel || 1,
                pointBalance: d.pointBalance || 0, // 고객의 포인트
                btBalance: d.btBalance || 0,       // 고객의 잔여 BT
                joinedAt: d.createdAt ? d.createdAt.toDate().toISOString() : null
            });
        });

        return res.json({
            success: true,
            merchantId: req.merchantId,
            memberCount: members.length,
            members: members
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: '회원 DB 조회 중 오류가 발생했습니다.' });
    }
});

module.exports = apiApp;
