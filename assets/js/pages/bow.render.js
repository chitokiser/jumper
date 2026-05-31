// bow.render.js — 활쏘기 렌더링 · 파티클 · 화면흔들림 (9:16 세로 전용)

export const LW = 360, LH = 640;
export const AX = LW/2, AY = LH - 60;

// 원근 5레이어
// row 0-1: 하늘 — 드래곤 전용 (scale 크게 설정해 시인성 확보)
// row 2-4: 지면/지평선 — 지상 몬스터 전용
export const ROWS = [
  { yFr:0.23, sc:0.42, spd:3.0, pts:80, dir: 1 },   // 하늘 원거리 (드래곤)
  { yFr:0.35, sc:0.65, spd:2.2, pts:60, dir:-1 },    // 하늘 근거리 (드래곤)
  { yFr:0.52, sc:0.44, spd:1.6, pts:45, dir: 1 },    // 지평선
  { yFr:0.65, sc:0.68, spd:1.0, pts:30, dir:-1 },    // 중간 지면
  { yFr:0.80, sc:0.96, spd:0.48,pts:20, dir: 1 },    // 근거리 지면
];

// ── 내부 상태 ────────────────────────────────────────────────────────────────
let _ctx = null;
let _shake = 0;
const _parts = [];   // 파티클
const _dust  = Array.from({length:18},()=>({
  x:Math.random()*LW, y:Math.random()*LH,
  vx:(Math.random()-.5)*.14, vy:-(0.10+Math.random()*.22),
  a:.05+Math.random()*.10, sz:.7+Math.random()*1.6,
  ph:Math.random()*Math.PI*2,
}));

// ── 공개 API ─────────────────────────────────────────────────────────────────
export function initBowRenderer(canvas) {
  _ctx = canvas.getContext('2d');
}

export function triggerShake(v) { _shake = Math.max(_shake, v); }

export function addHitParticles(x, y, kill, dragon=false) {
  const n   = dragon?50 : kill?26 : 12;
  const cols = dragon
    ? ['#ff6600','#ffd700','#ff2200','#cc00ff','#fff']
    : kill
      ? ['#ef4444','#ff8800','#fbbf24','#fff']
      : ['#fbbf24','rgba(255,245,130,.9)','#ff9900'];
  for (let i=0; i<n; i++) {
    const a   = Math.random()*Math.PI*2;
    const spd = (kill?6:3)*(0.25+Math.random()*.9);
    _parts.push({
      x: x+(Math.random()-.5)*10, y: y+(Math.random()-.5)*10,
      vx:Math.cos(a)*spd, vy:Math.sin(a)*spd,
      life:1, dc:kill?.008:.020,
      sz:(kill?8:4.5)*(0.35+Math.random()*.8),
      col:cols[Math.floor(Math.random()*cols.length)],
      grav:kill?.20:.03,
    });
  }
  if (kill) _parts.push({x,y,vx:0,vy:0,life:1,dc:.055,sz:dragon?55:30,col:'rgba(255,255,255,.88)',grav:0});
}

export function addArrowParticle(x, y, fire, pierce) {
  if (Math.random()>.60) return;
  _parts.push({
    x:x+(Math.random()-.5)*3, y:y+(Math.random()-.5)*3,
    vx:(Math.random()-.5)*1.0, vy:(Math.random()-.5)*1.0,
    life:1, dc:.16, grav:0,
    sz:fire?4.5:pierce?3.5:2.5,
    col:fire?`hsl(${18+Math.random()*22},100%,${46+Math.random()*20}%)`
       :pierce?'#c4b5fd':'rgba(251,191,36,.82)',
  });
}

export function updateRenderer(dt) {
  const r = dt/16.67;
  _shake = Math.max(0, _shake - .90*r);
  for (let i=_parts.length-1; i>=0; i--) {
    const p=_parts[i];
    p.x+=p.vx*r; p.y+=p.vy*r; p.vy+=p.grav*r;
    p.life-=p.dc*r;
    if (p.life<=0) _parts.splice(i,1);
  }
  for (const d of _dust) {
    d.x+=d.vx; d.y+=d.vy;
    if (d.y<-5){ d.y=LH+5; d.x=Math.random()*LW; }
    if (d.x<-5) d.x=LW+5; if (d.x>LW+5) d.x=-5;
  }
}

// ── 내부 드로잉 ──────────────────────────────────────────────────────────────
function drawBg(ctx, imgs) {
  const img=imgs.back;
  if (img) {
    const iw=img.naturalWidth||LW, ih=img.naturalHeight||LH;
    const sc=Math.max(LW/iw,LH/ih);
    ctx.drawImage(img,(LW-iw*sc)/2,(LH-ih*sc)/2,iw*sc,ih*sc);
  } else {
    ctx.fillStyle='#050510'; ctx.fillRect(0,0,LW,LH);
  }
  // 원근 안개 (하늘→지면 그라데이션)
  const fog=ctx.createLinearGradient(0,LH*.20,0,LH*.52);
  fog.addColorStop(0,'transparent'); fog.addColorStop(1,'rgba(5,5,18,.55)');
  ctx.fillStyle=fog; ctx.fillRect(0,0,LW,LH*.52);
}

function drawDust(ctx, ts) {
  ctx.save();
  for (const d of _dust) {
    ctx.globalAlpha=d.a*(.45+.55*Math.sin(ts*.0007+d.ph));
    ctx.fillStyle='rgba(140,175,255,.8)';
    ctx.beginPath(); ctx.arc(d.x,d.y,d.sz,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawMonster(ctx, sprs, m) {
  const row=ROWS[m.ri], sc=row.sc;
  const gy=row.yFr*LH;
  // 드래곤: 하늘 몬스터라 더 큰 기본 크기, 지상 몬스터: 1/2 크기
  const isDragon = m.key==='dragon';
  const bw=(isDragon?62:38)*sc, bh=(isDragon?80:49)*sc;
  const state=m.dead?'die':m.hurtLeft>0?'hurt':'walk';
  const frames=sprs[`${m.key}_${state}`];
  const img=frames?.[Math.min(m.frame,frames.length-1)]??null;

  // 원근 그림자
  ctx.save();
  ctx.globalAlpha=.14+sc*.20;
  ctx.fillStyle='#000';
  ctx.beginPath(); ctx.ellipse(m.x,gy,bw*.44,bh*.06,0,0,Math.PI*2); ctx.fill();
  ctx.restore();

  if (img) {
    ctx.save();
    ctx.translate(m.x,gy);
    if (m.dir===-1) ctx.scale(-1,1);
    ctx.drawImage(img,-bw/2,-bh,bw,bh);
    // 피격 붉은 플래시
    if (m.hurtLeft>0) {
      ctx.globalAlpha=(m.hurtLeft/450)*.62;
      ctx.fillStyle='#ff0c00'; ctx.fillRect(-bw/2,-bh,bw,bh);
    }
    ctx.restore();
  }

  // 독 오라
  const now=Date.now();
  if (m.poisonUntil>now) {
    const pulse=.25+Math.sin(now*.006)*.08;
    ctx.save(); ctx.globalAlpha=pulse;
    ctx.shadowColor='#a855f7'; ctx.shadowBlur=16*sc;
    ctx.strokeStyle='#a855f7'; ctx.lineWidth=2.2*sc;
    ctx.beginPath(); ctx.ellipse(m.x,gy-bh*.50,bw*.52,bh*.58,0,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // HP바 (3색 + 숫자)
  if (!m.dead && m.maxHp>1) {
    const bw2=bw*.72, by=gy-bh-5*sc;
    ctx.fillStyle='rgba(0,0,0,.65)'; ctx.fillRect(m.x-bw2/2,by,bw2,4*sc);
    const r=m.hp/m.maxHp;
    ctx.fillStyle=r>.6?'#22c55e':r>.3?'#f59e0b':'#ef4444';
    ctx.fillRect(m.x-bw2/2,by,bw2*r,4*sc);
    if (sc>.32) {
      ctx.font=`bold ${Math.max(7,Math.round(9*sc))}px sans-serif`;
      ctx.fillStyle='#fff'; ctx.textAlign='center';
      ctx.fillText(m.hp,m.x,by-2*sc);
    }
  }
}

function drawArrow(ctx, a) {
  const len=Math.sqrt(a.vx*a.vx+a.vy*a.vy)||1;
  const nx=a.vx/len, ny=a.vy/len, px=-ny, py=nx;
  ctx.save();
  ctx.shadowColor = a.fire?'#ff2200':a.explode?'#cc00ff':a.pierce?'#a78bfa':'#fbbf24';
  ctx.shadowBlur  = a.fire?18:a.explode?16:a.pierce?13:9;
  ctx.strokeStyle = a.fire?'#ff7700':a.explode?'#dd00ff':a.pierce?'#c4b5fd':'#fde68a';
  ctx.lineWidth   = a.fire?4:a.pierce?3.5:3;
  ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(a.x-nx*24,a.y-ny*24);
  ctx.lineTo(a.x+nx*3, a.y+ny*3);
  ctx.stroke();
  ctx.fillStyle = a.fire?'#ff4400':a.explode?'#ee00ff':a.pierce?'#8b5cf6':'#f59e0b';
  ctx.beginPath();
  ctx.moveTo(a.x+nx*13,a.y+ny*13);
  ctx.lineTo(a.x-nx*2+px*6,a.y-ny*2+py*6);
  ctx.lineTo(a.x-nx*2-px*6,a.y-ny*2-py*6);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawParticles(ctx) {
  for (const p of _parts) {
    if (p.life<=0) continue;
    const sz=Math.max(.1,p.sz*p.life);
    ctx.save();
    ctx.globalAlpha=Math.max(0,p.life);
    ctx.fillStyle=p.col;
    ctx.shadowColor=p.col; ctx.shadowBlur=sz*1.8;
    ctx.beginPath(); ctx.arc(p.x,p.y,sz,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

function drawEffects(ctx, effects) {
  ctx.textAlign='center';
  for (let i=effects.length-1; i>=0; i--) {
    const e=effects[i];
    e.y+=(e.vy||0);
    const dc={flash:.065,score:.018,msg:.015}[e.type]||.018;
    e.alpha-=dc;
    if (e.alpha<=0){effects.splice(i,1);continue;}
    ctx.save(); ctx.globalAlpha=Math.min(1,e.alpha);
    if (e.type==='score'||e.type==='msg') {
      const sz=e.big?24:15;
      ctx.font=`bold ${sz}px sans-serif`;
      ctx.strokeStyle='rgba(0,0,0,.78)'; ctx.lineWidth=3.5;
      ctx.fillStyle=e.type==='score'?'#fbbf24':'#fff';
      ctx.shadowColor=e.type==='score'?'#f59e0b':'rgba(255,255,255,.5)';
      ctx.shadowBlur=e.big?14:7;
      ctx.strokeText(e.text,e.x,e.y); ctx.fillText(e.text,e.x,e.y);
    } else if (e.type==='flash') {
      const rad=Math.max(.1,e.r*(2.4-e.alpha*1.4));
      const g=ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,rad);
      g.addColorStop(0,'rgba(255,255,255,.95)');
      g.addColorStop(.28,'rgba(255,200,50,.72)');
      g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(e.x,e.y,rad,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawArcher(ctx, imgs, st) {
  const shooting = Date.now()-st.shootTs < 380;
  const img=(shooting&&imgs.user2)?imgs.user2:imgs.user1;
  if (!img) return;
  const uh=120, uw=uh*(img.naturalWidth||1)/(img.naturalHeight||1);
  ctx.save();
  if      (st.rapidUntil>Date.now()){ ctx.shadowColor='#fbbf24'; ctx.shadowBlur=30; }
  else if (st.fireMode)              { ctx.shadowColor='#ff4400'; ctx.shadowBlur=24; }
  else if (st.pierceMode)            { ctx.shadowColor='#a78bfa'; ctx.shadowBlur=20; }
  ctx.drawImage(img, AX-uw/2, AY-uh, uw, uh);
  ctx.restore();
}

function drawCrosshair(ctx, aim) {
  const [x,y]=aim;
  ctx.save();
  ctx.strokeStyle='rgba(255,220,40,.78)';
  ctx.shadowColor='#ffd700'; ctx.shadowBlur=8;
  ctx.lineWidth=1.8;
  const r=14;
  ctx.beginPath(); ctx.moveTo(x-r,y); ctx.lineTo(x+r,y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x,y-r); ctx.lineTo(x,y+r); ctx.stroke();
  ctx.beginPath(); ctx.arc(x,y,5.5,0,Math.PI*2); ctx.stroke();
  ctx.restore();
}

// ── 메인 렌더 (외부 호출) ─────────────────────────────────────────────────────
export function renderFrame(st) {
  if (!_ctx) return;
  const ctx=_ctx;
  ctx.save();
  if (_shake>.18) ctx.translate((Math.random()-.5)*_shake*1.4,(Math.random()-.5)*_shake*.6);

  drawBg(ctx, st.imgs);
  drawDust(ctx, st.ts);
  [...st.monsters].sort((a,b)=>a.ri-b.ri).forEach(m=>drawMonster(ctx,st.sprs,m));
  for (const a of st.arrows) drawArrow(ctx,a);
  drawParticles(ctx);
  drawEffects(ctx, st.effects);
  drawArcher(ctx, st.imgs, st);
  drawCrosshair(ctx, st.aim);

  ctx.restore();
}
