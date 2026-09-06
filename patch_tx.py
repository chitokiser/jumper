import re

try:
    content = open('functions/handlers/transaction.js', 'r', encoding='utf-8').read()
    
    # Let's replace the transaction part safely
    content = re.sub(
        r'tx\.set\(db\.collection\([\'"]transactions[\'"]\)\.doc\(\),\s*\{\s*\.\.\.txBase,\s*uid:\s*mentorUid,\s*type:\s*[\'"]bonus_tier1[\'"],\s*amountVnd:\s*mentorBonusVnd,\s*amountKrw:\s*mentorBonusVnd\s*\}\);',
        r"tx.set(db.collection('transactions').doc(), { ...txBase, uid: mentorUid, type: 'bonus_tier1', amountVnd: mentorBonusVnd, amountKrw: mentorBonusVnd, fromUid: uid });\n      tx.set(buyerBpRef, { generatedForMentor: admin.firestore.FieldValue.increment(mentorBonusVnd) }, { merge: true });",
        content
    )
    
    content = re.sub(
        r'tx\.set\(db\.collection\([\'"]transactions[\'"]\)\.doc\(\),\s*\{\s*\.\.\.txBase,\s*uid:\s*grandMentorUid,\s*type:\s*[\'"]bonus_tier2[\'"],\s*amountVnd:\s*grandMentorBonusVnd,\s*amountKrw:\s*grandMentorBonusVnd\s*\}\);',
        r"tx.set(db.collection('transactions').doc(), { ...txBase, uid: grandMentorUid, type: 'bonus_tier2', amountVnd: grandMentorBonusVnd, amountKrw: grandMentorBonusVnd, fromUid: uid });\n      tx.set(buyerBpRef, { generatedForGrandMentor: admin.firestore.FieldValue.increment(grandMentorBonusVnd) }, { merge: true });",
        content
    )

    with open('functions/handlers/transaction.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("transactions.js patched with regex.")
except Exception as e:
    print(e)
