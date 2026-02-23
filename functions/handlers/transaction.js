// functions/handlers/transaction.js
// 수탁 지갑 서명 트랜잭션: 구매(buy) / 인출(withdraw) / 관리자 HEX 사전 approve

'use strict';

const admin  = require('firebase-admin');
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
  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) {
    throw new Error('수탁 지갑이 없습니다');
  }

  // private key 복호화
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider   = getProvider();
  const signer     = walletFromKey(privateKey, provider);
  const platform   = getPlatformContract(signer);

  // 온체인 상품 정보 확인
  const [exists, , priceWei, , isActive] = await platform.getProduct(productId);
  if (!exists)    throw new Error(`상품 ID ${productId}가 존재하지 않습니다`);
  if (!isActive)  throw new Error(`상품 ID ${productId}가 비활성 상태입니다`);

  // 포인트 잔액 확인
  const [, , pointWei] = await platform.getMember(walletData.address);
  if (pointWei < priceWei) {
    throw new Error(
      `포인트 부족. 보유: ${ethers.formatEther(pointWei)} HEX, 필요: ${ethers.formatEther(priceWei)} HEX`
    );
  }

  // 가스 추정 + 여유
  const gasLimit = await estimateGasWithBuffer(platform, 'buy', [productId]);
  const tx       = await platform.buy(productId, { gasLimit });
  const receipt  = await tx.wait();

  // 거래 로그 기록
  await db.collection('transactions').add({
    uid,
    userAddress: walletData.address,
    type:        'buy',
    productId,
    priceWei:    priceWei.toString(),
    txHash:      receipt.hash,
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  return { txHash: receipt.hash, productId };
}

// ────────────────────────────────────────────────
// 인출 (withdraw) – payableWei → HEX를 자신의 지갑으로
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
  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider   = getProvider();
  const signer     = walletFromKey(privateKey, provider);
  const platform   = getPlatformContract(signer);

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
      `인출 가능 금액 초과. 가능: ${ethers.formatEther(payableWei)} HEX`
    );
  }

  const gasLimit = await estimateGasWithBuffer(platform, 'withdraw', [amountWei]);
  const tx       = await platform.withdraw(amountWei, { gasLimit });
  const receipt  = await tx.wait();

  await db.collection('transactions').add({
    uid,
    userAddress: walletData.address,
    type:        'withdraw',
    amountWei:   amountWei.toString(),
    txHash:      receipt.hash,
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    txHash:        receipt.hash,
    amountDisplay: parseFloat(ethers.formatEther(amountWei)).toFixed(4) + ' HEX',
  };
}

// ────────────────────────────────────────────────
// 관리자: HEX.approve() 사전 실행 (1회)
// ────────────────────────────────────────────────

/**
 * adminApproveHex
 * 관리자 지갑 → jumpPlatform 컨트랙트에 HEX 지출 권한 부여
 * creditPoints() 호출 전에 반드시 1회 실행 필요
 * 권장: uint256 최대값으로 approve (무한 승인)
 *
 * @param {string} adminUid
 * @param {string|null} amountWeiStr null이면 MaxUint256
 * @returns {{ txHash, allowanceDisplay }}
 */
async function adminApproveHex(adminUid, amountWeiStr = null) {
  const adminSnap = await db.collection('users').doc(adminUid).get();
  if (!adminSnap.data()?.isAdmin) throw new Error('관리자 권한이 없습니다');

  const adminWallet = getAdminWallet();
  const hexContract = getHexContract(adminWallet);

  const amount = amountWeiStr ? BigInt(amountWeiStr) : ethers.MaxUint256;
  const tx     = await hexContract.approve(ADDRESSES.jumpPlatform, amount);
  const receipt= await tx.wait();

  const allowanceDisplay = amount === ethers.MaxUint256
    ? '무한 (MaxUint256)'
    : parseFloat(ethers.formatEther(amount)).toFixed(4) + ' HEX';

  return { txHash: receipt.hash, allowanceDisplay };
}

/**
 * adminCheckAllowance
 * 관리자 HEX allowance 현재값 조회
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
    allowanceWei:     allowance.toString(),
    allowanceDisplay: parseFloat(ethers.formatEther(allowance)).toFixed(4) + ' HEX',
    isMaxUint:        allowance === ethers.MaxUint256,
  };
}

module.exports = {
  buyProduct,
  withdrawPayable,
  adminApproveHex,
  adminCheckAllowance,
};
