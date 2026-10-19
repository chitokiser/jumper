// /assets/js/pages/used_market.js
import { onAuthReady } from "/assets/js/auth.js";
import { app, db } from "/assets/js/firebase-init.js";
import { formatUsedPrice, priceForVndInput } from "/assets/js/used-market-currency.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  orderBy,
  query,
  limit,
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

let _currentUser = null;
let _isSuperAdmin = false;
let ALL = [];

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(v) {
  try {
    const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : null);
    return d ? d.toLocaleDateString("ko-KR") : "-";
  } catch {
    return "-";
  }
}

function statusText(s) {
  if (s === "sold") return "판매완료";
  if (s === "reserved") return "예약중";
  if (s === "hidden") return "숨김";
  return "판매중";
}

function getThumb(post) {
  if (Array.isArray(post?.imageUrls) && post.imageUrls.length && post.imageUrls[0]) {
    return post.imageUrls[0];
  }
  if (post?.imageUrl) return post.imageUrl;
  return "/assets/images/jump/logo2.png";
}

function showToast(message) {
  const toast = $("umToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
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

function render() {
  const q = ($("umSearch")?.value || "").trim().toLowerCase();
  const st = $("umStatus")?.value || "all";
  const grid = $("umGrid");
  const state = $("umState");
  if (!grid || !state) return;

  const list = ALL.filter((x) => {
    // 숨김 글은 수퍼어드민만 열람 가능
    if (x.status === "hidden" && !_isSuperAdmin) return false;
    if (st !== "all" && x.status !== st) return false;
    if (!q) return true;
    return [x.title, x.region, x.description, x.sellerName, x.sellerEmail, x.contact].some((v) =>
      String(v || "").toLowerCase().includes(q)
    );
  });

  state.innerHTML = `총 <strong>${list.length}</strong>개 ${_isSuperAdmin ? '<span style="color:#2563eb; font-weight:700; margin-left:6px;">(수퍼어드민 권한 활성)</span>' : ""}`;

  if (!list.length) {
    grid.innerHTML = '<div class="muted" style="grid-column:1/-1; padding:36px; text-align:center;">등록된 중고거래 글이 없습니다.</div>';
    return;
  }

  grid.innerHTML = list.map((x) => {
    const stVal = x.status || "on_sale";
    return `
      <div class="um-card ${stVal === "hidden" ? "is-hidden" : ""}" data-id="${esc(x.id)}">
        <a class="um-card-link" href="/used-market-item.html?id=${encodeURIComponent(x.id)}">
          <div class="um-thumb-wrap">
            <img class="um-thumb" src="${esc(getThumb(x))}" alt="${esc(x.title)}" loading="lazy" />
            <span class="um-badge ${esc(stVal)}">${statusText(stVal)}</span>
          </div>
          <div class="um-body">
            <div class="um-title">${esc(x.title || "제목 없음")}</div>
            <div class="um-price">${esc(formatUsedPrice(x))}</div>
            <div class="um-meta">
              <span>📍 ${esc(x.region || "-")}</span>
              <span>📅 ${fmtDate(x.createdAt)}</span>
            </div>
            <div class="um-seller-tag" title="${esc(x.sellerEmail || "")}">👤 ${esc(x.sellerName || x.sellerEmail || "판매자")}</div>
          </div>
        </a>
        ${_isSuperAdmin ? `
          <div class="um-card-admin">
            <div class="um-admin-status-wrap">
              <span class="um-admin-label">상태 변경:</span>
              <select class="um-admin-status-select" data-id="${esc(x.id)}" data-status="${esc(stVal)}">
                <option value="on_sale" ${stVal === "on_sale" ? "selected" : ""}>판매중</option>
                <option value="reserved" ${stVal === "reserved" ? "selected" : ""}>예약중</option>
                <option value="sold" ${stVal === "sold" ? "selected" : ""}>판매완료</option>
                <option value="hidden" ${stVal === "hidden" ? "selected" : ""}>숨김</option>
              </select>
            </div>
            <div class="um-admin-btn-group">
              <button class="btn btn--sm btn-um-edit" data-id="${esc(x.id)}" type="button" title="상품 정보 및 이미지 수정/보완">
                ✏️ 수정/보완
              </button>
              <button class="btn btn--sm btn-um-delete" data-id="${esc(x.id)}" type="button" title="상품 삭제">
                🗑️ 삭제
              </button>
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

async function updateItemStatus(id, newStatus) {
  if (!_isSuperAdmin) {
    alert("수퍼어드민만 상태를 변경할 수 있습니다.");
    return;
  }
  try {
    await updateDoc(doc(db, "usedMarketPosts", id), {
      status: newStatus,
      updatedAt: serverTimestamp(),
    });

    const item = ALL.find((x) => x.id === id);
    if (item) item.status = newStatus;
    render();
    showToast(`상품 상태가 '${statusText(newStatus)}'(으)로 변경되었습니다.`);
  } catch (err) {
    console.error("Status update failed:", err);
    alert("상태 변경 실패: " + (err?.message || err));
  }
}

async function deleteItem(id) {
  if (!_isSuperAdmin) {
    alert("수퍼어드민만 상품을 삭제할 수 있습니다.");
    return;
  }
  const item = ALL.find((x) => x.id === id);
  const title = item ? item.title : "이 상품";
  if (!confirm(`정말 "${title}" 상품을 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) {
    return;
  }

  try {
    await deleteDoc(doc(db, "usedMarketPosts", id));
    ALL = ALL.filter((x) => x.id !== id);
    closeAdminEditModal();
    render();
    showToast("상품이 성공적으로 삭제되었습니다.");
  } catch (err) {
    console.error("Delete failed:", err);
    alert("삭제 실패: " + (err?.message || err));
  }
}

function updateModalImgPreviews() {
  const container = $("mEditImgPreviews");
  if (!container) return;
  const urls = [1, 2, 3, 4]
    .map((n) => ($("mEditImg" + n)?.value || "").trim())
    .filter(Boolean);

  if (!urls.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = urls
    .map((url, idx) => `
      <div class="um-img-preview-item" title="이미지 ${idx + 1}">
        <img src="${esc(url)}" alt="미리보기 ${idx + 1}" onerror="this.src='/assets/images/jump/logo2.png'" />
      </div>
    `)
    .join("");
}

function openAdminEditModal(id) {
  const item = ALL.find((x) => x.id === id);
  if (!item) {
    alert("상품 정보를 찾을 수 없습니다.");
    return;
  }

  $("mEditId").value = item.id;
  $("mEditStatus").value = item.status || "on_sale";
  $("mEditTitle").value = item.title || "";
  $("mEditPrice").value = priceForVndInput(item);
  $("mEditRegion").value = item.region || "";
  $("mEditContact").value = item.contact || "";
  $("mSellerName").textContent = item.sellerName || "판매자 미지정";
  $("mSellerEmail").textContent = item.sellerEmail || "-";
  $("mSellerUid").textContent = item.sellerUid || "-";
  $("mEditDesc").value = item.description || "";

  const imgs = Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []);
  [1, 2, 3, 4].forEach((n) => {
    const el = $("mEditImg" + n);
    if (el) el.value = imgs[n - 1] || "";
  });

  updateModalImgPreviews();

  const msg = $("mAdminModalMsg");
  if (msg) msg.textContent = "";

  const modal = $("umAdminModal");
  if (modal) modal.style.display = "flex";
}

function closeAdminEditModal() {
  const modal = $("umAdminModal");
  if (modal) modal.style.display = "none";
  const fileInput = $("mEditFileImages");
  if (fileInput) fileInput.value = "";
  const uploadStatus = $("mEditUploadStatus");
  if (uploadStatus) uploadStatus.textContent = "";
}

async function handleModalSave(e) {
  e.preventDefault();
  const id = $("mEditId")?.value;
  if (!id) return;

  const btn = $("btnAdminModalSave");
  const msg = $("mAdminModalMsg");
  if (btn) btn.disabled = true;
  if (msg) {
    msg.style.color = "#2563eb";
    msg.textContent = "저장 중...";
  }

  try {
    const title = ($("mEditTitle")?.value || "").trim();
    const status = $("mEditStatus")?.value || "on_sale";
    const price = Number($("mEditPrice")?.value || 0);
    const region = ($("mEditRegion")?.value || "").trim();
    const contact = ($("mEditContact")?.value || "").trim();
    const description = ($("mEditDesc")?.value || "").trim();

    const imageUrls = [1, 2, 3, 4]
      .map((n) => ($("mEditImg" + n)?.value || "").trim())
      .filter(Boolean)
      .slice(0, 4);

    if (!title || !region || !contact || !description || !Number.isFinite(price) || price < 0) {
      throw new Error("필수 입력값을 올바르게 입력해 주세요.");
    }

    const payload = {
      title,
      status,
      price,
      currency: "VND",
      region,
      contact,
      description,
      imageUrls,
      imageUrl: imageUrls[0] || "",
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, "usedMarketPosts", id), payload);

    const idx = ALL.findIndex((x) => x.id === id);
    if (idx !== -1) {
      ALL[idx] = { ...ALL[idx], ...payload };
    }

    closeAdminEditModal();
    render();
    showToast("상품 정보가 성공적으로 수정/보완되었습니다.");
  } catch (err) {
    console.error("Save edit failed:", err);
    if (msg) {
      msg.style.color = "#ef4444";
      msg.textContent = "저장 실패: " + (err?.message || err);
    }
    alert("저장 실패: " + (err?.message || err));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleFileImagesUpload(e) {
  const files = Array.from(e.target?.files || []).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;

  const statusEl = $("mEditUploadStatus");
  const uid = _currentUser?.uid || "admin";

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

      // 빈 필드 찾아서 입력, 꽉 차있으면 순서대로 덮어쓰기
      let assigned = false;
      for (let n = 1; n <= 4; n += 1) {
        const inp = $("mEditImg" + n);
        if (inp && !inp.value.trim()) {
          inp.value = downloadUrl;
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        const first = $("mEditImg1");
        if (first) first.value = downloadUrl;
      }
    }

    updateModalImgPreviews();
    if (statusEl) statusEl.textContent = `✅ ${files.length}장 업로드 완료`;
  } catch (err) {
    console.error("Upload error:", err);
    if (statusEl) statusEl.textContent = "❌ 업로드 실패: " + (err?.message || err);
    alert("이미지 업로드 실패: " + (err?.message || err));
  }
}

async function boot() {
  const state = $("umState");
  if (state) state.textContent = "불러오는 중...";

  try {
    const snap = await getDocs(query(collection(db, "usedMarketPosts"), orderBy("createdAt", "desc"), limit(100)));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    ALL = rows;
    render();
  } catch (e) {
    if (state) state.textContent = "목록을 불러오지 못했습니다.";
    console.warn(e);
  }
}

// ── 이벤트 등록 ──
["umSearch", "umStatus"].forEach((id) => {
  document.addEventListener("input", (e) => {
    if (e.target?.id === id) render();
  });
  document.addEventListener("change", (e) => {
    if (e.target?.id === id) render();
  });
});

// 그리드 내 수퍼어드민 조작 (이벤트 위임)
$("umGrid")?.addEventListener("change", async (e) => {
  const sel = e.target.closest(".um-admin-status-select");
  if (!sel) return;
  const id = sel.getAttribute("data-id");
  const newStatus = sel.value;
  sel.setAttribute("data-status", newStatus);
  await updateItemStatus(id, newStatus);
});

$("umGrid")?.addEventListener("click", (e) => {
  const btnEdit = e.target.closest(".btn-um-edit");
  if (btnEdit) {
    e.preventDefault();
    e.stopPropagation();
    const id = btnEdit.getAttribute("data-id");
    openAdminEditModal(id);
    return;
  }

  const btnDel = e.target.closest(".btn-um-delete");
  if (btnDel) {
    e.preventDefault();
    e.stopPropagation();
    const id = btnDel.getAttribute("data-id");
    deleteItem(id);
    return;
  }
});

// 모달 이벤트
$("btnAdminModalClose")?.addEventListener("click", closeAdminEditModal);
$("umAdminModalOverlay")?.addEventListener("click", closeAdminEditModal);
$("btnAdminModalCancel")?.addEventListener("click", closeAdminEditModal);
$("umAdminEditForm")?.addEventListener("submit", handleModalSave);

$("btnAdminModalDelete")?.addEventListener("click", () => {
  const id = $("mEditId")?.value;
  if (id) deleteItem(id);
});

$("mEditFileImages")?.addEventListener("change", handleFileImagesUpload);

[1, 2, 3, 4].forEach((n) => {
  $("mEditImg" + n)?.addEventListener("input", updateModalImgPreviews);
});

// 인증 상태 감지 및 수퍼어드민 검증
onAuthReady(async ({ loggedIn, user }) => {
  _currentUser = user || null;
  if (loggedIn && user) {
    _isSuperAdmin = await checkSuperAdmin(user);
  } else {
    _isSuperAdmin = false;
  }

  const adminBadge = $("umAdminBadge");
  const optHidden = $("umOptHidden");

  if (adminBadge) adminBadge.style.display = _isSuperAdmin ? "inline-flex" : "none";
  if (optHidden) optHidden.style.display = _isSuperAdmin ? "block" : "none";

  render();
});

boot();
