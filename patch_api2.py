import re
try:
    content = open('functions/handlers/merchantApi.js', 'r', encoding='utf-8').read()
    
    content = content.replace("km: ownerData.wallet?.pointBalance || 0,", "km: ownerData.pointBalanceVnd || ownerData.wallet?.pointBalance || 0,")
    
    with open('functions/handlers/merchantApi.js', 'w', encoding='utf-8') as f:
        f.write(content)
except Exception as e:
    print(e)
