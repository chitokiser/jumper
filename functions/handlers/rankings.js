// functions/handlers/rankings.js
'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { getProvider, getJumpTokenContract } = require('../wallet/chain');

const db = admin.firestore();

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

  return filtered.map((d, i) => {
    const ud = userSnaps[i]?.data() || {};
    return {
      rank:           i + 1,
      uid:            d.id,
      displayName:    ud.displayName || ud.name || '익명',
      photoURL:       ud.photoURL || null,
      treasuresFound: d.data().treasuresFound || 0,
    };
  });
}

async function getJumpRanking() {
  const provider  = getProvider();
  const jumpToken = getJumpTokenContract(provider);

  const usersSnap = await db.collection('users').limit(50).get();

  const walletUsers = usersSnap.docs.map(d => ({
    uid:         d.id,
    displayName: d.data().displayName || d.data().name || '익명',
    photoURL:    d.data().photoURL || null,
    address:     d.data().wallet?.address || '',
  })).filter(u => ethers.isAddress(u.address));

  if (!walletUsers.length) return [];

  // batch RPC calls in groups of 10 to avoid overloading
  const BATCH = 10;
  const balances = [];
  for (let i = 0; i < walletUsers.length; i += BATCH) {
    const chunk = walletUsers.slice(i, i + BATCH);
    const chunkBals = await Promise.all(
      chunk.map(u => jumpToken.balanceOf(u.address).catch(() => 0n))
    );
    balances.push(...chunkBals);
  }

  return walletUsers
    .map((u, i) => ({ ...u, jumpBalance: balances[i] }))
    .filter(u => u.jumpBalance > 0n)
    .sort((a, b) => (b.jumpBalance > a.jumpBalance ? 1 : b.jumpBalance < a.jumpBalance ? -1 : 0))
    .slice(0, 10)
    .map((u, i) => ({
      rank:          i + 1,
      uid:           u.uid,
      displayName:   u.displayName,
      photoURL:      u.photoURL,
      jumpBalance:   u.jumpBalance.toString(),
      walletAddress: u.address,
    }));
}

async function getHomeRankings() {
  const [treasureRanking, jumpRanking] = await Promise.all([
    getTreasureRanking().catch(err => {
      console.error('getTreasureRanking error:', err.message);
      return [];
    }),
    getJumpRanking().catch(err => {
      console.error('getJumpRanking error:', err.message);
      return [];
    }),
  ]);

  return { treasureRanking, jumpRanking };
}

module.exports = { getHomeRankings };
