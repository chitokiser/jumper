'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');

const SYSTEM_PROMPT = `당신은 Jumper 플랫폼의 친절한 고객 지원 AI입니다.
관리자가 오프라인일 때 사용자 질문에 대신 답변합니다.
모르거나 확신이 없는 내용은 "관리자가 온라인 상태일 때 직접 문의해 주세요"라고 안내하세요.
사용자가 한국어로 질문하면 한국어로, 다른 언어면 그 언어로 답변하세요.
답변은 간결하고 친절하게 2~4문장 이내로 작성하세요.

[Jumper 플랫폼 안내]
Jumper는 opBNB 블록체인 기반 커뮤니티 플랫폼입니다.

[포인트]
- Point: 플랫폼 포인트 포인트 — 상품 구매·가입비 등에 사용 (ERC-20, 18 decimal)
- JUMP: 거래용 포인트 (ERC-20, 0 decimal)
- BNB: 가스비

[주요 페이지]
- 메인(index.html): 마을 홈, 전체 현황
- 마이페이지(mypage.html): 지갑, 바우처, 거래내역
- 협동조합몰(coop.html): 상품 구매, 정회원 가입
- 지갑(wallet.html): Point 입출금
- 거래소(exchange.html): Point ↔ JUMP 거래
- 가맹점·게임(merchants.html): 가맹점 지도, 배틀 게임
- DAO(dao.html): 거버넌스 투표

[정회원]
- coop.html에서 10 Point 지불 시 정회원 가입
- 정회원 유효기간: 12개월, 만료 후 재가입 필요
- 정회원만 merchants.html의 보물박스 획득 가능

[고객 지원]
- 이 채팅은 1:1 문의 채팅입니다
- 관리자 오프라인 시 AI가 대신 답변합니다
- 복잡한 문의나 결제 관련 사항은 관리자 직접 답변이 필요합니다`;

/**
 * 새 사용자 메시지 → Gemini AI 자동 응답 (관리자 오프라인 시에만)
 */
async function onNewSupportMessage(event, geminiApiKey) {
  const data = event.data?.data();
  if (!data || data.sender !== 'user') return;

  const { uid, msgId } = event.params;
  const db = admin.firestore();

  // 관리자 온라인이면 AI 응답 생략
  const adminSnap = await db.doc('admin_status/main').get();
  if (adminSnap.exists && adminSnap.data().online === true) {
    logger.info(`[supportChat] admin is online — skipping AI reply for uid=${uid}`);
    return;
  }

  // 최근 대화 컨텍스트 (최대 10개, 현재 트리거 메시지 제외)
  const msgsSnap = await db
    .collection(`support_chats/${uid}/messages`)
    .orderBy('createdAt', 'asc')
    .limitToLast(10)
    .get();

  let conversationContext = '';
  for (const d of msgsSnap.docs) {
    if (d.id === msgId) continue;
    const { text: t, sender: s } = d.data();
    if (!t) continue;
    const role = s === 'user' ? '사용자' : s === 'admin' ? '관리자' : 'AI';
    conversationContext += `${role}: ${t}\n`;
  }

  // Gemini API 호출 (v1 REST — SDK의 v1beta 우회)
  let responseText = '';
  try {
    const prompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\n[이전 대화]\n${conversationContext}\n사용자: ${data.text}`
      : `${SYSTEM_PROMPT}\n\n사용자: ${data.text}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
        }),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      logger.error('[supportChat] Gemini HTTP error:', res.status, errText);
      return;
    }
    const json = await res.json();
    responseText = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  } catch (err) {
    logger.error('[supportChat] Gemini API error:', err);
    return;
  }

  if (!responseText) return;

  // 응답 저장
  await db.collection(`support_chats/${uid}/messages`).add({
    text: responseText,
    sender: 'bot',
    createdAt: FieldValue.serverTimestamp(),
    readByUser: false,
  });

  await db.doc(`support_chats/${uid}`).update({
    lastMessage: `🤖 ${responseText}`,
    lastAt: FieldValue.serverTimestamp(),
    hasUnread: true,
  });

  logger.info(`[supportChat] AI replied to uid=${uid}`);
}

module.exports = { onNewSupportMessage };
