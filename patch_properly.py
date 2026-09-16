import re

def main():
    with open('functions/handlers/onboarding.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. We ONLY want to replace the getMyMentees function body.
    # So we'll slice content up to `async function getMyMentees`
    idx_getMyMentees = content.find('async function getMyMentees(uid) {')
    
    # 2. We find where adminSelfOnboard starts
    idx_admin = content.find('/**\n * adminSelfOnboard')
    if idx_admin == -1:
        idx_admin = content.find('/**\r\n * adminSelfOnboard')
    
    if idx_getMyMentees == -1 or idx_admin == -1:
        print("COULD NOT FIND INDEX!")
        return
        
    part1_before = content[:idx_getMyMentees]
    part3_after = content[idx_admin:]
    
    new_func = """async function getMyMentees(uid) {
  const db = admin.firestore();
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
    
    new_content = part1_before + new_func + part3_after
    
    # Remove getMenteeIncome from exports
    new_content = new_content.replace('  getMenteeIncome,\n', '')
    new_content = new_content.replace('  getMenteeIncome,\r\n', '')
    
    with open('functions/handlers/onboarding.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print("Mentees successfully patched out!")

if __name__ == "__main__":
    main()
