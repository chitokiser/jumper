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
import { gsAdminGetSpawns, gsAdminAddSpawn, gsAdminDeleteSpawn, gsAdminKillMonster,
         isGameServerConnected, connectToGameServer, disconnectFromGameServer }
  from './merchants.gameserver.js';

// ── 공유 컨텍스트 참조 ─────────────────────────────────────────────────────────
// initBattle(ctx, callbacks) 호출 후 설정됨
let _ctx = null;

// ── 내부 배틀 상태 ────────────────────────────────────────────────────────────
let _player       = { level:1, hp:1000, mp:1000, maxHp:1000, maxMp:1000, xp:0, gold:0 };
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
let _monsterCd       = {};     // { monsterId: bool }
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
let _battleHpUnsub       = null;    // battle_hp onSnapshot 구독
let _monsterRespawnTimers = {};      // { monsterId: timeoutId }
let _monsterAggro        = {};      // { monsterId: uid } 어그로 캐시
let _aggroClaimed        = new Set(); // 이미 어그로 클레임한 몬스터 ID

// ── 스킬 상수 ────────────────────────────────────────────────────────────────
const SKILL_MP_COST  = 100;
const SKILL_RANGE_M  = 100;
const SKILL_CD_MS    = { lightning: 15000, ice: 25000, fire: 15000 };
const SKILL_FREEZE_MS = 20000;

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

  // GS 스폰 목록 새로고침 버튼
  document.getElementById('btnRefreshGsSpawns')?.addEventListener('click', () => refreshGsSpawnList());
  // Firestore 몬스터 목록 새로고침 버튼
  document.getElementById('btnRefreshFsMonsters')?.addEventListener('click', () => refreshFirestoreMonsterList());
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
      case 'arrow_shot':  tone(700,0.25,0.12); tone(300,0.15,0.1,0.05,'sawtooth'); break;
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
        noise(0.07,0.55);
        tone(160,0.45,0.07,0,'sawtooth');
        tone(85,0.3,0.14,0.04);
        break;
      case 'critical_hit':
        tone(880,0.5,0.05,0,'square');
        tone(1100,0.4,0.08,0.04,'square');
        noise(0.06,0.6);
        tone(660,0.35,0.12,0.07);
        break;
      case 'arrow_hit':   noise(0.08,0.5); tone(220,0.3,0.1,0,'square'); break;
      case 'player_hit':  tone(120,0.4,0.25,'sawtooth'); noise(0.1,0.3); break;
      case 'monster_die': [440,330,220,165].forEach((f,i)=>tone(f,0.28,0.14,i*0.09)); break;
      case 'player_die':  tone(300,0.5,0.9,'triangle'); tone(80,0.3,0.7,0.1); break;
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
    }
  } catch { /* 오디오 미지원 무시 */ }
}

// ── 화살 발사 애니메이션 ──────────────────────────────────────────────────────
function animateArrow(fromLat, fromLng, toLat, toLng, color, onHit) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) { onHit?.(); return; }
  const sp = latLngToPixel(fromLat, fromLng);
  const ep = latLngToPixel(toLat,   toLng);
  if (!sp || !ep) { onHit?.(); return; }

  const angle = Math.atan2(ep.y - sp.y, ep.x - sp.x) * 180 / Math.PI;
  const el = document.createElement('div');
  el.className = 'arrow-proj';
  el.style.cssText = `left:${sp.x}px;top:${sp.y}px;background:${color};
    box-shadow:0 0 5px ${color};transform:translate(-50%,-50%) rotate(${angle}deg)`;
  overlay.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.left = ep.x + 'px';
    el.style.top  = ep.y + 'px';
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
function showFloat(text, color, lat, lng) {
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
  ['lightning','ice','fire'].forEach((s, i) => {
    const btn  = document.getElementById(`skillBtn${i}`);
    const cdEl = document.getElementById(`skillCd${i}`);
    if (!btn) return;
    const cdExp = _skillCd[s] || 0;
    const inCd  = now < cdExp;
    const noMp  = _player.mp < SKILL_MP_COST;
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

  const lv = document.getElementById('cLv');    if (lv)  lv.textContent  = `LV.${p.level}  💰${p.gold||0}`;
  const hv = document.getElementById('cHpVal'); if (hv)  hv.textContent  = `${p.hp} / ${p.maxHp}`;
  const mv = document.getElementById('cMpVal'); if (mv)  mv.textContent  = `${p.mp} / ${p.maxMp}`;
  const sp = document.getElementById('cSpd');   if (sp)  sp.textContent  = `SPD ${_currentSpeed.toFixed(1)} km/h`;
  const dead = document.getElementById('cDead');
  if (dead) {
    if (_isDead) {
      dead.style.display = '';
      dead.textContent = `💀 사망 — 부활까지 ${Math.max(0, Math.round(50 - _reviveWalkDist))}m 남음`;
    } else {
      dead.style.display = 'none';
    }
  }
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
      _player.gold = d.gold || 0;
      if ((d.level || 1) === _player.level) {
        _player.hp = Math.min(d.hp ?? _player.maxHp, _player.maxHp);
        _player.mp = Math.min(d.mp ?? _player.maxMp, _player.maxMp);
        _isDead         = d.isDead         === true;
        _reviveWalkDist = d.reviveWalkDist || 0;
      } else {
        _player.hp      = _player.maxHp;
        _player.mp      = _player.maxMp;
        _isDead         = false;
        _reviveWalkDist = 0;
      }
    } else {
      _player.hp = _player.maxHp;
      _player.mp = _player.maxMp;
    }
  } catch { /* 무시 */ }

  updateCombatHud();
}

let _saveTimer = null;
export function getPlayerGold()  { return _player.gold  || 0; }
export function getPlayerLevel() { return _player.level || 1; }
export function isPlayerDead() { return _isDead; }

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
        gold: _player.gold || 0,
        isDead: _isDead,
        reviveWalkDist: _reviveWalkDist,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch { /* 무시 */ }
  }, 3000);
}

// ── 플레이어 HP/MP 변경 ────────────────────────────────────────────────────────
let _lastHealFloat = 0;
function takeDamage(amount, sourceLat, sourceLng) {
  if (_isDead) return;
  _player.hp = Math.max(0, _player.hp - amount);
  const myMark = _ctx?.myLocationMarker;
  const lat = sourceLat || (myMark ? myMark.getPosition().lat() : null);
  const lng = sourceLng || (myMark ? myMark.getPosition().lng() : null);
  if (lat && lng) showFloat(`-${amount}`, '#f87171', lat, lng);
  if (_player.hp <= 0) {
    _isDead = true;
    _player.hp = 0;
    _reviveWalkDist = 0;
    playSound('player_die');
    if (lat && lng) showFloat('💀 사망했습니다', '#fbbf24', lat, lng);
  } else {
    playSound('player_hit');
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

// ── 마법 스킬 ────────────────────────────────────────────────────────────────
export function castLightning() {
  if (_isDead) return;
  if (document.getElementById('skillTargetModal')) return;
  const now = Date.now();
  if (_skillCd.lightning && now < _skillCd.lightning) return;

  animateLightning();
  playSound('skill_lightning');

  const myMark = _ctx?.myLocationMarker;
  if (!myMark) { showSkillError('📍 위치 확인 중...'); return; }
  const pos = myMark.getPosition();
  const myLat = pos.lat(), myLng = pos.lng();

  const targets = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);

  if (targets.length === 0) { showSkillError('⚡ 범위 내 몬스터 없음'); return; }

  const fire = (target) => {
    if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError('⚡ MP 부족!'); return; }
    showSkillMapEffect(target.lat, target.lng, 'lightning');
    let hitCount = 0;
    for (const mob of _monsters) {
      if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
      if (haversine(target.lat, target.lng, mob.lat, mob.lng) <= SKILL_RANGE_M) {
        hitMonster(mob.id, 100 * _player.level);
        showFloat(`⚡-${100 * _player.level}`, '#facc15', mob.lat, mob.lng);
        hitCount++;
      }
    }
    showFloat(`⚡ 벼락! (${hitCount}마리)`, '#facc15', target.lat, target.lng);
    _skillCd.lightning = Date.now() + SKILL_CD_MS.lightning;
    updateSkillBar();
    setTimeout(() => updateSkillBar(), SKILL_CD_MS.lightning);
  };

  if (targets.length === 1) fire(targets[0]);
  else showSkillTargetModal('lightning', targets, fire);
}

export function castIceFreeze() {
  if (_isDead) return;
  if (document.getElementById('skillTargetModal')) return;
  const now = Date.now();
  if (_skillCd.ice && now < _skillCd.ice) return;

  animateIceFreeze();
  playSound('skill_ice');

  const myMark = _ctx?.myLocationMarker;
  if (!myMark) { showSkillError('📍 위치 확인 중...'); return; }
  const pos = myMark.getPosition();
  const myLat = pos.lat(), myLng = pos.lng();

  const targets = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);

  if (targets.length === 0) { showSkillError('❄ 범위 내 몬스터 없음'); return; }

  const fire = (target) => {
    if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError('❄ MP 부족!'); return; }
    showSkillMapEffect(target.lat, target.lng, 'ice');
    const freezeNow = Date.now();
    let hitCount = 0;
    for (const mob of _monsters) {
      if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
      if (haversine(target.lat, target.lng, mob.lat, mob.lng) <= SKILL_RANGE_M) {
        _frozenUntil[mob.id] = freezeNow + SKILL_FREEZE_MS;
        const marker = _monsterMarkers[mob.id];
        if (marker) {
          marker.setIcon(getMonsterFrozenIcon());
          setTimeout(() => { if (_monsterMarkers[mob.id]) _monsterMarkers[mob.id].setIcon(getMonsterIcon(mob.image)); }, SKILL_FREEZE_MS);
        }
        showFloat('❄ 동결!', '#93c5fd', mob.lat, mob.lng);
        hitCount++;
      }
    }
    showFloat(`❄ 동결! (${hitCount}마리 / ${SKILL_FREEZE_MS/1000}초)`, '#93c5fd', target.lat, target.lng);
    _skillCd.ice = Date.now() + SKILL_CD_MS.ice;
    updateSkillBar();
    setTimeout(() => updateSkillBar(), SKILL_CD_MS.ice);
  };

  if (targets.length === 1) fire(targets[0]);
  else showSkillTargetModal('ice', targets, fire);
}

export function castFireStorm() {
  if (_isDead) return;
  if (document.getElementById('skillTargetModal')) return;
  const now = Date.now();
  if (_skillCd.fire && now < _skillCd.fire) return;

  animateFireStorm();
  playSound('skill_fire');

  const myMark = _ctx?.myLocationMarker;
  if (!myMark) { showSkillError('📍 위치 확인 중...'); return; }
  const pos = myMark.getPosition();
  const myLat = pos.lat(), myLng = pos.lng();

  const targets = _monsters.filter(m => m.lat && m.lng && m.hp > 0 &&
    haversine(myLat, myLng, m.lat, m.lng) <= SKILL_RANGE_M);

  if (targets.length === 0) { showSkillError('🔥 범위 내 몬스터 없음'); return; }

  const fire = (target) => {
    if (!useMp(SKILL_MP_COST)) { playSound('skill_no_mp'); showSkillError('🔥 MP 부족!'); return; }
    showSkillMapEffect(target.lat, target.lng, 'fire');
    let hitCount = 0;
    for (const mob of _monsters) {
      if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
      if (haversine(target.lat, target.lng, mob.lat, mob.lng) <= SKILL_RANGE_M) {
        hitMonster(mob.id, 100 * _player.level);
        showFloat(`🔥-${100 * _player.level}`, '#f97316', mob.lat, mob.lng);
        hitCount++;
      }
    }
    showFloat(`🔥 화염! (${hitCount}마리)`, '#f97316', target.lat, target.lng);
    _skillCd.fire = Date.now() + SKILL_CD_MS.fire;
    updateSkillBar();
    setTimeout(() => updateSkillBar(), SKILL_CD_MS.fire);
  };

  if (targets.length === 1) fire(targets[0]);
  else showSkillTargetModal('fire', targets, fire);
}

// ── 스킬 대상 선택 모달 ───────────────────────────────────────────────────────
function showSkillTargetModal(skillKey, targets, onSelect) {
  document.getElementById('skillTargetModal')?.remove();
  const labels = { lightning: '⚡ 벼락', ice: '❄ 빙결', fire: '🔥 화염' };
  const modal = document.createElement('div');
  modal.id = 'skillTargetModal';
  modal.style.cssText = `position:fixed;bottom:130px;left:50%;transform:translateX(-50%);
    background:rgba(10,10,22,0.96);border:1px solid rgba(255,255,255,0.15);
    border-radius:14px;padding:14px 16px;z-index:9999;min-width:240px;max-width:90vw;
    box-shadow:0 8px 32px rgba(0,0,0,0.65);`;
  modal.innerHTML = `
    <div style="color:#e5e7eb;font-weight:700;font-size:13px;margin-bottom:10px;text-align:center;">
      ${labels[skillKey]||'스킬'} — 공격 대상 선택
    </div>
    ${targets.map(mob => `
      <div data-mob="${mob.id}" style="cursor:pointer;padding:9px 12px;margin:4px 0;
        background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);
        border-radius:9px;color:#fff;font-size:13px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:17px;">${mob.image?.startsWith('/')?'👾':(mob.image||'👾')}</span>
        <span>${escHtml(mob.name||'몬스터')}</span>
        <span style="margin-left:auto;font-size:11px;color:#9ca3af;">HP ${mob.hp}/${mob.maxHp}</span>
      </div>
    `).join('')}
    <div id="_skillTargetCancel" style="cursor:pointer;padding:6px;margin-top:8px;
      color:#6b7280;font-size:12px;text-align:center;">취소</div>
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
  const cfg = { lightning:['⚡','#facc15'], ice:['❄','#93c5fd'], fire:['🔥','#f97316'] }[type]||['✨','#fff'];
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
  if (!_isDead) { showSkillError('사망 상태가 아닙니다'); return; }
  const uid = _ctx?.uid;
  if (!uid) return;
  try {
    const fn = httpsCallable(_ctx.functions, 'useReviveTicket');
    await fn();

    _isDead = false;
    _reviveWalkDist = 0;
    _player.hp = Math.round(_player.maxHp * 0.5);
    _player.mp = Math.round(_player.maxMp * 0.5);
    playSound('revive');
    const myMark = _ctx?.myLocationMarker;
    if (myMark) showFloat('✨ 부활! HP·MP 50%', '#a78bfa', myMark.getPosition().lat(), myMark.getPosition().lng());
    updateCombatHud();
    savePlayerState();
    _ctx?._onLoadInventory();
    updateSkillBar();
  } catch (e) { showSkillError('오류: ' + e.message); }
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
    const [mSnap, tSnap, hpSnap] = await Promise.all([
      getDocs(query(collection(_ctx.db, 'battle_monsters'), where('active', '==', true))),
      getDocs(query(collection(_ctx.db, 'battle_towers'),   where('active', '==', true))),
      getDocs(collection(_ctx.db, 'battle_hp')),
    ]);
    _monsters = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _towers   = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
  _decoMarkers.forEach(d => {
    if (d.marker) d.marker.setMap(null);
    const size = d.size || 48;
    const marker = new google.maps.Marker({
      position: { lat: d.lat, lng: d.lng }, map,
      title: d.name || '',
      icon: { url: d.imageUrl, scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(size/2, size/2) },
      zIndex: 5,
    });
    marker.addListener('click', () => {
      infoWindow?.setContent(`
        <div style="font-size:13px;line-height:1.6;">
          <img src="${escHtml(d.imageUrl)}" style="width:80px;height:80px;object-fit:contain;display:block;margin:0 auto 6px;">
          <div style="font-weight:700;text-align:center;">${escHtml(d.name||'데코')}</div>
          ${_ctx?.isAdmin ? `<button onclick="window.__deleteDeco('${d.id}')" style="margin-top:6px;width:100%;padding:4px;background:#fee2e2;color:#b91c1c;border:none;border-radius:4px;cursor:pointer;">🗑️ 삭제</button>` : ''}
        </div>`);
      infoWindow?.open(map, marker);
    });
    d.marker = marker;
  });
}

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
  if (image && image.startsWith('/')) {
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
  return { url: `/assets/images/monsters/${image}`,
           scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
}

function getTowerIcon(image, type) {
  if (image && image.startsWith('/')) {
    return { url: image, scaledSize: new google.maps.Size(38,38), anchor: new google.maps.Point(19,19) };
  }
  const isCannon = type === 'cannon';
  const emoji = image || (isCannon ? '💣' : '🏹');
  const fill  = isCannon ? 'rgba(180,60,0,0.88)' : 'rgba(124,58,237,0.88)';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">
    <circle cx="19" cy="19" r="18" fill="${fill}" stroke="#fff" stroke-width="2"/>
    <text x="19" y="26" font-size="20" text-anchor="middle">${emoji}</text></svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
           scaledSize: new google.maps.Size(38,38), anchor: new google.maps.Point(19,19) };
}

function _spawnMonsterMarker(mob) {
  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;
  if (!map || !mob.lat || !mob.lng) return;

  // ── 스프라이트 타입 (dragon 등) ─────────────────────────────────────────────
  if (hasSpriteConfig(mob.monsterType)) {
    const gsLike = {
      ...mob,
      type:       mob.monsterType,
      currentLat: mob.lat,
      currentLng: mob.lng,
      state:      mob.hp > 0 ? 'idle' : 'dead',
      monsterId:  mob.id,
    };
    const overlay = createMonsterSpriteOverlay(
      map, gsLike,
      () => {
        if (!_isDead && _ctx?.myLocationMarker && !_clickAtkCd[mob.id] && mob.hp > 0) {
          const myPos = _ctx.myLocationMarker.getPosition();
          const dist  = haversine(myPos.lat(), myPos.lng(), mob.lat, mob.lng);
          const clickRange = 25;
          if (dist <= clickRange) {
            const roll = Math.floor(Math.random() * 10) + 1;
            const isCrit = roll >= 6;
            const dmg  = _player.level * roll;
            _clickAtkCd[mob.id] = true;
            setTimeout(() => { delete _clickAtkCd[mob.id]; }, 800);
            playSound(isCrit ? 'critical_hit' : 'arrow_hit');
            animateArrow(myPos.lat(), myPos.lng(), mob.lat, mob.lng,
              isCrit ? '#ff6600' : '#fbbf24', () => {
                hitMonster(mob.id, dmg);
                showFloat(isCrit ? `💥${dmg}` : `-${dmg}`,
                  isCrit ? '#ff6600' : '#fbbf24', mob.lat, mob.lng);
                if (isCrit) showCriticalToast();
              });
            return;
          }
        }
        const hpPct = Math.round((mob.hp / mob.maxHp) * 100);
        infoWindow?.setContent(`
          <div style="font-size:13px;min-width:140px">
            <b>🐉 ${escHtml(mob.name||'드래곤')}</b>
            <div style="margin:6px 0 2px;font-size:11px;color:#888">HP ${mob.hp} / ${mob.maxHp}</div>
            <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${hpPct}%;background:#ef4444;border-radius:4px"></div></div>
            ${_ctx?.isAdmin ? `<button onclick="window.__deleteBattleObj('monster','${mob.id}')"
              style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">🗑 삭제</button>` : ''}
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
    position: { lat: mob.lat, lng: mob.lng }, map,
    title: mob.name || '몬스터',
    icon: getMonsterIcon(mob.image),
    zIndex: 50,
  });
  marker.addListener('click', () => {
    if (!_isDead && _ctx?.myLocationMarker && !_clickAtkCd[mob.id] && mob.hp > 0) {
      const myPos = _ctx.myLocationMarker.getPosition();
      const dist  = haversine(myPos.lat(), myPos.lng(), mob.lat, mob.lng);
      const clickRange = 25;
      if (dist <= clickRange) {
        const roll   = Math.floor(Math.random() * 10) + 1;
        const isCrit = roll >= 6;
        const dmg    = _player.level * roll;
        _clickAtkCd[mob.id] = true;
        setTimeout(() => { delete _clickAtkCd[mob.id]; }, 800);
        playSound(isCrit ? 'critical_hit' : 'arrow_hit');
        animateArrow(myPos.lat(), myPos.lng(), mob.lat, mob.lng,
          isCrit ? '#ff6600' : '#fbbf24', () => {
            hitMonster(mob.id, dmg);
            showFloat(isCrit ? `💥${dmg}` : `-${dmg}`,
              isCrit ? '#ff6600' : '#fbbf24', mob.lat, mob.lng);
            if (isCrit) showCriticalToast();
          });
        return;
      }
    }
    const hpPct = Math.round((mob.hp / mob.maxHp) * 100);
    infoWindow?.setContent(`
      <div style="font-size:13px;min-width:140px">
        <b>${escHtml(mob.name||'몬스터')}</b>
        <div style="margin:6px 0 2px;font-size:11px;color:#888">HP ${mob.hp} / ${mob.maxHp}</div>
        <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${hpPct}%;background:#ef4444;border-radius:4px"></div></div>
        ${_ctx?.isAdmin ? `<button onclick="window.__deleteBattleObj('monster','${mob.id}')"
          style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">🗑 삭제</button>` : ''}
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
  playSound(isCrit ? 'critical' : 'arrow_shot');

  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;

  if (st.current <= 0) {
    // 타워 파괴
    marker.setMap(null);
    delete _towerMarkers[tower.id];
    infoWindow?.close();
    showFloat('🏚 타워 파괴!', '#f97316', pos.lat(), pos.lng());
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
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏰 ${escHtml(tower.name||'방어탑')}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
        <div style="flex:1;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${hpPct}%;background:${hpColor};border-radius:5px;transition:width .3s;"></div>
        </div>
        <span style="font-size:11px;color:#374151;min-width:65px;text-align:right;">${st.current}/${st.max}</span>
      </div>
      <div style="color:${isCrit?'#f97316':'#ef4444'};font-weight:700;">${isCrit?'💥 CRITICAL! ':'💥 '}-${dmg}</div>
      <div style="font-size:11px;color:#555;margin-top:2px;">계속 클릭하여 공격!</div>
    </div>`);
  infoWindow?.open(map, marker);
}

// ── 타워 마커 단일 생성 (리스폰에서도 재사용) ────────────────────────────────
function createTowerMarker(tower, map, infoWindow) {
  const st = getTowerHpState(tower);
  const marker = new google.maps.Marker({
    position: { lat: tower.lat, lng: tower.lng }, map,
    title: `${tower.name||'방어탑'} HP ${st.current}/${st.max}`,
    icon: getTowerIcon(tower.image, tower.type), zIndex: 55,
  });
  marker.addListener('click', () => {
    const myMark = _ctx?.myLocationMarker;
    const inRange = myMark
      ? haversine(myMark.getPosition().lat(), myMark.getPosition().lng(), tower.lat, tower.lng) <= (tower.radius || 30) * 3
      : false;
    if (inRange && !_isDead) {
      attackTower(tower, marker);
    } else {
      const hpPct2 = (getTowerHpState(tower).current / getTowerHpState(tower).max) * 100;
      const hpColor2 = hpPct2 > 50 ? '#22c55e' : hpPct2 > 25 ? '#f59e0b' : '#ef4444';
      infoWindow?.setContent(`
        <div style="font-size:13px;line-height:1.7;min-width:190px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏰 ${escHtml(tower.name||'방어탑')}</div>
          <div style="font-size:11px;color:#888;">반경 ${tower.radius||30}m · 데미지 ${tower.atk||50}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
            <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
            <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${hpPct2}%;background:${hpColor2};border-radius:4px;transition:width .3s;"></div>
            </div>
            <span style="font-size:11px;color:#374151;">${getTowerHpState(tower).current}/${getTowerHpState(tower).max}</span>
          </div>
          <div style="font-size:11px;color:#555;margin-top:4px;">공격 범위 안으로 접근 후 클릭하여 공격!</div>
          ${_ctx?.isAdmin ? `<button onclick="window.__deleteBattleObj('tower','${tower.id}')"
            style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">🗑 삭제</button>` : ''}
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
  for (const tower of _towers) {
    if (!tower.lat || !tower.lng) continue;
    // 리스폰 대기 중(파괴됨)이면 마커 생략
    if (_towerRespawn[tower.id]) continue;

    _towerMarkers[tower.id] = createTowerMarker(tower, map, infoWindow);

    const circle = new google.maps.Circle({
      map: _showTowerRange ? map : null,
      center: { lat: tower.lat, lng: tower.lng },
      radius: tower.radius || 30,
      fillColor: '#7c3aed', fillOpacity: 0.08,
      strokeColor: '#7c3aed', strokeOpacity: 0.4, strokeWeight: 1,
    });
    _towerRanges[tower.id] = circle;
  }
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
  checkPlayerAutoAttack();
  checkGoldPickup();
  if (_isDead) {
    if (_reviveWalkDist >= 50) {
      _isDead = false;
      _reviveWalkDist = 0;
      _player.hp = _player.maxHp;
      _player.mp = _player.maxMp;
      _healAccum   = 0;
      _mpHealAccum = 0;
      playSound('revive');
      const myMark = _ctx?.myLocationMarker;
      if (myMark) {
        const pos = myMark.getPosition();
        showFloat('✨ 부활!', '#fbbf24', pos.lat(), pos.lng());
      }
      updateCombatHud();
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
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
    if (_monsterCd[mob.id]) continue;
    if (_frozenUntil[mob.id] && now < _frozenUntil[mob.id]) continue;
    const dist = haversine(myLat, myLng, mob.lat, mob.lng);
    if (dist <= (mob.detectRadius || 20)) {
      // 어그로 클레임: 처음 탐지 시 항상 내가 클레임 (잔존 aggroUid 덮어쓰기)
      if (myUid && !_aggroClaimed.has(mob.id)) {
        _aggroClaimed.add(mob.id);
        _monsterAggro[mob.id] = myUid;
        setDoc(doc(_ctx.db, 'battle_hp', `monster_${mob.id}`),
          { aggroUid: myUid }, { merge: true }).catch(() => {});
      }
      // 내가 어그로 대상이 아니면 공격 무시 (다른 유저가 먼저 클레임한 경우)
      const aggro = _monsterAggro[mob.id];
      if (aggro && aggro !== myUid) continue;

      playSound('monster_atk');
      animateMonsterCharge(mob, myLat, myLng, () => {
        takeDamage(mob.atk || 10, myLat, myLng);
      });
      _monsterCd[mob.id] = true;
      setTimeout(() => { delete _monsterCd[mob.id]; }, 2500);
    }
  }
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
    if (dist <= (tower.radius || 30)) {
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

function checkPlayerAutoAttack() {
  if (_isDead || !_ctx?.myLocationMarker || _attackCd) return;
  if (_currentSpeed < 0.3) return;
  const myPos = _ctx.myLocationMarker.getPosition();
  const myLat = myPos.lat(), myLng = myPos.lng();

  let target = null, minDist = Infinity;
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
    const dist = haversine(myLat, myLng, mob.lat, mob.lng);
    if (dist > 25) continue;
    if (_ctx.lastHeading != null) {
      const bearing = calcBearing(myLat, myLng, mob.lat, mob.lng);
      const diff = Math.abs(((bearing - _ctx.lastHeading) + 540) % 360 - 180);
      if (diff > 60) continue;
    }
    if (dist < minDist) { minDist = dist; target = mob; }
  }

  if (!target) return;
  _attackCd = true;
  setTimeout(() => { _attackCd = false; }, 1500);

  playSound('arrow_shot');
  animateArrow(myLat, myLng, target.lat, target.lng, '#fbbf24', () => {
    playSound('arrow_hit');
    hitMonster(target.id, 5);
  });
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
  if (marker) marker.setTitle(`${mob.name||'몬스터'} HP:${mob.hp}`);

  if (isDead) {
    // 어그로 초기화 (내가 처치)
    delete _monsterAggro[monsterId];
    _aggroClaimed.delete(monsterId);

    playSound('monster_die');
    showFloat('💀 처치!', '#fbbf24', mob.lat, mob.lng);
    gainXp(mob.dropExp || 20);
    dropGoldTokens(mob);

    // 처치자만 아이템 획득 (killedBy === myUid 확인 후 지급)
    if (mob.dropItems?.length && myUid) {
      const drop = mob.dropItems[Math.floor(Math.random() * mob.dropItems.length)];
      if (drop?.itemId) {
        try {
          const invRef = doc(_ctx.db, 'treasure_inventory', `${myUid}_${drop.itemId}`);
          const invSnap = await getDoc(invRef);
          const cur = invSnap.exists() ? (invSnap.data().count || 0) : 0;
          await setDoc(invRef, { uid: myUid, itemId: String(drop.itemId), count: cur + 1,
            updatedAt: serverTimestamp() }, { merge: true });
          showFloat(`📦 ${drop.itemId}`, '#86efac', mob.lat, mob.lng);
        } catch {}
      }
    }

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
  showFloat('🏰 타워 부활!', '#a78bfa', tower.lat, tower.lng);
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
    if (_monsterMarkers[monsterId]) { _monsterMarkers[monsterId].setMap(null); delete _monsterMarkers[monsterId]; }
    delete _monsterAggro[monsterId];
    _aggroClaimed.delete(monsterId);
    _scheduleMonsterRespawn(mob, data.deadAt?.toMillis?.() || Date.now());
  } else if (!data.isDead && data.hp > 0) {
    if (mob.hp <= 0 && !_monsterMarkers[monsterId]) {
      mob.hp = data.hp;
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

// ── 관리자 배치 모드 ──────────────────────────────────────────────────────────
export function enterAdminPlaceMode(type) {
  const map = _ctx?.map;
  _adminPlaceMode = type;
  document.getElementById('btnPlaceMonster')?.classList.toggle('placing', type === 'monster');
  document.getElementById('btnPlaceDragon')?.classList.toggle('placing',  type === 'dragon');
  document.getElementById('btnPlaceArcherTower')?.classList.toggle('placing', type === 'archer_tower');
  document.getElementById('btnPlaceCannonTower')?.classList.toggle('placing', type === 'cannon_tower');
  document.getElementById('btnPlaceDeco')?.classList.toggle('placing', type === 'deco');
  document.getElementById('btnCancelPlace').style.display = '';
  if (map) map.setOptions({ draggableCursor: 'crosshair' });

  _adminMapListener = map.addListener('click', async (e) => {
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    if (_adminPlaceMode === 'monster' || _adminPlaceMode === 'dragon') {
      // ── 게임서버(GS) 스폰 포인트 생성 ────────────────────────────────────────
      const isDragon = _adminPlaceMode === 'dragon';

      // 몬스터 타입 결정 (dragon은 고정, monster는 선택)
      let monsterType = isDragon ? 'dragon' : null;
      if (!monsterType) {
        monsterType = prompt('몬스터 타입 (goblin / orc / dragon):', 'goblin') || 'goblin';
      }

      // 타입별 기본값 프리셋
      // maxHp = 레벨 × 100 × 30 → 30히트로 처치 (데미지 = 레벨 × 100)
      const lv = _ctx?.playerLevel ?? 1;
      const PRESETS = {
        dragon: { maxHp: lv * 100 * 30, attackPower:150, aggroRangeM:300, attackRangeM:100, moveSpeed:0.8, attackCooldownMs:1800, respawnSeconds:120 },
        orc:    { maxHp: lv * 100 * 15, attackPower:200, aggroRangeM:200, attackRangeM:25,  moveSpeed:0.8, attackCooldownMs:3000, respawnSeconds:600  },
        goblin: { maxHp: lv * 100 *  8, attackPower:80,  aggroRangeM:100, attackRangeM:20,  moveSpeed:1.2, attackCooldownMs:2000, respawnSeconds:300  },
      };
      const p = PRESETS[monsterType] || PRESETS.goblin;

      const maxHp          = parseInt(prompt(`최대 HP:`,          p.maxHp)          || p.maxHp);
      const attackPower    = parseInt(prompt(`공격력:`,            p.attackPower)    || p.attackPower);
      const aggroRangeM    = parseInt(prompt(`탐지 반경(m):`,      p.aggroRangeM)    || p.aggroRangeM);
      const respawnSeconds = parseInt(prompt(`리스폰 시간(초):`,    p.respawnSeconds) || p.respawnSeconds);

      try {
        const result = await gsAdminAddSpawn({
          monsterType, lat, lng, maxHp,
          attackPower,
          aggroRangeM,
          attackRangeM:      p.attackRangeM,
          moveSpeed:         p.moveSpeed,
          attackCooldownMs:  p.attackCooldownMs,
          respawnSeconds,
          maxCount: 1,
        });
        alert(`✅ ${monsterType} 배치 완료 (zone: ${result.zoneId})\n몬스터가 즉시 스폰됩니다.`);
        await refreshGsSpawnList();
      } catch (err) { alert('GS 배치 오류: ' + err.message); }

    } else if (_adminPlaceMode === 'archer_tower' || _adminPlaceMode === 'cannon_tower') {
      const towerType = _adminPlaceMode === 'cannon_tower' ? 'cannon' : 'archer';
      const defName   = towerType === 'cannon' ? '대포 타워' : '아처 타워';
      const defAtk    = towerType === 'cannon' ? '80' : '20';
      const defRadius = towerType === 'cannon' ? '20' : '30';
      const defEmoji  = towerType === 'cannon' ? '💣' : '🏹';
      const name   = prompt('타워 이름:', defName) || defName;
      const atk    = parseInt(prompt('데미지:', defAtk) || defAtk);
      const radius = parseInt(prompt('공격 반경(m):', defRadius) || defRadius);
      const image  = prompt('이미지 (이모지 or 경로, 예: /assets/images/shops/arms.png)', defEmoji) || defEmoji;
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
      const imageUrl = prompt('이미지 경로 (예: /assets/images/monsters/10.png):', '') || '';
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

// ── 내 위치 마커 아이콘 생성 (방향 화살표 포함) ──────────────────────────────
function makeLocationIcon(heading) {
  const hasHeading = heading != null && !isNaN(heading) && isFinite(heading);
  const arrow = hasHeading
    ? `<polygon points="22,3 15,16 22,12 29,16" fill="#ff6b00" stroke="white" stroke-width="1.5" transform="rotate(${Math.round(heading)},22,22)"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="22" fill="none" stroke="#ff6b00" stroke-width="2" stroke-opacity="0.5"/>
    <circle cx="24" cy="24" r="16" fill="#ff3300" fill-opacity="0.92" stroke="#ffcc00" stroke-width="3"/>
    ${arrow}
    <text x="24" y="29" font-size="12" font-weight="900" fill="white" text-anchor="middle" font-family="sans-serif">나</text>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(48, 48),
    anchor: new google.maps.Point(24, 24),
  };
}

// ── 내 위치 마커 업데이트 (실시간 GPS → ctx에 기록) ──────────────────────────
export function updateMyLocation(lat, lng, accuracy, heading) {
  const map = _ctx?.map;
  const latLng = { lat, lng };
  const icon = makeLocationIcon(heading);
  if (_ctx.myLocationMarker) {
    _ctx.myLocationMarker.setPosition(latLng);
    _ctx.myLocationMarker.setIcon(icon);
  } else {
    _ctx.myLocationMarker = new google.maps.Marker({
      position: latLng, map, title: '내 위치', icon, zIndex: 100,
    });
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
  updateCombatHud();
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
      _ctx._onCheckProximity(lat, lng);
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
  playSound('player_die');
  const myMark = _ctx?.myLocationMarker;
  const pos    = myMark?.getPosition();
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
  playSound('revive');
  const myMark = _ctx?.myLocationMarker;
  const pos    = myMark?.getPosition();
  if (pos) showFloat('✨ 부활!', '#fbbf24', pos.lat(), pos.lng());
  updateCombatHud();
  savePlayerState();
}
