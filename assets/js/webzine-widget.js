// /assets/js/webzine-widget.js - BestClub Webzine Merchant Embed SDK
(function () {
  function initBestClubWebzineWidgets() {
    const targets = document.querySelectorAll("#bestclub-webzine-widget, [data-bestclub-webzine]");
    targets.forEach(function (el) {
      if (el.dataset.initialized === "true") return;

      const merchant = el.dataset.merchant || "";
      const theme = encodeURIComponent(el.dataset.theme || "#7c3aed");
      const layout = el.dataset.layout || "card"; // card, banner, feed
      const mode = el.dataset.mode || "light";    // light, dark
      const header = el.dataset.header !== "0" ? "1" : "0";
      const count = el.dataset.count || "4";
      const height = el.dataset.height || (layout === "banner" ? "340" : (layout === "feed" ? "680" : "520"));

      // 현재 호스트 또는 CDN 호스트
      const baseUrl = window.location.origin.includes("localhost")
        ? window.location.origin
        : "https://bestclubvn.netlify.app";

      const widgetUrl = `${baseUrl}/kca_webzine_widget.html?merchant=${encodeURIComponent(merchant)}&theme=${theme}&layout=${layout}&mode=${mode}&header=${header}&count=${count}`;

      const iframe = document.createElement("iframe");
      iframe.src = widgetUrl;
      iframe.style.width = "100%";
      iframe.style.height = height + "px";
      iframe.style.border = "none";
      iframe.style.borderRadius = "14px";
      iframe.style.overflow = "hidden";
      iframe.style.display = "block";
      iframe.setAttribute("loading", "lazy");
      iframe.setAttribute("title", "BestClub Webzine Merchant Content");

      el.innerHTML = "";
      el.appendChild(iframe);
      el.dataset.initialized = "true";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBestClubWebzineWidgets);
  } else {
    initBestClubWebzineWidgets();
  }
})();
