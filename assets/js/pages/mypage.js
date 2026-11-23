// /assets/js/pages/mypage.js
// MyPage: profile / wallet / on-chain status / deposit & payment history

import { _t, initLang, renderLangSwitcher } from './mypage.i18n.js';
import { esc } from '/assets/js/esc.js';
import { onAuthReady } from "../auth.js";
import { db, functions, auth } from "/assets/js/firebase-init.js";
import { login } from "../auth.js";
import { initSlot } from "/assets/js/jackpot-anim.js";

import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  onSnapshot,
  updateDoc,
  increment,
  addDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

let _pointHexAmount = 0; // loadOnChainData에서 갱신, bindRedeemPoints에서 참조

function show(id, on) {
  const el = $(id);
  if (!el) return;
  el.style.display = on ? "" : "none";
  // 아코디언 섹션이 처음 표시될 때 자동 펼치기
  if (on && el.classList.contains('collapsible')) {
    el.classList.remove('is-collapsed');
  }
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

function renderProfile(userData, fireUser) {
  setText("infoName", userData?.name || "-");
  setText("infoEmail", fireUser?.email || userData?.email || "-");
  setText("infoPhone", userData?.phone || "-");
}

// ── 친구 초대 QR ──────────────────────────────────────────────────────────────
function renderReferralSection(uid) {
  const section = $('referralSection');
  if (!section || !uid) return;
  section.style.display = '';

  const inviteUrl = `${location.origin}/register.html?mentor=${encodeURIComponent(uid)}`;
  const linkEl = $('referralLink');
  const qrWrap = $('referralQrWrap');
  const copyBtn = $('btnCopyReferral');
  const copyMsg = $('referralCopyMsg');

  if (linkEl) linkEl.value = inviteUrl;

  // QR 코드 생성 (뷰포트 진입 시 lazy load)
  const observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    observer.disconnect();
    import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm').then(mod => {
      const canvas = document.createElement('canvas');
      mod.default.toCanvas(canvas, inviteUrl, { width: 200, margin: 1 }, () => {
        if (qrWrap) { qrWrap.innerHTML = ''; qrWrap.appendChild(canvas); }
      });
    }).catch(() => {
      if (qrWrap) qrWrap.innerHTML =
        `<a href="${inviteUrl}" style="font-size:0.75rem;word-break:break-all;">${inviteUrl}</a>`;
    });
  }, { threshold: 0.1 });
  if (qrWrap) observer.observe(qrWrap);

  // 복사 버튼
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {
      if (linkEl) { linkEl.select(); document.execCommand('copy'); }
    }).finally(() => {
      if (copyMsg) {
        copyMsg.textContent = '✅ 링크가 복사되었습니다!';
        setTimeout(() => { copyMsg.textContent = ''; }, 2000);
      }
    });
  }, { once: false });

  // 섹션 헤더 클릭 토글
  section.querySelector('.mp-section-head')?.addEventListener('click', () => {
    section.classList.toggle('is-collapsed');
  }, { once: true });
}

function renderWallet(d) { }

async function consumeBtClientFallback(uid, numBt, isMerchantOwner, mRef) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error("사용자 정보를 찾을 수 없습니다.");
  const userData = userSnap.data() || {};
  let currentBt = Number(userData.btBalance || 0);
  let merchantData = null;

  if (isMerchantOwner && mRef) {
    try {
      const mS = await getDoc(mRef);
      if (mS.exists()) {
        merchantData = mS.data();
        currentBt = Number(merchantData.btBalance || currentBt);
      }
    } catch (e) {
      console.warn("getDoc mRef failed:", e);
    }
  }

  if (currentBt < numBt) {
    throw new Error("잔여 보너스티켓(BT)이 부족합니다.");
  }

  let currentJackpotPool = 500000;
  try {
    const jpSnap = await getDoc(doc(db, "jackpot_config", "current"));
    if (jpSnap.exists()) {
      currentJackpotPool = Number(jpSnap.data().jackpotAccVnd || jpSnap.data().pool || 500000);
    }
  } catch (_) {}

  let totalJackpotReward = 0;
  let potionsAdded = 0, mpPotionsAdded = 0, reviveAdded = 0;
  let firstGrade = 0;

  for (let i = 0; i < numBt; i++) {
    const rItem = Math.random();
    if (rItem < 0.2) potionsAdded++;
    else if (rItem < 0.3) mpPotionsAdded++;
    else if (rItem < 0.35) reviveAdded++;

    const r_grade = Math.random() * 100;
    let grade = 0;
    if (r_grade < 0.1) grade = Math.floor(Math.random() * (20 - 10 + 1)) + 10;
    else if (r_grade < 0.6) grade = Math.floor(Math.random() * (50 - 21 + 1)) + 21;
    else if (r_grade < 2.6) grade = Math.floor(Math.random() * (100 - 51 + 1)) + 51;
    else if (r_grade < 12.6) grade = Math.floor(Math.random() * (300 - 101 + 1)) + 101;
    else if (r_grade < 37.6) grade = Math.floor(Math.random() * (500 - 301 + 1)) + 301;
    else if (r_grade < 72.6) grade = Math.floor(Math.random() * (800 - 501 + 1)) + 501;
    else grade = Math.floor(Math.random() * (1000 - 801 + 1)) + 801;

    if (i === 0) firstGrade = grade;

    // 당첨 포인트 = 잭팟 풀 ÷ 당첨번호(grade) (서버 consumeUserBtFirebase 와 같은 식)
    let reward = Math.floor(currentJackpotPool / grade);
    if (reward <= 0) reward = 1;

    totalJackpotReward += reward;
    currentJackpotPool = Math.max(0, currentJackpotPool - reward);
  }

  const txHash = 'CONSUME_BT_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const newBt = Math.max(0, currentBt - numBt);

  // 1. 유저 BT 차감 및 획득 포인트 적립
  await updateDoc(userRef, {
    btBalance: newBt,
    pointBalance: increment(totalJackpotReward),
    updatedAt: serverTimestamp()
  });

  // 2. 가맹점주인 경우 가맹점 BT 동기화 차감
  if (isMerchantOwner && mRef) {
    try {
      await updateDoc(mRef, {
        btBalance: newBt,
        updatedAt: serverTimestamp()
      });
    } catch (mErr) {
      console.warn("Failed to update merchant btBalance:", mErr);
    }
  }

  // 3. 배틀 플레이어 아이템 지급 시도
  if (potionsAdded > 0 || mpPotionsAdded > 0 || reviveAdded > 0) {
    try {
      const bpRef = doc(db, "battle_players", uid);
      await setDoc(bpRef, {
        potions: increment(potionsAdded),
        mpPotions: increment(mpPotionsAdded),
        reviveTickets: increment(reviveAdded),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (_) {}
  }

  // 4. jackpot_wins 컬렉션에 당첨 기록 생성 (index.html 메인 최근 당첨자 및 마이페이지 기록용)
  const displayName = userData.name || userData.displayName || (userData.email ? userData.email.split('@')[0] : '회원');
  const merchantName = (merchantData && (merchantData.name || merchantData.merchantName)) || userData.merchantName || '대한김치';
  const merchantId = userData.merchantId || (merchantData ? merchantData.id : 'daehan_kimchi');

  const winDoc = {
    uid,
    userName: displayName,
    userAddress: userData.walletAddress || '',
    merchantName: merchantName,
    merchantId: merchantId,
    amountVnd: totalJackpotReward,
    amountKrw: totalJackpotReward,
    pointsEarned: totalJackpotReward,
    grade: firstGrade,
    btUsed: numBt,
    potionCount: potionsAdded,
    mpPotionCount: mpPotionsAdded,
    reviveAdded: reviveAdded,
    createdAt: serverTimestamp(),
    timestamp: serverTimestamp(),
    txHash
  };

  try {
    await setDoc(doc(db, "jackpot_wins", txHash), winDoc);
  } catch (winErr) {
    console.error("Failed to write jackpot_wins doc:", winErr);
  }

  // 5. jackpot_config 누적 잭팟 갱신
  try {
    await setDoc(doc(db, "jackpot_config", "current"), {
      jackpotAccVnd: Math.max(100000, currentJackpotPool),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (_) {}

  return {
    success: true,
    txHash,
    isJackpot: totalJackpotReward > 0,
    pointsEarned: totalJackpotReward,
    jackpotAmountVnd: totalJackpotReward,
    btUsed: numBt,
    remainingBt: newBt,
    potionsAdded,
    mpPotionsAdded,
    reviveAdded,
    randomValue: firstGrade || Math.floor(Math.random() * 900) + 100
  };
}

const EXP_TITLES = [
  "",
  "입문자",   // Lv.1
  "초보자",   // Lv.2
  "수련자",   // Lv.3
  "숙련자",   // Lv.4
  "고수",     // Lv.5
  "달인",     // Lv.6
  "영웅",     // Lv.7
  "전설",     // Lv.8
  "신화",     // Lv.9
  "마스터"    // Lv.10+
];

async function loadExpAndLevel(uid, cachedUserData) {
  try {
    let userData = cachedUserData;
    if (!userData) {
      const uSnap = await getDoc(doc(db, "users", uid));
      userData = uSnap.exists() ? uSnap.data() : {};
    }

    let bpData = {};
    try {
      const bpSnap = await getDoc(doc(db, "battle_players", uid));
      if (bpSnap.exists()) bpData = bpSnap.data() || {};
    } catch (_) {}

    // 게임 레벨·경험치는 게임 DB(battle_players) 기준, 다음 레벨 필요 누적 경험치 = (레벨+1)² × 10,000 (게임과 동일)
    const displayLevel = Math.max(1, Number(bpData.gsLevel || 1), Number(userData.gsLevel || 1), Number(userData.level || 1), Number(bpData.level || 1));
    const displayExp = Math.max(Number(bpData.gsExp || 0), Number(userData.gsExp || 0), Number(userData.exp || 0));
    const required = (displayLevel + 1) * (displayLevel + 1) * 10000;
    const pct = required > 0 ? Math.min(100, Math.round((displayExp / required) * 100)) : 0;
    const remain = Math.max(0, required - displayExp);
    const canLevelUp = displayExp >= required;

    // 1. 프로필 정보 표시
    show("levelRow", true);
    setText("levelDisplay", "Lv." + displayLevel);
    show("expRow", true);
    setText("expDisplay", `${displayExp.toLocaleString()} / ${required.toLocaleString()} EXP`);

    // 2. ⭐ 레벨 & EXP 전용 카드 표시
    const card = $("expLevelCard");
    if (card) {
      card.style.display = "";

      const badge = $("expLevelBadge");
      if (badge) badge.textContent = String(displayLevel);

      const titleEl = $("expLevelTitle");
      if (titleEl) {
        titleEl.textContent = EXP_TITLES[displayLevel] || (displayLevel >= 10 ? "마스터" : `Lv.${displayLevel}`);
      }

      const nextEl = $("expToNextLevel");
      if (nextEl) {
        nextEl.textContent = canLevelUp ? "레벨업 가능! 🎉" : `${remain.toLocaleString()} EXP`;
      }

      const barFillNew = $("expBarFillNew");
      if (barFillNew) {
        setTimeout(() => {
          barFillNew.style.width = pct + "%";
        }, 50);
      }
      const barFill = $("expBarFill");
      if (barFill) {
        setTimeout(() => {
          barFill.style.width = pct + "%";
        }, 50);
      }

      const progLabel = $("expProgressLabel");
      if (progLabel) {
        progLabel.textContent = `${displayExp.toLocaleString()} / ${required.toLocaleString()} EXP (${pct}%)`;
      }

      const convRate = $("expConversionRate");
      if (convRate) {
        convRate.textContent = `GP × ${displayLevel} ÷ 10`;
      }

      // 레벨은 누적 경험치로 자동으로 오른다 (게임과 같음) — 수동 레벨업 버튼 사용 안 함
      show("levelUpRow", false);
    }

    if ($("gpUserLevelDisplay")) {
      $("gpUserLevelDisplay").textContent = "Level: " + displayLevel;
    }

    return { displayLevel, displayExp, required, pct, canLevelUp };
  } catch (err) {
    console.error("loadExpAndLevel error:", err);
  }
}

async function doLevelUp(uid) {
  // 2026-10-21: 레벨은 게임 누적 경험치로 자동 계산 — 경험치를 깎는 수동 레벨업은 쓰지 않는다 (docs/adr/0001)
  throw new Error("레벨은 경험치가 쌓이면 자동으로 오릅니다.");
  // eslint-disable-next-line no-unreachable
  // 1. Cloud Function 시도 (배포 상태일 경우)
  try {
    const fn = httpsCallable(functions, "requestLevelUp");
    const res = await fn();
    if (res?.data?.newLevel) return res.data.newLevel;
  } catch (fnErr) {
    console.warn("requestLevelUp Cloud Function unavailable, fallback to direct Firestore:", fnErr?.message || fnErr);
  }

  // 2. Direct Firestore fallback
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error("사용자 정보를 찾을 수 없습니다.");
  const userData = userSnap.data() || {};

  let bpData = {};
  try {
    const bpSnap = await getDoc(doc(db, "battle_players", uid));
    if (bpSnap.exists()) bpData = bpSnap.data() || {};
  } catch (_) {}

  const currentLevel = Math.max(1, Number(userData.gsLevel ?? userData.level ?? bpData.gsLevel ?? bpData.level ?? 1));
  const currentExp = Number(userData.gsExp ?? userData.exp ?? bpData.gsExp ?? 0);
  const required = currentLevel * currentLevel * 10000;

  if (currentExp < required) {
    throw new Error(`경험치(EXP)가 부족합니다.\n현재: ${currentExp.toLocaleString()} / 필요: ${required.toLocaleString()} EXP`);
  }

  const newLevel = currentLevel + 1;
  const newExp = Math.max(0, currentExp - required);

  await updateDoc(userRef, {
    gsLevel: newLevel,
    level: newLevel,
    gsExp: newExp,
    exp: newExp,
    updatedAt: serverTimestamp()
  });

  try {
    const bpRef = doc(db, "battle_players", uid);
    const bpSnap = await getDoc(bpRef);
    if (bpSnap.exists()) {
      await updateDoc(bpRef, {
        gsLevel: newLevel,
        level: newLevel,
        gsExp: newExp,
        updatedAt: serverTimestamp()
      });
    }
  } catch (e) {
    console.warn("battle_players level update skipped:", e);
  }

  try {
    await addDoc(collection(db, "exp_logs"), {
      uid,
      reason: "manual_level_up",
      prevLevel: currentLevel,
      newLevel,
      prevExp: currentExp,
      newExp,
      createdAt: serverTimestamp()
    });
  } catch (_) {}

  return newLevel;
}

async function loadOnChainData(uid) {
  return await loadExpAndLevel(uid);
}

async function loadKCultureBalances(uid) {
  try {
    try { await httpsCallable(functions, "getMoneyTreeInventory")(); } catch (_) {}
    const userSnap = await getDoc(doc(db, "users", uid));
    show("paymentBalanceRow", true);
    show("pointRow", true);
    show("btRow", true); // 추가된 BT 카드 보이기

    if (userSnap.exists()) {
      const d = userSnap.data();
      const pointBal = d.pointBalance || 0;
      const payBal = d.pointBalanceVnd || 0;
      let btBal = d.btBalance || 0;

      loadExpAndLevel(uid, d);

      const isMerchantOwner = !!d.merchantId;
      let mRef = null;

      if (isMerchantOwner) {
        show("aiErpBannerOption", true); // Show the SaaS ERP Banner

        mRef = doc(db, "merchants", String(d.merchantId));
        // BT 는 회원 BT(가게 BT + 결제로 받은 BT 합산)를 그대로 보여 준다 (2026-10-21)
      }

      const elPoint = $("pointDisplay");
      const elPay = $("paymentBalanceDisplay");
      const elBt = $("btDisplay");

      // 실시간 업데이트
      onSnapshot(doc(db, "users", uid), async (snap) => {
        if (!snap.exists()) return;
        const updatedD = snap.data();
        loadExpAndLevel(uid, updatedD);
        const pBal = updatedD.pointBalance || 0;
        const kBal = updatedD.pointBalanceVnd || 0;
        let bBal = updatedD.btBalance || 0;

        const updateBtDom = (val) => {
          if (elBt) {
            const btSpan = elBt.querySelector("#btSpan");
            if (btSpan) btSpan.textContent = val.toLocaleString("ko-KR") + " BT";
            else elBt.innerHTML = `<span id="btSpan" style="font-size:1.6rem;">${val.toLocaleString("ko-KR")} BT</span>`;
          }
        };

        // 가맹점주도 회원 BT(합산)를 그대로 표시
        updateBtDom(bBal);


        const elGpDisp = document.getElementById("gpBalanceDisplay");
        const elGpLv = document.getElementById("gpUserLevelDisplay");
        const elGpBtn = document.getElementById("btnConvertGpToPoint");

        // 게임 GP·게임 레벨은 게임 DB(battle_players) 기준
        let gpBal = 0;
        let userLv = 1;
        try {
          const bpS = await getDoc(doc(db, "battle_players", uid));
          if (bpS.exists()) {
            gpBal = Math.floor(Number(bpS.data().gold || 0));
            userLv = Math.max(1, Number(bpS.data().gsLevel || 1));
          }
        } catch (e) { console.warn("battle_players 읽기 실패:", e); }

        if (elGpDisp) elGpDisp.textContent = gpBal.toLocaleString("ko-KR") + " GP";
        if (elGpLv) elGpLv.textContent = "Level: " + userLv;
        // 전환 가능 GP (게임용 5,000 GP 제외) 안내
        const showGpConvertable = () => {
          let el = document.getElementById("gpConvertableDisplay");
          if (!el && elGpDisp) {
            el = document.createElement("div");
            el.id = "gpConvertableDisplay";
            el.style.cssText = "font-size:0.78rem; color:#64748b; margin-top:4px; line-height:1.4;";
            elGpDisp.insertAdjacentElement("afterend", el);
          }
          if (!el) return;
          const conv = Math.max(0, gpBal - GP_KEEP_MIN);
          el.textContent = conv >= 10
            ? `전환 가능 ${conv.toLocaleString("ko-KR")} GP → 약 ${Math.floor((conv * userLv) / 10).toLocaleString("ko-KR")} P (게임용 ${GP_KEEP_MIN.toLocaleString("ko-KR")} GP는 남김)`
            : `게임용 ${GP_KEEP_MIN.toLocaleString("ko-KR")} GP는 남겨 둡니다. ${(GP_KEEP_MIN + 10).toLocaleString("ko-KR")} GP 이상일 때 전환할 수 있습니다.`;
        };
        showGpConvertable();

        // BM → 게임 GP 충전 (서버 convertBmToGp: GP = BM × 100 ÷ 레벨, 수수료 5%, 하루 최대 10,000 BM)
        const elBmGpRate = document.getElementById("bmToGpRateDisplay");
        if (elBmGpRate) {
          const per1000 = Math.floor(Math.floor((1000 * 100) / userLv) * 0.95);
          elBmGpRate.textContent = `충전 비율: BM × 100 ÷ Lv.${userLv} = GP, 수수료 5% (1,000 BM → ${per1000.toLocaleString("ko-KR")} GP) · 하루 최대 10,000 BM`;
        }
        const elBmGpBtn = document.getElementById("btnBmToGp");
        if (elBmGpBtn) {
          elBmGpBtn.onclick = async () => {
            let bmBal = 0;
            try {
              const us = await getDoc(doc(db, "users", uid));
              bmBal = us.exists() ? Math.floor(Number(us.data().pointBalanceVnd || 0)) : 0;
            } catch (_) {}
            if (bmBal < 10) { alert("BM 잔액이 부족합니다. (최소 10 BM)"); return; }
            const suggest = Math.min(bmBal, 1000);
            const input = prompt(`게임 GP로 충전할 BM을 입력하세요.\n보유 BM: ${bmBal.toLocaleString()} BM · 하루 최대 10,000 BM\n비율: BM × 100 ÷ Lv.${userLv}, 수수료 5%`, String(suggest));
            if (input === null) return;
            const amountBm = Math.floor(Number(String(input).replace(/[^0-9]/g, "")));
            if (!Number.isSafeInteger(amountBm) || amountBm < 10) { alert("10 BM 이상 정수로 입력해 주세요."); return; }
            if (amountBm > bmBal) { alert(`BM 잔액이 부족합니다. (보유 ${bmBal.toLocaleString()} BM)`); return; }
            const expectGp = Math.floor(Math.floor((amountBm * 100) / userLv) * 0.95);
            if (!confirm(`${amountBm.toLocaleString()} BM → 약 ${expectGp.toLocaleString()} GP (Lv.${userLv}, 수수료 5%)\n충전하시겠습니까?`)) return;
            const idempotencyKey = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2)}`).slice(0, 32);
            try {
              elBmGpBtn.disabled = true;
              elBmGpBtn.textContent = "충전 중...";
              const res = await httpsCallable(functions, "convertBmToGp")({ amountBm, idempotencyKey });
              const d = res.data || {};
              gpBal += Number(d.gp || 0);
              if (elGpDisp) elGpDisp.textContent = gpBal.toLocaleString("ko-KR") + " GP";
              showGpConvertable();
              alert(`✅ 충전 완료!\n사용 BM: ${Number(d.usedBm || 0).toLocaleString()} BM\n받은 GP: +${Number(d.gp || 0).toLocaleString()} GP\n오늘 남은 충전 한도: ${Number(d.leftTodayBm || 0).toLocaleString()} BM`);
            } catch (e) {
              alert("충전 실패: " + (e.message || "서버 오류"));
            } finally {
              elBmGpBtn.disabled = false;
              elBmGpBtn.textContent = "💳 BM으로 GP 충전";
            }
          };
        }

        if (elGpBtn) {
          elGpBtn.onclick = async () => {
            const convGp = gpBal - GP_KEEP_MIN;
            if (convGp < 10) {
              alert(`게임 참여를 위해 ${GP_KEEP_MIN.toLocaleString()} GP는 남겨 둡니다.\n보유 GP가 ${(GP_KEEP_MIN + 10).toLocaleString()} GP 이상일 때 전환할 수 있습니다. (현재 ${gpBal.toLocaleString()} GP)`);
              return;
            }
            const expectPoint = Math.floor((convGp * userLv) / 10);
            if (!confirm(`보유 ${gpBal.toLocaleString()} GP 중 ${GP_KEEP_MIN.toLocaleString()} GP는 게임용으로 남깁니다.
전환 GP ${convGp.toLocaleString()} × Lv.${userLv} ÷ 10 = ${expectPoint.toLocaleString()} P
GP를 Point로 전환하시겠습니까?`)) return;

            try {
              elGpBtn.disabled = true;
              elGpBtn.textContent = "전환 중...";
              // 서버에서만 처리 (게임 GP 차감 + 포인트 적립 + 기록)
              const res = await httpsCallable(functions, "convertGpToPoint")({});
              const d = res.data || {};
              const kept = Number.isFinite(Number(d.remainingGp)) ? Number(d.remainingGp) : Math.max(0, gpBal - Number(d.usedGp || 0));
              alert("성공적으로 " + Number(d.points || 0).toLocaleString() + " Point 로 전환되었습니다!\n전환 GP: -" + Number(d.usedGp || 0).toLocaleString() + " GP · 남은 게임용 GP: " + kept.toLocaleString() + " GP");
              gpBal = kept;
              if (elGpDisp) elGpDisp.textContent = gpBal.toLocaleString("ko-KR") + " GP";
              showGpConvertable();
              if (typeof loadGpRewardHistory === "function") {
                loadGpRewardHistory(uid).catch(() => {});
              }
            } catch (e) {
              console.error(e);
              alert("전환 중 오류가 발생했습니다: " + (e.message || ""));
            } finally {
              elGpBtn.disabled = false;
              elGpBtn.textContent = "전환하기 (최소 10 GP 이상)";
            }
          };
        }

        if (elPoint) {
          const btnHtml = `<button id="btnExchangePoint" class="btn btn--sm" style="margin-top:4px; padding:6px 12px; font-size:0.8rem; font-weight:700; background:linear-gradient(135deg, #7c3aed, #4f46e5); color:#fff; border:none; border-radius:8px; box-shadow:0 4px 10px rgba(124,58,237,0.3); outline:none; cursor:pointer;">💸 머니(Money)로 전환</button>` +
            `<button id="btnConvertPointToGp" class="btn btn--sm" style="margin-top:4px; margin-left:4px; padding:6px 12px; font-size:0.8rem; font-weight:700; background:linear-gradient(135deg, #059669, #0d9488); color:#fff; border:none; border-radius:8px; box-shadow:0 4px 10px rgba(5,150,105,0.3); outline:none; cursor:pointer;">🎮 게임GP로 전환</button>`;
          if (!elPoint.innerHTML.includes("btnExchangePoint")) {
            elPoint.innerHTML = `<span id="ptSpan" style="font-size:1.6rem;">${pBal.toLocaleString("ko-KR")} P</span>` + btnHtml;
          } else {
            const ptSpan = elPoint.querySelector("span");
            if (ptSpan) ptSpan.textContent = pBal.toLocaleString("ko-KR") + " P";
          }
        }
        if (elPay) {
          elPay.innerHTML = `<span>${kBal.toLocaleString("ko-KR")} BM</span>` +
            `<div style="font-size:0.8rem; color:#15803d; opacity:0.8; margin-top:2px;">(BEST CLUB MONEY)</div>`;
        }
      }, (err) => {
        console.error("onSnapshot error:", err);
      });

      // 포인트 전환 바인딩
      if (elPoint) {
        elPoint.innerHTML = `<span id="ptSpan" style="font-size:1.6rem;">${pointBal.toLocaleString("ko-KR")} P</span>` +
          `<button id="btnExchangePoint" class="btn btn--sm" style="margin-top:4px; padding:6px 12px; font-size:0.8rem; font-weight:700; background:linear-gradient(135deg, #7c3aed, #4f46e5); color:#fff; border:none; border-radius:8px; box-shadow:0 4px 10px rgba(124,58,237,0.3); outline:none; cursor:pointer;">💸 머니(Money)로 전환</button>` +
          `<button id="btnConvertPointToGp" class="btn btn--sm" style="margin-top:4px; margin-left:4px; padding:6px 12px; font-size:0.8rem; font-weight:700; background:linear-gradient(135deg, #059669, #0d9488); color:#fff; border:none; border-radius:8px; box-shadow:0 4px 10px rgba(5,150,105,0.3); outline:none; cursor:pointer;">🎮 게임GP로 전환</button>`;
        setTimeout(() => {
          const btnExc = document.getElementById("btnExchangePoint");
          if (btnExc) {
            btnExc.addEventListener("click", async () => {
              try {
                const userSnap2 = await getDoc(doc(db, "users", uid));
                const currentPoints = userSnap2.exists() ? Number(userSnap2.data().pointBalance || 0) : pointBal;
                const expectedKm = Math.floor(currentPoints / 10);

                if (currentPoints < 10) {
                  alert("최소 10 P 이상이어야 전환할 수 있습니다.");
                  return;
                }
                const ok = confirm(`보유 포인트: ${currentPoints.toLocaleString()} P
전환 후 BM 머니: +${expectedKm.toLocaleString()} BM

전환 공식: 포인트 ÷ 10
전환하시겠습니까?`);
                if (!ok) return;

                btnExc.disabled = true;
                btnExc.textContent = "처리 중...";
                // 서버에서만 처리 (화면 직접 쓰기 폴백 없음)
                const fn = httpsCallable(functions, "exchangePointsToFiat");
                const res = await fn({ amount: currentPoints });
                const resData = res.data;
                alert(`✅ 전환 완료!\n사용 포인트: ${resData.usedPoints.toLocaleString()} P\n추가된 BM 머니: +${resData.convertedVnd.toLocaleString()} BM`);
                await loadKCultureBalances(uid);
              } catch (err) {
                alert("전환 실패: " + (err.message || "서버 오류"));
                btnExc.disabled = false;
                btnExc.textContent = "💸 머니(Money)로 전환";
              }
            });
          }

          const btnP2Gp = document.getElementById("btnConvertPointToGp");
          if (btnP2Gp) {
            btnP2Gp.addEventListener("click", async () => {
              try {
                const userSnap2 = await getDoc(doc(db, "users", uid));
                const currentPoints = userSnap2.exists() ? Number(userSnap2.data().pointBalance || 0) : pointBal;
                if (currentPoints < 10) {
                  alert("최소 10 P 이상이어야 전환할 수 있습니다.");
                  return;
                }
                const bpS2 = await getDoc(doc(db, "battle_players", uid));
                const userLv = bpS2.exists() ? Math.max(1, Number(bpS2.data().gsLevel || 1)) : 1;
                const usePoints = Math.min(Math.floor(currentPoints), 10000);
                const rawGp = Math.floor((usePoints * 10) / userLv);
                const finalGp = Math.floor(rawGp * 0.95);
                const fee = rawGp - finalGp;
                const ok = confirm(`보유 포인트: ${currentPoints.toLocaleString()} P\n전환할 포인트: ${usePoints.toLocaleString()} P (하루 1회, 최대 10,000 P)\n게임 레벨: Lv.${userLv}\n전환 공식: 포인트 × 10 ÷ 레벨 = ${rawGp.toLocaleString()} GP\n수수료 5%: -${fee.toLocaleString()} GP\n최종 수령 GP: ${finalGp.toLocaleString()} GP\n\n게임GP로 전환하시겠습니까?`);
                if (!ok) return;

                btnP2Gp.disabled = true;
                btnP2Gp.textContent = "전환 중...";
                const fn = httpsCallable(functions, "convertPointToGp");
                const res = await fn({});
                const d = res.data || {};
                alert(`✅ 전환 완료!\n사용 포인트: ${Number(d.usedPoints || 0).toLocaleString()} P\n획득 GP: +${Number(d.gp || 0).toLocaleString()} GP`);
                await loadKCultureBalances(uid);
              } catch (err) {
                alert("전환 실패: " + (err.message || "서버 오류"));
              } finally {
                btnP2Gp.disabled = false;
                btnP2Gp.textContent = "🎮 게임GP로 전환";
              }
            });
          }
        }, 100);
      }

      if (elPay) {
        elPay.innerHTML = `<span>${payBal.toLocaleString("ko-KR")} BM</span>` +
          `<div style="font-size:0.8rem; color:#15803d; opacity:0.8; margin-top:2px;">(BEST CLUB MONEY)</div>`;
      }

      if (elBt) {
        elBt.innerHTML = `<span id="btSpan" style="font-size:1.6rem;">${btBal.toLocaleString("ko-KR")} BT</span>`;
      }

      // BT 사용하기 바인딩
      const btnUseBt = $("btnUseBt");
      if (btnUseBt) {
        btnUseBt.onclick = async () => {
          const userSnap3 = await getDoc(doc(db, "users", uid));
          let currentBt = userSnap3.exists() ? Number(userSnap3.data().btBalance || 0) : 0;
          if (currentBt <= 0) {
            alert("보유한 BT가 없습니다. 가맹점에서 결제하여 획득해보세요!");
            return;
          }
          const numInput = prompt(`몇 장을 사용하시겠습니까?\n(보유: ${currentBt} BT)`, "1");
          if (!numInput) return;
          const numToUse = Number(numInput);
          if (isNaN(numToUse) || numToUse <= 0 || numToUse > currentBt) {
            alert("유효한 수량을 입력하세요.");
            return;
          }

          btnUseBt.disabled = true;
          btnUseBt.textContent = "사용 중...";
          let overlay = null;
          try {
            // Show spinning animation overlay
            overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;";
            document.body.appendChild(overlay);

            const animBox = document.createElement("div");
            animBox.style.cssText = "background:#1e293b;border:2px solid #3b82f6;padding:30px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.5);text-align:center;min-width:280px;color:white;";
            const titleEl = document.createElement("div");
            titleEl.innerHTML = "<h3 style='margin:0 0 15px;color:#60a5fa;'>🎰 잭팟 굴리기...</h3>";
            animBox.appendChild(titleEl);

            const slotContainer = document.createElement("div");
            slotContainer.style.marginBottom = "15px";
            animBox.appendChild(slotContainer);
            overlay.appendChild(animBox);

            const slot = initSlot(slotContainer);

            let d;
            try {
              const api = httpsCallable(functions, "consumeUserBtFirebase");
              const res = await api({ btToUse: numToUse });
              d = res.data;
            } catch (fnErr) {
              // 보안: 화면 직접 쓰기 폴백(consumeBtClientFallback) 사용 중지 — BT 사용은 서버에서만 처리
              console.warn("consumeUserBtFirebase cloud function failed:", fnErr);
              throw fnErr;
            }

            const isWin = d.pointsEarned > 0 || d.isJackpot;

            slot.stop(d.randomValue || 13, isWin, () => {
              const remainingBt = (d && d.remainingBt !== undefined) ? d.remainingBt : Math.max(0, currentBt - numToUse);
              const btSpanEl = $("btSpan");
              if (btSpanEl) btSpanEl.textContent = `${remainingBt.toLocaleString("ko-KR")} BT`;
              const btDisplayEl = $("btDisplay");
              if (btDisplayEl && !btSpanEl) btDisplayEl.innerHTML = `<span id="btSpan" style="font-size:1.6rem;">${remainingBt.toLocaleString("ko-KR")} BT</span>`;

              setTimeout(async () => {
                if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                showJackpotResult(d);
                try { loadJackpotHistory(uid); } catch (_) {}
                await loadKCultureBalances(uid);
              }, 1500);
            });
          } catch (e) {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            alert("사용 실패: " + (e.message || "서버 오류가 발생했습니다."));
          } finally {
            btnUseBt.disabled = false;
            btnUseBt.textContent = "사용하기 (잭팟 굴리기)";
          }
        };
      }

    } else {
      if ($("pointDisplay")) $("pointDisplay").textContent = "0 P";
      if ($("paymentBalanceDisplay")) $("paymentBalanceDisplay").textContent = "0 BM";
      if ($("btDisplay")) $("btDisplay").textContent = "0 BT";
    }
  } catch (err) {
    console.error("Failed to load K-CULTURE balances:", err);
  }
}

async function loadDepositHistory(uid) {
  const wrap = $("depositHistory");
  if (!wrap) return;

  try {
    const q = query(
      collection(db, "deposits"),
      where("uid", "==", uid),
      orderBy("requestedAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      wrap.innerHTML = `<p class="hint">${_t('deposit_empty')}</p>`;
      return;
    }

    const statusLabel = {
      pending: { text: _t('status_pending'), color: "#f59e0b" },
      processing: { text: _t('status_processing'), color: "#3b82f6" },
      approved: { text: _t('status_approved'), color: "#10b981" },
      rejected: { text: _t('status_rejected'), color: "#ef4444" },
    };

    const rows = snap.docs.map((d) => {
      const data = d.data();
      const dateStr = data.requestedAt?.toDate
        ? data.requestedAt.toDate().toLocaleString("ko")
        : "-";

      const amountParts = [];
      if (data.amountVnd) amountParts.push((data.amountVnd || 0).toLocaleString() + " VND");
      if (data.vndAmount) amountParts.push(Number(data.vndAmount).toLocaleString() + " VND");
      if (!amountParts.length) amountParts.push("-");
      const amountStr = amountParts.join(" / ");

      const st = statusLabel[data.status] || { text: data.status, color: "#6b7280" };
      const depositorStr = data.depositorName ? ` · ${data.depositorName}` : "";

      return `
        <div class="mp-hist-row" style="border-left:3px solid ${st.color}; padding-left:10px; margin-bottom:10px;">
          <div class="mp-hist-main" style="display:flex; justify-content:space-between; align-items:center;">
            <span class="mp-hist-code" style="font-size:0.78em; color:var(--muted);">${data.refCode || "-"}${depositorStr}</span>
            <span style="font-weight:700; color:${st.color}; font-size:0.88em;">${st.text}</span>
          </div>
          <div class="mp-hist-detail" style="display:flex; justify-content:space-between; margin-top:4px;">
            <span style="font-weight:600; color:var(--accent);">${amountStr}</span>
            <span style="font-size:0.78em; color:var(--muted);">${dateStr}</span>
          </div>
          ${data.txHash ? `<div style="font-size:0.72em; color:var(--muted); margin-top:2px;" class="mono">TX: ${data.txHash.slice(0, 20)}...</div>` : ""}
          ${data.status === "rejected" && data.rejectReason ? `<div style="font-size:0.8em; color:#ef4444; margin-top:4px;">${_t('reject_reason')} ${data.rejectReason}</div>` : ""}
        </div>
      `;
    }).join("");

    wrap.innerHTML = rows;
  } catch (err) {
    wrap.innerHTML = `<p class="hint muted">${_t('deposit_hist_error')}</p>`;
    console.warn("depositHistory failed", err.message);
  }
}

function calcLevelFromExp(exp) {
  let lv = 1;
  while (lv < 99 && exp >= Math.pow(lv + 1, 2) * 10000) lv++;
  return lv;
}

async function reconcileMentorExp(uid, mentees) {
  if (!uid || !Array.isArray(mentees) || mentees.length === 0) return false;
  try {
    const userRef = doc(db, "users", uid);
    const bpRef = doc(db, "battle_players", uid);
    let grantedAny = false;

    await runTransaction(db, async (tx) => {
      const [uSnap, bpSnap] = await Promise.all([tx.get(userRef), tx.get(bpRef)]);
      const uData = uSnap.exists() ? (uSnap.data() || {}) : {};
      const bpData = bpSnap.exists() ? (bpSnap.data() || {}) : {};

      const creditedArr = Array.isArray(uData.creditedMenteeUids) ? uData.creditedMenteeUids : [];
      const creditedSet = new Set(creditedArr);

      const newlyCredited = [];
      for (const m of mentees) {
        const mUid = m?.uid;
        if (!mUid || mUid === uid) continue;
        if (creditedSet.has(mUid) || m.mentorExpGranted === true) continue;
        creditedSet.add(mUid);
        newlyCredited.push(mUid);
      }

      if (newlyCredited.length === 0) return;

      const bonusExp = newlyCredited.length * 1000;
      const prevExp = Math.max(Number(bpData.gsExp || 0), Number(uData.gsExp || 0), Number(uData.exp || 0));
      const prevLevel = Math.max(1, Number(bpData.gsLevel || 1), Number(uData.gsLevel || 1), Number(uData.level || 1), Number(bpData.level || 1));
      const newExp = prevExp + bonusExp;
      const newLevel = Math.max(prevLevel, calcLevelFromExp(newExp));
      const updatedCredited = Array.from(creditedSet);

      tx.set(bpRef, {
        gsExp: newExp,
        gsLevel: newLevel,
        level: newLevel,
      }, { merge: true });

      tx.set(userRef, {
        gsExp: newExp,
        gsLevel: newLevel,
        exp: newExp,
        creditedMenteeUids: updatedCredited,
      }, { merge: true });

      grantedAny = true;
    });

    return grantedAny;
  } catch (err) {
    console.warn("reconcileMentorExp error:", err.message);
    return false;
  }
}

async function loadMentees() {
  const section = $("menteeSection");
  const wrap = $("menteeList");
  if (!section || !wrap) return;

  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";
  const myEmail = (currentUser?.email || "").trim().toLowerCase();

  try {
    const menteeMap = {};

    // 1. Cloud Function 조회
    try {
      const fn = httpsCallable(functions, "getMyMentees");
      const res = await fn();
      const cfMentees = res.data?.mentees || [];
      cfMentees.forEach((m) => {
        if (m && m.uid && m.uid !== uid) {
          menteeMap[m.uid] = m;
        }
      });
    } catch (cfErr) {
      console.warn("getMyMentees callable fallback:", cfErr.message);
    }

    // 2. Firestore 직접 조회 보완 (mentorAddressInput / mentorEmail / mentorUid)
    if (uid) {
      const queries = [
        query(collection(db, "users"), where("mentorUid", "==", uid), limit(100))
      ];
      if (myEmail) {
        queries.push(query(collection(db, "users"), where("mentorAddressInput", "==", myEmail), limit(100)));
        queries.push(query(collection(db, "users"), where("mentorEmail", "==", myEmail), limit(100)));
      }
      const snaps = await Promise.allSettled(queries.map((q) => getDocs(q)));
      snaps.forEach((r) => {
        if (r.status !== "fulfilled") return;
        r.value.forEach((d) => {
          if (d.id === uid) return;
          const u = d.data() || {};
          const existing = menteeMap[d.id] || {};
          const regMs = u.registeredAt?.toMillis?.() || u.createdAt?.toMillis?.() || existing.registeredAt || Date.now();
          menteeMap[d.id] = {
            uid: d.id,
            name: existing.name || u.displayName || u.name || (u.email ? u.email.split("@")[0] : "익명"),
            walletAddress: existing.walletAddress || existing.address || u.wallet?.address || "",
            address: existing.address || existing.walletAddress || u.wallet?.address || "",
            registeredAt: regMs,
            generatedForMentor: existing.generatedForMentor ?? 0,
            mentorExpGranted: Boolean(existing.mentorExpGranted || u.mentorExpGranted),
          };
        });
      });
    }

    const mentees = Object.values(menteeMap).sort((a, b) => (b.generatedForMentor || 0) - (a.generatedForMentor || 0));

    // 3. 미지급 멘토 추천 경험치(+1,000 EXP/명) 즉시 정산 및 EXP/레벨 UI 갱신
    if (uid && mentees.length > 0) {
      await reconcileMentorExp(uid, mentees);
      await loadExpAndLevel(uid);
    }

    show("menteeSection", true);

    if (!mentees || mentees.length === 0) {
      wrap.innerHTML = `<p class="hint">${_t('mentee_empty')}</p>`;
      return;
    }

    const rows = mentees.map(m => {
      const rawAddr = m.walletAddress || m.address || "";
      const addr = rawAddr ? rawAddr.substring(0, 6) + "..." + rawAddr.slice(-4) : "지갑 미생성";
      const dateStr = m.registeredAt ? new Date(m.registeredAt).toLocaleDateString() : "";
      const earned = m.generatedForMentor || 0;
      return `
      <div class="fx-row align-center justify-between" style="border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:8px;">
        <div class="fx-col gap-1">
          <span style="font-weight:600;">${m.name}</span>
          <span class="mono muted" style="font-size:0.82em;">${addr} | ${dateStr}</span>
        </div>
        <div class="text-right">
          <span style="font-weight:600; color:var(--primary-color);">+${earned.toLocaleString()} P</span>
          <div style="font-size:0.75rem; color:#10b981; font-weight:600;">+1,000 EXP 적립</div>
        </div>
      </div>`;
    }).join("");


    wrap.innerHTML = `<p class="hint muted" style="margin-bottom:8px;">${_t('mentee_count', mentees.length)}</p>` + rows;
  } catch (err) {
    show("menteeSection", true);
    wrap.innerHTML = `<p class="hint muted">${_t('mentee_error')}</p>`;
    console.warn("getMyMentees failed", err.message);
  }
}

const TX_CONFIG = {
  buy: { labelKey: 'tx_buy', dir: "income", icon: "💰" },
  credit: { labelKey: 'tx_credit', dir: "income", icon: "⭐" },
  p2p: { labelKey: 'tx_p2p', dir: "income", icon: "📥" },
  p2p_merge: { labelKey: 'tx_p2p_merge', dir: "income", icon: "📥" },
  withdraw: { labelKey: 'tx_withdraw', dir: "expense", icon: "📤" },
  pay_merchant: { labelKey: 'tx_pay_merchant', dir: "expense", icon: "🛒" },
  merchant_income: { labelKey: 'tx_merchant_income', dir: "income", icon: "🏪" },
  BM_TO_GP: { label: "BM → 게임 GP 충전", dir: "expense", icon: "🎮" },
};

function txAmountHex(tx) {
  if (tx.amountVnd != null && Number(tx.amountVnd) > 0) return Number(tx.amountVnd);
  if (tx.amountKrw != null && Number(tx.amountKrw) > 0) return Number(tx.amountKrw);
  if (tx.amountHex) return Number(tx.amountHex);
  // merchant_income 은 순수익(netAmountWei) 우선 표시
  if (tx.netAmountWei) return Number(formatWei(tx.netAmountWei));
  if (tx.amountWei) return Number(formatWei(tx.amountWei));
  if (tx.priceWei) return Number(formatWei(tx.priceWei));
  return 0;
}

function renderTxItem({ label, icon, dir, amountHex, dateStr, txHash, statusBadge, unit }) {
  const amtSign = dir === "income" ? "+" : dir === "expense" ? "−" : "";
  const amtClass = dir === "income" ? "income" : dir === "expense" ? "expense" : dir;
  const curr = unit || "Point";
  const amtText = amountHex > 0
    ? `${amtSign}${amountHex.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} ${curr}`
    : "-";
  const hashHtml = txHash
    ? `<div class="tx-hash">${txHash.slice(0, 10)}...${txHash.slice(-6)}</div>`
    : "";
  const badgeHtml = statusBadge
    ? `<span class="tx-status-badge ${statusBadge.cls}">${statusBadge.text}</span>`
    : "";
  return `
    <div class="tx-item">
      <div class="tx-icon ${amtClass}">${icon}</div>
      <div class="tx-body">
        <div class="tx-label">${label}</div>
        <div class="tx-date">${dateStr}</div>
        ${hashHtml}
      </div>
      <div class="tx-right">
        <div class="tx-amount ${amtClass}">${amtText}</div>
        ${badgeHtml}
      </div>
    </div>`;
}

// ── 멘티 수익 분석 ─────────────────────────────────────────────────────────
const JACKPOT_CONTRACT = "0x4d83A7764428fd1c116062aBb60c329E0E29f490";
const OPBNB_RPC = "https://opbnb-mainnet-rpc.bnbchain.org";

async function fetchMemberPoints(address) {
  try {
    // members(address) public mapping getter
    // selector = keccak256('members(address)')[0:4]
    // 미리 계산: 0x08ae4b0c
    const padded = "0x" + address.slice(2).toLowerCase().padStart(64, "0");
    const res = await fetch(OPBNB_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: JACKPOT_CONTRACT, data: "0x08ae4b0c" + padded.slice(2) }, "latest"],
      }),
    });
    const json = await res.json();
    if (!json.result || json.result === "0x") return 0n;
    // members struct: level(uint32) mentor(address) exp(uint256) points(uint256) blocked(bool)
    // ABI-encoded: [0]level 32B [1]mentor 32B [2]exp 32B [3]points 32B [4]blocked 32B
    const data = json.result.slice(2);
    const pointsHex = data.slice(3 * 64, 4 * 64);
    return BigInt("0x" + pointsHex);
  } catch { return 0n; }
}

async function loadMenteeIncome(_uid) {
  const section = $("menteeIncomeSection");
  const summaryEl = $("menteeIncomeSummary");
  const listEl = $("menteeIncomeList");
  if (!listEl) return;

  listEl.innerHTML = `<p class="hint">${_t('mi_loading')}</p>`;
  if (summaryEl) summaryEl.innerHTML = "";

  try {
    // Cloud Function으로 멘티 수익 집계 (Admin SDK → Firestore 권한 제한 없음)
    const fn = httpsCallable(functions, "getMenteeIncome");
    const res = await fn();
    const { mentees, myAddress } = res.data;

    if (!mentees || mentees.length === 0) {
      listEl.innerHTML = `<div class="mi-empty">${_t('mi_empty')}</div>`;
      if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
      return;
    }

    // 내 서비스 포인트 잔액
    let myPointsWei = 0n;
    if (myAddress) myPointsWei = await fetchMemberPoints(myAddress);
    const myPointsHex = Number(myPointsWei) / 1e18;

    // menteeMap 형태로 변환 (렌더링용)
    const menteeMap = {};
    mentees.forEach((m) => { menteeMap[m.uid] = m; });

    // 5. 요약 카드
    const totalMentees = mentees.length;
    const totalEarning = Object.values(menteeMap).reduce((s, m) => s + m.myEstimatedEarningHex, 0);
    const totalTxCount = Object.values(menteeMap).reduce((s, m) => s + m.txCount, 0);

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="mi-summary-card">
          <div class="mi-summary-label">${_t('mi_mentee_count')}</div>
          <div class="mi-summary-val">${totalMentees}${_t('mi_mentees_label')}</div>
        </div>
        <div class="mi-summary-card">
          <div class="mi-summary-label">${_t('mi_tx_count')}</div>
          <div class="mi-summary-val">${totalTxCount}${_t('mi_payments_label')}</div>
        </div>
        <div class="mi-summary-card" style="background:linear-gradient(135deg,#faf5ff,#f3e8ff);border-color:#d8b4fe;">
          <div class="mi-summary-label">${_t('mi_total_earning')}</div>
          <div class="mi-summary-val" style="color:#7c3aed;">${totalEarning.toFixed(4)} Point</div>
          <div class="mi-summary-sub">${_t('mi_fee_note')}</div>
        </div>
        <div class="mi-summary-card" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-color:#93c5fd;">
          <div class="mi-summary-label">${_t('mi_points_balance')}</div>
          <div class="mi-summary-val" style="color:#1d4ed8;">${myPointsHex.toFixed(6)} Point</div>
          <div class="mi-summary-sub">${_t('mi_onchain_realtime')}</div>
        </div>
      `;
    }

    // 6. 멘티별 카드 렌더링 (수익 높은 순 정렬)
    const sortedMentees = Object.values(menteeMap).sort(
      (a, b) => b.myEstimatedEarningHex - a.myEstimatedEarningHex
    );

    const frag = document.createDocumentFragment();
    sortedMentees.forEach((m) => {
      const addrShort = m.address
        ? m.address.slice(0, 6) + "..." + m.address.slice(-4)
        : "-";
      const regDate = m.registeredAt
        ? new Date(m.registeredAt).toLocaleDateString("ko-KR")
        : "-";

      const recentRows = (m.recentTxs || []).map((t) => {
        const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString("ko-KR") : "-";
        const earning = t.myEst ?? t.myEarning ?? 0;
        return `
          <div class="mi-tx-row">
            <span>${dateStr}</span>
            <span class="mi-tx-amt">${_t('mi_tx_row', (t.amountHex || 0).toFixed(4), earning > 0 ? earning.toFixed(6) : "?")}</span>
          </div>`;
      }).join("") || `<div class="mi-tx-row"><span>${_t('mi_tx_no_data')}</span></div>`;

      const card = document.createElement("div");
      card.className = "mi-mentee-card";
      card.innerHTML = `
        <div class="mi-mentee-head">
          <div>
            <div class="mi-mentee-name">${m.name}</div>
            <div class="mi-mentee-addr">${addrShort} · ${_t('mi_join_short', regDate)}</div>
          </div>
          <div class="mi-mentee-total">
            <div class="mi-mentee-total-val">${m.myEstimatedEarningHex > 0 ? m.myEstimatedEarningHex.toFixed(6) + " Point" : "-"}</div>
            <div class="mi-mentee-total-label">${_t('mi_cumulative_earn')}</div>
          </div>
        </div>
        <div class="mi-stat-row">
          <div class="mi-stat">
            <div class="mi-stat-val">${m.txCount}${_t('mi_payments_label')}</div>
            <div class="mi-stat-label">${_t('mi_stat_tx_count')}</div>
          </div>
          <div class="mi-stat">
            <div class="mi-stat-val">${(m.totalAmountHex || 0).toFixed(4)}</div>
            <div class="mi-stat-label">${_t('mi_stat_total_hex')}</div>
          </div>
          <div class="mi-stat">
            <div class="mi-stat-val">${m.myEstimatedEarningHex > 0 ? m.myEstimatedEarningHex.toFixed(6) : "-"}</div>
            <div class="mi-stat-label">${_t('mi_stat_mentor_earn')}</div>
          </div>
        </div>
        ${m.recentTxs.length > 0 ? `
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;">
            <div style="font-size:0.72rem;color:#94a3b8;font-weight:700;margin-bottom:4px;">${_t('mi_recent_tx')}</div>
            ${recentRows}
          </div>
        ` : ""}
      `;
      frag.appendChild(card);
    });

    listEl.innerHTML = "";
    listEl.appendChild(frag);
    if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }

  } catch (err) {
    listEl.innerHTML = `<div class="mi-empty">${_t('mi_error', esc(err.message))}</div>`;
    if (section) { section.style.display = ""; section.classList.remove('is-collapsed'); }
    console.warn("loadMenteeIncome failed:", err);
  }
}

async function loadCoopOrders(uid) {
  const section = $('coopOrderSection');
  const listEl = $('coopOrderList');
  if (!listEl) return;

  try {
    const q = query(
      collection(db, 'coopOrders'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    show('coopOrderSection', true);

    const TYPE_LABEL = { membership: '정회원', voucher: '바우처', general: '일반' };
    const rows = snap.docs.map((d) => {
      const o = d.data();
      const hexAmt = (Number(BigInt(o.hexWei || '0')) / 1e18).toFixed(4);
      const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('ko-KR') : '-';
      const typeLbl = TYPE_LABEL[o.type] || o.type || '일반';
      const txLink = o.txHash
        ? `<a href="https://opbnb.bscscan.com/tx/${o.txHash}" target="_blank" rel="noopener" style="font-size:0.72em;color:var(--accent);">TX ↗</a>`
        : '';
      return `<tr>
        <td style="font-size:0.82em;">${date}</td>
        <td>${o.productName || '-'} <span style="font-size:0.7em;background:#f3e8ff;color:#7c3aed;padding:1px 5px;border-radius:8px;font-weight:600;">${typeLbl}</span></td>
        <td style="text-align:right;font-weight:600;color:#dc2626;">${hexAmt} Point</td>
        <td style="text-align:center;">${txLink}</td>
      </tr>`;
    }).join('');

    listEl.innerHTML = `<table class="mp-table" style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-size:0.78em;color:#94a3b8;">
        <th style="text-align:left;padding:4px 6px;">날짜</th>
        <th style="text-align:left;padding:4px 6px;">상품</th>
        <th style="text-align:right;padding:4px 6px;">금액</th>
        <th style="text-align:center;padding:4px 6px;">TX</th>
      </tr></thead>
      <tbody style="font-size:0.88em;">${rows}</tbody>
    </table>`;
  } catch (_) {
    if (listEl) listEl.innerHTML = '<p class="hint muted">구매 내역을 불러올 수 없습니다.</p>';
  }
}

async function loadJackpotHistory(uid) {
  const wrap = $("jackpotHistList");
  const section = $("jackpotHistSection");
  if (!wrap) return;

  if (section) {
    section.style.display = "";
    section.classList.remove("is-collapsed");
  }
  wrap.innerHTML = `<p class="hint">잭팟 포인트(P) 당첨 내역을 불러오는 중...</p>`;

  let docs = [];
  let userPointBalance = 0;

  try {
    const uSnap = await getDoc(doc(db, "users", uid));
    if (uSnap.exists()) {
      userPointBalance = Number(uSnap.data()?.pointBalance || 0);
    }
  } catch (_) {}

  try {
    const q = query(
      collection(db, "jackpot_wins"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);
    docs = snap.docs;
  } catch (_) {
    try {
      const qFallback = query(
        collection(db, "jackpot_wins"),
        where("uid", "==", uid),
        limit(50)
      );
      const snapFallback = await getDocs(qFallback);
      docs = snapFallback.docs.slice().sort((a, b) => {
        const ta = a.data().createdAt?.seconds || a.data().timestamp?.seconds || 0;
        const tb = b.data().createdAt?.seconds || b.data().timestamp?.seconds || 0;
        return tb - ta;
      });
    } catch (e2) {
      wrap.innerHTML = `<div class="jp-hist-empty">잭팟 내역을 불러오지 못했습니다: ${esc(e2.message || String(e2))}</div>`;
      return;
    }
  }

  let totalPointsP = 0;
  let totalBtUsed = 0;
  let bestWinP = 0;

  docs.forEach((d) => {
    const v = d.data() || {};
    let pts = Number(v.pointsEarned ?? v.amountVnd ?? v.amountKrw ?? 0);
    if (!pts && v.onchainJackpotPointsWei) {
      try {
        pts = Math.round(Number(BigInt(v.onchainJackpotPointsWei)) / 1e18);
      } catch (_) {}
    }
    if (Number.isFinite(pts) && pts > 0) {
      totalPointsP += pts;
      if (pts > bestWinP) bestWinP = pts;
    }
    totalBtUsed += Math.max(1, Number(v.btUsed || 1));
  });

  const statRow = $("jackpotStatRow");
  const totalHexEl = $("jackpotTotalHex");
  const totalCountEl = $("jackpotTotalCount");
  const totalBtEl = $("jackpotTotalBtUsed");
  const bestWinEl = $("jackpotBestWinSub");
  const redeemableEl = $("jackpotRedeemable");

  if (statRow) statRow.style.display = "grid";
  if (totalHexEl) totalHexEl.textContent = `${totalPointsP.toLocaleString()} P`;
  if (totalCountEl) totalCountEl.textContent = `총 ${docs.length}회 당첨`;
  if (totalBtEl) totalBtEl.textContent = `${totalBtUsed.toLocaleString()} BT`;
  if (bestWinEl) bestWinEl.textContent = `최고 단일 당첨: ${bestWinP.toLocaleString()} P`;
  if (redeemableEl) {
    const displayBal = userPointBalance > 0 ? userPointBalance : (_pointHexAmount > 0 ? Math.round(_pointHexAmount) : 0);
    redeemableEl.textContent = `${displayBal.toLocaleString()} P`;
  }

  if (docs.length === 0) {
    wrap.innerHTML = `
      <div class="jp-hist-empty" style="padding:20px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px;border:1px dashed #cbd5e1;">
        🎰 아직 보너스 티켓(BT) 잭팟 당첨 내역이 없습니다.<br/>
        <small>가맹점 결제 또는 이벤트로 받은 BT를 사용해 잭팟 포인트(P)를 뽑아보세요!</small>
      </div>`;
    return;
  }

  const rowsHtml = docs.map((d) => {
    const v = d.data() || {};
    const rawTs = v.createdAt || v.timestamp;
    const ts = rawTs?.toDate ? rawTs.toDate() : (rawTs ? new Date(rawTs) : null);
    const dateStr = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString("ko-KR") : "-";

    let pts = Number(v.pointsEarned ?? v.amountVnd ?? v.amountKrw ?? 0);
    if (!pts && v.onchainJackpotPointsWei) {
      try {
        pts = Math.round(Number(BigInt(v.onchainJackpotPointsWei)) / 1e18);
      } catch (_) {}
    }
    const btUsed = Math.max(1, Number(v.btUsed || 1));
    const grade = v.grade ? `${v.grade}등급` : "";
    const merchantName = v.merchantName || "베스트클럽 가맹점";

    const items = [];
    if ((v.potionCount || 0) > 0) items.push(`🧪 HP물약 +${v.potionCount}`);
    if ((v.mpPotionCount || 0) > 0) items.push(`💧 MP물약 +${v.mpPotionCount}`);
    if ((v.reviveAdded || 0) > 0) items.push(`🪶 부활권 +${v.reviveAdded}`);

    return `
      <div class="jp-hist-item" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #f1f5f9;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="jp-hist-icon" style="font-size:1.4rem;">🎰</div>
          <div>
            <div style="font-weight:800;color:#1e293b;font-size:0.94rem;">
              🏪 ${esc(merchantName)} 잭팟 당첨
              ${grade ? `<span style="font-size:0.75rem;background:#fef3c7;color:#b45309;padding:2px 7px;border-radius:99px;margin-left:4px;">🎲 추첨 #${esc(v.grade)}</span>` : ""}
            </div>
            <div style="font-size:0.8rem;color:#64748b;margin-top:2px;">
              🎫 티켓 ${btUsed} BT 사용 ${items.length ? ` · ${items.join(" · ")}` : ""}
            </div>
            <div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;">${esc(dateStr)}</div>
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap;">
          <div style="font-size:1.08rem;font-weight:900;color:#d97706;">+${pts.toLocaleString()} P</div>
          <div style="font-size:0.73rem;color:#059669;font-weight:700;">포인트 적립 완료</div>
        </div>
      </div>
    `;
  }).join("");

  wrap.innerHTML = `<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;">${rowsHtml}</div>`;
}

// ── 🏆 게임 주간랭킹 상금 & 일일 게임 플레이 GP 획득 내역 ──────────────────────────
let _gpFilterTab = "all";
let _cachedGpRecords = [];
let _cachedThisWeekEntries = [];

function getVnCurrentWeekId() {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const vn = Date.now() + VN_OFFSET_MS;
  const dayStart = Math.floor(vn / DAY_MS) * DAY_MS;
  const dow = new Date(dayStart).getUTCDay(); // 0 = 일요일
  const startVn = dayStart - dow * DAY_MS;
  return new Date(startVn).toISOString().slice(0, 10);
}

async function loadGpRewardHistory(uid) {
  const section = $("gpRewardHistSection");
  const listEl = $("gpRewardHistList");
  if (!section || !listEl || !uid) return;

  section.style.display = "";
  section.classList.remove("is-collapsed");
  listEl.innerHTML = `<p class="hint">게임 주간랭킹 및 일일 플레이 GP 내역을 불러오는 중...</p>`;

  const GAME_LABELS = {
    suika: "🍉 수박게임",
    game2048: "🔢 2048",
    billiards: "🎱 베스트당구장",
    memory: "🃏 기억력 게임",
    bow: "🏹 활쏘기",
    race: "🐎 몬스터레이스",
    relay: "🏃 이어달리기",
    dungeon: "⚔️ 던전 탐험",
    conquest: "🏰 몬스터수성",
  };

  let bpData = {};
  let weeklyPayouts = [];
  let thisWeekEntries = [];

  // 1. battle_players/{uid} 조회 (보유 GP 및 일일 게임별 획득 GP, 보너스 이력)
  try {
    const bpSnap = await getDoc(doc(db, "battle_players", uid));
    if (bpSnap.exists()) bpData = bpSnap.data() || {};
  } catch (_) {}

  // 2. weekly_ranking_payouts 조회 (주간랭킹 TOP 10 상금 수령 내역)
  try {
    const qPayout = query(
      collection(db, "weekly_ranking_payouts"),
      where("uid", "==", uid),
      limit(50)
    );
    const pSnap = await getDocs(qPayout);
    pSnap.forEach((d) => weeklyPayouts.push({ id: d.id, ...d.data() }));
  } catch (_) {}

  // 3. 이번 주 내 주간랭킹 참가 최고점 조회 (수박게임, 2048, 베스트당구장)
  const currentWeekId = getVnCurrentWeekId();
  for (const gKey of ["suika", "game2048", "billiards"]) {
    try {
      const entryRef = doc(db, "weekly_rankings", `${gKey}_${currentWeekId}`, "entries", uid);
      const eSnap = await getDoc(entryRef);
      if (eSnap.exists()) {
        const ed = eSnap.data() || {};
        thisWeekEntries.push({
          gameType: gKey,
          gameLabel: GAME_LABELS[gKey] || gKey,
          weekId: currentWeekId,
          bestScore: Number(ed.bestScore || 0),
          plays: Number(ed.plays || 0),
          achievedAt: ed.achievedAt || null,
        });
      }
    } catch (_) {}
  }
  _cachedThisWeekEntries = thisWeekEntries;

  // 통합 내역 구성
  const records = [];
  let weeklyPrizeSum = 0;
  let playEarnSum = 0;

  // (A) 주간랭킹 상금 내역
  weeklyPayouts.forEach((p) => {
    const gp = Number(p.prizeGp || 0);
    if (gp > 0) weeklyPrizeSum += gp;
    const tsMs = p.createdAt?.toMillis?.() || (p.createdAt?.seconds ? p.createdAt.seconds * 1000 : Date.parse(p.weekId || "") || 0);
    records.push({
      category: "weekly_rank",
      icon: "🏅",
      title: `[주간랭킹 ${p.rank || "-"}위 상금] ${GAME_LABELS[p.gameType] || p.gameType || "게임"}`,
      sub: `${p.weekId || ""} 주간 정산 · 최고점수 ${Number(p.bestScore || 0).toLocaleString()}점 달성`,
      dateStr: p.weekId ? `${p.weekId} 주간 결산` : "-",
      sortMs: tsMs,
      gp,
      badge: `TOP ${p.rank || "-"}위`,
      badgeColor: "#1d4ed8",
      badgeBg: "#dbeafe",
    });
  });

  // (B) battle_players 내 일일 게임 플레이 획득 (gameEarn_{type}_{YYYY-MM-DD}) & 출석/가입 보너스
  for (const [key, val] of Object.entries(bpData)) {
    const earnMatch = key.match(/^gameEarn_([a-z0-9]+)_(\d{4}-\d{2}-\d{2})$/i);
    if (earnMatch) {
      const gp = Number(val || 0);
      if (Number.isFinite(gp) && gp > 0) {
        playEarnSum += gp;
        const gType = earnMatch[1];
        const dateYmd = earnMatch[2];
        records.push({
          category: "daily_play",
          icon: "🎮",
          title: `${GAME_LABELS[gType] || gType} 플레이 승리 보상`,
          sub: `${dateYmd} 일일 게임 플레이 누적 획득`,
          dateStr: dateYmd,
          sortMs: Date.parse(`${dateYmd}T12:00:00Z`) || 0,
          gp,
          badge: "게임보상",
          badgeColor: "#047857",
          badgeBg: "#d1fae5",
        });
      }
      continue;
    }

    const topupMatch = key.match(/^dailyTopup_(\d{4}-\d{2}-\d{2})$/);
    if (topupMatch && val === true) {
      const gp = 3500;
      playEarnSum += gp;
      const dateYmd = topupMatch[1];
      records.push({
        category: "daily_play",
        icon: "⚡",
        title: "정회원 일일 GP 자동 충전",
        sub: `${dateYmd} 정회원 데일리 보너스`,
        dateStr: dateYmd,
        sortMs: Date.parse(`${dateYmd}T09:00:00Z`) || 0,
        gp,
        badge: "일일충전",
        badgeColor: "#6d28d9",
        badgeBg: "#ede9fe",
      });
    }
  }

  for (const field of ["joinBonusAt", "referralBonusAt"]) {
    if (!bpData[field]) continue;
    const raw = bpData[field];
    const ms = raw?.toMillis?.() || (raw?.seconds ? raw.seconds * 1000 : Number(raw) || 0);
    const dateYmd = ms ? new Date(ms).toISOString().slice(0, 10) : "-";
    const gp = 1000;
    playEarnSum += gp;
    records.push({
      category: "daily_play",
      icon: "🎁",
      title: field === "joinBonusAt" ? "신규 가입 축하 GP 보너스" : "친구 추천 GP 보너스",
      sub: "베스트클럽 아케이드 웰컴 보너스",
      dateStr: dateYmd,
      sortMs: ms,
      gp,
      badge: "보너스",
      badgeColor: "#b45309",
      badgeBg: "#fef3c7",
    });
  }

  // (C) GP → Point 전환 내역 (transactions where uid == uid && type == GP_TO_POINT)
  try {
    const qConv = query(
      collection(db, "transactions"),
      where("uid", "==", uid),
      where("type", "==", "GP_TO_POINT"),
      limit(50)
    );
    const cSnap = await getDocs(qConv);
    cSnap.forEach((d) => {
      const tx = d.data() || {};
      const used = Number(tx.gpUsed || 0);
      const gained = Number(tx.pointGained || 0);
      if (used <= 0) return;
      const ms = tx.createdAt?.toMillis?.() || (tx.createdAt?.seconds ? tx.createdAt.seconds * 1000 : 0);
      const dt = ms
        ? new Date(ms).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "-";
      const afterText = Number.isFinite(Number(tx.gpAfter)) ? ` · 전환 후 잔여 ${Number(tx.gpAfter).toLocaleString()} GP` : "";
      records.push({
        category: "daily_play",
        icon: "🔄",
        title: `GP → Point 전환 (+${gained.toLocaleString()} P)`,
        sub: `Lv.${tx.level || 1} 기준 ${used.toLocaleString()} GP 전환${afterText}`,
        dateStr: dt,
        sortMs: ms,
        gp: -used,
        gpSubLabel: `+${gained.toLocaleString()} P 적립`,
        badge: "P 전환",
        badgeColor: "#9333ea",
        badgeBg: "#f3e8ff",
      });
    });
  } catch (_) {}

  // (D) 매일 무료 럭키 룰렛 당첨 내역 (daily_roulette_spins)
  try {
    const qRl = query(
      collection(db, "daily_roulette_spins"),
      where("uid", "==", uid),
      limit(30)
    );
    const rlSnap = await getDocs(qRl);
    rlSnap.forEach((d) => {
      const r = d.data() || {};
      const gp = Number(r.totalPrize || r.prize || 0);
      if (gp <= 0) return;
      playEarnSum += gp;
      const ms = r.createdAt?.toMillis?.() || (r.createdAt?.seconds ? r.createdAt.seconds * 1000 : Date.parse(r.date || "") || 0);
      records.push({
        category: "daily_play",
        icon: "🎰",
        title: `매일 무료 럭키 룰렛 (${r.streak || 1}일차)`,
        sub: r.streakBonus ? `룰렛 ${Number(r.prize || 0).toLocaleString()} GP + 7일 개근 +${Number(r.streakBonus).toLocaleString()} GP` : `${r.date || ""} 출석 룰렛 당첨`,
        dateStr: r.date || "-",
        sortMs: ms,
        gp,
        badge: "럭키룰렛",
        badgeColor: "#c2410c",
        badgeBg: "#ffedd5",
      });
    });
  } catch (_) {}

  records.sort((a, b) => (b.sortMs || 0) - (a.sortMs || 0));
  _cachedGpRecords = records;

  // 상단 요약 카드 업데이트
  const currentGold = Number(bpData.gold || 0);
  if ($("gpWeeklyPrizeTotal")) $("gpWeeklyPrizeTotal").textContent = `${weeklyPrizeSum.toLocaleString()} GP`;
  if ($("gpWeeklyPrizeCount")) $("gpWeeklyPrizeCount").textContent = `주간 TOP 10 입상 ${weeklyPayouts.length}회`;
  if ($("gpPlayEarnTotal")) $("gpPlayEarnTotal").textContent = `${playEarnSum.toLocaleString()} GP`;
  if ($("gpPlayEarnCount")) $("gpPlayEarnCount").textContent = `일일 게임·출석·전환 ${records.filter(r => r.category === "daily_play").length}건`;
  if ($("gpCurrentGoldDisplay")) $("gpCurrentGoldDisplay").textContent = `${currentGold.toLocaleString()} GP`;
  if ($("gpCurrentWeekRankSub")) {
    $("gpCurrentWeekRankSub").textContent = thisWeekEntries.length > 0
      ? `이번 주(${currentWeekId}) 랭킹 ${thisWeekEntries.length}종목 참여 중`
      : `이번 주(${currentWeekId}) 랭킹 도전 가능`;
  }

  renderGpRewardTabView();
}

function renderGpRewardTabView() {
  const listEl = $("gpRewardHistList");
  if (!listEl) return;

  if (_gpFilterTab === "this_week") {
    const currentWeekId = getVnCurrentWeekId();
    if (_cachedThisWeekEntries.length === 0) {
      listEl.innerHTML = `
        <div style="padding:20px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px;border:1px dashed #cbd5e1;">
          📊 이번 주(${esc(currentWeekId)} 주간)에 아직 등록된 주간랭킹 게임 점수가 없습니다.<br/>
          <small>수박게임 · 2048 · 베스트당구장을 플레이하면 주간 TOP 10 상금(1위 50,000,000 GP)에 자동 도전됩니다!</small>
        </div>`;
      return;
    }

    const html = _cachedThisWeekEntries.map((e) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #f1f5f9;">
        <div>
          <div style="font-weight:800;color:#1e293b;font-size:0.95rem;">${esc(e.gameLabel)} <span style="font-size:0.75rem;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:99px;margin-left:4px;">이번 주(${esc(e.weekId)})</span></div>
          <div style="font-size:0.8rem;color:#64748b;margin-top:2px;">이번 주 도전 횟수: <b>${e.plays}판</b> · 매주 일요일 00:00(베트남) TOP 10 자동 정산</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.1rem;font-weight:900;color:#2563eb;">최고 ${e.bestScore.toLocaleString()}점</div>
          <div style="font-size:0.73rem;color:#64748b;">1위 5,000만 GP ~ 10위 500만 GP</div>
        </div>
      </div>
    `).join("");

    listEl.innerHTML = `<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;">${html}</div>`;
    return;
  }

  const filtered = _cachedGpRecords.filter((r) => {
    if (_gpFilterTab === "all") return true;
    return r.category === _gpFilterTab;
  });

  if (filtered.length === 0) {
    const emptyMsg = _gpFilterTab === "weekly_rank"
      ? "🏅 아직 주간랭킹 TOP 10 상금 수령 내역이 없습니다. (매주 일요일 00:00 정산)"
      : "🎮 아직 기록된 게임 GP 획득 내역이 없습니다.";
    listEl.innerHTML = `
      <div style="padding:20px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px;border:1px dashed #cbd5e1;">
        ${emptyMsg}
      </div>`;
    return;
  }

  const rowsHtml = filtered.map((r) => {
    const gpNum = Number(r.gp || 0);
    const isMinus = gpNum < 0;
    const gpText = isMinus ? `-${Math.abs(gpNum).toLocaleString()} GP` : `+${gpNum.toLocaleString()} GP`;
    const gpColor = isMinus ? "#dc2626" : "#2563eb";
    const subLabel = r.gpSubLabel || (isMinus ? "Point 전환" : "GP 적립");
    const subColor = isMinus ? "#9333ea" : "#059669";
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #f1f5f9;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="font-size:1.35rem;">${r.icon}</div>
        <div>
          <div style="font-weight:800;color:#1e293b;font-size:0.93rem;">
            ${esc(r.title)}
            <span style="font-size:0.72rem;background:${r.badgeBg};color:${r.badgeColor};padding:2px 7px;border-radius:99px;margin-left:4px;font-weight:800;">${esc(r.badge)}</span>
          </div>
          <div style="font-size:0.8rem;color:#64748b;margin-top:2px;">${esc(r.sub)}</div>
          <div style="font-size:0.74rem;color:#94a3b8;margin-top:2px;">📅 ${esc(r.dateStr)}</div>
        </div>
      </div>
      <div style="text-align:right;white-space:nowrap;">
        <div style="font-size:1.06rem;font-weight:900;color:${gpColor};">${gpText}</div>
        <div style="font-size:0.73rem;color:${subColor};font-weight:700;">${esc(subLabel)}</div>
      </div>
    </div>`;
  }).join("");

  listEl.innerHTML = `<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;">${rowsHtml}</div>`;
}

// GP 내역 탭 버튼 이벤트 바인딩
document.querySelectorAll("#gpHistFilterTabs .gp-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    _gpFilterTab = btn.getAttribute("data-gp-tab") || "all";
    document.querySelectorAll("#gpHistFilterTabs .gp-tab-btn").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("btn--primary", active);
      b.style.background = active ? "" : "#fff";
      b.style.color = active ? "" : "#334155";
      b.style.border = active ? "" : "1px solid #cbd5e1";
    });
    renderGpRewardTabView();
  });
});

async function loadTxHistory(uid, _walletAddress) {
  const wrap = $("txHistory");
  const section = $("txSection");
  if (!wrap) return;

  const unified = [];

  // ── Firestore 거래 내역 ──
  try {
    const q = query(
      collection(db, "transactions"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    onSnapshot(q, (snap) => {
      const unified = [];
      snap.forEach((d) => {
        const tx = d.data();
        const cfg = TX_CONFIG[tx.type] || { labelKey: null, label: tx.type, dir: "expense", icon: "📋" };

        let label = cfg.labelKey ? _t(cfg.labelKey) : cfg.label;
        if (tx.type === "merchant_income" && tx.merchantName) {
          const feePct = tx.feeBps != null ? ` (${_t('fee_pct', (tx.feeBps / 100).toFixed(0))})` : "";
          label = `🏪 ${tx.merchantName}${feePct}`;
        }
        if (tx.type === "pay_merchant" && tx.merchantName) {
          label = `🛒 ${tx.merchantName}`;
        }

        const isBm = (tx.currency === "VND" || tx.amountVnd != null || tx.type === "pay_merchant" || tx.type === "merchant_income");
        const unit = isBm ? "BM" : "Point";
        unified.push({
          sortTs: tx.createdAt?.toDate ? tx.createdAt.toDate().getTime() : 0,
          label,
          icon: cfg.icon,
          dir: cfg.dir,
          amountHex: txAmountHex(tx),
          unit,
          dateStr: tx.createdAt?.toDate ? tx.createdAt.toDate().toLocaleString("ko-KR") : "-",
          txHash: tx.txHash || null,
          statusBadge: null,
        });
      });

      if (unified.length === 0) {
        if (section) section.style.display = "none";
        return;
      }

      unified.sort((a, b) => b.sortTs - a.sortTs);
      show("txSection", true);

      let totalIncome = 0, totalExpense = 0, incomeCount = 0, expenseCount = 0;
      unified.forEach((t) => {
        if (t.dir === "income") { totalIncome += t.amountHex; incomeCount++; }
        else if (t.dir === "expense") { totalExpense += t.amountHex; expenseCount++; }
      });

      const fmtSum = (v) => v.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) + " Point";

      const summary = $("txSummary");
      if (summary) {
        summary.style.display = "";
        const el = (id) => document.getElementById(id);
        if (el("txTotalIncome")) el("txTotalIncome").textContent = "+" + fmtSum(totalIncome);
        if (el("txTotalExpense")) el("txTotalExpense").textContent = "−" + fmtSum(totalExpense);
        if (el("txTotalIncomeCount")) el("txTotalIncomeCount").textContent = incomeCount + _t('mi_payments_label');
        if (el("txTotalExpenseCount")) el("txTotalExpenseCount").textContent = expenseCount + _t('mi_payments_label');
      }

      wrap.innerHTML = unified.map(renderTxItem).join("");
    }, (err) => {
      console.warn("loadTxHistory onSnapshot error:", err.message);
      wrap.innerHTML = `<p class="hint muted">${_t('status_loading')} failed.</p>`;
    });
  } catch (err) {
    console.warn("loadTxHistory try block:", err.message);
  }
}



function formatWei(weiStr) {
  try {
    const n = parseFloat(BigInt(weiStr).toString()) / 1e18;
    return n.toFixed(4);
  } catch {
    return weiStr;
  }
}

function bindCreateWallet() { }
function bindConnectMetaMask(uid) { }

function bindLevelUp(uid) {
  const btn = $("btnLevelUp");
  if (!btn || btn._bound) return;
  btn._bound = true;

  btn.onclick = async () => {
    if (!confirm("레벨업을 진행하시겠습니까?\n레벨업 시 해당 레벨의 필요 경험치(EXP)가 차감되고 레벨이 1 증가합니다.")) return;
    btn.disabled = true;
    const btnText = $("btnLevelUpText") || btn;
    const oldText = btnText.textContent;
    btnText.textContent = "레벨업 진행 중...";

    try {
      const newLevel = await doLevelUp(uid);
      alert(`🎉 축하합니다!\nLv.${newLevel} 로 레벨업 되었습니다!`);
      await loadExpAndLevel(uid);
      await loadKCultureBalances(uid);
    } catch (err) {
      alert("레벨업 실패: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btnText.textContent = oldText;
    }
  };
}

function bindRedeemPoints(uid) { }
function bindOnChainRegister(uid) { }

function bindDepositForm() {
  const form = $("depositForm");
  if (!form) return;

  // 통화 선택 라디오 버튼 이벤트
  const radios = document.getElementsByName("depositCurrencyRadio");
  const currencyHidden = $("depositCurrency");
  const accKRW = $("depositAccountKRW");
  const accVND = $("depositAccountVND");
  const amountInput = $("depositAmount");
  const labelAmount = $("labelDepositAmount");

  if (radios.length > 0) {
    radios.forEach(r => {
      r.addEventListener("change", (e) => {
        if (!e.target.checked) return;
        const cur = e.target.value;
        if (currencyHidden) currencyHidden.value = cur;

        if (cur === "VND") {
          if (accKRW) accKRW.style.display = "none";
          if (accVND) accVND.style.display = "block";
          if (labelAmount) labelAmount.textContent = "충전 금액 (동)";
          if (amountInput) {
            amountInput.min = "200000";
            amountInput.step = "10000";
            amountInput.placeholder = "최소 200,000 VND";
            amountInput.value = "";
          }
        } else {
          if (accKRW) accKRW.style.display = "block";
          if (accVND) accVND.style.display = "none";
          if (labelAmount) labelAmount.textContent = "충전 금액 (원)";
          if (amountInput) {
            amountInput.min = "10000";
            amountInput.step = "1000";
            amountInput.placeholder = "최소 10,000원";
            amountInput.value = "";
          }
        }
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amountVal = Number(amountInput?.value);
    const currency = currencyHidden?.value || "KRW";
    const depositorName = String($("depositorName")?.value || "").trim();
    const btn = $("btnDeposit");

    if (currency === "VND") {
      if (!amountVal || amountVal < 200000) { alert("최소 충전 금액은 200,000 VND 입니다."); return; }
    } else {
      if (!amountVal || amountVal < 10000) { alert(_t('deposit_min_error') || "최소 충전 금액은 10,000원 입니다."); return; }
    }

    if (!depositorName) {
      alert(_t('deposit_name_error') || "입금자명을 입력해주세요.");
      return;
    }

    btn.disabled = true;
    btn.textContent = _t('deposit_loading') || "진행중...";

    try {
      const payload = currency === "VND"
        ? { amountVnd: amountVal, currency: "VND", depositorName }
        : { amountVnd: amountVal, currency: "VND", depositorName };

      // Bypass requestDeposit Cloud Function via direct DB write to resolve persistent CORS / backend issues
      const { setDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("로그인이 필요합니다.");

      const refCode = `DEP-${currentUser.uid.slice(0, 8).toUpperCase()}-${Date.now()}`;

      const depositData = {
        uid: currentUser.uid,
        userAddress: '-',
        depositorName: depositorName.trim(),
        currency: currency || "KRW",
        bank: currency === 'VND' ? "TECHCOM BANK" : "IBK기업은행",
        refCode,
        status: 'pending',
        requestedAt: serverTimestamp(),
        rateAtRequest: null,
      };

      if (currency === "VND") {
        depositData.amountVnd = amountVal;
        depositData.amountKrw = Math.floor(amountVal / 18.84);
      } else {
        depositData.amountKrw = amountVal;
        depositData.amountVnd = Math.floor(amountVal * 18.84);
      }

      await setDoc(doc(db, 'deposits', refCode), depositData);

      const d = {
        refCode,
        amountKrw: depositData.amountKrw,
        amountVnd: currency === "VND" ? amountVal : null,
        bankInfo: { bank: 'IBK기업은행', account: '480-141680-01-016', holder: '신헌철(제이앤에스 글로벌)' },
        bankInfoVnd: { bank: 'TECHCOM BANK', account: '19037882768012', holder: 'SHIN HEON CHEOL' },
        instruction: `입금자명을 "${depositorName.trim()}"으로 정확히 입력하세요. 참조코드: ${refCode}`
      };

      show("depositResult", true);
      setText("drRefCode", d.refCode);

      if (currency === "VND") {
        setText("drBankVnd", d.bankInfoVnd?.bank || "-");
        setText("drAccountVnd", d.bankInfoVnd?.account || "-");
        setText("drHolderVnd", d.bankInfoVnd?.holder || "-");
        setText("drAmount", (d.amountVnd || 0).toLocaleString() + " VND");
      } else {
        setText("drBank", d.bankInfo?.bank || "-");
        setText("drAccount", d.bankInfo?.account || "-");
        setText("drHolder", d.bankInfo?.holder || "-");
        setText("drAmount", (d.amountKrw || 0).toLocaleString() + " 원");
      }

      const drParts = [];

      if (d.amountVnd) drParts.push((d.amountVnd || 0).toLocaleString() + " VND");
      if (d.estimatedUsd != null) drParts.push("$" + Number(d.estimatedUsd).toFixed(2));
      setText("drHex", drParts.join(" / "));

      form.reset();

      // 충전 내역 자동 새로고침 + 스크롤
      const currentUid = auth.currentUser?.uid;
      if (currentUid) await loadDepositHistory(currentUid);
      const histEl = $("depositHistory");
      if (histEl) histEl.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      alert((_t('deposit_error_alert') || "Error: ") + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = _t('deposit_btn_after') || "충전 요청";
    }
  });
}

function bindMentorRequest(uid) {
  const btn = $("btnMentorRequest");
  if (!btn || btn._bound) return;
  btn._bound = true;

  btn.onclick = async () => {
    const email = String($("mentorReqEmail")?.value || "").trim().toLowerCase();
    if (!email) {
      alert(_t('mentor_email_error'));
      return;
    }

    btn.disabled = true;
    btn.textContent = _t('alert_requesting');
    try {
      await setDoc(doc(db, "mentorRequests", uid), {
        uid,
        mentorEmail: email,
        requestedAt: serverTimestamp(),
        status: "pending",
      });
      show("mentorReqDone", true);
      show("btnMentorRequest", false);
      const emailEl = $("mentorReqEmail");
      if (emailEl) emailEl.disabled = true;
    } catch (err) {
      alert(_t('mentor_req_error', err.message));
      btn.disabled = false;
      btn.textContent = _t('mentor_req_btn_label');
    }
  };
}

async function loadMerchantsForSelect() {
  const sel = $("merchantPaySelect");
  if (!sel) return;

  try {
    const snap = await getDocs(collection(db, "merchants"));
    const list = [];

    snap.forEach((d) => {
      const m = d.data() || {};
      if (m.active !== false) {
        list.push({ id: d.id, name: m.name || d.id });
      }
    });

    if (!list.length) {
      sel.innerHTML = `<option value="">${_t('merchant_empty_list')}</option>`;
      return;
    }

    sel.innerHTML =
      `<option value="">${_t('merchant_select_placeholder')}</option>` +
      list.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  } catch (err) {
    sel.innerHTML = `<option value="">${_t('merchant_load_error')}</option>`;
    console.warn("loadMerchantsForSelect:", err.message);
  }
}

function buildMypageDropHtml(d) {
  const items = [];
  if (d.issuedBt > 0) items.push(`🎟️ 보너스 티켓 <b>+${d.issuedBt}장</b><div style="font-size:11px;color:#92400e;margin-top:2px;">(내 정보 탭에서 사용 가능)</div>`);
  if (d.potionsAdded > 0) items.push(`<img src="/assets/images/item/hp.png" style="width:24px;height:24px;vertical-align:middle;"> ${_t('item_potion')} <b>+${d.potionsAdded}</b>`);
  if (d.mpPotionsAdded > 0) items.push(`<img src="/assets/images/item/mp.png" style="width:24px;height:24px;vertical-align:middle;"> ${_t('item_mp_potion')} <b>+${d.mpPotionsAdded}</b>`);
  if (d.reviveAdded > 0) items.push(`<img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:24px;height:24px;vertical-align:middle;"> ${_t('item_revive')} <b>+${d.reviveAdded}</b>`);
  if (!items.length) return '';
  return `
    <div class="drop-box">
      <div class="drop-box-title">🎁 혜택 지급 완료</div>
      ${items.map(i => `<div class="drop-item">${i}</div>`).join('')}
    </div>`;
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
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(1500 + Math.random() * 1000, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } catch (e) { }
    }, i * 50 + Math.random() * 20);
  }

  setTimeout(() => {
    if (ctx.state === 'suspended') ctx.resume();
    [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach(freq => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5);
        osc.start();
        osc.stop(ctx.currentTime + 2.5);
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
        textEl.textContent = `+${amount.toLocaleString()} point`;
      } else {
        textEl.textContent = `+${Math.floor(current).toLocaleString()} point`;
        requestAnimationFrame(update);
      }
    };
    requestAnimationFrame(update);
  }
}

function showJackpotResult(d) {
  const modal = $("jackpotModal");
  if (!modal) return;

  const hasItems = (d.potionsAdded > 0) || (d.mpPotionsAdded > 0) || (d.reviveAdded > 0);
  const jackpotBM = Number(d.jackpotAmountVnd || d.pointsEarned || 0);
  const hasJackpot = jackpotBM > 0 || d.isJackpot;

  if (!hasJackpot && !hasItems) return;

  const emojiEl = $("jmEmoji");
  const titleEl = $("jmTitle");
  const descEl = $("jmDesc");
  const itemsEl = $("jmItems");
  const closeBtn = $("jmCloseBtn");

  if (d.isJackpot) {
    if (emojiEl) emojiEl.textContent = "🎉";
    if (titleEl) titleEl.textContent = "JACKPOT!! 🎰";
    if (descEl) descEl.textContent = _t('jm_jackpot_desc');
  } else if (hasJackpot) {
    if (emojiEl) emojiEl.textContent = "🪙";
    if (titleEl) { titleEl.textContent = _t('jm_onchain_title'); titleEl.style.color = "#fde68a"; }
    if (descEl) descEl.textContent = "가맹점 결제 보상 당첨!";
  } else {
    if (emojiEl) emojiEl.textContent = "🎁";
    if (titleEl) { titleEl.textContent = _t('jm_item_title'); titleEl.style.color = "#fef08a"; }
    if (descEl) descEl.textContent = _t('jm_item_desc');
  }

  if (itemsEl) {
    const lines = [];
    if (hasJackpot && jackpotBM > 0) {
      lines.push(`<div class="jm-item" style="font-size:1.4rem; color:#fde047; font-weight:800; margin: 15px 0;">✨ 잭팟 달성! <br><span id="jackpotAmountText" style="color:#fff; font-size:2.5rem; text-shadow:0 0 20px rgba(253,224,71,0.8); display:inline-block; font-variant-numeric:tabular-nums;">+${jackpotBM.toLocaleString()} BM</span> <br>(Point) 지급 완료</div>`);
      setTimeout(() => playUltimateJackpotEffect(jackpotBM), 150);
    }
    if (d.potionsAdded > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/hp.png" style="width:22px;height:22px;"> ${_t('item_potion')} <b>+${d.potionsAdded}</b></div>`);
    if (d.mpPotionsAdded > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/mp.png" style="width:22px;height:22px;"> ${_t('item_mp_potion')} <b>+${d.mpPotionsAdded}</b></div>`);
    if (d.reviveAdded > 0) lines.push(`<div class="jm-item"><img src="/assets/images/item/revive_ticket.png" onerror="this.src='/assets/images/item/hp.png'" style="width:22px;height:22px;"> ${_t('item_revive')} <b>+${d.reviveAdded}</b></div>`);
    itemsEl.innerHTML = lines.join('');
    itemsEl.style.display = lines.length ? '' : 'none';
  }

  modal.classList.add("active");

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.remove("active");
  }
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("active"); };
}

function playGradeSlotAnimation(grade) {
  return new Promise((resolve) => {
    if (!grade) {
      resolve();
      return;
    }

    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.92);backdrop-filter:blur(5px);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;animation:fadeIn 0.2s ease;";

    if (!document.getElementById("slotKeyframes")) {
      const style = document.createElement("style");
      style.id = "slotKeyframes";
      style.textContent = `
        @keyframes slotPulse { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `;
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
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(700 + Math.random() * 300, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
      } catch (e) { }
    };

    const playWin = () => {
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);     // C5
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2); // G5
        osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.3); // C6
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);
      } catch (e) { }
    };

    let duration = 2500;
    let start = Date.now();
    let tickSpeed = 50;

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

        sub.innerHTML = `잭팟 등급 <b style="color:#fff;font-size:1.2em;">1/${grade}</b> 확정! 보상 계산을 완료했습니다.`;
        sub.style.color = "#86efac";
        title.innerHTML = "🎉 추첨 완료! 🎉";
        title.style.color = "#4ade80";
        title.style.textShadow = "0 0 20px rgba(74,222,128,0.7)";

        playWin();
        if ("vibrate" in navigator) navigator.vibrate([100, 50, 100, 50, 200]);

        setTimeout(() => {
          modal.style.transition = "opacity 0.4s ease";
          modal.style.opacity = "0";
          setTimeout(() => {
            if (modal.parentNode) document.body.removeChild(modal);
            resolve();
          }, 400);
        }, 1800);
      }
    };
    runSlot();
  });
}

function bindMerchantPay(uid, _walletAddress) {
  const form = $("merchantPayForm");
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const merchantId = $("merchantPaySelect")?.value;
    const amount = Number($("merchantPayAmount")?.value);
    const btn = $("btnMerchantPay");
    const resultBox = $("merchantPayResult");

    if (!merchantId) {
      alert(_t('merchant_select_error'));
      return;
    }

    if (!amount || amount < 10000) { alert(_t('pay_vnd_min_error')); return; }

    const confirmMsg = _t('pay_confirm_vnd', amount.toLocaleString());
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;
    btn.textContent = _t('pay_loading');
    if (resultBox) resultBox.style.display = "none";

    const payload = { merchantId: Number(merchantId), amountVnd: amount, currency: "VND" };

    try {
      const payFn = httpsCallable(functions, "payMerchantFirebase");
      const res = await payFn(payload);
      const d = res.data;

      if (d.grade) {
        await playGradeSlotAnimation(d.grade);
      }

      const amountDisp = d.amountVnd ? `${Math.round(d.amountVnd).toLocaleString()} BM` : '';

      if (resultBox) {
        resultBox.style.display = "";
        resultBox.innerHTML = `
          <div class="mp-kv"><span class="k">${_t('pay_result_merchant')}</span><span class="v">${d.merchantName || ""}</span></div>
          <div class="mp-kv"><span class="k">${_t('pay_result_amount')}</span><span class="v accent">${amountDisp}</span></div>
          <p class="hint" style="color:var(--accent); margin-top:6px;">${_t('pay_done')}</p>
          ${buildMypageDropHtml(d)}
        `;
      }

      form.reset();
      showJackpotResult(d);
      loadTxHistory(uid);
      loadJackpotHistory(uid);

    } catch (err) {
      alert(_t('pay_error', err.message));
    } finally {
      btn.disabled = false;
      btn.textContent = _t('pay_btn_label');
    }
  });
}


let __qrStream = null;
let __qrRaf = 0;

function stopQrScan() {
  if (__qrRaf) cancelAnimationFrame(__qrRaf);
  __qrRaf = 0;
  if (__qrStream) {
    __qrStream.getTracks().forEach((t) => t.stop());
    __qrStream = null;
  }
  const overlay = $("qrScanOverlay");
  if (overlay) overlay.classList.remove("active");
}

function parseQrPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  try {
    const j = JSON.parse(text);
    return {
      merchantId: String(j.merchantId || j.merchant_id || j.id || "").trim(),
      merchantName: String(j.name || j.merchantName || j.merchant_name || "").trim(),
      amount: Number(j.amount || j.krw || j.vnd || 0) || null,
      currency: String(j.currency || "").toUpperCase() || null,
    };
  } catch { }

  try {
    const u = new URL(text);
    return {
      merchantId: String(u.searchParams.get("merchant") || u.searchParams.get("merchantId") || u.searchParams.get("id") || "").trim(),
      merchantName: String(u.searchParams.get("name") || "").trim(),
      amount: Number(u.searchParams.get("amount") || 0) || null,
      currency: String(u.searchParams.get("currency") || "").toUpperCase() || null,
    };
  } catch { }

  const mId =
    /merchantId\s*[:=]\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1] ||
    /id\s*[:=]\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1] ||
    "";
  const amount = Number(/amount\s*[:=]\s*([0-9.]+)/i.exec(text)?.[1] || 0) || null;
  const currency = (/(currency|cur)\s*[:=]\s*([A-Za-z]{3})/i.exec(text)?.[2] || "").toUpperCase() || null;
  if (!mId && !amount && !currency) return null;
  return { merchantId: mId, merchantName: "", amount, currency };
}

function showQrResult(msg, isError) {
  const box = $("qrResultState");
  if (!box) return;
  box.textContent = msg;
  box.style.cssText = `display:block!important;margin:8px 0;padding:10px 14px;border-radius:8px;border:1px solid;font-size:0.88rem;${isError ? "background:#fef2f2;border-color:#fca5a5;color:#991b1b;" : "background:#f0fdf4;border-color:#86efac;color:#166534;"}`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function applyQrResult(payload) {
  if (!payload) return false;
  const sel = $("merchantPaySelect");
  const amountInput = $("merchantPayAmount");
  const currencyHidden = $("merchantPayCurrency");
  const radioVnd = $("merchantPayCurrencyVND");
  const radioKrw = $("merchantPayCurrencyKRW");

  // 스캔 시 무조건 결제 섹션 펼치기
  const merchantPaySection = $("merchantPaySection");
  if (merchantPaySection) {
    merchantPaySection.classList.remove("is-collapsed");
  }

  // ── 금액 즉시 반영 ──
  if (payload.amount && amountInput) {
    amountInput.value = String(Math.round(payload.amount));
  }

  // ── 통화는 오직 VND ──
  // QR에 다른 통화(KRW)가 있더라도 무시하고 VND로 고정
  const labelEl = $("merchantPayAmountLabel");
  const inputEl = amountInput;
  if (labelEl) labelEl.textContent = "결제 금액 (VND)";
  if (inputEl) {
    inputEl.min = "10000";
    inputEl.step = "1000";
    inputEl.placeholder = "예: 20000";
  }

  // ── 가맹점 매칭 ──
  const mid = String(payload.merchantId || "").trim();
  if (!mid || !sel) {
    showQrResult(_t('qr_amount_only', payload.amount ? payload.amount.toLocaleString() : "-"), false);
    sel?.focus();
    return true;
  }

  // 1) 이미 select에 있으면 바로 선택
  const existing = Array.from(sel.options).find(
    (o) => o.value && (String(o.value) === mid || Number(o.value) === Number(mid))
  );
  if (existing) {
    sel.value = existing.value;
    showQrResult(_t('qr_success', existing.textContent, payload.amount?.toLocaleString() || "-"), false);
    sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return true;
  }

  // 2) Firestore에서 직접 조회
  showQrResult(_t('qr_loading_merchant'), false);
  try {
    const mSnap = await getDoc(doc(db, "merchants", mid));
    if (mSnap.exists()) {
      const mName = mSnap.data()?.name || mid;
      // 셀렉트에 옵션 추가 (없을 경우)
      let opt = Array.from(sel.options).find((o) => String(o.value) === mid);
      if (!opt) {
        opt = document.createElement("option");
        opt.value = mid;
        opt.textContent = mName;
        sel.appendChild(opt);
      }
      sel.value = mid;
      showQrResult(_t('qr_success', mName, payload.amount?.toLocaleString() || "-"), false);
      sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return true;
    }
  } catch (e) {
    console.warn("QR merchant fetch failed:", e.message);
    showQrResult(_t('qr_merchant_fail'), true);
    return false;
  }

  showQrResult(_t('qr_merchant_not_found', mid), true);
  return false;
}

function bindQrScan() {
  const btnOpen = $("btnQrScan");
  const btnClose = $("btnCloseQr");
  const overlay = $("qrScanOverlay");
  const video = $("qrVideo");
  const canvas = $("qrCanvas");
  const state = $("qrScanState");
  if (!btnOpen || !btnClose || !overlay || !video || !canvas) return;

  btnClose.onclick = () => stopQrScan();

  btnOpen.onclick = async () => {
    try {
      if (state) state.textContent = _t('qr_start');
      overlay.classList.add("active");

      __qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = __qrStream;
      await video.play();

      const onDetected = async (raw) => {
        if (__qrRaf) { cancelAnimationFrame(__qrRaf); __qrRaf = 0; }

        // ── 가맹점 직원 현장 쿠폰 스캔 타겟 지원 ──
        if (typeof window.__qrScanCouponTarget === 'function') {
          const cb = window.__qrScanCouponTarget;
          window.__qrScanCouponTarget = null;
          cb(raw.trim());
          stopQrScan();
          return;
        }

        // ── BT 모드 QR (보너스 티켓) 감지 시, 바로 리다이렉트 ──
        if (raw.includes('bt_receive.html')) {
          if (state) state.textContent = "보너스 티켓 수령 페이지로 이동합니다...";
          setTimeout(() => {
            location.href = raw;
          }, 300);
          return;
        }

        const payload = parseQrPayload(raw);
        console.log("[QR] raw:", raw, "parsed:", JSON.stringify(payload));
        if (state) state.textContent = _t('qr_recognized', raw.slice(0, 60), payload?.merchantId || "");
        if (payload && (payload.merchantId || payload.amount)) {
          await applyQrResult(payload);
        } else {
          showQrResult(_t('qr_parse_fail', raw.slice(0, 100)), true);
        }
        setTimeout(() => stopQrScan(), 800);
      };

      // ── BarcodeDetector (Android Chrome 83+ / 하드웨어 가속) ──
      if ("BarcodeDetector" in window) {
        if (state) state.textContent = _t('qr_hint');
        const bd = new BarcodeDetector({ formats: ["qr_code"] });
        let detecting = false;
        const detectTick = async () => {
          if (detecting) { __qrRaf = requestAnimationFrame(detectTick); return; }
          if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(detectTick); return; }
          detecting = true;
          try {
            const codes = await bd.detect(video);
            if (codes.length > 0) {
              await onDetected(codes[0].rawValue);
              return;
            }
          } catch { }
          detecting = false;
          __qrRaf = requestAnimationFrame(detectTick);
        };
        __qrRaf = requestAnimationFrame(detectTick);
        return;
      }

      // ── jsQR 폴백 ──
      if (!window.jsQR) {
        if (state) state.textContent = _t('qr_jsqr_fail');
        return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let frameCount = 0;
      const tick = () => {
        if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(tick); return; }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
        if (qr?.data) {
          onDetected(qr.data);
          return;
        }
        frameCount++;
        if (frameCount % 20 === 0 && state) {
          state.textContent = _t('qr_scan_progress', Math.floor(frameCount / 20));
        }
        __qrRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      if (state) state.textContent = _t('qr_camera_fail');
      stopQrScan();
      alert(_t('qr_camera_error_alert', err?.message || err));
    }
  };
}

// ── 아코디언 초기화 ──────────────────────────────────────────────────────────
function initAccordion() {
  document.querySelectorAll('.mp-section.collapsible').forEach((section) => {
    const head = section.querySelector('.mp-section-head');
    if (!head) return;

    // 제목에 chevron 추가
    const title = head.querySelector('.mp-section-title');
    if (title && !title.querySelector('.mp-chevron')) {
      const chevron = document.createElement('span');
      chevron.className = 'mp-chevron';
      chevron.textContent = '▾';
      title.appendChild(chevron);
    }

    // 헤더 이후 모든 자식을 .mp-body로 감싸기
    if (!section.querySelector('.mp-body')) {
      const body = document.createElement('div');
      body.className = 'mp-body';
      [...section.children].filter((c) => c !== head).forEach((c) => body.appendChild(c));
      section.appendChild(body);
    }

    // 토글 핸들러 (버튼/링크 클릭 시 전파 방지)
    head.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      section.classList.toggle('is-collapsed');
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// 내 쿠폰·바우쳐 (BM 기반 이벤트 쿠폰 / 바우쳐)
// ─────────────────────────────────────────────────────────────────
let _myCouponsList = [];
let _currentCouponTab = 'all';

function formatCouponDate(val) {
  if (!val) return '-';
  if (val.toDate) return val.toDate().toLocaleDateString('ko-KR');
  const d = new Date(val);
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('ko-KR');
}

function renderCouponCards(coupons) {
  const grid = $('myCouponsGrid');
  const empty = $('myCouponsEmpty');
  const emptyText = $('myCouponsEmptyText');
  if (!grid || !empty) return;

  grid.innerHTML = '';

  // 탭 상태 필터링
  const now = Date.now();
  const filtered = coupons.filter(item => {
    let effectiveStatus = item.status || 'available';
    const expireTime = item.expiresAt?.toMillis ? item.expiresAt.toMillis() : new Date(item.expiresAt || 0).getTime();
    if (effectiveStatus === 'available' && expireTime && now > expireTime) {
      effectiveStatus = 'expired';
    }

    if (_currentCouponTab === 'all') return true;
    return effectiveStatus === _currentCouponTab;
  });

  if (filtered.length === 0) {
    empty.style.display = 'block';
    if (emptyText) {
      const tabNames = { all: '보유한', available: '사용 가능한', used: '사용 완료된', expired: '기간 만료된', cancelled: '취소된' };
      emptyText.textContent = `${tabNames[_currentCouponTab] || ''} 쿠폰·바우쳐가 없습니다.`;
    }
    return;
  }

  empty.style.display = 'none';

  filtered.forEach(c => {
    let effectiveStatus = c.status || 'available';
    const expireTime = c.expiresAt?.toMillis ? c.expiresAt.toMillis() : new Date(c.expiresAt || 0).getTime();
    if (effectiveStatus === 'available' && expireTime && now > expireTime) {
      effectiveStatus = 'expired';
    }

    const card = document.createElement('div');
    card.className = 'my-coupon-card';

    const isVoucher = (c.campaignType || '').toUpperCase() === 'VOUCHER';
    const typeLabel = isVoucher ? '바우쳐' : '이벤트 쿠폰';
    const issuerBadge = c.issuerBadge || (c.issuerType === 'PLATFORM' ? 'SUPER ADMIN' : '가맹점');
    const priceBM = Number(c.purchasePriceBM || 0);
    const priceText = priceBM === 0 ? '무료 발급 (0 BM)' : `${priceBM.toLocaleString()} BM`;
    const isFree = priceBM === 0;

    const issuedDateStr = formatCouponDate(c.issuedAt);
    const expireDateStr = formatCouponDate(c.expiresAt);

    // 사용처
    let merchantsText = '전 가맹점 사용 가능';
    if (Array.isArray(c.applicableMerchantIds) && !c.applicableMerchantIds.includes('all')) {
      merchantsText = c.applicableMerchantIds.join(', ');
    } else if (c.merchantId && c.merchantId !== 'all') {
      merchantsText = c.merchantId;
    }

    let statusPillHtml = '';
    let actionBtnHtml = '';

    if (effectiveStatus === 'available') {
      statusPillHtml = `<span class="status-pill available">사용 가능</span>`;
      actionBtnHtml = `<button type="button" class="btn btn--primary btn--sm btn-open-coupon-qr" style="font-weight:700; padding:6px 14px; border-radius:8px;" data-id="${c.id}">사용하기 (QR)</button>`;
    } else if (effectiveStatus === 'used') {
      statusPillHtml = `<span class="status-pill used">사용 완료</span>`;
      const redeemedDate = c.redeemedAt ? formatCouponDate(c.redeemedAt) : '';
      actionBtnHtml = `<span style="font-size:0.75rem; color:#64748b; font-weight:600;">${redeemedDate ? redeemedDate + ' 사용됨' : '사용 완료'}</span>`;
    } else if (effectiveStatus === 'expired') {
      statusPillHtml = `<span class="status-pill expired">기간 만료</span>`;
      actionBtnHtml = `<span style="font-size:0.75rem; color:#dc2626; font-weight:600;">유효기간 종료</span>`;
    } else {
      statusPillHtml = `<span class="status-pill cancelled">취소</span>`;
      actionBtnHtml = `<span style="font-size:0.75rem; color:#9ca3af; font-weight:600;">발급 취소</span>`;
    }

    const fallbackImg = isVoucher
      ? 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80'
      : 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=80';
    const imgSrc = c.imageUrl || fallbackImg;

    card.innerHTML = `
      <div class="my-coupon-img-wrap">
        <img src="${imgSrc}" alt="${esc(c.title || '')}" class="my-coupon-img" onerror="this.src='${fallbackImg}';">
        <span class="my-coupon-badge-issuer">${esc(issuerBadge)}</span>
        <span class="my-coupon-badge-type">${typeLabel}</span>
      </div>
      <div class="my-coupon-content">
        <h4 class="my-coupon-title">${esc(c.title || '쿠폰 상품')}</h4>
        <div class="my-coupon-issuer">
          <span>발행처:</span> <b>${esc(c.issuerNameSnapshot || c.issuerId || '플랫폼')}</b>
        </div>
        <div class="my-coupon-price-row">
          <span style="font-size:0.75rem; color:#64748b; font-weight:600;">결제/발급 금액</span>
          <span class="my-coupon-price ${isFree ? 'free' : ''}">${priceText}</span>
        </div>
        <div class="my-coupon-info-list">
          <div>📅 <b>발급일:</b> ${issuedDateStr}</div>
          <div>⏳ <b>만료일:</b> <span style="color:#e11d48; font-weight:700;">${expireDateStr}</span></div>
          <div>🏪 <b>사용처:</b> ${esc(merchantsText)}</div>
          <div style="font-family:monospace; font-size:0.8rem; background:#f1f5f9; padding:2px 6px; border-radius:4px; display:inline-block; width:fit-content; margin-top:2px;">
            코드: <b>${esc(c.couponCode || '-')}</b>
          </div>
        </div>
        <div class="my-coupon-actions">
          ${statusPillHtml}
          <div style="margin-left:auto;">${actionBtnHtml}</div>
        </div>
      </div>
    `;

    // 사용하기 클릭 시 모달 열기
    const btnUse = card.querySelector('.btn-open-coupon-qr');
    if (btnUse) {
      btnUse.addEventListener('click', () => openCouponQrModal(c, merchantsText, expireDateStr));
    }

    grid.appendChild(card);
  });
}

function updateCouponTabCounts(coupons) {
  const now = Date.now();
  let cntAll = coupons.length;
  let cntAvailable = 0;
  let cntUsed = 0;
  let cntExpired = 0;
  let cntCancelled = 0;

  coupons.forEach(c => {
    let s = c.status || 'available';
    const expireTime = c.expiresAt?.toMillis ? c.expiresAt.toMillis() : new Date(c.expiresAt || 0).getTime();
    if (s === 'available' && expireTime && now > expireTime) {
      s = 'expired';
    }

    if (s === 'available') cntAvailable++;
    else if (s === 'used') cntUsed++;
    else if (s === 'expired') cntExpired++;
    else if (s === 'cancelled') cntCancelled++;
  });

  if ($('cntAll')) $('cntAll').textContent = `(${cntAll})`;
  if ($('cntAvailable')) $('cntAvailable').textContent = `(${cntAvailable})`;
  if ($('cntUsed')) $('cntUsed').textContent = `(${cntUsed})`;
  if ($('cntExpired')) $('cntExpired').textContent = `(${cntExpired})`;
  if ($('cntCancelled')) $('cntCancelled').textContent = `(${cntCancelled})`;
}

function openCouponQrModal(coupon, merchantsText, expireDateStr) {
  const modal = $('couponQrModal');
  if (!modal) return;

  const isVoucher = (coupon.campaignType || '').toUpperCase() === 'VOUCHER';
  if ($('qrModalTypeBadge')) $('qrModalTypeBadge').textContent = isVoucher ? '바우쳐' : '이벤트 쿠폰';
  if ($('qrModalTitle')) $('qrModalTitle').textContent = coupon.title || '-';
  if ($('qrModalCode')) $('qrModalCode').textContent = coupon.couponCode || '-';
  if ($('qrModalIssuer')) $('qrModalIssuer').textContent = coupon.issuerNameSnapshot || coupon.issuerId || '플랫폼';
  if ($('qrModalMerchants')) $('qrModalMerchants').textContent = merchantsText;
  if ($('qrModalExpiry')) $('qrModalExpiry').textContent = expireDateStr;
  if ($('qrModalTerms')) $('qrModalTerms').textContent = coupon.terms ? `조건: ${coupon.terms}` : '사용 조건: 현장 주문/결제 시 제시';

  const canvasWrap = $('couponQrCanvasWrap');
  if (canvasWrap) {
    canvasWrap.innerHTML = '';
    const code = coupon.couponCode || 'INVALID';
    if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
      const canvas = document.createElement('canvas');
      window.QRCode.toCanvas(canvas, code, { width: 190, margin: 1, color: { dark: '#1e1b4b', light: '#ffffff' } }, (err) => {
        if (!err) canvasWrap.appendChild(canvas);
        else canvasWrap.textContent = code;
      });
    } else {
      import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm').then(mod => {
        const canvas = document.createElement('canvas');
        mod.default.toCanvas(canvas, code, { width: 190, margin: 1 }, () => {
          canvasWrap.appendChild(canvas);
        });
      }).catch(() => {
        canvasWrap.textContent = code;
      });
    }
  }

  // 모달 복사 버튼
  const btnCopy = $('btnCopyCouponCode');
  const copyDone = $('couponCodeCopyDone');
  if (btnCopy) {
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(coupon.couponCode || '').then(() => {
        if (copyDone) {
          copyDone.style.display = 'inline';
          setTimeout(() => { copyDone.style.display = 'none'; }, 2000);
        }
      });
    };
  }

  // 닫기 버튼
  const close = () => { modal.style.display = 'none'; };
  if ($('btnCouponQrClose')) $('btnCouponQrClose').onclick = close;
  if ($('btnCouponQrConfirmClose')) $('btnCouponQrConfirmClose').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  modal.style.display = 'flex';
}

async function loadMyCouponsData(uid) {
  const loading = $('myCouponsLoading');
  const empty = $('myCouponsEmpty');
  if (loading) loading.style.display = 'block';
  if (empty) empty.style.display = 'none';

  try {
    const q = query(
      collection(db, 'user_coupons'),
      where('userId', '==', uid)
    );
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(docSnap => {
      list.push({ id: docSnap.id, ...docSnap.data() });
    });

    list.sort((a, b) => {
      const ta = a.issuedAt?.toMillis ? a.issuedAt.toMillis() : new Date(a.issuedAt || 0).getTime();
      const tb = b.issuedAt?.toMillis ? b.issuedAt.toMillis() : new Date(b.issuedAt || 0).getTime();
      return tb - ta;
    });

    _myCouponsList = list;
    updateCouponTabCounts(_myCouponsList);
    renderCouponCards(_myCouponsList);
  } catch (err) {
    console.error('loadMyCouponsData error:', err);
    if (empty) {
      empty.style.display = 'block';
      if ($('myCouponsEmptyText')) $('myCouponsEmptyText').textContent = '쿠폰 목록을 불러오는 중 오류가 발생했습니다.';
    }
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

async function initMyCoupons(user, userData) {
  const section = $('couponsSection');
  if (!section || !user) return;

  // 1. 탭 이벤트 바인딩
  document.querySelectorAll('.mycoupon-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.mycoupon-tab').forEach(b => {
        b.classList.remove('active');
        b.style.background = '#f1f5f9';
        b.style.color = '#475569';
      });
      tabBtn.classList.add('active');
      tabBtn.style.background = '#7c3aed';
      tabBtn.style.color = '#ffffff';

      _currentCouponTab = tabBtn.dataset.status || 'all';
      renderCouponCards(_myCouponsList);
    });
  });

  // 2. 새로고침 버튼
  const btnRefresh = $('btnRefreshCoupons');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnRefresh.disabled = true;
      btnRefresh.style.opacity = '0.6';
      await loadMyCouponsData(user.uid);
      btnRefresh.disabled = false;
      btnRefresh.style.opacity = '1';
    });
  }

  // 3. 가맹점 현장 승인 도구 바인딩 (관리자 또는 가맹점주)
  const isSuperAdmin = ['daguri75@gmail.com'].includes(user.email) || userData.role === 'SUPER_ADMIN' || userData.role === 'admin';
  const isMerchantOwner = !!userData.merchantId;

  // 내 구매 내역: 본인이 고객으로 결제한 내역 (가맹점주도 다른 가맹점에서 소비하므로 모두 표시)
  loadMyPurchaseHistory();
  const btnMp = $('btnRefreshMyPurchases');
  if (btnMp && !btnMp.dataset.bound) {
    btnMp.dataset.bound = '1';
    btnMp.addEventListener('click', () => loadMyPurchaseHistory());
  }

  // 내 가맹점 매출·고객 (BestERP 대시보드와 같은 서버 함수 getMerchantSalesSummary)
  if (isMerchantOwner) {
    loadMerchantSalesSummary(String(userData.merchantId));
    const btnMs = $('btnRefreshMerchantSales');
    if (btnMs && !btnMs.dataset.bound) {
      btnMs.dataset.bound = '1';
      btnMs.addEventListener('click', () => loadMerchantSalesSummary(String(userData.merchantId)));
    }
  }

  const toolBox = $('merchantRedeemTool');
  if (toolBox && (isSuperAdmin || isMerchantOwner)) {
    toolBox.style.display = 'block';
    const roleBadge = $('merchantStaffRoleBadge');
    const merchantSelect = $('staffMerchantSelect');
    if (roleBadge) {
      const mLabel = userData.merchantId === 1791605366 ? 'BEST WINNER' : (userData.merchantName || userData.merchantId);
      roleBadge.textContent = isSuperAdmin ? '수퍼 어드민' : `가맹점 점주 (${mLabel})`;
    }

    if (isSuperAdmin && merchantSelect) {
      merchantSelect.style.display = 'inline-block';
      try {
        const mSnap = await getDocs(collection(db, 'merchants'));
        merchantSelect.innerHTML = '<option value="">가맹점 선택...</option>';
        mSnap.forEach(d => {
          const m = d.data();
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = `${m.name || d.id} (${d.id})`;
          merchantSelect.appendChild(opt);
        });
      } catch (mErr) {
        console.warn('load merchants for staff redeem error:', mErr);
      }
    }

    const btnSubmit = $('btnStaffRedeemSubmit');
    const codeInput = $('staffCouponCodeInput');
    const msgEl = $('staffRedeemMsg');

    if (btnSubmit && codeInput) {
      btnSubmit.addEventListener('click', async () => {
        const rawCode = (codeInput.value || '').trim().toUpperCase();
        if (!rawCode) {
          if (msgEl) { msgEl.style.color = '#dc2626'; msgEl.textContent = '쿠폰 코드를 입력해 주세요.'; }
          return;
        }

        let targetMerchantId = isMerchantOwner ? String(userData.merchantId) : (merchantSelect?.value || '');
        if (!targetMerchantId) {
          if (msgEl) { msgEl.style.color = '#dc2626'; msgEl.textContent = '가맹점을 선택해 주세요.'; }
          return;
        }

        btnSubmit.disabled = true;
        btnSubmit.textContent = '승인 처리 중...';
        if (msgEl) { msgEl.style.color = '#7c3aed'; msgEl.textContent = '서버에서 쿠폰 유효성 검증 및 사용 처리 중...'; }

        try {
          const fn = httpsCallable(functions, 'redeemCouponOffline');
          const res = await fn({ couponCode: rawCode, merchantId: targetMerchantId });
          const d = res.data || {};
          if (msgEl) {
            msgEl.style.color = '#15803d';
            msgEl.textContent = `✅ [사용 완료] "${d.title || rawCode}" 쿠폰이 정상 승인되었습니다. (승인번호: ${d.redemptionId || '-'})`;
          }
          codeInput.value = '';
          await loadMyCouponsData(user.uid);
          loadKCultureBalances(user.uid);
        } catch (err) {
          if (msgEl) {
            msgEl.style.color = '#dc2626';
            msgEl.textContent = `❌ 사용 실패: ${err.message || '서버 오류'}`;
          }
        } finally {
          btnSubmit.disabled = false;
          btnSubmit.textContent = '승인 및 사용 처리';
        }
      });
    }

    // QR 스캔 버튼
    const btnScan = $('btnStaffRedeemScan');
    if (btnScan) {
      btnScan.addEventListener('click', () => {
        const openCamera = $('btnQrScan');
        if (openCamera) {
          window.__qrScanCouponTarget = (code) => {
            if (codeInput) codeInput.value = code;
            if (msgEl) { msgEl.style.color = '#15803d'; msgEl.textContent = `QR 스캔 성공: ${code}`; }
          };
          openCamera.click();
        }
      });
    }
  }

  // 4. 초기 데이터 로드
  await loadMyCouponsData(user.uid);
}

onAuthReady(async (ctx) => {
  initLang();
  window.addEventListener('lang:change', () => initLang());

  const loggedIn = (ctx?.loggedIn ?? ctx?.loggedin) === true;
  const user = ctx?.user;

  if (!loggedIn || !user) {
    show("needLoginPanel", true);
    const btn = $("btnLoginPage");
    if (btn) {
      btn.onclick = () => {
        location.href = "/register.html";
      };
    }
    return;
  }

  show("mainContent", true);
  initAccordion();

  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target?.classList.contains('collapsible')) {
      target.classList.remove('is-collapsed');
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (location.hash === '#merchantPaySection') {
          const btnOpen = document.getElementById("btnQrScan");
          if (btnOpen) btnOpen.click();
        }
      }, 120);
    }
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    if (!snap.exists() && ctx.role !== 'admin') {
      show("noProfilePanel", true);
      return;
    }

    const walletAddress = data?.wallet?.address ? String(data.wallet.address) : '';

    renderProfile(data, user);
    renderWallet(data);
    renderReferralSection(user.uid);
    bindCreateWallet();
    bindConnectMetaMask(user.uid);
    bindOnChainRegister(user.uid);
    bindLevelUp(user.uid);
    bindRedeemPoints(user.uid);
    bindMentorRequest(user.uid);
    bindDepositForm();
    await loadMerchantsForSelect();
    bindMerchantPay(user.uid, walletAddress);
    bindQrScan();

    // URL 파라미터 처리 (앱 네이티브 카메라로 QR 스캔 시 merchant=?&amount=?&currency=? 진입)
    (async () => {
      const p = new URLSearchParams(location.search);
      const mid = (p.get("merchant") || p.get("merchantId") || p.get("id") || "").trim();
      const amt = Number(p.get("amount") || 0) || null;
      const cur = (p.get("currency") || "").toUpperCase() || null;
      if (mid || amt) {
        await applyQrResult({ merchantId: mid, merchantName: "", amount: amt, currency: cur });
        $("qrResultState")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    })();

    loadKCultureBalances(user.uid);
    loadExpAndLevel(user.uid, data);

    loadDepositHistory(user.uid);
    loadMentees();

    // ── 잔고 새로고침 버튼 ──────────────────────────────────────────────────
    const btnRefreshInfo = $('btnRefreshInfo');
    if (btnRefreshInfo) {
      btnRefreshInfo.addEventListener('click', async (e) => {
        e.stopPropagation(); // 아코디언 토글 방지
        btnRefreshInfo.disabled = true;
        btnRefreshInfo.style.opacity = '0.6';
        btnRefreshInfo.innerHTML = '<span style="display:inline-block;animation:spin .7s linear infinite;">🔄</span> 갱신 중…';
        try {
          await Promise.all([
            loadKCultureBalances(user.uid),
            loadExpAndLevel(user.uid),
          ]);
          btnRefreshInfo.innerHTML = '✅ 완료';
        } catch (_) {
          btnRefreshInfo.innerHTML = '❌ 실패';
        } finally {
          setTimeout(() => {
            btnRefreshInfo.disabled = false;
            btnRefreshInfo.style.opacity = '1';
            btnRefreshInfo.innerHTML = '🔄 새로고침';
          }, 1500);
        }
      });
    }

    const btnRefresh = $("btnRefreshDeposits");
    if (btnRefresh) btnRefresh.onclick = () => loadDepositHistory(user.uid);

    const btnRefreshTx = $("btnRefreshTx");
    if (btnRefreshTx) btnRefreshTx.onclick = () => loadTxHistory(user.uid, walletAddress);

    loadJackpotHistory(user.uid);
    const btnRefreshJackpotHist = $("btnRefreshJackpotHist");
    if (btnRefreshJackpotHist) btnRefreshJackpotHist.onclick = () => loadJackpotHistory(user.uid);

    loadGpRewardHistory(user.uid);
    const btnRefreshGpRewardHist = $("btnRefreshGpRewardHist");
    if (btnRefreshGpRewardHist) btnRefreshGpRewardHist.onclick = () => loadGpRewardHistory(user.uid);

    const btnRefreshMentees = $("btnRefreshMentees");
    if (btnRefreshMentees) btnRefreshMentees.onclick = () => loadMentees();

    loadMenteeIncome(user.uid);
    const btnRefreshMenteeIncome = $("btnRefreshMenteeIncome");
    if (btnRefreshMenteeIncome) btnRefreshMenteeIncome.onclick = () => loadMenteeIncome(user.uid);

    loadCoopOrders(user.uid);
    const btnRefreshCoopOrders = $("btnRefreshCoopOrders");
    if (btnRefreshCoopOrders) btnRefreshCoopOrders.onclick = () => loadCoopOrders(user.uid);

    // ── 내 쿠폰·바우쳐 초기화 ──
    initMyCoupons(user, data);
  } catch (err) {
    console.error("\uB9C8\uC774\uD398\uC774\uC9C0 \uCD08\uAE30\uD654 \uC2E4\uD328", err);
  }
});

// ─────────────────────────────────────────────────────────
// 바우처 지갑
// ─────────────────────────────────────────────────────────
(function initVoucherWallet() {
  const grid = $('voucherCardGrid');
  const emptyEl = $('voucherCardEmpty');
  const loadingEl = $('voucherCardLoading');
  const transferPanel = $('voucherTransferPanel');
  const burnPanel = $('voucherBurnPanel');
  const vwMyQrPanel = $('vwMyQrPanel');
  const vwQrCanvas = $('vwQrCanvas');
  const vwWalletAddr = $('vwWalletAddr');
  const btnVwCopyAddr = $('btnVwCopyAddr');
  const btnVwShowQr = $('btnVwShowQr');
  const btnVwHideQr = $('btnVwHideQr');

  if (!grid) return;  // 섹션이 없으면 건너뜀

  let _pendingVoucherId = null;
  let _pendingDocId = null;
  let _pendingCollection = null;
  let _pendingHexPrice = null;

  // ── 내 지갑 QR 렌더 ─────────────────────────────────────────────────────
  let _myWalletAddress = null;
  let _qrRendered = false;

  function drawQrPanel(address) {
    if (!vwMyQrPanel || !vwQrCanvas) return;
    if (vwWalletAddr) vwWalletAddr.textContent = address;
    if (!_qrRendered && window.QRCode) {
      QRCode.toCanvas(vwQrCanvas, address, { width: 180, margin: 2 }, (err) => {
        if (err) vwQrCanvas.style.display = 'none';
      });
      _qrRendered = true;
    }
    vwMyQrPanel.style.display = '';
    if (btnVwShowQr) btnVwShowQr.style.display = 'none';
  }

  // API 응답에 walletAddress가 있으면 캐시만 해둠 (패널은 버튼 클릭 시 열림)
  function renderWalletQr(address) {
    _myWalletAddress = address;
  }

  if (btnVwShowQr) {
    btnVwShowQr.addEventListener('click', async () => {
      // 이미 캐시된 주소 있으면 바로 표시
      if (_myWalletAddress) { drawQrPanel(_myWalletAddress); return; }
      // 없으면 Firestore에서 직접 조회
      btnVwShowQr.textContent = _t('voucher_wallet_loading');
      btnVwShowQr.disabled = true;
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error(_t('voucher_no_login'));
        const snap = await getDoc(doc(db, 'users', uid));
        const addr = snap.data()?.wallet?.address;
        if (!addr) throw new Error(_t('voucher_no_wallet'));
        _myWalletAddress = addr;
        drawQrPanel(addr);
      } catch (err) {
        btnVwShowQr.textContent = _t('voucher_wallet_btn_label');
        btnVwShowQr.disabled = false;
        alert(err.message || _t('addr_lookup_fail'));
      }
    });
  }

  if (btnVwHideQr) {
    btnVwHideQr.addEventListener('click', () => {
      if (vwMyQrPanel) vwMyQrPanel.style.display = 'none';
      if (btnVwShowQr) {
        btnVwShowQr.textContent = _t('voucher_wallet_btn_label');
        btnVwShowQr.disabled = false;
        btnVwShowQr.style.display = '';
      }
    });
  }

  if (btnVwCopyAddr) {
    btnVwCopyAddr.addEventListener('click', () => {
      const addr = vwWalletAddr?.textContent?.trim();
      if (!addr) return;
      navigator.clipboard.writeText(addr).then(() => {
        const orig = btnVwCopyAddr.textContent;
        btnVwCopyAddr.textContent = _t('btn_copy_done');
        setTimeout(() => { btnVwCopyAddr.textContent = orig; }, 1500);
      });
    });
  }

  // ── 이체 패널: QR 스캔으로 수신자 주소 입력 ────────────────────────────
  const btnVwQrScan = $('btnVwQrScan');
  if (btnVwQrScan) {
    btnVwQrScan.addEventListener('click', async () => {
      const overlay = $('qrScanOverlay');
      const video = $('qrVideo');
      const canvas = $('qrCanvas');
      const state = $('qrScanState');
      if (!overlay || !video || !canvas) return;

      // 기존 스캔 중지 후 재시작
      stopQrScan();

      try {
        if (state) state.textContent = _t('qr_start');
        overlay.classList.add('active');

        __qrStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        video.srcObject = __qrStream;
        await video.play();

        const onWalletDetected = (raw) => {
          const addr = raw.trim();
          const toInput = $('vtToAddress');
          if (toInput) toInput.value = addr;
          if (state) state.textContent = _t('qr_recognized_short', addr.slice(0, 20));
          setTimeout(() => stopQrScan(), 400);
        };

        if ('BarcodeDetector' in window) {
          if (state) state.textContent = _t('qr_hint');
          const bd = new BarcodeDetector({ formats: ['qr_code'] });
          let detecting = false;
          const detectTick = async () => {
            if (detecting) { __qrRaf = requestAnimationFrame(detectTick); return; }
            if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(detectTick); return; }
            detecting = true;
            try {
              const codes = await bd.detect(video);
              if (codes.length > 0) { onWalletDetected(codes[0].rawValue); return; }
            } catch { }
            detecting = false;
            __qrRaf = requestAnimationFrame(detectTick);
          };
          __qrRaf = requestAnimationFrame(detectTick);
          return;
        }

        if (!window.jsQR) { if (state) state.textContent = _t('qr_jsqr_fail'); return; }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let frameCount = 0;
        const tick = () => {
          if (!video.videoWidth || !video.videoHeight) { __qrRaf = requestAnimationFrame(tick); return; }
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
          if (qr?.data) { onWalletDetected(qr.data); return; }
          frameCount++;
          if (frameCount % 20 === 0 && state) state.textContent = _t('qr_scan_progress2');
          __qrRaf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (state) state.textContent = _t('qr_camera_fail');
        stopQrScan();
      }
    });
  }

  function setVtStatus(msg, ok) {
    const el = $('vtStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#16a34a' : ok === false ? '#e53e3e' : '#6b7280';
  }
  function setVbStatus(msg, ok) {
    const el = $('vbStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#16a34a' : ok === false ? '#e53e3e' : '#6b7280';
  }

  function fmtHexShort(weiStr) {
    try { return (Number(BigInt(weiStr)) / 1e18).toFixed(4); }
    catch { return weiStr; }
  }

  // FX 헬퍼 — coopGetMyVouchers 응답의 fxKrwPerHexScaled / fxScale 사용
  let _vFx = { krw: 0, vnd: 0, scale: 1 };
  function hexWeiToKrwStr(weiStr) {
    if (!_vFx.krw || !weiStr || weiStr === '0') return '';
    const hex = Number(BigInt(weiStr)) / 1e18;
    return Math.round(hex * _vFx.krw).toLocaleString() + ' ₩';
  }
  function hexWeiToVndStr(weiStr) {
    if (!_vFx.vnd || !weiStr || weiStr === '0') return '';
    const hex = Number(BigInt(weiStr)) / 1e18;
    return Math.round(hex * _vFx.vnd).toLocaleString() + ' ₫';
  }

  function renderVoucherCards(vouchers) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (!vouchers.length) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const frag = document.createDocumentFragment();
    vouchers.forEach(v => {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--border,#e5e7eb);border-radius:10px;overflow:hidden;background:var(--surface,#fff);';
      const imgSrc = v.imageUrl || '';
      const imgTag = imgSrc
        ? `<img src="${imgSrc}" alt="${_t('voucher_default_name')}" style="width:100%;height:110px;object-fit:cover;display:block;background:#f3f4f6;" onerror="this.style.display='none'">`
        : `<div style="width:100%;height:60px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.4rem;">🎫</div>`;
      const isGameVoucher = v.source === 'game';
      const isProductVoucher = v.source === 'product';
      const isCommunityVoucher = v.source === 'community';
      // 서비스 바우처는 voucherId(숫자), 나머지는 docId(Firestore 문서 ID) 사용
      const vid = (isProductVoucher || isGameVoucher || isCommunityVoucher) ? null : v.voucherId;
      const docId = v.id;
      const col = isGameVoucher ? 'treasure_voucher_logs'
        : isCommunityVoucher ? 'community_event_vouchers'
          : 'coop';
      const hp = v.hexPrice ?? '0';
      const refundWei = (!isGameVoucher && hp !== '0')
        ? String(BigInt(hp) - BigInt(hp) * BigInt(v.burnFeeBps ?? 0) / BigInt(10000))
        : '0';

      // 소스 배지
      const sourceBadge = isGameVoucher
        ? `<span style="font-size:0.7rem;background:#d1fae5;color:#065f46;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:5px;">${_t('voucher_game_badge')}</span>`
        : isCommunityVoucher
          ? `<span style="font-size:0.7rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:5px;">행사</span>`
          : `<span style="font-size:0.7rem;background:#ede9fe;color:#5b21b6;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:5px;">${_t('voucher_shop_badge')}</span>`;

      // 가격 영역
      let priceHtml;
      if (isGameVoucher) {
        priceHtml = `<div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:6px;">${_t('voucher_game_src')}</div>`;
      } else if (isCommunityVoucher) {
        const vndStr = v.priceVnd ? v.priceVnd.toLocaleString() + ' ₫' : '';
        const krwStr = hexWeiToKrwStr(hp);
        const fxLine = (krwStr || vndStr) ? `<span style="color:#9ca3af;">${[krwStr, vndStr].filter(Boolean).join(' / ')}</span>` : '';
        const refundLine = refundWei !== '0' ? `<br>${_t('voucher_refund', fmtHexShort(refundWei))}` : '';
        priceHtml = `<div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:6px;">${_t('voucher_price', fmtHexShort(hp))}${refundLine}<br>${fxLine}</div>`;
      } else {
        const krwStr = hexWeiToKrwStr(hp);
        const vndStr = hexWeiToVndStr(hp);
        const fxLine = (krwStr || vndStr)
          ? `<span style="color:#9ca3af;">${[krwStr, vndStr].filter(Boolean).join(' / ')}</span>`
          : '';
        const refundLine = refundWei !== '0' ? `<br>${_t('voucher_refund', fmtHexShort(refundWei))}` : '';
        priceHtml = `<div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:6px;">${_t('voucher_price', fmtHexShort(hp))}${refundLine}<br>${fxLine}</div>`;
      }

      // 이체/소각 버튼
      const actionHtml = `<div style="display:flex;gap:6px;">
           <button data-docid="${docId}" data-vid="${vid ?? ''}" data-collection="${col}" data-action="transfer"
             style="flex:1;padding:6px 0;background:var(--accent,#7c3aed);color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">
             ${_t('btn_voucher_transfer')}
           </button>
           <button data-docid="${docId}" data-vid="${vid ?? ''}" data-collection="${col}" data-hex-price="${hp}" data-burn-fee-bps="${v.burnFeeBps ?? 0}" data-action="burn"
             style="flex:1;padding:6px 0;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">
             ${_t('btn_voucher_burn')}
           </button>
         </div>`;

      card.innerHTML = `
        ${imgTag}
        <div style="padding:10px 12px;">
          ${sourceBadge}
          <div style="font-weight:700;font-size:0.92rem;margin-bottom:3px;">${v.description || _t('voucher_default_name')}</div>
          <div style="font-size:0.78rem;color:var(--muted,#6b7280);margin-bottom:2px;">${_t('voucher_usage_label')} ${v.usagePlace || '—'}</div>
          ${priceHtml}
          ${actionHtml}
        </div>`;
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);

    // 이체 버튼
    grid.querySelectorAll('[data-action="transfer"]').forEach(btn => {
      btn.addEventListener('click', () => {
        _pendingDocId = btn.dataset.docid || null;
        _pendingVoucherId = btn.dataset.vid ? Number(btn.dataset.vid) : null;
        _pendingCollection = btn.dataset.collection || null;
        const label = _pendingVoucherId ? `#${_pendingVoucherId}` : (_pendingDocId ? _pendingDocId.slice(0, 8) + '…' : '?');
        if ($('vtVoucherId')) $('vtVoucherId').textContent = label;
        if ($('vtToAddress')) $('vtToAddress').value = '';
        setVtStatus('');
        transferPanel.style.display = '';
        burnPanel.style.display = 'none';
        transferPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    // 소각 버튼
    grid.querySelectorAll('[data-action="burn"]').forEach(btn => {
      btn.addEventListener('click', () => {
        _pendingDocId = btn.dataset.docid || null;
        _pendingVoucherId = btn.dataset.vid ? Number(btn.dataset.vid) : null;
        _pendingCollection = btn.dataset.collection || null;
        _pendingHexPrice = btn.dataset.hexPrice ?? '0';
        const hp = _pendingHexPrice;
        const bps = Number(btn.dataset.burnFeeBps ?? 0);
        const isGame = _pendingCollection === 'treasure_voucher_logs'
          || (_pendingCollection === 'community_event_vouchers' && (!hp || hp === '0'));
        const label = _pendingVoucherId ? `#${_pendingVoucherId}` : _t('burn_selected_voucher');
        if ($('vbInfo')) {
          if (isGame) {
            $('vbInfo').innerHTML = _t('burn_game_info', label);
          } else {
            const fee = BigInt(hp) * BigInt(bps) / BigInt(10000);
            const refund = BigInt(hp) - fee;
            const refundKrw = hexWeiToKrwStr(String(refund));
            const refundVnd = hexWeiToVndStr(String(refund));
            const fxNote = (refundKrw || refundVnd)
              ? ` <span style="font-size:0.8em;color:#9ca3af;">(${[refundKrw, refundVnd].filter(Boolean).join(' / ')})</span>`
              : '';
            $('vbInfo').innerHTML = _t('burn_info', label, fmtHexShort(String(refund)), fxNote, fmtHexShort(String(fee)));
          }
        }
        // 게임 바우처는 단계 레이블 교체
        if (isGame) {
          if ($('vbStep2Label')) $('vbStep2Label').textContent = _t('burn_step2_game');
          if ($('vbStep3Label')) $('vbStep3Label').textContent = _t('burn_step3_game');
          if ($('vbStep2')) $('vbStep2').style.display = '';
          if ($('vbStep3')) $('vbStep3').style.display = '';
        } else {
          if ($('vbStep2Label')) $('vbStep2Label').textContent = _t('burn_step2_onchain');
          if ($('vbStep3Label')) $('vbStep3Label').textContent = _t('burn_step3_onchain');
        }
        setVbStatus('');
        burnPanel.style.display = '';
        transferPanel.style.display = 'none';
        burnPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }

  async function loadMyVouchers() {
    if (loadingEl) loadingEl.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';
    grid.innerHTML = '';
    try {
      const fn = httpsCallable(functions, 'coopGetMyVouchers');
      const res = await fn();
      const d = res.data ?? {};
      // FX 환율 저장
      if (d.fxScale) {
        _vFx.krw = d.fxKrwPerHexScaled ? Number(d.fxKrwPerHexScaled) / d.fxScale : 0;
        _vFx.vnd = d.fxVndPerHexScaled ? Number(d.fxVndPerHexScaled) / d.fxScale : 0;
        _vFx.scale = d.fxScale;
      }
      if (d.walletAddress) renderWalletQr(d.walletAddress);
      renderVoucherCards(d.vouchers ?? []);
    } catch (err) {
      if (loadingEl) { loadingEl.textContent = _t('voucher_load_error', err.message || _t('server_error')); }
    }
  }

  // 이체 확인
  $('btnVtConfirm')?.addEventListener('click', async () => {
    const toAddress = ($('vtToAddress')?.value ?? '').trim();
    if (!toAddress) { setVtStatus(_t('transfer_no_addr'), false); return; }
    if (!_pendingDocId && _pendingVoucherId === null) return;
    const btn = $('btnVtConfirm');
    btn.disabled = true;
    setVtStatus(_t('transfer_pending'));
    try {
      const fn = httpsCallable(functions, 'coopTransferVoucher');
      await fn({
        docId: _pendingDocId || undefined,
        voucherId: _pendingVoucherId ?? undefined,
        toAddress,
        sourceCollection: _pendingCollection || undefined,
      });
      setVtStatus(_t('transfer_done'), true);
      transferPanel.style.display = 'none';
      _pendingVoucherId = null;
      _pendingDocId = null;
      _pendingCollection = null;
      await loadMyVouchers();
    } catch (err) {
      setVtStatus(_t('transfer_error', err.message || _t('server_error')), false);
    } finally {
      btn.disabled = false;
    }
  });

  $('btnVtCancel')?.addEventListener('click', () => {
    transferPanel.style.display = 'none';
    _pendingVoucherId = null;
    _pendingDocId = null;
    _pendingCollection = null;
    _pendingHexPrice = null;
  });

  // 소각 확인
  $('btnVbConfirm')?.addEventListener('click', async () => {
    if (!_pendingDocId && _pendingVoucherId === null) return;
    const btn = $('btnVbConfirm');
    const cancelBtn = $('btnVbCancel');
    const stepsEl = $('vbSteps');
    const buttonsEl = $('vbButtons');

    // 단계 아이콘 갱신 헬퍼
    const stepState = (n, state) => {
      const icon = $(`vbStep${n}Icon`);
      const row = $(`vbStep${n}`);
      if (!icon || !row) return;
      const map = { wait: ['⏳', '#9ca3af'], active: ['🔄', '#d97706'], done: ['✅', '#16a34a'], error: ['❌', '#ef4444'] };
      const [emoji, color] = map[state] || map.wait;
      icon.textContent = emoji;
      row.style.color = color;
      if (state === 'active') row.style.fontWeight = '700';
    };

    // UI → 진행 모드
    btn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (buttonsEl) buttonsEl.style.opacity = '0.4';
    if (stepsEl) stepsEl.style.display = '';
    setVbStatus('');
    [1, 2, 3, 4].forEach(n => stepState(n, 'wait'));

    // community 바우처는 hexPrice > 0 이면 서비스 환급 흐름 (product와 동일)
    const isGameBurnFlow = _pendingCollection === 'treasure_voucher_logs'
      || (_pendingCollection === 'community_event_vouchers' && (!_pendingHexPrice || _pendingHexPrice === '0'));
    let progressTimer = null;
    try {
      stepState(1, 'active');
      const fn = httpsCallable(functions, 'coopBurnVoucher', { timeout: 120000 });

      if (!isGameBurnFlow) {
        // 상품 바우처: 타이머로 단계 시각적 전진
        let step = 1;
        progressTimer = setInterval(() => {
          if (step >= 3) return;
          stepState(step, 'done');
          step++;
          stepState(step, 'active');
        }, 4000);
      }

      await fn({
        docId: _pendingDocId || undefined,
        voucherId: _pendingVoucherId ?? undefined,
        sourceCollection: _pendingCollection || undefined,
      });

      clearInterval(progressTimer);

      // 남은 단계 완료 처리
      for (let n = 1; n <= 3; n++) stepState(n, 'done');
      stepState(4, 'active');
      await new Promise(r => setTimeout(r, 400));
      stepState(4, 'done');

      setVbStatus(isGameBurnFlow ? _t('burn_done_game') : _t('burn_done_onchain'), true);
      setTimeout(async () => {
        burnPanel.style.display = 'none';
        if (stepsEl) stepsEl.style.display = 'none';
        _pendingVoucherId = null;
        _pendingDocId = null;
        _pendingCollection = null;
        _pendingHexPrice = null;
        await loadMyVouchers();
      }, 1800);
    } catch (err) {
      clearInterval(progressTimer);
      // 현재 활성 단계를 에러로
      [1, 2, 3, 4].forEach(n => {
        const icon = $(`vbStep${n}Icon`);
        if (icon?.textContent === '🔄') stepState(n, 'error');
      });
      setVbStatus(_t('burn_error', err.message || _t('server_error')), false);
      btn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (buttonsEl) buttonsEl.style.opacity = '';
    }
  });

  $('btnVbCancel')?.addEventListener('click', () => {
    burnPanel.style.display = 'none';
    _pendingVoucherId = null;
    _pendingDocId = null;
    _pendingCollection = null;
    _pendingHexPrice = null;
  });

  // 섹션 열릴 때 첫 로드
  const section = $('voucherWalletSection');
  if (section) {
    section.querySelector('.mp-section-head')?.addEventListener('click', () => {
      const isCollapsed = section.classList.contains('is-collapsed');
      if (isCollapsed && !grid.children.length) loadMyVouchers();
    }, { once: true });
  }
})();

// ── 앱 캐시 초기화 ──
(function bindClearCache() {
  const btn = $("btnClearCache");
  const msg = $("clearCacheMsg");
  if (!btn) return;

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = _t('cache_loading');

    try {
      // 1) Service Worker 캐시 전체 삭제
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }

      // 2) Service Worker 등록 해제
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }

      // 3) localStorage / sessionStorage 초기화
      localStorage.clear();
      sessionStorage.clear();

      if (msg) {
        msg.style.display = "";
        msg.textContent = _t('cache_done');
      }

      setTimeout(() => {
        // 강제 새로고침 (캐시 무시)
        location.href = location.pathname + "?v=" + Date.now();
      }, 3000);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = _t('btn_cache_reset');
      if (msg) { msg.style.display = ""; msg.textContent = _t('cache_error', err.message); }
    }
  };
})();


// ── 회원 탈퇴 ────────────────────────────────────────────────────────────────
(function bindWithdrawal() {
  const section = $('withdrawalSection');
  const checkbox = $('withdrawalConfirmCheck');
  const btn = $('btnWithdrawal');
  const statusEl = $('withdrawalStatus');
  const reasonEl = $('withdrawalReason');
  if (!section || !checkbox || !btn) return;

  // 아코디언 토글
  section.querySelector('.mp-section-head')?.addEventListener('click', () => {
    section.classList.toggle('is-collapsed');
  });

  // 체크박스 → 버튼 활성화
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    } else {
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
    }
  });

  // 탈퇴 버튼 클릭
  btn.addEventListener('click', async () => {
    if (!checkbox.checked) return;

    // 2차 확인 다이얼로그
    const confirmed = window.confirm(
      '⚠️ 최종 확인\n\n' +
      '탈퇴 시 아래 데이터가 모두 삭제됩니다:\n' +
      '  • 포인트 잔고 / BM 머니\n' +
      '  • 보너스 티켓(BT)\n' +
      '  • EXP · 레벨\n' +
      '  • 나의 멘티 연결 관계 (멘티들의 멘토 해제)\n' +
      '  • 모든 충전 · 결제 · 잭팟 내역\n\n' +
      '복구할 수 없습니다. 정말로 탈퇴하시겠습니까?'
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = '탈퇴 처리 중…';
    if (statusEl) statusEl.textContent = '';

    try {
      const fn = httpsCallable(functions, 'deleteMyAccount');
      await fn({ reason: reasonEl?.value?.trim() || '' });

      if (statusEl) {
        statusEl.style.color = '#15803d';
        statusEl.textContent = '✅ 탈퇴가 완료되었습니다. 잠시 후 메인 페이지로 이동합니다.';
      }

      // 로그아웃 후 홈으로 이동
      setTimeout(async () => {
        try {
          const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
          await signOut(auth);
        } catch (_) { /* auth 모듈 실패 시 무시 */ }
        location.href = '/';
      }, 2500);

    } catch (err) {
      btn.disabled = false;
      btn.textContent = '🗑️ 회원 탈퇴하기';
      if (statusEl) {
        statusEl.textContent = '❌ 탈퇴 실패: ' + (err.message || '서버 오류');
      }
    }
  });
})();

// ── 서비스 경험치 동기화 상태 UI ────────────────────────────────────────────────
// 레벨업 → Firestore 플래그 → 6시간 배치 또는 수동 동기화 → adminSetLevel() 1tx
function _renderOnChainSyncStatus(bp, uid) {
  const row = document.getElementById('onChainSyncRow');
  const container = document.getElementById('onChainSyncStatus');
  if (!row || !container) return;
  row.classList.remove('hidden');

  const pending = bp.pendingOnChainSync === true;
  const pendingLevel = bp.pendingOnChainLevel || null;
  const onChainLevel = bp.onChainLevel || null;
  const lastSyncAt = bp.lastOnChainSyncAt?.toDate?.() || null;
  const lastTxHash = bp.lastOnChainSyncTxHash || null;

  let statusHtml;
  if (pending && pendingLevel) {
    const lastSyncStr = lastSyncAt ? lastSyncAt.toLocaleDateString() : '—';
    statusHtml = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="background:#f59e0b;color:#000;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">
          ⏳ 동기화 대기 Lv.${pendingLevel}
        </span>
        <span style="font-size:11px;color:#9ca3af;">자동 동기화: 최대 6시간 이내</span>
        <button id="btnManualSync" style="
          padding:4px 12px;background:#3b82f6;color:#fff;border:none;
          border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
          지금 동기화
        </button>
      </div>`;
  } else if (onChainLevel) {
    const syncStr = lastSyncAt ? lastSyncAt.toLocaleDateString() : '—';
    const txShort = lastTxHash ? lastTxHash.slice(0, 10) + '…' : '';
    statusHtml = `
      <span style="background:#10b981;color:#fff;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">
        ✅ 서비스 Lv.${onChainLevel} 동기화됨
      </span>
      <span style="font-size:11px;color:#9ca3af;margin-left:6px;">${syncStr}${txShort ? ' · ' + txShort : ''}</span>`;
  } else {
    statusHtml = `<span style="font-size:11px;color:#6b7280;">서비스 레벨 미기록 (레벨업 후 자동 저장)</span>`;
  }

  container.innerHTML = statusHtml;

  // 수동 동기화 버튼 이벤트
  const manualBtn = document.getElementById('btnManualSync');
  if (!manualBtn) return;
  manualBtn.addEventListener('click', async () => {
    manualBtn.disabled = true;
    manualBtn.textContent = '동기화 중…';
    try {
      const fn = httpsCallable(functions, 'requestOnChainLevelSync');
      const res = await fn();
      if (res.data?.already) {
        manualBtn.textContent = '대기 없음';
      } else if (res.data?.skipped) {
        manualBtn.textContent = '이미 최신';
      } else {
        manualBtn.textContent = `✅ Lv.${res.data?.newLevel} 저장 완료`;
      }
    } catch (e) {
      manualBtn.disabled = false;
      manualBtn.textContent = '실패: ' + (e.message || '오류');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 🏪 내 가맹점 매출·고객 — BestERP 대시보드(admin/dashboard)와 같은 서버 함수로 계산한다.
// 매장 BM 결제 · 현금 결제(BT 발급) · 온라인 BM 결제 · 온라인 계좌이체를 모두 포함 (서버 기준)
// ─────────────────────────────────────────────────────────────────────────────
function msEsc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
// 게임 GP → Point 전환 시 게임 참여용으로 남겨 두는 GP (서버 convertGpToPoint 와 같은 값)
const GP_KEEP_MIN = 5000;

function msVnd(n) {
  return `₫ ${Number(n || 0).toLocaleString()}`;
}
function msDate(ms) {
  if (!ms) return "-";
  return new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Ho_Chi_Minh", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const MP_STATUS = { paid: ["결제 완료", "#166534", "#dcfce7"], pending: ["결제 대기", "#92400e", "#fef3c7"], cancelled: ["취소", "#64748b", "#f1f5f9"] };

async function loadMyPurchaseHistory() {
  const section = $("myPurchaseSection");
  const body = $("myPurchaseBody");
  if (!section || !body) return;
  section.style.display = "";
  body.innerHTML = '<p class="hint">불러오는 중...</p>';
  try {
    const res = await httpsCallable(functions, "getMyPurchaseHistory")({});
    const d = res.data || {};
    const t = d.totals || {};
    const items = d.items || [];
    if (!items.length) {
      body.innerHTML = '<p class="hint">아직 가맹점에서 결제한 내역이 없습니다.</p>';
      return;
    }
    const card = (label, value, sub = "") => `
      <div style="flex:1 1 140px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
        <div style="font-size:0.75rem; color:#64748b;">${label}</div>
        <div style="font-size:1.05rem; font-weight:800; color:#0f172a;">${value}</div>
        ${sub ? `<div style="font-size:0.72rem; color:#94a3b8;">${sub}</div>` : ""}
      </div>`;
    const th = (x, right) => `<th style="padding:4px 6px; text-align:${right ? "right" : "left"}; font-size:0.75rem; color:#64748b; border-bottom:1px solid #e2e8f0; white-space:nowrap;">${x}</th>`;

    const merchantRows = (d.merchants || []).slice(0, 10).map(m => `
      <tr><td style="padding:4px 6px;">${msEsc(m.merchantName || m.merchantId || "-")}</td>
      <td style="padding:4px 6px; text-align:right;">${m.count}회</td>
      <td style="padding:4px 6px; text-align:right; font-weight:700;">${msVnd(m.vnd)}</td>
      <td style="padding:4px 6px; text-align:right; color:#64748b; white-space:nowrap;">${msDate(m.lastAtMs)}</td></tr>`).join("");

    const itemRows = items.slice(0, 100).map(i => {
      const st = MP_STATUS[i.status] || MP_STATUS.paid;
      return `<tr style="${i.status === "cancelled" ? "opacity:0.55;" : ""}">
        <td style="padding:4px 6px; white-space:nowrap;">${msDate(i.atMs)}</td>
        <td style="padding:4px 6px;">${msEsc(i.merchantName || i.merchantId || "-")}</td>
        <td style="padding:4px 6px;">${msEsc(i.label || "")}</td>
        <td style="padding:4px 6px; text-align:right; font-weight:700; white-space:nowrap;">${msVnd(i.amountVnd)}</td>
        <td style="padding:4px 6px; text-align:right;">${i.btReceived ? `${Number(i.btReceived)} BT` : "-"}</td>
        <td style="padding:4px 6px;"><span style="font-size:0.72rem; font-weight:700; padding:1px 7px; border-radius:999px; color:${st[1]}; background:${st[2]}; white-space:nowrap;">${st[0]}</span></td></tr>`;
    }).join("");

    body.innerHTML = `
      <p class="hint muted" style="margin-bottom:8px;">내가 고객으로 모든 가맹점에서 결제한 내역입니다. 매장 BM 결제, 현금 결제(BT 수령), 온라인 BM 결제, 온라인 계좌이체를 모두 포함합니다.</p>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        ${card("총 구매액", msVnd(t.totalVnd), `${t.count || 0}건`)}
        ${card("BM 결제", msVnd(t.bmVnd))}
        ${card("이용 가맹점", `${t.merchantCount || 0}곳`)}
        ${card("받은 BT", `${Number(t.btReceived || 0).toLocaleString()} BT`)}
      </div>
      ${t.pendingCount ? `<p class="hint" style="margin-bottom:8px;">⏳ 결제 대기 주문 ${t.pendingCount}건 (${msVnd(t.pendingVnd)}) — 입금 확인 후 구매액에 반영됩니다.</p>` : ""}
      ${merchantRows ? `<h3 style="font-size:0.9rem; margin:8px 0 4px;">가맹점별</h3>
      <table style="width:100%; border-collapse:collapse; font-size:0.82rem; margin-bottom:12px;">
        <thead><tr>${th("가맹점")}${th("횟수", 1)}${th("구매액", 1)}${th("마지막", 1)}</tr></thead>
        <tbody>${merchantRows}</tbody></table>` : ""}
      <h3 style="font-size:0.9rem; margin:8px 0 4px;">구매 내역 (최근 ${Math.min(items.length, 100)}건)</h3>
      <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
        <thead><tr>${th("일시")}${th("가맹점")}${th("결제 방식")}${th("금액", 1)}${th("BT", 1)}${th("상태")}</tr></thead>
        <tbody>${itemRows}</tbody></table>`;
  } catch (err) {
    console.warn("getMyPurchaseHistory failed", err?.message);
    body.innerHTML = `<p class="hint muted">구매 내역을 불러오지 못했습니다. (${msEsc(err?.message || "")})</p>`;
  }
}

async function loadMerchantSalesSummary(merchantId) {
  const section = $("merchantSalesSection");
  const body = $("merchantSalesBody");
  if (!section || !body || !merchantId) return;
  section.style.display = "";
  body.innerHTML = '<p class="hint">불러오는 중...</p>';
  try {
    const res = await httpsCallable(functions, "getMerchantSalesSummary")({ merchantId });
    const d = res.data || {};
    const s = d.sales || {};
    const ch = d.channels || {};
    const cu = d.customers || {};

    const card = (label, value, sub = "") => `
      <div style="flex:1 1 140px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
        <div style="font-size:0.75rem; color:#64748b;">${label}</div>
        <div style="font-size:1.05rem; font-weight:800; color:#0f172a;">${value}</div>
        ${sub ? `<div style="font-size:0.72rem; color:#94a3b8;">${sub}</div>` : ""}
      </div>`;

    const channelRows = Object.values(ch).map(c => `
      <tr><td style="padding:4px 6px;">${msEsc(c.label)}</td>
      <td style="padding:4px 6px; text-align:right;">${c.count}건</td>
      <td style="padding:4px 6px; text-align:right; font-weight:700;">${msVnd(c.vnd)}</td>
      <td style="padding:4px 6px; text-align:right; color:#64748b;">${msVnd(c.monthVnd)}</td></tr>`).join("");

    const ledgerRows = (d.ledger || []).slice(0, 20).map(e => `
      <tr><td style="padding:4px 6px; white-space:nowrap;">${msDate(e.atMs)}</td>
      <td style="padding:4px 6px;">${msEsc(e.label)}</td>
      <td style="padding:4px 6px;">${msEsc(e.customerEmail || e.customerName || "-")}</td>
      <td style="padding:4px 6px; text-align:right; font-weight:700;">${msVnd(e.amountVnd)}</td></tr>`).join("");

    const custRows = (cu.list || []).slice(0, 20).map(c => `
      <tr><td style="padding:4px 6px;">${msEsc(c.name || "-")}</td>
      <td style="padding:4px 6px;">${msEsc(c.email || "이메일 미등록")}</td>
      <td style="padding:4px 6px; text-align:right;">${c.payCount}회</td>
      <td style="padding:4px 6px; text-align:right; font-weight:700;">${msVnd(c.spendVnd)}</td></tr>`).join("");

    const th = (t, right) => `<th style="padding:4px 6px; text-align:${right ? "right" : "left"}; font-size:0.75rem; color:#64748b; border-bottom:1px solid #e2e8f0;">${t}</th>`;

    body.innerHTML = `
      <p class="hint muted" style="margin-bottom:8px;">BestERP 대시보드와 같은 기준입니다. ${msEsc(d.basis || "")}</p>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        ${card("총 매출", msVnd(s.totalVnd), `${s.count || 0}건`)}
        ${card("오늘", msVnd(s.todayVnd))}
        ${card("이번 달", msVnd(s.monthVnd))}
        ${card("BM 정산 예정 (90%)", msVnd(s.settlementVnd), `수수료 ${msVnd(s.feeVnd)}`)}
        ${card("고객", `${cu.total || 0}명`, `결제 ${cu.buyers || 0} · 가입 ${cu.members || 0} · 멘티 ${cu.mentees || 0}`)}
      </div>
      ${s.pendingOrderCount ? `<p class="hint" style="margin-bottom:8px;">⏳ 결제 대기 주문 ${s.pendingOrderCount}건 (${msVnd(s.pendingOrderVnd)}) — 입금 확인 후 매출에 반영됩니다.</p>` : ""}
      <h3 style="font-size:0.9rem; margin:8px 0 4px;">결제 경로별 매출</h3>
      <table style="width:100%; border-collapse:collapse; font-size:0.82rem; margin-bottom:12px;">
        <thead><tr>${th("경로")}${th("건수", 1)}${th("누적", 1)}${th("이번 달", 1)}</tr></thead>
        <tbody>${channelRows}</tbody>
      </table>
      <h3 style="font-size:0.9rem; margin:8px 0 4px;">최근 매출 내역</h3>
      ${ledgerRows ? `<table style="width:100%; border-collapse:collapse; font-size:0.82rem; margin-bottom:12px;">
        <thead><tr>${th("일시")}${th("경로")}${th("고객")}${th("금액", 1)}</tr></thead>
        <tbody>${ledgerRows}</tbody></table>` : '<p class="hint">매출 내역이 없습니다.</p>'}
      <h3 style="font-size:0.9rem; margin:8px 0 4px;">고객 (결제액 순)</h3>
      ${custRows ? `<table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
        <thead><tr>${th("이름")}${th("이메일")}${th("결제", 1)}${th("결제액", 1)}</tr></thead>
        <tbody>${custRows}</tbody></table>` : '<p class="hint">고객이 없습니다.</p>'}`;
  } catch (err) {
    console.warn("getMerchantSalesSummary failed", err?.message);
    body.innerHTML = `<p class="hint muted">매출 정보를 불러오지 못했습니다. (${msEsc(err?.message || "")})</p>`;
  }
}
