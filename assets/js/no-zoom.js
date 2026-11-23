/* 탭으로 조작하는 게임 페이지 공통: 더블탭·핀치 확대 차단
   1. touch-action은 상속되지 않으므로 모든 요소(*)에 manipulation 적용 (스크롤 유지 + 더블탭 확대 제거 + 300ms 지연 제거)
   2. canvas는 touch-action:none 및 선택 방지로 게임 조작 중 줌/드래그 간섭 차단
   3. viewport 메타 보강 (maximum-scale=1, user-scalable=no)
   4. iOS Safari / 삼성인터넷 / 인앱브라우저용 gesture·멀티터치·더블탭 JS 차단 ({ passive: false }) */
(function () {
  var st = document.createElement('style');
  st.textContent =
    'html,body,*,*::before,*::after{touch-action:manipulation;-webkit-touch-callout:none}' +
    'canvas{touch-action:none;-webkit-user-select:none;user-select:none}';
  document.head.appendChild(st);

  var vp = document.querySelector('meta[name="viewport"]');
  if (vp) {
    var content = vp.content || 'width=device-width,initial-scale=1';
    if (!/maximum-scale/i.test(content)) content += ',maximum-scale=1';
    if (!/user-scalable/i.test(content)) content += ',user-scalable=no';
    vp.content = content.replace(/,\s*,/g, ',');
  }

  var opts = { passive: false };

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, opts);
  });

  // 두 손가락 핀치 확대 차단
  ['touchstart', 'touchmove'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (e.touches && e.touches.length > 1 && e.cancelable) {
        e.preventDefault();
      }
    }, opts);
  });

  // 구형 브라우저·인앱 웹뷰용 더블탭 확대 추가 차단 (버튼/입력창 정상 동작 보존)
  var lastTouchEnd = 0;
  function isFormOrInteractive(el) {
    return !!(el && el.closest && el.closest('input,textarea,select,button,a,label,[role="button"],[contenteditable="true"]'));
  }

  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 320 && e.cancelable && !isFormOrInteractive(e.target)) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, opts);

  document.addEventListener('dblclick', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('input,textarea,select,[contenteditable="true"]')) {
      e.preventDefault();
    }
  }, opts);
})();

