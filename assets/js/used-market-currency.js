// /assets/js/used-market-currency.js
// 회원간 중고거래 금액 표준: 베트남 동(VND). (CLAUDE.md §10.1 기본 통화 VND)
// - currency === "VND" 인 글: price 는 VND
// - currency 가 없는 글: 2026-10 이전 원화(KRW) 입력 글 → 원으로 표시 (DB 환산 전 과도기 대응)

/** 기존 원화 글 환산 기준 (2026-10-19 대표 확정: 1원 = 18동) */
export const LEGACY_KRW_TO_VND = 18;

export function isVndPost(post) {
  return post?.currency === "VND";
}

/** 목록·상세 표시용 금액 문자열 */
export function formatUsedPrice(post) {
  const n = Number(post?.price || 0);
  if (isVndPost(post)) return `${n.toLocaleString("en-US")} VND`;
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 수정 폼 입력값 (항상 VND). 원화 글은 환산한 값으로 채운다. */
export function priceForVndInput(post) {
  const n = Number(post?.price || 0);
  return isVndPost(post) ? n : Math.round(n * LEGACY_KRW_TO_VND);
}
