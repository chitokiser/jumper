import { app } from "../firebase-init.js";
import { getFirestore, collection, getDocs, query, where, orderBy, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthReady } from "../auth.js";

const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentViewer = null;

onAuthReady(async ({ loggedIn, user, role, token }) => {
    if (!loggedIn) {
        window.location.href = "/login.html";
        return;
    }
    currentViewer = {
        uid: user.uid,
        email: user.email,
        role: role,
        merchant_id: (token && token.merchant_id) ? token.merchant_id : "daehan_kimchi"
    };

    if (currentViewer.role === "admin") {
        await loadMerchantListForAdmin();
        $("pMerchantId").addEventListener("change", loadOrders);
    }

    $("btnRefresh").addEventListener("click", loadOrders);
    loadOrders();
});

async function loadMerchantListForAdmin() {
    $("adminMerchantRow").style.display = "block";
    try {
        const snap = await getDocs(collection(db, "merchants"));
        let options = "<option value='all'>== 전체 가맹점 열람 (수퍼관리자) ==</option>";
        snap.forEach(d => {
            const data = d.data();
            options += `<option value="${d.id}">${data.name || d.id}</option>`;
        });
        $("pMerchantId").innerHTML = options;
    } catch (err) {
        console.error(err);
    }
}

async function loadOrders() {
    const listEl = $("orderList");
    const stateEl = $("orderState");
    stateEl.textContent = "주문을 불러오는 중...";
    stateEl.style.display = "block";
    listEl.innerHTML = "";

    try {
        let q;
        if (currentViewer.role === "admin") {
            const selected = $("pMerchantId").value;
            if (selected === "all" || !selected) {
                q = query(collection(db, "merchant_orders"));
            } else {
                q = query(collection(db, "merchant_orders"), where("merchant_id", "==", selected));
            }
        } else {
            q = query(collection(db, "merchant_orders"), where("merchant_id", "==", currentViewer.merchant_id));
        }

        const snap = await getDocs(q);
        if (snap.empty) {
            stateEl.textContent = "아직 고객으로부터 들어온 주문이 없습니다.";
            return;
        }

        let docs = [];
        snap.forEach(d => docs.push({ id: d.id, data: d.data() }));
        docs.sort((a, b) => {
            const timeA = a.data.created_at?.toMillis() || 0;
            const timeB = b.data.created_at?.toMillis() || 0;
            return timeB - timeA;
        });

        let html = "";
        docs.forEach(d => {
            const data = d.data;

            // 상태 뱃지 
            let badge = "";
            let btnAction = "";
            switch (data.status) {
                case "pending": badge = "<span style='color:#f59e0b;font-weight:bold;'>주문 접수 (배송 대기)</span>";
                    btnAction = `<button class="btn btn--sm" style="background:#10b981;color:white;border:none;" data-action="ship" data-id="${d.id}">🚀 배송/발송 처리</button>`;
                    break;
                case "shipped": badge = "<span style='color:#3b82f6;font-weight:bold;'>배송(서비스) 완료</span>";
                    btnAction = `<button class="btn btn--sm" style="background:#8b5cf6;color:white;border:none;" data-action="complete" data-id="${d.id}">⭐ 최종 정산 확정 (보너스 지급)</button>`;
                    break;
                case "completed": badge = "<span style='color:#10b981;font-weight:bold;'>정산 및 리워드 완료</span>";
                    break;
                case "cancelled": badge = "<span style='color:#ef4444;font-weight:bold;'>주문 취소/환불</span>";
                    break;
                default: badge = data.status; break;
            }

            html += `
                <div class="panel" style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:12px; border-bottom:1px solid #eee; padding-bottom:8px;">
                        <span style="font-size:0.9rem; color:#666;">주문번호: ${d.id}</span>
                        <span style="font-size:0.9rem; color:#666;">${data.created_at?.toDate().toLocaleString() || "방금 전"}</span>
                    </div>
                    <div style="font-weight:bold; font-size:1.1rem; margin-bottom:8px;">
                       총 주문 금액: <span style="color:#ef4444;">${Number(data.total_amount).toLocaleString()} VND</span>
                    </div>
                    <div style="margin-bottom:8px;">
                       처리 상태: ${badge}
                    </div>
                    <div style="margin-top:12px; display:flex; gap:8px;">
                        ${btnAction}
                        ${data.status !== "cancelled" && data.status !== "completed" ? `<button class="btn btn--sm" data-action="cancel" data-id="${d.id}">주문 취소</button>` : ""}
                    </div>
                </div>
            `;
        });

        listEl.innerHTML = html;
        stateEl.style.display = "none";

        // 버튼 이벤트 बा인딩
        listEl.querySelectorAll("button[data-action='ship']").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("주문을 배송/처리중 상태로 변경하시겠습니까?")) return;
                await updateDoc(doc(db, "merchant_orders", btn.getAttribute("data-id")), {
                    status: "shipped",
                    updated_at: serverTimestamp()
                });
                alert("처리되었습니다.");
                loadOrders();
            });
        });

        listEl.querySelectorAll("button[data-action='complete']").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("최종 정산 처리하시겠습니까? 이 시점에 Jumper 포인트/리워드가 고객에게 지급 트리거됩니다.")) return;
                await updateDoc(doc(db, "merchant_orders", btn.getAttribute("data-id")), {
                    status: "completed",
                    updated_at: serverTimestamp(),
                    settled_at: serverTimestamp()
                });
                alert("구매 확정 및 정산 처리 완료!");
                loadOrders();
            });
        });

        listEl.querySelectorAll("button[data-action='cancel']").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("정말 주문을 취소/환불 하시겠습니까? 재고가 원복됩니다.")) return;
                await updateDoc(doc(db, "merchant_orders", btn.getAttribute("data-id")), {
                    status: "cancelled",
                    updated_at: serverTimestamp()
                });
                alert("취소 처리되었습니다.");
                loadOrders();
            });
        });

    } catch (e) {
        stateEl.textContent = "가져오기 실패: " + e.message;
        console.error(e);
    }
}
