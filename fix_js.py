import traceback
import re

try:
    content = open('assets/js/pages/family-register.js', 'r', encoding='utf-8').read()
    
    # 1. Replace "온체인 등록 실패" -> "가맹점 등록 실패"
    content = content.replace('온체인 등록 실패', '가맹점 등록 실패')
    
    # 2. Replace "온체인 등록 중..." -> "가맹점 등록 중..."
    content = content.replace('setState("온체인 등록 중...");', 'setState("가맹점 등록 중...");')
    
    # 3. Replace "온체인 registerMerchant" -> "registerMerchant"
    content = content.replace('온체인 registerMerchant + Firestore 저장', '가맹점 등록 + Firestore 저장')

    with open('assets/js/pages/family-register.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("family-register.js fixed!")
except Exception as e:
    print(e)
