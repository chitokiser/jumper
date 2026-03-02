// functions/handlers/exchange.js
// JUMP 토큰 거래소 — 구매/판매/스테이킹/배당

'use strict';

const admin  = require('firebase-admin');
const { ethers } = require('ethers');
const { decrypt } = require('../wallet/crypto');
const {
  ADDRESSES,
  getProvider,
  getHexContract,
  getJumpTokenContract,
  getJumpBankContract,
  walletFromKey,
  estimateGasWithBuffer,
} = require('../wallet/chain');

const db = admin.firestore();

// ─────────────────────────────────────────────
// 헬퍼: 수탁 지갑 + signer 준비
// ─────────────────────────────────────────────
async function getCustodialSigner(uid, masterSecret) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) {
    throw new Error('수탁 지갑이 없습니다. 먼저 지갑을 생성해주세요.');
  }
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider   = getProvider();
  const signer     = walletFromKey(privateKey, provider);
  return { signer, address: walletData.address };
}

// ─────────────────────────────────────────────
// 1. jumpBank 현황 조회
// ─────────────────────────────────────────────
async function getJumpBankStatus(uid) {
  const userSnap  = await db.collection('users').doc(uid).get();
  const address   = userSnap.data()?.wallet?.address || null;
  const provider  = getProvider();
  const jumpBank  = getJumpBankContract(provider);
  const jumpToken = getJumpTokenContract(provider);
  const hexToken  = getHexContract(provider);

  const [price, totalStaked, act, rate, bankHexBal, bankJumpInv, circSupply, jumpTotalSupply] = await Promise.all([
    jumpBank.price(),
    jumpBank.totalStaked(),
    jumpBank.act(),
    jumpBank.rate(),
    jumpBank.hexBalance(),
    jumpBank.tokenInventory(),
    jumpBank.circulatingSupply(),
    jumpToken.totalSupply(),
  ]);

  let hexBal = 0n, jumpBal = 0n, pending = 0n, userInfo = null, dashboard = null;
  if (address) {
    [hexBal, jumpBal, pending, userInfo, dashboard] = await Promise.all([
      hexToken.balanceOf(address),
      jumpToken.balanceOf(address),
      jumpBank.pendingDividend(address),
      jumpBank.user(address),
      jumpBank.myDashboard(address),
    ]);
  }

  return {
    // 시장 정보
    price:        price.toString(),
    totalStaked:  totalStaked.toString(),
    act:          Number(act),
    rate:         Number(rate),             // 매도 수수료율 (%)
    // jumpBank 잔고
    bankHexBalance:    bankHexBal.toString(),   // jumpBank HEX 준비금
    bankJumpInventory: bankJumpInv.toString(),  // jumpBank JUMP 재고
    circulatingSupply: circSupply.toString(),   // 유통량 (재고+스테이킹)
    jumpTotalSupply:   jumpTotalSupply.toString(), // JUMP 총 발행량
    // 내 잔액
    hexBalance:   hexBal.toString(),
    jumpBalance:  jumpBal.toString(),
    pendingDividend: pending.toString(),
    // 스테이킹 정보
    staked:       userInfo ? userInfo.depo.toString()         : '0',
    stakingTime:  userInfo ? userInfo.stakingTime.toString()  : '0',
    lastClaim:    userInfo ? userInfo.lastClaim.toString()    : '0',
    totalBuy:     userInfo ? userInfo.totalBuy.toString()     : '0',
    // 내 대시보드 (손익/ROI)
    myActualQty:       dashboard ? dashboard.myActualQty.toString()       : '0',
    myAvgBuyPrice:     dashboard ? dashboard.myAvgBuyPriceWei.toString()  : '0',
    myMarketCap:       dashboard ? dashboard.myMarketCapWei.toString()    : '0',
    myPnl:             dashboard ? dashboard.myPnlWei.toString()          : '0',
    myRoiBps:          dashboard ? dashboard.myRoiBps_.toString()         : '0',
  };
}

// ─────────────────────────────────────────────
// 2. JUMP 구매 (HEX → JUMP)
// ─────────────────────────────────────────────
async function buyJumpToken(uid, jumpAmount, masterSecret) {
  if (!jumpAmount || Number(jumpAmount) <= 0) throw new Error('구매 수량을 입력하세요');

  const { signer, address } = await getCustodialSigner(uid, masterSecret);
  const jumpBank  = getJumpBankContract(signer);
  const hexToken  = getHexContract(signer);
  const provider  = getProvider();

  const amountBig = BigInt(Math.floor(Number(jumpAmount)));
  if (amountBig <= 0n) throw new Error('구매 수량은 1 이상이어야 합니다');

  // 현재 가격 조회
  const price  = await getJumpBankContract(provider).price();
  const hexCost = price * amountBig;
  const maxPay  = (hexCost * 101n) / 100n; // 1% 슬리피지

  // HEX 잔액 확인
  const hexBal = await hexToken.balanceOf(address);
  if (hexBal < hexCost) {
    throw new Error(
      `HEX 잔액 부족. 필요: ${ethers.formatEther(hexCost)} HEX, 보유: ${ethers.formatEther(hexBal)} HEX`
    );
  }

  // HEX approve (MaxUint256)
  const hexAllowance = await hexToken.allowance(address, ADDRESSES.jumpBank);
  if (hexAllowance < hexCost) {
    const approveTx = await hexToken.approve(ADDRESSES.jumpBank, ethers.MaxUint256);
    await approveTx.wait();
  }

  // buy 호출
  const gasLimit = await estimateGasWithBuffer(jumpBank, 'buy', [amountBig, maxPay]);
  const tx       = await jumpBank.buy(amountBig, maxPay, { gasLimit });
  const receipt  = await tx.wait();

  await db.collection('transactions').add({
    uid,
    type:       'buyJump',
    jumpAmount: amountBig.toString(),
    hexCost:    hexCost.toString(),
    txHash:     receipt.hash,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    txHash:     receipt.hash,
    jumpAmount: amountBig.toString(),
    hexCost:    hexCost.toString(),
  };
}

// ─────────────────────────────────────────────
// 3. JUMP 판매 (JUMP → HEX)
// ─────────────────────────────────────────────
async function sellJumpToken(uid, jumpAmount, masterSecret) {
  if (!jumpAmount || Number(jumpAmount) <= 0) throw new Error('판매 수량을 입력하세요');

  const { signer, address } = await getCustodialSigner(uid, masterSecret);
  const jumpBank  = getJumpBankContract(signer);
  const jumpToken = getJumpTokenContract(signer);

  const amountBig = BigInt(Math.floor(Number(jumpAmount)));

  // JUMP 잔액 확인
  const jumpBal = await getJumpTokenContract(getProvider()).balanceOf(address);
  if (jumpBal < amountBig) {
    throw new Error(`JUMP 잔액 부족. 필요: ${amountBig}, 보유: ${jumpBal}`);
  }

  // JUMP approve
  const jumpAllowance = await jumpToken.allowance(address, ADDRESSES.jumpBank);
  if (jumpAllowance < amountBig) {
    const approveTx = await jumpToken.approve(ADDRESSES.jumpBank, ethers.MaxUint256);
    await approveTx.wait();
  }

  // sell 호출
  const gasLimit = await estimateGasWithBuffer(jumpBank, 'sell', [amountBig]);
  const tx       = await jumpBank.sell(amountBig, { gasLimit });
  const receipt  = await tx.wait();

  await db.collection('transactions').add({
    uid,
    type:       'sellJump',
    jumpAmount: amountBig.toString(),
    txHash:     receipt.hash,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    txHash:     receipt.hash,
    jumpAmount: amountBig.toString(),
  };
}

// ─────────────────────────────────────────────
// 4. JUMP 스테이킹
// ─────────────────────────────────────────────
async function stakeJumpToken(uid, jumpAmount, masterSecret) {
  if (!jumpAmount || Number(jumpAmount) <= 0) throw new Error('스테이킹 수량을 입력하세요');

  const { signer, address } = await getCustodialSigner(uid, masterSecret);
  const jumpBank  = getJumpBankContract(signer);
  const jumpToken = getJumpTokenContract(signer);

  const amountBig = BigInt(Math.floor(Number(jumpAmount)));

  // JUMP 잔액 확인
  const jumpBal = await getJumpTokenContract(getProvider()).balanceOf(address);
  if (jumpBal < amountBig) {
    throw new Error(`JUMP 잔액 부족. 필요: ${amountBig}, 보유: ${jumpBal}`);
  }

  // JUMP approve
  const jumpAllowance = await jumpToken.allowance(address, ADDRESSES.jumpBank);
  if (jumpAllowance < amountBig) {
    const approveTx = await jumpToken.approve(ADDRESSES.jumpBank, ethers.MaxUint256);
    await approveTx.wait();
  }

  // stake 호출
  const gasLimit = await estimateGasWithBuffer(jumpBank, 'stake', [amountBig]);
  const tx       = await jumpBank.stake(amountBig, { gasLimit });
  const receipt  = await tx.wait();

  await db.collection('transactions').add({
    uid,
    type:       'stakeJump',
    jumpAmount: amountBig.toString(),
    txHash:     receipt.hash,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    txHash:     receipt.hash,
    jumpAmount: amountBig.toString(),
  };
}

// ─────────────────────────────────────────────
// 5. JUMP 언스테이킹 (120일 락 — 컨트랙트 자동 검증)
// ─────────────────────────────────────────────
async function unstakeJumpToken(uid, masterSecret) {
  const { signer } = await getCustodialSigner(uid, masterSecret);
  const jumpBank = getJumpBankContract(signer);

  const gasLimit = await estimateGasWithBuffer(jumpBank, 'withdraw', []);
  const tx       = await jumpBank.withdraw({ gasLimit });
  const receipt  = await tx.wait();

  await db.collection('transactions').add({
    uid,
    type:    'unstakeJump',
    txHash:  receipt.hash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { txHash: receipt.hash };
}

// ─────────────────────────────────────────────
// 6. 배당 청구 (HEX 수령)
// ─────────────────────────────────────────────
async function claimJumpDividend(uid, masterSecret) {
  const { signer, address } = await getCustodialSigner(uid, masterSecret);
  const jumpBank = getJumpBankContract(signer);

  // 청구 가능 금액 확인
  const pending = await getJumpBankContract(getProvider()).pendingDividend(address);
  if (pending === 0n) throw new Error('청구할 배당이 없습니다');

  const gasLimit = await estimateGasWithBuffer(jumpBank, 'claimDividend', []);
  const tx       = await jumpBank.claimDividend({ gasLimit });
  const receipt  = await tx.wait();

  await db.collection('transactions').add({
    uid,
    type:         'claimDividend',
    hexAmount:    pending.toString(),
    txHash:       receipt.hash,
    createdAt:    admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    txHash:    receipt.hash,
    hexAmount: pending.toString(),
  };
}

module.exports = {
  getJumpBankStatus,
  buyJumpToken,
  sellJumpToken,
  stakeJumpToken,
  unstakeJumpToken,
  claimJumpDividend,
};
