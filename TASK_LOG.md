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



