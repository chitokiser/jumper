'use strict';
// Run: node functions/scripts/resetTreeConfig.js
// Resets Firestore system_config/money_tree to correct values (no extra zeros)

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'jumper-b15aa' });

const db = admin.firestore();

async function main() {
  await db.doc('system_config/money_tree').set({
    seedlingPriceGp:    10000,
    growthRate:         50,
    maxTreeValue:       500000,
    boosterPriceGp:     1000,
    boosterMin:         1,
    boosterMax:         25,
    mentorRegTicketPriceGp: 50000,
  }, { merge: true });
  console.log('system_config/money_tree reset to correct values.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
