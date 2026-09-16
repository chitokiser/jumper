import re

try:
    content = open('handlers/onboarding.js', 'r', encoding='utf-8').read()

    new_func = """async function getMyMentees(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const myAddress = userSnap.data()?.wallet?.address || null;

  const querySnap = await db.collection('users').where('mentorUid', '==', uid).limit(100).get();
  const menteeMap = {};
  
  await Promise.all(querySnap.docs.map(async (docSnap) => {
    const data = docSnap.data();
    const menteeUid = docSnap.id;
    const bpSnap = await db.collection('battle_players').doc(menteeUid).get();
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

    # We use regex to specifically replace the block, knowing its start and end
    # The end of getMyMentees is `return { mentees: Object.values(menteeMap), myAddress };\n}`
    
    content = re.sub(
        r'async function getMyMentees\(uid\) \{.*?return \{ mentees: Object\.values\(menteeMap\), myAddress \};\n\}',
        new_func,
        content,
        flags=re.DOTALL
    )

    with open('handlers/onboarding.js', 'w', encoding='utf-8') as f:
        f.write(content)
        print("Success regex!")
except Exception as e:
    print(e)
