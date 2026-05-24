// assets/js/pages/merchants.archery.js
// 활쏘기 미니게임 — merchants.js에서 initArcheryGame()으로 초기화
'use strict';

const ENTRY_COST  = 100;
const MAX_ARROWS  = 20;
const GAME_SEC    = 60;
const GRAVITY     = 0.28;

// [imgIdx, label, basePts, coinDrop, baseSpeed, baseSize, spawnWeight, rarity]
const MDEFS = [
  [0,  '슬라임',     10,  0, 1.3, 64, 28, 'normal'],
  [1,  '고블린',     10,  0, 1.7, 58, 22, 'normal'],
  [2,  '스켈레톤',   10,  0, 1.5, 60, 20, 'normal'],
  [3,  '오크',       10,  0, 1.1, 74, 16, 'normal'],
  [4,  '독거미',     30,  2, 2.4, 52,  5, 'rare'],
  [5,  '좀비',       30,  2, 2.9, 48,  4, 'rare'],
  [6,  '마법사',     30,  2, 2.7, 54,  3, 'rare'],
  [7,  '해골왕',    100,  5, 3.4, 46,  1, 'hero'],
  [8,  '드래곤',    100,  5, 1.6, 84,  1, 'hero'],
  [9,  '황금몬스터', 200, 20, 3.8, 42,  0.5, 'golden'],
  [10, '보물상자',   80,  8, 0.8, 68,  1, 'rare'],
];
const SPAWN_WEIGHT = MDEFS.reduce((s, d) => s + d[6], 0);
const MON_IMGS = Array.from({ length: 11 }, (_, i) => `/assets/images/slot/${i + 1}.png`);

// ── 클래스 ────────────────────────────────────────────────────────────────────
class ArcheryGame {
  constructor({ onSpendGold, onAddGold, onPlaySound }) {
    this._spend   = onSpendGold;
    this._add     = onAddGold;
    this._snd     = onPlaySound;
    this._running = false;
    this._imgs    = MON_IMGS.map(src => Object.assign(new Image(), { src }));
    this._buildDOM();
  }

  // ── DOM 구성 ────────────────────────────────────────────────────────────────
  _buildDOM() {
    const ov = document.createElement('div');
    ov.id = 'archeryOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#0d1117;display:none;flex-direction:column;overflow:hidden;';

    ov.innerHTML = `
      <div id="archHud" style="
        position:absolute;top:0;left:0;right:0;z-index:2;
        display:flex;justify-content:space-between;align-items:center;
        padding:8px 14px;background:rgba(0,0,0,.6);
        color:#fff;font:700 13px/1 monospace;pointer-events:none;
      ">
        <span id="archScore">SCORE: 0</span>
        <span id="archCombo" style="font-size:17px;color:#ffd700;"></span>
        <span id="archTime">TIME: ${GAME_SEC}</span>
        <span id="archArrow">ARROW: ${MAX_ARROWS}</span>
        <button id="archClose" style="pointer-events:all;background:#ef4444;color:#fff;border:none;border-radius:6px;padding:3px 12px;cursor:pointer;font-size:13px;">✕</button>
      </div>
      <canvas id="archCanvas" style="flex:1;width:100%;display:block;touch-action:none;"></canvas>
      <div id="archPowerWrap" style="
        position:absolute;bottom:74px;left:50%;transform:translateX(-50%);
        width:130px;height:9px;background:rgba(255,255,255,.2);
        border-radius:5px;overflow:hidden;display:none;
      ">
        <div id="archPowerFill" style="height:100%;width:0;border-radius:5px;
          background:linear-gradient(90deg,#4ade80,#f59e0b,#ef4444);"></div>
      </div>
    `;
    document.body.appendChild(ov);

    this._ov         = ov;
    this._cv         = ov.querySelector('#archCanvas');
    this._hudScore   = ov.querySelector('#archScore');
    this._hudCombo   = ov.querySelector('#archCombo');
    this._hudTime    = ov.querySelector('#archTime');
    this._hudArrow   = ov.querySelector('#archArrow');
    this._pwrWrap    = ov.querySelector('#archPowerWrap');
    this._pwrFill    = ov.querySelector('#archPowerFill');
    ov.querySelector('#archClose').addEventListener('click', () => this.close());
  }

  // ── 공개 API ────────────────────────────────────────────────────────────────
  open() {
    if (this._running) return;
    if (!this._spend(ENTRY_COST)) {
      this._pageToast('코인이 부족합니다 (활쏘기: 100코인 필요)');
      return;
    }
    this._ov.style.display = 'flex';
    this._start();
  }

  close() {
    this._stop();
    this._ov.style.display = 'none';
    // 결과 화면이 남아있으면 제거
    this._ov.querySelector('.arch-result')?.remove();
  }

  // ── 게임 생명주기 ────────────────────────────────────────────────────────────
  _start() {
    const cv = this._cv;
    const rect = cv.getBoundingClientRect();
    cv.width  = rect.width  || window.innerWidth;
    cv.height = rect.height || (window.innerHeight - 44);
    this._ctx = cv.getContext('2d');

    this._score      = 0;
    this._combo      = 0;
    this._maxCombo   = 0;
    this._arrows     = MAX_ARROWS;
    this._timeLeft   = GAME_SEC;
    this._coins      = 0;
    this._kills      = 0;
    this._monsters   = [];
    this._flyArrows  = [];
    this._particles  = [];
    this._floats     = [];
    this._aiming     = false;
    this._dragStart  = null;
    this._aimAngle   = -Math.PI / 2;
    this._aimPower   = 0;
    this._spawnTick  = 0;
    this._diff       = 1;
    this._running    = true;
    this._lastTs     = performance.now();

    this._hudScore.textContent = 'SCORE: 0';
    this._hudArrow.textContent = `ARROW: ${MAX_ARROWS}`;
    this._hudTime.textContent  = `TIME: ${GAME_SEC}`;
    this._hudCombo.textContent = '';

    this._bindEvents();
    this._showHint();

    this._timer = setInterval(() => {
      if (!this._running) return;
      this._timeLeft--;
      this._diff = 1 + (GAME_SEC - this._timeLeft) / GAME_SEC * 2;
      this._hudTime.textContent = `TIME: ${this._timeLeft}`;
      if (this._timeLeft <= 0) this._end();
    }, 1000);

    this._raf = requestAnimationFrame(ts => this._loop(ts));
  }

  _stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    clearInterval(this._timer);
    this._unbindEvents();
  }

  _loop(ts) {
    if (!this._running) return;
    const dt = Math.min((ts - this._lastTs) / 16.67, 3);
    this._lastTs = ts;
    this._update(dt);
    this._render();
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  // ── 업데이트 ─────────────────────────────────────────────────────────────────
  _update(dt) {
    const W = this._cv.width, H = this._cv.height;

    // 몬스터 스폰
    this._spawnTick -= dt;
    if (this._spawnTick <= 0) {
      this._spawnMonster(W, H);
      const base = Math.max(30, 100 - this._diff * 20);
      this._spawnTick = base + Math.random() * 25;
    }

    // 몬스터 이동 (좌우 + 사인파 상하)
    for (const m of this._monsters) {
      if (!m.alive) continue;
      m.x += m.vx * dt;
      m.y += Math.sin(m.phase) * m.ampY * dt;
      m.phase += 0.045 * dt;
      if (m.x < -(m.sz + 10) || m.x > W + m.sz + 10) m.alive = false;
    }

    // 화살 물리
    for (const a of this._flyArrows) {
      if (!a.alive) continue;
      a.vy += GRAVITY * dt;
      a.vx *= 0.997;
      a.x  += a.vx * dt;
      a.y  += a.vy * dt;
      a.ang = Math.atan2(a.vy, a.vx);
      if (a.y > H + 40 || a.x < -40 || a.x > W + 40) {
        if (!a.hit) this._combo = 0;
        a.alive = false;
      }
      if (a.alive) this._hitTest(a);
    }

    // 파티클
    for (const p of this._particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 0.12 * dt;
      p.life -= dt;
      p.a = Math.max(0, p.life / p.ml);
    }
    // 플로팅 텍스트
    for (const f of this._floats) {
      f.y -= 0.9 * dt;
      f.life -= dt;
      f.a = Math.max(0, f.life / f.ml);
    }

    this._monsters  = this._monsters.filter(m => m.alive);
    this._flyArrows = this._flyArrows.filter(a => a.alive);
    this._particles = this._particles.filter(p => p.life > 0);
    this._floats    = this._floats.filter(f => f.life > 0);
  }

  // ── 명중 판정 ────────────────────────────────────────────────────────────────
  _hitTest(arrow) {
    for (const m of this._monsters) {
      if (!m.alive) continue;
      const dx = arrow.x - m.x, dy = arrow.y - m.y;
      if (dx * dx + dy * dy < (m.sz * 0.46) * (m.sz * 0.46)) {
        arrow.hit  = true;
        arrow.alive = false;
        m.hp--;
        const headshot = arrow.y < m.y - m.sz * 0.22;
        if (m.hp <= 0) {
          m.alive = false;
          this._onKill(m, headshot, arrow.x, arrow.y);
        } else {
          this._burst(arrow.x, arrow.y, '#ff6644', 6);
          this._float(arrow.x, arrow.y - 20, '-HP', '#ff6644', 13);
          this._snd?.('hit');
        }
        break;
      }
    }
  }

  _onKill(m, headshot, hx, hy) {
    this._combo++;
    this._kills++;
    if (this._combo > this._maxCombo) this._maxCombo = this._combo;

    const mult = this._combo >= 5 ? 5 : this._combo >= 3 ? 3 : this._combo >= 2 ? 2 : 1;
    let pts  = m.def[2] * mult * (headshot ? 2 : 1);
    let coin = m.def[3] + (headshot ? 1 : 0);

    this._score += pts;
    this._coins += coin;

    const isGolden = m.def[7] === 'golden';
    const color = headshot ? '#ffd700' : isGolden ? '#fbbf24' : '#fff';
    const label = headshot
      ? `CRITICAL! +${pts}`
      : mult > 1
        ? `+${pts} COMBO×${mult}`
        : `+${pts}`;

    this._burst(hx, hy, headshot ? '#ffd700' : isGolden ? '#fbbf24' : '#ff8844', headshot ? 22 : 10);
    this._float(hx, hy - 28, label, color, headshot ? 20 : 15);
    if (coin > 0) this._float(hx, hy - 52, `🪙 +${coin}`, '#fbbf24', 13);
    if (isGolden) this._float(hx, hy - 72, '✨ 황금몬스터!', '#ffd700', 16);

    this._snd?.(isGolden || headshot ? 'slot_win' : 'hit');

    this._hudScore.textContent = `SCORE: ${this._score}`;
    if (this._combo >= 2) {
      this._hudCombo.textContent = `COMBO ×${this._combo}`;
      this._hudCombo.style.color = this._combo >= 5 ? '#ef4444' : this._combo >= 3 ? '#f97316' : '#ffd700';
    } else {
      this._hudCombo.textContent = '';
    }
  }

  // ── 몬스터 스폰 ─────────────────────────────────────────────────────────────
  _spawnMonster(W, H) {
    let r = Math.random() * SPAWN_WEIGHT;
    let def = MDEFS[0];
    for (const d of MDEFS) { r -= d[6]; if (r <= 0) { def = d; break; } }

    const dir   = Math.random() < 0.5 ? 1 : -1;
    const sz    = def[5] * (0.75 + Math.random() * 0.5);
    const speed = def[4] * this._diff * (0.7 + Math.random() * 0.6);
    const hp    = (def[7] === 'hero' || def[7] === 'golden') ? 2 : 1;

    this._monsters.push({
      alive: true, def, hp,
      imgIdx: def[0],
      x: dir === 1 ? -(sz + 5) : W + sz + 5,
      y: H * (0.1 + Math.random() * 0.62),
      vx: dir * speed,
      ampY: 0.1 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      sz,
    });
  }

  // ── 화살 발사 ────────────────────────────────────────────────────────────────
  _fire() {
    if (!this._running || this._arrows <= 0) return;
    this._arrows--;
    const W = this._cv.width, H = this._cv.height;
    const spd = this._aimPower * 20 + 7;
    this._flyArrows.push({
      alive: true, hit: false,
      x: W / 2, y: H - 58,
      vx: Math.cos(this._aimAngle) * spd,
      vy: Math.sin(this._aimAngle) * spd,
      ang: this._aimAngle,
    });
    this._hudArrow.textContent = `ARROW: ${this._arrows}`;
    this._snd?.('hit');
    if (this._arrows <= 0) setTimeout(() => this._end(), 1800);
  }

  // ── 렌더링 ──────────────────────────────────────────────────────────────────
  _render() {
    const ctx = this._ctx, W = this._cv.width, H = this._cv.height;

    // 배경
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#0d1117');
    bg.addColorStop(0.7, '#1a1a2e');
    bg.addColorStop(1,   '#16213e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 별 (결정적 패턴 — 매 프레임 동일)
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 50; i++) {
      ctx.fillRect((i * 137 + 11) % W, (i * 97 + 7) % (H * 0.58), 1.5, 1.5);
    }

    // 지면
    ctx.fillStyle = 'rgba(120,70,30,.5)';
    ctx.fillRect(0, H - 50, W, 50);
    ctx.fillStyle = '#5a3010';
    ctx.fillRect(0, H - 52, W, 4);

    // 몬스터
    for (const m of this._monsters) {
      if (!m.alive) continue;
      const img = this._imgs[m.imgIdx];
      ctx.save();
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, m.x - m.sz / 2, m.y - m.sz / 2, m.sz, m.sz);
      } else {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.sz / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // 헤드샷 존 표시
      ctx.strokeStyle = 'rgba(239,68,68,.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(m.x - m.sz * 0.27, m.y - m.sz * 0.5, m.sz * 0.55, m.sz * 0.25);
      ctx.setLineDash([]);
      // 체력 점 (보스/황금)
      if (m.hp > 1) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(m.x, m.y + m.sz * 0.52, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 날아가는 화살
    for (const a of this._flyArrows) {
      if (!a.alive) continue;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.ang);
      ctx.strokeStyle = '#c87941';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(10, 0); ctx.stroke();
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(5, -3); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // 활 (하단 중앙)
    this._drawBow(ctx, W, H);

    // 조준선 (드래그 중)
    if (this._aiming && this._aimPower > 0.03) this._drawTrajectory(ctx, W, H);

    // 파티클
    for (const p of this._particles) {
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 플로팅 텍스트
    ctx.textAlign = 'center';
    for (const f of this._floats) {
      ctx.globalAlpha = f.a;
      ctx.fillStyle = f.c;
      ctx.font = `bold ${f.sz}px sans-serif`;
      ctx.fillText(f.t, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  _drawBow(ctx, W, H) {
    const cx = W / 2, cy = H - 56;
    ctx.save();
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, 24, -Math.PI * 0.85, Math.PI * 0.85);
    ctx.stroke();
    const x1 = cx + 24 * Math.cos(-Math.PI * 0.85);
    const y1 = cy + 24 * Math.sin(-Math.PI * 0.85);
    const x2 = cx + 24 * Math.cos( Math.PI * 0.85);
    const y2 = cy + 24 * Math.sin( Math.PI * 0.85);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (this._aiming && this._aimPower > 0.02) {
      const pullX = cx + Math.cos(this._aimAngle + Math.PI) * this._aimPower * 14;
      const pullY = cy + Math.sin(this._aimAngle + Math.PI) * this._aimPower * 14;
      ctx.lineTo(pullX, pullY);
    }
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  _drawTrajectory(ctx, W, H) {
    let x = W / 2, y = H - 56;
    const spd = this._aimPower * 20 + 7;
    let vx = Math.cos(this._aimAngle) * spd;
    let vy = Math.sin(this._aimAngle) * spd;
    ctx.save();
    ctx.strokeStyle = 'rgba(251,191,36,.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let i = 0; i < 35; i++) {
      vx *= 0.997; vy += GRAVITY;
      x += vx; y += vy;
      if (x < 0 || x > W || y > H) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── 파티클·플로트 ─────────────────────────────────────────────────────────
  _burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2, spd = 1 + Math.random() * 4;
      this._particles.push({
        x, y, c: color,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 2,
        r: 1 + Math.random() * 3, life: 25 + Math.random() * 20, ml: 45, a: 1,
      });
    }
  }

  _float(x, y, t, c = '#fff', sz = 14) {
    this._floats.push({ x, y, t, c, sz, life: 55, ml: 55, a: 1 });
  }

  // ── 입력 ────────────────────────────────────────────────────────────────────
  _bindEvents() {
    const cv = this._cv;
    this._ePD = e => { e.preventDefault(); this._aimStart(e); };
    this._ePM = e => { e.preventDefault(); this._aimMove(e); };
    this._ePU = e => { e.preventDefault(); this._aimEnd(); };
    cv.addEventListener('pointerdown',   this._ePD, { passive: false });
    cv.addEventListener('pointermove',   this._ePM, { passive: false });
    cv.addEventListener('pointerup',     this._ePU, { passive: false });
    cv.addEventListener('pointercancel', this._ePU, { passive: false });
  }

  _unbindEvents() {
    if (!this._cv) return;
    this._cv.removeEventListener('pointerdown',   this._ePD);
    this._cv.removeEventListener('pointermove',   this._ePM);
    this._cv.removeEventListener('pointerup',     this._ePU);
    this._cv.removeEventListener('pointercancel', this._ePU);
  }

  _pos(e) {
    const r = this._cv.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (this._cv.width  / r.width),
      y: (e.clientY - r.top)  * (this._cv.height / r.height),
    };
  }

  _aimStart(e) {
    if (!this._running || this._arrows <= 0) return;
    this._dragStart = this._pos(e);
    this._aiming    = true;
    this._pwrWrap.style.display = 'block';
  }

  _aimMove(e) {
    if (!this._aiming) return;
    const p  = this._pos(e);
    const dx = p.x - this._dragStart.x;
    const dy = p.y - this._dragStart.y;
    // 슬링샷: 드래그 반대 방향으로 발사
    this._aimAngle = Math.atan2(-dy, -dx);
    // 위쪽 반구만 허용
    if (this._aimAngle > -0.08)           this._aimAngle = -0.08;
    if (this._aimAngle < -Math.PI + 0.08) this._aimAngle = -Math.PI + 0.08;
    this._aimPower = Math.min(Math.hypot(dx, dy) / 90, 1);
    this._pwrFill.style.width = `${this._aimPower * 100}%`;
  }

  _aimEnd() {
    if (!this._aiming) return;
    this._aiming = false;
    this._pwrWrap.style.display = 'none';
    if (this._aimPower > 0.05) this._fire();
    this._dragStart = null;
    this._aimPower  = 0;
  }

  // ── 종료 ────────────────────────────────────────────────────────────────────
  _end() {
    this._stop();
    const bonus    = Math.floor(this._score / 100) * 5;
    const total    = this._coins + bonus;
    if (total > 0) this._add(total);

    const shotFired = MAX_ARROWS - this._arrows;
    const acc = shotFired > 0 ? Math.round(this._kills / shotFired * 100) : 0;

    const res = document.createElement('div');
    res.className = 'arch-result';
    res.style.cssText = [
      'position:absolute;inset:0;z-index:5;',
      'background:rgba(0,0,0,.88);backdrop-filter:blur(4px);',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'color:#fff;gap:10px;',
    ].join('');
    res.innerHTML = `
      <div style="font-size:42px;">🏹 게임 종료!</div>
      <div style="font-size:28px;color:#ffd700;font-weight:700;">SCORE: ${this._score}</div>
      <div style="font-size:15px;color:#d1d5db;">명중률: ${acc}% &nbsp;|&nbsp; 최고 콤보: ×${this._maxCombo}</div>
      <div style="font-size:16px;color:#4ade80;font-weight:600;">획득 코인: +${total} 🪙</div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="archRetry" style="padding:11px 24px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;">🔄 다시하기</button>
        <button id="archExit"  style="padding:11px 24px;background:#374151;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;">나가기</button>
      </div>
    `;
    this._ov.appendChild(res);

    res.querySelector('#archRetry').addEventListener('click', () => {
      res.remove();
      if (!this._spend(ENTRY_COST)) {
        this._pageToast('코인이 부족합니다 (100코인 필요)');
        this.close();
        return;
      }
      this._start();
    });
    res.querySelector('#archExit').addEventListener('click', () => this.close());
  }

  // ── 유틸 ────────────────────────────────────────────────────────────────────
  _showHint() {
    const h = document.createElement('div');
    h.style.cssText = [
      'position:absolute;top:55px;left:50%;transform:translateX(-50%);',
      'background:rgba(0,0,0,.7);color:#fff;padding:8px 18px;border-radius:8px;',
      'font-size:14px;pointer-events:none;transition:opacity .5s;z-index:3;text-align:center;',
    ].join('');
    h.textContent = '🏹 화면을 아래로 드래그 → 손을 떼면 발사!';
    this._ov.appendChild(h);
    setTimeout(() => { h.style.opacity = '0'; }, 2500);
    setTimeout(() => h.remove(), 3100);
  }

  _pageToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = [
      'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:10001;',
      'background:#ef4444;color:#fff;padding:10px 20px;border-radius:8px;',
      'font-size:14px;font-weight:600;pointer-events:none;',
    ].join('');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
}

// ── 싱글턴 ──────────────────────────────────────────────────────────────────
let _inst = null;

export function initArcheryGame(opts) { _inst = new ArcheryGame(opts); }
export function openArcheryGame()     { _inst?.open(); }
