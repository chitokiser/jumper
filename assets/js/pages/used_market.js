// /assets/js/pages/used_market.js — 당근마켓(Karrot) 수준 하노이 회원간 중고거래
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
let selectedRegion = "all";
let selectedCategory = "all";
let onlyMyLikes = false;
let onlyMyPosts = false;
let likedIds = new Set();

function loadLikesFromStorage() {
  try {
    const raw = localStorage.getItem("bestclub_karrot_likes");
    const arr = raw ? JSON.parse(raw) : [];
    likedIds = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    likedIds = new Set();
  }
  updateLikesBadge();
}

function saveLikesToStorage() {
  try {
    localStorage.setItem("bestclub_karrot_likes", JSON.stringify([...likedIds]));
  } catch (_) {}
  updateLikesBadge();
}

function updateLikesBadge() {
  const b = $("myLikesCountBadge");
  if (b) b.textContent = String(likedIds.size);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

// 당근 스타일 상대 시간 ("방금 전", "15분 전", "2시간 전", "끌올 1일 전")
function timeAgo(post) {
  const bumpedMs = toMillis(post.bumpedAt);
  const createdMs = toMillis(post.createdAt);
  const isBumped = bumpedMs > createdMs + 60 * 1000;
  const targetMs = isBumped ? bumpedMs : createdMs;
  if (!targetMs) return "-";

  const diffSec = Math.max(0, Math.floor((Date.now() - targetMs) / 1000));
  const prefix = isBumped ? "끌올 " : "";
  if (diffSec < 60) return `${prefix}방금 전`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${prefix}${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${prefix}${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${prefix}${days}일 전`;
  return new Date(targetMs).toLocaleDateString("ko-KR");
}

function statusText(s) {
  if (s === "sold") return "거래완료";
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

// 제목/설명으로 카테고리 자동 추론 (기존 게시글 호환)
function inferCategory(post) {
  if (post.category && String(post.category).trim()) return String(post.category).trim();
  if (Number(post.price) === 0 || post.isFreeShare) return "무료나눔";
  const text = `${post.title || ""} ${post.description || ""}`.toLowerCase();
  if (/아이폰|갤럭시|맥북|노트북|패드|에어팟|모니터|tv|냉장고|세탁기|청소기|제습기|공기청정기|에어프라이어|전자|가전|컴퓨터|카메라/.test(text)) return "디지털/가전";
  if (/침대|매트리스|소파|책상|식탁|의자|수납|선반|가구|커튼|조명|인테리어/.test(text)) return "가구/인테리어";
  if (/유모차|카시트|아기|유아|장난감|기저귀|분유|젖병|키즈/.test(text)) return "유아동/출산";
  if (/골프|드라이버|아이언|퍼터|테니스|배드민턴|자전거|캠핑|운동|헬스|라켓/.test(text)) return "스포츠/골프";
  if (/오토바이|스쿠터|혼다|야마하|차량|자동차|헬멧/.test(text)) return "오토바이/차량";
  if (/옷|의류|가방|신발|운동화|원피스|자켓|명품|시계|지갑/.test(text)) return "의류/잡화";
  if (/그릇|냄비|프라이팬|주방|식기|정수기|생필품/.test(text)) return "생활/주방";
  return "기타";
}

// 판매자 매너온도 (기본 36.5°C ~ 활동/신뢰도에 따라 36.8°C~42.5°C 표시)
function getMannerTemp(post) {
  if (typeof post.mannerTemp === "number" && Number.isFinite(post.mannerTemp)) {
    return post.mannerTemp.toFixed(1);
  }
  const seed = String(post.sellerUid || post.sellerEmail || post.id || "user");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const bonus = (Math.abs(h) % 45) / 10; // 0.0 ~ 4.4
  return (36.5 + bonus).toFixed(1);
}

function matchesRegionChip(postRegion, targetChip) {
  if (!targetChip || targetChip === "all") return true;
  const r = String(postRegion || "").toLowerCase();
  if (targetChip === "미딩") return /미딩|쭝화|스카이레이크|골드마크|케이남|구찌|매트릭스|가든|더매너|빈홈/.test(r);
  if (targetChip === "서호") return /서호|외교단지|스타레이크|치푸차|롯데몰|떠이호|엠버시/.test(r);
  if (targetChip === "하동") return /하동|반푹|파크시티|물베리|시즌즈/.test(r);
  if (targetChip === "타임시티") return /타임시티|오션파크|에코파크|롱비엔/.test(r);
  if (targetChip === "기타") {
    return !/미딩|쭝화|스카이레이크|골드마크|케이남|서호|외교단지|스타레이크|치푸차|하동|반푹|타임시티|오션파크/.test(r);
  }
  return r.includes(targetChip.toLowerCase());
}

function canManageItem(item) {
  if (_isSuperAdmin) return true;
  if (_currentUser?.uid && item?.sellerUid && _currentUser.uid === item.sellerUid) return true;
  return false;
}

function showToast(message) {
  const toast = $("umToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
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
  const sortBy = $("umSort")?.value || "latest";
  const onlyFree = !!$("umOnlyFree")?.checked;
  const onlyBmPay = !!$("umOnlyBmPay")?.checked;
  const grid = $("umGrid");
  const state = $("umState");
  if (!grid || !state) return;

  const list = ALL.filter((x) => {
    const isMine = _currentUser?.uid && x.sellerUid === _currentUser.uid;
    if (x.status === "hidden" && !_isSuperAdmin && !isMine) return false;
    if (st !== "all" && (x.status || "on_sale") !== st) return false;

    const cat = inferCategory(x);
    if (selectedCategory !== "all" && cat !== selectedCategory) return false;
    if (!matchesRegionChip(x.region, selectedRegion)) return false;

    if (onlyFree && Number(x.price || 0) > 0 && !x.isFreeShare && cat !== "무료나눔") return false;
    if (onlyBmPay && x.bmPayOk === false) return false;
    if (onlyMyLikes && !likedIds.has(x.id)) return false;
    if (onlyMyPosts && !isMine) return false;

    if (!q) return true;
    return [x.title, x.region, x.meetSpot, x.description, x.sellerName, x.sellerEmail, x.contact, cat].some((v) =>
      String(v || "").toLowerCase().includes(q)
    );
  });

  // 정렬
  list.sort((a, b) => {
    if (sortBy === "price_asc") return Number(a.price || 0) - Number(b.price || 0);
    if (sortBy === "price_desc") return Number(b.price || 0) - Number(a.price || 0);
    if (sortBy === "popular") {
      const scoreA = (Number(a.likeCount || 0) + (likedIds.has(a.id) ? 1 : 0)) * 3 + Number(a.chatCount || 0) * 2 + Number(a.viewCount || 0);
      const scoreB = (Number(b.likeCount || 0) + (likedIds.has(b.id) ? 1 : 0)) * 3 + Number(b.chatCount || 0) * 2 + Number(b.viewCount || 0);
      return scoreB - scoreA;
    }
    const timeA = Math.max(toMillis(a.bumpedAt), toMillis(a.createdAt));
    const timeB = Math.max(toMillis(b.bumpedAt), toMillis(b.createdAt));
    return timeB - timeA;
  });

  const filterBadges = [];
  if (selectedRegion !== "all") filterBadges.push(`동네: ${selectedRegion}`);
  if (selectedCategory !== "all") filterBadges.push(`분류: ${selectedCategory}`);
  if (onlyMyLikes) filterBadges.push("❤️ 내 관심목록");
  if (onlyMyPosts) filterBadges.push("📦 내 판매글");

  state.innerHTML = `🥕 조회된 중고 물품 <strong>${list.length}</strong>개 ${
    filterBadges.length ? `<span style="color:#ff6f0f; font-weight:700; margin-left:6px;">(${filterBadges.join(" · ")})</span>` : ""
  } ${_isSuperAdmin ? '<span style="color:#2563eb; font-weight:700; margin-left:6px;">(🛡️ 수퍼어드민 모드)</span>' : ""}`;

  if (!list.length) {
    grid.innerHTML = `
      <div class="muted" style="grid-column:1/-1; padding:48px 20px; text-align:center; background:#f8fafc; border-radius:16px; border:1px dashed #cbd5e1;">
        <div style="font-size:32px; margin-bottom:8px;">🥕</div>
        <div style="font-weight:700; color:#334155; margin-bottom:4px;">조건에 맞는 중고거래 물품이 없습니다.</div>
        <div style="font-size:13px;">동네나 카테고리 필터를 변경하거나 첫 번째로 물건을 올려보세요!</div>
      </div>`;
    return;
  }

  grid.innerHTML = list.map((x) => {
    const stVal = x.status || "on_sale";
    const cat = inferCategory(x);
    const isLiked = likedIds.has(x.id);
    const likeCount = Math.max(0, Number(x.likeCount || 0) + (isLiked ? 1 : 0));
    const chatCount = Math.max(0, Number(x.chatCount || ( Array.isArray(x.inquiries) ? x.inquiries.length : 0 )));
    const isFree = Number(x.price || 0) === 0 || x.isFreeShare === true;
    const negotiable = x.negotiable !== false && !isFree;
    const bmPayOk = x.bmPayOk !== false && !isFree;
    const temp = getMannerTemp(x);
    const canManage = canManageItem(x);

    return `
      <div class="um-card ${stVal === "hidden" ? "is-hidden" : ""}" data-id="${esc(x.id)}">
        <div class="um-thumb-wrap">
          <a href="/used-market-item.html?id=${encodeURIComponent(x.id)}" style="display:block;">
            <img class="um-thumb" src="${esc(getThumb(x))}" alt="${esc(x.title)}" loading="lazy" onerror="this.src='/assets/images/jump/logo2.png'" />
          </a>
          <span class="um-badge ${esc(stVal)}">${statusText(stVal)}</span>
          <button type="button" class="um-like-btn ${isLiked ? "is-liked" : ""}" data-id="${esc(x.id)}" title="관심 상품 찜하기">
            ${isLiked ? "❤️" : "🤍"}
          </button>
          <span class="um-cat-tag">${esc(cat)}</span>
        </div>

        <a class="um-card-link" href="/used-market-item.html?id=${encodeURIComponent(x.id)}">
          <div class="um-body">
            <div class="um-title">${esc(x.title || "제목 없음")}</div>
            <div class="um-submeta">
              📍 ${esc(x.region || "하노이")}${x.meetSpot ? ` · ${esc(x.meetSpot)}` : ""} · ${esc(timeAgo(x))}
            </div>
            <div class="um-price-row">
              <div class="um-price ${isFree ? "is-free" : ""}">${isFree ? "🎁 무료나눔" : esc(formatUsedPrice(x))}</div>
              ${negotiable ? '<span class="um-pill-tag nego">가격제안가능</span>' : ""}
              ${bmPayOk ? '<span class="um-pill-tag bm">BM결제</span>' : ""}
            </div>
            <div class="um-card-footer">
              <span class="um-temp-badge" title="판매자 매너온도">🌡️ ${temp}°C · ${esc(x.sellerName || (x.sellerEmail ? x.sellerEmail.split("@")[0] : "이웃"))}</span>
              <span class="um-stats">
                ${chatCount > 0 ? `<span>💬 ${chatCount}</span>` : ""}
                <span>❤️ ${likeCount}</span>
              </span>
            </div>
          </div>
        </a>

        ${canManage ? `
          <div class="um-card-admin">
            <div class="um-admin-status-wrap">
              <span class="um-admin-label">${_isSuperAdmin ? "🛡️ 상태:" : "내 상품:"}</span>
              <select class="um-admin-status-select" data-id="${esc(x.id)}" data-status="${esc(stVal)}">
                <option value="on_sale" ${stVal === "on_sale" ? "selected" : ""}>🟢 판매중</option>
                <option value="reserved" ${stVal === "reserved" ? "selected" : ""}>🟡 예약중</option>
                <option value="sold" ${stVal === "sold" ? "selected" : ""}>⚪ 거래완료</option>
                <option value="hidden" ${stVal === "hidden" ? "selected" : ""}>🔴 숨김</option>
              </select>
            </div>
            <div class="um-admin-btn-group">
              <button class="btn btn--sm btn-um-bump" data-id="${esc(x.id)}" type="button" style="background:#fff7ed; color:#c2410c; border:1px solid #fdba74; border-radius:6px; font-size:11px; font-weight:700; padding:4px 7px; cursor:pointer;" title="최신글로 끌어올리기">
                🚀 끌올
              </button>
              <button class="btn btn--sm btn-um-edit" data-id="${esc(x.id)}" type="button" title="상품 정보 및 이미지 수정/보완">
                ✏️ 수정
              </button>
              <button class="btn btn--sm btn-um-delete" data-id="${esc(x.id)}" type="button" title="상품 삭제">
                🗑️
              </button>
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

function toggleLike(id) {
  if (likedIds.has(id)) {
    likedIds.delete(id);
    showToast("관심목록에서 해제되었습니다.");
  } else {
    likedIds.add(id);
    showToast("❤️ 관심목록에 추가되었습니다!");
  }
  saveLikesToStorage();
  render();
}

async function bumpItem(id) {
  const item = ALL.find((x) => x.id === id);
  if (!item || !canManageItem(item)) {
    alert("본인 판매글 또는 관리자만 끌올할 수 있습니다.");
    return;
  }
  try {
    await updateDoc(doc(db, "usedMarketPosts", id), {
      bumpedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    item.bumpedAt = new Date();
    render();
    showToast("🚀 게시글이 최신순 상단으로 끌올되었습니다!");
  } catch (err) {
    alert("끌올 실패: " + (err?.message || err));
  }
}

async function updateItemStatus(id, newStatus) {
  const item = ALL.find((x) => x.id === id);
  if (!item || !canManageItem(item)) {
    alert("본인 판매글 또는 수퍼어드민만 상태를 변경할 수 있습니다.");
    return;
  }
  try {
    await updateDoc(doc(db, "usedMarketPosts", id), {
      status: newStatus,
      updatedAt: serverTimestamp(),
    });
    item.status = newStatus;
    render();
    showToast(`상품 상태가 '${statusText(newStatus)}'(으)로 변경되었습니다.`);
  } catch (err) {
    console.error("Status update failed:", err);
    alert("상태 변경 실패: " + (err?.message || err));
  }
}

async function deleteItem(id) {
  const item = ALL.find((x) => x.id === id);
  if (!item || !canManageItem(item)) {
    alert("본인 판매글 또는 수퍼어드민만 삭제할 수 있습니다.");
    return;
  }
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
  if (!item || !canManageItem(item)) {
    alert("수정 권한이 없습니다.");
    return;
  }

  $("mEditId").value = item.id;
  $("mEditStatus").value = item.status || "on_sale";
  if ($("mEditCategory")) $("mEditCategory").value = inferCategory(item);
  $("mEditTitle").value = item.title || "";
  $("mEditPrice").value = priceForVndInput(item);
  if ($("mEditCondition")) $("mEditCondition").value = item.condition || "중고(상태좋음)";
  if ($("mEditNegotiable")) $("mEditNegotiable").checked = item.negotiable !== false;
  if ($("mEditBmPayOk")) $("mEditBmPayOk").checked = item.bmPayOk !== false;
  $("mEditRegion").value = item.region || "";
  if ($("mEditMeetSpot")) $("mEditMeetSpot").value = item.meetSpot || "";
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
    const category = $("mEditCategory")?.value || "기타";
    const price = Number($("mEditPrice")?.value || 0);
    const condition = $("mEditCondition")?.value || "중고(상태좋음)";
    const negotiable = !!$("mEditNegotiable")?.checked;
    const bmPayOk = !!$("mEditBmPayOk")?.checked;
    const region = ($("mEditRegion")?.value || "").trim();
    const meetSpot = ($("mEditMeetSpot")?.value || "").trim();
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
      category: price === 0 ? "무료나눔" : category,
      price,
      isFreeShare: price === 0,
      condition,
      negotiable,
      bmPayOk,
      currency: "VND",
      region,
      meetSpot,
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
    showToast("🥕 상품 정보가 성공적으로 수정되었습니다.");
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
  loadLikesFromStorage();
  const state = $("umState");
  if (state) state.textContent = "동네 중고거래 물품을 불러오는 중...";

  try {
    const snap = await getDocs(query(collection(db, "usedMarketPosts"), orderBy("createdAt", "desc"), limit(150)));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    ALL = rows;
    render();
  } catch (e) {
    if (state) state.textContent = "목록을 불러오지 못했습니다.";
    console.warn(e);
  }
}

// ── 동네 칩 / 카테고리 칩 / 검색 이벤트 등록 ──
document.querySelectorAll("#umRegionChips .um-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedRegion = btn.getAttribute("data-region") || "all";
    document.querySelectorAll("#umRegionChips .um-chip").forEach((b) => b.classList.toggle("is-active", b === btn));
    render();
  });
});

document.querySelectorAll("#umCategoryChips .um-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedCategory = btn.getAttribute("data-cat") || "all";
    document.querySelectorAll("#umCategoryChips .um-chip").forEach((b) => b.classList.toggle("is-active", b === btn));
    render();
  });
});

$("btnMyLikesToggle")?.addEventListener("click", () => {
  onlyMyLikes = !onlyMyLikes;
  const btn = $("btnMyLikesToggle");
  if (btn) {
    btn.style.background = onlyMyLikes ? "#ff6f0f" : "#fff";
    btn.style.color = onlyMyLikes ? "#fff" : "#c2410c";
  }
  render();
});

$("btnMyPostsToggle")?.addEventListener("click", () => {
  if (!_currentUser) {
    alert("내 판매글을 보려면 먼저 로그인해 주세요.");
    return;
  }
  onlyMyPosts = !onlyMyPosts;
  const btn = $("btnMyPostsToggle");
  if (btn) {
    btn.style.background = onlyMyPosts ? "#0f172a" : "#fff";
    btn.style.color = onlyMyPosts ? "#fff" : "#334155";
  }
  render();
});

["umSearch", "umStatus", "umSort", "umOnlyFree", "umOnlyBmPay"].forEach((id) => {
  $(id)?.addEventListener("input", render);
  $(id)?.addEventListener("change", render);
});

// 그리드 내 조작 (이벤트 위임)
$("umGrid")?.addEventListener("change", async (e) => {
  const sel = e.target.closest(".um-admin-status-select");
  if (!sel) return;
  const id = sel.getAttribute("data-id");
  const newStatus = sel.value;
  sel.setAttribute("data-status", newStatus);
  await updateItemStatus(id, newStatus);
});

$("umGrid")?.addEventListener("click", (e) => {
  const btnLike = e.target.closest(".um-like-btn");
  if (btnLike) {
    e.preventDefault();
    e.stopPropagation();
    toggleLike(btnLike.getAttribute("data-id"));
    return;
  }

  const btnBump = e.target.closest(".btn-um-bump");
  if (btnBump) {
    e.preventDefault();
    e.stopPropagation();
    bumpItem(btnBump.getAttribute("data-id"));
    return;
  }

  const btnEdit = e.target.closest(".btn-um-edit");
  if (btnEdit) {
    e.preventDefault();
    e.stopPropagation();
    openAdminEditModal(btnEdit.getAttribute("data-id"));
    return;
  }

  const btnDel = e.target.closest(".btn-um-delete");
  if (btnDel) {
    e.preventDefault();
    e.stopPropagation();
    deleteItem(btnDel.getAttribute("data-id"));
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
