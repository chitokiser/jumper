import re
try:
    content = open('functions/handlers/transaction.js', 'r', encoding='utf-8').read()
    idx = content.find('async function receiveBtQrFirebase(uid, data) {')
    idx2 = content.find('try {', idx+500)
    print(content[idx:idx2+500])
except Exception as e:
    print(e)
