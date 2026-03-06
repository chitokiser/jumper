// /assets/js/pages/used_market_item.js
import { onAuthReady } from "/assets/js/auth.js";
import { db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function statusText(s) {
  return s === "sold" ? "판매완료" : s === "reserved" ? "예약중" : "판매중";
}

function fmtDate(v) {
  try {
    const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : null);
    return d ? d.toLocaleString("ko-KR") : "-";
  } catch {
    return "-";
  }
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getImages(post) {
  const arr = [];
  if (Array.isArray(post?.imageUrls)) {
    for (const x of post.imageUrls) {
      const v = String(x || "").trim();
      if (v) arr.push(v);
    }
  }
  if (post?.imageUrl) arr.push(String(post.imageUrl).trim());
  const uniq = [...new Set(arr)].filter(Boolean).slice(0, 4);
  return uniq.length ? uniq : ["/assets/images/jump/BI.png"];
}

const postId = new URLSearchParams(location.search).get("id") || "";
let viewer = null;
let postData = null;

function isOwnerPost() {
  return !!(viewer?.uid && postData?.sellerUid && viewer.uid === postData.sellerUid);
}

function fillEditForm(post) {
  $("eTitle").value = post.title || "";
  $("ePrice").value = Number(post.price || 0);
  $("eRegion").value = post.region || "";
  $("eContact").value = post.contact || "";
  $("eDesc").value = post.description || "";

  const imgs = getImages(post);
  [1, 2, 3, 4].forEach((n) => {
    const el = $("eImage" + n);
    if (el) el.value = imgs[n - 1] || "";
  });
}

function openEdit() {
  if (!isOwnerPost()) return;
  fillEditForm(postData || {});
  const panel = $("umEditPanel");
  if (panel) panel.style.display = "block";
}

function closeEdit() {
  const panel = $("umEditPanel");
  if (panel) panel.style.display = "none";
  const msg = $("eMsg");
  if (msg) msg.textContent = "";
}

function render(post) {
  postData = post;

  const images = getImages(post);
  $("dImage").src = images[0];

  const thumbs = $("dThumbs");
  if (thumbs) {
    if (images.length <= 1) {
      thumbs.style.display = "none";
      thumbs.innerHTML = "";
    } else {
      thumbs.style.display = "grid";
      thumbs.innerHTML = images.map((src, idx) => `
        <button type="button" class="um-thumb-btn ${idx === 0 ? "is-active" : ""}" data-src="${esc(src)}" aria-label="이미지 ${idx + 1}">
          <img src="${esc(src)}" alt="상품 이미지 ${idx + 1}" />
        </button>
      `).join("");
    }
  }

  $("dTitle").textContent = post.title || "제목 없음";
  $("dBadge").innerHTML = `<span class="um-badge ${post.status || "on_sale"}">${statusText(post.status)}</span>`;
  $("dPrice").textContent = `${Number(post.price || 0).toLocaleString()}원`;
  $("dRegion").textContent = post.region || "-";
  $("dSeller").textContent = post.sellerName || post.sellerEmail || "-";
  $("dContact").textContent = post.contact || "-";
  $("dDate").textContent = fmtDate(post.createdAt);
  $("dDesc").textContent = post.description || "";

  $("umOwnerTools").style.display = isOwnerPost() ? "flex" : "none";

  $("umDetailState").style.display = "none";
  $("umDetail").style.display = "grid";
}

async function setStatus(next) {
  if (!postId || !isOwnerPost()) return;
  try {
    await updateDoc(doc(db, "usedMarketPosts", postId), {
      status: next,
      updatedAt: serverTimestamp(),
    });
    render({ ...postData, status: next });
  } catch (e) {
    alert("상태 변경 실패: " + (e?.message || e));
  }
}

async function saveEdit(e) {
  e.preventDefault();
  if (!postId || !isOwnerPost()) return;

  const msg = $("eMsg");
  const btn = $("btnEditSave");
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = "저장 중...";

  try {
    const title = ($("eTitle")?.value || "").trim();
    const price = Number(("" + ($("ePrice")?.value || "0")).replace(/,/g, ""));
    const region = ($("eRegion")?.value || "").trim();
    const contact = ($("eContact")?.value || "").trim();
    const description = ($("eDesc")?.value || "").trim();
    const imageUrls = [1, 2, 3, 4]
      .map((n) => ($("eImage" + n)?.value || "").trim())
      .filter(Boolean)
      .slice(0, 4);

    if (!title || !region || !contact || !description || !Number.isFinite(price) || price < 0) {
      throw new Error("필수 입력값을 확인해 주세요.");
    }

    const payload = {
      title,
      price,
      region,
      contact,
      description,
      imageUrls,
      imageUrl: imageUrls[0] || "",
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, "usedMarketPosts", postId), payload);
    render({ ...postData, ...payload });
    closeEdit();
  } catch (err) {
    alert("수정 실패: " + (err?.message || err));
  } finally {
    if (btn) btn.disabled = false;
    if (msg) msg.textContent = "";
  }
}

onAuthReady(async ({ user }) => {
  viewer = user || null;

  if (!postId) {
    $("umDetailState").textContent = "잘못된 접근입니다.";
    return;
  }

  try {
    const snap = await getDoc(doc(db, "usedMarketPosts", postId));
    if (!snap.exists()) {
      $("umDetailState").textContent = "게시글이 없습니다.";
      return;
    }
    render({ id: snap.id, ...snap.data() });
  } catch {
    $("umDetailState").textContent = "상세 정보를 불러오지 못했습니다.";
  }
});

$("btnReserved")?.addEventListener("click", () => setStatus("reserved"));
$("btnSold")?.addEventListener("click", () => setStatus("sold"));
$("btnOnSale")?.addEventListener("click", () => setStatus("on_sale"));
$("btnEditToggle")?.addEventListener("click", openEdit);
$("btnEditCancel")?.addEventListener("click", closeEdit);
$("umEditForm")?.addEventListener("submit", saveEdit);

$("dThumbs")?.addEventListener("click", (e) => {
  const btn = e.target?.closest?.(".um-thumb-btn");
  if (!btn) return;
  const src = btn.getAttribute("data-src") || "";
  if (!src) return;

  const main = $("dImage");
  if (main) main.src = src;

  document.querySelectorAll(".um-thumb-btn").forEach((x) => x.classList.remove("is-active"));
  btn.classList.add("is-active");
});
