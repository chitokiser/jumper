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
let merchantMap = {}; // { id: { id, name, ownerUid, aliases: [] } }
let currentTab = "merchant_products"; // "merchant_products" | "items"
let rawMerchantProducts = [];
let rawItems = [];

// 가맹점 ID/영문별칭 상호 호환 매핑 테이블
const KNOWN_MERCHANT_ALIASES = {
    "daehan_kimchi": ["1791002036", "daehan_kimchi"],
    "1791002036": ["1791002036", "daehan_kimchi"],
    "bestwinner": ["1791605366", "bestwinner", "best_winner"],
    "1791605366": ["1791605366", "bestwinner", "best_winner"]
};

// XSS 방지 헬퍼
function esc(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

// 가맹점 매칭 헬퍼 (숫자/문자열/별칭 모두 포용)
function matchesMerchant(productMerchantId, filterMerchantId) {
    if (!filterMerchantId || filterMerchantId === "all") return true;
    const pStr = String(productMerchantId || "").trim();
    const fStr = String(filterMerchantId || "").trim();
    if (pStr === fStr) return true;

    const aliases = KNOWN_MERCHANT_ALIASES[fStr] || [fStr];
    return aliases.some(a => String(a).trim() === pStr);
}

// 가맹점 이름 해결 헬퍼
function getMerchantName(merchantId) {
    const mStr = String(merchantId || "").trim();
    if (merchantMap[mStr]?.name) return merchantMap[mStr].name;
    if (mStr === "daehan_kimchi" || mStr === "1791002036") return "대한김치";
    if (mStr === "bestwinner" || mStr === "1791605366") return "베스트위너";
    return mStr || "기타 가맹점";
}

onAuthReady(async ({ loggedIn, user, role, token }) => {
    // 1. 가맹점 마스터 목록 로드 (누구나 읽기 가능)
    await loadMerchantMasterList();

    if (!loggedIn) {
        // 비로그인 상태: 조회 모드로 페이지 안내
        currentViewer = {
            uid: null,
            email: "게스트(미로그인)",
            role: "guest",
            merchant_id: "all",
            merchant_name: "전체"
        };
        const badgeEl = $("merchantInfoBadge");
        if (badgeEl) {
            badgeEl.innerHTML = `⚠️ <b>미로그인 상태 (조회 전용)</b> | 상품 등록/수정 권한을 사용하려면 <a href="/login.html" style="color:#2563eb;font-weight:bold;text-decoration:underline;">로그인</a>하세요.`;
        }
        setupEventListeners();
        loadAllData();
        return;
    }

    // 2. 로그인 사용자 정보 및 가맹점 식별
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

    // 기본 가맹점 fallback (개발/테스트 계정)
    if (!merchantId) {
        merchantId = "all";
        merchantName = "전체 가맹점";
    }

    const isAdmin = role === "admin" || role === "SUPER_ADMIN" || role === "CEO" ||
        (user.email && user.email.toLowerCase() === "daguri75@gmail.com");

    currentViewer = {
        uid: user.uid,
        email: user.email || "",
        role: isAdmin ? "admin" : (role || "merchant"),
        merchant_id: merchantId,
        merchant_name: merchantName || merchantId
    };

    // 상단 가맹점 안내 뱃지 갱신
    const badgeEl = $("merchantInfoBadge");
    if (badgeEl) {
        if (currentViewer.role === "admin") {
            badgeEl.innerHTML = `🛡️ <b>최고 관리자 전체 모드</b> (${esc(currentViewer.email)}) | 모든 가맹점의 상품을 조회/등록/수정할 수 있습니다.`;
        } else {
            badgeEl.innerHTML = `🏪 <b>가맹점:</b> ${esc(currentViewer.merchant_name)} <span style="font-family:monospace;font-size:0.8rem;color:#94a3b8;">(${esc(currentViewer.merchant_id)})</span> | 로그인: ${esc(currentViewer.email)}`;
        }
    }

    // 관리자 전용 모달 row 노출
    if (isAdmin && $("adminMerchantRow")) {
        $("adminMerchantRow").style.display = "block";
    }

    // 드롭다운 기본값 설정
    if ($("filterMerchantSelect")) {
        if (!isAdmin && merchantId !== "all") {
            $("filterMerchantSelect").value = String(merchantId);
        } else {
            $("filterMerchantSelect").value = "all";
        }
    }

    setupEventListeners();
    loadAllData();
});

// 가맹점 마스터 목록 로드 (merchants 컬렉션)
async function loadMerchantMasterList() {
    try {
        const snap = await getDocs(collection(db, "merchants"));
        adminMerchantList = [];
        merchantMap = {};

        // 기본 대한김치/베스트위너 프리셋 등록
        merchantMap["1791002036"] = { id: "1791002036", name: "대한김치", ownerUid: "PvJXIzbh3FYRAPIdZAU1Z5Oo7jL2" };
        merchantMap["daehan_kimchi"] = { id: "1791002036", name: "대한김치", ownerUid: "PvJXIzbh3FYRAPIdZAU1Z5Oo7jL2" };
        merchantMap["1791605366"] = { id: "1791605366", name: "베스트위너", ownerUid: "aovjkF5ft8WG6yR6OgJcvuZCWSq1" };
        merchantMap["bestwinner"] = { id: "1791605366", name: "베스트위너", ownerUid: "aovjkF5ft8WG6yR6OgJcvuZCWSq1" };

        let filterOptions = `<option value="all">== 전체 가맹점 (모든 상품) ==</option>`;
        let modalOptions = "";

        snap.forEach(d => {
            const data = d.data();
            const id = d.id;
            const name = data.name || data.merchantName || id;
            const ownerUid = data.ownerUid || "";
            merchantMap[String(id)] = { id, name, ownerUid };
            adminMerchantList.push({ id, name, ownerUid });

            filterOptions += `<option value="${esc(id)}">${esc(name)} (${esc(id)})</option>`;
            modalOptions += `<option value="${esc(id)}">${esc(name)} (${esc(id)})</option>`;
        });

        // 만약 merchants 문서에 daehan_kimchi 문자열 ID가 별도로 없으면 옵션에 명시 보완
        if (!snap.docs.some(d => d.id === "1791002036")) {
            filterOptions += `<option value="1791002036">대한김치 (1791002036 / daehan_kimchi)</option>`;
            modalOptions += `<option value="1791002036">대한김치 (1791002036)</option>`;
        }
        if (!snap.docs.some(d => d.id === "1791605366")) {
            filterOptions += `<option value="1791605366">베스트위너 (1791605366)</option>`;
            modalOptions += `<option value="1791605366">베스트위너 (1791605366)</option>`;
        }

        if ($("filterMerchantSelect")) $("filterMerchantSelect").innerHTML = filterOptions;
        if ($("pMerchantId")) $("pMerchantId").innerHTML = modalOptions;
    } catch (err) {
        console.error("가맹점 마스터 로드 실패:", err);
    }
}

function setupEventListeners() {
    // 탭 전환 이벤트
    if ($("tabMerchantProducts")) {
        $("tabMerchantProducts").addEventListener("click", () => {
            currentTab = "merchant_products";
            $("tabMerchantProducts").className = "btn btn--sm btn--primary";
            $("tabMerchantProducts").style.background = "";
            $("tabMerchantProducts").style.color = "";
            $("tabItemsProducts").className = "btn btn--sm";
            $("tabItemsProducts").style.background = "#fff";
            $("tabItemsProducts").style.color = "#475569";
            renderCurrentView();
        });
    }

    if ($("tabItemsProducts")) {
        $("tabItemsProducts").addEventListener("click", () => {
            currentTab = "items";
            $("tabItemsProducts").className = "btn btn--sm btn--primary";
            $("tabItemsProducts").style.background = "";
            $("tabItemsProducts").style.color = "";
            $("tabMerchantProducts").className = "btn btn--sm";
            $("tabMerchantProducts").style.background = "#fff";
            $("tabMerchantProducts").style.color = "#475569";
            renderCurrentView();
        });
    }

    // 필터 변경 시 렌더링
    if ($("filterMerchantSelect")) {
        $("filterMerchantSelect").addEventListener("change", renderCurrentView);
    }
    if ($("filterStatusSelect")) {
        $("filterStatusSelect").addEventListener("change", renderCurrentView);
    }
}

// 전체 데이터 1회 로드
async function loadAllData() {
    const stateEl = $("productState");
    stateEl.textContent = "가맹점 상품을 불러오는 중...";
    stateEl.style.display = "block";

    try {
        // 1. merchant_products 컬렉션 로드 (전체 로드 후 메모리 필터링)
        const mpSnap = await getDocs(collection(db, "merchant_products"));
        rawMerchantProducts = [];
        mpSnap.forEach(d => rawMerchantProducts.push({ id: d.id, data: d.data() }));

        rawMerchantProducts.sort((a, b) => {
            const timeA = a.data.created_at?.toMillis?.() || (a.data.created_at?.seconds ? a.data.created_at.seconds * 1000 : 0);
            const timeB = b.data.created_at?.toMillis?.() || (b.data.created_at?.seconds ? b.data.created_at.seconds * 1000 : 0);
            return timeB - timeA;
        });

        // 2. items 컬렉션 로드 (기존 투어/프로그램)
        try {
            const itemsSnap = await getDocs(collection(db, "items"));
            rawItems = [];
            itemsSnap.forEach(d => rawItems.push({ id: d.id, data: d.data() }));
            rawItems.sort((a, b) => {
                const timeA = a.data.createdAt?.toMillis?.() || 0;
                const timeB = b.data.createdAt?.toMillis?.() || 0;
                return timeB - timeA;
            });
        } catch (itemErr) {
            console.warn("items 로드 불가 또는 비인가:", itemErr);
            rawItems = [];
        }

        renderCurrentView();
    } catch (err) {
        console.error("데이터 로드 실패:", err);
        stateEl.textContent = "상품 목록 조회 실패: " + err.message;
    }
}

// 현재 탭 및 필터에 맞춰 렌더링
function renderCurrentView() {
    const listEl = $("productList");
    const stateEl = $("productState");
    const summaryEl = $("productStatsSummary");
    const selectedMerchant = $("filterMerchantSelect")?.value || "all";
    const selectedStatus = $("filterStatusSelect")?.value || "all";

    listEl.innerHTML = "";
    stateEl.style.display = "none";

    if (currentTab === "merchant_products") {
        // BestERP merchant_products 필터링
        const filtered = rawMerchantProducts.filter(item => {
            const mId = item.data.merchant_id;
            const matchesM = matchesMerchant(mId, selectedMerchant);
            const matchesS = (selectedStatus === "all") || (item.data.sale_status === selectedStatus);
            return matchesM && matchesS;
        });

        const totalPublished = filtered.filter(i => i.data.sale_status === "published").length;
        const totalDraft = filtered.filter(i => i.data.sale_status === "draft").length;
        const totalSoldOut = filtered.filter(i => i.data.sale_status === "sold_out").length;

        if (summaryEl) {
            summaryEl.innerHTML = `📊 <b>조회된 BestERP 상품:</b> 총 <b>${filtered.length}</b>개 (공개 ${totalPublished}개 · 임시저장 ${totalDraft}개 · 품절 ${totalSoldOut}개)`;
        }

        if (filtered.length === 0) {
            stateEl.textContent = "조건에 일치하는 BestERP 등록 상품이 없습니다. [+ 상품 등록] 버튼을 눌러 새 상품을 등록해보세요.";
            stateEl.style.display = "block";
            return;
        }

        renderMerchantProductCards(filtered);

    } else {
        // 기존 items 컬렉션 필터링
        const targetOwnerUids = [];
        if (selectedMerchant === "all") {
            // 전체 가맹점의 ownerUid
            Object.values(merchantMap).forEach(m => { if (m.ownerUid) targetOwnerUids.push(m.ownerUid); });
        } else {
            const m = merchantMap[selectedMerchant];
            if (m?.ownerUid) targetOwnerUids.push(m.ownerUid);
        }

        const filtered = rawItems.filter(item => {
            const owner = item.data.ownerUid;
            const matchesOwner = (targetOwnerUids.length === 0) || targetOwnerUids.includes(owner);
            const status = item.data.status;
            const matchesS = (selectedStatus === "all") ||
                (selectedStatus === "published" && status === "published") ||
                (selectedStatus === "draft" && status === "pending");
            return matchesOwner && matchesS;
        });

        if (summaryEl) {
            summaryEl.innerHTML = `🧳 <b>기존 등록 상품/투어(items):</b> 총 <b>${filtered.length}</b>개`;
        }

        if (filtered.length === 0) {
            stateEl.textContent = "해당 조건의 기존 등록 상품이 없습니다.";
            stateEl.style.display = "block";
            return;
        }

        renderItemsCards(filtered);
    }
}

// BestERP 카탈로그 카드 렌더링
function renderMerchantProductCards(docs) {
    const listEl = $("productList");
    const isAdmin = currentViewer?.role === "admin";
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
        const merchantName = getMerchantName(data.merchant_id);

        let statusBadge = "";
        if (data.sale_status === "published") {
            statusBadge = '<span style="background:#dcfce7; color:#15803d; font-weight:700; padding:3px 9px; border-radius:6px; font-size:0.8rem;">판매 공개중</span>';
        } else if (data.sale_status === "sold_out") {
            statusBadge = '<span style="background:#f1f5f9; color:#64748b; font-weight:700; padding:3px 9px; border-radius:6px; font-size:0.8rem;">품절</span>';
        } else {
            statusBadge = '<span style="background:#fef3c7; color:#b45309; font-weight:700; padding:3px 9px; border-radius:6px; font-size:0.8rem;">임시저장(비공개)</span>';
        }

        const canManage = isAdmin || (currentViewer && matchesMerchant(data.merchant_id, currentViewer.merchant_id));

        html += `
            <div class="panel" style="padding:16px; border:1px solid #e2e8f0; border-radius:12px; background:#fff; box-shadow:0 2px 4px rgba(0,0,0,0.03); display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; font-size:0.78rem; font-weight:bold; padding:2px 8px; border-radius:99px;">
                            🏪 ${esc(merchantName)} (${esc(data.merchant_id || '-')})
                        </span>
                        ${statusBadge}
                    </div>

                    ${data.image_url ? `<img src="${esc(data.image_url)}" style="width:100%; height:160px; object-fit:cover; border-radius:8px; margin-bottom:10px;" onerror="this.style.display='none';" />` : ""}

                    <div style="font-weight:700; font-size:1.15rem; color:#1e293b; margin-bottom:4px;">${esc(data.product_name)}</div>
                    <div style="font-size:0.82rem; color:#64748b;">분류: <b>${esc(typeLabel)}</b></div>
                    <div style="font-size:1.2rem; font-weight:800; color:#0f766e; margin:8px 0;">${Number(data.price || 0).toLocaleString()} VND</div>
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
                      <span style="font-size:0.8rem; color:#94a3b8;">타 가맹점 상품 (조회 전용)</span>
                  `}
                </div>
            </div>
        `;
    });
    listEl.innerHTML = html;

    bindActionEvents();
}

// items 컬렉션 카드 렌더링
function renderItemsCards(docs) {
    const listEl = $("productList");
    let html = "";

    docs.forEach(docSnap => {
        const data = docSnap.data;
        const ownerName = Object.values(merchantMap).find(m => m.ownerUid === data.ownerUid)?.name || "가맹점/가이드";
        let statusBadge = data.status === "published"
            ? '<span style="background:#dcfce7; color:#15803d; font-weight:700; padding:2px 8px; border-radius:4px; font-size:0.8rem;">공개중</span>'
            : '<span style="background:#fef3c7; color:#b45309; font-weight:700; padding:2px 8px; border-radius:4px; font-size:0.8rem;">검수대기</span>';

        html += `
            <div class="panel" style="padding:16px; border:1px solid #cbd5e1; border-radius:12px; background:#fff;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="background:#f1f5f9; color:#475569; font-size:0.78rem; font-weight:bold; padding:2px 8px; border-radius:99px;">
                        🧳 ${esc(ownerName)} (${esc(data.category || '투어')})
                    </span>
                    ${statusBadge}
                </div>
                ${data.imageUrl ? `<img src="${esc(data.imageUrl)}" style="width:100%; height:150px; object-fit:cover; border-radius:8px; margin-bottom:10px;" />` : ""}
                <div style="font-weight:700; font-size:1.1rem; color:#1e293b;">${esc(data.title || data.name)}</div>
                <div style="font-size:0.85rem; color:#64748b; margin-top:4px;">위치: ${esc(data.region || data.country || '-')}</div>
                <div style="font-size:1.1rem; font-weight:800; color:#2563eb; margin:8px 0;">
                    ${Number(data.priceVnd || data.price || 0).toLocaleString()} VND
                </div>
                ${data.desc ? `<p style="font-size:0.83rem; color:#475569; line-height:1.4;">${esc(data.desc)}</p>` : ""}
            </div>
        `;
    });
    listEl.innerHTML = html;
}

// 버튼 클릭 이벤트 바인딩
function bindActionEvents() {
    const listEl = $("productList");

    // 수정 모달 열기
    listEl.querySelectorAll("button[data-action='edit']").forEach(btn => {
        btn.addEventListener("click", () => {
            editingId = btn.getAttribute("data-id");
            const data = JSON.parse(btn.getAttribute("data-payload"));
            editingMerchantId = data.merchant_id;

            $("modalTitle").textContent = "상품 정보 수정";
            if ($("pMerchantId")) {
                $("pMerchantId").value = data.merchant_id || "";
            }
            $("pType").value = data.product_type || "physical_product";
            $("pName").value = data.product_name || "";
            $("pImg").value = data.image_url || "";
            $("pDesc").value = data.description || "";
            $("pPrice").value = data.price || 0;
            $("pStatus").value = data.sale_status || "draft";

            const modalDelBtn = $("btnDeleteInModal");
            if (modalDelBtn) {
                modalDelBtn.style.display = "inline-block";
                modalDelBtn.onclick = () => handleDeleteProduct(editingId, data.product_name, editingMerchantId);
            }

            $("productModal").style.display = "flex";
        });
    });

    // 삭제 버튼
    listEl.querySelectorAll("button[data-action='delete']").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const name = btn.getAttribute("data-name");
            const merchantId = btn.getAttribute("data-merchant");
            handleDeleteProduct(id, name, merchantId);
        });
    });

    // 공개 상태 변경
    listEl.querySelectorAll("button[data-action='publish']").forEach(btn => {
        btn.addEventListener("click", async () => {
            if (!confirm("해당 상품을 쇼핑몰에 즉시 공개하시겠습니까?")) return;
            const id = btn.getAttribute("data-id");
            try {
                await updateDoc(doc(db, "merchant_products", id), {
                    sale_status: "published",
                    published_at: serverTimestamp(),
                    updated_at: serverTimestamp()
                });
                alert("상품이 쇼핑몰에 공개되었습니다!");
                loadAllData();
            } catch (err) {
                alert("공개 상태 변경 실패: " + err.message);
            }
        });
    });

    // 비공개 처리
    listEl.querySelectorAll("button[data-action='draft']").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-id");
            try {
                await updateDoc(doc(db, "merchant_products", id), {
                    sale_status: "draft",
                    updated_at: serverTimestamp()
                });
                alert("상품이 비공개(임시저장) 처리되었습니다.");
                loadAllData();
            } catch (err) {
                alert("상태 변경 실패: " + err.message);
            }
        });
    });
}

// 상품 안전 삭제
async function handleDeleteProduct(id, name, merchantId) {
    if (!currentViewer || currentViewer.role === "guest") {
        alert("로그인이 필요합니다.");
        return;
    }

    const isAdmin = currentViewer.role === "admin";
    if (!isAdmin && !matchesMerchant(merchantId, currentViewer.merchant_id)) {
        alert("⚠️ 본인 가맹점의 상품만 삭제할 수 있습니다.");
        return;
    }

    if (!confirm(`🗑️ "${name || '이 상품'}"을(를) 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.`)) return;

    try {
        await deleteDoc(doc(db, "merchant_products", id));
        alert("✅ 상품이 삭제되었습니다.");
        if ($("productModal")) $("productModal").style.display = "none";
        editingId = null;
        editingMerchantId = null;
        loadAllData();
    } catch (err) {
        console.error("상품 삭제 실패:", err);
        alert("❌ 삭제 실패: " + (err.message || String(err)));
    }
}

// 새 상품 등록 버튼 클릭
$("btnCreateProduct").addEventListener("click", () => {
    if (!currentViewer || currentViewer.role === "guest") {
        alert("상품을 등록하려면 먼저 로그인해 주세요.");
        window.location.href = "/login.html";
        return;
    }

    editingId = null;
    editingMerchantId = null;
    $("modalTitle").textContent = "새 상품 등록";
    $("productForm").reset();

    // 현재 선택된 가맹점 필터가 있으면 모달 셀렉트에 자동 반영
    const currentFilter = $("filterMerchantSelect")?.value;
    if ($("pMerchantId")) {
        if (currentFilter && currentFilter !== "all") {
            $("pMerchantId").value = currentFilter;
        } else if (currentViewer.merchant_id && currentViewer.merchant_id !== "all") {
            $("pMerchantId").value = currentViewer.merchant_id;
        }
    }

    const modalDelBtn = $("btnDeleteInModal");
    if (modalDelBtn) modalDelBtn.style.display = "none";

    $("productModal").style.display = "flex";
});

$("btnCloseModal").addEventListener("click", () => {
    $("productModal").style.display = "none";
});

// 상품 저장(등록 및 수정) 제출
$("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentViewer || currentViewer.role === "guest") {
        alert("로그인이 필요합니다.");
        return;
    }

    const isAdmin = currentViewer.role === "admin";

    // 타겟 가맹점 결정
    let targetMerchantId;
    if (editingId) {
        targetMerchantId = isAdmin && $("pMerchantId") ? ($("pMerchantId").value || editingMerchantId) : editingMerchantId;
    } else {
        targetMerchantId = $("pMerchantId") ? $("pMerchantId").value : currentViewer.merchant_id;
    }

    if (!targetMerchantId || targetMerchantId === "all") {
        // 기본값: 대한김치
        targetMerchantId = "1791002036";
    }

    $("btnSaveProduct").disabled = true;
    $("btnSaveProduct").textContent = "저장 중...";

    const data = {
        merchant_id: String(targetMerchantId),
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
        loadAllData();
    } catch (err) {
        console.error("상품 저장 실패:", err);
        alert("저장 실패: " + err.message);
    } finally {
        $("btnSaveProduct").disabled = false;
        $("btnSaveProduct").textContent = "저장";
    }
});
