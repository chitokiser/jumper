# 배포 · 개발 명령어

## Firebase Functions 배포

```bash
# 항상 전체 배포 (단일 함수 배포 금지 — timeout 발생)
firebase deploy --only functions

# 프론트엔드 포함 전체 배포
firebase deploy
```

**절대 금지**: `firebase deploy --only functions:fnName`
→ 로딩 타임아웃으로 배포 실패

## 인증 오류 시

```bash
firebase login --reauth
```

## Git Push (pending 10개 이상 시 자동)

```bash
git add -p          # 선택적 스테이징
git commit -m "feat: ..."
git push origin master
```

## 로컬 Functions 에뮬레이터

```bash
cd functions
npm run serve       # firebase emulators:start --only functions
```

## Node.js 버전 경고

Node.js 20 → 2026-04-30 deprecated, 2026-10-30 decommissioned.
업그레이드 필요 시: `functions/package.json`의 `engines.node` 값 변경.
