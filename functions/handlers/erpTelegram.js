// BestERP 텔레그램 알림 중계
//
// 예전에는 BestERP 브라우저 코드가 VITE_TELEGRAM_BOT_TOKEN 으로 텔레그램 API 를 직접 불러서
// 봇 토큰이 빌드된 JS 에 그대로 들어갔다. 이제 토큰과 관리자 채팅 ID 는 서버 비밀값
// (ERP_TELEGRAM_BOT_TOKEN, ERP_ADMIN_TELEGRAM_ID)에만 두고, 이 함수가 대신 보낸다.
//  - 로그인 + ERP 사용 권한(직원 이상 또는 가맹점 소속)만 허용
//  - 브라우저는 자유 문장이 아니라 알림 종류와 값만 보낸다. 문장은 서버가 만들고 HTML 을 이스케이프한다.
//  - 사용자별 하루 전송 수 제한
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

const STAFF_ROLES = ['SUPER_ADMIN', 'CEO', 'ADMIN', 'STAFF', 'EMPLOYEE', 'FRANCHISE', 'MERCHANT'];
const OPERATOR_EMAILS = ['daguri75@gmail.com', 'hexttokenopbnb@gmail.com'];
const DAILY_LIMIT = Number(process.env.ERP_TELEGRAM_DAILY_LIMIT || 100);
const MAX_FIELD = 500;

function isErpUser(user, token) {
  const email = String(token?.email || '').toLowerCase();
  if (token?.email_verified === true && OPERATOR_EMAILS.includes(email)) return true;
  const role = String(user?.role || '').toUpperCase();
  return STAFF_ROLES.includes(role) || (user?.merchantId != null && user.merchantId !== '');
}

function escapeHtml(s) {
  return String(s ?? '')
    .slice(0, MAX_FIELD)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 알림 종류별 문장. 새 종류는 여기에 추가한다.
const TEMPLATES = {
  material_upload: (d) =>
    `📦 <b>AI-ERM 현장 모바일 알림</b>\n\n📌 <b>프로젝트</b>: ${escapeHtml(d.projectId)}\n📋 <b>자재 입고</b>: ${escapeHtml(d.details)}\n✅ AI 자동 등록 및 승인이 완료되었습니다.`,
  ai_action: (d) =>
    `🤖 <b>AI-ERM 경영 조치 실행</b>\n\n✅ <b>승인 내역</b>: ${escapeHtml(d.action)}\n👨‍💼 경영진 승인 처리가 시스템에 반영되었습니다.`
};

function buildMessage(data) {
  const kind = data?.kind;
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, kind)) {
    throw new HttpsError('invalid-argument', '알 수 없는 알림 종류입니다.');
  }
  return TEMPLATES[kind](data?.fields || {});
}

function vnDay(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function consumeQuota(db, uid) {
  const ref = db.collection('erp_telegram_usage').doc(`${uid}_${vnDay()}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = snap.exists ? Number(snap.data().count || 0) : 0;
    if (n >= DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted', `오늘 알림 전송 한도(${DAILY_LIMIT}회)를 넘었습니다.`);
    }
    tx.set(ref, {
      uid,
      day: vnDay(),
      count: n + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function erpTelegramNotify(request, { db = admin.firestore(), send, botToken, chatId } = {}) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

  const userSnap = await db.collection('users').doc(uid).get();
  if (!isErpUser(userSnap.exists ? userSnap.data() : null, request.auth.token)) {
    throw new HttpsError('permission-denied', 'ERP 사용 권한이 없습니다.');
  }

  const text = buildMessage(request.data);
  if (!botToken || !chatId) {
    throw new HttpsError('failed-precondition', '서버에 ERP_TELEGRAM_BOT_TOKEN / ERP_ADMIN_TELEGRAM_ID 가 설정되어 있지 않습니다.');
  }

  await consumeQuota(db, uid);
  const ok = await send(botToken, chatId, text);
  return { sent: !!ok };
}

module.exports = { erpTelegramNotify, buildMessage, escapeHtml, isErpUser, TEMPLATES };
