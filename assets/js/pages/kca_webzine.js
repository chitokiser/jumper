// /assets/js/pages/kca_webzine.js
import { db } from "/assets/js/auth.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  setDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { WEBZINE_20_ARTICLES } from "./webzine-seed-data.js";

const $ = (id) => document.getElementById(id);

let _allArticles = [];
let _activeCategory = "all";
let _searchQuery = "";
let _currentArticleId = null;

/**
 * 기사 좋아요(Like) 영속 헬퍼
 */
function getArticleLikes(articleId) {
  const saved = localStorage.getItem("wz_likes_" + articleId);
  if (saved !== null) return parseInt(saved, 10) || 0;
  let hash = 0;
  for (let i = 0; i < articleId.length; i++) hash += articleId.charCodeAt(i);
  const initialLikes = 18 + (hash % 28);
  localStorage.setItem("wz_likes_" + articleId, initialLikes);
  return initialLikes;
}

function isArticleLiked(articleId) {
  return localStorage.getItem("wz_liked_" + articleId) === "true";
}

function toggleArticleLike(articleId) {
  const liked = !isArticleLiked(articleId);
  let count = getArticleLikes(articleId);
  count = liked ? count + 1 : Math.max(0, count - 1);
  localStorage.setItem("wz_liked_" + articleId, liked ? "true" : "false");
  localStorage.setItem("wz_likes_" + articleId, count);
  return { liked, count };
}

/**
 * 기사 독자 댓글(Comments) 영속 헬퍼
 */
function getArticleComments(articleId) {
  const saved = localStorage.getItem("wz_comments_" + articleId);
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  const initialComments = [
    {
      author: "하노이 미딩 교민",
      text: "유용한 정보 감사드립니다! 주말에 가맹점 방문해서 포인트 혜택 받아봐야겠네요.",
      time: "2시간 전"
    },
    {
      author: "박*호 (주재원)",
      text: "베스트클럽 웹진 큐레이션 덕분에 현지 생활 꿀팁 많이 얻어갑니다 👍",
      time: "방금 전"
    }
  ];
  localStorage.setItem("wz_comments_" + articleId, JSON.stringify(initialComments));
  return initialComments;
}

function addArticleComment(articleId, author, text) {
  const list = getArticleComments(articleId);
  list.unshift({
    author: author || "익명 독자",
    text: text,
    time: "방금 전"
  });
  localStorage.setItem("wz_comments_" + articleId, JSON.stringify(list));
  return list;
}

/**
 * 기본 시드 아티클 (최초 방문 시에도 풍성한 볼거리 제공)
 */
const DEFAULT_PRESET_ARTICLES = [
  {
    id: "preset-chicken-culture",
    title: "하노이 미딩에서 발견한 한국식 치킨과 K-푸드의 진정한 풍미",
    subtitle: "현지 미식가들의 입맛까지 사로잡은 바삭한 튀김옷과 비법 양념의 깊은 조화",
    category: "K-푸드",
    summary: "이국적인 하노이의 밤, 따뜻한 온기와 바삭한 식감으로 하루의 피로를 녹여주는 한국식 푸드 문화가 하노이 교민과 현지인들 사이에서 뜨거운 사랑을 받고 있습니다.",
    content: `### 1. 하노이에 불어온 K-치킨 열풍, 그 특별한 비결\n\n베트남 하노이 거리를 걷다 보면 은은하게 풍겨오는 익숙하고 고소한 치킨 향기가 발걸음을 멈추게 합니다. 한국의 '치맥(치킨+맥주)' 문화는 이제 단순한 유행을 넘어, 소중한 사람들과 둘러앉아 따뜻한 정을 나누는 독보적인 식문화로 자리 잡았습니다.\n\n특히 하노이의 대표적인 한인 타운인 미딩(My Dinh)을 중심으로, 한국 정통 레시피 그대로 튀겨낸 겉바속촉 치킨과 깊은 풍미의 숙성 양념은 한국 교민뿐 아니라 베트남 현지 젊은 층 사이에서도 '꼭 경험해야 할 K-푸드'로 손꼽힙니다.\n\n### 2. 바삭함 뒤에 숨겨진 정성과 신선한 재료\n\n진정한 한식의 감동은 타협하지 않는 식재료의 신선함에서 출발합니다. 겉은 바삭하면서도 속살은 육즙을 가득 머금은 완벽한 튀김 기술, 그리고 한국에서 공수한 비법 양념의 조화는 한 입 베어 무는 순간 감탄을 자아냅니다.\n\n바쁜 일상을 마친 저녁, 시원한 음료와 함께 즐기는 따끈한 치킨 한 조각은 타국 생활의 향수를 달래주는 가장 확실한 힐링입니다.\n\n### 3. 베스트클럽 가맹점 혜택으로 더욱 풍성하게\n\n베스트클럽 멤버십 회원이라면 맛있는 식사와 함께 잊지 못할 혜택까지 누릴 수 있습니다. 매장 방문 결제 시 즉시 5% 포인트 페이백이 적립되며, 글로벌 잭팟에 참여할 수 있는 보너스 티켓(BT)이 즉시 발급됩니다.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1590301157890-4810ed352733?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 김하늘",
    dateStr: "2026. 10. 13",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "대한치킨 & 대한김치",
      category: "K-푸드 치킨 전문점",
      region: "하노이 미딩 송다 한인타운",
      address: "하노이 미딩 송다 CT1 정문 앞",
      description: "매일 아침 신선한 계육과 한국 직수송 양념으로 정성을 다하는 베스트클럽 대표 가맹점",
      phone: "024-3787-8899",
      hours: "매일 11:00 ~ 23:30",
      signatureMenu: "한국식 크리스피 후라이드 & 특제 마늘간장 치킨, 전통 배추김치",
      benefit: "베스트클럽 결제 시 5% 즉시 포인트 페이백 + 잭팟 보너스티켓(BT) 즉시 발급!",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[베스트 매거진 픽 ✨] 하노이 미딩에서 발견한 한국식 치킨의 진한 풍미!\n\n오늘 저녁 바삭한 치킨에 시원한 한 잔 어떠세요? 🍗\n\n📍 기사 제공 | 대한치킨 & 대한김치\n- 위치: 하노이 미딩 송다 CT1 정문 앞\n- 혜택: 베스트클럽 회원 결제 시 5% 포인트 페이백 + 잭팟 BT 티켓 증정!\n\n#베스트클럽 #하노이맛집 #K푸드 #하노이치킨 #미딩맛집",
      x: "[베스트 매거진] 하노이에서 즐기는 한국식 치킨 문화의 모든 것!\n대한치킨과 함께하는 바삭한 힐링 타임. 결제 시 5% 포인트 페이백 혜택까지 만나보세요.\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "하노이 살면서 가장 그리운 한국의 맛은 무엇인가요? 🍗 퇴근길 바삭한 치킨 한 마리면 하루 피로가 싹 가시죠. 미딩 '대한치킨'에서 베스트클럽 혜택과 함께 즐겨보세요!",
      facebook: "[베스트 클럽 웹진 카드뉴스] 하노이 미딩에서 만나는 한국식 치킨의 매력!\n정통 레시피로 완성한 바삭한 치킨과 공식 가맹점 혜택을 웹진에서 확인하세요."
    }
  },
  {
    id: "preset-k-beauty-hanoi",
    title: "동남아 기후를 이기는 K-뷰티: 투명한 유리알 피부 스킨케어",
    subtitle: "고온다습한 하노이 날씨 속에서도 무너지지 않는 수분 진정 솔루션",
    category: "K-뷰티",
    summary: "강한 자외선과 습도 속에서도 맑고 건강한 피부 컨디션을 유지하는 한국식 피부 관리 루틴이 하노이 트렌드세터들의 주목을 받고 있습니다.",
    content: `### 1. 가볍지만 깊은 수분, 레이어링의 기술\n\n베트남의 열대 기후에서는 유분기를 줄이고 수분을 촘촘하게 채워주는 워터리 에센스와 수딩 젤의 단계별 레이어링이 필수입니다.\n\n### 2. 안심할 수 있는 정품 케어와 프리미엄 에스테틱\n\n하노이 현지에서도 검증된 한국 뷰티 에스테틱 브랜드와 전문 케어 샵을 찾는 발길이 꾸준히 늘고 있습니다.\n\n### 3. 일상 속 뷰티 케어와 멤버십 혜택\n\n베스트클럽 제휴 뷰티 살롱에서 전문적인 상담과 함께 특별한 페이백 혜택을 경험해 보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80",
    readTime: "2분 읽기",
    author: "에디터 이수민",
    dateStr: "2026. 10. 12",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "K-스킨 에스테틱 & 뷰티",
      category: "K-뷰티 스킨케어 전문",
      region: "하노이 쭝화 (Trung Hoa)",
      address: "하노이 쭝화 냔칭 12동",
      description: "한국 정품 뷰티 제품과 전문 테라피스트의 1:1 맞춤 케어",
      phone: "024-3555-7788",
      hours: "매일 09:30 ~ 20:30",
      signatureMenu: "유리알 수분 진정 케어, 브라이트닝 스페셜 코스",
      benefit: "베스트클럽 회원 전용 5% 즉시 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[K-뷰티 꿀팁 ✨] 하노이 습한 날씨에도 끄떡없는 유리알 피부 관리법!\n가맹점 혜택으로 더욱 스마트하게 예뻐지세요. #K뷰티 #하노이스킨케어 #베스트클럽",
      x: "[베스트 매거진] 하노이에서 만나는 정통 K-뷰티 스킨케어 트렌드!\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "열대 기후에서도 피부 광채 유지하는 꿀팁 💧 여러분만의 스킨케어 루틴이 있나요?",
      facebook: "[베스트 클럽 웹진] 하노이 K-뷰티 트렌드 리포트: 맑고 투명한 피부를 위한 에디터 추천"
    }
  },
  {
    id: "preset-hanoi-life-mydinh",
    title: "하노이 속 작은 한국: 미딩(My Dinh) 라이프스타일 가이드",
    subtitle: "처음 방문한 주재원과 여행자도 단숨에 적응하는 알짜 생활 정보와 추천 동선",
    category: "하노이 라이프",
    summary: "편리한 인프라와 정겨운 정취가 공존하는 하노이 미딩 한인타운의 숨은 명소와 실속 있는 생활 팁을 정리했습니다.",
    content: `### 1. 하노이 미딩, 교민 문화의 중심지\n\n다양한 한식당, 베이커리, 마트, 병원 등이 밀집한 미딩은 하노이에서 가장 편리하게 한국의 생활 편의를 누릴 수 있는 지역입니다.\n\n### 2. 검증된 베스트클럽 가맹점 탐방\n\n베스트클럽 인증 마크가 있는 가맹점에서는 결제와 동시에 포인트가 쌓이고 글로벌 잭팟의 행운까지 함께 누릴 수 있습니다.\n\n### 3. 스마트한 하노이 라이프 시작하기\n\n지역 커뮤니티와 연계된 스마트 결제 시스템으로 더욱 풍요롭고 편리한 타국 생활을 즐겨보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80",
    readTime: "4분 읽기",
    author: "에디터 박준형",
    dateStr: "2026. 10. 11",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "대한마트 & 생활편의",
      category: "생활 유통 / 한인 마트",
      region: "하노이 미딩 송다",
      address: "하노이 미딩 송다 더매너 상가 1층",
      description: "한국 신선식품과 생활 필수품을 신속하게 공급하는 미딩 대표 마트",
      phone: "024-3999-1234",
      hours: "매일 08:00 ~ 23:00",
      signatureMenu: "한국 직수입 신선 농산물, 프리미엄 밀키트",
      benefit: "베스트클럽 회원 전 품목 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[하노이 라이프 🏙️] 미딩 한인타운 200% 활용하는 꿀팁 대방출!\n베스트클럽 가맹점과 함께 실속 있는 하노이 생활을 시작하세요. #하노이생활 #미딩 #베스트클럽",
      x: "[베스트 매거진] 하노이 미딩 라이프스타일 가이드! 알찬 생활 정보와 가맹점 혜택 확인하기\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "하노이 미딩에서 가장 자주 찾는 단골 매장은 어디인가요? 생활 꿀팁 나눠주세요! 🏢",
      facebook: "[베스트 클럽 웹진] 하노이 미딩 라이프 가이드: 교민과 여행자를 위한 필수 추천"
    }
  }
];

/**
 * 마크다운 간단 HTML 변환기
 */
function parseMarkdownToHtml(mdText) {
  if (!mdText) return "";
  let html = mdText
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>");

  return html
    .split("\n\n")
    .map((p) => (p.startsWith("<h") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
    .join("");
}

/**
 * 기사 목록 로드 (즉시 렌더링 + Firestore 백그라운드 동기화)
 */
async function loadWebzineArticles() {
  const featLoading = $("featuredStoryLoading");

  // 1. 대기 시간 0초(Zero Latency): 프리셋 20개 기사로 즉각 화면 렌더링
  if (_allArticles.length === 0) {
    _allArticles = Array.isArray(WEBZINE_20_ARTICLES) && WEBZINE_20_ARTICLES.length > 0
      ? [...WEBZINE_20_ARTICLES]
      : [...DEFAULT_PRESET_ARTICLES];
  }
  if (featLoading) featLoading.style.display = "none";
  renderArticles();

  // 2. 백그라운드에서 Firestore 최신 기사 동기화
  try {
    let snap;
    try {
      const q = query(
        collection(db, "webzine_articles"),
        orderBy("createdAt", "desc"),
        limit(50)
      );
      snap = await getDocs(q);
    } catch (orderErr) {
      console.warn("webzine_articles orderBy query failed, trying plain getDocs:", orderErr?.message || orderErr);
      snap = await getDocs(collection(db, "webzine_articles"));
    }

    const firestoreArticles = [];
    if (snap && !snap.empty) {
      snap.forEach((d) => {
        firestoreArticles.push({ id: d.id, ...d.data() });
      });
    }

    if (firestoreArticles.length > 0) {
      firestoreArticles.sort((a, b) => {
        const timeA = a.createdAt?.seconds || (typeof a.createdAt === "number" ? a.createdAt : 0);
        const timeB = b.createdAt?.seconds || (typeof b.createdAt === "number" ? b.createdAt : 0);
        return timeB - timeA;
      });
      const fsIds = new Set(firestoreArticles.map((a) => a.id));
      const presetsToAdd = WEBZINE_20_ARTICLES.filter((a) => !fsIds.has(a.id));
      _allArticles = [...firestoreArticles, ...presetsToAdd];
      renderArticles();
    }
  } catch (err) {
    console.warn("webzine_articles background sync note:", err?.message || err);
  } finally {
    if (featLoading) featLoading.style.display = "none";
  }
}

/**
 * 기사 렌더링 (피처드 1개 + 나머지 그리드)
 */
function renderArticles() {
  const featEl = $("featuredStory");
  const gridEl = $("articleGrid");
  const countBadge = $("articleCountBadge");
  if (!featEl || !gridEl) return;

  // 1. 카테고리 필터링
  let filtered = _activeCategory === "all"
    ? _allArticles
    : _allArticles.filter((a) => a.category === _activeCategory);

  // 2. 통합 키워드 검색 필터링 (제목, 부제목, 본문, 가맹점명, 태그)
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase().trim();
    filtered = filtered.filter((a) => {
      const t = (a.title || "").toLowerCase();
      const sub = (a.subtitle || a.summary || "").toLowerCase();
      const body = (a.content || "").toLowerCase();
      const mName = (a.merchantInfo?.name || "").toLowerCase();
      const mAddr = (a.merchantInfo?.address || a.merchantInfo?.region || "").toLowerCase();
      return t.includes(q) || sub.includes(q) || body.includes(q) || mName.includes(q) || mAddr.includes(q);
    });
  }

  if (countBadge) {
    countBadge.textContent = `${filtered.length}개의 아티클`;
  }

  if (filtered.length === 0) {
    featEl.innerHTML = "";
    gridEl.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:60px 20px; color:#94a3b8; background:#fff; border-radius:16px;">
      <span style="font-size:2rem; display:block; margin-bottom:10px;">🔍</span>
      ${_searchQuery ? `<strong>"${_searchQuery}"</strong> 키워드에 해당하는 기사를 찾을 수 없습니다.<br><button type="button" onclick="document.getElementById('wzSearchClearBtn')?.click()" style="margin-top:12px; background:#7c3aed; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">검색어 초기화</button>` : '해당 카테고리에 등록된 기사가 아직 없습니다.'}
    </div>`;
    return;
  }

  // 1. 피처드 리드 스토리
  const lead = filtered[0];
  const leadLikes = getArticleLikes(lead.id);
  const leadComments = getArticleComments(lead.id);

  featEl.innerHTML = `
    <article class="wz-featured" data-article-id="${lead.id}">
      <div class="wz-featured-media">
        <img class="wz-featured-img" src="${lead.thumbnailUrl || 'https://images.unsplash.com/photo-1590301157890-4810ed352733?auto=format&fit=crop&w=1200&q=80'}" alt="${lead.title}" />
        <span class="wz-featured-badge">FEATURED STORY</span>
      </div>
      <div class="wz-featured-content">
        <div class="wz-meta-line">
          <span class="wz-cat-tag">${lead.category || 'K-푸드'}</span>
          <span>${lead.readTime || '3분 읽기'}</span>
          <span>${lead.author || '에디터 픽'}</span>
        </div>
        <h2 class="wz-featured-title">${lead.title}</h2>
        <p class="wz-featured-desc">${lead.summary || lead.subtitle || ''}</p>
        <div class="wz-featured-sponsor" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <span>🏪</span>
            <span>기사 제공 | <strong>${lead.merchantInfo?.name || '베스트클럽 공식 가맹점'}</strong></span>
          </div>
          <div class="wz-card-meta-interactions">
            <span>❤️ ${leadLikes}</span>
            <span>💬 ${leadComments.length}</span>
          </div>
        </div>
      </div>
    </article>
  `;

  // 2. 나머지 기사 그리드
  const restArticles = filtered.slice(1);
  if (restArticles.length === 0) {
    gridEl.innerHTML = ``;
    return;
  }

  gridEl.innerHTML = restArticles.map((a) => {
    const likes = getArticleLikes(a.id);
    const comments = getArticleComments(a.id);
    return `
      <article class="wz-card" data-article-id="${a.id}">
        <div class="wz-card-thumb-wrap">
          <img class="wz-card-thumb" src="${a.thumbnailUrl || 'https://images.unsplash.com/photo-1590301157890-4810ed352733?auto=format&fit=crop&w=800&q=80'}" alt="${a.title}" loading="lazy" />
        </div>
        <div class="wz-card-body">
          <div class="wz-card-cat">${a.category || 'K-컬처'}</div>
          <h3 class="wz-card-title">${a.title}</h3>
          <p class="wz-card-summary">${a.summary || a.subtitle || ''}</p>
          <div class="wz-card-footer">
            <span>${a.readTime || '2분 읽기'} · ${a.author || '에디토리얼'}</span>
            <div class="wz-card-meta-interactions">
              <span>❤️ ${likes}</span>
              <span>💬 ${comments.length}</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

/**
 * 실시간 하노이 날씨 · 대기질(AQI) · 환율(KRW/VND/USD) 로더
 */
async function initLiveBriefing() {
  // 1. 하노이 실시간 날씨 (Open-Meteo 무료 API)
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=21.0285&longitude=105.8542&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=Asia%2FBangkok"
    );
    if (res.ok) {
      const data = await res.json();
      const c = data.current || {};
      const temp = Math.round(c.temperature_2m ?? 29);
      const hum = Math.round(c.relative_humidity_2m ?? 75);
      let desc = "구름 조금";
      if (c.weather_code === 0) desc = "맑음";
      else if (c.weather_code >= 61) desc = "비";
      else if (c.weather_code >= 1 && c.weather_code <= 3) desc = "구름 조금";

      const el = $("liveWeatherText");
      if (el) el.textContent = `${temp}°C · ${desc} (습도 ${hum}%)`;
    }
  } catch (err) {
    console.warn("Live weather fetch note:", err?.message || err);
  }

  // 2. 하노이 대기질 AQI (Open-Meteo Air Quality API)
  try {
    const res = await fetch(
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=21.0285&longitude=105.8542&current=us_aqi,pm2_5&timezone=Asia%2FBangkok"
    );
    if (res.ok) {
      const data = await res.json();
      const c = data.current || {};
      const aqi = Math.round(c.us_aqi ?? 68);
      const pm25 = Math.round(c.pm2_5 ?? 28);
      const el = $("liveAqiText");
      if (el) {
        let statusText = "보통";
        let statusCls = "wz-aqi-good";
        if (aqi <= 50) {
          statusText = "좋음";
          statusCls = "wz-aqi-good";
        } else if (aqi <= 100) {
          statusText = "보통";
          statusCls = "wz-aqi-warn";
        } else {
          statusText = "나쁨 (마스크 착용 권장)";
          statusCls = "wz-aqi-bad";
        }
        el.className = statusCls;
        el.textContent = `${aqi} ${statusText} (초미세먼지 ${pm25}µg)`;
      }
    }
  } catch (err) {
    console.warn("Live AQI fetch note:", err?.message || err);
  }

  // 3. 실시간 외환 환율 (ER-API)
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (res.ok) {
      const data = await res.json();
      const rates = data.rates || {};
      const usdVnd = rates.VND ? Math.round(rates.VND) : 25420;
      const usdKrw = rates.KRW ? Math.round(rates.KRW) : 1372;
      const krw1000Vnd = Math.round((usdVnd / usdKrw) * 1000);
      const el = $("liveFxText");
      if (el) {
        el.textContent = `1,000 KRW = ${krw1000Vnd.toLocaleString()} VND | 1 USD = ${usdVnd.toLocaleString()} VND`;
      }
    }
  } catch (err) {
    console.warn("Exchange rate fetch note:", err?.message || err);
  }
}

/**
 * 베트남 주요 은행 예금 금리 및 실시간 이자 계산기
 */
const VIETNAM_BANK_RATES = {
  shinhan: { name: "신한베트남 (Shinhan Bank Vietnam)", 1: 3.2, 6: 4.8, 12: 5.6 },
  woori: { name: "우리베트남 (Woori Bank Vietnam)", 1: 3.1, 6: 4.7, 12: 5.5 },
  vcb: { name: "Vietcombank (비엣콤뱅크)", 1: 2.8, 6: 4.2, 12: 5.0 },
  bidv: { name: "BIDV (베트남투자개발은행)", 1: 3.0, 6: 4.4, 12: 5.2 }
};

function updateBankCalculation() {
  const amountInput = $("calcDepositAmount");
  const bankSelect = $("calcBankSelect");
  const periodSelect = $("calcPeriodSelect");
  if (!amountInput || !bankSelect || !periodSelect) return;

  const principal = parseFloat(amountInput.value) || 0;
  const bankKey = bankSelect.value || "shinhan";
  const months = parseInt(periodSelect.value, 10) || 12;

  const bank = VIETNAM_BANK_RATES[bankKey] || VIETNAM_BANK_RATES.shinhan;
  const annualRate = bank[months] || 5.6;

  // 베트남 개인 은행 정기예금 이자소득세는 0%(비과세)
  const interest = Math.round(principal * (annualRate / 100) * (months / 12));
  const totalPayout = principal + interest;

  if ($("resRateText")) $("resRateText").textContent = `${annualRate.toFixed(1)}%`;
  if ($("resInterestText")) $("resInterestText").textContent = `+${interest.toLocaleString()} VND`;
  if ($("resTotalText")) $("resTotalText").textContent = `${totalPayout.toLocaleString()} VND`;

  if ($("calcAmountKor")) {
    const approxKrw = Math.round(principal / 18.5);
    const manWon = (approxKrw / 10000).toFixed(0);
    $("calcAmountKor").textContent = `${principal.toLocaleString()} VND (약 ${Number(manWon).toLocaleString()}만 원)`;
  }
}

function initBankCalculator() {
  const btnOpen = $("btnOpenBankCalc");
  const modal = $("bankRateModal");
  const btnClose = $("modalBankCloseBtn");

  if (btnOpen && modal) {
    btnOpen.onclick = () => {
      modal.classList.add("active");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      updateBankCalculation();
    };
  }

  const closeBankModal = () => {
    if (modal) {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
  };

  if (btnClose) btnClose.onclick = closeBankModal;
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeBankModal();
    };
  }

  $("calcDepositAmount")?.addEventListener("input", updateBankCalculation);
  $("calcBankSelect")?.addEventListener("change", updateBankCalculation);
  $("calcPeriodSelect")?.addEventListener("change", updateBankCalculation);
}

/**
 * 독자 댓글 렌더링
 */
function renderModalComments(articleId) {
  const listEl = $("mCommentsList");
  const badgeEl = $("mCommentCountBadge");
  if (!listEl) return;

  const comments = getArticleComments(articleId);
  if (badgeEl) badgeEl.textContent = String(comments.length);

  if (comments.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding:18px; color:#94a3b8; font-size:0.85rem;">첫 번째 독자 한줄 생각을 남겨보세요!</div>`;
    return;
  }

  listEl.innerHTML = comments
    .map(
      (c) => `
    <div class="wz-comment-item">
      <div class="wz-comment-meta">
        <span class="wz-comment-author">👤 ${c.author || "익명 독자"}</span>
        <span class="wz-comment-time">${c.time || "방금 전"}</span>
      </div>
      <div class="wz-comment-body">${c.text}</div>
    </div>
  `
    )
    .join("");
}

/**
 * 기사 상세 모달 열기
 */
function openArticleDetail(articleId) {
  const article = _allArticles.find((a) => a.id === articleId);
  if (!article) return;

  _currentArticleId = articleId;
  const modal = $("articleModal");
  if (!modal) return;

  // 기본 메타 정보 바인딩
  if ($("mHeroImg")) $("mHeroImg").src = article.thumbnailUrl || "";
  if ($("mCat")) $("mCat").textContent = article.category || "K-컬처";
  if ($("mTitle")) $("mTitle").textContent = article.title;
  if ($("mSub")) $("mSub").textContent = article.subtitle || "";
  if ($("mAuthor")) $("mAuthor").textContent = `✍️ ${article.author || "베스트클럽 에디토리얼 팀"}`;
  if ($("mDate")) $("mDate").textContent = `📅 ${article.dateStr || "2026. 10. 13"}`;
  if ($("mReadTime")) $("mReadTime").textContent = `⏱️ ${article.readTime || "3분 읽기"}`;

  // 좋아요 버튼 상태 동기화
  const likeBtn = $("mBtnLike");
  const likeCountEl = $("mLikeCount");
  const likeIconEl = $("mLikeIcon");
  if (likeBtn && likeCountEl) {
    const isLiked = isArticleLiked(articleId);
    const count = getArticleLikes(articleId);
    likeCountEl.textContent = String(count);
    if (likeIconEl) likeIconEl.textContent = isLiked ? "❤️" : "🤍";
    if (isLiked) likeBtn.classList.add("liked");
    else likeBtn.classList.remove("liked");
  }

  // 💡 3단계 심층 분석 브리핑 바인딩 (Why it matters · Expat Impact · Action Checklist)
  if ($("sbWhyText")) {
    $("sbWhyText").textContent =
      article.whyItMatters ||
      article.summary ||
      "하노이 현지 교민과 방문객에게 새로운 라이프스타일 경험과 베스트클럽 우수 가맹점 혜택을 제공합니다.";
  }
  if ($("sbImpactText")) {
    $("sbImpactText").textContent =
      article.impactOnExpats ||
      "미딩, 쭝화 등 주요 교민 상권에서 신뢰할 수 있는 정품 K-콘텐츠와 식음료 문화를 바로 누릴 수 있습니다.";
  }
  if ($("sbActionText")) {
    $("sbActionText").textContent =
      article.actionRequired ||
      "매장 방문 시 베스트클럽 결제를 통해 5% 즉시 포인트 페이백과 잭팟 보너스티켓(BT)을 챙기세요.";
  }

  // 본문 HTML 바인딩
  const bodyHtml = parseMarkdownToHtml(article.content);
  if ($("mBody")) $("mBody").innerHTML = bodyHtml;

  // 가맹점 정보 블록 바인딩
  const m = article.merchantInfo || {};
  if ($("mMerchName")) $("mMerchName").textContent = m.name || "베스트클럽 공식 가맹점";
  if ($("mMerchDesc")) $("mMerchDesc").textContent = m.description || "정성과 신뢰로 보답하는 베스트클럽 우수 가맹점";
  if ($("mMerchCatBadge")) $("mMerchCatBadge").textContent = m.category || article.category || "공식 파트너";
  if ($("mMerchAddr")) $("mMerchAddr").textContent = m.address || m.region || "하노이 미딩 한인타운";
  if ($("mMerchPhone")) $("mMerchPhone").textContent = m.phone || "024-3787-8899";
  if ($("mMerchHours")) $("mMerchHours").textContent = m.hours || "매일 10:30 ~ 23:00";
  if ($("mMerchMenu")) $("mMerchMenu").textContent = m.signatureMenu || "대표 시그니처 메뉴";
  if ($("mMerchBenefit")) $("mMerchBenefit").textContent = m.benefit || "베스트클럽 결제 시 5% 즉시 포인트 페이백 + 잭팟 보너스티켓(BT) 즉시 발급!";

  if ($("mMerchPayLink")) {
    $("mMerchPayLink").href = m.qrUrl || `/pay.html?merchant=${encodeURIComponent(m.id || "daehan_kimchi")}`;
  }
  if ($("mMerchTelLink")) {
    $("mMerchTelLink").href = `tel:${(m.phone || "02437878899").replace(/[^0-9]/g, "")}`;
  }

  // 댓글 리스트 바인딩
  renderModalComments(articleId);

  // SNS 숏폼 텍스트 바인딩
  const sns = article.sns || {};
  if ($("snsInsta")) $("snsInsta").textContent = sns.instagram || `${article.title}\n\n#베스트클럽 #${article.category}`;
  if ($("snsX")) $("snsX").textContent = sns.x || `${article.title} - 베스트 매거진 기사 확인하기`;
  if ($("snsThreads")) $("snsThreads").textContent = sns.threads || `${article.title}\n\n여러분의 생각은 어떠신가요? 댓글로 공유해 주세요!`;
  if ($("snsFb")) $("snsFb").textContent = sns.facebook || `${article.title}\n${article.summary}`;

  // URL 파라미터 딥링크 반영 (?article=...)
  try {
    const newUrl = `${window.location.pathname}?article=${encodeURIComponent(articleId)}`;
    window.history.replaceState({ articleId }, "", newUrl);
  } catch (e) {}

  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

/**
 * 기사 상세 모달 닫기
 */
function closeArticleDetail() {
  const modal = $("articleModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  _currentArticleId = null;

  // URL 파라미터 복구
  try {
    window.history.replaceState({}, "", window.location.pathname);
  } catch (e) {}
}

/**
 * 이벤트 리스너 바인딩
 */
function initEvents() {
  // 1. 키워드 검색 통합 이벤트
  const searchInput = $("wzSearchInput");
  const clearBtn = $("wzSearchClearBtn");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      _searchQuery = searchInput.value;
      if (clearBtn) {
        clearBtn.style.display = _searchQuery.trim().length > 0 ? "flex" : "none";
      }
      renderArticles();
    });
  }
  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      _searchQuery = "";
      clearBtn.style.display = "none";
      renderArticles();
      searchInput.focus();
    });
  }

  // 2. 카테고리 탭 클릭
  const tabWrap = $("categoryTabs");
  if (tabWrap) {
    tabWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".wz-tab-btn");
      if (!btn) return;
      tabWrap.querySelectorAll(".wz-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      _activeCategory = btn.dataset.cat || "all";
      renderArticles();
    });
  }

  // 3. 피처드 및 카드 클릭 시 상세 모달
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".wz-card, .wz-featured");
    if (card && card.dataset.articleId) {
      openArticleDetail(card.dataset.articleId);
    }
  });

  // 4. 모달 닫기 버튼 및 배경 클릭
  const closeBtn = $("modalCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeArticleDetail);

  const modal = $("articleModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeArticleDetail();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeArticleDetail();
      const bankModal = $("bankRateModal");
      if (bankModal && bankModal.classList.contains("active")) {
        bankModal.classList.remove("active");
        document.body.style.overflow = "";
      }
    }
  });

  // 5. 좋아요 버튼 토글
  const btnLike = $("mBtnLike");
  if (btnLike) {
    btnLike.onclick = () => {
      if (!_currentArticleId) return;
      const res = toggleArticleLike(_currentArticleId);
      if ($("mLikeCount")) $("mLikeCount").textContent = String(res.count);
      if ($("mLikeIcon")) $("mLikeIcon").textContent = res.liked ? "❤️" : "🤍";
      if (res.liked) btnLike.classList.add("liked");
      else btnLike.classList.remove("liked");
      renderArticles(); // 메인 피드/카드 카운트도 갱신
    };
  }

  // 6. 독자 댓글 등록 폼
  const commentForm = $("mCommentForm");
  if (commentForm) {
    commentForm.onsubmit = (e) => {
      e.preventDefault();
      if (!_currentArticleId) return;
      const author = $("mCommentAuthor")?.value.trim();
      const text = $("mCommentText")?.value.trim();
      if (!text) return;

      addArticleComment(_currentArticleId, author, text);
      renderModalComments(_currentArticleId);
      renderArticles(); // 메인 카운터 갱신

      if ($("mCommentText")) $("mCommentText").value = "";
    };
  }

  // 7. 실시간 SNS 다이렉트 공유 버튼 핸들러
  const getShareUrl = () => {
    const baseUrl = window.location.origin.includes("localhost")
      ? window.location.origin
      : "https://bestclubvn.netlify.app";
    return `${baseUrl}/kca_webzine.html?article=${encodeURIComponent(_currentArticleId || "")}`;
  };

  const getArticleTitle = () => {
    const a = _allArticles.find((art) => art.id === _currentArticleId);
    return a ? a.title : "베스트 매거진";
  };

  $("btnDirectFb")?.addEventListener("click", () => {
    const url = encodeURIComponent(getShareUrl());
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank");
  });

  $("btnDirectZalo")?.addEventListener("click", () => {
    window.open("https://chat.zalo.me/", "_blank");
  });

  $("btnDirectKakao")?.addEventListener("click", () => {
    const shareUrl = getShareUrl();
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert("카카오톡 공유 링크가 복사되었습니다! 카카오톡 채팅창에 붙여넣기(Ctrl+V) 하세요.");
    });
  });

  const handleCopyLink = () => {
    const shareUrl = getShareUrl();
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        alert("기사 고유 링크가 클립보드에 복사되었습니다! 친구나 단톡방에 공유해 보세요.\n" + shareUrl);
      })
      .catch(() => {
        alert("링크 복사 완료: " + shareUrl);
      });
  };

  $("btnDirectCopy")?.addEventListener("click", handleCopyLink);
  $("btnCopyArticleUrl")?.addEventListener("click", handleCopyLink);

  // 8. SNS 배포 텍스트 스크롤
  const btnOpenSns = $("btnOpenSnsModal");
  if (btnOpenSns) {
    btnOpenSns.onclick = () => {
      const box = $("mSnsBox");
      if (box) box.scrollIntoView({ behavior: "smooth" });
    };
  }

  // 9. SNS 텍스트 개별 복사 버튼
  document.addEventListener("click", (e) => {
    const copyBtn = e.target.closest(".wz-btn-copy");
    if (!copyBtn) return;
    const targetId = copyBtn.dataset.target;
    const textEl = $(targetId);
    if (!textEl) return;

    navigator.clipboard.writeText(textEl.textContent.trim()).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = "복사됨! ✅";
      setTimeout(() => {
        copyBtn.textContent = orig;
      }, 1500);
    });
  });
}

/**
 * 딥링크 체크 (?article=...)
 */
function checkDeepLink() {
  try {
    const params = new URLSearchParams(window.location.search);
    const deepArticleId = params.get("article");
    if (deepArticleId) {
      setTimeout(() => {
        openArticleDetail(deepArticleId);
      }, 100);
    }
  } catch (e) {}
}

// ── 초기화 실행 ──
function boot() {
  initEvents();
  initLiveBriefing();
  initBankCalculator();
  loadWebzineArticles().then(() => {
    checkDeepLink();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

