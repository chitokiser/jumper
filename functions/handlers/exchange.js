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
// 실시간 USD/KRW 환율 (open.er-api.com, 10분 캐시)
// ─────────────────────────────────────────────
let _fxCache = { rate: 0, ts: 0 };
const FX_TTL_MS = 600_000; // 10분

async function fetchUsdKrwRate() {
  if (_fxCache.rate > 0 && Date.now() - _fxCache.ts < FX_TTL_MS) {
    return _fxCache.rate;
  }
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    const rate = data?.rates?.KRW ?? 0;
    if (rate > 0) _fxCache = { rate, ts: Date.now() };
    return rate;
  } catch {
    return _fxCache.rate || 0; // 실패 시 캐시 값 반환
  }
}

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

  // 1단계: 시장 데이터 + 차트 길이 + 실시간 환율 일괄 조회
  const [
    [
      price, totalStaked, act, rate, autoStakeBpsVal,
      bankHexBal, bankJumpInv, circSupply, jumpTotalSupply,
      effStaked, divisorVal, chartLen,
    ],
    usdKrwRate,
  ] = await Promise.all([
    Promise.all([
      jumpBank.price(),
      jumpBank.totalStaked(),
      jumpBank.act(),
      jumpBank.rate(),
      jumpBank.autoStakeBps(),
      jumpBank.hexBalance(),
      jumpBank.tokenInventory(),
      jumpBank.circulatingSupply(),
      jumpToken.totalSupply(),
      jumpBank.effectiveStaked(),
      jumpBank.divisor(),
      jumpBank.chartLength(),
    ]),
    fetchUsdKrwRate(),
  ]);

  // 2단계: 차트 데이터 + 유저 데이터 병렬 조회
  const chartLenNum = Number(chartLen);
  const chartCount  = Math.min(chartLenNum, 50);
  const chartStart  = chartLenNum - chartCount;
  const chartIdxs   = Array.from({ length: chartCount }, (_, i) => chartStart + i);

  const [chartPrices, userData] = await Promise.all([
    chartCount > 0
      ? Promise.all(chartIdxs.map(i => jumpBank.chartAt(i)))
      : Promise.resolve([]),
    address
      ? Promise.all([
          hexToken.balanceOf(address),
          jumpToken.balanceOf(address),
          jumpBank.pendingDividend(address),
          jumpBank.user(address),
          jumpBank.myDashboard(address),
        ])
      : Promise.resolve([0n, 0n, 0n, null, null]),
  ]);

  const [hexBal, jumpBal, pending, userInfo, dashboard] = userData;

  // 파생 계산
  const effStakedBig = BigInt(effStaked.toString());
  const divisorBig   = BigInt(divisorVal.toString());
  const buyCap       = effStakedBig > 0n ? effStakedBig / 10n : 0n;
  const perTokenDiv  = effStakedBig > 0n && divisorBig > 0n
    ? bankHexBal / effStakedBig / divisorBig
    : 0n;

  // KRW 가격 계산: 1 HEX = 1 USDT 기준 실시간 환율 적용
  // priceKrw = (price / 1e18) × usdKrwRate
  const priceUsdt = Number(BigInt(price.toString())) / 1e18;
  const priceKrw  = usdKrwRate > 0 ? Math.round(priceUsdt * usdKrwRate) : 0;

  return {
    // 시장 정보
    price:        price.toString(),
    totalStaked:  totalStaked.toString(),
    act:          Number(act),
    rate:         Number(rate),
    autoStakeBps: Number(autoStakeBpsVal),
    // jumpBank 잔고
    bankHexBalance:    bankHexBal.toString(),
    bankJumpInventory: bankJumpInv.toString(),
    circulatingSupply: circSupply.toString(),
    jumpTotalSupply:   jumpTotalSupply.toString(),
    buyCap:            buyCap.toString(),
    perTokenDiv:       perTokenDiv.toString(),
    priceKrw:    priceKrw,                     // JUMP 1개 원화 가격 (정수 원)
    usdKrwRate:  Math.round(usdKrwRate),      // 사용된 USD/KRW 환율
    // 내 잔액
    hexBalance:      hexBal.toString(),
    jumpBalance:     jumpBal.toString(),
    pendingDividend: pending.toString(),
    // 스테이킹 정보
    staked:      userInfo ? userInfo.depo.toString()        : '0',
    stakingTime: userInfo ? userInfo.stakingTime.toString() : '0',
    lastClaim:   userInfo ? userInfo.lastClaim.toString()   : '0',
    totalBuy:    userInfo ? userInfo.totalBuy.toString()    : '0',
    // 내 대시보드 (손익/ROI)
    myActualQty:   dashboard ? dashboard.myActualQty.toString()      : '0',
    myAvgBuyPrice: dashboard ? dashboard.myAvgBuyPriceWei.toString() : '0',
    myMarketCap:   dashboard ? dashboard.myMarketCapWei.toString()   : '0',
    myPnl:         dashboard ? dashboard.myPnlWei.toString()         : '0',
    myRoiBps:      dashboard ? dashboard.myRoiBps_.toString()        : '0',
    // 가격 차트 (최근 50포인트)
    chart: chartPrices.map(p => p.toString()),
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
