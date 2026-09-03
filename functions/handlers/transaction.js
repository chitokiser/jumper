const crypto = require('crypto');
// functions/handlers/transaction.js
// 수탁 지갑 서명 트랜잭션: 구매(buy) / 인출(withdraw) / 관리자 Point 사전 approve

'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { ethers } = require('ethers');
const { decrypt } = require('../wallet/crypto');
const {
  getProvider,
  getPlatformContract,
  getHexContract,
  walletFromKey,
  getAdminWallet,
  estimateGasWithBuffer,
  ADDRESSES,
} = require('../wallet/chain');
const { requireAdmin } = require('../wallet/admin');

const db = admin.firestore();

// ────────────────────────────────────────────────
// 구매 (buy)
// ────────────────────────────────────────────────

/**
 * buyProduct
 * 유저의 수탁 지갑이 msg.sender로 jumpPlatform.buy(productId) 서명 + 전송
 * - pointWei 자동 차감 (컨트랙트 내부 처리)
 * - 판매자/멘토 payableWei 자동 적립 (컨트랙트 내부 처리)
 *
 * @param {string} uid          - Firebase Auth UID
 * @param {number} productId    - 상품 ID
 * @param {string} masterSecret - WALLET_MASTER_SECRET
 * @returns {{ txHash, productId }}
 */
async function buyProduct(uid, productId, masterSecret) {
  // 수탁 지갑 조회
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) {
    throw new Error('수탁 지갑이 없습니다');
  }

  // private key 복호화
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider = getProvider();
  const signer = walletFromKey(privateKey, provider);
  const platform = getPlatformContract(signer);

  // 온체인 상품 정보 확인
  const [exists, , priceWei, , isActive] = await platform.getProduct(productId);
  if (!exists) throw new Error(`상품 ID ${productId}가 존재하지 않습니다`);
  if (!isActive) throw new Error(`상품 ID ${productId}가 비활성 상태입니다`);

  // 포인트 잔액 확인
  const [, , pointWei] = await platform.getMember(walletData.address);
  if (pointWei < priceWei) {
    throw new Error(
      `포인트 부족. 보유: ${ethers.formatEther(pointWei)} Point, 필요: ${ethers.formatEther(priceWei)} Point`
    );
  }

  // 가스 추정 + 여유
  const gasLimit = await estimateGasWithBuffer(platform, 'buy', [productId]);
  const tx = await platform.buy(productId, { gasLimit });
  const receipt = await tx.wait();

  // 거래 로그 기록
  await db.collection('transactions').add({
    uid,
    userAddress: walletData.address,
    type: 'buy',
    productId,
    priceWei: priceWei.toString(),
    txHash: receipt.hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { txHash: receipt.hash, productId };
}

// ────────────────────────────────────────────────
// 인출 (withdraw) – payableWei → Point를 자신의 지갑으로
// ────────────────────────────────────────────────

/**
 * withdrawPayable
 * 수탁 지갑 또는 개인 지갑으로 payableWei 인출
 *
 * ⚠️  수탁 지갑 인출: 서버가 대신 서명 (편리하지만 서버 리스크)
 *     개인 지갑 인출: 개인 지갑에서 직접 withdraw() 호출 권장
 *
 * @param {string} uid          - Firebase Auth UID
 * @param {string} amountWeiStr - 인출할 금액 (wei 단위 문자열, "all"이면 전액)
 * @param {string} masterSecret - WALLET_MASTER_SECRET
 * @returns {{ txHash, amountDisplay }}
 */
async function withdrawPayable(uid, amountWeiStr, masterSecret) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider = getProvider();
  const signer = walletFromKey(privateKey, provider);
  const platform = getPlatformContract(signer);

  // payableWei 조회
  const [, , , payableWei] = await platform.getMember(walletData.address);

  let amountWei;
  if (amountWeiStr === 'all') {
    amountWei = payableWei;
  } else {
    amountWei = BigInt(amountWeiStr);
  }

  if (amountWei <= 0n) throw new Error('인출 금액이 0입니다');
  if (amountWei > payableWei) {
    throw new Error(
      `인출 가능 금액 초과. 가능: ${ethers.formatEther(payableWei)} Point`
    );
  }

  const gasLimit = await estimateGasWithBuffer(platform, 'withdraw', [amountWei]);
  const tx = await platform.withdraw(amountWei, { gasLimit });
  const receipt = await tx.wait();

  await db.collection('transactions').add({
    uid,
    userAddress: walletData.address,
    type: 'withdraw',
    amountWei: amountWei.toString(),
    txHash: receipt.hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    txHash: receipt.hash,
    amountDisplay: parseFloat(ethers.formatEther(amountWei)).toFixed(4) + ' Point',
  };
}

// ────────────────────────────────────────────────
// 관리자: Point.approve() 사전 실행 (1회)
// ────────────────────────────────────────────────

/**
 * adminApproveHex
 * 관리자 지갑 → jumpPlatform 컨트랙트에 Point 지출 권한 부여
 * creditPoints() 호출 전에 반드시 1회 실행 필요
 * 권장: uint256 최대값으로 approve (무한 승인)
 *
 * @param {string} adminUid
 * @param {string|null} amountWeiStr null이면 MaxUint256
 * @returns {{ txHash, allowanceDisplay }}
 */
async function adminApproveHex(adminUid, amountWeiStr = null) {
  await requireAdmin(adminUid);

  const adminWallet = getAdminWallet();
  const hexContract = getHexContract(adminWallet);

  const amount = amountWeiStr ? BigInt(amountWeiStr) : ethers.MaxUint256;
  const tx = await hexContract.approve(ADDRESSES.jumpPlatform, amount);
  const receipt = await tx.wait();

  const allowanceDisplay = amount === ethers.MaxUint256
    ? '무한 (MaxUint256)'
    : parseFloat(ethers.formatEther(amount)).toFixed(4) + ' Point';

  return { txHash: receipt.hash, allowanceDisplay };
}

/**
 * adminCheckAllowance
 * 관리자 Point allowance 현재값 조회
 * @returns {{ allowanceWei, allowanceDisplay }}
 */
async function adminCheckAllowance() {
  const adminWallet = getAdminWallet();
  const hexContract = getHexContract(getProvider());

  const allowance = await hexContract.allowance(
    adminWallet.address,
    ADDRESSES.jumpPlatform
  );

  return {
    allowanceWei: allowance.toString(),
    allowanceDisplay: parseFloat(ethers.formatEther(allowance)).toFixed(4) + ' Point',
    isMaxUint: allowance === ethers.MaxUint256,
  };
}

/**
 * adminGetContractStatus
 * jumpPlatform 컨트랙트 + 관리자 지갑 현황 종합 조회
 * - contractHexBalance : 컨트랙트가 보유한 Point (사용자 pointWei + payableWei 합산)
 * - ownerHexAllowance  : 관리자→컨트랙트 Point 지출 한도
 * - adminHexBalance    : 관리자 지갑 Point 잔액 (충전 재원)
 * - adminBnbBalance    : 관리자 지갑 BNB 잔액 (가스비)
 */
async function adminGetContractStatus() {
  const provider = getProvider();
  const adminWallet = getAdminWallet();
  const hexContract = getHexContract(provider);
  const platform = getPlatformContract(provider);
  const { fetchExchangeRates } = require('../wallet/exchange');

  const [
    contractHexBal,
    ownerAllowance,
    adminHexBal,
    adminBnbBal,
    rates,
  ] = await Promise.all([
    hexContract.balanceOf(ADDRESSES.jumpPlatform),
    hexContract.allowance(adminWallet.address, ADDRESSES.jumpPlatform),
    hexContract.balanceOf(adminWallet.address),
    provider.getBalance(adminWallet.address),
    fetchExchangeRates().catch(() => null),
  ]);

  const krwPerUsd = rates?.krwPerUsd ?? null;
  const hexToKrw = (wei) => {
    if (!krwPerUsd) return null;
    return Math.round(parseFloat(ethers.formatEther(wei)) * krwPerUsd);
  };

  return {
    adminAddress: adminWallet.address,
    contractAddress: ADDRESSES.jumpPlatform,

    // 컨트랙트 Point 잔액
    contractHexWei: contractHexBal.toString(),
    contractHexDisplay: parseFloat(ethers.formatEther(contractHexBal)).toFixed(4) + ' Point',
    contractHexKrw: hexToKrw(contractHexBal),

    // 관리자 Point 잔액
    adminHexWei: adminHexBal.toString(),
    adminHexDisplay: parseFloat(ethers.formatEther(adminHexBal)).toFixed(4) + ' Point',
    adminHexKrw: hexToKrw(adminHexBal),

    // 관리자 BNB 잔액 (가스비)
    adminBnbDisplay: parseFloat(ethers.formatEther(adminBnbBal)).toFixed(6) + ' BNB',

    // Point Allowance
    ownerHexAllowanceWei: ownerAllowance.toString(),
    ownerHexAllowanceDisplay: ownerAllowance === ethers.MaxUint256
      ? '∞ MaxUint256'
      : parseFloat(ethers.formatEther(ownerAllowance)).toFixed(4) + ' Point',
    isMaxUint: ownerAllowance === ethers.MaxUint256,

    // 환율
    krwPerUsd,
    rateSource: rates?.source ?? 'N/A',
  };
}

/**
 * adminRecordP2pTransfer
 * 외부 지갑 → 수탁 지갑으로 직접 전송된 Point를 거래 내역에 기록
 * 1. txHash로 온체인 Transfer 이벤트 파싱
 * 2. 수신 지갑 주소 → Firestore에서 uid 조회
 * 3. transactions 컬렉션에 type:'p2p'로 저장
 *
 * @param {string} adminUid
 * @param {string} txHash   - Point Transfer 트랜잭션 해시
 * @returns {{ uid, from, to, amountHex, amountKrw, txHash }}
 */
async function adminRecordP2pTransfer(adminUid, txHash) {
  await requireAdmin(adminUid);

  const provider = getProvider();

  // 트랜잭션 영수증 조회
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error('트랜잭션을 찾을 수 없습니다: ' + txHash);

  // Transfer 이벤트 파싱
  const hexAddr = ADDRESSES.jumpToken.toLowerCase();
  const transferIface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);
  const transferTopic = transferIface.getEvent('Transfer').topicHash;

  const transferLog = receipt.logs.find(
    (log) => log.address.toLowerCase() === hexAddr && log.topics[0] === transferTopic
  );
  if (!transferLog) throw new Error('이 트랜잭션에서 Point Transfer 이벤트를 찾을 수 없습니다');

  const parsed = transferIface.parseLog(transferLog);
  const from = parsed.args.from;
  const to = parsed.args.to;
  const value = parsed.args.value;

  // 수신 주소 → uid 조회
  const usersSnap = await db.collection('users')
    .where('wallet.address', '==', to)
    .limit(1)
    .get();
  if (usersSnap.empty) throw new Error('수탁 지갑 소유자를 찾을 수 없습니다: ' + to);
  const uid = usersSnap.docs[0].id;

  // 중복 기록 방지
  const dupSnap = await db.collection('transactions')
    .where('txHash', '==', txHash)
    .limit(1)
    .get();
  if (!dupSnap.empty) throw new Error('이미 기록된 트랜잭션입니다');

  // 환율 조회 (표시용)
  const { fetchExchangeRates } = require('../wallet/exchange');
  const rates = await fetchExchangeRates().catch(() => null);
  const krwPerUsd = rates?.krwPerUsd ?? null;
  const hexAmount = parseFloat(ethers.formatEther(value));
  const amountKrw = krwPerUsd ? Math.round(hexAmount * krwPerUsd) : null;
  const amountUsd = Math.round(hexAmount * 100) / 100;
  const amountVnd = (rates?.vndPerUsd && krwPerUsd)
    ? Math.round(hexAmount * rates.vndPerUsd)
    : null;

  await db.collection('transactions').add({
    uid,
    userAddress: to,
    fromAddress: from,
    type: 'p2p',
    amountWei: value.toString(),
    amountHex: hexAmount.toFixed(4),
    amountKrw,
    amountUsd,
    amountVnd,
    txHash,
    recordedBy: adminUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, uid, from, to, amountHex: hexAmount.toFixed(4), amountKrw, txHash };
}

/**
 * mergeWalletHexToPoints
 * 수탁 지갑의 실제 Point 잔액(P2P 수령분)을 컨트랙트 pointWei로 합산
 *
 * 흐름:
 *   1) 수탁 지갑 → 관리자 지갑으로 Point 전송  (walletHex → adminWallet)
 *   2) 관리자 지갑 → jumpPlatform.creditPoints()  (adminWallet → contract)
 *   3) user.pointWei 증가 (컨트랙트 내부)
 *
 * @param {string} uid          - Firebase Auth UID
 * @param {string} masterSecret - WALLET_MASTER_SECRET
 * @returns {{ txHash, amountHex, amountKrw }}
 */
async function mergeWalletHexToPoints(uid, masterSecret) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const adminWallet = getAdminWallet();
  const hexContract = getHexContract(provider);

  // 수탁 지갑 Point 잔액 확인
  const walletHexBal = await hexContract.balanceOf(walletData.address);
  if (walletHexBal === 0n) throw new Error('합산할 Point 잔액이 없습니다');

  // BNB 가스비 부족 시 보충
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({
      to: walletData.address, value: ethers.parseEther('0.0001'),
    });
    await fundTx.wait();
  }

  // 1) 수탁 지갑 → 관리자 지갑으로 Point 이동
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const userSigner = walletFromKey(privateKey, provider);
  const hexWithUser = getHexContract(userSigner);
  const transferTx = await hexWithUser.transfer(adminWallet.address, walletHexBal);
  await transferTx.wait();

  // 환율 조회
  const { fetchExchangeRates } = require('../wallet/exchange');
  const rates = await fetchExchangeRates().catch(() => null);
  const krwPerUsd = rates?.krwPerUsd ?? 1370;
  const hexAmount = parseFloat(ethers.formatEther(walletHexBal));
  const amountKrw = Math.round(hexAmount * krwPerUsd);

  // 2) adminCreditHex (관리자 지갑 → 컨트랙트, user.points 증가)
  const refStr = `P2P-MERGE-${uid.slice(0, 8).toUpperCase()}-${Date.now()}`;
  const refBytes = ethers.id(refStr);
  const platform = getPlatformContract(adminWallet);
  const gasLimit = await estimateGasWithBuffer(platform, 'adminCreditHex', [
    walletData.address, walletHexBal, refBytes,
  ]);
  const creditTx = await platform.adminCreditHex(
    walletData.address, walletHexBal, refBytes, { gasLimit }
  );
  const receipt = await creditTx.wait();

  // 3) Firestore 기록
  await db.collection('transactions').add({
    uid,
    userAddress: walletData.address,
    type: 'p2p_merge',
    amountWei: walletHexBal.toString(),
    amountHex: hexAmount.toFixed(4),
    amountKrw,
    txHash: receipt.hash,
    refCode: refStr,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, txHash: receipt.hash, amountHex: hexAmount.toFixed(4), amountKrw };
}

// ────────────────────────────────────────────────
// 레벨업 요청 (수탁 지갑 서명)
// ────────────────────────────────────────────────

/**
 * requestLevelUp
 * 유저의 수탁 지갑으로 jumpPlatform.requestLevelUp() 서명 + 전송
 * 조건: exp >= level² × 10000
 *
 * @param {string} uid          - Firebase Auth UID
 * @param {string} masterSecret - WALLET_MASTER_SECRET
 * @returns {{ txHash, newLevel }}
 */
async function requestLevelUp(uid, masterSecret) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider = getProvider();
  const signer = walletFromKey(privateKey, provider);
  const platform = getPlatformContract(signer);

  // 현재 레벨 확인 (members 매핑: level, mentor, exp, points, blocked)
  const [level, , exp] = await platform.members(walletData.address);
  const requiredExp = BigInt(level) * BigInt(level) * 10000n;
  if (exp < requiredExp) {
    throw new Error(
      `EXP 부족. 필요: ${requiredExp.toString()}, 현재: ${exp.toString()}`
    );
  }

  const gasLimit = await estimateGasWithBuffer(platform, 'requestLevelUp', []);
  const tx = await platform.requestLevelUp({ gasLimit });
  const receipt = await tx.wait();

  return { txHash: receipt.hash, newLevel: Number(level) + 1 };
}

// ────────────────────────────────────────────────
// 가맹점(판매회원) 온체인 등록
// ────────────────────────────────────────────────

/**
 * registerMerchantOnChain
 * 유저의 수탁 지갑으로 jumpPlatform.registerMerchant(metadataURI) 서명 + 전송
 * - onlyMember: 온체인 회원(level > 0) 이어야 함
 * - 초기 feeBps = 0 → 관리자가 이후 adminUpdateMerchantFee(id, 1000) 으로 10% 설정
 *
 * @param {string} uid           - Firebase Auth UID
 * @param {string} metadataURI   - 온체인 메타데이터 URI (compact JSON 등)
 * @param {object} merchantData  - Firestore에 저장할 판매자 정보
 * @param {string} masterSecret  - WALLET_MASTER_SECRET
 * @returns {{ txHash, merchantId }}
 */
async function registerMerchantOnChain(uid, metadataURI, merchantData, masterSecret) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다. 먼저 지갑을 생성해 주세요.');

  // onlyMember 조건 사전 확인
  const provider = getProvider();
  const platform = getPlatformContract(provider);
  const [level, , , , blocked] = await platform.members(walletData.address);
  if (Number(level) === 0) throw new Error('온체인 회원 등록이 필요합니다. 마이페이지에서 먼저 온체인 등록을 완료해 주세요.');
  if (blocked) throw new Error('차단된 계정입니다. 관리자에게 문의하세요.');

  // 수탁 지갑으로 registerMerchant 호출
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer = walletFromKey(privateKey, provider);
  const platformSigner = getPlatformContract(signer);

  const gasLimit = await estimateGasWithBuffer(platformSigner, 'registerMerchant', [metadataURI]);
  const tx = await platformSigner.registerMerchant(metadataURI, { gasLimit });
  const receipt = await tx.wait();

  // MerchantRegistered 이벤트에서 merchantId 파싱
  const iface = platformSigner.interface;
  let merchantId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'MerchantRegistered') {
        merchantId = Number(parsed.args.merchantId);
        break;
      }
    } catch { /* 다른 이벤트 로그 무시 */ }
  }
  if (merchantId === null) throw new Error('merchantId 파싱 실패: MerchantRegistered 이벤트를 찾을 수 없습니다');

  // Firestore 저장 (merchants/{merchantId})
  await db.collection('merchants').doc(String(merchantId)).set({
    merchantId,
    ownerUid: uid,
    ownerAddress: walletData.address,
    ...merchantData,
    feeBps: 0,   // 관리자가 이후 1000 (10%) 으로 설정
    active: true,
    txHash: receipt.hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 유저 문서에 merchantId 기록
  await db.collection('users').doc(uid).set({
    merchantId,
    merchantRegisteredAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { txHash: receipt.hash, merchantId };
}

// ────────────────────────────────────────────────
// 관리자: 가맹점 수수료 설정 (onchain adminUpdateMerchantFee)
// ────────────────────────────────────────────────

/**
 * adminSetMerchantFeeOnChain
 * 관리자 지갑으로 jumpPlatform.adminUpdateMerchantFee(merchantId, feeBps) 호출
 * feeBps=1000 → 10%, feeBps=0 → 0%
 *
 * @param {number} merchantId
 * @param {number} feeBps  - 0~10000 (basis points)
 * @returns {{ txHash, merchantId, feeBps }}
 */
async function adminSetMerchantFeeOnChain(merchantId, feeBps) {
  const db = admin.firestore();
  
  await db.collection('merchants').doc(String(merchantId)).set({
    feeBps: Number(feeBps),
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    active: true
  }, { merge: true });

  return { txHash: 'FIREBASE_NATIVE', merchantId, feeBps };
});

module.exports = {
  exchangePointsToFiat,
  buyProduct,
  withdrawPayable,
  requestLevelUp,
  registerMerchantOnChain,
  adminSetMerchantFeeOnChain,
  adminApproveHex,
  adminCheckAllowance,
  adminGetContractStatus,
  adminRecordP2pTransfer,
  mergeWalletHexToPoints,
  payMerchantFirebase,
  adminOwnerDepositHex,
  payProductWithHex,
  adminBulkChangeMentor,
  adminSetUserLevel,
  transferHexToPersonal,
  redeemPoints,
};
