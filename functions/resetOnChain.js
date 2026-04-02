/**
 * resetOnChain.js
 * 모든 사용자의 onChain 필드를 초기화한다.
 * → 다음 접속 시 신규 jumpPlatform 컨트랙트에 재등록 유도
 *
 * 사용법 (functions 폴더에서):
 *   node resetOnChain.js
 *
 * 옵션:
 *   DRY_RUN=true  → 실제 삭제 없이 대상 목록만 출력
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── .secret.local 자동 로드 ──────────────────────────────────────────
const secretFile = path.join(__dirname, '.secret.local');
if (fs.existsSync(secretFile)) {
  fs.readFileSync(secretFile, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq < 0 || line.trim().startsWith('#')) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  });
}

const admin = require('firebase-admin');

// ── Firebase Admin 초기화 ────────────────────────────────────────────
if (!admin.apps.length) {
  const saFile = path.join(__dirname, 'service_account.json');
  if (fs.existsSync(saFile)) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saFile, 'utf8'))) });
  } else {
    admin.initializeApp();
  }
}
const db      = admin.firestore();
const DRY_RUN = process.env.DRY_RUN === 'true';

async function main() {
  const snap = await db.collection('users').get();
  console.log(`\n📦 전체 사용자: ${snap.size}명`);

  const targets = snap.docs.filter(d => d.data().onChain?.registered);
  console.log(`🔄 onChain 초기화 대상: ${targets.length}명`);

  if (targets.length === 0) {
    console.log('✅ 초기화할 데이터가 없습니다.');
    return;
  }

  if (DRY_RUN) {
    targets.forEach(d => console.log(`  - ${d.id}`));
    console.log('\n⚠️  DRY_RUN=true — 실제 변경 없음');
    return;
  }

  // Firestore 배치 쓰기 (500건 제한)
  const CHUNK = 400;
  let count = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = db.batch();
    targets.slice(i, i + CHUNK).forEach(d => {
      const prevMentor = d.data().onChain?.mentorAddress || null;
      // registered/txHash/registeredAt 만 삭제, mentorAddress는 보존
      const update = {
        'onChain.registered':   admin.firestore.FieldValue.delete(),
        'onChain.txHash':       admin.firestore.FieldValue.delete(),
        'onChain.registeredAt': admin.firestore.FieldValue.delete(),
      };
      if (!prevMentor) {
        update.onChain = admin.firestore.FieldValue.delete();
      }
      batch.update(d.ref, update);
    });
    await batch.commit();
    count += Math.min(CHUNK, targets.length - i);
    console.log(`  ✅ ${count}/${targets.length} 완료`);
  }

  console.log(`\n🏁 ${targets.length}명 onChain 필드 삭제 완료`);
  console.log('   → 이제 firebase deploy --only functions 실행하세요');
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
