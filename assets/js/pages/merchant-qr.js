// /assets/js/pages/merchant-qr.js
// 가맹점 QR 코드 생성 페이지

import { onAuthReady } from "../auth.js";
import { login } from "../auth.js";
import { db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { functions } from "/assets/js/firebase-init.js";

const $ = (id) => document.getElementById(id);

function show(id, on) {
  const el = $(id);
  if (el) el.style.display = on ? "" : "none";
}

// ── 환율 (표시 전용) ──────────────────────────────────
let _rates = null; // { krwPerUsd, vndPerUsd }

async function loadRates() {
  if (_rates) return _rates;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    const d = await r.json();
    if (d.result === "success" && d.rates?.KRW && d.rates?.VND) {
      _rates = { krwPerUsd: d.rates.KRW, vndPerUsd: d.rates.VND };
      return _rates;
    }
  } catch (_) { }
  _rates = { krwPerUsd: 1350, vndPerUsd: 25400 }; // 기본값 fallback
  return _rates;
}

function vndToKrw(vnd, rates) {
  return Math.round((vnd / rates.vndPerUsd) * rates.krwPerUsd);
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val != null ? String(val) : "-";
}

// ── 진입 처리 ─────────────────────────────────────────
let _authDone = false;
let _currentUid = null;
let _currentOwnerEmail = "";
let _merchantBtPerVnd = 100000;

function updateModeAndBt() {
  const modeBt = $("modeBt");
  const modeMentor = $("modeMentor");
  const isBt = !!modeBt?.checked;
  const isMentor = !!modeMentor?.checked;
  const amount = Number($("qrAmount")?.value || 0);
  const currency = "VND";

  const labelEl = $("qrAmountLabel");
  const helpEl = $("qrAmountHelp");
  const btCalcResult = $("qrBtCalcResult");
  const btCountText = $("qrBtCount");
  const amountWrap = $("qrAmountFieldWrap");
  const amountInput = $("qrAmount");
  const mentorInfo = $("mentorModeInfo");

  if (amountWrap) amountWrap.style.display = isMentor ? "none" : "";
  if (mentorInfo) mentorInfo.style.display = isMentor ? "block" : "none";
  if (amountInput) amountInput.required = !isMentor;

  if (isBt) {
    if (labelEl) labelEl.textContent = "무료 BT 보상 기준금액 (VND)";
    if (helpEl) helpEl.textContent = "고객이 타 수단으로 결제한 금액을 입력하면 비례하여 BT 무료 보상 QR이 생성됩니다.";
  } else if (!isMentor) {
    if (labelEl) labelEl.textContent = "앱결제 받을 금액 (단위 VND)";
    if (helpEl) helpEl.textContent = "최소 10,000 VND 이상 입력해주세요.";
  }

  if (isBt && amount > 0) {
    if (btCalcResult) btCalcResult.style.display = "";
    const count = getBtAmount(amount, currency);
    const rate = Math.max(1000, Number(_merchantBtPerVnd || 100000));
    if (btCountText) btCountText.textContent = `${count} 장 (${rate.toLocaleString()} VND당 1장)`;
  } else {
    if (btCalcResult) btCalcResult.style.display = "none";
  }

  // 모드에 따라 버튼 텍스트 변경
  const btnGen = $("btnGenQr");
  if (btnGen) {
    if (isMentor) btnGen.textContent = "👥 매장 멘티 자동가입 QR 생성";
    else if (isBt) btnGen.textContent = "무료 BT 보상 QR 발급";
    else btnGen.textContent = "결제 QR 생성";
  }
}

onAuthReady(async ({ loggedIn, role, user }) => {
  if (_authDone) return;

  if (!loggedIn) {
    show("needLoginPanel", true);
    const btn = $("btnLogin");
    if (btn) btn.onclick = () => { location.href = "/register.html"; };
    return;
  }

  if (role !== "merchant" && role !== "admin") {
    alert("가맹점 계정만 이용 가능합니다.");
    location.href = "/family-register.html";
    return;
  }

  _authDone = true;
  _currentUid = user.uid;
  _currentOwnerEmail = (user.email || "").toLowerCase();
  await initPage(user.uid);
});

// 4초 내 로그인 없으면 로그인 안내
setTimeout(() => {
  if (!_authDone) {
    show("needLoginPanel", true);
    const btn = $("btnLogin");
    if (btn) btn.onclick = () => { location.href = "/register.html"; };
  }
}, 4000);

// ── 페이지 초기화 ─────────────────────────────────────
async function initPage(uid) {
  // 유저 문서에서 merchantId 조회
  const userSnap = await getDoc(doc(db, "users", uid));
  const userData = userSnap.data() || {};
  const merchantId = userData.merchantId;
  if (!_currentOwnerEmail && userData.email) {
    _currentOwnerEmail = String(userData.email).toLowerCase();
  }

  if (merchantId == null) {
    show("needMerchantPanel", true);
    return;
  }

  // 가맹점 정보 조회
  const mSnap = await getDoc(doc(db, "merchants", String(merchantId)));
  const merchantName = mSnap.exists() ? (mSnap.data()?.name || "가맹점") : "가맹점";
  if (mSnap.exists() && mSnap.data()?.ownerEmail) {
    _currentOwnerEmail = String(mSnap.data().ownerEmail).toLowerCase();
  }

  // 화면 표시
  setText("qrMerchantName", merchantName);

  // 실시간 K-Culture Balance & Payment Balance 모니터링
  onSnapshot(doc(db, "users", uid), (docS) => {
    const el = document.getElementById("merchBal");
    if (el && docS.exists()) el.textContent = Number(docS.data().pointBalanceVnd || 0).toLocaleString() + " BM";
  });

  // ── 가맹점 BT 재고 및 지급 기준금액(btPerVnd) 실시간 조회 ──
  onSnapshot(doc(db, "merchants", String(merchantId)), (mSnap2) => {
    if (mSnap2.exists()) {
      const data = mSnap2.data() || {};
      const btBal = Number(data.btBalance || 0);
      setText("qrMerchantBtBal", btBal.toLocaleString("ko-KR") + " BT");

      _merchantBtPerVnd = Math.max(1000, Number(data.btPerVnd || data.btGrantThresholdVnd || 100000));
      setText("qrMerchantBtPerVnd", `${_merchantBtPerVnd.toLocaleString("ko-KR")} VND당 1장`);
      updateModeAndBt();
    }
  });

  // ── 가맹점 BT 1장 지급 기준금액 설정 바인딩 ──
  const btnToggleBtSetting = $("btnToggleBtSetting");
  const btSettingBox = $("btSettingBox");
  const inputBtPerVnd = $("inputBtPerVnd");
  const btnSaveBtPerVnd = $("btnSaveBtPerVnd");
  const btSettingMsg = $("btSettingMsg");

  if (btnToggleBtSetting && btSettingBox) {
    btnToggleBtSetting.onclick = () => {
      const isHidden = btSettingBox.style.display === "none";
      btSettingBox.style.display = isHidden ? "block" : "none";
      btnToggleBtSetting.textContent = isHidden ? "닫기" : "기준 변경";
      if (isHidden && inputBtPerVnd) inputBtPerVnd.value = _merchantBtPerVnd;
    };
  }

  document.querySelectorAll(".btn-bt-preset").forEach((btn) => {
    btn.onclick = () => {
      if (inputBtPerVnd) inputBtPerVnd.value = btn.dataset.val;
    };
  });

  if (btnSaveBtPerVnd) {
    btnSaveBtPerVnd.onclick = async () => {
      const val = Number(inputBtPerVnd?.value);
      if (!val || val < 1000) {
        if (btSettingMsg) {
          btSettingMsg.textContent = "최소 1,000 VND 이상 입력해 주세요.";
          btSettingMsg.style.color = "#dc2626";
        }
        return;
      }

      btnSaveBtPerVnd.disabled = true;
      btnSaveBtPerVnd.textContent = "저장 중...";
      if (btSettingMsg) btSettingMsg.textContent = "";

      try {
        await updateDoc(doc(db, "merchants", String(merchantId)), {
          btPerVnd: val,
          updatedAt: serverTimestamp()
        });
        _merchantBtPerVnd = val;
        setText("qrMerchantBtPerVnd", `${val.toLocaleString("ko-KR")} VND당 1장`);
        if (btSettingMsg) {
          btSettingMsg.textContent = `✅ 기준이 ${val.toLocaleString("ko-KR")} VND당 1장으로 저장되었습니다!`;
          btSettingMsg.style.color = "#16a34a";
        }
        setTimeout(() => {
          if (btSettingBox) btSettingBox.style.display = "none";
          if (btnToggleBtSetting) btnToggleBtSetting.textContent = "기준 변경";
          if (btSettingMsg) btSettingMsg.textContent = "";
        }, 1500);

        // QR 계산 결과 즉시 재계산
        updateModeAndBt();
      } catch (err) {
        console.error("btPerVnd save error:", err);
        if (btSettingMsg) {
          btSettingMsg.textContent = "저장 실패: " + err.message;
          btSettingMsg.style.color = "#dc2626";
        }
      } finally {
        btnSaveBtPerVnd.disabled = false;
        btnSaveBtPerVnd.textContent = "저장";
      }
    };
  }

  // 가맹점주 BM/포인트 잔고 (merchant owner)
  const mOwner = mSnap.exists() ? mSnap.data()?.ownerUid : null;
  if (mOwner) {
    onSnapshot(doc(db, "users", mOwner), (snap) => {
      if (snap.exists()) {
        const { pointBalanceVnd = 0 } = snap.data();
        setText("qrMerchantPaymentBal", pointBalanceVnd.toLocaleString("ko-KR") + " BM (결제용)");
        setText("qrMerchantPointBal", (snap.data().pointBalance || 0).toLocaleString("ko-KR") + " P");
      }
    });
  }

  show("mainPanel", true);

  // 바인딩
  bindQrForm(merchantId, merchantName);
}

// ── QR 바인딩 ─────────────────────────────────────────
function bindQrForm(merchantId, merchantName) {
  const form = $("qrForm");
  if (!form) return;

  // 환산 표시 업데이트 함수
  async function updateConvert() {
    const isVnd = true;
    const inputEl = $("qrAmount");
    const convEl = $("qrAmountConvert");
    const krwEl = $("qrAmountKrw");
    if (!convEl || !krwEl) return;

    if (!isVnd) { convEl.style.display = "none"; return; }

    const val = Number(inputEl?.value);
    if (!val || val <= 0) { convEl.style.display = "none"; return; }

    convEl.style.display = "";
    krwEl.textContent = "계산 중..";
    const rates = await loadRates();
    krwEl.textContent = vndToKrw(val, rates).toLocaleString();
  }

  // 통화 UI: 무조건 VND
  const labelEl = $("qrAmountLabel");
  const helpEl = $("qrAmountHelp");
  const inputEl = $("qrAmount");
  if (labelEl) labelEl.textContent = "결제 금액 (단위 VND)";
  if (helpEl) helpEl.textContent = "최소 10,000 VND 이상 입력해주세요.";
  if (inputEl) {
    if (!inputEl.value) { // 초기 세팅 시에만
      inputEl.min = "10000";
      inputEl.step = "1000";
      inputEl.placeholder = "예: 200000";
      inputEl.value = "";
    }
  }
  updateConvert();

  // 금액 입력 환산 표시
  $("qrAmount")?.addEventListener("input", updateConvert);

  const modePay = $("modePay");
  const modeBt = $("modeBt");
  const modeMentor = $("modeMentor");

  modePay?.addEventListener("change", updateModeAndBt);
  modeBt?.addEventListener("change", updateModeAndBt);
  modeMentor?.addEventListener("change", updateModeAndBt);
  $("qrAmount")?.addEventListener("input", updateModeAndBt);

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const mode = form.querySelector("input[name='qrMode']:checked")?.value || "pay";
    const currency = "VND";

    if (mode === "mentor") {
      generateQr(merchantId, merchantName, 0, currency, "mentor");
      return;
    }

    const amountRaw = $("qrAmount")?.value || "";
    const amount = Number(amountRaw);

    if (!amount || amount < 10000) { alert("최소 10,000 VND 이상 입력해 주세요."); return; }

    generateQr(merchantId, merchantName, amount, currency, mode);
  });
}

// ── Point 변환 ──────────────────────────────────────────?
function weiToHex(weiStr) {
  if (!weiStr) return null;
  try {
    const n = BigInt(weiStr);
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    return Number(whole) + Number(frac) / 1e18;
  } catch (_) { return null; }
}

// ── 입금 내역 상태 ─────────────────────────────────────
let _receiptTotalVnd = 0;
let _receiptCount = 0;

function resetReceipts() {
  _receiptTotalVnd = 0;
  _receiptCount = 0;
  const list = $("receiptList");
  if (list) list.innerHTML = "";
  show("receiptWaiting", true);
  setText("receiptTotal", "총계: 0 VND");
}

function addReceiptItem(data, isNew = false) {
  const vndVal = data.amountVnd || (data.amountKrw ? vndToKrw(data.amountKrw, _rates || { krwPerUsd: 1350, vndPerUsd: 25400 }) : 0);
  if (!vndVal) return;

  _receiptTotalVnd += vndVal;
  _receiptCount += 1;

  // 대기 안내 숨기기
  show("receiptWaiting", false);

  // 총계 갱신
  setText("receiptTotal", `총계: ${_receiptTotalVnd.toLocaleString("ko-KR")} VND`);

  // 시각 포맷
  const ts = data.createdAt?.toDate?.() || new Date();
  const time = ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // 법정화폐 표시
  const cur = data.currency || "VND";
  const fiatAmt = cur === "VND" ? data.amountVnd : data.amountKrw;
  const fiatDisp = fiatAmt
    ? (cur === "VND" ? `${Number(fiatAmt).toLocaleString()}원` : `${Number(fiatAmt).toLocaleString()}원`)
    : "";

  // 카드 생성
  const item = document.createElement("div");
  item.className = `receipt-item${isNew ? " new-item" : ""}`;
  item.innerHTML = `
    <div class="ri-icon">${isNew ? "✅" : "💳"}</div>
    <div class="ri-body">
      <div class="ri-hex">+${vndVal.toLocaleString("ko-KR")} VND</div>
      ${fiatDisp ? `<div class="ri-fiat">결제: ${fiatDisp}</div>` : ""}
    </div>
    <div class="ri-time">${time}</div>
  `;

  // 최신 항목이 맨 위
  const list = $("receiptList");
  if (list) list.prepend(item);

  // new 스타일은 5초 후 해제
  if (isNew) setTimeout(() => item.classList.remove("new-item"), 5000);
}

// ── 카운터 인쇄용 멘티 초대 포스터 PNG 생성 ───────────────────
function downloadMentorPoster(qrCanvas, merchantId, merchantName) {
  const W = 800;
  const H = 1120;
  const pCanvas = document.createElement("canvas");
  pCanvas.width = W;
  pCanvas.height = H;
  const ctx = pCanvas.getContext("2d");
  if (!ctx) return;

  // 배경 그라데이션
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1e1b4b");
  bg.addColorStop(0.5, "#312e81");
  bg.addColorStop(1, "#4c1d95");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 상단 배지
  ctx.fillStyle = "rgba(253, 224, 71, 0.18)";
  ctx.beginPath();
  ctx.roundRect(210, 56, 380, 48, 24);
  ctx.fill();
  ctx.fillStyle = "#fde047";
  ctx.font = "bold 22px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BESTCLUB 공식 제휴 가맹점", W / 2, 88);

  // 매장명
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 46px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText(merchantName || "베스트클럽 가맹점", W / 2, 168);

  // 서브 카피
  ctx.fillStyle = "#e0e7ff";
  ctx.font = "bold 26px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText("QR 스캔 10초 가입하고 포인트·잭팟 받으세요!", W / 2, 218);

  // QR 흰색 카드
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(150, 260, 500, 500, 32);
  ctx.fill();
  ctx.drawImage(qrCanvas, 185, 295, 430, 430);

  // 혜택 박스
  ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
  ctx.beginPath();
  ctx.roundRect(70, 800, 660, 210, 22);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = "#fde047";
  ctx.font = "bold 24px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText("🎁 스캔 가입 즉시 혜택", 105, 848);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "600 22px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText("1. 신규 가입 즉시 1,000 GP 보너스 자동 지급", 105, 894);
  ctx.fillText("2. 가맹점 결제 시 보너스 티켓(BT) & 100% 당첨 잭팟", 105, 936);
  ctx.fillText("3. 매주 총상금 3억 GP 게임 토너먼트 · 공동구매 특가", 105, 978);

  // 하단 푸터
  ctx.textAlign = "center";
  ctx.fillStyle = "#c7d2fe";
  ctx.font = "bold 22px 'Pretendard', 'Malgun Gothic', sans-serif";
  ctx.fillText("bestclubvn.netlify.app", W / 2, 1068);

  const link = document.createElement("a");
  link.download = `bestclub-poster-${merchantId}.png`;
  link.href = pCanvas.toDataURL("image/png");
  link.click();
}

// ── QR 생성 ────────────────────────────────────────────
async function generateQr(merchantId, merchantName, amount, currency = "KRW", mode = "pay") {
  const canvas = $("qrCanvas");
  if (!canvas) return;

  const baseOrigin = location.origin;
  let btRewardAmount = 0;
  let url = `${baseOrigin}/pay.html?merchant=${merchantId}&amount=${amount}&currency=${currency}`;

  if (mode === "mentor") {
    const params = new URLSearchParams();
    if (_currentOwnerEmail) params.set("mentor", _currentOwnerEmail);
    params.set("merchant", String(merchantId));
    if (merchantName) params.set("mname", merchantName);
    url = `${baseOrigin}/register.html?${params.toString()}`;
  } else if (mode === "bt") {
    const btTokens = getBtAmount(amount, currency);
    if (!btTokens || btTokens <= 0) {
      alert("지급할 보너스 티켓(BT)이 0장입니다. 결제 금액을 확인해 주세요.");
      return;
    }
    btRewardAmount = btTokens;
    const nonce = Date.now();
    url = `${baseOrigin}/bt_receive.html?merchant=${merchantId}&amount=${amount}&currency=${currency}&bt=${btTokens}&nonce=${nonce}`;

    const btnGen = $("btnGenQr");
    if (btnGen) { btnGen.disabled = true; btnGen.textContent = "QR 생성 중.."; }

    try {
      const createSession = httpsCallable(functions, "createBtRewardSession");
      const res = await createSession({ amount });
      if (res?.data?.rewardId) {
        const { rewardId, btAmount } = res.data;
        if (btAmount) btRewardAmount = btAmount;
        url = `${baseOrigin}/bt_receive.html?merchant=${merchantId}&amount=${amount}&currency=${currency}&bt=${btRewardAmount}&rewardId=${rewardId}&nonce=${nonce}`;
      }
    } catch (sessionErr) {
      console.warn("createBtRewardSession unavailable, using direct QR generation:", sessionErr);
    } finally {
      if (btnGen) { btnGen.disabled = false; btnGen.textContent = "무료 BT 보상 QR 발급"; }
    }
  }

  // qrcode.js (CDN) API
  /* global QRCode */
  QRCode.toCanvas(canvas, url, { width: 280, margin: 2, color: { dark: "#1a1a2e", light: "#ffffff" } }, (err) => {
    if (err) {
      console.error("QR 생성 오류:", err);
      alert("QR 생성에 실패했습니다.");
      return;
    }

    // 카드 정보 업데이트
    let amountDisp = "";
    if (mode === "mentor") {
      amountDisp = "👥 매장 멘티 자동가입 QR";
    } else if (mode === "bt") {
      amountDisp = `무료 보상: ${btRewardAmount} BT (${amount.toLocaleString()} VND 결제)`;
    } else {
      amountDisp = currency === "VND" ? `${amount.toLocaleString()} BM` : `${amount.toLocaleString()}원 (KRW)`;
    }
    setText("qrCardMerchant", merchantName);
    setText("qrCardAmount", amountDisp);
    show("qrSection", true);

    const btnTest = $("btnTestPayLink");
    if (btnTest) {
      btnTest.href = url;
      if (mode === "mentor") btnTest.textContent = "🔗 멘티 가입 페이지 바로 열기 (테스트)";
      else if (mode === "bt") btnTest.textContent = "🔗 무료 BT 수령 페이지 바로 열기 (테스트)";
      else btnTest.textContent = "🔗 결제 페이지 바로 열기 (테스트)";
      btnTest.style.display = "block";
    }

    const btnPoster = $("btnDownloadPoster");
    const btnCopy = $("btnCopyInviteLink");
    if (btnPoster) {
      btnPoster.style.display = mode === "mentor" ? "block" : "none";
      btnPoster.onclick = () => downloadMentorPoster(canvas, merchantId, merchantName);
    }
    if (btnCopy) {
      btnCopy.style.display = mode === "mentor" ? "block" : "none";
      btnCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          btnCopy.textContent = "✅ 초대 링크가 복사되었습니다!";
          setTimeout(() => { btnCopy.textContent = "📋 가입 초대 링크 복사"; }, 2000);
        } catch (_) {
          prompt("아래 초대 링크를 복사해 주세요:", url);
        }
      };
    }

    const hintEl = document.querySelector("#qrSection .qr-hint");
    if (hintEl) {
      if (mode === "mentor") {
        hintEl.textContent = "고객이 스캔해 가입하면 사장님이 자동으로 멘토로 등록됩니다.";
      } else if (mode === "bt") {
        hintEl.textContent = "고객이 카메라로 QR을 스캔하면 무료 BT를 즉시 수령합니다.";
      } else {
        hintEl.textContent = "고객이 카메라로 QR을 스캔하면 결제 페이지가 열립니다.";
      }
    }

    // 다운로드 버튼
    const btnDl = $("btnDownloadQr");
    if (btnDl) {
      btnDl.onclick = () => {
        const link = document.createElement("a");
        link.download = `qr-${merchantId}-${mode}-${amount || "invite"}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      };
    }

    // 입금 확인 패널 표시 (결제 모드일 때만 입금 감지 활성화)
    if (mode === "pay") {
      resetReceipts();
      show("receiptSection", true);
      listenPayments(amount, currency);
    } else {
      show("receiptSection", false);
    }

    // 생성된 QR 영역으로 스크롤
    $("qrSection")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

// ?? ?시?결제 감? ???????????????????????????????????
let _unsubscribe = null;

function listenPayments(amount, currency = "KRW") {
  // 이전 리스너 해제
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  // QR 생성 시각 기준 — 이후 도착하는 결제만 감지
  const since = Timestamp.now();

  // uid 필터를 포함해야 Firestore 보안 규칙(resource.data.uid == request.auth.uid) 통과
  const q = query(
    collection(db, "transactions"),
    where("uid", "==", _currentUid),
    where("type", "==", "merchant_income"),
    where("createdAt", ">=", since),
    orderBy("createdAt", "desc"),
  );

  _unsubscribe = onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const d = change.doc.data();
      addReceiptItem(d, true);
      showPaymentAlert(d, amount, currency);
    });
  }, (err) => {
    console.error("listenPayments error:", err);
    // 인덱스 미생성 시 fallback 리스트 (type 필터 없이 표시)
    if (err?.code === "failed-precondition" || err?.message?.includes("index")) {
      console.warn("인덱스 미생성 시 fallback 리스트 (type 필터 없이 표시)");
      const q2 = query(
        collection(db, "transactions"),
        where("uid", "==", _currentUid),
        where("createdAt", ">=", since),
        orderBy("createdAt", "desc"),
      );
      _unsubscribe = onSnapshot(q2, (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const d = change.doc.data();
          if (d.type !== "merchant_income") return;
          addReceiptItem(d, true);
          showPaymentAlert(d, amount, currency);
        });
      }, (err2) => console.error("listenPayments fallback error:", err2));
    }
  });
}

function showPaymentAlert(data, expectedAmount, currency = "KRW") {
  // 기존 알림 제거
  document.getElementById("paymentAlert")?.remove();

  const netHex = data.netAmountWei
    ? parseFloat((BigInt(data.netAmountWei) / 10n ** 14n) / 10000).toFixed(4)
    : data.amountHex || "?";

  const cur = data.currency || currency;
  const amountDisp = cur === "VND"
    ? `${(data.amountVnd || expectedAmount || 0).toLocaleString()} BM`
    : `${(data.amountKrw || expectedAmount || 0).toLocaleString()}원 (KRW)`;

  const el = document.createElement("div");
  el.id = "paymentAlert";
  el.style.cssText = [
    "position:fixed", "top:80px", "left:50%", "transform:translateX(-50%)",
    "background:#16a34a", "color:#fff", "border-radius:12px",
    "padding:18px 28px", "z-index:9999", "box-shadow:0 4px 24px rgba(0,0,0,.3)",
    "text-align:center", "min-width:260px", "animation:fadeInDown .3s ease",
  ].join(";");

  const vndVal = data.amountVnd || (expectedAmount ? (cur === "VND" ? expectedAmount : vndToKrw(expectedAmount, _rates)) : 0);

  el.innerHTML = `
    <div style="font-size:2rem;margin-bottom:4px;">✅</div>
    <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">결제 완료!</div>
    <div style="font-size:0.95rem;opacity:.9;">고객 명의로 ${amountDisp} 결제완료</div>
    <div style="font-size:0.8rem;opacity:.7;margin-top:4px;">정산 금액: ${vndVal.toLocaleString("ko-KR")} BM</div>
    <button onclick="document.getElementById('paymentAlert').remove()"
      style="margin-top:10px;background:rgba(255,255,255,.2);border:none;color:#fff;
             border-radius:6px;padding:4px 16px;cursor:pointer;font-size:0.85rem;">닫기</button>
  `;

  document.body.appendChild(el);

  // 소리 (지원 시)
  try { new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAA==").play().catch(() => { }); } catch (_) { }

  // 10초 후 자동 제거
  setTimeout(() => { document.getElementById("paymentAlert")?.remove(); }, 10000);
}


function getBtAmount(amount, currency) {
  let vnd = amount;
  if (currency === "KRW") vnd = amount * 18;
  const rate = Math.max(1000, Number(_merchantBtPerVnd || 100000));
  return Math.floor(vnd / rate);
}


// 원격 전송 버튼
const btnRemoteBtSend = $("btnRemoteBtSend");
if (btnRemoteBtSend) {
  btnRemoteBtSend.onclick = async () => {
    const email = $("remoteUserEmail")?.value.trim();
    const amountVal = Number($("remoteVndAmount")?.value);
    const resBox = $("remoteBtResult");
    if (!email) return alert("고객 이메일을 입력해 주세요.");
    if (!amountVal || amountVal < 10000) return alert("결제 금액은 최소 10,000 VND 이상이어야 합니다.");

    try {
      btnRemoteBtSend.disabled = true;
      btnRemoteBtSend.textContent = "전송 중...";

      const merchantSendBtDirect = httpsCallable(functions, "merchantSendBtDirect");
      const res = await merchantSendBtDirect({ customerEmail: email, amountVnd: amountVal });

      if (resBox) {
        resBox.style.color = "blue";
        resBox.innerHTML = `전송 성공! ${res.data.customerEmail}님에게 ${res.data.btIssued} BT가 지급되었습니다.`;
      }
      if ($("remoteUserEmail")) $("remoteUserEmail").value = "";
      if ($("remoteVndAmount")) $("remoteVndAmount").value = "";
    } catch (err) {
      if (resBox) {
        resBox.style.color = "red";
        resBox.innerText = "오류: " + (err.message || "알 수 없는 오류");
      }
    } finally {
      btnRemoteBtSend.disabled = false;
      btnRemoteBtSend.innerHTML = `<i class="fa-solid fa-gift me-2"></i>BT 전송하기`;
    }
  };
}
