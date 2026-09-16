import re
with open('functions/handlers/onboarding.js', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('async function getMyMentees(uid) {')
with open('functions/debug.txt', 'w', encoding='utf-8') as fw:
    fw.write(content[idx:idx+3500])
