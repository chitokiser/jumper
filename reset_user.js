/**
 * reset_user.js
 * 특정 계정(hexdao722@gmail.com)을 완전 초기화 → 멘토 선택 회원가입 재테스트용
 *
 * 실행: node reset_user.js
 *
 * 처리 내용:
 *  1. 이메일로 UID 조회
 *  2. Firestore: users/{uid}, battle_players/{uid} 완전 삭제
 *  3. Firestore: users/{uid}에 연관된 deposits, transactions, exp_logs 삭제
 *  4. Firebase Auth 계정은 유지 (재로그인 가능) → disabled=false 확인
 *  5. 결과 출력
 */

'use strict';

const admin = require('firebase-admin');

// 서비스 계정 키 경로 — .firebaserc 같은 폴더에 있는 키 파일 사용
const serviceAccount = require('./functions/service_account.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

const TARGET_EMAIL = 'hexdao722@gmail.com';

async function deleteCollection(collectionPath, uid, field = 'uid') {
    const snap = await db.collection(collectionPath).where(field, '==', uid).get();
    if (snap.empty) {
        console.log(`  └ ${collectionPath}: 데이터 없음 (건너뜀)`);
        return 0;
    }
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    console.log(`  └ ${collectionPath}: ${snap.size}건 삭제 완료`);
    return snap.size;
}

async function deleteDoc(collectionPath, docId) {
    const ref = db.collection(collectionPath).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
        console.log(`  └ ${collectionPath}/${docId}: 문서 없음 (건너뜀)`);
        return false;
    }
    await ref.delete();
    console.log(`  └ ${collectionPath}/${docId}: 삭제 완료`);
    return true;
}

async function main() {
    console.log(`\n========================================`);
    console.log(` K-MOA 계정 초기화 스크립트`);
    console.log(` 대상: ${TARGET_EMAIL}`);
    console.log(`========================================\n`);

    // 1. UID 조회
    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(TARGET_EMAIL);
    } catch (e) {
        console.error(`❌ 계정을 찾을 수 없습니다: ${TARGET_EMAIL}`);
        console.error(e.message);
        process.exit(1);
    }

    const uid = userRecord.uid;
    console.log(`✅ UID 확인: ${uid}`);
    console.log(`   displayName: ${userRecord.displayName || '-'}`);
    console.log(`   disabled: ${userRecord.disabled}\n`);

    // 2. Auth 활성화 확인 (disabled였으면 복원)
    if (userRecord.disabled) {
        await auth.updateUser(uid, { disabled: false });
        console.log(`✅ Auth 계정 활성화 (disabled → false)\n`);
    }

    // 3. Firestore 문서 삭제
    console.log(`🗑️  Firestore 데이터 삭제 중...\n`);

    // 3-1. users/{uid} — 완전 삭제 (회원가입 재진행 위해)
    await deleteDoc('users', uid);

    // 3-2. battle_players/{uid}
    await deleteDoc('battle_players', uid);

    // 3-3. 연관 컬렉션 (uid 필드로 조회)
    await deleteCollection('deposits', uid);
    await deleteCollection('transactions', uid);
    await deleteCollection('exp_logs', uid);
    await deleteCollection('jackpot_wins', uid);
    await deleteCollection('membership_referrals', uid);
    await deleteCollection('bt_rewards', uid);

    // 3-4. mentor_requests (menteeUid 필드)
    const mentorReqSnap = await db.collection('mentor_requests').where('menteeUid', '==', uid).get();
    if (!mentorReqSnap.empty) {
        const b = db.batch();
        mentorReqSnap.docs.forEach(d => b.delete(d.ref));
        await b.commit();
        console.log(`  └ mentor_requests: ${mentorReqSnap.size}건 삭제 완료`);
    } else {
        console.log(`  └ mentor_requests: 데이터 없음 (건너뜀)`);
    }

    console.log(`\n========================================`);
    console.log(` ✅ 초기화 완료!`);
    console.log(`========================================`);
    console.log(` Firebase Auth 계정은 유지됨`);
    console.log(` → 동일 이메일(Google)로 재로그인 시 회원가입 화면으로 이동`);
    console.log(` → register.html?mentor=XXX 링크로 멘토 선택 테스트 가능\n`);

    process.exit(0);
}

main().catch(e => {
    console.error('❌ 스크립트 오류:', e.message);
    process.exit(1);
});
