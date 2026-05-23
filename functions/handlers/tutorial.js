// functions/handlers/tutorial.js
// 신규 유저 온보딩 보물 발견 체험 시스템
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

const db = admin.firestore();

// ── 지오데틱 오프셋 계산 ──────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// bearingDeg: 0=북, 90=동, 180=남, 270=서
function offsetByDistance(lat, lng, bearingDeg, distM) {
  const R = 6371000;
  const b = bearingDeg * Math.PI / 180;
  const latR = lat * Math.PI / 180;
  const lngR = lng * Math.PI / 180;
  const d = distM / R;
  const newLatR = Math.asin(
    Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(b)
  );
  const newLngR = lngR + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(latR),
    Math.cos(d) - Math.sin(latR) * Math.sin(newLatR)
  );
  return { lat: newLatR * 180 / Math.PI, lng: newLngR * 180 / Math.PI };
}

// ── 튜토리얼 보물박스 초기화 ─────────────────────────────────────────────────
// 신규 유저 최초 GPS 위치에서 30m / 60m / 120m 지점에 3개 박스 생성
// 이미 생성된 경우 기존 데이터 반환
async function initTutorialBoxes(uid, { lat, lng } = {}) {
  if (!lat || !lng) throw new HttpsError('invalid-argument', 'lat, lng가 필요합니다');
  if (typeof lat !== 'number' || typeof lng !== 'number')
    throw new HttpsError('invalid-argument', 'lat, lng는 숫자여야 합니다');

  const ref = db.collection('tutorial_boxes').doc(uid);
  const snap = await ref.get();

  // 이미 초기화된 경우 기존 데이터 반환
  if (snap.exists) {
    const data = snap.data();
    return { ok: true, boxes: data.boxes, alreadyExists: true };
  }

  // 3개 박스를 120도 간격으로 랜덤 방위각으로 배치
  const startBearing = Math.random() * 360;
  const distances = [30, 60, 120];
  const boxes = distances.map((distM, i) => {
    const bearing = (startBearing + i * 120) % 360;
    const pos = offsetByDistance(lat, lng, bearing, distM);
    return {
      index:    i,
      lat:      pos.lat,
      lng:      pos.lng,
      distM,
      claimed:  false,
      claimedAt: null,
    };
  });

  await ref.set({
    uid,
    originLat:  lat,
    originLng:  lng,
    boxes,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, boxes, alreadyExists: false };
}

// ── 튜토리얼 보물박스 수령 ──────────────────────────────────────────────────────
// boxIndex: 0 | 1 | 2
// 사용자 GPS가 박스 8m 이내여야 수령 가능 (GPS 오차 허용)
async function claimTutorialBox(uid, { boxIndex, userLat, userLng } = {}) {
  if (boxIndex == null || userLat == null || userLng == null)
    throw new HttpsError('invalid-argument', 'boxIndex, userLat, userLng가 필요합니다');

  const idx = Number(boxIndex);
  if (![0, 1, 2].includes(idx))
    throw new HttpsError('invalid-argument', 'boxIndex는 0, 1, 2 중 하나여야 합니다');

  const tutRef  = db.collection('tutorial_boxes').doc(uid);
  const playerRef = db.collection('battle_players').doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const [tutSnap, playerSnap] = await Promise.all([
      tx.get(tutRef),
      tx.get(playerRef),
    ]);

    if (!tutSnap.exists) throw new HttpsError('not-found', '튜토리얼 박스가 초기화되지 않았습니다');

    const data = tutSnap.data();
    const box = data.boxes[idx];
    if (!box) throw new HttpsError('not-found', `박스 ${idx}를 찾을 수 없습니다`);
    if (box.claimed) throw new HttpsError('already-exists', '이미 수령한 박스입니다');

    // GPS 거리 검증 (8m 이내)
    const dist = haversine(userLat, userLng, box.lat, box.lng);
    if (dist > 8) {
      throw new HttpsError('failed-precondition',
        `아직 거리가 멀어요! ${Math.round(dist)}m 떨어져 있습니다 (8m 이내 필요)`);
    }

    // 박스별 보상 정의
    const REWARDS = [
      // Box 0 (30m): 골드 + XP
      { gold: 500, xp: 500, items: [], badge: null,
        label: { ko: '🪙 골드 500 + XP 500 획득!', en: '🪙 500 Gold + 500 XP!', vi: '🪙 500 Vàng + 500 XP!' } },
      // Box 1 (60m): 랜덤 장비 + 아바타
      { gold: 200, xp: 1000, items: ['weapon_100', 'armo_10'], badge: null,
        label: { ko: '⚔️ 랜덤 장비 + XP 1000!', en: '⚔️ Random gear + 1000 XP!', vi: '⚔️ Trang bị ngẫu nhiên + 1000 XP!' } },
      // Box 2 (120m): 희귀 아이템 + 탐험가 뱃지
      { gold: 1000, xp: 2000, items: [], badge: 'explorer',
        label: { ko: '🏅 탐험가 뱃지 + XP 2000!', en: '🏅 Explorer badge + 2000 XP!', vi: '🏅 Huy hiệu Nhà thám hiểm + 2000 XP!' } },
    ];

    const reward = REWARDS[idx];

    // 플레이어 스탯 업데이트
    if (playerSnap.exists) {
      const p = playerSnap.data();
      const newGold = (p.gold || 0) + reward.gold;
      const newXp   = (p.gsExp || 0) + reward.xp;
      const update = {
        gold:  newGold,
        gsExp: newXp,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.update(playerRef, update);
    }

    // 탐험가 뱃지 부여
    if (reward.badge === 'explorer') {
      const userRef = db.collection('users').doc(uid);
      tx.update(userRef, {
        badges: admin.firestore.FieldValue.arrayUnion('explorer'),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 박스 수령 처리
    const updatedBoxes = data.boxes.map((b, i) =>
      i === idx ? { ...b, claimed: true, claimedAt: new Date().toISOString() } : b
    );
    tx.update(tutRef, { boxes: updatedBoxes });

    return { gold: reward.gold, xp: reward.xp, badge: reward.badge, label: reward.label };
  });

  return { ok: true, boxIndex: idx, ...result };
}

// ── 튜토리얼 박스 상태 조회 ───────────────────────────────────────────────────
async function getTutorialBoxes(uid) {
  const snap = await db.collection('tutorial_boxes').doc(uid).get();
  if (!snap.exists) return { ok: true, initialized: false, boxes: [] };
  const data = snap.data();
  // 클라이언트에는 위치와 수령 여부만 전달 (claim된 경우에도 위치는 공개)
  return {
    ok: true,
    initialized: true,
    boxes: (data.boxes || []).map(b => ({
      index:   b.index,
      lat:     b.lat,
      lng:     b.lng,
      distM:   b.distM,
      claimed: b.claimed,
    })),
  };
}

module.exports = { initTutorialBoxes, claimTutorialBox, getTutorialBoxes };
