// /assets/js/pages/admin_banners.js
import { auth, db } from "/assets/js/auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getStorage,
  ref as sRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const storage = getStorage();
const $ = (id) => document.getElementById(id);
let editingId = "";

function setState(msg) {
  const el = $("abState");
  if (el) el.textContent = msg || "";
}

function setHelp(msg, warn = false) {
  const el = $("abHelp");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = warn ? "#ef4444" : "#10b981";
}

function setFormEnabled(enabled) {
  const form = $("bannerForm");
  if (!form) return;
  form.querySelectorAll("input,select,button").forEach((el) => {
    if (el.id === "btnBnReset") return;
    el.disabled = !enabled;
  });
}

function sanitize(s) {
  return String(s ?? "").trim();
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function checkSuperAdmin(user) {
  if (!user) return false;
  const email = String(user.email || "").toLowerCase().trim();
  if (email === "hexttokenopbnb@gmail.com") return false;
  if (email === "daguri75@gmail.com") return true;

  try {
    const aSnap = await getDoc(doc(db, "admins", user.uid));
    if (aSnap.exists()) return true;
  } catch (_) {}

  try {
    const uSnap = await getDoc(doc(db, "users", user.uid));
    if (uSnap.exists()) {
      const ud = uSnap.data() || {};
      if (ud.isAdmin === true || ["SUPER_ADMIN", "CEO", "ADMIN", "admin"].includes(ud.role)) {
        return true;
      }
    }
  } catch (_) {}

  return false;
}

function updateLivePreview() {
  const title = sanitize($("bnTitle")?.value) || "배너 제목";
  const sub = sanitize($("bnSubtitle")?.value) || "배너 부제목 및 상세 설명이 여기에 표시됩니다.";
  const imgUrl = sanitize($("bnImageUrl")?.value) || "/assets/images/jump/BI.png";

  const prevTitle = $("prevTitle");
  const prevSub = $("prevSub");
  const prevImg = $("prevImg");

  if (prevTitle) prevTitle.textContent = title;
  if (prevSub) prevSub.textContent = sub;
  if (prevImg) {
    prevImg.src = imgUrl;
    prevImg.onerror = () => {
      prevImg.src = "/assets/images/jump/BI.png";
    };
  }
}

function sortBanners(list) {
  return list.sort((a, b) => {
    const aa = Number(a.sortOrder || 0);
    const bb = Number(b.sortOrder || 0);
    if (aa !== bb) return aa - bb;
    const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return bt - at;
  });
}

function resetForm() {
  editingId = "";
  const form = $("bannerForm");
  form?.reset();
  if ($("bnSort")) $("bnSort").value = "0";
  if ($("bnActive")) $("bnActive").value = "1";
  const saveBtn = $("btnBnSave");
  if (saveBtn) saveBtn.textContent = "배너 등록 저장";
  setHelp("");
  updateLivePreview();
}

function fillForm(row) {
  editingId = row.id;
  if ($("bnTitle")) $("bnTitle").value = row.title || "";
  if ($("bnSubtitle")) $("bnSubtitle").value = row.subtitle || "";
  if ($("bnImageUrl")) $("bnImageUrl").value = row.imageUrl || "";
  if ($("bnLinkUrl")) $("bnLinkUrl").value = row.linkUrl || "";
  if ($("bnSort")) $("bnSort").value = Number(row.sortOrder || 0);
  if ($("bnActive")) $("bnActive").value = row.active === false ? "0" : "1";
  const saveBtn = $("btnBnSave");
  if (saveBtn) saveBtn.textContent = "수정사항 저장";
  setHelp("배너 수정 모드", false);
  updateLivePreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cardHtml(row) {
  const active = row.active !== false;
  const title = esc(row.title || "제목 없음");
  const sub = esc(row.subtitle || "부제목 없음");
  const img = esc(row.imageUrl || "/assets/images/jump/BI.png");
  const link = esc(row.linkUrl || "-");
  const sort = Number(row.sortOrder || 0);

  return `
    <li class="ab-item" data-id="${esc(row.id)}">
      <div class="ab-item-row">
        <img class="ab-item-thumb" src="${img}" alt="${title}" onerror="this.src='/assets/images/jump/BI.png'" />
        <div class="ab-item-info">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="ab-item-title">${title}</div>
            <span class="ab-badge ${active ? "on" : "off"}">${active ? "노출 중" : "숨김"}</span>
          </div>
          <div class="ab-item-sub">${sub}</div>
          <div class="ab-item-meta">🔗 ${link} | 🔢 순서: ${sort}</div>
        </div>
      </div>
      <div class="ab-item-actions">
        <button class="btn btn--sm" type="button" data-act="edit">✏️ 수정</button>
        <button class="btn btn--sm btn--ghost" type="button" data-act="toggle">${active ? "👁️ 숨김" : "👁️ 노출"}</button>
        <button class="btn btn--sm" type="button" data-act="delete" style="color:#ef4444; border-color:#fca5a5;">🗑️ 삭제</button>
      </div>
    </li>`;
}

async function loadList() {
  const listEl = $("bannerList");
  if (!listEl) return;
  listEl.innerHTML = "<li style='color:#94a3b8;'>배너 목록 불러오는 중...</li>";

  try {
    const snap = await getDocs(query(collection(db, "sponsorBanners")));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    sortBanners(rows);

    if (!rows.length) {
      listEl.innerHTML = "<li style='color:#94a3b8; padding:20px; text-align:center;'>등록된 스폰서 배너가 없습니다.</li>";
      return;
    }

    listEl.innerHTML = rows.map(cardHtml).join("");
  } catch (e) {
    console.warn("loadList error:", e);
    listEl.innerHTML = "<li style='color:#ef4444;'>목록을 불러오지 못했습니다.</li>";
  }
}

async function handleFileUpload(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;

  const statusEl = $("uploadStatus");
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.textContent = `이미지 업로드 중... (${Math.round(file.size / 1024)} KB)`;
  }

  try {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `sponsor-banners/${Date.now()}_${cleanName}`;
    const fileRef = sRef(storage, filePath);

    await uploadBytes(fileRef, file, { contentType: file.type });
    const downloadUrl = await getDownloadURL(fileRef);

    if ($("bnImageUrl")) {
      $("bnImageUrl").value = downloadUrl;
      updateLivePreview();
    }
    if (statusEl) {
      statusEl.textContent = "✅ 이미지 업로드 완료!";
      statusEl.style.color = "#10b981";
      setTimeout(() => (statusEl.style.display = "none"), 3000);
    }
  } catch (err) {
    console.error("image upload error:", err);
    if (statusEl) {
      statusEl.textContent = `❌ 업로드 실패: ${err.message || err}`;
      statusEl.style.color = "#ef4444";
    }
  }
}

async function saveBanner(ev, user) {
  ev.preventDefault();
  const title = sanitize($("bnTitle")?.value);
  const subtitle = sanitize($("bnSubtitle")?.value);
  const imageUrl = sanitize($("bnImageUrl")?.value);
  const linkUrl = sanitize($("bnLinkUrl")?.value);
  const sortOrder = Number($("bnSort")?.value || "0");
  const active = $("bnActive")?.value !== "0";

  if (!title || !imageUrl || !linkUrl) {
    setHelp("제목, 이미지 URL, 링크 URL은 필수 항목입니다.", true);
    return;
  }

  const payload = {
    title,
    subtitle,
    imageUrl,
    linkUrl,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    active,
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || "",
  };

  try {
    if (editingId) {
      await updateDoc(doc(db, "sponsorBanners", editingId), payload);
      setHelp("✅ 배너가 성공적으로 수정되었습니다.");
    } else {
      await addDoc(collection(db, "sponsorBanners"), {
        ...payload,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "",
      });
      setHelp("✅ 새 스폰서 배너가 등록되었습니다.");
    }

    try {
      localStorage.removeItem("bc_cache_sponsor_banners");
    } catch (_) {}

    resetForm();
    await loadList();
  } catch (e) {
    console.warn("saveBanner error:", e);
    setHelp("저장 실패: 권한 또는 네트워크를 확인하세요.", true);
  }
}

async function onListClick(ev) {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const li = btn.closest(".ab-item");
  const id = li?.dataset?.id;
  if (!id) return;
  const act = btn.dataset.act;

  if (act === "delete") {
    if (!confirm("이 스폰서 배너를 삭제하시겠습니까?")) return;
    try {
      await deleteDoc(doc(db, "sponsorBanners", id));
      try { localStorage.removeItem("bc_cache_sponsor_banners"); } catch (_) {}
      await loadList();
    } catch (err) {
      alert("삭제 실패: " + (err.message || err));
    }
    return;
  }

  const snap = await getDoc(doc(db, "sponsorBanners", id));
  if (!snap.exists()) return;
  const row = { id: snap.id, ...snap.data() };

  if (act === "edit") {
    fillForm(row);
    return;
  }

  if (act === "toggle") {
    try {
      await updateDoc(doc(db, "sponsorBanners", id), {
        active: row.active === false,
        updatedAt: serverTimestamp(),
      });
      try { localStorage.removeItem("bc_cache_sponsor_banners"); } catch (_) {}
      await loadList();
    } catch (err) {
      alert("상태 변경 실패: " + (err.message || err));
    }
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setState("🔒 로그인이 필요합니다.");
    setFormEnabled(false);
    return;
  }

  const isSuper = await checkSuperAdmin(user);
  if (!isSuper) {
    setState("⛔ 수퍼 어드민 권한이 필요합니다.");
    setFormEnabled(false);
    setHelp("이 페이지는 최고 관리자(Super Admin)만 접근할 수 있습니다.", true);
    return;
  }

  setState(`👑 수퍼 어드민 인증됨 (${user.email || user.uid})`);
  setFormEnabled(true);

  $("btnBnReset")?.addEventListener("click", resetForm);
  $("bannerForm")?.addEventListener("submit", (e) => saveBanner(e, user));
  $("bannerList")?.addEventListener("click", onListClick);
  $("bnImageFile")?.addEventListener("change", handleFileUpload);

  // 실시간 미리보기 바인딩
  $("bnTitle")?.addEventListener("input", updateLivePreview);
  $("bnSubtitle")?.addEventListener("input", updateLivePreview);
  $("bnImageUrl")?.addEventListener("input", updateLivePreview);

  updateLivePreview();
  await loadList();
});
