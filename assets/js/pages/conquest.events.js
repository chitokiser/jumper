// conquest.events.js — 정복 게임 이벤트(보급 상자) · 소모 아이템(폭격/철벽/전군 강화) · 화면 이펙트
// 모두 인게임 자원(전장 GP·아이템)만 다룬다. 서버 GP 지급·기존 보상 로직은 건드리지 않는다.
// conquest.js 가 initCqEvents(deps)로 의존성을 넘기고, 아래 훅을 호출한다.

const ITEM_MAX_TOTAL = 3;
const CRATE_LIFE_MS = 15000;
const CRATE_CHANCE = 0.45;           // 웨이브 클리어 시 보급 상자 낙하 확률
const ITEM_CHANCE = 0.35;            // 웨이브 클리어 시 아이템 지급 확률 (보스 처치는 항상 지급)
const STRIKE_FRAC = 0.35;            // 폭격: 일반 몬스터 최대 체력의 35% (최소 STRIKE_MIN)
const STRIKE_MIN = 200;
const WALL_HEAL_FRAC = 0.4, CASTLE_HEAL_FRAC = 0.15;   // 철벽
const RALLY_MULT = 1.5, RALLY_MS = 25000;               // 전군 강화

const ITEM_DEFS = {
  strike: { icon: '🔥', name: '폭격',     tip: '모든 몬스터에게 큰 피해' },
  wall:   { icon: '🛡️', name: '철벽',     tip: '성벽·성 체력 회복' },
  rally:  { icon: '⚔️', name: '전군 강화', tip: '25초간 공격력 ×1.5' },
};

let _d = null, _ui = null;
let _items = { strike: 0, wall: 0, rally: 0 };
let _crate = null;                    // { x, y, until }
let _rallyUntil = 0, _epoch = 0, _rallyTimer = null;
const rnd = (a, b) => a + Math.random() * (b - a);
const total = () => _items.strike + _items.wall + _items.rally;

const CSS = `
#cqItems{position:fixed;right:8px;top:calc(132px + env(safe-area-inset-top,0px));z-index:70;display:flex;flex-direction:column;gap:8px}
#cqItems.hidden{display:none}
.cq-it{position:relative;width:46px;height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(10,10,20,.82);
  color:#fff;font-size:21px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;backdrop-filter:blur(6px)}
.cq-it:disabled{opacity:.35;cursor:not-allowed}
.cq-it .c{position:absolute;top:-6px;right:-6px;background:#f59e0b;color:#000;border-radius:999px;min-width:17px;height:17px;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center}
#cqBuff{position:fixed;right:8px;top:calc(132px + 3*54px + env(safe-area-inset-top,0px));z-index:70;font:800 11px/1 -apple-system,sans-serif;color:#fff;
  background:rgba(202,138,4,.92);padding:5px 9px;border-radius:999px;display:none}
#cqCrate{position:fixed;z-index:65;width:54px;height:54px;margin:-27px 0 0 -27px;border:0;background:none;font-size:42px;cursor:pointer;display:none;
  filter:drop-shadow(0 0 10px rgba(253,224,71,.9));animation:cqBob 1s ease-in-out infinite;padding:0}
#cqCrate small{position:absolute;left:50%;top:-14px;transform:translateX(-50%);font:800 10px/1 sans-serif;color:#fde047;background:rgba(0,0,0,.7);padding:2px 6px;border-radius:8px;white-space:nowrap}
@keyframes cqBob{50%{transform:translateY(-6px) scale(1.08)}}
#cqFlash{position:fixed;inset:0;pointer-events:none;z-index:66;opacity:0}
`;

export function initCqEvents(deps) {
  if (_ui) return;
  _d = deps;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const bar = document.createElement('div'); bar.id = 'cqItems'; bar.className = 'hidden';
  for (const k of Object.keys(ITEM_DEFS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cq-it'; b.dataset.k = k;
    b.title = `${ITEM_DEFS[k].name} — ${ITEM_DEFS[k].tip}`; b.innerHTML = `${ITEM_DEFS[k].icon}<span class="c">0</span>`;
    b.addEventListener('click', () => useItem(k)); bar.appendChild(b);
  }
  const buff = document.createElement('div'); buff.id = 'cqBuff';
  const crate = document.createElement('button'); crate.id = 'cqCrate'; crate.type = 'button'; crate.innerHTML = '📦<small>보급 상자</small>';
  crate.addEventListener('click', openCrate);
  const fl = document.createElement('div'); fl.id = 'cqFlash';
  document.body.append(bar, buff, crate, fl);
  _ui = { bar, buff, crate, fl };
  render();
}

// ── 훅 ─────────────────────────────────────────────────────────────────
export function cqReset() {
  _items = { strike: 0, wall: 0, rally: 0 }; _crate = null; _rallyUntil = 0; _epoch++; clearTimeout(_rallyTimer);
  if (_ui) { _ui.crate.style.display = 'none'; }
  render();
}
export function cqSetVisible(v) { if (!_ui) return; _ui.bar.classList.toggle('hidden', !v); if (!v) { _ui.crate.style.display = 'none'; _ui.buff.style.display = 'none'; } }
export function cqBossDown() { grantItem('보스 처치'); flash('rgba(250,204,21,.4)'); }
export function cqWaveCleared() {
  if (Math.random() < ITEM_CHANCE) grantItem('웨이브 클리어');
  if (Math.random() < CRATE_CHANCE) dropCrate();
}
export function cqFrame() {          // 매 프레임: 상자 위치 갱신·만료, 강화 표시
  if (!_ui) return;
  const now = Date.now();
  if (_crate) {
    if (now >= _crate.until) { _crate = null; _ui.crate.style.display = 'none'; _d.notify('📦 보급 상자가 사라졌어요'); }
    else {
      const p = _d.worldToScreen(_crate.x, _crate.y), r = _d.canvas.getBoundingClientRect(), k = r.width / _d.canvas.width;
      const sx = r.left + p[0] * k, sy = r.top + p[1] * k;
      const vis = sx > 0 && sx < innerWidth && sy > 60 && sy < innerHeight - 60;
      _ui.crate.style.display = vis ? 'block' : 'none'; _ui.crate.style.left = sx + 'px'; _ui.crate.style.top = sy + 'px';
    }
  }
  if (now < _rallyUntil) { _ui.buff.style.display = 'block'; _ui.buff.textContent = `⚔️ 전군 강화 ${Math.ceil((_rallyUntil - now) / 1000)}s`; }
  else _ui.buff.style.display = 'none';
}

// ── 이벤트: 보급 상자 ───────────────────────────────────────────────────
function dropCrate() {
  const a = rnd(0, Math.PI * 2), r = rnd(120, 520);
  _crate = { x: _d.castle.x + Math.cos(a) * r, y: _d.castle.y + Math.sin(a) * r, until: Date.now() + CRATE_LIFE_MS };
  _d.banner('📦 보급 상자 낙하!');
  _d.notify('📦 성 안에 보급 상자가 떨어졌어요 — 눌러서 획득! (15초)');
  _d.sound('levelup');
}
function openCrate() {
  if (!_crate) return;
  const c = _crate; _crate = null; _ui.crate.style.display = 'none';
  _d.burst(c.x, c.y);
  if (Math.random() < 0.6 || total() >= ITEM_MAX_TOTAL) {
    const gp = Math.round(rnd(150, 350) / 10) * 10;
    _d.addGP(gp); _d.coins(c.x, c.y, 6); _d.notify(`📦 보급 상자! +${gp} GP`);
  } else grantItem('보급 상자');
  _d.sound('coin'); flash('rgba(253,224,71,.3)');
}

// ── 아이템 ─────────────────────────────────────────────────────────────
function grantItem(reason) {
  if (total() >= ITEM_MAX_TOTAL) return;
  const ks = Object.keys(ITEM_DEFS), k = ks[Math.floor(Math.random() * ks.length)];
  _items[k]++; render(); _d.sound('levelup');
  _d.notify(`🎁 ${ITEM_DEFS[k].icon} ${ITEM_DEFS[k].name} 획득! (${reason})`);
}
function useItem(k) {
  if (_items[k] <= 0 || !_d.inGame()) return;
  if (k === 'strike') {
    const mons = _d.getMonsters().filter(m => !m.dying && m.hp > 0);
    if (!mons.length) { _d.notify('🔥 공격할 몬스터가 없어요'); return; }
    _items.strike--;
    let n = 0;
    for (const m of mons) {
      if (m.boss) m.hp -= Math.max(STRIKE_MIN, m.maxHp * 0.08);       // 보스는 8%만
      else m.hp -= Math.max(STRIKE_MIN, m.maxHp * STRIKE_FRAC);
      m.hitFlash = 200;
      if (n++ < 14) _d.burst(m.x, m.y - 40);
      _d.killIfDead(m);
    }
    _d.shake(12); _d.sound('skill_meteor'); flash('rgba(251,146,60,.5)');
    _d.notify(`🔥 폭격! ${mons.length}마리 타격`);
  } else if (k === 'wall') {
    _items.wall--;
    _d.healWalls(WALL_HEAL_FRAC, CASTLE_HEAL_FRAC);
    _d.sound('levelup'); flash('rgba(96,165,250,.4)'); _d.notify('🛡️ 철벽! 성벽·성 체력 회복');
  } else if (k === 'rally') {
    _items.rally--;
    if (Date.now() >= _rallyUntil) { _d.buff.ally *= RALLY_MULT; _d.buff.tower *= RALLY_MULT; }
    const ep = _epoch; _rallyUntil = Date.now() + RALLY_MS;
    clearTimeout(_rallyTimer);
    _rallyTimer = setTimeout(() => {                                   // 게임이 다시 시작됐다면 원복하지 않음(리셋됨)
      if (ep !== _epoch) return;
      _d.buff.ally /= RALLY_MULT; _d.buff.tower /= RALLY_MULT; _rallyUntil = 0;
    }, RALLY_MS);
    _d.sound('streak'); flash('rgba(250,204,21,.4)'); _d.notify('⚔️ 전군 강화 — 25초간 공격력 ×1.5');
  }
  render();
}

function render() {
  if (!_ui) return;
  _ui.bar.querySelectorAll('.cq-it').forEach(b => { const n = _items[b.dataset.k]; b.querySelector('.c').textContent = n; b.disabled = n <= 0; });
}
function flash(color) {
  const f = _ui.fl; f.style.transition = 'none'; f.style.background = `radial-gradient(circle at center,transparent 35%,${color} 100%)`; f.style.opacity = '1';
  void f.offsetWidth; f.style.transition = 'opacity .55s'; f.style.opacity = '0';
}
