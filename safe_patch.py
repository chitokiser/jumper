import re
try:
    content = open('functions/handlers/onboarding.js', 'r', encoding='utf-8').read()
    
    new_func = """
async function getMyMentees(uid) {
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
}
"""

    # We will search for async function getMyMentees and ONLY replace until we reach its closing brace.
    # To do this safely, we will use a more precise regex.
    # The original getMyMentees ends with: `return { mentees: Object.values(menteeMap), myAddress };\n}`
    
    # We will replace from `async function getMyMentees(uid) {` up to `getMenteeIncome(uid) {` 
    # to avoid destroying it, but wait, `adminSelfOnboard` is AFTER `getMenteeIncome` usually?
    
    # Let's just find the start of getMyMentees and the start of getMenteeIncome.
    idx_start = content.find('async function getMyMentees(uid) {')
    idx_end = content.find('async function getMenteeIncome(uid)')
    
    if idx_start != -1 and idx_end != -1:
        # Also include any JSDoc for getMenteeIncome to stay intact!
        # find the JSDoc before getMenteeIncome
        idx_doc = content.rfind('/**', idx_start, idx_end)
        
        content = content[:idx_start] + new_func + "\n" + content[idx_doc:]
        
        with open('functions/handlers/onboarding.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Safely replaced getMyMentees!")
    else:
        print(f"Couldn't find indices! {idx_start} {idx_end}")

except Exception as e:
    print(e)
