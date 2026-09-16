import re

try:
    content = open('functions/handlers/merchantReward.js', 'r', encoding='utf-8').read()
    
    idx = content.find('exports.receiveBtQrFirebase')
    print(content[idx:idx+1500])
except Exception as e:
    print(e)
