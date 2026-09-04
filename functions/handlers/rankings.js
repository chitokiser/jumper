// functions/handlers/rankings.js
'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { getProvider, getJumpTokenContract } = require('../wallet/chain');

const db = admin.firestore();

async function _getDisplayId(uid, ud) {
  if (ud.telegramId) {
    return ud.username ? `@${ud.username}` : `TG:${ud.telegramId}`;
  }
  if (ud.email) return ud.email;
  try {
    const authUser = await admin.auth().getUser(uid);
    if (authUser.email) return authUser.email;
  } catch { }
  return uid;
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
    uid: d.id,
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
    uid: d.id,
    displayName: displayIds[i] || d.data().name || 'User',
    photoURL: d.data().photoURL || null,
    pointBalance: d.data().pointBalance || 0,
  }));
}

async function getHomeRankings() {
  const [treasureRanking, pointRanking] = await Promise.all([
    getTreasureRanking().catch(err => {
      console.error('getTreasureRanking error:', err.message);
      return [];
    }),
    getPointRanking().catch(err => {
      console.error('getPointRanking error:', err.message);
      return [];
    }),
  ]);

  return { treasureRanking, pointRanking };
}

module.exports = { getHomeRankings };
