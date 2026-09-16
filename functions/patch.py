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

    # Manually search and replace to avoid swallowing
    search_str = "async function getMyMentees(uid) {"
    end_str = "return { mentees: Object.values(menteeMap), myAddress };\n}"
    
    idx_start = content.find(search_str)
    idx_end = content.find(end_str, idx_start) + len(end_str)
    
    if idx_start != -1 and idx_end != -1:
        content = content[:idx_start] + new_func + content[idx_end:]
        
        # Now remove getMenteeIncome function
        idx_g_start = content.find('/**\n * getMenteeIncome')
        idx_g_end = content.find('/**\n * adminSelfOnboard', idx_g_start)
        if idx_g_start != -1 and idx_g_end != -1:
            content = content[:idx_g_start] + content[idx_g_end:]
        
        # Now remove getMenteeIncome from exports
        content = content.replace("  getMenteeIncome,\n", "")
        
        with open('handlers/onboarding.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Success manual patch!")
    else:
        print("Could not find bounds")
except Exception as e:
    print(e)
