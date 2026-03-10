// functions/handlers/dao.js
// JUMP DAO 의결 시스템 – 심의/상정/의결/댓글

'use strict';

const admin  = require('firebase-admin');
const { logger } = require('firebase-functions');
const { getJumpBankContract, getProvider } = require('../wallet/chain');

const db = admin.firestore();

// ── 스테이킹 기준 (JUMP 0 decimals) ──────────────────────────────
const MIN_PROPOSE  = 10_000;    // 심의 등록
const MIN_COMMENT  = 10_000;    // 댓글
const MIN_VOTE     = 1;         // 투표
const TARGET_SUPPORT = 250_000; // 상정 전환 누적 지지 기준

// ── 헬퍼 ─────────────────────────────────────────────────────────

async function getUserWallet(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) throw new Error('미가입 회원입니다');
  const addr = snap.data()?.wallet?.address;
  if (!addr) throw new Error('수탁 지갑이 없습니다');
  return addr;
}

async function getStaked(walletAddress) {
  const bank = getJumpBankContract(getProvider());
  const info = await bank.user(walletAddress);
  return Number(info[2]); // depo (staked JUMP, 0 decimals)
}

async function requireAdmin(uid) {
  const snap = await db.collection('admins').doc(uid).get();
  if (!snap.exists) throw new Error('관리자 권한이 없습니다');
}

// ── 1. 안건 심의 등록 ─────────────────────────────────────────────
// 조건: JUMP 1만개 이상 스테이킹 + 관리자 최종 승인
async function createProposal(uid, { title, content }) {
  if (!title?.trim()) throw new Error('제목을 입력해주세요');
  if (!content?.trim()) throw new Error('내용을 입력해주세요');
  if (title.trim().length > 100) throw new Error('제목은 100자 이내로 입력해주세요');
  if (content.trim().length > 5000) throw new Error('내용은 5000자 이내로 입력해주세요');

  const wallet = await getUserWallet(uid);
  const staked = await getStaked(wallet);

  if (staked < MIN_PROPOSE) {
    throw new Error(`JUMP ${MIN_PROPOSE.toLocaleString()}개 이상 스테이킹 필요 (현재: ${staked.toLocaleString()}개)`);
  }

  const ref = await db.collection('dao_proposals').add({
    title:         title.trim(),
    content:       content.trim(),
    status:        'pending_admin', // 관리자 승인 대기
    authorUid:     uid,
    authorWallet:  wallet,
    authorStaked:  staked,
    supportStaked: 0,
    supportCount:  0,
    voteYes:       0,
    voteNo:        0,
    voteYesStaked: 0,
    voteNoStaked:  0,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    adminApprovedAt: null,
    votingStartedAt: null,
    closedAt:      null,
  });

  logger.info('dao.createProposal', { uid, proposalId: ref.id, staked });
  return { proposalId: ref.id };
}

// ── 2. 관리자 승인 (pending_admin → review) ───────────────────────
async function adminApproveProposal(uid, { proposalId }) {
  await requireAdmin(uid);

  const ref  = db.collection('dao_proposals').doc(proposalId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('안건을 찾을 수 없습니다');
  if (snap.data().status !== 'pending_admin') throw new Error('승인 대기 상태가 아닙니다');

  await ref.update({
    status:          'review',
    adminApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
    adminUid:        uid,
  });

  logger.info('dao.adminApproveProposal', { uid, proposalId });
  return { ok: true };
}

// ── 3. 안건 반려 (pending_admin → rejected) ───────────────────────
async function adminRejectProposal(uid, { proposalId, reason }) {
  await requireAdmin(uid);

  const ref  = db.collection('dao_proposals').doc(proposalId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('안건을 찾을 수 없습니다');
  if (snap.data().status !== 'pending_admin') throw new Error('승인 대기 상태가 아닙니다');

  await ref.update({
    status:    'rejected',
    closedAt:  admin.firestore.FieldValue.serverTimestamp(),
    rejectReason: reason?.trim() || '',
    adminUid:  uid,
  });

  logger.info('dao.adminRejectProposal', { uid, proposalId });
  return { ok: true };
}

// ── 4. 안건 지지 (review → 누적 25만 달성 시 voting 전환) ──────────
// 조건: JUMP 1개 이상 스테이킹, 중복 지지 불가
async function supportProposal(uid, { proposalId }) {
  const wallet = await getUserWallet(uid);
  const staked = await getStaked(wallet);

  if (staked < 1) throw new Error('JUMP 토큰을 스테이킹해야 지지할 수 있습니다');

  const proposalRef = db.collection('dao_proposals').doc(proposalId);
  const supportRef  = proposalRef.collection('supporters').doc(uid);

  let newStatus = null;

  await db.runTransaction(async (tx) => {
    const [proposalSnap, supportSnap] = await Promise.all([
      tx.get(proposalRef),
      tx.get(supportRef),
    ]);

    if (!proposalSnap.exists) throw new Error('안건을 찾을 수 없습니다');
    if (proposalSnap.data().status !== 'review') throw new Error('지지 가능한 상태가 아닙니다 (심의 중인 안건만 지지 가능)');
    if (supportSnap.exists) throw new Error('이미 지지한 안건입니다');

    const d = proposalSnap.data();
    const newSupportStaked = (d.supportStaked || 0) + staked;
    const newSupportCount  = (d.supportCount  || 0) + 1;

    tx.set(supportRef, {
      uid, wallet, stakedAmount: staked,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const update = { supportStaked: newSupportStaked, supportCount: newSupportCount };

    if (newSupportStaked >= TARGET_SUPPORT) {
      update.status          = 'voting';
      update.votingStartedAt = admin.firestore.FieldValue.serverTimestamp();
      newStatus = 'voting';
    }

    tx.update(proposalRef, update);
  });

  logger.info('dao.supportProposal', { uid, proposalId, staked, newStatus });
  return { ok: true, promoted: newStatus === 'voting' };
}

// ── 5. 투표 ──────────────────────────────────────────────────────
// 조건: JUMP 1개 이상 스테이킹, 중복 투표 불가
// 의결: 전체 스테이킹 수의 과반(>50%) 찬성 시 통과
async function voteProposal(uid, { proposalId, vote }) {
  if (!['yes', 'no'].includes(vote)) throw new Error('찬성(yes) 또는 반대(no)만 가능합니다');

  const wallet = await getUserWallet(uid);
  const staked = await getStaked(wallet);

  if (staked < MIN_VOTE) throw new Error('JUMP 토큰 1개 이상 스테이킹 필요합니다');

  const proposalRef = db.collection('dao_proposals').doc(proposalId);
  const voteRef     = proposalRef.collection('votes').doc(uid);

  await db.runTransaction(async (tx) => {
    const [proposalSnap, voteSnap] = await Promise.all([
      tx.get(proposalRef),
      tx.get(voteRef),
    ]);

    if (!proposalSnap.exists) throw new Error('안건을 찾을 수 없습니다');
    if (proposalSnap.data().status !== 'voting') throw new Error('투표 중인 안건이 아닙니다');
    if (voteSnap.exists) throw new Error('이미 투표한 안건입니다 (중복 투표 불가)');

    tx.set(voteRef, {
      uid, wallet, vote, stakedAmount: staked,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const d = proposalSnap.data();
    if (vote === 'yes') {
      tx.update(proposalRef, {
        voteYes:       (d.voteYes       || 0) + 1,
        voteYesStaked: (d.voteYesStaked || 0) + staked,
      });
    } else {
      tx.update(proposalRef, {
        voteNo:       (d.voteNo       || 0) + 1,
        voteNoStaked: (d.voteNoStaked || 0) + staked,
      });
    }
  });

  // 투표 후 과반 체크 (별도 트랜잭션)
  await checkVotingResult(proposalRef);

  logger.info('dao.voteProposal', { uid, proposalId, vote, staked });
  return { ok: true };
}

async function checkVotingResult(proposalRef) {
  const snap = await proposalRef.get();
  const d    = snap.data();
  if (d.status !== 'voting') return;

  // 전체 스테이킹 조회 (온체인)
  const bank        = getJumpBankContract(getProvider());
  const totalStaked = Number(await bank.totalStaked());
  if (totalStaked === 0) return;

  const majority = totalStaked / 2;

  if (d.voteYesStaked > majority) {
    await proposalRef.update({ status: 'passed',   closedAt: admin.firestore.FieldValue.serverTimestamp() });
    logger.info('dao.voteResult: passed', { proposalId: proposalRef.id, voteYesStaked: d.voteYesStaked, majority });
  } else if (d.voteNoStaked > majority) {
    await proposalRef.update({ status: 'rejected', closedAt: admin.firestore.FieldValue.serverTimestamp() });
    logger.info('dao.voteResult: rejected', { proposalId: proposalRef.id, voteNoStaked: d.voteNoStaked, majority });
  }
}

// ── 6. 댓글 ──────────────────────────────────────────────────────
// 조건: JUMP 1만개 이상 스테이킹
async function commentProposal(uid, { proposalId, content }) {
  if (!content?.trim()) throw new Error('댓글 내용을 입력해주세요');
  if (content.trim().length > 500) throw new Error('댓글은 500자 이내로 입력해주세요');

  const wallet = await getUserWallet(uid);
  const staked = await getStaked(wallet);

  if (staked < MIN_COMMENT) {
    throw new Error(`JUMP ${MIN_COMMENT.toLocaleString()}개 이상 스테이킹 필요 (현재: ${staked.toLocaleString()}개)`);
  }

  const proposalSnap = await db.collection('dao_proposals').doc(proposalId).get();
  if (!proposalSnap.exists) throw new Error('안건을 찾을 수 없습니다');
  if (proposalSnap.data().status === 'pending_admin') throw new Error('승인 대기 중인 안건에는 댓글을 달 수 없습니다');

  const ref = await db.collection('dao_proposals').doc(proposalId)
    .collection('comments').add({
      uid, wallet,
      content:   content.trim(),
      staked,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  logger.info('dao.commentProposal', { uid, proposalId, commentId: ref.id });
  return { commentId: ref.id };
}

module.exports = {
  createProposal,
  adminApproveProposal,
  adminRejectProposal,
  supportProposal,
  voteProposal,
  commentProposal,
};
