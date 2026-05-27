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
- 베트남 여행 필수 사이트 — 공항에서부터 보물찾기 이벤트 키워드 유지

## SEO 규칙
- 모든 공개 페이지: title / description / og / twitter 메타 필수
- title 형식: "페이지명 | JumpDAO — 부제"
- 핵심 키워드: 베트남여행, 공항보물찾기, 위치기반게임, Web3, AR보물
- canonical URL 필수
- robots.txt: Sitemap 경로 포함 유지
- sitemap.xml: 공개 페이지만 포함, admin/* 제외
