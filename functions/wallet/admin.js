// functions/wallet/admin.js
// 관리자 권한 확인 헬퍼 (deposit.js / transaction.js 공용)
//
// 아래 네 가지 중 하나라도 해당하면 관리자로 인정:
//   1) users/{uid}.isAdmin === true
//   2) admins/{uid} 문서 존재
//   3) JWT 토큰에 포함된 이메일 직접 체크 (tokenEmail)
//   4) Firebase Auth Admin SDK 이메일 조회

'use strict';

const admin = require('firebase-admin');

// 운영자 이메일 허용 목록 (소문자)
const ADMIN_EMAILS = ['daguri75@gmail.com'];

function _permDenied() {
  const e = new Error('Admin access required');
  e.httpCode = 'permission-denied';
  return e;
}

/**
 * requireAdmin(uid, tokenEmail?)
 * 권한이 없으면 httpCode='permission-denied' Error throw
 * @param {string} uid         Firebase Auth UID
 * @param {string} [tokenEmail] request.auth.token.email (있으면 직접 비교, SDK 호출 절약)
 */
async function requireAdmin(uid, tokenEmail) {
  if (!uid) throw _permDenied();

  const db = admin.firestore();

  // 1) users/{uid}.isAdmin
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.data()?.isAdmin === true) return;

  // 2) admins/{uid} 문서 존재
  const adminSnap = await db.collection('admins').doc(uid).get();
  if (adminSnap.exists) return;

  // 3) JWT 토큰 이메일 직접 체크 (Teleport custom token 포함)
  if (tokenEmail && ADMIN_EMAILS.includes(tokenEmail.toLowerCase())) return;

  // 4) Firebase Auth Admin SDK로 이메일 조회
  try {
    const record = await admin.auth().getUser(uid);
    if (ADMIN_EMAILS.includes(record.email?.toLowerCase())) return;
  } catch (authErr) {
    // user-not-found 이외의 오류(인프라 장애 등)는 전파하여 로그에 노출
    if (authErr.code !== 'auth/user-not-found') throw authErr;
  }

  throw _permDenied();
}

/** requireAdmin 과 동일한 세 가지 조건을 boolean으로 반환 */
async function isAdminUid(uid) {
  if (!uid) return false;
  try {
    await requireAdmin(uid);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { requireAdmin, isAdminUid, ADMIN_EMAILS };
