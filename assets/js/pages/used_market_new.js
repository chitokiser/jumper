// /assets/js/pages/used_market_new.js
import { onAuthReady } from "/assets/js/auth.js";
import { app, db } from "/assets/js/firebase-init.js";
import {
  collection,
  addDoc,
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
const MAX_FILES = 4;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

function extFromType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  return "jpg";
}

function renderPreview(files) {
  const wrap = $("fImagePreview");
  if (!wrap) return;
  if (!files.length) {
    wrap.style.display = "none";
    wrap.innerHTML = "";
    return;
  }

  wrap.style.display = "grid";
  wrap.innerHTML = files
    .map((file, idx) => {
      const url = URL.createObjectURL(file);
      return `
        <div class="um-upload-card">
          <img src="${url}" alt="미리보기 ${idx + 1}" />
          <div class="um-upload-name">${file.name}</div>
        </div>
      `;
    })
    .join("");
}

function readSelectedFiles() {
  const input = $("fImages");
  if (!input?.files) return [];

  const files = Array.from(input.files)
    .filter((f) => String(f.type || "").startsWith("image/"))
    .slice(0, MAX_FILES);

  return files;
}

async function uploadImages(userUid, files, setMsg) {
  const urls = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`파일 용량 초과: ${file.name} (10MB 이하만 가능)`);
    }

    setMsg?.(`이미지 업로드 중... (${i + 1}/${files.length})`);

    const safeName = sanitizeFileName(file.name);
    const ext = safeName.includes(".") ? safeName.split(".").pop() : extFromType(file.type);
    const path = `used-market/${userUid}/${Date.now()}-${i + 1}.${ext}`;
    const fileRef = ref(storage, path);

    await uploadBytes(fileRef, file, {
      contentType: file.type || "image/jpeg",
      customMetadata: {
        originalName: safeName,
      },
    });

    const url = await getDownloadURL(fileRef);
    urls.push(url);
  }
  return urls;
}

onAuthReady(({ loggedIn, user }) => {
  const form = $("umForm");
  const msg = $("fMsg");
  const btn = $("fSubmit");
  const inputImages = $("fImages");

  if (!form) return;

  if (!loggedIn || !user) {
    alert("로그인이 필요합니다.");
    location.href = "/used-market.html";
    return;
  }

  inputImages?.addEventListener("change", () => {
    const files = readSelectedFiles();
    renderPreview(files);
    if ((inputImages.files?.length || 0) > MAX_FILES) {
      alert("사진은 최대 4장까지 선택할 수 있습니다.");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = "등록 중...";

    const setMsg = (t) => {
      if (msg) msg.textContent = t;
    };

    const title = ($("fTitle")?.value || "").trim();
    const price = Number(("" + ($("fPrice")?.value || "0")).replace(/,/g, ""));
    const region = ($("fRegion")?.value || "").trim();
    const contact = ($("fContact")?.value || "").trim();
    const description = ($("fDesc")?.value || "").trim();

    if (!title || !region || !contact || !description || !Number.isFinite(price) || price < 0) {
      alert("필수 입력값을 확인해 주세요.");
      if (btn) btn.disabled = false;
      if (msg) msg.textContent = "";
      return;
    }

    try {
      const files = readSelectedFiles();
      if (files.length > MAX_FILES) {
        throw new Error("사진은 최대 4장까지 업로드할 수 있습니다.");
      }

      const imageUrls = await uploadImages(user.uid, files, setMsg);

      setMsg("게시글 저장 중...");
      const refDoc = await addDoc(collection(db, "usedMarketPosts"), {
        title,
        price,
        region,
        contact,
        imageUrls,
        imageUrl: imageUrls[0] || "",
        description,
        status: "on_sale",
        sellerUid: user.uid,
        sellerEmail: user.email || "",
        sellerName: user.displayName || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      location.href = `/used-market-item.html?id=${encodeURIComponent(refDoc.id)}`;
    } catch (err) {
      console.warn(err);
      alert("등록에 실패했습니다: " + (err?.message || err));
      if (btn) btn.disabled = false;
      if (msg) msg.textContent = "";
    }
  });
});
