import re
try:
    content = open('assets/js/auth.js', 'r', encoding='utf-8').read()
    idx = content.find('async function login')
    with open('dump.txt', 'w', encoding='utf-8') as f:
        f.write(content[idx:idx+1500])
except Exception as e:
    print(e)
