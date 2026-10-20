// /assets/js/pages/pay.js
// 가맹점 BM 결제 — 고객 결제 확인 페이지

import { onAuthReady } from "../auth.js";
import { login } from "../auth.js";
import { auth, db, functions } from "/assets/js/firebase-init.js";
import { initSlot } from "/assets/js/jackpot-anim.js";
import {
  doc,
  getDoc,
  setDoc,
  runTransaction,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

// ── URL 파라미터 파싱 ─────────────────────────────────
const params = new URLSearchParams(location.search);
const merchantId = Number(params.get("merchant"));
const amount = Number(params.get("amount"));
const currency = (params.get("currency") || "VND").toUpperCase();
const orderIdParam = params.get("orderId");

const isVnd = currency === "VND";

// 유효성 검증
const amountMin = isVnd ? 10000 : 1000;
if (!merchantId || !Number.isInteger(merchantId) || merchantId <= 0 ||
  !amount || !Number.isFinite(amount) || amount < amountMin) {
  show("invalidPanel", true);
  throw new Error("invalid pay params");
}

// 하위 호환: amountKrw 변수명 유지
const amountKrw = isVnd ? 0 : amount;
const amountVnd = isVnd ? amount : undefined;

// ── 환율 (표시 전용) ──────────────────────────────────
async function fetchRates() {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    const d = await r.json();
    if (d.result === "success" && d.rates?.KRW && d.rates?.VND)
      return { krwPerUsd: d.rates.KRW, vndPerUsd: d.rates.VND };
  } catch (_) { }
  return { krwPerUsd: 1350, vndPerUsd: 25400 };
}

// ── 가맹점 정보 로드 ──────────────────────────────────
let merchantName = "";

async function loadMerchant() {
  const mSnap = await getDoc(doc(db, "merchants", String(merchantId)));
  if (!mSnap.exists()) {
    show("invalidPanel", true);
    throw new Error("merchant not found");
  }
  const data = mSnap.data() || {};
  if (data.active === false) {
    show("invalidPanel", true);
    const el = $("invalidPanel")?.querySelector("p");
    if (el) el.textContent = "비활성 가맹점입니다.";
    throw new Error("merchant inactive");
  }
  merchantName = data.name || "가맹점";
  document.title = `${merchantName} 결제 확인 | Jump`;

  let amountStr = isVnd
    ? `${amount.toLocaleString()}BM`
    : `${amount.toLocaleString()}원 (KRW)`;
  ["payMerchantNameLogin", "payMerchantNameReg", "payMerchantName"].forEach((id) => setText(id, merchantName));
  ["payAmountLogin", "payAmountReg", "payAmountDisp"].forEach((id) => setText(id, amountStr));
  setText("payHeroDesc", `${merchantName} — ${amountStr}`);

  // 가맹점 설정에 따른 BT 보너스 안내
  const btPerVnd = Math.max(1000, Number(data.btPerVnd || data.btGrantThresholdVnd || 100000));
  const expectedBt = Math.floor((isVnd ? amount : Math.round(amount * 18)) / btPerVnd);
  const btNoticeEl = $("payBtNotice");
  if (btNoticeEl) {
    btNoticeEl.innerHTML = `🎟️ <strong>${expectedBt}장</strong> BT 보너스 지급 예정 <span style="font-size:0.75rem; color:#a16207;">(${btPerVnd.toLocaleString()} VND당 1 BT)</span>`;
    btNoticeEl.style.display = "";
  }

  // VND인 경우 KRW 환산 표시
  if (isVnd) {
    fetchRates().then((rates) => {
      const krw = Math.round((amount / rates.vndPerUsd) * rates.krwPerUsd).toLocaleString();
      const withKrw = `${amount.toLocaleString()}동 ≈ ${krw}원`;
      ["payAmountLogin", "payAmountReg", "payAmountDisp"].forEach((id) => setText(id, withKrw));
      setText("payHeroDesc", `${merchantName} — ${withKrw}`);
    });
  }
}

// ── 인증 처리 ─────────────────────────────────────────
let _authDone = false;

async function init() {
  try {
    await loadMerchant();
  } catch (_) {
    return; // 이미 invalidPanel 표시됨
  }

  let _userBmBalance = 0;

  onAuthReady(({ loggedIn, role, user }) => {
    if (_authDone) return;
    _authDone = true;

    if (!loggedIn) {
      show("needLoginPanel", true);
      const btn = $("btnLogin");
      if (btn) {
        btn.onclick = async () => {
          try {
            await login();
            location.reload();
          } catch (e) {
            console.warn(e);
          }
        };
      }
      return;
    }

    if (role === "user") {
      // 구글 로그인은 됐지만 회원가입(온체인) 미완
      show("needRegisterPanel", true);
      return;
    }

    // 정상 사용자 → 결제 패널 표시 및 실시간 잔액 감시
    show("payPanel", true);

    if (user?.uid) {
      onSnapshot(doc(db, "users", user.uid), (snap) => {
        if (!snap.exists()) return;
        const uData = snap.data() || {};
        const curBalance = Number(uData.pointBalanceVnd ?? uData.paymentBalance ?? uData.bmBalance ?? 0);
        _userBmBalance = curBalance;

        const balEl = $("myBmBalanceText");
        if (balEl) balEl.textContent = `${curBalance.toLocaleString()} BM`;

        const shortageEl = $("balanceShortageMsg");
        const btn = $("btnPay");
        const requiredAmount = isVnd ? amount : Math.round(amount * 18);

        if (curBalance < requiredAmount) {
          if (shortageEl) shortageEl.style.display = "";
          if (btn && btn.textContent !== "결제 중...") {
            btn.disabled = true;
            btn.style.opacity = "0.6";
            btn.textContent = "보유 BM 잔액 부족";
          }
        } else {
          if (shortageEl) shortageEl.style.display = "none";
          if (btn && btn.textContent !== "결제 중...") {
            btn.disabled = false;
            btn.style.opacity = "";
            btn.textContent = "결제하기";
          }
        }
      });
    }

    bindPayButton();
  });

  // 4초 이내 로그인 없으면 로그인 안내
  setTimeout(() => {
    if (!_authDone) {
      _authDone = true;
      show("needLoginPanel", true);
      const btn = $("btnLogin");
      if (btn) {
        btn.onclick = async () => {
          try {
            await login();
            location.reload();
          } catch (e) {
            console.warn(e);
          }
        };
      }
    }
  }, 4000);
}


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
        osc.frequency.setValueAtTime(1500 + Math.random() * 1000, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start(); osc.stop(ctx.currentTime + 0.1);
      } catch (e) { }
    }, i * 50 + Math.random() * 20);
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
      } catch (e) { }
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
        textEl.textContent = `+${amount.toLocaleString()} Point`;
      } else {
        textEl.textContent = `+${Math.floor(current).toLocaleString()} Point`;
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
    try { audioCtx = new AudioContext(); } catch (e) { }
    const playTick = () => {
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = "sine"; osc.frequency.setValueAtTime(700 + Math.random() * 300, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
        osc.start(); osc.stop(audioCtx.currentTime + 0.05);
      } catch (e) { }
    };
    const playWin = () => {
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
        osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);
        osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        osc.start(); osc.stop(audioCtx.currentTime + 1.2);
      } catch (e) { }
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
        sub.innerHTML = `잭팟 등급 <b style="color:#fff;font-size:1.2em;">1/${grade}</b> 확정!`;
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

// ── 클라이언트 Firestore 직통 결제 폴백 ──────────────────
async function executePaymentClientFallback(uid, merchantId, finalVnd, merchant) {
  const userRef = doc(db, "users", uid);
  const merchantRef = doc(db, "merchants", String(merchantId));
  const merchantOwnerUid = merchant.ownerUid || merchant.ownerId || merchant.userId || merchant.uid || uid;
  const isSelfPay = (merchantOwnerUid === uid);
  const merchantOwnerRef = doc(db, "users", merchantOwnerUid);
  const jackpotRef = doc(db, "jackpot_config", "current");
  const bpRef = doc(db, "battle_players", uid);

  const txHash = "TX_FB_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  const checkTxRef = doc(db, "transactions", txHash);
  const roundRef = doc(db, "jackpot_rounds", txHash);
  const winRef = doc(db, "jackpot_wins", txHash);
  const incomeTxRef = doc(db, "transactions", "TX_INC_" + Date.now() + "_" + Math.floor(Math.random() * 10000));

  const feeBps = Number(merchant.feeBps) > 0 ? Number(merchant.feeBps) : 1000;
  const feeVnd = Math.round((finalVnd * feeBps) / 10000);
  const netVnd = finalVnd - feeVnd;
  const jackpotBonusVnd = Math.round(feeVnd * 0.30);

  let payResult = null;

  await runTransaction(db, async (tx) => {
    // 1. ALL READS FIRST
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("회원 정보를 찾을 수 없습니다.");
    const uData = userSnap.data();
    const curBal = Number(uData.pointBalanceVnd ?? uData.paymentBalance ?? uData.bmBalance ?? 0);
    if (curBal < finalVnd) {
      throw new Error(`보유 BM 잔액이 부족합니다. (현재 보유: ${curBal.toLocaleString()} BM, 필요: ${finalVnd.toLocaleString()} BM)`);
    }

    const merchSnap = await tx.get(merchantRef);
    const mData = merchSnap.exists() ? (merchSnap.data() || {}) : {};
    const merchBt = Number(mData.btBalance || 0);

    const jackpotSnap = await tx.get(jackpotRef);
    let currentJackpotPool = jackpotSnap.exists() ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;

    let ownerSnap = null;
    if (!isSelfPay) {
      ownerSnap = await tx.get(merchantOwnerRef);
    }

    // 2. CALCULATIONS
    currentJackpotPool += jackpotBonusVnd; // 결제로 발생한 잭팟 기여금을 즉시 풀에 합산 후 추첨

    const r_grade = Math.random() * 100;
    let grade = 0;
    if (r_grade < 0.1) grade = Math.floor(Math.random() * (20 - 10 + 1)) + 10;
    else if (r_grade < 0.6) grade = Math.floor(Math.random() * (50 - 21 + 1)) + 21;
    else if (r_grade < 2.6) grade = Math.floor(Math.random() * (100 - 51 + 1)) + 51;
    else if (r_grade < 12.6) grade = Math.floor(Math.random() * (300 - 101 + 1)) + 101;
    else if (r_grade < 37.6) grade = Math.floor(Math.random() * (500 - 301 + 1)) + 301;
    else if (r_grade < 72.6) grade = Math.floor(Math.random() * (800 - 501 + 1)) + 501;
    else grade = Math.floor(Math.random() * (1000 - 801 + 1)) + 801;

    let reward = Math.floor((feeVnd + currentJackpotPool) / grade) + Math.floor(feeVnd / grade);
    if (reward <= 0 && (feeVnd > 0 || currentJackpotPool > 0)) reward = 1;
    if (reward < 0) reward = 0;
    const safeJackpotReward = Math.max(0, Math.floor(Number(reward) || 0));
    currentJackpotPool = Math.max(0, currentJackpotPool - safeJackpotReward);

    const cashbackPoint = Math.floor(finalVnd * 0.05);
    const totalPointsEarned = safeJackpotReward + cashbackPoint;

    // [BT 제로섬 보존 법칙 - 무한 발행 절대 방지]
    // 가맹점 주가 설정한 결제금액(btPerVnd)당 1 BT 기준이나, 가맹점의 실제 잔여 BT(merchBt) 범위 내에서만 지급.
    // 가맹점의 btBalance가 차감되지 않은 상태에서 소비자의 BT가 늘어나는 것은 절대 불가!
    const btPerVnd = Math.max(1000, Number(mData.btPerVnd || mData.btGrantThresholdVnd || 100000));
    const maxBtRequested = Math.floor(finalVnd / btPerVnd);
    const actualBt = Math.min(maxBtRequested, Math.max(0, merchBt));
    const payExp = Math.floor(finalVnd / 1000);

    const rRed = Math.random();
    const rMp = Math.random();
    const rRevive = Math.random();
    const potionsAdded = rRed < 0.20 ? 1 : 0;
    const mpPotionsAdded = rMp < 0.10 ? 1 : 0;
    const reviveAdded = rRevive < 0.05 ? 1 : 0;

    // 3. ALL WRITES
    tx.set(jackpotRef, {
      jackpotAccVnd: currentJackpotPool,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const finalWinWeiAmt = (BigInt(totalPointsEarned) * 1000000000000000000n).toString();
    tx.set(roundRef, {
      isWinner: totalPointsEarned > 0,
      randomValue: grade,
      finalWinWei: finalWinWeiAmt,
      btUsed: 0,
      createdAt: serverTimestamp()
    });

    if (totalPointsEarned > 0) {
      const displayName = uData.name || uData.nickname || (uData.email ? uData.email.split('@')[0] : 'User');
      tx.set(winRef, {
        uid,
        userName: displayName,
        userAddress: uData.walletAddress || '',
        merchantName: merchant.name || '',
        merchantId: Number(merchantId),
        amountVnd: totalPointsEarned,
        amountKrw: totalPointsEarned,
        pointsEarned: totalPointsEarned,
        grade: grade,
        btUsed: 0,
        potionCount: potionsAdded,
        mpPotionCount: mpPotionsAdded,
        reviveAdded: reviveAdded,
        createdAt: serverTimestamp(),
        txHash
      });
    }

    // 가맹점 BT 원자적 차감 (가맹점 보유 잔여량 차감)
    if (actualBt > 0) {
      tx.update(merchantRef, {
        btBalance: increment(-actualBt),
        updatedAt: serverTimestamp()
      });
    }

    const userUpdate = {
      pointBalanceVnd: isSelfPay ? (curBal - feeVnd) : (curBal - finalVnd),
      pointBalance: increment(totalPointsEarned),
      gsExp: increment(payExp)
    };
    if (actualBt > 0) {
      userUpdate.btBalance = increment(actualBt);
    }
    if (potionsAdded > 0) userUpdate.potions = increment(potionsAdded);
    if (mpPotionsAdded > 0) userUpdate.mpPotions = increment(mpPotionsAdded);
    if (reviveAdded > 0) userUpdate.reviveTickets = increment(reviveAdded);

    tx.update(userRef, userUpdate);

    if (!isSelfPay) {
      const ownerBal = (ownerSnap && ownerSnap.exists()) ? Number(ownerSnap.data().pointBalanceVnd || 0) : 0;
      const ownerUpdate = {
        pointBalanceVnd: ownerBal + netVnd
      };
      if (actualBt > 0) {
        ownerUpdate.btBalance = increment(-actualBt);
      }
      tx.set(merchantOwnerRef, ownerUpdate, { merge: true });
    }

    if (potionsAdded > 0 || mpPotionsAdded > 0 || reviveAdded > 0) {
      tx.set(bpRef, {
        potions: increment(potionsAdded),
        mpPotions: increment(mpPotionsAdded),
        reviveTickets: increment(reviveAdded),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    // 구매자 결제 기록
    tx.set(checkTxRef, {
      createdAt: serverTimestamp(),
      currency: "VND",
      amountVnd: finalVnd,
      amountKrw: Math.round(finalVnd / 18),
      merchantId: Number(merchantId),
      merchantName: merchant.name || "",
      txHash,
      uid,
      type: "pay_merchant",
      pointsEarned: totalPointsEarned,
      issuedBt: actualBt,
      requestedBt: maxBtRequested,
      grade
    });

    // 가맹점 정산 수입 기록 (merchant-qr.js 수신 감지용)
    tx.set(incomeTxRef, {
      createdAt: serverTimestamp(),
      currency: "VND",
      amountVnd: finalVnd,
      netAmountVnd: netVnd,
      feeAmountVnd: feeVnd,
      merchantId: Number(merchantId),
      merchantName: merchant.name || "",
      txHash,
      uid: merchantOwnerUid,
      buyerUid: uid,
      type: "merchant_income"
    });

    payResult = {
      txHash,
      merchantName: merchant.name || "",
      amountVnd: finalVnd,
      amountKrw: Math.round(finalVnd / 18),
      pointsEarned: totalPointsEarned,
      isJackpot: totalPointsEarned > 0,
      grade: grade,
      issuedBt: actualBt,
      requestedBt: maxBtRequested,
      payExp: payExp,
      potionsAdded,
      mpPotionsAdded,
      reviveAdded
    };
  });

  return payResult;
}

// ── 결제 버튼 바인딩 ──────────────────────────────────

function bindPayButton() {
  const btn = $("btnPay");
  if (!btn) return;

  const amountConfirmStr = isVnd
    ? `${amount.toLocaleString()}BM`
    : `${amount.toLocaleString()}원 (KRW)`;

  btn.onclick = async () => {
    if (!confirm(`${merchantName}에 ${amountConfirmStr}을 결제하시겠습니까?\n(내 보유 BM에서 결제됩니다)`)) return;

    btn.disabled = true;
    btn.textContent = "결제 중...";
    const stateEl = $("payState");
    if (stateEl) { stateEl.textContent = "서버 결제 처리 중입니다. 잠시 기다려 주세요..."; stateEl.style.display = ""; }

    try {
      const orderId = String(Date.now());
      let d = null;
      try {
        const payFn = httpsCallable(functions, "payMerchantFirebase");
        const payload = isVnd
          ? { merchantId: Number(merchantId), amountVnd: Number(amountVnd), currency: "VND", reqId: orderId }
          : { merchantId: Number(merchantId), amountKrw: Number(amountKrw), reqId: orderId };
        const res = await payFn(payload);
        d = res.data;
      } catch (cfErr) {
        // 보안: 클라이언트 직통 결제 폴백(executePaymentClientFallback) 사용 중지 — 결제는 서버에서만 처리
        console.warn("[Cloud Function Call Failed]", cfErr);
        throw cfErr;
      }

      try {
        const topArr = document.querySelectorAll('.info-header span, .head-coins span, .head-point span, [data-point="true"]');
        topArr.forEach(el => {
          if (el.textContent.includes('BM') || el.textContent.includes('KM') || el.textContent.includes('원')) {
            const currentStr = el.textContent.replace(/[^0-9]/g, '');
            if (currentStr) { el.textContent = (Number(currentStr) - (d.amountKrw || 0)).toLocaleString() + ' BM'; }
          }
        });
        // Update Point specifically
        const pointEl = document.querySelector('[data-point="true"]') || document.querySelector('.head-point span') || document.querySelector('.info-header [data-hdr-i18n="hdr_member_badge"]');
        // It might be hard to find exact point element class, let's just reload auth.js stats!
        if (window.loadMyBalances) {
          window.loadMyBalances();
        }
      } catch (e) { } 

      // 가맹점 주문 연동 시 주문 상태 업데이트
      if (orderIdParam) {
        try {
          await updateDoc(doc(db, "merchant_orders", orderIdParam), {
            status: "payment_confirmed",
            payment_status: "paid",
            payment_method: "bm_wallet",
            paid_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            txHash: d.txHash || ""
          });
        } catch (mErr) {
          console.warn("merchant_orders update error:", mErr);
        }
      }

      // 완료 패널 표시
      show("payPanel", false);
      show("donePanel", true);
      watchJackpotResult(d.txHash);

      const krwStr = `${(d.amountKrw || 0).toLocaleString()}원`;
      const vndStr = d.amountVnd ? `${Math.round(d.amountVnd).toLocaleString()}동` : '';
      const paidAmountStr = [krwStr, vndStr].filter(Boolean).join(' / ');

      const resultEl = $("payResult");
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="mp-kv"><span class="k">가맹점</span><span class="v">${d.merchantName || merchantName}</span></div>
          <div class="mp-kv"><span class="k">결제 금액</span><span class="v">${paidAmountStr}</span></div>
          ${buildDropHtml(d)}
        `;
      }
    } catch (err) {
      if (stateEl) stateEl.style.display = "none";
      console.error("[Pay Error]", err);
      let errMsg = err?.details || err?.message || "서버 오류가 발생했습니다.";
      if (typeof errMsg === "string" && (errMsg.toLowerCase().includes("billing is disabled") || errMsg.toLowerCase() === "internal")) {
        errMsg = "Firebase Cloud Function 결제 계정(Billing) 비활성화 또는 서버 일시적 오류입니다.\n(Google Cloud Console에서 프로젝트의 Blaze 플랜 / Billing 활성 상태를 확인해 주세요.)";
      }
      alert("결제 실패: " + errMsg);
      btn.disabled = false;
      btn.textContent = "결제하기";
    }
  };
}

// ── 결제 아이템 드롭 표시 ──────────────────────────────
function buildDropHtml(d) {
  const items = [];
  if (d.pointsEarned > 0) {
    items.push(`<div style="font-size:1.3em; color:#fff; font-weight:800; background:linear-gradient(135deg,#eab308,#d97706); padding:10px; border-radius:8px; text-shadow:0 0 10px rgba(0,0,0,0.3); text-align:center;box-shadow:0 4px 15px rgba(234,179,8,0.4); border: 2px solid #fef08a;">🎉 리워드 당첨! <br><span id="jackpotAmountText" style="font-size:2.4em; display:block; margin-top:5px; font-variant-numeric:tabular-nums; color:#fff; text-shadow:0 0 20px #ea1;">+${d.pointsEarned.toLocaleString()} Point</span></div>`);
  }
  if (d.issuedBt > 0) {
    if (d.requestedBt && d.requestedBt > d.issuedBt) {
      items.push(`🎟️ 보너스티켓(BT) <b>+${d.issuedBt}장</b> <span style="font-size:12px;color:#d97706;display:block;">(가맹점 보유 잔여 한도로 ${d.requestedBt}장 중 ${d.issuedBt}장만 지급되었습니다.)</span>`);
    } else {
      items.push(`🎟️ 보너스티켓(BT) <b>+${d.issuedBt}장</b>`);
    }
  } else if (d.requestedBt > 0) {
    items.push(`<div style="font-size:12px;color:#b91c1c;background:#fee2e2;padding:6px 10px;border-radius:6px;border:1px solid #fca5a5;">⚠️ 가맹점의 보유 BT 소진으로 보너스티켓(BT)이 지급되지 않았습니다.</div>`);
  }
  if (d.payExp > 0) {
    items.push(`⭐ 경험치 <b>+${d.payExp.toLocaleString()} EXP</b>`);
  }
  if (d.potionsAdded > 0) items.push(`<img src="/assets/images/item/hp.png" style="width:28px;height:28px;vertical-align:middle;"> 빨간약 <b>+${d.potionsAdded}</b>`);
  if (d.mpPotionsAdded > 0) items.push(`<img src="/assets/images/item/mp.png" style="width:28px;height:28px;vertical-align:middle;"> 마법약 <b>+${d.mpPotionsAdded}</b>`);
  if (d.reviveAdded > 0) items.push(`<img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:28px;height:28px;vertical-align:middle;"> 부활권 <b>+${d.reviveAdded}</b>`);

  if (!items.length) return '';
  return `<div style="margin-top:14px;background:rgba(251,191,36,.12);border:1.5px solid #f59e0b;border-radius:15px;padding:14px;box-shadow:inset 0 0 20px rgba(251,191,36,0.1);"><div style="font-size:13px;color:#92400e;font-weight:900;margin-bottom:10px;text-align:center;">🎁 지급 내역</div>${items.map(i => `<div style="font-size:15px;margin:6px 0;">${i}</div>`).join('')}</div>`;
}

// ── 잭팟 결과 감시 ────────────────────────────────────
function weiToHex(weiStr, decimals = 18) {
  const wei = BigInt(weiStr || "0");
  const d = BigInt(decimals);
  const whole = wei / 10n ** d;
  const frac = (wei % 10n ** d).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function watchJackpotResult(txHash) {
  const box = $("jackpotResultBox");
  if (!box || !txHash) return;
  box.style.display = "";

  // 슬롯머신 시작
  const slot = initSlot($("jpWaiting"));
  const startTime = Date.now();

  let unsub = null;
  let retryTimer = null;
  let giveupTimer = null;
  let revealed = false;

  const cleanup = () => {
    if (unsub) { unsub(); unsub = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (giveupTimer) { clearTimeout(giveupTimer); giveupTimer = null; }
  };

  const reveal = (data) => {
    if (revealed) return;
    revealed = true;
    cleanup();
    const isWin = data.isWinner && BigInt(data.finalWinWei || "0") > 0n;

    // 슬롯 회전감을 충분히 느낄 수 있도록 최소 1.5초 스핀 후 감속 정지
    const elapsed = Date.now() - startTime;
    const waitTime = Math.max(0, 1500 - elapsed);

    setTimeout(() => {
      slot.stop(data.randomValue ?? 0, isWin, () => {
        show("jpWaiting", false);
        if (isWin) {
          const winAmt = Number(weiToHex(data.finalWinWei));
          setText("jpWinAmount", `+${winAmt.toLocaleString()} Point`);
          const titleEl = box.querySelector(".jp-win-title");
          if (titleEl) {
            titleEl.textContent = `🎉 잭팟 당첨! (행운 등급: 1/${data.randomValue})`;
          }
          show("jpWin", true);
          // 축하 콘페티 및 사운드 폭발
          playUltimateJackpotEffect(winAmt);
        } else {
          const el = $("jpNoWinRand");
          if (el) el.textContent = `추첨 번호: ${data.randomValue ?? 0} / 9999`;
          show("jpNoWin", true);
        }
      });
    }, waitTime);
  };

  // 30초 후: 수동 재확인 버튼
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    const snap = await getDoc(doc(db, "jackpot_rounds", txHash));
    if (snap.exists()) { reveal(snap.data()); return; }
    const waitEl = $("jpWaiting");
    if (waitEl) waitEl.insertAdjacentHTML("beforeend",
      `<br><button onclick="window.__jpRetry&&window.__jpRetry()" style="margin-top:8px;padding:5px 14px;border:1px solid #c4b5fd;border-radius:8px;background:#f5f3ff;color:#7c3aed;font-size:0.82rem;cursor:pointer;">결과 다시 확인</button>`
    );
    window.__jpRetry = async () => {
      const s = await getDoc(doc(db, "jackpot_rounds", txHash));
      if (s.exists()) reveal(s.data());
    };
  }, 30000);

  // 120초 후: 최종 안내
  giveupTimer = setTimeout(() => {
    if (revealed) return;
    cleanup();
    const waitEl = $("jpWaiting");
    if (waitEl) waitEl.innerHTML = `<div style="padding:12px;color:#94a3b8;font-size:0.82rem;">잭팟 결과는 마이페이지에서 확인하세요</div>`;
  }, 120000);

  unsub = onSnapshot(
    doc(db, "jackpot_rounds", txHash),
    (snap) => { if (snap.exists()) reveal(snap.data()); },
    (err) => {
      cleanup();
      console.warn("jackpot onSnapshot error:", err.code);
    }
  );
}

// ── 시작 ─────────────────────────────────────────────
init();
