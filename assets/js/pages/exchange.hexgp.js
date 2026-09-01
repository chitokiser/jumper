// /assets/js/pages/exchange.hexgp.js
// Point → GameCoin (GP) 교환 탭

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const $ = (id) => document.getElementById(id);

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

function fmtHex(wei) {
  if (!wei || wei === '0') return '0';
  return (Number(BigInt(wei)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

let _status = null;
let _bound  = false;

async function loadStatus() {
  try {
    const fn  = httpsCallable(functions, 'getHexGpStatus');
    const res = await fn();
    _status   = res.data;
    const rate = Number(_status.gpPerHex || 1000);
    setText('hgGpPerHex', rate.toLocaleString() + ' GP');
    setText('hgHexBal',   fmtHex(_status.userHexBalance || '0') + ' Point');
    setText('hgGpBal',    Number(_status.userGold || 0).toLocaleString());
    _updatePreview();
  } catch (err) {
    setText('hgStatus', 'Load failed: ' + (err.message || String(err)));
  }
}

function _updatePreview() {
  const input   = $('hgHexInput');
  const preview = $('hgPreview');
  if (!input || !preview) return;
  const hexVal = parseFloat(input.value);
  if (!hexVal || hexVal <= 0 || !_status) { preview.style.display = 'none'; return; }
  const rate  = Number(_status.gpPerHex || 1000);
  const gpAmt = Math.floor(hexVal * rate);
  preview.innerHTML  = `You'll receive: <strong>${gpAmt.toLocaleString()} GP</strong>`;
  preview.style.display = '';
}

function bindHexGp() {
  if (_bound) return;
  _bound = true;

  $('hgHexInput')?.addEventListener('input', _updatePreview);

  const btn = $('btnHgConvert');
  if (!btn) return;

  btn.onclick = async () => {
    const input  = $('hgHexInput');
    const hexVal = parseFloat(input?.value);
    if (!hexVal || hexVal <= 0) { setText('hgStatus', 'Enter Point amount'); return; }

    const rate   = Number(_status?.gpPerHex || 1000);
    const gpAmt  = Math.floor(hexVal * rate);
    const hexWei = BigInt(Math.round(hexVal * 1e18)).toString();

    if (!confirm(`Convert ${hexVal} Point → ${gpAmt.toLocaleString()} GP?\nThis cannot be undone.`)) return;

    btn.disabled    = true;
    btn.textContent = 'Processing…';
    setText('hgStatus', 'Processing…');

    try {
      const fn  = httpsCallable(functions, 'hexToGp');
      const res = await fn({ hexWei });
      setText('hgStatus', `Done! +${Number(res.data.gpAmount).toLocaleString()} GP received`);
      if (input) input.value = '';
      const preview = $('hgPreview');
      if (preview) preview.style.display = 'none';
      await loadStatus();
    } catch (err) {
      setText('hgStatus', 'Failed: ' + (err.message || String(err)));
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Convert Point → GP';
    }
  };
}

let _ready = false;

window.__hexGpLoad = async () => {
  await loadStatus();
  if (!_ready) {
    bindHexGp();
    _ready = true;
  }
};

onAuthStateChanged(auth, (user) => {
  if (user && document.getElementById('swapPanel-hex-gp')?.classList.contains('active')) {
    window.__hexGpLoad();
  }
});
