// functions/handlers/tonPayment.js
// TON 네트워크 연동 — 입금 감지 자동처리 + TON 자동 송금
// @ton/ton 패키지는 무겁기 때문에 지연 로딩 (배포 타임아웃 방지)

'use strict';

const admin = require('firebase-admin');
const https = require('https');
const db = admin.firestore();

// ─────────────────────────────────────────────────
// 지연 로딩 — 실제 호출 시점에만 TON SDK 로드
// ─────────────────────────────────────────────────
let _ton    = null;
let _crypto = null;

function ton() {
  if (!_ton) _ton = require('@ton/ton');
  return _ton;
}
function tonCrypto() {
  if (!_crypto) _crypto = require('@ton/crypto');
  return _crypto;
}

// ─────────────────────────────────────────────────
// TON 클라이언트
// ─────────────────────────────────────────────────
function getTonClient() {
  const { TonClient } = ton();
  const apiKey = process.env.TON_CENTER_API_KEY || '';
  return new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    ...(apiKey && { apiKey }),
  });
}

// ─────────────────────────────────────────────────
// 플랫폼 TON 지갑 (mnemonic → signer)
// ─────────────────────────────────────────────────
async function getPlatformWallet() {
  const raw = process.env.TON_WALLET_MNEMONIC || '';
  if (!raw) throw new Error('TON_WALLET_MNEMONIC 시크릿이 설정되지 않았습니다');
  const { WalletContractV4 } = ton();
  const { mnemonicToPrivateKey } = tonCrypto();
  const mnemonic = raw.trim().split(/\s+/);
  const { publicKey, secretKey } = await mnemonicToPrivateKey(mnemonic);
  const wallet   = WalletContractV4.create({ publicKey, workchain: 0 });
  const client   = getTonClient();
  const contract = client.open(wallet);
  return { contract, secretKey, address: wallet.address };
}

// ─────────────────────────────────────────────────
// 플랫폼 TON 잔액 조회
// ─────────────────────────────────────────────────
async function getPlatformTonBalance() {
  try {
    const { fromNano } = ton();
    const { address }  = await getPlatformWallet();
    const client       = getTonClient();
    const balance      = await client.getBalance(address);
    return Number(fromNano(balance));
  } catch (_) {
    return 0;
  }
}

// ─────────────────────────────────────────────────
// TON 자동 송금
// ─────────────────────────────────────────────────
async function sendTon(toAddress, amount, memoText = '') {
  const { internal, toNano, Address } = ton();
  const { contract, secretKey } = await getPlatformWallet();
  const seqno = await contract.getSeqno();

  // comment body — @ton/ton v16에서는 beginCell().storeUint(0,32).storeStringTail(text).endCell()
  let body;
  if (memoText) {
    const { beginCell } = ton();
    body = beginCell()
      .storeUint(0, 32)
      .storeStringTail(memoText)
      .endCell();
  }

  await contract.sendTransfer({
    secretKey,
    seqno,
    messages: [
      internal({
        to:     Address.parse(toAddress),
        value:  toNano(amount.toFixed(9)),
        bounce: false,
        body,
      }),
    ],
  });
}

// ─────────────────────────────────────────────────
// toncenter v2 최근 트랜잭션 조회
// ─────────────────────────────────────────────────
function fetchTonCenterTx(address, limit = 30) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.TON_CENTER_API_KEY || '';
    const query  = new URLSearchParams({ address, limit: String(limit), archival: 'false' });
    const url    = `https://toncenter.com/api/v2/getTransactions?${query}`;
    const req = https.get(url, { headers: apiKey ? { 'X-API-Key': apiKey } : {}, timeout: 10_000 }, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TON Center 타임아웃')); });
  });
}

// ─────────────────────────────────────────────────
// TON → 게임코인: 입금 자동 감지 + 코인 지급
// ─────────────────────────────────────────────────
async function processPendingTonDeposits() {
  const depositAddr = process.env.TON_DEPOSIT_ADDRESS || '';
  if (!depositAddr) return;

  const snap = await db.collection('swap_requests')
    .where('pair',      '==', 'ton_gamecoin')
    .where('direction', '==', 'ton_to_coin')
    .where('status',    '==', 'pending')
    .limit(50).get();
  if (snap.empty) return;

  let txList = [];
  try {
    const data = await fetchTonCenterTx(depositAddr, 50);
    txList = data.result || [];
  } catch (_) { return; }

  // in_msg.message(comment) → swapId(20자 대문자) 매핑
  const confirmed = new Map();
  for (const tx of txList) {
    const inMsg = tx.in_msg;
    if (!inMsg || !inMsg.source) continue;
    const msgText = inMsg.message || '';
    const tonAmt  = Number(inMsg.value || 0) / 1e9;
    if (tonAmt <= 0) continue;
    const match = msgText.match(/[A-Z0-9]{20}/);
    if (match) confirmed.set(match[0], { tonAmount: tonAmt, txHash: tx.transaction_id?.hash });
  }

  const batch = db.batch();
  let processed = 0;

  for (const reqDoc of snap.docs) {
    const req  = reqDoc.data();
    const memo = reqDoc.id.slice(0, 20).toUpperCase();
    const hit  = confirmed.get(memo);
    if (!hit) continue;
    if (hit.tonAmount < req.fromAmount * 0.99) continue;

    batch.update(db.collection('battle_players').doc(req.uid), {
      gold: admin.firestore.FieldValue.increment(Math.floor(req.toAmount)),
    });
    batch.update(reqDoc.ref, {
      status: 'completed', txHash: hit.txHash,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const txQuery = await db.collection('transactions').where('swapId', '==', reqDoc.id).limit(1).get();
    txQuery.forEach(d => batch.update(d.ref, { status: 'completed', txHash: hit.txHash }));
    processed++;
  }

  if (processed > 0) await batch.commit();
}

// ─────────────────────────────────────────────────
// 게임코인 → TON: 자동 TON 송금
// ─────────────────────────────────────────────────
async function processPendingCoinToTonSwaps() {
  const snap = await db.collection('swap_requests')
    .where('pair',      '==', 'ton_gamecoin')
    .where('direction', '==', 'coin_to_ton')
    .where('status',    '==', 'pending')
    .orderBy('createdAt', 'asc')
    .limit(10).get();
  if (snap.empty) return;

  for (const reqDoc of snap.docs) {
    const req = reqDoc.data();
    if (req.processingAt) continue;
    await reqDoc.ref.update({ processingAt: admin.firestore.FieldValue.serverTimestamp() });

    try {
      await sendTon(req.tonAddress, req.toAmount, `swap_${reqDoc.id}`);
      const batch = db.batch();
      batch.update(reqDoc.ref, {
        status: 'completed',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processingAt: admin.firestore.FieldValue.delete(),
      });
      const txQ = await db.collection('transactions').where('swapId', '==', reqDoc.id).limit(1).get();
      txQ.forEach(d => batch.update(d.ref, { status: 'completed' }));
      await batch.commit();
    } catch (err) {
      await reqDoc.ref.update({
        processingAt: admin.firestore.FieldValue.delete(),
        lastError: err.message,
        retryCount: admin.firestore.FieldValue.increment(1),
      });
    }

    await new Promise(r => setTimeout(r, 2000));
  }
}

// ─────────────────────────────────────────────────
// 통합 스케줄러 진입점
// ─────────────────────────────────────────────────
async function processTonSwaps() {
  await Promise.allSettled([
    processPendingTonDeposits(),
    processPendingCoinToTonSwaps(),
  ]);
}

async function getPlatformTonInfo() {
  const balance = await getPlatformTonBalance();
  return { balance };
}

module.exports = { processTonSwaps, getPlatformTonInfo, sendTon };
