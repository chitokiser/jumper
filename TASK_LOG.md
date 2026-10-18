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
