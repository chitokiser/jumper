// functions/handlers/coinExchange.js
// 게임코인(gold) ↔ JUMP 포인트 양방향 교환
// JumpAutoExchange 컨트랙트 + Firebase Firestore 연동

'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { HttpsError } = require('firebase-functions/v2/https');
const { decrypt } = require('../wallet/crypto');
const {
  getProvider,
  getHexContract,
  getJumpTokenContract,
  getJumpAutoExchangeContract,
  getAdminWallet,
  walletFromKey,
  estimateGasWithBuffer,
} = require('../wallet/chain');

const db = admin.firestore();

// ─────────────────────────────────────────────────────────────
// 헬퍼: 수탁 지갑 signer + 주소 반환
// ─────────────────────────────────────────────────────────────
async function getCustodialSigner(uid, masterSecret) {
  const snap = await db.collection('users').doc(uid).get();
  const walletData = snap.data()?.wallet;
  if (!walletData?.encryptedKey)
    throw new HttpsError('failed-precondition', '수탁 지갑이 없습니다. 먼저 지갑을 생성하세요.');
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider = getProvider();
  const signer = walletFromKey(privateKey, provider);
  return { signer, address: walletData.address };
}

// ─────────────────────────────────────────────────────────────
// 교환 비율 + 컨트랙트 잔고 조회
// ─────────────────────────────────────────────────────────────
async function getCoinExchangeStatus(uid) {
  const provider = getProvider();
  const exchange = getJumpAutoExchangeContract(provider);

  const [coinPerJump, saleEnabled, contractBalance] = await Promise.all([
    exchange.coinPerJump(),
    exchange.saleEnabled(),
    exchange.contractJumpBalance(),
  ]);

  // 유저 게임코인 조회
  const bpSnap = await db.collection('battle_players').doc(uid).get();
  const gold = bpSnap.exists ? (bpSnap.data().gold || 0) : 0;

  // 유저 JUMP 온체인 잔액
  const snap = await db.collection('users').doc(uid).get();
  const rawAddr = snap.data()?.wallet?.address || '';
  const address = ethers.isAddress(rawAddr) ? rawAddr : null;
  const jumpBal = address
    ? await getJumpTokenContract(provider).balanceOf(address)
    : 0n;

  const rateNum = Number(coinPerJump);

  return {
    coinPerJump: rateNum,
    saleEnabled: Boolean(saleEnabled),
    contractJumpBalance: contractBalance.toString(),
    userGold: gold,
    userJumpBalance: jumpBal.toString(),
    walletAddress: address,
    maxBuyableJump: rateNum > 0 ? Math.floor(gold / rateNum) : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. 게임코인 → JUMP (BUY)
//
// 흐름:
//   1) battle_players.gold >= coinAmount 확인
//   2) Firestore 트랜잭션으로 gold 차감
//   3) 어드민 지갑으로 purchaseJumpFor(userAddr, coinAmount) 호출
//   4) 온체인 성공 → jump_coin_exchanges 기록
//   5) 실패 시 gold 복원
// ─────────────────────────────────────────────────────────────
async function buyJumpWithCoins(uid, coinAmount, masterSecret) {
  const coins = Math.floor(Number(coinAmount));
  if (!coins || coins <= 0)
    throw new HttpsError('invalid-argument', '교환할 게임코인 수량을 입력하세요');

  // 유저 지갑 주소 확인
  const { address } = await getCustodialSigner(uid, masterSecret);

  const provider = getProvider();
  const exchange = getJumpAutoExchangeContract(provider);

  // 교환 활성 여부 + 비율 조회
  const [saleEnabled, coinPerJump] = await Promise.all([
    exchange.saleEnabled(),
    exchange.coinPerJump(),
  ]);
  if (!saleEnabled) throw new HttpsError('failed-precondition', '현재 교환이 비활성화 상태입니다');

  const rateNum = Number(coinPerJump);
  if (rateNum === 0) throw new HttpsError('internal', '교환 비율이 설정되지 않았습니다');

  const jumpAmount = Math.floor(coins / rateNum);
  if (jumpAmount <= 0)
    throw new HttpsError('invalid-argument', `최소 ${rateNum}개 이상의 게임코인이 필요합니다`);

  // 컨트랙트 JUMP 잔고 확인
  const contractBal = await exchange.contractJumpBalance();
  if (BigInt(jumpAmount) > contractBal)
    throw new HttpsError('failed-precondition', 'JUMP 재고가 부족합니다. 잠시 후 다시 시도하세요.');

  // Firestore에서 gold 차감 (트랜잭션)
  const bpRef = db.collection('battle_players').doc(uid);
  await db.runTransaction(async tx => {
    const snap = await tx.get(bpRef);
    const gold = snap.exists ? (snap.data().gold || 0) : 0;
    if (gold < coins)
      throw new HttpsError('failed-precondition', `게임코인 부족 (보유: ${gold}, 필요: ${coins})`);
    tx.set(bpRef, {
      gold: admin.firestore.FieldValue.increment(-coins),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  // 온체인 JUMP 전송
  let receipt;
  try {
    const adminWallet = getAdminWallet();
    const exchangeAdm = getJumpAutoExchangeContract(adminWallet);
    const gasLimit = await estimateGasWithBuffer(exchangeAdm, 'purchaseJumpFor', [address, BigInt(coins)]);
    const tx = await exchangeAdm.purchaseJumpFor(address, BigInt(coins), { gasLimit });
    receipt = await tx.wait();
  } catch (err) {
    // 온체인 실패 → gold 복원
    await bpRef.set({
      gold: admin.firestore.FieldValue.increment(coins),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new HttpsError('internal', `온체인 처리 실패: ${err.message}`);
  }

  // 기록 저장
  await db.collection('jump_coin_exchanges').add({
    uid,
    walletAddress: address,
    direction: 'buy',      // 게임코인 → JUMP
    coinAmount: coins,
    jumpAmount,
    coinPerJump: rateNum,
    txHash: receipt.hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    direction: 'buy',
    coinAmount: coins,
    jumpAmount,
    txHash: receipt.hash,
  };
}

// ─────────────────────────────────────────────────────────────
// 2. JUMP → 게임코인 (SELL)
//
// 흐름:
//   1) 유저 수탁 지갑 JUMP 잔액 확인
//   2) 유저 signer로 JumpAutoExchange approve
//   3) 어드민 지갑으로 sellJumpForCoins(userAddr, jumpAmount) 호출
//      → 컨트랙트가 transferFrom으로 JUMP 가져옴
//   4) 온체인 성공 → Firestore gold 지급 + 기록
// ─────────────────────────────────────────────────────────────
async function sellJumpForCoins(uid, jumpAmount, masterSecret) {
  const jump = Math.floor(Number(jumpAmount));
  if (!jump || jump <= 0)
    throw new HttpsError('invalid-argument', '교환할 JUMP 수량을 입력하세요');

  const { signer, address } = await getCustodialSigner(uid, masterSecret);
  const provider = getProvider();
  const exchange = getJumpAutoExchangeContract(provider);
  const jumpToken = getJumpTokenContract(signer);

  // 교환 활성 여부 + 비율 조회
  const [saleEnabled, coinPerJump] = await Promise.all([
    exchange.saleEnabled(),
    exchange.coinPerJump(),
  ]);
  if (!saleEnabled) throw new HttpsError('failed-precondition', '현재 교환이 비활성화 상태입니다');

  const rateNum = Number(coinPerJump);
  const coinAmount = jump * rateNum;

  // JUMP 잔액 확인
  const jumpBal = await getJumpTokenContract(provider).balanceOf(address);
  if (jumpBal < BigInt(jump))
    throw new HttpsError('failed-precondition', `JUMP 잔액 부족 (보유: ${jumpBal}, 필요: ${jump})`);

  // approve (수탁 지갑 signer로)
  const exchangeAddr = getJumpAutoExchangeContract(provider).target;
  const allowance = await jumpToken.allowance(address, exchangeAddr);
  if (allowance < BigInt(jump)) {
    const approveTx = await jumpToken.approve(exchangeAddr, ethers.MaxUint256);
    await approveTx.wait();
  }

  // 온체인: 어드민 지갑으로 sellJumpForCoins 호출
  let receipt;
  try {
    const adminWallet = getAdminWallet();
    const exchangeAdm = getJumpAutoExchangeContract(adminWallet);
    const gasLimit = await estimateGasWithBuffer(exchangeAdm, 'sellJumpForCoins', [address, BigInt(jump)]);
    const tx = await exchangeAdm.sellJumpForCoins(address, BigInt(jump), { gasLimit });
    receipt = await tx.wait();
  } catch (err) {
    throw new HttpsError('internal', `온체인 처리 실패: ${err.message}`);
  }

  // Firestore gold 지급
  await db.collection('battle_players').doc(uid).set({
    gold: admin.firestore.FieldValue.increment(coinAmount),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // 기록 저장
  await db.collection('jump_coin_exchanges').add({
    uid,
    walletAddress: address,
    direction: 'sell',     // JUMP → 게임코인
    jumpAmount: jump,
    coinAmount,
    coinPerJump: rateNum,
    txHash: receipt.hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    direction: 'sell',
    jumpAmount: jump,
    coinAmount,
    txHash: receipt.hash,
  };
}

// ─────────────────────────────────────────────────────────────
// 3. 관리자: 교환 내역 목록 조회
// ─────────────────────────────────────────────────────────────
async function listCoinExchanges({ direction, limit: lim = 50 } = {}) {
  let q = db.collection('jump_coin_exchanges')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Number(lim), 200));

  if (direction === 'buy' || direction === 'sell') {
    q = q.where('direction', '==', direction);
  }

  const snap = await q.get();
  return snap.docs.map(d => {
    const r = d.data();
    return {
      id: d.id,
      uid: r.uid,
      walletAddress: r.walletAddress,
      direction: r.direction,
      coinAmount: r.coinAmount,
      jumpAmount: r.jumpAmount,
      coinPerJump: r.coinPerJump,
      txHash: r.txHash,
      createdAt: r.createdAt?.toMillis() ?? null,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 4. Point → GameCoin(GP) 현황 조회
// ─────────────────────────────────────────────────────────────
async function getHexGpStatus(uid) {
  const bpSnap = await db.collection('battle_players').doc(uid).get();
  const gold = bpSnap.exists ? (bpSnap.data().gold || 0) : 0;

  const snap = await db.collection('users').doc(uid).get();
  const userData = snap.exists ? snap.data() : {};
  const pointBalance = Number(userData.pointBalance || 0);

  const cfgSnap = await db.collection('config').doc('exchange').get();
  const gpPerHex = cfgSnap.exists ? (cfgSnap.data().gpPerHex || 1) : 1;

  return {
    userHexBalance: pointBalance,
    userGold: gold,
    gpPerHex,
    walletAddress: userData.wallet?.address || null,
  };
}

// ─────────────────────────────────────────────────────────────
// 5. Point → GameCoin(GP) 전환
//
// 흐름:
//   1) 유저 수탁 지갑 Point 잔액 확인
//   2) Firestore config/exchange.gpPerHex 비율 조회
//   3) 유저 수탁 지갑 → admin 지갑 Point transfer
//   4) battle_players.gold += gpAmount
//   5) hex_gp_exchanges 기록
// ─────────────────────────────────────────────────────────────
async function hexToGp(uid, pointAmount, masterSecret) {
  const pAmt = Number(pointAmount);
  if (!pAmt || pAmt <= 0)
    throw new HttpsError('invalid-argument', 'pointAmount must be a positive number');

  const bpRef = db.collection('battle_players').doc(uid);
  const userRef = db.collection('users').doc(uid);

  const cfgSnap = await db.collection('config').doc('exchange').get();
  const gpPerHex = cfgSnap.exists ? Number(cfgSnap.data().gpPerHex || 1) : 1;
  if (gpPerHex <= 0)
    throw new HttpsError('failed-precondition', 'Point→GP conversion is currently disabled');

  const gpAmount = Math.floor(pAmt * gpPerHex);
  if (gpAmount <= 0)
    throw new HttpsError('invalid-argument', 'Amount too small — results in 0 GP');

  let txHash = 'fiat_' + Date.now();

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};
      const bal = Number(data.pointBalance || 0);
      if (bal < pAmt) throw new Error('Insufficient Point Balance');

      tx.update(userRef, {
        pointBalance: admin.firestore.FieldValue.increment(-pAmt)
      });
      tx.set(bpRef, {
        gold: admin.firestore.FieldValue.increment(gpAmount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const recordRef = db.collection('hex_gp_exchanges').doc();
      tx.set(recordRef, {
        uid,
        pointAmount: pAmt,
        gpAmount,
        gpPerHex,
        txHash: txHash,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    throw new HttpsError('internal', `Database transaction failed: ${err.message}`);
  }

  return { ok: true, gpAmount, txHash: txHash };
}

module.exports = {
  getCoinExchangeStatus,
  buyJumpWithCoins,
  sellJumpForCoins,
  listCoinExchanges,
  getHexGpStatus,
  hexToGp,
};
