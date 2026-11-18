'use strict';
// billiards.js — 3쿠션 당구 GP 게임 (1인 플레이) 서버 처리
//
// 규칙 (서버 정의 — 클라이언트 값은 샷 판정 결과만 받음)
//   참가비: 50 / 100 / 200 GP 중 선택 → 보상 배율 ×1 / ×2 / ×4
//   기회: 10번으로 시작. 성공 +1, 실패 -1. 0이 되면 판 종료
//   샷 점수 (성공 시):
//     일반 3쿠션 (공 먼저 → 쿠션 3번 → 두 번째 공)  300점
//     빈쿠션 (쿠션 먼저 맞고 두 공, 쿠션 3번 이상)    600점
//     쿠션 3번을 넘는 쿠션 1번마다                    +100점 (4쿠션 400, 빈쿠션 4쿠션 700 ...)
//   GP 지급: (점수 ÷ GP_SCORE_UNIT) × 배율, 판 종료 시 1회
//   주간 랭킹: 판 최종 점수(배율 무관)를 서버에서 직접 접수 → 일요일 자동 정산 (weeklyRanking.js)
//
// 컬렉션 (서버 전용, firestore.rules 에 규칙 없음 = 클라이언트 접근 불가)
//   billiards_sessions/{uid}   진행 중/마지막 판 상태
//
// 부정 방지: 샷 번호 연속성, 샷 간 최소 간격, 판당 최대 샷 수, 판 최대 시간, 하루 GP 한도.
// 물리 계산은 브라우저에서 돌기 때문에 완전한 검증은 불가 — 위 제한으로 조작 폭을 줄인다.

const admin = require('firebase-admin');
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const TIERS = { 50: 1, 100: 2, 200: 4 };  // 참가비 → 보상 배율
const START_CHANCES = 10;
const MAX_SHOTS = 300;                     // 판당 최대 샷
const MIN_SHOT_GAP_MS = 1500;              // 샷 사이 최소 간격 (공이 멈추는 시간)
const SESSION_MAX_MS = 3 * 60 * 60 * 1000; // 3시간 지나면 판 무효(현재 점수로 종료)
const GP_SCORE_UNIT = 20;                  // 20점당 1 GP (×배율)
const DAILY_MAX_EARN = 100000;             // 하루 당구 GP 최대 획득
const MAX_CUSHIONS = 12;                   // 비정상 값 차단

function shotPoints({ success, cushions, bank }) {
  if (!success) return 0;
  const extra = Math.max(0, cushions - 3) * 100;
  return (bank ? 600 : 300) + extra;
}

function vnDate(ms = Date.now()) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function publicState(s) {
  return {
    active: !!s && !s.ended,
    fee: s?.fee ?? 0,
    mult: s?.mult ?? 1,
    chances: s?.chances ?? 0,
    score: s?.score ?? 0,
    shots: s?.shots ?? 0,
    successes: s?.successes ?? 0,
    ended: !!s?.ended,
    gpAwarded: s?.gpAwarded ?? 0,
  };
}

/** 판 시작 — 참가비 차감 + 새 판 생성 (진행 중이던 판은 현재 점수로 먼저 정산) */
async function startGame(uid, { fee } = {}) {
  const f = Number(fee);
  const mult = TIERS[f];
  if (!mult) throw new Error('참가비는 50, 100, 200 GP 중에서 고르세요');

  // 끝나지 않은 이전 판이 있으면 먼저 정산
  await endGame(uid, { reason: 'restart' }).catch(() => {});

  const playerRef = db.collection('battle_players').doc(uid);
  const sessRef = db.collection('billiards_sessions').doc(uid);
  const now = Date.now();

  const state = await db.runTransaction(async t => {
    const snap = await t.get(playerRef);
    if (!snap.exists) throw new Error('플레이어 데이터 없음');
    const gold = snap.data().gold || 0;
    if (gold < f) throw new Error(`GP 부족 — 필요: ${f.toLocaleString()} GP, 보유: ${gold.toLocaleString()} GP`);
    t.set(playerRef, { gold: FieldValue.increment(-f) }, { merge: true });
    const s = {
      uid, fee: f, mult, chances: START_CHANCES, score: 0, shots: 0, successes: 0,
      startedAt: now, lastShotAt: now, ended: false, gpAwarded: 0, log: [],
    };
    t.set(sessRef, s);
    return s;
  });
  return { ...publicState(state), gold: null };
}

/** 샷 결과 접수 — 서버가 점수·기회 계산. 기회 0이면 바로 정산 */
async function reportShot(uid, { seq, success, cushions, bank } = {}) {
  const sessRef = db.collection('billiards_sessions').doc(uid);
  const now = Date.now();
  const c = Math.floor(Number(cushions));
  if (!Number.isInteger(Number(seq)) || !Number.isFinite(c) || c < 0 || c > MAX_CUSHIONS) {
    throw new Error('샷 데이터가 올바르지 않습니다');
  }
  const shot = { success: success === true && c >= 3, cushions: c, bank: bank === true };

  const result = await db.runTransaction(async t => {
    const snap = await t.get(sessRef);
    const s = snap.data();
    if (!s || s.ended) throw new Error('진행 중인 게임이 없습니다');
    if (now - s.startedAt > SESSION_MAX_MS) return { s, expired: true };
    if (Number(seq) !== s.shots + 1) throw new Error('샷 순서가 맞지 않습니다');
    if (now - (s.lastShotAt || 0) < MIN_SHOT_GAP_MS) throw new Error('샷 간격이 너무 짧습니다');
    if (s.shots >= MAX_SHOTS) return { s, expired: true };

    const pts = shotPoints(shot);
    const next = {
      shots: s.shots + 1,
      successes: s.successes + (shot.success ? 1 : 0),
      score: s.score + pts,
      chances: s.chances + (shot.success ? 1 : -1),
      lastShotAt: now,
      log: FieldValue.arrayUnion(`${s.shots + 1}:${shot.success ? 1 : 0}:${c}:${shot.bank ? 1 : 0}:${pts}`),
    };
    t.update(sessRef, next);
    return { s: { ...s, ...next }, pts };
  });

  if (result.expired || result.s.chances <= 0) {
    const fin = await endGame(uid, { reason: result.expired ? 'expired' : 'chances' });
    return { ...fin, points: result.pts || 0, shot };
  }
  return { ...publicState(result.s), points: result.pts, shot };
}

/** 판 종료 — GP 지급 + 주간 랭킹 접수 (판당 1회, 멱등) */
async function endGame(uid, { reason = 'quit' } = {}) {
  const sessRef = db.collection('billiards_sessions').doc(uid);
  const playerRef = db.collection('battle_players').doc(uid);
  const dayKey = `gameEarn_billiards_${vnDate()}`;

  const fin = await db.runTransaction(async t => {
    const [snap, pSnap] = await Promise.all([t.get(sessRef), t.get(playerRef)]);
    const s = snap.data();
    if (!s || s.ended) return { s, already: true };
    const earnedToday = (pSnap.data() || {})[dayKey] || 0;
    let gp = Math.floor(s.score / GP_SCORE_UNIT) * s.mult;
    gp = Math.max(0, Math.min(gp, DAILY_MAX_EARN - earnedToday));
    if (gp > 0) {
      t.set(playerRef, { gold: FieldValue.increment(gp), [dayKey]: FieldValue.increment(gp) }, { merge: true });
    }
    const done = { ended: true, endedAt: Date.now(), endReason: reason, gpAwarded: gp };
    t.update(sessRef, done);
    return { s: { ...s, ...done } };
  });

  if (!fin.s) return publicState(null);
  let weekly = null;
  if (!fin.already && fin.s.score > 0) {
    try {
      weekly = await require('./weeklyRanking').recordServerScore(uid, 'billiards', fin.s.score);
    } catch (e) {
      weekly = { accepted: false, error: e.message };
    }
  }
  return { ...publicState(fin.s), weekly };
}

/** 현재 판 상태 (새로고침 후 이어하기 표시용) */
async function getState(uid) {
  const snap = await db.collection('billiards_sessions').doc(uid).get();
  return publicState(snap.data());
}

module.exports = { startGame, reportShot, endGame, getState, shotPoints, TIERS, GP_SCORE_UNIT, START_CHANCES };
