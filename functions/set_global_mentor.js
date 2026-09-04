const admin = require('firebase-admin');

// 서비스 어카운트 JSON을 불러와 강력한 인증으로 에러 100% 방지
const serviceAccount = require('./service_account.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
    try {
        const kfuEmail = 'kfu134252@gmail.com';
        const adminEmail = 'admin@jumper.com'; // 관리자 이메일
        const usersRef = db.collection('users');

        // 1. 관리자 유저 찾기
        const adminSnap = await usersRef.where('email', '==', adminEmail).limit(1).get();
        let adminUid = 'admin'; // 기본 fallback
        if (!adminSnap.empty) {
            adminUid = adminSnap.docs[0].id;
        }

        // 2. kfu 유저 찾기
        const kfuSnap = await usersRef.where('email', '==', kfuEmail).limit(1).get();
        if (kfuSnap.empty) {
            console.log('Error: KFU User not found.');
            process.exit(1);
        }

        const kfuDoc = kfuSnap.docs[0];
        const kfuUid = kfuDoc.id;
        const kfuData = kfuDoc.data();
        const kfuWallet = kfuData.walletAddress || (kfuData.onChain ? kfuData.onChain.walletAddress : null);

        console.log(`Admin UID: ${adminUid}`);
        console.log(`KFU UID: ${kfuUid}`);

        // 3. KFU의 멘토를 관리자(Admin)로 설정
        await kfuDoc.ref.update({
            mentorUid: adminUid,
            mentorEmail: adminEmail
        });
        console.log(`✅ Set mentor for KFU to Admin (${adminUid})`);

        // 4. 나머지 모든 유저의 멘토를 KFU로 설정
        const allUsersSnap = await usersRef.get();
        let updatedCount = 0;
        const batchArray = [db.batch()];
        let batchIndex = 0;
        let operationCount = 0;

        allUsersSnap.forEach(doc => {
            // 🎉 KFU 본인이거나 관리자(Admin)인 경우 스킵!
            if (doc.id === kfuUid || doc.id === adminUid) return;

            const updateData = {
                mentorUid: kfuUid,
                mentorEmail: kfuEmail
            };
            if (kfuWallet) {
                updateData['onChain.mentorAddress'] = kfuWallet;
            }

            batchArray[batchIndex].update(doc.ref, updateData);
            operationCount++;
            updatedCount++;

            if (operationCount >= 400) {
                batchArray.push(db.batch());
                batchIndex++;
                operationCount = 0;
            }
        });

        console.log(`Committing ${updatedCount} user updates...`);
        for (let i = 0; i < batchArray.length; i++) {
            if (i < batchIndex || (i === batchIndex && operationCount > 0)) {
                await batchArray[i].commit();
                console.log(`Batch ${i + 1} committed.`);
            }
        }

        console.log(`✅ Successfully updated ${updatedCount} users to have ${kfuEmail} as their mentor.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
