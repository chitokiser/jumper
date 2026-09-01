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

## 5) K-CULTURE ALLIANCE 소개

K-CULTURE ALLIANCE는 현실 세계를 기반으로 하는 Web3 보물찾기 플랫폼이다.

유저들은:

* 현실 위치에 숨겨진 보물을 찾고
* 몬스터를 사냥하고
* 직접 상점을 운영하며

게임코인을 획득할 수 있다.

---

# 게임 플레이

## 1. 보물찾기

운영자와 유저들은 현실 GPS 위치에 보물을 숨길 수 있다.

다른 유저는:

* 힌트를 해석하고
* NPC를 탐색하며
* 실제 장소를 이동해

숨겨진 보물을 찾는다.

---

## 2. 몬스터 사냥

현실 위치 기반으로 등장하는 몬스터를 사냥하여:

* 게임코인
* 아이템
* 보상

을 획득할 수 있다.

---

## 3. 유저 상점 운영

유저는 특정 지역에 자신의 상점을 개설할 수 있다.

상점 운영자는:

* 상품 판매
* 지역 독점 운영
* 판매 수수료 수익

을 얻을 수 있다.

---

# 게임코인과 JUMP 토큰

유저가 게임 내에서 획득한 게임코인은:

→ JUMP 토큰으로 교환 가능하다.

JUMP는 단순 게임코인이 아니라:

# K-CULTURE ALLIANCE의 지분(Share) 토큰

역할을 한다.

---

# JUMP 토큰 보유 혜택

JUMP 토큰을 보유하면:

* K-CULTURE ALLIANCE 주주로 인정
* 특별 혜택 제공
* 플랫폼 주요 혜택 참여 가능
* 플랫폼 수익 배당 참여 가능

---

# 플랫폼 수익 배당

K-CULTURE ALLIANCE 플랫폼에서 발생한 수익은
매주 정산되어

JUMP 토큰 보유량 비율에 따라 배당된다.

---

# K-CULTURE ALLIANCE 수익 구조

플랫폼 수익 예시:

* 가맹점 수수료
* 상점 판매 수수료
* 정회원 회비
* NPC 힌트 사용료
* JUMP 토큰 판매 수수료
* 배너 광고 수익
* 기타 플랫폼 수익

---

# HEX 토큰

K-CULTURE ALLIANCE 플랫폼의 모든 결제는
HEX 토큰 기반으로 이루어진다.

예:

* 회비 결제
* 상품 구매
* 광고 결제
* 상점 결제
* 바우처 구매

등.

---

# HEX 교환

HEX는 아래 사이트에서 교환 가능하다:

[HEX DAO Exchange](https://hexdao.netlify.app/?utm_source=chatgpt.com)

기준:

* 1 HEX = 1 USDT

---

# K-CULTURE ALLIANCE 핵심 개념

K-CULTURE ALLIANCE는:

* 현실 세계 탐험
* 위치 기반 게임
* 유저 경제 시스템
* Web3 보상 구조
* DAO 지분 시스템

유저는 탐험을 통해 획득한 보물과 게임코인을 사용하여
현실 GPS 위치에 자신만의 아지트(Base)를 구축할 수 있다.

아지트에는:

보물
NPC
대포타워
상점
광고 배너

등을 설치할 수 있으며,
다른 유저들을 자신의 지역으로 유인할 수 있다.

유저는:

보물 탐험가
지역 운영자
상점주
던전 제작자

처럼 활동하며
자신만의 현실 기반 Web3 영역을 성장시키게 된다.