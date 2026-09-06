import re
try:
    content = open('functions/handlers/transaction.js', 'r', encoding='utf-8').read()
    idx = content.find('mentorBonusVnd =')
    print(content[idx-100:idx+600])
except Exception as e:
    print(e)
