// functions/handlers/zalopay.js
// ZaloPay 포인트 시스템 핸들러
// 흐름: 유저 HEX→Zalo포인트 즉시 전환(2% 수수료) → 유저 포인트 사용 → 관리자 정산
//
// zaloBalance: users/{uid}.zaloBalance (VND 정수)
// zalo_transactions: 입출금 내역
// zalo_usage:        포인트 사용 요청

'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');
const {
  getProvider,
  getPlatformContract,
  getHexContract,
  getAdminWallet,
  walletFromKey,
  estimateGasWithBuffer,
} = require('../wallet/chain');
const { decrypt } = require('../wallet/crypto');

const db = admin.firestore();

const FEE_BPS = 200; // 수수료 2%

// ── VND 환율 조회 (온체인 우선, fallback: 외부 API) ──────────────────────────
async function getVndPerHex() {
  try {
    const provider  = getProvider();
    const platform  = getPlatformContract(provider);
    const [vndScaled, fxScale] = await Promise.all([
      platform.fxVndPerHexScaled(),
      platform.fxScale(),
    ]);
    const rate = Number(vndScaled) / Number(fxScale);
    if (rate > 0) return rate;
  } catch (_) {}

  // fallback: 1 HEX ≈ 1 USD
  const r = await fetch('https://open.er-api.com/v6/latest/USD');
  const d = await r.json();
  if (d.result === 'success' && d.rates?.VND > 0) return d.rates.VND;

  throw new HttpsError('unavailable', 'VND 환율을 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.');
}

// ── 유저: HEX → Zalo포인트 즉시 전환 ────────────────────────────────────────
// 수수료 2% 차감 → 온체인 HEX 이체 → VND 포인트 즉시 적립
async function requestZaloConvert(uid, { hexAmount, note } = {}, masterSecret) {
  if (!hexAmount || Number(hexAmount) <= 0)
    throw new HttpsError('invalid-argument', 'hexAmount는 0보다 커야 합니다');
  if (!masterSecret)
    throw new HttpsError('internal', 'WALLET_MASTER_SECRET이 설정되지 않았습니다');

  const userSnap   = await db.collection('users').doc(uid).get();
  const u          = userSnap.data() || {};
  const walletData = u.wallet;

  if (!walletData?.address || !walletData?.encryptedKey)
    throw new HttpsError('failed-precondition', '수탁 지갑이 없습니다. 먼저 지갑을 생성해 주세요.');

  // ── 잔액 확인 ──────────────────────────────────────────────────────────────
  const provider = getProvider();
  const hexRead  = getHexContract(provider);
  const hexBal   = await hexRead.balanceOf(walletData.address);
  const reqWei   = ethers.parseEther(String(hexAmount));

  if (hexBal < reqWei) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    throw new HttpsError(
      'failed-precondition',
      `HEX 잔액 부족. 보유: ${have} HEX, 신청: ${hexAmount} HEX`
    );
  }

  // ── 수수료 계산 (2%) ───────────────────────────────────────────────────────
  const hexAmtNum = Number(hexAmount);
  const feeHex    = Math.round(hexAmtNum * FEE_BPS) / 10000;
  const netHex    = hexAmtNum - feeHex;

  // ── VND 환산 ───────────────────────────────────────────────────────────────
  const vndPerHex = await getVndPerHex();
  const vndAmount = Math.floor(netHex * vndPerHex);

  // ── 온체인 HEX 이체: 유저 수탁 지갑 → 관리자 지갑 ───────────────────────
  const adminWallet = getAdminWallet();

  // BNB 가스비 부족 시 소액 보충
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({
      to: walletData.address, value: ethers.parseEther('0.0001'),
    });
    await fundTx.wait();
  }

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const hexSigned  = getHexContract(signer);
  const gasLimit   = await estimateGasWithBuffer(hexSigned, 'transfer', [adminWallet.address, reqWei]);
  const tx         = await hexSigned.transfer(adminWallet.address, reqWei, { gasLimit });
  const receipt    = await tx.wait();
  const txHash     = receipt.hash;

  // ── Firestore 업데이트 ─────────────────────────────────────────────────────
  await db.runTransaction(async (t) => {
    const userRef   = db.collection('users').doc(uid);
    const userSnap2 = await t.get(userRef);
    const current   = userSnap2.data()?.zaloBalance || 0;

    // 1) Zalo 포인트 즉시 적립
    t.update(userRef, { zaloBalance: current + vndAmount });

    // 2) 전환 기록
    t.set(db.collection('zalo_transactions').doc(), {
      uid,
      displayName:  u.displayName || u.name || '',
      email:        u.email || '',
      type:         'convert_in',
      hexAmount:    hexAmtNum,
      feeHex,
      netHex,
      vndAmount,
      vndPerHex:    Math.round(vndPerHex),
      walletAddress: walletData.address,
      txHash,
      note:         note || '',
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, vndAmount, feeHex, netHex, txHash };
}

// ── 유저: Zalo포인트 사용 신청 ───────────────────────────────────────────────
// 즉시 잔액 차감 → 관리자가 실제 ZaloPay 지급 후 settled 처리
async function useZaloBalance(uid, { vndAmount, purpose, recipientInfo } = {}) {
  if (!vndAmount || Number(vndAmount) <= 0)
    throw new HttpsError('invalid-argument', 'vndAmount는 0보다 커야 합니다');
  if (!purpose)
    throw new HttpsError('invalid-argument', '사용 목적을 입력해 주세요');

  const userRef = db.collection('users').doc(uid);

  return await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const u        = userSnap.data() || {};
    const current  = u.zaloBalance || 0;
    const vnd      = Math.round(Number(vndAmount));

    if (current < vnd)
      throw new HttpsError(
        'failed-precondition',
        `잔액 부족. 보유: ${current.toLocaleString()}동, 필요: ${vnd.toLocaleString()}동`
      );

    const usageRef = db.collection('zalo_usage').doc();

    tx.update(userRef, { zaloBalance: current - vnd });

    tx.set(usageRef, {
      uid,
      displayName:   u.displayName || u.name || '',
      email:         u.email || '',
      vndAmount:     vnd,
      purpose:       purpose || '',
      recipientInfo: recipientInfo || '',
      status:        'pending',
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(db.collection('zalo_transactions').doc(), {
      uid,
      type:      'use',
      vndAmount: vnd,
      purpose:   purpose || '',
      usageId:   usageRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, usageId: usageRef.id, remainingBalance: current - vnd };
  });
}

// ── 관리자: 사용 내역 정산 완료 처리 ────────────────────────────────────────
async function settleZaloUsage(adminUid, { usageId } = {}) {
  await requireAdmin(adminUid);
  if (!usageId) throw new HttpsError('invalid-argument', 'usageId가 필요합니다');

  const ref  = db.collection('zalo_usage').doc(usageId);
  const snap = await ref.get();
  if (!snap.exists)                     throw new HttpsError('not-found', '사용 내역을 찾을 수 없습니다');
  if (snap.data().status === 'settled') throw new HttpsError('failed-precondition', '이미 정산된 내역입니다');

  await ref.update({
    status:    'settled',
    settledAt: admin.firestore.FieldValue.serverTimestamp(),
    settledBy: adminUid,
  });

  return { ok: true };
}

module.exports = {
  requestZaloConvert,
  useZaloBalance,
  settleZaloUsage,
};
