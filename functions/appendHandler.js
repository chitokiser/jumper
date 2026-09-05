const fs = require('fs');

const code = `
/**
 * claimWebzineShareReward
 * - 유저가 웹진을 성공적으로 공유했을 때 1000P 지급
 */
exports.claimWebzineShareReward = async (uid, requestData) => {
    const { webzineId, platform } = requestData;
    if (!webzineId) throw new Error('webzineId가 필요합니다');
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const shareLogRef = userRef.collection('share_logs').doc(String(webzineId));
    
    return await db.runTransaction(async (tx) => {
        const shareSnap = await tx.get(shareLogRef);
        if (shareSnap.exists) {
            throw new Error('이 기사에 대한 공유 보상은 이미 받으셨습니다.');
        }
        
        const rewardAmount = 1000;
        
        tx.set(shareLogRef, {
            platform: platform || 'link',
            rewardAmount: rewardAmount,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        tx.update(userRef, {
            pointBalance: admin.firestore.FieldValue.increment(rewardAmount)
        });
        
        const histRef = userRef.collection('point_history').doc();
        tx.set(histRef, {
            type: 'webzine_share',
            amount: rewardAmount,
            webzineId: String(webzineId),
            platform: platform || 'unknown',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            note: '웹진 공유 보상'
        });

        const webzineRef = db.collection('kca_webzine').doc(String(webzineId));
        tx.update(webzineRef, {
            shareCount: admin.firestore.FieldValue.increment(1)
        });
        
        return { success: true, reward: rewardAmount };
    });
};

/**
 * adminGrantWebzineBonus
 * - 관리자가 특정 유저가 웹진 마케팅/공유를 잘했을 때 추가 포인트를 지급하는 기능
 */
exports.adminGrantWebzineBonus = async (adminUid, requestData) => {
    const { targetUid, amount, webzineId, note } = requestData;
    if (!targetUid || !amount) throw new Error('targetUid와 amount가 필요합니다');
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    const userRef = db.collection('users').doc(String(targetUid));
    
    return await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error('대상 유저가 존재하지 않습니다');
        
        const bonusAmount = Number(amount);
        
        tx.update(userRef, {
            pointBalance: admin.firestore.FieldValue.increment(bonusAmount)
        });
        
        const histRef = userRef.collection('point_history').doc();
        tx.set(histRef, {
            type: 'webzine_bonus_admin',
            amount: bonusAmount,
            adminUid: adminUid,
            webzineId: webzineId ? String(webzineId) : null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            note: note || '웹진 마케팅 우수자 추가 포인트 보상 (관리자 지급)'
        });
        
        return { success: true, bonusAmount: bonusAmount };
    });
};
`;

fs.appendFileSync('handlers/webzine.js', code);
