import re

try:
    content = open('kca_webzine.html', 'r', encoding='utf-8').read()
    
    # We replace loremflickr with picsum.photos for robust image generation
    content = re.sub(
        r'`https://loremflickr\.com/800/600/\$\{.*?\}\?lock=\$\{.*?\}\`',
        r'`https://picsum.photos/seed/${uniqueSeed}/800/600`',
        content
    )
    content = re.sub(
        r'`https://loremflickr\.com/1200/800/\$\{.*?\}\?lock=\$\{.*?\}\`',
        r'`https://picsum.photos/seed/${uniqueSeed}/1200/800`',
        content
    )

    with open('kca_webzine.html', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("kca_webzine.html images fixed!")
except Exception as e:
    print(e)
