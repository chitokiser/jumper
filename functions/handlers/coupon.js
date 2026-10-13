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
  const isSuperAdmin = adminSnap.exists || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';
  const myMerchantId = uData.merchantId ? String(uData.merchantId) : null;

  if (!isSuperAdmin && !myMerchantId) {
    throw new Error('쿠폰·바우쳐를 발행할 권한이 없습니다. (수퍼 어드민 또는 등록된 가맹점만 가능)');
  }

  // 가맹점인 경우 본인 가맹점 ID로 강제 고정
  let issuerId = isSuperAdmin ? (data.issuerId || 'platform') : myMerchantId;
  let issuerType = isSuperAdmin && issuerId === 'platform' ? 'PLATFORM' : 'MERCHANT';

  const docRef = db.collection('coupon_campaigns').doc();
  const newCampaign = {
    campaignId: docRef.id,
    campaignType: data.campaignType === 'VOUCHER' ? 'VOUCHER' : 'COUPON',
    issuerType,
    issuerId,
    issuerNameSnapshot: data.issuerNameSnapshot || '공식 가맹점',
    issuerBadge: data.issuerBadge || (isSuperAdmin ? 'SUPER ADMIN' : 'VERIFIED MERCHANT'),
    title: data.title || '이벤트 혜택',
    description: data.description || '',
    imageUrl: data.imageUrl || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
    priceBM: Math.max(0, Number(data.priceBM || 0)),
    discountType: data.discountType || 'PERCENT',
    discountValue: data.discountValue || '10',
    applicableMerchantIds: Array.isArray(data.applicableMerchantIds) ? data.applicableMerchantIds : [issuerId],
    applicableProductIds: Array.isArray(data.applicableProductIds) ? data.applicableProductIds : [],
    totalQuantity: Math.max(1, Number(data.totalQuantity || 100)),
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: Math.max(1, Number(data.maxPerUser || 1)),
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
 * 4. 쿠폰·바우쳐 수정 (수퍼 어드민 전용)
 */
async function updateCouponCampaign(uid, { campaignId, updates } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');

  const adminSnap = await db.collection('admins').doc(uid).get();
  const userSnap = await db.collection('users').doc(uid).get();
  const uData = userSnap.data() || {};
  const isSuperAdmin = adminSnap.exists || uData.email === 'daguri75@gmail.com' || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';

  if (!isSuperAdmin) {
    throw new Error('수퍼 어드민만 쿠폰·바우쳐를 수정할 수 있습니다.');
  }

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const campSnap = await campRef.get();
  if (!campSnap.exists) throw new Error('존재하지 않는 캠페인입니다.');

  const allowedFields = [
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
  cleanUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await campRef.update(cleanUpdates);
  return { success: true, campaignId };
}

/**
 * 5. 쿠폰·바우쳐 비활성화/활성화 토글 (수퍼 어드민 전용)
 */
async function toggleCouponCampaignStatus(uid, { campaignId, status } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');

  const adminSnap = await db.collection('admins').doc(uid).get();
  const userSnap = await db.collection('users').doc(uid).get();
  const uData = userSnap.data() || {};
  const isSuperAdmin = adminSnap.exists || uData.email === 'daguri75@gmail.com' || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';

  if (!isSuperAdmin) {
    throw new Error('수퍼 어드민만 쿠폰·바우쳐 상태를 변경할 수 있습니다.');
  }

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  const newStatus = status === 'paused' ? 'paused' : 'active';
  await campRef.update({
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, campaignId, status: newStatus };
}

/**
 * 6. 쿠폰·바우쳐 삭제 (수퍼 어드민 전용)
 */
async function deleteCouponCampaign(uid, { campaignId } = {}) {
  const db = getDb();
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!campaignId) throw new Error('캠페인 ID가 필요합니다.');

  const adminSnap = await db.collection('admins').doc(uid).get();
  const userSnap = await db.collection('users').doc(uid).get();
  const uData = userSnap.data() || {};
  const isSuperAdmin = adminSnap.exists || uData.email === 'daguri75@gmail.com' || uData.role === 'SUPER_ADMIN' || uData.role === 'admin';

  if (!isSuperAdmin) {
    throw new Error('수퍼 어드민만 쿠폰·바우쳐를 삭제할 수 있습니다.');
  }

  const campRef = db.collection('coupon_campaigns').doc(campaignId);
  await campRef.delete();
  return { success: true, campaignId };
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
  SEED_COUPON_CAMPAIGNS
};
