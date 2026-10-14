# 통합 개발자 공통 가이드 및 작업지시서

## BestClubVN · BestERP · 대한김치 · 결제 및 리워드 시스템

- **문서 버전:** 2.0 (Q&A 정책 확정본)
- **작성 기준일:** 2026년 10월 13일
- **대상:** 대표, 개발자 A·B·C, AI 코딩 에이전트
- **개발 환경:** Netlify, Firebase Authentication, Cloud Functions, Firestore, Git
- **문서 언어:** 한국어
- **핵심 목표:** 독립 운영 중인 웹사이트(BestClubVN, BestERP, 가맹점 쇼핑몰)를 단일 데이터·API 규격으로 통합하고, 상품 등록부터 결제, 리워드, 가맹점 관리까지 완결성 있는 파이프라인을 구축한다.

---

# 1. 개발의 최우선 원칙

## 1.1 시스템별 공식 역할

| 시스템 | 기준 역할 | 핵심 책임 |
|---|---|---|
| **BestClubVN** | 통합 멤버십·공통 플랫폼 | 회원 식별, 통합 정책(BM/Point/BT/GP), 포인트 원장, 룰렛/보너스 티켓, 통합 쇼핑몰(`/mall.html`) |
| **BestERP** | 가맹점 SaaS·CRM·ERP | 가맹점 상품 등록/공개, 테넌트 격리 관리, 직원·고객·재무·프로젝트 관리, AI 경영지원 |
| **가맹점 채널** | 고객 판매/서비스 채널 | 상품 조회, 장바구니, 주문/결제, 배송/예약 (적용 사례: 대한김치, 베스트위너 등) |
| **Firebase / Cloud Functions** | 서버 인프라 및 트랜잭션 | 인증/인가, 권한 검증, Firestore 원장 관리, 결제 검증, 수수료 분배, 멱등성 보장 |
| **주문·결제 시스템** | 주문/결제 기준 시스템 | 주문 생성, PG/결제 검증, 상태 전이, 취소/환불 원장 처리 |

> ⚠️ **경고:** 실제 소스코드와 데이터베이스를 조사하기 전에는 기존 주문·결제 시스템을 임의로 교체하지 않는다.

## 1.2 필수 개발 10대 원칙

1. **사전 전수 조사:** 기존 코드, DB, API, 인증 구조를 전수 조사한 후 작업을 시작한다.
2. **기존 기능 보존:** 정상 작동 중인 코드를 승인 없이 삭제하거나 전면 재작성하지 않는다.
3. **데이터 소유권 엄격 분리:** 데이터 소유권을 엄격히 구분한다 (회원은 BestClub, 상품은 BestERP).
4. **상품 단일 등록·동시 반영:** 상품은 BestERP에서 1회 등록·공개 시 가맹점 사이트와 `/mall.html`에 동시 자동 반영한다.
5. **서버 사이드 권한/결제 검증:** 모든 가맹점 접근 권한과 결제 금액 검증은 서버(Cloud Functions)에서 수행한다.
6. **서버 중심 판단:** 프런트엔드는 표시용이며, 금액·수수료·리워드 판정 권한은 전적으로 서버가 가진다.
7. **하드코딩 및 가조작 금지:** 실제 원장에 기반하지 않은 잔액, 잭팟, 재고 수치를 화면에 하드코딩하거나 가조작하지 않는다.
8. **사전 승인 필수:** 공통 API 규격 및 DB 스키마 수정은 담당 개발자 및 대표의 사전 승인을 거친다.
9. **테스트 및 Git 규정 준수:** 단위/회귀 테스트 후 Git 커밋 절차를 준수한다.
10. **문서 준수 의무:** AI 코딩 에이전트는 프로젝트 루트의 `CLAUDE.md` 및 작업지시서를 작업 전 반드시 읽고 준수한다.

---

# 2. 대상 사이트 및 공통 연결 구조

## 2.1 대상 사이트
- **BestClubVN 통합 플랫폼:** https://bestclubvn.netlify.app/
- **BestClubVN 통합 쇼핑몰:** https://bestclubvn.netlify.app/mall.html
- **BestERP 가맹점 SaaS:** https://besterp.netlify.app/
- **가맹점 홈페이지 (적용 사례):** https://bestwinner.netlify.app/ (및 대한김치 등)

각 사이트는 독립적으로 배포·운영하되, 공통 API와 인증·권한 정책을 준수한다.

## 2.2 권장 아키텍처

```text
BestClubVN
  ├─ 통합 회원 및 가맹점 정책
  ├─ BM / Point / BT / GP 공통 정책
  ├─ 포인트 원장 및 보너스 티켓 (BT)
  └─ 통합 쇼핑몰 mall.html
             │
             │ 공통 API / 인증 / 이벤트
             ▼
Firebase Authentication + Cloud Functions
  ├─ 인증·인가 및 가맹점 권한 검증 (이메일 기반 복합키)
  ├─ 상품 조회·주문·결제 검증
  ├─ 리워드·잭팟(최대 30% 캡)·수수료(10%) 처리
  ├─ 감사 로그 및 멱등성 보장
  └─ 공통 API 엔드포인트
             │
             ├── BestERP (가맹점 관리)
             │     ├─ 상품 카탈로그 CRUD (Single Source)
             │     ├─ CEO 가맹점명 자동 표출
             │     ├─ 멀티 테넌트 CRM / ERP
             │     └─ AI 경영지원
             │
             └── 가맹점 홈페이지 (고객 쇼핑몰 채널)
                   ├─ 대한김치, 베스트위너 등
                   ├─ 실시간 상품·주문·결제 연동
                   └─ 고객 문의·배송
```

---

# 3. 재화 표준 및 경제 시스템 (Q1, Q2 확정 반영)

기존 명세의 **KM은 완전히 폐기**되었으며, 모든 현금성 결제는 **BM**으로 통일합니다.

### [재화 흐름도]

```text
(결제: 100,000 VND당 1 BT 이체)
가맹점 (BT 보유) ──────────────────────────► 고객 (BT 수령)
                                                │
                                                ▼ (BT 룰렛 인터랙션)
게임 활동 ──────────► GP (Game Point)            Point (리워드 / 캐시백)
                          │                             │
                          ▼ (전환)                       ▼ (전환)
                     Point ────────────────────► BM (VND 현금성 가치)
```

## 3.1 4대 재화 표준 정의

| 재화 | 구분 및 단위 | 설명 및 전환 공식 |
|---|---|---|
| **BM (VND)** | 현금성 결제/정산 재화<br>(표기 단위: VND, UI 표기: `BM`) | - 플랫폼 내 유일한 현금성 결제·정산 재화.<br>- 기존의 KM 및 `pointBalanceVnd`는 BM으로 완전 대체·정리.<br>- 가맹점 정산은 향후 USDT 기반으로 일괄 처리 예정. |
| **Point** | 비현금성 리워드<br>(표기 단위: `Point`, 필드: `users.pointBalance`) | - 보상, 캐시백(5%), 잭팟 당첨, BT 룰렛 등으로 획득하는 비현금성 리워드.<br>- Point를 BM 또는 법정화폐와 동일한 가치로 직접 간주하지 않음.<br>- **BM 전환 공식:** `floor(보유 Point × (gsLevel / 10))` |
| **GP (Game Point)** | 게임 전용 포인트<br>(표기 단위: `GP`) | - 플랫폼 내 게임 콘텐츠(배틀, 퀘스트 등)를 통해 획득하는 전용 포인트.<br>- 게임 내에서 사용되며 Point로 전환 가능.<br>- **Point 전환 공식:** `floor(보유 GP × (gsLevel / 10))` |
| **BT (Bonus Ticket)** | 보너스 티켓 수량<br>(표기 단위: `BT`, 필드: `btBalance`) | - **발급 규정:** 가맹점에서 **100,000 VND 결제당 1 BT** 지급 (`Math.floor(amount / 100000)`).<br>- **사용처:** 인터랙티브 룰렛을 돌려 등급 기반 Point를 획득하는 전용 티켓. |

## 3.2 유저 레벨 및 경험치(EXP) 정책

- **Firestore 필드:** `users.gsLevel`, `users.gsExp`
- **레벨 범위:** **Lv.1 ~ Lv.30** (상한선: Lv.30)
- **레벨업 요구 EXP 공식:** `현재레벨 × 10,000 EXP`
  ```text
  Lv.1 → 2:  10,000 EXP
  Lv.2 → 3:  20,000 EXP
  Lv.3 → 4:  30,000 EXP
  ...
  Lv.29 → 30: 290,000 EXP
  ```
- **EXP 획득 기준:**
  - BM 결제: 100,000 VND당 100 EXP
  - BT 수령: BT 1개당 100 EXP
  - 추천인 가입: 1,000 EXP (추천인에게 지급)
- **전환 제한 및 밸런스:** 별도의 전환 횟수 제한이나 쿨다운은 없으나, 고레벨(Lv.10 이상) 도달 자체가 제어되므로 레벨 인플레이션이 방지됨.

## 3.3 데이터 일관성 및 원장 원칙
- 잔액을 프런트엔드에서 임의로 가산/차감하지 않는다.
- 모든 금액·포인트·티켓 변경에는 고유 거래 ID(트랜잭션 ID)를 부여한다.
- 원장과 잔액 변경은 반드시 Firestore 트랜잭션(`runTransaction`)을 통해 원자적으로 처리한다.
- 중복 요청 방지를 위한 멱등성 키(Idempotency Key)를 적용한다.

---

# 4. 결제·수수료 및 리워드 알고리즘 (Q3, Q4, Q5, Q6 확정 반영)

## 4.1 가맹점 결제 및 정산 (Q5 반영)

고객이 가맹점에서 BM(VND)으로 결제할 때의 기본 구조:
- **사용자 결제 수수료:** **0%**
- **가맹점 수수료:** **10%**
- **가맹점 매출액 (90%):** 가맹점 원장(`pendingSettlementVnd`)에 기록되며, 향후 **USDT 정산 파이프라인**을 통해 일괄 정산 처리됨 (실시간 온체인 정산 아님).

## 4.2 가맹점 수수료(10%) 분배 규칙

고객이 100,000 VND 결제 시 발생하는 수수료 10,000 VND (10%)의 배분 구조:

```text
고객 결제: 100,000 VND
├─ 가맹점 매출액: 90,000 VND (90%) ──► 가맹점 원장 적립 (USDT 정산 예정)
└─ 플랫폼 수수료: 10,000 VND (10%)
   ├─ 추천인 (멘토):         2,000 VND (20%)
   ├─ 상위 추천인 (그랜드):  1,000 VND (10%)
   ├─ 시스템 잭팟 풀:       3,000 VND (30%) ──► jackpot_config/current 적립
   └─ 플랫폼 운영 수익:     4,000 VND (40%)
```

| 배분 항목 | 수수료 대비 비율 | 비고 |
|---|---|---|
| **추천인 (멘토)** | 20% | 미지정 시 플랫폼 운영 수익으로 귀속 |
| **상위 추천인 (그랜드 멘토)** | 10% | 미지정 시 플랫폼 운영 수익으로 귀속 |
| **시스템 잭팟 풀** | 30% | `jackpot_config/current` 원장에 단 1회 적립 (중복 적립 금지) |
| **플랫폼 운영 수익** | 40% | 추천인 미지정 시 미배분 몫 합산 |
| **합계** | **100%** | |

## 4.3 리워드 및 잭팟 알고리즘 (Q3, Q4 반영)

### 1) 기본 Point 캐시백
$$\text{기본 캐시백 Point} = \text{결제 인정 금액} \times 5\%$$
- 잭팟 당첨 여부와 무관하게 모든 결제자에게 **1회 확정 지급**.

### 2) BM 결제 잭팟 당첨 확률 공식
$$\text{jackpotProbability} = \min\left(\frac{\text{gsLevel} \times 100}{10000},\; 0.30\right)$$
- **확률 캡 적용:** `gsLevel`에 따른 확률이 아무리 높아도 **최대 30%를 초과할 수 없음** (Q3 반영).
- **실제 코드 구현 규정:**
  ```js
  const gsLevel = userSnap.data().gsLevel || 1;
  const cappedLevel = Math.min(gsLevel, 30);
  const winThreshold = cappedLevel * 100; // 최대 3,000 (30%)
  const rand = Math.floor(Math.random() * 10000); // 0 ~ 9999
  const isJackpot = rand < winThreshold;
  ```
- **레거시 보존 원칙:** `gsLevel`의 출처 및 잭팟 풀 차감/시드(Seed) 초기화 로직은 기존 시스템에 코딩된 레거시 잭팟 알고리즘 핸들러(`functions/handlers/transaction.js`)를 우선 분석하여 적용한다 (임의 변형 금지).
- 당첨 시: 기본 5% 캐시백 + 누적 잭팟 Point를 합산 지급하고 풀을 리셋.
- 미당첨 시: 수수료 중 30%를 잭팟 풀에 정상 적립.

### 3) BT 룰렛 (인터랙티브 등급형 리워드)
- BT 1장 사용 시 등급(Grade 10 ~ 1000) 난수를 산출하여 차등 Point를 지급하는 구조.
- 반드시 클라이언트에서 **인터랙티브 룰렛/슬롯머신 애니메이션** 재생 후 결과를 표시.

### 4) 확률형 아이템 드롭 (독립 판정)
결제 시 잭팟 당첨 여부와 독립적으로 각각 판정:
| 아이템 | 기본 확률 | 대상 필드 |
|---|---|---|
| **빨간약** | 20% | `potions` |
| **마법약** | 10% | `mpPotions` |
| **부활권** | 5% | `reviveTickets` |

### 5) BT (Bonus Ticket) 지급 흐름 (Q6 반영)
1. **공급:** 최고관리자(Super Admin)가 각 가맹점 계정으로 BT를 사전에 일괄 충전/이체해 둠 (`adminChargeBt`).
2. **지급:** 가맹점에서 고객이 결제할 때 (**100,000 VND당 1 BT**), 가맹점의 `btBalance`에서 원자적으로 차감되고 고객의 `btBalance`로 즉시 이체됨.

---

# 5. 데이터베이스 및 식별자 아키텍처 (Q7 확정 반영)

기존 `merchant_members/{uid}` 구조는 1명의 유저가 여러 가맹점의 직원이 되거나, 여러 가맹점의 고객이 되는 N:M 관계를 수용하지 못하므로, **유저 이메일을 고유 식별자 또는 복합 키로 사용하는 구조로 전면 개편**합니다.

## 5.1 권장 Firestore 스키마

### 1) 가맹점 정보 (`merchants/{merchantId}`)
```json
{
  "merchantId": "merchant_001",
  "merchantName": "대한김치",
  "ownerEmail": "owner@kimchi.vn",
  "logoUrl": "https://...",
  "status": "active",
  "btBalance": 500,
  "pendingSettlementVnd": 90000000,
  "updatedAt": "Timestamp"
}
```

### 2) 가맹점 소속 및 권한 매핑 (`merchant_members/{docId}`)
- **문서 ID 규칙:** `{normalized_email}_{merchantId}` (단일 유저가 복수 가맹점 소속 가능)
```json
{
  "userEmail": "staff@example.com",
  "uid": "FIREBASE_AUTH_UID",
  "merchantId": "merchant_001",
  "role": "owner | admin | staff",
  "status": "active",
  "createdAt": "Timestamp"
}
```

### 3) 가맹점 고객 관계 매핑 (`merchant_customers/{docId}`)
- **문서 ID 규칙:** `{normalized_email}_{merchantId}` (유저 한 명이 다수 가맹점의 고객으로 등록)
```json
{
  "userEmail": "customer@example.com",
  "uid": "FIREBASE_AUTH_UID",
  "merchantId": "merchant_001",
  "totalOrders": 12,
  "totalSpendVnd": 1500000,
  "registeredAt": "Timestamp"
}
```

---

# 6. BestERP CEO 로그인 및 가맹점명 자동 표시

1. **로그인 인증:** Firebase Authentication 성공 후 `user.uid` 및 `user.email` 확인.
2. **소속 검증:** `merchant_members`에서 `{normalized_email}_{merchantId}` 또는 이메일 쿼리를 통해 사용자가 소유자(`owner`) 또는 관리자(`admin`)인 가맹점을 확인.
3. **가맹점명 자동 표출:** 조회된 `merchantId`를 기준으로 가맹점명 및 로고를 가져와 BestERP 관리자 화면 좌측 상단에 자동으로 렌더링.
4. **상태 유지:** 페이지 새로고침 후에도 로그인 상태와 가맹점 연결 정보가 원활히 유지되어야 함.
5. **보안 검증:** URL 파라미터 변조로 타 가맹점 데이터에 접근할 수 없도록 모든 API 및 DB 요청 시 서버에서 테넌트 권한을 검증.

---

# 7. BestERP 상품 등록 및 크로스 플랫폼 동기화

## 7.1 상품 마스터 데이터 (Single Source of Truth)
상품의 기준 시스템은 **BestERP**이며, 다음 4가지 상품 타입을 지원합니다:
- `menu`: 식당 메뉴, 음료, 세트 구성
- `physical_product`: 김치, 반찬, 식자재, 생활용품 등 실물 상품
- `service`: 수리, 설치, 인테리어, 컨설팅 등
- `booking`: 날짜·시간·인원 예약형 서비스

### 상품 공통 데이터 필드
| 필드 | 설명 |
|---|---|
| `product_id` | 고유 상품 ID (전역 유일) |
| `merchant_id` | 소유 가맹점 ID |
| `product_name` | 상품명 |
| `description` | 상세 설명 |
| `product_type` | `menu`, `physical_product`, `service`, `booking` |
| `price`, `currency` | 기본 판매 가격 및 통화 (기본: VND) |
| `options` | 규격, 중량, 맛 등 추가 옵션 및 옵션별 추가 금액 |
| `sale_status` | `draft`, `published`, `paused`, `sold_out`, `archived` |
| `inventory` | 판매 가능 재고 수량 |
| `images` | 대표 이미지 및 추가 이미지 URL 목록 |

## 7.2 동기화 규칙
- BestERP에서 상품 상태를 `published`로 등록하거나 변경하면:
  1. **해당 가맹점 자체 홈페이지** (예: 대한김치, 베스트위너)
  2. **BestClubVN 통합 쇼핑몰** (`/mall.html`)
  3. **BestERP 재고/주문 관리 화면**
  에 **즉시 자동 노출 및 반영**되어야 한다.
- 클라이언트 HTML 크롤링이나 로컬 스토리지 캐시에 의존한 연동을 엄격히 금지한다.

---

# 8. BestClubVN 통합 쇼핑몰 `/mall.html`

## 8.1 필수 기능
- 모든 연결 가맹점의 공개(`published`) 상품 통합 조회.
- 가맹점별 필터, 카테고리 필터, 검색 기능.
- 가격순/최신순 정렬, 상세 조회, 옵션 및 수량 선택 후 장바구니/주문서 연동.
- 모바일 반응형 디자인 및 한국어/베트남어 다국어 지원.

## 8.2 금지 사항
- `/mall.html`에서 타 가맹점 DB를 비인가 직접 조회 금지.
- 가맹점 홈페이지 HTML 크롤링 금지.
- 상품 정보 및 가격을 프런트엔드 JS/HTML에 하드코딩 금지.
- 클라이언트가 계산한 최종 결제 금액을 서버 검증 없이 승인 금지.

---

# 9. 주문·결제·재고 처리 원칙

1. **주문 데이터 스냅샷:** 주문 생성 시점의 상품명, 단가, 옵션, 배송비, 총액을 스냅샷으로 보관한다 (이후 상품 가격이 변해도 과거 주문 데이터는 변경하지 않음).
2. **원자적 재고 차감:** 동시 주문 환경에서도 재고가 음수가 되지 않도록 Firestore 트랜잭션으로 차감.
3. **주문 상태 흐름:**
   ```text
   주문 접수 ──► 결제 대기 ──► 결제 확인 ──► 주문 확인 ──► 상품 준비 ──► 배송 중 ──► 배송 완료
   ```
4. **취소 및 환불:** 취소/환불 시 원장의 역분개 처리(차감된 잔액 복구, 수수료 회수, 캐시백 회수) 정책을 엄격히 적용.

---

# 10. 개발 보안 및 프런트엔드 UI 규칙

## 10.1 UI/UX 필수 규칙
- **BT 보상 표기:** BT Reward 스캔 UI는 절대 '결제'로 표현하지 않고, 반드시 **'무료 보상 (Free Reward)'**으로 명시한다.
- **통화 기준 및 삼중 표기:** 기본 통화는 항상 **VND**를 기준으로 하되, 금액 표시 헬퍼를 통해 **KRW / VND / Point**를 명확히 병기한다:
  ```js
  const amountDisp = [krwStr, vndStr, pointStr].filter(Boolean).join(' / ');
  ```
- **BT 룰렛 애니메이션:** BT 사용 시 반드시 인터랙티브 룰렛/슬롯머신 연출을 실행한 뒤 당첨 결과를 노출한다.

## 10.2 보안 및 온체인 제거 정책
- **API 키 관리:** 가맹점 전용 API 키(`x-api-key`)는 브라우저 JavaScript나 Git에 절대 포함하지 않으며, 서버 측 프록시(Cloud Functions)를 통해 호출한다.
- **블록체인 제거 정책:**
  - 신규 `ethers.js`, 스마트 컨트랙트 및 블록체인 연동을 전면 금지한다.
  - 회원 식별은 오직 Firebase Authentication UID 및 이메일 기준으로 단일화한다.
- **불필요한 로그 금지:** 운영 환경에서 개인정보 및 인증 키를 담은 `console.log` 출력을 금지한다.

---

# 11. Firestore 데이터 접근 및 성능 최적화

1. **선별적 데이터 조회:** 페이지 로드 즉시 불필요한 전체 컬렉션을 조회하지 않는다.
2. **전체 컬렉션 구독 금지:** 조건 없는 `onSnapshot` 구독을 금지하며, 반드시 `where` 조건 및 사용자/가맹점 범위 필터를 적용한다.
3. **TTL 캐시 활용:** 반복 호출되는 정적 함수에는 **30초 TTL 캐시**를 적용한다 (단, 잔액, 결제, 재고 등 실시간 정확성이 필요한 원장 데이터는 캐싱 금지).
4. **위치 데이터 규칙:** 위치 폴링은 최소 30초 간격, 위치 저장은 최소 5초 간격 및 5m 이상 이동 시에만 기록한다.
5. **리스너 정리:** 페이지 언마운트, 로그아웃, 조건 변경 시 실시간 리스너(`unsubscribe`)와 타이머(`clearInterval`)를 반드시 해제한다.

---

# 12. 개발자별 역할 분담 (R&R) 및 배포 지침

## 12.1 역할 분담

### 개발자 A (BestClubVN)
- 통합 회원/인증, 공통 리워드(BM, Point, BT, GP) 처리 원장 관리.
- BT 룰렛 인터랙션 및 `/mall.html` 통합 쇼핑몰 프런트엔드/백엔드 구축.
- 기존 잭팟 알고리즘 핸들러 분석 및 **최대 30% 캡** 적용 Cloud Functions 배포.

### 개발자 B (BestERP)
- 이메일 기반 멀티 테넌트(`merchant_members`) 권한 연동 및 CEO 로그인 시 가맹점명 자동 표출.
- 상품 카탈로그 CRUD 파이프라인 및 가맹점 홈페이지/쇼핑몰 자동 동기화.
- 가맹점 CRM/ERP 및 AI 경영지원 기능 구현.

### 개발자 C (가맹점 / 대한김치)
- 기존 가맹점 쇼핑몰 코드베이스 보존 및 BestERP 상품 API 연동.
- 장바구니/주문서에서 서버 결제 검증 및 가맹점 BT 차감 이체 로직 연동.
- 주문 결과를 기준 주문 시스템 및 BestERP에 반영.

## 12.2 배포 명령어 (필수 준수)

### Firebase Functions 배포:
```bash
# 타임아웃 방지를 위해 항상 전체 배포 실행 (단일 함수 배포 금지)
firebase deploy --only functions

# 프론트엔드 포함 전체 배포
firebase deploy
```
> ⚠️ **절대 금지:** `firebase deploy --only functions:fnName` (로딩 타임아웃으로 배포 실패 발생)

### Git Push 규칙:
```bash
git add -A
git commit -m "feat: ..."
git push origin master
```

### Functions 로컬 에뮬레이터:
```bash
cd functions
npm run serve
```

---

# 13. 단계별 개발 및 승인 절차

| Phase | 목표 | 승인 조건 |
|---|---|---|
| **Phase 1** | 기존 시스템 조사 | 현황 보고서 및 데이터 소유권 초안 검토 완료 |
| **Phase 2** | 공통 데이터·API 확정 | 개발자 A·B·C 및 대표가 확정된 v2.0 명세 승인 |
| **Phase 3** | BestERP 상품 카탈로그 | 가맹점 상품 등록부터 공개·중지까지 테스트 통과 |
| **Phase 4** | 가맹점(대한김치) 연동 | 기존 기능 보존, BestERP 상품 연동 및 주문 흐름 테스트 통과 |
| **Phase 5** | BestClubVN 통합 쇼핑몰 | 다수 가맹점 상품의 `/mall.html` 통합 조회 및 구매 파이프라인 검증 |
| **Phase 6** | 결제·리워드 통합 | BM 결제 → 10% 수수료 분배 → 5% 캐시백 → 30% 캡 잭팟 → BT 이체 전체 통합 테스트 완료 |

---

# 14. AI 코딩 에이전트 공통 작업 규칙

1. **작업 전:** 저장소 파일 구조, 기존 코드, DB 스키마, `CLAUDE.md`를 반드시 확인하고 회귀 위험을 사전 분석한다.
2. **작업 중:** 기존 정상 코드를 보존하고, 임의의 가짜 데이터나 하드코딩을 배제하며, 변경 범위를 최소화한다.
3. **작업 후:** 수정한 파일과 변경 사유를 명확히 보고하고, 테스트 및 롤백 가능성을 확인한 후 승인된 커밋 규칙을 따른다.

---

---

# 15. 가맹점 웹진(BestClub Webzine) 자체 홈페이지 연동 및 디자인 커스터마이징 규격

## 15.1 목적 및 개요
- **목적:** 베스트클럽 공식 가맹점(대한김치, 베스트위너 등)이 자체 운영 중인 독립 홈페이지, 쇼핑몰, 블로그, 랜딩페이지에 베스트 매거진(웹진)의 가맹점 협찬·스토리 콘텐츠를 **자사 브랜드 디자인에 맞춰 실시간으로 임베드(Embed) 및 연동**할 수 있도록 표준 규격을 제공한다.
- **기대 효과:** 단순 링크 이동이 아닌 자연스러운 콘텐츠 융합을 통해 가맹점 브랜드 신뢰도를 제고하고, 기사 하단의 가맹점 결제 QR 및 포인트 페이백 혜택으로 고객 유입을 극대화한다.

## 15.2 시스템 구성 요소
1. **CMS 관리 및 커스터마이징 생성기 (`/admin_webzine.html`):**
   - 수퍼 어드민(SUPER ADMIN) 전용 접근 제어 (`admins/{uid}`, `role == SUPER_ADMIN`).
   - Firestore `merchants` 컬렉션의 실제 등록·활성화된 공식 가맹점만 선택 가능 (더미 및 임의 수동 입력 전면 배제).
   - 실시간 위젯 미리보기(Live Preview) 및 파라미터 조절 UI 제공.
   - 표준 iframe 및 JavaScript SDK 원클릭 복사 기능 제공.
2. **독립 임베드 위젯 뷰어 (`/kca_webzine_widget.html`):**
   - 가맹점 홈페이지 내부 어디서든 반응형으로 동작하도록 최적화된 경량 웹진 위젯 뷰어.
   - URL 쿼리 파라미터를 파싱하여 해당 가맹점 전용 기사 우선 노출 및 동적 테마/레이아웃 적용.
3. **경량 임베드 SDK (`/assets/js/webzine-widget.js`):**
   - 가맹점 사이트에 `<script>` 1줄만 추가하여 자동 렌더링을 지원하는 클라이언트 라이브러리.

## 15.3 디자인 커스터마이징 파라미터 규격

| 파라미터 | 기본값 | 선택 가능 값 | 설명 |
|---|---|---|---|
| `merchant` | `all` | 실제 가맹점 ID (예: `1791002036`, `1791605366`) | 연동할 대상 가맹점의 고유 식별자. 해당 가맹점 기사가 최우선 배치됨. |
| `theme` | `%237c3aed` | HEX 컬러 코드 (URL 인코딩 권장, 예: `%23e11d48`, `%23f59e0b`) | 가맹점의 브랜드 메인 컬러 (버튼, 뱃지, 링크 강조색 반영). |
| `layout` | `card` | `card`, `banner`, `feed` | **card:** 격자 카드형 (추천: 메인 하단 섹션)<br>**banner:** 가로 배너 리스트형 (추천: 사이드바/모바일)<br>**feed:** 리드 스토리 강조 피드형 (추천: 블로그형 레이아웃) |
| `mode` | `light` | `light`, `dark` | **light:** 밝은 배경 테마<br>**dark:** 다크 모드 배경 테마 |
| `header` | `1` | `1` (표시), `0` (숨김) | 위젯 상단 BestClub 헤더 타이틀 표시 여부. 가맹점 자체 헤더가 있을 경우 `0` 권장. |
| `count` | `4` | `2` ~ `10` (정수) | 위젯 내에 노출할 최대 기사 개수. |

## 15.4 가맹점 연동 방식 2가지 (실제 적용 코드)

### 1) 표준 반응형 `<iframe>` 임베드 방식 (권장)
가맹점 웹사이트의 원하는 위치(HTML)에 아래 코드를 삽입합니다:
```html
<!-- [BestClub Webzine] 가맹점 웹진 위젯 (반응형 iframe) -->
<iframe 
  src="https://bestclubvn.netlify.app/kca_webzine_widget.html?merchant=1791002036&theme=%23f59e0b&layout=card&mode=light&count=4" 
  width="100%" 
  height="500" 
  frameborder="0" 
  style="border:none; border-radius:14px; overflow:hidden; width:100%; display:block;" 
  loading="lazy" 
  title="BestClub Webzine Widget">
</iframe>
```

### 2) JavaScript 위젯 SDK 임베드 방식
가맹점 페이지에 `div` 태그와 SDK 스크립트를 삽입합니다:
```html
<!-- [BestClub Webzine] 가맹점 웹진 위젯 (JavaScript SDK) -->
<div 
  id="bestclub-webzine-widget" 
  data-merchant="1791002036" 
  data-theme="#f59e0b" 
  data-layout="card" 
  data-mode="light" 
  data-count="4">
</div>
<script src="https://bestclubvn.netlify.app/assets/js/webzine-widget.js" async></script>
```

## 15.5 보안 및 데이터 무결성 규칙
1. **실제 가맹점 무결성:** 임베드 위젯은 Firestore `merchants` 컬렉션의 실제 데이터를 기준으로 동작하며, 유효하지 않은 임의 가맹점 ID 요청 시 일반 인기 기사로 안전하게 Fallback 처리한다.
2. **반응형 샌드박스:** 외부 웹사이트의 글로벌 CSS 충돌을 방지하기 위해 iframe 또는 격리된 컨테이너 구조를 강제한다.
3. **Cross-Origin 허용:** 가맹점 독립 도메인(예: `bestwinner.netlify.app`, 자체 도메인 등)에서 자유롭게 로드될 수 있도록 정적 위젯 리소스(`kca_webzine_widget.html`, `webzine-widget.js`)는 CORS 제약 없이 퍼블릭 서빙된다.

---

# 16. BM 기반 이벤트 쿠폰·바우쳐 발행 및 통합 사용 시스템 규격

## 16.1 시스템 개요 및 목적
- **목적:** 수퍼 어드민 또는 승인된 가맹점이 회원에게 BM을 받고 이벤트 쿠폰이나 바우쳐를 발행하고, 회원은 BM으로 구매 또는 무료 발급받아 마이페이지(`mypage.html`)에서 확인 후 온·오프라인 가맹점에서 검증을 거쳐 사용할 수 있도록 지원한다.
- **핵심 엔드포인트:**
  - 이벤트 쿠폰·바우쳐 발행 및 라운지: `http://localhost:8080/events` (`/events.html`)
  - 회원 보유 쿠폰·바우쳐 지갑 및 QR 사용: `http://localhost:8080/mypage` (`/mypage.html#couponsSection`)

## 16.2 사용자 권한 및 발행 정책
1. **수퍼 어드민 (SUPER ADMIN):**
   - 모든 가맹점에 대한 발행 권한 제어 및 플랫폼 명의 쿠폰·바우쳐 발행.
   - BM 가격(0이면 무료, >0이면 BM 결제), 총 발행 수량, 1인당 구매 한도, 판매/사용 기간, 발행자 뱃지(`SUPER ADMIN`) 설정.
   - **쿠폰·바우쳐 관리 전권 보유:** 등록된 모든 이벤트 쿠폰 및 바우쳐에 대한 **수정(Edit), 비활성화(Pause/Toggle), 재활성화(Activate), 영구 삭제(Delete)** 권한.
   - **비활성화(`status: 'paused'`) 정책:** 비활성화된 쿠폰은 `[⏸️ 일시 비활성화됨]` 뱃지가 표출되며 일반 회원의 구매/발급이 즉시 차단(버튼 비활성화)됨. 수퍼 어드민은 언제든지 즉시 다시 활성화할 수 있음.
   - **최고 관리자 권한 엄격 분리:** 최고 관리자는 `daguri75@gmail.com` 또는 Firestore `admins/{uid}` / `role in ['SUPER_ADMIN', 'admin']` 사용자만 해당됨. (※ `hexttokenopbnb@gmail.com`은 BEST WINNER 공식 가맹점 점주 권한이며 최고 관리자가 아님).
   - 서버 측 권한 검증 필수 (`functions/handlers/coupon.js`의 `updateCouponCampaign`, `toggleCouponCampaignStatus`, `deleteCouponCampaign` 및 클라이언트 Firestore 규칙).
2. **승인된 가맹점 (MERCHANT):**
   - 본인 가맹점 명의(`users.merchantId` 일치)의 쿠폰/바우쳐 등록 및 관리.
   - BM 가격, 무료/유료 설정, 수량/한도, 판매/사용 기간, 적용 상품/메뉴, 온/오프라인 모드 설정.
   - 타 가맹점의 발행 상품이나 회원 거래 내역 수정 불가 (엄격한 테넌트 격리).
3. **일반 회원 (USER):**
   - 발행 중인 상품 조회, BM 결제 구매 또는 무료 발급, 마이페이지에서 본인 쿠폰 실시간 확인.
   - 12자리 고유 코드(`BC-XXXX-XXXX-XXXX`) 및 QR 코드 현장 제시, 온·오프라인 사용.
   - 비활성화된 상품은 구매/발급 불가.


## 16.3 데이터베이스 논리 구조

### 1) 발행 캠페인 마스터 (`coupon_campaigns/{campaignId}`)
```json
{
  "campaignType": "COUPON | VOUCHER",
  "issuerType": "PLATFORM | MERCHANT",
  "issuerId": "platform | merchant_id",
  "issuerNameSnapshot": "BEST WINNER | 백제갈비 | 대한김치",
  "issuerBadge": "BEST WINNER | SUPER ADMIN | BAJE GALBI | DAEHAN KIMCHI",
  "title": "베스트위너 모든 상품 10% 할인권",
  "description": "상세 설명",
  "imageUrl": "https://...",
  "priceBM": 10000,
  "discountType": "PERCENT | AMOUNT | FREE_ITEM",
  "discountValue": "10",
  "applicableMerchantIds": ["all | merchant_001"],
  "applicableProductIds": ["all | prod_001"],
  "totalQuantity": 1000,
  "issuedQuantity": 15,
  "redeemedQuantity": 3,
  "maxPerUser": 3,
  "saleStartsAt": "Timestamp",
  "saleEndsAt": "Timestamp",
  "validStartsAt": "Timestamp",
  "validEndsAt": "Timestamp",
  "usageMode": "ONLINE | OFFLINE | BOTH",
  "terms": "유의사항",
  "status": "active | paused | closed",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

### 2) 회원 소유 쿠폰·바우쳐 (`user_coupons/{userCouponId}`)
```json
{
  "userCouponId": "docId",
  "campaignId": "campaignId",
  "userId": "FIREBASE_AUTH_UID",
  "merchantId": "merchantId",
  "couponCode": "BC-ABCD-1234-EF56",
  "tokenHash": "sha256_hash_value",
  "purchasePriceBM": 10000,
  "transactionId": "TX_COUPON_179188...",
  "issuedAt": "Timestamp",
  "validStartsAt": "Timestamp",
  "expiresAt": "Timestamp",
  "status": "available | used | expired | cancelled",
  "redeemedAt": "Timestamp | null",
  "redeemedMerchantId": "merchantId | null",
  "staffUserId": "staffUid | null",
  "orderId": "orderId | null"
}
```

### 3) BM 거래 원장 (`transactions/{txId}`)
- 쿠폰 구매 시 `type: 'COUPON_PURCHASE'`, `amount: priceBM`, `relatedCampaignId`, `relatedUserCouponId`가 포함된 변경 원장 영구 보존.

### 4) 쿠폰 사용 기록 (`coupon_redemptions/{redemptionId}`)
- `redemptionId`, `userCouponId`, `campaignId`, `merchantId`, `userId`, `staffUserId`, `orderId`, `redeemedAt`, `status: 'completed' | 'reversed'`, `reversalReason`.

## 16.4 10대 필수 보안 및 무결성 규칙
1. **소유자 격리:** 회원은 본인이 소유한 쿠폰·바우쳐(`userId == auth.uid`)만 조회 가능하며, 타인의 쿠폰이나 코드를 조회할 수 없다.
2. **가맹점 격리:** 가맹점주는 본인 가맹점(`applicableMerchantIds` 또는 본인 소속)의 상품과 사용 통계만 열람·처리할 수 있다.
3. **수퍼 어드민 서버 검증:** 수퍼 어드민 권한은 브라우저 세션이 아닌 Cloud Function 서버(`admins/{uid}`)에서 엄격히 검증한다.
4. **가격 조작 방지:** 결제 BM 가격은 브라우저 요청값이 아닌 서버의 `coupon_campaigns` 스냅샷 가격(`priceBM`)을 기준으로 원자적으로 계산한다.
5. **원자적 한도 검증:** 총 발행 수량 초과 방지 및 1인당 최대 발급 한도는 Firestore `runTransaction` 내에서 원자적으로 카운팅·검증한다.
6. **QR 코드 난수성:** 쿠폰 코드는 `BC-` 접두사와 함께 암호학적으로 추측이 불가능한 고유 코드 및 난수 해시(`tokenHash`)를 적용한다.
7. **프런트엔드 임의 완료 차단:** 쿠폰 사용 처리는 클라이언트에서 임의 변경할 수 없으며, 서버 Callable Function(`redeemCouponOffline`)의 권한 검증 및 매장 유효성 확인을 통해서만 완료된다.
8. **멱등성 보장:** 중복 클릭 및 네트워크 재시도에 따른 이중 차감/발급을 방지하기 위해 멱등성 키(`idempotencyKey`) 검증을 적용한다.
9. **거래 원장 보존:** BM 잔액만 수정하고 거래 원장을 남기지 않는 방식을 금지하며, `transactions` 및 `coupon_redemptions`에 영구 기록한다.
10. **만료 및 취소 제어:** 사용 만료일이 지난 쿠폰은 즉시 사용이 차단되며, 취소·환불·복구 시 감사 로그를 남긴다.

## 16.5 오프라인 / 온라인 사용 프로세스
- **오프라인 사용:** 회원이 마이페이지에서 `사용하기 (QR)` 버튼을 눌러 화면에 표시된 QR 또는 12자리 코드를 가맹점 직원에게 제시 -> 직원이 매장 단말/마이페이지 현장 승인 도구에서 코드 입력 또는 QR 스캔 -> `redeemCouponOffline` 호출 -> 가맹점 일치 및 유효기간 확인 후 `status: 'used'` 확정.
- **온라인 사용:** 주문 결제 창에서 해당 가맹점 및 적용 가능 상품 매칭 확인 후 쿠폰 적용 할인 -> 주문 완료 시 쿠폰 상태 전환.

---

# 17. 가맹점 홈페이지(Merchant Channel)의 BestClub DB 직접 연동 원칙

## 17.1 대원칙: "가맹점 홈페이지의 모든 DB는 BESTCLUB에서 가져온다"
- 가맹점 홈페이지(BEST WINNER, 대한김치, 백제갈비 등)는 **독자적인 로컬 DB나 별개 백엔드를 구축하지 않으며**, 모든 데이터(가맹점 프로필, 상품 카탈로그, 회원 인증, 지갑 잔액, 주문, 결제, 쿠폰, 웹진)를 **BestClub 중앙 Firebase(`jumper-b15aa`)에서 직접 실시간 연동**한다.
- 상세 개발 가이드 및 표준 구현 코드는 [`docs/가맹점_홈페이지_개발가이드.md`](file:///c:/Users/Asus/Desktop/project/jumper/jumper_v10/docs/가맹점_홈페이지_개발가이드.md)를 참조한다.

## 17.2 6대 핵심 연동 컬렉션
1. **가맹점 프로필:** `merchants/{merchantId}` (상호명, 로고, 주소, 연락처, BT 잔액, 정산 대기금)
2. **상품 카탈로그:** `merchant_products` (`merchant_id == MY_ID && sale_status == 'published'`)
3. **통합 회원 & BM 지갑:** `users/{uid}` (BestClub 단일 계정 로그인, `pointBalanceVnd`(BM), `btBalance`(BT), `pointBalance`(Point))
4. **주문 및 결제:** `merchant_orders` (BM 결제, 10% 수수료 분배, 90% 가맹점 매출 적립, 100,000 VND당 1 BT 지급)
5. **쿠폰 & 바우쳐:** `user_coupons` (해당 가맹점 적용 가능 쿠폰 조회 및 주문 결제 시 차감/사용)
6. **가맹점 웹진 위젯:** `kca_webzine_widget.html` iframe 또는 `webzine-widget.js` 임베드

---

*이 문서는 BestClubVN 프로젝트(`jumper_v10`)의 최우선 개발 가이드입니다.*  
*작업 전 반드시 본 문서를 숙지하고, 정책이나 로직이 변경될 경우 반드시 본 문서를 함께 갱신합니다.*