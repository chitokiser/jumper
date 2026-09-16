import re

try:
    content = open('functions/index.js', 'r', encoding='utf-8').read()
    
    inject = """
exports.tempIssueKey = onRequest({ cors: true }, async (req, res) => {
    try {
        const admin = require('firebase-admin');
        const db = admin.firestore();
        const crypto = require('crypto');
        
        // 새로 발급 (주인이 바뀜)
        const newApiKey = "moa-merch-" + crypto.randomBytes(8).toString('hex');
        const merchantId = "2"; // 대한김치
        
        await db.collection('api_keys').doc(newApiKey).set({
            merchantId,
            merchantName: "대한김치",
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await db.collection('merchants').doc(merchantId).set({
            apiKey: newApiKey
        }, { merge: true });
        
        res.status(200).send(`
            <h1>✅ 대한김치(ID: 2) 신규 API 키 발급 완료</h1>
            <p>가맹점 주인이 변경되어 새롭게 발급한 안전한 전용 API 키입니다.</p>
            <h2 style="color: blue;">${newApiKey}</h2>
            <p>이 키를 복사해서 새로운 가맹점주(대한김치 관리자)에게 전달해주세요.</p>
        `);
    } catch(err) {
        res.status(500).send("에러: " + err.message);
    }
});
"""

    if "exports.tempIssueKey" not in content:
        content += "\n" + inject
        with open('functions/index.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Injected tempIssueKey into index.js")
    else:
        print("tempIssueKey already exists!")
except Exception as e:
    print(e)
