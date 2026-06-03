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
  getAdminWallet,
  walletFromKey,
  estimateGasWithBuffer,
} = require('../wallet/chain');
const { fetchExchangeRates } = require('../wallet/exchange');

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

  // 1단계: 시장 데이터 + 차트 길이 + 실시간 환율 일괄 조회
  const [
    [
      price, totalStaked, act, rate, autoStakeBpsVal,
      bankHexBal, bankJumpInv, circSupply, jumpTotalSupply,
      effStaked, divisorVal, chartLen,
    ],
    fxRates,
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
    fetchExchangeRates().catch(() => ({ krwPerUsd: 0, vndPerUsd: 0 })),
  ]);
  const usdKrwRate = fxRates.krwPerUsd || 0;
  const usdVndRate = fxRates.vndPerUsd || 0;

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

  // KRW/VND 가격 계산: 1 HEX = 1 USDT 기준 실시간 환율 적용
  const priceUsdt = Number(BigInt(price.toString())) / 1e18;
  const priceKrw  = usdKrwRate > 0 ? Math.round(priceUsdt * usdKrwRate) : 0;
  const priceVnd  = usdVndRate > 0 ? Math.round(priceUsdt * usdVndRate) : 0;

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
    priceKrw:    priceKrw,                    // JUMP 1개 원화 가격 (정수 원)
    priceVnd:    priceVnd,                    // JUMP 1개 동화 가격 (정수 동)
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

// ─────────────────────────────────────────────
// 7. 스왑 환율 조회 (Firestore exchange_config/swap_rates)
//    hex_ton rate: 1 HEX = 1 USD → rate = 1 / TON_USD (라이브 계산)
// ─────────────────────────────────────────────
async function getSwapRates() {
  const snap = await db.collection('exchange_config').doc('swap_rates').get();
  const data = snap.exists ? snap.data() : {
    jump_gamecoin: { rate: 10,  fee: 0, enabled: true  },
    ton_gamecoin:  { rate: 500, fee: 1, enabled: false },
    hex_ton:       { fee: 1,          enabled: true  },
  };

  // hex_ton: 라이브 TON 시세로 rate 계산 (1 HEX = 1 USD)
  if (data.hex_ton?.enabled !== false) {
    try {
      const tonH   = require('./tonExchange');
      const tonUsd = await tonH.getTonUsdPrice();
      data.hex_ton = { ...(data.hex_ton || {}), rate: 1 / tonUsd, tonUsd };
    } catch (_) {}
  }

  return data;
}

// ─────────────────────────────────────────────
// 8. 거래내역 조회 (페이지네이션)
// ─────────────────────────────────────────────
async function getExchangeHistory(uid, { limit = 20, startAfter = null, pairFilter = '', statusFilter = '' } = {}) {
  const needTon  = !pairFilter || pairFilter === 'ton_gamecoin';
  const needJump = !pairFilter || pairFilter === 'jump_gamecoin';
  const needMain = !pairFilter || !['ton_gamecoin', 'jump_gamecoin'].includes(pairFilter);

  // ── 1. transactions 컬렉션 ──
  let mainItems = [];
  let lastDocId = null;
  let hasMore   = false;

  if (needMain) {
    let q = db.collection('transactions')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (startAfter) {
      try {
        const cur = await db.collection('transactions').doc(startAfter).get();
        if (cur.exists) q = q.startAfter(cur);
      } catch (_) {}
    }

    const snaps = await q.get();
    mainItems = snaps.docs.map(d => {
      const data = d.data();
      return {
        id:         d.id,
        type:       data.type,
        pair:       data.pair,
        fromAmount: data.fromAmount ?? null,
        toAmount:   data.toAmount   ?? null,
        feeAmount:  data.feeAmount  ?? null,
        hexCost:    data.hexCost    ?? null,
        jumpAmount: data.jumpAmount ?? null,
        hexAmount:  data.hexAmount  ?? null,
        coinAmount: data.coinAmount ?? null,
        rate:       data.rate       ?? null,
        status:     data.status     || 'completed',
        txHash:     data.txHash     || data.swapId || null,
        swapId:     data.swapId     || null,
        createdAt:  data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });
    lastDocId = snaps.docs.length > 0 ? snaps.docs[snaps.docs.length - 1].id : null;
    hasMore   = snaps.docs.length === limit;
  }

  // ── 2. ton_transactions 컬렉션 (최근 50건) ──
  let tonItems = [];
  if (needTon) {
    try {
      const tonSnaps = await db.collection('ton_transactions')
        .where('uid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      tonItems = tonSnaps.docs.map(d => {
        const data = d.data();
        const isDeposit = data.type === 'deposit';
        const statusMap = { confirmed: 'completed', processing: 'pending', failed: 'failed' };
        return {
          id:         d.id,
          type:       isDeposit ? 'swap_ton_to_coin' : 'swap_coin_to_ton',
          fromAmount: isDeposit ? data.tonAmount       : data.gamecoin,
          toAmount:   isDeposit ? data.gamecoin        : data.tonAmount,
          feeAmount:  data.feeGp ?? null,
          status:     statusMap[data.status] || 'completed',
          txHash:     data.txHash || null,
          createdAt:  data.createdAt?.toDate?.()?.toISOString() || null,
        };
      });
    } catch (_) {}
  }

  // ── 3. jump_coin_exchanges 컬렉션 (최근 50건) ──
  let jumpItems = [];
  if (needJump) {
    try {
      const jumpSnaps = await db.collection('jump_coin_exchanges')
        .where('uid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      jumpItems = jumpSnaps.docs.map(d => {
        const data = d.data();
        const isBuy = data.direction === 'buy'; // 게임코인 → JUMP
        return {
          id:         d.id,
          type:       isBuy ? 'buyJumpWithCoins' : 'sellJumpForCoins',
          fromAmount: isBuy ? data.coinAmount : data.jumpAmount,
          toAmount:   isBuy ? data.jumpAmount  : data.coinAmount,
          feeAmount:  null,
          status:     'completed',
          txHash:     data.txHash || null,
          createdAt:  data.createdAt?.toDate?.()?.toISOString() || null,
        };
      });
    } catch (_) {}
  }

  // ── 4. 병합 → 날짜 내림차순 ──
  let items = [...mainItems, ...tonItems, ...jumpItems].sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // ── 5. 필터 ──
  if (pairFilter && !['ton_gamecoin', 'jump_gamecoin'].includes(pairFilter)) {
    const pairMap = {
      hex_jump:      ['buyJump', 'sellJump'],
      jump_gamecoin: ['buyJumpWithCoins', 'sellJumpForCoins'],
      hex_ton:       ['swap_hex_to_ton', 'swap_ton_to_hex'],
    };
    const allowed = pairMap[pairFilter] || [];
    if (allowed.length) items = items.filter(it => allowed.includes(it.type));
  }
  if (statusFilter) {
    items = items.filter(it => (it.status || 'completed') === statusFilter);
  }

  return {
    items:   items.slice(0, limit),
    lastId:  lastDocId,
    hasMore,
  };
}

// ─────────────────────────────────────────────
// 9. TON ↔ 게임코인 교환 신청
// ─────────────────────────────────────────────
async function requestTonCoinSwap(uid, { direction, amount, tonAddress }) {
  if (!['ton_to_coin', 'coin_to_ton'].includes(direction))
    throw new Error('올바르지 않은 교환 방향');
  if (!amount || Number(amount) <= 0) throw new Error('수량을 입력하세요');

  const ratesSnap = await db.collection('exchange_config').doc('swap_rates').get();
  const cfg = ratesSnap.data()?.ton_gamecoin || {};
  if (cfg.enabled === false) throw new Error('TON↔게임코인 교환이 현재 비활성화되어 있습니다');

  const rate       = Number(cfg.rate ?? 500);
  const feePct     = Number(cfg.fee  ?? 1) / 100;
  const fromAmount = Number(amount);
  let toAmount, feeAmount;

  if (direction === 'ton_to_coin') {
    const gross = fromAmount * rate;
    feeAmount   = gross * feePct;
    toAmount    = gross - feeAmount;
  } else {
    // coin_to_ton: 코인 차감 + TON 지급 예약
    const bpSnap = await db.collection('battle_players').doc(uid).get();
    const gold   = bpSnap.exists ? Number(bpSnap.data().gold || 0) : 0;
    if (fromAmount > gold) throw new Error(`게임코인 부족. 보유: ${gold.toLocaleString()}`);
    const gross = fromAmount / rate;
    feeAmount   = gross * feePct;
    toAmount    = gross - feeAmount;
    await db.collection('battle_players').doc(uid).update({
      gold: admin.firestore.FieldValue.increment(-fromAmount),
    });
  }

  const swapRef = await db.collection('swap_requests').add({
    uid, direction, fromAmount, toAmount, feeAmount, rate, tonAddress,
    pair: 'ton_gamecoin', status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('transactions').add({
    uid,
    type:      `swap_${direction}`,
    fromAmount, toAmount, feeAmount, rate,
    pair:      'ton_gamecoin',
    status:    'pending',
    swapId:    swapRef.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const tonDepositAddress = process.env.TON_DEPOSIT_ADDRESS || '';
  // memo: swapId의 앞 20자 (대문자) — TON 트랜잭션 comment에 입력
  const memo = swapRef.id.slice(0, 20).toUpperCase();
  return {
    swapId: swapRef.id,
    memo,
    direction, fromAmount, toAmount, feeAmount, rate,
    status: 'pending',
    depositAddress: direction === 'ton_to_coin' ? tonDepositAddress : null,
  };
}

// ─────────────────────────────────────────────
// 10. HEX ↔ TON 교환 — 완전 자동 처리
// ─────────────────────────────────────────────
async function requestHexTonSwap(uid, { direction, amount, tonAddress, masterSecret }) {
  if (!['hex_to_ton', 'ton_to_hex'].includes(direction))
    throw new Error('올바르지 않은 교환 방향');
  if (!amount || Number(amount) <= 0) throw new Error('수량을 입력하세요');

  const ratesSnap = await db.collection('exchange_config').doc('swap_rates').get();
  const cfg = ratesSnap.data()?.hex_ton || {};
  if (cfg.enabled === false) throw new Error('HEX↔TON 교환이 현재 비활성화되어 있습니다');

  // 1 HEX = 1 USD → rate = 1 / TON_USD (라이브)
  const tonH   = require('./tonExchange');
  const tonUsd = await tonH.getTonUsdPrice();
  const rate   = 1 / tonUsd;
  const feePct = Number(cfg.fee ?? 1) / 100;
  const fromAmount = Number(amount);

  if (direction === 'hex_to_ton') {
    // ── HEX → TON ──────────────────────────────────
    const grossTon  = fromAmount * rate;
    const feeAmount = grossTon * feePct;
    const toAmount  = grossTon - feeAmount;

    if (!tonAddress?.trim()) throw new Error('TON 수령 주소를 입력하세요');
    if (toAmount < 0.001) throw new Error('교환 TON 수량이 너무 적습니다 (최소 0.001 TON)');

    // 1) 유저 수탁지갑에서 HEX → 관리자 opBNB 지갑으로 이체
    const { signer, address: userAddr } = await getCustodialSigner(uid, masterSecret);
    const hexToken   = getHexContract(signer);
    const hexWei     = BigInt(Math.floor(fromAmount * 1e18));
    const adminAddr  = getAdminWallet().address;

    const bal = await hexToken.balanceOf(userAddr);
    if (bal < hexWei) throw new Error(`HEX 잔액 부족 (필요: ${fromAmount} HEX)`);

    const gasEst = await estimateGasWithBuffer(hexToken, 'transfer', [adminAddr, hexWei]);
    const hexTx  = await hexToken.transfer(adminAddr, hexWei, { gasLimit: gasEst });
    await hexTx.wait();

    // 2) TON 자동 송금
    const tonH   = require('./tonExchange');
    const tonTxHash = await tonH.sendTonOut(tonAddress.trim(), toAmount);

    // 3) 기록
    const swapRef = db.collection('swap_requests').doc();
    await Promise.all([
      swapRef.set({
        uid, direction, fromAmount, toAmount, feeAmount, rate, tonAddress,
        pair: 'hex_ton', status: 'completed',
        hexTxHash: hexTx.hash, tonTxHash: tonTxHash || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
      db.collection('transactions').add({
        uid, type: 'swap_hex_to_ton',
        fromAmount, toAmount, feeAmount, rate,
        pair: 'hex_ton', status: 'completed',
        swapId: swapRef.id, txHash: tonTxHash || hexTx.hash,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
    ]);

    return { swapId: swapRef.id, direction, fromAmount, toAmount, feeAmount, rate, status: 'completed', tonTxHash };

  } else {
    // ── TON → HEX ──────────────────────────────────
    const grossHex  = fromAmount / rate;
    const feeAmount = grossHex * feePct;
    const toAmount  = grossHex - feeAmount;
    const hexWei    = BigInt(Math.floor(toAmount * 1e18));

    // senderAddress, tonNano, sentAt 는 ton_to_hex 자동화용으로 클라이언트에서 전달
    const { senderAddress, tonNano, sentAt } = arguments[1] ?? {};

    if (!senderAddress || !tonNano || !sentAt)
      throw new Error('senderAddress, tonNano, sentAt 파라미터가 필요합니다');

    // 1) TonCenter에서 TON 수신 확인
    const tonH = require('./tonExchange');
    const verified = await tonH.findTonTx(senderAddress, tonNano, sentAt);
    if (!verified) throw new Error('TON 트랜잭션을 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.');

    // 중복 처리 방지
    const dup = await db.collection('swap_requests')
      .where('tonTxHash', '==', verified.txHash).limit(1).get();
    if (!dup.empty) throw new Error('이미 처리된 트랜잭션입니다');

    // 2) 유저 opBNB 주소 조회
    const userSnap = await db.collection('users').doc(uid).get();
    const userAddr = userSnap.data()?.wallet?.address;
    if (!userAddr) throw new Error('수탁 지갑이 없습니다');

    // 3) 관리자 opBNB 지갑 → 유저 수탁지갑으로 ERC-20 HEX 직접 이체
    const adminW   = getAdminWallet();
    const hexToken = getHexContract(adminW);
    const adminBal = await hexToken.balanceOf(adminW.address);
    if (adminBal < hexWei) throw new Error(`관리자 HEX 잔액 부족 (보유: ${(Number(adminBal) / 1e18).toFixed(4)} HEX)`);
    const gasEst   = await estimateGasWithBuffer(hexToken, 'transfer', [userAddr, hexWei]);
    const creditTx = await hexToken.transfer(userAddr, hexWei, { gasLimit: gasEst });
    await creditTx.wait();

    // 4) 기록
    const swapRef = db.collection('swap_requests').doc();
    await Promise.all([
      swapRef.set({
        uid, direction, fromAmount: verified.tonAmount, toAmount, feeAmount, rate,
        pair: 'hex_ton', status: 'completed',
        tonTxHash: verified.txHash, hexTxHash: creditTx.hash,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
      db.collection('transactions').add({
        uid, type: 'swap_ton_to_hex',
        fromAmount: verified.tonAmount, toAmount, feeAmount, rate,
        pair: 'hex_ton', status: 'completed',
        swapId: swapRef.id, txHash: creditTx.hash,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
    ]);

    return { swapId: swapRef.id, direction, fromAmount: verified.tonAmount, toAmount, feeAmount, rate, status: 'completed', hexTxHash: creditTx.hash };
  }
}

// ─────────────────────────────────────────────
// 11. 관리자 — 스왑 환율 설정
// ─────────────────────────────────────────────
async function adminSetSwapRate(uid, { pair, rate, fee, enabled }) {
  const validPairs = ['jump_gamecoin', 'ton_gamecoin', 'hex_ton'];
  if (!validPairs.includes(pair)) throw new Error('유효하지 않은 교환 쌍');

  const update = {};
  if (rate    !== undefined) update[`${pair}.rate`]    = Number(rate);
  if (fee     !== undefined) update[`${pair}.fee`]     = Number(fee);
  if (enabled !== undefined) update[`${pair}.enabled`] = Boolean(enabled);

  await db.collection('exchange_config').doc('swap_rates').set(update, { merge: true });
  await db.collection('admin_logs').add({
    uid, action: 'setSwapRate', pair, rate, fee, enabled,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

module.exports = {
  getJumpBankStatus,
  buyJumpToken,
  sellJumpToken,
  stakeJumpToken,
  unstakeJumpToken,
  claimJumpDividend,
  getSwapRates,
  getExchangeHistory,
  requestTonCoinSwap,
  requestHexTonSwap,
  adminSetSwapRate,
};
