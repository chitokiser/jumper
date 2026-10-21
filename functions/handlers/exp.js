'use strict';
/**
 * functions/handlers/exp.js
 *
 * EXP 부여 & 자동 레벨업 유틸
 *
 * 규칙 (2026-10-21 게임 경험치로 통일 — docs/adr/0001):
 *   - 데이터 저장: battle_players/{uid}.gsExp (누적) / gsLevel / level  ← 게임 서버·게임 화면과 같은 칸
 *   - 다음 레벨 필요 누적 EXP = (현재레벨+1)² × 10,000  (게임 서버 expService 와 같음)
 *       Lv.2: 40,000  /  Lv.3: 90,000  /  Lv.4: 160,000 …
 *   - 레벨은 내려가지 않음 (기존 gsLevel·level 중 큰 값 유지)
 *
 * EXP 획득 기준:
 *   - BM 결제: 100,000 VND / 1,000 = 100 EXP
 *   - BT 수령: BT 1개당 100 EXP
 *   - 추천인으로 가입: 1,000 EXP (추천인에게)
 */

const admin = require('firebase-admin');
const db = admin.firestore();

const LEVEL_CAP = 99;

/** 다음 레벨에 필요한 누적 EXP (게임 서버와 같음) */
function calcNextLevelExp(level) {
    return Math.pow(level + 1, 2) * 10000;
}

/** 누적 EXP → 레벨 */
function levelFromExp(exp) {
    let lv = 1;
    while (lv < LEVEL_CAP && exp >= calcNextLevelExp(lv)) lv++;
    return lv;
}

/** 예전 이름 유지 (다른 코드 호환): 현재 레벨에서 다음 레벨까지 필요한 누적 EXP */
function expRequiredForLevelUp(level) {
    return calcNextLevelExp(level);
}

function _apply(tx, uid, bpData, amount, reason) {
    const bpRef = db.collection('battle_players').doc(uid);
    const prevExp = Number(bpData.gsExp || 0);
    const prevLevel = Math.max(1, Number(bpData.gsLevel || 1), Number(bpData.level || 1));
    const newExp = prevExp + amount;
    const newLevel = Math.max(prevLevel, levelFromExp(newExp));

    tx.set(bpRef, {
        gsExp: admin.firestore.FieldValue.increment(amount),
        gsLevel: newLevel,
        level: newLevel,
    }, { merge: true });

    tx.set(db.collection('exp_logs').doc(), {
        uid,
        reason,
        amount,
        prevExp,
        newExp,
        prevLevel,
        newLevel,
        leveledUp: newLevel > prevLevel,
        target: 'battle_players',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { prevLevel, newLevel, prevExp, newExp, leveledUp: newLevel > prevLevel };
}

/**
 * EXP 부여 + 자동 레벨업 처리 (독립 트랜잭션)
 * @param {string} uid    - Firebase Auth UID
 * @param {number} amount - 부여할 EXP
 * @param {string} reason - 로그용 사유 ('payment' | 'bt' | 'referral' | 기타)
 */
async function grantExp(uid, amount, reason = '') {
    if (!uid || amount <= 0) return null;
    const bpRef = db.collection('battle_players').doc(uid);
    return await db.runTransaction(async (tx) => {
        const snap = await tx.get(bpRef);
        return _apply(tx, uid, snap.exists ? snap.data() : {}, amount, reason);
    });
}

/**
 * EXP 부여 (호출자의 트랜잭션 안에서 사용)
 * 주의: 호출자가 battle_players/{uid} 를 미리 읽어 bpData 로 넘겨야 한다 (트랜잭션은 읽기 → 쓰기 순서).
 * @param {FirebaseFirestore.Transaction} tx
 * @param {FirebaseFirestore.DocumentReference} userRef - users/{uid} (uid 확인용)
 * @param {FirebaseFirestore.DocumentData} bpData - battle_players/{uid} 데이터
 */
function grantExpInTx(tx, userRef, bpData, amount, reason = '') {
    if (amount <= 0) return null;
    return _apply(tx, userRef.id, bpData || {}, amount, reason);
}

module.exports = { grantExp, grantExpInTx, expRequiredForLevelUp, calcNextLevelExp, levelFromExp };
