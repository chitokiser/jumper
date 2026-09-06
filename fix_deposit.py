import re

try:
    content = open('assets/js/pages/mypage.js', 'r', encoding='utf-8').read()
    
    # Force dropdown or default to VND entirely where KRW was defaulting
    content = content.replace('if (d.amountKrw) drParts.push((d.amountKrw || 0).toLocaleString() + "원");',
                              '')
    content = content.replace('? { amountVnd: amountVal, currency: "VND", depositorName }',
                              '? { amountVnd: amountVal, currency: "VND", depositorName }')
    content = content.replace(': { amountKrw: amountVal, currency: "KRW", depositorName };',
                              ': { amountVnd: amountVal, currency: "VND", depositorName };')
                              
    with open('assets/js/pages/mypage.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("mypage.js deposit fixed completely!")
except Exception as e:
    print(e)
