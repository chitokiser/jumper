// functions/handlers/buggy.js
'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { decrypt } = require('../wallet/crypto');
const {
  getProvider, getHexContract, walletFromKey,
  getAdminWallet, estimateGasWithBuffer,
} = require('../wallet/chain');
const { requireAdmin } = require('../wallet/admin');

const db         = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const DEFAULT_CONFIG = {
  baseFare: 50000, intervalMinutes: 10, intervalFare: 50000,
  minHexUsd: 0.002, searchRadiusKm: 10, driverTimeoutSeconds: 120,
  driverSharePct: 80,
};

async function getConfig() {
  try {
    const snap = await db.collection('buggy_config').doc('default').get();
    return snap.exists ? { ...DEFAULT_CONFIG, ...snap.data() } : { ...DEFAULT_CONFIG };
  } catch (_) { return { ...DEFAULT_CONFIG }; }
}

function calcFare(startMs, endMs, cfg) {
  const minutes   = Math.max(0, (endMs - startMs) / 60000);
  const intervals = Math.max(1, Math.ceil(minutes / cfg.intervalMinutes));
  return { minutes: Math.ceil(minutes), fare: intervals * cfg.intervalFare };
}

let _fxCache = { usdVnd: 0, ts: 0 };
const FX_TTL = 600_000;

async function fetchRates() {
  if (_fxCache.usdVnd > 0 && Date.now() - _fxCache.ts < FX_TTL) return _fxCache;
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    _fxCache = { usdVnd: data?.rates?.VND ?? 25000, ts: Date.now() };
  } catch {
    _fxCache = { usdVnd: _fxCache.usdVnd || 25000, ts: Date.now() };
  }
  return _fxCache;
}

function vndToHexWei(vndAmount, usdVnd) {
  const usdAmt = vndAmount / usdVnd;
  const weiBig = BigInt(Math.round(usdAmt * 1e12)) * BigInt(1_000_000);
  return weiBig;
}

async function getUserWallet(uid) {
  const snap = await db.collection('users').doc(uid).get();
  const wallet = snap.data()?.wallet;
  if (!wallet?.address || !wallet?.encryptedKey) {
    throw new Error('수탁 지갑이 없습니다. 지갑을 먼저 생성해주세요.');
  }
  return wallet;
}

async function checkHexBalance(address, requiredVnd, usdVnd) {
  const provider = getProvider();
  const hexRead  = getHexContract(provider);
  const hexBal   = await hexRead.balanceOf(address);
  const reqWei   = vndToHexWei(requiredVnd, usdVnd);
  if (hexBal < reqWei) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    const need = parseFloat(ethers.formatEther(reqWei)).toFixed(4);
    throw new Error(`HEX 잔액 부족. 최소 ${need} HEX 필요 (현재 ${have} HEX)`);
  }
  return hexBal;
}

async function payWithHex(wallet, fareVnd, usdVnd, masterSecret) {
  const hexWei      = vndToHexWei(fareVnd, usdVnd);
  const provider    = getProvider();
  const adminWallet = getAdminWallet();
  const hexRead     = getHexContract(provider);

  const hexBal = await hexRead.balanceOf(wallet.address);
  if (hexBal < hexWei) {
    const partialWei = hexBal;
    if (partialWei === 0n) return { hexWei, actualHexWei: 0n, txHash: null, partial: true };
    const bnbBal = await provider.getBalance(wallet.address);
    if (bnbBal < ethers.parseEther('0.00005')) {
      const fundTx = await adminWallet.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.0001') });
      await fundTx.wait();
    }
    const privateKey = decrypt(wallet.encryptedKey, masterSecret);
    const signer     = walletFromKey(privateKey, provider);
    const hexSigned  = getHexContract(signer);
    const gasLimit   = await estimateGasWithBuffer(hexSigned, 'transfer', [adminWallet.address, partialWei]);
    const tx         = await hexSigned.transfer(adminWallet.address, partialWei, { gasLimit });
    const receipt    = await tx.wait();
    return { hexWei, actualHexWei: partialWei, txHash: receipt.hash, partial: true };
  }

  const bnbBal = await provider.getBalance(wallet.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.0001') });
    await fundTx.wait();
  }
  const privateKey = decrypt(wallet.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const hexSigned  = getHexContract(signer);
  const gasLimit   = await estimateGasWithBuffer(hexSigned, 'transfer', [adminWallet.address, hexWei]);
  const tx         = await hexSigned.transfer(adminWallet.address, hexWei, { gasLimit });
  const receipt    = await tx.wait();
  return { hexWei, actualHexWei: hexWei, txHash: receipt.hash, partial: false };
}

// ── 감사 로그 ────────────────────────────────────────────────────
async function writeAuditLog({ rideId, action, actorType, actorId, beforeStatus, afterStatus, payload }) {
  try {
    await db.collection('ride_audit_logs').add({
      rideId, action, actorType, actorId,
      beforeStatus, afterStatus,
      payloadJson: JSON.stringify(payload || {}),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (_) {}
}

// ── 결제 시도 로그 ───────────────────────────────────────────────
async function writePaymentLog({ rideId, userId, attemptedAmount, walletAddress, walletBalanceWei, result, errorCode, errorMessage, attemptedBy }) {
  try {
    await db.collection('payment_attempt_logs').add({
      rideId, userId,
      attemptedAmount,
      walletAddress,
      walletBalanceSnapshot: walletBalanceWei?.toString() || '0',
      walletType: 'hex_onchain',
      result,
      errorCode:    errorCode    || null,
      errorMessage: errorMessage || null,
      attemptedBy,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (_) {}
}

// ── 공통 운행 종료 + 결제 처리 ──────────────────────────────────
async function processRideEnd(rideId, endedBy, endedByActorId, masterSecret) {
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists) throw new Error('라이드를 찾을 수 없습니다');
  const ride = snap.data();

  if (ride.status !== 'riding') throw new Error('운행 중 상태가 아닙니다');

  const cfg     = await getConfig();
  const startMs = ride.startedAt?.toMillis() || Date.now();
  const { minutes, fare } = calcFare(startMs, Date.now(), cfg);
  const rates   = await fetchRates();

  // 사용자 지갑 조회
  let wallet, hexBalWei;
  let payResult = null;
  let payError  = null;

  try {
    wallet     = await getUserWallet(ride.userId);
    const provider = getProvider();
    const hexRead  = getHexContract(provider);
    hexBalWei  = await hexRead.balanceOf(wallet.address);
    payResult  = await payWithHex(wallet, fare, rates.usdVnd, masterSecret);
  } catch (err) {
    payError = err;
  }

  const hexAmount    = payResult ? parseFloat(ethers.formatEther(payResult.hexWei)).toFixed(6)       : '0';
  const actualAmount = payResult ? parseFloat(ethers.formatEther(payResult.actualHexWei)).toFixed(6) : '0';
  const txHash       = payResult?.txHash || null;
  const partial      = payResult?.partial ?? true;
  const paid         = payResult && !partial;

  // 결제 시도 로그
  await writePaymentLog({
    rideId,
    userId: ride.userId,
    attemptedAmount: fare,
    walletAddress: wallet?.address || null,
    walletBalanceWei: hexBalWei,
    result: paid ? 'success' : (payError ? 'error' : 'partial'),
    errorCode:    payError?.code    || null,
    errorMessage: payError?.message || null,
    attemptedBy: endedBy,
  });

  const batch = db.batch();
  const txRef = db.collection('buggy_transactions').doc();

  const rideUpdate = {
    endedAt:         FieldValue.serverTimestamp(),
    durationMinutes: minutes,
    feeVnd:          fare,
    feeHex:          hexAmount,
    txHash,
    endedBy,
    endedByActorId,
    updatedAt:       FieldValue.serverTimestamp(),
  };

  if (paid) {
    rideUpdate.status        = 'completed';
    rideUpdate.paymentStatus = 'paid';
    rideUpdate.paymentTxId   = txRef.id;
    batch.set(txRef, {
      userId: ride.userId, rideId, type: 'ride_charge',
      feeVnd: fare, hexRequired: hexAmount, hexCharged: hexAmount,
      txHash, status: 'completed',
      description: `버기카 ${minutes}분 이용 (${hexAmount} HEX)`,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else if (payResult && partial) {
    rideUpdate.status        = 'completed';
    rideUpdate.paymentStatus = 'partial';
    batch.set(txRef, {
      userId: ride.userId, rideId, type: 'ride_charge',
      feeVnd: fare, hexRequired: hexAmount, hexCharged: actualAmount,
      txHash, status: 'partial',
      description: `버기카 ${minutes}분 — HEX 잔액 부족 (${actualAmount}/${hexAmount} HEX)`,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    // 결제 완전 실패 (지갑 없음, 네트워크 오류 등)
    rideUpdate.status        = 'completed';
    rideUpdate.paymentStatus = 'failed';
    rideUpdate.paymentError  = payError?.message || '결제 오류';
    batch.set(txRef, {
      userId: ride.userId, rideId, type: 'ride_charge',
      feeVnd: fare, hexRequired: hexAmount, hexCharged: '0',
      txHash: null, status: 'failed',
      description: `버기카 ${minutes}분 — 결제 실패: ${payError?.message || '오류'}`,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  batch.update(rideRef, rideUpdate);

  // 기사 매출 기록 (수수료 설정에 따라 차감)
  if (ride.driverId && fare > 0) {
    const sharePct     = (cfg.driverSharePct ?? 80) / 100;
    const driverShare  = Math.round(fare * sharePct);
    const platformFee  = fare - driverShare;
    const earningRef   = db.collection('buggy_driver_earnings').doc();
    batch.set(earningRef, {
      driverId:     ride.driverId,
      rideId,
      grossFare:    fare,
      platformFee,
      driverShare,
      payoutStatus: paid ? 'pending_payout' : 'payment_failed',
      minutesDriven: minutes,
      pickupAddress: ride.pickupAddress || '',
      userMasked:   (ride.userDisplayName || '회원').slice(0, 1) + '**',
      endedAt:      FieldValue.serverTimestamp(),
      createdAt:    FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  // 감사 로그
  await writeAuditLog({
    rideId, action: 'ride_ended',
    actorType: endedBy, actorId: endedByActorId,
    beforeStatus: 'riding', afterStatus: rideUpdate.status,
    payload: { minutes, fare, paymentStatus: rideUpdate.paymentStatus, txHash },
  });

  return {
    success: true, minutes, fare, hexAmount, txHash,
    paymentStatus: rideUpdate.paymentStatus,
    paymentError:  payError?.message || null,
  };
}

// ── 탑승 요청 ─────────────────────────────────────────────────
async function requestRide(uid, { pickupLat, pickupLng, pickupAddress, destLat, destLng, destAddress }) {
  if (!pickupLat || !pickupLng) throw new Error('탑승 위치가 필요합니다');
  const cfg  = await getConfig();
  const rates = await fetchRates();
  const wallet = await getUserWallet(uid);
  await checkHexBalance(wallet.address, cfg.intervalFare, rates.usdVnd);

  const active = await db.collection('buggy_rides')
    .where('userId', '==', uid)
    .where('status', 'in', ['searching', 'accepted', 'arriving', 'riding'])
    .limit(1).get();
  if (!active.empty) throw new Error('이미 진행 중인 호출이 있습니다');

  const userSnap = await db.collection('users').doc(uid).get();
  const rideRef  = db.collection('buggy_rides').doc();

  await rideRef.set({
    userId: uid,
    userDisplayName: userSnap.data()?.displayName || '회원',
    userWallet: wallet.address,
    driverId: null, driverName: null, vehicleNumber: null, vehicleModel: null,
    pickupLat: parseFloat(pickupLat), pickupLng: parseFloat(pickupLng),
    pickupAddress: pickupAddress || '',
    destLat:  destLat  ? parseFloat(destLat)  : null,
    destLng:  destLng  ? parseFloat(destLng)  : null,
    destAddress: destAddress || '',
    status: 'searching',
    requestedAt: FieldValue.serverTimestamp(),
    acceptedAt: null, arrivedAt: null, startedAt: null, endedAt: null,
    durationMinutes: null, feeVnd: null, feeHex: null, txHash: null,
    paymentStatus: 'pending', cancelReason: null,
    endedBy: null, endedByActorId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({ rideId: rideRef.id, action: 'ride_requested', actorType: 'user', actorId: uid, beforeStatus: null, afterStatus: 'searching', payload: { pickupAddress } });
  return { rideId: rideRef.id };
}

// ── 사용자 취소 ───────────────────────────────────────────────
async function cancelRide(uid, { rideId, reason }) {
  if (!rideId) throw new Error('rideId가 필요합니다');
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists) throw new Error('라이드를 찾을 수 없습니다');
  const ride = snap.data();

  const isUser   = ride.userId   === uid;
  const isDriver = ride.driverId === uid;
  let isAdmin = false;
  try { await requireAdmin(uid); isAdmin = true; } catch (_) {}
  if (!isUser && !isDriver && !isAdmin) throw new Error('권한이 없습니다');
  if (['completed','cancelled_by_user','cancelled_by_driver','failed','payment_failed'].includes(ride.status)) throw new Error('이미 종료된 호출입니다');
  if (ride.status === 'riding') throw new Error('탑승 중에는 취소할 수 없습니다');

  const status = isUser ? 'cancelled_by_user' : isDriver ? 'cancelled_by_driver' : 'cancelled_by_user';
  await rideRef.update({ status, cancelReason: reason || '', updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({ rideId, action: 'ride_cancelled', actorType: isAdmin ? 'admin' : isDriver ? 'driver' : 'user', actorId: uid, beforeStatus: ride.status, afterStatus: status, payload: { reason } });
  return { success: true };
}

// ── 기사 수락 ─────────────────────────────────────────────────
async function acceptRide(driverUid, { rideId }) {
  if (!rideId) throw new Error('rideId가 필요합니다');
  const driverSnap = await db.collection('buggy_drivers').doc(driverUid).get();
  if (!driverSnap.exists) throw new Error('기사 등록 정보가 없습니다');
  const driver = driverSnap.data();
  if (!driver.isOnline || !driver.isActive) throw new Error('온라인 상태가 아닙니다');

  const rideRef = db.collection('buggy_rides').doc(rideId);
  await db.runTransaction(async (tx) => {
    const rSnap = await tx.get(rideRef);
    if (!rSnap.exists) throw new Error('라이드를 찾을 수 없습니다');
    if (rSnap.data().status !== 'searching') throw new Error('이미 다른 기사가 수락하였습니다');
    tx.update(rideRef, {
      status: 'accepted', driverId: driverUid,
      driverName: driver.name || '기사', vehicleNumber: driver.vehicleNumber || '',
      vehicleModel: driver.vehicleModel || '',
      acceptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await writeAuditLog({ rideId, action: 'ride_accepted', actorType: 'driver', actorId: driverUid, beforeStatus: 'searching', afterStatus: 'accepted', payload: {} });
  return { success: true };
}

// ── 기사 도착 ─────────────────────────────────────────────────
async function driverArrive(driverUid, { rideId }) {
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists || snap.data().driverId !== driverUid) throw new Error('권한 없음');
  if (!['accepted'].includes(snap.data().status)) throw new Error('잘못된 상태입니다');
  await rideRef.update({ status: 'arriving', arrivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { success: true };
}

// ── 탑승 시작 ─────────────────────────────────────────────────
async function startRide(driverUid, { rideId }) {
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists || snap.data().driverId !== driverUid) throw new Error('권한 없음');
  if (!['accepted', 'arriving'].includes(snap.data().status)) throw new Error('잘못된 상태입니다');
  const ride = snap.data();
  const cfg  = await getConfig();
  const rates = await fetchRates();
  const wallet = await getUserWallet(ride.userId);
  await checkHexBalance(wallet.address, cfg.intervalFare, rates.usdVnd);
  await rideRef.update({ status: 'riding', startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({ rideId, action: 'ride_started', actorType: 'driver', actorId: driverUid, beforeStatus: snap.data().status, afterStatus: 'riding', payload: {} });
  return { success: true };
}

// ── 탑승 종료 (기사) ──────────────────────────────────────────
async function endRide(driverUid, { rideId }, masterSecret) {
  const snap = await db.collection('buggy_rides').doc(rideId).get();
  if (!snap.exists || snap.data().driverId !== driverUid) throw new Error('권한 없음');
  return processRideEnd(rideId, 'driver', driverUid, masterSecret);
}

// ── 기사 위치 전송 ────────────────────────────────────────────
async function updateDriverLocation(driverUid, { lat, lng, heading, speed }) {
  await db.collection('buggy_driver_locations').doc(driverUid).set({
    driverId: driverUid,
    lat: parseFloat(lat) || 0, lng: parseFloat(lng) || 0,
    heading: parseFloat(heading) || 0, speed: parseFloat(speed) || 0,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { success: true };
}

// ── 기사 온라인 상태 ──────────────────────────────────────────
async function setDriverOnline(driverUid, { isOnline }) {
  await db.collection('buggy_drivers').doc(driverUid).update({ isOnline: !!isOnline, updatedAt: FieldValue.serverTimestamp() });
  return { success: true };
}

// ── 기사 매출 조회 ────────────────────────────────────────────
async function getDriverEarnings(driverUid, { period }) {
  // 기간 계산
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let startMs;
  if (period === 'week') {
    startMs = today.getTime() - 6 * 86400000;
  } else if (period === 'month') {
    const m = new Date(today); m.setDate(1);
    startMs = m.getTime();
  } else {
    startMs = today.getTime(); // 'today' 기본값
  }

  // 단일 필드 인덱스만 사용 (복합 인덱스 불필요)
  // orderBy/range filter 제거 → JS에서 필터/정렬
  const snap = await db.collection('buggy_driver_earnings')
    .where('driverId', '==', driverUid)
    .get();

  const all = snap.docs
    .map(d => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt?.toMillis() || 0,
      endedAt:   d.data().endedAt?.toMillis()   || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  const earnings   = all.filter(e => e.createdAt >= startMs);
  const totalGross = earnings.reduce((s, e) => s + (e.grossFare   || 0), 0);
  const totalShare = earnings.reduce((s, e) => s + (e.driverShare || 0), 0);
  const totalRides = earnings.length;
  return { earnings, totalGross, totalShare, totalRides };
}

// ── 관리자: 기사 등록 ─────────────────────────────────────────
async function adminCreateDriver(adminUid, { uid, name, vehicleNumber, vehicleModel }) {
  await requireAdmin(adminUid);
  await db.collection('buggy_drivers').doc(uid).set({
    uid, name: name || '', vehicleNumber: vehicleNumber || '',
    vehicleModel: vehicleModel || '', isOnline: false, isActive: true,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
}

// ── 관리자: 강제 종료 (결제 포함) ────────────────────────────
async function adminForceEnd(adminUid, { rideId, reason }, masterSecret) {
  await requireAdmin(adminUid);
  const snap = await db.collection('buggy_rides').doc(rideId).get();
  if (!snap.exists) throw new Error('라이드를 찾을 수 없습니다');
  if (snap.data().status !== 'riding') throw new Error('운행 중인 라이드만 강제 종료할 수 있습니다');

  // 취소 사유 먼저 기록
  await db.collection('buggy_rides').doc(rideId).update({ cancelReason: reason || '관리자 강제 종료' });

  return processRideEnd(rideId, 'admin', adminUid, masterSecret);
}

// ── 관리자: 설정 저장 ─────────────────────────────────────────
async function adminSaveConfig(adminUid, cfg) {
  await requireAdmin(adminUid);
  await db.collection('buggy_config').doc('default').set({ ...DEFAULT_CONFIG, ...cfg, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true };
}

module.exports = {
  requestRide, cancelRide,
  acceptRide, driverArrive, startRide, endRide,
  updateDriverLocation, setDriverOnline,
  getDriverEarnings,
  adminCreateDriver, adminForceEnd, adminSaveConfig,
  getConfig,
};
