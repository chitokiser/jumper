// /assets/js/partials.js
(() => {
  function abs(urlPath) {
    return new URL(urlPath, window.location.origin).toString();
  }

  function ensureCss(urlPath) {
    try {
      const url = abs(urlPath);
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
      const already = links.some((l) => String(l.href || "").split("?")[0] === String(url).split("?")[0]);
      if (already) return;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = urlPath;
      document.head.appendChild(link);
    } catch (e) {
      console.warn("ensureCss failed:", e?.message || e);
    }
  }

  function ensureFavicon() {
    try {
      const existing = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      if (existing) return;

      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/png";
      link.href = "/assets/images/jump/favicon.png";
      document.head.appendChild(link);
    } catch (e) {
      console.warn("ensureFavicon failed:", e?.message || e);
    }
  }

  function ensurePwaMeta() {
    try {
      if (!document.querySelector('link[rel="manifest"]')) {
        const m = document.createElement("link");
        m.rel = "manifest";
        m.href = "/manifest.webmanifest";
        document.head.appendChild(m);
      }

      if (!document.querySelector('meta[name="theme-color"]')) {
        const t = document.createElement("meta");
        t.name = "theme-color";
        t.content = "#2563eb";
        document.head.appendChild(t);
      }

      if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
        const c = document.createElement("meta");
        c.name = "apple-mobile-web-app-capable";
        c.content = "yes";
        document.head.appendChild(c);
      }

      if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
        const s = document.createElement("meta");
        s.name = "apple-mobile-web-app-status-bar-style";
        s.content = "default";
        document.head.appendChild(s);
      }

      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const a = document.createElement("link");
        a.rel = "apple-touch-icon";
        a.href = "/assets/images/jump/favicon.png";
        document.head.appendChild(a);
      }
    } catch (e) {
      console.warn("ensurePwaMeta failed:", e?.message || e);
    }
  }

  function ensurePwaScript() {
    try {
      if (document.querySelector('script[data-pwa-install="1"]')) return;

      const s = document.createElement("script");
      s.src = "/assets/js/pwa-install.js";
      s.defer = true;
      s.dataset.pwaInstall = "1";
      document.head.appendChild(s);
    } catch (e) {
      console.warn("ensurePwaScript failed:", e?.message || e);
    }
  }

  function ensureInAppGuardScript() {
    try {
      if (document.querySelector('script[data-inapp-guard="1"]')) return;
      const s = document.createElement("script");
      s.src = "/assets/js/inapp-guard.js";
      s.defer = true;
      s.dataset.inappGuard = "1";
      document.head.appendChild(s);
    } catch (e) {
      console.warn("ensureInAppGuardScript failed:", e?.message || e);
    }
  }

  async function loadInto(id, urlPath) {
    const el = document.getElementById(id);
    if (!el) return false;

    const url = abs(urlPath);
    const reqUrl = url + (url.includes("?") ? "&" : "?") + "_pv=" + Date.now();
    const res = await fetch(reqUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`partial load failed: ${urlPath} (${res.status})`);

    // Force UTF-8 decoding to prevent mojibake when hosting sends wrong charset.
    const buf = await res.arrayBuffer();
    let html = new TextDecoder("utf-8").decode(buf);
    html = html.replace(/^\uFEFF/, "");
    el.innerHTML = html;
    return true;
  }

  async function mount() {
    try {
      ensureFavicon();
      ensureCss("/assets/css/footer.css");
      ensurePwaMeta();
      ensurePwaScript();
      ensureInAppGuardScript();

      await loadInto("siteHeader", "/partials/header.html");
      await loadInto("siteFooter", "/partials/footer.html");

      window.dispatchEvent(new CustomEvent("partials:loaded"));
      window.dispatchEvent(new CustomEvent("partials:mounted"));
    } catch (e) {
      console.warn("partials mount failed:", e?.message || e);
      window.dispatchEvent(new CustomEvent("partials:error", { detail: e }));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();


