import re

def patch_admin_approve():
    with open('assets/js/admin-approve.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update emailMap to fetch both email and btBalance
    old_code1 = """  const emailMap = {};
  await Promise.all(ownerUids.map(async uid => {
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (userSnap.exists()) emailMap[uid] = userSnap.data().email || "";
    } catch (_) { }
  }));"""

    new_code1 = """  const emailMap = {};
  const btMap = {};
  await Promise.all(ownerUids.map(async uid => {
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (userSnap.exists()) {
        const ud = userSnap.data();
        emailMap[uid] = ud.email || "";
        btMap[uid] = ud.btBalance || 0;
      }
    } catch (_) { }
  }));"""

    if old_code1 in content:
        content = content.replace(old_code1, new_code1)
    else:
        # fallback regex
        pat1 = r"const emailMap = \{\};\s*await Promise\.all.*?emailMap\[uid\] = userSnap\.data\(\)\.email.*?catch\s*\(_\)\s*\{\s*\}\s*\}\)\);"
        content = re.sub(pat1, new_code1, content, flags=re.DOTALL)
        
    # 2. Update 'v.btBalance' to use 'btMap[v.ownerUid]'
    # There are two places inside the merchant card that says "BT 잔여량: <b style="color:#d946ef;">${v.btBalance || 0} BT</b>"
    
    # We will replace all `${v.btBalance || 0}` with `${btMap[v.ownerUid] ?? v.btBalance ?? 0}` for safety.
    content = content.replace("${v.btBalance || 0}", "${btMap[v.ownerUid] ?? v.btBalance ?? 0}")
    
    with open('assets/js/admin-approve.js', 'w', encoding='utf-8') as f:
        f.write(content)

patch_admin_approve()
