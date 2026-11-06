/* 탭으로 조작하는 게임 페이지 공통: 더블탭·핀치 확대 차단
   - touch-action:manipulation → 더블탭 확대 제거(탭 자체는 지연 없이 동작)
   - iOS Safari는 user-scalable=no를 무시하므로 gesture 이벤트로 핀치 확대 차단 */
(function () {
  var st = document.createElement('style');
  st.textContent = 'html,body{touch-action:manipulation;-webkit-touch-callout:none}';
  document.head.appendChild(st);
  var vp = document.querySelector('meta[name="viewport"]');
  if (vp && !/maximum-scale/.test(vp.content)) {
    vp.content = vp.content.replace(/\s*,?\s*$/, '') + ',maximum-scale=1,user-scalable=no';
  }
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); });
  });
})();
