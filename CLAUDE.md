# CLAUDE.md — Jumper v10

## 필수
- 수정 전 파일 전체 Read 필수
- 가격 표시: KRW / VND / HEX 동시
- pending changes 10개↑ → git push
- 변경 20개↑ → git push + `cd game-server && railway up`
- Functions 배포: `firebase deploy --only functions` (단일 함수 배포 금지)

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

## 다국어 — ko / en / vi 동시 추가 필수
- 기본 언어: English
- 게임 메시지 전부 3개 언어

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

## Firebase 초기화
`firebase-init.js` / `firestore-bridge.js`

## 유저 ID 표시
가입 당시 입력한 이름 사용
