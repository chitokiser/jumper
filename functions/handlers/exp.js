'use strict';
/**
 * functions/handlers/exp.js
 *
 * EXP 부여 & 자동 레벨업 유틸
 *
 * 규칙:
 *   - 데이터 저장: users/{uid}.gsExp / users/{uid}.gsLevel
 *   - 레벨업 필요 EXP = 현재레벨² × 10,000
 *       Lv.1→2: 10,000  /  Lv.2→3: 40,000  /  Lv.3→4: 90,000 …
 *   - 전환량 = 포인트 × gsLevel ÷ 10  (열람용, 변환 시 사용)
 *
 * EXP 획득 기준:
 *   - KM 결제: 100,000 VND / 1,000 = 100 EXP
 *   - BT 수령: BT 1개당 100 EXP
 *   - 추천인으로 가입: 1,000 EXP (추천인에게)
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 레벨업 필요 EXP 계산
 * @param {number} level - 현재 레벨
 */
function expRequiredForLevelUp(level) {
    return level * level * 10000;
}

/**
 * EXP 부여 + 자동 레벨업 처리 (Firestore 트랜잭션 미사용, 독립 호출)
 *
 * @param {string} uid    - Firebase Auth UID
 * @param {number} amount - 부여할 EXP
 * @param {string} reason - 로그용 사유 ('payment' | 'bt' | 'referral' | 기타)
 * @returns {{ prevLevel, newLevel, prevExp, newExp, leveledUp }}
 */
async function grantExp(uid, amount, reason = '') {
    if (!uid || amount <= 0) return null;

    const userRef = db.collection('users').doc(uid);

    return await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return null;

        const data = snap.data();
        const prevExp = Number(data.gsExp || 0);
        const prevLevel = Math.max(1, Number(data.gsLevel || 1));

        let newExp = prevExp + amount;
        let newLevel = prevLevel;

        // 자동 레벨업 (연속 레벨업 허용)
        while (newExp >= expRequiredForLevelUp(newLevel)) {
            newExp -= expRequiredForLevelUp(newLevel);
            newLevel += 1;
        }

        tx.set(userRef, {
            gsExp: newExp,
            gsLevel: newLevel,
        }, { merge: true });

        // EXP 이력 기록
        const logRef = db.collection('exp_logs').doc();
        tx.set(logRef, {
            uid,
            reason,
            amount,
            prevExp,
            newExp,
            prevLevel,
            newLevel,
            leveledUp: newLevel > prevLevel,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { prevLevel, newLevel, prevExp, newExp, leveledUp: newLevel > prevLevel };
    });
}

/**
 * EXP 부여 (Firestore 트랜잭션 내부에서 사용)
 * 호출자의 트랜잭션 객체(tx)를 받아 원자적으로 처리
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {FirebaseFirestore.DocumentReference} userRef
 * @param {FirebaseFirestore.DocumentData} userData
 * @param {number} amount
 * @param {string} reason
 * @returns {{ prevLevel, newLevel, prevExp, newExp, leveledUp }}
 */
function grantExpInTx(tx, userRef, userData, amount, reason = '') {
    if (amount <= 0) return null;

    const prevExp = Number(userData.gsExp || 0);
    const prevLevel = Math.max(1, Number(userData.gsLevel || 1));

    let newExp = prevExp + amount;
    let newLevel = prevLevel;

    while (newExp >= expRequiredForLevelUp(newLevel)) {
        newExp -= expRequiredForLevelUp(newLevel);
        newLevel += 1;
    }

    tx.set(userRef, { gsExp: newExp, gsLevel: newLevel }, { merge: true });

    const logRef = db.collection('exp_logs').doc();
    tx.set(logRef, {
        uid: userRef.id,
        reason,
        amount,
        prevExp,
        newExp,
        prevLevel,
        newLevel,
        leveledUp: newLevel > prevLevel,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { prevLevel, newLevel, prevExp, newExp, leveledUp: newLevel > prevLevel };
}

module.exports = { grantExp, grantExpInTx, expRequiredForLevelUp };
