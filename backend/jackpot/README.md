# Jumper Jackpot Backend (Off-chain)

기존 스마트컨트랙트는 수정하지 않고, 서버에서 잭팟 복권 로직을 처리하는 백엔드입니다.

## 핵심 보장
- 스마트컨트랙트 수정 없음
- 온체인 사용 범위: `결제 이벤트 감지`, `HEX 출금 전송`
- 잭팟 계산/당첨/적립/출금승인은 모두 오프체인
- 수학 규칙 보장
  - `finalWin <= jackpot`
  - `finalWin <= jackpot * 0.5`

## 기술 스택
- Node.js (ESM)
- Express
- PostgreSQL
- ethers.js

## 디렉터리
- `schema.sql`: DB 스키마
- `src/chain/listener.js`: 블록체인 결제 이벤트 리스너
- `src/services/jackpotMath.js`: 난수/당첨 계산
- `src/services/jackpotRepo.js`: DB 저장/조회
- `src/services/jackpotService.js`: API 서비스
- `src/routes/jackpotRoutes.js`: API 라우트

## 1) 설치
```bash
cd backend/jackpot
cp .env.example .env
npm install
```

## 2) DB 마이그레이션
```bash
npm run migrate
```

## 3) API 서버 실행
```bash
npm start
```

## 4) 이벤트 리스너 실행
```bash
npm run listener
```

운영에서는 API와 리스너를 별도 프로세스로 실행하세요.

## API
- `GET /jackpot/current`
- `GET /jackpot/balance?wallet=0x...`
- `GET /jackpot/history?wallet=0x...&limit=50`
- `POST /jackpot/withdraw`

### 출금 요청 예시
```bash
curl -X POST http://localhost:8787/jackpot/withdraw \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0xabc...","amountHex":"30"}'
```

## 운영 보안 규칙
- `tx_hash` 유니크로 중복 처리 방지
- 최소 컨펌 수 확인
- `receipt.status != 1` 제외
- 가맹점 화이트리스트 검증
- 자기결제 차단(옵션)
- 반복 결제 제한(10분 카운트)
- 관리자 주소 제외
- 일일 지급 한도

## 결제 이벤트 ABI
`src/chain/abi.js`의 `PaymentSettled` 시그니처는 예시입니다.
실제 컨트랙트 이벤트 시그니처로 교체하세요.

## 성능/확장 메모
- 10,000 결제/일 기준
  - 인덱스: `payments(tx_hash, paid_at)`, `jackpot_rounds(user_address, created_at)`
  - 리스너: 블록 범위 배치 처리 + 상태(`listener_state`) 체크포인트
  - API: rate limit 적용

## Docker 실행
```bash
docker compose up --build
```

## 체크리스트
- [ ] `.env`에 실제 RPC/컨트랙트 주소/비밀키 설정
- [ ] 지급용 HOT wallet에 HEX 잔고 확보
- [ ] `merchant_whitelist` 등록
- [ ] 실제 이벤트 ABI 반영
