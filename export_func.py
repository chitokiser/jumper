import re

try:
    content = open('functions/index.js', 'r', encoding='utf-8').read()
    
    inject = "exports.merchantSendBtDirect = onCall(wrapError(require('./handlers/merchantReward').merchantSendBtDirect));\n"
    
    if "merchantSendBtDirect" not in content:
        # Just append it
        content += "\n" + inject
    
    with open('functions/index.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Exported to index.js!")
except Exception as e:
    print(e)
