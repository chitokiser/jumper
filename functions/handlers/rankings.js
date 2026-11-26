// functions/handlers/rankings.js
'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { getProvider, getJumpTokenContract } = require('../wallet/chain');

const db = admin.firestore();

function _maskEmail(raw) {
  const s = String(raw || '').trim();
  const at = s.indexOf('@');
  if (at < 0) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const maskedLocal = local.length <= 2 ? `${local[0] || '*'}***` : `${local.slice(0, 2)}***`;
  const domParts = domain.split('.');
  const maskedDom = domParts[0] ? `${domParts[0][0]}***${domParts.length > 1 ? '.' + domParts.slice(1).join('.') : ''}` : '***';
  return `${maskedLocal}@${maskedDom}`;
}

function _maskName(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('@')) return _maskEmail(s);
  return s;
}

async function _getDisplayId(uid, ud) {
  const nick = _maskName(ud.nickname || ud.displayName || ud.name);
  if (nick) return nick;
  if (ud.telegramId) {
    return ud.username ? `@${ud.username.slice(0, 3)}***` : `회원#${String(ud.telegramId).slice(-4)}`;
  }
  if (ud.email) return _maskEmail(ud.email);
  try {
    const authUser = await admin.auth().getUser(uid);
    if (authUser.displayName) return _maskName(authUser.displayName);
    if (authUser.email) return _maskEmail(authUser.email);
  } catch { }
  return `회원#${String(uid).slice(-4)}`;
}

async function getTreasureRanking() {
  const bpSnap = await db.collection('battle_players')
    .orderBy('treasuresFound', 'desc')
    .limit(10)
    .get();

  const filtered = bpSnap.docs.filter(d => (d.data().treasuresFound || 0) > 0);
  if (!filtered.length) return [];

  const userSnaps = await Promise.all(
    filtered.map(d => db.collection('users').doc(d.id).get())
  );

  const displayIds = await Promise.all(
    filtered.map((d, i) => _getDisplayId(d.id, userSnaps[i]?.data() || {}))
  );

  return filtered.map((d, i) => ({
    rank: i + 1,
    displayName: displayIds[i],
    photoURL: (userSnaps[i]?.data() || {}).photoURL || null,
    treasuresFound: d.data().treasuresFound || 0,
  }));
}

async function getPointRanking() {
  const usersSnap = await db.collection('users')
    .orderBy('pointBalance', 'desc')
    .limit(10)
    .get();

  const filtered = usersSnap.docs.filter(d => (d.data().pointBalance || 0) > 0);
  if (!filtered.length) return [];

  const displayIds = await Promise.all(
    filtered.map(d => _getDisplayId(d.id, d.data()))
  );

  return filtered.map((d, i) => ({
    rank: i + 1,
    displayName: displayIds[i] || '베스트회원',
    photoURL: d.data().photoURL || null,
    pointBalance: d.data().pointBalance || 0,
  }));
}

// BM 보유 랭킹 (users.pointBalanceVnd = BM, 표기 단위 VND)
async function getBmRanking() {
  const usersSnap = await db.collection('users')
    .orderBy('pointBalanceVnd', 'desc')
    .limit(10)
    .get();

  const filtered = usersSnap.docs.filter(d => (Number(d.data().pointBalanceVnd) || 0) > 0);
  if (!filtered.length) return [];

  const displayIds = await Promise.all(
    filtered.map(d => _getDisplayId(d.id, d.data()))
  );

  return filtered.map((d, i) => ({
    rank: i + 1,
    displayName: displayIds[i] || '베스트회원',
    photoURL: d.data().photoURL || null,
    bmBalance: Math.floor(Number(d.data().pointBalanceVnd) || 0),
  }));
}

// 홈 랭킹 섹션: Point 보유 랭킹 + BM 보유 랭킹 (2026-11-26, 보물상자 랭킹 제외)
async function getHomeRankings() {
  const [pointRanking, bmRanking] = await Promise.all([
    getPointRanking().catch(err => {
      console.error('getPointRanking error:', err.message);
      return [];
    }),
    getBmRanking().catch(err => {
      console.error('getBmRanking error:', err.message);
      return [];
    }),
  ]);

  return { pointRanking, bmRanking };
}

module.exports = { getHomeRankings };
