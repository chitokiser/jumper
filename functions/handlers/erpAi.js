// BestERP AI 호출 중계 (Gemini)
//
// BestERP 화면(영수증 OCR, 명함 OCR, AI 경영 비서 등)이 브라우저에서 Gemini API 키를 직접
// 쓰지 않도록, 키는 서버(Secret Manager 의 GEMINI_API_KEY, index.js 에서 secrets 로 선언)에만 두고 이 함수가 대신 호출한다.
//  - 로그인 + ERP 사용 권한(직원 이상 또는 가맹점 소속)만 허용
//  - 모델은 허용 목록만, 요청 크기 제한, 사용자별 하루 호출 수 제한
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

const ALLOWED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const STAFF_ROLES = ['SUPER_ADMIN', 'CEO', 'ADMIN', 'STAFF', 'EMPLOYEE', 'FRANCHISE', 'MERCHANT'];
const OPERATOR_EMAILS = ['daguri75@gmail.com', 'hexttokenopbnb@gmail.com'];
const DAILY_LIMIT = Number(process.env.ERP_AI_DAILY_LIMIT || 300);
const MAX_PAYLOAD_CHARS = 9 * 1024 * 1024; // base64 이미지 포함 약 9MB

function isErpUser(user, token) {
  const email = String(token?.email || '').toLowerCase();
  if (token?.email_verified === true && OPERATOR_EMAILS.includes(email)) return true;
  const role = String(user?.role || '').toUpperCase();
  return STAFF_ROLES.includes(role) || (user?.merchantId != null && user.merchantId !== '');
}

function kstDay(d = new Date()) {
  // 베트남 시간(UTC+7) 기준 날짜
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function consumeQuota(db, uid) {
  const ref = db.collection('erp_ai_usage').doc(`${uid}_${kstDay()}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = snap.exists ? Number(snap.data().count || 0) : 0;
    if (n >= DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted', `오늘 AI 사용 한도(${DAILY_LIMIT}회)를 넘었습니다. 내일 다시 시도해 주세요.`);
    }
    tx.set(ref, {
      uid,
      day: kstDay(),
      count: n + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

function validateBody(data) {
  const body = data?.body;
  if (!body || typeof body !== 'object' || !Array.isArray(body.contents) || body.contents.length === 0) {
    throw new HttpsError('invalid-argument', 'body.contents 가 필요합니다.');
  }
  const json = JSON.stringify(body);
  if (json.length > MAX_PAYLOAD_CHARS) {
    throw new HttpsError('invalid-argument', '요청이 너무 큽니다. 이미지를 줄여서 다시 시도해 주세요.');
  }
  // 허용 필드만 Gemini 로 보낸다
  const out = { contents: body.contents };
  if (body.generationConfig && typeof body.generationConfig === 'object') out.generationConfig = body.generationConfig;
  if (body.systemInstruction && typeof body.systemInstruction === 'object') out.systemInstruction = body.systemInstruction;
  return out;
}

async function erpGeminiGenerate(request, { db = admin.firestore(), fetchImpl = fetch, apiKey = process.env.GEMINI_API_KEY } = {}) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

  const userSnap = await db.collection('users').doc(uid).get();
  if (!isErpUser(userSnap.exists ? userSnap.data() : null, request.auth.token)) {
    throw new HttpsError('permission-denied', 'ERP 사용 권한이 없습니다.');
  }

  const model = ALLOWED_MODELS.includes(request.data?.model) ? request.data.model : ALLOWED_MODELS[0];
  const body = validateBody(request.data);

  if (!apiKey) throw new HttpsError('failed-precondition', '서버에 GEMINI_API_KEY 가 설정되어 있지 않습니다.');

  await consumeQuota(db, uid);

  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    }
  );
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  if (!res.ok) {
    const msg = json?.error?.message || `Gemini 호출 실패 (HTTP ${res.status})`;
    throw new HttpsError(res.status === 429 ? 'resource-exhausted' : 'unavailable', msg);
  }
  // 브라우저 쪽 기존 코드가 그대로 읽을 수 있게 Gemini 응답 형식을 유지한다
  return { candidates: json?.candidates || [], usageMetadata: json?.usageMetadata || null };
}

module.exports = { erpGeminiGenerate, isErpUser, validateBody, ALLOWED_MODELS };
