// /assets/js/pages/town_home.hero.js
// 이미지 슬라이드쇼 히어로 – 진행 막대로 위치 표시, 뷰포트 밖에서는 정지 (성능 최적화)

(function () {
  const INTERVAL = 4500;
  const section  = document.getElementById('heroSection');
  const slides   = section && section.querySelectorAll('.hero-slide');
  const progress = document.getElementById('heroProgress');

  if (!slides || slides.length === 0) return;

  let current = 0;
  let timer   = null;
  let visible = false;

  section.style.setProperty('--hero-interval', INTERVAL + 'ms');

  // 진행 막대: 슬라이드마다 한 칸, 눌러서 이동
  const bars = [];
  if (progress && slides.length > 1) {
    slides.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `${i + 1}번째 그림 보기`);
      b.appendChild(document.createElement('span'));
      b.addEventListener('click', () => { show(i); restart(); });
      progress.appendChild(b);
      bars.push(b);
    });
  }

  function paintBars() {
    bars.forEach((b, i) => {
      b.classList.toggle('is-done', i < current);
      b.classList.remove('is-active');
    });
    const active = bars[current];
    if (active) {
      void active.offsetWidth; // 애니메이션 다시 시작
      active.classList.add('is-active');
    }
  }

  function show(i) {
    slides[current].classList.remove('is-active');
    current = (i + slides.length) % slides.length;
    slides[current].classList.add('is-active');
    paintBars();
  }

  function next() { show(current + 1); }

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function start() { if (!timer && !prefersReduced) timer = setInterval(next, INTERVAL); }
  function stop()  { clearInterval(timer); timer = null; }
  function restart() { stop(); if (visible) start(); }

  paintBars();
  if (prefersReduced) return;

  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      section.classList.toggle('is-paused', !visible);
      if (visible) { paintBars(); start(); } else { stop(); }
    },
    { threshold: 0.1 }
  );

  observer.observe(section);
})();
