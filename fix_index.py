import re
try:
    content = open('functions/index.js', 'r', encoding='utf-8').read()
    content = re.sub(r'exports\.getMenteeIncome\s*=\s*onCall.*?getMenteeIncome\)\);\s*', '', content, flags=re.DOTALL)
    with open('functions/index.js', 'w', encoding='utf-8') as f:
        f.write(content)
except Exception as e:
    print(e)
