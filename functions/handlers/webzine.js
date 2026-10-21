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
    content = `### 1. 하노이에 불어온 K-치킨 열풍, 그 특별한 비결\n\n베트남 하노이 거리를 걷다 보면 은은하게 풍겨오는 익숙하고 고소한 치킨 향기가 발걸음을 멈추게 합니다. 한국의 '치맥(치킨+맥주)' 문화는 이제 단순한 유행을 넘어, 소중한 사람들과 둘러앉아 따뜻한 정을 나누는 독보적인 식문화로 자리 잡았습니다.\n\n특히 하노이의 대표적인 한인 타운인 미딩(My Dinh)을 중심으로, 한국 정통 레시피 그대로 튀겨낸 겉바속촉 치킨과 깊은 풍미의 숙성 양념은 한국 교민뿐 아니라 베트남 현지 젊은 층 사이에서도 '꼭 경험해야 할 K-푸드'로 손꼽힙니다.\n\n### 2. 바삭함 뒤에 숨겨진 정성과 신선한 재료\n\n진정한 한식의 감동은 타협하지 않는 식재료의 신선함에서 출발합니다. 겉은 바삭하면서도 속살은 육즙을 가득 머금은 완벽한 튀김 기술, 그리고 한국에서 공수한 비법 양념의 조화는 한 입 베어 무는 순간 감탄을 자아냅니다.\n\n바쁜 일상을 마친 저녁, 시원한 음료와 함께 즐기는 따끈한 치킨 한 조각은 타국 생활의 향수를 달래주는 가장 확실한 힐링입니다.\n\n### 3. 베스트클럽 가맹점 혜택으로 더욱 풍성하게\n\n베스트클럽 멤버십 회원이라면 맛있는 식사와 함께 잊지 못할 혜택까지 누릴 수 있습니다. 매장 방문 결제 시 즉시 결제금 비례 포인트 잭팟이 적립되며, 글로벌 잭팟에 참여할 수 있는 보너스 티켓(BT)이 즉시 발급됩니다.`;
  } else if (category === 'K-뷰티') {
    title = topic || `하노이 K-뷰티 트렌드: 유리알 광채 피부의 비밀`;
    subtitle = `열대 기후 속에서도 건강하고 투명한 스킨케어 루틴과 맞춤 뷰티 케어`;
    summary = `베트남의 습하고 더운 기후 속에서도 맑고 투명한 피부를 유지하는 한국식 스킨케어 노하우가 하노이 뷰티 피플들의 마음을 사로잡고 있습니다.`;
    content = `### 1. 동남아 기후에 맞춘 스마트 K-뷰티 루틴\n\n강한 자외선과 높은 습도 속에서도 보송하면서 촉촉한 수분감을 잃지 않는 한국식 스킨케어는 전 세계적인 사랑을 받고 있습니다. 가벼운 수분 레이어링과 진정 케어가 핵심입니다.\n\n### 2. 정품 인증과 신뢰할 수 있는 뷰티 플랫폼\n\n현지에서 안심하고 한국 뷰티 서비스를 이용하고 검증된 제품을 만날 수 있는 가맹점들의 꼼꼼한 서비스가 주목받고 있습니다.\n\n### 3. 베스트클럽 회원 전용 뷰티 케어 혜택\n\n베스트클럽 가맹점에서 뷰티 서비스 및 제품 구매 시 특별한 포인트 혜택과 잭팟 티켓을 함께 챙겨보세요.`;
  } else {
    title = topic || `하노이 라이프스타일 탐방: 활기찬 일상 속 발견하는 한류 문화`;
    subtitle = `한국과 베트남이 어우러지는 따뜻한 커뮤니티와 숨은 명소 이야기`;
    summary = `하노이 곳곳에 스며든 한류 문화와 라이선스 가맹점들이 만들어가는 따뜻한 생활 정보와 혜택을 전해드립니다.`;
    content = `### 1. 두 문화가 만나 빚어내는 새로운 일상의 즐거움\n\n하노이는 전통의 고즈넉함과 현대의 역동성이 공존하는 매력적인 도시입니다. 그 중심에서 한류 문화는 현지인과 교민 모두에게 활력을 주는 매개체가 되고 있습니다.\n\n### 2. 가맹점과 함께하는 스마트 라이프\n\n믿을 수 있는 베스트클럽 제휴 매장에서 알찬 서비스와 특별한 포인트 잭팟 혜택을 직접 경험해 보세요.`;
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
      benefit: '베스트클럽 결제 시 결제금 비례 포인트 잭팟 + BT 티켓 증정',
      qrUrl: `/pay.html?merchant=${encodeURIComponent(merchantData.id || 'daehan_kimchi')}`
    },
    sns: {
      instagram: `[베스트 매거진 픽 ✨] ${cleanTitle}\n\n하노이에서 즐기는 특별한 순간! ${summary}\n\n📍 기사 제공 | ${mName}\n- 위치: ${mRegion}\n- 대표메뉴: ${mMenu}\n- 혜택: 베스트클럽 회원 결제 시 결제금 비례 포인트 잭팟 + BT 지급 🎟️\n\n더 자세한 매거진 기사는 프로필 링크에서 확인하세요!\n#베스트클럽 #하노이라이프 #${category} #하노이맛집 #K컬처 #${mName.replace(/\s+/g, '')}`,
      x: `[베스트 매거진] "${cleanTitle}"\n${summary.slice(0, 80)}...\n\n👉 기사 제공: ${mName} (${mRegion})\n자세히 보기: https://bestclubvn.netlify.app/kca_webzine.html`,
      threads: `하노이에서 만나는 최고의 순간 💫\n\n"${cleanTitle}"\n\n${summary}\n\n오늘 저녁은 ${mName}에서 맛있는 시간 보내고 베스트클럽 포인트 잭팟도 챙겨보시는 건 어떨까요? 여러분의 최애 메뉴는 무엇인가요? 댓글로 공유해 주세요! 👇`,
      facebook: `[베스트 클럽 웹진 카드뉴스] ${cleanTitle}\n\n${summary}\n\n■ 기사 제공 및 추천 매장\n- 상호명: ${mName}\n- 주소: ${mRegion}\n- 문의: ${mPhone}\n- 혜택: 베스트클럽 결제 시 포인트 잭팟 참여\n\n전체 기사 읽기: https://bestclubvn.netlify.app/kca_webzine.html`
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
  const { merchantId, category = 'K-푸드', topic = '', keywords = '', customPrompt = '', reporting = {} } = data || {};
  const rp = {
    interview: String(reporting.interview || '').trim().slice(0, 4000),
    facts: String(reporting.facts || '').trim().slice(0, 3000),
    scene: String(reporting.scene || '').trim().slice(0, 2000),
  };

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

  // 2. Gemini: 기자 초안 → 편집장 사실 검수 (2026-10-21)
  //    모델은 GEMINI_MODEL 로 바꿀 수 있음 (gemini-1.5 계열은 서비스 종료)
  const apiKey = process.env.GEMINI_API_KEY || '';
  let modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const backupModel = process.env.GEMINI_BACKUP_MODEL || 'gemini-2.5-flash-lite';
  let aiError = '';

  if (apiKey && !apiKey.includes('여기에')) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      // 구글 쪽 일시 과부하(503)·한도(429)는 잠깐 기다렸다 다시, 계속 안 되면 가벼운 예비 모델로
      const callModel = async (temperature, prompt) => {
        const models = [modelName, backupModel].filter((m, i, arr) => m && arr.indexOf(m) === i);
        let lastErr;
        for (const m of models) {
          const gm = genAI.getGenerativeModel({ model: m, generationConfig: { temperature, responseMimeType: 'application/json' } });
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await gm.generateContent(prompt);
              modelName = m;
              return res;
            } catch (e) {
              lastErr = e;
              if (![429, 500, 503].includes(e?.status)) throw e;
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            }
          }
        }
        throw lastErr;
      };
      const writer = { generateContent: (p) => callModel(0.7, p) };
      const editor = { generateContent: (p) => callModel(0.1, p) };

      const materials = `[가맹점 기본 정보]
- 상호: ${merchantData.name}
- 업종: ${merchantData.category}
- 위치: ${merchantData.region}
- 대표 메뉴/상품: ${merchantData.signatureMenu}
- 소개: ${merchantData.description}
- 베스트클럽 결제 혜택(확인된 사실): 결제금에 비례한 포인트 잭팟과 보너스티켓(BT) 지급

[취재 자료 — 인터뷰]
${rp.interview || '(없음)'}

[취재 자료 — 확인된 사실: 가격·메뉴·연혁·인증·수치]
${rp.facts || '(없음)'}

[취재 자료 — 현장 묘사·손님 반응]
${rp.scene || '(없음)'}

[기획 방향]
- 카테고리: ${category}
- 주제: ${topic || '(기자가 취재 자료에서 가장 기사 가치가 큰 이야기를 고를 것)'}
- 키워드: ${keywords || '(없음)'}
${customPrompt ? '- 추가 요청: ' + String(customPrompt).slice(0, 1000) : ''}`;

      const writePrompt = `당신은 베트남 하노이의 한인 생활 매거진 '베스트클럽 웹진'의 10년 차 취재기자입니다.
아래 취재 자료만을 근거로, 일간지 라이프면·주간지 피처 기사 수준의 기사를 씁니다.

[기사 작성 원칙 — 반드시 지킬 것]
1. 사실: 취재 자료에 없는 숫자·인증·수상·연혁·가격·인용문은 절대 만들지 않는다. 자료가 부족하면 일반적인 배경 설명(하노이 한인 생활, 한식 문화 등)으로 채우되, 그 가게에 대한 주장으로 쓰지 않는다.
2. 인용: 큰따옴표 인용은 인터뷰 자료에 있는 말만 쓰고, "…라고 말했다", "…라고 설명했다"처럼 누가 한 말인지 밝힌다. 말투는 다듬어도 뜻은 바꾸지 않는다.
3. 리드: 첫 문단은 구체적인 장면이나 사실로 시작한다. "~의 세계로 떠나보자", "~를 소개합니다" 같은 상투적 도입 금지.
4. 구성: 리드 → 왜 지금 이 이야기인가(배경) → 본문(인물·과정·디테일) → 독자에게 쓸모 있는 정보(위치·가격·이용 팁) → 여운 있는 마무리.
5. 문체: 평서문 "~다"체. 짧고 정확한 문장. 감탄사·이모지·느낌표 금지. "최고의", "완벽한", "독보적인", "환상적인", "놀라운" 같은 과장 표현 금지. 광고 문구처럼 독자에게 명령하지 않는다("꼭 방문하세요" 금지).
6. 분량: 본문 1,500~2,200자. 소제목(### ) 2~4개. 소제목은 기사 내용을 요약하는 짧은 문장으로.
7. 평가 단정 금지: "많은 이들의 입맛을 사로잡았다", "~의 중심으로 자리 잡았다", "~를 책임지는"처럼 인기·영향력을 단정하는 문장은 취재 자료(손님 반응 등)에 근거가 있을 때만 쓴다.
8. 혜택 표기: 베스트클럽 결제 혜택은 "결제금에 비례한 포인트 잭팟과 보너스티켓(BT)"으로만 쓴다. 캐시백·환급·할인율 같은 다른 혜택을 지어내지 않는다.

${materials}

아래 JSON 으로만 답한다.
{
  "title": "기사 제목 (25자 내외, 과장 없이 핵심을 담은 신문 제목)",
  "subtitle": "부제 (40자 내외)",
  "summary": "기사 요약 2문장",
  "content": "마크다운 본문 (### 소제목 포함)",
  "whyItMatters": "이 기사가 독자에게 중요한 이유 1~2문장",
  "impactOnExpats": "하노이 교민 생활에 주는 의미 1~2문장",
  "actionRequired": "독자가 실제로 쓸 수 있는 정보 1~2문장 (위치·이용 방법 등, 자료에 있는 것만)",
  "tags": ["태그1", "태그2", "태그3", "태그4"],
  "sns": {
    "instagram": "인스타그램 캡션 (해시태그 5개 이내)",
    "x": "X용 120자 요약",
    "threads": "스레드용 대화형 문장",
    "facebook": "페이스북용 요약"
  }
}`;

      const draftRes = await writer.generateContent(writePrompt);
      const draftText = draftRes.response.text().trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(draftText);

      // 편집장 검수: 취재 자료에 근거 없는 주장 찾기 (실패해도 초안은 돌려줌)
      let factCheck = [];
      try {
        const reviewPrompt = `당신은 베스트클럽 웹진의 편집장입니다. 아래 [기사]를 [취재 자료]와 한 문장씩 대조해,
취재 자료로 뒷받침되지 않는 구체적 주장(숫자, 인증, 수상, 연혁, 가격, 인용문, 가게에 대한 사실 단정, 과장 표현)을 찾습니다.
일반적인 배경 설명이나 분위기 묘사는 문제 삼지 않습니다. 문제가 없으면 빈 배열을 돌려줍니다.

[취재 자료]
${materials}

[기사]
제목: ${parsed.title}
부제: ${parsed.subtitle}
${parsed.content}

아래 JSON 으로만 답한다.
{ "issues": [ { "quote": "문제 문장(기사에서 그대로 발췌)", "reason": "왜 확인이 필요한지 한 줄" } ] }`;
        const reviewRes = await editor.generateContent(reviewPrompt);
        const reviewText = reviewRes.response.text().trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const issues = JSON.parse(reviewText).issues;
        if (Array.isArray(issues)) factCheck = issues.slice(0, 20);
      } catch (reviewErr) {
        console.warn('webzine fact-check failed:', reviewErr?.message || reviewErr);
        factCheck = [{ quote: '(검수 단계 실패)', reason: '편집장 검수를 실행하지 못했습니다. 숫자·인용문을 직접 확인해 주세요.' }];
      }

      const disclosure = `\n\n---\n\n*이 기사는 ${merchantData.name}의 협찬을 받아 베스트클럽 웹진이 취재·작성했습니다.*`;

      return {
        success: true,
        source: 'gemini',
        model: modelName,
        factCheck,
        article: {
          title: parsed.title,
          subtitle: parsed.subtitle,
          category,
          summary: parsed.summary,
          content: String(parsed.content || '') + disclosure,
          whyItMatters: parsed.whyItMatters || '',
          impactOnExpats: parsed.impactOnExpats || '',
          actionRequired: parsed.actionRequired || '',
          thumbnailUrl: getRandomThumbnail(category),
          readTime: `${Math.max(2, Math.round(String(parsed.content || '').length / 500))}분 읽기`,
          author: '베스트클럽 웹진 취재팀',
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
            benefit: '베스트클럽 결제 시 결제금 비례 포인트 잭팟 + 보너스티켓(BT)',
            qrUrl: `/pay.html?merchant=${encodeURIComponent(merchantData.id)}`
          },
          sns: parsed.sns
        }
      };
    } catch (aiErr) {
      aiError = String(aiErr?.message || aiErr).slice(0, 300);
      console.warn('Gemini generateContent failed, falling back to smart template:', aiErr);
    }
  } else {
    aiError = 'GEMINI_API_KEY 가 설정되어 있지 않습니다.';
  }

  // 3. Fallback: 스마트 템플릿 엔진으로 완전한 기사 즉시 생성
  const article = generateTemplateArticle({ category, topic, keywords, merchantData });
  return {
    success: true,
    source: 'template_engine',
    aiError,
    article
  };
}

module.exports = {
  buildWebzineContent,
  CATEGORY_THUMBNAILS,
  getRandomThumbnail
};
