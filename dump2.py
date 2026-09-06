import re
try:
    content = open('assets/js/pages/mypage.js', 'r', encoding='utf-8').read()
    idx = content.find('function loadDepositHistory')
    print(content[idx:idx+1500].encode('cp949', 'ignore').decode('cp949'))
except Exception as e:
    print(e)
