// /assets/js/inapp-guard.js
(() => {
  const DISMISS_KEY = "jumper_inapp_banner_dismissed_v1";
  const ua = (navigator.userAgent || "").toLowerCase();
  const inApp = ua.includes("kakaotalk") || ua.includes("instagram") || ua.includes("fbav") || ua.includes("fban") || ua.includes("line");
  if (!inApp) return;
  if (localStorage.getItem(DISMISS_KEY) === "1") return;

  function openExternal() {
    const url = location.href;
    const isAndroid = /android/i.test(navigator.userAgent || "");
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");

    if (isAndroid) {
      const noScheme = url.replace(/^https?:\/\//i, "");
      location.href = `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`;
      return;
    }

    if (isIOS) {
      const noScheme = url.replace(/^https?:\/\//i, "");
      location.href = `x-safari-https://${noScheme}`;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  const style = document.createElement("style");
  style.textContent = `
    .inapp-banner {
      position: sticky;
      top: 0;
      z-index: 1200;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #111827;
      color: #f9fafb;
      border-bottom: 1px solid rgba(255,255,255,.15);
      font-size: 12px;
      line-height: 1.35;
    }
    .inapp-banner button {
      border: 0;
      border-radius: 999px;
      padding: 8px 11px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .inapp-banner .go {
      background: #2563eb;
      color: #fff;
      margin-left: auto;
      white-space: nowrap;
    }
    .inapp-banner .close {
      background: rgba(255,255,255,.16);
      color: #fff;
    }
  `;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "inapp-banner";
  bar.innerHTML = `
    <span>카카오 인앱에서는 구글 로그인이 제한됩니다.</span>
    <button type="button" class="go">외부 브라우저 열기</button>
    <button type="button" class="close" aria-label="닫기">닫기</button>
  `;

  const goBtn = bar.querySelector(".go");
  const closeBtn = bar.querySelector(".close");
  goBtn?.addEventListener("click", openExternal);
  closeBtn?.addEventListener("click", () => {
    localStorage.setItem(DISMISS_KEY, "1");
    bar.remove();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => document.body.prepend(bar), { once: true });
  } else {
    document.body.prepend(bar);
  }
})();
