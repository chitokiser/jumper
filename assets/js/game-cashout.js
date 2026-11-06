// game-cashout.js — 게임 도중 "결산하고 나가기" 공통 버튼 + 확인창
// 사용: const co = createCashout({ getReward, onConfirm }); co.setVisible(true/false);
//   getReward()  → 지금 결산하면 받을 GP (연습 모드·0이면 0 반환)
//   onConfirm()  → 게임 쪽 종료/보상 지급 처리 (이중 지급 방지는 각 게임의 진행 상태로 확인)
const CSS = `
.gco-btn{position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:9000;
  padding:7px 12px;border-radius:999px;border:1px solid rgba(251,191,36,.55);
  background:rgba(17,24,39,.82);color:#fbbf24;font:700 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  cursor:pointer;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.gco-btn[hidden]{display:none}
.gco-ov{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px}
.gco-ov[hidden]{display:none}
.gco-box{width:100%;max-width:320px;background:#111827;border:1px solid #374151;border-radius:16px;padding:20px 18px;
  text-align:center;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.gco-t{font-size:17px;font-weight:800;margin-bottom:10px}
.gco-gp{font-size:26px;font-weight:900;color:#22c55e;margin:6px 0}
.gco-gp.zero{color:#9ca3af;font-size:15px;font-weight:600}
.gco-d{font-size:12px;color:#9ca3af;margin-bottom:16px;line-height:1.5}
.gco-row{display:flex;gap:8px}
.gco-row button{flex:1;padding:11px 0;border-radius:10px;border:0;font-weight:800;font-size:14px;cursor:pointer}
.gco-no{background:#374151;color:#e5e7eb}
.gco-yes{background:#f59e0b;color:#111827}
`;

let _cssDone = false;
function _injectCss() {
  if (_cssDone) return;
  _cssDone = true;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
}

export function createCashout({ getReward, onConfirm, corner = 'bl' }) {
  _injectCss();

  const btn = document.createElement('button');
  btn.className = 'gco-btn';
  btn.type = 'button';
  btn.hidden = true;
  // 하단 UI가 있는 게임용: 'tr' 우측 상단 / 'tl' 좌측 상단 (HUD 아래)
  if (corner === 'tr') btn.style.cssText = 'left:auto;bottom:auto;right:8px;top:calc(46px + env(safe-area-inset-top,0px))';
  else if (corner === 'tl') btn.style.cssText = 'bottom:auto;left:8px;top:calc(48px + env(safe-area-inset-top,0px))';
  btn.textContent = '💰 결산하고 나가기';

  const ov = document.createElement('div');
  ov.className = 'gco-ov';
  ov.hidden = true;
  ov.innerHTML = `
    <div class="gco-box">
      <div class="gco-t">💰 결산하고 나가기</div>
      <div class="gco-gp" id="gcoGp"></div>
      <div class="gco-d" id="gcoDesc"></div>
      <div class="gco-row">
        <button type="button" class="gco-no">계속하기</button>
        <button type="button" class="gco-yes">결산하기</button>
      </div>
    </div>`;

  document.body.appendChild(btn);
  document.body.appendChild(ov);

  const gpEl = ov.querySelector('#gcoGp');
  const descEl = ov.querySelector('#gcoDesc');
  let _busy = false;

  function close() { ov.hidden = true; }

  btn.addEventListener('click', () => {
    let gp = 0;
    try { gp = Math.max(0, Math.floor(Number(getReward()) || 0)); } catch { gp = 0; }
    if (gp > 0) {
      gpEl.className = 'gco-gp';
      gpEl.textContent = `+${gp.toLocaleString()} GP`;
      descEl.textContent = '지금 결산하면 현재까지의 보상을 받고 게임이 끝납니다.';
    } else {
      gpEl.className = 'gco-gp zero';
      gpEl.textContent = '받을 GP가 없습니다';
      descEl.textContent = '연습 모드이거나 아직 보상이 없습니다. 지금 나가면 게임이 끝납니다.';
    }
    ov.hidden = false;
  });

  ov.querySelector('.gco-no').addEventListener('click', close);
  ov.querySelector('.gco-yes').addEventListener('click', async () => {
    if (_busy) return;
    _busy = true;
    close();
    btn.hidden = true;
    try { await onConfirm(); } finally { _busy = false; }
  });

  return {
    setVisible(v) {
      btn.hidden = !v;
      if (!v) close();
    },
  };
}
