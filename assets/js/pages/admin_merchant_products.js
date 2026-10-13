import { app } from "../firebase-init.js";
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    getDoc,
    query,
    where,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthReady } from "../auth.js";

const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentViewer = null;
let editingId = null;
let editingMerchantId = null;
let adminMerchantList = [];

// XSS 방지 헬퍼
function esc(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

onAuthReady(async ({ loggedIn, user, role, token }) => {
    if (!loggedIn) {
        window.location.href = "/login.html";
        return;
    }

    // 가맹점 식별자(merchant_id) 확인 및 보안 바인딩
    let merchantId = (token && token.merchant_id) ? token.merchant_id : null;
    let merchantName = "";

    try {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
            const ud = uSnap.data() || {};
            if (!merchantId) {
                merchantId = ud.merchantId || ud.merchant_id || ud.tenant_id;
            }
        }

        // 만약 users에 없다면 merchants 컬렉션에서 ownerUid로 조회
        if (!merchantId) {
            const mQ = query(collection(db, "merchants"), where("ownerUid", "==", user.uid));
            const mSnap = await getDocs(mQ);
            if (!mSnap.empty) {
                const mDoc = mSnap.docs[0];
                merchantId = mDoc.id;
                merchantName = mDoc.data()?.name || "";
            }
        }

        // 특정 가맹점 문서가 있으면 이름 조회
        if (merchantId && !merchantName) {
            try {
                const mDocSnap = await getDoc(doc(db, "merchants", String(merchantId)));
                if (mDocSnap.exists()) {
                    merchantName = mDocSnap.data()?.name || "";
                }
            } catch (_) { }
        }
    } catch (e) {
        console.warn("가맹점 식별 로드 실패:", e);
    }

    // 기본 가맹점 fallback (개발/테스트용)
    if (!merchantId) {
        merchantId = "daehan_kimchi";
        merchantName = "대한김치";
    }

    currentViewer = {
        uid: user.uid,
        email: user.email || "",
        role: role,
        merchant_id: merchantId,
        merchant_name: merchantName || merchantId
    };

    // 상단 가맹점 안내 뱃지 갱신
    const badgeEl = $("merchantInfoBadge");
    if (badgeEl) {
        if (currentViewer.role === "admin" || currentViewer.role === "SUPER_ADMIN") {
            badgeEl.innerHTML = `🛡️ <b>관리자 전체 모드</b> (${currentViewer.email}) | 모든 가맹점의 상품을 관리할 수 있습니다.`;
        } else {
            badgeEl.innerHTML = `🏪 <b>가맹점:</b> ${esc(currentViewer.merchant_name)} <span style="font-family:monospace;font-size:0.8rem;color:#94a3b8;">(${esc(currentViewer.merchant_id)})</span> | 로그인: ${esc(currentViewer.email)}`;
        }
    }

    if (currentViewer.role === "admin" || currentViewer.role === "SUPER_ADMIN") {
        await loadMerchantListForAdmin();
    }
    loadProducts();
});

async function loadMerchantListForAdmin() {
    if ($("adminMerchantRow")) $("adminMerchantRow").style.display = "block";
    try {
        const snap = await getDocs(collection(db, "merchants"));
        let options = "";
        adminMerchantList = [];
        snap.forEach(d => {
            const data = d.data();
            const name = data.name || data.merchantName || d.id;
            adminMerchantList.push({ id: d.id, name });
            options += `<option value="${esc(d.id)}">${esc(name)} (${esc(d.id)})</option>`;
        });
        if (options === "") options = "<option value=''>등록된 가맹점이 없습니다.</option>";
        if ($("pMerchantId")) $("pMerchantId").innerHTML = options;
    } catch (err) {
        console.error("가맹점 목록 실패:", err);
        if ($("pMerchantId")) $("pMerchantId").innerHTML = "<option value=''>가맹점 로딩 실패</option>";
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
        const isAdmin = currentViewer.role === "admin" || currentViewer.role === "SUPER_ADMIN";

        if (isAdmin) {
            // 관리자는 전체 조회
            q = query(collection(db, "merchant_products"));
        } else {
            // 가맹점은 본인 merchant_id 상품만 조회 (보안 필터)
            q = query(collection(db, "merchant_products"), where("merchant_id", "==", currentViewer.merchant_id));
        }

        const snap = await getDocs(q);
        let docs = [];
        snap.forEach(d => docs.push({ id: d.id, data: d.data() }));

        docs.sort((a, b) => {
            const timeA = a.data.created_at?.toMillis?.() || (a.data.created_at?.seconds ? a.data.created_at.seconds * 1000 : 0);
            const timeB = b.data.created_at?.toMillis?.() || (b.data.created_at?.seconds ? b.data.created_at.seconds * 1000 : 0);
            return timeB - timeA;
        });

        if (docs.length === 0) {
            stateEl.textContent = "아직 등록된 상품이 없습니다. [+ 상품 등록] 버튼을 눌러 상품을 추가해보세요.";
            return;
        }

        let html = "";
        docs.forEach(docSnap => {
            const data = docSnap.data;
            const pTypeMap = {
                physical_product: "일반 상품",
                menu: "메뉴 (음식)",
                service: "서비스",
                booking: "예약형"
            };
            const typeLabel = pTypeMap[data.product_type] || (data.product_type || "기타");

            // 상태 뱃지 스타일
            let statusBadge = "";
            if (data.sale_status === "published") {
                statusBadge = '<span style="background:#dcfce7; color:#15803d; font-weight:700; padding:2px 8px; border-radius:4px; font-size:0.8rem;">판매 공개중</span>';
            } else if (data.sale_status === "sold_out") {
                statusBadge = '<span style="background:#f1f5f9; color:#64748b; font-weight:700; padding:2px 8px; border-radius:4px; font-size:0.8rem;">품절</span>';
            } else {
                statusBadge = '<span style="background:#fef3c7; color:#b45309; font-weight:700; padding:2px 8px; border-radius:4px; font-size:0.8rem;">임시저장(비공개)</span>';
            }

            // 본인 상품 여부 확인 (보안)
            const canManage = isAdmin || (data.merchant_id === currentViewer.merchant_id);

            html += `
                <div class="panel" style="padding:16px; border:1px solid #e2e8f0; border-radius:12px; background:#fff; box-shadow:0 2px 4px rgba(0,0,0,0.03); display:flex; flex-direction:column; justify-content:space-between;">
                    <div>
                        ${data.image_url ? `<img src="${esc(data.image_url)}" style="width:100%; height:160px; object-fit:cover; border-radius:8px; margin-bottom:10px;" onerror="this.style.display='none';" />` : ""}
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                            <div style="font-weight:700; font-size:1.1rem; color:#1e293b;">${esc(data.product_name)}</div>
                            ${statusBadge}
                        </div>
                        <div style="font-size:0.82rem; color:#64748b; margin-top:2px;">분류: ${esc(typeLabel)} ${isAdmin ? `| 가맹점: <b style="color:#2563eb;">${esc(data.merchant_id || '-')}</b>` : ''}</div>
                        <div style="font-size:1.15rem; font-weight:800; color:#0f766e; margin:8px 0;">${Number(data.price || 0).toLocaleString()} VND</div>
                        ${data.description ? `<p style="font-size:0.85rem; color:#475569; margin:0 0 12px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(data.description)}</p>` : ''}
                    </div>

                    <div style="display:flex; gap:6px; flex-wrap:wrap; border-top:1px solid #f1f5f9; padding-top:12px; margin-top:8px;">
                      ${canManage ? `
                          <button class="btn btn--sm" data-action="edit" data-id="${esc(docSnap.id)}" data-payload='${esc(JSON.stringify(data))}'>✏️ 수정</button>
                          ${data.sale_status === 'published'
                        ? `<button class="btn btn--sm" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a;" data-action="draft" data-id="${esc(docSnap.id)}">숨기기(임시저장)</button>`
                        : `<button class="btn btn--sm" style="background:#dcfce7; color:#166534; border:1px solid #bbf7d0; font-weight:600;" data-action="publish" data-id="${esc(docSnap.id)}">📢 쇼핑몰 노출</button>`}
                          <button class="btn btn--sm" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; margin-left:auto;" data-action="delete" data-id="${esc(docSnap.id)}" data-name="${esc(data.product_name)}" data-merchant="${esc(data.merchant_id)}">🗑️ 삭제</button>
                      ` : `
                          <span style="font-size:0.8rem; color:#94a3b8;">타 가맹점 상품 (수정 불가)</span>
                      `}
                    </div>
                </div>
            `;
        });
        listEl.innerHTML = html;
        stateEl.style.display = "none";

        // 이벤트 바인딩: 수정 모달 열기
        listEl.querySelectorAll("button[data-action='edit']").forEach(btn => {
            btn.addEventListener("click", () => {
                editingId = btn.getAttribute("data-id");
                const data = JSON.parse(btn.getAttribute("data-payload"));
                editingMerchantId = data.merchant_id;

                // 보안 검증: 권한 체크
                const isAdmin = currentViewer.role === "admin" || currentViewer.role === "SUPER_ADMIN";
                if (!isAdmin && editingMerchantId !== currentViewer.merchant_id) {
                    alert("본인 가맹점의 상품만 수정할 수 있습니다.");
                    return;
                }

                $("modalTitle").textContent = "상품 정보 수정";
                if ($("pMerchantId") && isAdmin) {
                    $("pMerchantId").value = data.merchant_id || "";
                }
                $("pType").value = data.product_type || "physical_product";
                $("pName").value = data.product_name || "";
                $("pImg").value = data.image_url || "";
                $("pDesc").value = data.description || "";
                $("pPrice").value = data.price || 0;
                $("pStatus").value = data.sale_status || "draft";

                // 모달 내 삭제 버튼 활성화
                const modalDelBtn = $("btnDeleteInModal");
                if (modalDelBtn) {
                    modalDelBtn.style.display = "inline-block";
                    modalDelBtn.onclick = () => handleDeleteProduct(editingId, data.product_name, editingMerchantId);
                }

                $("productModal").style.display = "flex";
            });
        });

        // 이벤트 바인딩: 상품 삭제
        listEl.querySelectorAll("button[data-action='delete']").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                const name = btn.getAttribute("data-name");
                const merchantId = btn.getAttribute("data-merchant");
                handleDeleteProduct(id, name, merchantId);
            });
        });

        // 이벤트 바인딩: 즉시 쇼핑몰 노출
        listEl.querySelectorAll("button[data-action='publish']").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("해당 상품을 고객 홈페이지(쇼핑몰)에 즉시 공개하시겠습니까?")) return;
                const id = btn.getAttribute("data-id");
                try {
                    await updateDoc(doc(db, "merchant_products", id), {
                        sale_status: "published",
                        published_at: serverTimestamp(),
                        updated_at: serverTimestamp()
                    });
                    alert("상품이 쇼핑몰에 공개되었습니다!");
                    loadProducts();
                } catch (err) {
                    alert("공개 상태 변경 실패: " + err.message);
                }
            });
        });

        // 이벤트 바인딩: 비공개(임시저장) 전환
        listEl.querySelectorAll("button[data-action='draft']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                try {
                    await updateDoc(doc(db, "merchant_products", id), {
                        sale_status: "draft",
                        updated_at: serverTimestamp()
                    });
                    alert("상품이 비공개(임시저장) 처리되었습니다.");
                    loadProducts();
                } catch (err) {
                    alert("상태 변경 실패: " + err.message);
                }
            });
        });

    } catch (e) {
        stateEl.textContent = "상품 목록 조회 실패: " + e.message;
        console.error(e);
    }
}

// 상품 안전 삭제 처리 함수 (보안 검증 및 확인 대화상자)
async function handleDeleteProduct(id, name, merchantId) {
    if (!currentViewer) return;

    // 1. 보안 권한 검증
    const isAdmin = currentViewer.role === "admin" || currentViewer.role === "SUPER_ADMIN";
    if (!isAdmin && merchantId !== currentViewer.merchant_id) {
        alert("⚠️ 보안 경고: 본인 가맹점의 상품만 삭제할 수 있습니다.");
        return;
    }

    // 2. 삭제 확인 대화상자
    const confirmed = confirm(
        `🗑️ 상품 삭제 확인\n\n정말로 "${name || '이 상품'}"을(를) 삭제하시겠습니까?\n삭제된 상품은 복구할 수 없으며 쇼핑몰에서도 즉시 제거됩니다.`
    );
    if (!confirmed) return;

    // 3. 삭제 실행
    try {
        await deleteDoc(doc(db, "merchant_products", id));
        alert("✅ 상품이 안전하게 삭제되었습니다.");

        // 모달이 열려 있었다면 닫기
        if ($("productModal")) $("productModal").style.display = "none";
        editingId = null;
        editingMerchantId = null;

        // 목록 새로고침
        loadProducts();
    } catch (err) {
        console.error("상품 삭제 실패:", err);
        alert("❌ 삭제 실패: " + (err.message || String(err)));
    }
}

// 새 상품 등록 버튼 클릭
$("btnCreateProduct").addEventListener("click", () => {
    editingId = null;
    editingMerchantId = null;
    $("modalTitle").textContent = "새 상품 등록";
    $("productForm").reset();

    const modalDelBtn = $("btnDeleteInModal");
    if (modalDelBtn) modalDelBtn.style.display = "none";

    $("productModal").style.display = "flex";
});

// 모달 닫기
$("btnCloseModal").addEventListener("click", () => {
    $("productModal").style.display = "none";
});

// 상품 저장(등록 및 수정) 제출
$("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentViewer) return;

    const isAdmin = currentViewer.role === "admin" || currentViewer.role === "SUPER_ADMIN";

    // 타겟 가맹점 결정
    let targetMerchantId;
    if (editingId) {
        // 수정 시에는 기존 상품의 merchant_id 유지 (관리자가 변경하지 않는 한)
        targetMerchantId = isAdmin && $("pMerchantId") ? ($("pMerchantId").value || editingMerchantId) : editingMerchantId;

        // 보안 검증: 가맹점 권한 사용자가 남의 상품을 수정하려는지 체크
        if (!isAdmin && editingMerchantId !== currentViewer.merchant_id) {
            alert("⚠️ 보안 경고: 타 가맹점의 상품을 수정할 수 없습니다.");
            return;
        }
    } else {
        // 등록 시
        targetMerchantId = isAdmin && $("pMerchantId") ? $("pMerchantId").value : currentViewer.merchant_id;
    }

    if (!targetMerchantId) {
        alert("가맹점 정보가 올바르지 않습니다.");
        return;
    }

    $("btnSaveProduct").disabled = true;
    $("btnSaveProduct").textContent = "저장 중...";

    const data = {
        merchant_id: targetMerchantId,
        product_type: $("pType").value,
        product_name: $("pName").value.trim(),
        image_url: $("pImg").value.trim(),
        description: $("pDesc").value.trim(),
        price: Number($("pPrice").value) || 0,
        sale_status: $("pStatus").value,
        updated_at: serverTimestamp()
    };

    try {
        if (editingId) {
            await updateDoc(doc(db, "merchant_products", editingId), data);
            alert("✅ 상품 정보가 성공적으로 수정되었습니다.");
        } else {
            data.created_at = serverTimestamp();
            await addDoc(collection(db, "merchant_products"), data);
            alert("✅ BestERP 카탈로그에 새 상품이 등록되었습니다.");
        }
        $("productModal").style.display = "none";
        loadProducts();
    } catch (err) {
        console.error("상품 저장 실패:", err);
        alert("저장 실패: " + err.message);
    } finally {
        $("btnSaveProduct").disabled = false;
        $("btnSaveProduct").textContent = "저장";
    }
});
