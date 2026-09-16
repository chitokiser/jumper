import re
try:
    content = open('kca_webzine.html', 'r', encoding='utf-8').read()
    idx = content.find('function renderArticleCard')
    print(content[idx:idx+1500])
except Exception as e:
    print(e)
