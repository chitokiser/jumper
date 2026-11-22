// /assets/js/bc-mobile-nav.js
// 모바일 앱 스타일 하단 고정 탭바 (홈 · 쇼핑몰 · 중고 · 게임 · MY)

(function () {
  const HIDDEN_PATHS = [
    "/billiards.html",
    "/tetris.html",
    "/2048.html",
    "/suika.html",
    "/bankpanic.html",
    "/bow.html",
    "/conquest.html",
    "/memory.html",
    "/relay.html",
    "/treasure.html",
  ];

  function shouldMount() {
    const path = location.pathname.toLowerCase();
    if (path.includes("admin")) return false;
    if (HIDDEN_PATHS.some((p) => path.endsWith(p))) return false;
    return true;
  }

  function getActiveKey() {
    const path = location.pathname.toLowerCase();
    if (path === "/" || path.endsWith("/index.html") || path.endsWith("/town.html")) return "home";
    if (path.endsWith("/mall.html") || path.endsWith("/products.html") || path.endsWith("/coop.html") || path.endsWith("/cart.html")) return "mall";
    if (path.endsWith("/used.html") || path.includes("used-market")) return "used";
    if (path.endsWith("/games.html")) return "games";
    if (
      path.endsWith("/mypage.html") ||
      path.endsWith("/wallet.html") ||
      path.endsWith("/orders.html") ||
      path.endsWith("/merchant-qr.html") ||
      path.endsWith("/merchant-report.html") ||
      path.endsWith("/register.html")
    ) {
      return "my";
    }
    return "";
  }

  function mountMobileNav() {
    if (!shouldMount()) return;
    if (document.getElementById("bcMobileBottomNav")) return;

    const style = document.createElement("style");
    style.id = "bcMobileBottomNavStyle";
    style.textContent = `
      .bc-mob-nav {
        display: none;
      }
      @media (max-width: 820px) {
        body {
          padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
        }
        .bc-ai-fab {
          bottom: calc(78px + env(safe-area-inset-bottom, 0px)) !important;
        }
        .bc-ai-panel {
          bottom: calc(132px + env(safe-area-inset-bottom, 0px)) !important;
        }
        .bc-mob-nav {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 9985;
          background: rgba(255, 255, 255, 0.94);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
          border-top: 1px solid rgba(226, 232, 240, 0.95);
          box-shadow: 0 -4px 20px rgba(15, 23, 42, 0.08);
          padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
        }
        .bc-mob-tab {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          padding: 4px 2px;
          border-radius: 12px;
          text-decoration: none;
          color: #64748b;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          transition: color 0.15s ease, transform 0.12s ease, background 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .bc-mob-tab:active {
          transform: scale(0.93);
        }
        .bc-mob-tab svg {
          width: 22px;
          height: 22px;
          stroke: currentColor;
          fill: none;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .bc-mob-tab.is-active {
          color: #4f46e5;
          background: rgba(79, 70, 229, 0.08);
        }
        .bc-mob-tab.is-active svg {
          stroke-width: 2.35;
        }
        .bc-mob-badge {
          position: absolute;
          top: 0;
          right: calc(50% - 24px);
          padding: 1px 5px;
          border-radius: 999px;
          background: linear-gradient(135deg, #f59e0b, #ea580c);
          color: #fff;
          font-size: 0.56rem;
          font-weight: 900;
          line-height: 1.3;
          box-shadow: 0 2px 6px rgba(234, 88, 12, 0.35);
        }
      }
    `;
    document.head.appendChild(style);

    const active = getActiveKey();
    const tabs = [
      {
        key: "home",
        href: "/",
        label: "홈",
        icon: `<svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/></svg>`,
      },
      {
        key: "mall",
        href: "/mall.html",
        label: "쇼핑몰",
        icon: `<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>`,
      },
      {
        key: "used",
        href: "/used.html",
        label: "중고",
        icon: `<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>`,
      },
      {
        key: "games",
        href: "/games.html",
        label: "게임",
        badge: "3억",
        icon: `<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="17.5" cy="13" r="1"/></svg>`,
      },
      {
        key: "my",
        href: "/mypage.html",
        label: "MY",
        icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>`,
      },
    ];

    const nav = document.createElement("nav");
    nav.id = "bcMobileBottomNav";
    nav.className = "bc-mob-nav";
    nav.setAttribute("aria-label", "모바일 하단 메뉴");
    nav.innerHTML = tabs
      .map(
        (t) => `
        <a href="${t.href}" class="bc-mob-tab${active === t.key ? " is-active" : ""}" aria-current="${active === t.key ? "page" : "false"}">
          ${t.badge ? `<span class="bc-mob-badge">${t.badge}</span>` : ""}
          ${t.icon}
          <span>${t.label}</span>
        </a>`
      )
      .join("");

    document.body.appendChild(nav);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountMobileNav);
  } else {
    mountMobileNav();
  }
})();
