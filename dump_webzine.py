import re
try:
    content = open('kca_webzine.html', 'r', encoding='utf-8').read()
    scripts = re.findall(r'<script.*?type="module".*?>(.*?)</script>', content, re.DOTALL)
    for i, s in enumerate(scripts):
        with open('temp_webzine.js', 'w', encoding='utf-8') as f:
            f.write(s)
            break
except Exception as e:
    print(e)
