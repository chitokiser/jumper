import re

try:
    content = open('functions/handlers/onboarding.js', 'r', encoding='utf-8').read()
    
    # Let's replace the ENTIRE getMyMentees function because the old one scans the blockchain for 490,000 blocks!!
    
    new_func = """async function getMyMentees(uid) {
  // 1. Fetch from Firestore purely
  const userSnap = await db.collection('users').doc(uid).get();
  const myAddress = userSnap.data()?.wallet?.address || null;

  // Find mentees where mentorUid == uid
  const querySnap = await db.collection('users').where('mentorUid', '==', uid).limit(100).get();
  
  const menteeMap = {};
  
  await Promise.all(querySnap.docs.map(async (docSnap) => {
    const data = docSnap.data();
    const menteeUid = docSnap.id;
    
    // Also fetch their battle_players doc to get 'generatedForMentor'
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

  // Sort by generated points (highest first)
  const sortedMentees = Object.values(menteeMap).sort((a, b) => b.generatedForMentor - a.generatedForMentor);

  return { mentees: sortedMentees, myAddress };
}"""

    # We need to find the async function getMyMentees(uid) { ... }
    # Since we know it's large, we use Regex with dotall
    content = re.sub(
        r'async function getMyMentees\(uid\) \{.*?return \{ mentees: Object\.values\(menteeMap\), myAddress \};\n\}',
        new_func,
        content,
        flags=re.DOTALL
    )

    with open('functions/handlers/onboarding.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Replaced getMyMentees in onboarding.js!")
except Exception as e:
    print(e)
