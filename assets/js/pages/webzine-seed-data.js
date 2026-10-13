// /assets/js/pages/webzine-seed-data.js
/**
 * 베스트 매거진(BestClub Webzine) 20종 프리미엄 샘플 기사 데이터
 */
export const WEBZINE_20_ARTICLES = [
  {
    id: "article-01-chicken",
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
      region: "하노이 미딩 송다",
      address: "하노이 미딩 송다 CT1 정문 앞",
      phone: "024-3787-8899",
      hours: "매일 11:00 ~ 23:30",
      signatureMenu: "한국식 크리스피 후라이드 & 특제 마늘간장 치킨, 전통 배추김치",
      benefit: "베스트클럽 결제 시 5% 즉시 포인트 페이백 + 잭팟 보너스티켓(BT) 즉시 발급!",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[베스트 매거진 픽 ✨] 하노이 미딩에서 만나는 겉바속촉 한국식 치킨!\n오늘 저녁 바삭한 치킨에 시원한 한 잔 어떠세요? 🍗\n\n📍 기사 제공 | 대한치킨 & 대한김치\n- 위치: 하노이 미딩 송다 CT1 정문 앞\n- 혜택: 베스트클럽 회원 5% 포인트 페이백 + 잭팟 BT 티켓!\n#하노이치킨 #미딩맛집 #K푸드 #베스트클럽",
      x: "[베스트 매거진] 하노이에서 즐기는 한국식 치킨 문화! 결제 시 5% 포인트 페이백 혜택까지 만나보세요.\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "하노이 살면서 가장 그리운 한국의 맛 치킨 🍗 퇴근길 바삭한 치킨 한 마리면 하루 피로가 싹 가시죠!",
      facebook: "[베스트 클럽 웹진] 하노이 미딩에서 만나는 한국식 치킨의 매력과 공식 가맹점 혜택 안내"
    }
  },
  {
    id: "article-02-kbbq",
    title: "하노이에서 즐기는 정통 숯불 삼겹살과 구수한 된장찌개의 정석",
    subtitle: "두툼한 생삼겹살의 고소한 육즙과 숯불 향이 전하는 한국 고기구이의 진수",
    category: "K-푸드",
    summary: "지글지글 불판 위에서 익어가는 두툼한 삼겹살과 신선한 쌈 채소의 조화. 타국 생활의 활력을 불어넣는 든든한 한 끼를 소개합니다.",
    content: `### 1. 숯불 위에서 피어나는 한국의 정취\n\n두툼하게 썰어낸 질 좋은 삼겹살이 뜨거운 숯불 불판에 닿는 순간 들리는 경쾌한 소리는 언제나 식욕을 돋웁니다. 정통 한국식 삼겹살 구이는 잘 익은 김치, 마늘과 함께 깻잎과 상추에 크게 쌈을 싸서 먹을 때 그 진가를 발휘합니다.\n\n### 2. 뚝배기 가득 끓여낸 쇠고기 된장찌개\n\n고기를 먹은 후 칼칼하고 구수하게 끓여낸 뚝배기 된장찌개에 공깃밥을 곁들이면 더할 나위 없는 완벽한 식사가 완성됩니다. 하노이 현지에서도 한국 교민들과 베트남 미식가들이 즐겨 찾는 대표 외식 코스입니다.\n\n### 3. 가족, 동료와 함께하는 풍성한 저녁\n\n베스트클럽 공식 파트너 고기 전문점에서 소중한 사람들과 편안한 식사를 즐기고 특별한 페이백 혜택도 놓치지 마세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1553163147-622ab57be1c7?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 최원석",
    dateStr: "2026. 10. 13",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "미딩 정통 숯불갈비 & 삼겹살",
      category: "K-푸드 한식 고기구이",
      region: "하노이 미딩 송다",
      address: "하노이 미딩 매너 상가 2층",
      phone: "024-3787-1122",
      hours: "매일 11:30 ~ 22:30",
      signatureMenu: "숙성 통삼겹살, 양념 소갈비살, 차돌 된장찌개",
      benefit: "베스트클럽 결제 시 5% 즉시 포인트 페이백 + 잭팟 BT 발급",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[고기러버 필독 🥓] 하노이에서 맛보는 육즙 가득 숯불 삼겹살!\n뚝배기 된장찌개까지 완벽한 한 상! #하노이삼겹살 #미딩맛집 #K푸드 #베스트클럽",
      x: "[베스트 매거진] 지글지글 숯불 삼겹살의 유혹! 하노이 미딩 정통 고기구이 전문점 탐방기\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "숯불 삼겹살에 쌈장 콕 찍어 한 쌈 먹으면 그곳이 바로 힐링 플레이스죠 ✨ 여러분의 고기 취향은?",
      facebook: "[베스트 클럽 웹진] 하노이 숯불 삼겹살 맛집 추천 및 베스트클럽 회원 전용 혜택"
    }
  },
  {
    id: "article-03-bunsik",
    title: "K-스트리트 푸드의 정점: 매콤달콤 떡볶이와 바삭한 튀김",
    subtitle: "학창 시절 추억을 소환하는 국민 간식, 하노이 MZ세대의 최애 푸드로 자리잡다",
    category: "K-푸드",
    summary: "쫀득한 쌀떡과 쫄깃한 어묵에 배어든 매콤달콤한 소스, 갓 튀겨낸 김말이와 튀김이 선사하는 한국 분식의 매력에 빠져보세요.",
    content: `### 1. 전 세계인이 사랑하는 K-소울푸드, 떡볶이\n\n빨간 고추장 베이스의 매콤달콤한 양념에 쫀득한 떡이 어우러진 떡볶이는 한국인뿐 아니라 베트남 젊은 세대 사이에서도 독보적인 인기를 누리고 있습니다.\n\n### 2. 환상의 짝꿍: 수제 튀김과 김밥\n\n바삭한 김말이와 오징어 튀김을 떡볶이 국물에 푹 찍어 먹는 즐거움은 분식만의 백미입니다. 참기름 향이 솔솔 풍기는 정갈한 김밥 한 줄을 곁들이면 훌륭한 든든한 한 끼가 됩니다.\n\n### 3. 베스트클럽과 함께하는 가벼운 스낵 타임\n\n출출한 오후, 퇴근길 가볍게 들러 즐기는 분식 한 접시! 베스트클럽 회원이라면 간편 결제와 포인트 적립까지 손쉽게 누릴 수 있습니다.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=1200&q=80",
    readTime: "2분 읽기",
    author: "에디터 강민지",
    dateStr: "2026. 10. 12",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "서울 분식 & 떡볶이 하노이점",
      category: "K-푸드 분식 / 스낵",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 중앙 광장 옆",
      phone: "024-3888-4455",
      hours: "매일 10:00 ~ 22:00",
      signatureMenu: "국물 떡볶이, 수제 모둠튀김, 참치마요 김밥",
      benefit: "베스트클럽 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[분식 땡기는 날 🍢] 매콤달콤 국물 떡볶이에 튀김 푹 찍어 먹기!\n하노이에서 즐기는 한국 분식의 맛! #하노이떡볶이 #K분식 #베스트클럽",
      x: "[베스트 매거진] K-스트리트 푸드 열풍! 떡볶이와 튀김의 환상 궁합\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "매콤한 떡볶이 국물에 김말이 튀김 찍어먹는 맛 아시는 분? 오늘 간식으로 어떠세요! 😋",
      facebook: "[베스트 클럽 웹진] 하노이에서 만나는 한국식 분식 트렌드와 추천 매장 안내"
    }
  },
  {
    id: "article-04-kimchi",
    title: "30년 손맛의 비결: 하노이에서 맛보는 정통 숙성 배추김치",
    subtitle: "한국산 태양초 고춧가루와 멸치액젓으로 빚어낸 아삭하고 시원한 발효의 미학",
    category: "K-푸드",
    summary: "밥상 위의 주인공이자 한식의 정체성, 정성 어린 발효 기술로 하노이 교민들의 식탁을 지켜주는 정통 김치 이야기를 전합니다.",
    content: `### 1. 발효 과학이 완성한 깊은 맛\n\n잘 절여진 배추 속 가득 채워 넣은 무채와 파, 마늘, 생강 그리고 고운 빛깔의 고춧가루. 정성으로 빚어 자연 숙성된 김치는 씹을수록 아삭하고 톡 쏘는 탄산감과 감칠맛을 선사합니다.\n\n### 2. 타국 생활의 든든한 버팀목\n\n따뜻한 흰쌀밥에 김치 한 점, 혹은 푹 끓여낸 묵은지 김치찌개는 타국 생활의 외로움과 향수를 달래주는 최고의 보약입니다.\n\n### 3. 산지 직송 신선함과 안심 먹거리\n\n베스트클럽 인증 가맹점에서 매일 담그는 신선한 겉절이부터 깊은 맛의 숙성 김치까지 편리하게 만나보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 정소연",
    dateStr: "2026. 10. 12",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "대한김치 명가 (Daehan Kimchi)",
      category: "K-푸드 전통 발효식품",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 CT1 상가 102호",
      phone: "024-3787-8899",
      hours: "매일 09:00 ~ 21:00",
      signatureMenu: "전통 포기김치, 숙성 묵은지, 깍두기, 열무김치",
      benefit: "베스트클럽 회원 5% 포인트 적립 & 잭팟 참여",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[한국인의 소울푸드 🥬] 아삭아삭 시원한 대한김치!\n갓 지은 밥에 김치 하나면 한 끼 뚝딱! #대한김치 #하노이김치 #K푸드 #베스트클럽",
      x: "[베스트 매거진] 하노이에서 만나는 30년 손맛 숙성 배추김치\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "잘 익은 묵은지로 끓인 김치찌개는 정말 못 참죠! 여러분은 겉절이파인가요, 묵은지파인가요? 🥢",
      facebook: "[베스트 클럽 웹진] 정통 발효 배추김치의 매력과 하노이 대표 가맹점 소개"
    }
  },
  {
    id: "article-05-kpop-dance",
    title: "글로벌 차트를 뒤흔든 K-POP 열풍: 하노이 청년들의 댄스 챌린지",
    subtitle: "호안끼엠 보행자 거리에서 울려 퍼지는 경쾌한 비트와 열정적인 한류 댄스 문화",
    category: "K-POP",
    summary: "주말마다 하노이 도심을 뜨겁게 달구는 K-POP 커버 댄스 크루들. 음악으로 소통하고 하나가 되는 젊음의 에너지를 취재했습니다.",
    content: `### 1. 호안끼엠 광장에 울려 퍼지는 K-POP 비트\n\n주말 저녁 하노이 호안끼엠 호수 주변은 K-POP 음악에 맞춰 절도 있는 칼군무를 선보이는 베트남 청년들로 가득합니다. SNS 숏폼 플랫폼을 타고 번진 댄스 챌린지는 세대와 국경을 잇는 활력소가 되었습니다.\n\n### 2. 단순한 음악을 넘어선 라이프스타일\n\n아이돌의 패션, 메이크업, 안무까지 세심하게 커버하는 이들의 열정은 한류가 일상 깊숙이 자리 잡았음을 증명합니다.\n\n### 3. K-컬처를 더 가깝게 즐기는 방법\n\n베스트클럽 파트너 댄스 아카데미 및 문화 공간에서 K-POP 안무를 배우고 다채로운 이벤트 혜택도 함께 누려보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 류진우",
    dateStr: "2026. 10. 11",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "K-컬처 댄스 & 보컬 스튜디오",
      category: "K-POP 문화 예술 아카데미",
      region: "하노이 꺼우저이 (Cau Giay)",
      address: "하노이 꺼우저이 두이딴로 18",
      phone: "024-3912-3344",
      hours: "매일 13:00 ~ 22:00",
      signatureMenu: "K-POP 최신곡 커버 댄스 클래스, 보컬 레슨",
      benefit: "수강료 결제 시 5% 포인트 페이백 + 잭팟 티켓",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[K-POP 핫이슈 🎶] 하노이 청춘들이 열광하는 K-POP 댄스 챌린지 현장!\n#KPOP #하노이댄스 #칼군무 #베스트클럽",
      x: "[베스트 매거진] 하노이 도심을 수놓은 K-POP 커버 댄스 열풍!\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "요즘 가장 귀에 맴도는 K-POP 노래는 무엇인가요? 🎧 주말마다 챌린지 영상 보느라 시간 가는 줄 모르네요!",
      facebook: "[베스트 클럽 웹진] 하노이 K-POP 댄스 문화 리포트와 공식 파트너 스튜디오 안내"
    }
  },
  {
    id: "article-06-kpop-concert",
    title: "하노이 미딘 스타디움 콘서트 비하인드: K-스타가 남긴 감동",
    subtitle: "수만 명의 환호성으로 가득 찼던 공연장의 열기와 공식 굿즈 트렌드",
    category: "K-POP",
    summary: "하노이에서 열린 대형 K-POP 스타들의 콘서트 현장 스토리와 팬덤이 만들어내는 따뜻한 기부 및 나눔 문화를 돌아봅니다.",
    content: `### 1. 응원봉 물결로 빛난 하노이의 밤\n\n대형 K-POP 스타들의 하노이 방문은 도시 전체를 축제의 도가니로 만들었습니다. 밤하늘을 수놓은 각양각색의 응원봉과 떼창은 아티스트와 팬 모두에게 잊지 못할 전율을 선사했습니다.\n\n### 2. 팬덤이 이끄는 건강한 문화 소비\n\n공식 앨범, 굿즈 수집뿐 아니라 현지 취약 계층을 돕는 기부 캠페인까지 펼치며 성숙한 팬덤 문화를 보여주고 있습니다.\n\n### 3. 정품 굿즈와 공식 제휴 혜택\n\n베스트클럽 제휴 K-스타 라운지에서 안심하고 정품 음반과 굿즈를 만나보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 김하늘",
    dateStr: "2026. 10. 11",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "K-스타 굿즈 & 음반 라운지",
      category: "K-POP 엔터테인먼트 상품",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 플라자 3층",
      phone: "024-3788-9900",
      hours: "매일 10:00 ~ 21:30",
      signatureMenu: "공식 응원봉, 한정판 K-POP 앨범, 포토카드 세트",
      benefit: "베스트클럽 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[K-POP 콘서트 감동 ✨] 하노이를 뜨겁게 달군 스타들의 무대 비하인드!\n#하노이콘서트 #KPOP굿즈 #응원봉 #베스트클럽",
      x: "[베스트 매거진] 하노이 미딘 스타디움을 가득 채운 K-POP 스타들의 감동 무대\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "콘서트 다녀오신 후유증 앓고 계신 분들 계신가요? 🎤 응원봉 불빛이 아직도 눈에 아른거리네요!",
      facebook: "[베스트 클럽 웹진] K-POP 하노이 콘서트 특집 리포트 및 공식 제휴처 안내"
    }
  },
  {
    id: "article-07-kbeauty-skincare",
    title: "열대 기후를 이기는 유리알 피부: 하노이 맞춤 K-스킨케어 5단계",
    subtitle: "고온다습한 날씨 속에서도 무너지지 않는 수분 진정과 자외선 차단 꿀팁",
    category: "K-뷰티",
    summary: "강한 자외선과 습도 속에서도 맑고 투명한 피부 컨디션을 지켜주는 한국식 피부 관리 루틴을 전문가의 조언과 함께 공개합니다.",
    content: `### 1. 모공 케어와 가벼운 수분 공급\n\n열대 기후에서는 유분기를 줄이고 수분을 촘촘하게 채워주는 워터리 에센스와 수딩 젤의 단계별 레이어링이 필수입니다. 약산성 클렌저로 모공 속 노폐물을 부드럽게 세정하는 것이 첫걸음입니다.\n\n### 2. 자외선 차단제는 365일 필수\n\n백탁 현상 없이 산뜻하게 밀착되는 한국산 선크림은 하노이 현지인들에게도 머스트해브 아이템입니다.\n\n### 3. 프리미엄 에스테틱의 맞춤 솔루션\n\n베스트클럽 공식 파트너 에스테틱에서 전문 테라피스트의 체계적인 스킨케어를 경험하고 포인트 혜택도 챙겨보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 이수민",
    dateStr: "2026. 10. 10",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "K-스킨 에스테틱 & 뷰티",
      category: "K-뷰티 스킨케어 전문",
      region: "하노이 쭝화",
      address: "하노이 쭝화 냔칭 12동",
      phone: "024-3555-7788",
      hours: "매일 09:30 ~ 20:30",
      signatureMenu: "유리알 수분 진정 케어, 모공 딥클렌징 테라피",
      benefit: "베스트클럽 회원 전용 5% 즉시 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[K-뷰티 스킨케어 팁 💧] 하노이 습한 날씨에도 끄떡없는 유리알 피부 관리법!\n#K뷰티 #유리알피부 #스킨케어루틴 #하노이에스테틱 #베스트클럽",
      x: "[베스트 매거진] 열대 기후를 이기는 K-스킨케어 비법 대공개!\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "자외선 강한 요즘, 피부 진정 어떻게 하시나요? 🌿 알로에와 약산성 토너는 필수템이죠!",
      facebook: "[베스트 클럽 웹진] 하노이 뷰티 피플을 위한 한국식 피부 관리 5단계 루틴"
    }
  },
  {
    id: "article-08-kbeauty-hair",
    title: "하노이 트렌드세터를 위한 K-헤어 스타일링: 레이어드 컷 & 퍼스널 컬러",
    subtitle: "자연스러운 볼륨감과 세련된 감각으로 완성하는 한국식 프리미엄 살롱 트렌드",
    category: "K-뷰티",
    summary: "손질이 편하면서도 얼굴형을 살려주는 한국식 레이어드 펌과 톤다운 매직. 하노이 핫플레이스로 떠오른 헤어 살롱 소식을 전합니다.",
    content: `### 1. 가볍고 세련된 레이어드 컷의 매력\n\n더운 날씨에 머리 숱이 많아 답답함을 느끼는 이들에게 질감을 가볍게 정리해 주는 레이어드 컷과 C컬 펌은 최고의 선택입니다.\n\n### 2. 한국산 프리미엄 펌제와 손상 최소화\n\n모발 건강을 최우선으로 생각하는 한국 헤어 디자이너들의 꼼꼼한 시술과 클리닉 서비스는 현지 고객들에게도 두터운 신뢰를 얻고 있습니다.\n\n### 3. 나만의 인생 헤어 찾기\n\n베스트클럽 제휴 살롱에서 예약하고 기분 좋은 스타일 변신과 함께 알뜰한 페이백 혜택을 누려보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80",
    readTime: "2분 읽기",
    author: "에디터 박준형",
    dateStr: "2026. 10. 10",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "서울 헤어 디자인 스튜디오",
      category: "K-뷰티 헤어 살롱",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 CT5 상가 2층",
      phone: "024-3789-5566",
      hours: "매일 10:00 ~ 20:00 (월요일 휴무)",
      signatureMenu: "한국식 레이어드 C컬펌, 두피 클리닉",
      benefit: "시술 금액 5% 포인트 페이백 + 잭팟 티켓",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[헤어 스타일 변신 💇‍♀️] 자연스러운 볼륨감의 한국식 레이어드 펌!\n인생 헤어 찾고 베스트클럽 페이백도 챙기세요. #하노이미용실 #K헤어 #레이어드컷 #베스트클럽",
      x: "[베스트 매거진] 하노이에서 경험하는 정통 K-헤어 스타일링 트렌드 리포트\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "계절 바뀔 때 헤어스타일 바꾸고 싶어지는 분들 손! 🙋‍♀️ 요즘 대세 레이어드 컷 어떠세요?",
      facebook: "[베스트 클럽 웹진] 하노이 헤어 살롱 추천 및 인기 K-헤어 스타일 가이드"
    }
  },
  {
    id: "article-09-kdrama-spots",
    title: "드라마 속 그 장면처럼: 한국 로맨스 드라마 촬영지 랜선 투어",
    subtitle: "남산타워부터 북촌 한옥마을까지, 가슴 설레는 K-드라마 명소 Best 5",
    category: "K-드라마",
    summary: "드라마 속 주인공들의 애틋한 사랑과 추억이 깃든 한국의 대표 촬영지들을 따라가며 로맨틱한 감성에 젖어보세요.",
    content: `### 1. 남산 서울타워의 사랑의 자물쇠\n\n수많은 K-드라마의 단골 프러포즈 장소인 남산타워는 서울의 화려한 야경과 함께 로맨틱한 분위기를 만끽할 수 있는 명소입니다.\n\n### 2. 북촌 한옥마을의 고즈넉한 골목길\n\n전통과 현대가 어우러진 북촌 한옥마을은 한복을 차려입고 드라마 속 주인공처럼 인생 사진을 남기기에 최적의 코스입니다.\n\n### 3. 드라마 감성을 하노이에서 즐기다\n\n베스트클럽 파트너 테마 라운지에서 드라마 속 익숙한 소품과 한국식 디저트를 맛보며 따뜻한 여유를 즐겨보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 강민지",
    dateStr: "2026. 10. 09",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "K-드라마 컬처 라운지 & 카페",
      category: "K-드라마 문화 공간 / 카페",
      region: "하노이 서호",
      address: "하노이 서호 쑤안지에우 45",
      phone: "024-3888-7711",
      hours: "매일 09:00 ~ 22:30",
      signatureMenu: "한국 전통 한방차, 수제 약과, 흑임자 라떼",
      benefit: "베스트클럽 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[K-드라마 명소 🎬] 드라마 속 주인공이 되어보는 서울 로맨틱 촬영지 투어!\n#K드라마 #드라마촬영지 #남산타워 #북촌한옥마을 #베스트클럽",
      x: "[베스트 매거진] 가슴 설레는 K-드라마 촬영지 Best 5와 감성 여행기\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "여러분의 인생 K-드라마는 무엇인가요? 📺 배경음악만 들어도 아련해지는 명장면들 떠올려보세요!",
      facebook: "[베스트 클럽 웹진] K-드라마 촬영지 가이드 및 하노이 제휴 카페 혜택"
    }
  },
  {
    id: "article-10-kdrama-story",
    title: "눈물의 여왕부터 도깨비까지: K-드라마가 전 세계를 사로잡은 비결",
    subtitle: "탄탄한 대본과 감각적인 연출, 그리고 보편적인 인간애가 만들어낸 글로벌 신드롬",
    category: "K-드라마",
    summary: "문화적 경계를 뛰어넘어 전 세계 시청자들의 눈시울을 적시고 웃음을 준 K-드라마의 독보적인 스토리텔링 힘을 분석합니다.",
    content: `### 1. 감정을 흔드는 디테일한 심리 묘사\n\n인물 간의 섬세한 갈등과 서사, 그리고 예측 불허의 전개는 한번 보기 시작하면 멈출 수 없는 몰입감을 선사합니다.\n\n### 2. OST가 더하는 깊은 울림\n\n명장면마다 흐르는 감미로운 배경음악(OST)은 장면의 감동을 배가시키며 전 세계 음원 차트까지 점령했습니다.\n\n### 3. K-드라마가 바꾼 라이프스타일\n\n드라마에 등장하는 한국 음식, 패션, 인테리어는 이제 하나의 글로벌 라이프스타일 표준이 되었습니다.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1518173946687-a4c8a383392e?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 정소연",
    dateStr: "2026. 10. 09",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "K-미디어 북스 & 콘텐츠 허브",
      category: "K-드라마 도서 / 음반 유통",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 CT1 상가 2층",
      phone: "024-3787-6655",
      hours: "매일 10:00 ~ 21:00",
      signatureMenu: "K-드라마 대본집, 공식 포토에세이, 한국 원서 소설",
      benefit: "베스트클럽 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[K-드라마 리포트 📺] 전 세계가 열광하는 K-드라마 흥행의 비밀!\n#K드라마 #눈물의여왕 #도깨비 #한국드라마 #베스트클럽",
      x: "[베스트 매거진] K-드라마가 글로벌 신드롬을 일으킨 3가지 이유\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "주말에 정주행하기 좋은 드라마 추천해주세요! 밤새도록 보게 만드는 마성의 K-드라마 🌙",
      facebook: "[베스트 클럽 웹진] K-드라마 글로벌 인기 비결과 관련 제휴 서점 안내"
    }
  },
  {
    id: "article-11-ktravel-seoul",
    title: "사계절이 살아 숨 쉬는 한국: 베트남 여행자를 위한 서울·제주 꿀팁",
    subtitle: "화려한 도심의 쇼핑부터 에메랄드빛 제주의 자연까지, 완벽한 여행 코스",
    category: "K-여행",
    summary: "비자 준비부터 편리한 교통 카드 활용, 그리고 꼭 맛봐야 할 로컬 맛집까지 베트남 여행객을 위한 알짜 한국 여행 가이드입니다.",
    content: `### 1. 트렌드의 중심, 서울 도심 탐방\n\n성수동의 감성 카페 골목과 홍대, 명동의 활기찬 거리, 그리고 경복궁 한복 체험은 서울 여행의 필수 코스입니다.\n\n### 2. 천혜의 힐링 아일랜드, 제주도\n\n성산일출봉과 섭지코지의 웅장한 바다 풍경, 흑돼지 구이와 신선한 해산물은 오감을 만족시키는 특별한 경험을 제공합니다.\n\n### 3. 스마트 여행 상담 서비스\n\n베스트클럽 공식 파트너 여행사에서 편리한 항공권 예약과 투어 패키지 혜택을 확인해 보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1538485399081-7191377e8241?auto=format&fit=crop&w=1200&q=80",
    readTime: "4분 읽기",
    author: "에디터 류진우",
    dateStr: "2026. 10. 08",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "K-투어 플래닛 여행사",
      category: "K-여행 / 비자 컨설팅",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 중앙로 35 2층",
      phone: "024-3999-8800",
      hours: "평일 09:00 ~ 18:00 (토요일 오전 근무)",
      signatureMenu: "한국 관광비자 대행, 서울·제주 맞춤 투어 패키지",
      benefit: "여행 상품 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[한국 여행 가이드 ✈️] 서울부터 제주까지 완벽 정복!\n가족, 친구와 함께 떠나는 한국 여행 꿀팁. #한국여행 #서울여행 #제주도 #베스트클럽",
      x: "[베스트 매거진] 베트남 여행자를 위한 서울·제주 맞춤 여행 코스 추천\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "한국 여행 갈 때 가장 먼저 가보고 싶은 장소는 어디인가요? 🗼 쇼핑 성지 성수동 vs 힐링 제주도!",
      facebook: "[베스트 클럽 웹진] 베트남 출발 한국 여행 준비 가이드 및 제휴 여행사 혜택"
    }
  },
  {
    id: "article-12-ktravel-autumn",
    title: "붉게 물든 단풍과 순백의 설경: 한국의 가을·겨울 힐링 명소",
    subtitle: "설악산 단풍 로드와 강원도 스키 리조트에서 만끽하는 계절의 절경",
    category: "K-여행",
    summary: "동남아에서는 경험하기 어려운 오색 단풍의 향연과 눈 덮인 겨울 왕국. 낭만 가득한 한국의 계절 여행지로 떠나보세요.",
    content: `### 1. 설악산과 내장산의 화려한 단풍 터널\n\n가을이면 산 전체가 붉고 노란 융단을 깔아놓은 듯 장관을 이루는 한국의 국립공원은 걷는 것만으로도 마음의 정화를 안겨줍니다.\n\n### 2. 눈부신 은빛 설원과 스키 리조트\n\n겨울철 강원도 스키장은 베트남 관광객들에게 평생 잊지 못할 순백의 추억과 짜릿한 겨울 스포츠의 묘미를 선사합니다.\n\n### 3. 계절 특화 투어 혜택\n\n베스트클럽 제휴사를 통해 따뜻한 온천 여행과 스키 패키지를 합리적인 가격에 예약하세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 최원석",
    dateStr: "2026. 10. 08",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "하나로 글로벌 트래블",
      category: "K-여행 / 항공 레저",
      region: "하노이 꺼우저이",
      address: "하노이 꺼우저이 쩐타이통 10",
      phone: "024-3755-9988",
      hours: "매일 09:00 ~ 19:00",
      signatureMenu: "강원도 스키 캠프, 가을 단풍 힐링 패키지",
      benefit: "베스트클럽 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[계절 여행 🍁❄️] 눈부신 단풍과 로맨틱한 스키장으로 떠나요!\n#한국단풍 #겨울스키 #설악산 #베스트클럽",
      x: "[베스트 매거진] 낭만 가득한 한국 가을·겨울 여행지 Best 4\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "눈 덮인 하얀 풍경 속에서 따끈한 호떡 하나 먹는 기분! 올겨울 눈 보러 가실 분? ☃️",
      facebook: "[베스트 클럽 웹진] 한국 가을·겨울 힐링 여행지 추천 및 베스트클럽 회원 특가"
    }
  },
  {
    id: "article-13-kculture-cvs",
    title: "24시간 불이 꺼지지 않는 한국의 편의점 미식 문화",
    subtitle: "한강 라면 끓이기부터 다채로운 콜라보 디저트까지, 소소한 일상의 행복",
    category: "한국 생활문화",
    summary: "밤낮없이 골목을 밝혀주는 한국의 편의점. 단순한 유통 매장을 넘어 하나의 독창적인 문화 플랫폼이 된 이야기를 조명합니다.",
    content: `### 1. 전용 조리기로 끓여 먹는 '한강 라면'\n\n은박 냄비에 스프와 면을 넣고 버튼 하나만 누르면 완성되는 꼬들꼬들한 라면은 한국을 방문한 외국인들이 손꼽는 최고의 이색 체험입니다.\n\n### 2. 가성비와 퀄리티를 모두 잡은 PB 상품\n\n유명 셰프나 인기 캐릭터와 콜라보한 도시락, 생크림 빵, 삼각김밥은 편의점을 미식의 보물창고로 만들었습니다.\n\n### 3. 하노이에서 만나는 한국식 편의마트\n\n베스트클럽 제휴 한인 편의마트에서 한국 직수입 스낵과 간편식을 바로 만나보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 강민지",
    dateStr: "2026. 10. 07",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "베스트 한인 24 편의마트",
      category: "한국 생활문화 / 편의 유통",
      region: "하노이 미딩 송다",
      address: "하노이 미딩 송다 중앙광장 1층",
      phone: "024-3787-2424",
      hours: "24시간 연중무휴",
      signatureMenu: "즉석 끓인 라면 머신, 한국 아이스크림, 냉동 간편식",
      benefit: "전 품목 베스트클럽 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[K-편의점 털기 🍜] 즉석 기계로 끓여먹는 라면의 환상적인 맛!\n#한국편의점 #한강라면 #편의점신상 #베스트클럽",
      x: "[베스트 매거진] 24시간 불 꺼지지 않는 한국 편의점 미식 문화 탐방기\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "야식으로 라면 끓여먹고 싶은 밤 🌙 여러분의 최애 편의점 조합은 무엇인가요?",
      facebook: "[베스트 클럽 웹진] 한국 편의점 문화 리포트와 하노이 24시 제휴 매장 안내"
    }
  },
  {
    id: "article-14-kculture-cafe",
    title: "커피 공화국 한국의 독창적인 카페 감성과 디저트 트렌드",
    subtitle: "크로플부터 소금빵까지, 감각적인 인테리어와 디저트가 어우러진 휴식 공간",
    category: "한국 생활문화",
    summary: "골목마다 자리한 개성 넘치는 공간과 향긋한 커피, 그리고 트렌드를 이끄는 K-디저트의 매력을 탐방해 봅니다.",
    content: `### 1. 단순한 커피숍을 넘어선 감성 공간\n\n미니멀한 인테리어와 통창 너머로 비치는 햇살, 감각적인 음악이 흐르는 한국식 카페는 바쁜 현대인들에게 가장 친근한 쉼터입니다.\n\n### 2. 크로와상과 와플의 만남, 크로플 신드롬\n\n겉은 바삭하고 속은 쫄깃한 크로플 위에 바닐라 아이스크림을 얹은 디저트는 커피와 완벽한 조화를 이룹니다.\n\n### 3. 하노이에서 즐기는 서울의 카페 무드\n\n베스트클럽 파트너 카페에서 여유로운 오후 티타임을 즐기고 포인트 적립도 챙겨보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1200&q=80",
    readTime: "2분 읽기",
    author: "에디터 이수민",
    dateStr: "2026. 10. 07",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "카페 서울 하노이 (Cafe Seoul)",
      category: "한국 생활문화 / 스페셜티 커피",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 골목 안길 15",
      phone: "024-3788-1212",
      hours: "매일 08:30 ~ 22:30",
      signatureMenu: "아인슈페너, 브라운치즈 크로플, 시그니처 소금빵",
      benefit: "음료 및 디저트 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[카페 투어 ☕] 감성 가득한 분위기와 달콤한 크로플의 유혹!\n#하노이카페 #크로플맛집 #아인슈페너 #베스트클럽",
      x: "[베스트 매거진] 한국식 감성 카페와 트렌디한 K-디저트의 모든 것\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "향긋한 커피 한 잔과 갓 구운 빵 냄새 🥐 오늘 오후 힐링 충전하러 가실 분!",
      facebook: "[베스트 클럽 웹진] 하노이에서 즐기는 한국식 감성 카페 투어 및 제휴 혜택"
    }
  },
  {
    id: "article-15-hanoi-mydinh",
    title: "하노이 속 작은 서울: 미딩(My Dinh) 송다 지역 완벽 생활 가이드",
    subtitle: "처음 방문한 주재원과 여행자도 단숨에 적응하는 알짜 생활 정보와 추천 동선",
    category: "하노이 라이프",
    summary: "편리한 인프라와 정겨운 한국어 간판이 반겨주는 하노이 미딩 지역의 병원, 마트, 맛집, 생활 편의시설을 정리했습니다.",
    content: `### 1. 하노이 최대 한인 커뮤니티의 중심\n\n미딩 송다 지역은 병원, 약국, 학원, 미용실, 세탁소 등 모든 생활 시설이 한국어로 소통 가능하여 타국 생활의 낯섦을 덜어줍니다.\n\n### 2. 베스트클럽 가맹점 밀집 구역\n\n미딩 지역 대부분의 우수 매장에서 베스트클럽 간편 결제를 이용할 수 있으며, 결제할 때마다 5% 포인트와 잭팟 보너스가 누적됩니다.\n\n### 3. 더욱 똑똑하고 편리한 미딩 생활\n\n지역 내 검증된 매장 네트워크와 함께 안심하고 쾌적한 하노이 일상을 만끽하세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 박준형",
    dateStr: "2026. 10. 06",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "미딩 라이프 컨설팅 & 종합지원",
      category: "하노이 라이프 / 생활 편의",
      region: "하노이 미딩 송다",
      address: "하노이 미딩 송다 CT4 상가 1층",
      phone: "024-3787-9911",
      hours: "평일 09:00 ~ 18:00",
      signatureMenu: "주거 정착 지원, 생활 편의 안내, 비즈니스 매칭",
      benefit: "베스트클럽 공식 파트너 우대 혜택",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[하노이 생활 백서 🏙️] 미딩 송다 한인타운 200% 정복하기!\n처음 온 분들도 걱정 없는 필수 정보. #하노이생활 #미딩송다 #주재원라이프 #베스트클럽",
      x: "[베스트 매거진] 하노이 미딩 지역 완벽 생활 가이드와 유용한 꿀팁\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "미딩에서 가장 살기 편한 아파트는 어디일까요? 🏢 선배님들의 생활 꿀팁 나눠주세요!",
      facebook: "[베스트 클럽 웹진] 하노이 미딩 송다 한인타운 생활 가이드북"
    }
  },
  {
    id: "article-16-hanoi-tayho",
    title: "주말을 여유롭게: 하노이 서호(Tay Ho) 브런치 카페와 라이프스타일 산책",
    subtitle: "호숫가를 따라 펼쳐지는 이국적인 풍경과 갤러리, 여유로운 휴식 코스",
    category: "하노이 라이프",
    summary: "하노이에서 가장 넓은 호수 서호(서호). 자전거 라이딩과 호숫가 테라스 카페에서 즐기는 여유로운 주말 힐링 산책 코스입니다.",
    content: `### 1. 호수 바람과 함께하는 주말의 낭만\n\n서호 주변 쑤안지에우(Xuan Dieu) 거리는 다국적 문화가 어우러져 유럽의 작은 휴양지에 온 듯한 여유를 선사합니다.\n\n### 2. 브런치와 스페셜티 커피의 여유\n\n호수가 한눈에 내려다보이는 테라스에 앉아 갓 구운 빵과 커피를 즐기는 시간은 일상의 스트레스를 잊게 해줍니다.\n\n### 3. 베스트클럽 서호 파트너 매장 방문\n\n서호의 분위기 좋은 가맹점에서 로맨틱한 데이트를 즐기고 회원 전용 혜택을 함께 챙겨보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 김하늘",
    dateStr: "2026. 10. 06",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "서호 레이크사이드 라운지 & 다이닝",
      category: "하노이 라이프 / 파인다이닝",
      region: "하노이 서호",
      address: "하노이 서호 쑤안지에우 88",
      phone: "024-3719-8877",
      hours: "매일 10:00 ~ 23:00",
      signatureMenu: "레이크뷰 브런치 플래터, 수제 와인 & 치즈",
      benefit: "베스트클럽 결제 시 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[주말 힐링 스팟 🌊] 하노이 서호 호숫가 테라스에서 즐기는 브런치!\n#하노이서호 #주말데이트 #하노이카페 #서호맛집 #베스트클럽",
      x: "[베스트 매거진] 하노이 서호(Tay Ho) 라이프스타일 산책과 추천 브런치 카페\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "주말에 서호 호수 한 바퀴 자전거 타고 마시는 시원한 커피의 맛 🚴‍♂️ 다들 주말 계획 세우셨나요?",
      facebook: "[베스트 클럽 웹진] 하노이 서호 주말 나들이 명소와 제휴 다이닝 혜택"
    }
  },
  {
    id: "article-17-vietnam-life-tips",
    title: "초보 주재원 필수 지침서: 베트남 환전, 그랩(Grab), 은행 계좌 개설 꿀팁",
    subtitle: "낯선 타국 생활을 스마트하게 시작하는 금융, 교통, 주거 실전 가이드",
    category: "베트남 생활정보",
    summary: "현지 통화 환전 요령부터 필수 호출 앱 그랩(Grab) 활용법, 현지 은행 계좌 개설 시 주의사항까지 실속 있는 노하우를 공개합니다.",
    content: `### 1. 안전하고 유리한 환전 요령\n\n공항보다는 시내 은행이나 공인 환전소를 이용하고, 고액권 달러($100 신권)를 준비하는 것이 환율 우대에 유리합니다.\n\n### 2. 교통의 필수품, 그랩(Grab) 똑똑하게 쓰기\n\n신용카드를 미리 연동해 두면 잔돈을 거슬러 받는 번거로움 없이 안전하고 투명하게 이동할 수 있습니다.\n\n### 3. 디지털 금융과 베스트클럽 활용\n\n베스트클럽의 간편 포인트 결제 시스템을 이용하면 현금 없이도 가맹점 결제와 페이백 적립을 한 번에 해결할 수 있습니다.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1200&q=80",
    readTime: "4분 읽기",
    author: "에디터 류진우",
    dateStr: "2026. 10. 05",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "베트남 비즈니스 케어 센터",
      category: "베트남 생활정보 / 컨설팅",
      region: "하노이 경남 랜드마크72",
      address: "하노이 랜드마크72 타워 24층",
      phone: "024-3837-1100",
      hours: "평일 09:00 ~ 18:00",
      signatureMenu: "법인 설립 자문, 비자 및 노동허가서 대행",
      benefit: "베스트클럽 회원 상담료 10% 우대",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[베트남 정착 꿀팁 📋] 초보 주재원 필수 체크리스트!\n환전부터 그랩 사용법까지 한 번에 정리. #베트남생활 #하노이주재원 #베트남팁 #베스트클럽",
      x: "[베스트 매거진] 베트남 생활정보 실전 가이드: 환전, 교통, 금융 꿀팁\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "처음 베트남 왔을 때 가장 당황했던 순간은 무엇이었나요? 😅 함께 공유해봐요!",
      facebook: "[베스트 클럽 웹진] 베트남 초보 생활 정착 가이드 및 공식 지원 안내"
    }
  },
  {
    id: "article-18-vietnam-metro",
    title: "하노이 메트로 지하철 3호선 개통: 달라지는 출퇴근 교통 지도",
    subtitle: "지상철 구간 시범 운행 시작, 도시의 이동 혁신과 역세권 상권 변화 전망",
    category: "베트남 뉴스",
    summary: "하노이의 교통 체증을 획기적으로 줄여줄 메트로 3호선 뇬(Nhon)~하노이역 구간 지상철 개통 소식과 생활권 변화를 짚어봅니다.",
    content: `### 1. 뇬(Nhon)에서 꺼우저이까지 쾌속 이동\n\n오토바이와 차량으로 꽉 막히던 출퇴근길이 메트로 개통으로 단 15~20분 만에 주파 가능해졌습니다.\n\n### 2. 친환경 대중교통으로의 전환\n\n대기질 개선과 시민들의 쾌적한 이동을 돕는 친환경 철도 인프라는 하노이의 새로운 도시 랜드마크가 되고 있습니다.\n\n### 3. 역세권 상권과 가맹점 혜택\n\n메트로 주요 역사 인근에 위치한 베스트클럽 가맹점을 편리하게 방문하고 혜택을 누려보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 최원석",
    dateStr: "2026. 10. 05",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "하노이 스마트 모빌리티 라운지",
      category: "베트남 뉴스 / 교통 서비스",
      region: "하노이 꺼우저이",
      address: "하노이 메트로 꺼우저이역 2번 출구 앞",
      phone: "024-3766-4433",
      hours: "매일 08:00 ~ 21:00",
      signatureMenu: "교통카드 충전 안내, 전동 스쿠터 대여",
      benefit: "베스트클럽 5% 포인트 페이백",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[하노이 뉴스 🚇] 메트로 3호선 개통! 달라지는 하노이의 교통 지도\n출퇴근길이 한결 빨라집니다. #하노이메트로 #하노이지하철 #하노이뉴스 #베스트클럽",
      x: "[베스트 매거진] 하노이 메트로 3호선 지상철 개통 리포트\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "하노이 지하철 타보신 분 계신가요? 🚊 오토바이보다 훨씬 시원하고 쾌적하네요!",
      facebook: "[베스트 클럽 웹진] 하노이 메트로 3호선 개통과 역세권 상권 소식"
    }
  },
  {
    id: "article-19-kbrand-economy",
    title: "베트남에 부는 K-브랜드 창업 열풍: 소비 트렌드와 성공 스토리",
    subtitle: "K-푸드, 화장품, 라이프스타일 샵의 현지화 전략과 프랜차이즈 시장의 기회",
    category: "경제/트렌드",
    summary: "젊은 인구 구조와 빠른 경제 성장을 자랑하는 베트남 시장에서 한국의 프리미엄 브랜드들이 성공을 거두는 핵심 비결을 분석합니다.",
    content: `### 1. 1억 인구와 젊은 소비층의 파워\n\n평균 연령 32세의 역동적인 베트남 소비 시장에서 한국 브랜드는 '트렌디하고 믿을 수 있는 품질'로 확고한 프리미엄 이미지를 구축했습니다.\n\n### 2. 현지화와 K-오리지널리티의 조화\n\n베트남 현지인들의 입맛과 취향을 배려하면서도 한국 고유의 서비스 철학을 유지하는 것이 롱런의 비결입니다.\n\n### 3. 베스트클럽 가맹점 상생 네트워크\n\n가맹점과 고객을 윈윈으로 연결하는 베스트클럽의 플랫폼 생태계와 함께 안정적인 매장 운영을 지원합니다.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80",
    readTime: "4분 읽기",
    author: "에디터 정소연",
    dateStr: "2026. 10. 04",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "베스트 프랜차이즈 창업지원센터",
      category: "경제/트렌드 / 비즈니스 육성",
      region: "하노이 미딩",
      address: "하노이 미딩 송다 더매너 상가 3층",
      phone: "024-3787-7000",
      hours: "평일 09:30 ~ 18:00",
      signatureMenu: "가맹점 마케팅 지원, POS 솔루션, 상권 분석",
      benefit: "신규 가맹점 입점 등록 무료 컨설팅",
      qrUrl: "/family-register.html"
    },
    sns: {
      instagram: "[비즈니스 리포트 📈] 베트남에서 성공하는 K-브랜드 창업 전략!\n#베트남창업 #K브랜드 #비즈니스트렌드 #베스트클럽",
      x: "[베스트 매거진] 베트남 시장을 사로잡은 K-프랜차이즈 성공 노하우\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "베트남에서 어떤 한국 비즈니스가 가장 유망할까요? 💡 창업에 관심 있는 분들의 의견이 궁금합니다!",
      facebook: "[베스트 클럽 웹진] 베트남 K-브랜드 창업 열풍과 공식 프랜차이즈 지원 안내"
    }
  },
  {
    id: "article-20-golf-lifestyle",
    title: "주말 라운딩과 활력 충전: 하노이 골퍼들을 위한 스크린 & 필드 가이드",
    subtitle: "쾌적한 실내 스크린 골프부터 하노이 근교 챔피언십 골프 코스까지 완벽 정리",
    category: "문화/생활",
    summary: "타국 생활의 건강한 활력소이자 친목의 장, 하노이에서 즐기는 골프 라이프스타일 팁과 공식 제휴 혜택을 전합니다.",
    content: `### 1. 날씨 걱정 없는 쾌적한 실내 스크린 골프\n\n더운 낮이나 비 오는 날에도 쾌적한 에어컨 아래에서 최첨단 그래픽으로 라운딩을 즐길 수 있는 스크린 골프장은 교민들의 인기 아지트입니다.\n\n### 2. 하노이 근교 아름다운 자연 속 정규 필드\n\n스카이레이크, 롱비엔 등 빼어난 경관을 자랑하는 골프 코스에서 주말의 피로를 날려버릴 수 있습니다.\n\n### 3. 골프 애호가를 위한 특별한 혜택\n\n베스트클럽 제휴 골프 연습장 및 스크린 매장에서 시원한 샷을 날리고 5% 포인트 페이백도 챙겨보세요.`,
    thumbnailUrl: "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=1200&q=80",
    readTime: "3분 읽기",
    author: "에디터 류진우",
    dateStr: "2026. 10. 04",
    merchantInfo: {
      id: "daehan_kimchi",
      name: "골프 앤 조이 스크린 골프 (Golf & Joy)",
      category: "문화/생활 / 스포츠 레저",
      region: "하노이 미딩 송다",
      address: "하노이 미딩 송다 CT2 상가 지하 1층",
      phone: "024-3787-5500",
      hours: "매일 08:00 ~ 24:00",
      signatureMenu: "최신 센서 스크린 룸, 1:1 원포인트 레슨, 클럽 렌탈",
      benefit: "게임비 결제 시 5% 포인트 페이백 + 잭팟 BT 발급",
      qrUrl: "/pay.html?merchant=daehan_kimchi"
    },
    sns: {
      instagram: "[골프 라이프 ⛳] 주말엔 시원한 스크린 골프장에서 굿샷!\n동료들과 즐거운 라운딩하고 포인트도 받으세요. #하노이골프 #스크린골프 #미딩골프 #베스트클럽",
      x: "[베스트 매거진] 하노이 골퍼들을 위한 실내외 라운딩 가이드\nhttps://bestclubvn.netlify.app/kca_webzine.html",
      threads: "이번 주말 라운딩 가시는 분? 🏌️‍♂️ 하노이 골프 코스 중 어디를 가장 좋아하시나요!",
      facebook: "[베스트 클럽 웹진] 하노이 골프 라이프스타일 가이드 및 공식 제휴 스크린골프 혜택"
    }
  }
];
