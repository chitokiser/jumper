// functions/handlers/onboarding.js
// 수탁 지갑 생성 / 온체인 가입 / 멘토 등록

'use strict';

const admin  = require('firebase-admin');
const { ethers } = require('ethers');
const { encrypt, decrypt } = require('../wallet/crypto');
const {
  getProvider,
  getPlatformContract,
  walletFromKey,
  estimateGasWithBuffer,
} = require('../wallet/chain');

const db = admin.firestore();

// ────────────────────────────────────────────────
// 수탁 지갑 생성
// ────────────────────────────────────────────────

/**
 * createCustodialWallet
 * - Firebase UID 1개 → ETH 지갑 1개 (멱등: 이미 있으면 기존 주소 반환)
 * - private key는 AES-256-GCM 암호화 후 Firestore에만 저장
 *
 * @param {string} uid         - Firebase Auth UID
 * @param {string} masterSecret - WALLET_MASTER_SECRET (Secret Manager에서 주입)
 * @returns {{ address: string, created: boolean }}
 */
async function createCustodialWallet(uid, masterSecret) {
  const userRef = db.collection('users').doc(uid);
  const snap    = await userRef.get();

  // 멱등: 이미 지갑 있으면 그대로 반환
  if (snap.exists && snap.data()?.wallet?.address) {
    return { address: snap.data().wallet.address, created: false };
  }

  // 새 지갑 생성
  const wallet       = ethers.Wallet.createRandom();
  const encryptedKey = encrypt(wallet.privateKey, masterSecret);

  await userRef.set({
    wallet: {
      address:      wallet.address,
      encryptedKey,                        // 평문 key는 절대 저장 안 함
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  return { address: wallet.address, created: true };
}

// ────────────────────────────────────────────────
// 온체인 가입 (register)
// ────────────────────────────────────────────────

/**
 * registerOnChain
 * 1. user의 수탁 지갑으로 jumpPlatform.register(mentorAddress) 서명 + 전송
 * 2. mentorEmail이 있으면 DB에서 주소 조회, 없으면 bootstrapMentor(0x0)
 *
 * @param {string}  uid          - Firebase Auth UID
 * @param {string|null} mentorEmail - 멘토 구글 이메일 (없으면 null)
 * @param {string}  masterSecret  - WALLET_MASTER_SECRET
 * @returns {{ txHash, address, mentorAddress }}
 */
async function registerOnChain(uid, mentorEmail, masterSecret) {
  // 수탁 지갑 정보 조회
  const userSnap   = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) {
    throw new Error('수탁 지갑이 없습니다. 먼저 지갑을 생성해주세요 (createWallet 호출)');
  }

  // 이미 가입했는지 확인 (Firestore 캐시)
  if (userSnap.data()?.onChain?.registered) {
    throw new Error('이미 온체인 가입이 완료된 계정입니다');
  }

  // 멘토 주소 결정
  let mentorAddress = ethers.ZeroAddress; // 0x00..00 → 컨트랙트가 bootstrapMentor 사용
  if (mentorEmail) {
    const key = mentorEmail.toLowerCase().trim();
    const mentorDoc = await db.collection('mentors').doc(key).get();
    if (!mentorDoc.exists) {
      throw new Error(`등록된 멘토 이메일을 찾을 수 없습니다: ${mentorEmail}`);
    }
    mentorAddress = mentorDoc.data().address;
  }

  // 수탁 지갑으로 서명
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider   = getProvider();
  const signer     = walletFromKey(privateKey, provider);
  const platform   = getPlatformContract(signer);

  // 가스 추정 + 10% 여유
  const gasLimit = await estimateGasWithBuffer(platform, 'register', [mentorAddress]);
  const tx       = await platform.register(mentorAddress, { gasLimit });
  const receipt  = await tx.wait();

  // Firestore 업데이트
  await db.collection('users').doc(uid).set({
    onChain: {
      registered:    true,
      registeredAt:  admin.firestore.FieldValue.serverTimestamp(),
      mentorAddress,
      txHash:        receipt.hash,
    },
  }, { merge: true });

  return {
    txHash:        receipt.hash,
    address:       walletData.address,
    mentorAddress,
  };
}

// ────────────────────────────────────────────────
// 멘토 등록 (이메일 ↔ 지갑 주소 연결)
// ────────────────────────────────────────────────

/**
 * registerMentor
 * 멘토가 Google OAuth로 이메일 인증 후,
 * 자신의 지갑으로 서명(EIP-191)하여 소유 증명 → DB에 email↔address 저장
 *
 * 서명 메시지 형식 (프론트에서 동일하게 생성해야 함):
 *   "Jump Platform 멘토 등록\nEmail: {email_lowercase}"
 *
 * @param {string} email     - Google OAuth 인증된 이메일
 * @param {string} address   - 멘토의 개인 지갑 주소
 * @param {string} signature - EIP-191 서명
 * @returns {{ success: boolean, address: string }}
 */
async function registerMentor(email, address, signature) {
  if (!email || !address || !signature) {
    throw new Error('email, address, signature 모두 필요합니다');
  }

  const normalEmail = email.toLowerCase().trim();

  // 서명 검증 (주소 소유 증명)
  const message = `Jump Platform 멘토 등록\nEmail: ${normalEmail}`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    throw new Error('서명 형식이 올바르지 않습니다');
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('서명 검증 실패: 제공된 주소와 서명 주소가 다릅니다');
  }

  // 온체인에서 level 4+ 확인
  const provider = getProvider();
  const platform = getPlatformContract(provider);
  const [level]  = await platform.getMember(address);

  if (Number(level) < 4) {
    throw new Error(
      `멘토 등록 조건 미충족: 레벨 4 이상 필요. 현재 레벨: ${level}`
    );
  }

  // DB 저장
  await db.collection('mentors').doc(normalEmail).set({
    email:      normalEmail,
    address,
    level:      Number(level),
    verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, address };
}

// ────────────────────────────────────────────────
// 온체인 조합원 정보 조회
// ────────────────────────────────────────────────

/**
 * getUserOnChainData
 * jumpPlatform.getMember() 조회 + 읽기 쉬운 형태로 포맷
 *
 * @param {string} uid - Firebase Auth UID
 * @returns {{ address, level, mentor, pointWei, payableWei, joinAt, blocked,
 *             pointDisplay, payableDisplay }}
 */
async function getUserOnChainData(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const address  = userSnap.data()?.wallet?.address;
  if (!address) throw new Error('수탁 지갑이 없습니다');

  const provider  = getProvider();
  const platform  = getPlatformContract(provider);
  const [level, mentor, pointWei, payableWei, joinAt, blocked] =
    await platform.getMember(address);

  return {
    address,
    level:          Number(level),
    mentor,
    pointWei:       pointWei.toString(),
    payableWei:     payableWei.toString(),
    joinAt:         Number(joinAt),
    blocked,
    // 사람이 읽기 쉬운 표시 (HEX 단위, 소수 4자리)
    pointDisplay:   parseFloat(ethers.formatEther(pointWei)).toFixed(4),
    payableDisplay: parseFloat(ethers.formatEther(payableWei)).toFixed(4),
  };
}

module.exports = {
  createCustodialWallet,
  registerOnChain,
  registerMentor,
  getUserOnChainData,
};
