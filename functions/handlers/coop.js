// functions/handlers/coop.js
// 조합전용몰 — 접근 확인 / 상품 목록 / 구매 / 관리자 설정

'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { decrypt } = require('../wallet/crypto');
const {
  getProvider,
  getHexContract,
  getJumpBankContract,
  getCoopMallContract,
  getPlatformContract,
  COOP_MALL_ADDRESS,
  walletFromKey,
  getAdminWallet,
  estimateGasWithBuffer,
} = require('../wallet/chain');
const { requireAdmin } = require('../wallet/admin');

const db = admin.firestore();

// ─────────────────────────────────────────────
// 환율 (KRW → HEX wei)
// ─────────────────────────────────────────────
let _fxCache = { rate: 0, ts: 0 };
const FX_TTL_MS = 600_000;

async function fetchUsdKrwRate() {
  if (_fxCache.rate > 0 && Date.now() - _fxCache.ts < FX_TTL_MS) return _fxCache.rate;
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    const rate = data?.rates?.KRW ?? 0;
    if (rate > 0) _fxCache = { rate, ts: Date.now() };
    return rate;
  } catch {
    return _fxCache.rate || 1370;
  }
}

function krwToHexWei(krwAmount, krwPerUsd) {
  const krwScaled  = BigInt(Math.round(krwAmount * 10000));
  const rateScaled = BigInt(Math.round(krwPerUsd * 10000));
  return (krwScaled * (10n ** 18n)) / rateScaled;
}

// ─────────────────────────────────────────────
// 내부 헬퍼: 접근 권한 확인
// ─────────────────────────────────────────────
async function getCoopAccess(uid) {
  const configSnap = await db.collection('coopConfig').doc('main').get();
  const minStake   = configSnap.exists ? (configSnap.data()?.minStake ?? 10000) : 10000;

  const userSnap = await db.collection('users').doc(uid).get();
  const address  = userSnap.data()?.wallet?.address || null;

  let userStaked = 0;
  if (address) {
    try {
      const jumpBank = getJumpBankContract(getProvider());
      const userInfo = await jumpBank.user(address);
      userStaked     = Number(userInfo.depo);
    } catch (_) {}
  }

  return { minStake, userStaked, hasAccess: userStaked >= minStake };
}

// ─────────────────────────────────────────────
// 1. 상품 목록 조회 (접근 여부 포함)
// ─────────────────────────────────────────────
async function listCoopProducts(uid) {
  const access = await getCoopAccess(uid);

  const snap = await db.collection('coopProducts')
    .where('active', '==', true)
    .get();

  const products = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  return {
    products,
    minStake:   access.minStake,
    userStaked: access.userStaked,
    hasAccess:  access.hasAccess,
  };
}

// ─────────────────────────────────────────────
// 2. 상품 구매
// ─────────────────────────────────────────────
async function buyCoopProduct(uid, { productId }, masterSecret) {
  const access = await getCoopAccess(uid);
  if (!access.hasAccess) {
    throw new Error(
      `스테이킹 부족. 최소 ${access.minStake.toLocaleString()}개 필요, ` +
      `현재 ${access.userStaked.toLocaleString()}개`
    );
  }

  const productSnap = await db.collection('coopProducts').doc(productId).get();
  if (!productSnap.exists) throw new Error('상품이 존재하지 않습니다');
  const product = productSnap.data();
  if (!product.active)    throw new Error('판매 중인 상품이 아닙니다');
  if (product.stock === 0) throw new Error('품절된 상품입니다');

  const usdKrwRate = await fetchUsdKrwRate();
  const hexWei     = krwToHexWei(product.price, usdKrwRate || 1370);

  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const hexRead  = getHexContract(provider);
  const hexBal   = await hexRead.balanceOf(walletData.address);
  if (hexBal < hexWei) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    const need = parseFloat(ethers.formatEther(hexWei)).toFixed(4);
    throw new Error(`HEX 잔액 부족. 필요: ${need} HEX, 보유: ${have} HEX`);
  }

  // BNB 가스비 보충
  const adminWallet = getAdminWallet();
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({
      to: walletData.address, value: ethers.parseEther('0.0001'),
    });
    await fundTx.wait();
  }

  // HEX 전송 (수탁 지갑 → 관리자 지갑)
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const hexSigned  = getHexContract(signer);
  const gasLimit   = await estimateGasWithBuffer(hexSigned, 'transfer', [adminWallet.address, hexWei]);
  const tx         = await hexSigned.transfer(adminWallet.address, hexWei, { gasLimit });
  const receipt    = await tx.wait();
  const txHash     = receipt.hash;

  const batch = db.batch();

  batch.set(db.collection('coopOrders').doc(), {
    uid,
    productId,
    productName: product.name,
    priceKrw:    product.price,
    hexWei:      hexWei.toString(),
    txHash,
    status:      'confirmed',
    type:        product.type || 'general',
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  if (product.stock > 0) {
    batch.update(db.collection('coopProducts').doc(productId), {
      stock: admin.firestore.FieldValue.increment(-1),
    });
  }

  // 바우처 상품인 경우 coopVouchers 컬렉션에도 저장 → 마이페이지 바우처 지갑에서 조회 가능
  if (product.type === 'voucher') {
    const userSnap2 = await db.collection('users').doc(uid).get();
    const addr = userSnap2.data()?.wallet?.address || '';
    batch.set(db.collection('coopVouchers').doc(), {
      source:       'product',        // 온체인 바우처와 구분
      productId,
      ownerUid:     uid,
      ownerAddress: addr,
      hexPrice:     hexWei.toString(),
      burnFeeBps:   product.burnFeeBps ?? 0,
      description:  product.description || product.name,
      usagePlace:   product.usagePlace  || '',
      imageUrl:     product.imageUrl    || '',
      txHash,
      status:       'active',
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  return {
    txHash,
    productName: product.name,
    priceKrw:    product.price,
    hexWei:      hexWei.toString(),
    amountHex:   parseFloat(ethers.formatEther(hexWei)).toFixed(4),
  };
}

// ─────────────────────────────────────────────
// 3. 관리자: 설정 변경
// ─────────────────────────────────────────────
async function adminSetCoopConfig(uid, { minStake }) {
  await requireAdmin(uid);
  const val = Number(minStake);
  if (!Number.isFinite(val) || val < 0) throw new Error('유효하지 않은 minStake 값');
  await db.collection('coopConfig').doc('main').set({
    minStake: val,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: uid,
  });
  return { minStake: val };
}

// ─────────────────────────────────────────────
// 4. 관리자: 상품 등록/수정
// ─────────────────────────────────────────────
async function adminSaveCoopProduct(uid, data) {
  await requireAdmin(uid);
  const { id, type, name, description, price, imageUrl, stock, active, burnFeeBps } = data;
  if (!name || !String(name).trim()) throw new Error('상품명이 필요합니다');
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) throw new Error('유효하지 않은 가격');
  const stockNum = Number(stock);
  if (!Number.isFinite(stockNum) || stockNum < -1) throw new Error('유효하지 않은 재고 (-1=무제한)');
  const typeVal  = type === 'voucher' ? 'voucher' : 'general';
  const burnFeeNum = typeVal === 'voucher' ? Math.min(10000, Math.max(0, Math.round(Number(burnFeeBps) || 0))) : 0;

  const docData = {
    type:        typeVal,
    name:        String(name).trim(),
    description: description ? String(description).trim() : '',
    price:       Math.round(priceNum),
    imageUrl:    imageUrl    ? String(imageUrl).trim()    : '',
    stock:       Math.round(stockNum),
    active:      active !== false,
    burnFeeBps:  burnFeeNum,
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    updatedBy:   uid,
  };

  if (id) {
    await db.collection('coopProducts').doc(id).update(docData);
    return { id };
  }
  docData.createdAt = admin.firestore.FieldValue.serverTimestamp();
  docData.createdBy = uid;
  const ref = await db.collection('coopProducts').add(docData);
  return { id: ref.id };
}

// ─────────────────────────────────────────────
// 5. 관리자: 상품 삭제
// ─────────────────────────────────────────────
async function adminDeleteCoopProduct(uid, { id }) {
  await requireAdmin(uid);
  if (!id) throw new Error('상품 ID가 필요합니다');
  await db.collection('coopProducts').doc(id).delete();
  return { id };
}

// ─────────────────────────────────────────────
// 6. CoopMall 온체인 회원 정보 조회
// ─────────────────────────────────────────────
async function coopGetMembership(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.address) return { hasWallet: false };

  const provider = getProvider();
  const coopMall  = getCoopMallContract(provider);
  const platform  = getPlatformContract(provider);

  const [info, feeHex, fxKrw, fxVnd, fxScale] = await Promise.all([
    coopMall.getUserInfo(walletData.address),
    coopMall.membershipFeeHex(),
    platform.fxKrwPerHexScaled(),
    platform.fxVndPerHexScaled(),
    platform.fxScale(),
  ]);

  return {
    hasWallet: true,
    address: walletData.address,
    eligible: info.eligible,
    member: info.member,
    mentor: info.mentor,
    pointsWei: info.points.toString(),
    membershipFeeHex: feeHex.toString(),
    fxKrwPerHexScaled: fxKrw.toString(),
    fxVndPerHexScaled: fxVnd.toString(),
    fxScale: Number(fxScale),
  };
}

// ─────────────────────────────────────────────
// 7. CoopMall 회비 납부 (회원가입)
//    - eligible 여부와 무관하게 누구나 가입 가능
//    - 서버에서 grantEligibility 자동 처리 (멘토는 플랫폼에서 자동 조회)
// ─────────────────────────────────────────────
async function coopJoinMall(uid, masterSecret) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const coopMall = getCoopMallContract(provider);

  const info = await coopMall.getUserInfo(walletData.address);
  if (info.member) throw new Error('이미 전용몰 회원입니다');

  const fee = await coopMall.membershipFeeHex();

  const hexRead = getHexContract(provider);
  const hexBal = await hexRead.balanceOf(walletData.address);
  if (hexBal < fee) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    const need = parseFloat(ethers.formatEther(fee)).toFixed(4);
    throw new Error(`HEX 잔액 부족. 필요: ${need} HEX, 보유: ${have} HEX`);
  }

  const adminWallet = getAdminWallet();

  // eligible 아닌 경우 자동으로 grantEligibility 호출 (멘토: 플랫폼 컨트랙트에서 조회)
  if (!info.eligible) {
    let mentorAddr = '0x0000000000000000000000000000000000000000';
    try {
      const platform = getPlatformContract(provider);
      const memberInfo = await platform.members(walletData.address);
      if (memberInfo.mentor && memberInfo.mentor !== walletData.address) {
        mentorAddr = memberInfo.mentor;
      }
    } catch (_) {}

    const coopAdmin = getCoopMallContract(adminWallet);
    const grantGas = await estimateGasWithBuffer(coopAdmin, 'grantEligibility', [walletData.address, mentorAddr]);
    const grantTx = await coopAdmin.grantEligibility(walletData.address, mentorAddr, { gasLimit: grantGas });
    await grantTx.wait();
  }

  // 가스비 보충
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({
      to: walletData.address, value: ethers.parseEther('0.0001'),
    });
    await fundTx.wait();
  }

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer = walletFromKey(privateKey, provider);
  const hexSigned = getHexContract(signer);
  const coopSigned = getCoopMallContract(signer);

  const allowance = await hexSigned.allowance(walletData.address, COOP_MALL_ADDRESS);
  if (allowance < fee) {
    const approveTx = await hexSigned.approve(COOP_MALL_ADDRESS, fee, { gasLimit: 80000n });
    await approveTx.wait();
  }

  const gasLimit = await estimateGasWithBuffer(coopSigned, 'joinMall', []);
  const tx = await coopSigned.joinMall({ gasLimit });
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    feeHex: parseFloat(ethers.formatEther(fee)).toFixed(4),
  };
}

// ─────────────────────────────────────────────
// 8. CoopMall 상품 구매 (온체인 pay)
// ─────────────────────────────────────────────
async function coopBuyOnChain(uid, { productId }, masterSecret) {
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const coopMall = getCoopMallContract(provider);

  const info = await coopMall.getUserInfo(walletData.address);
  if (!info.member) throw new Error('전용몰 회원이 아닙니다');

  const productSnap = await db.collection('coopProducts').doc(productId).get();
  if (!productSnap.exists) throw new Error('상품이 존재하지 않습니다');
  const product = productSnap.data();
  if (!product.active) throw new Error('판매 중인 상품이 아닙니다');
  if (product.stock === 0) throw new Error('품절된 상품입니다');

  const usdKrwRate = await fetchUsdKrwRate();
  const hexWei = krwToHexWei(product.price, usdKrwRate || 1370);

  const hexRead = getHexContract(provider);
  const hexBal = await hexRead.balanceOf(walletData.address);
  if (hexBal < hexWei) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    const need = parseFloat(ethers.formatEther(hexWei)).toFixed(4);
    throw new Error(`HEX 잔액 부족. 필요: ${need} HEX, 보유: ${have} HEX`);
  }

  const adminWallet = getAdminWallet();
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({
      to: walletData.address, value: ethers.parseEther('0.0001'),
    });
    await fundTx.wait();
  }

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer = walletFromKey(privateKey, provider);
  const hexSigned = getHexContract(signer);
  const coopSigned = getCoopMallContract(signer);

  const allowance = await hexSigned.allowance(walletData.address, COOP_MALL_ADDRESS);
  if (allowance < hexWei) {
    const approveTx = await hexSigned.approve(COOP_MALL_ADDRESS, hexWei, { gasLimit: 80000n });
    await approveTx.wait();
  }

  const gasLimit = await estimateGasWithBuffer(coopSigned, 'pay', [hexWei]);
  const tx = await coopSigned.pay(hexWei, { gasLimit });
  const receipt = await tx.wait();
  const txHash = receipt.hash;

  const batch = db.batch();
  batch.set(db.collection('coopOrders').doc(), {
    uid,
    productId,
    productName: product.name,
    type: product.type || 'general',
    priceKrw: product.price,
    hexWei: hexWei.toString(),
    txHash,
    status: 'confirmed',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (product.stock > 0) {
    batch.update(db.collection('coopProducts').doc(productId), {
      stock: admin.firestore.FieldValue.increment(-1),
    });
  }
  // 바우처 상품이면 coopVouchers에도 기록
  if (product.type === 'voucher') {
    const addr = userSnap.data()?.wallet?.address || '';
    batch.set(db.collection('coopVouchers').doc(), {
      source:       'product',
      productId,
      ownerUid:     uid,
      ownerAddress: addr,
      hexPrice:     hexWei.toString(),
      burnFeeBps:   product.burnFeeBps ?? 0,
      description:  product.description || product.name,
      usagePlace:   product.usagePlace  || '',
      imageUrl:     product.imageUrl    || '',
      txHash,
      status:       'active',
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  return {
    txHash,
    productName: product.name,
    priceKrw: product.price,
    hexWei: hexWei.toString(),
    amountHex: parseFloat(ethers.formatEther(hexWei)).toFixed(4),
  };
}

// ─────────────────────────────────────────────
// 9. CoopMall 포인트 → HEX 전환
// ─────────────────────────────────────────────
async function coopConvertPoints(uid, { ptsWei }, masterSecret) {
  if (!ptsWei || BigInt(ptsWei) <= 0n) throw new Error('전환할 포인트를 입력하세요');

  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const coopMall = getCoopMallContract(provider);

  const info = await coopMall.getUserInfo(walletData.address);
  if (!info.member) throw new Error('전용몰 회원이 아닙니다');
  if (info.points < BigInt(ptsWei)) throw new Error('포인트가 부족합니다');

  const adminWallet = getAdminWallet();
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({
      to: walletData.address, value: ethers.parseEther('0.0001'),
    });
    await fundTx.wait();
  }

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer = walletFromKey(privateKey, provider);
  const coopSigned = getCoopMallContract(signer);

  const gasLimit = await estimateGasWithBuffer(coopSigned, 'convertPoints', [BigInt(ptsWei)]);
  const tx = await coopSigned.convertPoints(BigInt(ptsWei), { gasLimit });
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    ptsWei,
    hexAmount: parseFloat(ethers.formatEther(BigInt(ptsWei))).toFixed(4),
  };
}

// ─────────────────────────────────────────────
// 10. 관리자: 입장 자격 부여
// ─────────────────────────────────────────────
async function coopAdminGrantEligibility(uid, { userAddress, mentorAddress }) {
  await requireAdmin(uid);
  if (!userAddress) throw new Error('userAddress가 필요합니다');

  const adminWallet = getAdminWallet();
  const coopMall = getCoopMallContract(adminWallet);
  const mentor = mentorAddress || '0x0000000000000000000000000000000000000000';

  const gasLimit = await estimateGasWithBuffer(coopMall, 'grantEligibility', [userAddress, mentor]);
  const tx = await coopMall.grantEligibility(userAddress, mentor, { gasLimit });
  const receipt = await tx.wait();

  return { txHash: receipt.hash, userAddress, mentorAddress: mentor };
}

// ─────────────────────────────────────────────
// 11. 관리자: 컨트랙트 잔고 조회
// ─────────────────────────────────────────────
async function coopAdminGetStats(uid) {
  await requireAdmin(uid);
  const provider = getProvider();
  const coopMall   = getCoopMallContract(provider);
  const platform   = getPlatformContract(provider);

  const [hexBal, jumpBal, withdrawable, totalPts, feeWei, mentorBps, jumpPriceWei,
         fxKrw, fxVnd, fxScale] = await Promise.all([
    coopMall.contractHexBalance(),
    coopMall.contractJumpBalance(),
    coopMall.withdrawableHex(),
    coopMall.totalPoints(),
    coopMall.membershipFeeHex(),
    coopMall.mentorRewardBps(),
    coopMall.jumpPrice(),
    platform.fxKrwPerHexScaled(),
    platform.fxVndPerHexScaled(),
    platform.fxScale(),
  ]);

  return {
    hexBalance:       hexBal.toString(),
    jumpBalance:      jumpBal.toString(),
    withdrawableHex:  withdrawable.toString(),
    totalPoints:      totalPts.toString(),
    membershipFeeHex: feeWei.toString(),
    mentorRewardBps:  Number(mentorBps),
    jumpPrice:        jumpPriceWei.toString(),
    fxKrwPerHexScaled: fxKrw.toString(),
    fxVndPerHexScaled: fxVnd.toString(),
    fxScale:           Number(fxScale),
  };
}

// ─────────────────────────────────────────────
// 11b. 관리자: 주문 상태 업데이트
// ─────────────────────────────────────────────
const ORDER_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

async function coopAdminUpdateOrder(uid, { orderId, status, note }) {
  await requireAdmin(uid);
  if (!orderId) throw new Error('orderId가 필요합니다');
  if (status && !ORDER_STATUSES.includes(status)) throw new Error('유효하지 않은 상태입니다');

  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (status) update.status = status;
  if (note !== undefined) update.adminNote = note;

  await db.collection('coopOrders').doc(orderId).update(update);
  return { orderId, status, note };
}

// ─────────────────────────────────────────────
// 12. 관리자: HEX 인출
// ─────────────────────────────────────────────
async function coopAdminWithdrawHex(uid, { amountWei }) {
  await requireAdmin(uid);
  if (!amountWei || BigInt(amountWei) <= 0n) throw new Error('인출 금액을 입력하세요');

  const adminWallet = getAdminWallet();
  const coopMall = getCoopMallContract(adminWallet);

  const gasLimit = await estimateGasWithBuffer(coopMall, 'withdrawHex', [BigInt(amountWei)]);
  const tx = await coopMall.withdrawHex(BigInt(amountWei), { gasLimit });
  const receipt = await tx.wait();

  return { txHash: receipt.hash, amountWei };
}

// ─────────────────────────────────────────────
// 13. 관리자: JUMP 인출
// ─────────────────────────────────────────────
async function coopAdminWithdrawJump(uid, { amount }) {
  await requireAdmin(uid);
  if (!amount || BigInt(amount) <= 0n) throw new Error('인출 수량을 입력하세요');

  const adminWallet = getAdminWallet();
  const coopMall = getCoopMallContract(adminWallet);

  const gasLimit = await estimateGasWithBuffer(coopMall, 'withdrawJump', [BigInt(amount)]);
  const tx = await coopMall.withdrawJump(BigInt(amount), { gasLimit });
  const receipt = await tx.wait();

  return { txHash: receipt.hash, amount };
}

// ─────────────────────────────────────────────
// 14. 관리자: 회비/멘토수당 설정
// ─────────────────────────────────────────────
async function coopAdminSetFee(uid, { feeWei, mentorBps }) {
  await requireAdmin(uid);
  const adminWallet = getAdminWallet();
  const coopMall = getCoopMallContract(adminWallet);

  const results = {};

  if (feeWei !== undefined) {
    const gasLimit = await estimateGasWithBuffer(coopMall, 'setMembershipFee', [BigInt(feeWei)]);
    const tx = await coopMall.setMembershipFee(BigInt(feeWei), { gasLimit });
    const receipt = await tx.wait();
    results.feeTxHash = receipt.hash;
  }
  if (mentorBps !== undefined) {
    const gasLimit = await estimateGasWithBuffer(coopMall, 'setMentorRewardBps', [Number(mentorBps)]);
    const tx = await coopMall.setMentorRewardBps(Number(mentorBps), { gasLimit });
    const receipt = await tx.wait();
    results.bpsTxHash = receipt.hash;
  }

  return results;
}

// ─────────────────────────────────────────────
// 15. 관리자: 바우처 템플릿 생성 (온체인 + Firestore)
// ─────────────────────────────────────────────
async function coopAdminCreateVoucher(uid, { hexPrice, burnFeeBps, description, usagePlace, imageUrl }) {
  await requireAdmin(uid);
  if (!hexPrice || BigInt(hexPrice) <= 0n) throw new Error('hexPrice가 필요합니다');
  const bps = Number(burnFeeBps ?? 0);
  if (bps < 0 || bps > 10000) throw new Error('burnFeeBps는 0~10000 범위여야 합니다');

  const adminWallet = getAdminWallet();
  const coopMall    = getCoopMallContract(adminWallet);

  const gasLimit = await estimateGasWithBuffer(coopMall, 'createVoucherTemplate', [
    BigInt(hexPrice), bps,
    String(description || ''), String(usagePlace || ''), String(imageUrl || ''),
  ]);
  const tx = await coopMall.createVoucherTemplate(
    BigInt(hexPrice), bps,
    String(description || ''), String(usagePlace || ''), String(imageUrl || ''),
    { gasLimit }
  );
  const receipt = await tx.wait();

  // templateId = voucherTemplateCount - 1 after creation; read from event
  let templateId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = coopMall.interface.parseLog(log);
      if (parsed?.name === 'VoucherTemplateCreated') {
        templateId = Number(parsed.args.templateId);
        break;
      }
    } catch (_) {}
  }

  await db.collection('coopVoucherTemplates').add({
    templateId,
    hexPrice:    hexPrice.toString(),
    burnFeeBps:  bps,
    description: description || '',
    usagePlace:  usagePlace || '',
    imageUrl:    imageUrl || '',
    active:      true,
    txHash:      receipt.hash,
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    createdBy:   uid,
  });

  return { templateId, txHash: receipt.hash };
}

// ─────────────────────────────────────────────
// 16. 관리자: 바우처 템플릿 수정 (소각 수수료 / 활성 상태)
// ─────────────────────────────────────────────
async function coopAdminUpdateVoucher(uid, { templateId, burnFeeBps, active }) {
  await requireAdmin(uid);
  if (templateId == null) throw new Error('templateId가 필요합니다');

  const adminWallet = getAdminWallet();
  const coopMall    = getCoopMallContract(adminWallet);
  const results     = {};

  if (burnFeeBps !== undefined) {
    const bps = Number(burnFeeBps);
    const gasLimit = await estimateGasWithBuffer(coopMall, 'setVoucherBurnFee', [Number(templateId), bps]);
    const tx = await coopMall.setVoucherBurnFee(Number(templateId), bps, { gasLimit });
    const r  = await tx.wait();
    results.feeTxHash = r.hash;
  }
  if (active !== undefined) {
    const gasLimit = await estimateGasWithBuffer(coopMall, 'setVoucherTemplateActive', [Number(templateId), !!active]);
    const tx = await coopMall.setVoucherTemplateActive(Number(templateId), !!active, { gasLimit });
    const r  = await tx.wait();
    results.activeTxHash = r.hash;
  }

  // Firestore 동기화
  const snap = await db.collection('coopVoucherTemplates')
    .where('templateId', '==', Number(templateId)).limit(1).get();
  if (!snap.empty) {
    const upd = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (burnFeeBps !== undefined) upd.burnFeeBps = Number(burnFeeBps);
    if (active !== undefined) upd.active = !!active;
    await snap.docs[0].ref.update(upd);
  }

  return { templateId, ...results };
}

// ─────────────────────────────────────────────
// 17. 관리자: 바우처 목록 조회 (Firestore)
// ─────────────────────────────────────────────
async function coopAdminListVouchers(uid) {
  await requireAdmin(uid);
  const [tmplSnap, vSnap] = await Promise.all([
    db.collection('coopVoucherTemplates').orderBy('createdAt', 'desc').get(),
    db.collection('coopVouchers').orderBy('createdAt', 'desc').limit(200).get(),
  ]);
  return {
    templates: tmplSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    vouchers:  vSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

// ─────────────────────────────────────────────
// 18. 유저: 바우처 구매 (온체인 buyVoucher + Firestore)
// ─────────────────────────────────────────────
async function coopBuyVoucher(uid, { templateId }, masterSecret) {
  if (templateId == null) throw new Error('templateId가 필요합니다');

  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const coopMall = getCoopMallContract(provider);
  const tmpl     = await coopMall.voucherTemplates(Number(templateId));
  if (!tmpl.active) throw new Error('비활성 바우처 템플릿입니다');
  const hexPrice = tmpl.hexPrice;

  const hexRead = getHexContract(provider);
  const hexBal  = await hexRead.balanceOf(walletData.address);
  if (hexBal < hexPrice) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    const need = parseFloat(ethers.formatEther(hexPrice)).toFixed(4);
    throw new Error(`HEX 잔액 부족. 필요: ${need} HEX, 보유: ${have} HEX`);
  }

  const adminWallet = getAdminWallet();
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({ to: walletData.address, value: ethers.parseEther('0.0001') });
    await fundTx.wait();
  }

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const hexSigned  = getHexContract(signer);
  const coopSigned = getCoopMallContract(signer);

  const allowance = await hexSigned.allowance(walletData.address, COOP_MALL_ADDRESS);
  if (allowance < hexPrice) {
    const approveTx = await hexSigned.approve(COOP_MALL_ADDRESS, hexPrice, { gasLimit: 80000n });
    await approveTx.wait();
  }

  const gasLimit = await estimateGasWithBuffer(coopSigned, 'buyVoucher', [Number(templateId)]);
  const tx       = await coopSigned.buyVoucher(Number(templateId), { gasLimit });
  const receipt  = await tx.wait();

  // voucherId from event
  let voucherId = null;
  const iface = getCoopMallContract(provider).interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'VoucherBought') { voucherId = Number(parsed.args.voucherId); break; }
    } catch (_) {}
  }

  // Firestore 기록
  const tmplSnap = await db.collection('coopVoucherTemplates')
    .where('templateId', '==', Number(templateId)).limit(1).get();
  const tmplData = tmplSnap.empty ? {} : tmplSnap.docs[0].data();

  await db.collection('coopVouchers').add({
    voucherId,
    templateId: Number(templateId),
    ownerUid:   uid,
    ownerAddress: walletData.address,
    hexPrice:   hexPrice.toString(),
    burnFeeBps: Number(tmpl.burnFeeBps),
    description: tmplData.description || '',
    usagePlace:  tmplData.usagePlace  || '',
    imageUrl:    tmplData.imageUrl    || '',
    status:      'active',
    txHash:      receipt.hash,
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    voucherId,
    txHash: receipt.hash,
    hexAmount: parseFloat(ethers.formatEther(hexPrice)).toFixed(4),
  };
}

// ─────────────────────────────────────────────
// 19. 유저: 바우처 이체 (온체인 NFT 또는 상품 바우처 Firestore-only)
// ─────────────────────────────────────────────
async function coopTransferVoucher(uid, { docId, voucherId, toAddress }, masterSecret) {
  if (!toAddress) throw new Error('toAddress가 필요합니다');

  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.address) throw new Error('수탁 지갑이 없습니다');

  // 수신자 UID 조회
  const recipientSnap = await db.collection('users').where('wallet.address', '==', toAddress).limit(1).get();
  const recipientUid  = recipientSnap.empty ? null : recipientSnap.docs[0].id;

  // ── 상품 바우처: Firestore-only 이체 ───────────────────────────────
  if (!voucherId && docId) {
    // coopVouchers 먼저 조회, 없으면 coopOrders fallback (구매 수정 전 구매 건)
    let data, docRef, isOrderSource = false;
    const vRef  = db.collection('coopVouchers').doc(docId);
    const vSnap = await vRef.get();
    if (vSnap.exists) {
      data    = vSnap.data();
      docRef  = vRef;
    } else {
      const oRef  = db.collection('coopOrders').doc(docId);
      const oSnap = await oRef.get();
      if (!oSnap.exists) throw new Error('바우처가 존재하지 않습니다');
      data           = oSnap.data();
      docRef         = oRef;
      isOrderSource  = true;
    }

    const ownerCheck = isOrderSource ? data.uid : data.ownerUid;
    if (ownerCheck !== uid) throw new Error('바우처 소유자가 아닙니다');
    if (!isOrderSource && data.status !== 'active') throw new Error('이미 사용된 바우처입니다');
    if (isOrderSource && data.status !== 'confirmed') throw new Error('이미 사용된 바우처입니다');

    // 상품 정보 보완 (coopOrders에는 일부 필드가 없을 수 있음)
    let productExtra = {};
    if (isOrderSource && data.productId) {
      const pSnap = await db.collection('coopProducts').doc(data.productId).get();
      if (pSnap.exists) productExtra = pSnap.data();
    }

    const batch = db.batch();
    // 기존 문서 상태 업데이트
    batch.update(docRef, {
      status: 'transferred', toAddress,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // 수신자에게 새 coopVouchers 문서 생성
    batch.set(db.collection('coopVouchers').doc(), {
      source:       'product',
      productId:    data.productId || productExtra.id || null,
      ownerUid:     recipientUid,
      ownerAddress: toAddress,
      hexPrice:     isOrderSource ? (data.hexWei || '0') : (data.hexPrice || '0'),
      burnFeeBps:   data.burnFeeBps ?? 0,
      description:  data.productName || productExtra.description || data.description || '',
      usagePlace:   productExtra.usagePlace || data.usagePlace || '',
      imageUrl:     productExtra.imageUrl   || data.imageUrl   || '',
      status:       'active',
      fromUid:      uid,
      fromAddress:  walletData.address,
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { docId, toAddress, txHash: null };
  }

  // ── 온체인 NFT 바우처 이체 ─────────────────────────────────────────
  if (!walletData.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const coopMall = getCoopMallContract(provider);
  const vInfo    = await coopMall.vouchers(Number(voucherId));

  if (vInfo.owner.toLowerCase() !== walletData.address.toLowerCase())
    throw new Error('바우처 소유자가 아닙니다');
  if (vInfo.burned) throw new Error('이미 소각된 바우처입니다');

  const adminWallet = getAdminWallet();
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({ to: walletData.address, value: ethers.parseEther('0.0001') });
    await fundTx.wait();
  }

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const coopSigned = getCoopMallContract(signer);

  const gasLimit = await estimateGasWithBuffer(coopSigned, 'transferVoucher', [Number(voucherId), toAddress]);
  const tx       = await coopSigned.transferVoucher(Number(voucherId), toAddress, { gasLimit });
  const receipt  = await tx.wait();

  // Firestore: 이전 소유자 문서 상태 업데이트
  const snap = await db.collection('coopVouchers')
    .where('voucherId', '==', Number(voucherId)).where('ownerUid', '==', uid).limit(1).get();
  const origData = snap.empty ? {} : snap.docs[0].data();
  if (!snap.empty) {
    await snap.docs[0].ref.update({
      status: 'transferred', toAddress,
      transferTxHash: receipt.hash,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await db.collection('coopVouchers').add({
    voucherId:     Number(voucherId),
    templateId:    origData.templateId,
    ownerUid:      recipientUid,
    ownerAddress:  toAddress,
    hexPrice:      origData.hexPrice,
    burnFeeBps:    origData.burnFeeBps,
    description:   origData.description || '',
    usagePlace:    origData.usagePlace  || '',
    imageUrl:      origData.imageUrl    || '',
    status:        'active',
    txHash:        receipt.hash,
    fromUid:       uid,
    fromAddress:   walletData.address,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
  });

  return { voucherId, txHash: receipt.hash, toAddress };
}

// ─────────────────────────────────────────────
// 20. 유저: 바우처 소각 → HEX 환급
//     - 온체인 NFT 바우처: burnVoucher() 호출 (컨트랙트가 HEX 반환)
//     - 상품 바우처: admin 지갑에서 직접 HEX 전송
// ─────────────────────────────────────────────
async function coopBurnVoucher(uid, { docId, voucherId }, masterSecret) {
  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.address) throw new Error('수탁 지갑이 없습니다');

  const provider    = getProvider();
  const adminWallet = getAdminWallet();

  // ── 상품 바우처: admin 지갑 → 유저 지갑 HEX 직접 전송 ────────────
  if (!voucherId && docId) {
    // coopVouchers 먼저 조회, 없으면 coopOrders fallback
    let data, docRef, isOrderSource = false;
    const vRef  = db.collection('coopVouchers').doc(docId);
    const vSnap = await vRef.get();
    if (vSnap.exists) {
      data   = vSnap.data();
      docRef = vRef;
    } else {
      const oRef  = db.collection('coopOrders').doc(docId);
      const oSnap = await oRef.get();
      if (!oSnap.exists) throw new Error('바우처가 존재하지 않습니다');
      data          = oSnap.data();
      docRef        = oRef;
      isOrderSource = true;
    }

    const ownerCheck = isOrderSource ? data.uid : data.ownerUid;
    if (ownerCheck !== uid) throw new Error('바우처 소유자가 아닙니다');
    if (!isOrderSource && data.status !== 'active')    throw new Error('이미 사용된 바우처입니다');
    if (isOrderSource  && data.status !== 'confirmed') throw new Error('이미 사용된 바우처입니다');

    const rawHex     = isOrderSource ? (data.hexWei || '0') : (data.hexPrice || '0');
    const hexWei     = BigInt(rawHex);
    // burnFeeBps: 문서에 저장된 값 사용, 0이면 productId로 상품에서 재조회
    let burnFeeRaw = Number(data.burnFeeBps ?? 0);
    if (burnFeeRaw === 0 && data.productId) {
      const prodSnap = await db.collection('coopProducts').doc(data.productId).get();
      if (prodSnap.exists) burnFeeRaw = Number(prodSnap.data()?.burnFeeBps ?? 0);
    }
    const burnFeeBps = BigInt(burnFeeRaw);
    const fee        = (hexWei * burnFeeBps) / 10000n;
    const refund     = hexWei - fee;
    if (refund <= 0n) throw new Error('환급 금액이 없습니다');

    // admin 지갑 HEX 잔액 확인
    const hexToken = getHexContract(adminWallet);
    const adminBal = await hexToken.balanceOf(adminWallet.address);
    if (adminBal < refund) throw new Error('관리자 지갑 HEX 잔액 부족 — 관리자에게 문의하세요');

    // HEX 전송
    const transferTx = await hexToken.transfer(walletData.address, refund, { gasLimit: 80000n });
    const receipt    = await transferTx.wait();

    const burnUpdate = {
      status:     'burned',
      burnTxHash: receipt.hash,
      hexRefund:  refund.toString(),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    };
    await docRef.update(burnUpdate);

    // coopVouchers 문서인 경우 동일 txHash의 coopOrders도 burned 처리 (중복 노출 방지)
    if (!isOrderSource && data.txHash) {
      try {
        const orderQ = await db.collection('coopOrders')
          .where('uid', '==', uid)
          .where('txHash', '==', data.txHash)
          .limit(1)
          .get();
        if (!orderQ.empty) {
          await orderQ.docs[0].ref.update({
            status:    'burned',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (_) { /* coopOrders 동기화 실패는 무시 */ }
    }

    return {
      docId,
      txHash:    receipt.hash,
      hexRefund: parseFloat(ethers.formatEther(refund)).toFixed(4),
    };
  }

  // ── 온체인 NFT 바우처: burnVoucher() 온체인 호출 ──────────────────
  if (!walletData.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const coopMall = getCoopMallContract(provider);
  const vInfo    = await coopMall.vouchers(Number(voucherId));

  if (vInfo.owner.toLowerCase() !== walletData.address.toLowerCase())
    throw new Error('바우처 소유자가 아닙니다');
  if (vInfo.burned) throw new Error('이미 소각된 바우처입니다');

  const tmpl   = await coopMall.voucherTemplates(Number(vInfo.templateId));
  const fee    = (tmpl.hexPrice * BigInt(tmpl.burnFeeBps)) / 10000n;
  const refund = tmpl.hexPrice - fee;

  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({ to: walletData.address, value: ethers.parseEther('0.0001') });
    await fundTx.wait();
  }

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const coopSigned = getCoopMallContract(signer);

  const gasLimit = await estimateGasWithBuffer(coopSigned, 'burnVoucher', [Number(voucherId)]);
  const tx       = await coopSigned.burnVoucher(Number(voucherId), { gasLimit });
  const receipt  = await tx.wait();

  const snap = await db.collection('coopVouchers')
    .where('voucherId', '==', Number(voucherId)).where('ownerUid', '==', uid).limit(1).get();
  if (!snap.empty) {
    await snap.docs[0].ref.update({
      status: 'burned',
      burnTxHash: receipt.hash,
      hexRefund:  refund.toString(),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return {
    voucherId,
    txHash: receipt.hash,
    hexRefund: parseFloat(ethers.formatEther(refund)).toFixed(4),
    feePaid:   parseFloat(ethers.formatEther(fee)).toFixed(4),
  };
}

// ─────────────────────────────────────────────
// 21. 유저: 내 바우처 목록 조회 (Firestore)
// ─────────────────────────────────────────────
async function coopGetMyVouchers(uid) {
  const provider = getProvider();
  const platform  = getPlatformContract(provider);

  const [vSnap, orderSnap, fxKrw, fxVnd, fxScale, userSnap] = await Promise.all([
    db.collection('coopVouchers')
      .where('ownerUid', '==', uid)
      .where('status', '==', 'active')
      .get(),
    // uid만으로 조회 (복합 인덱스 불필요) → status/type은 코드에서 필터
    db.collection('coopOrders')
      .where('uid', '==', uid)
      .limit(100)
      .get(),
    platform.fxKrwPerHexScaled(),
    platform.fxVndPerHexScaled(),
    platform.fxScale(),
    db.collection('users').doc(uid).get(),
  ]);
  const walletAddress = userSnap.data()?.wallet?.address || null;

  // coopVouchers에 이미 있는 productId는 중복 제거
  const voucherProductIds = new Set(vSnap.docs.map(d => d.data().productId).filter(Boolean));

  // 주문 중 productId 있고 voucherProductIds에 없는 것 모두 조회 (type 유무 무관 — burnFeeBps 획득 목적)
  const confirmedOrders = orderSnap.docs.filter(d => d.data().status === 'confirmed');
  const ordersNeedingLookup = confirmedOrders.filter(d => {
    const o = d.data();
    return o.productId && !voucherProductIds.has(o.productId);
  });
  const productLookups = await Promise.all(
    ordersNeedingLookup.map(d => db.collection('coopProducts').doc(d.data().productId).get())
  );
  const productTypeMap = {};
  ordersNeedingLookup.forEach((d, i) => {
    productTypeMap[d.data().productId] = productLookups[i].data()?.type || 'general';
  });

  const orderVouchers = confirmedOrders
    .filter(d => {
      const o = d.data();
      if (!o.productId || voucherProductIds.has(o.productId)) return false;
      const t = o.type || productTypeMap[o.productId] || 'general';
      return t === 'voucher';
    })
    .map(d => {
      const o = d.data();
      const prod = productLookups[ordersNeedingLookup.findIndex(x => x.id === d.id)]?.data() || {};
      return {
        id:          d.id,
        source:      'product',
        productId:   o.productId,
        ownerUid:    uid,
        hexPrice:    o.hexWei || '0',
        burnFeeBps:  prod.burnFeeBps ?? 0,
        description: o.productName || prod.description || '바우처',
        usagePlace:  prod.usagePlace || '',
        imageUrl:    prod.imageUrl   || '',
        txHash:      o.txHash || '',
        status:      'active',
        createdAt:   o.createdAt,
      };
    });

  // coopVouchers 문서에 burnFeeBps=0이면 coopProducts에서 재조회 (구매 전 생성된 레거시 문서 대응)
  const vBpsLookups = await Promise.all(
    vSnap.docs.map(d => {
      const data = d.data();
      if ((data.burnFeeBps === 0 || data.burnFeeBps == null) && data.productId) {
        return db.collection('coopProducts').doc(data.productId).get();
      }
      return null;
    })
  );

  return {
    vouchers: [
      ...vSnap.docs.map((d, i) => {
        const data = { id: d.id, ...d.data() };
        if (vBpsLookups[i]) {
          const bps = vBpsLookups[i].data()?.burnFeeBps;
          if (bps) data.burnFeeBps = bps;
        }
        return data;
      }),
      ...orderVouchers,
    ],
    fxKrwPerHexScaled: fxKrw.toString(),
    fxVndPerHexScaled: fxVnd.toString(),
    fxScale: Number(fxScale),
    walletAddress,
  };
}

module.exports = {
  listCoopProducts,
  buyCoopProduct,
  adminSetCoopConfig,
  adminSaveCoopProduct,
  adminDeleteCoopProduct,
  coopGetMembership,
  coopJoinMall,
  coopBuyOnChain,
  coopConvertPoints,
  coopAdminGrantEligibility,
  coopAdminGetStats,
  coopAdminUpdateOrder,
  coopAdminWithdrawHex,
  coopAdminWithdrawJump,
  coopAdminSetFee,
  coopAdminCreateVoucher,
  coopAdminUpdateVoucher,
  coopAdminListVouchers,
  coopBuyVoucher,
  coopTransferVoucher,
  coopBurnVoucher,
  coopGetMyVouchers,
};
