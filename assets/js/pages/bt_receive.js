// /assets/js/pages/bt_receive.js
// 가맹점 BM 결제 — 고객 결제 확인 페이지

import { onAuthReady } from "../auth.js";
import { login } from "../auth.js";
import { db, functions } from "/assets/js/firebase-init.js";
import { initSlot } from "/assets/js/jackpot-anim.js";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  increment,
  onSnapshot,
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
const rawMerchantId = params.get("merchant");
const merchantId = rawMerchantId?.trim();
const amount = Number(params.get("amount"));
const bt = Number(params.get("bt"));
const nonce = params.get("nonce");
const currency = (params.get("currency") || "VND").toUpperCase();

const isVnd = currency === "VND";

// 유효성 검증
const amountMin = isVnd ? 10000 : 1000;
if (!merchantId || !amount || !Number.isFinite(amount) || amount < amountMin) {
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
  let mSnap = await getDoc(doc(db, "merchants", String(merchantId)));
  if (!mSnap.exists()) {
    if (merchantId === "bestwinner") {
      mSnap = await getDoc(doc(db, "merchants", "1791605366"));
    } else if (merchantId === "1791605366") {
      mSnap = await getDoc(doc(db, "merchants", "bestwinner"));
    } else if (merchantId === "daehan_kimchi") {
      mSnap = await getDoc(doc(db, "merchants", "1791002036"));
    } else if (merchantId === "1791002036") {
      mSnap = await getDoc(doc(db, "merchants", "daehan_kimchi"));
    }
  }
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
    ? `${bt} BT 수령`
    : `${bt} BT 수령`;
  ["payMerchantNameLogin", "payMerchantNameReg", "payMerchantName"].forEach((id) => setText(id, merchantName));
  ["payAmountLogin", "payAmountReg", "payAmountDisp"].forEach((id) => setText(id, amountStr));
  setText("payHeroDesc", `${merchantName} — ${amountStr}`);

  // VND인 경우 KRW 환산 표시 제거하고 무료 보상 강조
  if (isVnd) {
    const withKrw = `${amount.toLocaleString()} VND 결제 → 무료 보상 (${bt} BT)`;
    ["payAmountLogin", "payAmountReg", "payAmountDisp"].forEach((id) => setText(id, withKrw));
    setText("payHeroDesc", `${merchantName} — ${withKrw}`);

    const btn = document.getElementById("btnPay");
    if (btn) btn.textContent = "무료 BT 보상받기";

    const title = document.querySelector(".pay-hero-title");
    if (title) title.textContent = "보상 티켓 수령";
  }
}

// ── 인증 처리 ─────────────────────────────────────────
let _authDone = false;
let _currentUser = null;

async function init() {
  try {
    await loadMerchant();
  } catch (_) {
    return; // 이미 invalidPanel 표시됨
  }

  onAuthReady(({ loggedIn, role, user }) => {
    if (_authDone) return;
    _authDone = true;
    _currentUser = user;

    if (!loggedIn) {
      show("needLoginPanel", true);
      const btn = $("btnLogin");
      if (btn) {
        btn.onclick = async () => {
          try {
            await login();
            // 로그인 완료되면 페이지 새로고침하여 결제 패널 표시 (파라미터 유지됨)
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

    // 정상 사용자 → 결제 패널 표시
    show("payPanel", true);
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

// ── 클라이언트 직통 BT 수령 (Cloud Function 미가동/billing 비활성화 대비) ──
async function receiveBtDirectFirestore(user, merchantId, amount, currency, bt, nonce, rewardId) {
  if (!user?.uid) throw new Error("로그인이 필요합니다.");
  const customerUid = user.uid;
  const numBt = Number(bt || 0);
  if (numBt <= 0) throw new Error("수령할 BT 수량이 올바르지 않습니다.");

  const checkTxId = 'RW_CLAIM_' + (rewardId || (merchantId + '_' + nonce));
  const checkTxRef = doc(db, 'transactions', checkTxId);

  let updatedMerchName = merchantName;

  await runTransaction(db, async (tx) => {
    // 1. 이미 수령한 티켓인지 확인
    const txSnap = await tx.get(checkTxRef);
    if (txSnap.exists()) throw new Error("이미 수령 완료된 티켓입니다.");

    // 2. 가맹점 정보 조회
    let mRef = doc(db, 'merchants', String(merchantId));
    let mSnap = await tx.get(mRef);
    if (!mSnap.exists()) {
      if (String(merchantId) === 'bestwinner') {
        mRef = doc(db, 'merchants', '1791605366');
        mSnap = await tx.get(mRef);
      } else if (String(merchantId) === '1791605366') {
        mRef = doc(db, 'merchants', 'bestwinner');
        mSnap = await tx.get(mRef);
      }
    }
    if (!mSnap.exists()) throw new Error("가맹점 정보를 찾을 수 없습니다.");
    const mData = mSnap.data() || {};
    updatedMerchName = mData.name || merchantName;

    const merchBtBal = Number(mData.btBalance || 0);
    if (merchBtBal < numBt) throw new Error("가맹점의 BT 잔고가 부족하여 지급할 수 없습니다.");

    // 3. 가맹점 BT 잔고 차감
    tx.update(mRef, {
      btBalance: Math.max(0, merchBtBal - numBt),
      updatedAt: serverTimestamp()
    });

    if (mData.ownerUid) {
      const ownerRef = doc(db, 'users', mData.ownerUid);
      tx.update(ownerRef, {
        btBalance: increment(-numBt)
      });
    }

    // 4. 고객에게 BT 적립
    const userRef = doc(db, 'users', customerUid);
    tx.update(userRef, {
      btBalance: increment(numBt)
    });

    // 5. 트랜잭션 기록
    tx.set(checkTxRef, {
      uid: customerUid,
      type: 'receive_bt',
      merchantId: String(merchantId),
      merchantName: updatedMerchName,
      bt: numBt,
      amountVnd: isVnd ? amount : 0,
      amountKrw: !isVnd ? amount : 0,
      rewardId: rewardId || null,
      nonce: String(nonce || ''),
      createdAt: serverTimestamp()
    });
  });

  return {
    merchantName: updatedMerchName,
    amountVnd: isVnd ? amount : 0,
    amountKrw: !isVnd ? amount : 0,
    bt: numBt
  };
}

// ── 결제 버튼 바인딩 ──────────────────────────────────
function bindPayButton() {
  const btn = $("btnPay");
  if (!btn) return;

  btn.onclick = async () => {
    if (!confirm(`${merchantName} 가맹점으로부터 ${bt} BT를 수령하시겠습니까?`)) return;

    btn.disabled = true;
    btn.textContent = "티켓 수령 중...";
    const stateEl = $("payState");
    if (stateEl) { stateEl.textContent = "티켓을 적립하고 있습니다..."; stateEl.style.display = ""; }

    try {
      let d = null;
      try {
        const payFn = httpsCallable(functions, "receiveBtQrFirebase");
        const payload = {
          rewardId: params.get("rewardId"),
          merchantId, amount, currency, bt, txHash: String(nonce), nonce
        };
        const res = await payFn(payload);
        d = res?.data;
      } catch (cfErr) {
        console.warn("receiveBtQrFirebase function unavailable, fallback to direct Firestore transaction:", cfErr);
        d = await receiveBtDirectFirestore(_currentUser, merchantId, amount, currency, bt, nonce, params.get("rewardId"));
      }

      // 완료 패널 표시
      show("payPanel", false);
      show("donePanel", true);

      const krwStr = `${(d?.amountKrw || 0).toLocaleString()}원`;
      const vndStr = d?.amountVnd ? `${Math.round(d.amountVnd).toLocaleString()}동` : '';
      let paidAmountStr = [krwStr, vndStr].filter(Boolean).join(" / "); paidAmountStr += ` (수령 BT: ${bt} BT)`;

      const resultEl = $("payResult");
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="mp-kv"><span class="k">가맹점</span><span class="v">${d?.merchantName || merchantName}</span></div>
          <div class="mp-kv"><span class="k">결제 금액</span><span class="v">${paidAmountStr}</span></div>
          <div style="margin-top:16px; background:#fef3c7; border:2px solid #f59e0b; padding:12px; border-radius:12px; text-align:center;">
             <h3 style="color:#d97706; margin-bottom:8px;">🎟️ 보너스 티켓 수령 완료!</h3>
             <p style="font-size:0.9rem; color:#92400e;">획득한 BT는 <b>마이페이지 (내 정보)</b>에서 확인하고 잭팟 굴리기에 사용할 수 있습니다!</p>
             <a href="/mypage.html" class="btn btn--sm" style="margin-top:10px; background:#f59e0b; color:#fff; border:none; padding:8px 20px; font-weight:700; text-decoration:none; display:inline-block; border-radius:8px;">마이페이지로 이동</a>
          </div>
        `;
      }
    } catch (err) {
      if (stateEl) stateEl.style.display = "none";
      alert("수령 실패: " + (err?.message || "서버 오류가 발생했습니다."));
      btn.disabled = false;
      btn.textContent = "수령하기";
    }
  };
}

// ── 결제 아이템 드롭 표시 ──────────────────────────────
function buildDropHtml(d) {
  return '';
}

// ── 잭팟 결과 감시 제거 ────────────────────────────────────
function watchJackpotResult(txHash) {
  // 옮겨짐: 이제 여기서 잭팟 애니메이션을 하지 않고 모두 마이페이지에서 수동 처리합니다.
  const box = $("jackpotResultBox");
  if (box) box.style.display = "none";
}

// ── 시작 ─────────────────────────────────────────────
init();
