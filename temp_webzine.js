
        import { db } from '/assets/js/firestore-bridge.js';
        import { collection, query, orderBy, limit, getDocs, doc, getDoc, updateDoc, increment, addDoc, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
        import { functions } from '/assets/js/firebase-init.js';
        import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

        const urlParams = new URLSearchParams(window.location.search);
        const specificId = urlParams.get('id');
        const isWhitelabel = urlParams.get('whitelabel') === 'true';

        // Header / Footer 임시 로드 (화이트라벨 모드 시 숨김 처리)
        if (!isWhitelabel) {
            fetch('/partials/header.html').then(r => r.text()).then(html => {
                document.getElementById('header-placeholder').innerHTML = html;
            });
        } else {
            document.getElementById('header-placeholder').style.display = 'none';
        }

        const container = document.getElementById('webzine-container');
        const loading = document.getElementById('loading-spinner');
        let currentSocialShorts = null;

        let articlesWrapper = document.getElementById('articles-grid');
        async function loadWebzines() {
            try {
                const snap = await getDocs(
                    query(collection(db, 'kca_webzine'), orderBy('createdAt', 'desc'), limit(12))
                );

                loading.style.display = 'none';

                if (snap.empty) {
                    container.innerHTML = `<div class="text-center text-muted py-5">아직 발행된 기사가 없습니다.</div>`;
                    return;
                }

                if (!articlesWrapper) {
                    articlesWrapper = document.createElement('div');
                    articlesWrapper.className = 'row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4';
                    articlesWrapper.id = 'articles-grid';
                    container.appendChild(articlesWrapper);
                }

                snap.forEach(docSnap => {
                    const data = docSnap.data();
                    renderArticleCard(docSnap.id, data);
                });
            } catch (err) {
                console.error(err);
                loading.innerHTML = `<p class="text-danger">웹진 데이터를 불러오는데 실패했습니다.</p>`;
            }
        }

        // --- 목록 보기용 (카드 뷰) ---
        function renderArticleCard(id, data) {
            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : '방금 전';
            const articleEl = document.createElement('div');
            articleEl.className = 'col';

            const shareTitle = data.webzineTitle || 'K-MOA 웹진';
            const shareUrl = window.location.href.split('?')[0] + '?id=' + id;

            // 완벽히 고유한 해시 값(Seed) 생성 로직 (중복 절대 불가)
            let hashSeed = 0;
            for (let i = 0; i < id.length; i++) {
                hashSeed = Math.imul(31, hashSeed) + id.charCodeAt(i) | 0;
            }
            const uniqueSeed = Math.abs(hashSeed);

            let randomImgUrl;
            if (data.heroImageKeyword) {
                // 키워드가 있는 기사는 플리커에서 실시간 당겨오기
                randomImgUrl = `https://loremflickr.com/800/600/${encodeURIComponent(data.heroImageKeyword)}?lock=${uniqueSeed}`;
            } else {
                // 키워드 없는 옛날 기사들은 절대 겹치지 않는 무작위 한국 관련 고화질 사진 배정
                const backupKeywords = ['korea', 'seoul', 'koreanfood', 'bibimbap', 'kimchi', 'koreanbbq'];
                const selectedKeyword = backupKeywords[uniqueSeed % backupKeywords.length];
                randomImgUrl = `https://loremflickr.com/800/600/${selectedKeyword}?lock=${uniqueSeed}`;
            }

            // 본문에서 HTML 태그를 제거하고 짧은 요약글만 추출
            const rawBody = data.webzineBody || data.webzineContent || '기사 내용이 없습니다.';
            const plainText = rawBody.replace(/<[^>]+>/g, '');
            const excerpt = plainText.substring(0, 100) + (plainText.length > 100 ? '...' : '');

            articleEl.innerHTML = `
        <div class="webzine-card">
          <img src="${randomImgUrl}" class="webzine-card-img" alt="Article image" loading="lazy">
          <div class="webzine-card-body">
            <div class="merchant-badge mb-2"><i class="fa-solid fa-store me-2"></i>${data.merchantName || '제휴점'}</div>
            <h5 class="webzine-card-title">${data.webzineTitle}</h5>
            <div class="text-muted mb-3 small"><i class="fa-regular fa-calendar me-1"></i> ${date}</div>
            <div class="webzine-card-excerpt">${excerpt}</div>
            <div class="webzine-card-footer">
              <span class="text-primary fw-bold small"><i class="fa-solid fa-gem me-1"></i>공유 1000P</span>
              <a href="${shareUrl}" class="btn-read-more">기사 읽기 & 공유</a>
            </div>
          </div>
        </div>
      `;
            articlesWrapper.appendChild(articleEl);
        }

        // --- 상세 보기용 ---
        function renderArticleDetail(id, data) {
            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : '방금 전';
            const articleEl = document.createElement('div');

            const shareTitle = data.webzineTitle || 'K-MOA 웹진';
            const shareUrl = window.location.href.split('?')[0] + '?id=' + id;
            const shortsJson = JSON.stringify(data.socialShorts || {}).replace(/"/g, '&quot;');

            let hashSeed = 0;
            for (let i = 0; i < id.length; i++) {
                hashSeed = Math.imul(31, hashSeed) + id.charCodeAt(i) | 0;
            }
            const uniqueSeed = Math.abs(hashSeed);

            let randomImgUrl;
            if (data.heroImageKeyword) {
                randomImgUrl = `https://loremflickr.com/1200/800/${encodeURIComponent(data.heroImageKeyword)}?lock=${uniqueSeed}`;
            } else {
                const backupKeywords = ['korea', 'seoul', 'koreanfood', 'bibimbap', 'kimchi', 'koreanbbq'];
                const selectedKeyword = backupKeywords[uniqueSeed % backupKeywords.length];
                randomImgUrl = `https://loremflickr.com/1200/800/${selectedKeyword}?lock=${uniqueSeed}`;
            }

            let shareBoxHtml = '';
            let returnBtnHtml = '';

            // 화이트라벨(민감 가맹점) 모드일 때는 K-MOA 특정 문구 "포인트 받으세요!"와 메인으로 돌아가는 버튼을 안 보이게 숨김
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
                       <a href="/kca_webzine.html" class="btn btn-outline-secondary px-4 py-2" style="border-radius:20px; font-weight:600;"><i class="fa-solid fa-list me-2"></i>목록으로 돌아가기</a>
                    </div>
                `;
            } else {
                // 화이트라벨 모드용 깔끔한 공유 기능 
                shareBoxHtml = `
                    <div class="share-box mt-5" style="border-top:1px solid #eee; padding-top:2rem;">
                      <div class="share-title text-muted fw-bold">공유하기</div>
                      <div class="share-buttons" style="display:flex; gap:12px; margin-top:15px;">
                        <button class="btn-share share-link" onclick="window.copyLink('${id}', '${shareUrl}')" title="링크 복사" style="width:40px; height:40px; border-radius:50%; border:none; color:white; background:#6c757d; font-size:1rem;"><i class="fa-solid fa-link"></i></button>
                        <button class="btn-share share-native" onclick="window.nativeShare('${id}', '${shareTitle}', '${shareUrl}')" title="공유하기" style="width:40px; height:40px; border-radius:50%; border:none; color:white; background:#007bff; font-size:1rem;"><i class="fa-solid fa-share-nodes"></i></button>
                      </div>
                    </div>
                `;
            }

            // 좋아요 & 댓글 UI
            const reactionsHtml = `
                <div class="d-flex align-items-center gap-2 mt-5">
                    <button class="btn btn-outline-danger rounded-pill px-4" onclick="window.likeArticle('${id}')">
                        <i class="fa-solid fa-heart me-1"></i> <span id="like-count-${id}">${data.likeCount || 0}</span>
                    </button>
                </div>
            `;

            articleEl.innerHTML = `
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
            container.appendChild(articleEl);
        }

        // --- 좋아요 반응 처리 기능 ---
        window.likeArticle = async function (webzineId) {
            try {
                const docRef = doc(db, 'kca_webzine', webzineId);
                await updateDoc(docRef, {
                    likeCount: increment(1)
                });
                const countSpan = document.getElementById(`like-count-${webzineId}`);
                if (countSpan) countSpan.innerText = parseInt(countSpan.innerText) + 1;
                // 하트 애니메이션이나 알림
            } catch (err) {
                console.error('좋아요 실패:', err);
                alert("처리 중 오류가 발생했습니다.");
            }
        };

        // 보상 지급 호출 함수
        window.recordShare = async function (webzineId, platform) {
            try {
                const claimWebzineShareReward = httpsCallable(functions, 'claimWebzineShareReward');
                const res = await claimWebzineShareReward({ webzineId, platform });
                if (res.data && res.data.success) {
                    alert(`🎉 공유 감사합니다! 기본 포인트 ${res.data.reward}P가 적립되었습니다.`);
                }
            } catch (err) {
                console.log('포인트 지급 스킵:', err.message);
            }
        }

        // 네이티브 Web Share
        window.nativeShare = function (id, title, url) {
            if (navigator.share) {
                navigator.share({
                    title: title,
                    text: 'K-MOA 웹진에서 흥미로운 기사를 발견했어요!',
                    url: url
                }).then(() => window.recordShare(id, 'native')).catch((error) => console.log('공유 실패', error));
            } else {
                alert("이 브라우저에서는 공유 기능이 지원되지 않습니다.");
            }
        }

        // 카카오톡 공유
        window.shareKakao = function (id, title, url) {
            if (window.Kakao && Kakao.isInitialized()) {
                Kakao.Share.sendDefault({
                    objectType: 'feed',
                    content: {
                        title: title,
                        description: 'K-MOA 웹진 - 현지의 K-Culture 정보와 혜택을 한눈에!',
                        imageUrl: 'https://kmoa.netlify.app/assets/images/jump/logo512.png',
                        link: { mobileWebUrl: url, webUrl: url },
                    },
                    buttons: [
                        { title: '웹진 보러가기', link: { mobileWebUrl: url, webUrl: url } },
                    ],
                });
                window.recordShare(id, 'kakao');
            } else {
                alert("카카오톡SDK 초기화 오류");
            }
        }

        // 링크 복사
        window.copyLink = function (id, url) {
            navigator.clipboard.writeText(url).then(() => {
                alert('링크가 복사되었습니다!');
                window.recordShare(id, 'link');
            });
        }

        // 소셜 숏폼 모달
        const shortsModalEl = new bootstrap.Modal(document.getElementById('socialShortsModal'));
        const shortsTextarea = document.getElementById('shortsTextarea');
        let currentShareId = null;

        window.openShortsModal = function (id, shortsData, type) {
            currentShareId = id;
            let text = "즐거운 웹진 기사를 확인해보세요!";
            let typeName = "SNS 공유용";
            if (shortsData) {
                if (type === 'instagram' && shortsData.instagram) { text = shortsData.instagram; typeName = "📷 인스타그램용"; }
                else if (type === 'twitter' && shortsData.twitter) { text = shortsData.twitter; typeName = "트위터용"; }
                else if (type === 'threads' && shortsData.threads) { text = shortsData.threads; typeName = "스레드용"; }
                else if (type === 'tiktok' && shortsData.tiktok) { text = shortsData.tiktok; typeName = "🎵 틱톡 캡션용"; }
            }

            shortsTextarea.value = text;
            document.getElementById('socialShortsTitle').innerText = `${typeName} 텍스트 복사`;
            shortsModalEl.show();
        }

        document.getElementById('btnCopyShorts').addEventListener('click', () => {
            shortsTextarea.select();
            navigator.clipboard.writeText(shortsTextarea.value).then(() => {
                alert('텍스트가 성공적으로 복사되었습니다! SNS 앱을 열고 붙여넣기 해주세요.\n\n앱으로 이동 시 사진과 함께 웹진 주소(URL)를 올려주시면 더욱 좋습니다.');
                shortsModalEl.hide();
                if (currentShareId) window.recordShare(currentShareId, 'social_shorts');
            });
        });

        // 하단 specificId 체크문 (위에서 선언됨)
        if (specificId) {
            import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js').then((module) => {
                const getDoc = module.getDoc;
                const docRef = module.doc;
                getDoc(docRef(db, 'kca_webzine', specificId)).then(docSnap => {
                    loading.style.display = 'none';
                    if (docSnap.exists()) {
                        renderArticleDetail(docSnap.id, docSnap.data());
                    } else {
                        container.innerHTML = `<div class="text-center text-muted py-5">해당 기사를 찾을 수 없습니다.</div>`;
                    }
                }).catch(err => {
                    console.error(err);
                    loading.innerHTML = `< p class="text-danger" > 기사를 불러오는데 실패했습니다.</p >`;
                });
            });
        } else {
            loadWebzines();
        }
    