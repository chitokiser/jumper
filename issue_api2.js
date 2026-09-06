const admin = require('firebase-admin');

// Trying default init
admin.initializeApp();

const db = admin.firestore();

async function run() {
    const merchantId = '2'; // User said 대한김치 ID is 2
    try {
        const apiKey = "moa-merch-" + require('crypto').randomBytes(8).toString('hex');

        await db.collection('api_keys').doc(apiKey).set({
            merchantId: merchantId,
            merchantName: "대한김치",
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await db.collection('merchants').doc(merchantId).set({
            apiKey: apiKey
        }, { merge: true });

        console.log("Success! API Key for merchant ID 2:", apiKey);
    } catch (err) {
        console.error(err);
    }
}
run();
