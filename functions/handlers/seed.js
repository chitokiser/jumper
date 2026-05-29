// functions/handlers/seed.js
// 관리자 전용 — 각종 랭킹 더미 데이터 100개 삽입
'use strict';

const admin = require('firebase-admin');
const db = admin.firestore();

// ── 이름 풀 ─────────────────────────────────────────────────────────────────
const NAMES = [
  'Nguyễn Minh Tuấn','Trần Thị Hương','Lê Văn Hùng','Phạm Thị Lan',
  'Hoàng Văn Nam','Vũ Thị Mai','Đặng Văn Đức','Bùi Thị Thu',
  'Đỗ Văn Thắng','Ngô Thị Hoa','Dương Văn Long','Lý Thị Trang',
  'Phan Văn Khoa','Trịnh Thị Yến','Đinh Văn Phúc','Lương Thị Ngọc',
  'Hà Văn Dũng','Cao Thị Linh','Tăng Văn Bảo','Võ Thị Quỳnh',
  '김민준','이서연','박지훈','최수연','정민서','강현우','조유진',
  '윤지호','임소희','한준혁','오세은','신동현','류채원','허준서',
  '남지수','심규민','안예진','문재원','배소영','공민혁',
  'Anh Khoa','Bảo Ngọc','Chí Kiên','Duy Khang','Gia Bảo',
  'Hải Đăng','Khánh Linh','Minh Châu','Nhật Nam','Phúc An',
  'Quỳnh Anh','Rin Nguyễn','Sơn Tùng','Thanh Thảo','Uyên Linh',
  'Vinh Quang','Xuân Mạnh','Yến Nhi','Kha Đăng','Nhựt Tiến',
  '이도윤','박서진','김하은','최민재','정수아','오시우','강다은',
  '윤하준','신지민','배수현','남도현','임채현','장민지','황준영',
  'Thành Đạt','Bích Ngọc','Tuấn Kiệt','Thu Hà','Mỹ Linh',
  'Hoài Nam','Ánh Tuyết','Đình Toàn','Hương Giang','Phước An',
  '조아현','류진우','허다연','문성준','안서진',
  'Cát Tiên','Diệu Linh','Gia Hân','Hồng Nhung','Kim Ngân',
  '김서윤','이준호','박하늘','최지우','정아린',
];

function randName(i) {
  return NAMES[i % NAMES.length];
}

// 자연스러운 감소 곡선 (상위권 간격이 넓고 하위권은 촘촘)
function rankValue(rank, max) {
  const ratio = Math.pow(1 - rank / 100, 1.6);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.max(1, Math.round(max * ratio * jitter));
}

// ── 더미 배틀 플레이어 100명 ─────────────────────────────────────────────────
async function seedBattlePlayers() {
  const MONSTERS_MAX  = 8500;
  const TREASURES_MAX = 950;
  const batch = db.batch();
  const existing = new Set();

  // 기존 더미 문서 ID 목록 (덮어쓰기용)
  const snap = await db.collection('battle_players')
    .where('_isDummy', '==', true).limit(120).get();
  snap.docs.forEach(d => existing.add(d.id));

  for (let i = 0; i < 100; i++) {
    const docId  = `dummy_player_${String(i + 1).padStart(3, '0')}`;
    const level  = Math.max(1, Math.round(50 * Math.pow(1 - i / 100, 1.2) + Math.random() * 3));
    const monstersKilled  = rankValue(i, MONSTERS_MAX);
    const treasuresFound  = rankValue(i, TREASURES_MAX);

    batch.set(db.collection('battle_players').doc(docId), {
      uid:           docId,
      displayName:   randName(i),
      photoURL:      null,
      level,
      gsLevel:       level,
      xp:            level * 1200 + Math.round(Math.random() * 800),
      hp:            level * 1000,
      mp:            level * 1000,
      maxHp:         level * 1000,
      maxMp:         level * 1000,
      gold:          Math.round(50000 * Math.pow(1 - i / 100, 1.3)),
      monstersKilled,
      treasuresFound,
      lat:           21.0 + Math.random() * 0.15,
      lng:           105.8 + Math.random() * 0.25,
      updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      _isDummy:      true,
    });
  }

  await batch.commit();
  return { inserted: 100, collection: 'battle_players' };
}

// ── 메인 시드 함수 ───────────────────────────────────────────────────────────
async function seedAllRankings() {
  const results = {};

  // battle_players (monstersKilled + treasuresFound 양쪽 커버)
  results.battlePlayers = await seedBattlePlayers();

  return results;
}

module.exports = { seedAllRankings };
