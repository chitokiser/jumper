// functions/handlers/friendInvite.js
// 친구초대 BT 이벤트 (/events, issueMethod 'FRIEND_INVITE')
//
// 흐름
//   1) 최고 관리자가 이벤트를 만들고 BT 풀을 충전한다 (friend_invite_events/{campaignId}.btPool)
//   2) 회원은 이벤트 화면에서 자기 초대 QR(가입 링크 register.html?mentor=내이메일&invite=이벤트ID)을 받는다
//   3) 친구가 그 링크로 가입하면 users/{새uid} 문서에 mentorUid·inviteCampaignId 가 남는다
//   4) onFriendInviteSignup 트리거(users 문서 쓰기)가 초대 1명을 세고, perFriends(기본 3)명마다 rewardBt(기본 1) BT를 풀에서 꺼내 초대한 회원에게 준다
//
// 보장
//   - 친구 1명은 1번만 센다: friend_invite_referrals/{campaignId}_{친구uid} (트랜잭션 안에서 존재 확인)
//   - 지급액은 "받아야 할 BT - 이미 받은 BT" 로 계산한다 (진행 문서 상태 기준이라 재실행해도 두 번 주지 않는다)
//   - 풀이 모자라면 지급을 미루고, 관리자가 충전한 뒤 회원이 화면을 열면(getFriendInviteStatus) 밀린 만큼 지급한다
//   - 풀·진행·초대 기록은 서버만 쓴다 (클라이언트는 Callable 로만 조회)
//   - BT 는 새로 만들지 않는다: 관리자가 충전한 풀(bt_transactions friend_invite_pool_charge)에서만 나간다

'use strict';

const admin = require('firebase-admin');
const { requireAdmin, isAdminUid } = require('../wallet/admin');

const FieldValue = admin.firestore.FieldValue;
const MAX_POOL_CHARGE = 100000;
const EXP_PER_BT = 100;

function getDb() {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}

function _err(message, httpCode = 'failed-precondition') {
  const e = new Error(message);
  e.httpCode = httpCode;
  return e;
}

function toInt(v, { min, max, label, fallback }) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min) throw _err(`${label}은(는) ${min} 이상이어야 합니다.`, 'invalid-argument');
  if (n > max) throw _err(`${label}은(는) 최대 ${max.toLocaleString()}까지 가능합니다.`, 'invalid-argument');
  return n;
}

/** 초대 수로 받아야 할 BT (1인 한도 적용) */
function entitledBt(invitedCount, ev) {
  const per = Math.max(1, Number(ev.perFriends || 3));
  const reward = Math.max(1, Number(ev.rewardBt || 1));
  const cap = Math.max(0, Number(ev.maxBtPerUser || 0)); // 0 = 한도 없음
  const due = Math.floor(Number(invitedCount || 0) / per) * reward;
  return cap > 0 ? Math.min(due, cap) : due;
}

/** 이번에 줄 BT: 밀린 BT 중 풀에 있는 만큼 (rewardBt 단위) */
function payableNow(invitedCount, paidBt, ev) {
  const reward = Math.max(1, Number(ev.rewardBt || 1));
  const owed = Math.max(0, entitledBt(invitedCount, ev) - Number(paidBt || 0));
  const pool = Math.max(0, Math.floor(Number(ev.btPool || 0)));
  return Math.min(owed, Math.floor(pool / reward) * reward);
}

/** 1. 이벤트 만들기 (최고 관리자) — 이벤트 카드(coupon_campaigns) + 기준 문서 */
async function createFriendInviteEvent(adminUid, data = {}) {
  await requireAdmin(adminUid);
  const db = getDb();

  const perFriends = toInt(data.perFriends, { min: 1, max: 100, label: '초대 인원', fallback: 3 });
  const rewardBt = toInt(data.rewardBt, { min: 1, max: 10, label: '지급 BT', fallback: 1 });
  const maxBtPerUser = toInt(data.maxBtPerUser, { min: 0, max: 10000, label: '1인 최대 BT', fallback: 10 });
  const initialPool = toInt(data.initialPool, { min: 0, max: MAX_POOL_CHARGE, label: '초기 풀', fallback: 0 });
  const title = String(data.title || '').trim().slice(0, 80) || `친구 ${perFriends}명 초대하면 ${rewardBt} BT`;
  const description = String(data.description || '').trim().slice(0, 500) ||
    `내 초대 QR로 친구가 베스트클럽에 가입하면, ${perFriends}명마다 ${rewardBt} BT가 자동으로 지급됩니다.`;
  const imageUrl = String(data.imageUrl || '').trim().slice(0, 500) ||
    'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=800&q=80';

  const campRef = db.collection('coupon_campaigns').doc();
  const eventRef = db.collection('friend_invite_events').doc(campRef.id);

  await db.runTransaction(async (tx) => {
    tx.set(campRef, {
      campaignId: campRef.id,
      campaignType: 'BT_REWARD',
      issueMethod: 'FRIEND_INVITE',
      issuerType: 'PLATFORM',
      issuerId: 'platform',
      issuerNameSnapshot: 'BestClub',
      issuerBadge: 'SUPER ADMIN',
      title,
      description,
      imageUrl,
      priceBM: 0,
      discountType: 'BT',
      discountValue: `${perFriends}명당 ${rewardBt} BT`,
      applicableMerchantIds: ['all'],
      applicableProductIds: [],
      // 카드 표시용 (실제 기준은 friend_invite_events 문서). 단위: BT
      totalQuantity: initialPool,
      issuedQuantity: 0,
      redeemedQuantity: 0,
      maxPerUser: maxBtPerUser,
      usageMode: 'ONLINE',
      terms: [
        '이 화면에서 내 초대 QR(또는 링크)을 친구에게 보내 주세요.',
        `친구가 그 링크로 베스트클럽에 새로 가입하면 초대 1명으로 셉니다.`,
        `초대한 친구 ${perFriends}명마다 ${rewardBt} BT가 자동으로 지급됩니다.`,
        maxBtPerUser > 0 ? `1인당 최대 ${maxBtPerUser} BT까지 받을 수 있습니다.` : '1인당 받을 수 있는 BT 한도는 없습니다.',
        '이미 가입한 회원이나 본인 계정은 초대로 세지 않습니다. 준비된 BT가 모두 소진되면 지급이 멈춥니다.',
      ].join('\n'),
      status: 'active',
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(eventRef, {
      campaignId: campRef.id,
      perFriends,
      rewardBt,
      maxBtPerUser,
      btPool: initialPool,
      btCharged: initialPool,
      btPaid: 0,
      inviteCount: 0,
      inviterCount: 0,
      status: 'active',
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (initialPool > 0) {
      tx.set(db.collection('bt_transactions').doc(), {
        type: 'friend_invite_pool_charge',
        campaignId: campRef.id,
        amount: initialPool,
        adminUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });

  return { success: true, campaignId: campRef.id };
}

/** 2. 설정 수정 (최고 관리자) — 상태만 바꾼다. 지급 조건은 진행 중 바꾸면 이미 센 회원과 어긋나므로 바꾸지 않는다 */
async function updateFriendInviteEvent(adminUid, { campaignId, status } = {}) {
  await requireAdmin(adminUid);
  const db = getDb();
  if (!campaignId) throw _err('campaignId가 필요합니다.', 'invalid-argument');
  const cid = String(campaignId);
  const eventRef = db.collection('friend_invite_events').doc(cid);
  const snap = await eventRef.get();
  if (!snap.exists) throw _err('친구초대 이벤트를 찾을 수 없습니다.', 'not-found');
  const next = status === 'paused' ? 'paused' : 'active';
  await eventRef.update({ status: next, updatedAt: FieldValue.serverTimestamp() });
  return { success: true, status: next };
}

/** 3. BT 풀 충전 (최고 관리자) */
async function chargeFriendInvitePool(adminUid, { campaignId, amount } = {}) {
  await requireAdmin(adminUid);
  const db = getDb();
  if (!campaignId) throw _err('campaignId가 필요합니다.', 'invalid-argument');
  const amt = toInt(amount, { min: 1, max: MAX_POOL_CHARGE, label: '충전 BT' });
  const cid = String(campaignId);
  const eventRef = db.collection('friend_invite_events').doc(cid);
  const campRef = db.collection('coupon_campaigns').doc(cid);

  return db.runTransaction(async (tx) => {
    const [snap, campSnap] = await Promise.all([tx.get(eventRef), tx.get(campRef)]);
    if (!snap.exists) throw _err('친구초대 이벤트를 찾을 수 없습니다.', 'not-found');
    const ev = snap.data();
    tx.update(eventRef, {
      btPool: FieldValue.increment(amt),
      btCharged: FieldValue.increment(amt),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (campSnap.exists) {
      tx.update(campRef, {
        totalQuantity: Number(ev.btCharged || 0) + amt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection('bt_transactions').doc(), {
      type: 'friend_invite_pool_charge',
      campaignId: cid,
      amount: amt,
      adminUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { success: true, btPool: Number(ev.btPool || 0) + amt };
  });
}

/**
 * 트랜잭션 안에서 초대한 회원에게 밀린 BT 를 준다. (읽기는 호출 쪽에서 끝낸 상태여야 한다)
 * @returns {number} 이번에 준 BT
 */
function payInTx(db, tx, { cid, inviterUid, ev, invitedCount, paidBt, eventRef, campRef, progressRef, campExists }) {
  const pay = payableNow(invitedCount, paidBt, ev);
  if (pay <= 0) return 0;
  tx.update(eventRef, {
    btPool: FieldValue.increment(-pay),
    btPaid: FieldValue.increment(pay),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (campExists) {
    tx.update(campRef, { issuedQuantity: FieldValue.increment(pay), updatedAt: FieldValue.serverTimestamp() });
  }
  tx.set(progressRef, { paidBt: FieldValue.increment(pay), lastPaidAt: FieldValue.serverTimestamp() }, { merge: true });
  tx.update(db.collection('users').doc(inviterUid), { btBalance: FieldValue.increment(pay) });
  const paidAfter = Number(paidBt || 0) + pay;
  const txRef = db.collection('transactions').doc(`TX_INVITE_${cid}_${inviterUid}_${paidAfter}`);
  tx.set(txRef, {
    txId: txRef.id,
    uid: inviterUid,
    type: 'FRIEND_INVITE_BT',
    btAmount: pay,
    campaignId: cid,
    invitedCount,
    createdAt: FieldValue.serverTimestamp(),
  });
  tx.set(db.collection('bt_transactions').doc(), {
    type: 'friend_invite_reward',
    campaignId: cid,
    uid: inviterUid,
    amount: pay,
    invitedCount,
    poolAfter: Math.floor(Number(ev.btPool || 0)) - pay,
    createdAt: FieldValue.serverTimestamp(),
  });
  return pay;
}

async function grantBtExp(uid, bt) {
  if (!bt) return;
  try {
    const expH = require('./exp');
    await expH.grantExp(uid, bt * EXP_PER_BT, 'bt');
  } catch (_) { /* EXP 실패는 BT 지급에 영향 없음 */ }
}

/** 친구가 보낸 가입 정보에서 초대한 회원 uid 찾기 */
async function resolveInviterUid(db, data) {
  const direct = String(data.mentorUid || '').trim();
  if (direct) return direct;
  const email = String(data.mentorEmail || data.mentorAddressInput || '').trim().toLowerCase();
  if (!email.includes('@')) return '';
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  return snap.empty ? '' : snap.docs[0].id;
}

/**
 * 4. 새 회원 가입 처리 (users/{uid} 에 inviteCampaignId 가 처음 들어올 때 트리거에서 호출)
 * 초대 링크(invite=이벤트ID)로 가입한 경우에만 센다.
 */
async function handleNewMemberSignup(newUid, data = {}) {
  const cid = String(data.inviteCampaignId || '').trim();
  if (!newUid || !cid || cid.length > 64 || cid.includes('/')) return { counted: false, reason: 'no-invite' };
  const db = getDb();

  const inviterUid = await resolveInviterUid(db, data);
  if (!inviterUid || inviterUid === newUid) return { counted: false, reason: 'no-inviter' };

  // 새 계정만 센다: Firebase 로그인 계정이 이벤트 시작 뒤에 만들어졌어야 한다 (기존 회원이 나중에 필드만 넣는 경우 차단)
  const evPeek = await db.collection('friend_invite_events').doc(cid).get();
  if (!evPeek.exists) return { counted: false, reason: 'no-event' };
  const evStartMs = evPeek.data().createdAt?.toMillis?.() || 0;
  let createdMs = 0;
  try {
    const authUser = await admin.auth().getUser(newUid);
    createdMs = Date.parse(authUser.metadata?.creationTime || '') || 0;
  } catch (_) { createdMs = 0; }
  if (!createdMs || createdMs < evStartMs - 60 * 1000) return { counted: false, reason: 'not-new-account' };

  const eventRef = db.collection('friend_invite_events').doc(cid);
  const campRef = db.collection('coupon_campaigns').doc(cid);
  const progressRef = db.collection('friend_invite_progress').doc(`${cid}_${inviterUid}`);
  const referralRef = db.collection('friend_invite_referrals').doc(`${cid}_${newUid}`);
  const inviterRef = db.collection('users').doc(inviterUid);

  const result = await db.runTransaction(async (tx) => {
    const [evSnap, campSnap, progSnap, refSnap, inviterSnap] = await Promise.all([
      tx.get(eventRef), tx.get(campRef), tx.get(progressRef), tx.get(referralRef), tx.get(inviterRef),
    ]);
    if (refSnap.exists) return { counted: false, reason: 'already-counted' };
    if (!evSnap.exists) return { counted: false, reason: 'no-event' };
    const ev = evSnap.data();
    if (ev.status !== 'active' || (campSnap.exists && campSnap.data().status === 'paused')) {
      return { counted: false, reason: 'event-paused' };
    }
    if (!inviterSnap.exists) return { counted: false, reason: 'inviter-missing' };

    const prog = progSnap.exists ? progSnap.data() : {};
    const invitedCount = Number(prog.invitedCount || 0) + 1;
    const paidBt = Number(prog.paidBt || 0);
    const inviter = inviterSnap.data() || {};

    tx.set(referralRef, {
      campaignId: cid,
      inviterUid,
      newUid,
      newEmail: String(data.email || ''),
      newName: String(data.name || data.displayName || ''),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(progressRef, {
      campaignId: cid,
      inviterUid,
      inviterEmail: String(inviter.email || ''),
      inviterName: String(inviter.name || inviter.displayName || ''),
      invitedCount,
      paidBt,
      updatedAt: FieldValue.serverTimestamp(),
      ...(progSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    tx.update(eventRef, {
      inviteCount: FieldValue.increment(1),
      ...(progSnap.exists ? {} : { inviterCount: FieldValue.increment(1) }),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const paid = payInTx(db, tx, {
      cid, inviterUid, ev, invitedCount, paidBt, eventRef, campRef, progressRef, campExists: campSnap.exists,
    });
    return { counted: true, inviterUid, invitedCount, paidBt: paid };
  });

  if (result.counted) await grantBtExp(inviterUid, result.paidBt);
  return result;
}

/** 5. 내 초대 현황 조회 (+ 풀 충전 후 밀린 BT 지급). 관리자는 이벤트 통계와 상위 초대자도 받는다 */
async function getFriendInviteStatus(uid, { campaignId } = {}) {
  const db = getDb();
  if (!campaignId) throw _err('campaignId가 필요합니다.', 'invalid-argument');
  const cid = String(campaignId);
  const eventRef = db.collection('friend_invite_events').doc(cid);
  const campRef = db.collection('coupon_campaigns').doc(cid);

  const evSnap0 = await eventRef.get();
  if (!evSnap0.exists) throw _err('친구초대 이벤트를 찾을 수 없습니다.', 'not-found');

  const out = { success: true, event: null, mine: null, admin: null };
  let paidNow = 0;

  if (uid) {
    const progressRef = db.collection('friend_invite_progress').doc(`${cid}_${uid}`);
    const userSnap = await db.collection('users').doc(uid).get();
    const r = await db.runTransaction(async (tx) => {
      const [evSnap, campSnap, progSnap] = await Promise.all([tx.get(eventRef), tx.get(campRef), tx.get(progressRef)]);
      const ev = evSnap.data();
      const prog = progSnap.exists ? progSnap.data() : {};
      const invitedCount = Number(prog.invitedCount || 0);
      const paidBt = Number(prog.paidBt || 0);
      let paid = 0;
      if (progSnap.exists && ev.status === 'active' && userSnap.exists) {
        paid = payInTx(db, tx, {
          cid, inviterUid: uid, ev, invitedCount, paidBt, eventRef, campRef, progressRef, campExists: campSnap.exists,
        });
      }
      return { invitedCount, paidBt: paidBt + paid, paid, ev };
    });
    paidNow = r.paid;
    const ev = r.ev;
    const per = Math.max(1, Number(ev.perFriends || 3));
    const cap = Math.max(0, Number(ev.maxBtPerUser || 0));
    out.mine = {
      email: String(userSnap.exists ? (userSnap.data().email || '') : ''),
      invitedCount: r.invitedCount,
      paidBt: r.paidBt,
      paidNow,
      pendingBt: Math.max(0, entitledBt(r.invitedCount, ev) - r.paidBt),
      toNext: per - (r.invitedCount % per),
      capReached: cap > 0 && r.paidBt >= cap,
    };
  }

  const ev = (await eventRef.get()).data();
  out.event = {
    perFriends: Number(ev.perFriends || 3),
    rewardBt: Number(ev.rewardBt || 1),
    maxBtPerUser: Number(ev.maxBtPerUser || 0),
    btPool: Number(ev.btPool || 0),
    status: ev.status || 'active',
  };

  if (uid && await isAdminUid(uid)) {
    const top = await db.collection('friend_invite_progress').where('campaignId', '==', cid).get();
    const rows = top.docs.map((d) => d.data())
      .sort((a, b) => Number(b.invitedCount || 0) - Number(a.invitedCount || 0))
      .slice(0, 30)
      .map((p) => ({
        name: p.inviterName || '', email: p.inviterEmail || '',
        invitedCount: Number(p.invitedCount || 0), paidBt: Number(p.paidBt || 0),
      }));
    out.admin = {
      btCharged: Number(ev.btCharged || 0),
      btPaid: Number(ev.btPaid || 0),
      inviteCount: Number(ev.inviteCount || 0),
      inviterCount: Number(ev.inviterCount || 0),
      inviters: rows,
    };
  }

  if (paidNow) await grantBtExp(uid, paidNow);
  return out;
}

module.exports = {
  createFriendInviteEvent,
  updateFriendInviteEvent,
  chargeFriendInvitePool,
  handleNewMemberSignup,
  getFriendInviteStatus,
  _test: { entitledBt, payableNow },
};
