# CLAUDE.md — Jumper v10

## 필수
- 수정 전 파일 전체 Read 필수
- 가격 표시: KRW / VND / HEX 동시
- pending changes 10개↑ → git push
- 변경 20개↑ → git push + `cd game-server && railway up`
- Functions 배포: `firebase deploy --only functions` (단일 함수 배포 금지)

## 실행 환경
- **bot.py (텔레그램 봇)** → Railway에서 실행 중 — 수정 후 Railway 재배포 필요
- **game-server** → Railway에서 실행 중 (`cd game-server && railway up`)

## ⚠️ CF 에러 처리 — CORS 버그 방지 (반복 발생 패턴)
- **Cloud Functions 핸들러에서 `throw new Error(...)` 절대 금지 — 반드시 `HttpsError` 사용**
- 이유: Gen2 `onCall`은 `HttpsError`만 CORS 헤더를 포함한 응답으로 직렬화함. 일반 `Error`는 Cloud Run이 500을 직접 반환 → 브라우저에서 CORS 오류로 보임 (실제 원인 은닉)
- import: `const { HttpsError } = require('firebase-functions/v2/https');`
- 에러 코드 선택: `invalid-argument` (입력값 오류) / `failed-precondition` (GP 부족 등) / `already-exists` / `not-found` / `permission-denied`
- 좌표 null 체크: `!lat` 금지 (lat=0 적도 실패) → `lat == null || lng == null` 사용
- 에러 메시지는 영어로 작성 (CLAUDE.md 언어 정책)

## ⚠️ 나무묘목(Money Tree) 절대 손대지 마라 (반복 발생 버그)
- **merchants.js / moneytree.js / moneyTree.js(Functions) 수정 후 반드시 확인:** 묘목 심기 → 지도에 나무 표시 정상 여부
- 묘목이 소모됐는데 나무가 안 보이면 유저 실제 손해 — 코드 한 줄 바꿔도 moneytree 플로우 전체 테스트 필수
- `window.showToast = showToast;` (merchants.js 하단) — 의도적 노출, 절대 삭제 금지
- `loadMoneyTreeMarkers` 는 심기 성공 후 즉시 호출됨 — 이 호출 체인 끊으면 나무 안 보임
- moneytree 모듈은 Cloud Functions 전용 (`httpsCallable`) — 직접 Firestore 읽기 추가 금지
- **`openPlantModal`에 `isServerConnected` / `_gameStarted` 조건 절대 추가 금지** — 나무 심기는 CF 전용 작업, 게임서버 연결과 무관. 이 체크가 3번 반복 삽입돼 매번 묘목 심기를 완전히 차단했음

## ⚠️ 전체화면 모달 필수 규칙 (반복 발생 버그)
- **모든 모달/오버레이는 반드시 `data-fs-modal` 속성 부착**
- 전체화면 진입 시 `_moveModalsToFs()`가 이 속성을 가진 요소를 fullscreen 컨테이너로 이동
- 없으면 전체화면에서 모달이 보이지 않음 (body에 고정되어 fullscreen 레이어 아래 숨겨짐)
- `FS_MODALS` 배열(merchants.js)에 ID를 추가하거나 `data-fs-modal` 속성 둘 중 하나 필수
- **동적으로 생성하는 모달도 예외 없이 적용**

---

## 구조
- HTML ↔ assets/js/pages 1:1 대응
- 복잡한 페이지: `.lib.js` / `.render.js` / `.hero.js` 분리
- 공통 헤더/푸터: `partials.js` (`#siteHeader` / `#siteFooter`)

---

## 블록체인
- opBNB Mainnet / ethers.js v6
- HEX = 플랫폼 포인트 (18dec), JUMP = 거래토큰 (0dec), BNB = gas
- 가격 입력은 HEX 기준, 환율 하드코딩 금지 (Firestore 또는 컨트랙트 조회)

---

## 온체인 가스비 절약 (최우선)
- **이벤트마다 온체인 쓰기 금지** — XP 획득·이동 등 빈번한 이벤트는 Firestore만
- **배치 지연 동기화** — 플래그(`pendingOnChainSync: true`) → 스케줄러 6시간 배치
- **최종 상태만 1tx** — 레벨 1→5 올라도 `adminSetLevel(5)` 1tx
- **관리자 지갑 우선** — 보상·레벨·포인트는 adminSetLevel/adminCreditHex 사용
- 온체인 저장 허용: 결제 / 레벨업 배치 / 지갑 최초 등록 / 관리자 명시 요청만

---

## Cloud Functions
- `requireAuth()` / `requireAdmin()` / `wrapError()` 필수
- Secrets: `WALLET_MASTER_SECRET`, `ADMIN_PRIVATE_KEY`
- 핸들러 파일에서 `firebase-functions` 직접 import 금지 — `index.js`에서만

---

## 역할 판정 — `getUserRole(uid)` 순서
1. admins/{uid} → admin
2. guides/{uid}.approved === true → guide
3. users/{uid}.role → 해당 role
4. 기본 → user / guest

---

## 정회원
- coop.html 10 HEX 결제 → 12개월 정회원
- 정회원 전용 보물박스는 정회원만 획득 가능

---

## Firestore 읽기 최적화
- 쿼리는 필요 시점에만 (페이지 로드 즉시 금지)
- 전체 컬렉션 onSnapshot 금지 — where 필터 필수
- `includeMetadataChanges: true` 금지
- 반복 호출 함수: 30초 TTL 캐시 필수
- 폴링: 위치 최소 30초, 위치 쓰기 최소 5초 + 5m 이동 시만

---

## GPS 보안
- `_ctx.gpsPos` — 보안용, `navigator.geolocation` 콜백에서만 설정
- `_ctx.lastPos` — 렌더링용 (맵 패닝 시 갱신 가능)
- 거리 검증은 반드시 `_ctx.gpsPos` 사용
- Cloud Functions: 클라이언트 lat/lng 신뢰 금지, `battle_players` 저장 위치 사용

---

## DOM / 이벤트
- `querySelector` 반복 금지 — 초기 캐싱 필수
- `style.display` 금지 — `classList.hidden` 사용
- `innerHTML` 루프 금지 — 부분 렌더링 우선
- scroll/resize throttle 100ms, mousemove 50ms, search debounce 350ms
- `passive: true` 사용
- onSnapshot / setInterval / watchPosition cleanup 필수

---

## 금지
- `console.log` 프로덕션 금지
- 하드코딩 최소화
- cleanup 없는 interval 금지
- Google Geocoding API 금지 → Nominatim 사용
- 풀스크린 모달 추가 시 `data-fs-modal` 속성 부착 (FS_MODALS 목록 자동 포함)

---

## 파일 크기 한도 (초과 시 분리)
기능 JS 300줄 / 페이지 JS 700줄 / Function handler 1200줄 / CSS 600줄

---

## 언어 정책
- **게임 내 안내·토스트·알림·버튼·모달 문구는 무조건 English** (주 사용자: 영어권)
- 한국어·베트남어 병기 금지 — 게임 UI는 영어 단일
- 관리자 페이지(admin/*)·CLAUDE.md·커밋 메시지는 한국어 허용
- Cloud Functions 에러 메시지도 영어로 작성

---

## 게임 서버
- notify 이벤트 사용, i18n.ts MESSAGES 등록, snake_case 키
- player:join 시 lang 포함, socket.on('notify') 처리

---

## SEO (공개 페이지 전부)
- title / description / og / twitter 메타 필수
- title 형식: `"페이지명 | JumpDAO — 부제"`
- canonical URL 필수, sitemap.xml에 admin/* 제외

---

## 커밋
`feat` / `fix` / `refactor` / `perf` / `style` / `docs` / `chore`

---

## API 키 / 시크릿 노출 금지
- **HTML·JS 소스에 API 키 직접 하드코딩 금지** — Firebase config, Maps 키 포함
- Firebase config: `assets/js/firebase-config.js` 에만 보관, HTML `<script>` 인라인 주입 금지
- `window.firebaseConfig` 인라인 블록 HTML에 추가 금지 — `firebase-init.js`가 자동으로 `firebase-config.js` 로드
- Google Maps 키: 반드시 `window.__mapsKey` 패턴만 허용 (HTML 최상단 1곳만, 중복 금지)
- `.env` / 개인키 / 서버 시크릿은 절대 커밋 금지

---

## Firebase 초기화
`firebase-init.js` / `firestore-bridge.js`

## 유저 ID 표시
가입 당시 입력한 이름 사용
