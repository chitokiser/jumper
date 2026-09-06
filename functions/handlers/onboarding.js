// functions/handlers/onboarding.js
// 수탁 지갑 생성 / 온체인 가입 / 멘토 등록

'use strict';

const admin = require('firebase-admin');
const { ethers } = require('ethers');
const { encrypt, decrypt } = require('../wallet/crypto');
const {
  getProvider,
  getPlatformContract,
  getHexContract,
  getAdminWallet,
  walletFromKey,
  estimateGasWithBuffer,
} = require('../wallet/chain');

const db = admin.firestore();

const DEFAULT_MENTOR_ADDRESS = '0xc662c3B58bE7345DE30dd8188B2Acc977943186A';

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
async function createCustodialWallet(uid, masterSecret, mentorAddress) {
  const fast = await createWalletAndBonus(uid, masterSecret, mentorAddress);
  if (!fast.created) return fast;
  try {
    await registerOnChainBackground(uid, mentorAddress, masterSecret);
    return { ...fast, registered: true };
  } catch (_) {
    return { ...fast, registered: false };
  }
}

/**
 * 1단계(빠름): 지갑 Firestore 저장 + 가입 보너스 지급
 * telegramRegister에서 봇 응답 전에 호출 — 3~5초 내 완료
 */
async function createWalletAndBonus(uid, masterSecret, mentorAddress) {
  if (!mentorAddress || !ethers.isAddress(mentorAddress)) {
    mentorAddress = DEFAULT_MENTOR_ADDRESS;
  }

  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();

  // 멱등: 수탁 지갑이 이미 있으면 그대로 반환
  if (snap.exists && snap.data()?.wallet?.address && snap.data()?.wallet?.encryptedKey) {
    return { address: snap.data().wallet.address, created: false, joinBonus: false };
  }

  const wallet = ethers.Wallet.createRandom();
  const encryptedKey = encrypt(wallet.privateKey, masterSecret);

  await userRef.set({
    wallet: { address: wallet.address, encryptedKey, createdAt: admin.firestore.FieldValue.serverTimestamp() },
  }, { merge: true });

  let joinBonus = false;
  try {
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const userNow = await userRef.get();
    const coopUntil = (userNow.data() || {}).coopMemberUntil || '';
    const isPremium = !!(coopUntil && coopUntil >= today);
    const bpUpdate = { uid, gold: admin.firestore.FieldValue.increment(1000), joinBonusAt: admin.firestore.FieldValue.serverTimestamp() };
    if (isPremium) { bpUpdate.level = 4; bpUpdate.pendingOnChainSync = true; bpUpdate.pendingOnChainLevel = 4; }
    await db.collection('battle_players').doc(uid).set(bpUpdate, { merge: true });
    joinBonus = true;
  } catch (bonusErr) {
    console.warn('[createWalletAndBonus] 보너스 지급 실패:', bonusErr.message);
  }

  return { address: wallet.address, created: true, registered: false, joinBonus };
}

/**
 * 2단계(느림): BNB 충전 + 온체인 register — 응답 후 백그라운드 실행
 */
async function registerOnChainBackground(uid, mentorAddress, masterSecret) {
  if (!mentorAddress || !ethers.isAddress(mentorAddress)) {
    mentorAddress = DEFAULT_MENTOR_ADDRESS;
  }
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  const walletData = snap.data()?.wallet;
  if (!walletData?.encryptedKey) throw new Error('지갑 없음');

  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider = getProvider();
  const adminWallet = getAdminWallet();

  const fundTx = await adminWallet.sendTransaction({ to: walletData.address, value: ethers.parseEther('0.0001') });
  await fundTx.wait();

  const signer = walletFromKey(privateKey, provider);
  const platform = getPlatformContract(signer);
  const gasLimit = await estimateGasWithBuffer(platform, 'register', [mentorAddress]);
  const regTx = await platform.register(mentorAddress, { gasLimit });
  await regTx.wait();

  await userRef.set({
    onChain: { registered: true, registeredAt: admin.firestore.FieldValue.serverTimestamp(), mentorAddress, txHash: regTx.hash },
  }, { merge: true });
}

// ────────────────────────────────────────────────
// 온체인 가입 (register)
// ────────────────────────────────────────────────

/**
 * registerOnChain
 * 1. user의 수탁 지갑으로 jumpPlatform.register(mentorAddress) 서명 + 전송
 * 2. mentorAddress(0x...)는 필수 — 없으면 에러
 *
 * @param {string}  uid           - Firebase Auth UID
 * @param {string}  mentorAddress - 멘토 지갑 주소 (0x로 시작하는 42자리)
 * @param {string}  masterSecret  - WALLET_MASTER_SECRET
 * @returns {{ txHash, address, mentorAddress }}
 */
async function registerOnChain(uid, mentorAddress, masterSecret) {
  // 멘토 주소 없으면 기본 주소 사용
  if (!mentorAddress || !ethers.isAddress(mentorAddress)) {
    mentorAddress = DEFAULT_MENTOR_ADDRESS;
  }

  // 수탁 지갑 정보 조회
  const userSnap = await db.collection('users').doc(uid).get();
  const walletData = userSnap.data()?.wallet;
  if (!walletData?.encryptedKey) {
    throw new Error('수탁 지갑이 없습니다. 먼저 지갑을 생성해주세요 (createWallet 호출)');
  }

  // 이미 가입했는지 확인 (체인이 진실 — Firestore 캐시는 무시)
  const providerCheck = getProvider();
  const platformCheck = getPlatformContract(providerCheck);
  const [currentLevel] = await platformCheck.members(walletData.address);
  if (Number(currentLevel) > 0) {
    // 체인에 이미 등록 → Firestore가 stale이면 동기화
    await db.collection('users').doc(uid).set(
      { onChain: { registered: true } },
      { merge: true }
    );
    throw new Error('이미 온체인 가입이 완료된 계정입니다');
  }

  // 수탁 지갑으로 서명
  const privateKey = decrypt(walletData.encryptedKey, masterSecret);
  const provider = getProvider();
  const signer = walletFromKey(privateKey, provider);
  const platform = getPlatformContract(signer);

  // 가스 추정 + 10% 여유
  const gasLimit = await estimateGasWithBuffer(platform, 'register', [mentorAddress]);
  const tx = await platform.register(mentorAddress, { gasLimit });
  const receipt = await tx.wait();

  // Firestore 업데이트
  await db.collection('users').doc(uid).set({
    onChain: {
      registered: true,
      registeredAt: admin.firestore.FieldValue.serverTimestamp(),
      mentorAddress,
      txHash: receipt.hash,
    },
  }, { merge: true });

  return {
    txHash: receipt.hash,
    address: walletData.address,
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
  // members() 반환: (level, mentor, exp, points, blocked)
  const [level] = await platform.members(address);

  if (Number(level) < 4) {
    throw new Error(
      `멘토 등록 조건 미충족: 레벨 4 이상 필요. 현재 레벨: ${level}`
    );
  }

  // DB 저장
  await db.collection('mentors').doc(normalEmail).set({
    email: normalEmail,
    address,
    level: Number(level),
    verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, address };
}

// ────────────────────────────────────────────────
// 온체인 회원 정보 조회
// ────────────────────────────────────────────────

/**
 * getUserOnChainData
 * jumpPlatform.getMember() 조회 + 원화(KRW) 환산 포함
 *
 * @param {string} uid - Firebase Auth UID
 * @returns {{ address, level, mentor, pointWei, payableWei, joinAt, blocked,
 *             pointDisplay, payableDisplay, pointKrw, payableKrw, krwPerUsd }}
 */
async function getUserOnChainData(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const address = userSnap.data()?.wallet?.address;
  if (!address) throw new Error('수탁 지갑이 없습니다');

  const provider = getProvider();
  const platform = getPlatformContract(provider);
  const hexContract = getHexContract(provider);
  const { fetchExchangeRates } = require('../wallet/exchange');

  // 온체인 조회 + 환율 조회 + 지갑 Point 잔액 병렬 실행
  // members() 반환: (uint32 level, address mentor, uint256 exp, uint256 points, bool blocked)
  const [[level, mentor, exp, points, blocked], ratesResult, walletHexBal] =
    await Promise.all([
      platform.members(address),
      fetchExchangeRates().catch(() => null),
      hexContract.balanceOf(address),
    ]);

  const krwPerUsd = ratesResult?.krwPerUsd ?? null;
  const vndPerUsd = ratesResult?.vndPerUsd ?? null;

  // Point wei → 각 통화 환산 (환율 없으면 null)
  const hexToKrw = (wei) => {
    if (!krwPerUsd) return null;
    return Math.round(parseFloat(ethers.formatEther(wei)) * krwPerUsd);
  };
  const hexToVnd = (wei) => {
    if (!vndPerUsd) return null;
    return Math.round(parseFloat(ethers.formatEther(wei)) * vndPerUsd);
  };
  const hexToUsd = (wei) => {
    return Math.round(parseFloat(ethers.formatEther(wei)) * 100) / 100;
  };

  // EXP는 wei 단위가 아닌 순수 카운터 (fee / 1e16)
  const expNum = Number(exp);
  const levelNum = Number(level);
  const requiredExp = levelNum > 0 ? levelNum * levelNum * 10000 : 10000;

  return {
    address,
    level: levelNum,
    mentor,
    exp: expNum,
    requiredExp,
    blocked,
    // 포인트 (Point wei 단위)
    pointWei: points.toString(),
    pointDisplay: parseFloat(ethers.formatEther(points)).toFixed(4),
    pointKrw: hexToKrw(points),
    pointVnd: hexToVnd(points),
    pointUsd: hexToUsd(points),
    // 수탁 지갑 실제 Point 잔액 (P2P 수령 포함)
    walletHexWei: walletHexBal.toString(),
    walletHexDisplay: parseFloat(ethers.formatEther(walletHexBal)).toFixed(4),
    walletHexKrw: hexToKrw(walletHexBal),
    walletHexUsd: hexToUsd(walletHexBal),
    walletHexVnd: hexToVnd(walletHexBal),
    krwPerUsd,
    vndPerUsd,
  };
}

// ────────────────────────────────────────────────
// 나의 멘티 목록 조회
// ────────────────────────────────────────────────

/**
 * getMyMentees
 * 1) Firestore onChain.mentorAddress 기준으로 멘티 주소 수집 (과거 전체 포함)
 * 2) 온체인 Registered 이벤트 최근 490,000 블록 스캔으로 보완
 * 3) members(address).mentor 재확인으로 멘토 변경 케이스 제거
 * 4) Firestore users 에서 uid/name 보완
 *
 * @param {string} uid - Firebase Auth UID
 * @returns {{ mentees: Array, myAddress: string|null }}
 */
async function getMyMentees(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const myAddress = userSnap.data()?.wallet?.address || null;

  const querySnap = await db.collection('users').where('mentorUid', '==', uid).limit(100).get();
  const menteeMap = {};
  
  await Promise.all(querySnap.docs.map(async (docSnap) => {
    const data = docSnap.data();
    const menteeUid = docSnap.id;
    const bpSnap = await db.collection('battle_players').doc(menteeUid).get();
    const earned = bpSnap.exists ? (bpSnap.data().generatedForMentor || 0) : 0;
    
    menteeMap[menteeUid] = {
      uid: menteeUid,
      name: data.displayName || data.name || data.email?.split('@')[0] || '익명',
      address: data.wallet?.address || '',
      registeredAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
      generatedForMentor: earned
    };
  }));

  const sortedMentees = Object.values(menteeMap).sort((a, b) => b.generatedForMentor - a.generatedForMentor);
  return { mentees: sortedMentees, myAddress };
}


