// /assets/js/pages/used_market_item.js
import { onAuthReady } from "/assets/js/auth.js";
import { app, db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const $ = (id) => document.getElementById(id);
const storage = getStorage(app);

function statusText(s) {
  if (s === "sold") return "판매완료";
  if (s === "reserved") return "예약중";
  if (s === "hidden") return "숨김";
  return "판매중";
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
  return uniq.length ? uniq : ["/assets/images/jump/logo2.png"];
}

const postId = new URLSearchParams(location.search).get("id") || "";
let viewer = null;
let postData = null;
let _isSuperAdmin = false;

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

function canManagePost() {
  if (!viewer?.uid) return false;
  if (_isSuperAdmin) return true;
  return !!(postData?.sellerUid && viewer.uid === postData.sellerUid);
}

function fillEditForm(post) {
  if ($("eStatus")) $("eStatus").value = post.status || "on_sale";
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
  if (!canManagePost()) return;
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

  const stVal = post.status || "on_sale";
  $("dTitle").textContent = post.title || "제목 없음";
  $("dBadge").innerHTML = `<span class="um-badge ${esc(stVal)}">${statusText(stVal)}</span>`;
  $("dPrice").textContent = `${Number(post.price || 0).toLocaleString()}원`;
  $("dRegion").textContent = post.region || "-";
  $("dSeller").textContent = post.sellerName || post.sellerEmail || "-";
  $("dContact").textContent = post.contact || "-";
  $("dDate").textContent = fmtDate(post.createdAt);
  $("dDesc").textContent = post.description || "";

  const hasPerm = canManagePost();
  $("umOwnerTools").style.display = hasPerm ? "flex" : "none";
  if ($("umSuperAdminPill")) {
    $("umSuperAdminPill").style.display = _isSuperAdmin ? "inline-flex" : "none";
  }

  $("umDetailState").style.display = "none";
  $("umDetail").style.display = "grid";
}

async function setStatus(next) {
  if (!postId || !canManagePost()) return;
  try {
    await updateDoc(doc(db, "usedMarketPosts", postId), {
      status: next,
      updatedAt: serverTimestamp(),
    });
    render({ ...postData, status: next });
    alert(`상태가 '${statusText(next)}'(으)로 변경되었습니다.`);
  } catch (e) {
    console.error("Status update error:", e);
    alert("상태 변경 실패: " + (e?.message || e));
  }
}

async function saveEdit(e) {
  e.preventDefault();
  if (!postId || !canManagePost()) return;

  const msg = $("eMsg");
  const btn = $("btnEditSave");
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = "저장 중...";

  try {
    const title = ($("eTitle")?.value || "").trim();
    const status = ($("eStatus")?.value || postData?.status || "on_sale");
    const price = Number(("" + ($("ePrice")?.value || "0")).replace(/,/g, ""));
    const region = ($("eRegion")?.value || "").trim();
    const contact = ($("eContact")?.value || "").trim();
    const description = ($("eDesc")?.value || "").trim();
    const imageUrls = [1, 2, 3, 4]
      .map((n) => ($("eImage" + n)?.value || "").trim())
      .filter(Boolean)
      .slice(0, 4);

    if (!title || !region || !contact || !description || !Number.isFinite(price) || price < 0) {
      throw new Error("필수 입력값을 올바르게 확인해 주세요.");
    }

    const payload = {
      title,
      status,
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
    alert("상품 정보가 성공적으로 수정/보완되었습니다.");
  } catch (err) {
    console.error("Save edit failed:", err);
    alert("수정 실패: " + (err?.message || err));
  } finally {
    if (btn) btn.disabled = false;
    if (msg) msg.textContent = "";
  }
}

async function handleFileImagesUpload(e) {
  const files = Array.from(e.target?.files || []).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;

  const statusEl = $("eUploadStatus");
  const uid = viewer?.uid || "admin";

  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(`파일 용량 초과 (10MB 이하): ${file.name}`);
      }

      if (statusEl) statusEl.textContent = `업로드 중... (${i + 1}/${files.length})`;

      const ext = file.name.split(".").pop() || "jpg";
      const path = `used-market/${uid}/${Date.now()}-${i + 1}.${ext}`;
      const fileRef = ref(storage, path);

      await uploadBytes(fileRef, file, { contentType: file.type || "image/jpeg" });
      const downloadUrl = await getDownloadURL(fileRef);

      // 빈 필드 찾아서 입력, 꽉 차있으면 순서대로 채움
      let assigned = false;
      for (let n = 1; n <= 4; n += 1) {
        const inp = $("eImage" + n);
        if (inp && !inp.value.trim()) {
          inp.value = downloadUrl;
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        const first = $("eImage1");
        if (first) first.value = downloadUrl;
      }
    }

    if (statusEl) statusEl.textContent = `✅ ${files.length}장 업로드 완료`;
  } catch (err) {
    console.error("Upload error:", err);
    if (statusEl) statusEl.textContent = "❌ 실패: " + (err?.message || err);
    alert("이미지 업로드 실패: " + (err?.message || err));
  }
}

onAuthReady(async ({ loggedIn, user }) => {
  viewer = user || null;
  if (loggedIn && user) {
    _isSuperAdmin = await checkSuperAdmin(user);
  } else {
    _isSuperAdmin = false;
  }

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
    const data = snap.data();
    if (data.status === "hidden" && !_isSuperAdmin && viewer?.uid !== data.sellerUid) {
      $("umDetailState").textContent = "비공개(숨김) 처리된 게시글입니다.";
      return;
    }
    render({ id: snap.id, ...data });
  } catch (e) {
    console.error("Fetch error:", e);
    $("umDetailState").textContent = "상세 정보를 불러오지 못했습니다.";
  }
});

$("btnReserved")?.addEventListener("click", () => setStatus("reserved"));
$("btnSold")?.addEventListener("click", () => setStatus("sold"));
$("btnOnSale")?.addEventListener("click", () => setStatus("on_sale"));
$("btnHidden")?.addEventListener("click", () => setStatus("hidden"));
$("btnEditToggle")?.addEventListener("click", openEdit);
$("btnEditCancel")?.addEventListener("click", closeEdit);
$("umEditForm")?.addEventListener("submit", saveEdit);
$("eImageFiles")?.addEventListener("change", handleFileImagesUpload);

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

$("btnDeletePost")?.addEventListener("click", async () => {
  if (!postId || !canManagePost()) return;
  if (!confirm("정말 이 게시글을 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.")) return;
  try {
    await deleteDoc(doc(db, "usedMarketPosts", postId));
    alert("삭제되었습니다.");
    location.href = "/used.html";
  } catch (err) {
    console.error("Delete error:", err);
    alert("삭제 실패: " + (err?.message || err));
  }
});
