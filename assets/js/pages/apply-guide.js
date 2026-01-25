// /assets/js/pages/apply-guide.js
import { onAuthReady } from "../auth.js";
import { db } from "/assets/js/firebase-init.js";
import { withdrawApplication } from "../admin-approve.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (s) => document.querySelector(s);

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // keep digits and leading plus
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^0-9]/g, "");
  return plus ? "+" + digits : digits;
}

function isValidPhone(p) {
  const digits = String(p || "").replace(/[^0-9]/g, "");
  return digits.length >= 10;
}

function setState(t) {
  const el = $("#applyState");
  if (el) el.textContent = t || "";
}

function showStatusBox({ status, reason }) {
  const box = $("#statusBox");
  const st = $("#statusText");
  const rr = $("#statusReasonRow");
  const rs = $("#statusReason");

  if (!box || !st || !rr || !rs) return;

  box.style.display = "block";
  st.textContent = status || "-";

  if (status === "rejected" && reason) {
    rr.style.display = "flex";
    rs.textContent = reason;
  } else {
    rr.style.display = "none";
    rs.textContent = "";
  }
}

function fillForm(app) {
  $("#intro").value = app?.profile?.intro || "";
  $("#phone").value = app?.profile?.phone || "";
  const kakao = app?.profile?.kakaoId ?? app?.kakaoId ?? "";
  const agree = Boolean(app?.agreeKakao ?? app?.profile?.agreeKakao);
  const kkEl = $("#kakaoId");
  if (kkEl) kkEl.value = kakao;
  const agEl = $("#agreeKakao");
  if (agEl) agEl.checked = agree;
  $("#walletAddress").value = app?.profile?.walletAddress || app?.walletAddress || "";
  $("#region").value = app?.profile?.region || "";
  $("#career").value = app?.profile?.career || "";
  $("#detail").value = app?.profile?.detail || "";
}

async function loadMyApplication(uid) {
  const ref = doc(db, "guideApplications", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

onAuthReady(async ({ user, profile }) => {
  const form = $("#applyForm");
  const btnSave = $("#btnSave");
  const btnWithdraw = $("#btnWithdraw");

  if (!form || !btnSave || !btnWithdraw) return;

  if (!user) {
    setState("로그인 필요");
    form.classList.add("hide");
    return;
  }

  const role = profile?.role || "user";

  // 이미 패밀리(role=guide)라면 신청이 불필요
  // (관리자는 테스트/대행 등록을 할 수 있게 허용)
  if (role === "guide") {
    setState("이미 패밀리로 승인된 계정입니다.");
    form.classList.add("hide");
    return;
  }

  form.classList.remove("hide");

  const uid = user.uid;
  const ref = doc(db, "guideApplications", uid);

  try {
    setState("내 신청서 확인 중...");
    const app = await loadMyApplication(uid);

    if (!app) {
      setState("신청서가 없습니다. 작성 후 저장하세요.");
      showStatusBox({ status: "none", reason: "" });
      fillForm(null);
    } else {
      const status = app.status || "pending";
      setState("");
      showStatusBox({ status, reason: app.rejectedReason || "" });
      fillForm(app);

      // rejected이면 수정 후 저장하면 다시 pending으로 올릴 수 있게 처리
      // approved이면 role이 guide로 바뀌어 이 페이지 접근 자체가 막힘
    }
  } catch (e) {
    console.error(e);
    setState(e?.message || e);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const phoneRaw = $("#phone").value.trim();
    const phone = normalizePhone(phoneRaw);
    const kakaoId = ($("#kakaoId")?.value || "").trim();
    const agreeKakao = Boolean($("#agreeKakao")?.checked);

    if (agreeKakao && !isValidPhone(phone)) {
      alert("자동 알림 수신에 동의한 경우, 휴대폰 번호를 올바르게 입력하세요.\n예: +82 10 1234 5678");
      return;
    }

    const payload = {
      uid,
      status: "pending",
      agreeKakao,
      profile: {
        intro: $("#intro").value.trim(),
        phone,
        kakaoId,
        walletAddress: $("#walletAddress").value.trim(),
        region: $("#region").value.trim(),
        career: $("#career").value.trim(),
        detail: $("#detail").value.trim(),
        agreeKakao,
      },
      walletAddress: $("#walletAddress").value.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      btnSave.disabled = true;

      const existing = await loadMyApplication(uid);
      if (!existing) payload.createdAt = serverTimestamp();

      await setDoc(ref, payload, { merge: true });

      const next = await loadMyApplication(uid);
      setState("");
      showStatusBox({ status: next?.status || "pending", reason: next?.rejectedReason || "" });

      alert("저장 완료 (pending)");
    } catch (err) {
      console.error(err);
      alert(err?.message || err);
    } finally {
      btnSave.disabled = false;
    }
  });

  btnWithdraw.addEventListener("click", async () => {
    if (!confirm("신청서를 삭제(철회)할까요?")) return;

    try {
      btnWithdraw.disabled = true;
      await withdrawApplication(uid);

      fillForm(null);
      setState("신청서가 없습니다. 작성 후 저장하세요.");
      showStatusBox({ status: "none", reason: "" });

      alert("신청서 삭제 완료");
    } catch (e) {
      console.error(e);
      alert(e?.message || e);
    } finally {
      btnWithdraw.disabled = false;
    }
  });
});
