// /assets/js/pages/home_utility_bar.js
// 홈 상단 하노이 생활 유틸리티 바: 실시간 KRW↔VND 환율 계산기 + 주간 3억 GP 마감 카운트다운 + PWA 알림 구독

import { auth, db } from "/assets/js/firebase-init.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const FX_CACHE_KEY = "bc_live_fx_v1";
const FX_CACHE_TTL_MS = 30 * 60 * 1000; // 30분
const PUSH_PREF_KEY = "bc_push_alerts_enabled";

let _fx = { krwPerUsd: 1380, vndPerUsd: 25400, updatedAt: 0, live: false };

function $(id) {
  return document.getElementById(id);
}

async function fetchLiveFx() {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.krwPerUsd && parsed.vndPerUsd && Date.now() - parsed.updatedAt < FX_CACHE_TTL_MS) {
        _fx = parsed;
        return _fx;
      }
    }
  } catch (_) {}

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    if (data?.result === "success" && data?.rates?.KRW && data?.rates?.VND) {
      _fx = {
        krwPerUsd: Number(data.rates.KRW),
        vndPerUsd: Number(data.rates.VND),
        updatedAt: Date.now(),
        live: true,
      };
      try {
        localStorage.setItem(FX_CACHE_KEY, JSON.stringify(_fx));
      } catch (_) {}
      // 전역 환율 객체도 최신화
      window.__jackpotFx = { krw: Math.round(_fx.krwPerUsd), vnd: Math.round(_fx.vndPerUsd) };
      return _fx;
    }
  } catch (_) {}

  return _fx;
}

function getNextSundayMidnightVnMs() {
  // 매주 일요일 00:00 (베트남 시간 UTC+7) 마감 기준
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowUtc = Date.now();
  const vnNow = new Date(nowUtc + VN_OFFSET_MS);

  const dayOfWeek = vnNow.getUTCDay(); // 0 = Sunday
  // 다음 일요일 00:00까지 남은 일수 (일요일이면 다음 주 일요일 00:00 = 7일 뒤)
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;

  const targetVn = Date.UTC(
    vnNow.getUTCFullYear(),
    vnNow.getUTCMonth(),
    vnNow.getUTCDate() + daysUntilSunday,
    0,
    0,
    0,
    0
  );
  return targetVn - VN_OFFSET_MS;
}

function formatCountdown(diffMs) {
  if (diffMs <= 0) return "곧 정산!";
  const totalSec = Math.floor(diffMs / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d}일 ${pad(h)}:${pad(m)}:${pad(s)}`;
}

function initCountdown() {
  const el = $("bcUtilCountdown");
  if (!el) return;

  const tick = () => {
    const target = getNextSundayMidnightVnMs();
    el.textContent = formatCountdown(target - Date.now());
  };
  tick();
  setInterval(tick, 1000);
}

function initFxWidget() {
  const rateText = $("bcUtilFxRate");
  const toggleBtn = $("bcUtilFxToggle");
  const calcDrawer = $("bcUtilFxDrawer");
  const inputKrw = $("bcFxInputKrw");
  const inputVnd = $("bcFxInputVnd");
  const usdInfo = $("bcFxUsdInfo");

  const renderRateSummary = () => {
    const vndPer10kKrw = Math.round((10000 / _fx.krwPerUsd) * _fx.vndPerUsd);
    if (rateText) {
      rateText.textContent = `1만원 ≈ ${vndPer10kKrw.toLocaleString("ko-KR")}₫`;
    }
    if (usdInfo) {
      usdInfo.textContent = `1 USD = ${Math.round(_fx.krwPerUsd).toLocaleString("ko-KR")}원 · ${Math.round(_fx.vndPerUsd).toLocaleString("ko-KR")}₫`;
    }
  };

  renderRateSummary();
  fetchLiveFx().then(() => {
    renderRateSummary();
    if (inputKrw && inputKrw.value) {
      const k = Number(inputKrw.value);
      if (k > 0 && inputVnd) {
        inputVnd.value = Math.round((k / _fx.krwPerUsd) * _fx.vndPerUsd);
      }
    }
  });

  if (toggleBtn && calcDrawer) {
    toggleBtn.addEventListener("click", () => {
      const open = calcDrawer.style.display === "none";
      calcDrawer.style.display = open ? "block" : "none";
      toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  if (inputKrw && inputVnd) {
    inputKrw.addEventListener("input", () => {
      const k = Number(inputKrw.value);
      if (!k || k <= 0) {
        inputVnd.value = "";
        return;
      }
      inputVnd.value = Math.round((k / _fx.krwPerUsd) * _fx.vndPerUsd);
    });

    inputVnd.addEventListener("input", () => {
      const v = Number(inputVnd.value);
      if (!v || v <= 0) {
        inputKrw.value = "";
        return;
      }
      inputKrw.value = Math.round((v / _fx.vndPerUsd) * _fx.krwPerUsd);
    });
  }

  document.querySelectorAll(".bc-fx-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vnd = Number(btn.dataset.vnd || 0);
      if (!vnd || !inputVnd || !inputKrw) return;
      inputVnd.value = vnd;
      inputKrw.value = Math.round((vnd / _fx.vndPerUsd) * _fx.krwPerUsd);
    });
  });
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  } catch (_) {
    return null;
  }
}

async function savePushPref(enabled) {
  try {
    localStorage.setItem(PUSH_PREF_KEY, enabled ? "1" : "0");
  } catch (_) {}

  const user = auth?.currentUser;
  if (!user || user.isAnonymous) return;

  try {
    await setDoc(
      doc(db, "users", user.uid),
      {
        pushAlertsEnabled: enabled,
        pushTopics: enabled ? ["coop_deal", "weekly_ranking", "used_chat", "merchant_reward"] : [],
        pushUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (_) {}
}

function initPushAlertButton() {
  const btn = $("bcUtilPushBtn");
  const statusEl = $("bcUtilPushLabel");
  if (!btn || !statusEl) return;

  const isSupported = "Notification" in window;

  const updateUi = () => {
    if (!isSupported) {
      statusEl.textContent = "알림 미지원 브라우저";
      btn.classList.remove("is-active");
      return;
    }
    const granted = Notification.permission === "granted" && localStorage.getItem(PUSH_PREF_KEY) !== "0";
    if (granted) {
      statusEl.textContent = "알림 켜짐 ✓";
      btn.classList.add("is-active");
    } else if (Notification.permission === "denied") {
      statusEl.textContent = "브라우저 알림 차단됨";
      btn.classList.remove("is-active");
    } else {
      statusEl.textContent = "특가·랭킹 알림 받기";
      btn.classList.remove("is-active");
    }
  };

  updateUi();

  btn.addEventListener("click", async () => {
    if (!isSupported) {
      alert("현재 브라우저에서는 웹 푸시 알림을 지원하지 않습니다. Chrome/Safari 앱으로 홈 화면에 추가해 이용해 주세요.");
      return;
    }

    if (Notification.permission === "denied") {
      alert("브라우저 주소창 왼쪽 설정 아이콘에서 '알림 허용'으로 변경해 주세요.");
      return;
    }

    const alreadyOn = Notification.permission === "granted" && localStorage.getItem(PUSH_PREF_KEY) !== "0";
    if (alreadyOn) {
      await savePushPref(false);
      updateUi();
      return;
    }

    btn.disabled = true;
    statusEl.textContent = "설정 중...";
    try {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") {
        updateUi();
        return;
      }

      await savePushPref(true);
      const reg = await ensureServiceWorker();
      if (reg && reg.active) {
        reg.active.postMessage({
          type: "SHOW_LOCAL_NOTIFICATION",
          title: "🔔 베스트클럽 알림이 켜졌습니다!",
          body: "타임특가 오픈, 주간 3억 GP 게임 마감, 가맹점 혜택 소식을 가장 먼저 받아보세요.",
          url: "/mall.html",
          tag: "bestclub-welcome-alert",
        });
      }
      updateUi();
    } catch (_) {
      updateUi();
    } finally {
      btn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initFxWidget();
  initCountdown();
  initPushAlertButton();
});
