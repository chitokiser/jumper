import re
try:
    content = open('assets/js/pages/mypage.js', 'r', encoding='utf-8').read()
    idx = content.find('function loadMentees()')
    print(content[idx:idx+1200])
except Exception as e:
    print(e)
