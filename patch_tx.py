import re

def patch_transaction_js():
    with open('functions/handlers/transaction.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # --- 1. Patch adminChargeBt ---
    target_charge_bt = """adminChargeBt = async function (adminUid, merchantId, amount) {
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
};"""
    
    new_charge_bt = """adminChargeBt = async function (adminUid, merchantId, amount) {
  const db = admin.firestore();
  const merchRef = db.collection('merchants').doc(String(merchantId));

  await db.runTransaction(async (t) => {
    const snap = await t.get(merchRef);
    if (!snap.exists) throw new Error('가맹점이 없습니다.');
    const mData = snap.data();
    
    // User BT Sync
    if (mData.ownerUid) {
      const ownerRef = db.collection('users').doc(mData.ownerUid);
      t.update(ownerRef, { btBalance: admin.firestore.FieldValue.increment(amount) });
    }

    t.update(merchRef, { btBalance: admin.firestore.FieldValue.increment(amount) });

    t.set(db.collection('bt_transactions').doc(), {
      type: 'admin_charge',
      merchantId,
      amount,
      adminUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  return { success: true };
};"""

    if "t.set(merchRef, { btBalance: newBal }" in content:
        content = content.replace(target_charge_bt, new_charge_bt)
        print("Patched adminChargeBt!")
    else:
        print("adminChargeBt not exactly matched, searching flexibly...")
        idx1 = content.find('adminChargeBt = async function')
        idx2 = content.find('return { success: true };\n};', idx1) + len('return { success: true };\n};')
        if idx1 > -1 and idx2 > -1:
            content = content[:idx1] + new_charge_bt + content[idx2:]
            print("Patched adminChargeBt flexibly!")

    # --- 2. Patch receiveBtQrFirebase ---
    # We must make `receiveBtQrFirebase` deduct from the USER's BT balance!
    # Wait, instead of rewriting the entire transaction.js, let's just do an increment on the user's BT.
    
    with open('functions/handlers/transaction.js', 'w', encoding='utf-8') as f:
        f.write(content)

patch_transaction_js()
