'use strict';
// signupBonus.js — 연계 사이트(BestClub·BestWinner·BestMario 등) 최초 구글 가입 보너스
// 구글 계정당 1회, 서버 트랜잭션으로만 지급 (클라이언트 신뢰 불가)
const admin = require('firebase-admin');
const db    = admin.firestore();

const SIGNUP_BONUS_GP   = 5000;
const NEW_ACCOUNT_MS    = 24 * 60 * 60 * 1000;   // 계정 생성 후 24시간 이내만 "최초 가입"
const ALLOWED_SITES     = new Set(['bestclub', 'bestwinner', 'bestmario', 'daehan']);

// 같은 구글 계정을 점·+별칭으로 바꿔 재가입하는 것을 막기 위한 정규화 (gmail/googlemail)
function normalizeEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return '';
  let local = e.slice(0, at), domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}

async function claimSignupBonus(uid, site) {
  if (!uid) throw new Error('로그인이 필요합니다');
  const siteKey = ALLOWED_SITES.has(site) ? site : 'unknown';

  const authUser = await admin.auth().getUser(uid);
  const googleInfo = (authUser.providerData || []).find(p => p.providerId === 'google.com');
  if (!googleInfo) return { granted: false, reason: 'not_google' };

  const email = normalizeEmail(authUser.email || googleInfo.email);
  if (!email || !authUser.emailVerified) return { granted: false, reason: 'email_unverified' };

  const created = Date.parse(authUser.metadata?.creationTime || '');
  if (!Number.isFinite(created) || Date.now() - created > NEW_ACCOUNT_MS) {
    return { granted: false, reason: 'not_new_account' };
  }

  const claimRef = db.collection('signup_bonus_claims').doc(Buffer.from(email).toString('base64url'));
  const bpRef    = db.collection('battle_players').doc(uid);
  const userRef  = db.collection('users').doc(uid);

  return db.runTransaction(async t => {
    const claim = await t.get(claimRef);
    if (claim.exists) return { granted: false, reason: 'already_claimed' };
    const FV = admin.firestore.FieldValue;
    t.set(claimRef, { uid, email, site: siteKey, amount: SIGNUP_BONUS_GP, at: FV.serverTimestamp() });
    t.set(bpRef, { uid, gold: FV.increment(SIGNUP_BONUS_GP), signupBonusAt: FV.serverTimestamp() }, { merge: true });
    t.set(userRef, { signupBonusSite: siteKey, signupBonusAt: FV.serverTimestamp() }, { merge: true });
    return { granted: true, amount: SIGNUP_BONUS_GP };
  });
}

module.exports = { claimSignupBonus, normalizeEmail, SIGNUP_BONUS_GP };
