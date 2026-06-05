'use strict';
// npcSystem.js — 가상 유저 50명 이벤트 브로드캐스터 (17±3분 랜덤 주기)

const admin = require('firebase-admin');
const db    = admin.firestore();
const { FieldValue } = admin.firestore;

// ── NPC 캐릭터 50명 ────────────────────────────────────────────────────────
const NPC_SEED = [
  { name:'Arthur22',    level:18 }, { name:'MorganHunter', level:24 },
  { name:'Ranger57',    level:31 }, { name:'Shadow2',      level:9  },
  { name:'Falcon5453',  level:42 }, { name:'Titan8',       level:35 },
  { name:'Phoenix99',   level:27 }, { name:'Wolf73',       level:21 },
  { name:'Drake47',     level:38 }, { name:'Viking3',      level:14 },
  { name:'StormX',      level:45 }, { name:'BladeEdge',    level:29 },
  { name:'Thunder55',   level:33 }, { name:'EchoWolf',     level:17 },
  { name:'Viper42',     level:40 }, { name:'Cobra33',      level:22 },
  { name:'SteelClaw',   level:36 }, { name:'IronFang5',    level:11 },
  { name:'Lance77',     level:48 }, { name:'AceRider',     level:25 },
  { name:'Logan9',      level:19 }, { name:'CrimsonX',     level:44 },
  { name:'NightBlade',  level:32 }, { name:'DarkWolf3',    level:7  },
  { name:'StarFire',    level:39 }, { name:'MoonHunter',   level:16 },
  { name:'SunStrike7',  level:50 }, { name:'GoldRush',     level:28 },
  { name:'SilverFox',   level:23 }, { name:'BronzeAxe9',   level:41 },
  { name:'CrystalX5',   level:15 }, { name:'DiamondKing',  level:47 },
  { name:'RubyFire',    level:30 }, { name:'EmeraldBow',   level:13 },
  { name:'ShadowFang',  level:43 }, { name:'OnyxBlade3',   level:26 },
  { name:'AmberX7',     level:34 }, { name:'JadeWolf',     level:8  },
  { name:'ObsidianS',   level:20 }, { name:'TitanFist9',   level:46 },
  { name:'Nexus7',      level:37 }, { name:'Vertex99',     level:12 },
  { name:'QuantumX',    level:49 }, { name:'ApexHunt',     level:10 },
  { name:'ZeroK5',      level:6  }, { name:'Hydra55',      level:44 },
  { name:'Cerberus9',   level:38 }, { name:'Olympus3',     level:22 },
  { name:'Kronos22',    level:31 }, { name:'Atlas88',       level:50 },
];

// ── 이벤트 정의 ───────────────────────────────────────────────────────────
const EVENT_TYPES = ['treasure_find','treasure_hide','dungeon','monsterrace','archery','relay'];

const GP_RANGE = {
  treasure_find: [80,  350],
  dungeon:       [150, 500],
  monsterrace:   [100, 350],
  archery:       [80,  420],
  relay:         [60,  260],
};

function _randGp(type) {
  const [min, max] = GP_RANGE[type] || [100, 300];
  return min + Math.floor(Math.random() * (max - min));
}

function _buildMsg(name, type, gp) {
  switch (type) {
    case 'treasure_find':
      return `🤖 NPC <b>${name}</b>님이 보물을 발견했습니다! +${gp} GP <i>(시스템 이벤트)</i>`;
    case 'treasure_hide':
      return `🤖 NPC <b>${name}</b>님이 새로운 보물을 숨겨두었습니다. <i>(시스템 이벤트)</i>`;
    case 'dungeon':
      return `⚔️ NPC <b>${name}</b>님이 던전 생존 성공! +${gp} GP <i>(시스템 이벤트)</i>`;
    case 'monsterrace':
      return `🐉 NPC <b>${name}</b>님 몬스터 레이스 우승! +${gp} GP <i>(시스템 이벤트)</i>`;
    case 'archery':
      return `🏹 NPC <b>${name}</b>님이 활쏘기 +${gp} GP <i>(시스템 이벤트)</i>`;
    case 'relay':
      return `🏃 NPC <b>${name}</b>님이 이어달리기 +${gp} GP <i>(시스템 이벤트)</i>`;
    default:
      return `🤖 NPC <b>${name}</b>님이 +${gp} GP 획득! <i>(시스템 이벤트)</i>`;
  }
}

// ── 스케줄러 실행 ─────────────────────────────────────────────────────────
// index.js의 onSchedule('every 1 minutes') 에서 호출
async function runNpcScheduler(botToken, chatId) {
  if (!chatId || !botToken) return { skipped: true, reason: 'no_config' };

  const stateRef = db.collection('system').doc('npcState');
  const stateSnap = await stateRef.get();
  const state = stateSnap.data() || {};

  const now = Date.now();
  const nextEventAt = state.nextEventAt?.toMillis?.() ?? 0;

  // 아직 발화 시각 미도달
  if (now < nextEventAt) return { skipped: true, reason: 'not_yet' };

  // 실제 유저 이벤트가 최근 4분 내 발생했으면 NPC 이벤트 5분 후로 지연
  const lastReal = state.lastRealEventAt?.toMillis?.() ?? 0;
  if (now - lastReal < 4 * 60 * 1000) {
    const delay = (5 + Math.random() * 2) * 60 * 1000;
    await stateRef.set({ nextEventAt: new Date(now + delay) }, { merge: true });
    return { skipped: true, reason: 'real_user_priority' };
  }

  // 중복 방지: 최근 5회 이벤트 키 목록
  const recent = state.recentKeys || [];

  // NPC 선택 (최근 사용된 NPC 제외)
  const recentNpcs = recent.map(k => k.split(':')[0]);
  const available  = NPC_SEED.filter(n => !recentNpcs.includes(n.name));
  const pool       = available.length >= 3 ? available : NPC_SEED;
  const npc        = pool[Math.floor(Math.random() * pool.length)];

  // 이벤트 선택 (최근 같은 type 연속 방지)
  const recentTypes = recent.map(k => k.split(':')[1]);
  const typePool    = EVENT_TYPES.filter(t => t !== recentTypes[recentTypes.length - 1]);
  const eventType   = typePool[Math.floor(Math.random() * typePool.length)];

  const gp  = eventType === 'treasure_hide' ? 0 : _randGp(eventType);
  const msg = _buildMsg(npc.name, eventType, gp);
  const key = `${npc.name}:${eventType}`;

  // Telegram 전송
  const { sendTelegramMessage } = require('./telegram');
  await sendTelegramMessage(botToken, chatId, msg, 'HTML');

  // 다음 이벤트 시각 설정: 14~20분 후
  const intervalMs = (14 + Math.random() * 6) * 60 * 1000;
  const newRecent  = [...recent, key].slice(-5);

  await stateRef.set({
    nextEventAt:     new Date(now + intervalMs),
    lastEventAt:     FieldValue.serverTimestamp(),
    lastNpcName:     npc.name,
    lastEventType:   eventType,
    recentKeys:      newRecent,
  }, { merge: true });

  return { ok: true, npc: npc.name, event: eventType, gp };
}

// ── 실제 유저 이벤트 발생 시 타임스탬프 갱신 (broadcastGpEvent에서 호출) ──
async function markRealUserEvent() {
  await db.collection('system').doc('npcState')
    .set({ lastRealEventAt: FieldValue.serverTimestamp() }, { merge: true });
}

// ── NPC 캐릭터 초기 시드 ─────────────────────────────────────────────────
async function seedNpcCharacters() {
  const col   = db.collection('npc_characters');
  const snap  = await col.limit(1).get();
  if (!snap.empty) return { skipped: true, count: NPC_SEED.length };

  const batch = db.batch();
  NPC_SEED.forEach((npc, idx) => {
    const ref = col.doc();
    batch.set(ref, {
      id:         ref.id,
      name:       npc.name,
      level:      npc.level,
      avatar:     String((idx % 10) + 1), // 1~10 아바타 순환
      created_at: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return { seeded: true, count: NPC_SEED.length };
}

module.exports = { runNpcScheduler, markRealUserEvent, seedNpcCharacters };
