// functions/index.js
// Firebase Cloud Functions 진입점 – 수탁형 지갑 + 기존 리뷰 집계
//
// ──────────────────────────────────────────────────────
// [최초 1회 Secret 등록]
//   firebase functions:secrets:set WALLET_MASTER_SECRET
//   firebase functions:secrets:set ADMIN_PRIVATE_KEY
//
// [배포]
//   firebase deploy --only functions
//
// [로컬 에뮬레이터]
//   WALLET_MASTER_SECRET=xxx ADMIN_PRIVATE_KEY=0x... firebase emulators:start
// ──────────────────────────────────────────────────────

'use strict';

const admin = require('firebase-admin');
const { onDocumentWritten }  = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret }       = require('firebase-functions/params');
const { logger }             = require('firebase-functions');

admin.initializeApp();
const db = admin.firestore();

// ── Firebase Secret Manager ──────────────────────────────────────────────────
const walletSecret  = defineSecret('WALLET_MASTER_SECRET');
const adminKeySecret= defineSecret('ADMIN_PRIVATE_KEY');

// ── 핸들러 ───────────────────────────────────────────────────────────────────
const onboarding = require('./handlers/onboarding');
const depositH   = require('./handlers/deposit');
const txH        = require('./handlers/transaction');

// ────────────────────────────────────────────────────────────────────────────
// 유틸 함수
// ────────────────────────────────────────────────────────────────────────────
function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다');
  }
  return request.auth.uid;
}

/** 에러를 HttpsError로 래핑하고 로그 기록 */
function wrapError(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error('[Functions Error]', err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err.message || '서버 오류');
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 수탁 지갑 생성
//    클라이언트: httpsCallable(functions, 'createWallet')()
// ════════════════════════════════════════════════════════════════════════════
exports.createWallet = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid    = requireAuth(request);
    const result = await onboarding.createCustodialWallet(uid, walletSecret.value());
    logger.info('createWallet', { uid, address: result.address, created: result.created });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 2. 온체인 조합원 가입
//    클라이언트: httpsCallable(functions, 'registerMember')({ mentorEmail: 'xxx@gmail.com' })
//    mentorEmail 없으면 bootstrapMentor 사용
// ════════════════════════════════════════════════════════════════════════════
exports.registerMember = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid         = requireAuth(request);
    const mentorEmail = request.data?.mentorEmail ?? null;
    const result = await onboarding.registerOnChain(uid, mentorEmail, walletSecret.value());
    logger.info('registerMember', { uid, mentorEmail, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 3. 멘토 등록 (이메일 ↔ 지갑 주소 연결)
//    cors: true → 127.0.0.1:5500 포함 모든 오리진 허용
//    클라이언트: fetch(url, { method:'POST', headers:{ Authorization:'Bearer {idToken}' }, body: JSON.stringify({address,signature}) })
//
//    프론트 서명 메시지:
//      const msg = `Jump Platform 멘토 등록\nEmail: ${email.toLowerCase()}`;
//      personal_sign(hexEncode(msg), address)
// ════════════════════════════════════════════════════════════════════════════
exports.linkMentor = onRequest(
  { cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
    try {
      // Firebase Auth 토큰 검증
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: '로그인이 필요합니다' });
        return;
      }
      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      } catch (_) {
        res.status(401).json({ error: '인증 토큰이 유효하지 않습니다' });
        return;
      }

      const email = decoded.email;
      if (!email) {
        res.status(401).json({ error: '구글 이메일 인증이 필요합니다' });
        return;
      }

      const { address, signature } = req.body ?? {};
      if (!address || !signature) {
        res.status(400).json({ error: 'address와 signature가 필요합니다' });
        return;
      }

      const result = await onboarding.registerMentor(email, address, signature);
      logger.info('linkMentor', { uid: decoded.uid, email, address });
      res.json(result);
    } catch (err) {
      logger.error('[linkMentor Error]', err);
      res.status(500).json({ error: err.message || '서버 오류' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 4. 내 온체인 정보 조회 (포인트, payable, 레벨 등)
//    클라이언트: httpsCallable(functions, 'getMyOnChain')()
// ════════════════════════════════════════════════════════════════════════════
exports.getMyOnChain = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return await onboarding.getUserOnChainData(uid);
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 5. 원화 입금 요청 (유저)
//    클라이언트: httpsCallable(functions, 'requestDeposit')({ amountKrw: 100000, depositorName: '홍길동' })
// ════════════════════════════════════════════════════════════════════════════
exports.requestDeposit = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { amountKrw, depositorName, bank } = request.data ?? {};
    if (!amountKrw) throw new HttpsError('invalid-argument', 'amountKrw가 필요합니다');
    if (!depositorName) throw new HttpsError('invalid-argument', 'depositorName이 필요합니다');
    const result = await depositH.requestDeposit(uid, { amountKrw, depositorName, bank });
    logger.info('requestDeposit', { uid, amountKrw, refCode: result.refCode });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 6. 충전 내역 조회 (유저)
//    클라이언트: httpsCallable(functions, 'getDepositHistory')()
// ════════════════════════════════════════════════════════════════════════════
exports.getDepositHistory = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return await depositH.getDepositHistory(uid);
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 7. 관리자: 입금 승인 + 온체인 creditPoints
//    클라이언트: httpsCallable(functions, 'approveDeposit')({ refCode: 'DEP-XXX', overrideKrwRate: null })
//    overrideKrwRate: 수동 환율 지정 (null이면 자동 조회)
// ════════════════════════════════════════════════════════════════════════════
exports.approveDeposit = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const adminUid = requireAuth(request);
    const { refCode, overrideKrwRate } = request.data ?? {};
    if (!refCode) throw new HttpsError('invalid-argument', 'refCode가 필요합니다');

    // Secret을 process.env에 주입 (chain.js의 getAdminWallet()이 읽음)
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();

    const result = await depositH.approveDeposit(adminUid, refCode, overrideKrwRate ?? null);
    logger.info('approveDeposit', { adminUid, refCode, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 8. 관리자: 대기중 입금 목록
//    클라이언트: httpsCallable(functions, 'listPendingDeposits')()
// ════════════════════════════════════════════════════════════════════════════
exports.listPendingDeposits = onCall(
  wrapError(async (request) => {
    const adminUid = requireAuth(request);
    return await depositH.listPendingDeposits(adminUid);
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 9. 상품 구매 (수탁 지갑 서명)
//    클라이언트: httpsCallable(functions, 'buyProduct')({ productId: 1 })
// ════════════════════════════════════════════════════════════════════════════
exports.buyProduct = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid       = requireAuth(request);
    const productId = request.data?.productId;
    if (!productId) throw new HttpsError('invalid-argument', 'productId가 필요합니다');
    const result = await txH.buyProduct(uid, Number(productId), walletSecret.value());
    logger.info('buyProduct', { uid, productId, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 10. 인출 – payableWei → HEX 전송 (수탁 지갑 서명)
//     클라이언트: httpsCallable(functions, 'withdraw')({ amountWei: '1000000000000000000' })
//     { amountWei: 'all' } 이면 전액 인출
// ════════════════════════════════════════════════════════════════════════════
exports.withdraw = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid       = requireAuth(request);
    const amountWei = request.data?.amountWei ?? 'all';
    const result = await txH.withdrawPayable(uid, amountWei, walletSecret.value());
    logger.info('withdraw', { uid, amountWei, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 11. 관리자: HEX approve 실행 (최초 1회 필수)
//     jumpPlatform이 owner 지갑에서 HEX를 끌어올 수 있도록
//     클라이언트: httpsCallable(functions, 'adminApproveHex')({ amountWei: null })
//     amountWei: null → MaxUint256 (무한 승인)
// ════════════════════════════════════════════════════════════════════════════
exports.adminApproveHex = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const adminUid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.adminApproveHex(adminUid, request.data?.amountWei ?? null);
    logger.info('adminApproveHex', { adminUid, ...result });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 12. 관리자: HEX allowance 조회
//     클라이언트: httpsCallable(functions, 'adminCheckAllowance')()
// ════════════════════════════════════════════════════════════════════════════
exports.adminCheckAllowance = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return await txH.adminCheckAllowance();
  })
);

// ════════════════════════════════════════════════════════════════════════════
// [기존] 리뷰 평점 집계 (유지)
// ════════════════════════════════════════════════════════════════════════════
exports.aggregateItemReviews = onDocumentWritten(
  'items/{itemId}/reviews/{reviewId}',
  async (event) => {
    const itemId = event.params.itemId;
    const before = event.data?.before?.data() || null;
    const after  = event.data?.after?.data()  || null;
    if (!before && !after) return;

    const bRating = before?.rating != null ? Number(before.rating) : 0;
    const aRating = after?.rating  != null ? Number(after.rating)  : 0;
    const itemRef = db.collection('items').doc(itemId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(itemRef);
      const cur  = snap.exists ? snap.data() : {};

      let count = Number(cur.reviewCount || 0);
      let sum   = Number(cur.reviewSum   || 0);

      if      (!before && after)  { count += 1; sum += aRating; }
      else if (before  && !after) { count = Math.max(0, count - 1); sum -= bRating; }
      else if (before  && after)  { sum += aRating - bRating; }

      if (!Number.isFinite(count) || count < 0) count = 0;
      if (!Number.isFinite(sum)   || sum   < 0) sum   = 0;

      const avg = count ? Math.round((sum / count) * 10) / 10 : 0;

      tx.set(itemRef, {
        reviewCount:     count,
        reviewSum:       sum,
        reviewAvg:       avg,
        reviewUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    logger.info('aggregateItemReviews updated', { itemId, bRating, aRating });
  }
);
