// functions/handlers/starter.js
// 초보자 체험 패키지 — seed만 DB 저장, 좌표는 클라이언트 생성
'use strict';

const admin = require('firebase-admin');
const db    = admin.firestore();

const RESET_MS    = 24 * 60 * 60 * 1000; // 24시간
const CLAIM_LIMIT = 30;                   // uid당 최대 claim 문서 수

function _randomSeed() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

// ── 1. 스타터팩 조회 / 생성 / 리셋 ──────────────────────────────────────────
async function getStarterPack(uid) {
  const ref  = db.collection('starterPacks').doc(uid);
  const snap = await ref.get();
  const now  = Date.now();

  let seed, resetAt;

  if (!snap.exists) {
    // 최초 생성
    seed    = _randomSeed();
    resetAt = admin.firestore.Timestamp.fromMillis(now + RESET_MS);
    await ref.set({ uid, starterSeed: seed, starterResetAt: resetAt });
  } else {
    const data = snap.data();
    const resetMs = (data.starterResetAt?.toMillis?.() ?? 0);
    if (now >= resetMs) {
      // 24시간 경과 → 리셋
      seed    = _randomSeed();
      resetAt = admin.firestore.Timestamp.fromMillis(now + RESET_MS);
      await ref.update({ starterSeed: seed, starterResetAt: resetAt });
      // 기존 claim 삭제
      const claims = await db.collection('starterClaims')
        .where('uid', '==', uid).limit(CLAIM_LIMIT).get();
      const batch = db.batch();
      claims.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } else {
      seed    = data.starterSeed;
      resetAt = data.starterResetAt;
    }
  }

  // 이미 획득한 아이템 목록
  const claimsSnap = await db.collection('starterClaims')
    .where('uid', '==', uid).limit(CLAIM_LIMIT).get();
  const claimed = claimsSnap.docs.map(d => d.data().itemId);

  return {
    starterSeed:   seed,
    starterResetAt: (resetAt?.toMillis?.() ?? 0),
    claimedIds:    claimed,
  };
}

// ── 2. 아이템 획득 기록 + 보상 지급 ─────────────────────────────────────────
async function recordStarterClaim(uid, { itemId, type, drop }) {
  if (!itemId || !type) throw new Error('itemId / type 필요');

  const claimId = `${uid}_${itemId}`;
  const ref     = db.collection('starterClaims').doc(claimId);

  // 중복 방지 (이미 획득한 경우 오류 없이 무시)
  const existing = await ref.get();
  if (existing.exists) return { ok: true, already: true };

  const batch = db.batch();
  batch.set(ref, {
    uid,
    itemId,
    type,         // 'treasure' | 'monster'
    drop,         // { kind: 'gold', amount: 3 } | { kind: 'box', boxId: 2 }
    claimedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 보상: gold → battle_players 문서 gold 필드 증가
  if (drop?.kind === 'gold' && drop.amount > 0) {
    const bpRef = db.collection('battle_players').doc(uid);
    batch.set(bpRef, { gold: admin.firestore.FieldValue.increment(drop.amount) }, { merge: true });
  }

  // 보상: box → boxInventory 서브컬렉션 추가 (treasure_boxes 획득과 동일 형식)
  if (drop?.kind === 'box' && drop.boxId) {
    const invRef = db.collection('users').doc(uid)
      .collection('boxInventory').doc();
    batch.set(invRef, {
      boxId:     String(drop.boxId),
      boxName:   `스타터 보물박스 ${drop.boxId}`,
      starterBox: true,
      acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { ok: true, drop };
}

module.exports = { getStarterPack, recordStarterClaim };
