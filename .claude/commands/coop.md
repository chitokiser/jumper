# CoopMall 컨텍스트

## 컨트랙트

```
CoopMall 주소: Firestore coopConfig/main.contractAddress (하드코딩 금지)
```

주요 함수:
- `pay(hexWei)` — 상품 구매, 멘토 포인트 자동 적립
- `burnVoucher(voucherId, hexWei, burnFeeBps)` — 바우처 소각 (멘토 포인트 없음)
- `convertPoints(points)` — 포인트 → HEX 전환
- `grantEligibility(addr)` — 관리자 전용

## 결제 경로

| 경로 | 조건 | 함수 |
|------|------|------|
| 수탁(custodial) | 기본 | `hexToken.transfer(adminWallet, hexWei)` |
| 온체인 | 멘토 포인트 필요 | `coopMall.pay(hexWei)` |

## Firestore 구조

```
coopProducts/{id}
  type: 'general' | 'voucher'
  priceHexWei: string   // 온체인 단위
  burnFeeBps: number    // 바우처 소각 수수료 (BPS)
  active: boolean

coopOrders/{id}
  uid, productId, hexWei, txHash
  status: 'confirmed' | 'burned'
  createdAt: Timestamp

coopVouchers/{id}
  uid, productId, burnFeeBps
  status: 'active' | 'burned'
  source: 'product'
  createdAt, burnedAt: Timestamp

coopConfig/main
  contractAddress: string   // CoopMall 컨트랙트
  minStake: number
```

## BPS 계산

```js
const fee = (hexWei * BigInt(burnFeeBps)) / 10000n;  // 소각 수수료
const net  = hexWei - fee;
// mentorRewardBps: 컨트랙트 상태변수, 기본 1000 (10%)
```

## 서버 핸들러 위치

`functions/handlers/coop.js`
- `buyCoopProduct(uid, productId, masterSecret)` — 상품 구매
- `burnCoopVoucher(uid, voucherId, masterSecret)` — 바우처 소각
- `convertCoopPoints(uid, points, masterSecret)` — 포인트 전환
