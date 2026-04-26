// /assets/js/pages/town_home.hero.js
// 이미지 슬라이드쇼 히어로 – IntersectionObserver로 뷰포트 밖에서는 정지 (성능 최적화)

(function () {
  const section = document.getElementById('heroSection');
  const slides  = section && section.querySelectorAll('.hero-slide');

  if (!slides || slides.length === 0) return;

  let current = 0;
  let timer   = null;

  function next() {
    slides[current].classList.remove('is-active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('is-active');
  }

  function start() { if (!timer) timer = setInterval(next, 4500); }
  function stop()  { clearInterval(timer); timer = null; }

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;

  const observer = new IntersectionObserver(
    (entries) => { entries[0].isIntersecting ? start() : stop(); },
    { threshold: 0.1 }
  );

  observer.observe(section);
})();
