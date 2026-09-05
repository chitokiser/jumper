# K-MOA 가맹점 전용 API 연동 가이드

본 문서에서는 K-MOA 가맹점 홈페이지(웹/앱) 개발자가 K-MOA 포인트 결제 데이터, 회원(단골) DB, 그리고 AI 웹진 등을 자체 홈페이지에 가져와서 화면에 표출할 수 있도록 제공하는 **REST API** 규격을 안내합니다.

---

## 🚀 기본 설정 (Base Endpoint)

- **Base URL:** `https://us-central1-jumper-b15aa.cloudfunctions.net/merchantApi`
- 모든 API는 **GET** 요청을 바탕으로 이루어지며, 인증이 필수로 요구됩니다.

### 인증 방식 (Authentication)
모든 API 요청 시 `x-api-key` 헤더(Header) 또는 URL Parameter `?apiKey=키값`을 반드시 포함해야 합니다.
*(※ API 키는 K-MOA 관리자에게 별도로 요청하여 발급받을 수 있습니다)*

**[Header 방식 예시]**
```http
GET /v1/balance HTTP/1.1
Host: merchantapi-q7d5i6ldrq-uc.a.run.app
x-api-key: moa-merch-a1b2c3d4e5...
```

---

## 📊 1. 가맹점 잔액(포인트/BT) 조회 API

해당 가맹점 계정의 빵빵한 현재 잔여 K-MOA 포인트와 발급 가능한 BT(보너스 티켓) 재고를 실시간으로 불러옵니다.

- **Endpoint:** `/v1/balance`
- **Method:** `GET`
- **응답 성공 예시 (200 OK):**
```json
{
  "success": true,
  "merchantId": "가맹점고유ID",
  "merchantName": "대한김치 본점",
  "balance": {
    "points": 500000,
    "bt": 1500
  }
}
```

---

## 👥 2. 단골 회원(초대 유저) DB API

본 가맹점 테이블의 QR코드를 찍고 처음 가입했거나 혜택을 받은 유저들(단골 고객 풀)을 불러옵니다.
*(홈페이지에서 현재 확보된 K-MOA 멤버십 고객 리스트를 표출하거나 분석할 때 씁니다.)*

- **Endpoint:** `/v1/members`
- **Method:** `GET`
- **Parameters:**
  - `limit` (선택): 불러올 인원수 (기본값: 50, 최대 무제한)
- **응답 성공 예시 (200 OK):**
```json
{
  "success": true,
  "merchantId": "가맹점고유ID",
  "memberCount": 2,
  "members": [
    {
      "uid": "123kjasldkfj45",
      "email": "customer1@gmail.com",
      "displayName": "김치마니아",
      "userLevel": 3,
      "pointBalance": 12500,
      "btBalance": 5,
      "joinedAt": "2026-09-01T15:00:00.000Z"
    },
    {
      "uid": "678asdfjk90",
      "email": "user2@naver.com",
      "displayName": "K푸드러버",
      "userLevel": 1,
      "pointBalance": 0,
      "btBalance": 2,
      "joinedAt": "2026-09-03T11:20:00.000Z"
    }
  ]
}
```

---

## 📰 3. 가맹점 전용 AI 웹진(매거진) 리스트 API

K-MOA 관리자에서 [AI 기사 쓰기]를 통해 멋지게 완성된 나의 매장 맞춤형 기사 리스트를 불러와서, 가맹점 홈페이지 게시판이나 블로그 섹션에 곧바로 박아넣을 수 있습니다! Thumbnail 이미지도 고화질로 찰떡 제공됩니다.

- **Endpoint:** `/v1/webzines`
- **Method:** `GET`
- **Parameters:**
  - `limit` (선택): 불러올 기사 수 (기본값: 20)
- **응답 성공 예시 (200 OK):**
```json
{
  "success": true,
  "merchantId": "가맹점고유ID",
  "webzineCount": 1,
  "webzines": [
    {
      "webzineId": "docId_8x2c9",
      "title": "하노이 K-푸드 최고 맛집, 대한김치의 진가를 알아보자!",
      "excerpt": "최근 한류의 열풍과 더불어 K-푸드가 큰 사랑을 받고 있습니다. 그 중에서도 한국의 소울푸드인 김치를 전문적으로...",
      "thumbnailUrl": "https://loremflickr.com/800/600/kimchi?lock=153",
      "viewCount": 0,
      "likeCount": 15,
      "shareCount": 4,
      "readUrl": "https://kmoa.netlify.app/kca_webzine.html?id=docId_8x2c9",
      "whitelabelUrl": "https://kmoa.netlify.app/kca_webzine.html?id=docId_8x2c9&whitelabel=true",
      "publishedAt": "2026-09-05T15:20:00.000Z"
    }
  ]
}
```

### 🎯 API 활용 및 "화이트라벨(무상표)" 모드 적용 팁
- **소비자 반응 확인:** 새롭게 추가된 `likeCount` (좋아요) 및 `shareCount` (공유 횟수) 데이터를 통해, 기사에 대한 소비자들의 실제 반응을 가맹점 홈페이지에서 자체적으로 통계/표출할 수 있습니다.
- **K-MOA 흔적 지우기 (Whitelabel 모드):** API 응답값에 포함된 `whitelabelUrl`을 홈페이지 프레임(iframe)이나 버튼 링크로 연결해보세요. 접속 시 K-MOA 로고, 상단 메뉴, 그리고 "포인트 지급" 같은 특정 플랫폼 문구가 전부 감쪽같이 숨겨집니다. 오직 순수한 가맹점 브랜드 매거진으로만 보이게 되어, 브랜드 독립성에 민감한 점주님들도 안심하고 사용할 수 있습니다.

---
### 🔒 에러(오류) 처리 가이드
- `401 Unauthorized`: API 키 값이 헤더에 없음
- `403 Forbidden`: API 키 틀림 또는 만료
- `500 Internal Server Error`: 내부 데이터베이스 접근 오류

에러 발생 시 아래와 같은 공통 규격의 JSON 응답이 내려갑니다.
```json
{
  "success": false,
  "error": "상세한 에러 원인 짧은 설명"
}
```
