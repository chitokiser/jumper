
/**
 * payMerchantHexOnChain
 * 유저 수탁 지갑의 Point로 jumpPlatform.payMerchantHex() 호출
 * 흐름: KRW → Point wei 환산 → approve → payMerchantHex
 *
 * @param {string} uid          - Firebase Auth UID
 * @param {number} merchantId   - 가맹점 ID (온체인)
 * @param {number} amountKrw    - 결제 원화 금액
 * @param {string} masterSecret - WALLET_MASTER_SECRET
 * @returns {{ txHash, amountHex, amountKrw, merchantName }}
 */
async function payMerchantFirebase(uid, merchantId, amountKrw, { currency = 'KRW', amountVnd } = {}) {
  // 트랜잭션 대상: 유저, 가맹점, 가맹점소유주, 추천인(멘토), 잭팟 상태
  const db = admin.firestore();

  // 1. 환율 조회
  const { fetchExchangeRates } = require('../wallet/exchange');
  const rates = await fetchExchangeRates();

  // 결제할 기준 금액(VND) 계산
  let paymentVnd = 0;
  if (currency === 'VND' && amountVnd) {
    paymentVnd = Number(amountVnd);
    amountKrw = Math.round((paymentVnd / rates.vndPerUsd) * rates.krwPerUsd);
  } else {
    // KRW 기준일시 VND로 환산
    paymentVnd = Math.round((amountKrw / rates.krwPerUsd) * rates.vndPerUsd);
  }

  if (paymentVnd < 100) throw new Error('결제 금액이 너무 작습니다');

  // 트랜잭션 시작
  const result = await db.runTransaction(async (tx) => {
    // 문서 참조
    const userRef = db.collection('users').doc(uid);
    const merchantRef = db.collection('merchants').doc(String(merchantId));

    const buyerBpRef = db.collection('battle_players').doc(uid);
    const [userSnap, merchantSnap, bpSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(merchantRef),
      tx.get(buyerBpRef),
    ]);

    if (!userSnap.exists) throw new Error('유저 정보를 찾을 수 없습니다.');
    const userData = userSnap.data();

    // 유저 잔액 (VND 기준)
    const userBalanceVnd = Number(userData.pointBalanceVnd || 0);
    if (userBalanceVnd < paymentVnd) {
      throw new Error(`포인트가 부족합니다. (보유: ${userBalanceVnd.toLocaleString()} VND, 필요: ${paymentVnd.toLocaleString()} VND)`);
    }

    if (!merchantSnap.exists) throw new Error(`가맹점 ID ${merchantId}를 찾을 수 없습니다.`);
    const merchant = merchantSnap.data();
    if (merchant.active === false) throw new Error('비활성 가맹점입니다.');

    let merchantOwnerUid = merchant.ownerUid;
    if (!merchantOwnerUid) {
      throw new Error('가맹점 소유자의 UID 정보가 없습니다.');
    }
    const merchantOwnerRef = db.collection('users').doc(merchantOwnerUid);
    // merchantBalanceRef removed, sending directly to owner's pointBalanceVnd

    const [ownerSnap] = await Promise.all([tx.get(merchantOwnerRef)]);

    // 구매자의 멘토/그랜드멘토 정보
    const mentorUid = userData.mentorUid || null;
    let grandMentorUid = null;
    let mentorRef = null, grandMentorRef = null;
    let mentorSnap = null, grandMentorSnap = null;

    if (mentorUid) {
      mentorRef = db.collection('users').doc(mentorUid);
      mentorSnap = await tx.get(mentorRef);
      if (mentorSnap.exists) {
        grandMentorUid = mentorSnap.data().mentorUid || null;
        if (grandMentorUid) {
          grandMentorRef = db.collection('users').doc(grandMentorUid);
          grandMentorSnap = await tx.get(grandMentorRef);
        }
      }
    }

    // 잭팟 설정
    const jackpotRef = db.collection('jackpot_config').doc('current');
    const jackpotSnap = await tx.get(jackpotRef);
    const jackpotVnd = jackpotSnap.exists ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;

    // 플랫폼 잔고 설정
    const platformRef = db.collection('platform_config').doc('revenue');
    const platformSnap = await tx.get(platformRef);
    const platformVnd = platformSnap.exists ? Number(platformSnap.data().totalRevenueVnd || 0) : 0;

    // 수수료 계산
    const feeBps = Number(merchant.feeBps || 0);
    const feeVnd = Math.round((paymentVnd * feeBps) / 10000);
    // EXP
    let currentExp = typeof bpSnap !== 'undefined' && bpSnap.exists ? Number(bpSnap.data().gsExp || 0) : 0;
    let currentLevel = typeof bpSnap !== 'undefined' && bpSnap.exists ? Math.max(1, Number(bpSnap.data().gsLevel || 1)) : 1;
    let earnedExp = feeVnd; 
    currentExp += earnedExp;
    let requiredExp = Math.pow(currentLevel, 2) * 10000;
    while (currentExp >= requiredExp) { currentLevel++; requiredExp = Math.pow(currentLevel, 2) * 10000; }
    tx.set(buyerBpRef, { gsExp: currentExp, gsLevel: currentLevel, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const netVnd = paymentVnd - feeVnd;

    // 수수료 분배 체계
    let mentorBonusVnd = 0;
    let grandMentorBonusVnd = 0;
    let jackpotBonusVnd = Math.round(feeVnd * 0.30); // 30%
    let platformBonusVnd = Math.round(feeVnd * 0.40); // 40%

    let remainingVnd = feeVnd - jackpotBonusVnd - platformBonusVnd;

    if (mentorSnap && mentorSnap.exists) {
      mentorBonusVnd = Math.round(feeVnd * 0.20);
      remainingVnd -= mentorBonusVnd;
    } else {
      platformBonusVnd += Math.round(feeVnd * 0.20);
      remainingVnd -= Math.round(feeVnd * 0.20);
    }

    if (grandMentorSnap && grandMentorSnap.exists) {
      grandMentorBonusVnd = Math.round(feeVnd * 0.10);
      remainingVnd -= grandMentorBonusVnd;
    } else {
      platformBonusVnd += Math.round(feeVnd * 0.10);
      remainingVnd -= Math.round(feeVnd * 0.10);
    }

    // 단수 차이 보정 -> 전부 플랫폼으로 처리
    if (remainingVnd !== 0) {
      platformBonusVnd += remainingVnd;
    }

    // ====== DB 업데이트 ======
    // 1. 유저 출금 기록 (포인트 차감)
    tx.update(userRef, {
      pointBalanceVnd: userBalanceVnd - paymentVnd
    });

    const txBase = {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      currency: 'VND',
      amountVnd: paymentVnd,
      amountKrw,
      merchantId: Number(merchantId),
      merchantName: merchant.name || ''
    };

    // 2. 결제 내역(출금)
    const userTxRef = db.collection('transactions').doc();
    tx.set(userTxRef, {
      ...txBase,
      uid,
      type: 'pay_merchant',
    });

    // 3. 가맹점 정산
    const currentMerchantBal = ownerSnap.exists ? Number(ownerSnap.data().pointBalanceVnd || 0) : 0;
    tx.set(merchantOwnerRef, {
      pointBalanceVnd: currentMerchantBal + netVnd
    }, { merge: true });

    const merchantTxRef = db.collection('transactions').doc();
    tx.set(merchantTxRef, {
      ...txBase,
      uid: merchantOwnerUid,
      buyerUid: uid,
      type: 'merchant_income',
      netAmountVnd: netVnd,
      feeAmountVnd: feeVnd,
      feeBps,
    });

    // 4. 멘토 1대 지급
    if (mentorBonusVnd > 0 && mentorSnap && mentorSnap.exists) {
      tx.update(mentorRef, { pointBalance: admin.firestore.FieldValue.increment(mentorBonusVnd) });
      tx.set(db.collection('transactions').doc(), {
        uid: mentorUid,
        sourceUid: uid,
        merchantId: Number(merchantId),
        type: 'mentor_bonus_tier1',
        amountVnd: mentorBonusVnd,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // 5. 그랜드 멘토 2대 지급
    if (grandMentorBonusVnd > 0 && grandMentorSnap && grandMentorSnap.exists) {
      tx.update(grandMentorRef, { pointBalance: admin.firestore.FieldValue.increment(grandMentorBonusVnd) });
      tx.set(db.collection('transactions').doc(), {
        uid: grandMentorUid,
        sourceUid: uid,
        merchantId: Number(merchantId),
        type: 'mentor_bonus_tier2',
        amountVnd: grandMentorBonusVnd,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // 6. 잭팟 업데이트
    if (jackpotBonusVnd > 0) {