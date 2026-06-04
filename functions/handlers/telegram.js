'use strict';

const admin  = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

// wrapError가 HttpsError로 변환 — 핸들러 파일은 plain Error만 사용
function _err(code, msg) {
  const e = new Error(msg);
  e.httpCode = code; // index.js wrapError가 읽는 커스텀 필드
  return e;
}

/**
 * Telegram WebApp initData HMAC 검증
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  const entries = [];
  for (const [k, v] of params.entries()) {
    if (k !== 'hash') entries.push(`${k}=${v}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return computedHash === hash;
}

function parseTelegramUser(initData) {
  const params = new URLSearchParams(initData);
  const userStr = params.get('user');
  if (!userStr) return null;
  try { return JSON.parse(userStr); } catch { return null; }
}

/**
 * telegramId 기준으로 Firestore 사용자 조회 또는 신규 생성
 * uid 형식: tg_{telegramId}
 */
async function findOrCreateTelegramUser(tgUser) {
  const telegramId = String(tgUser.id);

  const snap = await db.collection('users')
    .where('telegramId', '==', telegramId)
    .limit(1)
    .get();

  if (!snap.empty) {
    const existing = snap.docs[0];
    await existing.ref.update({
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { uid: existing.id, isNew: false };
  }

  const uid = `tg_${telegramId}`;
  const displayName =
    [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
    `TGUser${telegramId}`;

  // Firebase Auth 계정 생성 (중복이면 무시)
  try {
    await admin.auth().createUser({ uid, displayName });
  } catch (e) {
    if (e.code !== 'auth/uid-already-exists') throw e;
  }

  await db.collection('users').doc(uid).set(
    {
      telegramId,
      username: tgUser.username || null,
      displayName,
      photoURL: tgUser.photo_url || null,
      source: 'telegram',
      role: 'user',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { uid, isNew: true };
}

/**
 * initData 검증 → 사용자 조회/생성 → Firebase Custom Token 발급
 * @returns {{ token: string, uid: string, isNew: boolean }}
 */
async function authWithTelegram(initData, botToken) {
  if (!initData) throw _err('invalid-argument', 'initData 누락');

  if (!validateTelegramInitData(initData, botToken)) {
    throw _err('unauthenticated', '유효하지 않은 Telegram 데이터');
  }

  const tgUser = parseTelegramUser(initData);
  if (!tgUser?.id) throw _err('invalid-argument', 'user 정보 없음');

  const { uid, isNew } = await findOrCreateTelegramUser(tgUser);

  // TON 지갑 연결 대비: customClaims에 telegram_id 포함
  const customToken = await admin.auth().createCustomToken(uid, {
    telegram_id: String(tgUser.id),
  });

  return { token: customToken, uid, isNew };
}

/**
 * 웹 브라우저용 텔레그램 로그인 위젯 인증
 * https://core.telegram.org/widgets/login
 *
 * 검증 방식 (Mini App initData와 다름):
 *   secret_key  = SHA256(bot_token)
 *   hash        = HMAC_SHA256(dataCheckString, secret_key)
 *   auth_date 24시간 이내만 허용
 */
async function telegramWebAuth(userData, botToken) {
  const { hash, ...fields } = userData ?? {};
  if (!hash)        throw _err('invalid-argument', 'hash 누락');
  if (!fields.id)   throw _err('invalid-argument', 'id 누락');

  // 만료 확인 (24시간)
  const age = Math.floor(Date.now() / 1000) - Number(fields.auth_date || 0);
  if (age > 86400)  throw _err('unauthenticated', '인증 데이터가 만료되었습니다 (24시간 초과)');

  // 데이터 문자열 생성 (null/undefined 제외, 키 정렬)
  const dataCheckString = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // secret_key = SHA256(bot_token) — widget 전용
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) {
    throw _err('unauthenticated', '텔레그램 서명 검증 실패');
  }

  const tgUser = {
    id:         Number(fields.id),
    first_name: fields.first_name || '',
    last_name:  fields.last_name  || undefined,
    username:   fields.username   || undefined,
    photo_url:  fields.photo_url  || undefined,
  };

  const { uid, isNew } = await findOrCreateTelegramUser(tgUser);
  const customToken = await admin.auth().createCustomToken(uid, {
    telegram_id: String(tgUser.id),
  });

  return { token: customToken, uid, isNew };
}

module.exports = { authWithTelegram, telegramWebAuth };
