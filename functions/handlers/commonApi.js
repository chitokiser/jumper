'use strict';

const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
// 추가로 인가/권한 체계를 위한 유틸을 가져올 수 있습니다. (예: 시스템 API 키 등)

let db;

function getDb() {
    if (!db) {
        db = admin.firestore();
    }
    return db;
}

/**
 * 간단한 API Key 인증 미들웨어 로직 예시
 * 실제 운영시에는 Secret Manager에 저장된 키와 비교해야 합니다.
 */
function verifyPlatformApiKey(req) {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    if (!apiKey) {
        throw new Error('API 토큰이 필요합니다.');
    }
    // TODO: 실제 프로젝트의 SECRET MANAGER PARTNER_API_KEY 와 비교
    // 임시 하드코딩 또는 서버 환경변수 체크
    const validKey = process.env.PARTNER_API_KEY || 'TEMP_DEV_API_KEY';
    if (apiKey.replace('Bearer ', '') !== validKey) {
        throw new Error('올바르지 않은 API 키입니다.');
    }
}

/**
 * 1) 통합 회원 조회
 * GET /api/v1/members/:member_id
 */
async function getMember(req, res) {
    try {
        verifyPlatformApiKey(req);
        const memberId = req.query.member_id || req.body.member_id;
        if (!memberId) {
            return res.status(400).json({ success: false, error: 'member_id is required' });
        }

        const snap = await getDb().collection('users').doc(memberId).get();
        if (!snap.exists) {
            return res.status(404).json({ success: false, error: 'Member not found' });
        }

        const data = snap.data();
        return res.json({
            success: true,
            data: {
                member_id: memberId,
                email: data.email || null,
                name: data.name || data.displayName || null,
                status: data.blacklisted ? 'BLOCKED' : 'ACTIVE',
                walletAddress: data.wallet?.address || null,
                mentorAddress: data.onChain?.mentorAddress || null
            }
        });
    } catch (err) {
        logger.error('[getMember]', err);
        res.status(401).json({ success: false, error: err.message });
    }
}

/**
 * 2) 포인트/티켓 트랜잭션 기록(적립/사용) - 예시
 * POST /api/v1/points/transaction
 */
async function handleTransaction(req, res) {
    try {
        verifyPlatformApiKey(req);
        const { member_id, merchant_id, type, amount, reason, idempotency_key } = req.body;

        if (!member_id || !idempotency_key) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const txRef = getDb().collection('transactions').doc(idempotency_key);

        await getDb().runTransaction(async (t) => {
            const txSnap = await t.get(txRef);
            if (txSnap.exists) {
                // 이미 처리된 멱등성 키
                return;
            }

            t.set(txRef, {
                uid: member_id,
                merchantId: merchant_id || null,
                type: type || 'external_system',
                amount: Number(amount) || 0,
                reason: reason || '',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                source: '공통API'
            });

            // TODO: 실제 유저의 포인트 원장 업데이트 로직 (PointsLedger / 온체인 Hex Wei 연동)
        });

        res.json({ success: true, data: { status: 'OK', idempotency_key } });
    } catch (err) {
        logger.error('[handleTransaction]', err);
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = {
    getMember,
    handleTransaction
};
