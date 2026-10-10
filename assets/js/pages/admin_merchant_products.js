import { app } from "../firebase-init.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, query, where, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthReady } from "../auth.js";

const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentViewer = null;
let editingId = null;
let adminMerchantList = [];

onAuthReady(async ({ loggedIn, user, role, token }) => {
    if (!loggedIn) {
        window.location.href = "/login.html";
        return;
    }
    // token.merchant_id가 세팅되어 있지 않다면 임시 식별자(대한김치) 할당 (검증 편의상)
    currentViewer = {
        uid: user.uid,
        email: user.email,
        role: role,
        merchant_id: (token && token.merchant_id) ? token.merchant_id : "daehan_kimchi"
    };
    if (currentViewer.role === "admin") loadMerchantListForAdmin();
    loadProducts();
});


async function loadMerchantListForAdmin() {
    if (currentViewer.role !== "admin") return;
    $("adminMerchantRow").style.display = "block";
    try {
        const snap = await getDocs(collection(db, "merchants"));
        let options = "";
        adminMerchantList = [];
        snap.forEach(doc => {
            const data = doc.data();
            adminMerchantList.push({ id: doc.id, name: data.name || data.merchantName || doc.id });
            options += `<option value="${doc.id}">${data.name || data.merchantName || doc.id} (${doc.id})</option>`;
        });
        if (options === "") options = "<option value=''>등록된 가맹점이 없습니다.</option>";
        $("pMerchantId").innerHTML = options;
    } catch (err) {
        console.error("가맹점 목록 실패:", err);
        $("pMerchantId").innerHTML = "<option value=''>가맹점 로딩 실패</option>";
    }
}

async function loadProducts() {
    if (!currentViewer) return;
    const listEl = $("productList");
    const stateEl = $("productState");

    stateEl.textContent = "가맹점 상품을 불러오는 중...";
    stateEl.style.display = "block";
    listEl.innerHTML = "";

    try {
        let q;
        if (currentViewer.role === "admin") {
            q = query(collection(db, "merchant_products"));
        } else {
            q = query(collection(db, "merchant_products"),
                where("merchant_id", "==", currentViewer.merchant_id));
        }

        const snap = await getDocs(q);
        let docs = [];
        snap.forEach(d => docs.push({ id: d.id, data: d.data() }));
        docs.sort((a, b) => {
            const timeA = a.data.created_at?.toMillis() || 0;
            const timeB = b.data.created_at?.toMillis() || 0;
            return timeB - timeA;
        });
        if (snap.empty) {
            stateEl.textContent = "아직 등록된 상품이 없습니다.";
            return;
        }

        let html = "";
        docs.forEach(docSnap => {
            const data = docSnap.data;
            html += `
                <div class="panel" style="padding:16px;border:1px solid #eee;border-radius:8px;box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                    ${data.image_url ? `<img src="${data.image_url}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />` : ""}
                    <div style="font-weight:bold;font-size:1.1rem;">${data.product_name}</div>
                    <div class="muted" style="font-size:0.9rem;margin-bottom:8px;">가격: ${Number(data.price).toLocaleString()} VND | 
                         상태: <span style="font-weight:bold;color:${data.sale_status === 'published' ? '#10b981' : '#ef4444'}">${data.sale_status}</span>
                    </div>
                    <div style="display:flex;gap:8px;">
                      <button class="btn btn--sm" data-action="edit" data-id="${docSnap.id}" data-payload='${JSON.stringify(data)}'>수정</button>
                      ${data.sale_status === 'draft' ? `<button class="btn btn--sm" style="background:#10b981;color:white;border:none;" data-action="publish" data-id="${docSnap.id}">! 지금 공개</button>` : `<button class="btn btn--sm" style="background:#f59e0b;color:white;border:none;" data-action="draft" data-id="${docSnap.id}">숨기기(임시저장)</button>`}
                    </div>
                </div>
            `;
        });
        listEl.innerHTML = html;
        stateEl.style.display = "none";

        // 이벤트 바인딩 로직
        listEl.querySelectorAll("button[data-action='edit']").forEach(btn => {
            btn.addEventListener("click", () => {
                editingId = btn.getAttribute("data-id");
                const data = JSON.parse(btn.getAttribute("data-payload"));
                $("modalTitle").textContent = "상품 정보 수정";
                if (currentViewer.role === "admin") {
                    $("pMerchantId").value = data.merchant_id || "";
                }
                $("pType").value = data.product_type || "physical_product";
                $("pName").value = data.product_name;
                $("pImg").value = data.image_url || "";
                $("pDesc").value = data.description || "";
                $("pPrice").value = data.price;
                $("pStatus").value = data.sale_status || "draft";
                $("productModal").style.display = "flex";
            });
        });

        listEl.querySelectorAll("button[data-action='publish']").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("해당 상품을 고객 홈페이지(쇼핑몰)에 즉시 노출하시겠습니까?")) return;
                const id = btn.getAttribute("data-id");
                await updateDoc(doc(db, "merchant_products", id), {
                    sale_status: "published",
                    published_at: serverTimestamp(),
                    updated_at: serverTimestamp()
                });
                alert("성공적으로 노출되었습니다!");
                loadProducts();
            });
        });

        listEl.querySelectorAll("button[data-action='draft']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                await updateDoc(doc(db, "merchant_products", id), {
                    sale_status: "draft",
                    updated_at: serverTimestamp()
                });
                loadProducts();
            });
        });

    } catch (e) {
        stateEl.textContent = "에러: " + e.message;
        console.error(e);
    }
}

$("btnCreateProduct").addEventListener("click", () => {
    editingId = null;
    $("modalTitle").textContent = "새 상품 등록";
    $("productForm").reset();
    $("productModal").style.display = "flex";
});
$("btnCloseModal").addEventListener("click", () => {
    $("productModal").style.display = "none";
});

$("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentViewer) return;

    $("btnSaveProduct").disabled = true;
    $("btnSaveProduct").textContent = "저장 중...";

    const data = {
        merchant_id: currentViewer.role === "admin" ? $("pMerchantId").value : currentViewer.merchant_id,
        product_type: $("pType").value,
        product_name: $("pName").value,
        image_url: $("pImg").value.trim(),
        description: $("pDesc").value,
        price: Number($("pPrice").value),
        sale_status: $("pStatus").value,
        updated_at: serverTimestamp(),
    };

    try {
        if (editingId) {
            await updateDoc(doc(db, "merchant_products", editingId), data);
            alert("수정 완료되었습니다.");
        } else {
            data.created_at = serverTimestamp();
            await addDoc(collection(db, "merchant_products"), data);
            alert("BestERP 카탈로그에 등록되었습니다.");
        }
        $("productModal").style.display = "none";
        loadProducts();
    } catch (err) {
        alert("저장 실패: " + err.message);
    } finally {
        $("btnSaveProduct").disabled = false;
        $("btnSaveProduct").textContent = "저장";
    }
});
