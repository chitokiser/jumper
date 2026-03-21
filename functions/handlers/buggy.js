// functions/handlers/buggy.js
// 오션파크 버기카 호출 서비스 — HEX 토큰 자동 결제

'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { decrypt } = require('../wallet/crypto');
const {
  getProvider,
  getHexContract,
  walletFromKey,
  getAdminWallet,
  estimateGasWithBuffer,
} = require('../wallet/chain');

const { requireAdmin } = require('../wallet/admin');

const db        = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── 기본 설정 ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  baseFare:              50000,   // VND
  intervalMinutes:       10,      // 10분마다
  intervalFare:          50000,   // 추가 요금
  minHexUsd:             0.002,   // 최소 HEX 보유 (USD 기준) — 약 50,000 VND
  searchRadiusKm:        10,
  driverTimeoutSeconds:  120,
};

async function getConfig() {
  try {
    const snap = await db.collection('buggy_config').doc('default').get();
    return snap.exists ? { ...DEFAULT_CONFIG, ...snap.data() } : { ...DEFAULT_CONFIG };
  } catch (_) {
    return { ...DEFAULT_CONFIG };
  }
}

// ── 요금 계산 ─────────────────────────────────────────────────
function calcFare(startMs, endMs, cfg) {
  const minutes   = Math.max(0, (endMs - startMs) / 60000);
  const intervals = Math.max(1, Math.ceil(minutes / cfg.intervalMinutes));
  return { minutes: Math.ceil(minutes), fare: intervals * cfg.intervalFare };
}

// ── 환율 캐시 ─────────────────────────────────────────────────
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

// ── VND → HEX wei (18 decimals, 1 HEX ≒ 1 USD) ─────────────
function vndToHexWei(vndAmount, usdVnd) {
  const usdAmt = vndAmount / usdVnd;               // USD
  const weiBig = BigInt(Math.round(usdAmt * 1e12)) * BigInt(1_000_000);
  return weiBig;
}

// ── 사용자 지갑 조회 ──────────────────────────────────────────
async function getUserWallet(uid) {
  const snap = await db.collection('users').doc(uid).get();
  const wallet = snap.data()?.wallet;
  if (!wallet?.address || !wallet?.encryptedKey) {
    throw new Error('수탁 지갑이 없습니다. 지갑을 먼저 생성해주세요.');
  }
  return wallet;
}

// ── HEX 잔액 확인 ─────────────────────────────────────────────
async function checkHexBalance(address, requiredVnd, usdVnd) {
  const provider  = getProvider();
  const hexRead   = getHexContract(provider);
  const hexBal    = await hexRead.balanceOf(address);
  const reqWei    = vndToHexWei(requiredVnd, usdVnd);
  if (hexBal < reqWei) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    const need = parseFloat(ethers.formatEther(reqWei)).toFixed(4);
    throw new Error(
      `HEX 잔액 부족. 최소 ${need} HEX 필요 (현재 ${have} HEX, 약 ₫${requiredVnd.toLocaleString()})`
    );
  }
  return hexBal;
}

// ── HEX 온체인 결제 ───────────────────────────────────────────
async function payWithHex(wallet, fareVnd, usdVnd, masterSecret) {
  const hexWei     = vndToHexWei(fareVnd, usdVnd);
  const provider   = getProvider();
  const adminWallet= getAdminWallet();
  const hexRead    = getHexContract(provider);

  // 잔액 최종 확인
  const hexBal = await hexRead.balanceOf(wallet.address);
  if (hexBal < hexWei) {
    // 잔액 부족 — 있는 만큼 전송 (부분 결제)
    const partialWei = hexBal;
    if (partialWei === 0n) return { hexWei, actualHexWei: 0n, txHash: null, partial: true };
    // BNB 가스비 보충
    const bnbBal = await provider.getBalance(wallet.address);
    if (bnbBal < ethers.parseEther('0.00005')) {
      const fundTx = await adminWallet.sendTransaction({
        to: wallet.address, value: ethers.parseEther('0.0001'),
      });
      await fundTx.wait();
    }
    const privateKey  = decrypt(wallet.encryptedKey, masterSecret);
    const signer      = walletFromKey(privateKey, provider);
    const hexSigned   = getHexContract(signer);
    const gasLimit    = await estimateGasWithBuffer(hexSigned, 'transfer', [adminWallet.address, partialWei]);
    const tx          = await hexSigned.transfer(adminWallet.address, partialWei, { gasLimit });
    const receipt     = await tx.wait();
    return { hexWei, actualHexWei: partialWei, txHash: receipt.hash, partial: true };
  }

  // BNB 가스비 보충
  const bnbBal = await provider.getBalance(wallet.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({
      to: wallet.address, value: ethers.parseEther('0.0001'),
    });
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

// ── 탑승 요청 ─────────────────────────────────────────────────
async function requestRide(uid, { pickupLat, pickupLng, pickupAddress, destLat, destLng, destAddress }) {
  if (!pickupLat || !pickupLng) throw new Error('탑승 위치가 필요합니다');

  const cfg  = await getConfig();
  const rates = await fetchRates();

  // 수탁 지갑 확인 + HEX 잔액 확인
  const wallet = await getUserWallet(uid);
  await checkHexBalance(wallet.address, cfg.intervalFare, rates.usdVnd); // 최소 1구간 요금

  // 진행 중 호출 중복 확인
  const active = await db.collection('buggy_rides')
    .where('userId', '==', uid)
    .where('status', 'in', ['searching', 'accepted', 'arriving', 'riding'])
    .limit(1).get();
  if (!active.empty) throw new Error('이미 진행 중인 호출이 있습니다');

  const userSnap = await db.collection('users').doc(uid).get();

  const rideRef = db.collection('buggy_rides').doc();
  await rideRef.set({
    userId:          uid,
    userDisplayName: userSnap.data()?.displayName || '회원',
    userWallet:      wallet.address,
    driverId:        null,
    driverName:      null,
    vehicleNumber:   null,
    vehicleModel:    null,
    pickupLat:       parseFloat(pickupLat),
    pickupLng:       parseFloat(pickupLng),
    pickupAddress:   pickupAddress || '',
    destLat:         destLat  ? parseFloat(destLat)  : null,
    destLng:         destLng  ? parseFloat(destLng)  : null,
    destAddress:     destAddress || '',
    status:          'searching',
    requestedAt:     FieldValue.serverTimestamp(),
    acceptedAt:      null,
    arrivedAt:       null,
    startedAt:       null,
    endedAt:         null,
    durationMinutes: null,
    feeVnd:          null,
    feeHex:          null,
    txHash:          null,
    paymentStatus:   'pending',
    cancelReason:    null,
    createdAt:       FieldValue.serverTimestamp(),
    updatedAt:       FieldValue.serverTimestamp(),
  });

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
  if (['completed','cancelled_by_user','cancelled_by_driver','failed','payment_failed'].includes(ride.status)) {
    throw new Error('이미 종료된 호출입니다');
  }
  if (ride.status === 'riding') throw new Error('탑승 중에는 취소할 수 없습니다');

  const status = isUser ? 'cancelled_by_user'
               : isDriver ? 'cancelled_by_driver'
               : 'cancelled_by_user';

  await rideRef.update({
    status,
    cancelReason: reason || '',
    updatedAt:    FieldValue.serverTimestamp(),
  });

  return { success: true };
}

// ── 기사 수락 (트랜잭션으로 경쟁 처리) ──────────────────────
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
      status:        'accepted',
      driverId:      driverUid,
      driverName:    driver.name        || '기사',
      vehicleNumber: driver.vehicleNumber || '',
      vehicleModel:  driver.vehicleModel  || '',
      acceptedAt:    FieldValue.serverTimestamp(),
      updatedAt:     FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
}

// ── 기사 도착 알림 ────────────────────────────────────────────
async function driverArrive(driverUid, { rideId }) {
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists || snap.data().driverId !== driverUid) throw new Error('권한 없음');
  if (!['accepted'].includes(snap.data().status)) throw new Error('잘못된 상태입니다');

  await rideRef.update({
    status:    'arriving',
    arrivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
}

// ── 탑승 시작 ─────────────────────────────────────────────────
async function startRide(driverUid, { rideId }) {
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists || snap.data().driverId !== driverUid) throw new Error('권한 없음');
  if (!['accepted', 'arriving'].includes(snap.data().status)) throw new Error('잘못된 상태입니다');
  const ride = snap.data();

  // HEX 잔액 재확인
  const cfg    = await getConfig();
  const rates  = await fetchRates();
  const wallet = await getUserWallet(ride.userId);
  await checkHexBalance(wallet.address, cfg.intervalFare, rates.usdVnd);

  await rideRef.update({
    status:    'riding',
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
}

// ── 탑승 종료 + HEX 자동 결제 ────────────────────────────────
async function endRide(driverUid, { rideId }, masterSecret) {
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists || snap.data().driverId !== driverUid) throw new Error('권한 없음');
  if (snap.data().status !== 'riding') throw new Error('탑승 중 상태가 아닙니다');
  const ride = snap.data();

  const cfg     = await getConfig();
  const startMs = ride.startedAt?.toMillis() || Date.now();
  const { minutes, fare } = calcFare(startMs, Date.now(), cfg);

  const rates  = await fetchRates();
  const wallet = await getUserWallet(ride.userId);

  // 온체인 HEX 결제
  const { hexWei, actualHexWei, txHash, partial } = await payWithHex(
    wallet, fare, rates.usdVnd, masterSecret
  );

  const hexAmount    = parseFloat(ethers.formatEther(hexWei)).toFixed(6);
  const actualAmount = parseFloat(ethers.formatEther(actualHexWei)).toFixed(6);

  const batch  = db.batch();
  const txRef  = db.collection('buggy_transactions').doc();

  if (partial) {
    batch.set(txRef, {
      userId:      ride.userId,
      rideId,
      type:        'ride_charge',
      feeVnd:      fare,
      hexRequired: hexAmount,
      hexCharged:  actualAmount,
      txHash:      txHash || null,
      status:      'partial',
      description: `버기카 ${minutes}분 — HEX 잔액 부족 (필요: ${hexAmount} HEX, 차감: ${actualAmount} HEX)`,
      createdAt:   FieldValue.serverTimestamp(),
    });
    batch.update(rideRef, {
      status:          'payment_failed',
      endedAt:         FieldValue.serverTimestamp(),
      durationMinutes: minutes,
      feeVnd:          fare,
      feeHex:          hexAmount,
      txHash:          txHash || null,
      paymentStatus:   'partial',
      updatedAt:       FieldValue.serverTimestamp(),
    });
  } else {
    batch.set(txRef, {
      userId:      ride.userId,
      rideId,
      type:        'ride_charge',
      feeVnd:      fare,
      hexRequired: hexAmount,
      hexCharged:  hexAmount,
      txHash,
      status:      'completed',
      description: `버기카 ${minutes}분 이용료 (${hexAmount} HEX)`,
      createdAt:   FieldValue.serverTimestamp(),
    });
    batch.update(rideRef, {
      status:          'completed',
      endedAt:         FieldValue.serverTimestamp(),
      durationMinutes: minutes,
      feeVnd:          fare,
      feeHex:          hexAmount,
      txHash,
      paymentStatus:   'paid',
      paymentTxId:     txRef.id,
      updatedAt:       FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  return {
    success:       true,
    minutes,
    fare,
    hexAmount,
    txHash:        txHash || null,
    paymentStatus: partial ? 'partial' : 'paid',
  };
}

// ── 기사 위치 전송 ────────────────────────────────────────────
async function updateDriverLocation(driverUid, { lat, lng, heading, speed }) {
  await db.collection('buggy_driver_locations').doc(driverUid).set({
    driverId: driverUid,
    lat:      parseFloat(lat)     || 0,
    lng:      parseFloat(lng)     || 0,
    heading:  parseFloat(heading) || 0,
    speed:    parseFloat(speed)   || 0,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { success: true };
}

// ── 기사 온라인 상태 ──────────────────────────────────────────
async function setDriverOnline(driverUid, { isOnline }) {
  await db.collection('buggy_drivers').doc(driverUid).update({
    isOnline:  !!isOnline,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
}

// ── 관리자: 기사 등록 ─────────────────────────────────────────
async function adminCreateDriver(adminUid, { uid, name, vehicleNumber, vehicleModel }) {
  await requireAdmin(adminUid);
  await db.collection('buggy_drivers').doc(uid).set({
    uid, name: name || '', vehicleNumber: vehicleNumber || '',
    vehicleModel: vehicleModel || '',
    isOnline: false, isActive: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
}

// ── 관리자: 강제 종료 ─────────────────────────────────────────
async function adminForceEnd(adminUid, { rideId, reason }) {
  await requireAdmin(adminUid);

  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists) throw new Error('라이드를 찾을 수 없습니다');
  const ride = snap.data();

  const cfg = await getConfig();
  let minutes = 0, fare = 0;
  if (ride.startedAt) {
    ({ minutes, fare } = calcFare(ride.startedAt.toMillis(), Date.now(), cfg));
  }

  await rideRef.update({
    status:          'completed',
    endedAt:         FieldValue.serverTimestamp(),
    durationMinutes: minutes,
    feeVnd:          fare,
    paymentStatus:   'pending',
    cancelReason:    reason || '관리자 강제 종료',
    updatedAt:       FieldValue.serverTimestamp(),
  });
  return { success: true, minutes, fare };
}

// ── 관리자: 설정 저장 ─────────────────────────────────────────
async function adminSaveConfig(adminUid, cfg) {
  await requireAdmin(adminUid);
  await db.collection('buggy_config').doc('default').set({
    ...DEFAULT_CONFIG, ...cfg,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { success: true };
}

module.exports = {
  requestRide, cancelRide,
  acceptRide, driverArrive, startRide, endRide,
  updateDriverLocation, setDriverOnline,
  adminCreateDriver, adminForceEnd, adminSaveConfig,
  getConfig,
};
