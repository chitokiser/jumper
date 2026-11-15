// functions/handlers/coupon.js
// BM 기반 이벤트 쿠폰·바우쳐 발행, 구매/발급 및 사용 처리 핸들러

'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

/**
 * 고유 쿠폰 코드 생성 (예: BC-9X4K-7P2M-3Q8Z)
 */
function generateCouponCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let segment = () => {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
  };
  return `BC-${segment()}-${segment()}-${segment()}`;
}

/**
 * 1. 유료 BM 구매 및 무료 발급 처리 (원자적 트랜잭션)
 */
async function purchaseOrIssueCoupon(uid, { campaignId, reqId } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('발행 상품 ID가 누락되었습니다.');

  const txId = reqId ? `TX_CPN_${reqId}` : `TX_CPN_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  return await db.runTransaction(async (tx) => {
    // 멱등성 검증 (동일 요청 중복 처리 방지)
    const txRef = db.collection('transactions').doc(txId);
    const existingTx = await tx.get(txRef);
    if (existingTx.exists) {
      throw new Error('이미 처리된 구매/발급 요청입니다.');
    }

    // 캠페인 조회
    const campaignRef = db.collection('coupon_campaigns').doc(campaignId);
    const campaignSnap = await tx.get(campaignRef);
    if (!campaignSnap.exists) {
      throw new Error('존재하지 않는 쿠폰·바우쳐입니다.');
    }

    const c = campaignSnap.data();
    if (c.status !== 'active') {
      throw new Error('현재 판매/발급 중인 상품이 아닙니다.');
    }

    if (c.issueMethod === 'GOOGLE_REVIEW') {
      throw new Error('구글 리뷰 인증 이벤트는 댓글에 구글 리뷰 URL을 등록하신 후 관리자가 확인하여 바우쳐 1장을 이체해 드립니다.');
    }

    const now = Date.now();
    const saleStart = c.saleStartsAt?.toMillis ? c.saleStartsAt.toMillis() : new Date(c.saleStartsAt || 0).getTime();
    const saleEnd = c.saleEndsAt?.toMillis ? c.saleEndsAt.toMillis() : new Date(c.saleEndsAt || 0).getTime();

    if (saleStart && now < saleStart) {
      throw new Error('아직 판매/발급 시작 전입니다.');
    }
    if (saleEnd && now > saleEnd) {
      throw new Error('판매/발급 기간이 종료되었습니다.');
    }

    const totalQty = Number(c.totalQuantity || 0);
    const issuedQty = Number(c.issuedQuantity || 0);
    if (totalQty > 0 && issuedQty >= totalQty) {
      throw new Error('준비된 수량이 모두 소진되었습니다. (품절)');
    }

    // 유저당 최대 구매/발급 한도 검증
    const maxPerUser = Number(c.maxPerUser || 1);
    const userCouponsQuery = db.collection('user_coupons')
      .where('userId', '==', uid)
      .where('campaignId', '==', campaignId);
    const userCouponsSnap = await tx.get(userCouponsQuery);

    if (userCouponsSnap.size >= maxPerUser) {
      throw new Error(`회원당 최대 ${maxPerUser}장까지만 구매/발급 가능합니다.`);
    }

    // 가격 확인 및 유저 잔액 검증
    const priceBM = Number(c.priceBM || 0);
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('유저 정보를 찾을 수 없습니다.');

    const userData = userSnap.data();
    const userBalanceVnd = Number(userData.pointBalanceVnd || 0);

    if (priceBM > 0) {
      if (userBalanceVnd < priceBM) {
        throw new Error(`BM 잔액이 부족합니다. (필요: ${priceBM.toLocaleString()} BM, 보유: ${userBalanceVnd.toLocaleString()} BM)`);
      }
      // BM 차감
      tx.update(userRef, {
        pointBalanceVnd: admin.firestore.FieldValue.increment(-priceBM),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // 거래 원장 기록
      tx.set(txRef, {
        userId: uid,
        type: 'COUPON_PURCHASE',
        campaignId,
        amountVnd: -priceBM,
        currency: 'VND',
        status: 'completed',
        description: `[${c.campaignType === 'VOUCHER' ? '바우쳐' : '쿠폰'}] ${c.title} 구매`,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // 캠페인 발급 수량 증가
    tx.update(campaignRef, {
      issuedQuantity: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 회원 보유 쿠폰 문서 생성
    const couponCode = generateCouponCode();
    const tokenHash = crypto.createHash('sha256').update(`${couponCode}_${uid}_${now}`).digest('hex');
    const newUserCouponRef = db.collection('user_coupons').doc();

    const validStart = c.validStartsAt || admin.firestore.FieldValue.serverTimestamp();
    const validEnd = c.validEndsAt || new Date(now + 30 * 86400000); // 기본 30일

    const newUserCouponData = {
      userCouponId: newUserCouponRef.id,
      campaignId,
      userId: uid,
      userEmail: userData.email || '',
      campaignType: c.campaignType || 'COUPON',
      title: c.title,
      description: c.description || '',
      imageUrl: c.imageUrl || '',
      issuerType: c.issuerType || 'PLATFORM',
      issuerId: c.issuerId || 'platform',
      issuerNameSnapshot: c.issuerNameSnapshot || 'BestClub Official',
      issuerBadge: c.issuerBadge || 'VERIFIED MERCHANT',
      applicableMerchantIds: c.applicableMerchantIds || ['all'],
      applicableProductIds: c.applicableProductIds || [],
      discountType: c.discountType || 'PERCENT',
      discountValue: c.discountValue || '10',
      usageMode: c.usageMode || 'BOTH',
      terms: c.terms || '',
      couponCode,
      tokenHash,
      purchasePriceBM: priceBM,
      transactionId: priceBM > 0 ? txId : null,
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
      validStartsAt: validStart,
      expiresAt: validEnd,
      status: 'available', // available | used | expired | cancelled
      redeemedAt: null,
      redeemedMerchantId: null,
      staffUserId: null,
      orderId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    tx.set(newUserCouponRef, newUserCouponData);

    return {
      success: true,
      userCouponId: newUserCouponRef.id,
      couponCode,
      priceBM,
      newBalanceVnd: userBalanceVnd - priceBM,
      title: c.title,
      campaignType: c.campaignType
    };
  });
}

/**
 * 2. 오프라인 현장 가맹점 직원의 쿠폰/바우쳐 사용 승인 처리
 */
async function redeemCouponOffline(staffUid, { couponCode, merchantId } = {}) {
  const db = getDb();
  if (!staffUid) throw new Error('가맹점 직원/관리자 로그인이 필요합니다.');
  if (!couponCode) throw new Error('쿠폰 코드를 입력해 주세요.');
  if (!merchantId) throw new Error('가맹점 ID가 지정되지 않았습니다.');

  const cleanCode = couponCode.trim().toUpperCase();

  // 가맹점 권한 검증: staffUid가 해당 가맹점의 점주이거나 admins에 등록된 관리자인지 확인
  const merchantRef = db.collection('merchants').doc(String(merchantId));
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) throw new Error('존재하지 않는 가맹점입니다.');
  const mData = merchantSnap.data();

  const adminSnap = await db.collection('admins').doc(staffUid).get();
  const isSuperAdmin = adminSnap.exists;
  const isOwner = String(mData.ownerUid) === String(staffUid);

  if (!isSuperAdmin && !isOwner) {
    throw new Error('해당 가맹점의 쿠폰을 승인할 권한이 없습니다.');
  }

  // user_coupons 조회
  const qSnap = await db.collection('user_coupons').where('couponCode', '==', cleanCode).limit(1).get();
  if (qSnap.empty) {
    throw new Error('유효하지 않은 쿠폰 코드입니다.');
  }

  const userCouponDoc = qSnap.docs[0];
  const userCouponRef = userCouponDoc.ref;
  const uc = userCouponDoc.data();

  if (uc.status !== 'available') {
    if (uc.status === 'used') throw new Error(`이미 사용 완료된 쿠폰입니다. (사용일시: ${uc.redeemedAt?.toDate ? uc.redeemedAt.toDate().toLocaleString('ko-KR') : '확인됨'})`);
    if (uc.status === 'expired') throw new Error('유효기간이 만료된 쿠폰입니다.');
    throw new Error(`사용할 수 없는 상태입니다. (현재 상태: ${uc.status})`);
  }

  // 만료일 검증
  const now = Date.now();
  const expireTime = uc.expiresAt?.toMillis ? uc.expiresAt.toMillis() : new Date(uc.expiresAt || 0).getTime();
  if (expireTime && now > expireTime) {
    await userCouponRef.update({ status: 'expired', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    throw new Error('쿠폰의 유효기간이 지났습니다. (기간 만료)');
  }

  // 사용 가능 가맹점 검증
  const allowedMerchants = uc.applicableMerchantIds || ['all'];
  if (!allowedMerchants.includes('all') && !allowedMerchants.includes(String(merchantId))) {
    throw new Error(`이 쿠폰은 현재 가맹점(${mData.name || merchantId})에서 사용할 수 없습니다.`);
  }

  // 사용 승인 트랜잭션
  const redemptionId = `RED_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  await db.runTransaction(async (tx) => {
    tx.update(userCouponRef, {
      status: 'used',
      redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      redeemedMerchantId: String(merchantId),
      staffUserId: staffUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (uc.campaignId) {
      const campRef = db.collection('coupon_campaigns').doc(uc.campaignId);
      tx.update(campRef, {
        redeemedQuantity: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    const redRef = db.collection('coupon_redemptions').doc(redemptionId);
    tx.set(redRef, {
      redemptionId,
      userCouponId: userCouponDoc.id,
      campaignId: uc.campaignId || '',
      merchantId: String(merchantId),
      merchantName: mData.name || mData.merchantName || '공식 가맹점',
      userId: uc.userId,
      userEmail: uc.userEmail || '',
      staffUserId: staffUid,
      usageMode: 'OFFLINE',
      couponTitle: uc.title,
      campaignType: uc.campaignType,
      status: 'success',
      redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  return {
    success: true,
    redemptionId,
    title: uc.title,
    campaignType: uc.campaignType,
    userEmail: uc.userEmail,
    redeemedMerchantName: mData.name || mData.merchantName || '가맹점'
  };
}

/**
 * 3. 신규 쿠폰·바우쳐 발행 캠페인 생성
 */
async function createCouponCampaign(uid, data) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');

  // 수퍼 어드민 또는 가맹점 확인
  const adminSnap = await db.collection('admins').doc(uid).get();
  const userSnap = await db.collection('users').doc(uid).get();
  const uData = userSnap.data() || {};
  const isSuperAdmin = adminSnap.exists || uData.email === 'daguri75@gmail.com' || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';
  const myMerchantId = uData.merchantId ? String(uData.merchantId) : null;

  if (!isSuperAdmin && !myMerchantId) {
    throw new Error('쿠폰·바우쳐를 발행할 권한이 없습니다. (수퍼 어드민 또는 등록된 가맹점만 가능)');
  }

  // 가맹점인 경우 본인 가맹점 ID로 강제 고정
  let issuerId = isSuperAdmin ? (data.issuerId || 'platform') : myMerchantId;
  let issuerType = isSuperAdmin && issuerId === 'platform' ? 'PLATFORM' : 'MERCHANT';
  const issueMethod = data.issueMethod === 'GOOGLE_REVIEW' ? 'GOOGLE_REVIEW' : 'DIRECT';
  const isGoogleReview = issueMethod === 'GOOGLE_REVIEW';

  const docRef = db.collection('coupon_campaigns').doc();
  const newCampaign = {
    campaignId: docRef.id,
    campaignType: data.campaignType === 'VOUCHER' ? 'VOUCHER' : 'COUPON',
    issueMethod,
    googleReviewTargetUrl: String(data.googleReviewTargetUrl || '').trim(),
    issuerType,
    issuerId,
    issuerNameSnapshot: data.issuerNameSnapshot || '공식 가맹점',
    issuerBadge: data.issuerBadge || (isSuperAdmin ? 'SUPER ADMIN' : 'VERIFIED MERCHANT'),
    title: data.title || '이벤트 혜택',
    description: data.description || '',
    imageUrl: data.imageUrl || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
    priceBM: isGoogleReview ? 0 : Math.max(0, Number(data.priceBM || 0)),
    discountType: data.discountType || 'PERCENT',
    discountValue: data.discountValue || '10',
    applicableMerchantIds: Array.isArray(data.applicableMerchantIds) ? data.applicableMerchantIds : [issuerId],
    applicableProductIds: Array.isArray(data.applicableProductIds) ? data.applicableProductIds : [],
    totalQuantity: Math.max(1, Number(data.totalQuantity || 100)),
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: isGoogleReview ? 1 : Math.max(1, Number(data.maxPerUser || 1)),
    saleStartsAt: data.saleStartsAt ? new Date(data.saleStartsAt) : admin.firestore.FieldValue.serverTimestamp(),
    saleEndsAt: data.saleEndsAt ? new Date(data.saleEndsAt) : new Date(Date.now() + 365 * 86400000),
    validStartsAt: data.validStartsAt ? new Date(data.validStartsAt) : admin.firestore.FieldValue.serverTimestamp(),
    validEndsAt: data.validEndsAt ? new Date(data.validEndsAt) : new Date(Date.now() + 365 * 86400000),
    usageMode: data.usageMode || 'BOTH',
    terms: data.terms || '본 쿠폰은 명시된 가맹점 및 유효기간 내에서만 사용 가능합니다.',
    status: 'active',
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await docRef.set(newCampaign);
  return { success: true, campaignId: docRef.id };
}

/**
 * 4. 쿠폰·바우쳐 수정 (수퍼 어드민 또는 발행 가맹점주)
 */
async function updateCouponCampaign(uid, { campaignId, updates } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');

  const adminSnap = await db.collection('admins').doc(uid).get();
  const userSnap = await db.collection('users').doc(uid).get();
  const uData = userSnap.data() || {};
  const isSuperAdmin = adminSnap.exists || uData.email === 'daguri75@gmail.com' || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';
  const myMerchantId = uData.merchantId ? String(uData.merchantId) : null;

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const campSnap = await campRef.get();
  if (!campSnap.exists) throw new Error('존재하지 않는 캠페인입니다.');
  const campData = campSnap.data() || {};

  if (!isSuperAdmin && (!myMerchantId || String(campData.issuerId) !== myMerchantId)) {
    throw new Error('수퍼 어드민 또는 발행 가맹점주만 쿠폰·바우쳐를 수정할 수 있습니다.');
  }

  const allowedFields = [
    'campaignType', 'issueMethod', 'googleReviewTargetUrl', 'issuerId', 'issuerNameSnapshot',
    'title', 'description', 'imageUrl', 'priceBM', 'discountValue',
    'totalQuantity', 'maxPerUser', 'usageMode', 'terms', 'status',
    'issuerBadge', 'applicableMerchantIds'
  ];

  const cleanUpdates = {};
  for (const key of allowedFields) {
    if (updates && updates[key] !== undefined) {
      if (key === 'priceBM' || key === 'totalQuantity' || key === 'maxPerUser') {
        cleanUpdates[key] = Number(updates[key]);
      } else {
        cleanUpdates[key] = updates[key];
      }
    }
  }
  if (cleanUpdates.issueMethod === 'GOOGLE_REVIEW') {
    cleanUpdates.priceBM = 0;
    cleanUpdates.maxPerUser = 1;
  }
  cleanUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await campRef.update(cleanUpdates);
  return { success: true, campaignId };
}

/**
 * 5. 쿠폰·바우쳐 비활성화/활성화 토글 (수퍼 어드민 또는 발행 가맹점주)
 */
async function toggleCouponCampaignStatus(uid, { campaignId, status } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');

  const adminSnap = await db.collection('admins').doc(uid).get();
  const userSnap = await db.collection('users').doc(uid).get();
  const uData = userSnap.data() || {};
  const isSuperAdmin = adminSnap.exists || uData.email === 'daguri75@gmail.com' || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';
  const myMerchantId = uData.merchantId ? String(uData.merchantId) : null;

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const campSnap = await campRef.get();
  if (!campSnap.exists) throw new Error('존재하지 않는 캠페인입니다.');
  const campData = campSnap.data() || {};

  if (!isSuperAdmin && (!myMerchantId || String(campData.issuerId) !== myMerchantId)) {
    throw new Error('수퍼 어드민 또는 발행 가맹점주만 상태를 변경할 수 있습니다.');
  }

  const newStatus = status === 'paused' ? 'paused' : 'active';
  await campRef.update({
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, campaignId, status: newStatus };
}

/**
 * 6. 쿠폰·바우쳐 삭제 (수퍼 어드민 또는 발행 가맹점주)
 */
async function deleteCouponCampaign(uid, { campaignId } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');

  const adminSnap = await db.collection('admins').doc(uid).get();
  const userSnap = await db.collection('users').doc(uid).get();
  const uData = userSnap.data() || {};
  const isSuperAdmin = adminSnap.exists || uData.email === 'daguri75@gmail.com' || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';
  const myMerchantId = uData.merchantId ? String(uData.merchantId) : null;

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const campSnap = await campRef.get();
  if (!campSnap.exists) throw new Error('존재하지 않는 캠페인입니다.');
  const campData = campSnap.data() || {};

  if (!isSuperAdmin && (!myMerchantId || String(campData.issuerId) !== myMerchantId)) {
    throw new Error('수퍼 어드민 또는 발행 가맹점주만 삭제할 수 있습니다.');
  }

  await campRef.delete();
  return { success: true, campaignId };
}

/**
 * 7. 구글 리뷰 URL 댓글 등록 (1계정 1회 참여 보장)
 */
async function submitCouponReviewComment(uid, { campaignId, reviewUrl, reviewText } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');
  const cleanUrl = String(reviewUrl || '').trim();
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('올바른 구글 리뷰 URL(http:// 또는 https://)을 입력해 주세요.');
  }

  const commentId = `${campaignId}_${uid}`;
  const commentRef = db.collection('coupon_review_comments').doc(commentId);
  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const userRef = db.collection('users').doc(uid);
  const deterministicCouponRef = db.collection('user_coupons').doc(`UC_REV_${campaignId}_${uid}`);

  return await db.runTransaction(async (tx) => {
    const [campSnap, commentSnap, userSnap, ucSnap] = await Promise.all([
      tx.get(campRef),
      tx.get(commentRef),
      tx.get(userRef),
      tx.get(deterministicCouponRef)
    ]);

    if (!campSnap.exists) throw new Error('존재하지 않는 이벤트 캠페인입니다.');
    const c = campSnap.data() || {};
    if (c.status !== 'active') throw new Error('현재 진행 중인 이벤트가 아닙니다.');

    const totalQty = Number(c.totalQuantity || 0);
    const issuedQty = Number(c.issuedQuantity || 0);
    if (totalQty > 0 && issuedQty >= totalQty) {
      throw new Error('준비된 바우쳐 수량이 모두 소진되었습니다.');
    }

    if (ucSnap.exists) {
      throw new Error('이미 본 이벤트 바우쳐를 지급받으셨습니다. (1계정 1회 참여 가능)');
    }

    if (commentSnap.exists) {
      const existing = commentSnap.data() || {};
      if (existing.status === 'approved') {
        throw new Error('이미 리뷰 인증이 완료되어 바우쳐가 지급되었습니다. (1계정 1회 참여 가능)');
      }
      if (existing.status === 'pending') {
        throw new Error('이미 구글 리뷰 URL을 등록하셨습니다. 관리자 확인 대기 중입니다. (1계정 1회 참여 가능)');
      }
    }

    const uData = userSnap.exists ? (userSnap.data() || {}) : {};
    const userEmail = uData.email || '';
    const userName = uData.name || uData.displayName || (userEmail ? userEmail.split('@')[0] : '회원');

    tx.set(commentRef, {
      commentId,
      campaignId,
      campaignTitle: c.title || '',
      issuerId: c.issuerId || '',
      userId: uid,
      userEmail,
      userName,
      reviewUrl: cleanUrl,
      reviewText: String(reviewText || '').trim().slice(0, 200),
      status: 'pending',
      issuedCouponCode: null,
      issuedUserCouponId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, commentId };
  });
}

/**
 * 8. 관리자의 구글 리뷰 확인 후 BT 지급 (2026-11-15: 바우쳐 → BT 로 변경)
 *    - BT는 캠페인별 BT 풀(review_bt_pools/{campaignId}, 서버 전용)에서만 나간다. 풀이 비면 지급 불가.
 *    - 1계정 1회: review_bt_claims/{campaignId}_{uid} 결정적 문서 + 기존 바우쳐 수령자(UC_REV_...) 제외
 *    - 함수 이름은 화면 호환을 위해 그대로 둔다.
 */
async function approveReviewAndTransferVoucher(adminUid, { campaignId, commentId } = {}) {
  const db = getDb();
  if (!adminUid) throw new Error('관리자 로그인이 필요합니다.');
  if (!campaignId || !commentId) throw new Error('캠페인 ID와 댓글 ID가 필요합니다.');

  const [adminSnap, adminUserSnap] = await Promise.all([
    db.collection('admins').doc(adminUid).get(),
    db.collection('users').doc(adminUid).get()
  ]);
  const adminUserData = adminUserSnap.data() || {};
  const isSuperAdmin =
    adminSnap.exists ||
    adminUserData.email === 'daguri75@gmail.com' ||
    adminUserData.role === 'SUPER_ADMIN' ||
    adminUserData.role === 'admin';
  const myMerchantId = adminUserData.merchantId ? String(adminUserData.merchantId) : null;

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const commentRef = db.collection('coupon_review_comments').doc(commentId);
  const poolRef = db.collection('review_bt_pools').doc(campaignId);

  const result = await db.runTransaction(async (tx) => {
    const [campSnap, commentSnap, poolSnap] = await Promise.all([
      tx.get(campRef),
      tx.get(commentRef),
      tx.get(poolRef)
    ]);

    if (!campSnap.exists) throw new Error('존재하지 않는 캠페인입니다.');
    if (!commentSnap.exists) throw new Error('존재하지 않는 리뷰 댓글입니다.');

    const c = campSnap.data() || {};
    const cmt = commentSnap.data() || {};

    if (cmt.campaignId && String(cmt.campaignId) !== String(campaignId)) {
      throw new Error('댓글과 캠페인이 일치하지 않습니다.');
    }

    const isIssuerOwner = myMerchantId && (
      String(c.issuerId) === myMerchantId ||
      (Array.isArray(c.applicableMerchantIds) && c.applicableMerchantIds.map(String).includes(myMerchantId))
    );
    if (!isSuperAdmin && !isIssuerOwner) {
      throw new Error('수퍼 어드민 또는 해당 이벤트 발행 가맹점주만 BT를 지급할 수 있습니다.');
    }

    if (cmt.status === 'approved') {
      throw new Error('이미 보상이 지급된 참여건입니다.');
    }

    const targetUid = cmt.userId;
    if (!targetUid) throw new Error('참여 회원 UID를 확인할 수 없습니다.');

    const claimRef = db.collection('review_bt_claims').doc(`${campaignId}_${targetUid}`);
    const oldVoucherRef = db.collection('user_coupons').doc(`UC_REV_${campaignId}_${targetUid}`);
    const userRef = db.collection('users').doc(targetUid);
    const [claimSnap, oldVoucherSnap, userSnap] = await Promise.all([
      tx.get(claimRef), tx.get(oldVoucherRef), tx.get(userRef)
    ]);
    if (claimSnap.exists || oldVoucherSnap.exists) {
      throw new Error('해당 회원은 이미 본 이벤트 보상을 받았습니다. (1계정 1회 참여 제한)');
    }
    if (!userSnap.exists) throw new Error('참여 회원 정보를 찾을 수 없습니다.');

    const pool = poolSnap.exists ? Math.floor(Number(poolSnap.data().btPool || 0)) : 0;
    const rewardBt = poolSnap.exists ? Math.max(1, Math.floor(Number(poolSnap.data().rewardBt || 1))) : 1;
    if (pool < rewardBt) {
      throw new Error('이 이벤트의 BT 풀이 비어 있습니다. 관리자 패널에서 BT를 먼저 충전해 주세요.');
    }

    tx.update(poolRef, {
      btPool: admin.firestore.FieldValue.increment(-rewardBt),
      btPaid: admin.firestore.FieldValue.increment(rewardBt),
      claimCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(userRef, { btBalance: admin.firestore.FieldValue.increment(rewardBt) });
    tx.set(claimRef, {
      campaignId,
      commentId,
      userId: targetUid,
      userEmail: cmt.userEmail || '',
      rewardBt,
      reviewUrl: cmt.reviewUrl || '',
      approvedBy: adminUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(db.collection('transactions').doc(`TX_REVIEW_${campaignId}_${targetUid}`), {
      uid: targetUid,
      type: 'GOOGLE_REVIEW_BT',
      btAmount: rewardBt,
      campaignId,
      commentId,
      approvedBy: adminUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(db.collection('bt_transactions').doc(), {
      type: 'review_reward',
      campaignId,
      uid: targetUid,
      amount: rewardBt,
      poolAfter: pool - rewardBt,
      adminUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(campRef, {
      issuedQuantity: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(commentRef, {
      status: 'approved',
      rewardType: 'BT',
      issuedBt: rewardBt,
      approvedBy: adminUid,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { rewardBt, targetUid, targetEmail: cmt.userEmail || '', remainingPool: pool - rewardBt };
  });

  // EXP: BT 1개당 100 EXP (실패해도 지급에는 영향 없음)
  try {
    await require('./exp').grantExp(result.targetUid, result.rewardBt * 100, 'bt');
  } catch (_) { /* noop */ }

  return {
    success: true,
    btGiven: result.rewardBt,
    targetUid: result.targetUid,
    targetEmail: result.targetEmail,
    remainingPool: result.remainingPool
  };
}

/**
 * 8-B. 구글 리뷰 이벤트 BT 풀 충전 (최고 관리자)
 */
async function chargeReviewBtPool(adminUid, { campaignId, amount } = {}) {
  const db = getDb();
  const { requireAdmin } = require('../wallet/admin');
  await requireAdmin(adminUid);
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < 1 || amt > 100000) throw new Error('충전 BT는 1 ~ 100,000 사이여야 합니다.');

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const poolRef = db.collection('review_bt_pools').doc(campaignId);
  return db.runTransaction(async (tx) => {
    const [campSnap, poolSnap] = await Promise.all([tx.get(campRef), tx.get(poolRef)]);
    if (!campSnap.exists) throw new Error('존재하지 않는 캠페인입니다.');
    const c = campSnap.data() || {};
    if (c.issueMethod !== 'GOOGLE_REVIEW') throw new Error('구글 리뷰 이벤트에만 BT 풀을 충전할 수 있습니다.');
    const prev = poolSnap.exists ? poolSnap.data() : {};
    const newPool = Math.floor(Number(prev.btPool || 0)) + amt;
    const rewardBt = Math.max(1, Math.floor(Number(prev.rewardBt || 1)));
    tx.set(poolRef, {
      campaignId,
      rewardBt,
      btPool: newPool,
      btCharged: Math.floor(Number(prev.btCharged || 0)) + amt,
      btPaid: Math.floor(Number(prev.btPaid || 0)),
      claimCount: Math.floor(Number(prev.claimCount || 0)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    // 카드 표시용 수량: 지금까지 지급 + 남은 풀로 지급 가능한 인원
    tx.update(campRef, {
      totalQuantity: Math.floor(Number(c.issuedQuantity || 0)) + Math.floor(newPool / rewardBt),
      discountValue: `${rewardBt} BT`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(db.collection('bt_transactions').doc(), {
      type: 'review_pool_charge',
      campaignId,
      amount: amt,
      adminUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, btPool: newPool };
  });
}

/**
 * 9. 구글 리뷰 댓글 삭제/반려 (관리자 또는 대기 상태인 본인)
 */
async function deleteCouponReviewComment(uid, { campaignId, commentId } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!commentId) throw new Error('댓글 ID가 필요합니다.');

  const commentRef = db.collection('coupon_review_comments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) throw new Error('존재하지 않는 댓글입니다.');
  const cmt = commentSnap.data() || {};

  if (cmt.status === 'approved') {
    throw new Error('이미 바우쳐가 이체 완료된 댓글은 삭제할 수 없습니다.');
  }

  const [adminSnap, userSnap] = await Promise.all([
    db.collection('admins').doc(uid).get(),
    db.collection('users').doc(uid).get()
  ]);
  const uData = userSnap.data() || {};
  const isSuperAdmin =
    adminSnap.exists ||
    uData.email === 'daguri75@gmail.com' ||
    uData.role === 'SUPER_ADMIN' ||
    uData.role === 'admin';
  const myMerchantId = uData.merchantId ? String(uData.merchantId) : null;
  const isAuthor = String(cmt.userId) === String(uid);
  const isIssuerOwner = myMerchantId && String(cmt.issuerId) === myMerchantId;

  if (!isSuperAdmin && !isIssuerOwner && !isAuthor) {
    throw new Error('댓글을 삭제할 권한이 없습니다.');
  }

  await commentRef.delete();
  return { success: true, commentId };
}

/**
 * 7. 예시 쿠폰 2종 & 바우쳐 2종 초기 시딩 데이터 정의
 */
const SEED_COUPON_CAMPAIGNS = [
  {
    campaignId: "seed-cpn-bestwinner-10pct",
    campaignType: "COUPON",
    issuerType: "MERCHANT",
    issuerId: "1791605366",
    issuerNameSnapshot: "BEST WINNER",
    issuerBadge: "BEST WINNER",
    title: "베스트위너 모든 상품 10% 할인권",
    description: "베스트위너 공식 가맹점의 모든 대상 상품 구매 시 결제 금액의 10%를 즉시 할인해 드립니다.",
    imageUrl: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=800&q=80",
    priceBM: 10000,
    discountType: "PERCENT",
    discountValue: "10%",
    applicableMerchantIds: ["1791605366", "bestwinner"],
    applicableProductIds: [],
    totalQuantity: 200,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 2,
    usageMode: "BOTH",
    terms: "베스트위너 온·오프라인 매장에서 사용 가능하며, 다른 할인 쿠폰과 중복 적용되지 않습니다.",
    status: "active"
  },
  {
    campaignId: "seed-cpn-baekje-10pct-free",
    campaignType: "COUPON",
    issuerType: "MERCHANT",
    issuerId: "baekje_galbi",
    issuerNameSnapshot: "백제갈비",
    issuerBadge: "BAJE GALBI",
    title: "백제갈비 모든 메뉴 10% 할인권",
    description: "하노이 최고의 정통 숯불갈비 명가 백제갈비 전 메뉴 10% 무료 특별 할인 이벤트 쿠폰입니다.",
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80",
    priceBM: 0, // 무료
    discountType: "PERCENT",
    discountValue: "10%",
    applicableMerchantIds: ["baekje_galbi", "1791002036"],
    applicableProductIds: [],
    totalQuantity: 500,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 1,
    usageMode: "BOTH",
    terms: "백제갈비 매장 방문 결제 또는 온라인 주문 시 적용 가능하며, 테이블당 1매 사용 가능합니다.",
    status: "active"
  },
  {
    campaignId: "seed-vch-baekje-lunch-meal",
    campaignType: "VOUCHER",
    issuerType: "MERCHANT",
    issuerId: "baekje_galbi",
    issuerNameSnapshot: "백제갈비",
    issuerBadge: "BAJE GALBI",
    title: "백제갈비 점심 무료 식사권 (스페셜 메뉴)",
    description: "백제갈비 지정 매장에서 정성껏 준비한 스페셜 점심 특선 메뉴 1회를 무료로 교환할 수 있는 권리 바우쳐입니다.",
    imageUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80",
    priceBM: 100000,
    discountType: "ITEM_EXCHANGE",
    discountValue: "스페셜 점심 식사 1회",
    applicableMerchantIds: ["baekje_galbi", "1791002036"],
    applicableProductIds: [],
    totalQuantity: 100,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 2,
    usageMode: "OFFLINE",
    terms: "백제갈비 오프라인 지정 매장 방문 시 직원에게 QR 코드를 제시하면 메뉴 1회 교환이 승인됩니다. (점심 시간대 11:30~14:30 한정)",
    status: "active"
  },
  {
    campaignId: "seed-vch-daehan-kimchi-5kg",
    campaignType: "VOUCHER",
    issuerType: "MERCHANT",
    issuerId: "1791002036",
    issuerNameSnapshot: "대한김치",
    issuerBadge: "DAEHAN KIMCHI",
    title: "대한김치 5kg 배추김치 구매권",
    description: "한국산 프리미엄 고춧가루와 비법 레시피로 매일 아침 담그는 정통 포기 배추김치 5kg 1통 실물 교환 바우쳐입니다.",
    imageUrl: "https://images.unsplash.com/photo-1583032015879-6b3a014902b3?auto=format&fit=crop&w=800&q=80",
    priceBM: 200000,
    discountType: "ITEM_EXCHANGE",
    discountValue: "배추김치 5kg 1통",
    applicableMerchantIds: ["1791002036", "daehan_kimchi"],
    applicableProductIds: [],
    totalQuantity: 150,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 3,
    usageMode: "BOTH",
    terms: "대한김치 매장 방문 또는 온라인 주문 결제 시 바우쳐 번호를 적용하면 배추김치 5kg 상품과 교환됩니다.",
    status: "active"
  }
];

module.exports = {
  purchaseOrIssueCoupon,
  redeemCouponOffline,
  createCouponCampaign,
  updateCouponCampaign,
  toggleCouponCampaignStatus,
  deleteCouponCampaign,
  submitCouponReviewComment,
  approveReviewAndTransferVoucher,
  chargeReviewBtPool,
  deleteCouponReviewComment,
  SEED_COUPON_CAMPAIGNS
};
