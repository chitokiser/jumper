import re

def patch_tx_withdraw():
    with open('functions/handlers/transaction.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the precise block
    old_block = """    const merchBtBal = Number(merchData.btBalance) || 0;
    if (merchBtBal < numBt) throw new Error('가맹점의 BT 잔고가 부족합니다. (상인에게 문의)');

    // 4. Deduct Merchant BT
    tx.set(merchRef, { btBalance: merchBtBal - numBt }, { merge: true });

    // 5. Update Reward Document"""

    old_block2 = """    const merchBtBal = Number(merchData.btBalance) || 0;
    if (merchBtBal < numBt) throw new Error('가맹점의 BT 잔고가 부족합니다. (상인에게 문의)');
    tx.set(merchRef, { btBalance: merchBtBal - numBt }, { merge: true });

    // 5. Update Reward Document"""
    
    # Actually just regex replace tx.set(merchRef, { btBalance: merchBtBal - numBt }...
    new_code = """    const merchBtBal = Number(merchData.btBalance) || 0;
    if (merchBtBal < numBt) throw new Error('가맹점의 BT 잔고가 부족합니다. (상인에게 문의)');
    
    tx.set(merchRef, { btBalance: merchBtBal - numBt }, { merge: true });
    if (merchData.ownerUid) {
      const ownerRef = db.collection('users').doc(merchData.ownerUid);
      tx.update(ownerRef, { btBalance: admin.firestore.FieldValue.increment(-numBt) });
    }"""

    # Do a simple regex
    pattern = r"tx\.set\(merchRef,\s*\{\s*btBalance:\s*merchBtBal\s*-\s*numBt\s*\},.*?\);"
    if re.search(pattern, content):
        content = re.sub(pattern, """tx.set(merchRef, { btBalance: merchBtBal - numBt }, { merge: true });
    if (merchData.ownerUid) {
      const ownerRef = db.collection('users').doc(merchData.ownerUid);
      tx.update(ownerRef, { btBalance: admin.firestore.FieldValue.increment(-numBt) });
    }""", content)
        print("Patched tx.set successfully!")
    else:
        print("Could not find pattern in transaction.js")

    with open('functions/handlers/transaction.js', 'w', encoding='utf-8') as f:
        f.write(content)

patch_tx_withdraw()
