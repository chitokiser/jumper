// functions/handlers/webzine.js
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * 카테고리별 고화질 큐레이션 썸네일 프리셋
 */
const CATEGORY_THUMBNAILS = {
  'K-푸드': [
    'https://images.unsplash.com/photo-1590301157890-4810ed352733?auto=format&fit=crop&w=1200&q=80', // 치킨
    'https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=1200&q=80', // 한식
    'https://images.unsplash.com/photo-1553163147-622ab57be1c7?auto=format&fit=crop&w=1200&q=80'  // 바베큐
  ],
  'K-POP': [
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80', // 콘서트
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80'
  ],
  'K-뷰티': [
    'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80', // 뷰티/스킨케어
    'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1200&q=80'
  ],
  'K-드라마': [
    'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80'
  ],
  '하노이 라이프': [
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1200&q=80', // 카페
    'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80'  // 하노이 거리
  ],
  '베트남 뉴스': [
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80'
  ],
  '문화/생활': [
    'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80'
  ]
};

function getRandomThumbnail(category) {
  const list = CATEGORY_THUMBNAILS[category] || CATEGORY_THUMBNAILS['K-푸드'];
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * AI 기사 템플릿 생성기 (Fallback / High Quality Generator)
 */
function generateTemplateArticle({ category, topic, keywords, merchantData }) {
  const mName = merchantData.name || merchantData.merchantName || '대한김치 & 치킨';
  const mCategory = merchantData.category || merchantData.industry || 'K-푸드 전문점';
  const mRegion = merchantData.region || merchantData.address || '하노이 미딩 (My Dinh)';
  const mDesc = merchantData.description || '정통 한국의 맛과 넉넉한 인심을 자랑하는 베스트클럽 우수 가맹점';
  const mPhone = merchantData.phone || '024-3787-8899';
  const mHours = merchantData.hours || '매일 10:30 ~ 23:00';
  const mMenu = merchantData.signatureMenu || '한국식 바삭 후라이드 & 양념치킨, 숙성 배추김치';

  let title = '';
  let subtitle = '';
  let summary = '';
  let content = '';

  if (category === 'K-푸드' || !category) {
    title = topic || `하노이에서 즐기는 한국식 치킨과 K-푸드의 새로운 매력`;
    subtitle = `현지 미식가들의 입맛까지 사로잡은 바삭한 풍미와 정통 한식의 깊은 맛`;
    summary = `이국적인 하노이의 밤, 따뜻한 온기와 바삭한 식감으로 하루의 피로를 녹여주는 한국식 푸드 문화가 하노이 교민과 현지인들 사이에서 뜨거운 사랑을 받고 있습니다.`;
    content = `### 1. 하노이에 불어온 K-치킨 열풍, 그 특별한 비결\n\n베트남 하노이 거리를 걷다 보면 은은하게 풍겨오는 익숙하고 고소한 치킨 향기가 발걸음을 멈추게 합니다. 한국의 '치맥(치킨+맥주)' 문화는 이제 단순한 유행을 넘어, 소중한 사람들과 둘러앉아 따뜻한 정을 나누는 독보적인 식문화로 자리 잡았습니다.\n\n특히 하노이의 대표적인 한인 타운인 미딩(My Dinh)을 중심으로, 한국 정통 레시피 그대로 튀겨낸 겉바속촉 치킨과 깊은 풍미의 숙성 양념은 한국 교민뿐 아니라 베트남 현지 젊은 층 사이에서도 '꼭 경험해야 할 K-푸드'로 손꼽힙니다.\n\n### 2. 바삭함 뒤에 숨겨진 정성과 신선한 재료\n\n진정한 한식의 감동은 타협하지 않는 식재료의 신선함에서 출발합니다. 겉은 바삭하면서도 속살은 육즙을 가득 머금은 완벽한 튀김 기술, 그리고 한국에서 공수한 비법 양념의 조화는 한 입 베어 무는 순간 감탄을 자아냅니다.\n\n바쁜 일상을 마친 저녁, 시원한 음료와 함께 즐기는 따끈한 치킨 한 조각은 타국 생활의 향수를 달래주는 가장 확실한 힐링입니다.\n\n### 3. 베스트클럽 가맹점 혜택으로 더욱 풍성하게\n\n베스트클럽 멤버십 회원이라면 맛있는 식사와 함께 잊지 못할 혜택까지 누릴 수 있습니다. 매장 방문 결제 시 즉시 5% 포인트 페이백이 적립되며, 글로벌 잭팟에 참여할 수 있는 보너스 티켓(BT)이 즉시 발급됩니다.`;
  } else if (category === 'K-뷰티') {
    title = topic || `하노이 K-뷰티 트렌드: 유리알 광채 피부의 비밀`;
    subtitle = `열대 기후 속에서도 건강하고 투명한 스킨케어 루틴과 맞춤 뷰티 케어`;
    summary = `베트남의 습하고 더운 기후 속에서도 맑고 투명한 피부를 유지하는 한국식 스킨케어 노하우가 하노이 뷰티 피플들의 마음을 사로잡고 있습니다.`;
    content = `### 1. 동남아 기후에 맞춘 스마트 K-뷰티 루틴\n\n강한 자외선과 높은 습도 속에서도 보송하면서 촉촉한 수분감을 잃지 않는 한국식 스킨케어는 전 세계적인 사랑을 받고 있습니다. 가벼운 수분 레이어링과 진정 케어가 핵심입니다.\n\n### 2. 정품 인증과 신뢰할 수 있는 뷰티 플랫폼\n\n현지에서 안심하고 한국 뷰티 서비스를 이용하고 검증된 제품을 만날 수 있는 가맹점들의 꼼꼼한 서비스가 주목받고 있습니다.\n\n### 3. 베스트클럽 회원 전용 뷰티 케어 혜택\n\n베스트클럽 가맹점에서 뷰티 서비스 및 제품 구매 시 특별한 포인트 혜택과 잭팟 티켓을 함께 챙겨보세요.`;
  } else {
    title = topic || `하노이 라이프스타일 탐방: 활기찬 일상 속 발견하는 한류 문화`;
    subtitle = `한국과 베트남이 어우러지는 따뜻한 커뮤니티와 숨은 명소 이야기`;
    summary = `하노이 곳곳에 스며든 한류 문화와 라이선스 가맹점들이 만들어가는 따뜻한 생활 정보와 혜택을 전해드립니다.`;
    content = `### 1. 두 문화가 만나 빚어내는 새로운 일상의 즐거움\n\n하노이는 전통의 고즈넉함과 현대의 역동성이 공존하는 매력적인 도시입니다. 그 중심에서 한류 문화는 현지인과 교민 모두에게 활력을 주는 매개체가 되고 있습니다.\n\n### 2. 가맹점과 함께하는 스마트 라이프\n\n믿을 수 있는 베스트클럽 제휴 매장에서 알찬 서비스와 특별한 페이백 혜택을 직접 경험해 보세요.`;
  }

  const cleanTitle = title.replace(/"/g, '');
  const tags = ['베스트클럽', '하노이생활', category || 'K-푸드', mName.replace(/\s+/g, ''), '하노이맛집', 'K컬처'];

  return {
    title: cleanTitle,
    subtitle,
    category: category || 'K-푸드',
    summary,
    content,
    thumbnailUrl: getRandomThumbnail(category),
    readTime: '3분 소요',
    author: '베스트클럽 에디토리얼 팀',
    tags,
    merchantInfo: {
      id: merchantData.id || 'daehan_kimchi',
      name: mName,
      category: mCategory,
      region: mRegion,
      address: mRegion,
      description: mDesc,
      phone: mPhone,
      hours: mHours,
      signatureMenu: mMenu,
      benefit: '베스트클럽 결제 시 5% 즉시 포인트 페이백 + 잭팟 BT 티켓 증정',
      qrUrl: `/pay.html?merchant=${encodeURIComponent(merchantData.id || 'daehan_kimchi')}`
    },
    sns: {
      instagram: `[베스트 매거진 픽 ✨] ${cleanTitle}\n\n하노이에서 즐기는 특별한 순간! ${summary}\n\n📍 기사 제공 | ${mName}\n- 위치: ${mRegion}\n- 대표메뉴: ${mMenu}\n- 혜택: 베스트클럽 회원 결제 시 5% 포인트 페이백 + 잭팟 BT 지급 🎟️\n\n더 자세한 매거진 기사는 프로필 링크에서 확인하세요!\n#베스트클럽 #하노이라이프 #${category} #하노이맛집 #K컬처 #${mName.replace(/\s+/g, '')}`,
      x: `[베스트 매거진] "${cleanTitle}"\n${summary.slice(0, 80)}...\n\n👉 기사 제공: ${mName} (${mRegion})\n자세히 보기: https://bestclubvn.netlify.app/kca_webzine.html`,
      threads: `하노이에서 만나는 최고의 순간 💫\n\n"${cleanTitle}"\n\n${summary}\n\n오늘 저녁은 ${mName}에서 맛있는 시간 보내고 베스트클럽 포인트 페이백도 챙겨보시는 건 어떨까요? 여러분의 최애 메뉴는 무엇인가요? 댓글로 공유해 주세요! 👇`,
      facebook: `[베스트 클럽 웹진 카드뉴스] ${cleanTitle}\n\n${summary}\n\n■ 기사 제공 및 추천 매장\n- 상호명: ${mName}\n- 주소: ${mRegion}\n- 문의: ${mPhone}\n- 혜택: 베스트클럽 결제 시 포인트 페이백 & 잭팟 참여\n\n전체 기사 읽기: https://bestclubvn.netlify.app/kca_webzine.html`
    }
  };
}

/**
 * buildWebzineContent: Cloud Function API
 * 가맹점 정보 + 카테고리/주제를 기반으로 Gemini AI 또는 스마트 템플릿 엔진을 실행하여
 * 웹진 장문 기사 + 가맹점 협찬 블록 + SNS 숏폼 세트 생성
 */
async function buildWebzineContent(data, context) {
  const db = admin.firestore();
  const { merchantId, category = 'K-푸드', topic = '', keywords = '', customPrompt = '' } = data || {};

  // 1. 가맹점 정보 조회
  let merchantData = {
    id: merchantId || 'daehan_kimchi',
    name: '대한김치 & 치킨',
    category: 'K-푸드 전문점',
    region: '하노이 미딩 (My Dinh)',
    address: '하노이 미딩 송다 한인타운',
    phone: '024-3787-8899',
    hours: '매일 10:30 ~ 23:00',
    signatureMenu: '한국식 바삭 후라이드 & 양념치킨, 숙성 배추김치',
    description: '하노이 미딩 한인타운에서 정통 한국의 맛과 정성을 전하는 베스트클럽 대표 가맹점'
  };

  if (merchantId) {
    try {
      const mSnap = await db.collection('merchants').doc(String(merchantId)).get();
      if (mSnap.exists) {
        const d = mSnap.data();
        merchantData = {
          id: mSnap.id,
          name: d.name || d.merchantName || merchantData.name,
          category: d.career || d.category || merchantData.category,
          region: d.region || d.address || merchantData.region,
          address: d.address || d.region || merchantData.address,
          phone: d.phone || merchantData.phone,
          hours: d.hours || merchantData.hours,
          signatureMenu: d.signatureMenu || d.description || merchantData.signatureMenu,
          description: d.description || merchantData.description
        };
      }
    } catch (e) {
      console.warn('Failed to load merchant doc:', e);
    }
  }

  // 2. Gemini API Key 확인 및 호출 시도
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (apiKey && !apiKey.includes('여기에')) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = `
당신은 한국과 베트남을 잇는 프리미엄 라이프스타일 매거진 '베스트클럽 웹진(BestClub Webzine)'의 수석 에디터입니다.
단순한 노골적 광고가 아니라, 독자에게 읽는 즐거움과 신뢰를 주는 고품격 기사(콘텐츠)를 작성하고,
기사 하단 및 맥락 속에 자연스럽게 관련 가맹점(${merchantData.name})을 '기사 제공 / 협찬 / 공식 파트너'로 노출해야 합니다.

[작성 조건]
1. 카테고리: ${category}
2. 주제/헤드라인 방향: ${topic || '하노이에서 만나는 한국식 문화와 미식의 새로운 경험'}
3. 핵심 키워드: ${keywords || 'K-컬처, 정통 레시피, 하노이 라이프스타일'}
4. 연동 가맹점 정보:
   - 상호명: ${merchantData.name}
   - 업종: ${merchantData.category}
   - 위치/주소: ${merchantData.region}
   - 대표메뉴/특징: ${merchantData.signatureMenu}
   - 설명: ${merchantData.description}
5. 톤앤매너: 브런치(Brunch Story)나 고급 라이프스타일 잡지처럼 감성적이고 정갈하며 신뢰감 있는 문체.
6. SNS 숏폼: 기사 발행 후 인스타그램, X(트위터), 스레드, 페이스북에 바로 배포할 수 있는 플랫폼별 맞춤 캡션 텍스트 필수 생성.

반드시 아래 JSON 포맷으로만 응답하세요. 백틱(code block) 없이 순수 JSON만 출력하세요.
{
  "title": "매력적인 기사 제목 (30자 내외)",
  "subtitle": "깊이 있는 부제목 (40자 내외)",
  "category": "${category}",
  "summary": "독자의 호기심을 끄는 2~3줄 요약문",
  "content": "3~4개의 소제목(### )과 문단으로 구성된 1200자 내외의 풍부한 기사 본문 (마크다운 포맷)",
  "tags": ["태그1", "태그2", "태그3", "태그4"],
  "sns": {
    "instagram": "인스타그램용 감성 캡션 및 해시태그",
    "x": "X(트위터)용 150자 핵심 요약 및 링크 문구",
    "threads": "스레드용 대화 유도형 텍스트",
    "facebook": "페이스북용 카드뉴스 스타일 요약문"
  }
}
`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        success: true,
        source: 'gemini',
        article: {
          title: parsed.title,
          subtitle: parsed.subtitle,
          category: parsed.category || category,
          summary: parsed.summary,
          content: parsed.content,
          thumbnailUrl: getRandomThumbnail(category),
          readTime: '3분 소요',
          author: '베스트클럽 에디토리얼 팀',
          tags: parsed.tags || [category, '베스트클럽', merchantData.name],
          merchantInfo: {
            id: merchantData.id,
            name: merchantData.name,
            category: merchantData.category,
            region: merchantData.region,
            address: merchantData.address,
            phone: merchantData.phone,
            hours: merchantData.hours,
            signatureMenu: merchantData.signatureMenu,
            description: merchantData.description,
            benefit: '베스트클럽 결제 시 5% 즉시 포인트 페이백 + 잭팟 BT 티켓 증정',
            qrUrl: `/pay.html?merchant=${encodeURIComponent(merchantData.id)}`
          },
          sns: parsed.sns
        }
      };
    } catch (aiErr) {
      console.warn('Gemini generateContent failed, falling back to smart template:', aiErr);
    }
  }

  // 3. Fallback: 스마트 템플릿 엔진으로 완전한 기사 즉시 생성
  const article = generateTemplateArticle({ category, topic, keywords, merchantData });
  return {
    success: true,
    source: 'template_engine',
    article
  };
}

module.exports = {
  buildWebzineContent,
  CATEGORY_THUMBNAILS,
  getRandomThumbnail
};
