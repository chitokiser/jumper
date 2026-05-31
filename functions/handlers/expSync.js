'use strict';
// handlers/expSync.js
// 게임 경험치 → 온체인 레벨 배치 동기화
//
// 설계 원칙: "가스 최대 절약"
//   - XP 획득마다 온체인 저장 ❌
//   - 레벨업 시 Firestore에 pendingOnChainLevel 플래그만 기록
//   - 스케줄러(6시간)가 배치로 adminSetLevel() 1회 호출 (레벨 연속 상승도 1tx)
//   - 수동 동기화: 24시간 1회 허용

const admin  = require('firebase-admin');
const { logger } = require('firebase-functions');
const {
  getPlatformContract,
  getAdminWallet,
  estimateGasWithBuffer,
} = require('../wallet/chain');

const db = admin.firestore();
const MAX_BATCH = 20;                          // 스케줄러 1회 최대 처리 유저 수
const MANUAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 수동 동기화 24시간 쿨다운

// ── 단일 유저 온체인 레벨 저장 (admin wallet → adminSetLevel) ──────────────────
async function _syncUserLevel(uid, pendingLevel) {
  // 1. 지갑 주소 조회
  const userSnap = await db.collection('users').doc(uid).get();
  const walletAddr = userSnap.data()?.wallet?.address;
  if (!walletAddr) throw new Error(`uid=${uid}: 지갑 주소 없음`);

  const adminWallet = getAdminWallet();
  const platform    = getPlatformContract(adminWallet);

  // 2. 현재 온체인 레벨 확인 (중복 방지)
  const [onChainLevel] = await platform.members(walletAddr);
  const currentLevel    = Number(onChainLevel);

  const bpRef = db.collection('battle_players').doc(uid);

  if (currentLevel >= pendingLevel) {
    // 이미 온체인이 같거나 높음 → Firestore 플래그만 정리
    await bpRef.update({
      pendingOnChainSync:    admin.firestore.FieldValue.delete(),
      pendingOnChainLevel:   admin.firestore.FieldValue.delete(),
      onChainLevel:          currentLevel,
      lastOnChainSyncAt:     admin.firestore.FieldValue.serverTimestamp(),
    });
    return { skipped: true, onChainLevel: currentLevel };
  }

  // 3. adminSetLevel 트랜잭션 (관리자 지갑이 가스 부담)
  const gasLimit = await estimateGasWithBuffer(platform, 'adminSetLevel', [walletAddr, pendingLevel]);
  const tx       = await platform.adminSetLevel(walletAddr, pendingLevel, { gasLimit });
  const receipt  = await tx.wait();

  // 4. Firestore 동기화 완료 기록
  await bpRef.update({
    pendingOnChainSync:      admin.firestore.FieldValue.delete(),
    pendingOnChainLevel:     admin.firestore.FieldValue.delete(),
    onChainLevel:            pendingLevel,
    lastOnChainSyncAt:       admin.firestore.FieldValue.serverTimestamp(),
    lastOnChainSyncTxHash:   receipt.hash,
  });

  logger.info('[expSync] 온체인 레벨 저장 완료', { uid, pendingLevel, txHash: receipt.hash });
  return { txHash: receipt.hash, newLevel: pendingLevel };
}

// ── 배치 스케줄러 (6시간마다 실행) ───────────────────────────────────────────
async function batchSyncPendingLevels() {
  const snap = await db.collection('battle_players')
    .where('pendingOnChainSync', '==', true)
    .limit(MAX_BATCH)
    .get();

  if (snap.empty) {
    logger.info('[expSync] 배치: 대기 유저 없음');
    return 0;
  }

  let success = 0;
  for (const docSnap of snap.docs) {
    const uid            = docSnap.id;
    const pendingLevel   = docSnap.data().pendingOnChainLevel;
    if (!pendingLevel || pendingLevel < 1) continue;

    try {
      await _syncUserLevel(uid, pendingLevel);
      success++;
    } catch (e) {
      // 실패한 유저는 다음 배치에서 재시도 (플래그 유지)
      logger.error('[expSync] 배치 실패', { uid, error: e.message });
    }
  }

  logger.info('[expSync] 배치 완료', { total: snap.size, success });
  return success;
}

// ── 수동 동기화 (유저 직접 요청, 24시간 1회) ───────────────────────────────────
async function manualSyncLevel(uid) {
  const bpRef  = db.collection('battle_players').doc(uid);
  const bpSnap = await bpRef.get();
  const bp     = bpSnap.data() || {};

  if (!bp.pendingOnChainSync || !bp.pendingOnChainLevel) {
    return { ok: true, already: true, message: '동기화할 레벨업이 없습니다' };
  }

  // 24시간 쿨다운 검사
  const lastMs = bp.lastManualSyncAt?.toMillis?.() ?? 0;
  const elapsed = Date.now() - lastMs;
  if (elapsed < MANUAL_COOLDOWN_MS) {
    const remainHr = Math.ceil((MANUAL_COOLDOWN_MS - elapsed) / 3_600_000);
    throw new Error(`수동 동기화는 24시간에 1회만 가능합니다. 약 ${remainHr}시간 후 재시도하세요.`);
  }

  // 쿨다운 갱신 후 동기화
  await bpRef.update({ lastManualSyncAt: admin.firestore.FieldValue.serverTimestamp() });
  const result = await _syncUserLevel(uid, bp.pendingOnChainLevel);
  return { ok: true, ...result };
}

module.exports = { batchSyncPendingLevels, manualSyncLevel };
