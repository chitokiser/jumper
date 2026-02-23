// /assets/js/pages/town_home.hero.js
// 비디오 히어로 – IntersectionObserver로 뷰포트에 들어왔을 때만 재생 (성능 최적화)

(function () {
  const section = document.getElementById('heroSection');
  const video   = section && section.querySelector('.hero-video-el');

  if (!video) return;

  // prefersReducedMotion 설정 시 비디오 정지
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    video.pause();
    return;
  }

  // 뷰포트 진입 시 재생, 벗어나면 정지 → 백그라운드 탭 CPU 절약
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          video.play().catch(() => { /* autoplay 정책으로 차단될 경우 조용히 처리 */ });
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.1 }
  );

  observer.observe(section);
})();
