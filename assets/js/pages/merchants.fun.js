// merchants.fun.js — 지도 사냥 재미 요소: 연속 처치 콤보 · 사냥 열기 이벤트 · 소모 아이템 · 이펙트
// GP 지급 금액·서버 로직은 건드리지 않는다 (처치 보상은 기존 그대로). 클라이언트 연출·아이템만 담당.
// battle.js 가 initFun(deps)로 의존성을 넘기고, 처치/피해/드랍 지점에서 아래 훅을 부른다.

const COMBO_WINDOW_MS = 7000;           // 이 시간 안에 다음 처치가 이어지면 콤보 유지
const ITEM_EVERY = 5;                   // 처치 N마리마다 아이템 1개
const ITEM_MAX_TOTAL = 3;
const BOOST_MS = 30000;                 // 부스터: 콤보 유지 시간·아이템 진행 ×2
const FRENZY_MS = 45000;                // 사냥 열기: 처치 점수 ×2, 마정석 드랍 확률 UP
const FRENZY_FIRST = [4, 8];            // 첫 이벤트까지 분
const FRENZY_GAP = [9, 15];             // 이후 이벤트 간격 분
const BOMB_RANGE_M = 80;                // 폭탄 범위(m)
const BOMB_ATK_MULT = 3;                // 폭탄 피해 = 공격력 × 3
const POUCH_STONES = 3;                 // 마석 주머니: 마정석 +3

const ITEM_DEFS = {
  bomb:   { icon: '💣', name: '폭탄' },
  boost:  { icon: '⚡', name: '부스터' },
  pouch:  { icon: '🔮', name: '마석 주머니' },
};

let _d = null;                          // 의존성
let _combo = 0, _lastKillAt = 0, _comboTimer = null;
let _progress = 0;                      // 아이템까지 쌓인 처치 점수
let _items = { bomb: 0, boost: 0, pouch: 0 };
const _gsTouched = new Map();           // 서버 몬스터: 내가 최근에 공격한 시각 (처치 귀속 판단용)
let _boostUntil = 0, _frenzyUntil = 0, _frenzyTimer = null, _tick = null;
let _ui = null, _fx = null, _fxc = null, _parts = [], _raf = 0, _last = 0;

const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
const total = () => _items.bomb + _items.boost + _items.pouch;
const frenzyOn = () => Date.now() < _frenzyUntil;
const boostOn = () => Date.now() < _boostUntil;

// ── 외부 훅 ────────────────────────────────────────────────────────────
export function funStoneChance() { return frenzyOn() ? 0.6 : 0.3; }   // 클라이언트 몬스터 마정석 드랍 확률

export function funOnKill(mob) {
  if (!_ui) return;
  const now = Date.now();
  const win = COMBO_WINDOW_MS * (frenzyOn() ? 1.5 : 1) * (boostOn() ? 2 : 1);
  _combo = (now - _lastKillAt <= win) ? _combo + 1 : 1;
  _lastKillAt = now;
  clearTimeout(_comboTimer);
  _comboTimer = setTimeout(() => { _combo = 0; renderBadges(); }, win);

  if (_combo >= 3) {
    _d.showFloat?.(`🔥 COMBO x${_combo}`, '#c4b5fd', mob.lat, mob.lng);
    flash(_combo >= 10 ? 'rgba(168,85,247,.35)' : 'rgba(168,85,247,.18)');
  }
  if (_combo > 0 && _combo % 10 === 0) { confetti(70); grantItem(`콤보 ${_combo}`); }

  _progress += (frenzyOn() ? 2 : 1) * (boostOn() ? 2 : 1);
  while (_progress >= ITEM_EVERY) { _progress -= ITEM_EVERY; grantItem('처치 보상'); }
  renderBadges();
}

// ── 초기화 ─────────────────────────────────────────────────────────────
export function initFun(deps) {
  if (_ui) return;
  _d = deps;
  buildUi();
  // 서버 몬스터(게임 서버)는 처치자가 이벤트에 안 실려 와서, 내가 방금 공격한 몬스터가 죽으면 내 처치로 센다
  window.__funTouchGs = id => { if (id != null) _gsTouched.set(String(id), Date.now()); };
  window.__funGsKilled = (id, mob) => {
    const t = _gsTouched.get(String(id)); _gsTouched.delete(String(id));
    if (t && Date.now() - t < 4000 && mob) funOnKill({ lat: mob.currentLat ?? mob.lat, lng: mob.currentLng ?? mob.lng });
  };
  scheduleFrenzy(FRENZY_FIRST);
  _tick = setInterval(renderBadges, 500);
}

// ── 아이템 ─────────────────────────────────────────────────────────────
function grantItem(reason) {
  if (total() >= ITEM_MAX_TOTAL) return;
  const ks = Object.keys(ITEM_DEFS), k = ks[Math.floor(Math.random() * ks.length)];
  _items[k]++;
  _d.playSound?.('gold_pickup');
  toast(`🎁 ${ITEM_DEFS[k].icon} ${ITEM_DEFS[k].name} 획득! (${reason})`);
  renderItems();
}

function useItem(k) {
  if (_items[k] <= 0 || _d.isDead?.()) return;
  if (k === 'bomb') {
    const me = _d.getMyPos?.();
    if (!me) { toast('위치를 확인하는 중입니다'); return; }
    const near = (lat, lng) => lat && lng && _d.haversine(me.lat, me.lng, lat, lng) <= BOMB_RANGE_M;
    const local = (_d.getMonsters?.() || []).filter(m => m.hp > 0 && near(m.lat, m.lng));
    const gs = Object.entries(_d.getGsMonsters?.() || {}).filter(([, m]) => (m.hp ?? 1) > 0 && near(m.currentLat ?? m.lat, m.currentLng ?? m.lng));
    if (!local.length && !gs.length) { toast('💣 범위 안에 몬스터가 없어요'); return; }
    _items.bomb--;
    const dmg = Math.round((_d.getTotalAtk?.() || 100) * BOMB_ATK_MULT);
    local.forEach((m, i) => setTimeout(() => {
      _d.showFloat?.('💥', '#fb923c', m.lat, m.lng);
      _d.hitMonster?.(m.id, dmg, m);
    }, i * 90));
    gs.forEach(([id, m], i) => setTimeout(() => {      // 서버 몬스터는 서버 규칙대로 1타씩
      _d.showFloat?.('💥', '#fb923c', m.currentLat ?? m.lat, m.currentLng ?? m.lng);
      _d.attackGs?.(id);
    }, i * 90));
    flash('rgba(251,146,60,.4)'); confetti(40, ['#fb923c', '#fde047', '#ef4444']);
    toast(`💣 폭탄! ${local.length + gs.length}마리 타격`);
  } else if (k === 'boost') {
    _items.boost--;
    _boostUntil = Date.now() + BOOST_MS;
    flash('rgba(250,204,21,.3)'); toast('⚡ 부스터 ON — 30초간 콤보 유지 시간·아이템 진행 2배');
  } else if (k === 'pouch') {
    _items.pouch--;
    _d.addTokens?.(POUCH_STONES);
    _d.playSound?.('gold_pickup');
    flash('rgba(96,165,250,.3)'); toast(`🔮 마정석 +${POUCH_STONES}`);
  }
  renderItems(); renderBadges();
}

// ── 사냥 열기 이벤트 ───────────────────────────────────────────────────
function scheduleFrenzy(rangeMin) {
  clearTimeout(_frenzyTimer);
  _frenzyTimer = setTimeout(startFrenzy, rndInt(rangeMin) * 60000);
}
function startFrenzy() {
  _frenzyUntil = Date.now() + FRENZY_MS;
  flash('rgba(239,68,68,.35)'); confetti(110);
  _d.playSound?.('levelup');
  toast('🔥 사냥 열기 시작! 45초간 처치 점수 ×2 · 마정석 드랍 UP', 3200);
  setTimeout(() => { toast('사냥 열기 종료'); renderBadges(); }, FRENZY_MS + 200);
  scheduleFrenzy(FRENZY_GAP);
  renderBadges();
}

// ── UI ─────────────────────────────────────────────────────────────────
const CSS = `
#funBar{position:fixed;left:8px;bottom:calc(86px + env(safe-area-inset-bottom,0px));z-index:1500;display:flex;gap:8px;pointer-events:auto}
.fun-it{position:relative;width:46px;height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(10,10,20,.8);
  backdrop-filter:blur(6px);color:#fff;font-size:21px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.fun-it:disabled{opacity:.35;cursor:not-allowed}
.fun-it .c{position:absolute;top:-6px;right:-6px;background:#f59e0b;color:#000;border-radius:999px;min-width:17px;height:17px;font-size:11px;font-weight:900;
  display:flex;align-items:center;justify-content:center}
#funBadges{position:fixed;left:8px;bottom:calc(140px + env(safe-area-inset-bottom,0px));z-index:1500;display:flex;flex-direction:column;gap:5px;pointer-events:none}
.fun-b{font:800 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;padding:5px 10px;border-radius:999px;width:fit-content;display:none}
.fun-b.on{display:block}
#funCombo{background:rgba(124,58,237,.9)}#funFrenzy{background:rgba(220,38,38,.92)}#funBoost{background:rgba(202,138,4,.92)}
#funFx{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1600}
#funFlash{position:fixed;inset:0;pointer-events:none;z-index:1590;opacity:0;transition:opacity .45s}
#funToast{position:fixed;left:50%;top:calc(68px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:1700;pointer-events:none;
  background:rgba(10,10,20,.88);border:1px solid rgba(251,191,36,.5);color:#fde68a;font:800 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  padding:9px 16px;border-radius:12px;max-width:86vw;text-align:center;opacity:0;transition:opacity .25s}
#funToast.on{opacity:1}
`;

function buildUi() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const bar = document.createElement('div'); bar.id = 'funBar';
  for (const k of Object.keys(ITEM_DEFS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fun-it'; b.dataset.k = k;
    b.title = ITEM_DEFS[k].name; b.innerHTML = `${ITEM_DEFS[k].icon}<span class="c">0</span>`;
    b.addEventListener('click', () => useItem(k)); bar.appendChild(b);
  }
  const badges = document.createElement('div'); badges.id = 'funBadges';
  badges.innerHTML = '<div class="fun-b" id="funCombo"></div><div class="fun-b" id="funFrenzy"></div><div class="fun-b" id="funBoost"></div>';
  const fx = document.createElement('canvas'); fx.id = 'funFx';
  const fl = document.createElement('div'); fl.id = 'funFlash';
  const tt = document.createElement('div'); tt.id = 'funToast';
  document.body.append(bar, badges, fx, fl, tt);
  _fx = fx; _fxc = fx.getContext('2d');
  const size = () => { const r = window.devicePixelRatio || 1; fx.width = innerWidth * r; fx.height = innerHeight * r; _fxc.setTransform(r, 0, 0, r, 0, 0); };
  window.addEventListener('resize', size); size();
  _ui = { bar, badges, fl, tt };
  renderItems(); renderBadges();
}

function renderItems() {
  _ui.bar.querySelectorAll('.fun-it').forEach(b => {
    const n = _items[b.dataset.k]; b.querySelector('.c').textContent = n; b.disabled = n <= 0;
  });
}
function renderBadges() {
  if (!_ui) return;
  const c = document.getElementById('funCombo'), f = document.getElementById('funFrenzy'), bo = document.getElementById('funBoost');
  if (_combo >= 2) { c.textContent = `🔥 콤보 x${_combo}`; c.classList.add('on'); } else c.classList.remove('on');
  if (frenzyOn()) { f.textContent = `🔥 사냥 열기 ${Math.ceil((_frenzyUntil - Date.now()) / 1000)}s`; f.classList.add('on'); } else f.classList.remove('on');
  if (boostOn()) { bo.textContent = `⚡ 부스터 ${Math.ceil((_boostUntil - Date.now()) / 1000)}s`; bo.classList.add('on'); } else bo.classList.remove('on');
}

let _toastT = null;
function toast(msg, ms = 2000) {
  const t = _ui.tt; t.textContent = msg; t.classList.add('on');
  clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('on'), ms);
}
function flash(color) {
  const f = _ui.fl; f.style.transition = 'none'; f.style.background = `radial-gradient(circle at center,transparent 35%,${color} 100%)`; f.style.opacity = '1';
  void f.offsetWidth; f.style.transition = 'opacity .5s'; f.style.opacity = '0';
}

// ── 파티클 ─────────────────────────────────────────────────────────────
function confetti(n, cols = ['#f59e0b', '#ef4444', '#38bdf8', '#4ade80', '#a78bfa', '#f472b6', '#fde047']) {
  for (let i = 0; i < n && _parts.length < 300; i++) {
    _parts.push({ x: rnd(0, innerWidth), y: rnd(-30, 20), vx: rnd(-70, 70), vy: rnd(80, 260), g: 170, s: rnd(3, 6),
      life: rnd(1000, 1800), max: 1800, c: cols[i % cols.length], rot: rnd(0, 6), vr: rnd(-8, 8) });
  }
  if (!_raf) _raf = requestAnimationFrame(loop);
}
function loop(ts) {
  const dt = Math.min(40, ts - (_last || ts)); _last = ts;
  _fxc.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of _parts) {
    p.life -= dt; p.vy += p.g * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.rot += p.vr * dt / 1000;
    _fxc.globalAlpha = Math.max(0, Math.min(1, p.life / 600)); _fxc.fillStyle = p.c;
    _fxc.save(); _fxc.translate(p.x, p.y); _fxc.rotate(p.rot); _fxc.fillRect(-p.s, -p.s / 2, p.s * 2, p.s); _fxc.restore();
  }
  _fxc.globalAlpha = 1;
  _parts = _parts.filter(p => p.life > 0);
  if (_parts.length) _raf = requestAnimationFrame(loop); else { _raf = 0; _last = 0; }
}
