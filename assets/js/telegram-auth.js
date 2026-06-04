// /assets/js/telegram-auth.js
// Telegram Mini App 인증 모듈
//
// 사용법:
//   import { isTelegramMiniApp, loginWithTelegram } from '/assets/js/telegram-auth.js';
//
//   if (isTelegramMiniApp()) {
//     const { user, isNew } = await loginWithTelegram();
//   }

import { functions, auth } from '/assets/js/firebase-init.js';
import {
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import {
  signInWithCustomToken,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

/** Telegram Mini App 환경 여부 */
export function isTelegramMiniApp() {
  return !!(window.Telegram?.WebApp?.initData);
}

/** Telegram.WebApp 인스턴스 반환 (없으면 null) */
export function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

/**
 * Telegram 자동 로그인
 * 1. initData를 서버로 전송 (HMAC 검증)
 * 2. Firebase Custom Token 수신
 * 3. signInWithCustomToken으로 Firebase 인증
 *
 * @returns {{ user: FirebaseUser, uid: string, isNew: boolean } | null}
 */
export async function loginWithTelegram() {
  const twa = window.Telegram?.WebApp;
  if (!twa?.initData) return null;

  twa.ready();
  twa.expand();

  const callTelegramAuth = httpsCallable(functions, 'telegramAuth');
  const { data } = await callTelegramAuth({ initData: twa.initData });
  const { token, uid, isNew } = data;

  const cred = await signInWithCustomToken(auth, token);

  // TON 지갑 연결 대비 — 전역 노출
  window.__tgWebApp = twa;
  window.__tgUser   = twa.initDataUnsafe?.user ?? null;

  return { user: cred.user, uid, isNew };
}

/**
 * 웹 브라우저용 Telegram Login Widget 인증
 * Telegram 위젯이 콜백으로 전달한 userData를 서버에서 검증 후 Firebase 로그인
 *
 * @param {object} userData - 위젯 콜백에서 받은 {id, first_name, hash, auth_date, ...}
 * @returns {{ user, uid, isNew }}
 */
export async function loginWithTelegramWidget(userData) {
  if (!userData?.id || !userData?.hash) {
    throw new Error('텔레그램 인증 데이터가 없습니다');
  }
  const callFn = httpsCallable(functions, 'telegramWebAuth');
  const { data } = await callFn(userData);
  const { token, uid, isNew } = data;
  const cred = await signInWithCustomToken(auth, token);
  return { user: cred.user, uid, isNew };
}
