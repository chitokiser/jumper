const fs = require('fs');
const file = 'assets/js/pages/pay.js';
let content = fs.readFileSync(file, 'utf8');

const effectContent = `
function playUltimateJackpotEffect(amount) {
  if (!window.confetti) {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js";
    s.onload = fireConfetti;
    document.head.appendChild(s);
  } else {
    fireConfetti();
  }
  function fireConfetti() {
    var duration = 3500;
    var end = Date.now() + duration;
    (function frame() {
      confetti({ particleCount: 7, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#fde047', '#fbbf24', '#f59e0b', '#fff'] });
      confetti({ particleCount: 7, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#fde047', '#fbbf24', '#f59e0b', '#fff'] });
      if (Date.now() < end) requestAnimationFrame(frame);
    }());
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      if (ctx.state === 'suspended') ctx.resume();
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(1500 + Math.random()*1000, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start(); osc.stop(ctx.currentTime + 0.1);
      } catch(e){}
    }, i * 50 + Math.random()*20);
  }
  setTimeout(() => {
    if (ctx.state === 'suspended') ctx.resume();
    [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach(freq => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5);
        osc.start(); osc.stop(ctx.currentTime + 2.5);
      } catch(e){}
    });
  }, 400);

  const textEl = document.getElementById("jackpotAmountText");
  if (textEl) {
    textEl.animate([
      { transform: 'scale(1)', textShadow: '0 0 10px #ea1' },
      { transform: 'scale(1.3)', textShadow: '0 0 30px #ea1' },
      { transform: 'scale(1)', textShadow: '0 0 10px #ea1' }
    ], { duration: 400, iterations: 4 });
    let current = 0;
    const step = amount / 30;
    const update = () => {
      current += step;
      if (current >= amount) {
         textEl.textContent = \`+\${amount.toLocaleString()} KM\`;
      } else {
         textEl.textContent = \`+\${Math.floor(current).toLocaleString()} KM\`;
         requestAnimationFrame(update);
      }
    };
    requestAnimationFrame(update);
  }
}

function playGradeSlotAnimation(grade) {
  return new Promise((resolve) => {
    if (!grade) { resolve(); return; }
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.92);backdrop-filter:blur(5px);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;animation:fadeIn 0.2s ease;";
    if (!document.getElementById("slotKeyframes")) {
      const style = document.createElement("style");
      style.id = "slotKeyframes";
      style.textContent = "@keyframes slotPulse { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } } @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }";
      document.head.appendChild(style);
    }
    const title = document.createElement("div");
    title.style.cssText = "font-size:1.5rem;font-weight:900;color:#fcd34d;margin-bottom:24px;text-shadow:0 0 15px rgba(252,211,77,0.6);letter-spacing:1px;";
    title.innerHTML = "🎰 잭팟 확률 추첨 중... 🎰";
    modal.appendChild(title);
    const slotBox = document.createElement("div");
    slotBox.style.cssText = "display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg, #1e1b4b, #312e81);border:3px solid #7c3aed;border-radius:24px;padding:25px 40px;box-shadow:0 0 40px rgba(124,58,237,0.7);";
    const prefix = document.createElement("span");
    prefix.style.cssText = "font-size:2.5rem;font-weight:900;color:#cbd5e1;margin-right:15px;";
    prefix.textContent = "1 ÷";
    slotBox.appendChild(prefix);
    const numDisplay = document.createElement("span");
    numDisplay.style.cssText = "font-size:5rem;font-weight:900;color:#fef08a;font-variant-numeric:tabular-nums;text-shadow:0 0 20px rgba(254,240,138,0.6);width:150px;text-align:center;display:inline-block;";
    numDisplay.textContent = "000";
    slotBox.appendChild(numDisplay);
    modal.appendChild(slotBox);
    const sub = document.createElement("div");
    sub.style.cssText = "font-size:1.05rem;color:#c4b5fd;margin-top:24px;font-weight:700;";
    sub.textContent = "과연 당신의 잭팟 등급은...?";
    modal.appendChild(sub);
    document.body.appendChild(modal);

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;
    try { audioCtx = new AudioContext(); } catch(e) {}
    const playTick = () => {
      if(!audioCtx) return;
      if(audioCtx.state === 'suspended') audioCtx.resume();
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = "sine"; osc.frequency.setValueAtTime(700 + Math.random()*300, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
        osc.start(); osc.stop(audioCtx.currentTime + 0.05);
      } catch(e){}
    };
    const playWin = () => {
      if(!audioCtx) return;
      if(audioCtx.state === 'suspended') audioCtx.resume();
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime+0.1);
        osc.frequency.setValueAtTime(783.99, audioCtx.currentTime+0.2);
        osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime+0.3);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        osc.start(); osc.stop(audioCtx.currentTime + 1.2);
      } catch(e){}
    };
    let duration = 2500; let start = Date.now(); let tickSpeed = 50;
    const runSlot = () => {
      let elapsed = Date.now() - start;
      if (elapsed < duration) {
        numDisplay.textContent = Math.floor(Math.random() * 990) + 10;
        playTick();
        if ("vibrate" in navigator) navigator.vibrate(15);
        if (duration - elapsed < 600) tickSpeed = 90;
        if (duration - elapsed < 300) tickSpeed = 150;
        setTimeout(runSlot, tickSpeed);
      } else {
        numDisplay.textContent = grade;
        numDisplay.style.color = "#4ade80"; 
        numDisplay.style.textShadow = "0 0 25px rgba(74,222,128,0.9)";
        numDisplay.style.animation = "slotPulse 0.4s ease 2";
        sub.innerHTML = \`잭팟 등급 <b style="color:#fff;font-size:1.2em;">1/\${grade}</b> 확정!\`;
        title.innerHTML = "🎉 추첨 완료! 🎉";
        title.style.color = "#4ade80"; title.style.textShadow = "0 0 20px rgba(74,222,128,0.7)";
        playWin();
        if ("vibrate" in navigator) navigator.vibrate([100, 50, 100, 50, 200]);
        setTimeout(() => {
          modal.style.transition = "opacity 0.4s ease";
          modal.style.opacity = "0";
          setTimeout(() => { if (modal.parentNode) document.body.removeChild(modal); resolve(); }, 400);
        }, 1800);
      }
    };
    runSlot();
  });
}

// ── 결제 버튼 바인딩 ──────────────────────────────────
`;

// Insert functions just before bindPayButton
content = content.replace('// ── 결제 버튼 바인딩 ──────────────────────────────────', effectContent);

// Modify bindPayButton handler
const stateMatch = content.match(/if \(stateEl\) \{ stateEl\.textContent = "블록체인 처리 중입니다[^\}]+\}/);
if (stateMatch) {
    content = content.replace(stateMatch[0], 'if (stateEl) { stateEl.textContent = "서버 결제 처리 중입니다. 잠시 기다려 주세요..."; stateEl.style.display = ""; }');
}

// Intercept res.data block
const resMatch = content.match(/const d = res.data;[\s\S]*try \{[\s\S]*\}\} catch\(e\)\{\} \/\/ 완료 패널 표시/);
if (resMatch) {
    let replaced = resMatch[0] + `
      if (d.grade) { await playGradeSlotAnimation(d.grade); }
`;
    content = content.replace(resMatch[0], replaced);
}

// Hide watchJackpotResult
content = content.replace('watchJackpotResult(d.txHash);', 'const jpBox = $("jackpotResultBox"); if (jpBox) jpBox.style.display = "none"; const jpWait = $("jpWaiting"); if (jpWait) jpWait.style.display = "none"; watchJackpotResult(d.txHash);');

// Insert ultimate trigger
content = content.replace(/\$\{buildDropHtml\(d\)\}\s*`;\s*\}/, `\${buildDropHtml(d)}\n        \`;\n      }\n      if (d.pointsEarned > 0) {\n        setTimeout(() => playUltimateJackpotEffect(d.pointsEarned), 100);\n      }`);

// Redefine buildDropHtml completely by tossing the old one out
content = content.replace(/function buildDropHtml\(d\) \{[\s\S]*?\n\}/, `function buildDropHtml(d) {
  const items = [];
  if (d.pointsEarned > 0) {
     items.push(\`<div style="font-size:1.3em; color:#fff; font-weight:800; background:linear-gradient(135deg,#eab308,#d97706); padding:10px; border-radius:8px; text-shadow:0 0 10px rgba(0,0,0,0.3); text-align:center;box-shadow:0 4px 15px rgba(234,179,8,0.4); border: 2px solid #fef08a;">🎉 리워드 당첨! <br><span id="jackpotAmountText" style="font-size:2.4em; display:block; margin-top:5px; font-variant-numeric:tabular-nums; color:#fff; text-shadow:0 0 20px #ea1;">+\${d.pointsEarned.toLocaleString()} KM</span></div>\`);
  }
  if (d.potionsAdded > 0) items.push(\`<img src="/assets/images/item/hp.png" style="width:28px;height:28px;vertical-align:middle;"> 빨간약 <b>+\${d.potionsAdded}</b>\`);
  if (d.mpPotionsAdded > 0) items.push(\`<img src="/assets/images/item/mp.png" style="width:28px;height:28px;vertical-align:middle;"> 마법약 <b>+\${d.mpPotionsAdded}</b>\`);
  if (d.reviveAdded > 0) items.push(\`<img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:28px;height:28px;vertical-align:middle;"> 부활권 <b>+\${d.reviveAdded}</b>\`);
  
  if (!items.length) return '';
  return \`<div style="margin-top:14px;background:rgba(251,191,36,.12);border:1.5px solid #f59e0b;border-radius:15px;padding:14px;box-shadow:inset 0 0 20px rgba(251,191,36,0.1);"><div style="font-size:13px;color:#92400e;font-weight:900;margin-bottom:10px;text-align:center;">🎁 지급 내역</div>\${items.map(i => \`<div style="font-size:15px;margin:6px 0;">\${i}</div>\`).join('')}</div>\`;
}`);

fs.writeFileSync(file, content, 'utf8');
console.log('Done modifying pay.js!');
