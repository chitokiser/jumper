// /assets/js/pages/exchange.js
// JUMP 嫄곕옒??????쒕낫??UI + 媛寃?李⑦듃

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ?????????????????????????????????????????????????????????
// ?좏떥
// ?????????????????????????????????????????????????????????
const $ = (id) => document.getElementById(id);

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

/** HEX wei (18 decimals) ???뚯닔??理쒕? 6?먮━ */
function fmtHex(wei) {
  if (!wei || wei === '0') return '0';
  const n = Number(BigInt(wei)) / 1e18;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

/** JUMP (0 decimals) ???뺤닔 */
function fmtJump(raw) {
  if (!raw || raw === '0') return '0';
  return Number(raw).toLocaleString();
}

/** Unix timestamp ???⑥? ?쒓컙 臾몄옄??(addDays ?꾨? 湲곗?) */
function fmtTimeLeft(ts, addDays = 0) {
  if (!ts || ts === '0') return '-';
  const targetTs = Number(ts) + addDays * 86400;
  const msLeft   = targetTs * 1000 - Date.now();
  if (msLeft <= 0) return '媛??;
  const days = Math.ceil(msLeft / 86400000);
  const d    = new Date(targetTs * 1000);
  const ymd  = d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${ymd} (${days}????`;
}

// ?????????????????????????????????????????????????????????
// 媛寃?李⑦듃 (Chart.js)
// ?????????????????????????????????????????????????????????
let _chart = null;

function renderChart(prices) {
  const canvas = $('priceChart');
  if (!canvas || !prices || prices.length === 0) return;

  const data   = prices.map(p => Number(BigInt(p)) / 1e18);
  const labels = data.map((_, i) => i + 1);

  if (_chart) {
    _chart.data.labels            = labels;
    _chart.data.datasets[0].data  = data;
    _chart.update('none');
    return;
  }

  _chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:           'JUMP 媛寃?(HEX)',
        data,
        borderColor:     '#06b6d4',
        backgroundColor: 'rgba(6,182,212,0.07)',
        borderWidth:     2,
        pointRadius:     data.length > 20 ? 0 : 3,
        tension:         0.25,
        fill:            true,
      }],
    },
    options: {
      responsive: true,
      animation:  false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(6)} HEX` },
        },
      },
      scales: {
        x: { display: false },
        y: {
          ticks: { callback: (v) => v.toFixed(4) },
          grid:  { color: '#f0f0f0' },
        },
      },
    },
  });
}

// ?????????????????????????????????????????????????????????
// ?곹깭 罹먯떆
// ?????????????????????????????????????????????????????????
let _status = null;

// ?????????????????????????????????????????????????????????
// ?곹깭 濡쒕뱶 + ?뚮뜑留?// ?????????????????????????????????????????????????????????
async function loadStatus() {
  setText('exState', '濡쒕뵫 以?..');
  try {
    const fn  = httpsCallable(functions, 'getJumpBankStatus');
    const res = await fn();
    _status   = res.data;

    const actLabel = { 0: '以묐떒', 1: '援щℓ留?, 2: '援щℓ+諛곕떦', 3: '?꾩껜' };

    // ?꾩옱媛寃?ROI = (price - BASE_PRICE) / BASE_PRICE 횞 100
    // BASE_PRICE = 0.01 HEX = 1e16 wei
    const BASE    = 10000000000000000n;
    const priceBI = BigInt(_status.price || '0');
    const roiPct  = priceBI > BASE
      ? Number((priceBI - BASE) * 100000n / BASE) / 1000
      : 0;

    // ?? ?뺣낫 洹몃━????
    setText('exBankHex',     fmtHex(_status.bankHexBalance));
    setText('exBankJump',    fmtJump(_status.bankJumpInventory));
    setText('exPriceRoi',  roiPct.toFixed(3) + ' %');
    setText('exPrice',     fmtHex(_status.price));
    const krw    = Number(_status.priceKrw    || 0);
    const usdKrw = Number(_status.usdKrwRate  || 0);
    setText('exPriceKrw', krw > 0 ? krw.toLocaleString() + ' ?? : '-');
    setText('exUsdKrw',   usdKrw > 0 ? '?섏쑉 ?? + usdKrw.toLocaleString() + '/USD' : '');
    setText('exStaked',    fmtJump(_status.staked));

    setText('exTotalStaked', fmtJump(_status.totalStaked));
    setText('exBuyCap',      fmtJump(_status.buyCap));
    setText('exPerTokenDiv', fmtHex(_status.perTokenDiv));
    setText('exTotalBuy',    fmtJump(_status.totalBuy));
    setText('exJumpBal',     fmtJump(_status.jumpBalance));

    setText('exPendingDiv',  fmtHex(_status.pendingDividend));
    setText('exUnstakeLeft', fmtTimeLeft(_status.stakingTime, 120));
    setText('exClaimLeft',   fmtTimeLeft(_status.lastClaim, 7));
    const myStakedJump   = BigInt(_status.staked || '0');
    const myHoldJump     = BigInt(_status.jumpBalance || '0');
    const myTotalJump    = myStakedJump + myHoldJump;
    const currentPrice   = BigInt(_status.price || '0');
    const myMarketCapWei = myTotalJump * currentPrice;
    setText('exMyMarketCap', fmtHex(myMarketCapWei.toString()));
    setText('exMyAvgPrice',  fmtHex(_status.myAvgBuyPrice));

    // ROI (?됱긽 ?ы븿)
    const roiBps = Number(_status.myRoiBps || '0');
    const roiEl  = $('exMyRoi');
    if (roiEl) {
      roiEl.textContent = (roiBps >= 0 ? '+' : '') + (roiBps / 100).toFixed(2) + ' %';
      roiEl.className   = 'ex-box-value' + (roiBps > 0 ? ' pos' : roiBps < 0 ? ' neg' : '');
    }

    const aBps = _status.autoStakeBps ?? 1000;
    setText('exAutoStake', aBps + ' bps (' + (aBps / 100).toFixed(0) + '%)');
    setText('exRate',      (_status.rate ?? 3) + ' %');
    setText('exAct',       actLabel[_status.act] ?? String(_status.act));
    setText('exHexBal',    fmtHex(_status.hexBalance));

    // ?? 李⑦듃 ??
    if (_status.chart && _status.chart.length > 0) {
      renderChart(_status.chart);
    }

    setText('exState', '');
  } catch (err) {
    setText('exState', '?ㅻ쪟: ' + (err.message || '議고쉶 ?ㅽ뙣'));
  }
}

// ?????????????????????????????????????????????????????????
// 踰꾪듉 ?ы띁
// ?????????????????????????????????????????????????????????
function setLoading(btnId, loading, label) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? '泥섎━ 以?..' : label;
}

function setStatus(id, msg, isErr = false) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = msg;
  el.className = 'ex-status' + (isErr ? ' err' : '');
}

// ?????????????????????????????????????????????????????????
// 援щℓ
// ?????????????????????????????????????????????????????????
function bindBuy() {
  const btn = $('btnBuy');
  if (!btn) return;

  $('inputBuyAmount')?.addEventListener('input', () => {
    const previewEl = $('buyPreview');
    if (!previewEl) return;
    const amount = parseInt($('inputBuyAmount')?.value, 10);
    if (!amount || amount <= 0 || !_status?.price) { previewEl.style.display = 'none'; return; }
    const hexCost = BigInt(_status.price) * BigInt(amount);
    const krwCost = amount * Number(_status.priceKrw || 0);
    previewEl.innerHTML =
      `?꾩슂 HEX: <strong>${fmtHex(hexCost.toString())}</strong>` +
      (krwCost > 0 ? `<br>??<strong>${krwCost.toLocaleString()}</strong> ?? : '');
    previewEl.style.display = '';
  });

  btn.onclick = async () => {
    const amount = parseInt($('inputBuyAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('援щℓ ?섎웾???낅젰?섏꽭??); return; }
    if (_status) {
      const hexCost = BigInt(_status.price) * BigInt(amount);
      const hexBal  = BigInt(_status.hexBalance || '0');
      if (hexBal < hexCost) {
        alert(`HEX ?붿븸 遺議?n?꾩슂: ${fmtHex(hexCost.toString())} HEX\n蹂댁쑀: ${fmtHex(_status.hexBalance)} HEX`);
        return;
      }
      if (!confirm(`JUMP ${amount}媛?援щℓ\n?꾩슂 HEX: ${fmtHex(hexCost.toString())}\n吏꾪뻾?좉퉴??`)) return;
    }
    setLoading('btnBuy', true, '援щℓ');
    setStatus('buyStatus', '泥섎━ 以?..');
    try {
      const fn  = httpsCallable(functions, 'buyJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('buyStatus', `?꾨즺! JUMP: ${fmtJump(res.data.jumpAmount)} / ?뚮퉬 HEX: ${fmtHex(res.data.hexCost)}`);
      await loadStatus();
    } catch (err) {
      setStatus('buyStatus', '?ㅽ뙣: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnBuy', false, '援щℓ');
    }
  };
}

// ?????????????????????????????????????????????????????????
// ?먮ℓ
// ?????????????????????????????????????????????????????????
function bindSell() {
  const btn = $('btnSell');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputSellAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('?먮ℓ ?섎웾???낅젰?섏꽭??); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP ?붿븸 遺議?); return;
    }
    if (!confirm(`JUMP ${amount}媛??섎ℓ (?섏닔猷?${_status?.rate ?? 3}% 李④컧)\n吏꾪뻾?좉퉴??`)) return;
    setLoading('btnSell', true, '?섎ℓ');
    setStatus('sellStatus', '泥섎━ 以?..');
    try {
      const fn  = httpsCallable(functions, 'sellJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('sellStatus', `?꾨즺! TxHash: ${res.data.txHash.slice(0, 14)}...`);
      await loadStatus();
    } catch (err) {
      setStatus('sellStatus', '?ㅽ뙣: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnSell', false, '?섎ℓ');
    }
  };
}

// ?????????????????????????????????????????????????????????
// ?ㅽ뀒?댄궧
// ?????????????????????????????????????????????????????????
function bindStake() {
  const btn = $('btnStake');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputStakeAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('?섎웾???낅젰?섏꽭??); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP ?붿븸 遺議?); return;
    }
    if (!confirm(`JUMP ${amount}媛??ㅽ뀒?댄궧\n??120?????몄뒪?뚯씠??媛??n吏꾪뻾?좉퉴??`)) return;
    setLoading('btnStake', true, '?ㅽ뀒?댄궧');
    setStatus('stakeStatus', '泥섎━ 以?..');
    try {
      const fn  = httpsCallable(functions, 'stakeJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('stakeStatus', `?꾨즺! TxHash: ${res.data.txHash.slice(0, 14)}...`);
      await loadStatus();
    } catch (err) {
      setStatus('stakeStatus', '?ㅽ뙣: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnStake', false, '?ㅽ뀒?댄궧');
    }
  };
}

function bindUnstake() {
  const btn = $('btnUnstake');
  if (!btn) return;
  btn.onclick = async () => {
    if (!confirm('?ㅽ뀒?댄궧??JUMP瑜?紐⑤몢 異쒓툑?⑸땲??\n(120??誘몃쭔?대㈃ 而⑦듃?숉듃?먯꽌 嫄곕??⑸땲??\n吏꾪뻾?좉퉴??')) return;
    setLoading('btnUnstake', true, '?몄뒪?뚯씠??);
    setStatus('stakeStatus', '泥섎━ 以?..');
    try {
      const fn  = httpsCallable(functions, 'unstakeJumpToken');
      const res = await fn();
      setStatus('stakeStatus', `?몄뒪?뚯씠???꾨즺! TxHash: ${res.data.txHash.slice(0, 14)}...`);
      await loadStatus();
    } catch (err) {
      setStatus('stakeStatus', '?ㅽ뙣: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnUnstake', false, '?몄뒪?뚯씠??);
    }
  };
}

// ?????????????????????????????????????????????????????????
// 諛곕떦 泥?뎄
// ?????????????????????????????????????????????????????????
function bindClaim() {
  const btn = $('btnClaim');
  if (!btn) return;
  btn.onclick = async () => {
    if (_status && BigInt(_status.pendingDividend || '0') === 0n) {
      alert('泥?뎄??諛곕떦???놁뒿?덈떎'); return;
    }
    if (!confirm(`諛곕떦 ${fmtHex(_status?.pendingDividend || '0')} HEX瑜?泥?뎄?⑸땲??\n吏꾪뻾?좉퉴??`)) return;
    setLoading('btnClaim', true, '泥?뎄');
    setStatus('claimStatus', '泥섎━ 以?..');
    try {
      const fn  = httpsCallable(functions, 'claimJumpDividend');
      const res = await fn();
      setStatus('claimStatus', `?꾨즺! ?섎졊 HEX: ${fmtHex(res.data.hexAmount)}`);
      await loadStatus();
    } catch (err) {
      setStatus('claimStatus', '?ㅽ뙣: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnClaim', false, '泥?뎄');
    }
  };
}

// ?????????????????????????????????????????????????????????
// 珥덇린??// ?????????????????????????????????????????????????????????
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    const n = $('exLoginNotice');
    const m = $('exMain');
    if (n) n.style.display = '';
    if (m) m.style.display = 'none';
    return;
  }

  const n = $('exLoginNotice');
  const m = $('exMain');
  if (n) n.style.display = 'none';
  if (m) m.style.display = '';

  const btnRefresh = $('btnRefresh');
  if (btnRefresh) btnRefresh.onclick = loadStatus;

  bindBuy();
  bindSell();
  bindStake();
  bindUnstake();
  bindClaim();

  await loadStatus();
});

