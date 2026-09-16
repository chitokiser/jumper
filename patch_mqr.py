import re
try:
    content = open('assets/js/pages/merchant-qr.js', 'r', encoding='utf-8').read()
    
    content = re.sub(
        r'const unSubBt = onSnapshot\(doc\(db,\s*[\'"]merchants[\'"],\s*String\(mId\)\),\s*\(mSnap2\)\s*=>\s*\{.*?\}\);',
        r'''const mOwner = mSnap.exists() ? mSnap.data()?.ownerUid : null;
  let unSubBt = null;
  if (mOwner) {
    unSubBt = onSnapshot(doc(db, "users", mOwner), (mSnap2) => {
      if (mSnap2.exists()) {
        const btBal = Number(mSnap2.data().btBalance || 0);
        setText("qrMerchantBtBal", btBal.toLocaleString("ko-KR") + " BT");
      }
    });
  }''',
        content,
        flags=re.DOTALL
    )
    
    with open('assets/js/pages/merchant-qr.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Replaced unSubBt in merchant-qr.js!")
except Exception as e:
    print(e)
