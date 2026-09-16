import re
try:
    content = open('functions/handlers/merchantApi.js', 'r', encoding='utf-8').read()
    
    new_v1_balance = """// 1. [가맹점 자산 잔고 조회 API]
apiApp.get('/v1/balance', async (req, res) => {
    try {
        const merchData = req.merchantDoc.data();
        const ownerUid = merchData.ownerUid;
        
        let ownerData = {};
        if (ownerUid) {
            const ownerSnap = await req.db.collection('users').doc(ownerUid).get();
            if (ownerSnap.exists) {
                ownerData = ownerSnap.data();
            }
        }

        return res.json({
            success: true,
            merchantId: req.merchantId,
            merchantName: merchData.name || '알 수 없음',
            balance: {
                points: ownerData.pointBalance || 0, 
                km: ownerData.wallet?.pointBalance || 0,
                btBalance: ownerData.btBalance || 0
            }
        });
    } catch (err) {
        console.error('Balance check error:', err);
        res.status(500).json({ success: false, message: '잔고 확인 중 오류가 발생했습니다.' });
    }
});"""
    
    # We replace the v1 balance
    content = re.sub(
        r'// 1\. \[가맹점 자산 잔고 조회 API\].*?res\.status\(500\)\.json\(\{ success: false, message: [\'"]잔고.*?\}\);\n    \}\n\}\);',
        new_v1_balance,
        content,
        flags=re.DOTALL
    )
    
    # Also let's check for K-MOA text in API error messages or logs
    content = content.replace("K-MOA", "Platform")

    with open('functions/handlers/merchantApi.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("merchantApi modified!")
except Exception as e:
    print(e)
