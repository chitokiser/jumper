import re

try:
    content = open('functions/handlers/onboarding.js', 'r', encoding='utf-8').read()

    new_func = """async function getMyMentees(uid) {
  const userSnap = await admin.firestore().collection('users').doc(uid).get();
  const myAddress = userSnap.data()?.wallet?.address || null;

  const querySnap = await admin.firestore().collection('users').where('mentorUid', '==', uid).limit(100).get();
  const menteeMap = {};
  
  await Promise.all(querySnap.docs.map(async (docSnap) => {
    const data = docSnap.data();
    const menteeUid = docSnap.id;
    const bpSnap = await admin.firestore().collection('battle_players').doc(menteeUid).get();
    const earned = bpSnap.exists ? (bpSnap.data().generatedForMentor || 0) : 0;
    
    menteeMap[menteeUid] = {
      uid: menteeUid,
      name: data.displayName || data.name || data.email?.split('@')[0] || '익명',
      address: data.wallet?.address || '',
      registeredAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
      generatedForMentor: earned
    };
  }));

  const sortedMentees = Object.values(menteeMap).sort((a, b) => b.generatedForMentor - a.generatedForMentor);
  return { mentees: sortedMentees, myAddress };
}"""

    # We want to replace getMyMentees. It starts at:
    idx_start = content.find("async function getMyMentees(uid) {")
    end_str = "        feeBps,\n        myEst,\n      });\n    }\n  });\n\n  return { mentees: Object.values(menteeMap), myAddress };\n}"
    idx_end = content.find("return { mentees: Object.values(menteeMap), myAddress };", idx_start)
    
    # Actually, we can just split content!
    # Let's search for "async function getMenteeIncome"
    idx_next_func = content.find("async function getMenteeIncome(uid) {")
    # In front of getMenteeIncome, there is its JSDoc.
    # We will just replace everything from `async function getMyMentees` until `/**\n * getMenteeIncome`
    
    # Use re.sub with VERY specific pattern
    content = re.sub(
        r'async function getMyMentees\(uid\) \{.*?(?=/\*\*\s*\*\s*getMenteeIncome)',
        new_func + "\n\n",
        content,
        flags=re.DOTALL
    )
    
    # We will NOT remove getMenteeIncome to avoid breaking things for now.
    # Just leave it! We don't care if it's there.
    
    with open('functions/handlers/onboarding.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Success patch with regex!")
except Exception as e:
    print(e)
