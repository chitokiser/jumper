const admin = require('firebase-admin');
const serviceAccount = require('./service_account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function cleanOldDeposits() {
    const snap = await db.collection('deposits').get();
    let count = 0;
    const batch = db.batch();

    snap.forEach(doc => {
        const data = doc.data();
        if (data.amountKrw !== 500000) {
            batch.delete(doc.ref);
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log('Deleted ' + count + ' old records.');
    } else {
        console.log('No old records found.');
    }
}
cleanOldDeposits().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
