const admin = require('firebase-admin');
const serviceAccount = require('./service_account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function processRefunds() {
    const snap = await db.collection('transactions')
        .where('type', '==', 'pay_merchant')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

    const batch = db.batch();
    let count = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        // Revert the faulty logic if the transaction was done recently
        if (data.amountVnd === 350000 || data.amountKrw > 0) {
            // Just delete the faulty transaction docs
            batch.delete(doc.ref);
            count++;

            // Refund buyer
            const userRef = db.collection('users').doc(data.uid);
            // We know the faulty logic deducted amountVnd from their KM balance instead of amountKrw natively
            const deduction = data.amountVnd;
            batch.update(userRef, {
                pointBalanceVnd: admin.firestore.FieldValue.increment(deduction)
            });

            // Delete corresponding merchant_income
            const mIncSnap = await db.collection('transactions').where('buyerUid', '==', data.uid).where('type', '==', 'merchant_income').get();
            mIncSnap.forEach(d => {
                batch.delete(d.ref);
                const mData = d.data();
                const mRef = db.collection('users').doc(mData.uid);
                batch.update(mRef, { pointBalanceVnd: admin.firestore.FieldValue.increment(-mData.netAmountVnd) });
            });
        }
    }

    if (count > 0) {
        await batch.commit();
        console.log('Refunded ' + count + ' recent faulty transactions.');
    } else {
        console.log('No recent faulty transactions found.');
    }
}

processRefunds().then(() => process.exit(0)).catch(console.error);
