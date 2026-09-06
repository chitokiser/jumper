import re

try:
    content = open('kca_webzine.html', 'r', encoding='utf-8').read()
    
    # We have two render functions: renderArticleCard (800x600) and renderArticleDetail (1200x800)
    
    block_card = """            let randomImgUrl;
            if (data.heroImageKeyword) {
                let kw = encodeURIComponent(data.heroImageKeyword);
                randomImgUrl = `https://image.pollinations.io/prompt/${kw},korea,professional,photography?width=800&height=600&nologo=true&seed=${uniqueSeed}`;
            } else {
                const backupKeywords = ['seoul city view', 'korean food', 'bibimbap', 'kimchi', 'korean palace'];
                const selectedKeyword = encodeURIComponent(backupKeywords[uniqueSeed % backupKeywords.length]);
                randomImgUrl = `https://image.pollinations.io/prompt/${selectedKeyword},korea,professional,photography?width=800&height=600&nologo=true&seed=${uniqueSeed}`;
            }"""
            
    block_detail = """            let randomImgUrl;
            if (data.heroImageKeyword) {
                let kw = encodeURIComponent(data.heroImageKeyword);
                randomImgUrl = `https://image.pollinations.io/prompt/${kw},korea,professional,photography?width=1200&height=800&nologo=true&seed=${uniqueSeed}`;
            } else {
                const backupKeywords = ['seoul city view', 'korean food', 'bibimbap', 'kimchi', 'korean palace'];
                const selectedKeyword = encodeURIComponent(backupKeywords[uniqueSeed % backupKeywords.length]);
                randomImgUrl = `https://image.pollinations.io/prompt/${selectedKeyword},korea,professional,photography?width=1200&height=800&nologo=true&seed=${uniqueSeed}`;
            }"""

    # We can replace the current logic with a simple regex
    content = re.sub(
        r'let randomImgUrl;\s*if \(data\.heroImageKeyword\) \{.*?\}(?=\s*// 본문에서 HTML)',
        block_card,
        content,
        flags=re.DOTALL
    )
    
    content = re.sub(
        r'let randomImgUrl;\s*if \(data\.heroImageKeyword\) \{.*?\}(?=\s*let shareBoxHtml =)',
        block_detail,
        content,
        flags=re.DOTALL
    )
    
    with open('kca_webzine.html', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Images updated to pollinations AI!")
except Exception as e:
    print(e)
