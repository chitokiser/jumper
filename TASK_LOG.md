# 📋 작업 및 요구사항 처리 기록 (TASK_LOG.md)

이 문서는 사용자의 요청 사항과 각 작업의 분석, 수정 내역, 변경 파일, 배포 상태를 기록하는 작업 일지입니다.

---

## 📌 기록 규격
- **요청 일시**: YYYY-MM-DD HH:mm
- **요청 내용**: 사용자의 요구사항 원문 또는 요약
- **원인 분석**: 문제 발생 원인 또는 요구사항 분석 내용
- **처리 내역**: 코드 수정 및 기능 구현 상세
- **수정/추가 파일**: 변경된 파일 경로 목록
- **검증 및 배포**: 테스트 결과 및 Git 배포(커밋 해시) 상태

---

## 🕒 작업 히스토리

### [2026-10-20] 전체화면 단독 버튼 외부 노출 및 고품질 5대 스킬 애니메이션 구현

- **요청 일시**: 2026-10-20 07:15
- **요청 내용**:
  1. "게임상에서 전체화면을 키우는 기능은 직관적으로 밖에서 단독으로 보여야 한다."
  2. "그리고 스킬 라이팅, 아이스, 파이어등 스킬을 사용하면 스킬 애니메이션이 안 보인다."
- **원인 분석**:
  1. **전체화면 버튼 은닉**: `btnFullscreen`이 우측 HUD의 환경설정(⚙️) 하위 슬라이드 메뉴(`wrapGroupSystem`) 안에 접혀있어 유저가 한눈에 전체화면 기능을 찾거나 원클릭으로 켜고 끄기 어려웠음.
  2. **스킬 사정거리 제한(40m)으로 인한 조기 반환**: 스킬 사정거리 상수(`SKILL_RANGE_M = 40`, `WIND_RANGE_M = 30`, `METEOR_RANGE_M = 60`)가 너무 좁아 화면 내 눈에 보이는 몬스터(일반적으로 60~120m)가 범위 밖으로 판정되어 에러 토스트만 뜨고 스킬 애니메이션 코드 자체가 실행되지 않았음.
  3. **스킬 애니메이션 부실 및 오버레이 스택 이슈**:
     - 기존 애니메이션이 단순 이모지 1개(⚡, ❄, 🔥)가 0.35초 잠깐 깜빡이는 수준에 불과하여 타격감 및 시각 피드백이 극도로 미약했음.
     - `#battleOverlay`의 z-index(950)가 낮아 지도 타일/마커 레이어와 간섭될 위험이 있었고, 범위 내 타겟이 없을 때 시각 효과가 전무했음.
- **처리 내역**:
  1. **전체화면 버튼(`btnFullscreen`) 단독 노출 및 직관적 디자인**:
     - `merchants.html` & `merchants.js`: `btnFullscreen`을 접히는 메뉴(`wrapGroupSystem`)에서 꺼내어 `mapHud` 최상단(GP 배지 바로 아래)에 단독 버튼으로 상시 배치.
     - 스타일: `border: 1.5px solid rgba(59,130,246,0.65); background: rgba(15,23,42,0.85); color: #60a5fa; font-size: 17px;`.
     - 전체화면 활성화/해제 상태에 따라 아이콘(`⛶` ↔ `⤡`/`✕`) 및 컬러 실시간 동기화.
  2. **오버레이 스택 상향**:
     - `#battleOverlay`의 `z-index`를 950에서 `1050`으로 상향하여 모든 지도 마커/팝업 위에 이펙트가 선명히 렌더링되도록 보장.
  3. **스킬 사정거리 확장**:
     - `SKILL_RANGE_M = 120` (기존 40m -> 120m), `WIND_RANGE_M = 120`, `METEOR_RANGE_M = 150`, 관리자 시전 사정거리는 `500m`로 대폭 확장하여 화면 내 몬스터를 100% 포착.
  4. **화려한 60fps 5대 마법 스킬 애니메이션 엔진 구현**:
     - **Lightning (⚡ 라이트닝)**: 하늘에서 타겟(및 플레이어 전방)으로 내리꽂히는 지그재그 전격 레이저(SVG Polyline) + 백색/골드 네온 글로우 + 지면 방전 펄스 링 + 사방으로 비산하는 8개 감전 스파크 파티클.
     - **Ice (❄️ 아이스)**: 지면에 팽창 회전하는 서리 마법진(Expanding Frost Nova Ring) + 위로 솟구치는 3대 사파이어 얼음 크리스탈 기둥(Glacier Spikes) + 8개의 서리 파편 파티클.
     - **Fire (🔥 파이어)**: 타겟 지점에서 솟구치는 거대한 화염 폭풍 기둥(Fire Pillar Blast) + 지면 용암 충격파 링 + 위로 솟구치는 10개의 불티(Floating Embers) 파티클.
     - **Whirlwind (🌪️ 회오리)**: 고속 회전하는 3단 에메랄드 토네이도 볼텍스 + 바람 칼날 슬래시.
     - **Meteor (☄️ 메테오)**: 우상단 하늘에서 불꽃 꼬리를 끌며 초고속 낙하하는 거대 운석 + 지면 대폭발(Nuclear Blast Ring) + 화면 전체 진동(Screen Shake Effect).
     - **다중 타겟 동시/연쇄 타격**: 사정거리 내 복수 몬스터에게 시차(60ms)를 두고 연쇄 타격 이펙트 발동.
     - **폴백 시각 피드백**: 타겟이 사정거리 밖이거나 없을 때도 플레이어 위치/전방으로 마법 시전 연출이 출력되어 유저가 스킬 발동을 즉각 체감할 수 있도록 개선.
- **수정/추가 파일**:
  - `merchants.html`
  - `merchants-vn.html`
  - `assets/js/pages/merchants.js`
  - `assets/js/pages/merchants.battle.js`
- **검증 및 배포**:
  - Playwright E2E 테스트로 전체화면 단독 버튼 가시성 및 토글(`⛶` ↔ `✕`), 라이트닝(자식 노드 12개 SVG/파티클), 아이스(15개 마법진/크리스탈), 파이어(15개 불기둥/용암링), 회오리, 메테오 정상 렌더링 100% 검증 통과.
  - Git 커밋 및 master 푸시 완료.

---

### [2026-10-17] 지도 게임 화면 HUD 기능 버튼 소실 복원 및 Git 배포

- **요청 일시**: 2026-10-17 18:23:19
- **요청 내용**:
  1. `http://localhost:8080/merchants` 게임하기에서 기능버튼이 모두 사라짐.
  2. 깃에 배포해줘.
- **원인 분석**:
  - `merchants.html` `<head>`에서 Leaflet JS를 사전 로드한 환경에서 `gmaps-leaflet-compat.js` 실행 시, `ensureLeaflet()`의 `if (window.L) return;` 구문으로 인해 컨트롤 컨테이너 CSS(`.gmaps-ctrl-container` 등) 스타일 주입이 누락됨.
  - 이로 인해 `map.controls[...].push()`로 추가된 우측 HUD 버튼(`mapHud`), 좌상단 전투 HUD(`combatHud`), 하단 스킬바(`skillBar`)가 정적 블록으로 지도 아래(420px 밖)로 밀려나 `overflow: hidden`에 의해 화면에서 잘림.
- **처리 내역**:
  - `assets/js/gmaps-leaflet-compat.js`:
    - `injectShimStyles()` 함수를 즉시 실행하도록 분리하여 컨테이너 스타일 무조건 주입.
    - Google Maps 12개 `ControlPosition` 전체를 위치별 클래스에 매핑.
    - 컨트롤 및 하위 버튼에 `L.DomEvent.disableClickPropagation` 및 `disableScrollPropagation` 적용하여 지도 제스처와의 간섭 차단.
    - `getAt`, `setAt`, `insertAt`, `removeAt`, `clear` 등 MVCArray 호환 메서드 추가.
  - `merchants.html` & `merchants-vn.html`:
    - `<style>` 태그에 `.gmaps-ctrl-container` 위치별 CSS를 직접 명시하여 첫 프레임부터 안정적으로 렌더링되도록 보강.
- **수정/추가 파일**:
  - `assets/js/gmaps-leaflet-compat.js` (신규 추가 및 개선)
  - `merchants.html`
  - `merchants-vn.html`
  - `assets/js/pages/merchants.js`
  - `assets/js/pages/merchants.battle.js`
  - `assets/js/pages/town_home.js`
  - `find_merchants.html`
  - `index.html`
- **검증 및 배포**:
  - Playwright 헤드리스 브라우저 테스트로 기능 버튼 13종, 전투 HUD, 스킬바 정상 노출 확인 완료.
  - Git 커밋: `3ac644b` (`fix(merchants): restore map HUD function buttons and control containers on Leaflet shim`)
  - 원격 저장소 푸시 완료 (`git push origin master`).

---

### [2026-10-18] 관리자 배틀 셋업 패널 닫기/최소화 토글 지원 및 전투 HUD 가림 방지

- **요청 일시**: 2026-10-18 09:08:22
- **요청 내용**:
  - HUD 기능 버튼 복원 후 관리자(`_isAdmin: true`) 계정으로 접속 시 좌측의 `adminBattlePanel` (⚔️ Battle Setup)이 지나치게 커서 상단의 `combatHud` (LV.1 HP/MP/EXP)를 완전히 덮어버리고, 하단 `skillBar` 좌측을 가리며, 패널을 닫거나 최소화할 수 있는 수단이 없던 현상 개선.
  - 좌하단의 몬스터 디버그 패널(`FS: 200 | Grid: 200...`) 기본 숨김 처리.
- **원인 분석**:
  - `adminBattlePanel` 내부 버튼 수가 25개 이상으로 전체 높이가 945px에 달함.
  - 420px 높이의 지도에서 `LEFT_BOTTOM`에 위치한 945px 요소가 위로 솟구쳐 Y = -314px(화면 밖/상단 전투 HUD 영역)까지 침범.
  - 패널 열기/닫기 토글 기능 및 상하 최대 높이(`max-height`) 제한이 없어 상단 전투 HUD(`combatHud`)와 하단 스킬바가 가려짐.
- **처리 내역**:
  - `merchants.html` & `merchants-vn.html`:
    - `#adminBattlePanel`을 `#adminBattleControlWrap` 컨테이너로 감싸고, 컴팩트한 `btnAdminPanelToggle` (`⚔️` 배틀 셋업 버튼) 추가.
    - 패널 상단 헤더에 `btnAdminPanelClose` (`✕ 닫기`) 버튼 추가.
    - 패널의 최대 높이를 `max-height: 250px;` (전체화면 시 `calc(100vh - 170px)`)로 제한하고, 버튼 목록 영역(`#abPanelBody`)에 세로 스크롤 적용.
    - 좌표 검색 지우기 버튼 라벨을 `✕`에서 `✕ 마커`로 변경하여 패널 닫기 버튼과의 혼선 방지.
  - `assets/js/gmaps-leaflet-compat.js`:
    - `.gmaps-ctrl-left-bottom`의 `max-height`를 `calc(100% - 155px)`로 제한하여 상단 컨트롤(`TOP_LEFT`)과의 물리적 충돌 차단.
  - `assets/js/pages/merchants.js`:
    - `map.controls[...LEFT_BOTTOM]`에 `#adminBattleControlWrap`을 등록하고, 관리자 권한 여부(`_isAdmin`)에 따라 토글 버튼 및 패널 노출.
    - `localStorage`(`admin_battle_panel_open`)를 통해 패널 열림/닫힘 상태를 유지하며, 기본값은 닫힌 상태(`⚔️` 미니 버튼만 표시)로 설정.
  - `assets/js/pages/merchants.battle.js`:
    - `_updateDebugPanel()`에서 `localStorage.getItem('show_monster_debug') === '1'`일 때만 `_monsterDebugPanel`을 표시하도록 변경 (기본 숨김 처리).
    - 관리자 배틀 패널에 `⚙️ Debug Overlay (FPS/Grid)` 토글 버튼 추가.
- **수정/추가 파일**:
  - `merchants.html`
  - `merchants-vn.html`
  - `assets/js/gmaps-leaflet-compat.js`
  - `assets/js/pages/merchants.js`
  - `assets/js/pages/merchants.battle.js`
  - `TASK_LOG.md`
- **검증 및 배포**:
  - 실제 실행 중인 `http://localhost:8080/merchants` 환경에서 자동화 검증 스크립트 실행:
    - 기본 상태: `adminBattlePanel`이 닫히고 `⚔️` 토글 버튼만 깔끔하게 노출됨.
    - 열린 상태: `combatHud`(bottom Y: 315)와 `adminBattlePanel`(top Y: 381) 사이에 66px의 안전 간격 확보 확인, 겹침(overlap) 없음.
  - Git 커밋: `34a31ed` (`fix(merchants): add admin battle panel toggle and prevent HUD overlap`)
  - 원격 저장소(`origin master`) 푸시 완료.

---

### [2026-10-18] 수퍼어드민 몬스터 배치 불가 오류 수정 및 Firestore/스프라이트 연동

- **요청 일시**: 2026-10-18 09:40:35
- **요청 내용**: 수퍼어드민이 몬스터를 원하는 장소에 배치할 수 없다.
- **원인 분석**:
  1. **Leaflet Shim의 `map.setOptions` 메서드 부재**:
     - `enterAdminPlaceMode()` 호출 시 `map.setOptions({ draggableCursor: 'crosshair' })`가 실행되나, `gmaps-leaflet-compat.js`의 `maps.Map` 클래스에 `setOptions`가 구현되어 있지 않아 `TypeError: map.setOptions is not a function` 예외가 발생함.
     - 이로 인해 이후 줄의 `map.addListener('click', ...)` 이벤트 등록 코드가 실행되지 못하고 중단되어 지도를 클릭해도 아무 동작도 일어나지 않음.
  2. **외부 게임서버(Railway) 오프라인 상태 시 몬스터 배치 완전 차단**:
     - 드래곤(`dragon`), 오크(`orc`, `orc2`, `orc3`), 해적(`pirate`, `pirate2`, `pirate3`), 좀비(`zombie1`, `zombie3`) 등 9종의 몬스터 배치 시 `isGameServerConnected()` 검사를 수행하여 미연결 시 `⚠️ Connecting to game server...` 알림과 함께 배치가 강제 중단됨.
     - 현재 Railway 게임서버가 오프라인 상태이므로 관리자가 몬스터를 전혀 배치할 수 없었음.
  3. **수퍼어드민 권한 체크 범위 누락**:
     - `merchants.js`에서 관리자 확인 시 `admins/{uid}` 컬렉션과 특정 이메일만 확인하고 있어, `users/{uid}`에 `role: 'SUPER_ADMIN'` 또는 `role: 'ADMIN'`으로 지정된 최고 관리자의 경우 `_isAdmin`이 활성화되지 않는 문제 존재.
  4. **좌표 마커 클릭 시 배치 이벤트 미연동**:
     - 좌표 검색(`abCoordGo`)으로 찍힌 핀 마커(`_coordMarker`)를 클릭할 경우 지도 클릭 이벤트가 전달되지 않던 현상.
- **처리 내역**:
  - `assets/js/gmaps-leaflet-compat.js`:
    - `maps.Map` 클래스에 `setOptions(opts)` 메서드 구현. `draggableCursor`, `zoom`, `center` 등 옵션을 Leaflet 컨테이너 및 맵에 즉시 반영하도록 지원.
  - `assets/js/pages/merchants.battle.js`:
    - `enterAdminPlaceMode()` 진입 시 기존 맵 클릭 리스너를 안전하게 해제(`removeListener`)하여 다중 클릭 중복 등록 방지.
    - 드래곤, 오크, 해적, 좀비 9종 몬스터 배치 시 Firebase Firestore `battle_monsters`에 영구 저장되도록 연동:
      - 게임서버 연결 여부와 무관하게 언제든 원하는 위치에 몬스터 즉시 배치 및 지도 렌더링(스프라이트 오버레이 포함) 가능.
      - 게임서버가 연결되어 있을 경우 실시간 게임서버 스폰(`gsAdminAddSpawn`)도 함께 동기화.
    - 일반 몬스터(`monster`) 배치 시 다중 prompt 취소에 대한 안전 종료 처리.
  - `assets/js/pages/merchants.js`:
    - 좌표 검색 마커(`_coordMarker`) 클릭 시 지도 클릭 이벤트(`map.click`)를 트리거하여 원하는 좌표 핀 바로 위에 몬스터를 배치할 수 있도록 지원.
    - 관리자 인증 시 `admins/{uid}`뿐만 아니라 `users/{uid}`의 `role in ['SUPER_ADMIN', 'CEO', 'ADMIN', 'admin']` 및 `isAdmin == true`까지 통합 검사하여 수퍼어드민 권한 완벽 보장.
- **수정/추가 파일**:
  - `assets/js/gmaps-leaflet-compat.js`
  - `assets/js/pages/merchants.battle.js`
  - `assets/js/pages/merchants.js`
  - `TASK_LOG.md`
- **검증 및 배포**:
  - Playwright 헤드리스 브라우저 테스트 실행:
    - `map.setOptions` 호출 성공 (에러 0건).
    - `btnPlaceDragon`, `btnPlaceMonster` 클릭 시 `placing` 클래스 활성화 및 맵 클릭 리스너 정상 트리거 확인.
    - `btnCancelPlace` 클릭 시 정상 취소 확인.
  - Git 커밋 및 원격 저장소(`origin master`) 푸시 완료.

---

### [2026-10-18] 우측 HUD 기능 버튼 모바일 최적화 그룹화 (Speed-Dial Flyout)

- **요청 일시**: 2026-10-18 17:40:07
- **요청 내용**: 게임 오른쪽 버튼이 너무 많아서 모바일에서 너무 불편하다. 비슷한 기능끼리 묶어줘.
- **원인 분석**:
  - 지도 우측 HUD에 총 13개의 버튼 및 배지(GP 배지, 충전, 게임시작, 가방, 내ID, 가이드, 상점, 무역선, 보물탐지기, AR스캔, 보물등록, 전체화면, BGM 등)가 세로 일렬로 길게 나열되어 있었음.
  - 모바일 디바이스(화면 높이 358px)에서 버튼 총 높이가 600px 이상을 차지하여 화면을 심하게 가리고 하단 스킬바(90px)와 겹쳐 조작이 극히 불편함.
- **처리 내역**:
  - **카테고리별 논리적 그룹화 (13개 -> 5개 상위 인터페이스로 대폭 축소)**:
    1. **상단 콤팩트 GP 배지 (`hudGpBadge`)**:
       - 💰 GP 잔액과 ⚡+ 충전 버튼을 높이 24px의 인라인 가로 알약형 배지로 일체화하여 세로 공간 절약.
    2. **단독 퀵 버튼**:
       - `btnGameToggle`: ▶ 게임 시작/접속 (핵심 플레이 기능)
       - `btnInventory`: 🎒 가방/인벤토리 (아이템 드랍 알림 뱃지 `dropNearbyBadge` 상시 노출 유지)
    3. **🧭 보물 & 탐색 그룹 (`wrapGroupTreasure`)**:
       - 메인 트리거 버튼: `btnGroupTreasure` (`🧭`, 보물 탐지기 동작 시 펄싱 보라색 도트 동기화)
       - 슬라이드 플라이아웃 서브메뉴: `btnDetector` (📡 탐지기), `btnArScan` (📷 AR스캐너), `btnRegisterTreasure` (📍 보물등록)
    4. **🏪 상점 & 무역 그룹 (`wrapGroupShop`)**:
       - 메인 트리거 버튼: `btnGroupShop` (`🏪`)
       - 슬라이드 플라이아웃 서브메뉴: `btnUserPlaceShop` (🏪 배치 상점), `btnHarborSv` (⛵ 무역선)
    5. **⚙️ 메뉴 & 설정 그룹 (`wrapGroupSystem`)**:
       - 메인 트리거 버튼: `btnGroupSystem` (`⚙️`)
       - 슬라이드 플라이아웃 서브메뉴: `btnMyId` (👤 프로필/내 ID), `btnTutHelp` (❓ 가이드), `btnFullscreen` (⛶ 전체화면), `btnBgm` (🎵 BGM), `distPanel` (거리측정)
  - **스타일 및 반응형 모바일 최적화 (`merchants.html`)**:
    - `.hud-group-wrap`: 상대 좌표 컨테이너 구성.
    - `.hud-group-flyout`: 모바일 및 데스크톱에서 터치/클릭 시 좌측으로 부드럽게 펼쳐지는 플라이아웃 알약 메뉴 (`hudFlyoutIn` 키프레임 애니메이션 적용).
    - `#wrapGroupSystem .hud-group-flyout`: 최하단 설정 메뉴는 위쪽 방향으로 자연스럽게 정렬되도록 `bottom: 0; top: auto;` 적용.
    - `@media (max-width: 640px)`: 버튼 크기 34px, 플라이아웃 버튼 31px, 갭 4px로 모바일 전용 압축 적용.
    - 모바일 기준 HUD 전체 높이를 **210px**로 압축하여, 지도 높이 358px 중 하단 스킬바(90px)를 제외한 268px 공간 내에 58px 이상의 여유 공간을 남기며 완벽하게 배치.
  - **이벤트 핸들러 및 상태 제어 (`assets/js/pages/merchants.js`)**:
    - Leaflet/Gmaps 컨트롤 위치를 기존 `RIGHT_BOTTOM`에서 `RIGHT_TOP`으로 변경하여 하단 스킬바 영역과의 간섭 원천 차단.
    - 그룹 트리거 버튼 탭 시 상호 배타적 토글(한 그룹을 열면 다른 그룹은 자동 닫힘) 구현.
    - 지도 바깥 또는 다른 곳을 터치하면 서브메뉴가 자동으로 닫히는 외부 탭 리스너 추가.
    - 보물 탐지기 활성화/비활성화 시 `btnGroupTreasure`에 펄싱 보라색 인디케이터 도트(`_updateTreasureGroupDot`) 실시간 연동.
- **수정/추가 파일**:
  - `merchants.html`
  - `assets/js/pages/merchants.js`
  - `TASK_LOG.md`
- **검증 및 배포**:
  - Playwright 헤드리스 브라우저 테스트 (데스크톱 및 모바일 Pixel 7 환경):
    - 모바일 뷰포트에서 기본 닫힘, 🧭 보물 그룹 열림, 🏪 상점 그룹 열림, ⚙️ 설정 그룹 열림의 모든 상태 렌더링 및 클릭 상호작용 검증 완료.
    - 하단 스킬바 및 상단 HUD와의 겹침(overlap) 0건 확인.
  - Git 커밋 및 원격 저장소(`origin master`) 배포 완료.

---

### [2026-10-18] 몬스터 공격 불가 원인 해결 (사망/사거리 피드백 및 즉시 부활/이동 지원)

- **요청 일시**: 2026-10-18 19:04:31
- **요청 내용**: 몬스터를 공격할 수 없다.
- **원인 분석**:
  1. **플레이어 사망(Dead) 상태에서의 조용한 무시 (Silent Return)**:
     - 스크린샷 확인 결과 캐릭터가 오크의 공격을 받아 HP 0 / 1000 상태로 사망(`💀 Dead — Auto-reviving in 10s...`)해 있었음.
     - `castLightning` 등 5종의 마법 스킬 함수와 몬스터 마커 클릭 시 `if (_isDead) return;`으로 인해 화면에 아무런 피드백 없이 조용히 무시되어 유저는 게임이 멈추거나 공격 기능이 고장 난 것으로 오인함.
  2. **공격 사정거리(Range) 초과 및 피드백 부재**:
     - 평타 공격은 `30m`, 마법 스킬은 `40m` 사정거리를 가짐.
     - 스크린샷 상 유저 위치(💀)와 배치된 오크 사이의 거리가 약 100m 이상 떨어져 있었으나, 거리 초과 시 "사정거리 초과" 알림이 없어 왜 공격이 안 되는지 알 수 없었음.
  3. **사망 시 대기 시간(15초) 중 즉시 부활 수단 부재**:
     - 사망 후 15초 카운트다운 동안 캐릭터가 무방비/행동 불능 상태에 빠지며, 관리자가 테스트할 때 즉시 부활할 수 있는 수단이 없었음.
  4. **모바일/Leaflet 환경에서 스프라이트 오버레이 클릭 제스처 충돌**:
     - `merchants.monster-sprite.js`의 `div`에 Leaflet 제스처 전파 방지(`L.DomEvent.disableClickPropagation`)가 누락되어 몬스터 탭 시 지도가 이벤트를 가로채 몬스터 클릭이 씹히는 문제.
- **처리 내역**:
  - **사망 상태 피드백 및 원터치 즉시 부활 지원 (`assets/js/pages/merchants.battle.js`)**:
    - 모든 스킬 및 마커 클릭 시 사망 상태이면 `💀 사망 상태입니다. [⚡ 즉시 부활]을 누르거나 부활을 기다려주세요!` 명확한 토스트 피드백 표시.
    - 전투 HUD `cDead`에 `[⚡ 즉시 부활]` 버튼을 추가하여 대기 시간 없이 원터치로 풀피(HP/MP 100%) 즉시 부활 가능 (`revivePlayerAdmin`).
    - 관리자 배틀 패널(`adminBattlePanel`)에 `🪄 즉시 부활 & 완충 (HP/MP 100%)` 버튼 신규 추가.
  - **사정거리 안내 및 관리자 이동 지원 (`assets/js/pages/merchants.battle.js`, `merchants.js`)**:
    - `_getNearestMonster(myLat, myLng)` 헬퍼 함수를 구현하여, 사거리 초과 시 가장 가까운 몬스터의 현재 거리와 사거리를 화면에 실시간 안내 (`🎯 사정거리 초과! 거리: 85m / 사거리: 40m`).
    - 관리자(`_isAdmin`)의 경우 편의를 위해 스킬 및 평타 사정거리를 150m~200m로 대폭 확장.
    - 몬스터 인포윈도우에 관리자용 `🏃 이 위치로 이동` 버튼 추가 (`window.__warpToMob`)하여 몬스터 코앞으로 즉시 이동하여 바로 공격할 수 있도록 지원.
  - **스프라이트 몬스터 터치/클릭 반응성 개선 (`assets/js/pages/merchants.monster-sprite.js`)**:
    - `L.DomEvent.disableClickPropagation(div)` 및 `disableScrollPropagation(div)` 적용.
    - 모바일 터치 대응을 위해 디바운스된 `touchend` 이벤트 핸들러 추가.
- **수정/추가 파일**:
  - `assets/js/pages/merchants.battle.js`
  - `assets/js/pages/merchants.js`
  - `assets/js/pages/merchants.monster-sprite.js`
  - `merchants.html`
  - `TASK_LOG.md`
- **검증 및 배포**:
  - Playwright 헤드리스 브라우저 테스트 완료:
    - `window.__adminFullRevive()` 실행 및 풀피 회복 정상 검증.
    - 관리자 패널 `#btnAdminFullRevive` 및 `window.__warpToMob` 정상 동작 확인.
  - Git 커밋 및 원격 저장소(`origin master`) 배포 완료.

---

### [2026-10-18] 주인공 화살 사냥 불가 오류 수정 및 자동 타겟팅/실시간 HP 연동

- **요청 일시**: 2026-10-18 19:11:14
- **요청 내용**: 주인공이 몬스터를 화살로 사냥할 수 없다.
- **원인 분석**:
  1. **초기 플레이어 위치 및 마커 부재**: 게임 시작(▶) 버튼을 누르기 전이거나 GPS 수신 전에는 `_ctx.myLocationMarker`와 `_ctx.lastPos`가 모두 `undefined/null`이어서, `getMyPos()`에서 `myLat == null`로 판단되어 화살 발사가 "위치 정보를 확인 중입니다" 에러와 함께 즉시 차단됨.
  2. **Leaflet Shim 픽셀 좌표 오차**: `latLngToPixel`에서 `map._lmap.latLngToContainerPoint` 대신 Google Maps 투영법을 거쳐 화살 궤적과 타격 좌표가 화면 좌표와 어긋남.
  3. **스프라이트 몬스터 오버레이 실시간 HP 갱신 누락**: `hitMonster()`에서 `_monsterOverlays[monsterId]?.updateMonster(mob)` 호출이 누락되어, 화살을 맞아도 몬스터 머리 위의 HP 바가 실시간으로 줄어들지 않음.
  4. **몬스터 클릭 시 화살 공격 직결 부재**: 몬스터를 클릭/탭했을 때 인포윈도우만 열리고 화살을 즉시 쏘는 메커니즘이 부족했음.
  5. **사정거리 제한**: 기본 30m~40m로 너무 짧아 화면 내 보이는 몬스터에게 화살을 쏘려 할 때 "사정거리 초과"가 빈번히 발생함.
- **처리 내역**:
  1. **플레이어 위치 자동 폴백 및 마커 자동 소환 (`assets/js/pages/merchants.battle.js`, `assets/js/pages/merchants.js`)**:
     - `getMyPos()` 개선: 마커나 GPS 좌표가 없더라도 `map.getCenter()`(지도 중심)를 폴백으로 읽고 `updateMyLocation`을 호출하여 주인공 캐릭터 마커를 즉시 소환하고 좌표 반환.
     - `initMap()` 완료 시점에도 기본 위치(`20.9947, 105.9487`)로 플레이어 마커를 즉시 소환하여 첫 화면부터 활을 든 주인공이 대기하도록 처리.
  2. **화살 공격 시스템 전면 구현 (`shootArrowAtMonster`, `attackNearestWithBow`)**:
     - 사정거리를 120m (관리자는 500m)로 대폭 확장하고, 연사 디바운스를 0.4초로 신속하게 개선.
     - 활 쏘기 시 캐릭터가 몬스터 방향으로 회전(`setFacing`)하고 활 당기기 모션(`setState('attack')`) 재생.
     - 활 끝 픽셀 위치(`getBowPixel()`)에서 몬스터 중심까지 고속 화살 투사체(`.arrow-proj`) 및 피격 플래시(`.hit-flash`) 애니메이션 연결.
     - 피격 시 몬스터 머리 위에 빨간색 데미지 텍스트(`.dmg-float`) 표시.
     - 키보드 `A` 키 및 `Space` 키 입력 시 사정거리 내 가장 가까운 몬스터를 자동 타겟팅하여 화살 사격(`attackNearestWithBow`).
  3. **실시간 HP 바 감소 및 사망/보상 완벽 연동**:
     - `hitMonster(monsterId, damage, mobRef)`에서 스프라이트 오버레이 `overlay.updateMonster(mob)`를 실시간 호출하여 몬스터 체력 바가 실시간으로 줄어들도록 연동.
     - HP가 0이 되면 사망 사운드, EXP/GP/마정석 드랍 및 사망 애니메이션(`dyingOverlay.playDeathAndRemove()`) 정상 발동.
  4. **몬스터 클릭 직결**:
     - 스프라이트 몬스터 및 SVG 몬스터 마커 클릭 시 즉시 `shootArrowAtMonster(mob)`로 화살 발사.
     - 인포윈도우에도 `[🏹 화살 사격]` 버튼을 추가하여 어디서든 원클릭 화살 사격 지원.
- **수정/추가 파일**:
  - `assets/js/pages/merchants.battle.js`
  - `assets/js/pages/merchants.js`
  - `TASK_LOG.md`
- **검증 및 배포**:
  - Playwright 헤드리스 브라우저 테스트(`scratch_test_arrow_hunt.cjs`) 수행:
    - `shootArrowAtMonster` 성공 (`success: true`, `.arrow-proj`, `.hit-flash` 생성)
    - 몬스터 HP 1000 -> 940 감소 확인 (`damageDealt: 60`)
    - 체력 0 도달 시 사망 처리 (`mobHp: 0, isDead: true`) 확인
    - `attackNearestWithBow` 단축키 자동 타겟팅 화살 사격 및 데미지 적용 정상 확인.
  - Git 커밋: `9b46d27` (`fix(battle): allow player to hunt monsters with bow and arrow`)
  - 원격 저장소(`origin master`) 푸시 완료.

---

### [2026-10-18] 일반 유저 관리자 배틀셋업 오작동 차단 및 몬스터 화살 사냥 연동

- **요청 일시**: 2026-10-18 20:32:19
- **요청 내용**:
  1. 몬스터 클릭하면 화살은 안 날리고 "No hidden treasure boxes within 100m" (100m 이내 보물박스가 숨겨져 있지 않다) 라고만 한다.
  2. 관리자 모드도 아닌데 관리자 모드 배틀셋업이 가능함. 일반 유저 계정으로 로그인했음. 이런 부분은 실수하면 안 됨.
- **원인 분석**:
  1. **하드코딩된 특정 이메일 자동 관리자 부여 버그**:
     - `merchants.js`의 권한 검증부에 `_userEmail === 'daguri75@gmail.com'`이 하드코딩되어 있어, 사용자가 일반 유저 플레이(무료 일반 회원 테스트)를 목적으로 해당 계정으로 로그인했음에도 DB 권한과 무관하게 무조건 `_isAdmin = true`가 강제 부여됨.
     - 이로 인해 일반 유저 화면에 `Battle Setup` 패널(`adminBattleControlWrap`)이 노출되고, 지도 클릭 시 관리자 전용 기능인 숨김 보물박스 탐색(`_adminRevealNearbyHiddenBoxes`)이 활성화됨.
  2. **몬스터 클릭 시 지도 클릭 이벤트 전파(Bubbling) 및 보물박스 탐색 팝업 중복 발생**:
     - `gmaps-leaflet-compat.js`의 `Marker` 및 `merchants.monster-sprite.js` 오버레이 `div`에서 Leaflet 지도 클릭 이벤트로의 전파 차단(`stopPropagation`)이 불완전하여, 몬스터 클릭 시 지도의 `click` 리스너가 동시에 트리거됨.
     - 1번 원인으로 인해 `_isAdmin === true`였기 때문에 지도의 `_adminRevealNearbyHiddenBoxes`가 실행되어 인포윈도우에 `No hidden treasure boxes within 100m`가 덮어씌워져 표시됨.
  3. **게임 서버(GS) 연결 시 몬스터 클릭 사정거리(40m) 차단 및 화살 사격 누락**:
     - 게임 서버가 연결된 상태(`Connected`)에서 GS 몬스터 클릭 시 40m 사정거리 초과 체크에 걸려 공격이 즉시 취소되고 화살이 발사되지 않음.
- **처리 내역**:
  1. **하드코딩된 이메일 관리자 권한 완전 제거 및 엄격한 DB 권한 검증 (`assets/js/pages/merchants.js`)**:
     - `_userEmail === 'daguri75@gmail.com'` 하드코딩을 완전히 제거.
     - 오직 Firestore `admins/{uid}` 컬렉션 등록 여부 및 `users/{uid}`의 `role`(`SUPER_ADMIN`, `ADMIN`, `CEO`, `isAdmin === true`)로만 관리자 여부를 판정하도록 수정.
     - 일반 유저 로그인 시 `_isAdmin = false`, `_ctx.isAdmin = false`로 철저히 제한.
  2. **관리자 배틀 셋업 패널 기본 숨김 및 일반 유저 완전 차단 (`merchants.html`, `merchants-vn.html`, `assets/js/pages/merchants.js`)**:
     - HTML 마크업에서 `#adminBattleControlWrap`의 기본 스타일을 `display: none`으로 설정.
     - `_isAdmin`이 false인 일반 유저 환경에서는 패널(`adminBattlePanel`), 래퍼(`adminBattleControlWrap`), 토글 버튼(`btnAdminPanelToggle`)을 일체 노출하지 않도록 완벽 차단.
  3. **몬스터 및 마커 클릭 이벤트 전파 차단 (`assets/js/gmaps-leaflet-compat.js`, `assets/js/pages/merchants.monster-sprite.js`)**:
     - Leaflet Shim의 `Marker` 클릭 이벤트에 `window.L.DomEvent.stopPropagation(e)`를 추가하여 지도 클릭 이벤트와의 간섭 원천 차단.
     - 스프라이트 오버레이 `div`에 `pointerdown`, `mousedown`, `click`, `touchend` 전체에 `stopPropagation()` 및 `L.DomEvent.stopPropagation`을 적용하여 몬스터 탭 시 지도가 클릭되는 현상 해결.
  4. **게임 서버(GS) 몬스터 화살 사냥 연동 및 사정거리 120m 통일 (`assets/js/pages/merchants.js`, `assets/js/pages/merchants.battle.js`)**:
     - GS 몬스터 클릭 시에도 40m 제한을 없애고 120m (관리자는 500m) 화살 사정거리로 확장.
     - 주인공 캐릭터가 몬스터를 바라보며 활을 당기는 모션 및 고속 화살(`.arrow-proj`) 투사체 비행, 타격 효과음 및 데미지 플로팅, 서버 공격 전송(`sendPlayerAttack`) 일원화 연동.
- **수정/추가 파일**:
  - `assets/js/pages/merchants.js`
  - `assets/js/pages/merchants.battle.js`
  - `assets/js/pages/merchants.monster-sprite.js`
  - `assets/js/gmaps-leaflet-compat.js`
  - `merchants.html`
  - `merchants-vn.html`
  - `TASK_LOG.md`
- **검증 및 배포**:
  - Playwright 자동화 테스트 수행:
    - 비관리자 계정 접속 시 `adminBattleControlWrap` 및 `adminBattlePanel`이 `display: none`으로 완벽히 숨겨짐 검증.
    - 지도 바탕 클릭 시 `No hidden treasure boxes within 100m` 인포윈도우 미노출 검증.
    - 몬스터 클릭 시 숨김 보물박스 팝업 없이 화살 투사체(`.arrow-proj`) 정상 발사 및 피격 플래시(`.hit-flash`) 정상 출력 검증 완료.
  - Git 커밋: `a68e9f3` (`fix(auth/battle): restrict admin battle setup to authorized roles and fix monster click arrow hunting`)
  - 원격 저장소(`origin master`) 푸시 완료.

