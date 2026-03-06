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

const $ = (id) => document.getElementById(id);
const OPERATOR_EMAILS = new Set(["daguri75@gmail.com"]);
let editingId = "";

function setState(msg) {
  const el = $("abState");
  if (el) el.textContent = msg || "";
}

function setHelp(msg, warn = false) {
  const el = $("abHelp");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = warn ? "#b91c1c" : "var(--muted)";
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

async function isAdmin(uid, email) {
  const em = String(email || "").toLowerCase().trim();
  if (em && OPERATOR_EMAILS.has(em)) return true;
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch {
    return false;
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
  $("bnSort").value = "0";
  $("bnActive").value = "1";
  const saveBtn = $("btnBnSave");
  if (saveBtn) saveBtn.textContent = "저장";
  setHelp("");
}

function fillForm(row) {
  editingId = row.id;
  $("bnTitle").value = row.title || "";
  $("bnSubtitle").value = row.subtitle || "";
  $("bnImageUrl").value = row.imageUrl || "";
  $("bnLinkUrl").value = row.linkUrl || "";
  $("bnSort").value = Number(row.sortOrder || 0);
  $("bnActive").value = row.active === false ? "0" : "1";
  const saveBtn = $("btnBnSave");
  if (saveBtn) saveBtn.textContent = "수정 저장";
}

function cardHtml(row) {
  const active = row.active !== false;
  return `
    <li class="ab-item" data-id="${esc(row.id)}">
      <div class="ab-item-top">
        <div>
          <div class="ab-item-title">${esc(row.title || "제목 없음")}</div>
          <div class="ab-item-sub">${esc(row.subtitle || "")}</div>
        </div>
        <span class="ab-badge ${active ? "on" : "off"}">${active ? "노출" : "숨김"}</span>
      </div>
      <img class="ab-thumb" src="${esc(row.imageUrl || "/assets/images/jump/BI.png")}" alt="banner" />
      <div class="ab-item-meta">링크: ${esc(row.linkUrl || "-")} | 정렬: ${Number(row.sortOrder || 0)}</div>
      <div class="ab-item-actions">
        <button class="btn btn--sm" type="button" data-act="edit">수정</button>
        <button class="btn btn--sm" type="button" data-act="toggle">${active ? "숨김" : "노출"}</button>
        <button class="btn btn--sm" type="button" data-act="delete">삭제</button>
      </div>
    </li>`;
}

async function loadList() {
  const listEl = $("bannerList");
  if (!listEl) return;
  listEl.innerHTML = "";

  try {
    const snap = await getDocs(query(collection(db, "sponsorBanners")));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    sortBanners(rows);

    if (!rows.length) {
      listEl.innerHTML = "<li>등록된 배너가 없습니다.</li>";
      return;
    }

    listEl.innerHTML = rows.map(cardHtml).join("");
  } catch (e) {
    console.warn(e);
    listEl.innerHTML = "<li>목록을 불러오지 못했습니다.</li>";
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
    setHelp("제목/이미지URL/링크URL은 필수입니다.", true);
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
      setHelp("수정 완료");
    } else {
      await addDoc(collection(db, "sponsorBanners"), {
        ...payload,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "",
      });
      setHelp("등록 완료");
    }

    resetForm();
    await loadList();
  } catch (e) {
    console.warn(e);
    setHelp("저장 실패: 권한 또는 규칙을 확인하세요.", true);
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
    if (!confirm("배너를 삭제할까요?")) return;
    await deleteDoc(doc(db, "sponsorBanners", id));
    await loadList();
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
    await updateDoc(doc(db, "sponsorBanners", id), {
      active: row.active === false,
      updatedAt: serverTimestamp(),
    });
    await loadList();
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setState("로그인이 필요합니다.");
    setFormEnabled(false);
    return;
  }

  const admin = await isAdmin(user.uid, user.email);
  if (!admin) {
    setState("관리자 권한이 없습니다.");
    setFormEnabled(false);
    return;
  }

  setState("관리자 모드");
  setFormEnabled(true);

  $("btnBnReset")?.addEventListener("click", resetForm);
  $("bannerForm")?.addEventListener("submit", (e) => saveBanner(e, user));
  $("bannerList")?.addEventListener("click", onListClick);

  await loadList();
});
