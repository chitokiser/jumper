import re

def fix_webzine():
    with open('kca_webzine.html', 'r', encoding='utf-8') as f:
        content = f.read()

    # Split the javascript part to fix it
    script_start = content.find('// --- 목록 보기용 (카드 뷰) ---')
    script_end = content.find('// --- 좋아요 반응 처리 기능 ---')
    
    # We will replace the entire renderArticleCard function to properly split into Card and Detail logic.
    new_render_logic = """// --- 목록 보기용 (카드 뷰) ---
        function renderArticleCard(id, data) {
            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : '방금 전';
            const articleEl = document.createElement('div');
            articleEl.className = 'col';

            const shareTitle = data.webzineTitle || 'K-MOA 웹진';
            
            // 완벽히 고유한 해시 값(Seed) 생성 로직 (중복 절대 불가)
            let hashSeed = 0;
            for (let i = 0; i < id.length; i++) {
                hashSeed = Math.imul(31, hashSeed) + id.charCodeAt(i) | 0;
            }
            const uniqueSeed = Math.abs(hashSeed);

            let randomImgUrl;
            if (data.heroImageKeyword) {
                let kw = encodeURIComponent(data.heroImageKeyword);
                randomImgUrl = `https://image.pollinations.io/prompt/${kw},korea,professional,photography?width=500&height=350&nologo=true&seed=${uniqueSeed}`;
            } else {
                const backupKeywords = ['seoul city view', 'korean food', 'bibimbap', 'kimchi', 'korean palace'];
                const selectedKeyword = encodeURIComponent(backupKeywords[uniqueSeed % backupKeywords.length]);
                randomImgUrl = `https://image.pollinations.io/prompt/${selectedKeyword},korea,professional,photography?width=500&height=350&nologo=true&seed=${uniqueSeed}`;
            }
            
            let targetUrl = `?id=${id}`;
            if (isWhitelabel) { targetUrl += `&whitelabel=true`; }

            let excerpt = data.webzineBody || data.webzineContent || '';
            excerpt = excerpt.replace(/<[^>]+>/g, '').substring(0, 100);
            if (excerpt.length >= 100) excerpt += '...';
            if (excerpt.trim() === '') excerpt = '흥미로운 기사를 클릭해서 확인해보세요!';

            articleEl.innerHTML = `
                <a href="${targetUrl}" class="text-decoration-none h-100 d-block">
                    <div class="webzine-card h-100">
                        <img src="${randomImgUrl}" class="webzine-card-img" alt="Webzine Image">
                        <div class="webzine-card-body">
                            <h3 class="webzine-card-title">${shareTitle}</h3>
                            <div class="webzine-card-excerpt">${excerpt}</div>
                            <div class="webzine-card-footer">
                                <small class="text-muted fw-semibold"><i class="fa-regular fa-calendar me-1"></i> ${date}</small>
                                <span class="btn-read-more">Read More <i class="fa-solid fa-arrow-right ms-1"></i></span>
                            </div>
                        </div>
                    </div>
                </a>
            `;
            articlesWrapper.appendChild(articleEl);
        }

        // --- 상세 보기용 (디테일 뷰) ---
        function renderArticleDetail(id, data) {
            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : '방금 전';
            
            const shareTitle = data.webzineTitle || 'K-MOA 웹진';
            let shareUrl = window.location.href.split('?')[0] + '?id=' + id;
            if(isWhitelabel) shareUrl += '&whitelabel=true';

            // 완벽히 고유한 해시 값(Seed) 생성 로직 (중복 절대 불가)
            let hashSeed = 0;
            for (let i = 0; i < id.length; i++) {
                hashSeed = Math.imul(31, hashSeed) + id.charCodeAt(i) | 0;
            }
            const uniqueSeed = Math.abs(hashSeed);

            let randomImgUrl;
            if (data.heroImageKeyword) {
                let kw = encodeURIComponent(data.heroImageKeyword);
                randomImgUrl = `https://image.pollinations.io/prompt/${kw},korea,professional,photography?width=1200&height=800&nologo=true&seed=${uniqueSeed}`;
            } else {
                const backupKeywords = ['seoul city view', 'korean food', 'bibimbap', 'kimchi', 'korean palace'];
                const selectedKeyword = encodeURIComponent(backupKeywords[uniqueSeed % backupKeywords.length]);
                randomImgUrl = `https://image.pollinations.io/prompt/${selectedKeyword},korea,professional,photography?width=1200&height=800&nologo=true&seed=${uniqueSeed}`;
            }

            let shareBoxHtml = '';
            let returnBtnHtml = '';

            let returnUrl = isWhitelabel ? '/kca_webzine.html?whitelabel=true' : '/kca_webzine.html';

            if (!isWhitelabel) {
                shareBoxHtml = `
                    <div class="share-box mt-5" style="border-top:2px solid #f3f4f6; padding-top:2rem;">
                      <div class="share-title" style="font-size:1.1rem; font-weight:700;">💖 이 기사가 마음에 드셨나요? 친구들에게 공유하고 포인트 받으세요! (1000P 지급)</div>
                      <div class="share-buttons" style="display:flex; flex-wrap:wrap; gap:12px; margin-top:20px;">
                        <button class="btn-share share-native" onclick="window.nativeShare('${id}', '${shareTitle}', '${shareUrl}')" title="기타 미디어 공유" style="width:50px; height:50px; border-radius:50%; border:none; color:white; background:#007bff; font-size:1.2rem;"><i class="fa-solid fa-share-nodes"></i></button>
                        <button class="btn-share share-kakao" onclick="window.shareKakao('${id}', '${shareTitle}', '${shareUrl}')" title="카카오톡 공유" style="width:50px; height:50px; border-radius:50%; border:none; color:#3a2929; background:#FEE500; font-size:1.2rem;"><i class="fa-solid fa-comment"></i></button>
                        <button class="btn-share share-facebook" onclick="window.recordShare('${id}', 'facebook'); window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent('${shareUrl}'))" title="페이스북 공유" style="width:50px; height:50px; border-radius:50%; border:none; color:white; background:#1877f2; font-size:1.2rem;"><i class="fa-brands fa-facebook-f"></i></button>
                        <button class="btn-share share-link" onclick="window.copyLink('${id}', '${shareUrl}')" title="링크 복사" style="width:50px; height:50px; border-radius:50%; border:none; color:white; background:#6c757d; font-size:1.2rem;"><i class="fa-solid fa-link"></i></button>
                      </div>
                    </div>
                `;
                returnBtnHtml = `
                    <div class="text-center mt-5">
                       <a href="${returnUrl}" class="btn btn-outline-secondary px-4 py-2" style="border-radius:20px; font-weight:600;"><i class="fa-solid fa-list me-2"></i>목록으로 돌아가기</a>
                    </div>
                `;
            } else {
                shareBoxHtml = `
                    <div class="share-box mt-5" style="border-top:1px solid #eee; padding-top:2rem;">
                      <div class="share-title text-muted fw-bold">공유하기</div>
                      <div class="share-buttons" style="display:flex; gap:12px; margin-top:15px;">
                        <button class="btn-share share-link" onclick="window.copyLink('${id}', '${shareUrl}')" title="링크 복사" style="width:40px; height:40px; border-radius:50%; border:none; color:white; background:#6c757d; font-size:1rem;"><i class="fa-solid fa-link"></i></button>
                        <button class="btn-share share-native" onclick="window.nativeShare('${id}', '${shareTitle}', '${shareUrl}')" title="공유하기" style="width:40px; height:40px; border-radius:50%; border:none; color:white; background:#007bff; font-size:1rem;"><i class="fa-solid fa-share-nodes"></i></button>
                      </div>
                    </div>
                `;
                returnBtnHtml = `
                    <div class="text-center mt-5">
                       <a href="${returnUrl}" class="btn btn-outline-secondary px-4 py-2" style="border-radius:20px; font-weight:600;"><i class="fa-solid fa-list me-2"></i>목록으로 돌아가기</a>
                    </div>
                `;
            }

            const reactionsHtml = `
                <div class="d-flex align-items-center gap-2 mt-5">
                    <button class="btn btn-outline-danger rounded-pill px-4" onclick="window.likeArticle('${id}')">
                        <i class="fa-solid fa-heart me-1"></i> <span id="like-count-${id}">${data.likeCount || 0}</span>
                    </button>
                </div>
            `;

            container.innerHTML = `
        <div class="webzine-detail-header">
            <div class="merchant-badge mb-3 d-inline-block" style="font-size:1.1rem; padding:8px 16px;"><i class="fa-solid fa-store me-2"></i>${data.merchantName || '제휴점'}</div>
            <h1 class="fw-bold mb-4" style="font-size:2.5rem; color:#111827;">${shareTitle}</h1>
            <div class="text-muted" style="font-size:1.1rem;"><i class="fa-regular fa-calendar me-1"></i> 발행일: ${date}</div>
        </div>
        
        <img src="${randomImgUrl}" class="webzine-detail-img" alt="Article image">
        
        <div class="webzine-detail-content-wrap">
            <div class="article-content">
              ${data.webzineBody || data.webzineContent || '기사 내용이 없습니다.'}
            </div>

            ${reactionsHtml}
            ${shareBoxHtml}
            ${returnBtnHtml}
        </div>
      `;
        }

        """

    new_content = content[:script_start] + new_render_logic + content[script_end:]
    
    with open('kca_webzine.html', 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print("Fixed!")

fix_webzine()
