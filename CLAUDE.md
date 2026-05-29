```markdown
# CLAUDE.md — Jumper v10

## 필수 규칙
- 수정 전 반드시 파일 전체 Read
- 가격 표시: KRW / VND / HEX 동시 표시
- 상품 가격 기준은 HEX
- pending changes 10개 이상 → git push
- 변경사항 20개 이상 → git push + 게임서버 railway up
- Functions 배포:
  firebase deploy --only functions
- 단일 함수 배포 금지

---

## 기본 구조
- HTML ↔ assets/js/pages 1:1 대응
- 복잡한 페이지는 .lib.js / .render.js / .hero.js 분리
- 공통 헤더/푸터:
  partials.js 사용
  (#siteHeader / #siteFooter 필수)

---

## 블록체인
- opBNB Mainnet
- ethers.js v6
- HEX = 플랫폼 포인트 (18dec)
- JUMP = 거래토큰 (0dec)
- BNB = gas

---

## 결제 규칙
- 가격 입력은 HEX 기준
- KRW/VND 환율 자동 계산 표시
- 수수료/환율 하드코딩 금지
- Firestore 또는 컨트랙트 조회 사용

---

## 정회원 시스템
- coop.html 에서 10 HEX 결제 시 정회원
- 기간: 가입 후 12개월
- 만료 후 재가입 필요
- merchants.html 정회원전용 보물박스 획득은 정회원만 가능

---

## 역할 판정
반드시:
getUserRole(uid)

순서:
1. admin
2. approved guide
3. users.role
4. user / guest

---

## Cloud Functions
- WALLET_MASTER_SECRET 사용
- ADMIN_PRIVATE_KEY 사용
- requireAuth()
- requireAdmin()
- wrapError()

---

## 성능 / 서버 부하 최소화
- Firestore 쿼리는 반드시 필요한 시점에만 실행 (페이지 로드 즉시 금지)
- 뷰포트 진입 시 로드: IntersectionObserver 사용 (threshold: 0.1)
- 메모리 캐시 → localStorage 캐시(TTL) → Firestore 순서 우선
- 랭킹·목록 쿼리: where 필터로 불필요한 문서 스캔 제거
- 이미지 프리로드: 실제 필요 시점(게임 시작·모달 열기)에만 실행
- 모듈 최상단 preload 금지 — lazy load 원칙
- Promise.race + 타임아웃(10s) 추가로 무한 로딩 방지
- Firestore rules: 공개 데이터는 if true, 인증 필요 데이터만 signedIn()

---

## DOM 최적화
- querySelector 반복 금지
- DOM 초기 캐싱 필수
- innerHTML 루프 반복 금지
- 부분 렌더링 우선
- style.display 금지
- classList hidden 사용

---

## 이벤트 규칙
- scroll/resize throttle 100ms
- mousemove 50ms
- search debounce 350ms
- passive:true 사용
- onSnapshot/setInterval/watchPosition cleanup 필수

---

## 금지사항
- console.log 프로덕션 금지
- 하드코딩 최소화
- 단일 함수 deploy 금지
- cleanup 없는 interval 금지

---

## 파일 크기
- 기능 JS: 300줄
- 페이지 JS: 700줄
- Function handler: 1200줄
- CSS: 600줄
초과 시 분리

---

## Geocoding
- Nominatim 사용
- Google Geocoding API 금지

---

## Firebase 초기화
- firebase-init.js
- firestore-bridge.js

---

## 다국어 규칙
기본 언어:
- English

추가:
- Korean
- Vietnamese

모든 게임 메시지:
ko / en / vi 동시 추가 필수

---

## 게임 서버 규칙
- notify 이벤트 사용
- i18n.ts MESSAGES 등록 필수
- snake_case 키 사용
- player:join 시 lang 포함
- socket.on('notify') 처리

---

## 게임 서버 배포
git push 후 반드시:
cd game-server && railway up

---

## 커밋 규칙
type: summary

type:
- feat
- fix
- refactor
- perf
- style
- docs
- chore
```

## 구글 검색엔진 등록 유지
- 구글검색엔진 확인된 상태 유지 할것
- 검색엔진 신뢰도 높일 것
- 보물숨기기— 보물찾기
- 지오캐싱과 포켓몬고를 뛰어넘는 플랫폼
- 가맹점 이용시 물약 & 잭팟
-

## SEO 규칙
- 모든 공개 페이지: title / description / og / twitter 메타 필수
- title 형식: "페이지명 | JumpDAO — 부제"
- 핵심 키워드: 베트남여행, 공항보물찾기, 위치기반게임, Web3, AR보물
- canonical URL 필수
- robots.txt: Sitemap 경로 포함 유지
- sitemap.xml: 공개 페이지만 포함, admin/* 제외


## 유저 id를 표시해야 할때 
-가입 당시 입력한 이름을 사용한다

---

## Firestore 읽기 규칙 (과다 읽기 방지)

### onSnapshot 금지 패턴
- **전체 컬렉션 onSnapshot 절대 금지** — 반드시 where 필터 포함
  ```js
  // 금지
  onSnapshot(collection(db, 'battle_players'), ...)
  // 허용
  onSnapshot(query(collection(db, 'battle_players'), where('geohash7', 'in', cells)), ...)
  ```
- **`includeMetadataChanges: true` 금지** — 모든 이벤트 2배 발화, 명시적 필요 없으면 사용 금지
- onSnapshot과 setInterval 폴링이 **같은 데이터를 중복 구독 금지** — 하나만 사용

### 반복 호출 함수 캐시 필수
- `loadInventory()`, `loadPlayerState()`, `loadShops()` 등 반복 호출 함수는 **30초 TTL 캐시** 필수
- 캐시 패턴:
  ```js
  let _lastFetch = 0;
  const CACHE_MS = 30000;
  async function loadXxx({ force = false } = {}) {
    if (!force && Date.now() - _lastFetch < CACHE_MS) { /* 캐시 렌더만 */ return; }
    _lastFetch = Date.now();
    // Firestore 읽기...
  }
  ```
- 실제 데이터 변경 시(구매·제작·수리 등)만 `{ force: true }` 사용

### 폴링 간격 기준
- 근처 유저/위치 폴링: **최소 30초**
- 위치 쓰기 (`user_locations`): **최소 5초 + 5m 이상 이동 시만**
- 배틀 루프: 게임 서버 WebSocket 이벤트 기반, Firestore 폴링 금지

---

## GPS 보안 규칙 (위치 우회 방지)

### _ctx.gpsPos vs _ctx.lastPos
- **`_ctx.gpsPos`** — 보안용. `navigator.geolocation` 콜백에서만 설정. 절대로 맵 센터·기타 값으로 대체 금지
- **`_ctx.lastPos`** — 렌더링용. 맵 패닝 시 갱신 가능 (PC 모드 지원)
- 거리 검증(상점·보물 등)은 반드시 `_ctx.gpsPos` 사용

### map idle 리스너 금지 패턴
```js
// 금지 — GPS가 있어도 맵 센터로 덮어쓴다
if (!_ctx.lastPos || _ctx.lastPos.accuracy > 5) {
  _ctx.lastPos = { lat: c.lat(), lng: c.lng() };
}
// 허용 — 실제 GPS 없을 때만
if (_ctx.gpsPos) return;
if (!_ctx.lastPos) { _ctx.lastPos = { lat: c.lat(), lng: c.lng() }; }
```

### 백엔드 거리 검증 원칙
- Cloud Functions에서 클라이언트 제공 `lat/lng` **신뢰 금지**
- 거리 검증 시 `battle_players/{uid}` Firestore 저장 위치 사용
- 저장 위치 `updatedAt` 10분 초과 시 거부
  ```js
  const playerLoc = (await db.collection('battle_players').doc(uid).get()).data();
  if (!playerLoc?.lat || Date.now() - playerLoc.updatedAt.toMillis() > 600000)
    throw new HttpsError('failed-precondition', 'GPS 위치 확인 불가');
  ```