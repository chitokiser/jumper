// /assets/js/pages/merchants.monster-sprite.js
// 게임서버 몬스터 Sprite 오버레이 — Google Maps OverlayView 기반
//
// 지원 타입 : dragon (추가 타입은 SPRITE_CONFIGS에 등록)
// 폴백     : 스프라이트 설정 없는 타입은 SVG 마커로 자동 전환
//
// 사용법:
//   import { hasSpriteConfig, createMonsterSpriteOverlay } from './merchants.monster-sprite.js';
//
//   if (hasSpriteConfig(monster.type)) {
//     const overlay = createMonsterSpriteOverlay(map, monster, onClickCb, onRemovedCb);
//   }
//   overlay.updateMonster(monster);
//   overlay.playDeathAndRemove();

// ─── 스프라이트 설정 레지스트리 ────────────────────────────────────────────────
//
// sheetWidth/sheetHeight : sprite sheet 전체 픽셀
// frameWidth/frameHeight : 1 프레임 픽셀
// displaySize            : 지도 위 표시 크기 (px)
// animations.*.row       : sprite sheet 행 번호 (0-based)
// animations.*.frames    : 해당 행의 사용 프레임 수
// animations.*.fps       : 재생 속도
// animations.*.loop      : true=반복, false=one-shot

export const SPRITE_CONFIGS = {
  dragon: {
    monsterType:  'dragon',
    spritePath:   '/assets/images/monsters/dragon/dragon_sprite.png',
    frameWidth:   256,
    frameHeight:  256,
    sheetWidth:   1536,
    sheetHeight:  1024,
    displaySize:  80,   // 지도 위 px (36px 기본 대비 ~2.2x)
    facingLeft: true,  // 스프라이트가 왼쪽을 향함 → 기본 반전 적용
    animations: {
      idle:    { row: 1, frames: 6, fps: 4,  loop: true  },  // Row1=IDLE 라벨
      walk:    { row: 0, frames: 6, fps: 8,  loop: true  },  // Row0=unlabeled walk
      attack:  { row: 2, frames: 5, fps: 10, loop: false },  // Row2=ATTACK, 6번째 빈프레임 제외
      hit:     { row: 2, frames: 2, fps: 12, loop: false },  // attack 앞 2프레임 재사용
      death:   { row: 3, frames: 6, fps: 6,  loop: false },  // Row3=DEATH
      respawn: { row: 3, frames: 6, fps: 6,  loop: false },
    },
  },
};

// 서버 상태 → 애니메이션 이름 매핑
const STATE_TO_ANIM = {
  idle:       'idle',
  chasing:    'walk',
  return:     'walk',
  attacking:  'attack',
  dead:       'death',
  respawning: 'respawn',
};

// 이동 보간 시간 (ms)
const LERP_MS = 300;

// ─── CSS 주입 (페이지당 1회) ───────────────────────────────────────────────────

let _cssInjected = false;

function _injectStyles() {
  if (_cssInjected || document.getElementById('monster-sprite-styles')) return;
  _cssInjected = true;

  let css = `
/* ── monster-sprite overlay 공통 ── */
.ms-overlay {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}
.ms-overlay .ms-name {
  position: absolute;
  top: -16px; left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 10px; font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,.9);
  pointer-events: none;
}
.ms-overlay .ms-hp-wrap {
  position: absolute;
  bottom: 2px; left: 4px; right: 4px;
  height: 4px;
  background: rgba(0,0,0,.45);
  border-radius: 2px;
  overflow: hidden;
}
.ms-overlay .ms-hp-bar {
  height: 100%;
  background: #22c55e;
  border-radius: 2px;
  transition: width .35s, background .35s;
}
`;

  // 타입별 sprite CSS 생성
  for (const [type, cfg] of Object.entries(SPRITE_CONFIGS)) {
    const { spritePath, frameWidth, frameHeight, sheetWidth, sheetHeight, displaySize } = cfg;
    const scale     = displaySize / frameWidth;
    const bgW       = Math.round(sheetWidth  * scale);
    const bgH       = Math.round(sheetHeight * scale);
    const fW        = Math.round(frameWidth  * scale); // = displaySize
    const fH        = Math.round(frameHeight * scale);

    const blendMode = cfg.facingLeft ? `
  mix-blend-mode: screen;` : '';
    // transform은 CSS에 넣지 않고 JS(_updateDirection)에서만 관리
    // CSS default flip이 있으면 inline style ''로 지워도 CSS가 다시 적용되어 방향 전환 불가

    css += `
/* ── ${type} sprite ── */
.ms-${type} {
  width: ${fW}px; height: ${fH}px;
  background-image: url('${spritePath}');
  background-size: ${bgW}px ${bgH}px;
  background-repeat: no-repeat;
  image-rendering: pixelated;
  image-rendering: crisp-edges;${blendMode}
}
`;

    for (const [animName, anim] of Object.entries(cfg.animations)) {
      const rowY      = Math.round(anim.row * fH);
      const totalW    = Math.round(anim.frames * fW);
      const duration  = (anim.frames / anim.fps).toFixed(3);
      const iteration = anim.loop ? 'infinite' : '1';
      const fill      = anim.loop ? 'none' : 'forwards';
      const kfName    = `ms-${type}-${animName}`;

      css += `
@keyframes ${kfName} {
  from { background-position: 0 -${rowY}px; }
  to   { background-position: -${totalW}px -${rowY}px; }
}
.ms-${type}[data-anim="${animName}"] {
  animation: ${kfName} ${duration}s steps(${anim.frames}) ${iteration} ${fill};
}
`;
    }
  }

  const el = document.createElement('style');
  el.id = 'monster-sprite-styles';
  el.textContent = css;
  document.head.appendChild(el);
}

// ─── MonsterSpriteOverlay 클래스 팩토리 ───────────────────────────────────────
// google.maps.OverlayView는 Maps API 로드 후에만 상속 가능하므로 lazy 생성

let _OverlayClass = null;

function _getOverlayClass() {
  if (_OverlayClass) return _OverlayClass;
  if (!window.google?.maps) return null;

  class MonsterSpriteOverlay extends google.maps.OverlayView {
    /**
     * @param {object}   monster    - MonsterInstance (currentLat/Lng, type, state, hp, maxHp)
     * @param {object}   cfg        - SPRITE_CONFIGS[type]
     * @param {Function} onClick    - 클릭 핸들러
     * @param {Function} onRemoved  - 오버레이 DOM 제거 완료 콜백
     */
    constructor(monster, cfg, onClick, onRemoved) {
      super();
      this._cfg       = cfg;
      this._onClick   = onClick   || (() => {});
      this._onRemoved = onRemoved || (() => {});

      this._lat       = monster.currentLat;
      this._lng       = monster.currentLng;
      this._hp        = monster.hp;
      this._maxHp     = monster.maxHp;
      this._type      = monster.type;
      this._name      = monster.type.charAt(0).toUpperCase() + monster.type.slice(1);

      // 애니메이션 상태
      this._animState = 'idle';
      this._logicState = monster.state;
      this._oneShot   = false;   // one-shot 진행 중 여부

      // 이동 보간
      this._targetLat  = this._lat;
      this._targetLng  = this._lng;
      this._lerpFrom   = { lat: this._lat, lng: this._lng };
      this._lerpTo     = { lat: this._lat, lng: this._lng };
      this._lerpStart  = null;
      this._lerpRaf    = null;
      this._hidden     = false;

      // 이동 방향 (좌우 반전용)
      this._lastMoveLng = this._lng;

      this._div = null;
    }

    onAdd() {
      _injectStyles();
      const cfg  = this._cfg;
      const size = cfg.displaySize;

      const div = document.createElement('div');
      div.className = 'ms-overlay';
      div.style.cssText = `width:${size}px;height:${size}px;`;

      // 스프라이트 프레임
      const frame = document.createElement('div');
      frame.className = `ms-${this._type}`;
      frame.dataset.anim = 'idle';
      this._frame = frame;

      // HP 바
      const hpWrap = document.createElement('div');
      hpWrap.className = 'ms-hp-wrap';
      const hpBar = document.createElement('div');
      hpBar.className = 'ms-hp-bar';
      hpWrap.appendChild(hpBar);
      this._hpBar = hpBar;

      // 이름 레이블
      const nameEl = document.createElement('div');
      nameEl.className = 'ms-name';
      nameEl.textContent = this._name;

      div.appendChild(nameEl);
      div.appendChild(frame);
      div.appendChild(hpWrap);
      div.addEventListener('click', () => this._onClick());

      this._div = div;
      this._updateHpBar();
      this._applyAnim(STATE_TO_ANIM[this._logicState] || 'idle');

      const pane = this.getPanes().overlayMouseTarget;
      pane.appendChild(div);
    }

    draw() {
      if (!this._div) return;
      const proj = this.getProjection();
      if (!proj) return;
      const pt   = proj.fromLatLngToDivPixel(new google.maps.LatLng(this._lat, this._lng));
      const size = this._cfg.displaySize;
      this._div.style.left = (pt.x - size / 2) + 'px';
      this._div.style.top  = (pt.y - size)      + 'px';
    }

    onRemove() {
      if (this._div?.parentNode) this._div.parentNode.removeChild(this._div);
      this._div = null;
      if (this._lerpRaf) cancelAnimationFrame(this._lerpRaf);
      this._onRemoved();
    }

    // ── public API ───────────────────────────────────────────────────────────

    /** 서버 이벤트(monster:update / monster:respawned)로 상태 갱신 */
    updateMonster(monster) {
      const prevHp = this._hp;
      this._hp     = monster.hp;
      this._maxHp  = monster.maxHp;
      this._updateHpBar();

      // 위치 보간
      const newLat = monster.currentLat;
      const newLng = monster.currentLng;
      if (Math.abs(newLat - this._targetLat) > 1e-7 ||
          Math.abs(newLng - this._targetLng) > 1e-7) {
        this._lastMoveLng = newLng;
        this._startLerp(newLat, newLng);
        this._updateDirection();
      }

      // logicState는 항상 먼저 갱신 — onComplete 클로저가 최신 상태를 참조하도록
      this._logicState = monster.state;

      // 피격 감지 (HP 감소)
      if (monster.hp < prevHp && !this._oneShot) {
        this._playOneShot('hit', () => this._syncAnim(this._logicState));
        return;
      }

      // respawning → 표시 복귀
      if (monster.state === 'respawning' && this._hidden) {
        this._show();
        this._playOneShot('respawn', () => this._applyAnim('idle'));
        return;
      }

      if (!this._oneShot) this._syncAnim(monster.state);
    }

    /** monster:died 수신 시 — death 애니메이션 후 오버레이 자체 제거 */
    playDeathAndRemove() {
      this._oneShot = true;
      this._applyAnim('death');
      if (!this._frame) { this.setMap(null); return; }

      const onEnd = () => {
        this._frame.removeEventListener('animationend', onEnd);
        this._hide();
        // DOM은 유지 (respawn 이벤트 대기), 단 respawnAt 도달 시 서버가 respawned 전송
        this._oneShot = false;
      };
      this._frame.addEventListener('animationend', onEnd);
    }

    // ── 내부 헬퍼 ────────────────────────────────────────────────────────────

    _syncAnim(serverState) {
      this._applyAnim(STATE_TO_ANIM[serverState] || 'idle');
    }

    _updateDirection() {
      if (!this._frame) return;
      const facingLeft = this._cfg.facingLeft;
      // CSS에 default transform 없음 → 명시적으로 scaleX(1) or scaleX(-1) 설정
      // movingWest = true  → 서쪽(왼쪽)으로 이동
      // facingLeft = true  → 스프라이트 자연 방향이 왼쪽 → 서쪽이동 시 flip 없음
      const movingWest = this._lastMoveLng < this._lng;
      if (facingLeft) {
        this._frame.style.transform = movingWest ? 'scaleX(1)' : 'scaleX(-1)';
      } else {
        this._frame.style.transform = movingWest ? 'scaleX(-1)' : 'scaleX(1)';
      }
    }

    _applyAnim(animName) {
      if (!this._frame) return;
      const animCfg = this._cfg.animations[animName];
      // loop=true  (idle/walk): 같은 상태면 재시작 금지 — 루프 끊김 방지
      // loop=false (attack/hit/death): 매 호출마다 재시작 — 서버 tick에 맞춰 재생
      if (this._animState === animName && animCfg?.loop !== false) return;
      // animation 강제 재시작: data-anim 리셋 후 재설정
      this._frame.dataset.anim = '';
      void this._frame.offsetWidth; // reflow trigger
      this._frame.dataset.anim = animName;
      this._animState = animName;
      this._updateDirection();
    }

    _playOneShot(animName, onComplete) {
      if (!this._frame) return;
      this._oneShot = true;
      this._applyAnim(animName);

      const onEnd = () => {
        this._frame.removeEventListener('animationend', onEnd);
        this._oneShot = false;
        onComplete?.();
      };
      this._frame.addEventListener('animationend', onEnd);

      // 안전 타이머: animationend가 안 오면 fallback
      const cfg = this._cfg.animations[animName];
      if (cfg) {
        const safeDuration = (cfg.frames / cfg.fps + 0.5) * 1000;
        setTimeout(() => {
          if (this._oneShot) { this._oneShot = false; onComplete?.(); }
        }, safeDuration);
      }
    }

    _updateHpBar() {
      if (!this._hpBar) return;
      const pct = this._maxHp > 0 ? Math.max(0, this._hp / this._maxHp) : 0;
      this._hpBar.style.width = (pct * 100).toFixed(1) + '%';
      this._hpBar.style.background =
        pct > 0.5 ? '#22c55e' : pct > 0.2 ? '#f97316' : '#ef4444';
    }

    _startLerp(toLat, toLng) {
      if (this._lerpRaf) cancelAnimationFrame(this._lerpRaf);
      this._lerpFrom  = { lat: this._lat, lng: this._lng };
      this._lerpTo    = { lat: toLat, lng: toLng };
      this._lerpStart = performance.now();
      this._targetLat = toLat;
      this._targetLng = toLng;
      this._doLerp();
    }

    _doLerp() {
      const t = Math.min(1, (performance.now() - this._lerpStart) / LERP_MS);
      this._lat = this._lerpFrom.lat + (this._lerpTo.lat - this._lerpFrom.lat) * t;
      this._lng = this._lerpFrom.lng + (this._lerpTo.lng - this._lerpFrom.lng) * t;
      this.draw();
      if (t < 1) this._lerpRaf = requestAnimationFrame(() => this._doLerp());
    }

    _hide() {
      if (this._div) this._div.style.display = 'none';
      this._hidden = true;
    }

    _show() {
      if (this._div) this._div.style.display = '';
      this._hidden = false;
    }
  }

  _OverlayClass = MonsterSpriteOverlay;
  return _OverlayClass;
}

// ─── 공개 API ──────────────────────────────────────────────────────────────────

/** 해당 타입에 스프라이트 설정이 있는지 확인 */
export function hasSpriteConfig(monsterType) {
  return monsterType in SPRITE_CONFIGS;
}

/**
 * 스프라이트 오버레이 생성 후 map에 즉시 추가
 * @returns {MonsterSpriteOverlay}
 */
export function createMonsterSpriteOverlay(map, monster, onClick, onRemoved) {
  const Cls = _getOverlayClass();
  if (!Cls) {
    console.warn('[MonsterSprite] google.maps 미로드 — 오버레이 생성 불가');
    return null;
  }
  const cfg = SPRITE_CONFIGS[monster.type];
  if (!cfg) {
    console.warn('[MonsterSprite] 설정 없는 타입:', monster.type);
    return null;
  }
  const overlay = new Cls(monster, cfg, onClick, onRemoved);
  overlay.setMap(map);
  return overlay;
}
