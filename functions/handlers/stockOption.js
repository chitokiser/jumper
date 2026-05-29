// functions/handlers/stockOption.js
// JumpDao 스톡옵션 바우처 — Cloud Functions 핸들러
'use strict';

const admin  = require('firebase-admin');
const { ethers } = require('ethers');
const { getProvider, getHexContract, walletFromKey, getAdminWallet, estimateGasWithBuffer } = require('../wallet/chain');
const { decrypt } = require('../wallet/crypto');

const db = admin.firestore();

// 컨트랙트 주소 — 배포 후 settings/stockOption 문서에 저장
const STOCK_OPTION_ABI = [
  'function createOptionVoucher(address _owner, uint256 _strikePrice, uint256 _totalAmount, uint256 _maturityDays) external returns (uint256)',
  'function transferVoucher(uint256 _voucherId, address _to) external',
  'function executeOption(uint256 _voucherId, uint256 _amount) external',
  'function getVoucher(uint256 _voucherId) external view returns (tuple(uint256 id, address currentOwner, uint256 strikePrice, uint256 totalAmount, uint256 exercisedAmount, uint256 purchaseDate, uint256 maturityDate, bool active))',
  'function getUserVouchers(address _user) external view returns (uint256[])',
  'function remainingAmount(uint256 _voucherId) external view returns (uint256)',
  'function isMatured(uint256 _voucherId) external view returns (bool)',
  'function depositJumpToken(uint256 _amount) external',
  'event VoucherCreated(uint256 indexed voucherId, address indexed owner, uint256 strikePrice, uint256 totalAmount, uint256 maturityDate)',
  'event VoucherTransferred(uint256 indexed voucherId, address indexed from, address indexed to)',
  'event OptionExecuted(uint256 indexed voucherId, address indexed user, uint256 amount, uint256 hexPaid)',
];

// 배포된 컨트랙트 주소 (opBNB Mainnet, 2026-05-29)
const DEPLOYED_CONTRACT_ADDRESS = '0x0e328ddD602CbA103a39dF822CcFD4690C633677';

async function getContractAddress() {
  const snap = await db.collection('settings').doc('stockOption').get();
  const addr = snap.data()?.contractAddress || DEPLOYED_CONTRACT_ADDRESS;
  if (!ethers.isAddress(addr)) throw new Error('컨트랙트 주소가 유효하지 않습니다');
  return addr;
}

function getStockOptionContract(signerOrProvider, address) {
  return new ethers.Contract(address, STOCK_OPTION_ABI, signerOrProvider);
}

// ── 1. 관리자: 바우처 생성 ──────────────────────────────────────────────────
async function adminCreateStockVoucher(uid, {
  recipientAddress,
  strikePrice,    // HEX (float, e.g. 10.5)
  totalAmount,    // JUMP 수량 (정수, 0 decimals)
  maturityDays,   // 만기까지 일수
}, masterSecret) {
  if (!ethers.isAddress(recipientAddress)) throw new Error('유효하지 않은 수신자 주소');
  if (!strikePrice || strikePrice <= 0)    throw new Error('행사 가격을 입력하세요');
  if (!totalAmount || totalAmount <= 0)    throw new Error('행사 수량을 입력하세요');
  if (!maturityDays || maturityDays < 1)   throw new Error('만기일을 입력하세요');

  const contractAddress = await getContractAddress();
  const provider        = getProvider();

  // 관리자 수탁 지갑 로드
  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('관리자 수탁 지갑이 없습니다');

  const privateKey    = decrypt(walletData.encryptedKey, masterSecret);
  const signer        = walletFromKey(privateKey, provider);
  const hexSigned     = getHexContract(signer);
  const contractSigned = getStockOptionContract(signer, contractAddress);

  const strikePriceWei = ethers.parseEther(String(strikePrice)); // HEX wei per 1 JUMP
  const totalAmountBN  = BigInt(Math.round(totalAmount));
  const purchaseCost   = strikePriceWei * totalAmountBN;          // HEX wei total

  // HEX approve to contract
  const allowance = await hexSigned.allowance(walletData.address, contractAddress);
  if (allowance < purchaseCost) {
    const approveTx = await hexSigned.approve(contractAddress, purchaseCost, { gasLimit: 80000n });
    await approveTx.wait();
  }

  // Contract call
  const gasLimit = await estimateGasWithBuffer(contractSigned, 'createOptionVoucher', [
    recipientAddress, strikePriceWei, totalAmountBN, BigInt(maturityDays),
  ]);
  const tx      = await contractSigned.createOptionVoucher(
    recipientAddress, strikePriceWei, totalAmountBN, BigInt(maturityDays), { gasLimit }
  );
  const receipt = await tx.wait();

  // 이벤트에서 voucherId 추출
  let voucherId = null;
  const iface = getStockOptionContract(provider, contractAddress).interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'VoucherCreated') { voucherId = Number(parsed.args.voucherId); break; }
    } catch (_) {}
  }

  const maturityDate = new Date(Date.now() + maturityDays * 86400000);

  // Firebase 저장
  const docData = {
    voucherId,
    contractAddress,
    currentOwner:    recipientAddress.toLowerCase(),
    strikePrice:     strikePrice,
    strikePriceWei:  strikePriceWei.toString(),
    totalAmount:     Number(totalAmountBN),
    exercisedAmount: 0,
    purchaseDate:    admin.firestore.FieldValue.serverTimestamp(),
    maturityDate:    admin.firestore.Timestamp.fromDate(maturityDate),
    maturityDays,
    active:          true,
    createdBy:       uid,
    txHash:          receipt.hash,
    createdAt:       admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('stockOptionVouchers').doc(String(voucherId)).set(docData);

  return {
    voucherId,
    txHash:          receipt.hash,
    recipientAddress,
    strikePrice,
    totalAmount:     Number(totalAmountBN),
    maturityDate:    maturityDate.toISOString(),
    purchaseCostHex: parseFloat(ethers.formatEther(purchaseCost)).toFixed(4),
  };
}

// ── 2. 관리자: 전체 바우처 목록 ──────────────────────────────────────────────
async function adminGetAllVouchers() {
  const snap = await db.collection('stockOptionVouchers')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── 3. 유저: 내 바우처 목록 ─────────────────────────────────────────────────
async function getMyStockVouchers(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const address  = userSnap.data()?.wallet?.address;
  if (!address) return { vouchers: [] };

  const snap = await db.collection('stockOptionVouchers')
    .where('currentOwner', '==', address.toLowerCase())
    .orderBy('createdAt', 'desc')
    .get();

  return {
    vouchers:    snap.docs.map(d => ({ id: d.id, ...d.data() })),
    userAddress: address,
  };
}

// ── 4. 클라이언트가 MetaMask로 양도한 뒤 Firebase 동기화 ────────────────────
async function syncVoucherTransfer(uid, { voucherId, toAddress, txHash }) {
  if (!voucherId || !ethers.isAddress(toAddress)) throw new Error('유효하지 않은 인수');

  const ref  = db.collection('stockOptionVouchers').doc(String(voucherId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('바우처를 찾을 수 없습니다');

  const userSnap  = await db.collection('users').doc(uid).get();
  const myAddress = userSnap.data()?.wallet?.address?.toLowerCase();
  if (snap.data().currentOwner !== myAddress) throw new Error('소유자가 아닙니다');

  const batch = db.batch();
  batch.update(ref, {
    currentOwner: toAddress.toLowerCase(),
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('voucherTransfers').doc(), {
    voucherId,
    fromAddress: myAddress,
    toAddress:   toAddress.toLowerCase(),
    fromUid:     uid,
    txHash,
    transferredAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { ok: true };
}

// ── 5. 클라이언트가 MetaMask로 권리행사한 뒤 Firebase 동기화 ────────────────
async function syncOptionExecution(uid, { voucherId, amount, txHash }) {
  if (!voucherId || !amount || !txHash) throw new Error('유효하지 않은 인수');

  const ref  = db.collection('stockOptionVouchers').doc(String(voucherId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('바우처를 찾을 수 없습니다');

  const userSnap  = await db.collection('users').doc(uid).get();
  const myAddress = userSnap.data()?.wallet?.address?.toLowerCase();
  if (snap.data().currentOwner !== myAddress) throw new Error('소유자가 아닙니다');

  const prev     = snap.data().exercisedAmount || 0;
  const newTotal = prev + Number(amount);
  const isExhausted = newTotal >= snap.data().totalAmount;

  const batch = db.batch();
  batch.update(ref, {
    exercisedAmount: newTotal,
    active:          !isExhausted,
    updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('optionExecutions').doc(), {
    voucherId,
    executorAddress: myAddress,
    executorUid:     uid,
    amount:          Number(amount),
    txHash,
    executedAt:      admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { ok: true, exercisedAmount: newTotal };
}

// ── 6. 관리자: 컨트랙트 주소 저장 ────────────────────────────────────────────
async function adminSetContractAddress(uid, { contractAddress }) {
  if (!ethers.isAddress(contractAddress)) throw new Error('유효하지 않은 주소');
  await db.collection('settings').doc('stockOption').set(
    { contractAddress, updatedBy: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { ok: true };
}

module.exports = {
  adminCreateStockVoucher,
  adminGetAllVouchers,
  getMyStockVouchers,
  syncVoucherTransfer,
  syncOptionExecution,
  adminSetContractAddress,
};
