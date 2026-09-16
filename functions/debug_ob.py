import re
content = open('handlers/onboarding.js', 'r', encoding='utf-8').read()
with open('debug_onboarding.txt', 'w', encoding='utf-8') as f:
    f.write(content[-1500:])
