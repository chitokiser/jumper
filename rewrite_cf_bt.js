const fs = require('fs');

let index = fs.readFileSync('functions/index.js', 'utf8');

const cfBlock = `// ════════════════════════════════════════════════════════════════════════════
// 99. 관리자: 가맹점에 BT 충전
// ════════════════════════════════════════════════════════════════════════════
exports.adminChargeBt = onCall(
  wrapError(async (request) => {
    const adminUid = requireAuth(request);
    await requireAdmin(adminUid);
    const { merchantId, amount } = request.data ?? {};
    if (!merchantId || !amount) throw new HttpsError('invalid-argument', 'merchantId와 amount가 필요합니다.');
    
    return await txH.adminChargeBt(adminUid, Number(merchantId), Number(amount));
  })
);
`;

if (!index.includes('adminChargeBt = onCall')) {
    index = index + '\n' + cfBlock;
    fs.writeFileSync('functions/index.js', index, 'utf8');
}

let tx = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const txBlock = `
exports.adminChargeBt = async function(adminUid, merchantId, amount) {
  const db = admin.firestore();
  const merchRef = db.collection('merchants').doc(String(merchantId));
  
  await db.runTransaction(async (t) => {
    const snap = await t.get(merchRef);
    if (!snap.exists) throw new Error('가맹점이 없습니다.');
    const newBal = (Number(snap.data().btBalance) || 0) + amount;
    t.set(merchRef, { btBalance: newBal }, { merge: true });
    
    t.set(db.collection('bt_transactions').doc(), {
      type: 'admin_charge',
      merchantId,
      amount,
      adminUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  return { success: true };
};
`;

if (!tx.includes('exports.adminChargeBt = async')) {
    tx = tx + '\n' + txBlock;
    fs.writeFileSync('functions/handlers/transaction.js', tx, 'utf8');
}

console.log('Added adminChargeBt Cloud Function');
