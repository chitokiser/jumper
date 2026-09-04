/**
 * reset_members.js
 * Firebase CLI 인증(Application Default Credentials) 사용 - service-account.json 불필요
 * 실행: node reset_members.js
 */

'use strict';

process.env.GOOGLE_CLOUD_PROJECT = 'jumper-b15aa';

const admin = require('firebase-admin');

// Application Default Credentials 사용 (firebase CLI 로그인 세션 활용)
admin.initializeApp({
    projectId: 'jumper-b15aa',
    credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const auth = admin.auth();

const ADMIN_EMAIL = 'daguri75@gmail.com';
const BATCH_SIZE = 400;

async function deleteCollection(colName) {
    let deleted = 0;
    while (true) {
        const snap = await db.collection(colName).limit(BATCH_SIZE).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.docs.length;
        process.stdout.write(`  ${colName}: ${deleted}건 삭제 중...\r`);
    }
    console.log(`✓ ${colName} 삭제 완료 (${deleted}건)          `);
}

async function main() {
    console.log('='.repeat(60));
    console.log('K-MOA 회원 데이터 초기화');
    console.log(`유지 계정: ${ADMIN_EMAIL}`);
    console.log('='.repeat(60));

    // 관리자 UID 확인
    let adminUid = null;
    let adminEmail = ADMIN_EMAIL;
    try {
        const adminUser = await auth.getUserByEmail(ADMIN_EMAIL);
        adminUid = adminUser.uid;
        console.log(`✓ 관리자 UID: ${adminUid}\n`);
    } catch (e) {
        console.warn(`! 관리자 계정 UID 조회 실패 (이메일 기준으로만 필터)\n`);
    }

    // ── [1] users 잔고 초기화 ─────────────────────────────────────
    console.log('[1] users 잔고 초기화...');
    const usersSnap = await db.collection('users').get();
    let userReset = 0, userSkip = 0;

    for (let i = 0; i < usersSnap.docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = usersSnap.docs.slice(i, i + BATCH_SIZE);
        for (const d of chunk) {
            const data = d.data();
            const isAdmin = (d.id === adminUid) || (data.email === adminEmail);
            if (isAdmin) { userSkip++; continue; }
            batch.update(d.ref, {
                pointBalanceVnd: 0,
                pointBalance: 0,
                btBalance: 0,
                gsExp: 0,
                gsLevel: 1,
            });
            userReset++;
        }
        await batch.commit();
    }
    console.log(`✓ users: ${userReset}명 초기화, ${userSkip}명 유지\n`);

    // ── [2] battle_players 초기화 ─────────────────────────────────
    console.log('[2] battle_players 초기화...');
    const bpSnap = await db.collection('battle_players').get();
    let bpReset = 0, bpSkip = 0;

    for (let i = 0; i < bpSnap.docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = bpSnap.docs.slice(i, i + BATCH_SIZE);
        for (const d of chunk) {
            if (d.id === adminUid) { bpSkip++; continue; }
            batch.update(d.ref, {
                gsExp: 0,
                gsLevel: 1,
                gold: 0,
                btBalance: 0,
                potions: 0,
                mpPotions: 0,
                reviveTickets: 0,
            });
            bpReset++;
        }
        await batch.commit();
    }
    console.log(`✓ battle_players: ${bpReset}명 초기화, ${bpSkip}명 유지\n`);

    // ── [3] 관련 컬렉션 전체 삭제 ─────────────────────────────────
    console.log('[3] 관련 컬렉션 삭제...');
    for (const col of ['deposits', 'transactions', 'exp_logs', 'membership_referrals', 'jackpot_wins', 'jackpot_rounds']) {
        await deleteCollection(col);
    }

    // ── [4] 잭팟 풀 초기화 ────────────────────────────────────────
    console.log('\n[4] 잭팟 풀 초기화...');
    await db.collection('jackpot_config').doc('current').set({
        jackpotAccVnd: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log('✓ jackpot_config 초기화 완료');

    console.log('\n' + '='.repeat(60));
    console.log('✅ 초기화 완료!');
    console.log(`  • users 초기화:        ${userReset}명`);
    console.log(`  • 유지된 관리자:        ${ADMIN_EMAIL}`);
    console.log(`  • deposits/transactions/exp_logs/referrals/jackpot: 삭제`);
    console.log('='.repeat(60));
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ 오류:', err.message);
    if (err.message.includes('credential')) {
        console.error('\n💡 해결 방법:');
        console.error('   1. https://console.firebase.google.com/project/jumper-b15aa/settings/serviceaccounts');
        console.error('   2. "새 비공개 키 생성" 클릭 → JSON 다운로드');
        console.error('   3. functions/ 폴더에 service-account.json 으로 저장');
        console.error('   4. 스크립트 상단 credential 부분을 cert() 방식으로 교체 후 재실행');
    }
    process.exit(1);
});
