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
  - Git 커밋 및 원격 저장소(`origin master`) 푸시 완료.

