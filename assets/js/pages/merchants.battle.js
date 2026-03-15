// /assets/js/pages/merchants.battle.js
// 위치 기반 전투 시스템 (merchants.js에서 분리)
// ctx 객체를 통해 core와 공유 상태를 교환한다.

import { collection, getDocs, doc, getDoc, query, where,
         addDoc, deleteDoc, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ── 공유 컨텍스트 참조 ─────────────────────────────────────────────────────────
// initBattle(ctx, callbacks) 호출 후 설정됨
let _ctx = null;

// ── 내부 배틀 상태 ────────────────────────────────────────────────────────────
let _player       = { level:1, hp:1000, mp:1000, maxHp:1000, maxMp:1000, xp:0, gold:0 };
let _monsters     = [];        // [{id, name, lat, lng, hp, maxHp, atk, detectRadius, image, active}]
let _towers       = [];        // [{id, name, lat, lng, atk, radius, active}]
let _monsterMarkers  = {};     // { id: Marker }
let _towerMarkers    = {};     // { id: Marker }
let _towerRanges     = {};     // { id: Circle }
let _showTowerRange  = false;
let _battleLoopId    = null;
let _attackCd        = false;  // 유저 공격 쿨다운 (1.5초)
let _clickAtkCd      = {};     // { monsterId: bool }
let _towerCd         = {};     // { towerId: bool }
let _monsterCd       = {};     // { monsterId: bool }
let _healAccum       = 0;      // HP 회복용 누적거리(m)
let _reviveWalkDist  = 0;      // 사망 후 부활용 누적거리(m)
let _currentSpeed    = 0;      // km/h
let _isDead          = false;
let _goldDrops       = [];     // [{id, lat, lng, amount, marker}]
let _adminPlaceMode  = null;   // 'monster' | 'tower' | 'deco' | null
let _adminMapListener = null;
let _decoMarkers     = [];

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
}

// ── 사운드 시스템 (Web Audio API) ────────────────────────────────────────────
let _audioCtx = null;
function getAC() {
  if (!_audioCtx || _audioCtx.state === 'closed')
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
    title: `💰 황금토큰 ×${amount}`,
    icon: { url: '/assets/images/item/0.png',
            scaledSize: new google.maps.Size(22, 22),
            anchor: new google.maps.Point(11, 11) },
    zIndex: 25,
  });
  const drop = { id, lat, lng, amount, marker };
  _goldDrops.push(drop);
  showFloat(`💰×${amount}`, '#fbbf24', lat, lng);
  playSound('gold_drop');
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

// ── 전투 HUD 업데이트 ─────────────────────────────────────────────────────────
function updateCombatHud() {
  const p = _player;
  const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  const mpPct = Math.max(0, Math.min(100, (p.mp / p.maxMp) * 100));

  const hpBar = document.getElementById('cHpBar');
  const mpBar = document.getElementById('cMpBar');
  if (hpBar) { hpBar.style.width = hpPct + '%'; hpBar.classList.toggle('low', hpPct < 25); }
  if (mpBar)  mpBar.style.width = mpPct + '%';

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
    const [mSnap, tSnap] = await Promise.all([
      getDocs(query(collection(_ctx.db, 'battle_monsters'), where('active', '==', true))),
      getDocs(query(collection(_ctx.db, 'battle_towers'),   where('active', '==', true))),
    ]);
    _monsters = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _towers   = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (window.google?.maps) {
      renderMonsterMarkers();
      renderTowerMarkers();
    }
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

function renderMonsterMarkers() {
  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;
  Object.values(_monsterMarkers).forEach(m => m.setMap(null));
  _monsterMarkers = {};
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng) continue;
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
        if (dist <= (mob.detectRadius || 20)) {
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
}

function renderTowerMarkers() {
  const map = _ctx?.map;
  const infoWindow = _ctx?.infoWindow;
  Object.values(_towerMarkers).forEach(m => m.setMap(null));
  Object.values(_towerRanges).forEach(c => c.setMap(null));
  _towerMarkers = {}; _towerRanges = {};
  for (const tower of _towers) {
    if (!tower.lat || !tower.lng) continue;
    const marker = new google.maps.Marker({
      position: { lat: tower.lat, lng: tower.lng }, map,
      title: tower.name || '방어탑',
      icon: getTowerIcon(tower.image, tower.type), zIndex: 55,
    });
    marker.addListener('click', () => {
      infoWindow?.setContent(`
        <div style="font-size:13px">
          <b>🏰 ${escHtml(tower.name||'방어탑')}</b>
          <div style="font-size:11px;color:#888;margin-top:4px">반경 ${tower.radius||30}m · 데미지 ${tower.atk||50}</div>
          ${_ctx?.isAdmin ? `<button onclick="window.__deleteBattleObj('tower','${tower.id}')"
            style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">🗑 삭제</button>` : ''}
        </div>`);
      infoWindow?.open(map, marker);
    });
    _towerMarkers[tower.id] = marker;

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
      _player.hp = Math.round(_player.maxHp * 0.3);
      _player.mp = Math.round(_player.maxMp * 0.2);
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
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
    if (_monsterCd[mob.id]) continue;
    const dist = haversine(myLat, myLng, mob.lat, mob.lng);
    if (dist <= (mob.detectRadius || 20)) {
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

async function hitMonster(monsterId, damage) {
  const mob = _monsters.find(m => m.id === monsterId);
  if (!mob || mob.hp <= 0) return;
  mob.hp = Math.max(0, mob.hp - damage);

  try {
    await setDoc(doc(_ctx.db, 'battle_monsters', monsterId), { hp: mob.hp }, { merge: true });
  } catch { /* 무시 */ }

  const marker = _monsterMarkers[monsterId];
  if (marker) marker.setTitle(`${mob.name||'몬스터'} HP:${mob.hp}`);

  if (mob.hp <= 0) {
    const map = _ctx?.map;
    playSound('monster_die');
    showFloat('💀 처치!', '#fbbf24', mob.lat, mob.lng);
    gainXp(mob.dropExp || 20);
    dropGoldTokens(mob);

    if (mob.dropItems?.length && _ctx?.uid) {
      const drop = mob.dropItems[Math.floor(Math.random() * mob.dropItems.length)];
      if (drop?.itemId) {
        try {
          const invRef = doc(_ctx.db, 'treasure_inventory', `${_ctx.uid}_${drop.itemId}`);
          const invSnap = await getDoc(invRef);
          const cur = invSnap.exists() ? (invSnap.data().count || 0) : 0;
          await setDoc(invRef, { uid: _ctx.uid, itemId: String(drop.itemId), count: cur + 1,
            updatedAt: serverTimestamp() }, { merge: true });
          showFloat(`📦 ${drop.itemId}`, '#86efac', mob.lat, mob.lng);
        } catch { /* 무시 */ }
      }
    }

    const respawnMs = (mob.respawnMinutes || 1) * 60000;
    if (_monsterMarkers[monsterId]) {
      _monsterMarkers[monsterId].setMap(null);
      delete _monsterMarkers[monsterId];
    }
    setTimeout(async () => {
      try {
        await setDoc(doc(_ctx.db, 'battle_monsters', monsterId),
          { hp: mob.maxHp, active: true }, { merge: true });
        mob.hp = mob.maxHp;
        if (window.google?.maps && map) {
          const m = new google.maps.Marker({
            position: { lat: mob.lat, lng: mob.lng }, map,
            title: mob.name, icon: getMonsterIcon(mob.image), zIndex: 50,
          });
          _monsterMarkers[monsterId] = m;
        }
      } catch { /* 무시 */ }
    }, respawnMs);
  }
}

// ── 관리자 배치 모드 ──────────────────────────────────────────────────────────
export function enterAdminPlaceMode(type) {
  const map = _ctx?.map;
  _adminPlaceMode = type;
  document.getElementById('btnPlaceMonster')?.classList.toggle('placing', type === 'monster');
  document.getElementById('btnPlaceArcherTower')?.classList.toggle('placing', type === 'archer_tower');
  document.getElementById('btnPlaceCannonTower')?.classList.toggle('placing', type === 'cannon_tower');
  document.getElementById('btnPlaceDeco')?.classList.toggle('placing', type === 'deco');
  document.getElementById('btnCancelPlace').style.display = '';
  if (map) map.setOptions({ draggableCursor: 'crosshair' });

  _adminMapListener = map.addListener('click', async (e) => {
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    if (_adminPlaceMode === 'monster') {
      const name   = prompt('몬스터 이름:', '슬라임') || '슬라임';
      const maxHp  = parseInt(prompt('최대 HP:', '30') || '30');
      const atk    = parseInt(prompt('공격력:', '5') || '5');
      const radius = parseInt(prompt('탐지 반경(m):', '20') || '20');
      const image  = prompt('이미지 (이모지 or 경로, 예: /assets/images/monsters/10.png)', '🐉') || '🐉';
      try {
        const ref = await addDoc(collection(_ctx.db, 'battle_monsters'), {
          name, lat, lng, hp: maxHp, maxHp, atk,
          detectRadius: radius, image, active: true,
          dropExp: 20, respawnMinutes: 1,
          createdAt: serverTimestamp(),
        });
        _monsters.push({ id: ref.id, name, lat, lng, hp: maxHp, maxHp, atk,
          detectRadius: radius, image, active: true, dropExp: 20, respawnMinutes: 1 });
        renderMonsterMarkers();
        alert(`✅ 몬스터 "${name}" 배치 완료`);
      } catch (err) { alert('오류: ' + err.message); }

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
          name, lat, lng, atk, radius, image, type: towerType, active: true,
          createdAt: serverTimestamp(),
        });
        _towers.push({ id: ref.id, name, lat, lng, atk, radius, image, type: towerType, active: true });
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
  document.getElementById('btnCancelPlace').style.display = 'none';
}

window.__deleteBattleObj = async (type, id) => {
  if (!confirm('삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(_ctx.db, type === 'monster' ? 'battle_monsters' : 'battle_towers', id));
    if (type === 'monster') {
      _monsters = _monsters.filter(m => m.id !== id);
      if (_monsterMarkers[id]) { _monsterMarkers[id].setMap(null); delete _monsterMarkers[id]; }
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
    ? `<polygon points="20,3 14,17 20,13 26,17" fill="#1a73e8" stroke="white" stroke-width="1.5" transform="rotate(${Math.round(heading)},20,20)"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="13" fill="#4285F4" fill-opacity="0.18"/>
    ${arrow}
    <circle cx="20" cy="20" r="8" fill="#4285F4" stroke="white" stroke-width="2.5"/>
    <circle cx="20" cy="20" r="3" fill="white"/>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 20),
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
      fillColor: '#4285F4', fillOpacity: 0.08,
      strokeColor: '#4285F4', strokeOpacity: 0.3, strokeWeight: 1,
    });
  }

  if (heading != null && !isNaN(heading)) _ctx.lastHeading = heading;

  if (accuracy && accuracy > 30) {
    _ctx.lastDistPos  = { lat, lng };
    _ctx.lastSpeedPos = { lat, lng, time: Date.now() };
    updateCombatHud();
    return;
  }

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
          _healAccum += d;
          while (_healAccum >= 10) {
            _healAccum -= 10;
            healHp(10);
          }
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
      if (_ctx.myLocationMarker) updateMyLocation(lat, lng, accuracy, heading);
      _ctx._onCheckProximity(lat, lng);
    },
    null,
    { enableHighAccuracy: true, maximumAge: 3000 }
  );
  _ctx.locationWatchId = watchId;
}
