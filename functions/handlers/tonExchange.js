// functions/handlers/tonExchange.js
// TON ↔ GameCoin 교환 처리
// 입금: TON → 관리자 지갑 → 블록체인 확인 → DB GameCoin 적립
// 출금: DB GameCoin 차감 → 관리자 지갑 → TON 송금 요청

'use strict';

const admin  = require('firebase-admin');
const https  = require('https');

const db               = admin.firestore();
const COIN_PER_USD     = 10000;       // 1 USD = 10,000 GameCoin
const TON_CACHE_TTL    = 60 * 1000;  // 60초 캐시
const MIN_WITHDRAW_GP  = 1000;       // 최소 출금 GP
const MAX_DAILY_WITHDRAW_GP = 500000; // 1일 최대 출금 GP
const TONCENTER_BASE   = 'https://toncenter.com/api/v2';

let _tonCache = { usd: 0, ts: 0 };

// ── HTTP 유틸 ──────────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 9000 }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse 오류: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('API 타임아웃')));
  });
}

// ── TON 실시간 가격 (CoinGecko) ───────────────────────────────────────────────
async function getTonUsdPrice() {
  const now = Date.now();
  if (_tonCache.usd > 0 && now - _tonCache.ts < TON_CACHE_TTL) {
    return _tonCache.usd;
  }
  try {
    const d = await fetchJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd'
    );
    const price = d?.['the-open-network']?.usd;
    if (price > 0) _tonCache = { usd: price, ts: now };
  } catch (e) {
    console.warn('[tonExchange] CoinGecko 실패, 캐시 사용:', e.message);
  }
  return _tonCache.usd > 0 ? _tonCache.usd : 2.50; // fallback
}

// ── TON 환율 정보 반환 ────────────────────────────────────────────────────────
async function getPrice() {
  const usd = await getTonUsdPrice();
  return {
    tonUsd:         usd,
    coinPerTon:     Math.floor(usd * COIN_PER_USD),
    coinPerUsd:     COIN_PER_USD,
    minWithdrawGp:  MIN_WITHDRAW_GP,
    updatedAt:      new Date().toISOString(),
  };
}

// ── 관리자 지갑 주소 조회 ──────────────────────────────────────────────────────
async function getAdminWallet() {
  const snap = await db.collection('config').doc('ton').get();
  const addr = snap.data()?.adminWallet;
  if (!addr) throw new Error('관리자 TON 지갑 주소가 설정되지 않았습니다 (config/ton.adminWallet)');
  return addr;
}

// ── TonCenter API: TX 조회 ────────────────────────────────────────────────────
async function fetchTxByHash(txHash) {
  try {
    const data = await fetchJson(`${TONCENTER_BASE}/getTransactions?hash=${encodeURIComponent(txHash)}&limit=1&archival=false`);
    if (data?.ok && data.result?.length > 0) return data.result[0];
  } catch (e) {
    console.warn('[tonExchange] TonCenter TX 조회 실패:', e.message);
  }
  return null;
}

// ── 입금 확인 & GameCoin 지급 ─────────────────────────────────────────────────
// txHash: 유저가 제출한 TON 트랜잭션 해시
// uid:    Firebase Auth UID
async function verifyDeposit(txHash, uid) {
  if (!txHash || typeof txHash !== 'string') throw new Error('txHash가 누락됐습니다');

  // 1. 중복 처리 방지
  const dupSnap = await db.collection('ton_transactions')
    .where('txHash', '==', txHash).limit(1).get();
  if (!dupSnap.empty && dupSnap.docs[0].data().status === 'confirmed') {
    throw new Error('이미 처리된 트랜잭션입니다');
  }

  // 2. 관리자 지갑 주소 확인
  const adminWallet = await getAdminWallet();

  // 3. 온체인 TX 검증
  const tx = await fetchTxByHash(txHash);
  if (!tx) throw new Error('트랜잭션을 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.');

  const inMsg      = tx.in_msg;
  const destination = (inMsg?.destination || '').toLowerCase();
  const nanoton    = parseInt(inMsg?.value || '0', 10);

  if (destination !== adminWallet.toLowerCase()) {
    throw new Error('수신 주소가 관리자 지갑과 일치하지 않습니다');
  }
  if (nanoton <= 0) throw new Error('전송 금액이 0입니다');

  // 4. GameCoin 계산
  const tonAmount = nanoton / 1e9;
  const tonUsd    = await getTonUsdPrice();
  const gamecoin  = Math.floor(tonAmount * tonUsd * COIN_PER_USD);

  if (gamecoin < 1) throw new Error('교환 GameCoin이 너무 적습니다');

  // 5. 트랜잭션 기록 저장
  const batch = db.batch();
  const txRef = db.collection('ton_transactions').doc();
  batch.set(txRef, {
    uid, txHash, tonAmount, usdRate: tonUsd, gamecoin,
    type: 'deposit', status: 'confirmed',
    adminWallet, senderAddress: inMsg?.source || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 6. GameCoin 지급
  const playerRef = db.collection('battle_players').doc(uid);
  batch.update(playerRef, {
    gold: admin.firestore.FieldValue.increment(gamecoin),
  });

  await batch.commit();

  console.info('[tonExchange] 입금 완료', { uid, txHash, tonAmount, gamecoin });
  return { txHash, tonAmount, gamecoin, usdRate: tonUsd };
}

// ── 출금 요청 ─────────────────────────────────────────────────────────────────
// gamecoin:      출금할 GameCoin 수량
// walletAddress: 유저의 TON 지갑 주소 (수신)
// uid:           Firebase Auth UID
async function requestWithdraw(gamecoin, walletAddress, uid) {
  if (!Number.isInteger(gamecoin) || gamecoin < MIN_WITHDRAW_GP) {
    throw new Error(`최소 출금 GP는 ${MIN_WITHDRAW_GP.toLocaleString()} GP 입니다`);
  }
  if (!walletAddress || walletAddress.trim().length < 30) {
    throw new Error('올바른 TON 지갑 주소를 입력해 주세요');
  }

  // 일일 출금 한도 확인
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todaySnap = await db.collection('ton_transactions')
    .where('uid', '==', uid)
    .where('type', '==', 'withdraw')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(todayStart))
    .get();
  const dailyUsed = todaySnap.docs.reduce((sum, d) => sum + (d.data().gamecoin || 0), 0);
  if (dailyUsed + gamecoin > MAX_DAILY_WITHDRAW_GP) {
    throw new Error(`1일 출금 한도(${MAX_DAILY_WITHDRAW_GP.toLocaleString()} GP)를 초과합니다`);
  }

  // 잔액 확인
  const playerDoc = await db.collection('battle_players').doc(uid).get();
  const balance   = playerDoc.data()?.gold || 0;
  if (balance < gamecoin) throw new Error('GP 잔액이 부족합니다');

  // 환율 계산
  const tonUsd    = await getTonUsdPrice();
  const tonAmount = gamecoin / (tonUsd * COIN_PER_USD);

  if (tonAmount < 0.001) throw new Error('출금 TON이 너무 적습니다 (최소 0.001 TON)');

  // GP 차감 (pending 상태)
  const batch = db.batch();
  const wdRef = db.collection('ton_transactions').doc();
  batch.set(wdRef, {
    uid, walletAddress, gamecoin, tonAmount, usdRate: tonUsd,
    type: 'withdraw', status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(db.collection('battle_players').doc(uid), {
    gold: admin.firestore.FieldValue.increment(-gamecoin),
  });
  await batch.commit();

  console.info('[tonExchange] 출금 요청', { uid, gamecoin, tonAmount, walletAddress });
  return { id: wdRef.id, gamecoin, tonAmount, usdRate: tonUsd, status: 'pending' };
}

// ── 내 거래 내역 조회 ─────────────────────────────────────────────────────────
async function getMyTransactions(uid, limitCount = 20) {
  const snap = await db.collection('ton_transactions')
    .where('uid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() }));
}

module.exports = { getPrice, getTonUsdPrice, verifyDeposit, requestWithdraw, getMyTransactions };
