// /assets/js/pages/admin_reviews.js
// NOTE: Firestore 복합 인덱스 없이 동작하도록(특히 where+orderBy) 필터 쿼리를 단순화했습니다.
//       기본 목록은 orderBy(createdAt) 사용(단일 필드 정렬이라 인덱스 불필요)
//       itemId/guideUid 필터가 걸리면 where만 사용하고, 정렬은 클라이언트에서 처리합니다.

import { onAuthReady } from "../auth.js";
import { auth, db } from "../firebase-init.js";

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const stateEl = $("state");
const listEl = $("list");
const btnReload = $("btnReload");
const btnApply = $("btnApply");
const btnClear = $("btnClear");
const qItem = $("qItem");
const qGuide = $("qGuide");

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setState(msg, kind = "") {
  stateEl.className = "state " + (kind ? `state--${kind}` : "");
  stateEl.textContent = msg || "";
}

function tsToMs(v) {
  if (!v) return 0;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function stars(n) {
  const v = Math.max(0, Math.min(5, Number(n || 0)));
  return "★★★★★".slice(0, v) + "☆☆☆☆☆".slice(0, 5 - v);
}

function renderRow(r) {
  const visible = r.visible !== false;
  return `
  <article class="card">
    <div class="card-body">
      <div class="card-title">item ${esc(r.itemId)} · order ${esc(r.orderId || r.id)}</div>
      <div class="card-meta">
        <span>${esc(stars(r.rating))} (${esc(r.rating)})</span>
        <span>· author ${esc(r.authorUid)}</span>
        <span>· guide ${esc(r.guideUid)}</span>
        ${visible ? `<span class="chip chip--ok">공개</span>` : `<span class="chip chip--warn">숨김</span>`}
      </div>

      ${r.text ? `<div class="card-text">${esc(r.text)}</div>` : ""}

      ${r.guideReply ? `<div class="card-reply">가이드 답변: ${esc(r.guideReply)}</div>` : ""}

      <div class="field">
        <label class="label">관리자 답변</label>
        <textarea class="textarea" rows="3" data-adminreply="${esc(r.id)}">${esc(r.adminReply || "")}</textarea>
      </div>

      <div class="card-actions">
        <button class="btn btn-sm" data-save="${esc(r.id)}">저장</button>
        <button class="btn btn-sm btn-ghost" data-toggle="${esc(r.id)}" data-visible="${visible ? "1" : "0"}">
          ${visible ? "숨김" : "공개"}
        </button>
        <button class="btn btn-sm btn-danger" data-del="${esc(r.id)}">삭제</button>
        <a class="btn btn-sm btn-ghost" href="/item.html?id=${encodeURIComponent(r.itemId)}">상품 보기</a>
      </div>
    </div>
  </article>`;
}

async function load() {
  const user = auth.currentUser;
  if (!user) {
    setState("로그인이 필요합니다.", "bad");
    listEl.innerHTML = "";
    return;
  }

  setState("리뷰 불러오는 중...");
  listEl.innerHTML = "";

  const itemId = (qItem.value || "").trim();
  const guideUid = (qGuide.value || "").trim();

  let snap;

  // 기본: createdAt desc 200개 (단일 orderBy라 인덱스 없이 동작)
  if (!itemId && !guideUid) {
    const q = query(collection(db, "reviews"), orderBy("createdAt", "desc"), limit(200));
    snap = await getDocs(q);
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    if (!rows.length) {
      setState("리뷰가 없습니다.", "muted");
      return;
    }
    setState("");
    listEl.innerHTML = rows.map(renderRow).join("");
    return;
  }

  // 필터: where만 사용하고 정렬은 클라이언트에서
  if (itemId) {
    snap = await getDocs(query(collection(db, "reviews"), where("itemId", "==", itemId), limit(800)));
  } else {
    snap = await getDocs(query(collection(db, "reviews"), where("guideUid", "==", guideUid), limit(800)));
  }

  const rows = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    rows.push({ id: d.id, ...x, _t: tsToMs(x.createdAt) });
  });

  rows.sort((a, b) => (b._t || 0) - (a._t || 0));
  const top = rows.slice(0, 200);

  if (!top.length) {
    setState("리뷰가 없습니다.", "muted");
    return;
  }

  setState("");
  listEl.innerHTML = top.map(renderRow).join("");
}

async function save(reviewId) {
  const ta = document.querySelector(`textarea[data-adminreply="${CSS.escape(reviewId)}"]`);
  const text = ta ? ta.value : "";
  await updateDoc(doc(db, "reviews", reviewId), {
    adminReply: text,
    updatedAt: serverTimestamp(),
  });
}

async function toggleVisible(reviewId, nextVisible) {
  await updateDoc(doc(db, "reviews", reviewId), {
    visible: nextVisible,
    updatedAt: serverTimestamp(),
  });
}

async function del(reviewId) {
  await deleteDoc(doc(db, "reviews", reviewId));
}

listEl?.addEventListener("click", async (e) => {
  const btnSave = e.target.closest("[data-save]");
  const btnToggle = e.target.closest("[data-toggle]");
  const btnDel = e.target.closest("[data-del]");

  try {
    if (btnSave) {
      const id = btnSave.getAttribute("data-save");
      btnSave.disabled = true;
      await save(id);
      setState("저장했습니다.");
      setTimeout(() => setState(""), 1200);
      return;
    }

    if (btnToggle) {
      const id = btnToggle.getAttribute("data-toggle");
      const cur = btnToggle.getAttribute("data-visible") === "1";
      btnToggle.disabled = true;
      await toggleVisible(id, !cur);
      await load();
      return;
    }

    if (btnDel) {
      const id = btnDel.getAttribute("data-del");
      const ok = confirm("정말 삭제할까요? (되돌릴 수 없음)");
      if (!ok) return;
      btnDel.disabled = true;
      await del(id);
      await load();
      return;
    }
  } catch (err) {
    console.error(err);
    setState("권한 또는 네트워크 문제로 처리 실패", "bad");
  } finally {
    if (btnSave) btnSave.disabled = false;
    if (btnToggle) btnToggle.disabled = false;
    if (btnDel) btnDel.disabled = false;
  }
});

btnReload?.addEventListener("click", load);
btnApply?.addEventListener("click", load);
btnClear?.addEventListener("click", () => {
  qItem.value = "";
  qGuide.value = "";
  load();
});

onAuthReady(async () => {
  try {
    await load();
  } catch (e) {
    console.error(e);
    setState("권한 또는 네트워크 문제", "bad");
  }
});
