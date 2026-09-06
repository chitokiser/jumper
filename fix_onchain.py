import re

try:
    content = open('functions/handlers/transaction.js', 'r', encoding='utf-8').read()
    
    # We will replace the entire function body of registerMerchantOnChain
    old_func_pattern = r'async function registerMerchantOnChain\(uid, metadataURI, merchantData, masterSecret\)\s*\{.*?return \{ txHash: receipt\.hash, merchantId \};\n\}'
    
    # Let me just manually splice it string-wise to be safer, or regex if strict
    func_start = 'async function registerMerchantOnChain(uid, metadataURI, merchantData, masterSecret) {'
    func_end = 'return { txHash: receipt.hash, merchantId };\n}'
    
    idx_start = content.find(func_start)
    if idx_start == -1:
        print("Function signature not found")
    else:
        # Since the end might differ slightly, let's look for the next "async function" 
        # or the exact known end string.
        idx_end = content.find('return { txHash: receipt.hash, merchantId };', idx_start)
        
        replacement = """async function registerMerchantOnChain(uid, metadataURI, merchantData, masterSecret) {
  // onChain removed as per user request
  const merchantId = Math.floor(Date.now() / 1000); 

  await db.collection('merchants').doc(String(merchantId)).set({
    merchantId,
    ownerUid: uid,
    ownerAddress: "offchain-" + uid,
    ...merchantData,
    feeBps: 0,
    active: true,
    txHash: "offchain",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('users').doc(uid).set({
    merchantId
  }, { merge: true });

  return { txHash: "offchain", merchantId };"""
        
        content = content[:idx_start] + replacement + content[idx_end + len('return { txHash: receipt.hash, merchantId };'):]
        
        with open('functions/handlers/transaction.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Replaced!")
except Exception as e:
    print(e)
