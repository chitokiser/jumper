// /assets/js/pages/homestay.rooms.js
// 객실 사진관: 메인 1장 + 썸네일 여러 장 + 썸네일 여러 장씩 넘김

const $ = (id) => document.getElementById(id);

const imgEl   = $("roomSlideImg");
const idxEl   = $("roomSlideIndex");
const helpEl  = $("roomSlideHelp");

const btnPrev = $("roomPrev");
const btnNext = $("roomNext");

const thumbsEl = $("roomThumbs");
const thumbPrev = $("thumbPrev");
const thumbNext = $("thumbNext");

const BASE = "/assets/images/homestay/";

// Try to use a static manifest first to avoid many HTTP probes.
async function loadValidImages(){
  // 1) manifest.json 우선
  try{
    const res = await fetch(`${BASE}manifest.json`);
    if(res && res.ok){
      const data = await res.json();
      if(Array.isArray(data) && data.length) return data.slice();
    }
  }catch(e){
    console.warn("homestay manifest fetch failed:", e);
  }

  // 2) 폴백: 병렬 프로브로 존재하는 파일만 수집(순차 probe는 느립니다)
  const MAX_TRY = 39;
  const candidates = Array.from({length: MAX_TRY}, (_,i) => `${BASE}${i+1}.png`);

  const probe = (url) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({url, ok: true});
    im.onerror = () => resolve({url, ok: false});
    im.src = url;
  });

  // 제한된 병렬성으로 실행 (브라우저에 부담 주지 않도록 배치)
  const BATCH = 8;
  const valid = [];
  for(let i=0;i<candidates.length;i+=BATCH){
    const batch = candidates.slice(i, i+BATCH).map(probe);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch);
    results.forEach(r => { if(r.ok) valid.push(r.url); });
    // 만약 연속으로 빈 결과가 길게 이어지면 조기종료 가능(옵션)
  }
  return valid;
}

let list = [];
let cur = 0;

function setActiveThumb(){
  if(!thumbsEl) return;
  const items = thumbsEl.querySelectorAll(".room-thumb");
  items.forEach((el, i) => {
    el.classList.toggle("is-active", i === cur);
    if(i === cur){
      // 현재 썸네일이 보이도록 스크롤
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  });
}

function render(){
  if(!imgEl || !idxEl) return;

  const total = list.length;
  if(total === 0){
    imgEl.style.display = "none";
    idxEl.textContent = "-";
    if(helpEl) helpEl.textContent = "객실 사진이 아직 준비되지 않았습니다. (/assets/images/homestay/1.png 부터 넣어주세요)";
    if(btnPrev) btnPrev.disabled = true;
    if(btnNext) btnNext.disabled = true;
    if(thumbPrev) thumbPrev.disabled = true;
    if(thumbNext) thumbNext.disabled = true;
    return;
  }

  const safeIndex = ((cur % total) + total) % total;
  cur = safeIndex;

  imgEl.style.display = "";
  try{ imgEl.loading = 'lazy'; }catch(e){}
  imgEl.src = list[cur];
  idxEl.textContent = `${cur + 1} / ${total}`;
  if(helpEl) helpEl.textContent = "아래 썸네일을 눌러 선택하거나 좌우 버튼으로 넘겨보세요.";

  if(btnPrev) btnPrev.disabled = false;
  if(btnNext) btnNext.disabled = false;
  if(thumbPrev) thumbPrev.disabled = false;
  if(thumbNext) thumbNext.disabled = false;

  setActiveThumb();
}

function prev(){
  cur -= 1;
  render();
}
function next(){
  cur += 1;
  render();
}

function thumbsPerPage(){
  // 화면 크기에 따라 한번에 넘길 개수 결정
  // 썸네일 폭(대략) + gap 감안해서
  if(window.matchMedia("(max-width: 640px)").matches) return 4;
  return 6;
}

function scrollThumbsByPage(dir){
  if(!thumbsEl) return;

  const per = thumbsPerPage();
  cur += dir * per;

  // 범위 보정
  const total = list.length;
  if(total > 0){
    if(cur < 0) cur = 0;
    if(cur >= total) cur = total - 1;
  }
  render();
}

function buildThumbs(){
  if(!thumbsEl) return;
  thumbsEl.innerHTML = "";

  list.forEach((url, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "room-thumb";
    btn.setAttribute("aria-label", `객실 사진 ${i + 1}`);

    const im = document.createElement("img");
    im.loading = "lazy";
    im.src = url;
    im.alt = `객실 썸네일 ${i + 1}`;

    btn.appendChild(im);
    btn.addEventListener("click", () => {
      cur = i;
      render();
    });

    thumbsEl.appendChild(btn);
  });
}

function bind(){
  if(btnPrev) btnPrev.addEventListener("click", prev);
  if(btnNext) btnNext.addEventListener("click", next);

  if(thumbPrev) thumbPrev.addEventListener("click", () => scrollThumbsByPage(-1));
  if(thumbNext) thumbNext.addEventListener("click", () => scrollThumbsByPage(1));

  // 메인 이미지 스와이프
  if(imgEl){
    let sx = 0;
    let sy = 0;
    imgEl.addEventListener("touchstart", (e) => {
      const t = e.touches?.[0];
      if(!t) return;
      sx = t.clientX;
      sy = t.clientY;
    }, { passive:true });

    imgEl.addEventListener("touchend", (e) => {
      const t = e.changedTouches?.[0];
      if(!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if(Math.abs(dx) < 30) return;
      if(Math.abs(dy) > Math.abs(dx) * 0.8) return;
      if(dx > 0) prev();
      else next();
    }, { passive:true });
  }

  // 썸네일 영역 키보드 좌우 (PC)
  if(thumbsEl){
    thumbsEl.addEventListener("keydown", (e) => {
      if(e.key === "ArrowLeft"){ e.preventDefault(); prev(); }
      if(e.key === "ArrowRight"){ e.preventDefault(); next(); }
    });
  }

  // 리사이즈 시 페이지 이동 단위가 바뀌므로 활성 썸네일 위치만 보정
  window.addEventListener("resize", () => setActiveThumb());
}

async function init(){
  if(!imgEl || !idxEl) return;
  if(helpEl) helpEl.textContent = "객실 사진 불러오는 중...";

  list = await loadValidImages();
  cur = 0;

  buildThumbs();
  bind();
  render();
}

init();
