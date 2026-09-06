import re
try:
    content = open('functions/handlers/transaction.js', 'r', encoding='utf-8').read()
    collections = set(re.findall(r'db\.collection\([\'"](.*?)[\'"]\)', content))
    print(list(collections))
except Exception as e:
    print(e)
