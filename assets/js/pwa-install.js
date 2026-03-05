// /assets/js/pwa-install.js
(() => {
  const DISMISS_KEY = "jumper_pwa_install_dismissed_v1";
  const IOS_DISMISS_KEY = "jumper_ios_install_dismissed_v1";

  const inStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (inStandalone) return;

  function ensureInstallStyles() {
    if (document.getElementById("pwaInstallStyle")) return;
    const style = document.createElement("style");
    style.id = "pwaInstallStyle";
    style.textContent = `
      .pwa-install-fab {
        position: fixed;
        right: calc(14px + env(safe-area-inset-right, 0px));
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        z-index: 9999;
        border: 0;
        border-radius: 999px;
        padding: 11px 14px;
        background: #2563eb;
        color: #fff;
        font-weight: 700;
        box-shadow: 0 8px 24px rgba(37,99,235,.35);
        cursor: pointer;
      }
      .pwa-install-sheet {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: calc(68px + env(safe-area-inset-bottom, 0px));
        z-index: 9998;
        background: #fff;
        border: 1px solid rgba(26,39,68,.12);
        border-radius: 14px;
        box-shadow: 0 12px 30px rgba(16,24,40,.16);
        padding: 12px;
        color: #1a2744;
      }
      .pwa-install-row {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
      }
      .pwa-install-title {
        margin: 0;
        font-size: 14px;
        font-weight: 800;
      }
      .pwa-install-sub {
        margin: 4px 0 0;
        font-size: 12px;
        color: rgba(26,39,68,.68);
      }
      .pwa-install-btn {
        border: 0;
        border-radius: 10px;
        padding: 9px 11px;
        font-weight: 700;
        cursor: pointer;
      }
      .pwa-install-btn.primary { background: #2563eb; color: #fff; }
      .pwa-install-btn.ghost { background: #eef5ff; color: #1a2744; }
      @media (min-width: 861px) {
        .pwa-install-fab { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isIosSafari() {
    const ua = navigator.userAgent || "";
    const iOS = /iPhone|iPad|iPod/.test(ua);
    const webkit = /WebKit/.test(ua);
    const noCriOS = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return iOS && webkit && noCriOS;
  }

  function makeInstallFab(onClick) {
    const fab = document.createElement("button");
    fab.className = "pwa-install-fab";
    fab.type = "button";
    fab.textContent = "앱으로 설치";
    fab.addEventListener("click", onClick);
    document.body.appendChild(fab);
    return fab;
  }

  function makeSheet(title, sub, onPrimary, onDismiss, primaryText = "설치") {
    const wrap = document.createElement("div");
    wrap.className = "pwa-install-sheet";
    wrap.innerHTML = `
      <p class="pwa-install-title">${title}</p>
      <p class="pwa-install-sub">${sub}</p>
      <div class="pwa-install-row" style="margin-top:10px;">
        <button class="pwa-install-btn ghost" type="button" data-act="dismiss">닫기</button>
        <button class="pwa-install-btn primary" type="button" data-act="primary">${primaryText}</button>
      </div>
    `;

    wrap.querySelector('[data-act="primary"]').addEventListener("click", onPrimary);
    wrap.querySelector('[data-act="dismiss"]').addEventListener("click", () => {
      onDismiss?.();
      wrap.remove();
    });
    document.body.appendChild(wrap);
    return wrap;
  }

  function registerSw() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  function bootAndroidInstallPrompt() {
    if (!isMobile()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    let deferredPrompt = null;
    let sheet = null;
    let fab = null;

    function openInstall() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(() => {
        deferredPrompt = null;
        sheet?.remove();
        fab?.remove();
      });
    }

    function dismiss() {
      localStorage.setItem(DISMISS_KEY, "1");
      sheet?.remove();
      fab?.remove();
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      ensureInstallStyles();
      if (!sheet) {
        sheet = makeSheet("홈 화면에 추가", "한 번 설치하면 앱처럼 빠르게 실행할 수 있어요.", openInstall, dismiss, "추가하기");
      }
      if (!fab) {
        fab = makeInstallFab(openInstall);
      }
    });

    window.addEventListener("appinstalled", () => {
      sheet?.remove();
      fab?.remove();
      deferredPrompt = null;
    });
  }

  function bootIosGuide() {
    if (!isIosSafari()) return;
    if (localStorage.getItem(IOS_DISMISS_KEY) === "1") return;

    ensureInstallStyles();
    const sheet = makeSheet(
      "홈 화면에 추가",
      "Safari 공유 버튼(□↑)을 누른 뒤 '홈 화면에 추가'를 선택해 주세요.",
      () => {
        localStorage.setItem(IOS_DISMISS_KEY, "1");
        sheet.remove();
      },
      () => localStorage.setItem(IOS_DISMISS_KEY, "1"),
      "확인"
    );
  }

  registerSw();
  bootAndroidInstallPrompt();
  bootIosGuide();
})();
