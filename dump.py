import re

try:
    content = open('assets/js/pages/mypage.js', 'r', encoding='utf-8').read()
    
    # We want to dump the btnDeposit request function
    idx = content.find('requestDeposit')
    if idx != -1:
        print(content[idx-500:idx+1500])
except:
    pass
