'use strict';
// dailyArea.js — 유저 첫 입장 위치 기준 보물박스 15 + 몬스터 15 (24h 리셋)

const admin = require('firebase-admin');
const db    = admin.firestore();
const { FieldValue } = admin.firestore;

// ── 설정 ─────────────────────────────────────────────────────────────────
const BOX_TYPES = [
  ...Array(8).fill('common'),
  ...Array(5).fill('rare'),
  ...Array(2).fill('epic'),
];
const BOX_HP  = { common: 80,  rare: 150, epic: 250 };
const BOX_GP_MIN = { common: 50,  rare: 100, epic: 300 };
const BOX_GP_MAX = { common: 150, rare: 350, epic: 700 };

const MON_LIST = [
  { species:'zombie',   hp:200, gp:40  },
  { species:'zombie',   hp:200, gp:40  },
  { species:'zombie',   hp:200, gp:40  },
  { species:'goblin',   hp:150, gp:50  },
  { species:'goblin',   hp:150, gp:50  },
  { species:'goblin',   hp:150, gp:50  },
  { species:'orc',      hp:300, gp:80  },
  { species:'orc',      hp:300, gp:80  },
  { species:'orc',      hp:300, gp:80  },
  { species:'skeleton', hp:250, gp:65  },
  { species:'skeleton', hp:250, gp:65  },
  { species:'skeleton', hp:250, gp:65  },
  { species:'elite',    hp:400, gp:120 },
  { species:'elite',    hp:400, gp:120 },
  { species:'elite',    hp:400, gp:120 },
];

function _todayUtc7() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function _offset(lat, lng, distM, angle) {
  const R = 111000;
  return {
    lat: lat + (distM / R) * Math.cos(angle),
    lng: lng + (distM / (R * Math.cos(lat * Math.PI / 180))) * Math.sin(angle),
  };
}

// ── 일일 구역 생성 / 스킵 ────────────────────────────────────────────────
async function createDailyArea(uid, lat, lng) {
  const today = _todayUtc7();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.data() || {};

  if (userData.dailyAreaDate === today) {
    return { ok: true, skipped: true };
  }

  const areaCol = db.collection('users').doc(uid).collection('dailyArea');

  // 기존 항목 일괄 삭제
  const oldSnap = await areaCol.get();
  const batch = db.batch();
  oldSnap.forEach(d => batch.delete(d.ref));

  // 보물박스 15개
  for (let i = 0; i < 15; i++) {
    const btype = BOX_TYPES[i];
    const dist  = 35 + Math.random() * 165;
    const angle = (i / 15) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const pos   = _offset(lat, lng, dist, angle);
    const gp    = BOX_GP_MIN[btype] + Math.floor(Math.random() * (BOX_GP_MAX[btype] - BOX_GP_MIN[btype]));
    batch.set(areaCol.doc(), {
      type:    'box',
      boxType: btype,
      lat:     pos.lat,
      lng:     pos.lng,
      hp:      BOX_HP[btype],
      maxHp:   BOX_HP[btype],
      gp,
      active:    true,
      resetDate: today,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 몬스터 15마리
  for (let i = 0; i < 15; i++) {
    const mon   = MON_LIST[i];
    const dist  = 35 + Math.random() * 165;
    const angle = (i / 15 + 0.5) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const pos   = _offset(lat, lng, dist, angle);
    batch.set(areaCol.doc(), {
      type:      'monster',
      species:   mon.species,
      lat:       pos.lat,
      lng:       pos.lng,
      hp:        mon.hp,
      maxHp:     mon.hp,
      gp:        mon.gp,
      active:    true,
      resetDate: today,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  await userRef.set({ dailyAreaDate: today }, { merge: true });
  return { ok: true, skipped: false };
}

// ── 아이템 처치/수집 → GP 지급 ──────────────────────────────────────────
async function claimDailyItem(uid, itemId) {
  const itemRef = db.collection('users').doc(uid).collection('dailyArea').doc(itemId);
  const snap = await itemRef.get();
  if (!snap.exists) throw new Error('Item not found');
  const item = snap.data() || {};
  if (!item.active) return { ok: false, reason: 'already_claimed' };

  const gp = item.gp || 0;
  await Promise.all([
    itemRef.update({ active: false, claimedAt: FieldValue.serverTimestamp() }),
    db.collection('battle_players').doc(uid)
      .set({ gold: FieldValue.increment(gp) }, { merge: true }),
  ]);
  return { ok: true, gp, type: item.type };
}

module.exports = { createDailyArea, claimDailyItem };
