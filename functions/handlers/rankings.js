// functions/handlers/rankings.js
'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { getProvider, getJumpTokenContract } = require('../wallet/chain');

const db = admin.firestore();

async function getHomeRankings() {
  const provider  = getProvider();
  const jumpToken = getJumpTokenContract(provider);

  // 1. 보물박스 랭킹 —————————————————————————————
  const bpSnap = await db.collection('battle_players')
    .where('treasuresFound', '>', 0)
    .orderBy('treasuresFound', 'desc')
    .limit(10)
    .get();

  const uids = bpSnap.docs.map(d => d.id);
  const userSnaps = uids.length
    ? await Promise.all(uids.map(uid => db.collection('users').doc(uid).get()))
    : [];

  const treasureRanking = bpSnap.docs.map((d, i) => {
    const ud = userSnaps[i]?.data() || {};
    return {
      rank:           i + 1,
      uid:            d.id,
      displayName:    ud.displayName || ud.name || '익명',
      photoURL:       ud.photoURL || null,
      treasuresFound: d.data().treasuresFound || 0,
    };
  });

  // 2. JUMP 토큰 보유 랭킹 —————————————————————————
  const usersSnap = await db.collection('users').limit(100).get();

  const walletUsers = usersSnap.docs.map(d => ({
    uid:         d.id,
    displayName: d.data().displayName || d.data().name || '익명',
    photoURL:    d.data().photoURL || null,
    address:     d.data().wallet?.address || '',
  })).filter(u => ethers.isAddress(u.address));

  const balances = await Promise.all(
    walletUsers.map(u => jumpToken.balanceOf(u.address).catch(() => 0n))
  );

  const jumpRanking = walletUsers
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

  return { treasureRanking, jumpRanking };
}

module.exports = { getHomeRankings };
