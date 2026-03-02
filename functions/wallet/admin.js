// functions/wallet/admin.js
// 관리자 권한 확인 헬퍼 (deposit.js / transaction.js 공용)
//
// 아래 세 가지 중 하나라도 해당하면 관리자로 인정:
//   1) users/{uid}.isAdmin === true
//   2) admins/{uid} 문서 존재
//   3) 운영자 이메일 허용 목록 (ADMIN_EMAILS)

'use strict';

const admin = require('firebase-admin');

// 운영자 이메일 허용 목록 (소문자)
const ADMIN_EMAILS = ['daguri75@gmail.com'];

/**
 * requireAdmin(uid)
 * 권한이 없으면 Error('관리자 권한이 없습니다') throw
 * @param {string} uid  Firebase Auth UID
 */
async function requireAdmin(uid) {
  if (!uid) throw new Error('관리자 권한이 없습니다');

  const db = admin.firestore();

  // 1) users/{uid}.isAdmin
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.data()?.isAdmin === true) return;

  // 2) admins/{uid} 문서 존재
  const adminSnap = await db.collection('admins').doc(uid).get();
  if (adminSnap.exists) return;

  // 3) Firebase Auth 이메일 허용 목록
  try {
    const record = await admin.auth().getUser(uid);
    if (ADMIN_EMAILS.includes(record.email?.toLowerCase())) return;
  } catch (_) { /* UID 조회 실패 → 권한 없음 */ }

  throw new Error('관리자 권한이 없습니다');
}

module.exports = { requireAdmin, ADMIN_EMAILS };
