import { app, functions } from "../firebase-init.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { getFirestore, collection, getDocs, getDoc, query, where, orderBy, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthReady } from "../auth.js";

const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentViewer = null;

onAuthReady(async ({ loggedIn, user, role, token }) => {
    if (!loggedIn) {
        window.location.href = "/login.html";
        return;
    }
    // 가맹점 번호: 로그인 토큰 → users/{uid}.merchantId 순으로 확인 (임의 기본값 사용 금지)
    let merchantId = (token && token.merchant_id) ? String(token.merchant_id) : "";
    if (!merchantId) {
        try {
            const uSnap = await getDoc(doc(db, "users", user.uid));
            if (uSnap.exists() && uSnap.data().merchantId != null) merchantId = String(uSnap.data().merchantId);
        } catch (e) { console.warn("merchantId 조회 실패", e); }
    }
    currentViewer = {
        uid: user.uid,
        email: user.email,
        role: role,
        merchant_id: merchantId
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

// 주문의 merchant_id 는 숫자/문자/옛 별칭으로 저장된 경우가 있어 모두 조회
const MERCHANT_ALIASES = { "1791002036": ["daehan_kimchi"], "1791605366": ["bestwinner"] };
function merchantIdVariants(id) {
    const s = String(id);
    const out = new Set([s, ...(MERCHANT_ALIASES[s] || [])]);
    for (const [k, v] of Object.entries(MERCHANT_ALIASES)) if (v.includes(s)) { out.add(k); v.forEach(x => out.add(x)); }
    for (const x of [...out]) if (/^\d+$/.test(x)) out.add(Number(x));
    return [...out].slice(0, 30);
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
            if (!currentViewer.merchant_id) {
                stateEl.textContent = "가맹점 정보가 연결되지 않은 계정입니다. 관리자에게 문의해 주세요.";
                return;
            }
            q = query(collection(db, "merchant_orders"), where("merchant_id", "in", merchantIdVariants(currentViewer.merchant_id)));
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

            // 결제 상태 뱃지 및 가맹점 확인 정보
            let payBadge = "";
            let btnConfirmTransfer = "";

            if (data.payment_method === "bank_transfer" || data.payment_status === "deposit_requested") {
                payBadge = `<div style="margin:8px 0; padding:8px 12px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; font-size:0.88rem;">
                    🏦 <strong>계좌이체 확인 요청</strong> | 송금자 성명: <strong style="color:#d97706; font-size:1rem;">${data.depositor_name || "미입력"}</strong>
                </div>`;
                if (data.status === "pending" || data.payment_status === "deposit_requested") {
                    btnConfirmTransfer = `<button class="btn btn--sm" style="background:#2563eb; color:white; border:none; padding:6px 12px; font-weight:bold;" data-action="confirm-deposit" data-id="${d.id}" data-depositor="${data.depositor_name || ''}">💰 통장 입금 확인 (주문 승인)</button>`;
                }
            } else if (data.payment_status === "paid" || data.status === "payment_confirmed") {
                payBadge = `<div style="margin:6px 0; font-size:0.88rem; color:#10b981; font-weight:600;">
                    ✅ 결제/입금 확인 완료 (${data.payment_method === "bm_wallet" ? "내 지갑 BM 결제" : "계좌이체 승인"})
                </div>`;
            } else {
                payBadge = `<div style="margin:6px 0; font-size:0.85rem; color:#6b7280;">
                    결제 수단: ${data.payment_method === "bm_wallet" ? "BM 지갑 결제 대기" : "결제 수단 미선택/대기"}
                </div>`;
            }

            // 주문 상태 뱃지 및 액션 버튼
            let badge = "";
            let btnAction = "";
            switch (data.status) {
                case "pending":
                    badge = "<span style='color:#f59e0b;font-weight:bold;'>주문 접수 (입금/배송 대기)</span>";
                    btnAction = `${btnConfirmTransfer} <button class="btn btn--sm" style="background:#10b981;color:white;border:none;padding:6px 12px;" data-action="ship" data-id="${d.id}">🚀 배송/발송 처리</button>`;
                    break;
                case "payment_confirmed":
                    badge = "<span style='color:#2563eb;font-weight:bold;'>입금 승인 완료 (발송 준비)</span>";
                    btnAction = `<button class="btn btn--sm" style="background:#10b981;color:white;border:none;padding:6px 12px;" data-action="ship" data-id="${d.id}">🚀 배송/발송 처리</button>`;
                    break;
                case "shipped":
                    badge = "<span style='color:#3b82f6;font-weight:bold;'>배송(서비스) 완료</span>";
                    btnAction = `<button class="btn btn--sm" style="background:#8b5cf6;color:white;border:none;padding:6px 12px;" data-action="complete" data-id="${d.id}">⭐ 최종 정산 확정 (보너스 지급)</button>`;
                    break;
                case "completed":
                    badge = "<span style='color:#10b981;font-weight:bold;'>정산 및 리워드 완료</span>";
                    break;
                case "cancelled":
                    badge = "<span style='color:#ef4444;font-weight:bold;'>주문 취소/환불</span>";
                    break;
                default:
                    badge = data.status;
                    break;
            }

            // 입금 확인 후: 고객 이메일로 BT 보내기 (가맹점주 BT 잔고에서 차감, 지급 기준금액당 1 BT)
            const paidLike = data.payment_status === "paid" || ["payment_confirmed", "shipped", "completed"].includes(data.status);
            let btBox = "";
            if (data.bt_sent) {
                btBox = `<div style="margin:6px 0; font-size:0.85rem; color:#7c3aed; font-weight:600;">🎟️ BT 전송 완료: ${data.bt_issued ?? "-"} BT → ${data.bt_sent_to || data.buyer_email || ""}</div>`;
            } else if (paidLike && data.status !== "cancelled" && data.buyer_email) {
                btBox = `<button class="btn btn--sm" style="background:#7c3aed;color:white;border:none;padding:6px 12px;" data-action="send-bt" data-id="${d.id}" data-email="${data.buyer_email}" data-amount="${Number(data.total_amount) || 0}">🎟️ 고객 이메일로 BT 보내기</button>`;
            }

            // 상품 아이템 요약
            const itemsSummary = (data.items || []).map(it => `${it.name || it.product_name || '상품'} x ${it.qty || 1}개`).join(', ');

            html += `
                <div class="panel" style="padding:16px;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.04);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:8px;">
                        <span style="font-size:0.9rem; color:#4b5563; font-weight:600;">주문번호: ${d.id}</span>
                        <span style="font-size:0.85rem; color:#888;">${data.created_at?.toDate().toLocaleString() || "방금 전"}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div>
                           <strong>주문 고객:</strong> ${data.buyer_name || data.buyer_email || '회원'} <span style="color:#6b7280; font-size:0.85rem;">(${data.buyer_email || ''})</span>
                        </div>
                        <div style="font-size:1.2rem; font-weight:800; color:#ef4444;">
                           ${Number(data.total_amount).toLocaleString()} VND
                        </div>
                    </div>
                    <div style="font-size:0.9rem; color:#374151; margin-bottom:6px;">
                        <strong>주문 상품:</strong> ${itemsSummary || '상품 정보 없음'}
                    </div>
                    <div style="margin-bottom:6px;">
                        <strong>진행 상태:</strong> ${badge}
                    </div>
                    ${payBadge}
                    <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">
                        ${btnAction}
                        ${btBox}
                        ${data.status !== "cancelled" && data.status !== "completed" ? `<button class="btn btn--sm" data-action="cancel" data-id="${d.id}" style="background:#f3f4f6; color:#374151; border:1px solid #d1d5db;">주문 취소</button>` : ""}
                    </div>
                </div>
            `;
        });

        listEl.innerHTML = html;
        stateEl.style.display = "none";

        // 버튼 이벤트 바인딩
        listEl.querySelectorAll("button[data-action='confirm-deposit']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const depName = btn.getAttribute("data-depositor");
                const promptMsg = depName
                    ? `입금자 [${depName}] 님의 통장 입금 내역을 확인하셨습니까?\n주문을 [입금 승인] 상태로 변경합니다.`
                    : "실제 통장 입금 내역을 확인하셨습니까?\n주문을 [입금 승인] 상태로 변경합니다.";
                if (!confirm(promptMsg)) return;

                try {
                    await updateDoc(doc(db, "merchant_orders", btn.getAttribute("data-id")), {
                        status: "payment_confirmed",
                        payment_status: "paid",
                        payment_method: "bank_transfer",
                        confirmed_at: serverTimestamp(),
                        updated_at: serverTimestamp()
                    });
                    alert("입금 확인 및 주문 승인이 완료되었습니다!");
                    loadOrders();
                } catch (err) {
                    alert("처리 실패: " + err.message);
                }
            });
        });

        listEl.querySelectorAll("button[data-action='send-bt']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const orderId = btn.getAttribute("data-id");
                const email = btn.getAttribute("data-email");
                const amount = Number(btn.getAttribute("data-amount"));
                if (!confirm(`고객 [${email}] 에게 결제금액 ${amount.toLocaleString()} VND 기준 BT를 보냅니다.
가맹점 BT 잔고에서 차감됩니다. 진행할까요?`)) return;
                btn.disabled = true;
                btn.textContent = "전송 중...";
                try {
                    // 서버가 주문 원장(이메일·금액)으로 계산하고, 같은 주문의 중복 전송을 막으며 주문에 전송 기록을 남긴다
                    const res = await httpsCallable(functions, "merchantSendBtDirect")({ orderId });
                    alert(`BT 전송 완료: ${email} 님에게 ${res.data?.btIssued ?? ""} BT`);
                    loadOrders();
                } catch (err) {
                    alert("BT 전송 실패: " + (err.message || err));
                    btn.disabled = false;
                    btn.textContent = "🎟️ 고객 이메일로 BT 보내기";
                }
            });
        });

        listEl.querySelectorAll("button[data-action='ship']").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("주문을 배송/처리중 상태로 변경하시겠습니까?")) return;
                await updateDoc(doc(db, "merchant_orders", btn.getAttribute("data-id")), {
                    status: "shipped",
                    updated_at: serverTimestamp()
                });
                alert("배송 처리되었습니다.");
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
                if (!confirm("정말 주문을 취소/환불 하시겠습니까?")) return;
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
