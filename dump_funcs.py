import re
with open('treasure.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out = []
for i, line in enumerate(lines):
    if re.search(r'\b(function|async function|const .* = \(\) =>|\.then)\b', line):
        out.append(f"{i}: {line.strip()}")

with open('funcs.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))
