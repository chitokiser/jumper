# JumpDAO 게임코인 보안 지침서

> 최종 업데이트: 2026-06-03  
> 대상: 모든 게임·백엔드 개발자

---

## 1. 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **서버만 gold를 변경** | 클라이언트(브라우저 JS)에서 `gold` 필드를 직접 쓰는 코드 금지 |
| **입력값 불신** | Cloud Function에 전달된 `amount`, `fee`, `gameKey` 등 모든 클라이언트 제공값을 서버에서 재검증 |
| **원자 트랜잭션** | GP 차감·지급은 항상 `runTransaction()` 또는 `batch` 사용 — read-then-write 분리 금지 |
| **음수 차단** | 모든 GP 관련 숫자에 `> 0` 검증 필수 |
| **한도 설정** | 보상·출금·일일 획득에 서버사이드 상한선 |

---

## 2. Firestore 규칙 (battle_players)

```firestore
match /battle_players/{uid} {
  // gold 필드는 Cloud Functions만 변경 가능
  allow create: if signedIn() && request.auth.uid == uid
    && !request.resource.data.keys().hasAny(['gold']);
  allow update: if signedIn() && request.auth.uid == uid
    && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['gold']);
}
```

**절대 하지 말 것:**
```js
// ❌ 클라이언트에서 직접 gold 쓰기 — 해커가 DevTools로 금액 조작 가능
await updateDoc(doc(db, 'battle_players', uid), { gold: increment(9999999) });
```

**올바른 방법:**
```js
// ✅ Cloud Function 호출 — 서버에서 검증 후 처리
await httpsCallable(functions, 'claimGameReward')({ gameType: 'memory', amount: 300 });
```

---

## 3. Cloud Function 보안 체크리스트

### 3-1. 새 GP 관련 함수 작성 시 필수 항목

```js
// ✅ 1. 인증 확인
const uid = requireAuth(request);

// ✅ 2. 입력값 양수·정수 검증
const amount = Math.floor(Number(request.data.amount));
if (!Number.isFinite(amount) || amount <= 0) throw new Error('invalid amount');

// ✅ 3. 서버 정의 상한선 초과 차단
if (amount > SERVER_MAX_REWARD) throw new Error('한도 초과');

// ✅ 4. 원자 트랜잭션 — 잔액 확인 + 차감을 분리하지 않음
await db.runTransaction(async t => {
  const snap = await t.get(playerRef);
  const gold = snap.data()?.gold ?? 0;
  if (gold < amount) throw new Error('잔액 부족');
  t.update(playerRef, { gold: FieldValue.increment(-amount) });
});

// ✅ 5. Admin SDK로 gold 업데이트 (Firestore rules 우회 가능)
await db.collection('battle_players').doc(uid).update({
  gold: admin.firestore.FieldValue.increment(gp),
});
```

### 3-2. 금지 패턴

```js
// ❌ 잔액 확인과 차감을 트랜잭션 없이 분리 — 레이스 컨디션 발생
const balance = (await playerRef.get()).data().gold;
if (balance >= amount) await playerRef.update({ gold: increment(-amount) }); // 위험!

// ❌ 클라이언트가 보낸 금액을 그대로 신뢰
const gp = request.data.amount;  // 조작 가능
await playerRef.update({ gold: increment(gp) });

// ❌ 음수 미검증
if (!coinAmount || coinAmount <= 0) ...  // !(-500) === false → 음수 통과!
// 올바른 방법: if (!Number.isFinite(val) || val <= 0) ...
```

---

## 4. 게임별 보안 현황

| 게임 | 클라이언트 gold 쓰기 | 현황 |
|------|---------------------|------|
| 스피드기억 | `claimGameReward` CF 호출 | ✅ 수정됨 |
| 활쏘기 | `claimGameReward` CF 호출 | ✅ 수정됨 |
| 몬스터레이스 | 클라이언트 직접 쓰기 | ⚠️ 마이그레이션 필요 |
| 던전 | 클라이언트 직접 쓰기 | ⚠️ 마이그레이션 필요 |
| 몬스터수성 | 클라이언트 직접 쓰기 | ⚠️ 마이그레이션 필요 |

**마이그레이션 우선순위**: 레이스 → 던전 → 수성 (상금이 큰 순서)

---

## 5. TON 입출금 보안

### 5-1. 입금 (verifyDeposit)
- **중복 방지**: `txHash` 기준 중복 확인 — `confirmed`와 `processing` 상태 모두 차단
- **주소 검증**: 수신 주소가 관리자 지갑과 일치하는지 확인
- **금액 검증**: `nano > 0` 확인 후 GameCoin 환산
- **환산 상한**: 비정상적으로 큰 값 방어를 위해 `COIN_PER_USD` 기반 계산

### 5-2. 출금 (requestWithdraw)
- **원자 처리**: GP 선차감 → TON 송금 → 실패 시 GP 복원 (runTransaction)
- **일일 한도**: `MAX_DAILY_WITHDRAW = 1,000,000 GP/일`
- **최소 금액**: `MIN_WITHDRAW_GP = 10,000 GP`
- **수수료 3%** 서버에서 계산 — 클라이언트 제공값 무시

---

## 6. 신규 게임 개발 시 보안 요구사항

```
1. 게임 결과(점수, 보상)는 클라이언트에서 계산해도 됨
2. GP 지급은 반드시 `claimGameReward` Cloud Function 호출
3. 참가비 차감은 반드시 `payGameEntry` Cloud Function 호출
4. 클라이언트 JS에서 `updateDoc(..., { gold: ... })` 절대 금지
5. 새 게임 타입 추가 시 gameReward.js의 GAME_MAX_REWARD에 한도 등록 필수
```

---

## 7. 취약점 발견 및 보고

보안 이슈 발견 시 공개 이슈 대신 직접 연락:  
📧 daguri75@gmail.com (운영자)

---

## 8. 정기 점검 항목

| 주기 | 점검 내용 |
|------|----------|
| 매주 | Firestore rules에 battle_players.gold 쓰기 우회 여부 |
| 매월 | Cloud Function 보상 한도 vs 실제 게임 최대 획득 GP 검토 |
| 분기 | TON 입출금 로그 이상 패턴 (동일 txHash 반복, 대량 출금) 분석 |
| 배포마다 | 새 CF 함수에 `requireAuth()` 누락 여부 확인 |
