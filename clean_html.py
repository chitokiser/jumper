import re

try:
    content = open('family-register.html', 'r', encoding='utf-8').read()
    
    content = re.sub(r'수탁 지갑 생성 및 온체인 회원 등록까지 완료해 주셔야 가맹점 승인이 가능합니다\.', '간단한 정보 입력만으로 가맹점 신청이 완료됩니다.', content, flags=re.DOTALL)
    # also try this if there are span/br tags
    content = re.sub(r'수탁 지갑 생성 및 온체인.*?가능합니다\.', '간단한 정보 입력만으로 가맹점 신청이 완료됩니다.', content, flags=re.DOTALL)
    
    content = re.sub(r'등록 즉시 온체인에 가맹점이 생성되며, 초기 수수료\(10%\)는 관리자가 승인 후 적용됩니다\.', '등록 즉시 가맹점이 생성되며, 시스템 승인 후 활동이 가능해집니다.', content, flags=re.DOTALL)

    with open('family-register.html', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Done html cleaning")
except Exception as e:
    print(e)
