import re
try:
    content = open('functions/handlers/merchantReward.js', 'r', encoding='utf-8').read()
    
    # We replace the merchant BT deduction from mRef to merchSnap (the users doc of the merchant)
    # The current logic:
    """
        const mRef = db.collection('merchants').doc(String(merchantId));
        const mDoc = await tx.get(mRef);
        if (!mDoc.exists) throw new HttpsError('not-found', '가맹점 정보를 찾을 수 없습니다.');
        const mData = mDoc.data();
        
        let mBtBalance = mData.btBalance || 0;
        if (mBtBalance < btAmountToGive) {
            throw new HttpsError('failed-precondition', `가맹점의 BT 잔고가 부족합니다! (현재잔고: ${mBtBalance} BT)`);
        }
        
        // Deduct from merchant
        tx.update(mRef, {
            btBalance: admin.firestore.FieldValue.increment(-btAmountToGive)
        });
    """
    
    # Replace it with deducting from the user's doc
    new_logic = """
        const mOwnerRef = db.collection('users').doc(merchantUid);
        const mOwnerDoc = await tx.get(mOwnerRef);
        const mOwnerData = mOwnerDoc.data();
        
        let mBtBalance = mOwnerData.btBalance || 0;
        if (mBtBalance < btAmountToGive) {
            throw new HttpsError('failed-precondition', `보유하신 BT 잔고가 부족합니다! (현재잔고: ${mBtBalance} BT)`);
        }
        
        // Deduct from merchant's user account!
        tx.update(mOwnerRef, {
            btBalance: admin.firestore.FieldValue.increment(-btAmountToGive)
        });
        
        // (We still optionally update merchant's stats if needed, but we don't deduct BT there)
        const mRef = db.collection('merchants').doc(String(merchantId));
        // just to ensure they exist
        const mDoc = await tx.get(mRef);
        if (!mDoc.exists) throw new HttpsError('not-found', '가맹점 정보를 찾을 수 없습니다.');
    """
    
    content = re.sub(
        r'const mRef = db\.collection\(\'merchants\'\)\.doc\(String\(merchantId\)\);.*?btBalance:\s*admin\.firestore\.FieldValue\.increment\(-btAmountToGive\)\s*\}\);',
        new_logic,
        content,
        flags=re.DOTALL
    )

    with open('functions/handlers/merchantReward.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Patched remote BT sending for user BT balance!")
except Exception as e:
    print(e)
