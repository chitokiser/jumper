// memory.js — 스피드 기억력 게임 (4×6, 30회 오답 게임오버, 2초 타이머)
import { db, auth } from '/assets/js/firebase-init.js';
import { esc } from '/assets/js/esc.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

// ── 카드 이미지 풀 ────────────────────────────────────────────────────────────
const CARD_POOL = [
  ...Array.from({length:21},(_,i)=>`/assets/images/item/${i}.png`),
  '/assets/images/item/armor.png','/assets/images/item/axe.png',
  '/assets/images/item/bag.png','/assets/images/item/belts.png',
  '/assets/images/item/boots.png','/assets/images/item/box.png',
  '/assets/images/item/coins.png','/assets/images/item/frame.png',
  '/assets/images/item/gem.png','/assets/images/item/helmets.png',
  '/assets/images/item/hp.png','/assets/images/item/ingots.png',
  '/assets/images/item/mp.png','/assets/images/item/pants.png',
  '/assets/images/item/scroll.png','/assets/images/item/shield.png',
  '/assets/images/item/shoulders.png','/assets/images/item/sword.png',
  '/assets/images/item/book.PNG','/assets/images/item/bracers.PNG',
  '/assets/images/item/cloaks.PNG','/assets/images/item/gloves.PNG',
  '/assets/images/item/necklace.PNG','/assets/images/item/rings.PNG',
];

const ENTRY_FEE    = 0;    // 무료 입장
const TOTAL_PAIRS  = 12;   // 4×6 = 24장 = 12쌍
const MAX_MISS     = 30;
const TIMER_MS     = 2000; // 2초
const MATCH_GP     = 30;   // 쌍 매칭 보상
const COMBO_BONUS  = 20;   // 콤보당 추가 GP (연속 성공마다)
const MISS_PENALTY = 15;   // 오답 1회 점수 패널티 (30회 × 15 = 450 → 클리어 보너스로 상쇄)
const CLEAR_BONUS  = 300;  // 클리어 달성 보너스 (오답 수 무관)
const TIME_BONUS   = 200;  // 1분 이내 클리어 추가 보너스
const TIME_LIMIT_MS= 60000;// 1분

// ── Firebase ─────────────────────────────────────────────────────────────────
let _uid=null, _playerGP=0;

async function loadPlayer() {
  if (!_uid) return;
  try {
    const d=(await getDoc(doc(db,'battle_players',_uid))).data()||{};
    _playerGP=d.gold||0;
  } catch {}
  $('lobbyGP').textContent=_playerGP;
  $('btnEnter').disabled=false;
}

async function deductFee() {
  if (ENTRY_FEE <= 0) return true;
  if (_playerGP<ENTRY_FEE) return false;
  try { await updateDoc(doc(db,'battle_players',_uid),{gold:increment(-ENTRY_FEE)}); _playerGP-=ENTRY_FEE; return true; }
  catch { return false; }
}

async function awardGP(amount) {
  if (amount<=0||!_uid) return;
  try { await updateDoc(doc(db,'battle_players',_uid),{gold:increment(amount)}); } catch {}
}

// ── 게임 상태 ────────────────────────────────────────────────────────────────
let _cards=[];        // {el, pairId, flipped, matched}
let _flipped=[];      // 현재 뒤집힌 카드 인덱스 (최대 2개)
let _locked=false;
let _misses=0, _matched=0, _combo=0, _score=0, _startTime=0;
let _timerToken=0;
let _timerRaf=null;
let _timerStart=0;
let _ac=null;
let _phase='loading';

const $=id=>document.getElementById(id);

// ── 사운드 ───────────────────────────────────────────────────────────────────
function ac(){
  if(!_ac) _ac=new(window.AudioContext||window.webkitAudioContext)();
  if(_ac.state==='suspended') _ac.resume();
  return _ac;
}
function _tone(freq,type,dur,vol=0.18,st=0){
  try{const a=ac(),o=a.createOscillator(),g=a.createGain();
    o.connect(g);g.connect(a.destination);o.type=type;
    if(st){o.frequency.setValueAtTime(st,a.currentTime);o.frequency.linearRampToValueAtTime(freq,a.currentTime+dur*.8);}
    else o.frequency.value=freq;
    g.gain.setValueAtTime(vol,a.currentTime);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+dur);
    o.start();o.stop(a.currentTime+dur);}catch{}
}
function playTick(urgent=false){_tone(urgent?900:660,'sine',.07,.14);}
function playFlip(){_tone(800,'sine',.05,.09);}
function playMatch(){
  _tone(523,'sine',.12,.22);setTimeout(()=>_tone(784,'sine',.18,.22),110);
}
function playCombo(n){_tone(440+n*80,'sine',.15,.25);}
function playMiss(){_tone(300,'sawtooth',.3,.18,180);}
function playTimeout(){_tone(200,'sawtooth',.25,.18,350);}
function playGameOver(){[200,150,100].forEach((f,i)=>setTimeout(()=>_tone(f,'sawtooth',.4,.25),i*180));}
function playClear(){[523,659,784,1047,1319].forEach((f,i)=>setTimeout(()=>_tone(f,'sine',.3,.3),i*90));}

// ── 카드 그리드 빌드 ──────────────────────────────────────────────────────────
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

function buildGrid(){
  const chosen=shuffle(CARD_POOL).slice(0,TOTAL_PAIRS);
  const pairs=shuffle([
    ...chosen.map((img,pid)=>({img,pairId:pid})),
    ...chosen.map((img,pid)=>({img,pairId:pid})),
  ]);
  const grid=$('gameGrid');
  grid.innerHTML='';
  _cards=[];

  pairs.forEach(({img,pairId},idx)=>{
    const card=document.createElement('div');
    card.className='mem-card';
    card.innerHTML=`<div class="mem-card-inner">
      <div class="mem-card-front">🎴</div>
      <div class="mem-card-back"><img src="${img}" alt="" loading="eager"/></div>
    </div>`;
    card.addEventListener('click',()=>onCardClick(idx));
    grid.appendChild(card);
    _cards.push({el:card,pairId,flipped:false,matched:false});
  });
}

// ── 카드 클릭 ────────────────────────────────────────────────────────────────
function onCardClick(idx){
  if(_locked) return;
  const c=_cards[idx];
  if(c.flipped||c.matched) return;

  c.flipped=true;
  c.el.classList.add('flipped');
  playFlip();
  _flipped.push(idx);

  if(_flipped.length===1){
    // 첫 번째 카드: 2초 타이머 시작
    startPickTimer();
  } else {
    // 두 번째 카드: 매칭 판정
    stopPickTimer();
    _locked=true;
    checkMatch();
  }
}

// ── 매칭 판정 ────────────────────────────────────────────────────────────────
function checkMatch(){
  const [i1,i2]=_flipped;
  const c1=_cards[i1],c2=_cards[i2];

  if(c1.pairId===c2.pairId){
    // ✅ 매칭 성공
    c1.matched=c2.matched=true;
    c1.el.classList.add('matched');
    c2.el.classList.add('matched');
    _matched++;
    _combo++;
    const gp=MATCH_GP+Math.min(_combo-1,8)*COMBO_BONUS;
    _score+=gp;
    playMatch();
    if(_combo>=2) playCombo(_combo);
    showFloat(`+${gp}GP 🎉`,c1.el,'#fbbf24');
    _flipped=[];
    _locked=false;
    updateHUD();
    if(_matched===TOTAL_PAIRS) setTimeout(gameClear,400);
  } else {
    // ❌ 매칭 실패
    _combo=0;
    _misses++;
    _score-=MISS_PENALTY;
    c1.el.classList.add('wrong');
    c2.el.classList.add('wrong');
    playMiss();
    showFloat(`-${MISS_PENALTY}점 💀`,c1.el,'#ef4444');
    updateHUD();
    setTimeout(()=>{
      c1.flipped=c2.flipped=false;
      c1.el.classList.remove('flipped','wrong');
      c2.el.classList.remove('flipped','wrong');
      _flipped=[];
      _locked=false;
      if(_misses>=MAX_MISS) gameOver();
    },650);
  }
}

// ── 2초 타이머 ────────────────────────────────────────────────────────────────
function startPickTimer(){
  const token=++_timerToken;
  _timerStart=performance.now();
  const wrap=$('timerWrap'), bar=$('timerBar');
  wrap.classList.remove('hidden','urgent');
  bar.style.width='100%';

  // 틱 사운드 스케줄
  const ticks=[0,250,500,750,1000,1250,1500,1750];
  ticks.forEach((delay,i)=>{
    setTimeout(()=>{
      if(_timerToken===token) playTick(delay>=1250);
    },delay);
  });

  // 타이머 바 애니메이션
  function animate(now){
    if(_timerToken!==token) return;
    const elapsed=now-_timerStart;
    const pct=Math.max(0,1-elapsed/TIMER_MS);
    bar.style.width=(pct*100)+'%';
    if(pct<0.35) wrap.classList.add('urgent');
    if(elapsed>=TIMER_MS){
      onPickTimeout(token);
    } else {
      _timerRaf=requestAnimationFrame(animate);
    }
  }
  _timerRaf=requestAnimationFrame(animate);
}

function stopPickTimer(){
  _timerToken++;
  if(_timerRaf){cancelAnimationFrame(_timerRaf);_timerRaf=null;}
  const wrap=$('timerWrap');
  wrap.classList.add('hidden');
  wrap.classList.remove('urgent');
}

function onPickTimeout(token){
  if(_timerToken!==token) return;
  $('timerWrap').classList.add('hidden');
  $('timerWrap').classList.remove('urgent');

  // 첫 카드 되돌리기
  const idx=_flipped[0];
  if(idx!==undefined){
    const c=_cards[idx];
    c.flipped=false;
    c.el.classList.remove('flipped');
  }
  _flipped=[];
  _combo=0;
  _misses++;
  _score-=MISS_PENALTY;
  _locked=false;
  playTimeout();
  updateHUD();
  if(_misses>=MAX_MISS) setTimeout(gameOver,400);
}

// ── HUD 업데이트 ─────────────────────────────────────────────────────────────
function updateHUD(){
  $('missTxt').textContent=_misses;
  $('scoreTxt').textContent=_score;
  const missBox=$('missBox');
  missBox.classList.toggle('danger',_misses>=MAX_MISS-5);
  const comboBox=$('comboBox');
  if(_combo>=2){
    comboBox.classList.remove('hidden');
    $('comboTxt').textContent=`×${_combo}`;
  } else {
    comboBox.classList.add('hidden');
  }
}

// ── 플로팅 텍스트 ─────────────────────────────────────────────────────────────
function showFloat(text,anchorEl,color='#fff'){
  const rect=anchorEl.getBoundingClientRect();
  const div=document.createElement('div');
  div.className='float-txt';
  div.textContent=text;
  div.style.top=(rect.top+window.scrollY-20)+'px';
  div.style.color=color;
  document.body.appendChild(div);
  div.addEventListener('animationend',()=>div.remove());
}

// ── 게임 종료 ────────────────────────────────────────────────────────────────
async function gameClear(){
  stopPickTimer();
  const elapsed=Date.now()-_startTime;
  _score+=CLEAR_BONUS;
  const timeBonus=elapsed<TIME_LIMIT_MS?TIME_BONUS:0;
  if(timeBonus>0) _score+=timeBonus;
  playClear();
  const netGP=Math.max(0,_score);
  await awardGP(netGP);
  const sec=Math.floor(elapsed/1000);
  const infoParts=[`오답: ${_misses}회`,`클리어 시간: ${sec}초`,`+${CLEAR_BONUS}GP 클리어 보너스`];
  if(timeBonus>0) infoParts.push(`⚡1분 보너스: +${TIME_BONUS}GP`);
  $('resTitle').textContent='🏆 전체 클리어!';
  $('resTitle').className='res-title clear';
  $('resScore').textContent=_score+'점';
  $('resGP').textContent=`+${netGP} GP 획득!`;
  $('resInfo').textContent=infoParts.join(' | ');
  showPhase('result');
}

async function gameOver(){
  stopPickTimer();
  playGameOver();
  $('resTitle').textContent='💀 게임 오버';
  $('resTitle').className='res-title over';
  $('resScore').textContent=_score+'점';
  $('resGP').textContent='획득 GP 없음';
  $('resInfo').textContent=`매칭: ${_matched}/12 | 오답: ${_misses}회 | 클리어 실패 시 보상 없음`;
  showPhase('result');
}

// ── 게임 시작 ─────────────────────────────────────────────────────────────────
function startGame(){
  _cards=[];_flipped=[];_locked=false;
  _misses=0;_matched=0;_combo=0;_score=0;_startTime=Date.now();
  _timerToken=0;
  buildGrid();
  updateHUD();
  $('comboBox').classList.add('hidden');
  $('timerWrap').classList.add('hidden');
  showPhase('game');
}

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
const SCREENS=['loading','login','lobby','game','result'];
function showPhase(name){
  SCREENS.forEach(s=>$(`${s}Screen`)?.classList.add('hidden'));
  $(`${name}Screen`)?.classList.remove('hidden');
  _phase=name;
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
async function init(){
  showPhase('loading');

  // Google 로그인
  $('btnGoogleLogin')?.addEventListener('click',async()=>{
    try {
      $('btnGoogleLogin').textContent='로그인 중...';
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch(e) {
      $('btnGoogleLogin').innerHTML='<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:22px;height:22px" alt=""> Google로 로그인';
      if(!e.message?.includes('popup-closed')) alert('로그인 오류: '+e.message);
    }
  });

  // 익명 로그인
  $('btnAnonymous')?.addEventListener('click',async()=>{
    try {
      $('btnAnonymous').textContent='연결 중...';
      await signInAnonymously(auth);
    } catch(e) {
      $('btnAnonymous').textContent='👤 익명으로 플레이 (GP 저장 안 됨)';
    }
  });

  $('btnEnter')?.addEventListener('click',()=>startGame());

  $('btnRestart')?.addEventListener('click',()=>startGame());

  $('btnLoginFromLobby')?.addEventListener('click',async e=>{
    e.preventDefault();
    try {
      $('btnLoginFromLobby').textContent='로그인 중...';
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch(err) {
      $('btnLoginFromLobby').textContent='로그인';
      if(!err.message?.includes('popup-closed')) alert('로그인 오류: '+err.message);
    }
  });

  // 헤더 Google 로그인
  function _bindHdrLogin(){
    $('gLoginBtn')?.addEventListener('click',async()=>{
      try{
        const btn=$('gLoginBtn'); if(btn) btn.textContent='로그인 중...';
        await signInWithPopup(auth,new GoogleAuthProvider());
      }catch(e){
        const btn=$('gLoginBtn'); if(btn) btn.textContent='🔑 Google 로그인';
        if(!e.message?.includes('popup-closed')) alert('로그인 오류: '+e.message);
      }
    });
  }
  function _updateHdr(user){
    const r=$('gHdrRight'); if(!r) return;
    if(user&&!user.isAnonymous){
      r.innerHTML=`<span class="g-user-chip">👤 ${esc(user.displayName||'유저')}</span>`;
    } else {
      r.innerHTML=`<button class="g-login-btn" id="gLoginBtn">🔑 Google 로그인</button>`;
      _bindHdrLogin();
    }
  }
  _bindHdrLogin();

  onAuthStateChanged(auth,async user=>{
    _uid=user?.uid||null;
    if(_uid){
      await loadPlayer();
      const hint=$('loginHint');
      if(hint) hint.style.display='none';
    } else {
      $('lobbyGP').textContent='게스트';
      const hint=$('loginHint');
      if(hint) hint.style.display='flex';
    }
    _updateHdr(user);
    showPhase('lobby');
  });
}
init();
