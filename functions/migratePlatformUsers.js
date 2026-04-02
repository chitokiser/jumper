/**
 * migratePlatformUsers.js
 * 기존 사용자들을 신규 jumpPlatform 컨트랙트에 일괄 재등록한다.
 *
 * 사용법 (functions 폴더에서):
 *   node migratePlatformUsers.js
 *
 * 옵션:
 *   DRY_RUN=true   → 실제 트랜잭션 없이 대상 목록만 출력
 *   BATCH=10       → 병렬 처리 배치 크기 (기본 5)
 *
 * .secret.local 과 service_account.json 이 functions/ 폴더에 있으면 자동으로 읽습니다.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── .secret.local 자동 로드 ───────────────────────────────────────────
const secretFile = path.join(__dirname, '.secret.local');
if (fs.existsSync(secretFile)) {
  fs.readFileSync(secretFile, 'utf8')
    .split('\n')
    .forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    });
  console.log('✅ .secret.local 로드 완료');
}

const admin      = require('firebase-admin');
const { ethers } = require('ethers');
const { decrypt } = require('./wallet/crypto');
const {
  getProvider,
  getPlatformContract,
  getAdminWallet,
  walletFromKey,
  estimateGasWithBuffer,
  ADDRESSES,
} = require('./wallet/chain');

// ── Firebase Admin 초기화 ─────────────────────────────────────────────
if (!admin.apps.length) {
  const saFile = path.join(__dirname, 'service_account.json');
  if (fs.existsSync(saFile)) {
    const sa = JSON.parse(fs.readFileSync(saFile, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    console.log('✅ service_account.json 으로 Firebase Admin 초기화');
  } else {
    // GOOGLE_APPLICATION_CREDENTIALS 환경변수 사용
    admin.initializeApp();
    console.log('✅ GOOGLE_APPLICATION_CREDENTIALS 로 Firebase Admin 초기화');
  }
}
const db = admin.firestore();

// ── 설정 ──────────────────────────────────────────────────────────────
const DRY_RUN    = process.env.DRY_RUN === 'true';
const BATCH_SIZE = parseInt(process.env.BATCH ?? '5', 10);
const GAS_FUND   = ethers.parseEther('0.0002'); // 각 지갑에 보낼 가스비 BNB
const BOOTSTRAP_MENTOR = '0xc662c3B58bE7345DE30dd8188B2Acc977943186A'; // 멘토 없는 경우 폴백

async function main() {
  const masterSecret = process.env.WALLET_MASTER_SECRET;
  if (!masterSecret || masterSecret.includes('여기에')) {
    console.error('❌ .secret.local 의 WALLET_MASTER_SECRET을 실제 값으로 채워주세요.');
    process.exit(1);
  }
  if (!process.env.ADMIN_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY.includes('여기에')) {
    console.error('❌ .secret.local 의 ADMIN_PRIVATE_KEY를 실제 값으로 채워주세요.');
    process.exit(1);
  }

  const provider    = getProvider();
  const adminWallet = getAdminWallet();
  const platform    = getPlatformContract(provider);

  console.log('\n📋 신규 jumpPlatform 마이그레이션');
  console.log('  컨트랙트 :', ADDRESSES.jumpPlatform);
  console.log('  관리자   :', adminWallet.address);

  const bnbBal = await provider.getBalance(adminWallet.address);
  console.log('  관리자 BNB:', ethers.formatEther(bnbBal), 'BNB');

  if (DRY_RUN) console.log('\n⚠️  DRY_RUN=true — 실제 트랜잭션 없음\n');

  // ── Firestore에서 온체인 등록된 사용자 전체 조회 ──────────────────
  const snap = await db.collection('users')
    .where('onChain.registered', '==', true)
    .get();

  console.log(`\n📦 Firestore 등록 사용자: ${snap.size}명`);

  // ── 신규 컨트랙트 미등록 사용자 필터 ─────────────────────────────
  const todo = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const addr = data.wallet?.address;
    const enc  = data.wallet?.encryptedKey;
    if (!addr || !enc) continue; // 수탁 지갑 없으면 스킵

    const mentor = data.onChain?.mentorAddress || BOOTSTRAP_MENTOR;

    // 신규 컨트랙트에 이미 등록됐는지 확인
    const [level] = await platform.members(addr);
    if (Number(level) > 0) {
      console.log(`  ✅ 이미 등록됨: ${addr} (level ${level})`);
      continue;
    }

    todo.push({ uid: doc.id, addr, enc, mentor });
  }

  console.log(`\n🔄 재등록 필요: ${todo.length}명`);
  if (todo.length === 0) {
    console.log('✅ 모든 사용자가 이미 신규 컨트랙트에 등록되어 있습니다.');
    return;
  }

  if (DRY_RUN) {
    todo.forEach(u => console.log(`  - ${u.uid} / ${u.addr} → mentor: ${u.mentor}`));
    return;
  }

  // ── 배치 처리 ──────────────────────────────────────────────────────
  let success = 0;
  let failure = 0;

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    console.log(`\n▶ 배치 ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length}명)`);

    await Promise.all(batch.map(async (u) => {
      try {
        // 1) 가스비 확인 및 BNB 보충
        const curBnb = await provider.getBalance(u.addr);
        if (curBnb < GAS_FUND) {
          console.log(`  💸 BNB 전송 → ${u.addr}`);
          const fundTx = await adminWallet.sendTransaction({ to: u.addr, value: GAS_FUND });
          await fundTx.wait();
        }

        // 2) 수탁 지갑으로 register(mentorAddress)
        const privateKey = decrypt(u.enc, masterSecret);
        const signer     = walletFromKey(privateKey, provider);
        const pSigner    = getPlatformContract(signer);
        const gasLimit   = await estimateGasWithBuffer(pSigner, 'register', [u.mentor]);
        const tx         = await pSigner.register(u.mentor, { gasLimit });
        const receipt    = await tx.wait();

        // 3) Firestore 업데이트
        await db.collection('users').doc(u.uid).set({
          onChain: {
            registered:    true,
            registeredAt:  admin.firestore.FieldValue.serverTimestamp(),
            mentorAddress: u.mentor,
            txHash:        receipt.hash,
          },
        }, { merge: true });

        console.log(`  ✅ ${u.addr} → txHash: ${receipt.hash}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${u.addr}: ${err.message}`);
        failure++;
      }
    }));
  }

  console.log(`\n🏁 완료: 성공 ${success}명 / 실패 ${failure}명`);
  if (failure > 0) {
    console.log('   실패한 사용자는 다시 실행하면 재시도됩니다.');
  }
}

main().catch((err) => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
