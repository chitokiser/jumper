// /assets/js/pages/merchants.battle.js
// 위치 기반 전투 시스템 (merchants.js에서 분리)
// ctx 객체를 통해 core와 공유 상태를 교환한다.

import { collection, getDocs, doc, getDoc, query, where,
         addDoc, deleteDoc, setDoc, serverTimestamp, onSnapshot }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { hasSpriteConfig, createMonsterSpriteOverlay }
  from './merchants.monster-sprite.js';
import { createPlayerSpriteOverlay }
  from './merchants.player-sprite.js';
import { MonsterGrid }
  from './merchants.monster-grid.js';
import { gsAdminGetSpawns, gsAdminAddSpawn, gsAdminDeleteSpawn, gsAdminKillMonster,
         gsAdminGetMonsterTypes, gsAdminPatchMonsterType,
         isGameServerConnected, connectToGameServer, sendPlayerRevive }
  from './merchants.gameserver.js';
import { _t } from './merchants.i18n.js';

// ── 공유 컨텍스트 참조 ─────────────────────────────────────────────────────────
// initBattle(ctx, callbacks) 호출 후 설정됨
let _ctx = null;

// ── GS 스킬 콜백 (merchants.js가 setGsSkillCallback으로 주입) ──────────────────
// fn(skillId, centerLat, centerLng, rangeM) — GS 몬스터 범위 피해 처리
let _gsSkillCallback = null;
export function setGsSkillCallback(fn) { _gsSkillCallback = fn; }

// ── GS 몬스터 getter (merchants.js가 주입) ────────────────────────────────────
let _gsMobsGetter = null;
export function setGsMobsGetter(fn) { _gsMobsGetter = fn; }

// ── 내부 배틀 상태 ────────────────────────────────────────────────────────────
let _player       = { level:1, hp:1000, mp:1000, maxHp:1000, maxMp:1000, xp:0, gold:0, token:30,
                      weaponBonus:100,
                      equippedWeapon:'weapon_100',
                      equippedHelmet:'armo_10', equippedLegs:null, equippedGloves:null, equippedBoots:null,
                      gsExp:0, gsLevel:1, nextLevelExp:400000 };
let _monsters     = [];        // [{id, name, lat, lng, hp, maxHp, atk, detectRadius, image, active, monsterType?}]
let _towers       = [];        // [{id, name, lat, lng, atk, radius, active}]
let _monsterMarkers  = {};     // { id: Marker }  — 비-스프라이트 몬스터
let _monsterOverlays = {};     // { id: MonsterSpriteOverlay } — 스프라이트 몬스터 (dragon 등)
let _towerMarkers    = {};     // { id: Marker }
let _towerRanges     = {};     // { id: Circle }
let _showTowerRange  = false;
let _battleLoopId    = null;
let _attackCd        = false;  // 유저 공격 쿨다운 (1.5초)
let _clickAtkCd      = {};     // { monsterId: bool }
let _towerCd         = {};     // { towerId: bool }
let _towerHpState    = {};     // { towerId: {current, max} }
let _towerAtkCd      = {};     // { towerId: bool } 유저→타워 공격 쿨다운
let _towerRespawn    = {};     // { towerId: timeoutId }
let _monsterAtkTs    = {};     // { monsterId: timestamp } 타임스탬프 기반 쿨다운
const _monsterGrid   = new MonsterGrid();
let _lastProximityPos = null;  // GPS 스캔 쓰로틀용 마지막 위치
let _dbgNearby = 0, _dbgAiCount = 0, _dbgFpsTick = 0, _dbgFpsLast = Date.now(), _dbgFps = 0;
let _healAccum       = 0;      // HP 회복용 누적거리(m)
let _mpHealAccum     = 0;      // MP 회복용 누적거리(m)
let _reviveWalkDist  = 0;      // 사망 후 부활용 누적거리(m)
let _currentSpeed    = 0;      // km/h
let _isDead          = false;
let _goldDrops       = [];     // [{id, lat, lng, amount, marker}]
let _adminPlaceMode  = null;   // 'monster' | 'tower' | 'deco' | null
let _adminMapListener = null;
let _decoMarkers     = [];
let _frozenUntil     = {};     // { monsterId: expiryTimestamp } 동결 만료
let _skillCd         = {};     // { lightning|ice|fire: expiryTimestamp }
let _keyDefs         = [];     // [{ id, name, dropRate, image, active }] — treasure_keys
let _deathLat        = null;   // 사망 위치 (재접속 시 마커 표시용)
let _deathLng        = null;
let _deathMarker     = null;   // google.maps.Marker — 사망 지점 해골 마커
let _battleHpUnsub       = null;    // battle_hp onSnapshot 구독
let _monsterRespawnTimers = {};      // { monsterId: timeoutId }
let _monsterAggro        = {};      // { monsterId: uid } 어그로 캐시
let _aggroClaimed        = new Set(); // 이미 어그로 클레임한 몬스터 ID
let _nearbyPlayerMarkers  = {};      // { uid: google.maps.Marker } 근처 플레이어 마커
let _nearbyPlayersUnsub   = null;    // battle_players onSnapshot 구독
let _lastPosWriteAt       = 0;      // 위치 Firestore 저장 쓰로틀

// ── 상점 상태 ─────────────────────────────────────────────────────────────────
let _shops        = [];   // [{id, name, type, lat, lng, items, active}]
let _shopMarkers  = {};   // { shopId: google.maps.Marker }
const SHOP_RANGE_M = 20;  // 상점 진입 반경(m)
const SHOP_EXIT_M  = 30;  // 상점 이탈 판정 반경(m) — GPS 노이즈로 인한 오발동 방지 히스테리시스
const SHOP_ICONS  = { weapon_armor: '⚔️', potion: '🧪', misc: '🛍️' };

// ── 스킬 상수 ────────────────────────────────────────────────────────────────
const SKILL_MP_COST    = 100;
const SKILL_RANGE_M    = 40;
const WIND_RANGE_M     = 30;   // 회오리 바람 전용 범위
const METEOR_RANGE_M   = 60;   // 유성 전용 범위
const OVERVIEW_ZOOM    = 15;   // 이 줌 이하(광역 조망) → 모든 오브제 표시
const SKILL_CD_MS    = { lightning: 15000, ice: 25000, fire: 15000, wind: 20000, meteor: 40000, heal: 30000 };
const SKILL_FREEZE_MS = 20000;
// 서버와 동일한 배율 (클라이언트 float 표시용)
const GS_SKILL_MULT  = { lightning: 2.0, ice: 1.5, fire: 2.0, wind: 2.5, meteor: 3.0 };

// ── 유틸 (core에서 받지 않고 직접 구현) ────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── 초기화 ────────────────────────────────────────────────────────────────────
/**
 * @param {object} ctx - 공유 컨텍스트 (core가 생성, battle이 읽고 씀)
 * @param {object} callbacks
 * @param {(lat:number, lng:number) => void} callbacks.onCheckProximity
 * @param {() => void} callbacks.onLoadInventory
 * @param {() => void} callbacks.onUpdateDistDisplay
 */
export function initBattle(ctx, callbacks) {
  _ctx = ctx;
  _ctx._onCheckProximity    = callbacks.onCheckProximity    || (() => {});
  _ctx._onLoadInventory     = callbacks.onLoadInventory     || (() => {});
  _ctx._onUpdateDistDisplay = callbacks.onUpdateDistDisplay || (() => {});

  // 줌 변경 시 가시성 갱신 (OVERVIEW_ZOOM 이하면 전체 표시)
  ctx.map?.addListener('zoom_changed', () => {
    const pos = _ctx?.lastPos;
    _refreshBattleVisibility(pos?.lat, pos?.lng);
  });

  // GS 스폰 목록 새로고침 버튼
  document.getElementById('btnRefreshGsSpawns')?.addEventListener('click', () => refreshGsSpawnList());
  // Firestore 몬스터 목록 새로고침 버튼
  document.getElementById('btnRefreshFsMonsters')?.addEventListener('click', () => refreshFirestoreMonsterList());
  // 몬스터 스탯 설정 모달 버튼
  document.getElementById('btnMonsterStatModal')?.addEventListener('click', () => openMonsterStatModal());
  document.getElementById('btnCloseMonsterStatModal')?.addEventListener('click', () => closeMonsterStatModal());
  document.getElementById('btnMonsterStatCancel')?.addEventListener('click', () => closeMonsterStatModal());
  document.getElementById('btnMonsterStatSaveAll')?.addEventListener('click', () => saveAllMonsterStats());

  startNearbyPlayersWatch();
}

// ── 사운드 시스템 (Web Audio API) ────────────────────────────────────────────
let _audioCtx = null;
function getAC() {
  if (!_audioCtx || _audioCtx.state === 'closed')
    _audioCtx = new (window.AudioContext || /** @type {any} */(window).webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
export function playSound(type) {
  try {
    const ac = getAC();
    const osc = (freq, type2='sine') => { const o = ac.createOscillator(); o.type = type2; o.frequency.value = freq; return o; };
    const gain = (vol) => { const g = ac.createGain(); g.gain.value = vol; g.connect(ac.destination); return g; };
    const ramp = (node, from, to, dur) => { node.setValueAtTime(from, ac.currentTime); node.exponentialRampToValueAtTime(to, ac.currentTime + dur); };
    const noise = (dur, vol=0.4) => {
      const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
      const s = ac.createBufferSource(); s.buffer = buf;
      const g = gain(vol); s.connect(g); s.start(); return s;
    };
    const tone = (freq, vol, dur, t=0, type2='sine') => {
      const o = osc(freq, type2), g = gain(0);
      o.connect(g); ramp(g.gain, vol, 0.001, dur); o.start(ac.currentTime+t); o.stop(ac.currentTime+t+dur);
    };
    switch (type) {
      case 'box_hit': {
        // 쫀득한 나무 타격음 — 둔탁한 저음 + 짧은 공명
        const bh = ac.createBuffer(1, Math.floor(ac.sampleRate*0.08), ac.sampleRate);
        const bhd = bh.getChannelData(0);
        for (let i=0; i<bhd.length; i++) bhd[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.012));
        const bhs=ac.createBufferSource(); bhs.buffer=bh;
        const bhf=ac.createBiquadFilter(); bhf.type='lowpass'; bhf.frequency.value=420; bhf.Q.value=5.5;
        const bhg=ac.createGain(); bhg.gain.value=1.8;
        bhs.connect(bhf); bhf.connect(bhg); bhg.connect(ac.destination); bhs.start();
        tone(120,0.6,0.07,0,'sine'); tone(80,0.35,0.12,0.01,'sine'); tone(200,0.15,0.04,0,'triangle');
        break;
      }
      case 'arrow_shot':
        noise(0.05, 0.3);
        tone(680, 0.55, 0.07, 0, 'sawtooth');
        tone(380, 0.35, 0.11, 0.02, 'sawtooth');
        tone(200, 0.2,  0.09, 0.04, 'sine');
        break;
      case 'melee_hit': {
        // 칼 타격음 — 쇳소리 순간 + 둔탁한 충격
        noise(0.035, 0.9);
        tone(480, 0.55, 0.04, 0, 'sawtooth');
        tone(240, 0.4, 0.09, 0.02, 'square');
        tone(140, 0.25, 0.18, 0.03);
        break;
      }
      case 'tower_shot':
        tone(900,0.35,0.04,0,'square');
        tone(600,0.2,0.07,0.02,'sawtooth');
        noise(0.2,0.18);
        tone(180,0.18,0.18,0.05);
        break;
      case 'cannon_shot': {
        const cbuf = ac.createBuffer(1, Math.floor(ac.sampleRate*0.018), ac.sampleRate);
        const cd = cbuf.getChannelData(0);
        for (let i=0;i<cd.length;i++) cd[i]=(Math.random()*2-1)*Math.pow(1-i/cd.length,2);
        const cs=ac.createBufferSource(); cs.buffer=cbuf;
        const cg=ac.createGain(); cg.gain.value=1.4; cs.connect(cg); cg.connect(ac.destination); cs.start();

        const boom=ac.createOscillator(); boom.type='sine';
        boom.frequency.setValueAtTime(90,ac.currentTime);
        boom.frequency.exponentialRampToValueAtTime(22,ac.currentTime+0.28);
        const bg=ac.createGain();
        bg.gain.setValueAtTime(0,ac.currentTime);
        bg.gain.linearRampToValueAtTime(1.8,ac.currentTime+0.006);
        bg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+1.0);
        boom.connect(bg); bg.connect(ac.destination); boom.start(); boom.stop(ac.currentTime+1.0);

        const mb=ac.createOscillator(); mb.type='sawtooth';
        mb.frequency.setValueAtTime(130,ac.currentTime);
        mb.frequency.exponentialRampToValueAtTime(38,ac.currentTime+0.22);
        const mg=ac.createGain();
        mg.gain.setValueAtTime(0.9,ac.currentTime);
        mg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.28);
        mb.connect(mg); mg.connect(ac.destination); mb.start(); mb.stop(ac.currentTime+0.28);

        const nbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.45),ac.sampleRate);
        const nd=nbuf.getChannelData(0);
        for(let i=0;i<nd.length;i++) nd[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.07));
        const ns=ac.createBufferSource(); ns.buffer=nbuf;
        const bpf=ac.createBiquadFilter(); bpf.type='bandpass'; bpf.frequency.value=220; bpf.Q.value=0.6;
        const ng=ac.createGain(); ng.gain.value=1.1;
        ns.connect(bpf); bpf.connect(ng); ng.connect(ac.destination); ns.start();

        const rbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*1.3),ac.sampleRate);
        const rd=rbuf.getChannelData(0);
        for(let i=0;i<rd.length;i++) rd[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.38));
        const rs=ac.createBufferSource(); rs.buffer=rbuf;
        const lpf=ac.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=75;
        const rg=ac.createGain(); rg.gain.value=0.75;
        rs.connect(lpf); lpf.connect(rg); rg.connect(ac.destination); rs.start();
        break;
      }
      case 'cannon_hit': {
        const ibuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.55),ac.sampleRate);
        const id2=ibuf.getChannelData(0);
        for(let i=0;i<id2.length;i++) id2[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.09));
        const is=ac.createBufferSource(); is.buffer=ibuf;
        const ibpf=ac.createBiquadFilter(); ibpf.type='bandpass'; ibpf.frequency.value=180; ibpf.Q.value=0.5;
        const ig=ac.createGain(); ig.gain.value=1.3;
        is.connect(ibpf); ibpf.connect(ig); ig.connect(ac.destination); is.start();
        const ib=ac.createOscillator(); ib.type='sine';
        ib.frequency.setValueAtTime(75,ac.currentTime);
        ib.frequency.exponentialRampToValueAtTime(20,ac.currentTime+0.3);
        const ibg=ac.createGain();
        ibg.gain.setValueAtTime(1.2,ac.currentTime);
        ibg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.35);
        ib.connect(ibg); ibg.connect(ac.destination); ib.start(); ib.stop(ac.currentTime+0.35);
        break;
      }
      case 'monster_atk':
        noise(0.12, 0.6);
        tone(160, 0.5, 0.09, 0, 'sawtooth');
        tone(85,  0.35, 0.18, 0.04);
        tone(220, 0.25, 0.06, 0, 'square');
        break;
      case 'monster_atk_dragon': {
        // 드래곤 포효 — 저음 스윕 + 공기 진동
        const drOsc = ac.createOscillator(); drOsc.type = 'sawtooth';
        drOsc.frequency.setValueAtTime(130, ac.currentTime);
        drOsc.frequency.exponentialRampToValueAtTime(22, ac.currentTime + 1.0);
        const drG = ac.createGain();
        drG.gain.setValueAtTime(0, ac.currentTime);
        drG.gain.linearRampToValueAtTime(1.3, ac.currentTime + 0.06);
        drG.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.0);
        drOsc.connect(drG); drG.connect(ac.destination); drOsc.start(); drOsc.stop(ac.currentTime + 1.0);
        const dr2 = ac.createOscillator(); dr2.type = 'sine';
        dr2.frequency.setValueAtTime(65, ac.currentTime);
        dr2.frequency.exponentialRampToValueAtTime(18, ac.currentTime + 1.1);
        const dr2G = ac.createGain(); dr2G.gain.setValueAtTime(0.9, ac.currentTime);
        dr2G.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.1);
        dr2.connect(dr2G); dr2G.connect(ac.destination); dr2.start(); dr2.stop(ac.currentTime + 1.1);
        noise(0.18, 0.75);
        break;
      }
      case 'monster_atk_orc': {
        // 오크 으르렁 — 중음 진동 + 타격 임팩트
        const orOsc = ac.createOscillator(); orOsc.type = 'square';
        orOsc.frequency.setValueAtTime(190, ac.currentTime);
        orOsc.frequency.exponentialRampToValueAtTime(75, ac.currentTime + 0.38);
        const orG = ac.createGain();
        orG.gain.setValueAtTime(0, ac.currentTime);
        orG.gain.linearRampToValueAtTime(1.0, ac.currentTime + 0.025);
        orG.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.38);
        orOsc.connect(orG); orG.connect(ac.destination); orOsc.start(); orOsc.stop(ac.currentTime + 0.38);
        noise(0.09, 0.7);
        tone(95, 0.5, 0.2, 0.02, 'sine');
        break;
      }
      case 'monster_atk_pirate': {
        // 해적 칼 휘두르기 — 금속 쉭 + 충격
        tone(1300, 0.55, 0.05, 0, 'sawtooth');
        tone(850,  0.4,  0.08, 0.01, 'sawtooth');
        noise(0.07, 0.65);
        tone(140, 0.45, 0.16, 0.05, 'sine');
        break;
      }
      case 'critical_hit':
        tone(880,0.5,0.05,0,'square');
        tone(1100,0.4,0.08,0.04,'square');
        noise(0.06,0.6);
        tone(660,0.35,0.12,0.07);
        break;
      case 'arrow_hit':
        noise(0.14, 1.0);
        tone(180, 0.6, 0.09, 0, 'square');
        tone(110, 0.4, 0.15, 0.03, 'sine');
        break;
      case 'player_hit': {
        // 짧은 피격 비명 — 보이스 피치 다운스윕 + 임팩트
        const phDur = 0.28;
        const phOsc = ac.createOscillator(); phOsc.type = 'sawtooth';
        phOsc.frequency.setValueAtTime(580, ac.currentTime);
        phOsc.frequency.exponentialRampToValueAtTime(190, ac.currentTime + phDur);
        const phBpf = ac.createBiquadFilter(); phBpf.type = 'bandpass'; phBpf.frequency.value = 1200; phBpf.Q.value = 3.5;
        const phG = ac.createGain();
        phG.gain.setValueAtTime(0.001, ac.currentTime);
        phG.gain.linearRampToValueAtTime(0.55, ac.currentTime + 0.015);
        phG.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + phDur);
        phG.connect(ac.destination);
        phOsc.connect(phBpf); phBpf.connect(phG);
        phOsc.start(); phOsc.stop(ac.currentTime + phDur);
        noise(0.04, 0.45);
        break;
      }
      case 'monster_die': [440,330,220,165].forEach((f,i)=>tone(f,0.28,0.14,i*0.09)); break;
      case 'player_die': {
        // 사망 비명 — 길고 처절한 피치 다운스윕
        const pdDur = 0.85;
        const pdOsc = ac.createOscillator(); pdOsc.type = 'sawtooth';
        pdOsc.frequency.setValueAtTime(500, ac.currentTime);
        pdOsc.frequency.exponentialRampToValueAtTime(70, ac.currentTime + pdDur);
        const pdBpf = ac.createBiquadFilter(); pdBpf.type = 'bandpass'; pdBpf.frequency.value = 950; pdBpf.Q.value = 2.5;
        const pdG = ac.createGain();
        pdG.gain.setValueAtTime(0.001, ac.currentTime);
        pdG.gain.linearRampToValueAtTime(0.65, ac.currentTime + 0.02);
        pdG.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + pdDur);
        pdG.connect(ac.destination);
        pdOsc.connect(pdBpf); pdBpf.connect(pdG);
        pdOsc.start(); pdOsc.stop(ac.currentTime + pdDur);
        tone(80, 0.3, 0.7, 0.1);
        break;
      }
      case 'heal':        [523,659,784].forEach((f,i)=>tone(f,0.18,0.1,i*0.07)); break;
      case 'revive':      [261,329,392,523,659,784].forEach((f,i)=>tone(f,0.3,0.15,i*0.09)); break;
      case 'gold_drop':   [1047,1319,1568].forEach((f,i)=>tone(f,0.35,0.18,i*0.07,'triangle')); break;
      case 'gold_pickup': [523,784,1047,1319].forEach((f,i)=>tone(f,0.3,0.1,i*0.05)); break;
      case 'error_locked':[200,180].forEach((f,i)=>tone(f,0.25,0.12,i*0.14,'square')); break;
      // 스킬 사운드
      case 'skill_lightning': {
        // 벼락: 크랙 + 천둥 저음
        noise(0.25, 0.12);
        tone(80, 0.6, 0.5, 0.05);
        tone(140, 0.4, 0.3, 0);
        [1800,1200,900].forEach((f,i)=>tone(f,0.3,0.06,i*0.03,'square'));
        break;
      }
      case 'skill_ice': {
        // 얼음: 고음 크리스탈 + 서리 노이즈
        [1047,1319,1568,2093].forEach((f,i)=>tone(f,0.2,0.4,i*0.06,'triangle'));
        noise(0.06, 0.7);
        break;
      }
      case 'skill_fire': {
        // 화염: 로우 붐 + 파직 노이즈
        tone(60, 0.7, 0.8, 0);
        tone(120, 0.5, 0.5, 0.05);
        noise(0.3, 0.4);
        noise(0.15, 0.9);
        break;
      }
      case 'skill_no_mp': [260,220].forEach((f,i)=>tone(f,0.3,0.15,i*0.1,'sawtooth')); break;
      case 'levelup':
        [523,659,784,1047,1319,1568].forEach((f,i)=>tone(f,0.35,0.2,i*0.07,'triangle'));
        tone(2093,0.4,0.4,0.4,'sine');
        break;
      // ── 슬롯·기억력 게임 사운드 ──────────────────────────────────────────────
      case 'hit': {
        // 카드 매칭 / 릴 정지 — 맑은 핑 음
        const hg = gain(0.28);
        const ho = ac.createOscillator(); ho.type = 'sine'; ho.frequency.value = 880;
        ho.frequency.exponentialRampToValueAtTime(1320, ac.currentTime + 0.06);
        hg.gain.setValueAtTime(0.28, ac.currentTime);
        hg.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
        ho.connect(hg); ho.start(); ho.stop(ac.currentTime + 0.22);
        tone(1760, 0.12, 0.1, 0.04, 'triangle');
        break;
      }
      case 'slot_win': {
        // 슬롯 당첨 — 코인 연타 + 상승 팡파르
        [523,659,784,1047].forEach((f,i)=>tone(f,0.28,0.14,i*0.06,'triangle'));
        noise(0.06, 0.18);
        break;
      }
      case 'miss': {
        // 미스 / 틀림 — 짧은 버저
        tone(220, 0.3, 0.12, 0, 'sawtooth');
        tone(180, 0.2, 0.1, 0.08, 'sawtooth');
        break;
      }
      case 'dead': {
        // 게임 오버 — 하강 피치 + 잔향
        const ddur = 1.0;
        const dOsc = ac.createOscillator(); dOsc.type = 'sawtooth';
        dOsc.frequency.setValueAtTime(440, ac.currentTime);
        dOsc.frequency.exponentialRampToValueAtTime(55, ac.currentTime + ddur);
        const dg = gain(0);
        dg.gain.setValueAtTime(0.4, ac.currentTime);
        dg.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + ddur);
        dOsc.connect(dg); dOsc.start(); dOsc.stop(ac.currentTime + ddur);
        tone(110, 0.25, 0.6, 0.1);
        break;
      }
    }
  } catch { /* 오디오 미지원 무시 */ }
}

// ── 화살 발사 애니메이션 ──────────────────────────────────────────────────────
export function animateArrow(fromLat, fromLng, toLat, toLng, color, onHit, startPx) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) { onHit?.(); return; }

  // 픽셀 좌표 계산. startPx가 있으면 그것을 우선 사용 (활 끝 위치)
  const ow = overlay.offsetWidth  || 300;
  const oh = overlay.offsetHeight || 300;
  const sp = startPx || latLngToPixel(fromLat, fromLng) || { x: ow * 0.5, y: oh * 0.5 };
  const ep = latLngToPixel(toLat,   toLng)   || { x: ow * 0.5, y: oh * 0.45 };

  const dx = ep.x - sp.x;
  const dy = ep.y - sp.y;
  const rawDist = Math.sqrt(dx * dx + dy * dy);
  const angle   = rawDist > 0 ? Math.atan2(dy, dx) * 180 / Math.PI : -90;

  // 줌이 낮을 때 픽셀 거리가 너무 짧아 보이지 않으므로 최소 80px 보장
  const MIN_PX = 80;
  let tx = ep.x, ty = ep.y;
  if (rawDist < MIN_PX) {
    const scale = MIN_PX / (rawDist || 1);
    tx = sp.x + dx * scale;
    ty = sp.y + dy * scale;
  }

  const el = document.createElement('div');
  el.className = 'arrow-proj';
  el.style.cssText = `left:${sp.x}px;top:${sp.y}px;background:${color};
    box-shadow:0 0 5px ${color};transform:translate(-50%,-50%) rotate(${angle}deg)`;
  overlay.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.left = tx + 'px';
    el.style.top  = ty + 'px';
  }));

  setTimeout(() => {
    el.remove();
    const hit = document.createElement('div');
    hit.className = 'hit-flash';
    hit.style.cssText = `left:${ep.x}px;top:${ep.y}px;background:radial-gradient(circle,${color},transparent)`;
    overlay.appendChild(hit);
    setTimeout(() => hit.remove(), 320);
    onHit?.();
  }, 300);
}

// ── 타워 투사체 애니메이션 ────────────────────────────────────────────────────
function animateTowerShot(fromLat, fromLng, toLat, toLng, onHit) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) { onHit?.(); return; }
  const sp = latLngToPixel(fromLat, fromLng);
  const ep = latLngToPixel(toLat,   toLng);
  if (!sp || !ep) { onHit?.(); return; }

  const angle = Math.atan2(ep.y - sp.y, ep.x - sp.x) * 180 / Math.PI;

  const ring = document.createElement('div');
  ring.className = 'tower-launch-ring';
  ring.style.cssText = `left:${sp.x}px;top:${sp.y}px;`;
  overlay.appendChild(ring);
  setTimeout(() => ring.remove(), 400);

  const proj = document.createElement('div');
  proj.className = 'tower-proj';
  proj.style.cssText = `left:${sp.x}px;top:${sp.y}px;transform:translate(-50%,-50%) rotate(${angle}deg)`;
  overlay.appendChild(proj);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    proj.style.left = ep.x + 'px';
    proj.style.top  = ep.y + 'px';
  }));

  setTimeout(() => {
    proj.remove();
    const impact = document.createElement('div');
    impact.className = 'tower-impact';
    impact.style.cssText = `left:${ep.x}px;top:${ep.y}px;`;
    overlay.appendChild(impact);
    setTimeout(() => impact.remove(), 420);
    onHit?.();
  }, 340);
}

// ── 대포 투사체 애니메이션 ────────────────────────────────────────────────────
function animateCannonShot(fromLat, fromLng, toLat, toLng, onHit) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) { onHit?.(); return; }
  const sp = latLngToPixel(fromLat, fromLng);
  const ep = latLngToPixel(toLat,   toLng);
  if (!sp || !ep) { onHit?.(); return; }

  const muzzle = document.createElement('div');
  muzzle.className = 'cannon-muzzle';
  muzzle.style.cssText = `left:${sp.x}px;top:${sp.y}px;`;
  overlay.appendChild(muzzle);
  setTimeout(() => muzzle.remove(), 280);

  const proj = document.createElement('div');
  proj.className = 'cannon-proj';
  proj.style.cssText = `left:${sp.x}px;top:${sp.y}px;`;
  overlay.appendChild(proj);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    proj.style.left = ep.x + 'px';
    proj.style.top  = ep.y + 'px';
  }));

  setTimeout(() => {
    proj.remove();
    const blast = document.createElement('div');
    blast.className = 'cannon-blast';
    blast.style.cssText = `left:${ep.x}px;top:${ep.y}px;`;
    overlay.appendChild(blast);
    setTimeout(() => blast.remove(), 480);
    onHit?.();
  }, 580);
}

// ── 황금토큰 드랍 ─────────────────────────────────────────────────────────────
function dropGoldTokens(mob) {
  if (!window.google?.maps || !_ctx?.map) return;
  const map = _ctx.map;
  const maxDrop = Math.min(Math.floor(mob.maxHp / 20), 10);
  const amount  = Math.max(1, Math.floor(Math.random() * maxDrop) + 1);
  const lat = mob.lat + (Math.random() - 0.5) * 0.00003;
  const lng = mob.lng + (Math.random() - 0.5) * 0.00003;
  const id  = `gold_${Date.now()}_${Math.random()}`;

  const marker = new google.maps.Marker({
    position: { lat, lng }, map,
    title: `💰 코인 ×${amount} — 클릭하여 획득`,
    icon: { url: '/assets/images/item/coins.png',
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(14, 14) },
    zIndex: 25,
  });
  const drop = { id, lat, lng, amount, marker };
  _goldDrops.push(drop);
  showFloat(`💰×${amount}`, '#fbbf24', lat, lng);
  playSound('gold_drop');

  // 클릭으로도 바로 획득 가능
  marker.addListener('click', () => {
    if (!_goldDrops.find(d => d.id === id)) return; // 이미 획득됨
    drop.marker?.setMap(null);
    _goldDrops = _goldDrops.filter(d => d.id !== id);
    _player.gold = (_player.gold || 0) + amount;
    const myLat = _ctx?.lastPos?.lat || lat;
    const myLng = _ctx?.lastPos?.lng || lng;
    showFloat(`💰+${amount}`, '#fbbf24', myLat, myLng);
    playSound('gold_pickup');
    updateCombatHud();
    savePlayerState();
  });

  setTimeout(() => {
    drop.marker?.setMap(null);
    _goldDrops = _goldDrops.filter(d => d.id !== id);
  }, 300000);
}

function checkGoldPickup() {
  if (_isDead || !_ctx?.myLocationMarker || !_goldDrops.length) return;
  const pos = _ctx.myLocationMarker.getPosition();
  const myLat = pos.lat(), myLng = pos.lng();
  for (const drop of [..._goldDrops]) {
    if (haversine(myLat, myLng, drop.lat, drop.lng) <= 3) {
      drop.marker?.setMap(null);
      _goldDrops = _goldDrops.filter(d => d.id !== drop.id);
      _player.gold = (_player.gold || 0) + drop.amount;
      showFloat(`💰+${drop.amount}`, '#fbbf24', myLat, myLng);
      playSound('gold_pickup');
      savePlayerState();
    }
  }
}

// ── 좌표 → 픽셀 변환 ─────────────────────────────────────────────────────────
function latLngToPixel(lat, lng) {
  const map = _ctx?.map;
  if (!map || !map.getProjection || !map.getProjection() || !map.getBounds()) return null;
  const proj   = map.getProjection();
  const bounds = map.getBounds();
  const scale  = Math.pow(2, map.getZoom());
  const nw = proj.fromLatLngToPoint(
    new google.maps.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng()));
  const pt = proj.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
  return { x: (pt.x - nw.x) * scale, y: (pt.y - nw.y) * scale };
}

// ── 크리티컬 토스트 ───────────────────────────────────────────────────────────
function showCriticalToast() {
  const el = document.getElementById('criticalToast');
  if (!el) return;
  el.style.animation = 'none';
  el.offsetWidth; // reflow
  el.style.animation = 'critPop 0.9s ease-out forwards';
}

// ── 데미지/힐 숫자 플로팅 ──────────────────────────────────────────────────────
export function showFloat(text, color, lat, lng) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  const px = latLngToPixel(lat, lng);
  const x = px ? px.x : overlay.offsetWidth  * 0.5;
  const y = px ? px.y : overlay.offsetHeight * 0.4;
  const el = document.createElement('div');
  el.className = 'dmg-float';
  el.style.cssText = `left:${x}px;top:${y}px;color:${color}`;
  el.textContent = text;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ── 스킬바 UI 업데이트 ───────────────────────────────────────────────────────
export function updateSkillBar() {
  const now = Date.now();
  ['lightning','ice','fire','wind','meteor'].forEach((s, i) => {
    const btn  = document.getElementById(`skillBtn${i}`);
    const cdEl = document.getElementById(`skillCd${i}`);
    if (!btn) return;
    const cdExp   = _skillCd[s] || 0;
    const inCd    = now < cdExp;
    const noMp    = _player.mp    < SKILL_MP_COST;
    btn.disabled = inCd || noMp || _isDead;
    btn.classList.toggle('skill-cd',    inCd);
    btn.classList.toggle('skill-no-mp', noMp && !inCd);
    if (cdEl) {
      if (inCd) {
        const rem = Math.ceil((cdExp - now) / 1000);
        cdEl.textContent = rem + 's';
        cdEl.style.display = '';
      } else {
        cdEl.style.display = 'none';
      }
    }
  });

  // 힐 버튼 상태
  const healBtn  = document.getElementById('skillBtnHeal');
  const healCdEl = document.getElementById('skillCdHeal');
  if (healBtn) {
    const cdExp = _skillCd.heal || 0;
    const inCd  = now < cdExp;
    const noMp  = _player.mp < SKILL_MP_COST;
    healBtn.disabled = inCd || noMp || _isDead;
    healBtn.classList.toggle('skill-cd',    inCd);
    healBtn.classList.toggle('skill-no-mp', noMp && !inCd);
    if (healCdEl) {
      if (inCd) { healCdEl.textContent = Math.ceil((cdExp - now) / 1000) + 's'; healCdEl.style.display = ''; }
      else healCdEl.style.display = 'none';
    }
  }

  // 마정석 버튼 상태
  const magicBtn   = document.getElementById('skillBtnMagicStone');
  const magicBadge = document.getElementById('skillMagicStoneBadge');
  const tokenCount = _player.token ?? 0;
  if (magicBtn)   magicBtn.disabled = tokenCount <= 0 || _isDead;
  if (magicBadge) magicBadge.textContent = tokenCount > 0 ? String(tokenCount) : '';
}

// ── 마정석 사용 (MP +100) ──────────────────────────────────────────────────────
export function useMagicStone() {
  if (_isDead) return;
  if ((_player.token ?? 0) <= 0) { showSkillError(_t('magic_stone_none')); return; }
  _player.token = (_player.token ?? 0) - 1;
  const prev = _player.mp;
  _player.mp = Math.min(_player.maxMp, _player.mp + 100);
  const gain = _player.mp - prev;
  const myMark = _ctx?.myLocationMarker;
  if (myMark && gain > 0) {
    showFloat(`💎+${gain}MP`, '#a78bfa', myMark.getPosition().lat(), myMark.getPosition().lng());
    playSound('heal');
  }
  updateCombatHud();
  updateSkillBar();
  savePlayerState();
}

// ── 전투 HUD 업데이트 ─────────────────────────────────────────────────────────
function updateCombatHud() {
  const p = _player;
  const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  const mpPct = Math.max(0, Math.min(100, (p.mp / p.maxMp) * 100));

  const hpBar = document.getElementById('cHpBar');
  const mpBar = document.getElementById('cMpBar');
  if (hpBar) { hpBar.style.width = hpPct + '%'; hpBar.classList.toggle('low', hpPct < 25); }
  if (mpBar)  mpBar.style.width = mpPct + '%';

  // compact 미니바 동기화
  const mhp = document.getElementById('cMiniHpBar');
  const mmp = document.getElementById('cMiniMpBar');
  if (mhp) mhp.style.width = hpPct + '%';
  if (mmp) mmp.style.width = mpPct + '%';

  const lv = document.getElementById('cLv');    if (lv)  lv.textContent  = _t('hud_lv', p.level, p.gold||0, p.token??0);
  const hv = document.getElementById('cHpVal'); if (hv)  hv.textContent  = `${p.hp} / ${p.maxHp}`;
  const mv = document.getElementById('cMpVal'); if (mv)  mv.textContent  = `${p.mp} / ${p.maxMp}`;
  const sp = document.getElementById('cSpd');   if (sp)  sp.textContent  = `SPD ${_currentSpeed.toFixed(1)} km/h`;
  const atkEl = document.getElementById('cAtk'); if (atkEl) atkEl.textContent = `⚔${getTotalAtk()}`;
  const defEl = document.getElementById('cDef'); if (defEl) defEl.textContent = `🛡${getDefense()}`;
  const dead = document.getElementById('cDead');
  if (dead) {
    if (_isDead) {
      dead.style.display = '';
      dead.textContent = _t('hud_dead', Math.max(0, Math.round(10 - _reviveWalkDist)));
    } else {
      dead.style.display = 'none';
    }
  }
  updateExpBar();
}

// ── 플레이어 상태 저장/로드 ───────────────────────────────────────────────────
export async function loadPlayerState() {
  const uid = _ctx?.uid;
  if (!uid) return;

  try {
    const res = await httpsCallable(_ctx.functions, 'getMyOnChain')();
    const onChain = res.data;
    if (onChain?.level > 0) {
      _player.level = onChain.level;
      _player.xp    = onChain.exp    || 0;
    }
  } catch { /* 온체인 조회 실패 시 battle_players fallback */ }

  try {
    const snap = await getDoc(doc(_ctx.db, 'battle_players', uid));
    _player.maxHp = _player.level * 1000;
    _player.maxMp = _player.level * 1000;
    if (snap.exists()) {
      const d = snap.data();
      _player.gold    = d.gold  || 0;
      _player.token   = d.token ?? 30;
      _player.gsExp   = typeof d.gsExp   === 'number' ? d.gsExp   : 0;
      _player.gsLevel = typeof d.gsLevel === 'number' ? d.gsLevel : _player.level;
      _player.gsLevel = Math.max(_player.level, _player.gsLevel);
      _player.nextLevelExp = calcNextLevelExp(_player.gsLevel);
      if ((d.level || 1) === _player.level) {
        _player.hp = Math.min(d.hp ?? _player.maxHp, _player.maxHp);
        _player.mp = Math.min(d.mp ?? _player.maxMp, _player.maxMp);
        _isDead         = d.isDead         === true;
        _reviveWalkDist = d.reviveWalkDist || 0;
        _deathLat       = d.deathLat       || null;
        _deathLng       = d.deathLng       || null;
      } else {
        _player.hp      = _player.maxHp;
        _player.mp      = _player.maxMp;
        _isDead         = false;
        _reviveWalkDist = 0;
      }
      // 장비 로드 (없으면 기본값 유지)
      if (d.equippedWeapon) {
        _player.equippedWeapon = d.equippedWeapon;
        _player.weaponBonus    = _equipNumFromId(d.equippedWeapon);
      }
      // 방어구 4슬롯 로드 (구버전 equippedArmor → equippedHelmet 마이그레이션)
      _player.equippedHelmet = d.equippedHelmet || d.equippedArmor || null;
      _player.equippedLegs   = d.equippedLegs   || null;
      _player.equippedGloves = d.equippedGloves || null;
      _player.equippedBoots  = d.equippedBoots  || null;
    } else {
      _player.hp = _player.maxHp;
      _player.mp = _player.maxMp;
      return 'new'; // 플레이어 문서 없음 → 초기화 필요 신호
    }
  } catch { /* 무시 */ }

  updateCombatHud();
  // 사망 상태로 재접속 → 맵이 준비됐으면 즉시, 아니면 showDeathMarkerIfDead()로 지연 표시
  if (_isDead && _deathLat && _deathLng) _showDeathMarker();
}

let _saveTimer = null;
export function getPlayerGold()  { return _player.gold  || 0; }
export function getPlayerToken() { return _player.token ?? 0; }

export function addPlayerGold(amount) {
  _player.gold = (_player.gold || 0) + amount;
  updateCombatHud();
  savePlayerState();
}
export function spendPlayerGold(amount) {
  if ((_player.gold || 0) < amount) return false;
  _player.gold -= amount;
  updateCombatHud();
  savePlayerState();
  return true;
}
export function addPlayerGsExp(amount) {
  _player.gsExp = (_player.gsExp || 0) + amount;
  updateExpBar();
  savePlayerState();
}
export function getPlayerLevel() { return _player.level || 1; }
export function isPlayerDead() { return _isDead; }

// ── 장비 시스템 ────────────────────────────────────────────────────────────────
/** 아이템 ID 끝 숫자가 직접 수치: 'weapon_50' → 50, 'armo_10' → 10 */
function _equipNumFromId(itemId) {
  const m = String(itemId || '').match(/(\d+)$/);
  return m ? parseInt(m[1]) : 0;
}

/** 아이템 ID 접두사로 방어구 슬롯 키 반환 */
function _armorSlotFromId(itemId) {
  const id = String(itemId || '');
  if (id.startsWith('helm_')) return 'equippedHelmet';
  if (id.startsWith('legs_')) return 'equippedLegs';
  if (id.startsWith('glov_')) return 'equippedGloves';
  if (id.startsWith('boot_')) return 'equippedBoots';
  if (id.startsWith('armo_')) return 'equippedHelmet'; // 구버전 호환
  return null;
}

export function getTotalAtk()  { return 100 + (_player.weaponBonus || 0); }
export function getDefense() {
  return _equipNumFromId(_player.equippedHelmet) +
         _equipNumFromId(_player.equippedLegs) +
         _equipNumFromId(_player.equippedGloves) +
         _equipNumFromId(_player.equippedBoots);
}
export function getEquippedWeapon() { return _player.equippedWeapon || null; }
export function getEquippedArmor()  { return _player.equippedHelmet  || null; } // 투구 슬롯 반환 (구버전 호환)
export function getEquippedArmorSlots() {
  return {
    helmet: _player.equippedHelmet || null,
    legs:   _player.equippedLegs   || null,
    gloves: _player.equippedGloves || null,
    boots:  _player.equippedBoots  || null,
  };
}

export function equipWeapon(itemId) {
  _player.weaponBonus    = _equipNumFromId(itemId);
  _player.equippedWeapon = itemId;
  updateCombatHud();
  savePlayerState();
}
export function equipArmor(itemId) {
  const slot = _armorSlotFromId(itemId);
  if (!slot) return;
  _player[slot] = itemId;
  updateCombatHud();
  savePlayerState();
}
export function unequipWeapon() {
  _player.weaponBonus    = 0;
  _player.equippedWeapon = null;
  updateCombatHud();
  savePlayerState();
}
/** slot: 'helmet' | 'legs' | 'gloves' | 'boots' */
export function unequipArmor(slot) {
  const key = { helmet:'equippedHelmet', legs:'equippedLegs', gloves:'equippedGloves', boots:'equippedBoots' }[slot];
  if (key) _player[key] = null;
  updateCombatHud();
  savePlayerState();
}

export function savePlayerState() {
  const uid = _ctx?.uid;
  if (!uid) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      await setDoc(doc(_ctx.db, 'battle_players', uid), {
        uid, level: _player.level, xp: _player.xp,
        hp: _player.hp, mp: _player.mp,
        maxHp: _player.maxHp, maxMp: _player.maxMp,
        gold:  _player.gold  || 0,
        token: _player.token ?? 30,
        isDead: _isDead,
        reviveWalkDist: _reviveWalkDist,
        deathLat: _deathLat ?? null,
        deathLng: _deathLng ?? null,
        equippedWeapon:  _player.equippedWeapon  || 'weapon_100',
        equippedHelmet:  _player.equippedHelmet  || null,
        equippedLegs:    _player.equippedLegs    || null,
        equippedGloves:  _player.equippedGloves  || null,
        equippedBoots:   _player.equippedBoots   || null,
        gsExp:   _player.gsExp   || 0,
        gsLevel: _player.gsLevel || _player.level,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch { /* 무시 */ }
  }, 3000);
}

// ── EXP / 레벨업 시스템 ───────────────────────────────────────────────────────
function calcNextLevelExp(level) {
  return Math.pow(level + 1, 2) * 100_000;
}

function updateExpBar() {
  const expBar = document.getElementById('cExpBar');
  const expVal = document.getElementById('cExpVal');
  const gsLv   = _player.gsLevel || _player.level;
  const gsExp  = _player.gsExp   || 0;
  const nextLv = _player.nextLevelExp || calcNextLevelExp(gsLv);
  const pct    = Math.min(100, (gsExp / nextLv) * 100);
  if (expBar) expBar.style.width = pct + '%';
  if (expVal) expVal.textContent = `Lv.${gsLv}  ${gsExp.toLocaleString()} / ${nextLv.toLocaleString()}`;
}

function showLevelUpEffect(newLevel) {
  playSound('levelup');
  const overlay = document.getElementById('levelupOverlay');
  if (!overlay) return;
  overlay.querySelector('#levelupLv').textContent = `Lv. ${newLevel}`;
  overlay.classList.add('visible');
  setTimeout(() => overlay.classList.remove('visible'), 3000);
}

export function onPlayerExp(d) {
  _player.gsExp        = d.exp;
  _player.gsLevel      = d.level;
  _player.nextLevelExp = d.nextLevelExp;
  updateExpBar();
}

export function onPlayerLevelUp(d) {
  _player.gsExp        = d.exp;
  _player.gsLevel      = d.newLevel;
  _player.nextLevelExp = d.nextLevelExp;
  updateExpBar();
  showLevelUpEffect(d.newLevel);
}

// ── 플레이어 HP/MP 변경 ────────────────────────────────────────────────────────
let _lastHealFloat = 0;
function takeDamage(rawAmount, sourceLat, sourceLng) {
  if (_isDead) return;
  const actual = Math.max(0, rawAmount - getDefense());
  const myMark = _ctx?.myLocationMarker;
  const lat = sourceLat || (myMark ? myMark.getPosition().lat() : null);
  const lng = sourceLng || (myMark ? myMark.getPosition().lng() : null);
  if (actual === 0) { if (lat && lng) showFloat('🛡0', '#6ee7b7', lat, lng); return; }
  _player.hp = Math.max(0, _player.hp - actual);
  if (lat && lng) showFloat(`-${actual}`, '#f87171', lat, lng);
  if (_player.hp <= 0) {
    _isDead = true;
    _player.hp = 0;
    _reviveWalkDist = 0;
    const myMark2 = _ctx?.myLocationMarker;
    if (myMark2) {
      _deathLat = myMark2.getPosition().lat();
      _deathLng = myMark2.getPosition().lng();
    } else if (lat && lng) {
      _deathLat = lat;
      _deathLng = lng;
    }
    _showDeathMarker();
    refreshMyMarkerIcon();
    playSound('player_die');
    if (lat && lng) showFloat(_t('float_player_dead'), '#fbbf24', lat, lng);
  } else {
    playSound('player_hit');
    const spr = _ctx?.myLocationMarker;
    if (spr && typeof spr.setState === 'function') spr.setState('hurt');
  }
  updateCombatHud();
  savePlayerState();
}

export function healMp(amount) {
  _player.mp = amount > 0 ? Math.min(_player.maxMp, _player.mp + amount) : _player.maxMp;
  updateCombatHud();
  updateSkillBar();
  savePlayerState();
}

export function healHp(amount) {
  if (_isDead) return;
  const prev = _player.hp;
  _player.hp = Math.min(_player.maxHp, _player.hp + amount);
  const gain = _player.hp - prev;
  if (gain > 0) {
    const now = Date.now();
    if (now - _lastHealFloat > 30000) { playSound('heal'); _lastHealFloat = now; }
  }
  updateCombatHud();
  savePlayerState();
}

function useMp(amount) {
  if (_player.mp < amount) return false;
  _player.mp -= amount;
  _player.maxMp += 100; // 스킬 사용마다 최대 MP +100
  updateCombatHud();
  updateSkillBar();
  savePlayerState();
  return true;
}

// ── 스킬 애니메이션 ───────────────────────────────────────────────────────────


function _skillFlash(color, emoji) {
  // battleOverlay 전체에 섬광 + 이모지 — 전체화면에서도 확실히 보임
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  if (!document.getElementById('_sfStyle')) {
    const s = document.createElement('style'); s.id = '_sfStyle';
    s.textContent = `@keyframes sfFlash{0%{opacity:.7}100%{opacity:0}}
      @keyframes sfPop{0%{opacity:1;transform:translate(-50%,-50%) scale(.4)}
        40%{opacity:1;transform:translate(-50%,-50%) scale(1.3)}
        100%{opacity:0;transform:translate(-50%,-50%) scale(1.8)}}`;
    document.head.appendChild(s);
  }
  const flash = document.createElement('div');
  flash.style.cssText = `position:absolute;inset:0;background:${color};pointer-events:none;
    z-index:3800;animation:sfFlash .35s ease-out forwards;`;
  overlay.appendChild(flash);
  setTimeout(() => flash.remove(), 400);

  const icon = document.createElement('div');
  icon.style.cssText = `position:absolute;top:40%;left:50%;font-size:72px;
    pointer-events:none;z-index:3900;filter:drop-shadow(0 0 18px ${color});
    animation:sfPop .7s ease-out forwards;`;
  icon.textContent = emoji;
  overlay.appendChild(icon);
  setTimeout(() => icon.remove(), 750);
}

function animateLightning() {
  _skillFlash('rgba(250,204,21,0.35)', '⚡');
}

function animateIceFreeze() {
  _skillFlash('rgba(147,197,253,0.35)', '❄️');
}

function animateFireStorm() {
  _skillFlash('rgba(249,115,22,0.35)', '🔥');
}

function animateWhirlwind() {
  _skillFlash('rgba(167,243,208,0.35)', '🌪️');
}

function animateMeteor() {
  _skillFlash('rgba(234,88,12,0.45)', '☄️');
}

// ── 플레이어 위치 조회 (마커 우선, 없으면 lastPos 폴백) ─────────────────────
function getMyPos() {
  const myMark = _ctx?.myLocationMarker;
  if (myMark) {
    const p = myMark.getPosition();
    return { lat: p.lat(), lng: p.lng() };
  }
  if (_ctx?.lastPos) return { lat: _ctx.lastPos.lat, lng: _ctx.lastPos.lng };
  return null;
}

// ── GS 몬스터 수집 (생존한 전체) ──────────────────────────────────────────────
// 거리 체크 없이 살아있는 GS 몬스터 전부 반환.
// 실제 범위/존 검증은 서버(resolvePlayerSkill)가 담당.
function getGsTargetsInRange() {
  const mobs = _gsMobsGetter?.() ?? {};
  const result = [];
  for (const [id, m] of Object.entries(mobs)) {
    if (!m || m.state === 'dead' || m.state === 'respawning') continue;
    const lat = m.currentLat ?? m.lat;
    const lng = m.currentLng ?? m.lng;
    if (!lat || !lng) continue;
    result.push({ id, name: m.type || '서버몬스터', lat, lng,
                  hp: m.hp ?? 1, maxHp: m.maxHp ?? 1, image: '👾', _isGs: true });
  }
  return result;
}

// ── 마법 스킬 ────────────────────────────────────────────────────────────────
export function castLightning() {
  if (_isDead) return;
  const now = Date.now();
  if (_skillCd.lightning && now < _skillCd.lightning) return;

  const myPos = getMyPos();
  if (!myPos) { showSkillError(_t('skill_locating')); return; }
  const { lat: myLat, lng: myLng } = myPos;

  const inRangeMobs = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);
  const gsTargets = getGsTargetsInRange().filter(m =>
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);

  if (inRangeMobs.length === 0 && gsTargets.length === 0) {
    showSkillError(_t('skill_no_target_lightning')); return;
  }
  if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError(_t('skill_mp_low_lightning')); return; }

  animateLightning();
  playSound('skill_lightning');

  const anchor = inRangeMobs[0] ?? gsTargets[0];
  showSkillMapEffect(anchor.lat, anchor.lng, 'lightning');

  let hitCount = 0;
  for (const mob of inRangeMobs) {
    hitMonster(mob.id, getTotalAtk() * _player.level);
    showFloat(`⚡-${getTotalAtk() * _player.level}`, '#facc15', mob.lat, mob.lng);
    hitCount++;
  }
  const gsDmg = Math.round(_player.level * 100 * GS_SKILL_MULT.lightning);
  for (const gsMob of gsTargets) {
    showFloat(`⚡-${gsDmg}`, '#facc15', gsMob.lat, gsMob.lng);
    hitCount++;
  }
  _gsSkillCallback?.('lightning');
  showFloat(_t('skill_lightning_hit', hitCount), '#facc15', anchor.lat, anchor.lng);
  _skillCd.lightning = Date.now() + SKILL_CD_MS.lightning;
  updateSkillBar();
  setTimeout(() => updateSkillBar(), SKILL_CD_MS.lightning);
}

export function castIceFreeze() {
  if (_isDead) return;
  const now = Date.now();
  if (_skillCd.ice && now < _skillCd.ice) return;

  const myPos = getMyPos();
  if (!myPos) { showSkillError(_t('skill_locating')); return; }
  const { lat: myLat, lng: myLng } = myPos;

  const inRangeMobs = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);
  const gsTargets = getGsTargetsInRange().filter(m =>
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);

  if (inRangeMobs.length === 0 && gsTargets.length === 0) {
    showSkillError(_t('skill_no_target_ice')); return;
  }
  if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError(_t('skill_mp_low_ice')); return; }

  animateIceFreeze();
  playSound('skill_ice');

  const anchor = inRangeMobs[0] ?? gsTargets[0];
  showSkillMapEffect(anchor.lat, anchor.lng, 'ice');

  const freezeNow = Date.now();
  let hitCount = 0;
  for (const mob of inRangeMobs) {
    _frozenUntil[mob.id] = freezeNow + SKILL_FREEZE_MS;
    const marker = _monsterMarkers[mob.id];
    if (marker) {
      marker.setIcon(getMonsterFrozenIcon());
      setTimeout(() => { if (_monsterMarkers[mob.id]) _monsterMarkers[mob.id].setIcon(getMonsterIcon(mob.image)); }, SKILL_FREEZE_MS);
    }
    showFloat(_t('skill_freeze_single'), '#93c5fd', mob.lat, mob.lng);
    hitCount++;
  }
  const gsDmgIce = Math.round(_player.level * 100 * GS_SKILL_MULT.ice);
  for (const gsMob of gsTargets) {
    showFloat(`❄-${gsDmgIce}`, '#93c5fd', gsMob.lat, gsMob.lng);
    hitCount++;
  }
  _gsSkillCallback?.('ice');
  showFloat(_t('skill_freeze_multi', hitCount, SKILL_FREEZE_MS/1000), '#93c5fd', anchor.lat, anchor.lng);
  _skillCd.ice = Date.now() + SKILL_CD_MS.ice;
  updateSkillBar();
  setTimeout(() => updateSkillBar(), SKILL_CD_MS.ice);
}

export function castFireStorm() {
  if (_isDead) return;
  const now = Date.now();
  if (_skillCd.fire && now < _skillCd.fire) return;

  const myPos = getMyPos();
  if (!myPos) { showSkillError(_t('skill_locating')); return; }
  const { lat: myLat, lng: myLng } = myPos;

  const inRangeMobs = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);
  const gsTargets = getGsTargetsInRange().filter(m =>
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);

  if (inRangeMobs.length === 0 && gsTargets.length === 0) {
    showSkillError(_t('skill_no_target_fire')); return;
  }
  if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError(_t('skill_mp_low_fire')); return; }

  animateFireStorm();
  playSound('skill_fire');

  const anchor = inRangeMobs[0] ?? gsTargets[0];
  showSkillMapEffect(anchor.lat, anchor.lng, 'fire');

  let hitCount = 0;
  for (const mob of inRangeMobs) {
    hitMonster(mob.id, getTotalAtk() * _player.level);
    showFloat(`🔥-${getTotalAtk() * _player.level}`, '#f97316', mob.lat, mob.lng);
    hitCount++;
  }
  const gsDmgFire = Math.round(_player.level * 100 * GS_SKILL_MULT.fire);
  for (const gsMob of gsTargets) {
    showFloat(`🔥-${gsDmgFire}`, '#f97316', gsMob.lat, gsMob.lng);
    hitCount++;
  }
  _gsSkillCallback?.('fire');
  showFloat(_t('skill_fire_hit', hitCount), '#f97316', anchor.lat, anchor.lng);
  _skillCd.fire = Date.now() + SKILL_CD_MS.fire;
  updateSkillBar();
  setTimeout(() => updateSkillBar(), SKILL_CD_MS.fire);
}

export function castWhirlwind() {
  if (_isDead) return;
  const now = Date.now();
  if (_skillCd.wind && now < _skillCd.wind) return;

  const myPos = getMyPos();
  if (!myPos) { showSkillError(_t('skill_locating')); return; }
  const { lat: myLat, lng: myLng } = myPos;

  const inRangeMobs = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= WIND_RANGE_M);
  const gsTargets = getGsTargetsInRange().filter(m =>
    haversine(myLat, myLng, m.lat, m.lng) <= WIND_RANGE_M);

  if (inRangeMobs.length === 0 && gsTargets.length === 0) {
    showSkillError(_t('skill_no_target_wind')); return;
  }
  if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError(_t('skill_mp_low_wind')); return; }

  animateWhirlwind();
  playSound('skill_lightning');

  const anchor = inRangeMobs[0] ?? gsTargets[0];
  showSkillMapEffect(anchor.lat, anchor.lng, 'wind');

  let hitCount = 0;
  for (const mob of inRangeMobs) {
    hitMonster(mob.id, getTotalAtk() * _player.level);
    showFloat(`🌪️-${getTotalAtk() * _player.level}`, '#6ee7b7', mob.lat, mob.lng);
    hitCount++;
  }
  const gsDmgWind = Math.round(_player.level * 100 * GS_SKILL_MULT.wind);
  for (const gsMob of gsTargets) {
    showFloat(`🌪️-${gsDmgWind}`, '#6ee7b7', gsMob.lat, gsMob.lng);
    hitCount++;
  }
  _gsSkillCallback?.('wind');
  showFloat(_t('skill_wind_hit', hitCount), '#6ee7b7', anchor.lat, anchor.lng);
  _skillCd.wind = Date.now() + SKILL_CD_MS.wind;
  updateSkillBar();
  setTimeout(() => updateSkillBar(), SKILL_CD_MS.wind);
}

export function castMeteor() {
  if (_isDead) return;
  const now = Date.now();
  if (_skillCd.meteor && now < _skillCd.meteor) return;

  const myPos = getMyPos();
  if (!myPos) { showSkillError(_t('skill_locating')); return; }
  const { lat: myLat, lng: myLng } = myPos;

  const inRangeMobs = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= METEOR_RANGE_M);
  const gsTargets = getGsTargetsInRange().filter(m =>
    haversine(myLat, myLng, m.lat, m.lng) <= METEOR_RANGE_M);

  if (inRangeMobs.length === 0 && gsTargets.length === 0) {
    showSkillError(_t('skill_no_target_meteor')); return;
  }
  if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError(_t('skill_mp_low_meteor')); return; }

  animateMeteor();
  playSound('skill_fire');

  const anchor = inRangeMobs[0] ?? gsTargets[0];
  showSkillMapEffect(anchor.lat, anchor.lng, 'meteor');

  let hitCount = 0;
  for (const mob of inRangeMobs) {
    hitMonster(mob.id, getTotalAtk() * _player.level);
    showFloat(`☄️-${getTotalAtk() * _player.level}`, '#f97316', mob.lat, mob.lng);
    hitCount++;
  }
  const gsDmgMeteor = Math.round(_player.level * 100 * GS_SKILL_MULT.meteor);
  for (const gsMob of gsTargets) {
    showFloat(`☄️-${gsDmgMeteor}`, '#f97316', gsMob.lat, gsMob.lng);
    hitCount++;
  }
  _gsSkillCallback?.('meteor');
  showFloat(_t('skill_meteor_hit', hitCount), '#ea580c', anchor.lat, anchor.lng);
  _skillCd.meteor = Date.now() + SKILL_CD_MS.meteor;
  updateSkillBar();
  setTimeout(() => updateSkillBar(), SKILL_CD_MS.meteor);
}

// ── 힐 스킬 (자가 회복) ───────────────────────────────────────────────────────
export function castHeal() {
  if (_isDead) return;
  const now = Date.now();
  if (_skillCd.heal && now < _skillCd.heal) return;
  if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError(_t('skill_mp_low_heal')); return; }

  const healAmt = _player.level * 100;
  const prev    = _player.hp;
  _player.hp    = Math.min(_player.maxHp, _player.hp + healAmt);
  const actual  = _player.hp - prev;

  const myMark = _ctx?.myLocationMarker;
  if (myMark) {
    const lat = myMark.getPosition().lat();
    const lng = myMark.getPosition().lng();
    showFloat(`💚+${actual}`, '#4ade80', lat, lng);
    // 힐 원형 파동 효과
    _healRipple(lat, lng);
  }
  playSound('heal');
  _skillCd.heal = Date.now() + SKILL_CD_MS.heal;
  updateCombatHud();
  updateSkillBar();
  setTimeout(() => updateSkillBar(), SKILL_CD_MS.heal);
  savePlayerState();
}

function _healRipple(lat, lng) {
  if (!window.google?.maps || !_ctx?.map) return;
  const map = _ctx.map;
  let size = 0;
  const steps = 12;
  const circle = new google.maps.Circle({
    map,
    center: { lat, lng },
    radius: 0,
    strokeColor: '#4ade80',
    strokeOpacity: 0.8,
    strokeWeight: 2,
    fillColor: '#4ade80',
    fillOpacity: 0.15,
    zIndex: 300,
  });
  const tick = setInterval(() => {
    size++;
    circle.setRadius(size * 3);
    circle.setOptions({ strokeOpacity: 0.8 - size / steps * 0.8, fillOpacity: 0.15 - size / steps * 0.15 });
    if (size >= steps) { clearInterval(tick); circle.setMap(null); }
  }, 60);
}

// ── 스킬 대상 선택 모달 ───────────────────────────────────────────────────────
function showSkillTargetModal(skillKey, targets, onSelect) {
  document.getElementById('skillTargetModal')?.remove();
  const labels = {
    lightning: _t('skill_label_lightning'),
    ice:       _t('skill_label_ice'),
    fire:      _t('skill_label_fire'),
    wind:      _t('skill_label_wind'),
    meteor:    _t('skill_label_meteor'),
  };
  const modal = document.createElement('div');
  modal.id = 'skillTargetModal';
  modal.style.cssText = `position:fixed;bottom:130px;left:50%;transform:translateX(-50%);
    background:rgba(10,10,22,0.96);border:1px solid rgba(255,255,255,0.15);
    border-radius:14px;padding:14px 16px;z-index:9999;min-width:240px;max-width:90vw;
    box-shadow:0 8px 32px rgba(0,0,0,0.65);`;
  modal.innerHTML = `
    <div style="color:#e5e7eb;font-weight:700;font-size:13px;margin-bottom:10px;text-align:center;">
      ${_t('skill_modal_title', labels[skillKey]||_t('skill_label_default'))}
    </div>
    ${targets.map(mob => `
      <div data-mob="${mob.id}" style="cursor:pointer;padding:9px 12px;margin:4px 0;
        background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);
        border-radius:9px;color:#fff;font-size:13px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:17px;">${mob.image?.startsWith('/')?'👾':(mob.image||'👾')}</span>
        <span>${escHtml(mob.name||_t('monster_default'))}</span>
        <span style="margin-left:auto;font-size:11px;color:#9ca3af;">HP ${mob.hp}/${mob.maxHp}</span>
      </div>
    `).join('')}
    <div id="_skillTargetCancel" style="cursor:pointer;padding:6px;margin-top:8px;
      color:#6b7280;font-size:12px;text-align:center;">${_t('skill_modal_cancel')}</div>
  `;
  (document.fullscreenElement || document.body).appendChild(modal);
  modal.querySelectorAll('[data-mob]').forEach(el => {
    el.addEventListener('click', () => {
      const mob = targets.find(m => m.id === el.dataset.mob);
      modal.remove();
      if (mob) onSelect(mob);
    });
    el.addEventListener('mouseover', () => el.style.background = 'rgba(255,255,255,0.15)');
    el.addEventListener('mouseout',  () => el.style.background = 'rgba(255,255,255,0.07)');
  });
  modal.querySelector('#_skillTargetCancel')?.addEventListener('click', () => modal.remove());
  setTimeout(() => {
    const h = (e) => { if (!modal.contains(e.target)) { modal.remove(); document.removeEventListener('click', h); } };
    document.addEventListener('click', h);
  }, 150);
}

// 맵 위 대상 중심 스킬 이펙트
function showSkillMapEffect(lat, lng, type) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  const px = latLngToPixel(lat, lng);
  if (!px) return;
  const cfg = { lightning:['⚡','#facc15'], ice:['❄','#93c5fd'], fire:['🔥','#f97316'], wind:['🌪️','#6ee7b7'], meteor:['☄️','#ea580c'] }[type]||['✨','#fff'];
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:${px.x}px;top:${px.y}px;font-size:56px;
    transform:translate(-50%,-50%);pointer-events:none;z-index:3500;
    filter:drop-shadow(0 0 14px ${cfg[1]});
    animation:skillMapPop 0.75s ease-out forwards;`;
  el.textContent = cfg[0];
  if (!document.getElementById('_skillMapPopStyle')) {
    const s = document.createElement('style'); s.id = '_skillMapPopStyle';
    s.textContent = `@keyframes skillMapPop{from{opacity:1;transform:translate(-50%,-50%) scale(1)}to{opacity:0;transform:translate(-50%,-50%) scale(2.8)}}`;
    document.head.appendChild(s);
  }
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function showSkillError(msg) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:rgba(0,0,0,.75);color:#f87171;font-size:16px;font-weight:700;
    padding:10px 20px;border-radius:8px;z-index:9999;pointer-events:none;
    animation:fadeInDown .2s ease`;
  el.textContent = msg;
  (document.fullscreenElement || document.body).appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function getMonsterFrozenIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="17" fill="rgba(147,197,253,0.9)" stroke="#bfdbfe" stroke-width="2"/>
    <text x="18" y="24" font-size="18" text-anchor="middle">❄</text></svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
           scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
}

// ── 부활 아이템 ───────────────────────────────────────────────────────────────
export async function useReviveTicket() {
  if (!_isDead) { showSkillError(_t('revive_not_dead')); return; }
  const uid = _ctx?.uid;
  if (!uid) return;
  try {
    const fn = httpsCallable(_ctx.functions, 'useReviveTicket');
    await fn();

    _isDead = false;
    _reviveWalkDist = 0;
    _clearDeathMarker();
    const _rspr = _ctx?.myLocationMarker;
    if (_rspr && typeof _rspr.revive === 'function') _rspr.revive();
    else refreshMyMarkerIcon();
    _player.hp = Math.round(_player.maxHp * 0.5);
    _player.mp = Math.round(_player.maxMp * 0.5);
    _player.token = (_player.token ?? 0) + 30;
    sendPlayerRevive();  // GS 서버에 부활 동기화
    playSound('revive');
    const myMark = _ctx?.myLocationMarker;
    if (myMark) showFloat('✨ 부활! 💎×30', '#a78bfa', myMark.getPosition().lat(), myMark.getPosition().lng());
    updateCombatHud();
    updateSkillBar();
    savePlayerState();
    _ctx?._onLoadInventory();
    updateSkillBar();
  } catch (e) { showSkillError(_t('revive_error', e.message)); }
}

function gainXp(amount) {
  _player.xp += amount;
  const myMark = _ctx?.myLocationMarker;
  if (myMark) {
    const pos = myMark.getPosition();
    showFloat(`+${amount} XP`, '#a78bfa', pos.lat(), pos.lng());
  }
  updateCombatHud();
  savePlayerState();
}

// ── 배틀 데이터 로드 ──────────────────────────────────────────────────────────
export async function loadBattleData() {
  try {
    const [mSnap, tSnap, hpSnap, kSnap] = await Promise.all([
      getDocs(query(collection(_ctx.db, 'battle_monsters'), where('active', '==', true))),
      getDocs(query(collection(_ctx.db, 'battle_towers'),   where('active', '==', true))),
      getDocs(collection(_ctx.db, 'battle_hp')),
      getDocs(query(collection(_ctx.db, 'treasure_keys'),   where('active', '==', true))),
    ]);
    _monsters = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _towers   = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _keyDefs  = kSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // battle_hp 에서 현재 공유 상태 적용
    hpSnap.docs.forEach(d => {
      const data = d.data();
      const idx  = d.id.indexOf('_');
      if (idx < 0) return;
      const type     = d.id.slice(0, idx);
      const entityId = d.id.slice(idx + 1);
      if (type === 'monster') {
        const mob = _monsters.find(m => m.id === entityId);
        if (!mob) return;
        if (data.isDead) {
          const deadAtMs  = data.deadAt?.toMillis?.() || Date.now();
          const respawnMs = (mob.respawnMinutes || 5) * 60000;
          if (Date.now() - deadAtMs >= respawnMs) {
            // 리스폰 시간이 이미 지남 → 살아있는 상태로 처리
            mob.hp = mob.maxHp;
          } else {
            mob.hp = 0;
            _scheduleMonsterRespawn(mob, deadAtMs);
          }
        } else {
          mob.hp = data.hp ?? mob.hp;
          if (data.aggroUid) _monsterAggro[entityId] = data.aggroUid;
        }
      } else if (type === 'tower') {
        const tower = _towers.find(t => t.id === entityId);
        if (!tower) return;
        const max = data.maxHp || tower.hp || 1000;
        if (data.isDead) {
          const deadAtMs  = data.deadAt?.toMillis?.() || Date.now();
          const elapsed   = Date.now() - deadAtMs;
          const remaining = Math.max(0, 10 * 60 * 1000 - elapsed);
          if (elapsed >= 10 * 60 * 1000) {
            // 리스폰 시간이 이미 지남 → 살아있는 상태로 처리
            _towerHpState[entityId] = { current: max, max };
          } else {
            _towerHpState[entityId] = { current: 0, max };
            if (!_towerRespawn[entityId]) {
              _towerRespawn[entityId] = setTimeout(() => _respawnTower(tower), remaining);
            }
          }
        } else {
          _towerHpState[entityId] = { current: data.hp ?? max, max };
        }
      }
    });

    // 그리드 재구축 (hp>0인 몬스터만)
    _monsterGrid.rebuild(_monsters.filter(m => m.hp > 0));

    if (window.google?.maps) {
      renderMonsterMarkers();
      renderTowerMarkers();
    }
    // 관리자 패널 Firestore 몬스터 목록 자동 갱신
    if (_ctx?.isAdmin) refreshFirestoreMonsterList();
  } catch (e) { console.warn('loadBattleData:', e.message); }
}

// ── 데코 마커 로드/렌더/삭제 ──────────────────────────────────────────────────
export async function loadDecorations() {
  try {
    const snap = await getDocs(query(collection(_ctx.db, 'map_decorations'), where('active', '==', true)));
    _decoMarkers.forEach(m => m.marker?.setMap(null));
    _decoMarkers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDecoMarkers();
  } catch (e) { console.warn('loadDecorations:', e.message); }
}

function renderDecoMarkers() {
  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;
  const overview = _ctx?.isAdmin || (map?.getZoom() ?? 18) <= OVERVIEW_ZOOM;
  const myPos = _ctx?.lastPos;
  _decoMarkers.forEach(d => {
    if (d.marker) d.marker.setMap(null);
    const size = d.size || 48;
    const visible = overview || !myPos || haversine(myPos.lat, myPos.lng, d.lat, d.lng) <= SKILL_RANGE_M;
    const marker = new google.maps.Marker({
      position: { lat: d.lat, lng: d.lng }, map: visible ? map : null,
      title: d.name || '',
      icon: { url: d.imageUrl, scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(size/2, size/2) },
      zIndex: 5,
    });
    marker.addListener('click', () => {
      infoWindow?.setContent(_decoInfoContent(d));
      infoWindow?.open(map, marker);
    });
    d.marker = marker;
  });
}

function _decoInfoContent(d) {
  return `<div style="font-size:13px;line-height:1.7;min-width:180px;">
    <img src="${escHtml(d.imageUrl)}" style="width:80px;height:80px;object-fit:contain;display:block;margin:0 auto 6px;">
    <div style="font-weight:700;text-align:center;margin-bottom:4px;">${escHtml(d.name||'데코')}</div>
    ${_ctx?.isAdmin ? `
      <div style="display:flex;gap:6px;margin-top:6px;">
        <button onclick="window.__editDecoForm('${d.id}')" style="flex:1;padding:4px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:4px;cursor:pointer;">✏️ 수정</button>
        <button onclick="window.__deleteDeco('${d.id}')" style="flex:1;padding:4px;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;border-radius:4px;cursor:pointer;">🗑️ 삭제</button>
      </div>` : ''}
  </div>`;
}

window.__editDecoForm = (id) => {
  const d = _decoMarkers.find(x => x.id === id);
  if (!d) return;
  const iw = _ctx?.infoWindow;
  if (!iw) return;
  iw.setContent(`<div style="font-size:13px;line-height:1.8;min-width:200px;">
    <div style="font-weight:700;margin-bottom:8px;">✏️ 데코 수정</div>
    <label style="display:block;margin-bottom:4px;">이름
      <input id="decoEditName" value="${escHtml(d.name||'')}" style="width:100%;box-sizing:border-box;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;">
    </label>
    <label style="display:block;margin-bottom:4px;">이미지 경로
      <input id="decoEditImg" value="${escHtml(d.imageUrl||'')}" style="width:100%;box-sizing:border-box;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;">
    </label>
    <label style="display:block;margin-bottom:8px;">크기(px)
      <input id="decoEditSize" type="number" value="${d.size||48}" min="16" max="256" style="width:100%;box-sizing:border-box;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;">
    </label>
    <div style="display:flex;gap:6px;">
      <button onclick="window.__saveDecoEdit('${id}')" style="flex:1;padding:5px;background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:4px;cursor:pointer;">💾 저장</button>
      <button onclick="window.__cancelDecoEdit('${id}')" style="flex:1;padding:5px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;">취소</button>
    </div>
  </div>`);
};

window.__saveDecoEdit = async (id) => {
  const d = _decoMarkers.find(x => x.id === id);
  if (!d) return;
  const name     = document.getElementById('decoEditName')?.value.trim() || d.name;
  const imageUrl = document.getElementById('decoEditImg')?.value.trim()  || d.imageUrl;
  const size     = parseInt(document.getElementById('decoEditSize')?.value || d.size);
  try {
    await setDoc(doc(_ctx.db, 'map_decorations', id), { name, imageUrl, size }, { merge: true });
    Object.assign(d, { name, imageUrl, size });
    renderDecoMarkers();
    const marker = _decoMarkers.find(x => x.id === id)?.marker;
    _ctx?.infoWindow?.setContent(_decoInfoContent(d));
    if (marker) _ctx?.infoWindow?.open(_ctx.map, marker);
  } catch (e) { alert('저장 실패: ' + e.message); }
};

window.__cancelDecoEdit = (id) => {
  const d = _decoMarkers.find(x => x.id === id);
  if (!d) return;
  _ctx?.infoWindow?.setContent(_decoInfoContent(d));
};

window.__deleteDeco = async (id) => {
  if (!confirm('이 데코를 삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(_ctx.db, 'map_decorations', id));
    _decoMarkers.filter(d => d.id === id).forEach(d => d.marker?.setMap(null));
    _decoMarkers = _decoMarkers.filter(d => d.id !== id);
    _ctx?.infoWindow?.close();
  } catch (e) { alert('삭제 실패: ' + e.message); }
};

// ── 몬스터 마커 ───────────────────────────────────────────────────────────────
function getMonsterIcon(image) {
  if (image && (image.startsWith('/') || image.startsWith('http'))) {
    return { url: image, scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
  }
  const emoji = image || '🐉';
  const isEmoji = !image || image.length <= 4;
  if (isEmoji) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="17" fill="rgba(220,38,38,0.85)" stroke="#fff" stroke-width="2"/>
      <text x="18" y="24" font-size="18" text-anchor="middle">${emoji}</text></svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
             scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
  }
  // 이미 경로가 포함된 경우(assets/... 형태) 그대로 사용
  const imgPath = image.includes('/') ? `/${image}` : `/assets/images/monsters/${image}`;
  return { url: imgPath,
           scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
}

function getTowerIcon(image, type) {
  const isCannon = type === 'cannon';
  const defaultImg = isCannon ? '/assets/images/shops/tower2.png' : '/assets/images/shops/tower.png';
  const src = (image && image.startsWith('/')) ? image : defaultImg;
  return { url: src, scaledSize: new google.maps.Size(38,38), anchor: new google.maps.Point(19,19) };
}

// ── 마커 가시 범위 갱신 (GPS 이동 또는 줌 변경 시 호출) ──────────────────────
function _refreshBattleVisibility(myLat, myLng) {
  const map = _ctx?.map;
  if (!map) return;
  const overview = _ctx?.isAdmin || (map.getZoom() ?? 18) <= OVERVIEW_ZOOM;
  const hasPos = myLat != null && myLng != null;

  function show(lat, lng) {
    return overview || !hasPos || haversine(myLat, myLng, lat, lng) <= SKILL_RANGE_M;
  }
  function showMonster(mob) {
    if (overview || !hasPos) return true;
    const visRange = Math.max(SKILL_RANGE_M, (mob.detectRadius || 30) + 5);
    return haversine(myLat, myLng, mob.lat, mob.lng) <= visRange;
  }

  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng) continue;
    const vis = showMonster(mob);
    _monsterMarkers[mob.id]?.setMap(vis ? map : null);
    _monsterOverlays[mob.id]?.setMap?.(vis ? map : null);
  }
  for (const tower of _towers) {
    if (!tower.lat || !tower.lng) continue;
    _towerMarkers[tower.id]?.setMap(show(tower.lat, tower.lng) ? map : null);
  }
  for (const d of _decoMarkers) {
    if (!d.lat || !d.lng || !d.marker) continue;
    d.marker.setMap(show(d.lat, d.lng) ? map : null);
  }
}

function _spawnMonsterMarker(mob) {
  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;
  if (!map || !mob.lat || !mob.lng) return;
  // 플레이어 위치 기준 100m 밖이면 마커 숨김
  const myPos = _ctx?.lastPos;
  const overview = _ctx?.isAdmin || (_ctx?.map?.getZoom() ?? 18) <= OVERVIEW_ZOOM;
  const visRange = Math.max(SKILL_RANGE_M, (mob.detectRadius || 30) + 5);
  const startVisible = overview || !myPos || haversine(myPos.lat, myPos.lng, mob.lat, mob.lng) <= visRange;

  // ── 스프라이트 타입 (dragon 등) ─────────────────────────────────────────────
  // image 필드가 단순 PNG 파일명(예: 23.png, 22.png)이면 스프라이트 무시 → 일반 마커
  const hasSimpleImage = mob.image && /^\d+\.png$/i.test(String(mob.image));
  if (!hasSimpleImage && hasSpriteConfig(mob.monsterType)) {
    const gsLike = {
      ...mob,
      type:       mob.monsterType,
      currentLat: mob.lat,
      currentLng: mob.lng,
      state:      mob.hp > 0 ? 'idle' : 'dead',
      monsterId:  mob.id,
    };
    const overlay = createMonsterSpriteOverlay(
      startVisible ? map : null, gsLike,
      () => {
        if (!_isDead && _ctx?.myLocationMarker && !_clickAtkCd[mob.id] && mob.hp > 0) {
          const myPos = _ctx.myLocationMarker.getPosition();
          const dist  = haversine(myPos.lat(), myPos.lng(), mob.lat, mob.lng);
          const clickRange = mob.detectRadius || 30;
          if (dist <= clickRange) {
            const roll = Math.floor(Math.random() * 10) + 1;
            const isCrit = roll >= 6;
            const dmg  = Math.floor(getTotalAtk() * roll / 5);
            _clickAtkCd[mob.id] = true;
            setTimeout(() => { delete _clickAtkCd[mob.id]; }, 800);
            const _spr1 = _ctx?.myLocationMarker;
            if (_spr1 && typeof _spr1.setFacing === 'function') _spr1.setFacing(calcBearing(myPos.lat(), myPos.lng(), mob.lat, mob.lng));
            if (_spr1 && typeof _spr1.setState === 'function') _spr1.setState('attack');
            playSound(isCrit ? 'critical_hit' : 'arrow_hit');
            animateArrow(myPos.lat(), myPos.lng(), mob.lat, mob.lng,
              isCrit ? '#ff6600' : '#fbbf24', () => {
                hitMonster(mob.id, dmg);
                showFloat(isCrit ? `💥${dmg}` : `-${dmg}`,
                  isCrit ? '#ff6600' : '#fbbf24', mob.lat, mob.lng);
                if (isCrit) showCriticalToast();
              }, _spr1?.getBowPixel?.());
            return;
          }
        }
        const hpPct = Math.round((mob.hp / mob.maxHp) * 100);
        infoWindow?.setContent(`
          <div style="font-size:13px;min-width:140px">
            <b>🐉 ${escHtml(mob.name||_t('dragon_default'))}</b>
            <div style="margin:6px 0 2px;font-size:11px;color:#888">HP ${mob.hp} / ${mob.maxHp}</div>
            <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${hpPct}%;background:#ef4444;border-radius:4px"></div></div>
            ${_ctx?.isAdmin ? `<button onclick="window.__deleteBattleObj('monster','${mob.id}')"
              style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">${_t('admin_delete')}</button>` : ''}
          </div>`);
        infoWindow?.setPosition({ lat: mob.lat, lng: mob.lng });
        infoWindow?.open(map);
      },
      () => { delete _monsterOverlays[mob.id]; },
    );
    if (overlay) _monsterOverlays[mob.id] = overlay;
    return;
  }

  // ── 일반 SVG 마커 ────────────────────────────────────────────────────────────
  const marker = new google.maps.Marker({
    position: { lat: mob.lat, lng: mob.lng }, map: startVisible ? map : null,
    title: mob.name || _t('monster_default'),
    icon: getMonsterIcon(mob.image),
    zIndex: 50,
  });
  marker.addListener('click', () => {
    if (!_isDead && _ctx?.myLocationMarker && !_clickAtkCd[mob.id] && mob.hp > 0) {
      const myPos = _ctx.myLocationMarker.getPosition();
      const dist  = haversine(myPos.lat(), myPos.lng(), mob.lat, mob.lng);
      const clickRange = mob.detectRadius || 30;
      if (dist <= clickRange) {
        const roll   = Math.floor(Math.random() * 10) + 1;
        const isCrit = roll >= 6;
        const dmg    = Math.floor(getTotalAtk() * roll / 5);
        _clickAtkCd[mob.id] = true;
        setTimeout(() => { delete _clickAtkCd[mob.id]; }, 800);
        const _spr2 = _ctx?.myLocationMarker;
        if (_spr2 && typeof _spr2.setFacing === 'function') _spr2.setFacing(calcBearing(myPos.lat(), myPos.lng(), mob.lat, mob.lng));
        if (_spr2 && typeof _spr2.setState === 'function') _spr2.setState('attack');
        playSound(isCrit ? 'critical_hit' : 'arrow_hit');
        animateArrow(myPos.lat(), myPos.lng(), mob.lat, mob.lng,
          isCrit ? '#ff6600' : '#fbbf24', () => {
            hitMonster(mob.id, dmg);
            showFloat(isCrit ? `💥${dmg}` : `-${dmg}`,
              isCrit ? '#ff6600' : '#fbbf24', mob.lat, mob.lng);
            if (isCrit) showCriticalToast();
          }, _spr2?.getBowPixel?.());
        return;
      }
    }
    const hpPct = Math.round((mob.hp / mob.maxHp) * 100);
    infoWindow?.setContent(`
      <div style="font-size:13px;min-width:140px">
        <b>${escHtml(mob.name||_t('monster_default'))}</b>
        <div style="margin:6px 0 2px;font-size:11px;color:#888">HP ${mob.hp} / ${mob.maxHp}</div>
        <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${hpPct}%;background:#ef4444;border-radius:4px"></div></div>
        ${_ctx?.isAdmin ? `<button onclick="window.__deleteBattleObj('monster','${mob.id}')"
          style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">${_t('admin_delete')}</button>` : ''}
      </div>`);
    infoWindow?.open(map, marker);
  });
  _monsterMarkers[mob.id] = marker;
}

function renderMonsterMarkers() {
  Object.values(_monsterMarkers).forEach(m => m.setMap(null));
  _monsterMarkers = {};
  Object.values(_monsterOverlays).forEach(o => o?.setMap(null));
  _monsterOverlays = {};
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
    _spawnMonsterMarker(mob);
  }
}

// ── 타워 HP 상태 ──────────────────────────────────────────────────────────────
function getTowerHpState(tower) {
  if (!_towerHpState[tower.id]) {
    const max = Math.max(1, tower.hp || 1000);
    _towerHpState[tower.id] = { current: max, max };
  }
  return _towerHpState[tower.id];
}

// ── 타워 공격 (클릭) ──────────────────────────────────────────────────────────
function attackTower(tower, marker) {
  if (_towerAtkCd[tower.id]) return;
  _towerAtkCd[tower.id] = true;
  setTimeout(() => delete _towerAtkCd[tower.id], 800);

  const st = getTowerHpState(tower);
  if (st.current <= 0) return;

  const isCrit = Math.random() < 0.1;
  const base = 30 + Math.floor(Math.random() * 21); // 30-50
  const dmg  = isCrit ? base * 2 : base;
  st.current = Math.max(0, st.current - dmg);

  // 데미지 플로팅
  const pos = marker.getPosition();
  showFloat(isCrit ? `💥 CRIT! -${dmg}` : `-${dmg}`, isCrit ? '#f97316' : '#ef4444', pos.lat(), pos.lng());
  const _sprT = _ctx?.myLocationMarker;
  if (_sprT) {
    const myPosT = _sprT.getPosition?.();
    if (myPosT && typeof _sprT.setFacing === 'function') _sprT.setFacing(calcBearing(myPosT.lat(), myPosT.lng(), pos.lat(), pos.lng()));
    if (typeof _sprT.setState === 'function') _sprT.setState('attack');
  }
  playSound(isCrit ? 'critical_hit' : 'arrow_shot');

  // ── 화살 날아가는 애니메이션 ──
  const myMarkT = _ctx?.myLocationMarker;
  const myPosT  = myMarkT?.getPosition?.();
  if (myPosT) {
    animateArrow(
      myPosT.lat(), myPosT.lng(),
      pos.lat(), pos.lng(),
      isCrit ? '#f97316' : '#fbbf24',
      () => { playSound('arrow_hit'); },
      myMarkT?.getBowPixel?.()
    );
  }

  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;

  if (st.current <= 0) {
    // 타워 파괴
    marker.setMap(null);
    delete _towerMarkers[tower.id];
    infoWindow?.close();
    showFloat(_t('tower_destroyed'), '#f97316', pos.lat(), pos.lng());
    playSound('gold_drop');
    // 공유 상태 기록
    setDoc(doc(_ctx.db, 'battle_hp', `tower_${tower.id}`),
      { hp: 0, maxHp: st.max, isDead: true, deadAt: serverTimestamp(), type: 'tower' }, { merge: true }).catch(() => {});
    // 10분 후 리스폰
    _towerRespawn[tower.id] = setTimeout(() => _respawnTower(tower), 10 * 60 * 1000);
    return;
  }
  // HP 변경 공유
  setDoc(doc(_ctx.db, 'battle_hp', `tower_${tower.id}`),
    { hp: st.current, maxHp: st.max, isDead: false, type: 'tower' }, { merge: true }).catch(() => {});

  const hpPct = (st.current / st.max) * 100;
  const hpColor = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';
  infoWindow?.setContent(`
    <div style="font-size:13px;line-height:1.6;min-width:190px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏰 ${escHtml(tower.name||_t('tower_default'))}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
        <div style="flex:1;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${hpPct}%;background:${hpColor};border-radius:5px;transition:width .3s;"></div>
        </div>
        <span style="font-size:11px;color:#374151;min-width:65px;text-align:right;">${st.current}/${st.max}</span>
      </div>
      <div style="color:${isCrit?'#f97316':'#ef4444'};font-weight:700;">${isCrit?'💥 CRITICAL! ':'💥 '}-${dmg}</div>
      <div style="font-size:11px;color:#555;margin-top:2px;">${_t('tower_click_to_attack')}</div>
    </div>`);
  infoWindow?.open(map, marker);
}

// ── 타워 마커 단일 생성 (리스폰에서도 재사용) ────────────────────────────────
function createTowerMarker(tower, map, infoWindow) {
  const st = getTowerHpState(tower);
  const marker = new google.maps.Marker({
    position: { lat: tower.lat, lng: tower.lng }, map,
    title: `${tower.name||_t('tower_default')} HP ${st.current}/${st.max}`,
    icon: getTowerIcon(tower.image, tower.type), zIndex: 55,
  });
  marker.addListener('click', () => {
    const myMark = _ctx?.myLocationMarker;
    const inRange = myMark
      ? haversine(myMark.getPosition().lat(), myMark.getPosition().lng(), tower.lat, tower.lng) <= 20
      : false;
    if (inRange && !_isDead) {
      attackTower(tower, marker);
    } else {
      const hpPct2 = (getTowerHpState(tower).current / getTowerHpState(tower).max) * 100;
      const hpColor2 = hpPct2 > 50 ? '#22c55e' : hpPct2 > 25 ? '#f59e0b' : '#ef4444';
      infoWindow?.setContent(`
        <div style="font-size:13px;line-height:1.7;min-width:190px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏰 ${escHtml(tower.name||_t('tower_default'))}</div>
          <div style="font-size:11px;color:#888;">${_t('tower_radius_dmg', 30, tower.atk||50)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
            <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
            <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${hpPct2}%;background:${hpColor2};border-radius:4px;transition:width .3s;"></div>
            </div>
            <span style="font-size:11px;color:#374151;">${getTowerHpState(tower).current}/${getTowerHpState(tower).max}</span>
          </div>
          <div style="font-size:11px;color:#555;margin-top:4px;">${_t('tower_approach')}</div>
          ${_ctx?.isAdmin ? `<button onclick="window.__deleteBattleObj('tower','${tower.id}')"
            style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">${_t('admin_delete')}</button>` : ''}
        </div>`);
      infoWindow?.open(map, marker);
    }
  });
  return marker;
}

function renderTowerMarkers() {
  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;
  Object.values(_towerMarkers).forEach(m => m.setMap(null));
  Object.values(_towerRanges).forEach(c => c.setMap(null));
  _towerMarkers = {}; _towerRanges = {};
  const myPos = _ctx?.lastPos;
  for (const tower of _towers) {
    if (!tower.lat || !tower.lng) continue;
    // 리스폰 대기 중(파괴됨)이면 마커 생략
    if (_towerRespawn[tower.id]) continue;
    const overview2 = _ctx?.isAdmin || (map?.getZoom() ?? 18) <= OVERVIEW_ZOOM;
    const towerVisible = overview2 || !myPos || haversine(myPos.lat, myPos.lng, tower.lat, tower.lng) <= SKILL_RANGE_M;
    const towerMap = towerVisible ? map : null;
    _towerMarkers[tower.id] = createTowerMarker(tower, towerMap, infoWindow);

    const circle = new google.maps.Circle({
      map: _showTowerRange ? map : null,
      center: { lat: tower.lat, lng: tower.lng },
      radius: 30,
      fillColor: '#7c3aed', fillOpacity: 0.08,
      strokeColor: '#7c3aed', strokeOpacity: 0.4, strokeWeight: 1,
    });
    _towerRanges[tower.id] = circle;
  }
}

// ── 디버그 패널 ───────────────────────────────────────────────────────────────
function _updateDebugPanel() {
  if (!_ctx?.isAdmin) return;
  // FPS (1초 배틀틱 기준 — battleTick 호출 횟수/초)
  _dbgFpsTick++;
  const now = Date.now();
  if (now - _dbgFpsLast >= 5000) {
    _dbgFps = Math.round(_dbgFpsTick / ((now - _dbgFpsLast) / 1000));
    _dbgFpsTick = 0;
    _dbgFpsLast = now;
  }
  let panel = document.getElementById('_monsterDebugPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = '_monsterDebugPanel';
    panel.style.cssText = 'position:fixed;bottom:80px;left:8px;z-index:9999;background:rgba(0,0,0,.72);'
      + 'color:#4ade80;font-size:10px;font-family:monospace;padding:5px 8px;border-radius:6px;'
      + 'pointer-events:none;line-height:1.6;';
    (document.fullscreenElement || document.body).appendChild(panel);
  }
  const total  = _monsters.length;
  const active = _monsterGrid.size;
  const cells  = _monsterGrid.cellCount;
  panel.innerHTML =
    `FS몬스터: ${total} | 그리드: ${active}<br>` +
    `셀: ${cells} | 주변: ${_dbgNearby}<br>` +
    `AI처리: ${_dbgAiCount} | 틱FPS: ${_dbgFps}`;
}

// ── 배틀 루프 ─────────────────────────────────────────────────────────────────
export function startBattleLoop() {
  if (_battleLoopId) return;
  _battleLoopId = setInterval(battleTick, 1000);
}

export function stopBattleLoop() {
  if (_battleLoopId) { clearInterval(_battleLoopId); _battleLoopId = null; }
}

function battleTick() {
  checkMonsterAttacks();
  checkTowerAttacks();
  checkGoldPickup();
  _updateDebugPanel();
  if (_isDead) {
    if (_reviveWalkDist >= 10) {
      _isDead = false;
      _reviveWalkDist = 0;
      _clearDeathMarker();
      { const _rm = _ctx?.myLocationMarker;
        if (_rm && typeof _rm.revive === 'function') _rm.revive();
        else refreshMyMarkerIcon(); }
      _player.hp = _player.maxHp;
      _player.mp = _player.maxMp;
      _healAccum   = 0;
      _mpHealAccum = 0;
      _player.token = (_player.token ?? 0) + 30;
      sendPlayerRevive();  // GS 서버에 부활 동기화 (state='dead' 해제)
      playSound('revive');
      const myMark = _ctx?.myLocationMarker;
      if (myMark) {
        const pos = myMark.getPosition();
        showFloat('✨ 부활! 💎×30', '#fbbf24', pos.lat(), pos.lng());
      }
      updateCombatHud();
      updateSkillBar();
      savePlayerState();
    }
  }
}

// ── 몬스터 돌진 애니메이션 ────────────────────────────────────────────────────
function animateMonsterCharge(mob, myLat, myLng, onHit) {
  const marker = _monsterMarkers[mob.id];
  if (!marker) { onHit?.(); return; }

  const origLat = mob.lat, origLng = mob.lng;
  const midLat  = origLat + (myLat - origLat) * 0.62;
  const midLng  = origLng + (myLng - origLng) * 0.62;

  const CHARGE = 280, RETURN = 420;
  let chargeStart = null;

  function chargeStep(ts) {
    if (!chargeStart) chargeStart = ts;
    const p = Math.min((ts - chargeStart) / CHARGE, 1);
    const e = 1 - Math.pow(1 - p, 3);
    marker.setPosition({ lat: origLat + (midLat - origLat) * e,
                         lng: origLng + (midLng - origLng) * e });
    if (p < 1) { requestAnimationFrame(chargeStep); return; }

    const overlay = document.getElementById('battleOverlay');
    const ep = overlay && latLngToPixel(myLat, myLng);
    if (ep) {
      const hit = document.createElement('div');
      hit.className = 'hit-flash';
      hit.style.cssText = `left:${ep.x}px;top:${ep.y}px;background:radial-gradient(circle,#ef4444,transparent)`;
      overlay.appendChild(hit);
      setTimeout(() => hit.remove(), 320);
    }
    onHit?.();

    let retStart = null;
    function returnStep(ts2) {
      if (!retStart) retStart = ts2;
      const p2 = Math.min((ts2 - retStart) / RETURN, 1);
      const e2 = p2 < 0.5 ? 2*p2*p2 : 1 - Math.pow(-2*p2+2, 2)/2;
      marker.setPosition({ lat: midLat + (origLat - midLat) * e2,
                           lng: midLng + (origLng - midLng) * e2 });
      if (p2 < 1) requestAnimationFrame(returnStep);
    }
    requestAnimationFrame(returnStep);
  }
  requestAnimationFrame(chargeStep);
}

function checkMonsterAttacks() {
  if (_isDead || !_ctx?.myLocationMarker) return;
  const myPos = _ctx.myLocationMarker.getPosition();
  const myLat = myPos.lat(), myLng = myPos.lng();
  const myUid = _ctx?.uid;
  const now = Date.now();
  const ATK_CD_MS = 2500;

  const nearby = _monsterGrid.nearby(myLat, myLng, 1);
  _dbgNearby = nearby.length;
  let aiCount = 0;
  for (const mob of nearby) {
    if (_frozenUntil[mob.id] && now < _frozenUntil[mob.id]) continue;
    if (now - (_monsterAtkTs[mob.id] || 0) < ATK_CD_MS) continue;
    const r = mob.detectRadius || 30;
    if (MonsterGrid.distSq(myLat, myLng, mob.lat, mob.lng) <= r * r) {
      aiCount++;
      if (myUid && !_aggroClaimed.has(mob.id)) {
        _aggroClaimed.add(mob.id);
        _monsterAggro[mob.id] = myUid;
        setDoc(doc(_ctx.db, 'battle_hp', `monster_${mob.id}`),
          { aggroUid: myUid }, { merge: true }).catch(() => {});
      }
      const aggro = _monsterAggro[mob.id];
      if (aggro && aggro !== myUid) continue;

      const _mobKind = String(mob.type || '').replace(/\d+$/, '');
      const _atkSound = (_mobKind === 'dragon') ? 'monster_atk_dragon'
                      : (_mobKind === 'orc')    ? 'monster_atk_orc'
                      : (_mobKind === 'pirate') ? 'monster_atk_pirate'
                      : 'monster_atk';
      playSound(_atkSound);
      animateMonsterCharge(mob, myLat, myLng, () => {
        takeDamage(mob.atk || 10, myLat, myLng);
      });
      _monsterAtkTs[mob.id] = now;
    }
  }
  _dbgAiCount = aiCount;
}

function checkTowerAttacks() {
  if (_isDead || !_ctx?.myLocationMarker) return;
  const myPos = _ctx.myLocationMarker.getPosition();
  const myLat = myPos.lat(), myLng = myPos.lng();
  for (const tower of _towers) {
    if (!tower.lat || !tower.lng) continue;
    if (_towerCd[tower.id]) continue;
    if (_towerRespawn[tower.id]) continue; // 파괴된 타워는 공격 안 함
    if (_towerHpState[tower.id]?.current <= 0) continue;
    const dist = haversine(myLat, myLng, tower.lat, tower.lng);
    if (dist <= 30) {
      const isCannon = tower.type === 'cannon';
      if (isCannon) {
        playSound('cannon_shot');
        animateCannonShot(tower.lat, tower.lng, myLat, myLng, () => {
          playSound('cannon_hit');
          takeDamage(tower.atk || 80, myLat, myLng);
        });
      } else {
        playSound('tower_shot');
        animateTowerShot(tower.lat, tower.lng, myLat, myLng, () => {
          takeDamage(tower.atk || 20, myLat, myLng);
        });
      }
      _towerCd[tower.id] = true;
      setTimeout(() => { delete _towerCd[tower.id]; }, isCannon ? 4000 : 2000);
    }
  }
}


function calcBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
          - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function _scheduleMonsterRespawn(mob, deadAtMs) {
  if (_monsterRespawnTimers[mob.id]) return; // 이미 예약됨
  deadAtMs = deadAtMs ?? Date.now();
  const respawnMs = (mob.respawnMinutes || 5) * 60000;
  const elapsed   = Date.now() - deadAtMs;
  const remaining = Math.max(0, respawnMs - elapsed);
  _monsterRespawnTimers[mob.id] = setTimeout(() => {
    delete _monsterRespawnTimers[mob.id];
    mob.hp = mob.maxHp;
    _monsterGrid.register(mob);
    if (_ctx?.map) _spawnMonsterMarker(mob);
  }, remaining);
}

async function hitMonster(monsterId, damage) {
  const mob = _monsters.find(m => m.id === monsterId);
  if (!mob || mob.hp <= 0) return;
  mob.hp = Math.max(0, mob.hp - damage);

  const isDead = mob.hp <= 0;
  const myUid  = _ctx?.uid || null;
  // battle_hp 에 공유 상태 기록 (killedBy = 처치자 UID, aggroUid 초기화)
  setDoc(doc(_ctx.db, 'battle_hp', `monster_${monsterId}`), {
    hp: mob.hp, maxHp: mob.maxHp, isDead, type: 'monster',
    ...(isDead ? { deadAt: serverTimestamp(), killedBy: myUid, aggroUid: null } : {}),
  }, { merge: true }).catch(() => {});

  const marker = _monsterMarkers[monsterId];
  if (marker) marker.setTitle(`${mob.name||_t('monster_default')} HP:${mob.hp}`);

  if (isDead) {
    // 어그로 초기화 (내가 처치)
    delete _monsterAggro[monsterId];
    _aggroClaimed.delete(monsterId);

    playSound('monster_die');
    showFloat(_t('float_kill'), '#fbbf24', mob.lat, mob.lng);
    gainXp(mob.dropExp || 20);
    dropGoldTokens(mob);
    // 마정석 랜덤 드랍 (30% 확률, 1~3개)
    if (Math.random() < 0.3) {
      const stones = Math.floor(Math.random() * 3) + 1;
      _player.token = (_player.token ?? 0) + stones;
      showFloat(_t('float_magic_stone', stones), '#a78bfa', mob.lat, mob.lng);
      updateSkillBar();
      savePlayerState();
    }
    // 열쇠 랜덤 드랍 (cabi/Monster eyes 제외, active 열쇠 정의별 dropRate 확률)
    const _noKeyTypes = ['cabi', 'Monster eyes'];
    if (_keyDefs.length && !_noKeyTypes.includes(mob.monsterType)) {
      const myUid = _ctx?.uid;
      if (myUid) {
        for (const keyDef of _keyDefs) {
          if (Math.random() < (keyDef.dropRate || 0) / 5) {
            httpsCallable(_ctx.functions, 'earnKey')({ keyId: keyDef.id })
              .then(res => {
                showFloat(_t('float_key_drop', res.data?.keyName || `Key #${keyDef.id}`), '#fcd34d', mob.lat, mob.lng);
                _ctx._onLoadInventory?.();
              })
              .catch(err => console.warn('[earnKey]', err.message));
          }
        }
      }
    }
    // 드래곤 처치 시 10% 확률로 부활권 드랍
    if (mob.monsterType === 'dragon' && Math.random() < 0.10) {
      httpsCallable(_ctx.functions, 'earnReviveTicket')()
        .then(() => {
          showFloat('🔮 부활권 드랍!', '#a78bfa', mob.lat, mob.lng);
          _ctx._onLoadInventory?.();
        })
        .catch(err => console.warn('[earnReviveTicket]', err.message));
    }
    // FS 몬스터(goblin/orc)는 아이템 드랍 없음 — 아이템은 GS 서버 몬스터 전용

    _monsterGrid.remove(monsterId);
    if (marker) { marker.setMap(null); delete _monsterMarkers[monsterId]; }
    _scheduleMonsterRespawn(mob, Date.now());
  }
}

// ── 공유 전투 상태 동기화 ─────────────────────────────────────────────────────
function _respawnTower(tower) {
  const tid = tower.id;
  delete _towerRespawn[tid];
  delete _towerHpState[tid];
  const map = _ctx?.map, infoWindow = _ctx?.infoWindow;
  if (!map) return;
  _towerMarkers[tid] = createTowerMarker(tower, map, infoWindow);
  showFloat(_t('tower_respawn'), '#a78bfa', tower.lat, tower.lng);
}

function _onMonsterHpChange(monsterId, data) {
  const mob = _monsters.find(m => m.id === monsterId);
  if (!mob) return;

  // 어그로 동기화: 내가 이미 클레임한 mob은 다른 유저의 write 무시
  if (data.aggroUid !== undefined && !_aggroClaimed.has(monsterId)) {
    if (data.aggroUid) _monsterAggro[monsterId] = data.aggroUid;
    else               delete _monsterAggro[monsterId];
  }

  if (data.isDead && mob.hp > 0) {
    mob.hp = 0;
    _monsterGrid.remove(monsterId);
    if (_monsterMarkers[monsterId]) { _monsterMarkers[monsterId].setMap(null); delete _monsterMarkers[monsterId]; }
    delete _monsterAggro[monsterId];
    _aggroClaimed.delete(monsterId);
    _scheduleMonsterRespawn(mob, data.deadAt?.toMillis?.() || Date.now());
  } else if (!data.isDead && data.hp > 0) {
    if (mob.hp <= 0 && !_monsterMarkers[monsterId]) {
      mob.hp = data.hp;
      _monsterGrid.register(mob);
      if (_ctx?.map) _spawnMonsterMarker(mob);
    } else if (mob.hp > 0) {
      mob.hp = data.hp;
      if (_monsterMarkers[monsterId]) _monsterMarkers[monsterId].setTitle(`${mob.name||'몬스터'} HP:${mob.hp}`);
    }
  }
}

function _onTowerHpChange(towerId, data) {
  const tower = _towers.find(t => t.id === towerId);
  if (!tower) return;
  if (data.isDead) {
    if (_towerMarkers[towerId]) { _towerMarkers[towerId].setMap(null); delete _towerMarkers[towerId]; }
    delete _towerHpState[towerId];
    if (!_towerRespawn[towerId]) {
      const elapsed   = Date.now() - (data.deadAt?.toMillis?.() || Date.now());
      const remaining = Math.max(0, 10 * 60 * 1000 - elapsed);
      _towerRespawn[towerId] = setTimeout(() => _respawnTower(tower), remaining);
    }
  } else if (data.hp !== undefined && !_towerRespawn[towerId]) {
    if (_towerHpState[towerId]) { _towerHpState[towerId].current = data.hp; }
    else { _towerHpState[towerId] = { current: data.hp, max: data.maxHp || 1000 }; }
  }
}

// battle_hp 컬렉션 실시간 구독 — 다른 유저 공격/처치 동기화
export function startSharedSync(onBoxHpChange) {
  if (!_ctx?.db || _battleHpUnsub) return;
  _battleHpUnsub = onSnapshot(
    collection(_ctx.db, 'battle_hp'),
    { includeMetadataChanges: true },
    (snap) => {
      snap.docChanges({ includeMetadataChanges: true }).forEach(change => {
        if (change.doc.metadata.hasPendingWrites) return; // 내 쓰기 제외
        if (change.type === 'removed') return;
        const docId = change.doc.id;
        const data  = change.doc.data();
        const idx   = docId.indexOf('_');
        if (idx < 0) return;
        const type     = docId.slice(0, idx);
        const entityId = docId.slice(idx + 1);
        if (type === 'monster')      _onMonsterHpChange(entityId, data);
        else if (type === 'tower')   _onTowerHpChange(entityId, data);
        else if (type === 'box' && onBoxHpChange) onBoxHpChange(entityId, data);
      });
    },
    () => {}
  );
}

// ── 근처 100m 이내 플레이어 마커 ──────────────────────────────────────────────
export function startNearbyPlayersWatch() {
  if (!_ctx?.db || _nearbyPlayersUnsub) return;
  const NEARBY_M = 100;
  const STALE_MS = 120000; // 2분 미갱신 시 무시

  _nearbyPlayersUnsub = onSnapshot(
    collection(_ctx.db, 'battle_players'),
    (snap) => {
      const map   = _ctx?.map;
      const myId  = _ctx?.uid;
      const myPos = _ctx?.lastPos;
      if (!map || !myId || !myPos) return;

      const cutoff  = Date.now() - STALE_MS;
      const seenIds = new Set();

      snap.docs.forEach(d => {
        const uid = d.id;
        if (uid === myId) return;
        const data = d.data();
        if (!data.lat || !data.lng) return;
        const updMs = data.updatedAt?.toMillis?.() ?? 0;
        if (updMs < cutoff) return;

        const dist = haversine(myPos.lat, myPos.lng, data.lat, data.lng);
        if (dist > NEARBY_M) {
          if (_nearbyPlayerMarkers[uid]) { _nearbyPlayerMarkers[uid].setMap(null); delete _nearbyPlayerMarkers[uid]; }
          return;
        }
        seenIds.add(uid);

        if (_nearbyPlayerMarkers[uid]) {
          _nearbyPlayerMarkers[uid].setPosition({ lat: data.lat, lng: data.lng });
        } else {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="19" fill="#3b82f6" stroke="white" stroke-width="3"/>
            <text x="22" y="28" text-anchor="middle" font-size="18" fill="white">👤</text>
          </svg>`;
          _nearbyPlayerMarkers[uid] = new google.maps.Marker({
            position: { lat: data.lat, lng: data.lng },
            map,
            title:  _t('nearby_player_label') + ' (' + Math.round(dist) + 'm)',
            zIndex: 85,
            icon: {
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
              scaledSize: new google.maps.Size(32, 32),
              anchor:     new google.maps.Point(16, 16),
            },
          });
        }
      });

      // 범위 밖으로 나간 마커 정리
      Object.keys(_nearbyPlayerMarkers).forEach(uid => {
        if (!seenIds.has(uid)) { _nearbyPlayerMarkers[uid].setMap(null); delete _nearbyPlayerMarkers[uid]; }
      });
    },
    () => {}
  );
}

export function stopNearbyPlayersWatch() {
  if (_nearbyPlayersUnsub) { _nearbyPlayersUnsub(); _nearbyPlayersUnsub = null; }
  Object.values(_nearbyPlayerMarkers).forEach(m => m.setMap(null));
  _nearbyPlayerMarkers = {};
}

// ── 관리자 배치 모드 ──────────────────────────────────────────────────────────
export function enterAdminPlaceMode(type) {
  const map = _ctx?.map;
  _adminPlaceMode = type;
  document.getElementById('btnPlaceMonster')?.classList.toggle('placing', type === 'monster');
  document.getElementById('btnPlaceDragon')?.classList.toggle('placing',  type === 'dragon');
  document.getElementById('btnPlaceOrc')?.classList.toggle('placing',     type === 'orc');
  document.getElementById('btnPlaceOrc2')?.classList.toggle('placing',    type === 'orc2');
  document.getElementById('btnPlaceOrc3')?.classList.toggle('placing',    type === 'orc3');
  document.getElementById('btnPlacePirate')?.classList.toggle('placing',  type === 'pirate');
  document.getElementById('btnPlacePirate2')?.classList.toggle('placing', type === 'pirate2');
  document.getElementById('btnPlacePirate3')?.classList.toggle('placing', type === 'pirate3');
  document.getElementById('btnPlaceArcherTower')?.classList.toggle('placing', type === 'archer_tower');
  document.getElementById('btnPlaceCannonTower')?.classList.toggle('placing', type === 'cannon_tower');
  document.getElementById('btnPlaceDeco')?.classList.toggle('placing', type === 'deco');
  document.getElementById('btnPlaceShopWeapon')?.classList.toggle('placing', type === 'shop_weapon_armor');
  document.getElementById('btnPlaceShopPotion')?.classList.toggle('placing', type === 'shop_potion');
  document.getElementById('btnPlaceShopMisc')?.classList.toggle('placing', type === 'shop_misc');
  document.getElementById('btnCancelPlace').style.display = '';
  if (map) map.setOptions({ draggableCursor: 'crosshair' });

  _adminMapListener = map.addListener('click', async (e) => {
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    if (_adminPlaceMode === 'monster') {
      // ── Firebase battle_monsters 추가 (서버 오프라인에도 유지) ──────────────
      const lv = _ctx?.playerLevel ?? 1;
      const monsterType = prompt('몬스터 타입 (Monster eyes / cabi):', 'Monster eyes') || 'Monster eyes';
      const PRESETS_FB = {
        'cabi':          { name:'cabi',          image:'23.png', maxHp: 500,     atk:20, detectRadius:30, respawnMinutes:2 },
        'Monster eyes':  { name:'Monster eyes',  image:'22.png', maxHp: lv*100*8, atk:80, detectRadius:30, respawnMinutes:2 },
      };
      const p = PRESETS_FB[monsterType] || PRESETS_FB['Monster eyes'];

      const name           = prompt(`몬스터 이름:`,       p.name)            || p.name;
      const image          = prompt(`이미지 (이모지 or 경로):`, p.image)      || p.image;
      const maxHp          = parseInt(prompt(`최대 HP:`,   p.maxHp)           || p.maxHp);
      const atk            = parseInt(prompt(`공격력:`,    p.atk)             || p.atk);
      const detectRadius   = parseInt(prompt(`탐지 반경(m):`, p.detectRadius) || p.detectRadius);
      const respawnMinutes = parseInt(prompt(`리스폰 시간(분):`, p.respawnMinutes) || p.respawnMinutes);

      try {
        const ref = await addDoc(collection(_ctx.db, 'battle_monsters'), {
          name, image, monsterType, lat, lng,
          maxHp, hp: maxHp, atk,
          detectRadius, respawnMinutes,
          active: true, createdAt: serverTimestamp(),
        });
        const newMob = { id: ref.id, name, image, monsterType, lat, lng, maxHp, hp: maxHp, atk, detectRadius, respawnMinutes, active: true };
        _monsters.push(newMob);
        _monsterGrid.register(newMob);
        renderMonsterMarkers();
        refreshFirestoreMonsterList();
        alert(`✅ ${name} 배치 완료 (Firebase)\n서버가 꺼져도 유지됩니다.`);
      } catch (err) { alert('Firebase 배치 오류: ' + err.message); }

    } else if (['dragon','orc','orc2','orc3','pirate','pirate2','pirate3'].includes(_adminPlaceMode)) {
      // ── 게임서버(GS) 몬스터 스폰 — 타입별 사전 설정값으로 즉시 배치 ────────────
      if (!isGameServerConnected()) {
        connectToGameServer();
        alert('⚠️ 게임서버에 연결 중입니다.\n연결 후(■ 표시) 다시 배치해주세요.');
        return;
      }
      const monsterType = _adminPlaceMode;
      // 서버 MONSTER_TYPE_DEFAULTS와 동일한 값
      const GS_DEFAULTS = {
        pirate:  { maxHp:  600, attackPower:   60, attackRangeM: 20, aggroRangeM:  40, moveSpeed: 1.5, attackCooldownMs: 1500, respawnSeconds:  90 },
        pirate2: { maxHp: 1000, attackPower:  110, attackRangeM: 20, aggroRangeM:  45, moveSpeed: 1.4, attackCooldownMs: 2000, respawnSeconds: 120 },
        pirate3: { maxHp: 1600, attackPower:  170, attackRangeM: 20, aggroRangeM:  50, moveSpeed: 1.3, attackCooldownMs: 2000, respawnSeconds: 180 },
        orc:     { maxHp: 1200, attackPower:  120, attackRangeM: 20, aggroRangeM:  50, moveSpeed: 1.2, attackCooldownMs: 2000, respawnSeconds: 150 },
        orc2:    { maxHp: 2000, attackPower:  190, attackRangeM: 20, aggroRangeM:  55, moveSpeed: 1.1, attackCooldownMs: 2200, respawnSeconds: 200 },
        orc3:    { maxHp: 3000, attackPower:  260, attackRangeM: 20, aggroRangeM:  60, moveSpeed: 1.0, attackCooldownMs: 2500, respawnSeconds: 240 },
        dragon:  { maxHp: 6000, attackPower:  320, attackRangeM: 20, aggroRangeM: 100, moveSpeed: 0.8, attackCooldownMs: 3000, respawnSeconds: 300 },
      };
      const p = GS_DEFAULTS[monsterType];
      if (!confirm(
        `[${monsterType}] 배치 확인\n` +
        `HP: ${p.maxHp}  ATK: ${p.attackPower}  공격범위: ${p.attackRangeM}m\n` +
        `탐지: ${p.aggroRangeM}m  리스폰: ${p.respawnSeconds}초`
      )) return;

      try {
        const result = await gsAdminAddSpawn({ monsterType, lat, lng, maxCount: 1, ...p });
        alert(`✅ ${monsterType} 배치 완료 (zone: ${result.zoneId})`);
        await refreshGsSpawnList();
      } catch (err) { alert('GS 배치 오류: ' + err.message); }

    } else if (_adminPlaceMode === 'archer_tower' || _adminPlaceMode === 'cannon_tower') {
      const towerType = _adminPlaceMode === 'cannon_tower' ? 'cannon' : 'archer';
      const defName   = towerType === 'cannon' ? '대포 타워' : '아처 타워';
      const defAtk    = towerType === 'cannon' ? '80' : '20';
      const defRadius = '30';
      const defEmoji  = towerType === 'cannon' ? '💣' : '🏹';
      const name   = prompt('타워 이름:', defName) || defName;
      const atk    = parseInt(prompt('데미지:', defAtk) || defAtk);
      const radius = parseInt(prompt('공격 반경(m):', defRadius) || defRadius);
      const defImg = towerType === 'cannon' ? '/assets/images/shops/tower2.png' : '/assets/images/shops/tower.png';
      const image  = prompt('이미지 (이모지 or 경로)', defImg) || defImg;
      try {
        const ref = await addDoc(collection(_ctx.db, 'battle_towers'), {
          name, lat, lng, atk, radius, image, type: towerType, hp: 1000, active: true,
          createdAt: serverTimestamp(),
        });
        _towers.push({ id: ref.id, name, lat, lng, atk, radius, image, type: towerType, hp: 1000, active: true });
        renderTowerMarkers();
        alert(`✅ ${name} 설치 완료`);
      } catch (err) { alert('오류: ' + err.message); }

    } else if (_adminPlaceMode === 'deco') {
      const name     = prompt('데코 이름:', '해적선') || '해적선';
      const imageUrl = prompt('이미지 경로:', '/assets/images/npc/npc1.png') || '/assets/images/npc/npc1.png';
      if (!imageUrl) { exitAdminPlaceMode(); return; }
      const size = parseInt(prompt('크기 (픽셀, 기본 48):', '48') || '48');
      try {
        const ref = await addDoc(collection(_ctx.db, 'map_decorations'), {
          name, lat, lng, imageUrl, size, active: true,
          createdAt: serverTimestamp(),
        });
        const newDeco = { id: ref.id, name, lat, lng, imageUrl, size, active: true };
        _decoMarkers.push(newDeco);
        renderDecoMarkers();
        alert(`✅ 데코 "${name}" 배치 완료`);
      } catch (err) { alert('오류: ' + err.message); }

    } else if (['shop_weapon_armor','shop_potion','shop_misc'].includes(_adminPlaceMode)) {
      const typeMap = { shop_weapon_armor: 'weapon_armor', shop_potion: 'potion', shop_misc: 'misc' };
      const shopType = typeMap[_adminPlaceMode];
      const defaultNames = { weapon_armor: '무기/방어구 상점', potion: '약물 상점', misc: '잡템 상점' };
      const name = prompt('상점 이름:', defaultNames[shopType]);
      if (!name) { exitAdminPlaceMode(); return; }
      try {
        const ref = await addDoc(collection(_ctx.db, 'game_shops'), {
          name: name.trim(), type: shopType, lat, lng,
          items: [], active: true, createdAt: serverTimestamp(),
        });
        const newShop = { id: ref.id, name: name.trim(), type: shopType, lat, lng, items: [], active: true };
        _shops.push(newShop);
        _renderShopMarker(newShop);
        alert(`✅ 상점 "${name}" 배치 완료\n마커를 클릭하여 아이템을 설정하세요.`);
      } catch (err) { alert('상점 배치 오류: ' + err.message); }
    }
    exitAdminPlaceMode();
  });
}

export function exitAdminPlaceMode() {
  const map = _ctx?.map;
  _adminPlaceMode = null;
  if (_adminMapListener) { google.maps.event.removeListener(_adminMapListener); _adminMapListener = null; }
  if (map) map.setOptions({ draggableCursor: null });
  document.getElementById('btnPlaceMonster')?.classList.remove('placing');
  document.getElementById('btnPlaceArcherTower')?.classList.remove('placing');
  document.getElementById('btnPlaceCannonTower')?.classList.remove('placing');
  document.getElementById('btnPlaceDeco')?.classList.remove('placing');
  document.getElementById('btnPlaceDragon')?.classList.remove('placing');
  document.getElementById('btnPlaceShopWeapon')?.classList.remove('placing');
  document.getElementById('btnPlaceShopPotion')?.classList.remove('placing');
  document.getElementById('btnPlaceShopMisc')?.classList.remove('placing');
  document.getElementById('btnCancelPlace').style.display = 'none';
}

// ── Firestore 몬스터 목록 패널 (기존 battle_monsters 관리) ─────────────────────

export function refreshFirestoreMonsterList() {
  const el = document.getElementById('firestoreMonsterList');
  if (!el) return;

  const list = _monsters.filter(m => m.active !== false);
  if (list.length === 0) { el.textContent = '없음'; return; }

  el.innerHTML = list.map(m => {
    const emoji = m.monsterType ? (TYPE_EMOJI[m.monsterType] || '👾') : (m.image || '👾');
    const name  = escHtml(m.name || m.monsterType || '몬스터');
    const hp    = `HP ${m.hp ?? m.maxHp}/${m.maxHp}`;
    const lat   = m.lat?.toFixed(4) ?? '?';
    const lng   = m.lng?.toFixed(4) ?? '?';
    return `<div class="gs-spawn-row">
      <span class="gs-spawn-emoji">${emoji}</span>
      <span class="gs-spawn-info">
        <b>${name}</b><br>
        <span style="color:#9ca3af;font-size:9px">${lat},${lng}</span><br>
        <span style="color:#f97316">${hp}</span>
      </span>
      <span class="gs-spawn-actions">
        <button class="gs-spawn-del" onclick="window.__deleteBattleObj('monster','${m.id}')" title="삭제">🗑</button>
      </span>
    </div>`;
  }).join('');
}

// ── GS 스폰 목록 패널 ─────────────────────────────────────────────────────────

const TYPE_EMOJI = { dragon: '🐉', orc: '👹', goblin: '👾' };

export async function refreshGsSpawnList() {
  const el = document.getElementById('gsSpawnList');
  if (!el) return;
  el.textContent = '로딩 중…';
  try {
    const data   = await gsAdminGetSpawns();
    const spawns = data.spawns || [];

    // 살아있는 인스턴스를 monster:update 이벤트로 강제 렌더링 (WS를 못 받은 경우 보완)
    for (const spawn of spawns) {
      for (const inst of (spawn.instances || [])) {
        if (inst.state === 'dead' || inst.state === 'respawning') continue;
        window.dispatchEvent(new CustomEvent('gs:forceRenderMonster', { detail: {
          monsterId:  inst.monsterId,
          type:       spawn.monsterType,
          state:      inst.state,
          hp:         inst.hp,
          maxHp:      inst.maxHp,
          currentLat: inst.currentLat,
          currentLng: inst.currentLng,
          zoneId:     spawn.zoneId,
          spawnId:    spawn.spawnId,
        }}));
      }
    }
    if (spawns.length === 0) { el.textContent = '스폰 없음'; return; }

    el.innerHTML = spawns.map(s => {
      const emoji    = TYPE_EMOJI[s.monsterType] || '👾';
      const alive    = s.liveCount || 0;
      const total    = s.maxCount  || 1;
      const hpColor  = alive > 0 ? '#22c55e' : '#ef4444';
      const shortId  = s.spawnId.replace('spawn-admin-', '').slice(0, 8);
      const zoneName = s.zoneId?.replace('oceanpark-', 'OP-').replace('ecopark-', 'ECO-') || s.zoneId;

      // kill 버튼: 각 살아있는 인스턴스마다
      const killBtns = (s.instances || [])
        .filter(m => m.state !== 'dead' && m.state !== 'respawning')
        .map(m =>
          `<button class="gs-spawn-kill" onclick="window.__killGsMonster('${m.monsterId}')" title="강제 사망">💀</button>`
        ).join('');

      return `<div class="gs-spawn-row">
        <span class="gs-spawn-emoji">${emoji}</span>
        <span class="gs-spawn-info">
          <b>${s.monsterType}</b> <span style="color:#9ca3af;font-size:9px">${zoneName} #${shortId}</span><br>
          <span style="color:${hpColor}">${alive}/${total} alive</span>
          · HP${s.maxHp} · ⚔${s.attackPower}
        </span>
        <span class="gs-spawn-actions">
          ${killBtns}
          <button class="gs-spawn-del" onclick="window.__deleteGsSpawn('${s.spawnId}')" title="스폰 삭제">🗑</button>
        </span>
      </div>`;
    }).join('');
  } catch (err) {
    el.textContent = '오류: ' + err.message;
  }
}

window.__deleteGsSpawn = async (spawnId) => {
  if (!confirm(`스폰 [${spawnId}] 을 삭제하시겠습니까?\n해당 스폰의 몬스터가 즉시 제거됩니다.`)) return;
  try {
    const r = await gsAdminDeleteSpawn(spawnId);
    alert(`✅ 삭제 완료 (인스턴스 ${r.instancesRemoved}개 제거)`);
    await refreshGsSpawnList();
  } catch (err) { alert('삭제 오류: ' + err.message); }
};

window.__killGsMonster = async (monsterId) => {
  try {
    await gsAdminKillMonster(monsterId);
    await refreshGsSpawnList();
  } catch (err) { alert('kill 오류: ' + err.message); }
};

// ── 몬스터 스탯 설정 모달 ─────────────────────────────────────────────────────

const TYPE_LABEL = {
  dragon:  '🐉 Dragon',
  orc:     '🐗 Orc',     orc2: '🗡️ Orc2',    orc3: '⚔️ Orc3',
  pirate:  '🏴‍☠️ Pirate', pirate2: '🗡 Pirate2', pirate3: '💀 Pirate3',
  goblin:  '👾 Goblin',
};

// 원래 값 보관 (변경 여부 비교용)
let _origStats = {};

function openMonsterStatModal() {
  const modal = document.getElementById('monsterStatModal');
  if (!modal) return;
  modal.style.display = 'flex';
  _loadMonsterStatModal();
}

function closeMonsterStatModal() {
  const modal = document.getElementById('monsterStatModal');
  if (modal) modal.style.display = 'none';
}

async function _loadMonsterStatModal() {
  const tbody = document.getElementById('monsterStatTbody');
  const msg   = document.getElementById('monsterStatMsg');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#6b7280;padding:24px">로딩 중…</td></tr>';
  if (msg) msg.textContent = '';
  try {
    const data  = await gsAdminGetMonsterTypes();
    const types = data.types || [];
    _origStats = {};
    for (const t of types) _origStats[t.type] = { maxHp: t.maxHp, attackPower: t.attackPower };

    tbody.innerHTML = types.map(t => {
      const label = TYPE_LABEL[t.type] || t.type;
      return `<tr style="border-bottom:1px solid #1f2937">
        <td style="padding:10px 8px;color:#e5e7eb;font-size:14px">${label}</td>
        <td style="padding:10px 8px;text-align:center">
          <input type="number" class="ms-hp" data-type="${t.type}" value="${t.maxHp}" min="1"
            style="width:70px;background:#1f2937;border:1px solid #374151;color:#e5e7eb;font-size:13px;padding:4px 6px;border-radius:6px;text-align:center">
        </td>
        <td style="padding:10px 8px;text-align:center">
          <input type="number" class="ms-atk" data-type="${t.type}" value="${t.attackPower}" min="0"
            style="width:70px;background:#1f2937;border:1px solid #374151;color:#e5e7eb;font-size:13px;padding:4px 6px;border-radius:6px;text-align:center">
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#ef4444;padding:20px">오류: ${err.message}</td></tr>`;
  }
}

async function saveAllMonsterStats() {
  const btn = document.getElementById('btnMonsterStatSaveAll');
  const msg = document.getElementById('monsterStatMsg');
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = '저장 중…';

  const hpInputs = document.querySelectorAll('.ms-hp');
  const changed  = [];

  for (const inp of hpInputs) {
    const type        = inp.dataset.type;
    const maxHp       = parseInt(inp.value, 10);
    const atkInp      = document.querySelector(`.ms-atk[data-type="${type}"]`);
    const attackPower = parseInt(atkInp?.value ?? '0', 10);

    if (!isFinite(maxHp) || maxHp < 1) { alert(`${type}: HP는 1 이상이어야 합니다`); if (btn) btn.disabled = false; return; }
    if (!isFinite(attackPower) || attackPower < 0) { alert(`${type}: 공격력은 0 이상이어야 합니다`); if (btn) btn.disabled = false; return; }

    const orig = _origStats[type] || {};
    if (maxHp !== orig.maxHp || attackPower !== orig.attackPower) {
      changed.push({ type, maxHp, attackPower });
    }
  }

  if (changed.length === 0) {
    if (msg) msg.textContent = '변경 사항 없음';
    if (btn) btn.disabled = false;
    return;
  }

  let saved = 0, totalInstances = 0;
  for (const c of changed) {
    try {
      const r = await gsAdminPatchMonsterType(c.type, { maxHp: c.maxHp, attackPower: c.attackPower });
      totalInstances += r.instancesUpdated || 0;
      saved++;
    } catch (err) {
      if (msg) msg.textContent = `${c.type} 오류: ${err.message}`;
      if (btn) btn.disabled = false;
      return;
    }
  }

  if (msg) msg.textContent = `✅ ${saved}종 저장 완료 (인스턴스 ${totalInstances}개 즉시 반영)`;
  if (btn) btn.disabled = false;
  // 저장 후 원래 값 갱신
  for (const c of changed) _origStats[c.type] = { maxHp: c.maxHp, attackPower: c.attackPower };
}

window.__deleteBattleObj = async (type, id) => {
  if (!confirm('삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(_ctx.db, type === 'monster' ? 'battle_monsters' : 'battle_towers', id));
    if (type === 'monster') {
      _monsters = _monsters.filter(m => m.id !== id);
      if (_monsterMarkers[id])  { _monsterMarkers[id].setMap(null);  delete _monsterMarkers[id]; }
      // 스프라이트 오버레이도 함께 제거
      if (_monsterOverlays[id]) { _monsterOverlays[id].setMap(null); delete _monsterOverlays[id]; }
      refreshFirestoreMonsterList();
    } else {
      _towers = _towers.filter(t => t.id !== id);
      if (_towerMarkers[id])  { _towerMarkers[id].setMap(null);  delete _towerMarkers[id]; }
      if (_towerRanges[id])   { _towerRanges[id].setMap(null);   delete _towerRanges[id]; }
    }
    _ctx?.infoWindow?.close();
  } catch (err) { alert('삭제 실패: ' + err.message); }
};

// ── 방어탑 범위 토글 ──────────────────────────────────────────────────────────
export function toggleTowerRanges() {
  const map = _ctx?.map;
  _showTowerRange = !_showTowerRange;
  Object.values(_towerRanges).forEach(circle => {
    circle.setMap(_showTowerRange ? map : null);
  });
  document.getElementById('btnToggleTowerRange').textContent =
    _showTowerRange ? '🙈 범위 숨기기' : '👁 범위 표시';
}

// ── 사망 마커 ─────────────────────────────────────────────────────────────────
function _makeDeathMarkerIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
    <circle cx="22" cy="22" r="20" fill="rgba(30,10,10,0.85)" stroke="#ff3333" stroke-width="2"/>
    <text x="22" y="32" font-size="24" text-anchor="middle">💀</text>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(44, 44),
    anchor:     new google.maps.Point(22, 22),
  };
}

function _showDeathMarker() {
  const map = _ctx?.map;
  if (!map || !_deathLat || !_deathLng) return;
  if (_deathMarker) { _deathMarker.setMap(null); _deathMarker = null; }
  _deathMarker = new google.maps.Marker({
    position: { lat: _deathLat, lng: _deathLng },
    map,
    title:    _t('death_marker_title'),
    zIndex:   90,
    icon:     _makeDeathMarkerIcon(),
  });
  // 인포윈도우
  const iw = _ctx?.infoWindow;
  _deathMarker.addListener('click', () => {
    if (!iw) return;
    iw.setContent(`<div style="font-size:13px;padding:4px 6px;">
      <strong>${_t('death_marker_label')}</strong><br>
      <span style="color:#888;font-size:11px;">${_t('death_marker_hint')}</span>
    </div>`);
    iw.open(map, _deathMarker);
  });
}

function _clearDeathMarker() {
  if (_deathMarker) { _deathMarker.setMap(null); _deathMarker = null; }
  _deathLat = null;
  _deathLng = null;
}

/** 재접속 후 맵 초기화 완료 시 merchants.js에서 호출 */
export function showDeathMarkerIfDead() {
  if (_isDead && _deathLat && _deathLng) _showDeathMarker();
}

// ── 내 위치 마커 아이콘 생성 (방향 화살표 포함) ──────────────────────────────
function makeLocationIcon(heading, isDead) {
  const hasHeading = !isDead && heading != null && !isNaN(heading) && isFinite(heading);
  const arrow = hasHeading
    ? `<polygon points="22,3 15,16 22,12 29,16" fill="#ff6b00" stroke="white" stroke-width="1.5" transform="rotate(${Math.round(heading)},22,22)"/>`
    : '';
  const label = isDead ? _t('player_label_dead') : _t('player_label_alive');
  const fontSize = isDead ? '10' : '12';
  const fillColor = isDead ? '#555555' : '#ff3300';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="22" fill="none" stroke="#ff6b00" stroke-width="2" stroke-opacity="0.5"/>
    <circle cx="24" cy="24" r="16" fill="${fillColor}" fill-opacity="0.92" stroke="#ffcc00" stroke-width="3"/>
    ${arrow}
    <text x="24" y="29" font-size="${fontSize}" font-weight="900" fill="white" text-anchor="middle" font-family="sans-serif">${label}</text>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(48, 48),
    anchor: new google.maps.Point(24, 24),
  };
}

function refreshMyMarkerIcon() {
  const marker = _ctx?.myLocationMarker;
  if (!marker) return;
  if (typeof marker.setState === 'function') {
    if (_isDead) marker.setState('die');
    else         marker.setState('idle');
  } else {
    marker.setIcon(makeLocationIcon(null, _isDead));
  }
}

// ── 내 위치 마커 업데이트 (실시간 GPS → ctx에 기록) ──────────────────────────
export function updateMyLocation(lat, lng, accuracy, heading) {
  const map    = _ctx?.map;
  const latLng = { lat, lng };

  if (_ctx.myLocationMarker) {
    _ctx.myLocationMarker.setPosition(latLng);
    if (typeof _ctx.myLocationMarker.setFacing === 'function' && heading != null) {
      _ctx.myLocationMarker.setFacing(heading);
    }
  } else {
    _ctx.myLocationMarker = createPlayerSpriteOverlay(latLng, map);
  }
  const radius = (accuracy && accuracy > 0) ? accuracy : 10;
  if (_ctx.myLocationAccCircle) {
    _ctx.myLocationAccCircle.setCenter(latLng);
    _ctx.myLocationAccCircle.setRadius(radius);
  } else {
    _ctx.myLocationAccCircle = new google.maps.Circle({
      map, center: latLng, radius,
      fillColor: '#ff3300', fillOpacity: 0.07,
      strokeColor: '#ff6b00', strokeOpacity: 0.35, strokeWeight: 1,
    });
  }

  if (heading != null && !isNaN(heading)) _ctx.lastHeading = heading;

  if (_ctx.lastDistPos) {
    const d = haversine(lat, lng, _ctx.lastDistPos.lat, _ctx.lastDistPos.lng);
    if (d > 1 && d < 500) {
      _ctx.totalDist += d;
      _ctx._onUpdateDistDisplay();

      const now = Date.now();
      if (_ctx.lastSpeedPos) {
        const dt = (now - _ctx.lastSpeedPos.time) / 1000;
        if (dt > 0) _currentSpeed = Math.min((d / dt) * 3.6, 200);
      }

      if (_isDead) {
        _reviveWalkDist += d;
        updateCombatHud();
      } else {
        if (_currentSpeed <= 17) {
          // 1m 이동 = HP+1, MP+1
          _healAccum   += d;
          _mpHealAccum += d;
          while (_healAccum   >= 1) { _healAccum   -= 1; healHp(1); }
          while (_mpHealAccum >= 1) { _mpHealAccum -= 1; healMp(1); }
        }
      }
    }
  }
  _ctx.lastDistPos  = { lat, lng };
  _ctx.lastSpeedPos = { lat, lng, time: Date.now() };

  // Update sprite animation state based on speed / alive status
  const spr = _ctx.myLocationMarker;
  if (spr && typeof spr.setState === 'function' && !_isDead) {
    const cur = spr._state;
    if (cur !== 'attack' && cur !== 'hurt') {
      if (_currentSpeed >= 8)        spr.setState('run');
      else if (_currentSpeed >= 0.5) spr.setState('walk');
      else                           spr.setState('idle');
    }
  }

  updateCombatHud();

  // 10초마다 내 위치를 battle_players에 기록 (근처 유저 표시용)
  const _now = Date.now();
  if (_ctx?.uid && _ctx?.db && _now - _lastPosWriteAt > 10000) {
    _lastPosWriteAt = _now;
    setDoc(doc(_ctx.db, 'battle_players', _ctx.uid), { lat, lng, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  }
}

// ── 백그라운드 근접 감지 + 전투 GPS 추적 ─────────────────────────────────────
export function startWatchPosition() {
  if (!navigator.geolocation) return;
  if (_ctx?.locationWatchId != null) return;
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy, heading } = pos.coords;
      _ctx.lastPos = { lat, lng, accuracy, heading };
      updateMyLocation(lat, lng, accuracy, heading);
      // GPS 쓰로틀: 5m 이상 이동 시만 근접 GS 존 재조회
      const prox = _lastProximityPos;
      if (!prox || MonsterGrid.distSq(lat, lng, prox.lat, prox.lng) >= 25) {
        _lastProximityPos = { lat, lng };
        _ctx._onCheckProximity(lat, lng);
        _refreshBattleVisibility(lat, lng);
      }
    },
    null,
    { enableHighAccuracy: true, maximumAge: 3000 }
  );
  _ctx.locationWatchId = watchId;
}

// ── 게임 서버 HP 동기화 ───────────────────────────────────────────────────────
// 서버가 확정한 HP 상태를 로컬 전투 시스템에 반영한다.
// 직접 HP를 조작하므로 서버 값이 항상 우선.

/**
 * 서버 → 클라이언트 피격 확정 반영
 * @param {number} remainHp - 서버 기준 남은 HP
 * @param {number} damage   - 받은 데미지 (플로팅 숫자용)
 */
export function syncHpFromServer(remainHp, damage) {
  if (_isDead) return;
  _player.hp = Math.max(0, remainHp);
  const myMark = _ctx?.myLocationMarker;
  const pos    = myMark?.getPosition();
  if (pos && damage > 0) showFloat(`-${damage}`, '#f87171', pos.lat(), pos.lng());
  playSound('player_hit');
  updateCombatHud();
}

/**
 * 서버 → 클라이언트 사망 확정 반영
 */
export function syncDeathFromServer() {
  if (_isDead) return;
  _isDead         = true;
  _player.hp      = 0;
  _reviveWalkDist = 0;
  const myMark = _ctx?.myLocationMarker;
  const pos    = myMark?.getPosition();
  if (pos) {
    _deathLat = pos.lat();
    _deathLng = pos.lng();
  }
  _showDeathMarker();
  refreshMyMarkerIcon();
  playSound('player_die');
  if (pos) showFloat('💀 사망', '#fbbf24', pos.lat(), pos.lng());
  updateCombatHud();
  savePlayerState();
}

/**
 * 서버 → 클라이언트 부활 확정 반영
 * @param {number} hp - 서버 기준 부활 후 HP
 */
export function syncReviveFromServer(hp) {
  _isDead         = false;
  _player.hp      = hp;
  _reviveWalkDist = 0;
  _clearDeathMarker();
  { const _rm = _ctx?.myLocationMarker;
    if (_rm && typeof _rm.revive === 'function') _rm.revive();
    else refreshMyMarkerIcon(); }
  _player.token = (_player.token ?? 0) + 30;
  playSound('revive');
  const myMark = _ctx?.myLocationMarker;
  const pos    = myMark?.getPosition();
  if (pos) showFloat('✨ 부활! 💎×30', '#fbbf24', pos.lat(), pos.lng());
  updateCombatHud();
  updateSkillBar();
  savePlayerState();
}

// GS 드랍 마커 관리 — {dropId: {marker, lat, lng, gold}}
const _gsDrops = {};

export function spawnGsDrop(dropId, lat, lng, gold, onClaim) {
  if (!window.google?.maps || !_ctx?.map) return;
  const map = _ctx.map;
  const marker = new google.maps.Marker({
    position: { lat, lng }, map,
    title: `💰 코인 ×${gold} — 클릭 획득`,
    icon: { url: '/assets/images/item/coins.png',
            scaledSize: new google.maps.Size(32, 32),
            anchor: new google.maps.Point(16, 16) },
    zIndex: 26,
  });
  _gsDrops[dropId] = { marker, lat, lng, gold };
  showFloat(`💰×${gold}`, '#fbbf24', lat, lng);
  playSound('gold_drop');

  marker.addListener('click', () => {
    if (!_gsDrops[dropId]) return;
    removeGsDrop(dropId);
    _player.gold = (_player.gold || 0) + gold;
    showFloat(`💰+${gold}`, '#fbbf24', lat, lng);
    playSound('gold_pickup');
    updateCombatHud();
    savePlayerState();
    onClaim?.();
  });

  // 5분 자동 소멸
  setTimeout(() => removeGsDrop(dropId), 300000);
}

export function removeGsDrop(dropId) {
  const d = _gsDrops[dropId];
  if (!d) return;
  d.marker?.setMap(null);
  delete _gsDrops[dropId];
}

export function hideMyMarker() {
  if (_ctx?.myLocationMarker) {
    _ctx.myLocationMarker.setMap(null);
    _ctx.myLocationMarker = null;
  }
  if (_ctx?.myLocationAccCircle) {
    _ctx.myLocationAccCircle.setMap(null);
    _ctx.myLocationAccCircle = null;
  }
}

// ── 상점 시스템 ───────────────────────────────────────────────────────────────

function _makeShopIcon(type, imageUrl) {
  const url = imageUrl || 'assets/images/shops/arms.png';
  return {
    url,
    scaledSize: new google.maps.Size(44, 44),
    anchor:     new google.maps.Point(22, 22),
  };
}

function _renderShopMarker(shop) {
  const map = _ctx?.map;
  if (!map || !shop.active) return;
  if (_shopMarkers[shop.id]) { _shopMarkers[shop.id].setMap(null); }

  const marker = new google.maps.Marker({
    position: { lat: shop.lat, lng: shop.lng },
    map,
    title:  shop.name,
    icon:   _makeShopIcon(shop.type, shop.image),
    zIndex: 50,
  });

  marker.addListener('click', () => {
    const iw = _ctx?.infoWindow;
    if (iw) {
      const typeLabel = { weapon_armor: '⚔️ 무기/방어구', potion: '🧪 약물', misc: '🛍️ 잡템' }[shop.type] || shop.type;
      iw.setContent(`<div style="font-size:13px;padding:4px 8px;min-width:120px">
        <strong>${escHtml(shop.name)}</strong><br>
        <span style="color:#888;font-size:11px">${typeLabel}</span>
      </div>`);
      iw.open(map, marker);
    }
    const freshShop = _shops.find(s => s.id === shop.id) || shop;
    _ctx._onShopClick?.(freshShop);
  });

  _shopMarkers[shop.id] = marker;
}

export async function loadShops() {
  if (!_ctx?.db) return;
  try {
    const snap = await getDocs(collection(_ctx.db, 'game_shops'));
    _shops = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    Object.values(_shopMarkers).forEach(m => m.setMap(null));
    _shopMarkers = {};
    _shops.forEach(s => { if (s.active) _renderShopMarker(s); });
  } catch (err) {
    // 상점 로드 실패는 비치명적
  }
}

export function getShops() { return _shops; }

export async function deleteShop(shopId) {
  if (!_ctx?.db) return;
  await deleteDoc(doc(_ctx.db, 'game_shops', shopId));
  _shops = _shops.filter(s => s.id !== shopId);
  if (_shopMarkers[shopId]) { _shopMarkers[shopId].setMap(null); delete _shopMarkers[shopId]; }
}

let _lastNearShopId = null;

export function checkShopProximity(lat, lng) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const shop of _shops) {
    if (!shop.active) continue;
    const dist = haversine(lat, lng, shop.lat, shop.lng);
    // 현재 머물던 상점은 넓은 이탈 임계값 사용 (GPS 노이즈로 인한 경계 진동 방지)
    const threshold = shop.id === _lastNearShopId ? SHOP_EXIT_M : SHOP_RANGE_M;
    if (dist <= threshold && dist < nearestDist) {
      nearestDist = dist;
      nearest = shop;
    }
  }
  const nearId = nearest?.id ?? null;
  if (nearId !== _lastNearShopId) {
    _lastNearShopId = nearId;
    if (nearest) _ctx?._onShopNear?.(nearest);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 신규 유저 온보딩 튜토리얼 보물박스 시스템
// ════════════════════════════════════════════════════════════════════════════

let _tutorialBoxes = [];        // [{index, lat, lng, distM, claimed, marker}]
let _tutorialProxState = {};    // {index: lastThresholdHit} — 중복 효과 방지
const _claimedTutorialSet = new Set(); // 세션 내 수령 완료 인덱스 — loadTutorialBoxes 재호출 후에도 유지

function _tutorialShowRewardPanel(data, lang) {
  const existing = document.getElementById('tutorialRewardPanel');
  if (existing) existing.remove();

  const title = { ko: '🎁 보물 획득!', en: '🎁 Treasure Found!', vi: '🎁 Tìm thấy kho báu!' }[lang] || '🎁 보물 획득!';
  const goldLabel = { ko: '골드', en: 'Gold', vi: 'Vàng' }[lang] || '골드';
  const xpLabel   = { ko: '경험치', en: 'XP', vi: 'Kinh nghiệm' }[lang] || '경험치';
  const badgeLabel = {
    ko: '🏅 탐험가 뱃지 획득!',
    en: '🏅 Explorer Badge earned!',
    vi: '🏅 Nhận Huy hiệu Nhà thám hiểm!',
  }[lang] || '🏅 탐험가 뱃지 획득!';
  const tapLabel = { ko: '탭하여 닫기', en: 'Tap to close', vi: 'Nhấn để đóng' }[lang] || '탭하여 닫기';

  const rows = [];
  if (data.gold) rows.push(`<div class="trp-row"><span class="trp-icon">🪙</span><span class="trp-name">${goldLabel}</span><span class="trp-val">+${data.gold.toLocaleString()}</span></div>`);
  if (data.xp)   rows.push(`<div class="trp-row"><span class="trp-icon">⭐</span><span class="trp-name">${xpLabel}</span><span class="trp-val">+${data.xp.toLocaleString()}</span></div>`);
  if (data.badge === 'explorer') rows.push(`<div class="trp-badge">${badgeLabel}</div>`);

  const panel = document.createElement('div');
  panel.id = 'tutorialRewardPanel';
  panel.innerHTML = `
    <div class="trp-title">${title}</div>
    <div class="trp-divider"></div>
    ${rows.join('')}
    <div class="trp-tap">${tapLabel}</div>`;
  panel.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.85);
    background:linear-gradient(145deg,#1e1b4b,#312e81);
    border:2px solid #fbbf24;border-radius:18px;padding:24px 32px;
    z-index:10000;text-align:center;min-width:240px;max-width:300px;
    box-shadow:0 0 40px rgba(251,191,36,.45);
    animation:trpIn .35s cubic-bezier(.34,1.56,.64,1) forwards;
    font-family:inherit;cursor:pointer;`;

  if (!document.getElementById('trpStyle')) {
    const s = document.createElement('style');
    s.id = 'trpStyle';
    s.textContent = `
      @keyframes trpIn{to{transform:translate(-50%,-50%) scale(1);opacity:1}}
      #tutorialRewardPanel{opacity:0}
      #tutorialRewardPanel .trp-title{color:#fbbf24;font-size:20px;font-weight:800;margin-bottom:4px}
      #tutorialRewardPanel .trp-divider{height:1px;background:rgba(251,191,36,.3);margin:10px 0}
      #tutorialRewardPanel .trp-row{display:flex;align-items:center;gap:10px;padding:6px 0;color:#f1f5f9;font-size:16px}
      #tutorialRewardPanel .trp-icon{font-size:20px;width:28px;text-align:center}
      #tutorialRewardPanel .trp-name{flex:1;text-align:left;color:#cbd5e1;font-size:14px}
      #tutorialRewardPanel .trp-val{font-weight:800;color:#fbbf24;font-size:18px}
      #tutorialRewardPanel .trp-badge{margin-top:10px;padding:8px 12px;background:rgba(167,139,250,.2);border-radius:10px;color:#a78bfa;font-size:14px;font-weight:700}
      #tutorialRewardPanel .trp-tap{margin-top:14px;color:#64748b;font-size:11px}`;
    document.head.appendChild(s);
  }

  document.body.appendChild(panel);
  const dismiss = () => {
    panel.style.transition = 'opacity .2s';
    panel.style.opacity = '0';
    setTimeout(() => panel.remove(), 200);
  };
  panel.addEventListener('click', dismiss);
  setTimeout(dismiss, 6000);
}

function _tutorialShowToast(msg, color = '#f59e0b') {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:20%;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,.85);color:${color};font-size:15px;font-weight:700;
    padding:12px 24px;border-radius:12px;z-index:9998;pointer-events:none;
    animation:fadeInDown .3s ease;text-align:center;max-width:280px;line-height:1.4;
    border:2px solid ${color};`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function _tutorialScreenRipple() {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;inset:0;border-radius:inherit;
    background:radial-gradient(circle, rgba(251,191,36,.15) 0%, transparent 70%);
    animation:fadeInDown .8s ease forwards;pointer-events:none;z-index:10;`;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function _tutorialHeartbeat() {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  for (let i = 0; i < 2; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;inset:0;background:rgba(239,68,68,.12);
        animation:fadeInDown .25s ease;pointer-events:none;z-index:10;`;
      overlay.appendChild(el);
      setTimeout(() => el.remove(), 250);
    }, i * 400);
  }
}

function _tutorialParticles(lat, lng) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  const emojis = ['✨','⭐','💫','🌟'];
  for (let i = 0; i < 4; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      const x = 40 + Math.random() * 20;
      const y = 40 + Math.random() * 20;
      el.style.cssText = `position:absolute;left:${x}%;top:${y}%;font-size:22px;
        animation:fadeInDown .8s ease forwards;pointer-events:none;z-index:11;`;
      el.textContent = emojis[i % emojis.length];
      overlay.appendChild(el);
      setTimeout(() => el.remove(), 800);
    }, i * 150);
  }
}

function _tutorialLightBurst() {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;inset:0;
    background:radial-gradient(circle, rgba(251,191,36,.6) 0%, rgba(251,191,36,0) 60%);
    animation:fadeInDown .15s ease;pointer-events:none;z-index:12;`;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

function _tutorialSlowMo() {
  // 화면 전체에 brief 슬로우모 필터 느낌 (청백 vignette)
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  const prev = overlay.style.filter || '';
  overlay.style.transition = 'filter .1s';
  overlay.style.filter = 'brightness(1.4) saturate(1.8)';
  setTimeout(() => { overlay.style.filter = prev; }, 600);
}

function _tutorialDiscoveryAnimation(box) {
  _tutorialSlowMo();
  setTimeout(() => _tutorialLightBurst(), 100);
  setTimeout(() => _tutorialParticles(box.lat, box.lng), 200);
  // 박스 마커 애니메이션 (bounce → remove after claim)
  if (box.marker) {
    const el = box.marker.getElement?.();
    if (el) {
      el.style.animation = 'none';
      el.style.transform = 'scale(1.5)';
      setTimeout(() => { el.style.transform = 'scale(1)'; }, 500);
    }
  }
}

async function _claimTutorialBox(box) {
  if (box.claimed || box._claiming || _claimedTutorialSet.has(box.index)) return;
  box._claiming = true;

  const pos = getMyPos();
  if (!pos) { box._claiming = false; return; }

  try {
    const fn = httpsCallable(_ctx?.functions, 'claimTutorialBox');
    const res = await fn({ boxIndex: box.index, userLat: pos.lat, userLng: pos.lng });
    if (!res.data?.ok) { box._claiming = false; return; }

    box.claimed = true;
    _claimedTutorialSet.add(box.index);
    const data = res.data;

    // 발견 연출
    _tutorialDiscoveryAnimation(box);
    playSound('gold');

    // 강한 진동
    if (navigator.vibrate) navigator.vibrate([100, 50, 200, 50, 300]);

    // 보상 상세 패널 표시
    const lang = window.LANG || 'en';
    setTimeout(() => _tutorialShowRewardPanel(data, lang), 500);

    // 마커 제거 (0.8초 딜레이 — 연출 후)
    setTimeout(() => {
      if (box.marker) { box.marker.setMap(null); box.marker = null; }
    }, 800);

    // 골드·XP 반영
    if (data.gold) { _player.gold = (_player.gold || 0) + data.gold; updateHud?.(); }
    if (data.xp)   { _player.gsExp = (_player.gsExp || 0) + data.xp; }

  } catch (err) {
    const msg = err?.message || '수령 실패';
    _tutorialShowToast(`❌ ${msg}`, '#f87171');
  } finally {
    box._claiming = false;
  }
}

function _renderTutorialMarker(box) {
  const map = _ctx?.map;
  if (!map) return;
  if (box.marker) box.marker.setMap(null);

  const label = String(box.distM) + 'm';
  const marker = new google.maps.Marker({
    position: { lat: box.lat, lng: box.lng },
    map,
    title: `🎁 튜토리얼 보물 (${label})`,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
          <filter id="glow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <ellipse cx="24" cy="52" rx="12" ry="3" fill="rgba(0,0,0,.25)"/>
          <g filter="url(#glow)">
            <rect x="8" y="22" width="32" height="24" rx="4" fill="#b45309"/>
            <rect x="8" y="22" width="32" height="10" rx="4" fill="#d97706"/>
            <rect x="18" y="16" width="12" height="8" rx="3" fill="#92400e"/>
            <rect x="20" y="22" width="8" height="24" fill="#b45309"/>
            <rect x="8" y="22" width="32" height="2" fill="#fbbf24"/>
            <text x="24" y="38" font-size="14" text-anchor="middle" dominant-baseline="middle">🎁</text>
          </g>
        </svg>`),
      scaledSize: new google.maps.Size(48, 56),
      anchor:     new google.maps.Point(24, 52),
    },
    zIndex: 200,
    animation: google.maps.Animation.BOUNCE,
  });

  marker.addListener('click', () => {
    const lang = window.LANG || 'en';
    const pos = getMyPos();
    if (!pos) {
      _tutorialShowToast(
        lang === 'vi' ? '📍 Đang chờ GPS...' : '📍 GPS 위치 확인 중입니다.',
        '#94a3b8'
      );
      return;
    }
    const dist = haversine(pos.lat, pos.lng, box.lat, box.lng);
    if (dist > 50) {
      _tutorialShowToast(
        lang === 'vi'
          ? `🎁 Còn ${Math.round(dist)}m nữa! Tiến lại gần hơn.`
          : `🎁 아직 ${Math.round(dist)}m 남았어요! 직접 걸어가세요.`,
        '#fbbf24'
      );
      return;
    }
    _claimTutorialBox(box);
  });

  box.marker = marker;
}

export function loadTutorialBoxes(boxes) {
  // 기존 마커 정리
  for (const b of _tutorialBoxes) { if (b.marker) b.marker.setMap(null); }
  _tutorialBoxes = [];
  _tutorialProxState = {};

  for (const b of (boxes || [])) {
    if (b.claimed || _claimedTutorialSet.has(b.index)) continue;
    const box = { ...b, marker: null, _claiming: false };
    _tutorialBoxes.push(box);
    _renderTutorialMarker(box);
  }
}

export function clearTutorialBoxes() {
  for (const b of _tutorialBoxes) { if (b.marker) b.marker.setMap(null); }
  _tutorialBoxes = [];
  _tutorialProxState = {};
}

// 매 GPS 업데이트마다 호출 — 거리 기반 UX 효과 발동
export function checkTutorialProximity(lat, lng) {
  if (_tutorialBoxes.length === 0) return;
  const lang = window.LANG || 'en';

  for (const box of _tutorialBoxes) {
    if (box.claimed) continue;
    const dist = haversine(lat, lng, box.lat, box.lng);
    const prev = _tutorialProxState[box.index] ?? Infinity;

    // 8m 이내 → 자동 수령 시도
    if (dist <= 8) {
      if (prev > 8) {
        _claimTutorialBox(box);
        _tutorialProxState[box.index] = dist;
      }
      continue;
    }

    // 20m 이내 → 심박 + 파티클 (최초 진입 시만)
    if (dist <= 20 && prev > 20) {
      _tutorialHeartbeat();
      _tutorialParticles(lat, lng);
      if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
      _tutorialShowToast(
        lang === 'vi'
          ? `❤️ Còn ${Math.round(dist)}m! Kho báu đang gần...`
          : `❤️ ${Math.round(dist)}m! 보물이 아주 가까워요...`,
        '#f87171'
      );
      _tutorialProxState[box.index] = dist;
      continue;
    }

    // 50m 이내 → 방향 안내 + 미세진동 (최초 진입 시만)
    if (dist <= 50 && prev > 50) {
      if (navigator.vibrate) navigator.vibrate(30);
      _tutorialShowToast(
        lang === 'vi'
          ? `✨ ${Math.round(dist)}m — Cảm nhận hơi thở của kho báu!`
          : `✨ ${Math.round(dist)}m — 보물의 기운이 느껴져요!`,
        '#fbbf24'
      );
      _tutorialProxState[box.index] = dist;
      continue;
    }

    // 100m 이내 → 미풍 화면 흔들림 (최초 진입 시만)
    if (dist <= 100 && prev > 100) {
      _tutorialScreenRipple();
      _tutorialShowToast(
        lang === 'vi'
          ? `🌬️ ${Math.round(dist)}m — Có gì đó ở gần đây...`
          : `🌬️ ${Math.round(dist)}m — 근처에 뭔가 있어요...`,
        '#d1d5db'
      );
      _tutorialProxState[box.index] = dist;
    }
  }
}
