# Firestore 보안 규칙 테스트

권한 상승·가맹점 간 데이터 접근을 막는 규칙(`firestore.rules`)을 Firestore 에뮬레이터로 검사합니다.

```bash
cd tests/firestore-rules
npm i --no-save firebase-tools@13 @firebase/rules-unit-testing firebase
npx firebase emulators:exec --only firestore --project demo-rules "node rules.test.mjs"
```

Java 가 필요합니다. 결과 끝에 `N passed, 0 failed` 가 나오면 정상입니다.
