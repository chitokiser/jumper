// /assets/js/pages/guide_reviews.js
// NOTE: Firestore 복합 인덱스 없이 동작하도록 where + orderBy 조합을 제거했습니다.
//       정렬은 클라이언트에서 createdAt 기준으로 처리합니다.

import { onAuthReady } from "../auth.js";
import { auth, db } from "../firebase-init.js";

import {
  collection,
  query,
  where,
  limit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const stateEl = $("state");
const listEl = $("list");
const btnReload = $("btnReload");

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate().getTime();
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

function setState(msg, kind = "") {
  if (!stateEl) return;
  stateEl.className = "state " + (kind ? `state--${kind}` : "");
  stateEl.textContent = msg || "";
}

async function getItemTitle(itemId) {
  if (!itemId) return "";
  try {
    const snap = await getDoc(doc(db, "items", itemId));
    return snap.exists() ? (snap.data().title || "") : "";
  } catch {
    return "";
  }
}

function stars(n) {
  const v = Math.max(0, Math.min(5, Number(n || 0)));
  return "★★★★★".slice(0, v) + "☆☆☆☆☆".slice(0, 5 - v);
}

function renderRow(r, itemTitle) {
  const reply = r.guideReply || "";
  return `
  <article class="card">
    <div class="card-body">
      <div class="card-title">${esc(itemTitle || "(상품명 없음)")}</div>
      <div class="card-meta">
        <span>${esc(stars(r.rating))} (${esc(r.rating)})</span>
        ${r.visible === false ? `<span class="chip chip--warn">비공개</span>` : ""}
        <span>· 주문 ${esc(r.orderId || r.id)}</span>
      </div>
      ${r.text ? `<div class="card-text">${esc(r.text)}</div>` : ""}
      <div class="field">
        <label class="label">가이드 답변</label>
        <textarea class="textarea" rows="3" data-reply="${esc(r.id)}">${esc(reply)}</textarea>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" data-save="${esc(r.id)}">답변 저장</button>
        <a class="btn btn-sm btn-ghost" href="/item.html?id=${encodeURIComponent(r.itemId)}">상품 보기</a>
      </div>
    </div>
  </article>`;
}

async function load() {
  const user = auth.currentUser;
  if (!user) {
    setState("로그인이 필요합니다.", "bad");
    if (listEl) listEl.innerHTML = "";
    return;
  }

  setState("리뷰 불러오는 중...");
  if (listEl) listEl.innerHTML = "";

  // 인덱스 없이: where만 사용하고 createdAt 정렬은 클라이언트에서
  const q = query(collection(db, "reviews"), where("guideUid", "==", user.uid), limit(400));

  const snap = await getDocs(q);
  const rows = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    rows.push({ id: d.id, ...data, _t: toMs(data.createdAt) });
  });

  rows.sort((a, b) => (b._t || 0) - (a._t || 0));
  const top = rows.slice(0, 100);

  if (!top.length) {
    setState("리뷰가 없습니다.", "muted");
    return;
  }

  setState("");
  const html = [];
  for (const r of top) {
    const title = await getItemTitle(r.itemId);
    html.push(renderRow(r, title));
  }
  if (listEl) listEl.innerHTML = html.join("");
}

async function saveReply(reviewId) {
  const ta = document.querySelector(`textarea[data-reply="${CSS.escape(reviewId)}"]`);
  const text = ta ? ta.value : "";
  await updateDoc(doc(db, "reviews", reviewId), {
    guideReply: text,
    updatedAt: serverTimestamp(),
  });
}

listEl?.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("[data-save]");
  if (!btn) return;
  const id = btn.getAttribute("data-save");
  if (!id) return;

  try {
    btn.disabled = true;
    await saveReply(id);
    setState("저장했습니다.");
    setTimeout(() => setState(""), 1200);
  } catch (err) {
    console.error(err);
    setState("권한 또는 네트워크 문제로 저장 실패", "bad");
  } finally {
    btn.disabled = false;
  }
});

btnReload?.addEventListener("click", load);

onAuthReady(async () => {
  try {
    await load();
  } catch (e) {
    console.error(e);
    setState("권한 또는 네트워크 문제", "bad");
  }
});
