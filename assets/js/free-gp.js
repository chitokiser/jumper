// free-gp.js — 무료 일일 GP 충전 (보유 GP 100 미만이면 하루 1회 100 GP)
// 지급 판정·기록은 서버 함수 claimFreeDailyGp 가 한다 (화면은 결과만 표시)
import { functions } from '/assets/js/firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

export const FREE_GP_THRESHOLD = 100;

function toast(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:99999;'
    + 'background:linear-gradient(135deg,#065f46,#047857);color:#fff;font-weight:800;font-size:14px;'
    + 'padding:12px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35);text-align:center;max-width:90%';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/** 보유 GP가 100 미만일 때 호출 — 지급되면 토스트를 띄우고 결과 반환 */
export async function claimFreeDailyGp({ silent = false } = {}) {
  try {
    const res = await httpsCallable(functions, 'claimFreeDailyGp')();
    const d = res.data || {};
    if (d.granted && !silent) toast(`🎁 오늘의 무료 충전 +${d.gp} GP! (GP 100 미만 회원 하루 1회)`);
    return d;
  } catch {
    return { granted: false };
  }
}
