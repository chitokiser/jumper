'use strict';
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * buildWebzineContent
 * - 가맹점(merchants) 정보를 바탕으로 Gemini AI를 통해 K-컬쳐 기사 및 SNS 포맷을 생성하는 함수
 */
exports.buildWebzineContent = async (adminUid, requestData, geminiApiKey) => {
    const { merchantId } = requestData;
    if (!merchantId) throw new Error('merchantId가 필요합니다');
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');

    const db = admin.firestore();

    // 1. 가맹점 정보 조회
    const merchantSnap = await db.collection('merchants').doc(String(merchantId)).get();
    if (!merchantSnap.exists) {
        throw new Error('해당 가맹점 정보를 찾을 수 없습니다.');
    }
    const mData = merchantSnap.data();

    // 2. Gemini AI 프롬프트 구성
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
당신은 베트남(하노이) 기반의 K-Culture(한국 문화) 전문 웹진 에디터이자 SNS 마케터입니다.
K-Culture(K-Food, K-Pop, K-뷰티, 한국 생활문화 등)에 대한 유용한 정보성 트렌드 기사를 하나 작성하되,
기사 내용과 자연스럽게 어우러지도록 아래 제공된 '가맹점 정보'를 기사 후반부에 추천 명소(스폰서)로 녹여내 주세요.

[가맹점 정보]
- 매장명: ${mData.name || '무명 가맹점'}
- 업종/소개: ${mData.career || '한국 관련 서비스'} / ${mData.description || ''}
- 지역: ${mData.region || '하노이 어딘가'}
- 기타 노트: ${mData.note || ''}
- 홈페이지/SNS: ${mData.website || ''}
- 주소/지도연결: ${mData.gmap || ''}

[응답 가이드라인]
반드시 다음 JSON 스키마를 엄격히 준수하여 응답해야 합니다. 다른 텍스트는 덧붙이지 마세요.

{
  "webzineTitle": "마그네틱하고 클릭을 유도하는 트렌디한 뉴스 기사 제목",
  "heroImageKeyword": "이 기사 주제와 어울리는 영어 키워드 1개 (예: kimchi, kfood, seoul, cafe, beauty 등 오직 영단어 1개만)",
  "webzineBody": "HTML 형식으로 작성된 웹진 기사 본문. (<h1>, <h2>, <p> 등을 활용하여 가독성 있게 작성). 마지막 단락에는 홈페이지/SNS 링크(${mData.website || ''})와 '기사 제공 | K-MOA 제휴 - 매장명' 과 같이 아주 자연스러운 방문 유도 문구를 기입할 것.",
  "socialShorts": {
    "instagram": "인스타그램용 매력적인 텍스트 (이모지 및 관련 해시태그 풍부하게 포함)",
    "twitter": "X(트위터)용 핵심 요약형 텍스트 (280자 이내, 해시태그 포함)",
    "threads": "스레드(Threads)용 대화형 친근한 텍스트 (해시태그 포함)",
    "tiktok": "틱톡(TikTok) 숏폼 영상 설명 텍스트 (시선을 끄는 첫 줄 필수)"
  }
}
`;

    // 3. AI 텍스트 생성 (JSON 모드)
    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
        }
    });

    const responseText = result.response.text();
    let parsedContent;
    try {
        parsedContent = JSON.parse(responseText);
    } catch (e) {
        throw new Error('AI 응답을 JSON으로 파싱하는데 실패했습니다: ' + responseText);
    }

    // 4. Firestore에 생성된 기사 초안 저장 (상태: 임시저장(published: false))
    const webzineRef = db.collection('kca_webzine').doc();
    const docData = {
        merchantId: String(merchantId),
        merchantName: mData.name,
        originalMerchantInfo: mData, // 팩트체크용 보존
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: adminUid,
        ...parsedContent,
        published: false,
        viewCount: 0
    };

    await webzineRef.set(docData);

    // 5. 프론트로 반환
    return { id: webzineRef.id, ...docData };
};

/**
 * claimWebzineShareReward
 * - 유저가 웹진을 성공적으로 공유했을 때 1000P 지급
 */
exports.claimWebzineShareReward = async (uid, requestData) => {
    const { webzineId, platform } = requestData;
    if (!webzineId) throw new Error('webzineId가 필요합니다');

    const admin = require('firebase-admin');
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const shareLogRef = userRef.collection('share_logs').doc(String(webzineId));

    return await db.runTransaction(async (tx) => {
        const shareSnap = await tx.get(shareLogRef);
        if (shareSnap.exists) {
            throw new Error('이 기사에 대한 공유 보상은 이미 받으셨습니다.');
        }

        const rewardAmount = 1000;

        tx.set(shareLogRef, {
            platform: platform || 'link',
            rewardAmount: rewardAmount,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        tx.update(userRef, {
            pointBalance: admin.firestore.FieldValue.increment(rewardAmount)
        });

        const histRef = userRef.collection('point_history').doc();
        tx.set(histRef, {
            type: 'webzine_share',
            amount: rewardAmount,
            webzineId: String(webzineId),
            platform: platform || 'unknown',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            note: '웹진 공유 보상'
        });

        const webzineRef = db.collection('kca_webzine').doc(String(webzineId));
        tx.update(webzineRef, {
            shareCount: admin.firestore.FieldValue.increment(1)
        });

        return { success: true, reward: rewardAmount };
    });
};

/**
 * adminGrantWebzineBonus
 * - 관리자가 특정 유저가 웹진 마케팅/공유를 잘했을 때 추가 포인트를 지급하는 기능
 */
exports.adminGrantWebzineBonus = async (adminUid, requestData) => {
    const { targetUid, amount, webzineId, note } = requestData;
    if (!targetUid || !amount) throw new Error('targetUid와 amount가 필요합니다');

    const admin = require('firebase-admin');
    const db = admin.firestore();
    const userRef = db.collection('users').doc(String(targetUid));

    return await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error('대상 유저가 존재하지 않습니다');

        const bonusAmount = Number(amount);

        tx.update(userRef, {
            pointBalance: admin.firestore.FieldValue.increment(bonusAmount)
        });

        const histRef = userRef.collection('point_history').doc();
        tx.set(histRef, {
            type: 'webzine_bonus_admin',
            amount: bonusAmount,
            adminUid: adminUid,
            webzineId: webzineId ? String(webzineId) : null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            note: note || '웹진 마케팅 우수자 추가 포인트 보상 (관리자 지급)'
        });

        return { success: true, bonusAmount: bonusAmount };
    });
};
