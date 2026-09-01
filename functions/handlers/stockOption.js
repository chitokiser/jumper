// functions/handlers/stockOption.js
// K-Culture Alliance 스톡옵션 바우처 — 관리자가 공개 오퍼링 발행, 유저가 Point로 구매
'use strict';

const admin  = require('firebase-admin');
const { ethers } = require('ethers');
const {
  getProvider, getHexContract, getJumpBankContract,
  walletFromKey, getAdminWallet, estimateGasWithBuffer,
} = require('../wallet/chain');
const { decrypt } = require('../wallet/crypto');

async function getUserStaked(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const address  = userSnap.data()?.wallet?.address;
  if (!address) return { staked: 0, walletData: userSnap.data()?.wallet };
  const jumpBank = getJumpBankContract(getProvider());
  const info     = await jumpBank.user(address);
  return { staked: Number(info.depo), walletData: userSnap.data()?.wallet };
}

const db = admin.firestore();

const CONTRACT_ADDRESS = '0x0e328ddD602CbA103a39dF822CcFD4690C633677';
const JUMPBANK_ADDRESS  = '0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E';

const STOCK_OPTION_ABI = [
  'function createOptionVoucher(address _owner,uint256 _strikePrice,uint256 _totalAmount,uint256 _maturityDays) external returns (uint256)',
  'function transferVoucher(uint256 _voucherId,address _to) external',
  'function executeOption(uint256 _voucherId,uint256 _amount) external',
  'function getVoucher(uint256 _voucherId) external view returns (tuple(uint256 id,address currentOwner,uint256 strikePrice,uint256 totalAmount,uint256 exercisedAmount,uint256 purchaseDate,uint256 maturityDate,bool active))',
  'function getUserVouchers(address _user) external view returns (uint256[])',
  'function remainingAmount(uint256 _voucherId) external view returns (uint256)',
  'function isMatured(uint256 _voucherId) external view returns (bool)',
  'function depositJumpToken(uint256 _amount) external',
  'event VoucherCreated(uint256 indexed voucherId,address indexed owner,uint256 strikePrice,uint256 totalAmount,uint256 maturityDate)',
  'event VoucherTransferred(uint256 indexed voucherId,address indexed from,address indexed to)',
  'event OptionExecuted(uint256 indexed voucherId,address indexed user,uint256 amount,uint256 hexPaid)',
];

function getStockOptionContract(signerOrProvider) {
  return new ethers.Contract(CONTRACT_ADDRESS, STOCK_OPTION_ABI, signerOrProvider);
}

// ── 1. 관리자: 스톡옵션 공개 오퍼링 등록 (Firestore만, 유저가 구매 가능) ────
async function adminCreateOffering(uid, {
  name, description,
  strikePrice,      // 행사 가격 Point (float, 예: 10.5)
  voucherPrice,     // 바우처 가격 Point (float, 예: 5)
  jumpPerVoucher,   // 바우처 1장당 JUMP 수량 (정수)
  totalVouchers,    // 발행 수량
  maturityDays,     // 만기까지 일수
  stakeRequired,    // 구매 자격: 최소 스테이킹 JUMP (0 = 제한 없음)
}) {
  if (!name)                             throw new Error('오퍼링 이름을 입력하세요');
  if (!strikePrice || strikePrice <= 0)  throw new Error('행사 가격을 입력하세요 (Point/JUMP)');
  if (!voucherPrice || voucherPrice < 0) throw new Error('바우처 가격을 입력하세요');
  if (!jumpPerVoucher || jumpPerVoucher <= 0) throw new Error('바우처당 JUMP 수량을 입력하세요');
  if (!totalVouchers || totalVouchers <= 0)   throw new Error('발행 수량을 입력하세요');
  if (!maturityDays || maturityDays < 1)      throw new Error('만기일을 입력하세요');

  const strikePriceWei  = ethers.parseEther(String(strikePrice)).toString();
  const voucherPriceWei = ethers.parseEther(String(voucherPrice)).toString();
  const maturityDate    = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + maturityDays * 86400000)
  );

  const ref = await db.collection('stockOptionOfferings').add({
    name, description: description || '',
    strikePrice, strikePriceWei,
    voucherPrice, voucherPriceWei,
    jumpPerVoucher: Math.round(jumpPerVoucher),
    totalVouchers:  Math.round(totalVouchers),
    soldVouchers:   0,
    stakeRequired:  Math.max(0, Math.round(Number(stakeRequired) || 0)),
    maturityDays,
    maturityDate,
    active:    true,
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { offeringId: ref.id, name, strikePrice, voucherPrice, jumpPerVoucher, totalVouchers, stakeRequired: Math.round(Number(stakeRequired) || 0) };
}

// ── 2. 공개: 스톡옵션 오퍼링 목록 조회 ────────────────────────────────────────
async function getStockOfferings() {
  // orderBy 없이 단일 필드 where만 사용 — 복합 인덱스 불필요
  const snap = await db.collection('stockOptionOfferings')
    .where('active', '==', true)
    .get();
  const offerings = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return { offerings };
}

// ── 3. 관리자: 전체 오퍼링·바우처 관리 ──────────────────────────────────────
async function adminGetAllOfferings() {
  const snap = await db.collection('stockOptionOfferings')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return { offerings: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

async function adminGetAllVouchers() {
  const snap = await db.collection('stockOptionVouchers')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();
  return { vouchers: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

// ── 4. 유저: 스톡옵션 바우처 구매 (수탁지갑 Point → JumpBank + 컨트랙트 발행) ─
async function buyStockOptionVoucher(uid, { offeringId }, masterSecret) {
  if (!offeringId) throw new Error('offeringId가 필요합니다');

  // 오퍼링 조회
  const offeringRef  = db.collection('stockOptionOfferings').doc(offeringId);
  const offeringSnap = await offeringRef.get();
  if (!offeringSnap.exists) throw new Error('오퍼링을 찾을 수 없습니다');
  const offering = offeringSnap.data();
  if (!offering.active) throw new Error('종료된 오퍼링입니다');
  if (offering.soldVouchers >= offering.totalVouchers) throw new Error('매진되었습니다');

  // 스테이킹 조건 확인
  const stakeRequired = offering.stakeRequired || 0;
  if (stakeRequired > 0) {
    const { staked } = await getUserStaked(uid);
    if (staked < stakeRequired) {
      throw new Error(
        `스테이킹 조건 미충족. 필요: JUMP ${stakeRequired.toLocaleString()}개, 보유: ${staked.toLocaleString()}개`
      );
    }
  }

  // 유저 수탁지갑 조회
  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');

  const provider  = getProvider();
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const hexSigned  = getHexContract(signer);

  // Point 잔액 확인
  const voucherPriceWei = BigInt(offering.voucherPriceWei);
  if (voucherPriceWei > 0n) {
    const hexBal = await hexSigned.balanceOf(walletData.address);
    if (hexBal < voucherPriceWei) {
      const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
      const need = parseFloat(ethers.formatEther(voucherPriceWei)).toFixed(4);
      throw new Error(`Point 잔액 부족. 필요: ${need} Point, 보유: ${have} Point`);
    }

    // BNB 가스비 보충
    const adminWallet = getAdminWallet();
    const bnbBal = await provider.getBalance(walletData.address);
    if (bnbBal < ethers.parseEther('0.00005')) {
      const fundTx = await adminWallet.sendTransaction({ to: walletData.address, value: ethers.parseEther('0.0001') });
      await fundTx.wait();
    }

    // 구매 Point → JumpBank
    const gasLimitHex = await estimateGasWithBuffer(hexSigned, 'transfer', [JUMPBANK_ADDRESS, voucherPriceWei]);
    const hexTx       = await hexSigned.transfer(JUMPBANK_ADDRESS, voucherPriceWei, { gasLimit: gasLimitHex });
    await hexTx.wait();
  }

  // 컨트랙트에 바우처 생성 (관리자 수탁지갑이 owner이므로 admin wallet으로 호출)
  const adminWallet = getAdminWallet();
  const adminHex    = getHexContract(adminWallet);
  const contract    = getStockOptionContract(adminWallet);

  const strikePriceWei  = BigInt(offering.strikePriceWei);
  const jumpPerVoucher  = BigInt(offering.jumpPerVoucher);

  // 관리자가 유저 주소를 소유자로 해서 바우처 생성
  // admin Point approve (발행 비용 strikePrice * jumpAmount → JumpBank는 컨트랙트 내부 처리)
  const purchaseCost = strikePriceWei * jumpPerVoucher;
  if (purchaseCost > 0n) {
    const allowance = await adminHex.allowance(adminWallet.address, CONTRACT_ADDRESS);
    if (allowance < purchaseCost) {
      const approveTx = await adminHex.approve(CONTRACT_ADDRESS, purchaseCost, { gasLimit: 80000n });
      await approveTx.wait();
    }
  }

  const gasLimit = await estimateGasWithBuffer(contract, 'createOptionVoucher', [
    walletData.address, strikePriceWei, jumpPerVoucher, BigInt(offering.maturityDays),
  ]);
  const tx      = await contract.createOptionVoucher(
    walletData.address, strikePriceWei, jumpPerVoucher, BigInt(offering.maturityDays),
    { gasLimit }
  );
  const receipt = await tx.wait();

  // 이벤트에서 voucherId 추출
  let voucherId = null;
  const iface   = contract.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'VoucherCreated') { voucherId = Number(parsed.args.voucherId); break; }
    } catch (_) {}
  }

  const maturityDate = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + offering.maturityDays * 86400000)
  );

  // Firestore 저장
  const batch = db.batch();
  batch.set(db.collection('stockOptionVouchers').doc(String(voucherId)), {
    voucherId,
    offeringId,
    offeringName:    offering.name,
    contractAddress: CONTRACT_ADDRESS,
    ownerUid:        uid,
    ownerAddress:    walletData.address.toLowerCase(),
    currentOwner:    walletData.address.toLowerCase(),
    strikePrice:     offering.strikePrice,
    strikePriceWei:  offering.strikePriceWei,
    jumpPerVoucher:  offering.jumpPerVoucher,
    exercisedAmount: 0,
    voucherPrice:    offering.voucherPrice,
    purchaseTxHash:  receipt.hash,
    maturityDate,
    maturityDays:    offering.maturityDays,
    active:          true,
    createdAt:       admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(offeringRef, {
    soldVouchers: admin.firestore.FieldValue.increment(1),
  });
  await batch.commit();

  return {
    voucherId,
    txHash:          receipt.hash,
    jumpPerVoucher:  offering.jumpPerVoucher,
    strikePrice:     offering.strikePrice,
    maturityDate:    maturityDate.toDate().toISOString(),
  };
}

// ── 5. 유저: 내 스톡옵션 바우처 조회 ────────────────────────────────────────
async function getMyStockVouchers(uid) {
  const userSnap  = await db.collection('users').doc(uid).get();
  const address   = userSnap.data()?.wallet?.address?.toLowerCase();
  if (!address) return { vouchers: [], userAddress: null };

  // orderBy 없이 단일 필드 where만 사용 — 복합 인덱스 불필요
  const snap = await db.collection('stockOptionVouchers')
    .where('currentOwner', '==', address)
    .get();
  const vouchers = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  return { vouchers, userAddress: address };
}

// ── 6. 유저: 권리행사 (수탁지갑으로 executeOption 호출) ──────────────────────
async function exerciseStockOption(uid, { voucherId, amount }, masterSecret) {
  if (!voucherId || !amount || amount <= 0) throw new Error('유효하지 않은 인수');

  const ref  = db.collection('stockOptionVouchers').doc(String(voucherId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('바우처를 찾을 수 없습니다');
  const v = snap.data();

  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.address) throw new Error('수탁 지갑이 없습니다');
  if (v.currentOwner !== walletData.address.toLowerCase()) throw new Error('바우처 소유자가 아닙니다');
  if (!v.active) throw new Error('이미 완료된 바우처입니다');

  const matDate = v.maturityDate?.toDate?.() || new Date(0);
  if (matDate > new Date()) throw new Error('아직 만기가 되지 않았습니다');

  const remaining = (v.jumpPerVoucher || 0) - (v.exercisedAmount || 0);
  if (amount > remaining) throw new Error(`잔여 수량(${remaining} JUMP) 초과`);

  const provider   = getProvider();
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const hexSigned  = getHexContract(signer);
  const contract   = getStockOptionContract(signer);

  const strikePriceWei = BigInt(v.strikePriceWei);
  const amountBN       = BigInt(Math.round(amount));
  const hexCost        = strikePriceWei * amountBN;

  // Point 잔액 확인
  const hexBal = await hexSigned.balanceOf(walletData.address);
  if (hexBal < hexCost) {
    const have = parseFloat(ethers.formatEther(hexBal)).toFixed(4);
    const need = parseFloat(ethers.formatEther(hexCost)).toFixed(4);
    throw new Error(`Point 잔액 부족. 필요: ${need} Point, 보유: ${have} Point`);
  }

  // BNB 가스비 보충
  const adminWallet = getAdminWallet();
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({ to: walletData.address, value: ethers.parseEther('0.0001') });
    await fundTx.wait();
  }

  // Point approve to contract
  const allowance = await hexSigned.allowance(walletData.address, CONTRACT_ADDRESS);
  if (allowance < hexCost) {
    const approveTx = await hexSigned.approve(CONTRACT_ADDRESS, hexCost, { gasLimit: 80000n });
    await approveTx.wait();
  }

  // executeOption
  const gasLimit = await estimateGasWithBuffer(contract, 'executeOption', [BigInt(voucherId), amountBN]);
  const tx       = await contract.executeOption(BigInt(voucherId), amountBN, { gasLimit });
  const receipt  = await tx.wait();

  const newExercised = (v.exercisedAmount || 0) + Number(amount);
  const isExhausted  = newExercised >= (v.jumpPerVoucher || 0);

  await db.runTransaction(async t => {
    t.update(ref, {
      exercisedAmount: newExercised,
      active:          !isExhausted,
      updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
    });
    t.set(db.collection('optionExecutions').doc(), {
      voucherId, uid,
      ownerAddress: walletData.address.toLowerCase(),
      amount:       Number(amount),
      hexPaid:      ethers.formatEther(hexCost),
      txHash:       receipt.hash,
      executedAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return {
    txHash:          receipt.hash,
    exercisedAmount: newExercised,
    jumpReceived:    Number(amount),
    hexPaid:         parseFloat(ethers.formatEther(hexCost)).toFixed(4),
  };
}

// ── 7. 유저: 바우처 양도 (수탁지갑으로 transferVoucher 호출) ─────────────────
async function transferStockOptionVoucher(uid, { voucherId, toAddress }, masterSecret) {
  if (!voucherId || !ethers.isAddress(toAddress)) throw new Error('유효하지 않은 인수');

  const ref  = db.collection('stockOptionVouchers').doc(String(voucherId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('바우처를 찾을 수 없습니다');
  const v = snap.data();

  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('수탁 지갑이 없습니다');
  if (v.currentOwner !== walletData.address.toLowerCase()) throw new Error('바우처 소유자가 아닙니다');
  if (!v.active) throw new Error('이미 완료된 바우처입니다');

  const provider   = getProvider();
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const signer     = walletFromKey(privateKey, provider);
  const contract   = getStockOptionContract(signer);

  // BNB 가스비 보충
  const adminWallet = getAdminWallet();
  const bnbBal = await provider.getBalance(walletData.address);
  if (bnbBal < ethers.parseEther('0.00005')) {
    const fundTx = await adminWallet.sendTransaction({ to: walletData.address, value: ethers.parseEther('0.0001') });
    await fundTx.wait();
  }

  // transferVoucher on-chain
  const gasLimit = await estimateGasWithBuffer(contract, 'transferVoucher', [BigInt(voucherId), toAddress]);
  const tx       = await contract.transferVoucher(BigInt(voucherId), toAddress, { gasLimit });
  const receipt  = await tx.wait();

  // Firestore 업데이트
  const batch = db.batch();
  batch.update(ref, {
    currentOwner: toAddress.toLowerCase(),
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('voucherTransfers').doc(), {
    voucherId,
    fromUid:     uid,
    fromAddress: walletData.address.toLowerCase(),
    toAddress:   toAddress.toLowerCase(),
    txHash:      receipt.hash,
    transferredAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { txHash: receipt.hash, toAddress };
}

// ── 8. 관리자: 오퍼링 활성화/비활성화 ────────────────────────────────────────
async function adminToggleOffering(uid, { offeringId, active }) {
  await db.collection('stockOptionOfferings').doc(offeringId)
    .update({ active: Boolean(active), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { ok: true };
}

module.exports = {
  adminCreateOffering,
  getStockOfferings,
  adminGetAllOfferings,
  adminGetAllVouchers,
  buyStockOptionVoucher,
  getMyStockVouchers,
  exerciseStockOption,
  transferStockOptionVoucher,
  adminToggleOffering,
};
