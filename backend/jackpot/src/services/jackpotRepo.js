import { db, Timestamp } from "../db/firestore.js";
import { config } from "../config.js";
import { fromWei, toWei, lower } from "../utils/units.js";

// ── 인메모리 캐시 ──────────────────────────────────────
const _cache = new Map();
function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value, ttlMs) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
function cacheInvalidate(key) { _cache.delete(key); }

// listener block은 메모리에 유지 + 주기적으로 Firestore에만 flush
let _listenerBlockMem = null;
let _listenerBlockDirty = false;

function asDateIso(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return new Date(ts).toISOString();
}

function asBigInt(v, fallback = 0n) {
  if (v === undefined || v === null || v === "") return fallback;
  return BigInt(v);
}

const coll = {
  config: db.collection("jackpot_config"),
  users: db.collection("users"),
  payments: db.collection("payments"),
  rounds: db.collection("jackpot_rounds"),
  wallets: db.collection("jackpot_wallets"),
  claims: db.collection("jackpot_claims"),
  listener: db.collection("listener_state"),
  whitelist: db.collection("merchant_whitelist"),
  rateLimits: db.collection("payment_rate_limits"),
};

export async function getConfig() {
  const cached = cacheGet("config");
  if (cached) return cached;

  const snap = await coll.config.doc("default").get();
  const row = snap.exists ? snap.data() : {};

  const result = {
    enabled: row.enabled ?? config.defaults.enabled,
    payoutScale: asBigInt(row.payoutScale, config.defaults.payoutScale),
    maxWinPercent: Number(row.maxWinPercent ?? config.defaults.maxWinPercent),
    minPaymentWei: asBigInt(row.minPaymentWei, toWei(config.defaults.minPaymentHex)),
    minClaimWei: asBigInt(row.minClaimWei, toWei(config.defaults.minClaimHex)),
    dailyMaxPayoutWei: asBigInt(row.dailyMaxPayoutWei, toWei(config.defaults.dailyMaxPayoutHex)),
  };
  cacheSet("config", result, 60_000); // 60초 캐시
  return result;
}

export async function setConfig(fields) {
  const update = {};
  if (fields.payoutScale !== undefined) update.payoutScale = String(BigInt(fields.payoutScale));
  if (fields.maxWinPercent !== undefined) update.maxWinPercent = Number(fields.maxWinPercent);
  if (fields.enabled !== undefined) update.enabled = Boolean(fields.enabled);
  if (Object.keys(update).length === 0) throw new Error("NO_FIELDS");
  await db.collection("jackpot_config").doc("default").set(update, { merge: true });
  cacheInvalidate("config"); // 변경 즉시 캐시 무효화
}

export async function txExists(txHash) {
  const snap = await coll.payments.doc(txHash).get();
  return snap.exists;
}

export async function isWhitelistedMerchant(merchantId) {
  const key = `whitelist:${merchantId}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached.active;

  const snap = await coll.whitelist.doc(String(merchantId)).get();
  const result = { active: snap.exists && Boolean(snap.data()?.active), wallet: snap.exists ? (snap.data()?.merchantWallet || null) : null };
  cacheSet(key, result, 300_000); // 5분 캐시
  return result.active;
}

export async function getMerchantWallet(merchantId) {
  const key = `whitelist:${merchantId}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached.wallet ? lower(cached.wallet) : null;

  const snap = await coll.whitelist.doc(String(merchantId)).get();
  const result = { active: snap.exists && Boolean(snap.data()?.active), wallet: snap.exists ? (snap.data()?.merchantWallet || null) : null };
  cacheSet(key, result, 300_000); // 5분 캐시
  return result.wallet ? lower(result.wallet) : null;
}

export async function checkRepeatLimit({ userAddress, limitCount }) {
  const cutoff = Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000));
  const qs = await coll.rateLimits
    .where("userAddress", "==", lower(userAddress))
    .where("createdAt", ">=", cutoff)
    .count()
    .get();

  const cnt = qs.data().count || 0;
  return cnt < limitCount;
}

export async function getDailyPayoutWei() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const snaps = await coll.claims
    .where("status", "in", ["approved", "paid"])
    .where("approvedAt", ">=", Timestamp.fromDate(start))
    .get();

  let total = 0n;
  snaps.forEach((doc) => {
    const data = doc.data();
    total += asBigInt(data.approvedWei, 0n);
  });
  return total;
}

export async function recordRound(payload) {
  const userAddress = lower(payload.userAddress);

  await db.runTransaction(async (tx) => {
    const paymentRef = coll.payments.doc(payload.txHash);
    const paymentSnap = await tx.get(paymentRef);
    if (paymentSnap.exists) return;

    const userRef = coll.users.doc(userAddress);
    tx.set(
      userRef,
      {
        walletAddress: userAddress,
        status: "active",
        createdAt: Timestamp.now(),
      },
      { merge: true },
    );

    tx.set(paymentRef, {
      txHash: payload.txHash,
      userAddress,
      merchantId: payload.merchantId,
      amountHexWei: payload.paymentAmountWei.toString(),
      feeHexWei: payload.feeAmountWei.toString(),
      blockNumber: payload.blockNumber,
      paidAt: Timestamp.fromDate(new Date(payload.paidAt)),
      processed: true,
      createdAt: Timestamp.now(),
    });

    tx.set(coll.rateLimits.doc(payload.txHash), {
      txHash: payload.txHash,
      userAddress,
      merchantId: payload.merchantId,
      createdAt: Timestamp.now(),
    });

    tx.set(coll.rounds.doc(payload.txHash), {
      paymentId: payload.txHash,
      txHash: payload.txHash,
      userAddress,
      merchantId: payload.merchantId,
      paymentAmountWei: payload.paymentAmountWei.toString(),
      contractBalanceWei: payload.contractBalanceWei.toString(),
      jackpotDisplayWei: payload.jackpotDisplayWei.toString(),
      randomValue: payload.randomValue,
      rawWinWei: payload.rawWinWei.toString(),
      maxWinWei: payload.maxWinWei.toString(),
      finalWinWei: payload.finalWinWei.toString(),
      finalWinSort: Number(fromWei(payload.finalWinWei.toString())),
      isWinner: payload.finalWinWei > 0n,
      createdAt: Timestamp.now(),
    });

    const walletRef = coll.wallets.doc(userAddress);
    const walletSnap = await tx.get(walletRef);
    const prev = walletSnap.exists
      ? walletSnap.data()
      : { totalWonWei: "0", totalClaimedWei: "0", claimableWei: "0" };

    const prevWon = asBigInt(prev.totalWonWei, 0n);
    const prevClaimed = asBigInt(prev.totalClaimedWei, 0n);
    const prevClaimable = asBigInt(prev.claimableWei, 0n);

    const nextWon = prevWon + payload.finalWinWei;
    const nextClaimable = prevClaimable + payload.finalWinWei;

    tx.set(walletRef, {
      userAddress,
      totalWonWei: nextWon.toString(),
      totalClaimedWei: prevClaimed.toString(),
      claimableWei: nextClaimable.toString(),
      updatedAt: Timestamp.now(),
    });
  });
}

export async function getWallet(userAddress) {
  const key = lower(userAddress);
  const snap = await coll.wallets.doc(key).get();
  const row = snap.exists
    ? snap.data()
    : {
        userAddress: key,
        totalWonWei: "0",
        totalClaimedWei: "0",
        claimableWei: "0",
        updatedAt: Timestamp.now(),
      };

  const totalWonWei = asBigInt(row.totalWonWei, 0n);
  const totalClaimedWei = asBigInt(row.totalClaimedWei, 0n);
  const claimableWei = asBigInt(row.claimableWei, 0n);

  return {
    userAddress: row.userAddress || key,
    totalWonWei,
    totalClaimedWei,
    claimableWei,
    totalWonHex: fromWei(totalWonWei),
    totalClaimedHex: fromWei(totalClaimedWei),
    claimableHex: fromWei(claimableWei),
    updatedAt: asDateIso(row.updatedAt),
  };
}

export async function getHistory(userAddress, limit = 50) {
  const snaps = await coll.rounds
    .where("userAddress", "==", lower(userAddress))
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const out = [];
  snaps.forEach((doc) => {
    const r = doc.data();
    out.push({
      id: doc.id,
      txHash: r.txHash,
      merchantId: r.merchantId,
      paymentHex: fromWei(r.paymentAmountWei || "0"),
      randomValue: r.randomValue,
      rawWinHex: fromWei(r.rawWinWei || "0"),
      finalWinHex: fromWei(r.finalWinWei || "0"),
      isWinner: Boolean(r.isWinner),
      createdAt: asDateIso(r.createdAt),
    });
  });
  return out;
}

export async function createWithdrawRequest({ userAddress, requestedWei }) {
  const walletKey = lower(userAddress);
  const claimRef = coll.claims.doc();

  await db.runTransaction(async (tx) => {
    const walletRef = coll.wallets.doc(walletKey);
    const walletSnap = await tx.get(walletRef);
    const wallet = walletSnap.exists ? walletSnap.data() : { claimableWei: "0" };

    if (asBigInt(wallet.claimableWei, 0n) < requestedWei) {
      throw new Error("INSUFFICIENT_CLAIMABLE");
    }

    tx.set(claimRef, {
      userAddress: walletKey,
      requestedWei: requestedWei.toString(),
      approvedWei: "0",
      txHash: null,
      status: "requested",
      requestedAt: Timestamp.now(),
      approvedAt: null,
      createdAt: Timestamp.now(),
    });
  });

  const snap = await claimRef.get();
  const data = snap.data();
  return {
    id: claimRef.id,
    status: data?.status || "requested",
    requestedAt: asDateIso(data?.requestedAt),
  };
}

export async function markClaimPaid({ claimId, txHash, approvedWei }) {
  const claimRef = coll.claims.doc(String(claimId));

  await db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists) throw new Error("CLAIM_NOT_FOUND");

    const claim = claimSnap.data();
    if (!["requested", "approved"].includes(claim.status)) {
      throw new Error("INVALID_CLAIM_STATUS");
    }

    const walletRef = coll.wallets.doc(claim.userAddress);
    const walletSnap = await tx.get(walletRef);
    const wallet = walletSnap.exists
      ? walletSnap.data()
      : { totalWonWei: "0", totalClaimedWei: "0", claimableWei: "0" };

    const prevClaimable = asBigInt(wallet.claimableWei, 0n);
    if (prevClaimable < approvedWei) {
      throw new Error("INSUFFICIENT_CLAIMABLE");
    }

    const prevClaimed = asBigInt(wallet.totalClaimedWei, 0n);

    tx.update(claimRef, {
      status: "paid",
      approvedWei: approvedWei.toString(),
      txHash,
      approvedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    tx.set(
      walletRef,
      {
        userAddress: claim.userAddress,
        totalWonWei: (wallet.totalWonWei || "0").toString(),
        claimableWei: (prevClaimable - approvedWei).toString(),
        totalClaimedWei: (prevClaimed + approvedWei).toString(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  });
}

let _listenerFlushCount = 0;
const LISTENER_FLUSH_EVERY = 5; // 5번에 1번만 Firestore 쓰기

export async function setListenerBlock(blockNumber) {
  _listenerBlockMem = Number(blockNumber);
  _listenerBlockDirty = true;
  _listenerFlushCount++;
  if (_listenerFlushCount >= LISTENER_FLUSH_EVERY) {
    _listenerFlushCount = 0;
    await coll.listener.doc("main").set(
      { lastScannedBlock: _listenerBlockMem, updatedAt: Timestamp.now() },
      { merge: true },
    );
    _listenerBlockDirty = false;
  }
}

export async function getListenerBlock() {
  if (_listenerBlockMem !== null) return _listenerBlockMem;
  const snap = await coll.listener.doc("main").get();
  _listenerBlockMem = snap.exists ? Number(snap.data()?.lastScannedBlock || 0) : 0;
  return _listenerBlockMem;
}

export async function getClaimById(claimId) {
  const snap = await coll.claims.doc(String(claimId)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function markClaimRejected(claimId) {
  const claimRef = coll.claims.doc(String(claimId));
  const snap = await claimRef.get();
  if (!snap.exists) throw new Error("CLAIM_NOT_FOUND");

  await claimRef.update({
    status: "rejected",
    approvedAt: Timestamp.now(),
    txHash: null,
    updatedAt: Timestamp.now(),
  });
}

export async function getPublicStats() {
  const winnerAgg = await coll.rounds.where("isWinner", "==", true).count().get();
  const winnerCount = Number(winnerAgg.data().count || 0);

  const highestSnap = await coll.rounds.orderBy("finalWinSort", "desc").limit(1).get();
  let highestWinWei = 0n;
  if (!highestSnap.empty) {
    highestWinWei = asBigInt(highestSnap.docs[0].data()?.finalWinWei, 0n);
  }

  const lastRoundSnap = await coll.rounds.orderBy("createdAt", "desc").limit(1).get();
  const lastRoundAt = lastRoundSnap.empty
    ? new Date().toISOString()
    : asDateIso(lastRoundSnap.docs[0].data()?.createdAt);

  return {
    winnerCount,
    highestWinWei,
    lastRoundAt,
  };
}
