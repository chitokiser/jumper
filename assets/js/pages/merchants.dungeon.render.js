// merchants.dungeon.render.js — v7 (2x player, lighting, screenshake, zoom, enhanced effects)
import { GRID_W, GRID_H, CELL, WORLD_W, WORLD_H } from './merchants.dungeon.map.js';

// ── 스프라이트 캐시 ───────────────────────────────────────────────────────
export const IMGS = {
  tower:null, tower2:null,
  p_body:null, p_head:null, p_armL:null, p_armR:null,
  p_legL:null, p_legR:null, p_handL:null, p_handR:null,
  p_bow1:null, p_bow2:null, p_quiver:null, p_arrow:null,
  m:{},
};

function _s3(n){ return String(n).padStart(3,'0'); }
function _fs(d,p,a,n){ return Array.from({length:n},(_,i)=>`/assets/images/monsters/${d}/${p}${a}_${_s3(i)}.png`); }
function _fn(d,p,n){ return Array.from({length:n},(_,i)=>`/assets/images/monsters/${d}/${p}${i+1}.png`); }

export const MSPRITE_DEFS = {
  orc1:   {walk:_fs('orc','ORK_01_','WALK',6),   atk:_fs('orc','ORK_01_','ATTAK',6),  hurt:_fs('orc','ORK_01_','HURT',6),  die:_fs('orc','ORK_01_','DIE',6)},
  orc2:   {walk:_fs('orc2','ORK_02_','WALK',6),  atk:_fs('orc2','ORK_02_','ATTAK',6), hurt:_fs('orc2','ORK_02_','HURT',6), die:_fs('orc2','ORK_02_','DIE',6)},
  orc3:   {walk:_fs('orc3','ORK_03_','WALK',6),  atk:_fs('orc3','ORK_03_','ATTAK',6), hurt:_fs('orc3','ORK_03_','HURT',6), die:_fs('orc3','ORK_03_','DIE',6)},
  pirate1:{walk:_fs('pirate','1_entity_000_','WALK',6), atk:_fs('pirate','1_entity_000_','ATTACK',6), hurt:_fs('pirate','1_entity_000_','HURT',6), die:_fs('pirate','1_entity_000_','DIE',6)},
  zombie: {walk:_fn('zombie1/animation','Run',8), atk:_fn('zombie1/animation','Attack',6), hurt:_fn('zombie1/animation','Hurt',5), die:_fn('zombie1/animation','Dead',8)},
  dragon: {
    walk:Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/fly${_s3(i)}.png`),
    atk: Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/attak${_s3(i)}.png`),
    hurt:Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/idle${_s3(i)}.png`),
    die: Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/attak${_s3(i)}.png`),
  },
};

export async function loadAllDungeonSprites() {
  const ld=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=s;});
  IMGS.tower =await ld('/assets/images/shops/tower.png');
  IMGS.tower2=await ld('/assets/images/shops/tower2.png');
  const pp='/assets/images/monsters/1/';
  [IMGS.p_body,IMGS.p_head,IMGS.p_armL,IMGS.p_armR,
   IMGS.p_legL,IMGS.p_legR,IMGS.p_handL,IMGS.p_handR,
   IMGS.p_bow1,IMGS.p_bow2,IMGS.p_quiver,IMGS.p_arrow]=await Promise.all([
    ld(pp+'1_body.png'),ld(pp+'1_head.png'),ld(pp+'1_arm left.png'),ld(pp+'1_arm right.png'),
    ld(pp+'1_leg left.png'),ld(pp+'1_leg right.png'),ld(pp+'1_hand left.png'),ld(pp+'1_hand right.png'),
    ld(pp+'1_bow1.png'),ld(pp+'1_bow2.png'),ld(pp+'1_quiver.png'),ld(pp+'arrow.png'),
  ]);
  await Promise.all(Object.entries(MSPRITE_DEFS).map(async([k,d])=>{
    IMGS.m[k]={walk:[],atk:[],hurt:[],die:[]};
    for (const a of ['walk','atk','hurt','die'])
      IMGS.m[k][a]=await Promise.all(d[a].map(ld));
  }));
}

// ── 캔버스 상태 ──────────────────────────────────────────────────────────
let _ctx=null, _W=0, _H=0;

export function initDungeonRenderer(canvas) {
  _ctx=canvas.getContext('2d'); _W=canvas.width; _H=canvas.height;
}
export function resizeDungeonRenderer(canvas){ initDungeonRenderer(canvas); }

// ── 뷰포트 설정 ──────────────────────────────────────────────────────────
const VIEWPORT_BASE = 120;  // zoom=1일 때 화면에 보이는 월드 단위(가로)

// ── 메인 렌더 ────────────────────────────────────────────────────────────
export function renderDungeonFrame(st) {
  if (!_ctx||!_W||!_H) return;
  const {mapImg,player,monsters,projs,floats,effects,drops,rooms,cam,ts,debug,walkable,
         zoom=1.0,shake={x:0,y:0}} = st;

  const VIEWPORT = VIEWPORT_BASE / Math.max(0.3, zoom);
  const scale = _W / VIEWPORT;
  const visH  = _H / scale;

  // ── ① 배경 초기화 ────────────────────────────────────────────────────
  _ctx.fillStyle='#050508';
  _ctx.fillRect(0,0,_W,_H);

  // 화면 흔들림 적용
  const sx = shake.x * scale * 0.5;
  const sy = shake.y * scale * 0.5;

  // ── ② dungeon.png 배경 ───────────────────────────────────────────────
  if (mapImg && mapImg.naturalWidth>0 && mapImg.naturalHeight>0) {
    const iw=mapImg.naturalWidth, ih=mapImg.naturalHeight;
    const wLeft = cam.x - VIEWPORT/2;
    const wTop  = cam.y - visH/2;
    const imgSx = wLeft/WORLD_W * iw;
    const imgSy = wTop /WORLD_H * ih;
    const imgSw = VIEWPORT/WORLD_W * iw;
    const imgSh = visH   /WORLD_H * ih;
    const csx=Math.max(0,imgSx), csy=Math.max(0,imgSy);
    const cex=Math.min(iw,imgSx+imgSw), cey=Math.min(ih,imgSy+imgSh);
    const ow=(csx-imgSx)/imgSw*_W+sx, oh=(csy-imgSy)/imgSh*_H+sy;
    const dw=(cex-csx)/imgSw*_W, dh=(cey-csy)/imgSh*_H;
    if (dw>0&&dh>0) _ctx.drawImage(mapImg, csx,csy, cex-csx,cey-csy, ow,oh, dw,dh);
  }

  // ── ③ 월드 좌표 엔티티 ────────────────────────────────────────────────
  _ctx.save();
  _ctx.translate(_W/2 - cam.x*scale + sx, _H/2 - cam.y*scale + sy);

  if (debug?.navmesh && walkable) {
    for (let y=0;y<GRID_H;y++) for (let x=0;x<GRID_W;x++) {
      if (!walkable[y*GRID_W+x]) {
        _ctx.fillStyle='rgba(239,68,68,0.25)';
        _ctx.fillRect(x*CELL*scale,y*CELL*scale,CELL*scale,CELL*scale);
      }
    }
  }

  if (debug?.rooms && rooms?.length) {
    const RC=['#3b82f6','#22c55e','#f59e0b','#a78bfa','#f87171','#34d399','#fb923c','#60a5fa'];
    rooms.forEach((rm,i)=>{
      _ctx.save(); _ctx.globalAlpha=0.09; _ctx.fillStyle=RC[i%RC.length];
      for (const [gx,gy] of rm.cells) _ctx.fillRect(gx*CELL*scale,gy*CELL*scale,CELL*scale,CELL*scale);
      _ctx.restore();
      _ctx.fillStyle=RC[i%RC.length]; _ctx.font=`bold ${Math.round(scale*3)}px sans-serif`;
      _ctx.textAlign='center'; _ctx.textBaseline='middle';
      _ctx.fillText(`R${i+1}`,rm.cx*scale,rm.cy*scale);
    });
  }

  _drawEffects(_ctx, effects, scale);

  // 드롭 아이템
  _ctx.textAlign='center'; _ctx.textBaseline='middle';
  for (const d of drops) {
    _ctx.font=`${Math.round(scale*3.5)}px sans-serif`;
    _ctx.shadowColor='#fbbf24'; _ctx.shadowBlur=scale*2;
    _ctx.fillText(d.skillId?d.emoji||'✨':d.hp?'🧪':d.mp?'💙':'💰',d.x*scale,d.y*scale);
    _ctx.shadowBlur=0;
  }

  if (debug?.detect) {
    for (const m of monsters) {
      if (m.state==='die') continue;
      _ctx.save(); _ctx.globalAlpha=0.1; _ctx.fillStyle='#ef4444';
      _ctx.beginPath(); _ctx.arc(m.x*scale,m.y*scale,m.def.detect*scale,0,Math.PI*2); _ctx.fill();
      _ctx.restore();
    }
  }

  // 몬스터
  for (const m of monsters) {
    const sp=MSPRITE_DEFS[m.def.sp];
    if (!sp) continue;
    const nf=sp.die?.length||6;
    if (m.state==='die'&&m.frame>=nf-1) continue;
    _drawMonster(_ctx, m, scale, ts);
  }

  // 발사체
  for (const pr of projs) {
    _ctx.save();
    if (pr.isArrow) {
      const len=scale*3.5;
      const sp=Math.hypot(pr.vx,pr.vy)||1;
      const ax=pr.vx/sp, ay=pr.vy/sp;
      _ctx.strokeStyle='#fde68a'; _ctx.lineWidth=scale*0.45; _ctx.lineCap='round';
      _ctx.shadowColor='#f59e0b'; _ctx.shadowBlur=scale*2;
      _ctx.beginPath();
      _ctx.moveTo(pr.x*scale-ax*len, pr.y*scale-ay*len);
      _ctx.lineTo(pr.x*scale+ax*len*.5, pr.y*scale+ay*len*.5);
      _ctx.stroke();
    } else {
      _ctx.fillStyle=pr.color||'#ef4444';
      _ctx.shadowColor=pr.color||'#ef4444'; _ctx.shadowBlur=scale;
      _ctx.beginPath(); _ctx.arc(pr.x*scale,pr.y*scale,scale*0.8,0,Math.PI*2); _ctx.fill();
    }
    _ctx.shadowBlur=0; _ctx.restore();
  }

  // 플레이어
  if (player) _drawPlayer(_ctx, player, scale, ts);

  // 플로팅 텍스트
  _ctx.textAlign='center'; _ctx.textBaseline='middle';
  for (const f of floats) {
    _ctx.save(); _ctx.globalAlpha=Math.min(1,f.life);
    _ctx.font=`bold ${Math.round(scale*2.5)}px sans-serif`;
    _ctx.fillStyle=f.color||'#fff';
    _ctx.strokeStyle='rgba(0,0,0,.8)'; _ctx.lineWidth=0.4*scale;
    _ctx.strokeText(f.text,f.wx*scale,f.wy*scale);
    _ctx.fillText(f.text,f.wx*scale,f.wy*scale);
    _ctx.restore();
  }

  _ctx.restore(); // 카메라 트랜스폼 해제

  // ── ④ 다이나믹 조명 (카메라 해제 후, 화면 좌표로 그리기) ──────────────
  if (player) _drawLighting(_ctx, player, scale, cam, ts, VIEWPORT, visH);

  // ── ⑤ 디버그 HUD ─────────────────────────────────────────────────────
  if (debug&&(debug.navmesh||debug.detect||debug.path||debug.rooms)) {
    _ctx.fillStyle='rgba(0,0,0,.7)'; _ctx.fillRect(4,4,190,16);
    _ctx.fillStyle='#fbbf24'; _ctx.font='10px monospace'; _ctx.textAlign='left';
    _ctx.fillText('F1:NavMesh F2:Detect F3:Path F4:Rooms',7,14);
  }
}

// ── 다이나믹 조명 (비네팅 + 토치 플리커) ─────────────────────────────────
function _drawLighting(ctx, player, scale, cam, ts, VIEWPORT, visH) {
  // 플레이어 화면 중앙 위치
  const px = _W/2, py = _H/2;

  // 토치 플리커 (sin 합성으로 자연스러운 깜빡임)
  const flicker = 1.0
    + Math.sin(ts * 0.003) * 0.06
    + Math.sin(ts * 0.0071) * 0.04
    + Math.sin(ts * 0.0137) * 0.02;

  // 조명 반경 (화면의 ~55%)
  const lightR = Math.min(_W, _H) * 0.55 * flicker;
  const outerR = Math.min(_W, _H) * 1.1;

  // 방사형 그래디언트 — 중심 투명, 외곽 어두움
  const grad = ctx.createRadialGradient(px, py, lightR*0.3, px, py, outerR);
  grad.addColorStop(0,   'rgba(0,0,0,0)');
  grad.addColorStop(0.55,'rgba(0,0,0,0.15)');
  grad.addColorStop(0.78,'rgba(0,0,0,0.55)');
  grad.addColorStop(1,   'rgba(0,0,0,0.92)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, _W, _H);

  // 따뜻한 토치 색온도 오버레이
  const warmGrad = ctx.createRadialGradient(px, py, 0, px, py, lightR * 1.2);
  warmGrad.addColorStop(0,   `rgba(255,180,60,${0.06 * flicker})`);
  warmGrad.addColorStop(0.5, `rgba(255,120,20,${0.04 * flicker})`);
  warmGrad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = warmGrad;
  ctx.fillRect(0, 0, _W, _H);
}

// ── 플레이어 (2배 크기) ───────────────────────────────────────────────────
function _drawPlayer(ctx, p, scale, ts) {
  const t=ts*0.001;
  const ph=IMGS.p_body?.naturalHeight||200;
  // 플레이어 높이: scale * 16 (기존 8에서 2배)
  const sc=scale*16/ph;

  let bodyY=0,armLA=0,armRA=0,legLA=0,legRA=0;
  if (p.animState==='walk') {
    bodyY=Math.abs(Math.sin(t*8))*(-scale*0.5);
    armLA=Math.sin(t*8)*0.35; armRA=-armLA;
    legLA=Math.sin(t*8)*0.38; legRA=-legLA;
  } else {
    bodyY=Math.sin(t*2)*scale*0.15;
    armLA=Math.sin(t*1.8)*0.04; armRA=-armLA;
  }

  ctx.save();
  ctx.translate(p.x*scale, p.y*scale-scale*0.5);
  if (p.facing<0) ctx.scale(-1,1);

  ctx.save(); ctx.translate(0,bodyY);
  _part(ctx,IMGS.p_quiver, scale*.5,  -scale*.2,  0.1,   sc*.55);
  _part(ctx,IMGS.p_legR,   scale*.15,  scale*.8,  legRA, sc*.72);
  _part(ctx,IMGS.p_armR,   scale*.35, -scale*.1,  armRA, sc*.75);
  _part(ctx,IMGS.p_body,   0,0,0,sc);
  _part(ctx,IMGS.p_bow1,   scale*.45, -scale*.2,  armRA*.6, sc*.8);
  _part(ctx,IMGS.p_legL,  -scale*.15,  scale*.8,  legLA, sc*.72);
  _part(ctx,IMGS.p_armL,  -scale*.35, -scale*.1,  armLA, sc*.75);
  _part(ctx,IMGS.p_head,   0,         -scale*.95, 0,     sc*.62);
  _part(ctx,IMGS.p_handR,  scale*.55, -scale*.1,  armRA, sc*.50);
  _part(ctx,IMGS.p_handL, -scale*.50, -scale*.1,  armLA, sc*.50);
  ctx.restore();

  // HP 바
  const bw=scale*6, bh=scale*0.5, bx=-bw/2, by=-scale*3.5;
  ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(bx,by,bw,bh);
  const r=Math.max(0,p.hp/p.maxHp);
  ctx.fillStyle=r>.6?'#22c55e':r>.3?'#f59e0b':'#ef4444';
  ctx.fillRect(bx,by,bw*r,bh);

  ctx.restore();
}

function _part(ctx,img,ox,oy,angle,sc) {
  if (!img?.naturalWidth) return;
  ctx.save(); ctx.translate(ox,oy);
  if (angle) ctx.rotate(angle);
  const w=img.naturalWidth*sc, h=img.naturalHeight*sc;
  ctx.drawImage(img,-w/2,-h/2,w,h);
  ctx.restore();
}

// ── 몬스터 ───────────────────────────────────────────────────────────────
function _drawMonster(ctx, m, scale, ts) {
  const spKey=m.def.sp;
  const sp=MSPRITE_DEFS[spKey];
  const anim=m.state==='die'?'die':m.state==='attack'?'atk':'walk';
  const frames=IMGS.m[spKey]?.[anim];
  const img=frames?.[Math.min(m.frame,(frames.length||1)-1)];

  const dispH=m.def.sz*scale*4;
  const dispW=img?(img.naturalWidth/img.naturalHeight)*dispH:dispH;
  const dieAlpha=m.state==='die'?Math.max(0.1,1-(m.frame/((MSPRITE_DEFS[spKey]?.die?.length||6)-1))):1;

  ctx.save();
  ctx.translate(m.x*scale, m.y*scale);
  if (m.facing<0) ctx.scale(-1,1);
  ctx.globalAlpha=dieAlpha;

  ctx.save(); ctx.globalAlpha=dieAlpha*.35;
  ctx.fillStyle='rgba(0,0,0,.6)';
  ctx.beginPath(); ctx.ellipse(0,m.def.sz*scale*.35,m.def.sz*scale*.65,m.def.sz*scale*.2,0,0,Math.PI*2); ctx.fill();
  ctx.restore();

  if (img) {
    ctx.drawImage(img,-dispW/2,-dispH+m.def.sz*scale*.35,dispW,dispH);
  } else {
    ctx.fillStyle='#ef4444';
    ctx.beginPath(); ctx.arc(0,0,m.def.sz*scale,0,Math.PI*2); ctx.fill();
  }

  if (m.state!=='die') {
    const bw=m.def.sz*scale*2.5, bh=scale*0.5;
    const by=-dispH+m.def.sz*scale*.2;
    ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(-bw/2,by,bw,bh);
    ctx.fillStyle='#ef4444'; ctx.fillRect(-bw/2,by,bw*Math.max(0,m.hp/m.def.maxHp),bh);
    if (m.def.isBoss) {
      ctx.fillStyle='#f59e0b'; ctx.font=`bold ${Math.round(scale*2)}px sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('BOSS',0,by-scale*1.2);
    }
  }
  ctx.restore();
}

// ── 이펙트 (강화된 파티클) ───────────────────────────────────────────────
function _drawEffects(ctx, effects, scale) {
  if (!effects) return;
  const now=Date.now();
  for (const ef of effects) {
    const p=Math.min(1,(now-ef.at)/ef.dur);
    if (p>=1) continue;
    ctx.save(); ctx.globalAlpha=(1-p)*.85;
    const ex=ef.x*scale, ey=ef.y*scale, er=ef.r*scale;

    if (ef.type==='fire') {
      // 불꽃: 다중 레이어 + 파티클
      const g=ctx.createRadialGradient(ex,ey,0,ex,ey,er*(1+p*.5));
      g.addColorStop(0,'rgba(255,255,200,.95)');
      g.addColorStop(0.3,ef.color+'ee');
      g.addColorStop(0.7,'rgba(220,50,0,.6)');
      g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(ex,ey,er*(1+p*.5),0,Math.PI*2); ctx.fill();
      // 스파크 파티클
      ctx.shadowColor=ef.color; ctx.shadowBlur=scale*3;
      for (let i=0; i<8; i++) {
        const a=i/8*Math.PI*2+p*4, r=er*(0.5+p*0.5);
        ctx.fillStyle='rgba(255,200,50,.8)';
        ctx.beginPath(); ctx.arc(ex+Math.cos(a)*r,ey+Math.sin(a)*r,scale*0.8,0,Math.PI*2); ctx.fill();
      }
      ctx.shadowBlur=0;

    } else if (ef.type==='ice') {
      const g=ctx.createRadialGradient(ex,ey,0,ex,ey,er*(1+p*.3));
      g.addColorStop(0,'rgba(200,240,255,.9)');
      g.addColorStop(0.4,ef.color+'cc');
      g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(ex,ey,er*(1+p*.3),0,Math.PI*2); ctx.fill();
      // 결정 파티클
      ctx.strokeStyle='rgba(180,230,255,.7)'; ctx.lineWidth=scale*0.4;
      for (let i=0; i<6; i++) {
        const a=i/6*Math.PI*2, r=er*(0.3+p*0.6);
        ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex+Math.cos(a)*r,ey+Math.sin(a)*r); ctx.stroke();
      }

    } else if (ef.type==='wind') {
      // 회오리
      for (let ring=0; ring<3; ring++) {
        const rScale=0.5+ring*0.25;
        const g=ctx.createRadialGradient(ex,ey,0,ex,ey,er*rScale*(1+p*.2));
        g.addColorStop(0,'transparent');
        g.addColorStop(0.6,ef.color+'44');
        g.addColorStop(1,'transparent');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(ex,ey,er*rScale*(1+p*.2),0,Math.PI*2); ctx.fill();
      }

    } else if (ef.type==='bolt') {
      ctx.strokeStyle=ef.color; ctx.lineWidth=scale*.5; ctx.shadowColor=ef.color; ctx.shadowBlur=scale*4;
      for (const seg of ef.segs||[]) {
        ctx.beginPath(); ctx.moveTo(seg.from.x*scale,seg.from.y*scale); ctx.lineTo(seg.to.x*scale,seg.to.y*scale); ctx.stroke();
        // 충격파
        ctx.lineWidth=scale*1.5; ctx.globalAlpha=(1-p)*.2;
        ctx.beginPath(); ctx.moveTo(seg.from.x*scale,seg.from.y*scale); ctx.lineTo(seg.to.x*scale,seg.to.y*scale); ctx.stroke();
        ctx.globalAlpha=(1-p)*.85; ctx.lineWidth=scale*.5;
      }

    } else if (ef.type==='meteor_warn') {
      ctx.strokeStyle=ef.color; ctx.lineWidth=scale*.35;
      ctx.setLineDash([scale,scale]); ctx.shadowColor=ef.color; ctx.shadowBlur=scale*2;
      ctx.beginPath(); ctx.arc(ex,ey,er,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]); ctx.shadowBlur=0;
      // 경고 크로스헤어
      ctx.strokeStyle='rgba(251,146,60,.5)'; ctx.lineWidth=scale*.2;
      ctx.beginPath(); ctx.moveTo(ex-er,ey); ctx.lineTo(ex+er,ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex,ey-er); ctx.lineTo(ex,ey+er); ctx.stroke();

    } else if (ef.type==='meteor_hit') {
      // 폭발: 다중 레이어
      const blast=er*(1+p*2.5);
      const g2=ctx.createRadialGradient(ex,ey,0,ex,ey,blast);
      g2.addColorStop(0,'rgba(255,255,220,1)');
      g2.addColorStop(0.2,'rgba(255,160,20,.95)');
      g2.addColorStop(0.5,ef.color+'cc');
      g2.addColorStop(0.8,'rgba(100,30,0,.4)');
      g2.addColorStop(1,'transparent');
      ctx.fillStyle=g2; ctx.beginPath(); ctx.arc(ex,ey,blast,0,Math.PI*2); ctx.fill();
      // 충격파 링
      ctx.strokeStyle=`rgba(255,200,100,${(1-p)*.6})`; ctx.lineWidth=scale*1.5;
      ctx.beginPath(); ctx.arc(ex,ey,blast*.8,0,Math.PI*2); ctx.stroke();
      // 파편 파티클
      ctx.shadowColor='#fbbf24'; ctx.shadowBlur=scale*2;
      for (let i=0; i<12; i++) {
        const a=i/12*Math.PI*2, r=blast*(0.4+Math.random()*.5);
        ctx.fillStyle=`rgba(255,${100+Math.floor(Math.random()*100)},20,.8)`;
        ctx.beginPath(); ctx.arc(ex+Math.cos(a)*r,ey+Math.sin(a)*r,scale*(0.8+Math.random()*1.2),0,Math.PI*2); ctx.fill();
      }
      ctx.shadowBlur=0;

    } else if (ef.type==='kill') {
      // 처치 이펙트: 황금 폭발
      ctx.fillStyle=`rgba(251,191,36,${(1-p)*.5})`;
      ctx.beginPath(); ctx.arc(ex,ey,er*(1+p*1.5),0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=`rgba(251,191,36,${(1-p)*.7})`; ctx.lineWidth=scale*.3;
      ctx.beginPath(); ctx.arc(ex,ey,er*(0.8+p*0.8),0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }
}

// ── 레거시 호환 ───────────────────────────────────────────────────────────
export function drawPlayerSprite(){}
export function addArrowParticle() {}
export function triggerShake()     {}
export function updateRenderer()   {}
