// /assets/js/partials.js
// header/footer partial을 fetch로 주입합니다.
// Netlify/배포/로컬 모두 안전하게: 항상 "사이트 루트" 기준(/partials/...)으로 로드합니다.
// (페이지가 / 하위 경로여도 깨지지 않게)

(() => {
  function abs(urlPath){
    // urlPath: "/partials/header.html" 같은 루트 경로
    return new URL(urlPath, window.location.origin).toString();
  }

  function ensureCss(urlPath){
    // 모든 페이지에서 footer.css를 확실히 적용 (특정 페이지에서 로고 확대/텍스트 세로쪼개짐 방지)
    try{
      const url = abs(urlPath);
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
      const already = links.some((l) => {
        const h = String(l.href || "").split("?")[0];
        return h === String(url).split("?")[0];
      });
      if (already) return;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = urlPath; // 루트 경로 유지
      document.head.appendChild(link);
    }catch(e){
      console.warn("ensureCss failed:", e?.message || e);
    }
  }

  async function loadInto(id, urlPath) {
    const el = document.getElementById(id);
    if (!el) return false;

    const url = abs(urlPath);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`partial load failed: ${urlPath} (${res.status})`);

    const html = await res.text();
    el.innerHTML = html;
    return true;
  }

  async function mount(){
    try{
      // footer.css 누락 페이지(예: item.html)에서도 푸터 스타일을 강제 적용
      ensureCss("/assets/css/footer.css");

      // 루트 기준으로 고정
      await loadInto("siteHeader", "/partials/header.html");
      await loadInto("siteFooter", "/partials/footer.html");

      window.dispatchEvent(new CustomEvent("partials:loaded"));
      window.dispatchEvent(new CustomEvent("partials:mounted"));
    }catch(e){
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
