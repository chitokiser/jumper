import re
try:
    content = open('functions/handlers/moneyTree.js', 'r', encoding='utf-8').read()
    
    # Let's search for "return {" inside mentees.map
    old_return = """      return {
        id: d.id,
        name: data.name || '—',
        email: data.email || '—',
        walletAddress: data.walletAddress || '—',
        registeredAt: data.registeredAt ? data.registeredAt.toMillis() : null,
      };"""
      
    new_return = """      return {
        id: d.id,
        name: data.name || '—',
        email: data.email || '—',
        walletAddress: data.walletAddress || '—',
        registeredAt: data.registeredAt ? data.registeredAt.toMillis() : null,
        generatedForMentor: data.generatedForMentor || 0,
        generatedForGrandMentor: data.generatedForGrandMentor || 0
      };"""
      
    # use regex because spacing might differ
    content = re.sub(r"return\s*\{\s*id:\s*d\.id,\s*name:\s*data\.name[^\}]*?registeredAt:[^\}]*?\};", new_return, content, flags=re.DOTALL)
    
    with open('functions/handlers/moneyTree.js', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("moneyTree updated!")
except Exception as e:
    print(e)
