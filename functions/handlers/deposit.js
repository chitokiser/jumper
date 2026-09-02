'use strict';

const admin = require('firebase-admin');
const { requireAdmin } = require('../wallet/admin');

const db = admin.firestore();

// 은행 계좌 정보
const BANK_INFO = {
  bank: 'IM뱅크',
  account: '253-08-000869-7',
  holder: '신헌철',
};

const BANK_INFO_VND = {
  bank: 'TECHCOM BANK',
  account: '19037852768012',
  holder: '신헌철 (SHIN HEON CHEOL)',
};

const MIN_KRW = 10_000;

async function requestDeposit(uid, payload) {
  const { amountKrw, amountVnd, currency, depositorName, bank } = payload;
  let amount = 0;

  if (currency === "VND") {
    amount = Math.floor(Number(amountVnd));
    if (!amount || amount < 200000) {
      throw new Error(`최소 충전 금액은 200,000 VND 입니다`);
    }
  } else {
    amount = Math.floor(Number(amountKrw));
    if (!amount || amount < MIN_KRW) {
      throw new Error(`최소 충전 금액은 ${MIN_KRW.toLocaleString()}원입니다`);
    }
  }

  if (!depositorName || depositorName.trim().length < 2) {
    throw new Error('입금자명(2자 이상)을 입력해주세요');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const address = userSnap.data()?.wallet?.address || '-';

  const refCode = `DEP-${uid.slice(0, 8).toUpperCase()}-${Date.now()}`;

  const depositData = {
    uid,
    userAddress: address,
    depositorName: depositorName.trim(),
    currency: currency || "KRW",
    bank: bank || (currency === 'VND' ? BANK_INFO_VND.bank : BANK_INFO.bank),
    refCode,
    status: 'pending',
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    rateAtRequest: null,
  };

  if (currency === "VND") {
    depositData.amountVnd = amount;
    depositData.amountKrw = Math.floor(amount / 18.84); // VND to KRW estimate if VND was still used
  } else {
    depositData.amountKrw = amount;
    depositData.amountVnd = Math.floor(amount * 18.84);
  }

  await db.collection('deposits').doc(refCode).set(depositData);

  return {
    refCode,
    amountKrw: depositData.amountKrw,
    amountVnd: currency === "VND" ? amount : null,
    bankInfo: BANK_INFO,
    bankInfoVnd: BANK_INFO_VND,
    instruction: `입금자명을 "${depositorName.trim()}"으로 정확히 입력하세요. 참조코드: ${refCode}`,
    estimatedHex: depositData.amountKrw + ' KM', // For backward compat
    estimatedUsd: null,
    estimatedVnd: depositData.amountVnd ? depositData.amountVnd.toLocaleString() + ' VND' : null,
  };
}

async function approveDeposit(adminUid, refCode, overrideKrwRate = null, masterSecret = null) {
  await requireAdmin(adminUid);
  const depositRef = db.collection('deposits').doc(refCode);

  try {
    const depositData = await db.runTransaction(async (t) => {
      const depositSnap = await t.get(depositRef);
      if (!depositSnap.exists) throw new Error('입금 요청을 찾을 수 없습니다');

      const dep = depositSnap.data();
      if (dep.status !== 'pending' && dep.status !== 'processing') {
        throw new Error(`이미 처리된 요청입니다 (상태: ${dep.status})`);
      }

      // 유저 잔고(포인트) 업데이트 - KRW 입금액을 KM으로 추가
      const userRef = db.collection('users').doc(dep.uid);
      const userSnap = await t.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const currentPointVnd = Number(userData.pointBalanceVnd || 0);
      const addKm = Number(dep.amountKrw || 0);

      t.update(userRef, { pointBalanceVnd: currentPointVnd + addKm });

      // 입금 승인 처리
      const approvedData = {
        status: 'approved',
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: adminUid,
        rateAtApproval: overrideKrwRate ? { krwPerUsd: overrideKrwRate } : { note: '1:1 KRW to KM' }
      };
      t.update(depositRef, approvedData);

      return { addKm, usdAmount: 0, vndAmount: dep.amountVnd || 0 };
    });

    return {
      success: true,
      txHash: 'FIREBASE_NATIVE',
      hexDisplay: depositData.addKm.toLocaleString() + ' KM',
      usdAmount: depositData.usdAmount,
      vndAmount: depositData.vndAmount,
      vndDisplay: depositData.vndAmount.toLocaleString() + ' VND(추산)',
    };
  } catch (err) {
    if (err.message.includes('이미 처리된 요청')) throw err;
    await depositRef.update({
      status: 'pending',
      lastError: err.message,
      lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    throw new Error(`Firebase 내부 자산 충전 실패: ${err.message}`);
  }
}

async function listPendingDeposits(adminUid) {
  await requireAdmin(adminUid);

  const snap = await db.collection('deposits')
    .where('status', 'in', ['pending', 'processing'])
    .orderBy('requestedAt', 'desc')
    .limit(100)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      refCode: data.refCode,
      uid: data.uid,
      userAddress: data.userAddress,
      amountKrw: data.amountKrw,
      depositorName: data.depositorName,
      bank: data.bank,
      status: data.status,
      requestedAt: data.requestedAt?.toDate?.()?.toISOString?.() ?? null,
    };
  });
}

async function getDepositHistory(uid) {
  const snap = await db.collection('deposits')
    .where('uid', '==', uid)
    .orderBy('requestedAt', 'desc')
    .limit(50)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      refCode: data.refCode,
      amountKrw: data.amountKrw,
      hexDisplay: data.amountKrw ? data.amountKrw.toLocaleString() + ' KM' : '-',
      usdAmount: data.usdAmount ?? null,
      vndAmount: data.vndAmount ?? null,
      status: data.status,
      txHash: data.txHash ?? null,
      requestedAt: data.requestedAt?.toDate?.()?.toISOString?.() ?? null,
      approvedAt: data.approvedAt?.toDate?.()?.toISOString?.() ?? null,
    };
  });
}

module.exports = {
  requestDeposit,
  approveDeposit,
  listPendingDeposits,
  getDepositHistory,
};
