try:
    content = open('functions/handlers/onboarding.js', 'r', encoding='utf-8').read()

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

    idx_start = content.find('async function getMyMentees(uid) {')
    idx_end = content.find('/**\n * getMenteeIncome')
    
    content = content[:idx_start] + new_func + "\n\n" + content[idx_end:]
    
    # Also I need to remove getMenteeIncome entirely since we don't use it!
    # Let's remove from getMenteeIncome up to adminSelfOnboard
    idx_g = content.find('/**\n * getMenteeIncome')
    idx_a = content.find('/**\n * adminSelfOnboard')
    
    content = content[:idx_g] + content[idx_a:]
    
    # Update exports to remove getMenteeIncome
    content = content.replace('  getMenteeIncome,\n', '')
    
    with open('functions/handlers/onboarding.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Patched safely!")
except Exception as e:
    print(e)
