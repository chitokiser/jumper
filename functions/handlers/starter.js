'use strict';

// starter.js — 초보자 체험 패키지
// 클라이언트가 로컬에서 생성 → 획득 결과만 서버 저장
// getStarterPack 제거: 시드·클레임 추적이 클라이언트 로컬로 이전됨

const admin = require('firebase-admin');
const db    = admin.firestore();

const CLAIM_LIMIT = 30; // uid당 최대 보관 문서 수 (과부하 방지)

/**
 * 아이템 획득 기록 + 보상 지급
 * - starterClaims/{uid}_{itemId} 문서로 중복 방지 (1 read)
 * - gold → battle_players.gold 증가
 * - box  → users/{uid}/boxInventory 추가
 */
async function recordStarterClaim(uid, { itemId, type, drop }) {
  if (!itemId || !type) throw new Error('itemId / type 필요');

  const claimId = `${uid}_${itemId}`;
  const ref     = db.collection('starterClaims').doc(claimId);

  // 중복 방지: 단일 문서 읽기 1회
  const existing = await ref.get();
  if (existing.exists) return { ok: true, already: true };

  const batch = db.batch();
  batch.set(ref, {
    uid,
    itemId,
    type,
    drop,
    claimedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (drop?.kind === 'gold' && drop.amount > 0) {
    const bpRef = db.collection('battle_players').doc(uid);
    batch.set(bpRef, { gold: admin.firestore.FieldValue.increment(drop.amount) }, { merge: true });
  }

  if (drop?.kind === 'box' && drop.boxId) {
    const invRef = db.collection('users').doc(uid)
      .collection('boxInventory').doc();
    batch.set(invRef, {
      boxId:      String(drop.boxId),
      boxName:    `스타터 보물박스 ${drop.boxId}`,
      starterBox: true,
      acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { ok: true, drop };
}

module.exports = { recordStarterClaim };
