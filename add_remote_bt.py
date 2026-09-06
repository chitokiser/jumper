import re

try:
    content = open('functions/handlers/merchantReward.js', 'r', encoding='utf-8').read()
    
    inject_func = """
exports.merchantSendBtDirect = async function(data, context) {
    if (!context.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const merchantUid = context.auth.uid;
    const { customerEmail, amountVnd } = data;
    
    if (!customerEmail || !amountVnd || amountVnd < 10000) {
        throw new HttpsError('invalid-argument', '고객 이메일과 결제금액(VND)을 올바르게 입력해주세요.');
    }
    
    // 1. Find the customer
    const userSnap = await db.collection('users').where('email', '==', customerEmail).limit(1).get();
    if (userSnap.empty) {
        throw new HttpsError('not-found', '해당 이메일의 고객을 찾을 수 없습니다.');
    }
    const customer = userSnap.docs[0];
    const customerUid = customer.id;
    
    // 2. Find the merchant
    const merchSnap = await db.collection('users').doc(merchantUid).get();
    const merchantId = merchSnap.data()?.merchantId;
    if (!merchantId) {
        throw new HttpsError('permission-denied', '가맹점이 아닙니다.');
    }
    
    // 3. Process exactly like receiveBtQrFirebase
    const btAmountToGive = Math.floor(amountVnd / 10000);
    if (btAmountToGive < 1) {
        throw new HttpsError('invalid-argument', '10,000 VND 미만은 BT를 지급할 수 없습니다.');
    }

    // Wrap in transaction
    return await db.runTransaction(async (tx) => {
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
        
        // Add to customer
        const cRef = db.collection('users').doc(customerUid);
        tx.update(cRef, {
            btBalance: admin.firestore.FieldValue.increment(btAmountToGive)
        });
        
        // Record log
        const logRef = db.collection('bt_transactions').doc();
        tx.set(logRef, {
            type: 'remote_send',
            merchantId: Number(merchantId),
            merchantUid,
            customerUid,
            customerEmail,
            amountVnd,
            btIssued: btAmountToGive,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { success: true, btIssued: btAmountToGive, customerEmail };
    });
};
"""
    
    content += "\n" + inject_func
    
    with open('functions/handlers/merchantReward.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("merchantReward.js added merchantSendBtDirect!")
except Exception as e:
    print(e)
