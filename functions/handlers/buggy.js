// functions/handlers/buggy.js
// 오션파크 버기카 호출 서비스

'use strict';

const admin = require('firebase-admin');
const db    = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── 기본 설정 ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  baseFare:              50000,   // VND
  intervalMinutes:       10,      // 10분마다
  intervalFare:          50000,   // 추가 요금
  minBalance:            50000,   // 최소 보유 잔액
  searchRadiusKm:        10,      // 기사 탐색 반경
  driverTimeoutSeconds:  120,     // 기사 응답 제한시간
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

// ── 거리 계산 (km) ────────────────────────────────────────────
function distKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 탑승 요청 ─────────────────────────────────────────────────
async function requestRide(uid, { pickupLat, pickupLng, pickupAddress, destLat, destLng, destAddress }) {
  if (!pickupLat || !pickupLng) throw new Error('탑승 위치가 필요합니다');

  const cfg = await getConfig();

  // 잔액 확인
  const userSnap = await db.collection('users').doc(uid).get();
  const balance  = userSnap.data()?.buggyVndBalance || 0;
  if (balance < cfg.minBalance) {
    throw new Error(`잔액 부족. 최소 ${cfg.minBalance.toLocaleString()}동 필요 (현재 ${balance.toLocaleString()}동)`);
  }

  // 진행 중 호출 중복 확인
  const active = await db.collection('buggy_rides')
    .where('userId', '==', uid)
    .where('status', 'in', ['searching', 'accepted', 'arriving', 'riding'])
    .limit(1).get();
  if (!active.empty) throw new Error('이미 진행 중인 호출이 있습니다');

  const rideRef = db.collection('buggy_rides').doc();
  await rideRef.set({
    userId:          uid,
    userDisplayName: userSnap.data()?.displayName || '회원',
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
    paymentStatus:   'pending',
    paymentTxId:     null,
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
  // 관리자 확인
  const isAdmin  = await db.collection('admins').doc(uid).get().then(s => s.exists);

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

  // 잔액 재확인
  const cfg      = await getConfig();
  const userSnap = await db.collection('users').doc(ride.userId).get();
  const balance  = userSnap.data()?.buggyVndBalance || 0;
  if (balance < cfg.minBalance) throw new Error('승객 잔액 부족으로 탑승을 시작할 수 없습니다');

  await rideRef.update({
    status:    'riding',
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
}

// ── 탑승 종료 + 자동 정산 ─────────────────────────────────────
async function endRide(driverUid, { rideId }) {
  const rideRef = db.collection('buggy_rides').doc(rideId);
  const snap    = await rideRef.get();
  if (!snap.exists || snap.data().driverId !== driverUid) throw new Error('권한 없음');
  if (snap.data().status !== 'riding') throw new Error('탑승 중 상태가 아닙니다');
  const ride = snap.data();

  const cfg     = await getConfig();
  const startMs = ride.startedAt?.toMillis() || Date.now();
  const { minutes, fare } = calcFare(startMs, Date.now(), cfg);

  const userRef  = db.collection('users').doc(ride.userId);
  const userSnap = await userRef.get();
  const balance  = userSnap.data()?.buggyVndBalance || 0;
  const batch    = db.batch();
  const txRef    = db.collection('buggy_transactions').doc();

  if (balance < fare) {
    // 잔액 부족 — 있는 만큼 차감, payment_failed
    batch.set(txRef, {
      userId: ride.userId, rideId,
      type: 'ride_charge', amount: -balance,
      balanceBefore: balance, balanceAfter: 0,
      status: 'partial',
      description: `버기카 ${minutes}분 — 잔액 부족 (부족분 ${(fare - balance).toLocaleString()}동)`,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (balance > 0) batch.update(userRef, { buggyVndBalance: 0 });
    batch.update(rideRef, {
      status: 'payment_failed', endedAt: FieldValue.serverTimestamp(),
      durationMinutes: minutes, feeVnd: fare,
      paymentStatus: 'failed', updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    batch.set(txRef, {
      userId: ride.userId, rideId,
      type: 'ride_charge', amount: -fare,
      balanceBefore: balance, balanceAfter: balance - fare,
      status: 'completed',
      description: `버기카 ${minutes}분 이용료`,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(userRef, { buggyVndBalance: FieldValue.increment(-fare) });
    batch.update(rideRef, {
      status: 'completed', endedAt: FieldValue.serverTimestamp(),
      durationMinutes: minutes, feeVnd: fare,
      paymentStatus: 'paid', paymentTxId: txRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  return { success: true, minutes, fare, paymentStatus: balance >= fare ? 'paid' : 'failed' };
}

// ── 기사 위치 전송 ────────────────────────────────────────────
async function updateDriverLocation(driverUid, { lat, lng, heading, speed }) {
  await db.collection('buggy_driver_locations').doc(driverUid).set({
    driverId: driverUid,
    lat:      parseFloat(lat)  || 0,
    lng:      parseFloat(lng)  || 0,
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
  const aSnap = await db.collection('admins').doc(adminUid).get();
  if (!aSnap.exists) throw new Error('관리자 권한 없음');
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
  const aSnap = await db.collection('admins').doc(adminUid).get();
  if (!aSnap.exists) throw new Error('관리자 권한 없음');

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
    status: 'completed', endedAt: FieldValue.serverTimestamp(),
    durationMinutes: minutes, feeVnd: fare,
    paymentStatus: 'pending',
    cancelReason:  reason || '관리자 강제 종료',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true, minutes, fare };
}

// ── 관리자: 잔액 충전 ─────────────────────────────────────────
async function adminTopUpBalance(adminUid, { userId, amount }) {
  const aSnap = await db.collection('admins').doc(adminUid).get();
  if (!aSnap.exists) throw new Error('관리자 권한 없음');
  const amt   = parseInt(amount);
  if (!amt || amt <= 0) throw new Error('충전 금액을 확인하세요');

  const batch  = db.batch();
  const txRef  = db.collection('buggy_transactions').doc();
  const userRef = db.collection('users').doc(userId);
  const before = (await userRef.get()).data()?.buggyVndBalance || 0;

  batch.update(userRef, { buggyVndBalance: FieldValue.increment(amt) });
  batch.set(txRef, {
    userId, rideId: null, type: 'top_up',
    amount: amt, balanceBefore: before, balanceAfter: before + amt,
    status: 'completed',
    description: `버기카 잔액 충전 (관리자: ${adminUid})`,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { success: true, newBalance: before + amt };
}

// ── 관리자: 설정 저장 ─────────────────────────────────────────
async function adminSaveConfig(adminUid, cfg) {
  const aSnap = await db.collection('admins').doc(adminUid).get();
  if (!aSnap.exists) throw new Error('관리자 권한 없음');
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
  adminCreateDriver, adminForceEnd, adminTopUpBalance, adminSaveConfig,
  getConfig,
};
