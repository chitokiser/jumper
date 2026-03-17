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
// [sprite sheet 방식 - 단일 시트]
// sheetWidth/sheetHeight : sprite sheet 전체 픽셀
// frameWidth/frameHeight : 1 프레임 픽셀
// animations.*.row       : sprite sheet 행 번호 (0-based)
//
// [strips 방식 - dragon 등]
// stripsMode: true       : 애니메이션별 수평 스트립 PNG 파일 방식
// basePath               : 이미지 폴더 경로
// frameWidth/frameHeight : 1 프레임 픽셀
// animations.*.file      : 스트립 파일명 (예: 'Walk.png')
//
// [개별 프레임 방식 - orc 등]
// framesMode: true       : 개별 PNG 파일 방식 (JS setInterval)
// basePath               : 이미지 폴더 경로
// animations.*.prefix    : 파일명 접두사 (예: 'ORK_01_IDLE_')
//
// [공통]
// displaySize            : 지도 위 표시 크기 (px)
// animations.*.frames    : 프레임 수
// animations.*.fps       : 재생 속도
// animations.*.loop      : true=반복, false=one-shot

export const SPRITE_CONFIGS = {
  dragon: {
    monsterType:  'dragon',
    stripsMode:   true,                              // 애니메이션별 수평 스트립 PNG 방식
    basePath:     '/assets/images/monsters/dragon/',
    frameWidth:   128,
    frameHeight:  128,
    displaySize:  80,
    facingLeft:   false,
    animations: {
      idle:    { file: 'Idle.png',     frames: 6, fps: 6,  loop: true  },
      walk:    { file: 'Walk.png',     frames: 8, fps: 10, loop: true  },
      attack:  { file: 'Attack_1.png', frames: 6, fps: 10, loop: false },
      hit:     { file: 'Hurt.png',     frames: 3, fps: 12, loop: false },
      death:   { file: 'Dead.png',     frames: 6, fps: 6,  loop: false },
      respawn: { file: 'Idle.png',     frames: 6, fps: 6,  loop: false },
    },
  },
  orc: {
    monsterType: 'orc',
    framesMode:  true,
    basePath:    '/assets/images/monsters/orc/',
    displaySize: 80,
    facingLeft:  false,
    animations: {
      idle:    { prefix: 'ORK_01_IDLE_',   frames: 10, fps: 8,  loop: true  },
      walk:    { prefix: 'ORK_01_WALK_',   frames: 10, fps: 10, loop: true  },
      attack:  { prefix: 'ORK_01_ATTAK_',  frames: 10, fps: 12, loop: false },
      hit:     { prefix: 'ORK_01_HURT_',   frames: 10, fps: 12, loop: false },
      death:   { prefix: 'ORK_01_DIE_',    frames: 10, fps: 8,  loop: false },
      respawn: { prefix: 'ORK_01_IDLE_',   frames: 10, fps: 6,  loop: false },
    },
  },
  pirate: {
    monsterType: 'pirate',
    framesMode:  true,
    basePath:    '/assets/images/monsters/pirate/',
    displaySize: 80,
    facingLeft:  false,
    animations: {
      idle:    { prefix: '1_entity_000_IDLE_',   frames: 7, fps: 7,  loop: true  },
      walk:    { prefix: '1_entity_000_WALK_',   frames: 7, fps: 8,  loop: true  },
      attack:  { prefix: '1_entity_000_ATTACK_', frames: 7, fps: 12, loop: false },
      hit:     { prefix: '1_entity_000_HURT_',   frames: 7, fps: 12, loop: false },
      death:   { prefix: '1_entity_000_DIE_',    frames: 7, fps: 8,  loop: false },
      respawn: { prefix: '1_entity_000_IDLE_',   frames: 7, fps: 6,  loop: false },
    },
  },
  orc2: {
    monsterType: 'orc2',
    framesMode:  true,
    basePath:    '/assets/images/monsters/orc2/',
    displaySize: 80,
    facingLeft:  false,
    animations: {
      idle:    { prefix: 'ORK_02_IDLE_',   frames: 10, fps: 8,  loop: true  },
      walk:    { prefix: 'ORK_02_WALK_',   frames: 10, fps: 10, loop: true  },
      attack:  { prefix: 'ORK_02_ATTAK_',  frames: 10, fps: 12, loop: false },
      hit:     { prefix: 'ORK_02_HURT_',   frames: 10, fps: 12, loop: false },
      death:   { prefix: 'ORK_02_DIE_',    frames: 10, fps: 8,  loop: false },
      respawn: { prefix: 'ORK_02_IDLE_',   frames: 10, fps: 6,  loop: false },
    },
  },
  orc3: {
    monsterType: 'orc3',
    framesMode:  true,
    basePath:    '/assets/images/monsters/orc3/',
    displaySize: 80,
    facingLeft:  false,
    animations: {
      idle:    { prefix: 'ORK_03_IDLE_',   frames: 10, fps: 8,  loop: true  },
      walk:    { prefix: 'ORK_03_WALK_',   frames: 10, fps: 10, loop: true  },
      attack:  { prefix: 'ORK_03_ATTAK_',  frames: 10, fps: 12, loop: false },
      hit:     { prefix: 'ORK_03_HURT_',   frames: 10, fps: 12, loop: false },
      death:   { prefix: 'ORK_03_DIE_',    frames: 10, fps: 8,  loop: false },
      respawn: { prefix: 'ORK_03_IDLE_',   frames: 10, fps: 6,  loop: false },
    },
  },
  pirate2: {
    monsterType: 'pirate2',
    framesMode:  true,
    basePath:    '/assets/images/monsters/pirate2/',
    displaySize: 80,
    facingLeft:  false,
    animations: {
      idle:    { prefix: '2_entity_000_IDLE_',   frames: 7, fps: 7,  loop: true  },
      walk:    { prefix: '2_entity_000_WALK_',   frames: 7, fps: 8,  loop: true  },
      attack:  { prefix: '2_entity_000_ATTACK_', frames: 7, fps: 12, loop: false },
      hit:     { prefix: '2_entity_000_HURT_',   frames: 7, fps: 12, loop: false },
      death:   { prefix: '2_entity_000_DIE_',    frames: 7, fps: 8,  loop: false },
      respawn: { prefix: '2_entity_000_IDLE_',   frames: 7, fps: 6,  loop: false },
    },
  },
  pirate3: {
    monsterType: 'pirate3',
    framesMode:  true,
    basePath:    '/assets/images/monsters/pirate3/',
    displaySize: 80,
    facingLeft:  false,
    animations: {
      idle:    { prefix: '3_3-PIRATE_IDLE_',   frames: 7, fps: 7,  loop: true  },
      walk:    { prefix: '3_3-PIRATE_WALK_',   frames: 7, fps: 8,  loop: true  },
      attack:  { prefix: '3_3-PIRATE_ATTACK_', frames: 7, fps: 12, loop: false },
      hit:     { prefix: '3_3-PIRATE_HURT_',   frames: 7, fps: 12, loop: false },
      death:   { prefix: '3_3-PIRATE_DIE_',    frames: 7, fps: 8,  loop: false },
      respawn: { prefix: '3_3-PIRATE_IDLE_',   frames: 7, fps: 6,  loop: false },
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
    const { displaySize } = cfg;

    if (cfg.framesMode) {
      // 개별 프레임 방식 — <img> 태그 크기만 지정
      css += `
/* ── ${type} frames ── */
.ms-${type} {
  width: ${displaySize}px; height: ${displaySize}px;
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
`;
      continue;
    }

    if (cfg.stripsMode) {
      // 애니메이션별 수평 스트립 방식 — 애니메이션마다 별도 PNG, CSS background-position
      const { basePath, frameWidth, frameHeight } = cfg;
      const scale = displaySize / frameWidth;
      const dW    = Math.round(frameWidth  * scale);  // = displaySize
      const dH    = Math.round(frameHeight * scale);

      css += `
/* ── ${type} strips ── */
.ms-${type} {
  width: ${dW}px; height: ${dH}px;
  background-repeat: no-repeat;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
`;
      for (const [animName, anim] of Object.entries(cfg.animations)) {
        const stripW   = Math.round(anim.frames * dW);
        const duration = (anim.frames / anim.fps).toFixed(3);
        const iteration = anim.loop ? 'infinite' : '1';
        const fill      = anim.loop ? 'none' : 'forwards';
        const kfName    = `ms-${type}-${animName}`;

        css += `
@keyframes ${kfName} {
  from { background-position: 0 0; }
  to   { background-position: -${stripW}px 0; }
}
.ms-${type}[data-anim="${animName}"] {
  background-image: url('${basePath}${anim.file}');
  background-size: ${stripW}px ${dH}px;
  animation: ${kfName} ${duration}s steps(${anim.frames}) ${iteration} ${fill};
}
`;
      }
      continue;
    }

    const { spritePath, frameWidth, frameHeight, sheetWidth, sheetHeight } = cfg;
    const scale     = displaySize / frameWidth;
    const bgW       = Math.round(sheetWidth  * scale);
    const bgH       = Math.round(sheetHeight * scale);
    const fW        = Math.round(frameWidth  * scale); // = displaySize
    const fH        = Math.round(frameHeight * scale);

    const blendMode = cfg.facingLeft ? `
  mix-blend-mode: screen;` : '';

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

      // framesMode 전용
      this._frameTimer = null;

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
      let frame;
      if (cfg.framesMode) {
        frame = document.createElement('img');
        frame.className = `ms-${this._type}`;
        frame.draggable = false;
        frame.alt = '';
      } else {
        frame = document.createElement('div');
        frame.className = `ms-${this._type}`;
        frame.dataset.anim = 'idle';
      }
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
      if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
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
      if (this._cfg.framesMode) {
        this._applyFrameAnim('death', () => {
          this._oneShot = false;
          this._hide();
        });
        return;
      }
      this._applyAnim('death');
      if (!this._frame) { this.setMap(null); return; }

      const onEnd = () => {
        this._frame.removeEventListener('animationend', onEnd);
        this._hide();
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
      if (this._cfg.framesMode) { this._applyFrameAnim(animName); return; }
      const animCfg = this._cfg.animations[animName];
      // loop=true  (idle/walk): 같은 상태면 재시작 금지 — 루프 끊김 방지
      // loop=false (attack/hit/death): 매 호출마다 재시작 — 서버 tick에 맞춰 재생
      if (this._animState === animName && animCfg?.loop !== false) return;
      this._frame.dataset.anim = '';
      void this._frame.offsetWidth; // reflow trigger
      this._frame.dataset.anim = animName;
      this._animState = animName;
      this._updateDirection();
    }

    /** framesMode 전용 — 개별 PNG를 setInterval로 교체 */
    _applyFrameAnim(animName, oneShotCb = null) {
      if (!this._frame) return;
      const animCfg = this._cfg.animations[animName];
      if (!animCfg) return;
      // loop 애니메이션은 같은 상태 재진입 시 그냥 유지 (단 oneShotCb 있으면 강제 재시작)
      if (this._animState === animName && animCfg.loop && !oneShotCb) return;

      if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
      this._animState = animName;

      let frameIdx = 0;
      const setFrame = (idx) => {
        const padded = String(idx).padStart(3, '0');
        this._frame.src = `${this._cfg.basePath}${animCfg.prefix}${padded}.png`;
      };
      setFrame(0);
      this._updateDirection();

      this._frameTimer = setInterval(() => {
        frameIdx++;
        if (frameIdx >= animCfg.frames) {
          if (animCfg.loop && !oneShotCb) {
            frameIdx = 0;
          } else {
            frameIdx = animCfg.frames - 1; // 마지막 프레임 고정
            clearInterval(this._frameTimer);
            this._frameTimer = null;
            if (oneShotCb) { this._oneShot = false; oneShotCb(); }
            return;
          }
        }
        setFrame(frameIdx);
      }, 1000 / animCfg.fps);
    }

    _playOneShot(animName, onComplete) {
      if (!this._frame) return;
      this._oneShot = true;
      if (this._cfg.framesMode) {
        this._applyFrameAnim(animName, () => {
          this._oneShot = false;
          onComplete?.();
        });
        return;
      }
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

/** 모든 스프라이트 이미지 사전 로드 (몬스터 등장 전 호출) */
export function preloadSpriteImages() {
  for (const cfg of Object.values(SPRITE_CONFIGS)) {
    if (cfg.stripsMode) {
      // 애니메이션별 스트립 PNG 프리로드
      const seen = new Set();
      for (const anim of Object.values(cfg.animations)) {
        if (seen.has(anim.file)) continue;
        seen.add(anim.file);
        const img = new Image();
        img.src = cfg.basePath + anim.file;
      }
    } else if (cfg.framesMode) {
      // 개별 프레임 PNG 프리로드
      for (const anim of Object.values(cfg.animations)) {
        for (let i = 0; i < anim.frames; i++) {
          const img = new Image();
          img.src = cfg.basePath + anim.prefix + String(i).padStart(3, '0') + '.png';
        }
      }
    } else if (cfg.spritePath) {
      // 단일 스프라이트 시트 프리로드
      const img = new Image();
      img.src = cfg.spritePath;
    }
  }
}

/** 해당 타입에 스프라이트 설정이 있는지 확인 */
export function hasSpriteConfig(monsterType) {
  return monsterType in SPRITE_CONFIGS;
}

/**
 * 스프라이트 오버레이 생성 후 map에 즉시 추가
 * @returns {object}
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
