'use strict';
/**
 * BM → 게임 GP 충전 (마이페이지). GP·Point가 없어 게임에 못 들어가는 회원용.
 *
 * 비율: GP = BM × 100 ÷ 게임 레벨, 수수료 5% 차감
 *   - 기존 전환의 역방향과 같은 비율: GP→Point(GP×레벨÷10), Point→BM(P÷10) 를 거꾸로 하면 BM×100÷레벨.
 *   - 수수료 5%는 Point→GP 와 같고, 왕복(BM→GP→P→BM) 시 손해가 나게 해 무한 순환을 막는다.
 * 한도: 하루(베트남 시간) 누적 최대 10,000 BM, 1회 최소 10 BM. 낮은 레벨에서 사서 높은 레벨에서 되파는 차익을 제한.
 * 원장: users.pointBalanceVnd 차감, battle_players.gold 증가, transactions 'BM_TO_GP' 기록 (한 트랜잭션).
 * 멱등: 같은 요청 키는 한 번만 처리 (bm_gp_requests, 서버 전용).
 */
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

const db = admin.firestore();
const BM_TO_GP_MAX_PER_DAY = 10000;
const BM_TO_GP_MIN = 10;
const FEE_RATE = 0.05;

function quoteBmToGp(bm, level) {
  const rawGp = Math.floor((bm * 100) / Math.max(1, level));
  const gp = Math.floor(rawGp * (1 - FEE_RATE));
  return { rawGp, gp, fee: rawGp - gp };
}

async function convertBmToGp(uid, data = {}) {
  const bm = Number(data.amountBm);
  const idem = String(data.idempotencyKey || '').trim();
  if (!Number.isSafeInteger(bm) || bm < BM_TO_GP_MIN) {
    throw new HttpsError('invalid-argument', `최소 ${BM_TO_GP_MIN} BM 이상, 정수로 입력해 주세요.`);
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idem)) throw new HttpsError('invalid-argument', '요청 키가 올바르지 않습니다.');

  const vnDay = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const userRef = db.collection('users').doc(uid);
  const bpRef = db.collection('battle_players').doc(uid);
  const dailyRef = db.collection('bm_gp_daily').doc(`${uid}_${vnDay}`);
  const reqRef = db.collection('bm_gp_requests').doc(`${uid}_${idem}`);

  return db.runTransaction(async (tx) => {
    const [userSnap, bpSnap, dailySnap, reqSnap] = await Promise.all([tx.get(userRef), tx.get(bpRef), tx.get(dailyRef), tx.get(reqRef)]);
    if (reqSnap.exists) return { success: true, duplicate: true, ...(reqSnap.data().result || {}) };
    if (!userSnap.exists) throw new HttpsError('not-found', '유저 정보를 찾을 수 없습니다.');

    const userData = userSnap.data() || {};
    const bmBefore = Math.floor(Number(userData.pointBalanceVnd ?? 0));
    if (bm > bmBefore) throw new HttpsError('failed-precondition', `BM 잔액이 부족합니다. (보유 ${bmBefore.toLocaleString()} BM)`);

    const usedToday = dailySnap.exists ? Number(dailySnap.data().usedBm || 0) : 0;
    const leftToday = BM_TO_GP_MAX_PER_DAY - usedToday;
    if (bm > leftToday) {
      throw new HttpsError('resource-exhausted', `BM → GP 충전은 하루 ${BM_TO_GP_MAX_PER_DAY.toLocaleString()} BM까지입니다. 오늘 남은 한도: ${Math.max(0, leftToday).toLocaleString()} BM`);
    }

    const bp = bpSnap.exists ? (bpSnap.data() || {}) : {};
    const level = Math.max(1, Math.floor(Number(bp.gsLevel ?? 1)));
    const goldBefore = Math.floor(Number(bp.gold ?? 0));
    const { rawGp, gp, fee } = quoteBmToGp(bm, level);
    if (gp <= 0) throw new HttpsError('failed-precondition', '충전 금액이 너무 적습니다.');

    const ts = admin.firestore.FieldValue.serverTimestamp();
    tx.update(userRef, { pointBalanceVnd: admin.firestore.FieldValue.increment(-bm), lastBmToGpAt: ts });
    tx.set(bpRef, { gold: admin.firestore.FieldValue.increment(gp) }, { merge: true });
    tx.set(dailyRef, { uid, day: vnDay, usedBm: usedToday + bm, updatedAt: ts }, { merge: true });
    const txRef = db.collection('transactions').doc();
    tx.set(txRef, {
      uid,
      type: 'BM_TO_GP',
      currency: 'VND',
      amountVnd: bm,
      bmBefore,
      bmAfter: bmBefore - bm,
      rawGp,
      gp,
      feeGp: fee,
      level,
      goldBefore,
      goldAfter: goldBefore + gp,
      idempotencyKey: idem,
      createdAt: ts,
    });
    const result = { usedBm: bm, gp, feeGp: fee, level, bmAfter: bmBefore - bm, leftTodayBm: leftToday - bm, transactionId: txRef.id };
    tx.set(reqRef, { uid, createdAt: ts, result });
    return { success: true, duplicate: false, ...result };
  });
}

module.exports = { convertBmToGp, quoteBmToGp, BM_TO_GP_MAX_PER_DAY, BM_TO_GP_MIN };
