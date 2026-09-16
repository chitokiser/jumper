import re
try:
    content = open('functions/handlers/transaction.js', 'r', encoding='utf-8').read()
    idx = content.find('async function receiveBtQrFirebase(uid, data) {')
    idx_end = content.find('return', idx)
    with open('dump_out.txt', 'w', encoding='utf-8') as f:
        f.write(content[idx:idx_end + 300])
except Exception as e:
    print(e)
