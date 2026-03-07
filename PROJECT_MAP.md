<!-- /PROJECT_MAP.md -->

# Jump / Jump - 구조 고정본

이 폴더는 “Google 로그인 기반 역할(관리자/가이드/일반/게스트) + Firestore”로 동작하는 버전입니다.

## 1) 공통 로딩 규격 (모든 페이지 동일)

- partials 주입
  - /assets/js/partials.js
  - 페이지 body에 반드시 아래 2개 컨테이너가 있어야 합니다.
    - <div id="siteHeader"></div>
    - <div id="siteFooter"></div>

- auth/role/메뉴 바인딩
  - /assets/js/header-auth.js

- Firebase (module)
  - /assets/js/firebase-init.js
  - /assets/js/firestore-bridge.js

## 2) 역할(role) 단일 진실 원천 (SSOT)

role 판정은 오직 아래 로직만 사용합니다.

- /assets/js/auth.js : getUserRole(uid)
  1) admins/{uid} 존재 → admin
  2) guides/{uid}.approved === true → guide
  3) users/{uid}.role 있으면 사용
  4) 로그인만 되어 있으면 user
  5) 비로그인 guest

(roles.js는 window.__ROLE__ 레거시 호환 브릿지 용도로만 남겨둠)

## 3) Firestore rules 운영 기준

- /firestore.rules
  - 관리자는 admins/{uid} 문서 존재로 판단
  - 가이드는 guides/{uid}.approved === true
  - 공개 상품은 items.status == "published"
  - 주문은 buyerUid/ownerUid 기준으로 접근 제어

## 4) 정리된 파일(미사용/레거시)

미사용/레거시 파일은 수정 혼란 방지를 위해 /_trash 로 이동했습니다.

- /_trash/unused
  - firestore.js (구형 role 판정 포함)
  - assets/js/pages/products.js, product_detail.js (구형 UI)

- /_trash/legacy_localdb
  - api.js + storage/localdb.js (지갑/로컬DB 기반 구버전)

- /_trash/legacy_wallet
  - assets/js/core/* (지갑 연동 구버전)

필요해지면 다시 살릴 수 있지만, 현재 운영 흐름에서는 사용하지 않습니다.
