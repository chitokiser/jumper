// functions/scripts/seed_coupons.js
const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, '../service_account.json'));
const { SEED_COUPON_CAMPAIGNS } = require('../handlers/coupon');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: "jumper-b15aa"
  });
}

const db = admin.firestore();

async function runSeed() {
  console.log("Seeding 4 initial coupon and voucher campaigns...");
  const batch = db.batch();

  for (const c of SEED_COUPON_CAMPAIGNS) {
    const ref = db.collection('coupon_campaigns').doc(c.campaignId);
    batch.set(ref, {
      ...c,
      saleStartsAt: admin.firestore.FieldValue.serverTimestamp(),
      saleEndsAt: new Date(Date.now() + 365 * 86400000),
      validStartsAt: admin.firestore.FieldValue.serverTimestamp(),
      validEndsAt: new Date(Date.now() + 365 * 86400000),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  await batch.commit();
  console.log("✅ Seed completed successfully! 4 coupon campaigns registered in Firestore.");
}

runSeed().catch(console.error);
