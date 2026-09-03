const admin = require('firebase-admin');
const serviceAccount = require('./service_account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function cleanJackpotWins() {
    const snap = await db.collection('jackpot_wins').get();
    let count = 0;
    const batch = db.batch();

    snap.forEach(doc => {
        batch.delete(doc.ref);
        count++;
    });

    if (count > 0) {
        await batch.commit();
        console.log('Deleted ' + count + ' old jackpot_wins.');
    } else {
        console.log('No old jackpot_wins found.');
    }
}
cleanJackpotWins().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
