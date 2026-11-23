// /assets/js/pages/used_market_item.js — 당근마켓 수준 상세 페이지 (매너온도 · 당근톡 · 가격제안 · BM페이 · 끌올 · 유사매물)
import { onAuthReady } from "/assets/js/auth.js";
import { app, db } from "/assets/js/firebase-init.js";
import { formatUsedPrice, priceForVndInput } from "/assets/js/used-market-currency.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
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

function statusText(s) {
  if (s === "sold") return "거래완료";
  if (s === "reserved") return "예약중";
  if (s === "hidden") return "숨김";
  return "판매중";
}

function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtDate(v) {
  try {
    const ms = toMillis(v);
    return ms ? new Date(ms).toLocaleString("ko-KR") : "-";
  } catch {
    return "-";
  }
}

function timeAgo(post) {
  const bumpedMs = toMillis(post?.bumpedAt);
  const createdMs = toMillis(post?.createdAt);
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

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function inferCategory(post) {
  if (post?.category && String(post.category).trim()) return String(post.category).trim();
  if (Number(post?.price) === 0 || post?.isFreeShare) return "무료나눔";
  const text = `${post?.title || ""} ${post?.description || ""}`.toLowerCase();
  if (/아이폰|갤럭시|맥북|노트북|패드|에어팟|모니터|tv|냉장고|세탁기|청소기|제습기|공기청정기|에어프라이어|전자|가전|컴퓨터|카메라/.test(text)) return "디지털/가전";
  if (/침대|매트리스|소파|책상|식탁|의자|수납|선반|가구|커튼|조명|인테리어/.test(text)) return "가구/인테리어";
  if (/유모차|카시트|아기|유아|장난감|기저귀|분유|젖병|키즈/.test(text)) return "유아동/출산";
  if (/골프|드라이버|아이언|퍼터|테니스|배드민턴|자전거|캠핑|운동|헬스|라켓/.test(text)) return "스포츠/골프";
  if (/오토바이|스쿠터|혼다|야마하|차량|자동차|헬멧/.test(text)) return "오토바이/차량";
  if (/옷|의류|가방|신발|운동화|원피스|자켓|명품|시계|지갑/.test(text)) return "의류/잡화";
  if (/그릇|냄비|프라이팬|주방|식기|정수기|생필품/.test(text)) return "생활/주방";
  return "기타";
}

function getMannerTemp(post) {
  if (typeof post?.mannerTemp === "number" && Number.isFinite(post.mannerTemp)) {
    return post.mannerTemp;
  }
  const seed = String(post?.sellerUid || post?.sellerEmail || post?.id || "user");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const bonus = (Math.abs(h) % 45) / 10;
  return Number((36.5 + bonus).toFixed(1));
}

const postId = new URLSearchParams(location.search).get("id") || "";
let viewer = null;
let postData = null;
let _isSuperAdmin = false;
let chatMessages = [];

function isPostLiked(id) {
  try {
    const arr = JSON.parse(localStorage.getItem("bestclub_karrot_likes") || "[]");
    return Array.isArray(arr) && arr.includes(id);
  } catch {
    return false;
  }
}

function togglePostLike(id) {
  try {
    const raw = JSON.parse(localStorage.getItem("bestclub_karrot_likes") || "[]");
    const set = new Set(Array.isArray(raw) ? raw : []);
    if (set.has(id)) {
      set.delete(id);
      showToast("관심목록에서 해제되었습니다.");
    } else {
      set.add(id);
      showToast("❤️ 관심목록에 추가되었습니다!");
    }
    localStorage.setItem("bestclub_karrot_likes", JSON.stringify([...set]));
    if (postData) render(postData);
  } catch (_) {}
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

function canManagePost() {
  if (!viewer?.uid) return false;
  if (_isSuperAdmin) return true;
  return !!(postData?.sellerUid && viewer.uid === postData.sellerUid);
}

function fillEditForm(post) {
  if ($("eStatus")) $("eStatus").value = post.status || "on_sale";
  if ($("eCategory")) $("eCategory").value = inferCategory(post);
  $("eTitle").value = post.title || "";
  $("ePrice").value = priceForVndInput(post);
  if ($("eCondition")) $("eCondition").value = post.condition || "중고(상태좋음)";
  if ($("eNegotiable")) $("eNegotiable").checked = post.negotiable !== false;
  if ($("eBmPayOk")) $("eBmPayOk").checked = post.bmPayOk !== false;
  $("eRegion").value = post.region || "";
  if ($("eMeetSpot")) $("eMeetSpot").value = post.meetSpot || "";
  $("eContact").value = post.contact || "";
  $("eDesc").value = post.description || "";

  const imgs = getImages(post).filter((u) => !u.endsWith("/logo2.png"));
  [1, 2, 3, 4].forEach((n) => {
    const el = $("eImage" + n);
    if (el) el.value = imgs[n - 1] || "";
  });
}

function openEdit() {
  if (!canManagePost()) return;
  fillEditForm(postData || {});
  const panel = $("umEditPanel");
  if (panel) {
    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
  const cat = inferCategory(post);
  const isFree = Number(post.price || 0) === 0 || post.isFreeShare === true;
  const negotiable = post.negotiable !== false && !isFree;
  const bmPayOk = post.bmPayOk !== false && !isFree;
  const temp = getMannerTemp(post);
  const tempPct = Math.min(100, Math.max(20, Math.round(((temp - 30) / 20) * 100)));
  const sellerDisplay = post.sellerName || (post.sellerEmail ? post.sellerEmail.split("@")[0] : "하노이 이웃");

  $("dTitle").textContent = post.title || "제목 없음";
  $("dBadge").innerHTML = `<span class="um-badge ${esc(stVal)}" style="font-size:12.5px; padding:5px 12px;">${statusText(stVal)}</span>`;
  $("dMetaRow").innerHTML = `<span style="font-weight:700; color:#ff6f0f;">${esc(cat)}</span> · <span>${esc(timeAgo(post))}</span>`;

  const priceEl = $("dPrice");
  if (priceEl) {
    priceEl.textContent = isFree ? "🎁 무료나눔" : formatUsedPrice(post);
    priceEl.classList.toggle("is-free", isFree);
  }

  const pillsEl = $("dPills");
  if (pillsEl) {
    const pills = [];
    if (post.condition) pills.push(`<span class="um-pill-tag cond">${esc(post.condition)}</span>`);
    if (negotiable) pills.push(`<span class="um-pill-tag nego">💬 가격제안 가능</span>`);
    if (bmPayOk) pills.push(`<span class="um-pill-tag bm">💳 BM 안전결제 가능</span>`);
    pillsEl.innerHTML = pills.join("");
  }

  // 판매자 & 매너온도
  $("dSeller").textContent = sellerDisplay;
  if ($("dSellerAvatar")) $("dSellerAvatar").textContent = sellerDisplay.slice(0, 1).toUpperCase();
  if ($("dRegionSub")) $("dRegionSub").textContent = `📍 ${post.region || "하노이"}${post.meetSpot ? ` · ${post.meetSpot}` : ""}`;
  if ($("dMannerTemp")) $("dMannerTemp").textContent = `${temp.toFixed(1)}°C ${temp >= 39 ? "😄" : "😊"}`;
  if ($("dMannerFill")) $("dMannerFill").style.width = `${tempPct}%`;

  // 상세 테이블
  $("dRegion").textContent = post.region || "-";
  if ($("dMeetSpot")) $("dMeetSpot").textContent = post.meetSpot || "직거래 또는 그랩퀵 협의";
  if ($("dCondition")) $("dCondition").textContent = post.condition || "중고 (상태 좋음)";
  const isLoggedInViewer = Boolean(viewer && viewer.uid && !viewer.isAnonymous);
  $("dContact").textContent = post.contact
    ? (isLoggedInViewer ? post.contact : "🔒 로그인 후 판매자 연락처 확인 가능")
    : "-";
  $("dDate").textContent = `${fmtDate(post.createdAt)}${post.bumpedAt ? ` (최근 끌올: ${timeAgo(post)})` : ""}`;
  $("dDesc").textContent = post.description || "";

  // 관심 버튼 상태
  const liked = isPostLiked(post.id);
  const likeCount = Math.max(0, Number(post.likeCount || 0) + (liked ? 1 : 0));
  const btnLike = $("btnDetailLike");
  if (btnLike) {
    btnLike.innerHTML = `${liked ? "❤️ 관심중" : "🤍 관심"} <span id="dLikeCount">${likeCount}</span>`;
  }

  const hasPerm = canManagePost();
  $("umOwnerTools").style.display = hasPerm ? "flex" : "none";
  if ($("umSuperAdminPill")) {
    $("umSuperAdminPill").style.display = _isSuperAdmin ? "inline-flex" : "none";
  }

  $("umDetailState").style.display = "none";
  $("umDetail").style.display = "grid";
}

// ── 💬 당근톡 실시간 문의 & 가격 제안 로드 (purchaseRequests 컬렉션 활용) ──
async function loadChatMessages() {
  if (!postId) return;
  try {
    const q = query(
      collection(db, "purchaseRequests"),
      where("usedPostId", "==", postId)
    );
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    rows.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    chatMessages = rows;
    renderChatMessages();
  } catch (err) {
    console.warn("Chat load error:", err);
  }
}

function renderChatMessages() {
  const listEl = $("dChatList");
  const countEl = $("dChatCount");
  if (countEl) countEl.textContent = String(chatMessages.length);
  if (!listEl) return;

  if (!chatMessages.length) {
    listEl.innerHTML = `<div class="muted" style="text-align:center; padding:18px; font-size:13px;">아직 등록된 당근톡 문의가 없습니다. 첫 메시지나 가격 제안을 남겨보세요!</div>`;
    return;
  }

  listEl.innerHTML = chatMessages.map((m) => {
    const isSellerMsg = postData?.sellerUid && m.senderUid === postData.sellerUid;
    const isMine = viewer?.uid && m.senderUid === viewer.uid;
    const offerVnd = Number(m.offerPrice || 0);
    return `
      <div class="um-chat-bubble ${isMine ? "is-mine" : ""} ${isSellerMsg ? "is-seller" : ""}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px; font-size:12px;">
          <div>
            <strong style="color:#0f172a;">${esc(m.senderName || "이웃")}</strong>
            ${isSellerMsg ? `<span style="background:#2563eb; color:#fff; font-size:10px; font-weight:700; padding:1px 6px; border-radius:99px; margin-left:4px;">판매자</span>` : ""}
            ${offerVnd > 0 ? `<span style="background:#ff6f0f; color:#fff; font-size:11px; font-weight:800; padding:2px 8px; border-radius:99px; margin-left:6px;">💰 가격제안: ${offerVnd.toLocaleString()} VND</span>` : ""}
          </div>
          <span style="color:#94a3b8; font-size:11px;">${fmtDate(m.createdAt)}</span>
        </div>
        <div style="color:#1e293b; word-break:break-word;">${esc(m.message || "")}</div>
      </div>
    `;
  }).join("");
  listEl.scrollTop = listEl.scrollHeight;
}

async function handleSendChat(e) {
  e.preventDefault();
  if (!viewer) {
    if (confirm("당근톡 문의 및 가격 제안을 하려면 로그인이 필요합니다.\n로그인 페이지로 이동하시겠습니까?")) {
      location.href = "/login.html";
    }
    return;
  }

  const msgInput = $("chatMessageInput");
  const offerInput = $("chatOfferPrice");
  const btn = $("btnSendChat");
  const text = (msgInput?.value || "").trim();
  const offerPrice = Number(offerInput?.value || 0);

  if (!text) return;
  if (btn) btn.disabled = true;

  try {
    const payload = {
      type: "karrot_used_chat",
      usedPostId: postId,
      usedPostTitle: postData?.title || "",
      sellerUid: postData?.sellerUid || "",
      senderUid: viewer.uid,
      senderEmail: viewer.email || "",
      senderName: viewer.displayName || (viewer.email ? viewer.email.split("@")[0] : "이웃"),
      message: text,
      offerPrice: offerPrice > 0 ? offerPrice : 0,
      createdAt: serverTimestamp(),
    };

    const refDoc = await addDoc(collection(db, "purchaseRequests"), payload);
    chatMessages.push({ id: refDoc.id, ...payload, createdAt: new Date() });
    if (msgInput) msgInput.value = "";
    if (offerInput) offerInput.value = "";
    renderChatMessages();
    showToast(offerPrice > 0 ? "💰 가격 제안과 메시지가 등록되었습니다!" : "💬 당근톡 메시지가 등록되었습니다!");
  } catch (err) {
    alert("메시지 전송 실패: " + (err?.message || err));
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── 🥕 이 동네 다른 당근 매물 추천 ──
async function loadRelatedPosts() {
  const grid = $("dRelatedGrid");
  if (!grid) return;
  try {
    const snap = await getDocs(query(collection(db, "usedMarketPosts"), orderBy("createdAt", "desc"), limit(12)));
    const rows = [];
    snap.forEach((d) => {
      const data = d.data();
      if (d.id !== postId && data.status !== "hidden") {
        rows.push({ id: d.id, ...data });
      }
    });
    const top4 = rows.slice(0, 4);
    if (!top4.length) {
      grid.innerHTML = `<div class="muted" style="font-size:13px;">다른 등록된 매물이 없습니다.</div>`;
      return;
    }
    grid.innerHTML = top4.map((x) => {
      const stVal = x.status || "on_sale";
      const thumb = (Array.isArray(x.imageUrls) && x.imageUrls[0]) || x.imageUrl || "/assets/images/jump/logo2.png";
      const isFree = Number(x.price || 0) === 0 || x.isFreeShare;
      return `
        <div class="um-card">
          <a class="um-card-link" href="/used-market-item.html?id=${encodeURIComponent(x.id)}">
            <div class="um-thumb-wrap">
              <img class="um-thumb" src="${esc(thumb)}" alt="${esc(x.title)}" loading="lazy" onerror="this.src='/assets/images/jump/logo2.png'" />
              <span class="um-badge ${esc(stVal)}">${statusText(stVal)}</span>
            </div>
            <div class="um-body">
              <div class="um-title">${esc(x.title || "제목 없음")}</div>
              <div class="um-submeta">📍 ${esc(x.region || "하노이")} · ${esc(timeAgo(x))}</div>
              <div class="um-price ${isFree ? "is-free" : ""}">${isFree ? "🎁 무료나눔" : esc(formatUsedPrice(x))}</div>
            </div>
          </a>
        </div>
      `;
    }).join("");
  } catch (_) {}
}

async function setStatus(next) {
  if (!postId || !canManagePost()) return;
  try {
    await updateDoc(doc(db, "usedMarketPosts", postId), {
      status: next,
      updatedAt: serverTimestamp(),
    });
    render({ ...postData, status: next });
    showToast(`상태가 '${statusText(next)}'(으)로 변경되었습니다.`);
  } catch (e) {
    console.error("Status update error:", e);
    alert("상태 변경 실패: " + (e?.message || e));
  }
}

async function bumpPost() {
  if (!postId || !canManagePost()) return;
  try {
    await updateDoc(doc(db, "usedMarketPosts", postId), {
      bumpedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    render({ ...postData, bumpedAt: new Date() });
    showToast("🚀 게시글이 최신순 상단으로 끌올되었습니다!");
  } catch (e) {
    alert("끌올 실패: " + (e?.message || e));
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
    const rawCat = $("eCategory")?.value || "기타";
    const price = Number(("" + ($("ePrice")?.value || "0")).replace(/,/g, ""));
    const isFreeShare = price === 0 || rawCat === "무료나눔";
    const category = isFreeShare ? "무료나눔" : rawCat;
    const condition = $("eCondition")?.value || "중고(상태좋음)";
    const negotiable = !isFreeShare && !!$("eNegotiable")?.checked;
    const bmPayOk = !isFreeShare && !!$("eBmPayOk")?.checked;
    const region = ($("eRegion")?.value || "").trim();
    const meetSpot = ($("eMeetSpot")?.value || "").trim();
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
      category,
      price: isFreeShare ? 0 : price,
      isFreeShare,
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

    await updateDoc(doc(db, "usedMarketPosts", postId), payload);
    render({ ...postData, ...payload });
    closeEdit();
    showToast("🥕 상품 정보가 성공적으로 수정되었습니다.");
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
    loadChatMessages();
    loadRelatedPosts();
  } catch (e) {
    console.error("Fetch error:", e);
    $("umDetailState").textContent = "상세 정보를 불러오지 못했습니다.";
  }
});

// ── 액션 버튼 바인딩 ──
$("btnDetailLike")?.addEventListener("click", () => {
  if (postId) togglePostLike(postId);
});

$("btnOpenOffer")?.addEventListener("click", () => {
  const sec = $("umChatSection");
  if (sec) sec.scrollIntoView({ behavior: "smooth", block: "center" });
  const offerInput = $("chatOfferPrice");
  if (offerInput) {
    const base = Number(postData?.price || 0);
    if (base > 0 && !offerInput.value) {
      offerInput.value = String(Math.round((base * 0.9) / 1000) * 1000);
    }
    offerInput.focus();
  }
});

$("btnOpenBmPay")?.addEventListener("click", () => {
  const modal = $("bmPayModal");
  if (!modal || !postData) return;
  const sellerName = postData.sellerName || (postData.sellerEmail ? postData.sellerEmail.split("@")[0] : "판매자");
  const amtText = Number(postData.price || 0) === 0 ? "무료나눔 (0 VND)" : formatUsedPrice(postData);
  if ($("bmPaySellerName")) $("bmPaySellerName").textContent = sellerName;
  if ($("bmPayAmountText")) $("bmPayAmountText").textContent = amtText;

  const payUrl = `${window.location.origin}/wallet.html?to=${encodeURIComponent(postData.sellerUid || "")}&amount=${encodeURIComponent(postData.price || 0)}&memo=${encodeURIComponent("당근직거래:" + (postData.title || ""))}`;
  if ($("bmPayDirectLink")) $("bmPayDirectLink").href = payUrl;

  try {
    if (window.QRCode && $("bmPayQrCanvas")) {
      window.QRCode.toCanvas($("bmPayQrCanvas"), payUrl, { width: 170, margin: 1 });
    }
  } catch (_) {}

  modal.style.display = "flex";
});

$("btnCloseBmPayModal")?.addEventListener("click", () => {
  $("bmPayModal").style.display = "none";
});
$("bmPayModalOverlay")?.addEventListener("click", () => {
  $("bmPayModal").style.display = "none";
});

$("btnShareKarrot")?.addEventListener("click", () => {
  if (!postData) return;
  const isFree = Number(postData.price || 0) === 0 || postData.isFreeShare;
  const priceStr = isFree ? "무료나눔" : formatUsedPrice(postData);
  const text = `🥕 [하노이 베스트 당근장터] ${postData.title}\n📍 거래동네: ${postData.region || "하노이"}${postData.meetSpot ? ` (${postData.meetSpot})` : ""}\n💰 가격: ${priceStr}\n👉 상세보기: ${window.location.href}`;
  navigator.clipboard.writeText(text).then(() => {
    showToast("📣 단톡방 홍보 문구와 링크가 복사되었습니다!");
  }).catch(() => {
    alert(text);
  });
});

$("btnCopyContact")?.addEventListener("click", () => {
  const c = postData?.contact || "";
  if (!c) return;
  navigator.clipboard.writeText(c).then(() => {
    showToast("📞 판매자 연락처가 복사되었습니다: " + c);
  });
});

document.querySelectorAll(".um-quick-msg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inp = $("chatMessageInput");
    if (inp) {
      inp.value = btn.getAttribute("data-msg") || "";
      inp.focus();
    }
  });
});

$("umChatForm")?.addEventListener("submit", handleSendChat);
$("btnBumpPost")?.addEventListener("click", bumpPost);
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
