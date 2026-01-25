// /assets/js/pages/town_home.hero.js
// 히어로 배경 슬라이더 (이미지 없으면 fallback 그라데이션)

const HERO_IMAGES = [
  "/assets/images/hero/1.png",
  "/assets/images/hero/2.png",
  "/assets/images/hero/3.png",
  "/assets/images/hero/4.png",
  "/assets/images/hero/5.png",
  "/assets/images/hero/6.png",
  "/assets/images/hero/7.png",
  "/assets/images/hero/8.png",
  "/assets/images/hero/9.png",
  "/assets/images/hero/10.png",
  "/assets/images/hero/11.png",
  "/assets/images/hero/12.png",
  "/assets/images/hero/13.png",
];

const track = document.getElementById("heroBgTrack");
const dotsEl = document.getElementById("heroDots");
const prevBtn = document.getElementById("heroPrev");
const nextBtn = document.getElementById("heroNext");

let slides = [];
let dots = [];
let idx = 0;
let timer = null;

function preload(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = reject;
    img.src = src;
  });
}

function setActive(n){
  if(!slides.length) return;
  idx = ((n % slides.length) + slides.length) % slides.length;

  slides.forEach((el, i) => el.classList.toggle("is-active", i === idx));
  dots.forEach((el, i) => el.classList.toggle("is-active", i === idx));
}

function startAuto(){
  stopAuto();
  timer = setInterval(() => setActive(idx + 1), 4500);
}

function stopAuto(){
  if(timer) clearInterval(timer);
  timer = null;
}

function buildUI(urls){
  if(!track || !dotsEl) return;

  track.innerHTML = "";
  dotsEl.innerHTML = "";
  slides = [];
  dots = [];

  urls.forEach((src, i) => {
    const s = document.createElement("div");
    s.className = "hero-bg-slide";
    s.style.backgroundImage = `url("${src}")`;
    track.appendChild(s);
    slides.push(s);

    const d = document.createElement("button");
    d.type = "button";
    d.className = "hero-dot";
    d.setAttribute("aria-label", `${i + 1}번 배경`);
    d.onclick = () => { setActive(i); startAuto(); };
    dotsEl.appendChild(d);
    dots.push(d);
  });

  setActive(0);

  if(prevBtn) prevBtn.onclick = () => { setActive(idx - 1); startAuto(); };
  if(nextBtn) nextBtn.onclick = () => { setActive(idx + 1); startAuto(); };

  // 마우스 올리면 자동 멈춤(원하면 제거 가능)
  const host = document.getElementById("heroSlider");
  if(host){
    host.addEventListener("mouseenter", stopAuto);
    host.addEventListener("mouseleave", startAuto);
  }

  startAuto();
}

async function init(){
  // 이미지 실제 존재하는 것만 사용
  const ok = [];
  for(const src of HERO_IMAGES){
    try{
      await preload(src);
      ok.push(src);
    }catch(e){
      // ignore
    }
  }

  if(ok.length === 0){
    // fallback 1장
    buildUI(["__fallback__"]);
    // fallback 슬라이드 처리
    slides[0].classList.add("is-fallback");
    slides[0].style.backgroundImage = "";
    dotsEl.style.display = "none";
    if(prevBtn) prevBtn.style.display = "none";
    if(nextBtn) nextBtn.style.display = "none";
    return;
  }

  buildUI(ok);
}

init();
