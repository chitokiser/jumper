// functions/handlers/tonExchange.js
// TON ↔ GameCoin 교환 처리 (자동 출금)
// 입금: TON → 관리자 지갑 → TonCenter TX 검증 → DB GameCoin 적립
// 출금: GameCoin ≥ 10,000 → 자동 TON 송금 (@ton/ton SDK)

'use strict';

const admin = require('firebase-admin');
const https = require('https');

const db                  = admin.firestore();
const COIN_PER_USD        = 10000;         // 1 USD = 10,000 GameCoin
const TON_CACHE_TTL       = 60 * 1000;    // 60초 가격 캐시
const MIN_WITHDRAW_GP     = 10000;         // 최소 출금 10,000 GP
const MAX_DAILY_WITHDRAW  = 1_000_000;    // 1일 최대 출금 1,000,000 GP
const TONCENTER_BASE      = 'https://toncenter.com/api/v2';

let _tonCache = { usd: 0, ts: 0 };

// ── HTTP 헬퍼 ─────────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 9000 }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', () => reject(new Error('타임아웃')));
  });
}

// ── TON 실시간 가격 (Binance primary → CoinGecko fallback, 60초 캐시) ─────────
async function getTonUsdPrice() {
  const now = Date.now();
  if (_tonCache.usd > 0 && now - _tonCache.ts < TON_CACHE_TTL) return _tonCache.usd;

  // 1순위: Binance (빠르고 정확, 키 불필요)
  try {
    const d = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT');
    const p = parseFloat(d?.price);
    if (p > 0) { _tonCache = { usd: p, ts: now }; return p; }
  } catch (e) { console.warn('[ton] Binance 실패:', e.message); }

  // 2순위: CoinGecko
  try {
    const d = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
    const p = d?.['the-open-network']?.usd;
    if (p > 0) { _tonCache = { usd: p, ts: now }; return p; }
  } catch (e) { console.warn('[ton] CoinGecko 실패:', e.message); }

  // 캐시라도 반환 (최신 실패 시), 캐시도 없으면 에러
  if (_tonCache.usd > 0) return _tonCache.usd;
  throw new Error('TON 시세 조회 실패 — 잠시 후 다시 시도해 주세요');
}

// ── 가격 + 교환비 반환 ────────────────────────────────────────────────────────
async function getPrice() {
  const usd = await getTonUsdPrice();
  return {
    tonUsd:          usd,
    coinPerTon:      Math.floor(usd * COIN_PER_USD),
    coinPerUsd:      COIN_PER_USD,
    minWithdrawGp:   MIN_WITHDRAW_GP,
    updatedAt:       new Date().toISOString(),
  };
}

// ── 관리자 TON 지갑 주소 ──────────────────────────────────────────────────────
async function getAdminWallet() {
  const snap = await db.collection('config').doc('ton').get();
  const addr = snap.data()?.adminWallet;
  if (!addr) throw new Error('config/ton.adminWallet이 설정되지 않았습니다');
  return addr;
}

// ── TonCenter: TX 조회 ────────────────────────────────────────────────────────
async function fetchTxByHash(txHash) {
  try {
    const d = await fetchJson(`${TONCENTER_BASE}/getTransactions?hash=${encodeURIComponent(txHash)}&limit=1&archival=false`);
    if (d?.ok && d.result?.length > 0) return d.result[0];
  } catch (e) { console.warn('[ton] TX 조회 실패:', e.message); }
  return null;
}

// ── 자동 TON 송금 (@ton/ton SDK) ──────────────────────────────────────────────
async function sendTonAutomatic(toAddress, tonAmount, adminMnemonic) {
  const { TonClient, WalletContractV4, internal, toNano } = require('@ton/ton');
  const { mnemonicToPrivateKey } = require('@ton/crypto');

  const words   = adminMnemonic.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet  = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
  const client  = new TonClient({ endpoint: `${TONCENTER_BASE}/jsonRPC` });
  const contract = client.open(wallet);

  const seqno = await contract.getSeqno();

  await contract.sendTransfer({
    secretKey:  keyPair.secretKey,
    seqno,
    messages: [
      internal({
        to:      toAddress,
        value:   toNano(tonAmount.toFixed(9)),
        bounce:  false,
      }),
    ],
  });

  // seqno+1이 확인될 때까지 최대 30초 대기 → TX hash 조회
  const maxWait = 30;
  for (let i = 0; i < maxWait; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const newSeqno = await contract.getSeqno().catch(() => seqno);
    if (newSeqno > seqno) break;
  }

  // 최근 TX 목록에서 해당 출금 TX hash 조회
  try {
    const txList = await fetchJson(
      `${TONCENTER_BASE}/getTransactions?address=${wallet.address.toString()}&limit=5&archival=false`
    );
    const outTx = txList?.result?.find(tx => {
      const msg = tx.out_msgs?.[0];
      return msg?.destination?.toLowerCase() === toAddress.toLowerCase();
    });
    if (outTx?.transaction_id?.hash) return outTx.transaction_id.hash;
  } catch {}
  return null; // hash 미확인이어도 송금은 완료
}

// ── 입금 확인 & GameCoin 지급 ─────────────────────────────────────────────────
async function verifyDeposit(txHash, uid) {
  if (!txHash?.trim()) throw new Error('txHash가 누락됐습니다');

  // 중복 처리 방지
  const dup = await db.collection('ton_transactions').where('txHash', '==', txHash).limit(1).get();
  if (!dup.empty && dup.docs[0].data().status === 'confirmed') throw new Error('이미 처리된 트랜잭션입니다');

  const adminWallet = await getAdminWallet();
  const tx          = await fetchTxByHash(txHash);
  if (!tx) throw new Error('트랜잭션을 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.');

  const inMsg = tx.in_msg;
  const dest  = (inMsg?.destination || '').toLowerCase();
  const nano  = parseInt(inMsg?.value || '0', 10);

  if (dest !== adminWallet.toLowerCase()) throw new Error('수신 주소가 관리자 지갑과 일치하지 않습니다');
  if (nano <= 0) throw new Error('전송 금액이 0입니다');

  const tonAmount = nano / 1e9;
  const tonUsd    = await getTonUsdPrice();
  const gamecoin  = Math.floor(tonAmount * tonUsd * COIN_PER_USD);
  if (gamecoin < 1) throw new Error('환산 GameCoin이 너무 적습니다');

  const batch = db.batch();
  batch.set(db.collection('ton_transactions').doc(), {
    uid, txHash, tonAmount, usdRate: tonUsd, gamecoin,
    type: 'deposit', status: 'confirmed',
    senderAddress: inMsg?.source || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(db.collection('battle_players').doc(uid), {
    gold: admin.firestore.FieldValue.increment(gamecoin),
  });
  await batch.commit();

  console.info('[ton] 입금 완료', { uid, txHash, tonAmount, gamecoin });
  return { txHash, tonAmount, gamecoin, usdRate: tonUsd };
}

// ── 자동 출금 처리 ────────────────────────────────────────────────────────────
// adminMnemonic: Firebase Secret TON_ADMIN_MNEMONIC 값 (24-word)
async function requestWithdraw(gamecoin, walletAddress, uid, adminMnemonic) {
  if (!Number.isInteger(gamecoin) || gamecoin < MIN_WITHDRAW_GP) {
    throw new Error(`최소 출금은 ${MIN_WITHDRAW_GP.toLocaleString()} GP 입니다`);
  }
  if (!walletAddress?.trim() || walletAddress.trim().length < 30) {
    throw new Error('올바른 TON 지갑 주소를 입력해 주세요');
  }
  if (!adminMnemonic) throw new Error('관리자 지갑 시드가 설정되지 않았습니다');

  // 일일 출금 한도
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todaySnap = await db.collection('ton_transactions')
    .where('uid', '==', uid).where('type', '==', 'withdraw')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(todayStart))
    .get();
  const dailyUsed = todaySnap.docs.reduce((s, d) => s + (d.data().gamecoin || 0), 0);
  if (dailyUsed + gamecoin > MAX_DAILY_WITHDRAW) {
    throw new Error(`1일 출금 한도(${MAX_DAILY_WITHDRAW.toLocaleString()} GP)를 초과합니다`);
  }

  // 잔액 확인
  const playerDoc = await db.collection('battle_players').doc(uid).get();
  const balance   = playerDoc.data()?.gold || 0;
  if (balance < gamecoin) throw new Error('GP 잔액이 부족합니다');

  // 환율 계산
  const tonUsd    = await getTonUsdPrice();
  const tonAmount = gamecoin / (tonUsd * COIN_PER_USD);
  if (tonAmount < 0.001) throw new Error('출금 TON 수량이 너무 적습니다 (최소 0.001 TON)');

  // GP 선차감 (processing 상태)
  const txRef = db.collection('ton_transactions').doc();
  const batch = db.batch();
  batch.set(txRef, {
    uid, walletAddress, gamecoin, tonAmount, usdRate: tonUsd,
    type: 'withdraw', status: 'processing',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(db.collection('battle_players').doc(uid), {
    gold: admin.firestore.FieldValue.increment(-gamecoin),
  });
  await batch.commit();

  // 자동 TON 송금 실행
  let txHash = null;
  try {
    txHash = await sendTonAutomatic(walletAddress.trim(), tonAmount, adminMnemonic);
    await txRef.update({ status: 'confirmed', txHash: txHash || '', completedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.info('[ton] 자동 출금 완료', { uid, gamecoin, tonAmount, txHash });
  } catch (sendErr) {
    // 송금 실패 → GP 복원
    console.error('[ton] 자동 출금 실패, GP 복원:', sendErr.message);
    await db.runTransaction(async t => {
      t.update(txRef, { status: 'failed', error: sendErr.message });
      t.update(db.collection('battle_players').doc(uid), {
        gold: admin.firestore.FieldValue.increment(gamecoin),
      });
    });
    throw new Error('TON 송금 실패: ' + sendErr.message);
  }

  return { id: txRef.id, gamecoin, tonAmount, usdRate: tonUsd, txHash, status: 'confirmed' };
}

// ── 거래 내역 ─────────────────────────────────────────────────────────────────
async function getMyTransactions(uid, limitN = 20) {
  const snap = await db.collection('ton_transactions')
    .where('uid', '==', uid).orderBy('createdAt', 'desc').limit(limitN).get();
  return snap.docs.map(d => ({
    id: d.id, ...d.data(),
    createdAt: d.data().createdAt?.toDate?.()?.toISOString(),
  }));
}

module.exports = { getPrice, getTonUsdPrice, verifyDeposit, requestWithdraw, getMyTransactions };
