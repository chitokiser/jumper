// /assets/js/pages/webzine-ai.js
import { functions } from "/assets/js/firebase-init.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

/**
 * 카테고리별 고품질 에디토리얼 썸네일 프리셋
 */
export const CATEGORY_THUMBNAILS = {
  'K-푸드': [
    'https://images.unsplash.com/photo-1590301157890-4810ed352733?auto=format&fit=crop&w=1200&q=80', // 치킨
    'https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=1200&q=80', // 한식 상차림
    'https://images.unsplash.com/photo-1553163147-622ab57be1c7?auto=format&fit=crop&w=1200&q=80'  // 바베큐
  ],
  'K-POP': [
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80'
  ],
  'K-뷰티': [
    'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1200&q=80'
  ],
  'K-드라마': [
    'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80'
  ],
  '하노이 라이프': [
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80'
  ],
  '베트남 뉴스': [
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80'
  ],
  '문화/생활': [
    'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80'
  ]
};

export function getRandomThumbnail(category) {
  const list = CATEGORY_THUMBNAILS[category] || CATEGORY_THUMBNAILS['K-푸드'];
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * 스마트 클라이언트 템플릿 기사 생성기 (고품질 저널리즘 에디토리얼)
 */
export function generateClientArticle({ category = 'K-푸드', topic = '', keywords = '', merchant = {} }) {
  const mName = merchant.name || merchant.merchantName || '대한김치 & 치킨';
  const mCategory = merchant.category || merchant.career || 'K-푸드 전문점';
  const mRegion = merchant.region || merchant.address || '하노이 미딩 한인타운 (My Dinh)';
  const mDesc = merchant.description || '정통 한국의 맛과 넉넉한 인심을 자랑하는 베스트클럽 대표 가맹점';
  const mPhone = merchant.phone || '024-3787-8899';
  const mHours = merchant.hours || '매일 10:30 ~ 23:00';
  const mMenu = merchant.signatureMenu || '한국식 바삭 후라이드 & 양념치킨, 숙성 배추김치';

  let title = '';
  let subtitle = '';
  let summary = '';
  let content = '';

  if (category === 'K-푸드' || !category) {
    title = topic || `하노이에서 즐기는 한국식 치킨과 K-푸드의 새로운 매력`;
    subtitle = `현지 미식가들의 입맛까지 사로잡은 바삭한 풍미와 정통 한식의 깊은 맛`;
    summary = `이국적인 하노이의 밤, 따뜻한 온기와 바삭한 식감으로 하루의 피로를 녹여주는 한국식 푸드 문화가 하노이 교민과 현지인들 사이에서 뜨거운 사랑을 받고 있습니다.`;
    content = `### 1. 하노이에 불어온 K-치킨 열풍, 그 특별한 비결\n\n베트남 하노이 거리를 걷다 보면 은은하게 풍겨오는 익숙하고 고소한 치킨 향기가 발걸음을 멈추게 합니다. 한국의 '치맥(치킨+맥주)' 문화는 이제 단순한 유행을 넘어, 소중한 사람들과 둘러앉아 따뜻한 정을 나누는 독보적인 식문화로 자리 잡았습니다.\n\n특히 하노이의 대표적인 한인 타운인 미딩(My Dinh)을 중심으로, 한국 정통 레시피 그대로 튀겨낸 겉바속촉 치킨과 깊은 풍미의 숙성 양념은 한국 교민뿐 아니라 베트남 현지 젊은 층 사이에서도 '꼭 경험해야 할 K-푸드'로 손꼽힙니다.\n\n### 2. 바삭함 뒤에 숨겨진 정성과 신선한 재료\n\n진정한 한식의 감동은 타협하지 않는 식재료의 신선함에서 출발합니다. 겉은 바삭하면서도 속살은 육즙을 가득 머금은 완벽한 튀김 기술, 그리고 한국에서 공수한 비법 양념의 조화는 한 입 베어 무는 순간 감탄을 자아냅니다.\n\n바쁜 일상을 마친 저녁, 시원한 음료와 함께 즐기는 따끈한 치킨 한 조각은 타국 생활의 향수를 달래주는 가장 확실한 힐링입니다.\n\n### 3. 베스트클럽 가맹점 혜택으로 더욱 풍성하게\n\n베스트클럽 멤버십 회원이라면 맛있는 식사와 함께 잊지 못할 혜택까지 누릴 수 있습니다. 매장 방문 결제 시 결제금에 비례한 포인트 잭팟이 적립되며, 글로벌 잭팟에 참여할 수 있는 보너스 티켓(BT)이 즉시 발급됩니다.`;
  } else if (category === 'K-뷰티') {
    title = topic || `하노이 K-뷰티 트렌드: 유리알 광채 피부의 비밀`;
    subtitle = `열대 기후 속에서도 건강하고 투명한 스킨케어 루틴과 맞춤 뷰티 케어`;
    summary = `베트남의 습하고 더운 기후 속에서도 맑고 투명한 피부를 유지하는 한국식 스킨케어 노하우가 하노이 뷰티 피플들의 마음을 사로잡고 있습니다.`;
    content = `### 1. 동남아 기후에 맞춘 스마트 K-뷰티 루틴\n\n강한 자외선과 높은 습도 속에서도 보송하면서 촉촉한 수분감을 잃지 않는 한국식 스킨케어는 전 세계적인 사랑을 받고 있습니다. 가벼운 수분 레이어링과 진정 케어가 핵심입니다.\n\n### 2. 정품 인증과 신뢰할 수 있는 뷰티 플랫폼\n\n현지에서 안심하고 한국 뷰티 서비스를 이용하고 검증된 제품을 만날 수 있는 가맹점들의 꼼꼼한 서비스가 주목받고 있습니다.\n\n### 3. 베스트클럽 회원 전용 뷰티 케어 혜택\n\n베스트클럽 가맹점에서 뷰티 서비스 및 제품 구매 시 특별한 포인트 혜택과 잭팟 티켓을 함께 챙겨보세요.`;
  } else if (category === '하노이 라이프') {
    title = topic || `하노이 속 작은 한국, 미딩 송다 라이프스타일 완벽 가이드`;
    subtitle = `맛집부터 생활 편의시설까지, 교민과 여행자를 위한 든든한 일상 탐방기`;
    summary = `베트남의 수도 하노이에서 한국의 정겨움과 활기를 고스란히 느낄 수 있는 미딩 지역의 알짜배기 생활 정보와 가맹점들을 소개합니다.`;
    content = `### 1. 하노이에서 만나는 가장 익숙한 편안함\n\n하노이 미딩 지역은 한국어 간판과 맛있는 한식당, 마트가 즐비해 마치 서울의 한 거리에 온 듯한 친근함을 줍니다.\n\n### 2. 엄선된 베스트클럽 파트너 매장 탐방\n\n품질과 위생, 그리고 한국의 친절한 서비스를 그대로 느낄 수 있는 공식 가맹점에서 소중한 추억을 만들어보세요.\n\n### 3. 결제할 때마다 쌓이는 즐거움\n\n가맹점 어디서나 베스트클럽 결제 시 행운의 포인트 잭팟 기회가 주어집니다.`;
  } else {
    title = topic || `한류와 하노이가 빚어내는 새로운 문화 트렌드`;
    subtitle = `음악, 음식, 라이프스타일이 하나로 이어지는 역동적인 도시의 기록`;
    summary = `베트남 현지에서 꽃피우는 다채로운 K-컬처 이야기와 일상에 활력을 불어넣는 추천 공간을 소개합니다.`;
    content = `### 1. 문화와 소통이 만드는 새로운 일상\n\n문화는 국경을 넘어 서로의 일상을 풍요롭게 채워줍니다. 하노이 중심에서 펼쳐지는 생생한 한류 트렌드를 만나보세요.\n\n### 2. 믿고 찾는 베스트클럽 공식 가맹점\n\n정직한 서비스와 감동을 전하는 가맹점을 방문하고 일상 속 특별한 혜택을 경험하세요.`;
  }

  const cleanTitle = title.replace(/"/g, '');
  const tags = ['베스트클럽', '하노이생활', category, mName.replace(/\s+/g, ''), 'K컬처', '가맹점혜택'];

  return {
    title: cleanTitle,
    subtitle,
    category,
    summary,
    content,
    thumbnailUrl: getRandomThumbnail(category),
    readTime: '3분 소요',
    author: '베스트클럽 에디토리얼 팀',
    tags,
    merchantInfo: {
      id: merchant.id || 'daehan_kimchi',
      name: mName,
      category: mCategory,
      region: mRegion,
      address: mRegion,
      description: mDesc,
      phone: mPhone,
      hours: mHours,
      signatureMenu: mMenu,
      benefit: '베스트클럽 결제 시 결제금 비례 포인트 잭팟 + BT 티켓 증정',
      qrUrl: `/pay.html?merchant=${encodeURIComponent(merchant.id || 'daehan_kimchi')}`
    },
    sns: {
      instagram: `[베스트 매거진 픽 ✨] ${cleanTitle}\n\n하노이에서 만나는 특별한 순간! ${summary}\n\n📍 기사 제공 | ${mName}\n- 위치: ${mRegion}\n- 대표메뉴: ${mMenu}\n- 혜택: 베스트클럽 회원 결제 시 결제금 비례 포인트 잭팟 + BT 지급 🎟️\n\n더 자세한 매거진 기사는 프로필 링크에서 확인하세요!\n#베스트클럽 #하노이라이프 #${category} #하노이맛집 #K컬처 #${mName.replace(/\s+/g, '')}`,
      x: `[베스트 매거진] "${cleanTitle}"\n${summary.slice(0, 80)}...\n\n👉 기사 제공: ${mName} (${mRegion})\n자세히 보기: https://bestclubvn.netlify.app/kca_webzine.html`,
      threads: `하노이에서 만나는 최고의 순간 💫\n\n"${cleanTitle}"\n\n${summary}\n\n오늘 저녁은 ${mName}에서 맛있는 시간 보내고 베스트클럽 포인트 잭팟도 챙겨보시는 건 어떨까요? 여러분의 최애 메뉴는 무엇인가요? 댓글로 공유해 주세요! 👇`,
      facebook: `[베스트 클럽 웹진 카드뉴스] ${cleanTitle}\n\n${summary}\n\n■ 기사 제공 및 추천 매장\n- 상호명: ${mName}\n- 주소: ${mRegion}\n- 문의: ${mPhone}\n- 혜택: 베스트클럽 결제 시 포인트 잭팟 참여\n\n전체 기사 읽기: https://bestclubvn.netlify.app/kca_webzine.html`
    }
  };
}

/**
 * AI 기사 생성 통합 함수 (Cloud Function 호출 -> 실패 시 클라이언트 스마트 생성)
 */
export async function generateWebzineArticle({ merchantId, category, topic, keywords, merchantData }) {
  try {
    const fn = httpsCallable(functions, "buildWebzineContent");
    const res = await fn({ merchantId, category, topic, keywords });
    if (res?.data?.article) {
      return res.data.article;
    }
  } catch (err) {
    console.warn("Cloud function buildWebzineContent fallback to client engine:", err.message);
  }

  // Fallback to client template generator
  return generateClientArticle({
    category,
    topic,
    keywords,
    merchant: merchantData
  });
}
