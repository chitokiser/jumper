// /assets/js/merchant-hub-widget.js - BestClub Merchant Hub Embed SDK
// 가맹점 홈페이지에 아래 2줄만 넣으면 플랫폼 바로가기 + 공지사항 + 포인트 리워드 + 이벤트가 표시됩니다.
//   <div data-bestclub-hub data-merchant="1794710386" data-theme="#b8893f" data-lang="ko"></div>
//   <script src="https://bestclubvn.netlify.app/assets/js/merchant-hub-widget.js" async></script>
// 옵션: data-mode(light|dark) data-lang(ko|vi|en) data-sections(links,notices,rewards,events) data-count(2~10) data-header(1|0)
(function () {
  var BASE = "https://bestclubvn.netlify.app";
  var seq = 0;
  var frames = {};

  window.addEventListener("message", function (e) {
    if (e.origin !== BASE && e.origin !== window.location.origin) return;
    var d = e.data;
    if (!d || d.type !== "bestclub-hub-height" || !frames[d.wid]) return;
    var h = Number(d.height);
    if (h > 0 && h < 6000) frames[d.wid].style.height = h + "px";
  });

  function init() {
    var targets = document.querySelectorAll("#bestclub-merchant-hub, [data-bestclub-hub]");
    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      if (el.dataset.initialized === "true") continue;
      var wid = "bchub" + (++seq);
      var qs = [
        "merchant=" + encodeURIComponent(el.dataset.merchant || ""),
        "theme=" + encodeURIComponent(el.dataset.theme || "#7c3aed"),
        "mode=" + encodeURIComponent(el.dataset.mode || "light"),
        "lang=" + encodeURIComponent(el.dataset.lang || "ko"),
        "sections=" + encodeURIComponent(el.dataset.sections || "links,notices,rewards,events"),
        "count=" + encodeURIComponent(el.dataset.count || "4"),
        "header=" + (el.dataset.header === "0" ? "0" : "1"),
        "wid=" + wid
      ].join("&");
      var iframe = document.createElement("iframe");
      iframe.src = BASE + "/merchant_hub_widget.html?" + qs;
      iframe.title = "BestClub";
      iframe.setAttribute("loading", "lazy");
      iframe.style.cssText = "width:100%;height:" + (el.dataset.height || "560") + "px;border:0;border-radius:14px;overflow:hidden;display:block;";
      el.innerHTML = "";
      el.appendChild(iframe);
      el.dataset.initialized = "true";
      frames[wid] = iframe;
    }
  }

  // 가맹점 사이트의 언어 토글과 연동: window.BestClubHub.setLang("vi")
  window.BestClubHub = {
    init: init,
    setLang: function (lang) {
      for (var k in frames) {
        var f = frames[k];
        var next = f.src.replace(/([?&]lang=)[^&]*/, "$1" + encodeURIComponent(lang));
        if (next !== f.src) f.src = next;
      }
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
