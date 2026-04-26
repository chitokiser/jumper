# 코딩 원칙 — Jumper v10

Claude Code가 이 프로젝트에서 작업할 때 **반드시 준수해야 할 원칙**입니다.

---

## 0. 필수 규칙

- **파일을 수정하기 전에 반드시 Read로 전체 내용을 먼저 읽는다.**
- **가격·금액을 표시할 때는 KRW / VND / HEX 세 가지를 모두 표시한다.**
- **Source Control pending changes가 10개 이상이면 자동으로 GitHub에 push한다.**
- **배포: `firebase deploy --only functions` (단일 함수 배포 금지 — timeout 오류).**

---

## 1. 프로젝트 구조

### 주요 페이지 (HTML ↔ `assets/js/pages/` 1:1 대응)

| 파일 | 설명 |
|------|------|
| `index.html` | 메인 (town_home) |
| `mypage.html` | 마이페이지 (지갑, 바우처, 거래내역) |
| `coop.html` | 협동조합 몰 — 상품 목록/구매 |
| `coop-mall.html` | CoopMall 회원/포인트/바우처 관리 |
| `dao.html` | DAO 거버넌스 |
| `wallet.html` | 수탁 지갑 (HEX 입출금) |
| `exchange.html` | HEX ↔ JUMP 거래소 |
| `buggy.html` / `buggy-driver.html` / `buggy-admin.html` | 탈것 앱 |
| `admin_coop.html` / `admin_jackpot.html` | 어드민 |
| `merchants.html` | 가맹점 (게임 포함) |
| `zalopay.html` | ZaloPay KRW→HEX 충전 |

복잡한 페이지는 `.lib.js`, `.render.js`, `.hero.js` 서브모듈로 분리.

### Cloud Functions (`functions/`)

| 경로 | 역할 |
|------|------|
| `functions/index.js` | 모든 함수 진입점 |
| `functions/handlers/coop.js` | 협동조합 몰 |
| `functions/handlers/dao.js` | DAO |
| `functions/handlers/buggy.js` | 탈것 |
| `functions/handlers/exchange.js` | HEX ↔ JUMP 거래소 |
| `functions/handlers/deposit.js` | HEX 입금 |
| `functions/handlers/transaction.js` | 거래 내역 |
| `functions/handlers/zalopay.js` | ZaloPay |
| `functions/handlers/treasure.js` | 잭팟/보물상자 |
| `functions/handlers/onboarding.js` | 가입/지갑 생성 |
| `functions/wallet/chain.js` | ethers.js v6 — opBNB RPC, 컨트랙트 헬퍼 |
| `functions/wallet/crypto.js` | 지갑 암호화/복호화 |

### 스마트 컨트랙트 (`contract/`)
`CoopMall.sol` (`pay`, `burnVoucher`, `convertPoints`) · `jumpPlatform.sol` · `jumpBank.sol` · `jumpTresury.sol`

---

## 2. 블록체인 / 결제

- **체인**: opBNB Mainnet (L2), RPC: `https://opbnb-mainnet-rpc.bnbchain.org`, ethers.js v6
- **토큰**: HEX (ERC-20, 18 dec) — 플랫폼 포인트 / JUMP (ERC-20, 0 dec) — 거래 / BNB — 가스

### 컨트랙트 주소
```
jumpPlatform : 0x4d83A7764428fd1c116062aBb60c329E0E29f490
jumpToken    : 0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464  (HEX)
jumpJump     : 0xA3C35c52446C133b7211A743c6D47470D1385601  (JUMP)
jumpBank     : 0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E
jumpTreasury : 0xe1f4cDc794D22C23fa47E768dD86Ad09aeEb0312
```
`CoopMall`: Firestore `coopConfig/main.contractAddress`에서 조회.

### 수탁 지갑
- EOA 지갑 → Firestore `users/{uid}.wallet`, 개인키는 `WALLET_MASTER_SECRET`으로 AES 암호화
- 관리자: `ADMIN_PRIVATE_KEY` Secret

### 결제 경로 (CoopMall)
| 경로 | 설명 |
|------|------|
| **수탁** | `hexToken.transfer(adminWallet, hexWei)` — 멘토 포인트 없음 |
| **온체인** | `coopMall.pay(hexWei)` — 멘토 포인트 자동 적립 |

### BPS · FX
- BPS: 10000=100%, `burnFeeBps` (`coopProducts`/`coopVouchers`), `mentorRewardBps` 기본 1000
- FX: `fetchExchangeRates()` → `{ krwPerUsd, vndPerUsd }` (`functions/wallet/exchange.js`)
- 온체인 FX: `platform.fxKrwPerHexScaled()`, `platform.fxVndPerHexScaled()`, `platform.fxScale()`

---

## 3. Firestore 주요 컬렉션

| 컬렉션 | 설명 |
|--------|------|
| `users/{uid}` | 프로필 + 수탁 지갑(`wallet`) |
| `coopProducts` | 상품 (`type: 'general'|'voucher'`, `burnFeeBps`) |
| `coopOrders` | 주문 (`status: confirmed|burned`) |
| `coopVouchers` | 바우처 (`status: active|burned`, `burnFeeBps`) |
| `coopConfig/main` | 컨트랙트 주소, minStake 등 |
| `admins/{uid}` | 관리자 목록 |
| `guides/{uid}` | 가이드 (`.approved === true`) |
| `buggy_config/default` | 탈것 설정 (`driverSharePct` 기본 80%) |
| `jackpot_config` | 잭팟 설정 |
| `town_home` | 메인 화면 데이터 |

---

## 4. 역할(Role) 판정

`assets/js/auth.js`의 `getUserRole(uid)` 만 사용:
1. `admins/{uid}` 존재 → `admin`
2. `guides/{uid}.approved === true` → `guide`
3. `users/{uid}.role` → 해당 값
4. 로그인 → `user` / 비로그인 → `guest`

---

## 5. Firebase Cloud Functions 규칙

- 배포: `firebase deploy --only functions` (단일 함수 배포 절대 금지)
- 모든 `onCall`은 `WALLET_MASTER_SECRET`, `ADMIN_PRIVATE_KEY` secret 사용
- `wrapError()` → `HttpsError` 래핑 / `requireAuth(request)` → uid / `requireAdmin(uid)` → admins 확인

---

## 6. DOM · 이벤트 최적화

- **DOM 캐싱**: 셀렉터는 초기화 시 1회 캐싱, 함수 내 반복 조회 금지
- **일괄 렌더링**: 루프 내 `innerHTML` 반복 금지 — 문자열 누적 후 1회 삽입
- **스타일**: `style.display` 직접 조작 금지 — `classList.add/remove('hidden')` 사용
- **부분 갱신**: 변경된 노드만 갱신 (전체 재렌더 금지, 최초·전체교체 제외)
- **이벤트 인터벌**: scroll/resize throttle 100ms, mousemove 50ms, 검색 debounce 350ms
- **passive**: `scroll`, `touchstart`, `touchmove`, `wheel` → `{ passive: true }`
- **cleanup 필수**: `onSnapshot`, `setInterval`, `watchPosition` — 재등록 전 해제, 섹션 파괴 시 정리

---

## 7. 금지 사항

| 금지 | 대안 |
|------|------|
| `querySelector` 반복 호출 | 초기 캐싱 |
| `innerHTML` 루프 내 반복 갱신 | 문자열 누적 후 1회 삽입 |
| `console.log` 프로덕션 | 제거 또는 `// TODO` |
| 수수료율·요금 하드코딩 | Firestore 또는 컨트랙트 조회 |
| `setInterval`/`onSnapshot` 미해제 | cleanup 변수 유지 |
| `firebase deploy --only functions:fnName` | `firebase deploy --only functions` |

---

## 8. 파일 크기 기준

단일 기능 JS 300줄 / 페이지 JS 700줄 (초과 시 `.lib.js` 분리) / Cloud Functions 핸들러 1,200줄 / CSS 600줄

---

## 9. 커밋 · 기타

- 커밋: `type: 요약` — type: `feat|fix|refactor|perf|style|docs|chore`
- Geocoding: **Nominatim** 사용 (Google Geocoding API 금지)
- 공통 헤더/푸터: `partials.js` 주입 (`#siteHeader`, `#siteFooter` div 필수)
- Firebase 초기화: `assets/js/firebase-init.js` + `assets/js/firestore-bridge.js`
