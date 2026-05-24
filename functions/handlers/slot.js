'use strict';
// functions/handlers/slot.js

const admin      = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// ── 심볼 정의 (총 weight = 100) ───────────────────────────────────────────────
const SYMBOLS = [
  // normal  (weight 합계 60)
  { id: 'arms',    rarity: 'normal', weight: 8,  label: '무기상점' },
  { id: 'bakery',  rarity: 'normal', weight: 8,  label: '베이커리' },
  { id: 'cafe',    rarity: 'normal', weight: 8,  label: '카페'    },
  { id: 'eat',     rarity: 'normal', weight: 8,  label: '식당'    },
  { id: 'info',    rarity: 'normal', weight: 7,  label: '안내소'  },
  { id: 'korea',   rarity: 'normal', weight: 7,  label: '한식당'  },
  { id: 'pub',     rarity: 'normal', weight: 7,  label: '펍'      },
  { id: 'shop2',   rarity: 'normal', weight: 7,  label: '잡화점'  },
  // rare    (weight 합계 25)
  { id: 'golf',    rarity: 'rare',   weight: 5,  label: '골프장'  },
  { id: 'japan',   rarity: 'rare',   weight: 5,  label: '일식당'  },
  { id: 'massage', rarity: 'rare',   weight: 5,  label: '마사지'  },
  { id: 'park',    rarity: 'rare',   weight: 5,  label: '파크'    },
  { id: 'pool',    rarity: 'rare',   weight: 5,  label: '풀장'    },
  // hero    (weight 합계 10)
  { id: 'castle',  rarity: 'hero',   weight: 3,  label: '성'      },
  { id: 'ship',    rarity: 'hero',   weight: 3,  label: '선박'    },
  { id: 'sanghai', rarity: 'hero',   weight: 2,  label: '상하이'  },
  { id: 'venice',  rarity: 'hero',   weight: 2,  label: '베니스'  },
  // legend  (weight 합계 5)
  { id: 'tower',   rarity: 'legend', weight: 3,  label: '타워'    },
  { id: 'tower2',  rarity: 'legend', weight: 2,  label: '황금탑'  },
];

const TOTAL_WEIGHT         = SYMBOLS.reduce((s, x) => s + x.weight, 0); // 100
const ENTRY_COST           = 10;  // minimum bet (client multiplies reward by bet/10)
const JACKPOT_CONTRIBUTION = 10;
const JACKPOT_BASE         = 1000;
const REWARDS              = {
  normal:         300,
  rare:           1000,
  hero:           5000,
  two_normal:     30,   // 2× normal symbol
  two_match:      150,  // 2× rare+ symbol
};
const JACKPOT_DOC          = 'slot_config/jackpot';

function pickSymbol() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SYMBOLS) { r -= s.weight; if (r <= 0) return s; }
  return SYMBOLS[SYMBOLS.length - 1];
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ── 잭팟 풀 조회 ─────────────────────────────────────────────────────────────
async function getJackpot() {
  const snap = await admin.firestore().doc(JACKPOT_DOC).get();
  const pool = snap.exists ? (snap.data().pool ?? JACKPOT_BASE) : JACKPOT_BASE;
  return { pool };
}

// ── 스핀 실행 ────────────────────────────────────────────────────────────────
async function spinSlot(uid, { isFree = false } = {}) {
  const db      = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  const jpRef   = db.doc(JACKPOT_DOC);
  const today   = todayISO();

  // 무료 스핀 중복 방지
  const userSnap = await userRef.get();
  if (isFree && (userSnap.data() ?? {}).slotFreeDate === today) {
    throw new Error('FREE_USED');
  }

  // 잭팟 풀 로드
  const jpSnap = await jpRef.get();
  let jackpotPool = jpSnap.exists ? (jpSnap.data().pool ?? JACKPOT_BASE) : JACKPOT_BASE;

  // 릴 결과
  const reels = [pickSymbol(), pickSymbol(), pickSymbol()];
  const ids   = reels.map(s => s.id);
  const all3  = ids[0] === ids[1] && ids[1] === ids[2];

  let outcome = 'miss', reward = 0, isJackpot = false, jackpotWon = 0;

  if (all3) {
    const rarity = reels[0].rarity;
    if (rarity === 'legend') {
      isJackpot = true; jackpotWon = jackpotPool;
      reward = jackpotPool; outcome = 'jackpot';
    } else {
      reward = REWARDS[rarity] ?? 0;
      outcome = `${rarity}_match`;
    }
  } else {
    // 2개 일치: normal → two_normal(30×mult), rare+ → two_match(150×mult)
    const counts = {};
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    const matchId = Object.entries(counts).find(([, c]) => c >= 2)?.[0];
    if (matchId) {
      const matchSym = reels.find(s => s.id === matchId);
      if (matchSym) {
        if (matchSym.rarity === 'normal') {
          reward = REWARDS.two_normal; outcome = 'two_normal';
        } else {
          reward = REWARDS.two_match; outcome = 'two_match';
        }
      }
    }
  }

  // Firestore 업데이트
  await db.runTransaction(async (tx) => {
    if (isFree) tx.set(userRef, { slotFreeDate: today }, { merge: true });
    if (isJackpot) {
      tx.set(jpRef, { pool: JACKPOT_BASE }, { merge: false });
    } else if (!isFree) {
      tx.set(jpRef, { pool: FieldValue.increment(JACKPOT_CONTRIBUTION) }, { merge: true });
      jackpotPool += JACKPOT_CONTRIBUTION;
    }
  });

  return {
    reels:       reels.map(s => ({ id: s.id, rarity: s.rarity, label: s.label })),
    outcome, reward, jackpotWon,
    jackpotPool: isJackpot ? JACKPOT_BASE : jackpotPool,
    isFree,
    entryCost: isFree ? 0 : ENTRY_COST,
  };
}

module.exports = { spinSlot, getJackpot, ENTRY_COST };
