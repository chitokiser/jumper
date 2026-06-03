// /assets/js/pages/exchange.swap.js
// TON↔GameCoin / HEX↔TON 스왑 + 거래내역
// TON은 기존 tonExchange 핸들러 (tonGetPrice/tonDepositVerify/tonWithdrawRequest) 사용

import { auth, db, functions } from '../firebase-init.js';
import { onAuthStateChanged }  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }       from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { doc, getDoc }         from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const $ = id => document.getElementById(id);
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

function setStatus(id, msg, isErr = false) {
  const el = $(id);
  if (!el) return;
  el.innerHTML  = msg;
  el.className  = 'ex-status' + (isErr ? ' err' : msg ? ' ok' : '');
}
function setLoading(btnId, loading, label) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? '처리 중...' : label;
}
function isValidTonAddr(addr) {
  return /^[EU]Q[A-Za-z0-9_-]{46}$/.test(addr.trim());
}

// ─────────────────────────────────────────────────
// 캐시
// ─────────────────────────────────────────────────
let _tonInfo      = null;  // { tonUsd, coinPerTon, adminWallet, ... }
let _tonInfoAt    = 0;
let _tonTimer     = null;
let _ratesCache   = null;
let _ratesAt      = 0;
let _histLastId   = null;
let _histHasMore  = false;

// ─────────────────────────────────────────────────
// TON 시세 로드 (기존 tonGetPrice Cloud Function 사용)
// Binance → OKX → Bybit → CoinGecko 순 fallback, 서버 60초 캐시
// ─────────────────────────────────────────────────
async function loadTonPrice(force = false) {
  if (!force && _tonInfo && Date.now() - _tonInfoAt < 30_000) return _tonInfo;
  try {
    const fn  = httpsCallable(functions, 'tonGetPrice');
    const res = await fn();
    _tonInfo   = res.data;
    _tonInfoAt = Date.now();
    renderTonPrice();
  } catch (_) {}
  return _tonInfo;
}

function renderTonPrice() {
  if (!_tonInfo) return;
  const { tonUsd, coinPerTon } = _tonInfo;
  setText('tonPriceUsd',   '$' + Number(tonUsd).toFixed(3));
  setText('tonCoinRate',   Number(coinPerTon).toLocaleString() + ' GP');
  const d = new Date(_tonInfoAt);
  setText('tonPriceAt', d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' }) + ' 기준');

  // 입금 preview 갱신 (이미 입력된 경우)
  _refreshDepositPreview();

  // 출금 preview 갱신
  const gp = parseInt($('tcWithdrawGp')?.value || '0', 10);
  if (gp >= 10000) updateWithdrawPreview(gp);
}

function _refreshDepositPreview() {
  const amt     = parseFloat($('tcTonAmount')?.value || '0');
  const preview = $('tcDepositPreview');
  if (!preview || !_tonInfo) return;
  if (!amt || amt <= 0) { preview.style.display = 'none'; return; }
  const { tonUsd } = _tonInfo;
  const gamecoin  = Math.floor(amt * tonUsd * 10000);
  preview.innerHTML =
    `받을 GameCoin: <strong style="font-size:14px;color:#22c55e;">${gamecoin.toLocaleString()}</strong><br>` +
    `<span style="font-size:10px;color:#475569;">≈ $${(amt * tonUsd).toFixed(2)} · 1 TON = $${Number(tonUsd).toFixed(3)}</span>`;
  preview.style.display = '';
}

function startTonTicker() {
  loadTonPrice(true);
  clearInterval(_tonTimer);
  _tonTimer = setInterval(() => loadTonPrice(true), 30_000);
}
function stopTonTicker() {
  clearInterval(_tonTimer);
  _tonTimer = null;
}

window.__swapRatesLoad = () => {
  loadSwapRates();
  startTonTicker();
};

// ─────────────────────────────────────────────────
// 스왑 환율 (HEX↔TON용)
// ─────────────────────────────────────────────────
async function loadSwapRates(force = false) {
  if (!force && _ratesCache && Date.now() - _ratesAt < 30_000) return _ratesCache;
  try {
    const fn  = httpsCallable(functions, 'getSwapRates');
    const res = await fn();
    _ratesCache = res.data;
    _ratesAt    = Date.now();
    applyHexTonRate();
  } catch (_) { _ratesCache = {}; }
  return _ratesCache;
}
function applyHexTonRate() {
  const ht = _ratesCache?.hex_ton || {};
  setText('htRateDisplay', ht.enabled !== false ? `1 HEX = ${ht.rate ?? 0.02} TON` : '현재 비활성화');
  setText('htFeeDisplay',  `${ht.fee ?? 1}%`);
}

// ─────────────────────────────────────────────────
// TON 탭 — 방향 전환
// ─────────────────────────────────────────────────
let _tcDir = 'deposit';

function bindTonTabDir() {
  const buyBtn  = $('tcDirBuyBtn');
  const sellBtn = $('tcDirSellBtn');
  const depPanel = $('tcPanelDeposit');
  const witPanel = $('tcPanelWithdraw');

  function setDir(dir) {
    _tcDir = dir;
    buyBtn?.classList.toggle('active',  dir === 'deposit');
    sellBtn?.classList.toggle('active', dir === 'withdraw');
    if (depPanel) depPanel.style.display = dir === 'deposit'  ? '' : 'none';
    if (witPanel) witPanel.style.display = dir === 'withdraw' ? '' : 'none';
  }

  buyBtn?.addEventListener('click',  () => setDir('deposit'));
  sellBtn?.addEventListener('click', () => setDir('withdraw'));
}

// ─────────────────────────────────────────────────
// TonConnect 상태 관리
// ─────────────────────────────────────────────────
let _tc = null;  // TonConnectUI 인스턴스

function initTonConnect() {
  if (_tc || !window.TON_CONNECT_UI) return;
  _tc = new window.TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://jump22.netlify.app/tonconnect-manifest.json',
    actionsConfiguration: { returnStrategy: 'none' },
  });
  _tc.onStatusChange(_updateTcUI);
  _updateTcUI(_tc.wallet);
}

/** raw TON 주소(0:hex) → UQ 형식 변환 */
function _rawToUQ(raw) {
  try {
    const hex = raw.split(':')[1];
    if (!hex || hex.length !== 64) return raw;
    const addr = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const data = new Uint8Array(34);
    data[0] = 0x51; data[1] = 0x00; data.set(addr, 2);
    // CRC16-CCITT
    let crc = 0;
    for (let i = 0; i < 34; i++) {
      crc ^= data[i] << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
    crc &= 0xffff;
    const full = new Uint8Array(36);
    full.set(data); full[34] = crc >> 8; full[35] = crc & 0xff;
    return btoa(String.fromCharCode(...full)).replace(/\+/g, '-').replace(/\//g, '_');
  } catch { return raw; }
}

function _updateTcUI(wallet) {
  const connectBtn  = $('btnTcConnect');
  const sendBtn     = $('btnTcDeposit');
  const infoEl      = $('tcConnectedInfo');
  const addrEl      = $('tcConnectedAddr');

  if (wallet?.account?.address) {
    const uq    = _rawToUQ(wallet.account.address);
    const short = uq.slice(0, 6) + '…' + uq.slice(-4);
    if (connectBtn) connectBtn.style.display = 'none';
    if (sendBtn)    sendBtn.style.display = '';
    if (infoEl)     infoEl.style.display = '';
    if (addrEl)     addrEl.textContent = short;
    // HEX↔TON 패널 TON 수령 주소 자동 입력
    const htAddr = $('htTonAddr');
    if (htAddr && !htAddr.value) htAddr.value = uq;
  } else {
    if (connectBtn) connectBtn.style.display = '';
    if (sendBtn)    sendBtn.style.display = 'none';
    if (infoEl)     infoEl.style.display = 'none';
  }
}

// ─────────────────────────────────────────────────
// TON → GameCoin: 지갑 연결 + 자동 전송
// ─────────────────────────────────────────────────
function bindTonDeposit() {
  // 수량 입력 → preview (시세 미로드 시 자동 로드 후 갱신)
  $('tcTonAmount')?.addEventListener('input', () => {
    const amt     = parseFloat($('tcTonAmount')?.value || '0');
    const preview = $('tcDepositPreview');
    if (!preview) return;
    if (!amt || amt <= 0) { preview.style.display = 'none'; return; }
    if (!_tonInfo) {
      preview.innerHTML = '<span style="color:#475569;font-size:11px;">시세 로딩 중...</span>';
      preview.style.display = '';
      loadTonPrice(true);
      return;
    }
    _refreshDepositPreview();
  });

  // 연결 버튼: 지갑 연결 후 즉시 전송 트리거
  $('btnTcConnect')?.addEventListener('click', async () => {
    if (!_tc) { alert('TonConnect를 초기화하는 중입니다. 잠시 후 다시 시도하세요.'); return; }
    const amt = parseFloat($('tcTonAmount')?.value || '0');
    if (!amt || amt <= 0) { alert('먼저 TON 수량을 입력하세요'); return; }
    try {
      await _tc.connectWallet();
      // 연결 성공 시 _updateTcUI가 호출되어 버튼 전환됨 — 자동 전송 실행
      $('btnTcDeposit')?.click();
    } catch (err) {
      if (!err.message?.includes('reject') && !err.message?.includes('cancel')) {
        setStatus('tcDepositStatus', '연결 실패: ' + (err.message || String(err)), true);
      }
    }
  });

  // 연결 해제 버튼
  $('btnTcDisconnect')?.addEventListener('click', async () => {
    await _tc?.disconnect();
  });

  // 전송 버튼
  const sendBtn = $('btnTcDeposit');
  if (!sendBtn) return;
  sendBtn.onclick = async () => {
    const amt = parseFloat($('tcTonAmount')?.value || '0');
    if (!amt || amt <= 0) { alert('TON 수량을 입력하세요'); return; }
    if (!_tc?.wallet) { alert('TON 지갑이 연결되지 않았습니다'); return; }
    if (!_tonInfo?.adminWallet) { alert('관리자 지갑 정보 로딩 중입니다. 잠시 후 다시 시도하세요.'); return; }

    const tonNano    = Math.floor(amt * 1e9);
    const senderAddr = _tc.wallet.account.address;

    // 주소 정규화: trim + 형식 검증
    const adminAddr = (_tonInfo.adminWallet || '').trim();
    const validTonAddr = /^[EUkQ][A-Za-z0-9_-]{47}$/.test(adminAddr)  // user-friendly
                      || /^-?\d+:[0-9a-fA-F]{64}$/.test(adminAddr);   // raw
    if (!adminAddr || !validTonAddr) {
      alert('관리자 TON 지갑 주소가 올바르지 않습니다. 잠시 후 다시 시도하세요.');
      return;
    }

    setLoading('btnTcDeposit', true, 'TON 전송 & GameCoin 받기');
    setStatus('tcDepositStatus', '지갑에서 서명해 주세요...');

    try {
      const sentAt = Date.now();
      await _tc.sendTransaction({
        validUntil: Math.floor(sentAt / 1000) + 600,
        messages: [{ address: adminAddr, amount: String(tonNano) }],
      });

      setStatus('tcDepositStatus', '전송 완료! 블록체인 확인 중… (최대 30초)');

      const fn  = httpsCallable(functions, 'tonDepositAuto');
      const res = await fn({ senderAddress: senderAddr, tonNano, sentAt });
      const d   = res.data;

      setStatus('tcDepositStatus',
        `✅ 지급 완료! ${Number(d.gamecoin).toLocaleString()} GameCoin<br>` +
        `TON: ${d.tonAmount} / $${d.usdRate?.toFixed(3)}/TON`);

      if ($('tcTonAmount'))     $('tcTonAmount').value = '';
      if ($('tcDepositPreview')) $('tcDepositPreview').style.display = 'none';
      loadUserCoinBal();
      if (window.__loadCoinExStatus) window.__loadCoinExStatus();
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('declined')) {
        setStatus('tcDepositStatus', '사용자가 취소했습니다.', true);
      } else {
        setStatus('tcDepositStatus', '실패: ' + msg, true);
      }
    } finally {
      setLoading('btnTcDeposit', false, 'TON 전송 & GameCoin 받기');
    }
  };
}

// ─────────────────────────────────────────────────
// GameCoin → TON 출금: preview + 실행
// ─────────────────────────────────────────────────
function updateWithdrawPreview(gp) {
  const preview = $('tcWithdrawPreview');
  if (!preview || !_tonInfo) return;
  const { tonUsd, coinPerTon } = _tonInfo;
  const feeGp   = Math.floor(gp * 0.03);
  const netGp   = gp - feeGp;
  const tonAmt  = netGp / coinPerTon;
  const usdVal  = (netGp / 10000).toFixed(2);
  preview.innerHTML =
    `받을 TON: <strong>${tonAmt.toFixed(4)}</strong> (≈ $${usdVal})<br>` +
    `수수료: ${feeGp.toLocaleString()} GP (3%) / 실지급: ${netGp.toLocaleString()} GP`;
  preview.style.display = '';
}

function bindTonWithdraw(coinBal) {
  const gpInput = $('tcWithdrawGp');
  if (gpInput) {
    gpInput.addEventListener('input', () => {
      const gp = parseInt(gpInput.value || '0', 10);
      if (gp < 10000) { if ($('tcWithdrawPreview')) $('tcWithdrawPreview').style.display = 'none'; return; }
      updateWithdrawPreview(gp);
    });
  }

  const btn = $('btnTcWithdraw');
  if (!btn) return;
  btn.onclick = async () => {
    const gp      = parseInt($('tcWithdrawGp')?.value || '0', 10);
    const tonAddr = $('tcTonAddr')?.value.trim() || '';
    if (gp < 10000) { alert('최소 10,000 GameCoin부터 출금 가능합니다'); return; }
    if (gp > coinBal) { alert(`GameCoin 부족. 보유: ${coinBal.toLocaleString()}`); return; }
    if (!isValidTonAddr(tonAddr)) { alert('올바른 TON 지갑 주소를 입력하세요 (EQ... 또는 UQ...)'); return; }

    const { coinPerTon } = _tonInfo || {};
    const feeGp  = Math.floor(gp * 0.03);
    const tonAmt = coinPerTon ? ((gp - feeGp) / coinPerTon).toFixed(4) : '?';
    if (!confirm(`GameCoin ${gp.toLocaleString()} → TON ${tonAmt} 출금\n수수료: ${feeGp.toLocaleString()} GP\n\n진행하시겠습니까?`)) return;

    setLoading('btnTcWithdraw', true, 'TON 출금하기');
    setStatus('tcWithdrawStatus', 'TON 전송 중...');
    try {
      const fn  = httpsCallable(functions, 'tonWithdrawRequest');
      const res = await fn({ gamecoin: gp, walletAddress: tonAddr });
      const d   = res.data;
      setStatus('tcWithdrawStatus',
        `✅ 출금 완료! TON ${d.tonAmount?.toFixed(4)} 전송<br>` +
        `TxHash: ${d.txHash ? d.txHash.slice(0, 16) + '…' : '처리 중'}`);
      if ($('tcWithdrawGp')) $('tcWithdrawGp').value = '';
      if ($('tcWithdrawPreview')) $('tcWithdrawPreview').style.display = 'none';
      loadUserCoinBal();
    } catch (err) {
      setStatus('tcWithdrawStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnTcWithdraw', false, 'TON 출금하기');
    }
  };
}

// ─────────────────────────────────────────────────
// HEX↔TON 스왑 (관리자 배치 처리)
// ─────────────────────────────────────────────────
let _htDir = 'hex_to_ton';

function bindHexTonSwap() {
  const dirBuy  = $('htDirBuyBtn');
  const dirSell = $('htDirSellBtn');
  const lbl     = $('htAmountLabel');
  const inp     = $('htAmount');
  const preview = $('htPreview');

  function setDir(dir) {
    _htDir = dir;
    dirBuy?.classList.toggle('active',  dir === 'hex_to_ton');
    dirSell?.classList.toggle('active', dir === 'ton_to_hex');
    if (lbl) lbl.textContent = dir === 'hex_to_ton' ? '보낼 HEX 수량' : '보낼 TON 수량';
    if (inp) { inp.value = ''; if (preview) preview.style.display = 'none'; }
  }
  dirBuy?.addEventListener('click',  () => setDir('hex_to_ton'));
  dirSell?.addEventListener('click', () => setDir('ton_to_hex'));

  inp?.addEventListener('input', () => {
    const amt = parseFloat(inp.value);
    if (!preview) return;
    if (!amt || amt <= 0) { preview.style.display = 'none'; return; }
    const cfg  = _ratesCache?.hex_ton || {};
    const rate = Number(cfg.rate ?? 0.02);
    const fee  = Number(cfg.fee  ?? 1) / 100;
    if (_htDir === 'hex_to_ton') {
      const gross = amt * rate, recv = gross * (1 - fee);
      const usdV  = _tonInfo ? ` (≈ $${(recv * _tonInfo.tonUsd).toFixed(2)})` : '';
      preview.innerHTML = `받을 TON: <strong>${recv.toFixed(4)}</strong>${usdV}<br>수수료: ${(gross * fee).toFixed(4)} TON`;
    } else {
      const gross = amt / rate, recv = gross * (1 - fee);
      preview.innerHTML = `받을 HEX: <strong>${recv.toFixed(4)}</strong><br>수수료: ${(gross * fee).toFixed(4)} HEX`;
    }
    preview.style.display = '';
  });

  $('btnHtSwap')?.addEventListener('click', async () => {
    const rates = await loadSwapRates();
    const cfg   = rates.hex_ton || {};
    if (cfg.enabled === false) { alert('HEX↔TON 교환이 현재 비활성화되어 있습니다.'); return; }
    const tonAddr = $('htTonAddr')?.value.trim() || '';
    const amt     = parseFloat($('htAmount')?.value || '0');
    if (!amt || amt <= 0) { alert('수량을 입력하세요'); return; }

    const rate = Number(cfg.rate ?? 0.02);
    const fee  = Number(cfg.fee  ?? 1) / 100;

    if (_htDir === 'hex_to_ton') {
      // ── HEX → TON: 즉시 자동 처리 ──
      if (!isValidTonAddr(tonAddr)) { alert('TON 수령 주소를 입력하세요 (EQ... 또는 UQ...)'); return; }
      const recv = (amt * rate * (1 - fee)).toFixed(4);
      setLoading('btnHtSwap', true, '교환 처리 중...');
      setStatus('htStatus', 'HEX 이체 중...');
      try {
        const fn  = httpsCallable(functions, 'requestHexTonSwap');
        const res = await fn({ direction: 'hex_to_ton', amount: amt, tonAddress: tonAddr });
        const d   = res.data;
        setStatus('htStatus',
          `✅ 교환 완료! TON ${Number(d.toAmount).toFixed(4)} 전송됨<br>` +
          `TxHash: ${d.tonTxHash ? d.tonTxHash.slice(0, 16) + '…' : '처리 중'}`);
        if ($('htAmount')) $('htAmount').value = '';
        if ($('htPreview')) $('htPreview').style.display = 'none';
      } catch (err) {
        setStatus('htStatus', '실패: ' + (err.message || String(err)), true);
      } finally {
        setLoading('btnHtSwap', false, '교환하기');
      }

    } else {
      // ── TON → HEX: TonConnect 전송 후 자동 HEX 적립 ──
      if (!_tc) { alert('TON 지갑을 먼저 연결하세요'); return; }
      if (!_tonInfo?.adminWallet) { alert('관리자 지갑 정보 로딩 중입니다. 잠시 후 다시 시도하세요.'); return; }

      const tonNano = Math.floor(amt * 1e9);
      const recvHex = (amt / rate * (1 - fee)).toFixed(4);

      setLoading('btnHtSwap', true, '교환 처리 중...');
      setStatus('htStatus', '지갑에서 서명해 주세요...');
      try {
        // 미연결 시 자동 연결
        if (!_tc.wallet) await _tc.connectWallet();
        const senderAddr = _tc.wallet.account.address;
        const sentAt     = Date.now();

        await _tc.sendTransaction({
          validUntil: Math.floor(sentAt / 1000) + 600,
          messages: [{ address: _tonInfo.adminWallet, amount: String(tonNano) }],
        });

        setStatus('htStatus', 'TON 전송 완료! HEX 적립 중...');
        const fn  = httpsCallable(functions, 'requestHexTonSwap');
        const res = await fn({ direction: 'ton_to_hex', amount: amt, senderAddress: senderAddr, tonNano, sentAt });
        const d   = res.data;
        setStatus('htStatus',
          `✅ 교환 완료! HEX ${Number(d.toAmount).toFixed(4)} 적립됨<br>` +
          `TxHash: ${d.hexTxHash ? d.hexTxHash.slice(0, 16) + '…' : '처리 중'}`);
        if ($('htAmount')) $('htAmount').value = '';
        if ($('htPreview')) $('htPreview').style.display = 'none';
        // HEX 잔액 새로고침
        if (window.__loadStatus) window.__loadStatus();
      } catch (err) {
        const msg = err.message || String(err);
        if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
          setStatus('htStatus', '사용자가 취소했습니다.', true);
        } else {
          setStatus('htStatus', '실패: ' + msg, true);
        }
      } finally {
        setLoading('btnHtSwap', false, '교환하기');
      }
    }
  });
}

// ─────────────────────────────────────────────────
// 거래내역
// ─────────────────────────────────────────────────
const PAIR_LABELS = {
  buyJump:'HEX → JUMP', sellJump:'JUMP → HEX',
  stakeJump:'JUMP 스테이킹', unstakeJump:'JUMP 언스테이킹', claimDividend:'배당 청구',
  buyJumpWithCoins:'GameCoin → JUMP', sellJumpForCoins:'JUMP → GameCoin',
  swap_ton_to_coin:'TON → GameCoin', swap_coin_to_ton:'GameCoin → TON',
  swap_hex_to_ton:'HEX → TON', swap_ton_to_hex:'TON → HEX',
};
const STATUS_INFO = {
  completed:['ok','완료'], pending:['pending','처리중'], failed:['fail','실패'],
};

function renderHistRows(items, append = false) {
  const tbody = $('histTableBody');
  if (!tbody) return;
  if (!items.length && !append) {
    tbody.innerHTML = '<tr><td colspan="7" class="hist-empty">거래내역이 없습니다.</td></tr>';
    return;
  }
  const rows = items.map(it => {
    const label = PAIR_LABELS[it.type] || it.type || '–';
    const [cls, txt] = STATUS_INFO[it.status || 'completed'] || ['','–'];
    const from = it.fromAmount != null
      ? Number(it.fromAmount).toLocaleString(undefined, { maximumFractionDigits:4 })
      : (it.hexCost ? (Number(it.hexCost)/1e18).toFixed(4) : (it.coinAmount||it.jumpAmount||'–'));
    const to = it.toAmount != null
      ? Number(it.toAmount).toLocaleString(undefined, { maximumFractionDigits:4 })
      : (it.jumpAmount||it.hexAmount||it.coinAmount||'–');
    const fee = it.feeAmount != null ? Number(it.feeAmount).toFixed(4) : (it.rate!=null?it.rate+'%':'–');
    const d = it.createdAt ? new Date(it.createdAt) : null;
    const dateStr = d
      ? d.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'}) + ' ' +
        d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}) : '–';
    const tx = it.txHash;
    const txLink = tx && tx.startsWith('0x')
      ? `<a href="https://mainnet.opbnbscan.com/tx/${tx}" target="_blank" style="color:#3b82f6;">${tx.slice(0,8)}…</a>`
      : (tx ? tx.slice(0,10)+'…' : '–');
    return `<tr>
      <td>${dateStr}</td>
      <td style="font-family:sans-serif;color:#94a3b8;">${label}</td>
      <td>${from}</td><td>${to}</td><td>${fee}</td>
      <td><span class="hist-badge ${cls}">${txt}</span></td>
      <td>${txLink}</td>
    </tr>`;
  });
  if (append) tbody.insertAdjacentHTML('beforeend', rows.join(''));
  else tbody.innerHTML = rows.join('');
}

async function loadHistory(reset = false) {
  if (reset) { _histLastId = null; _histHasMore = false; }
  const tbody = $('histTableBody');
  if (reset && tbody) tbody.innerHTML = '<tr><td colspan="7" class="hist-empty">로딩 중...</td></tr>';
  try {
    const fn  = httpsCallable(functions, 'getExchangeHistory');
    const res = await fn({
      limit: 20, startAfter: _histLastId,
      pairFilter:   $('histFilterPair')?.value   || '',
      statusFilter: $('histFilterStatus')?.value || '',
    });
    renderHistRows(res.data.items || [], !reset);
    _histLastId  = res.data.lastId  || null;
    _histHasMore = res.data.hasMore || false;
    const more = $('btnHistMore');
    if (more) more.style.display = _histHasMore ? '' : 'none';
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="hist-empty">로드 실패: ${err.message}</td></tr>`;
  }
}

window.__historyLoad = () => loadHistory(true);
window.__coinExLoad  = () => { if (window.__loadCoinExStatus) window.__loadCoinExStatus(); };

// ─────────────────────────────────────────────────
// 유저 GameCoin 잔액 로드
// ─────────────────────────────────────────────────
let _currentCoinBal = 0;

async function loadUserCoinBal() {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const snap = await getDoc(doc(db, 'battle_players', user.uid));
    _currentCoinBal = snap.exists() ? (snap.data().gold || 0) : 0;
    setText('tcCoinBal', _currentCoinBal.toLocaleString() + ' GameCoin');
  } catch (_) {}
}

// ─────────────────────────────────────────────────
// 탭 전환 시 ticker 제어
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.swap-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.swap;
      if (key === 'ton-coin' || key === 'hex-ton') startTonTicker();
      else stopTonTicker();
    });
  });
});

// ─────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  await loadUserCoinBal();
  initTonConnect();

  bindTonTabDir();
  bindTonDeposit();
  bindTonWithdraw(_currentCoinBal);
  bindHexTonSwap();

  $('histFilterPair')?.addEventListener('change',   () => loadHistory(true));
  $('histFilterStatus')?.addEventListener('change', () => loadHistory(true));
  $('btnHistRefresh')?.addEventListener('click',    () => loadHistory(true));
  $('btnHistMore')?.addEventListener('click',       () => loadHistory(false));

  loadSwapRates();
});

window.__updateSwapHexBal = (formatted) => setText('htHexBal', formatted);
