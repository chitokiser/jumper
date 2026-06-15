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
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { defineSecret }       = require('firebase-functions/params');
const { logger }             = require('firebase-functions');

admin.initializeApp();
const db = admin.firestore();

// ── Firebase Secret Manager ──────────────────────────────────────────────────
const walletSecret        = defineSecret('WALLET_MASTER_SECRET');
const adminKeySecret      = defineSecret('ADMIN_PRIVATE_KEY');
const extApiSecret        = defineSecret('PARTNER_API_KEY');
const geminiSecret        = defineSecret('GEMINI_API_KEY');
const exchangeAddrSecret  = defineSecret('JUMP_AUTO_EXCHANGE_ADDRESS');
const telegramBotSecret   = defineSecret('TELEGRAM_BOT_TOKEN');
const announceGroupSecret = defineSecret('ANNOUNCE_GROUP_ID'); // GP 생중계 그룹 채팅 ID
const tonMnemonicSecret   = defineSecret('TON_WALLET_MNEMONIC');
const tonDepositSecret    = defineSecret('TON_DEPOSIT_ADDRESS');
const tonCenterKeySecret  = defineSecret('TON_CENTER_API_KEY');
const tonPrivKeySecret    = defineSecret('TON_PRIVATE_KEY');

// ── 핸들러 ───────────────────────────────────────────────────────────────────
const onboarding             = require('./handlers/onboarding');
const depositH               = require('./handlers/deposit');
const txH                    = require('./handlers/transaction');
const exchangeH              = require('./handlers/exchange');
const coopH                  = require('./handlers/coop');
const daoH                   = require('./handlers/dao');
const treasureH              = require('./handlers/treasure');
const communityH             = require('./handlers/community');
const supportChatH           = require('./handlers/supportChat');
const shopH                  = require('./handlers/shop');
const nfcH                   = require('./handlers/nfc');
const tutorialH              = require('./handlers/tutorial');
const slotH                  = require('./handlers/slot');
const userTreasureH          = require('./handlers/userTreasure');
const coinExchangeH          = require('./handlers/coinExchange');
const rankingsH              = require('./handlers/rankings');
const stockOptionH           = require('./handlers/stockOption');
const starterH               = require('./handlers/starter');
const dailyAreaH             = require('./handlers/dailyArea');
const npcH                   = require('./handlers/npcSystem');
const userPlaceH             = require('./handlers/userPlace');
const expSyncH               = require('./handlers/expSync');
const telegramH              = require('./handlers/telegram');
const tonPaymentH            = require('./handlers/tonPayment');
const gameRewardH            = require('./handlers/gameReward');
const starsH                 = require('./handlers/starsPayment');
const membershipH            = require('./handlers/membership');
const moneyTreeH             = require('./handlers/moneyTree');
const goldMineH              = require('./handlers/goldMine');
const harborH                = require('./handlers/harbor');
const { requireAdmin, ADMIN_EMAILS } = require('./wallet/admin');

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
      // 핸들러가 _err()로 던진 경우 httpCode를 그대로 사용
      const code = err.httpCode || 'internal';
      throw new HttpsError(code, err.message || '서버 오류');
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 수탁 지갑 생성
//    클라이언트: httpsCallable(functions, 'createWallet')()
// ════════════════════════════════════════════════════════════════════════════
exports.createWallet = onCall(
  { secrets: [walletSecret, adminKeySecret], timeoutSeconds: 300 },
  wrapError(async (request) => {
    const uid           = requireAuth(request);
    const mentorAddress = request.data?.mentorAddress ?? null;
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await onboarding.createCustodialWallet(uid, walletSecret.value(), mentorAddress);
    logger.info('createWallet', { uid, address: result.address, created: result.created, registered: result.registered });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 1-b. 관리자 셀프 온보딩 (ADMIN_PRIVATE_KEY 지갑 → 플랫폼 연결)
//      클라이언트: httpsCallable(functions, 'adminSelfOnboard')()
// ════════════════════════════════════════════════════════════════════════════
exports.adminSelfOnboard = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await onboarding.adminSelfOnboard(uid);
    logger.info('adminSelfOnboard', { uid, address: result.address, level: result.level });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// [SECURITY] 게임 GP 보상 — 서버사이드 검증 (클라이언트 금액 조작 방지)
//    클라이언트: httpsCallable(functions, 'claimGameReward')({ gameType:'memory', amount:300 })
// ════════════════════════════════════════════════════════════════════════════
exports.claimGameReward = onCall(wrapError(async (request) => {
  const uid      = requireAuth(request);
  const { gameType, amount } = request.data ?? {};
  return await gameRewardH.claimGameReward(uid, gameType, amount);
}));

// ════════════════════════════════════════════════════════════════════════════
// [SECURITY] 게임 참가비 차감 — 서버사이드 잔액·횟수 검증 원자 처리
//    클라이언트: httpsCallable(functions, 'payGameEntry')({ gameKey:'memoryEntry' })
// ════════════════════════════════════════════════════════════════════════════
exports.payGameEntry = onCall(wrapError(async (request) => {
  const uid      = requireAuth(request);
  const { gameKey } = request.data ?? {};
  return await gameRewardH.payGameEntry(uid, gameKey);
}));

// ════════════════════════════════════════════════════════════════════════════
// 정회원(Membership) — 일일 GP 충전
// ════════════════════════════════════════════════════════════════════════════

// 일일 GP 충전 — 정회원 + GP ≤ 1000 + 오늘 미수령
//   클라이언트: httpsCallable(functions, 'claimDailyGpTopup')()
exports.claimDailyGpTopup = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await membershipH.claimDailyGpTopup(uid);
}));

// 정회원 상태 조회 (클라이언트 + bot.py)
exports.getMembershipStatus = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await membershipH.getMembershipStatus(uid);
}));

// 관리자: Stars 가격 변경
exports.adminSetMembershipPrice = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  const { starsPrice } = request.data ?? {};
  return await membershipH.adminSetMembershipPrice(starsPrice);
}));

// 관리자: 통계 조회
exports.adminGetMembershipStats = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  return await membershipH.adminGetMembershipStats();
}));

// 관리자: 유저 GP 내역 조회
exports.adminGetUserGpHistory = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  const { targetUid } = request.data ?? {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid 누락');
  return await gameRewardH.adminGetUserGpHistory(targetUid);
}));

// 관리자: 유저 GP 직접 충전
exports.adminChargeGp = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  const { targetUid, amount, note } = request.data ?? {};
  return await gameRewardH.adminChargeGp(uid, { targetUid, amount, note });
}));

// 초대 보상 처리 (bot.py → 내부 호출, 공유 시크릿 헤더 검증)
exports.processReferralReward = onCall(wrapError(async (request) => {
  const { referrerUid, newUserUid } = request.data ?? {};
  return await membershipH.processReferralReward(referrerUid, newUserUid);
}));

// ════════════════════════════════════════════════════════════════════════════
// 돈나무(Money Tree) 시스템
// ════════════════════════════════════════════════════════════════════════════
exports.getMoneyTreeConfig = onCall(wrapError(async (request) => {
  requireAuth(request);
  return await moneyTreeH.getMoneyTreeConfig();
}));

exports.adminSetMoneyTreeConfig = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.adminSetMoneyTreeConfig(uid, request.data ?? {});
}));

exports.buySeedling = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.buySeedling(uid, request.data ?? {});
}));

exports.buyTreeBooster = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.buyTreeBooster(uid, request.data ?? {});
}));

exports.plantSeedling = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.plantSeedling(uid, request.data ?? {});
}));

exports.useTreeBooster = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.useTreeBooster(uid, request.data ?? {});
}));

exports.harvestTree = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.harvestTree(uid, request.data ?? {});
}));

exports.getNearbyTrees = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  const { lat, lng, radiusKm } = request.data ?? {};
  return await moneyTreeH.getNearbyTrees(uid, { lat, lng, radiusKm });
}));

exports.getMyTrees = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.getMyTrees(uid);
}));

exports.getMoneyTreeInventory = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.getMyInventory(uid);
}));

exports.grantSeedlingDrop = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  const { monsterType } = request.data ?? {};
  return await moneyTreeH.grantSeedlingDrop(uid, { monsterType });
}));

exports.adminGetMoneyTreeStats = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.adminGetMoneyTreeStats(uid);
}));

exports.buyMentorRegTicket = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  const { shopId } = request.data ?? {};
  return await moneyTreeH.buyMentorRegTicket(uid, { shopId });
}));

exports.convertSvToGp = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  const { amount } = request.data ?? {};
  return await moneyTreeH.convertSvToGp(uid, { amount });
}));

exports.getMyMentees = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await moneyTreeH.getMyMentees(uid);
}));

exports.plantBulkSeedlings = onCall(
  { timeoutSeconds: 300 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { shopId } = request.data ?? {};
    return await moneyTreeH.plantBulkSeedlings(uid, { shopId });
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 2. 온체인 회원 가입
//    클라이언트: httpsCallable(functions, 'registerMember')({ mentorAddress: '0x...' })
//    mentorAddress 필수 — 없으면 에러
// ════════════════════════════════════════════════════════════════════════════
exports.registerMember = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid           = requireAuth(request);
    const mentorAddress = request.data?.mentorAddress ?? null;
    const result = await onboarding.registerOnChain(uid, mentorAddress, walletSecret.value());
    logger.info('registerMember', { uid, mentorAddress, txHash: result.txHash });
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
  { secrets: [adminKeySecret, walletSecret] },
  wrapError(async (request) => {
    const adminUid = requireAuth(request);
    const { refCode, overrideKrwRate } = request.data ?? {};
    if (!refCode) throw new HttpsError('invalid-argument', 'refCode가 필요합니다');

    // Secret을 process.env에 주입 (chain.js의 getAdminWallet()이 읽음)
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();

    const result = await depositH.approveDeposit(adminUid, refCode, overrideKrwRate ?? null, walletSecret.value());
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
// 9. 레벨업 요청 (수탁 지갑 서명)
//    클라이언트: httpsCallable(functions, 'requestLevelUp')()
// ════════════════════════════════════════════════════════════════════════════
exports.requestLevelUp = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const result = await txH.requestLevelUp(uid, walletSecret.value());
    logger.info('requestLevelUp', { uid, newLevel: result.newLevel, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 11. 상품 구매 (수탁 지갑 서명)
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
// 13. 관리자: 컨트랙트 + 관리자 지갑 현황 조회
//     클라이언트: httpsCallable(functions, 'adminGetContractStatus')()
// ════════════════════════════════════════════════════════════════════════════
exports.adminGetContractStatus = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return await txH.adminGetContractStatus();
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 14. 관리자: P2P HEX 전송 기록 (txHash로 수동 등록)
//     클라이언트: httpsCallable(functions, 'adminRecordP2pTransfer')({ txHash: '0x...' })
// ════════════════════════════════════════════════════════════════════════════
exports.adminRecordP2pTransfer = onCall(
  wrapError(async (request) => {
    const adminUid = requireAuth(request);
    const { txHash } = request.data ?? {};
    if (!txHash) throw new HttpsError('invalid-argument', 'txHash가 필요합니다');
    const result = await txH.adminRecordP2pTransfer(adminUid, txHash);
    logger.info('adminRecordP2pTransfer', { adminUid, txHash, uid: result.uid });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 15. 유저: P2P 수령 HEX → pointWei 합산 (수탁 지갑 전용)
//     수탁 지갑 HEX → 관리자 지갑 → creditPoints → pointWei 증가
//     클라이언트: httpsCallable(functions, 'mergeWalletHexToPoints')()
// ════════════════════════════════════════════════════════════════════════════
exports.mergeWalletHexToPoints = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.mergeWalletHexToPoints(uid, walletSecret.value());
    logger.info('mergeWalletHexToPoints', { uid, txHash: result.txHash, amountHex: result.amountHex });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 16-A. 유저: 멘토 포인트 → HEX 전환 (최소 100,000 VND 상당 ≈ 4 HEX)
//       클라이언트: httpsCallable(functions, 'redeemPoints')()
// ════════════════════════════════════════════════════════════════════════════
exports.redeemPoints = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.redeemPoints(uid, walletSecret.value());
    logger.info('redeemPoints', { uid, txHash: result.txHash, amountHex: result.amountHex });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 16. 판매회원 온체인 등록
//     - 수탁 지갑으로 jumpPlatform.registerMerchant(metadataURI) 호출 (onlyMember)
//     - 초기 feeBps=0 → 관리자가 adminUpdateMerchantFee(id, 1000) 으로 10% 설정
//     클라이언트: httpsCallable(functions, 'registerMerchant')({ name, description, phone, kakaoId, region, career })
// ════════════════════════════════════════════════════════════════════════════
exports.registerMerchant = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { name, description, phone, kakaoId, region, career, gmap } = request.data ?? {};
    if (!name) throw new HttpsError('invalid-argument', '가게명(name)이 필요합니다');

    // 온체인 metadataURI: compact JSON (가스 절약)
    const metadataURI = JSON.stringify({
      n: name,
      r: region  || '',
      c: career  || '',
      d: (description || '').slice(0, 120),
    });

    const merchantData = { name, description: description || '', phone: phone || '', kakaoId: kakaoId || '', region: region || '', career: career || '', ...(gmap ? { gmap } : {}) };
    const result = await txH.registerMerchantOnChain(uid, metadataURI, merchantData, walletSecret.value());
    logger.info('registerMerchant', { uid, merchantId: result.merchantId, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 17. 관리자: 가맹점 수수료 설정 (승인)
//     - 관리자 지갑으로 jumpPlatform.adminUpdateMerchantFee(id, feeBps) 호출
//     클라이언트: httpsCallable(functions, 'adminSetMerchantFee')({ merchantId, feeBps })
// ════════════════════════════════════════════════════════════════════════════
exports.adminSetMerchantFee = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    requireAuth(request);
    const { merchantId, feeBps } = request.data ?? {};
    if (merchantId == null) throw new HttpsError('invalid-argument', 'merchantId가 필요합니다');
    const bps = feeBps != null ? Number(feeBps) : 1000;
    if (!Number.isFinite(bps) || bps < 0 || bps > 3000)
      throw new HttpsError('invalid-argument', 'feeBps는 0~3000(최대 30%) 사이여야 합니다');

    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.adminSetMerchantFeeOnChain(Number(merchantId), bps);
    logger.info('adminSetMerchantFee', result);
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 17-b. 관리자: 온체인 멘토 일괄 변경
//       클라이언트: httpsCallable(functions, 'adminBulkChangeMentor')({ mentorAddress, targetUids? })
// ════════════════════════════════════════════════════════════════════════════
exports.adminBulkChangeMentor = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    const { mentorAddress, targetUids } = request.data ?? {};
    if (!mentorAddress) throw new HttpsError('invalid-argument', 'mentorAddress가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.adminBulkChangeMentor(mentorAddress, targetUids || null);
    logger.info('adminBulkChangeMentor', { mentorAddress, ...result });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 17-c. 관리자: 멘토 일괄변경 대상 주소 조회 (Rabby 서명용 — 온체인 tx 없음)
//       클라이언트: httpsCallable(functions, 'adminGetMentorTargets')({ targetUids? })
// ════════════════════════════════════════════════════════════════════════════
exports.adminGetMentorTargets = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    const { targetUids } = request.data ?? {};
    const db = admin.firestore();
    let snapshotDocs;
    if (targetUids && targetUids.length > 0) {
      const docs = await Promise.all(targetUids.map(u => db.collection('users').doc(u).get()));
      snapshotDocs = docs;
    } else {
      const snap = await db.collection('users').where('onChain.registered', '==', true).get();
      snapshotDocs = snap.docs;
    }
    const targets = snapshotDocs
      .filter(d => d.exists && d.data()?.wallet?.address && d.data()?.onChain?.registered)
      .map(d => ({ uid: d.id, address: d.data().wallet.address }));
    return { targets };
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 17-c1. 관리자: uid/이메일 → 지갑 주소 조회 (Rabby 서명용 — 온체인 tx 없음)
//        클라이언트: httpsCallable(functions, 'adminLookupUserAddress')({ emailOrUid })
// ════════════════════════════════════════════════════════════════════════════
exports.adminLookupUserAddress = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    const { emailOrUid } = request.data ?? {};
    if (!emailOrUid) throw new HttpsError('invalid-argument', 'emailOrUid가 필요합니다');
    const db = admin.firestore();
    let userUid, address;
    if (emailOrUid.includes('@')) {
      const snap = await db.collection('users').where('email', '==', emailOrUid.toLowerCase().trim()).limit(1).get();
      if (snap.empty) throw new HttpsError('not-found', `유저를 찾을 수 없습니다: ${emailOrUid}`);
      userUid = snap.docs[0].id;
      address = snap.docs[0].data()?.wallet?.address;
    } else {
      const snap = await db.collection('users').doc(emailOrUid).get();
      if (!snap.exists) throw new HttpsError('not-found', `유저를 찾을 수 없습니다: ${emailOrUid}`);
      userUid = snap.id;
      address = snap.data()?.wallet?.address;
    }
    if (!address) throw new HttpsError('failed-precondition', '해당 유저에게 지갑이 없습니다');
    return { uid: userUid, address };
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 17-c2. 관리자: 유저 온체인 레벨 설정 (레거시 — 수탁지갑용, Rabby 방식 권장)
//       클라이언트: httpsCallable(functions, 'adminSetUserLevel')({ emailOrUid, level })
// ════════════════════════════════════════════════════════════════════════════
exports.adminSetUserLevel = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    const { emailOrUid, level } = request.data ?? {};
    if (!emailOrUid) throw new HttpsError('invalid-argument', 'emailOrUid가 필요합니다');
    if (!Number.isInteger(Number(level)) || Number(level) < 1 || Number(level) > 10)
      throw new HttpsError('invalid-argument', '레벨은 1~10 사이 정수여야 합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.adminSetUserLevel(emailOrUid, Number(level));
    logger.info('adminSetUserLevel', { adminUid: uid, ...result });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 17-c2. 관리자: 유저 정보 조회 (블랙리스트 상태 포함)
//        클라이언트: httpsCallable(functions, 'adminGetUserInfo')({ emailOrUid })
// ════════════════════════════════════════════════════════════════════════════
exports.adminGetUserInfo = onCall(
  wrapError(async (request) => {
    const callerId = requireAuth(request);
    await requireAdmin(callerId);
    const { emailOrUid } = request.data ?? {};
    if (!emailOrUid) throw new HttpsError('invalid-argument', 'emailOrUid가 필요합니다');

    const isEmail = emailOrUid.includes('@');
    let authUser;
    try {
      authUser = isEmail
        ? await admin.auth().getUserByEmail(emailOrUid)
        : await admin.auth().getUser(emailOrUid);
    } catch {
      throw new HttpsError('not-found', `유저를 찾을 수 없습니다: ${emailOrUid}`);
    }
    const uid = authUser.uid;
    const fsSnap = await db.collection('users').doc(uid).get();
    const fsData = fsSnap.exists ? fsSnap.data() : {};
    return {
      uid,
      email:         authUser.email || null,
      name:          fsData.name    || null,
      walletAddress: fsData.wallet?.address || null,
      blacklisted:   !!fsData.blacklisted,
      authDisabled:  !!authUser.disabled,
    };
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 17-d. 관리자: 유저 블랙리스트 등록/해제
//       - 온체인 adminSetBlocked(address, bool) 호출
//       - Firebase Auth disabled 설정 (로그인 차단)
//       - Firestore users.blacklisted 필드 기록
//       클라이언트: httpsCallable(functions, 'adminSetBlacklist')({ emailOrUid, blocked })
// ════════════════════════════════════════════════════════════════════════════
exports.adminSetBlacklist = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const callerId = requireAuth(request);
    await requireAdmin(callerId);
    const { emailOrUid, blocked } = request.data ?? {};
    if (!emailOrUid) throw new HttpsError('invalid-argument', 'emailOrUid가 필요합니다');
    if (typeof blocked !== 'boolean') throw new HttpsError('invalid-argument', 'blocked는 boolean이어야 합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await onboarding.adminSetBlacklist(emailOrUid, blocked);
    logger.info('adminSetBlacklist', { adminUid: callerId, ...result });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 18. 온체인 멘티 목록 조회 (블록체인 이벤트 기반 — 별도 명칭)
//     클라이언트: httpsCallable(functions, 'getMyOnChainMentees')()
// ════════════════════════════════════════════════════════════════════════════
exports.getMyOnChainMentees = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return await onboarding.getMyMentees(uid);
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 19-0. 나의 멘티 수익 집계 (Admin SDK로 transactions 조회)
//     클라이언트: httpsCallable(functions, 'getMenteeIncome')()
// ════════════════════════════════════════════════════════════════════════════
exports.getMenteeIncome = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return await onboarding.getMenteeIncome(uid);
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 19. 관리자: jumpPlatform 컨트랙트에 HEX 충전
//     - 관리자 지갑 HEX → ownerDepositHex() → 컨트랙트 HEX 풀 증가
//     - 사전 조건: adminApproveHex (무한 approve) 완료 상태
//     클라이언트: httpsCallable(functions, 'adminOwnerDepositHex')({ amountWei: '1000000000000000000' })
// ════════════════════════════════════════════════════════════════════════════
exports.adminOwnerDepositHex = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    requireAuth(request);
    const { amountWei } = request.data ?? {};
    if (!amountWei) throw new HttpsError('invalid-argument', 'amountWei가 필요합니다');

    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.adminOwnerDepositHex(String(amountWei));
    logger.info('adminOwnerDepositHex', result);
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 20. 가맹점 오프라인 결제
//     - 수탁 지갑 HEX → approve → jumpPlatform.payMerchantHex(merchantId, amountWei)
//     클라이언트: httpsCallable(functions, 'payMerchantHex')({ merchantId: 1, amountKrw: 50000 })
// ════════════════════════════════════════════════════════════════════════════
exports.payMerchantHex = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { merchantId, amountKrw, amountVnd, currency = 'KRW' } = request.data ?? {};
    if (merchantId == null) throw new HttpsError('invalid-argument', 'merchantId가 필요합니다');

    const cur = String(currency).toUpperCase();
    if (cur === 'VND') {
      if (!amountVnd || Number(amountVnd) < 10000)
        throw new HttpsError('invalid-argument', 'VND 최소 결제 금액은 10,000동입니다');
    } else {
      if (!amountKrw || Number(amountKrw) < 1000)
        throw new HttpsError('invalid-argument', '최소 결제 금액은 1,000원입니다');
    }

    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.payMerchantHexOnChain(
      uid, Number(merchantId), amountKrw ? Number(amountKrw) : 0, walletSecret.value(),
      { currency: cur, amountVnd: amountVnd ? Number(amountVnd) : undefined }
    );
    logger.info('payMerchantHex', { uid, merchantId, amountKrw, amountVnd, currency: cur, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 21. 상품 HEX 즉시결제 (유저 수탁 지갑)
//     - 상품 가격(KRW/VND/USD) → 현재 환율로 HEX wei 환산
//     - approve → payMerchantHex (가맹점) 또는 직접 transfer (비가맹점)
//     - 주문 자동 confirmed 처리
//     클라이언트: httpsCallable(functions, 'payProductWithHex')({ itemId, date, people, phone, ... })
// ════════════════════════════════════════════════════════════════════════════
exports.payProductWithHex = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { itemId, date, startDate, endDate, people, phone, memo, bookingMode } = request.data ?? {};
    if (!itemId) throw new HttpsError('invalid-argument', 'itemId가 필요합니다');

    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.payProductWithHex(
      uid,
      { itemId, date, startDate, endDate, people, phone, memo, bookingMode },
      walletSecret.value()
    );
    logger.info('payProductWithHex', { uid, itemId, orderId: result.orderId, txHash: result.txHash });
    return result;
  })
);

// ════════════════════════════════════════════════════════════════════════════
// JUMP 거래소
// ════════════════════════════════════════════════════════════════════════════

// jumpBank 현황 조회 (가격, 잔액, 스테이킹, 배당)
exports.getJumpBankStatus = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return await exchangeH.getJumpBankStatus(uid);
  })
);

// JUMP 구매 (HEX → JUMP)
exports.buyJumpToken = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid        = requireAuth(request);
    const jumpAmount = request.data?.jumpAmount;
    if (!jumpAmount) throw new HttpsError('invalid-argument', 'jumpAmount가 필요합니다');
    const result = await exchangeH.buyJumpToken(uid, jumpAmount, walletSecret.value());
    logger.info('buyJumpToken', { uid, jumpAmount, txHash: result.txHash });
    return result;
  })
);

// JUMP 판매 (JUMP → HEX)
exports.sellJumpToken = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid        = requireAuth(request);
    const jumpAmount = request.data?.jumpAmount;
    if (!jumpAmount) throw new HttpsError('invalid-argument', 'jumpAmount가 필요합니다');
    const result = await exchangeH.sellJumpToken(uid, jumpAmount, walletSecret.value());
    logger.info('sellJumpToken', { uid, jumpAmount, txHash: result.txHash });
    return result;
  })
);

// JUMP 스테이킹
exports.stakeJumpToken = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid        = requireAuth(request);
    const jumpAmount = request.data?.jumpAmount;
    if (!jumpAmount) throw new HttpsError('invalid-argument', 'jumpAmount가 필요합니다');
    const result = await exchangeH.stakeJumpToken(uid, jumpAmount, walletSecret.value());
    logger.info('stakeJumpToken', { uid, jumpAmount, txHash: result.txHash });
    return result;
  })
);

// JUMP 언스테이킹 (120일 락)
exports.unstakeJumpToken = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const result = await exchangeH.unstakeJumpToken(uid, walletSecret.value());
    logger.info('unstakeJumpToken', { uid, txHash: result.txHash });
    return result;
  })
);

// 배당 청구 (HEX 수령)
exports.claimJumpDividend = onCall(
  { secrets: [walletSecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const result = await exchangeH.claimJumpDividend(uid, walletSecret.value());
    logger.info('claimJumpDividend', { uid, hexAmount: result.hexAmount, txHash: result.txHash });
    return result;
  })
);

// ── 토큰거래소 — 스왑 환율 / 거래내역 / TON·HEX 교환 ──────────────────────────

// 스왑 환율 조회 (전체 사용자)
exports.getSwapRates = onCall(
  wrapError(async (request) => {
    requireAuth(request);
    return await exchangeH.getSwapRates();
  })
);

// 거래내역 조회 (페이지네이션)
exports.getExchangeHistory = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return await exchangeH.getExchangeHistory(uid, request.data || {});
  })
);

// TON ↔ 게임코인 교환 신청
exports.requestTonCoinSwap = onCall(
  { secrets: [tonDepositSecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.TON_DEPOSIT_ADDRESS = tonDepositSecret.value();
    const { direction, amount, tonAddress } = request.data || {};
    const result = await exchangeH.requestTonCoinSwap(uid, { direction, amount, tonAddress });
    logger.info('requestTonCoinSwap', { uid, direction, amount, swapId: result.swapId });
    return result;
  })
);

// HEX ↔ TON 교환 신청
exports.requestHexTonSwap = onCall(
  { secrets: [walletSecret, adminKeySecret, tonPrivKeySecret, tonCenterKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY  = adminKeySecret.value();
    process.env.TON_PRIVATE_KEY    = tonPrivKeySecret.value();
    process.env.TON_CENTER_API_KEY = tonCenterKeySecret.value();
    const { direction, amount, tonAddress, senderAddress, tonNano, sentAt } = request.data || {};
    const result = await exchangeH.requestHexTonSwap(uid, {
      direction, amount, tonAddress,
      senderAddress, tonNano, sentAt,
      masterSecret: walletSecret.value(),
    });
    logger.info('requestHexTonSwap', { uid, direction, amount, swapId: result.swapId, status: result.status });
    return result;
  })
);

// 관리자 — 스왑 환율 설정
exports.adminSetSwapRate = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    return await exchangeH.adminSetSwapRate(uid, request.data || {});
  })
);

// ── TON 자동 처리 ─────────────────────────────────────────────────────────────

// 플랫폼 TON 잔액 조회 (클라이언트 표시용)
exports.getPlatformTonInfo = onCall(
  { secrets: [tonMnemonicSecret, tonDepositSecret, tonCenterKeySecret] },
  wrapError(async (request) => {
    requireAuth(request);
    process.env.TON_WALLET_MNEMONIC   = tonMnemonicSecret.value();
    process.env.TON_DEPOSIT_ADDRESS   = tonDepositSecret.value();
    process.env.TON_CENTER_API_KEY    = tonCenterKeySecret.value();
    return await tonPaymentH.getPlatformTonInfo();
  })
);

// 2분마다 TON 입금 감지 + 자동 게임코인 지급 + coin→TON 자동 송금
exports.processTonSwaps = onSchedule(
  {
    schedule: 'every 2 minutes',
    secrets:  [tonMnemonicSecret, tonDepositSecret, tonCenterKeySecret],
  },
  async () => {
    process.env.TON_WALLET_MNEMONIC = tonMnemonicSecret.value();
    process.env.TON_DEPOSIT_ADDRESS = tonDepositSecret.value();
    process.env.TON_CENTER_API_KEY  = tonCenterKeySecret.value();
    logger.info('[processTonSwaps] 스케줄 실행');
    await tonPaymentH.processTonSwaps();
    logger.info('[processTonSwaps] 완료');
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 레벨4+ HEX → 개인 지갑 이체
//    클라이언트: httpsCallable(functions, 'transferHexToPersonal')({ toAddress, amountWei })
//    amountWei: wei 단위 문자열 또는 "all" (전액)
// ════════════════════════════════════════════════════════════════════════════
exports.transferHexToPersonal = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { toAddress, amountWei } = request.data ?? {};
    if (!toAddress) throw new HttpsError('invalid-argument', 'toAddress가 필요합니다');
    if (!amountWei) throw new HttpsError('invalid-argument', 'amountWei가 필요합니다');

    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await txH.transferHexToPersonal(
      uid, toAddress, String(amountWei), walletSecret.value()
    );
    logger.info('transferHexToPersonal', { uid, toAddress, amountHex: result.amountHex, txHash: result.txHash });
    return result;
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

// ════════════════════════════════════════════════════════════════════════════
// 조합전용몰
// ════════════════════════════════════════════════════════════════════════════

exports.listCoopProducts = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.listCoopProducts(uid);
  })
);

exports.buyCoopProduct = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { productId } = request.data ?? {};
    if (!productId) throw new HttpsError('invalid-argument', 'productId가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.buyCoopProduct(uid, { productId }, walletSecret.value());
    logger.info('buyCoopProduct', { uid, productId, txHash: result.txHash });
    return result;
  })
);

exports.adminSetCoopConfig = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.adminSetCoopConfig(uid, request.data ?? {});
  })
);

exports.adminSaveCoopProduct = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.adminSaveCoopProduct(uid, request.data ?? {});
  })
);

exports.adminDeleteCoopProduct = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.adminDeleteCoopProduct(uid, request.data ?? {});
  })
);

exports.getRandomAutoReferrer = onCall(
  {},
  wrapError(async (_request) => {
    return coopH.getRandomAutoReferrer();
  })
);

exports.coopGetMembership = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.coopGetMembership(uid);
  })
);

exports.coopJoinMall = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.coopJoinMall(uid, walletSecret.value());
    logger.info('coopJoinMall', { uid, txHash: result.txHash });
    return result;
  })
);

exports.coopBuyOnChain = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { productId } = request.data ?? {};
    if (!productId) throw new HttpsError('invalid-argument', 'productId가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.coopBuyOnChain(uid, { productId }, walletSecret.value());
    logger.info('coopBuyOnChain', { uid, productId, txHash: result.txHash });
    return result;
  })
);

exports.coopBuyTreasurePackage = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { productId, treasureName, lat, lng, npcImageUrl } = request.data ?? {};
    if (!productId)    throw new HttpsError('invalid-argument', 'productId가 필요합니다');
    if (!treasureName) throw new HttpsError('invalid-argument', '보물 이름이 필요합니다');
    if (lat == null || lng == null) throw new HttpsError('invalid-argument', '위치 정보가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.coopBuyTreasurePackage(uid, { productId, treasureName, lat, lng, npcImageUrl }, walletSecret.value());
    logger.info('coopBuyTreasurePackage', { uid, productId, packageId: result.packageId });
    return result;
  })
);

exports.coopConvertPoints = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { ptsWei } = request.data ?? {};
    if (!ptsWei) throw new HttpsError('invalid-argument', 'ptsWei가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.coopConvertPoints(uid, { ptsWei }, walletSecret.value());
    logger.info('coopConvertPoints', { uid, ptsWei, txHash: result.txHash });
    return result;
  })
);

exports.coopAdminGrantEligibility = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.coopAdminGrantEligibility(uid, request.data ?? {});
  })
);

exports.coopAdminGetStats = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.coopAdminGetStats(uid);
  })
);

exports.coopAdminWithdrawHex = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { amountWei } = request.data ?? {};
    if (!amountWei) throw new HttpsError('invalid-argument', 'amountWei가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.coopAdminWithdrawHex(uid, { amountWei });
  })
);

exports.coopAdminWithdrawJump = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { amount } = request.data ?? {};
    if (!amount) throw new HttpsError('invalid-argument', 'amount가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.coopAdminWithdrawJump(uid, { amount });
  })
);

exports.coopAdminSetFee = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.coopAdminSetFee(uid, request.data ?? {});
  })
);

exports.coopAdminUpdateOrder = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.coopAdminUpdateOrder(uid, request.data ?? {});
  })
);

// ── CoopMall 바우처 ──────────────────────────────────────────────────────────

exports.coopAdminCreateVoucher = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.coopAdminCreateVoucher(uid, request.data ?? {});
  })
);

exports.coopAdminUpdateVoucher = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.coopAdminUpdateVoucher(uid, request.data ?? {});
  })
);

exports.coopAdminListVouchers = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.coopAdminListVouchers(uid);
  })
);

exports.coopBuyVoucher = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { templateId } = request.data ?? {};
    if (templateId === undefined) throw new HttpsError('invalid-argument', 'templateId가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.coopBuyVoucher(uid, { templateId }, walletSecret.value());
    logger.info('coopBuyVoucher', { uid, templateId, voucherId: result.voucherId });
    return result;
  })
);

exports.coopTransferVoucher = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { docId, voucherId, toAddress } = request.data ?? {};
    if (!toAddress) throw new HttpsError('invalid-argument', 'toAddress가 필요합니다');
    if (docId == null && voucherId == null) throw new HttpsError('invalid-argument', 'docId 또는 voucherId가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.coopTransferVoucher(uid, { docId, voucherId, toAddress }, walletSecret.value());
    logger.info('coopTransferVoucher', { uid, docId, voucherId, toAddress });
    return result;
  })
);

exports.coopBurnVoucher = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { docId, voucherId, sourceCollection } = request.data ?? {};
    if (docId == null && voucherId == null) throw new HttpsError('invalid-argument', 'docId 또는 voucherId가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coopH.coopBurnVoucher(uid, { docId, voucherId, sourceCollection }, walletSecret.value());
    logger.info('coopBurnVoucher', { uid, docId, voucherId, sourceCollection, txHash: result.txHash });
    return result;
  })
);

exports.coopGetMyVouchers = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return coopH.coopGetMyVouchers(uid);
  })
);

exports.submitVoucherOrder = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { docId, sourceCollection, voucherId, requestedName, latLng, imageUrl } = request.data ?? {};
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coopH.submitVoucherOrder(uid, { docId, sourceCollection, voucherId, requestedName, latLng, imageUrl }, walletSecret.value());
  })
);

// ════════════════════════════════════════════════════════════════════════════
// FX 환율 조회 (온체인) — 로그인 유저 누구나 호출 가능
//    클라이언트: httpsCallable(functions, 'getExchangeRates')()
//    반환: { krwPerHex, vndPerHex }
// ════════════════════════════════════════════════════════════════════════════
exports.getExchangeRates = onCall(
  {},
  wrapError(async (_request) => {
    const { fetchExchangeRates } = require('./wallet/exchange');
    const rates = await fetchExchangeRates();
    // 1 HEX = 1 USD peg
    const krwPerHex = rates.krwPerUsd;
    const vndPerHex = rates.vndPerUsd;
    logger.info('[getExchangeRates]', { krwPerHex, vndPerHex, source: rates.source });
    return { krwPerHex, vndPerHex };
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 외부 Web3 개발자용 파트너 API
//
// 인증: Header  X-Api-Key: {EXT_API_KEY}
//       또는 Query ?api_key={EXT_API_KEY}
//
// [엔드포인트]
//
// 1. 지갑 주소 조회 (이메일로)
//    GET /externalApi/wallet?email=user@example.com
//    Response: { ok, data: { walletAddress, level, mentor, createdAt } }
//
// 2. 지갑 주소 조회 (지갑 주소로 → Jump 회원 여부 확인)
//    GET /externalApi/wallet?address=0x...
//    Response: { ok, data: { walletAddress, level, mentor, createdAt } }
//
// 3. 배치 조회 (이메일 목록 → 지갑 주소 매핑)
//    POST /externalApi/wallets
//    Body: { emails: ['a@b.com', 'c@d.com'] }  (최대 50개)
//    Response: { ok, data: [ { email, walletAddress, level } ... ] }
//
// [API 키 발급]
//   firebase functions:secrets:set EXT_API_KEY
// ════════════════════════════════════════════════════════════════════════════
exports.externalApi = onRequest(
  { cors: false, secrets: [extApiSecret, walletSecret] },
  async (req, res) => {
    // ── CORS 헤더 직접 설정 (커스텀 헤더 X-Api-Key 허용) ──
    const origin = req.headers.origin || '*';
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, X-User-Token, Authorization');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const path = req.path.replace(/^\//, '');

    // ── API 키 검증 (verifyUser / signMessage는 사용자 토큰 기반이라 제외) ──
    const publicPaths = ['verifyUser', 'signMessage']; // signTransaction은 내부에서 별도 API 키 검증
    if (!publicPaths.includes(path)) {
      const providedKey =
        req.headers['x-api-key'] ||
        req.body?.apiKey ||
        req.query.api_key ||
        '';

      logger.info('[externalApi] auth debug', {
        path,
        hasHeaderKey: !!req.headers['x-api-key'],
        hasBodyKey: !!req.body?.apiKey,
        bodyKeys: Object.keys(req.body || {}),
        providedKeyLen: providedKey.length,
        secretKeyLen: extApiSecret.value().length,
        match: providedKey === extApiSecret.value(),
      });

      if (!providedKey || providedKey !== extApiSecret.value()) {
        res.status(401).json({ ok: false, error: 'Invalid API key' });
        return;
      }
    }

    try {
      // ── 1 & 2: 단건 조회 GET /wallet ──────────────────────────────
      if (req.method === 'GET' && path === 'wallet') {
        const { email, address } = req.query;

        if (!email && !address) {
          res.status(400).json({ ok: false, error: 'email 또는 address 파라미터가 필요합니다' });
          return;
        }

        let uid = null;

        if (email) {
          // 이메일로 Firebase Auth UID 조회
          try {
            const userRecord = await admin.auth().getUserByEmail(String(email).trim().toLowerCase());
            uid = userRecord.uid;
          } catch (_) {
            res.status(404).json({ ok: false, error: '해당 이메일로 가입된 회원을 찾을 수 없습니다' });
            return;
          }
        } else {
          // 지갑 주소로 Firestore 조회
          const addr = String(address).trim().toLowerCase();
          const snap = await db.collection('users')
            .where('wallet.address', '==', addr)
            .limit(1)
            .get();
          if (snap.empty) {
            res.status(404).json({ ok: false, error: '해당 주소로 가입된 회원을 찾을 수 없습니다' });
            return;
          }
          uid = snap.docs[0].id;
        }

        const userSnap = await db.collection('users').doc(uid).get();
        if (!userSnap.exists) {
          res.status(404).json({ ok: false, error: '회원 정보를 찾을 수 없습니다' });
          return;
        }

        const data = userSnap.data();
        const walletAddress = data?.wallet?.address || null;

        if (!walletAddress) {
          res.status(404).json({ ok: false, error: '수탁 지갑이 아직 생성되지 않았습니다' });
          return;
        }

        res.json({
          ok: true,
          data: {
            walletAddress,
            level:     data?.onChain?.level     ?? null,
            mentor:    data?.onChain?.mentor     ?? null,
            createdAt: data?.createdAt?.toDate?.()?.toISOString?.() ?? null,
          },
        });
        return;
      }

      // ── 3: 배치 조회 POST /wallets ─────────────────────────────────
      if (req.method === 'POST' && path === 'wallets') {
        const emails = req.body?.emails;
        if (!Array.isArray(emails) || emails.length === 0) {
          res.status(400).json({ ok: false, error: 'emails 배열이 필요합니다' });
          return;
        }
        if (emails.length > 50) {
          res.status(400).json({ ok: false, error: '한 번에 최대 50개까지 조회할 수 있습니다' });
          return;
        }

        const results = await Promise.all(
          emails.map(async (em) => {
            const emailStr = String(em).trim().toLowerCase();
            try {
              const userRecord = await admin.auth().getUserByEmail(emailStr);
              const userSnap = await db.collection('users').doc(userRecord.uid).get();
              const data = userSnap.exists ? userSnap.data() : null;
              const walletAddress = data?.wallet?.address || null;
              return {
                email: emailStr,
                walletAddress,
                level:  data?.onChain?.level  ?? null,
                mentor: data?.onChain?.mentor ?? null,
                found:  !!walletAddress,
              };
            } catch (_) {
              return { email: emailStr, walletAddress: null, level: null, mentor: null, found: false };
            }
          })
        );

        res.json({ ok: true, data: results });
        return;
      }

      // ── 4: 유저 토큰으로 지갑 주소 확인 POST /verifyUser ──────────
      // 파트너 API 키 불필요. 유저가 직접 자신의 Firebase ID Token을 보냄.
      // 파트너 사이트: 유저 Google 로그인 → ID Token → 이 엔드포인트 호출
      if (req.method === 'POST' && path === 'verifyUser') {
        const userToken = (req.headers['x-user-token'] || req.body?.userToken || req.body?.idToken || '');
        if (!userToken) {
          res.status(400).json({ ok: false, error: 'idToken(또는 userToken) 필드가 필요합니다' });
          return;
        }
        let decoded;
        try {
          decoded = await admin.auth().verifyIdToken(userToken);
        } catch (_) {
          res.status(401).json({ ok: false, error: '유효하지 않은 사용자 토큰입니다' });
          return;
        }
        const userSnap = await db.collection('users').doc(decoded.uid).get();
        if (!userSnap.exists) {
          res.status(404).json({ ok: false, error: 'Jump 미가입 회원입니다' });
          return;
        }
        const data = userSnap.data();
        const walletAddress = data?.wallet?.address || null;
        if (!walletAddress) {
          res.status(404).json({ ok: false, error: '수탁 지갑이 아직 생성되지 않았습니다' });
          return;
        }
        res.json({
          ok: true,
          data: {
            walletAddress,
            level:     data?.onChain?.level  ?? null,
            mentor:    data?.onChain?.mentor ?? null,
            createdAt: data?.createdAt?.toDate?.()?.toISOString?.() ?? null,
          },
        });
        return;
      }

      // ── 5: 메시지 서명 위임 POST /signMessage ──────────────────────
      // 파트너 API 키 + 유저 토큰 모두 필요.
      // 파트너가 특정 메시지를 수탁 지갑으로 서명 요청 (EIP-191 개인 서명).
      // 보안: 서명 가능 메시지는 100자 이내 평문만 허용 (임의 트랜잭션 불가).
      if (req.method === 'POST' && path === 'signMessage') {
        const userToken = (req.headers['x-user-token'] || req.body?.userToken || req.body?.idToken || '');
        const message   = String(req.body?.message || '').trim();

        if (!userToken) {
          res.status(400).json({ ok: false, error: 'idToken(또는 userToken) 필드가 필요합니다' });
          return;
        }
        if (!message || message.length > 200) {
          res.status(400).json({ ok: false, error: 'message는 1~200자 평문이어야 합니다' });
          return;
        }

        let decoded;
        try {
          decoded = await admin.auth().verifyIdToken(userToken);
        } catch (_) {
          res.status(401).json({ ok: false, error: '유효하지 않은 사용자 토큰입니다' });
          return;
        }

        const userSnap = await db.collection('users').doc(decoded.uid).get();
        if (!userSnap.exists) {
          res.status(404).json({ ok: false, error: 'Jump 미가입 회원입니다' });
          return;
        }
        const data = userSnap.data();
        const encryptedKey = data?.wallet?.encryptedKey;
        const walletAddress = data?.wallet?.address;
        if (!encryptedKey || !walletAddress) {
          res.status(404).json({ ok: false, error: '수탁 지갑이 없습니다' });
          return;
        }

        // 수탁 지갑 복호화 후 서명
        const { ethers } = require('ethers');
        const { decrypt } = require('./wallet/crypto');
        const privateKey = decrypt(encryptedKey, walletSecret.value());
        const signer = new ethers.Wallet(privateKey);
        const signature = await signer.signMessage(message);

        logger.info('signMessage', { uid: decoded.uid, walletAddress, messageLen: message.length });
        res.json({
          ok: true,
          data: { walletAddress, signature, message },
        });
        return;
      }

      // ── 6: 트랜잭션 서명 + 브로드캐스트 POST /signTransaction ──────
      // 파트너 API 키 + 유저 idToken 모두 필요.
      // opBNB Mainnet에서 사용자 수탁 지갑으로 실제 트랜잭션을 전송한다.
      //
      // tx.type 별 Body 예시:
      //   ETH 전송:    { type:"eth",      to:"0x...", value:"1000000000000000000" }
      //   ERC-20:      { type:"erc20",    tokenAddress:"0x...", to:"0x...", amount:"1000000000000000000" }
      //   컨트랙트 호출: { type:"contract", to:"0x...", abi:[...], method:"fn", args:[...], value:"0" }
      if (req.method === 'POST' && path === 'signTransaction') {
        // ① API 키 재확인 (publicPaths에 포함되어 위에서 건너뛰었으므로 여기서 직접 검증)
        const apiKey = req.headers['x-api-key'] || req.body?.apiKey || req.query.api_key || '';
        if (!apiKey || apiKey !== extApiSecret.value()) {
          res.status(401).json({ ok: false, error: 'Invalid API key' });
          return;
        }

        // ② 유저 토큰 검증
        const userToken = (req.headers['x-user-token'] || req.body?.idToken || req.body?.userToken || '');
        if (!userToken) {
          res.status(400).json({ ok: false, error: 'idToken 필드가 필요합니다' });
          return;
        }
        let decoded;
        try {
          decoded = await admin.auth().verifyIdToken(userToken);
        } catch (_) {
          res.status(401).json({ ok: false, error: '유효하지 않은 사용자 토큰입니다' });
          return;
        }

        // ③ 수탁 지갑 조회
        const userSnap = await db.collection('users').doc(decoded.uid).get();
        if (!userSnap.exists) {
          res.status(404).json({ ok: false, error: 'Jump 미가입 회원입니다' });
          return;
        }
        const data = userSnap.data();
        const encryptedKey = data?.wallet?.encryptedKey;
        const walletAddress = data?.wallet?.address;
        if (!encryptedKey || !walletAddress) {
          res.status(404).json({ ok: false, error: '수탁 지갑이 없습니다' });
          return;
        }

        // ④ 트랜잭션 파라미터 검증
        const tx = req.body?.tx;
        if (!tx || !tx.type) {
          res.status(400).json({ ok: false, error: 'tx.type이 필요합니다 (eth | erc20 | contract)' });
          return;
        }
        if (!['eth', 'erc20', 'contract'].includes(tx.type)) {
          res.status(400).json({ ok: false, error: 'tx.type은 eth, erc20, contract 중 하나여야 합니다' });
          return;
        }

        // ⑤ 지갑 복호화 + provider 연결
        const { ethers } = require('ethers');
        const { decrypt } = require('./wallet/crypto');
        const { getProvider } = require('./wallet/chain');
        const privateKey = decrypt(encryptedKey, walletSecret.value());
        const signer = new ethers.Wallet(privateKey, getProvider());

        let txResponse;

        if (tx.type === 'eth') {
          // ETH 전송
          if (!tx.to || !tx.value) {
            res.status(400).json({ ok: false, error: 'tx.to, tx.value가 필요합니다' });
            return;
          }
          txResponse = await signer.sendTransaction({
            to: tx.to,
            value: BigInt(tx.value),
            ...(tx.gasLimit ? { gasLimit: BigInt(tx.gasLimit) } : {}),
          });

        } else if (tx.type === 'erc20') {
          // ERC-20 전송
          if (!tx.tokenAddress || !tx.to || !tx.amount) {
            res.status(400).json({ ok: false, error: 'tx.tokenAddress, tx.to, tx.amount가 필요합니다' });
            return;
          }
          const erc20 = new ethers.Contract(
            tx.tokenAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
          );
          txResponse = await erc20.transfer(tx.to, BigInt(tx.amount),
            tx.gasLimit ? { gasLimit: BigInt(tx.gasLimit) } : {}
          );

        } else {
          // 컨트랙트 호출
          if (!tx.to || !tx.abi || !tx.method) {
            res.status(400).json({ ok: false, error: 'tx.to, tx.abi, tx.method가 필요합니다' });
            return;
          }
          const contract = new ethers.Contract(tx.to, tx.abi, signer);
          const args = Array.isArray(tx.args) ? tx.args : [];
          const overrides = {};
          if (tx.value)    overrides.value    = BigInt(tx.value);
          if (tx.gasLimit) overrides.gasLimit = BigInt(tx.gasLimit);
          txResponse = await contract[tx.method](...args, ...(Object.keys(overrides).length ? [overrides] : []));
        }

        // ⑥ Firestore 감사 로그
        await db.collection('partner_tx_logs').add({
          uid:         decoded.uid,
          walletAddress,
          txType:      tx.type,
          txHash:      txResponse.hash,
          to:          tx.to || null,
          createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        });

        logger.info('signTransaction', { uid: decoded.uid, walletAddress, txType: tx.type, txHash: txResponse.hash });
        res.json({
          ok: true,
          data: {
            txHash:  txResponse.hash,
            from:    walletAddress,
            txType:  tx.type,
          },
        });
        return;
      }

      res.status(404).json({ ok: false, error: '지원하지 않는 엔드포인트입니다' });
    } catch (err) {
      logger.error('[externalApi Error]', err);
      res.status(500).json({ ok: false, error: err.message || '서버 오류' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// DAO 의결 시스템
// ════════════════════════════════════════════════════════════════════════════

// 안건 심의 등록 (JUMP 1만개 이상 스테이킹 필요)
exports.daoCreateProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.createProposal(uid, request.data);
  })
);

// 관리자 승인
exports.daoAdminApproveProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.adminApproveProposal(uid, request.data);
  })
);

// 관리자 반려
exports.daoAdminRejectProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.adminRejectProposal(uid, request.data);
  })
);

// 관리자 가결/부결 (voting → passed/rejected)
exports.daoAdminFinalizeVote = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.adminFinalizeVote(uid, request.data);
  })
);

// 안건 지지 (누적 25만 달성 시 의결 전환)
exports.daoSupportProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.supportProposal(uid, request.data);
  })
);

// 투표 (찬성/반대, 과반 달성 시 즉시 의결)
exports.daoVoteProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.voteProposal(uid, request.data);
  })
);

// 안건 삭제 (pending_admin, 작성자/관리자)
exports.daoDeleteProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.deleteProposal(uid, request.data);
  })
);

// 안건 수정 (pending_admin, 작성자/관리자)
exports.daoUpdateProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.updateProposal(uid, request.data);
  })
);

// 댓글 (JUMP 1만개 이상 스테이킹 필요)
exports.daoCommentProposal = onCall(
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return daoH.commentProposal(uid, request.data);
  })
);

// DAO 10일 만료 자동 부결 — 매일 오전 9시 (UTC+7 기준 02:00 UTC)
exports.daoAutoRejectExpired = onSchedule('every 24 hours', async () => {
  await daoH.autoRejectExpiredProposals();
});

// ════════════════════════════════════════════════════════════════════════════
// 보물찾기 시스템
// ════════════════════════════════════════════════════════════════════════════

exports.collectTreasureBox = onCall(wrapError(async (req) => {
  return treasureH.collectTreasureBox(requireAuth(req), req.data ?? {});
}));

exports.openTreasureBox = onCall(wrapError(async (req) => {
  return treasureH.openTreasureBox(requireAuth(req), req.data ?? {});
}));

exports.adminCollectTreasureBox = onCall(wrapError(async (req) => {
  return treasureH.adminCollectTreasureBox(requireAuth(req), req.data ?? {});
}));

exports.craftVoucher = onCall(wrapError(async (req) => {
  return treasureH.craftVoucher(requireAuth(req), req.data ?? {});
}));

exports.adminSaveTreasureItem = onCall(wrapError(async (req) => {
  return treasureH.adminSaveTreasureItem(requireAuth(req), req.data ?? {});
}));

exports.adminSaveTreasureBox = onCall(wrapError(async (req) => {
  return treasureH.adminSaveTreasureBox(requireAuth(req), req.data ?? {});
}));

exports.adminDeleteTreasureBox = onCall(wrapError(async (req) => {
  return treasureH.adminDeleteTreasureBox(requireAuth(req), req.data ?? {});
}));

exports.adminListTreasureBoxes = onCall(wrapError(async (req) => {
  return treasureH.adminListTreasureBoxes(requireAuth(req));
}));

exports.adminSaveVoucher = onCall(wrapError(async (req) => {
  return treasureH.adminSaveVoucher(requireAuth(req), req.data ?? {});
}));

exports.adminGrantItem = onCall(wrapError(async (req) => {
  return treasureH.adminGrantItem(requireAuth(req), req.data ?? {});
}));

exports.usePotion = onCall(wrapError(async (req) => {
  return treasureH.usePotion(requireAuth(req));
}));

exports.useMpPotion = onCall(wrapError(async (req) => {
  return treasureH.useMpPotion(requireAuth(req));
}));

exports.useReviveTicket = onCall(wrapError(async (req) => {
  return treasureH.useReviveTicket(requireAuth(req));
}));

exports.earnKey = onCall(wrapError(async (req) => {
  return treasureH.earnKey(requireAuth(req), req.data ?? {});
}));

exports.adminSaveTreasureKey = onCall(wrapError(async (req) => {
  return treasureH.adminSaveTreasureKey(requireAuth(req), req.data ?? {});
}));

exports.adminDeleteTreasureKey = onCall(wrapError(async (req) => {
  return treasureH.adminDeleteTreasureKey(requireAuth(req), req.data ?? {});
}));

// ── 바닥 드랍 시스템 ───────────────────────────────────────────────────────────
exports.dropInventoryItem = onCall(wrapError(async (req) => {
  return treasureH.dropInventoryItem(requireAuth(req), req.data ?? {});
}));

exports.pickupDroppedItem = onCall(wrapError(async (req) => {
  return treasureH.pickupDroppedItem(requireAuth(req), req.data ?? {});
}));

exports.cleanupExpiredDrops = onSchedule('every 5 minutes', async () => {
  await treasureH.cleanupExpiredDrops();
});

// 관리자: 빨간약 직접 지급
exports.adminGivePotion = onCall(wrapError(async (req) => {
  const adminUid = requireAuth(req);
  await requireAdmin(adminUid);
  const { targetUid, count = 1 } = req.data ?? {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid가 필요합니다');
  const n = Math.max(1, Math.floor(Number(count)));
  const db = admin.firestore();
  const invRef = db.collection('treasure_inventory').doc(`${targetUid}_potion_red`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    tx.set(invRef, {
      uid: targetUid, itemId: 'potion_red', count: current + n,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return { ok: true, given: n };
}));

// ── 관리자: GP(gold) 지급 / 설정
exports.adminSetGold = onCall(wrapError(async (req) => {
  const adminUid = requireAuth(req);
  await requireAdmin(adminUid);
  const { targetUid, gold, mode = 'set' } = req.data ?? {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid 필요');
  const amount = Math.max(0, Math.floor(Number(gold)));
  if (isNaN(amount)) throw new HttpsError('invalid-argument', 'gold는 숫자여야 합니다');
  const db = admin.firestore();
  const ref = db.collection('battle_players').doc(targetUid);
  if (mode === 'add') {
    await ref.set({ gold: admin.firestore.FieldValue.increment(amount), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } else {
    await ref.set({ gold: amount, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  const snap = await ref.get();
  return { ok: true, gold: snap.data()?.gold ?? amount };
}));

exports.adminGiveRevive = onCall(wrapError(async (req) => {
  const adminUid = requireAuth(req);
  await requireAdmin(adminUid);
  const { targetUid, count = 1 } = req.data ?? {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid가 필요합니다');
  const n = Math.max(1, Math.floor(Number(count)));
  const db = admin.firestore();
  const invRef = db.collection('treasure_inventory').doc(`${targetUid}_revive_ticket`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    tx.set(invRef, {
      uid: targetUid, itemId: 'revive_ticket', count: current + n,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return { ok: true, given: n };
}));

exports.earnReviveTicket = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  const db = admin.firestore();
  const invRef = db.collection('treasure_inventory').doc(`${uid}_revive_ticket`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    tx.set(invRef, {
      uid, itemId: 'revive_ticket', count: current + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return { ok: true };
}));

// ════════════════════════════════════════════════════════════════════════════
// 소셜 커뮤니티 – 행사 바우처
// ════════════════════════════════════════════════════════════════════════════

exports.checkEventEligibility = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return communityH.checkEventEligibility(uid, req.data ?? {});
}));

exports.getMyEventVoucher = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return communityH.getMyEventVoucher(uid, req.data ?? {});
}));

exports.buyEventVoucher = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (req) => {
    const uid = requireAuth(req);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await communityH.buyEventVoucher(uid, req.data ?? {}, walletSecret.value());
    logger.info('buyEventVoucher', { uid, eventId: req.data?.eventId, txHash: result.txHash });
    return result;
  })
);

exports.confirmVoucher = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return communityH.confirmVoucher(uid, req.data ?? {});
}));


// ════════════════════════════════════════════════════════════════════════════
// 관리자: 회원 비활성화 / 재활성화
// ════════════════════════════════════════════════════════════════════════════
exports.adminDisableUser = onCall(wrapError(async (req) => {
  const adminUid = requireAuth(req);
  await requireAdmin(adminUid);
  const { targetUid } = req.data ?? {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid가 필요합니다');
  const db = admin.firestore();
  await admin.auth().updateUser(targetUid, { disabled: true });
  await db.collection('users').doc(targetUid).set(
    { disabled: true, disabledAt: admin.firestore.FieldValue.serverTimestamp(), disabledBy: adminUid },
    { merge: true }
  );
  logger.info('adminDisableUser', { adminUid, targetUid });
  return { ok: true };
}));

exports.adminEnableUser = onCall(wrapError(async (req) => {
  const adminUid = requireAuth(req);
  await requireAdmin(adminUid);
  const { targetUid } = req.data ?? {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid가 필요합니다');
  const db = admin.firestore();
  await admin.auth().updateUser(targetUid, { disabled: false });
  await db.collection('users').doc(targetUid).set(
    { disabled: false, enabledAt: admin.firestore.FieldValue.serverTimestamp(), enabledBy: adminUid },
    { merge: true }
  );
  logger.info('adminEnableUser', { adminUid, targetUid });
  return { ok: true };
}));

// ════════════════════════════════════════════════════════════════════════════
// 관리자: 가맹점 활성/비활성 토글
// ════════════════════════════════════════════════════════════════════════════
exports.adminToggleMerchant = onCall(wrapError(async (req) => {
  const adminUid = requireAuth(req);
  await requireAdmin(adminUid);
  const { merchantId, active } = req.data ?? {};
  if (merchantId === undefined || merchantId === null) throw new HttpsError('invalid-argument', 'merchantId가 필요합니다');
  if (typeof active !== 'boolean') throw new HttpsError('invalid-argument', 'active(boolean)가 필요합니다');
  const db = admin.firestore();
  await db.collection('merchants').doc(String(merchantId)).update({
    active,
    [`${active ? 'activated' : 'deactivated'}At`]: admin.firestore.FieldValue.serverTimestamp(),
    [`${active ? 'activated' : 'deactivated'}By`]: adminUid,
  });
  logger.info('adminToggleMerchant', { adminUid, merchantId, active });
  return { ok: true, merchantId, active };
}));

// ════════════════════════════════════════════════════════════════════════════
// 1:1 채팅 AI 자동 응답 (관리자 오프라인 시 Gemini가 대신 답변)
// ════════════════════════════════════════════════════════════════════════════
exports.onSupportChatMessage = onDocumentCreated(
  {
    document: 'support_chats/{uid}/messages/{msgId}',
    secrets: [geminiSecret],
  },
  async (event) => {
    await supportChatH.onNewSupportMessage(event, geminiSecret.value());
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 공개 통계 집계 — stats/public (랜딩 페이지 실시간 표시용)
// ════════════════════════════════════════════════════════════════════════════
exports.onUserCreatedStats = onDocumentCreated('users/{uid}', async () => {
  const statsRef = db.collection('stats').doc('public');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(statsRef);
    const prev = snap.exists ? (snap.data().userCount || 0) : 0;
    tx.set(statsRef, { userCount: prev + 1 }, { merge: true });
  });
});

exports.onTreasureCollectedStats = onDocumentCreated('treasure_logs/{docId}', async () => {
  const statsRef = db.collection('stats').doc('public');
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(statsRef);
    const data = snap.exists ? snap.data() : {};
    const sameDay = data.treasureDate === today;
    tx.set(statsRef, {
      treasureDate: today,
      treasureTodayCount: sameDay ? (data.treasureTodayCount || 0) + 1 : 1,
      treasureTotalCount: (data.treasureTotalCount || 0) + 1,
    }, { merge: true });
  });
});

// ── 상점 관리 ────────────────────────────────────────────────────────────────
exports.adminSaveShop = onCall(wrapError(async (req) => {
  return shopH.adminSaveShop(requireAuth(req), req.data ?? {});
}));

exports.ownerSaveShopItems = onCall(wrapError(async (req) => {
  return shopH.ownerSaveShopItems(requireAuth(req), req.data ?? {});
}));

exports.payWarpEntrance = onCall(wrapError(async (req) => {
  return shopH.payWarpEntrance(requireAuth(req), req.data ?? {});
}));

exports.adminDeleteShop = onCall(wrapError(async (req) => {
  return shopH.adminDeleteShop(requireAuth(req), req.data ?? {});
}));

exports.buyShopItem = onCall(wrapError(async (req) => {
  return shopH.buyShopItem(requireAuth(req), req.data ?? {});
}));

exports.getWeaponArmorJackpot = onCall(wrapError(async () => {
  return shopH.getWeaponArmorJackpot();
}));

exports.claimWeaponArmorDividend = onCall(wrapError(async (req) => {
  return shopH.claimWeaponArmorDividend(requireAuth(req), req.data ?? {});
}));

exports.getShopSales = onCall(wrapError(async (req) => {
  return shopH.getShopSales(requireAuth(req), req.data ?? {});
}));

exports.initBattlePlayer = onCall(wrapError(async (req) => {
  return shopH.initBattlePlayer(requireAuth(req));
}));

exports.adminInitAllPlayers = onCall(wrapError(async (req) => {
  return shopH.adminInitAllPlayers(requireAuth(req));
}));

exports.attackShop = onCall(wrapError(async (req) => {
  return shopH.attackShop(requireAuth(req), req.data ?? {});
}));

exports.repairShop = onCall(wrapError(async (req) => {
  return shopH.repairShop(requireAuth(req), req.data ?? {});
}));

exports.transferShop = onCall(wrapError(async (req) => {
  return shopH.transferShop(requireAuth(req), req.data ?? {});
}));

exports.levelUpShop = onCall(wrapError(async (req) => {
  return shopH.levelUpShop(requireAuth(req), req.data ?? {});
}));

exports.updateShopAppearance = onCall(wrapError(async (req) => {
  return shopH.updateShopAppearance(requireAuth(req), req.data ?? {});
}));

// 최초 1회 호출 — 기존 users 수를 세어 stats/public 초기화 (어드민 전용)
// ════════════════════════════════════════════════════════════════════════════
// NFC 보물 태그 시스템
// ════════════════════════════════════════════════════════════════════════════

exports.adminSaveNfcTag = onCall(wrapError(async (req) => {
  return nfcH.adminSaveNfcTag(requireAuth(req), req.data ?? {});
}));

exports.adminDeleteNfcTag = onCall(wrapError(async (req) => {
  return nfcH.adminDeleteNfcTag(requireAuth(req), req.data ?? {});
}));

exports.adminRegisterDevice = onCall(wrapError(async (req) => {
  return nfcH.adminRegisterDevice(requireAuth(req), req.data ?? {});
}));

exports.adminRemoveDevice = onCall(wrapError(async (req) => {
  return nfcH.adminRemoveDevice(requireAuth(req), req.data ?? {});
}));

exports.claimNfcTreasure = onCall(wrapError(async (req) => {
  return nfcH.claimNfcTreasure(requireAuth(req), req.data ?? {});
}));

exports.adminListNfcTags = onCall(wrapError(async (req) => {
  return nfcH.adminListNfcTags(requireAuth(req));
}));

exports.adminListNfcClaims = onCall(wrapError(async (req) => {
  return nfcH.adminListNfcClaims(requireAuth(req), req.data ?? {});
}));

// ════════════════════════════════════════════════════════════════════════════
// 튜토리얼 보물 발견 체험 시스템
// ════════════════════════════════════════════════════════════════════════════

exports.initTutorialBoxes = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return tutorialH.initTutorialBoxes(uid, req.data ?? {});
}));

exports.claimTutorialBox = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return tutorialH.claimTutorialBox(uid, req.data ?? {});
}));

exports.getTutorialBoxes = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return tutorialH.getTutorialBoxes(uid);
}));

exports.initPublicStats = onCall(async (req) => {
  await requireAdmin(requireAuth(req));
  const [userSnap, logSnap] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('treasure_logs').count().get(),
  ]);
  const userCount = userSnap.data().count;
  const totalCount = logSnap.data().count;
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('stats').doc('public').set({
    userCount,
    treasureTotalCount: totalCount,
    treasureTodayCount: 0,
    treasureDate: today,
    initializedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, userCount, totalCount };
});

// ── 슬롯 머신 ────────────────────────────────────────────────────────────────
exports.spinSlot = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return slotH.spinSlot(uid, req.data ?? {});
}));

exports.getSlotJackpot = onCall(wrapError(async (_req) => {
  return slotH.getJackpot();
}));

// ── 사용자 보물 + NPC ─────────────────────────────────────────────────────────
exports.registerUserTreasure = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return userTreasureH.registerUserTreasure(uid, req.data ?? {});
}));

exports.discoverUserTreasure = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return userTreasureH.discoverUserTreasure(uid, req.data ?? {});
}));

exports.listUserTreasureNpcs = onCall(wrapError(async (req) => {
  const uid = req.auth?.uid || null;
  return userTreasureH.listUserTreasureNpcs(uid);
}));

exports.getMyUserTreasures = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return userTreasureH.getMyUserTreasures(uid);
}));

exports.cancelUserTreasure = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return userTreasureH.cancelUserTreasure(uid, req.data ?? {});
}));

exports.addTreasureComment = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return userTreasureH.addTreasureComment(uid, req.data ?? {});
}));

exports.deleteTreasureComment = onCall(wrapError(async (req) => {
  const uid     = requireAuth(req);
  let isAdmin   = false;
  try { await requireAdmin(uid); isAdmin = true; } catch (_) {}
  return userTreasureH.deleteTreasureComment(uid, req.data ?? {}, isAdmin);
}));

exports.listTreasureComments = onCall(wrapError(async (req) => {
  return userTreasureH.listTreasureComments(req.data ?? {});
}));

exports.checkHintUnlock = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return userTreasureH.checkHintUnlock(uid, req.data ?? {});
}));

exports.unlockHint = onCall(wrapError(async (req) => {
  const uid = requireAuth(req);
  return userTreasureH.unlockHint(uid, req.data ?? {});
}));

// ════════════════════════════════════════════════════════════════════════════
// 게임코인 ↔ JUMP 교환 (JumpAutoExchange 컨트랙트)
// ════════════════════════════════════════════════════════════════════════════

// 교환 현황 조회 (비율, 잔고, 유저 gold/JUMP)
exports.getCoinExchangeStatus = onCall(
  { secrets: [adminKeySecret, exchangeAddrSecret] },
  wrapError(async (req) => {
    const uid = requireAuth(req);
    process.env.ADMIN_PRIVATE_KEY          = adminKeySecret.value();
    process.env.JUMP_AUTO_EXCHANGE_ADDRESS = exchangeAddrSecret.value();
    return coinExchangeH.getCoinExchangeStatus(uid);
  })
);

// 게임코인 → JUMP 교환
exports.buyJumpWithCoins = onCall(
  { secrets: [walletSecret, adminKeySecret, exchangeAddrSecret] },
  wrapError(async (req) => {
    const uid = requireAuth(req);
    const { coinAmount } = req.data ?? {};
    if (!coinAmount) throw new HttpsError('invalid-argument', 'coinAmount가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY          = adminKeySecret.value();
    process.env.JUMP_AUTO_EXCHANGE_ADDRESS = exchangeAddrSecret.value();
    const result = await coinExchangeH.buyJumpWithCoins(uid, coinAmount, walletSecret.value());
    logger.info('buyJumpWithCoins', { uid, coinAmount, jumpAmount: result.jumpAmount, txHash: result.txHash });
    return result;
  })
);

// JUMP → 게임코인 교환
exports.sellJumpForCoins = onCall(
  { secrets: [walletSecret, adminKeySecret, exchangeAddrSecret] },
  wrapError(async (req) => {
    const uid = requireAuth(req);
    const { jumpAmount } = req.data ?? {};
    if (!jumpAmount) throw new HttpsError('invalid-argument', 'jumpAmount가 필요합니다');
    process.env.ADMIN_PRIVATE_KEY          = adminKeySecret.value();
    process.env.JUMP_AUTO_EXCHANGE_ADDRESS = exchangeAddrSecret.value();
    const result = await coinExchangeH.sellJumpForCoins(uid, jumpAmount, walletSecret.value());
    logger.info('sellJumpForCoins', { uid, jumpAmount, coinAmount: result.coinAmount, txHash: result.txHash });
    return result;
  })
);

// HEX → GP 현황 조회
exports.getHexGpStatus = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (req) => {
    const uid = requireAuth(req);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return coinExchangeH.getHexGpStatus(uid);
  })
);

// HEX → GP 전환
exports.hexToGp = onCall(
  { secrets: [walletSecret, adminKeySecret] },
  wrapError(async (req) => {
    const uid = requireAuth(req);
    const { hexWei } = req.data ?? {};
    if (!hexWei) throw new HttpsError('invalid-argument', 'hexWei is required');
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const result = await coinExchangeH.hexToGp(uid, hexWei, walletSecret.value());
    logger.info('hexToGp', { uid, hexWei, gpAmount: result.gpAmount, txHash: result.txHash });
    return result;
  })
);

// 관리자: 교환 내역 목록
exports.listCoinExchanges = onCall(
  { secrets: [exchangeAddrSecret] },
  wrapError(async (req) => {
    const uid = requireAuth(req);
    await requireAdmin(uid);
    process.env.JUMP_AUTO_EXCHANGE_ADDRESS = exchangeAddrSecret.value();
    const { direction, limit } = req.data ?? {};
    return coinExchangeH.listCoinExchanges({ direction, limit });
  })
);

// ── 홈 랭킹 ──────────────────────────────────────────────────────────────────
exports.getHomeRankings = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  wrapError(async () => rankingsH.getHomeRankings())
);

// ── 랭킹 더미 데이터 시드 (관리자 전용 — 1회 실행 후 제거 예정) ─────────────
const seedH = require('./handlers/seed');
exports.adminSeedRankings = onCall(
  { timeoutSeconds: 120 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    return seedH.seedAllRankings();
  })
);

// ── 스톡옵션 바우처 시스템 ────────────────────────────────────────────────────
exports.adminCreateStockOffering = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    return stockOptionH.adminCreateOffering(uid, request.data ?? {});
  })
);

exports.getStockOfferings = onCall(
  {},
  wrapError(async () => stockOptionH.getStockOfferings())
);

exports.adminGetAllStockOfferings = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    return stockOptionH.adminGetAllOfferings();
  })
);

exports.adminGetAllStockVouchers = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    return stockOptionH.adminGetAllVouchers();
  })
);

exports.buyStockOptionVoucher = onCall(
  { secrets: [walletSecret, adminKeySecret], timeoutSeconds: 180 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return stockOptionH.buyStockOptionVoucher(uid, request.data ?? {}, walletSecret.value());
  })
);

exports.getMyStockVouchers = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return stockOptionH.getMyStockVouchers(uid);
  })
);

exports.exerciseStockOption = onCall(
  { secrets: [walletSecret, adminKeySecret], timeoutSeconds: 180 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return stockOptionH.exerciseStockOption(uid, request.data ?? {}, walletSecret.value());
  })
);

exports.transferStockOptionVoucher = onCall(
  { secrets: [walletSecret, adminKeySecret], timeoutSeconds: 120 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return stockOptionH.transferStockOptionVoucher(uid, request.data ?? {}, walletSecret.value());
  })
);

exports.adminToggleStockOffering = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    return stockOptionH.adminToggleOffering(uid, request.data ?? {});
  })
);

// ── 초보자 체험 패키지 ──────────────────────────────────────────────────────
// getStarterPack 제거: 시드·클레임이 클라이언트 로컬로 이전됨 (Firestore 읽기 절감)
exports.recordStarterClaim = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return starterH.recordStarterClaim(uid, request.data ?? {});
  })
);

// ── 유저 배치 상점 ────────────────────────────────────────────────────────────
exports.placeUserObject = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.placeUserObject(uid, request.data ?? {});
  })
);

exports.getMyPlacedObjects = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.getMyPlacedObjects(uid);
  })
);

exports.getUserPlacePrices = onCall(
  {},
  wrapError(async () => userPlaceH.getUserPlacePrices())
);

exports.adminSetUserPlacePrices = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid);
    return userPlaceH.adminSetUserPlacePrices(request.data ?? {});
  })
);

exports.useTicket = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.useTicket(uid, request.data ?? {});
  })
);

exports.getMyPlacementTickets = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.getMyPlacementTickets(uid);
  })
);

exports.placeUserMarker = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.placeUserMarker(uid, request.data ?? {});
  })
);

exports.getUserMarkers = onCall(
  {},
  wrapError(async () => userPlaceH.getUserMarkers())
);

exports.getMyUserMarker = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.getMyUserMarker(uid);
  })
);

exports.updateUserMarker = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.updateUserMarker(uid, request.data ?? {});
  })
);

exports.deleteUserMarker = onCall(
  {},
  wrapError(async (request) => {
    const uid = requireAuth(request);
    return userPlaceH.deleteUserMarker(uid, request.data ?? {});
  })
);

// ════════════════════════════════════════════════════════════════════════════
// 게임 경험치 → 온체인 레벨 배치 동기화
// 설계: XP마다 온체인 저장 ❌ → 레벨업 시 Firestore 플래그 → 6시간 배치 1tx
// ════════════════════════════════════════════════════════════════════════════
exports.scheduledExpSync = onSchedule(
  { schedule: 'every 6 hours', secrets: [adminKeySecret] },
  async () => {
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    const count = await expSyncH.batchSyncPendingLevels();
    logger.info('[scheduledExpSync] 완료', { synced: count });
  }
);

// 수동 동기화 — 유저 직접 요청 (24시간 1회 제한)
exports.requestOnChainLevelSync = onCall(
  { secrets: [adminKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();
    return expSyncH.manualSyncLevel(uid);
  })
);

// ════════════════════════════════════════════════════════════════════════════
// GP 획득 생중계 — 그룹 채팅에 게임별 GP 브로드캐스트
// 선행 작업: firebase functions:secrets:set ANNOUNCE_GROUP_ID
//           (값: Telegram 그룹/채널 chat_id, 예: -1001234567890)
// ════════════════════════════════════════════════════════════════════════════
const _GAME_LABELS = {
  relay:          '🏃 Sprint Relay',
  conquest:       '🏰 Monster Siege',
  dungeon:        '⚔️ Dungeon',
  archery:        '🏹 Archery',
  memory:         '🧠 Memory Game',
  treasure:       '💎 Treasure Hunt',
  monsterrace:    '🐉 Monster Race',
  treasure_hide:  '📦 Treasure Hidden',
  treasure_find:  '🏆 Treasure Found',
  treasure_issue: '🎁 Treasure Issued',
};
// 유저별 마지막 브로드캐스트 시각 (인스턴스 내 캐시, 이벤트 종류별 15초 쿨다운)
const _broadcastCooldown = new Map();

exports.broadcastGpEvent = onCall(
  { secrets: [telegramBotSecret, announceGroupSecret] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) return { ok: false };
    const { game, amount, label: extraLabel } = request.data || {};
    if (!game) return { ok: false };

    // 보물 이벤트는 GP 없이 허용, 일반 게임은 50GP 이상만
    const isTreasureEvent = game.startsWith('treasure_');
    if (!isTreasureEvent && (!amount || amount < 50)) return { ok: false };

    const chatId = announceGroupSecret.value()?.trim();
    if (!chatId) return { ok: false };

    // 쿨다운: 이벤트 종류별 독립 키 (treasure 이벤트 15초, GP 이벤트 30초)
    const cdKey  = `${uid}:${game}`;
    const cdMs   = isTreasureEvent ? 15000 : 30000;
    const now    = Date.now();
    if (now - (_broadcastCooldown.get(cdKey) || 0) < cdMs) return { ok: false };
    _broadcastCooldown.set(cdKey, now);

    try {
      const snap = await db.collection('battle_players').doc(uid).get();
      const d    = snap.data() || {};
      let name = d.displayName || d.name;
      if (!name) {
        const uSnap = await db.collection('users').doc(uid).get();
        name = uSnap.data()?.displayName || uSnap.data()?.name || 'Adventurer';
      }

      let msg;
      if (game === 'treasure_hide') {
        const item = extraLabel || 'Treasure';
        msg = `📦 <b>${name}</b> has hidden <b>${item}</b> on the map! Can you find it? 🔍`;
      } else if (game === 'treasure_find') {
        const boxName = extraLabel || 'Treasure Box';
        msg = `🏆 <b>${name}</b> discovered <b>${boxName}</b>! 💎`;
      } else if (game === 'treasure_issue') {
        const item = extraLabel || 'Treasure';
        msg = `🎁 <b>${name}</b> published <b>${item}</b> on the map!`;
      } else {
        const gameLabel = _GAME_LABELS[game] || '🎮 Game';
        msg = `${gameLabel}\n<b>${name}</b> earned <b>+${Number(amount).toLocaleString()} GP</b>! 🎉`;
      }

      logger.info('[broadcastGpEvent] sending', { uid, game, amount, chatId });
      const ok = await telegramH.sendTelegramMessage(telegramBotSecret.value(), chatId, msg);
      logger.info('[broadcastGpEvent] result', { ok });
      // 실제 유저 이벤트 발생 → NPC 스케줄러 지연 트리거
      if (ok) npcH.markRealUserEvent().catch(() => {});
      return { ok };
    } catch (e) {
      logger.warn('[broadcastGpEvent] error', e?.message);
      return { ok: false };
    }
  }
);

// ── NPC 이벤트 스케줄러 (1분마다 체크 → 14~20분 랜덤 간격 발화) ────────────
exports.npcEventScheduler = onSchedule(
  { schedule: 'every 5 minutes', secrets: [telegramBotSecret, announceGroupSecret] },
  async () => {
    try {
      const result = await npcH.runNpcScheduler(
        telegramBotSecret.value(),
        announceGroupSecret.value()?.trim(),
      );
      if (result.ok) logger.info('[npcEventScheduler] fired', result);
    } catch (e) {
      logger.error('[npcEventScheduler] error', e?.message);
    }
  }
);

// NPC 캐릭터 초기 시드 (관리자 1회 실행)
exports.seedNpcCharacters = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  return npcH.seedNpcCharacters();
}));

// ════════════════════════════════════════════════════════════════════════════
// Telegram Mini App 인증
// 클라이언트: httpsCallable(functions, 'telegramAuth')({ initData })
// 선행 작업: firebase functions:secrets:set TELEGRAM_BOT_TOKEN
// ════════════════════════════════════════════════════════════════════════════
exports.telegramAuth = onCall(
  { secrets: [telegramBotSecret] },
  wrapError(async (request) => {
    const { initData } = request.data || {};
    return telegramH.authWithTelegram(initData, telegramBotSecret.value());
  })
);

// ════════════════════════════════════════════════════════════════════════════
// TON ↔ GameCoin 교환 시스템  (lazy require — @ton/ton 패키지 크기 대응)
// 사전 작업: firebase functions:secrets:set TON_ADMIN_MNEMONIC
// ════════════════════════════════════════════════════════════════════════════
const tonMnemonic = defineSecret('TON_ADMIN_MNEMONIC');  // 관리자 TON 지갑 24-word 시드

// TON 실시간 가격 + 교환비 + 관리자 지갑 주소 조회
exports.tonGetPrice = onCall(
  { secrets: [tonDepositSecret] },
  wrapError(async () => {
    process.env.TON_DEPOSIT_ADDRESS = tonDepositSecret.value();
    const tonH = require('./handlers/tonExchange');
    const info = await tonH.getPrice();
    logger.info('tonGetPrice', { tonUsd: info.tonUsd });
    return info;
  })
);

// TON 입금 TX 검증 → GameCoin 자동 지급
exports.tonDepositVerify = onCall(
  { secrets: [tonDepositSecret] },
  wrapError(async (request) => {
    process.env.TON_DEPOSIT_ADDRESS = tonDepositSecret.value();
    const uid    = requireAuth(request);
    const { txHash } = request.data ?? {};
    if (!txHash) throw new HttpsError('invalid-argument', 'txHash가 필요합니다');
    const tonH  = require('./handlers/tonExchange');
    const result = await tonH.verifyDeposit(txHash, uid);
    logger.info('tonDepositVerify', { uid, txHash, gamecoin: result.gamecoin });
    return result;
  })
);

// TonConnect 전송 후 자동 TX 탐색 → GameCoin 지급
exports.tonDepositAuto = onCall(
  { secrets: [tonDepositSecret], timeoutSeconds: 120 },
  wrapError(async (request) => {
    process.env.TON_DEPOSIT_ADDRESS = tonDepositSecret.value();
    const uid = requireAuth(request);
    const { senderAddress, tonNano, sentAt } = request.data ?? {};
    if (!senderAddress) throw new HttpsError('invalid-argument', 'senderAddress가 필요합니다');
    if (!tonNano || tonNano <= 0) throw new HttpsError('invalid-argument', 'tonNano가 필요합니다');
    if (!sentAt) throw new HttpsError('invalid-argument', 'sentAt이 필요합니다');
    const tonH   = require('./handlers/tonExchange');
    const result = await tonH.verifyDepositAuto(senderAddress, Number(tonNano), Number(sentAt), uid);
    logger.info('tonDepositAuto', { uid, senderAddress, tonNano, gamecoin: result.gamecoin });
    return result;
  })
);

// GameCoin → TON 자동 출금 (최소 10,000 GP, @ton/ton SDK로 즉시 송금)
exports.tonWithdrawRequest = onCall(
  { secrets: [tonPrivKeySecret, tonCenterKeySecret] },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    const { gamecoin, walletAddress } = request.data ?? {};
    if (!gamecoin || !walletAddress)
      throw new HttpsError('invalid-argument', 'gamecoin, walletAddress 필요');
    const gp = Number(gamecoin);
    if (gp < 10000)
      throw new HttpsError('invalid-argument', '최소 출금은 10,000 GP 입니다');
    process.env.TON_PRIVATE_KEY    = tonPrivKeySecret.value();
    process.env.TON_CENTER_API_KEY = tonCenterKeySecret.value();
    const tonH   = require('./handlers/tonExchange');
    const result = await tonH.requestWithdraw(gp, walletAddress, uid);
    logger.info('tonWithdrawRequest', { uid, gamecoin: gp, tonAmount: result.tonAmount, txHash: result.txHash });
    return result;
  })
);

// 내 TON 거래 내역 조회
exports.tonGetTransactions = onCall(
  wrapError(async (request) => {
    const uid  = requireAuth(request);
    const tonH = require('./handlers/tonExchange');
    return tonH.getMyTransactions(uid, 30);
  })
);

// ════════════════════════════════════════════════════════════════════════════
// Telegram 웹 로그인 위젯 인증 (일반 브라우저에서 텔레그램 ID로 로그인)
// ════════════════════════════════════════════════════════════════════════════
exports.telegramWebAuth = onCall(
  { secrets: [telegramBotSecret] },
  wrapError(async (request) => {
    const userData = request.data ?? {};
    return await telegramH.telegramWebAuth(userData, telegramBotSecret.value());
  })
);

// ════════════════════════════════════════════════════════════════════════════
// Telegram Bot: 지갑 생성 + 온체인 등록
// bot.py → POST X-Bot-Token 헤더로 인증, uid + mentorAddress 전달
// ════════════════════════════════════════════════════════════════════════════
exports.telegramRegister = onRequest(
  { cors: false, secrets: [walletSecret, adminKeySecret, telegramBotSecret], timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }
    if ((req.headers['x-bot-token'] || '') !== telegramBotSecret.value()) {
      res.status(401).json({ error: '인증 실패' });
      return;
    }
    const { uid, mentorAddress } = req.body ?? {};
    if (!uid || !uid.startsWith('tg_')) {
      res.status(400).json({ error: 'uid 오류 (tg_ 접두사 필요)' });
      return;
    }
    process.env.ADMIN_PRIVATE_KEY = adminKeySecret.value();

    // 1단계: 지갑 생성 + 보너스 (빠른 Firestore 작업, ~3초)
    //        완료 즉시 봇에 응답 → 봇이 로딩 없이 바로 결과 표시
    let fastResult;
    try {
      fastResult = await onboarding.createWalletAndBonus(uid, walletSecret.value(), mentorAddress || null);
    } catch (err) {
      logger.error('[telegramRegister] wallet/bonus error', err);
      res.status(500).json({ error: err.message || '지갑 생성 실패' });
      return;
    }

    logger.info('telegramRegister fast', { uid, address: fastResult.address, created: fastResult.created });
    res.json(fastResult);  // 봇에 즉시 응답

    // 2단계: 온체인 등록 (느린 블록체인 작업, 응답 후 백그라운드 실행)
    if (fastResult.created) {
      onboarding.registerOnChainBackground(uid, mentorAddress || null, walletSecret.value())
        .catch((err) => logger.warn('[telegramRegister] onchain background error', err.message));
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// Telegram Stars 결제 — 상품 지급
// POST body: { chargeId }  /  X-Bot-Token 헤더 검증
// ════════════════════════════════════════════════════════════════════════════
exports.starsGrantProduct = onRequest(
  { cors: false, secrets: [telegramBotSecret], timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if ((req.headers['x-bot-token'] || '') !== telegramBotSecret.value()) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    const { chargeId } = req.body || {};
    if (!chargeId) { res.status(400).json({ error: 'chargeId required' }); return; }
    try {
      const result = await starsH.grantProduct(chargeId);
      logger.info('[starsGrantProduct]', { chargeId, ...result });
      res.json(result);
    } catch (e) {
      logger.error('[starsGrantProduct] error', e?.message);
      res.status(500).json({ error: e?.message });
    }
  }
);

// 관리자 자기 등록 (부트스트랩) — ADMIN_EMAILS 일치 시 admins/{uid} 생성
exports.adminRegisterSelf = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);

  // JWT 토큰 이메일 우선, 없으면 Admin SDK 조회
  let email = request.auth?.token?.email?.toLowerCase();
  if (!email) {
    try {
      const record = await admin.auth().getUser(uid);
      email = record.email?.toLowerCase();
    } catch (_) {}
  }

  if (!email || !ADMIN_EMAILS.includes(email)) {
    throw new HttpsError('permission-denied', 'Not in admin email list');
  }

  const db = admin.firestore();
  await Promise.all([
    db.collection('admins').doc(uid).set({ email, createdAt: new Date() }),
    db.collection('users').doc(uid).set({ isAdmin: true }, { merge: true }),
  ]);
  return { ok: true };
}));

// Stars 관리자 통계
exports.starsGetAdminStats = onCall(
  { timeoutSeconds: 60 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid, request.auth?.token?.email);
    return starsH.getAdminStats();
  })
);

// Stars 상품 시드 (최초 1회)
exports.starsSeedProducts = onCall(
  { timeoutSeconds: 60 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid, request.auth?.token?.email);
    return starsH.seedProducts();
  })
);

// Stars 상품 추가/수정 (관리자)
exports.starsUpsertProduct = onCall(
  { timeoutSeconds: 60 },
  wrapError(async (request) => {
    const uid = requireAuth(request);
    await requireAdmin(uid, request.auth?.token?.email);
    return starsH.upsertProduct(request.data);
  })
);

// ── 일일 구역 (보물박스 15 + 몬스터 15 / 24h 리셋) ──────────────────────────
exports.createDailyArea = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  const { lat, lng } = request.data ?? {};
  if (!lat || !lng) throw new HttpsError('invalid-argument', 'lat/lng required');
  return dailyAreaH.createDailyArea(uid, lat, lng);
}));

exports.claimDailyItem = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  const { itemId } = request.data ?? {};
  if (!itemId) throw new HttpsError('invalid-argument', 'itemId required');
  return dailyAreaH.claimDailyItem(uid, itemId);
}));

// ── Gold Mine ──────────────────────────────────────────────────────────────────
exports.createGoldMine = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await goldMineH.createGoldMine(uid, request.data ?? {});
}));

exports.addGoldMiners = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await goldMineH.addMiners(uid, request.data ?? {});
}));

exports.claimGoldMine = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await goldMineH.claimGoldMine(uid, request.data ?? {});
}));

exports.getMyGoldMines = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await goldMineH.getMyMines(uid);
}));

exports.getNearbyGoldMines = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await goldMineH.getNearbyMines(uid, request.data ?? {});
}));

exports.adminGetGoldMines = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await goldMineH.adminGetMines(uid);
}));

exports.adminSetGoldMineConfig = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await goldMineH.adminSetGoldMineConfig(uid, request.data ?? {});
}));

exports.processGoldMines = onSchedule(
  { schedule: 'every 5 minutes', timeoutSeconds: 300 },
  async () => { await goldMineH.processGoldMines(); }
);

// ── Harbor ────────────────────────────────────────────────────────────────────
exports.installHarbor = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await harborH.installHarbor(uid, request.data ?? {});
}));

exports.buildTradeShip = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await harborH.buildTradeShip(uid, request.data ?? {});
}));

exports.claimShipDividend = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await harborH.claimShipDividend(uid);
}));

exports.getNearbyHarbors = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await harborH.getNearbyHarbors(uid, request.data ?? {});
}));

exports.getMyShips = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await harborH.getMyShips(uid);
}));

exports.getHarborJackpot = onCall(wrapError(async (request) => {
  requireAuth(request);
  return await harborH.getHarborJackpot();
}));

exports.deleteHarbor = onCall(wrapError(async (request) => {
  const uid = requireAuth(request);
  return await harborH.deleteHarbor(uid, request.data ?? {});
}));

// Affiliate 커미션 GP 환급 (bot.py 내부 호출)
exports.starsRedeemCommission = onRequest(
  { cors: false, secrets: [telegramBotSecret], timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if ((req.headers['x-bot-token'] || '') !== telegramBotSecret.value()) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    const { uid } = req.body || {};
    if (!uid) { res.status(400).json({ error: 'uid required' }); return; }
    try {
      const result = await starsH.redeemAffiliateCommission(uid);
      logger.info('[starsRedeemCommission]', { uid, ...result });
      res.json(result);
    } catch (e) {
      logger.error('[starsRedeemCommission] error', e?.message);
      res.status(500).json({ error: e?.message });
    }
  }
);

