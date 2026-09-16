import re
import sys
sys.stdout.reconfigure(encoding='utf-8')
try:
    content = open('kca_webzine.html', 'r', encoding='utf-8').read()
    idx = content.find('function renderArticleCard')
    idx_end = content.find('}', idx)
    # let's just write to out.txt
    with open('out.txt', 'w', encoding='utf-8') as f:
        f.write(content[idx:content.find('</script>', idx)])
except Exception as e:
    print(e)
