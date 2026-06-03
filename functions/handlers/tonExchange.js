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
const WITHDRAW_FEE_RATE   = 0.03;          // 출금 수수료 3%
const MAX_DAILY_WITHDRAW  = 1_000_000;    // 1일 최대 출금 1,000,000 GP
const TONCENTER_BASE      = 'https://toncenter.com/api/v2';
const ADMIN_WALLET = 'UQBLkDA_wtlLMP8m5k-XD5O6XumB9v5mzdowMR8c0A8S9edJ';

let _tonCache = { usd: 0, ts: 0 };

// ── TonCenter URL 빌더 (API키 자동 첨부) ──────────────────────────────────────
function tcUrl(path) {
  const key = process.env.TON_CENTER_API_KEY || '';
  return `${TONCENTER_BASE}${path}${path.includes('?') ? '&' : '?'}${key ? 'api_key=' + key : '_=1'}`;
}

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

// ── TON 실시간 가격 (Binance → OKX → Bybit → CoinGecko, 60초 캐시) ──────────
async function getTonUsdPrice() {
  const now = Date.now();
  if (_tonCache.usd > 0 && now - _tonCache.ts < TON_CACHE_TTL) return _tonCache.usd;

  const apis = [
    { name: 'Binance', fn: async () => {
      const d = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT');
      return parseFloat(d?.price);
    }},
    { name: 'OKX', fn: async () => {
      const d = await fetchJson('https://www.okx.com/api/v5/market/ticker?instId=TON-USDT');
      return parseFloat(d?.data?.[0]?.last);
    }},
    { name: 'Bybit', fn: async () => {
      const d = await fetchJson('https://api.bybit.com/v5/market/tickers?category=spot&symbol=TONUSDT');
      return parseFloat(d?.result?.list?.[0]?.lastPrice);
    }},
    { name: 'CoinGecko', fn: async () => {
      const d = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
      return d?.['the-open-network']?.usd;
    }},
  ];

  for (const api of apis) {
    try {
      const p = await api.fn();
      if (p > 0) { _tonCache = { usd: p, ts: now }; return p; }
    } catch (e) { console.warn(`[ton] ${api.name} 실패:`, e.message); }
  }

  if (_tonCache.usd > 0) return _tonCache.usd;
  throw new Error('TON 시세 조회 실패 — 잠시 후 다시 시도해 주세요');
}

// ── 가격 + 교환비 + 관리자 지갑 반환 ─────────────────────────────────────────
async function getPrice() {
  const usd = await getTonUsdPrice();
  return {
    tonUsd:          usd,
    coinPerTon:      Math.floor(usd * COIN_PER_USD),
    coinPerUsd:      COIN_PER_USD,
    minWithdrawGp:   MIN_WITHDRAW_GP,
    adminWallet:     ADMIN_WALLET,
    updatedAt:       new Date().toISOString(),
  };
}

// ── 관리자 TON 지갑 주소 ──────────────────────────────────────────────────────
function getAdminWallet() {
  return ADMIN_WALLET;
}

// ── TonCenter: TX 조회 ────────────────────────────────────────────────────────
async function fetchTxByHash(txHash) {
  try {
    const d = await fetchJson(tcUrl(`/getTransactions?hash=${encodeURIComponent(txHash)}&limit=1&archival=false`));
    if (d?.ok && d.result?.length > 0) return d.result[0];
  } catch (e) { console.warn('[ton] TX 조회 실패:', e.message); }
  return null;
}

// ── 개인키에서 KeyPair 추출 ────────────────────────────────────────────────────
function keyPairFromPrivateKey(hexKey) {
  const buf = Buffer.from(hexKey.trim().replace(/^0x/, ''), 'hex');
  if (buf.length === 64) {
    // TweetNaCl 형식: secretKey(32) + publicKey(32)
    return { secretKey: buf, publicKey: buf.slice(32) };
  }
  if (buf.length === 32) {
    // seed만 있는 경우 → TweetNaCl로 공개키 생성
    const nacl = require('tweetnacl');
    const kp = nacl.sign.keyPair.fromSeed(buf);
    return { secretKey: Buffer.from(kp.secretKey), publicKey: Buffer.from(kp.publicKey) };
  }
  throw new Error('개인키 형식 오류 (32 또는 64 바이트 hex 필요)');
}

// ── 자동 TON 송금 (@ton/ton SDK) ──────────────────────────────────────────────
async function sendTonAutomatic(toAddress, tonAmount) {
  const {
    TonClient, WalletContractV5R1, WalletContractV4,
    WalletContractV3R2, internal, toNano,
  } = require('@ton/ton');

  const privKeyHex = process.env.TON_PRIVATE_KEY;
  if (!privKeyHex) throw new Error('TON_PRIVATE_KEY 시크릿이 설정되지 않았습니다');

  const keyPair = keyPairFromPrivateKey(privKeyHex);
  const apiKey  = process.env.TON_CENTER_API_KEY || '';
  const client  = new TonClient({ endpoint: `${TONCENTER_BASE}/jsonRPC`, apiKey: apiKey || undefined });

  // 지갑 버전 자동 감지: V5R1(W5) → V4 → V3R2
  const adminWallet = getAdminWallet();
  const normAdmin   = normalizeTonAddr(adminWallet);
  const versions = [
    () => WalletContractV5R1.create({ publicKey: keyPair.publicKey, workchain: 0 }),
    () => WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }),
    () => WalletContractV3R2.create({ publicKey: keyPair.publicKey, workchain: 0 }),
  ];

  let wallet   = null;
  let contract = null;
  for (const create of versions) {
    const w = create();
    if (normalizeTonAddr(w.address.toString()) === normAdmin) {
      wallet = w; contract = client.open(w); break;
    }
  }
  if (!contract) throw new Error('개인키가 관리자 지갑 주소와 일치하지 않습니다');

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
      tcUrl(`/getTransactions?address=${wallet.address.toString()}&limit=5&archival=false`)
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

  const adminWallet = getAdminWallet();
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
// TON 송금은 tonPayment.sendTon 사용 (TON_WALLET_MNEMONIC + TON_CENTER_API_KEY 환경변수 필요)
async function requestWithdraw(gamecoin, walletAddress, uid) {
  if (!Number.isInteger(gamecoin) || gamecoin < MIN_WITHDRAW_GP) {
    throw new Error(`최소 출금은 ${MIN_WITHDRAW_GP.toLocaleString()} GP 입니다`);
  }
  if (!walletAddress?.trim() || walletAddress.trim().length < 30) {
    throw new Error('올바른 TON 지갑 주소를 입력해 주세요');
  }
  if (!process.env.TON_PRIVATE_KEY) throw new Error('TON_PRIVATE_KEY 시크릿이 설정되지 않았습니다');

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

  // 환율 계산 (수수료 3% 차감 후 TON 환산)
  const tonUsd   = await getTonUsdPrice();
  const feeGp    = Math.floor(gamecoin * WITHDRAW_FEE_RATE);
  const netGp    = gamecoin - feeGp;
  const tonAmount = netGp / (tonUsd * COIN_PER_USD);
  if (tonAmount < 0.001) throw new Error('출금 TON 수량이 너무 적습니다 (최소 0.001 TON)');

  // GP 선차감 (processing 상태)
  const txRef = db.collection('ton_transactions').doc();
  const batch = db.batch();
  batch.set(txRef, {
    uid, walletAddress, gamecoin, feeGp, netGp, tonAmount, usdRate: tonUsd,
    type: 'withdraw', status: 'processing',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(db.collection('battle_players').doc(uid), {
    gold: admin.firestore.FieldValue.increment(-gamecoin),
  });
  await batch.commit();

  // 자동 TON 송금 (개인키 방식)
  let txHash = null;
  try {
    txHash = await sendTonAutomatic(walletAddress.trim(), tonAmount);
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

  return { id: txRef.id, gamecoin, feeGp, netGp, tonAmount, usdRate: tonUsd, txHash, status: 'confirmed' };
}

// ── TON 주소 정규화 (raw 0:hex ↔ user-friendly EQ/UQ... 모두 64자 hex로 변환) ──
function normalizeTonAddr(addr) {
  if (!addr) return '';
  addr = addr.trim();
  const rawMatch = addr.match(/^-?\d+:([0-9a-fA-F]+)$/i);
  if (rawMatch) return rawMatch[1].toLowerCase().padStart(64, '0');
  try {
    const buf = Buffer.from(addr.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buf.length >= 34) return buf.slice(2, 34).toString('hex').toLowerCase();
  } catch {}
  return addr.toLowerCase();
}

// ── TonConnect 전송 후 자동 TX 탐색 → GameCoin 지급 ─────────────────────────
// senderAddress: TonConnect wallet.account.address (raw format)
// tonNano: 전송 나노톤 (정수)
// sentAtMs: 클라이언트 Date.now() 전송 직전 시각
// ── 관리자 지갑 수신 목록에서 발신자 TX 탐색 ──────────────────────────────────
async function _findTxFromAdmin(adminWallet, normSender, afterTs, tonNano) {
  try {
    const d = await fetchJson(
      tcUrl(`/getTransactions?address=${encodeURIComponent(adminWallet)}&limit=20&archival=false`)
    );
    if (!d?.ok || !Array.isArray(d.result)) return null;
    for (const tx of d.result) {
      if (tx.utime < afterTs) break;
      const src = tx.in_msg?.source;
      if (!src) continue;
      if (normalizeTonAddr(src) !== normSender) continue;
      const nano = parseInt(tx.in_msg?.value || '0', 10);
      if (nano <= 0) continue;
      // 금액 검증: 요청 금액의 ±15% 이내만 허용
      if (tonNano > 0 && Math.abs(nano - tonNano) / tonNano > 0.15) continue;
      return { txHash: tx.transaction_id?.hash, tonAmount: nano / 1e9 };
    }
  } catch {}
  return null;
}

// ── 발신자 지갑 송신 목록에서 관리자 지갑 행 TX 탐색 (폴백) ───────────────────
async function _findTxFromSender(senderAddress, normAdmin, afterTs, tonNano) {
  try {
    const d = await fetchJson(
      tcUrl(`/getTransactions?address=${encodeURIComponent(senderAddress)}&limit=20&archival=false`)
    );
    if (!d?.ok || !Array.isArray(d.result)) return null;
    for (const tx of d.result) {
      if (tx.utime < afterTs) break;
      for (const msg of tx.out_msgs || []) {
        if (normalizeTonAddr(msg.destination || '') !== normAdmin) continue;
        const nano = parseInt(msg.value || '0', 10);
        if (nano <= 0) continue;
        // 금액 검증: 요청 금액의 ±15% 이내만 허용
        if (tonNano > 0 && Math.abs(nano - tonNano) / tonNano > 0.15) continue;
        return { txHash: tx.transaction_id?.hash, tonAmount: nano / 1e9 };
      }
    }
  } catch {}
  return null;
}

async function verifyDepositAuto(senderAddress, tonNano, sentAtMs, uid) {
  if (!senderAddress) throw new Error('senderAddress가 누락됐습니다');

  const adminWallet = getAdminWallet();
  const normSender  = normalizeTonAddr(senderAddress);
  const normAdmin   = normalizeTonAddr(adminWallet);
  const afterTs     = Math.floor(sentAtMs / 1000) - 300;

  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 5000));

    // 1차: 관리자 지갑 수신 목록 조회
    let found = await _findTxFromAdmin(adminWallet, normSender, afterTs, tonNano);

    // 2차 폴백: 발신자 지갑 송신 목록 조회
    if (!found) {
      found = await _findTxFromSender(senderAddress, normAdmin, afterTs, tonNano);
    }

    if (!found?.txHash) continue;

    // 중복 방지
    const dup = await db.collection('ton_transactions')
      .where('txHash', '==', found.txHash).limit(1).get();
    if (!dup.empty && dup.docs[0].data().status === 'confirmed') {
      throw new Error('이미 처리된 트랜잭션입니다');
    }

    // GameCoin 계산 및 지급
    const tonUsd   = await getTonUsdPrice();
    const gamecoin = Math.floor(found.tonAmount * tonUsd * COIN_PER_USD);
    if (gamecoin < 1) throw new Error('환산 GameCoin이 너무 적습니다');

    const batch = db.batch();
    batch.set(db.collection('ton_transactions').doc(), {
      uid, txHash: found.txHash, tonAmount: found.tonAmount,
      usdRate: tonUsd, gamecoin, type: 'deposit', status: 'confirmed',
      senderAddress, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(db.collection('battle_players').doc(uid), {
      gold: admin.firestore.FieldValue.increment(gamecoin),
    });
    await batch.commit();

    return { txHash: found.txHash, tonAmount: found.tonAmount, gamecoin, usdRate: tonUsd };
  }

  throw new Error('트랜잭션을 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.');
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

// ── 외부 호출용 TON 송금 래퍼 (exchange.js에서 사용) ─────────────────────────
async function sendTonOut(toAddress, tonAmount) {
  return await sendTonAutomatic(toAddress, tonAmount);
}

// ── 외부 호출용 TON TX 탐색 (exchange.js ton_to_hex에서 사용) ────────────────
async function findTonTx(senderAddress, tonNano, sentAtMs) {
  const adminWallet = getAdminWallet();
  const normSender  = normalizeTonAddr(senderAddress);
  const normAdmin   = normalizeTonAddr(adminWallet);
  const afterTs     = Math.floor(sentAtMs / 1000) - 300;

  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 5000));
    let found = await _findTxFromAdmin(adminWallet, normSender, afterTs, tonNano);
    if (!found) found = await _findTxFromSender(senderAddress, normAdmin, afterTs, tonNano);
    if (found?.txHash) return found;
  }
  return null;
}

module.exports = { getPrice, getTonUsdPrice, verifyDeposit, verifyDepositAuto, requestWithdraw, getMyTransactions, sendTonOut, findTonTx };
