import { app } from "../firebase-init.js";
import { getFirestore, collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthReady } from "../auth.js";

const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentViewer = null;
let cart = []; // 장바구니 아이템 담는 배열
let rawProducts = [];
let selectedMerchantFilter = "all";

// 가맹점 식별 및 별칭 매핑
let merchantMap = {
  "1791002036": "대한김치",
  "daehan_kimchi": "대한김치",
  "1791605366": "베스트위너",
  "bestwinner": "베스트위너"
};

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

// 가맹점 이름 해결 헬퍼
function resolveMerchantName(merchantId, explicitName) {
  if (explicitName) return explicitName;
  const mIdStr = String(merchantId || "").trim();
  if (merchantMap[mIdStr]) return merchantMap[mIdStr];
  if (mIdStr === "daehan_kimchi" || mIdStr === "1791002036") return "대한김치";
  if (mIdStr === "bestwinner" || mIdStr === "1791605366") return "베스트위너";
  return mIdStr || "제휴 가맹점";
}

// 가맹점 필터 매칭
function matchesMerchant(productMerchantId, filterTarget) {
  if (!filterTarget || filterTarget === "all") return true;
  const pStr = String(productMerchantId || "").trim();
  const fStr = String(filterTarget || "").trim();
  if (pStr === fStr) return true;

  const aliases = KNOWN_MERCHANT_ALIASES[fStr] || [fStr];
  return aliases.some(a => String(a).trim() === pStr);
}

onAuthReady(async ({ loggedIn, user }) => {
  if (loggedIn) {
    currentViewer = user;
  }
  loadCartFromStorage();
  await loadMerchants();
  await loadProducts();
});

// 가맹점 마스터 목록 로드
async function loadMerchants() {
  try {
    const snap = await getDocs(collection(db, "merchants"));
    const filterBar = $("merchantFilterBar");

    snap.forEach(d => {
      const data = d.data();
      const id = String(d.id);
      const name = data.name || data.merchantName || id;
      merchantMap[id] = name;
      if (data.merchantId) merchantMap[String(data.merchantId)] = name;
    });

    if (filterBar) {
      // 고유 가맹점 목록 구성
      const uniqueMerchants = [
        { id: "1791002036", name: "대한김치" },
        { id: "1791605366", name: "베스트위너" }
      ];

      snap.forEach(d => {
        const id = String(d.id);
        const name = d.data()?.name || id;
        if (!uniqueMerchants.some(m => m.id === id || matchesMerchant(id, m.id))) {
          uniqueMerchants.push({ id, name });
        }
      });

      let buttonsHtml = `
        <span style="font-size:0.85rem; font-weight:bold; color:#475569; margin-right:4px;">🏪 가맹점별 모아보기:</span>
        <button type="button" class="btn btn--sm btn--primary filter-btn" data-merchant="all" style="border-radius:99px; font-weight:600;">전체 보기</button>
      `;

      uniqueMerchants.forEach(m => {
        buttonsHtml += `
          <button type="button" class="btn btn--sm filter-btn" data-merchant="${esc(m.id)}" style="background:#fff; color:#334155; border:1px solid #cbd5e1; border-radius:99px; font-weight:600;">
            🏪 ${esc(m.name)}
          </button>
        `;
      });

      filterBar.innerHTML = buttonsHtml;

      // 필터 버튼 클릭 이벤트
      filterBar.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          selectedMerchantFilter = btn.getAttribute("data-merchant");

          filterBar.querySelectorAll(".filter-btn").forEach(b => {
            b.className = "btn btn--sm filter-btn";
            b.style.background = "#fff";
            b.style.color = "#334155";
            b.style.border = "1px solid #cbd5e1";
          });

          btn.className = "btn btn--sm btn--primary filter-btn";
          btn.style.background = "";
          btn.style.color = "";
          btn.style.border = "";

          renderProductsList();
        });
      });
    }
  } catch (err) {
    console.warn("가맹점 마스터 로드 실패:", err);
  }
}

// 1. 서버(Firestore)에서 공개된 상품(published) 로드
async function loadProducts() {
  const listEl = $("coopMallProducts");
  listEl.innerHTML = "<div class='hint' style='grid-column: 1 / -1; text-align:center; padding:30px;'>상품을 불러오는 중...</div>";

  try {
    const q = query(
      collection(db, "merchant_products"),
      where("sale_status", "==", "published")
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      listEl.innerHTML = "<div class='hint' style='grid-column: 1 / -1; text-align:center; padding:30px;'>현재 판매 중인 가맹점 상품이 없습니다.</div>";
      return;
    }

    rawProducts = [];
    snap.forEach(d => rawProducts.push({ id: d.id, data: d.data() }));
    rawProducts.sort((a, b) => {
      const timeA = a.data.created_at?.toMillis?.() || (a.data.created_at?.seconds ? a.data.created_at.seconds * 1000 : 0);
      const timeB = b.data.created_at?.toMillis?.() || (b.data.created_at?.seconds ? b.data.created_at.seconds * 1000 : 0);
      return timeB - timeA;
    });

    renderProductsList();
  } catch (err) {
    listEl.innerHTML = `<div class='hint' style='grid-column: 1 / -1; color:red;'>상품 목록 로드 실패: ${err.message}</div>`;
    console.error(err);
  }
}

// 상품 카드 목록 렌더링
function renderProductsList() {
  const listEl = $("coopMallProducts");
  listEl.innerHTML = "";

  const filtered = rawProducts.filter(item => {
    return matchesMerchant(item.data.merchant_id, selectedMerchantFilter);
  });

  if (filtered.length === 0) {
    listEl.innerHTML = "<div class='hint' style='grid-column: 1 / -1; text-align:center; padding:40px;'>해당 가맹점에서 현재 등록된 공개 상품이 없습니다.</div>";
    return;
  }

  let html = "";
  filtered.forEach(docSnap => {
    const data = docSnap.data;
    const merchantName = resolveMerchantName(data.merchant_id, data.merchant_name);

    const pTypeMap = {
      physical_product: "일반상품",
      menu: "메뉴(음식)",
      service: "서비스",
      booking: "예약형"
    };
    const typeLabel = pTypeMap[data.product_type] || "";

    html += `
      <div class="panel product-card" style="padding:16px; border:1px solid #e2e8f0; border-radius:14px; background:#fff; box-shadow: 0 4px 12px rgba(0,0,0,0.04); display:flex; flex-direction:column; justify-content:space-between; transition: transform 0.2s, box-shadow 0.2s;">
          <div>
              <!-- 🏪 가맹점 뱃지 (어디 가맹점 상품인지 명확하게 표기) -->
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                  <span class="merchant-badge" style="display:inline-flex; align-items:center; gap:6px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-size:0.83rem; font-weight:700; padding:4px 10px; border-radius:99px; box-shadow:0 1px 2px rgba(37,99,235,0.08);">
                      <span style="font-size:0.95rem;">🏪</span>
                      <span>${esc(merchantName)}</span>
                  </span>
                  ${typeLabel ? `<span style="font-size:0.75rem; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:6px; font-weight:600;">${esc(typeLabel)}</span>` : ''}
              </div>

              ${data.image_url ? `<img src="${esc(data.image_url)}" style="width:100%; height:180px; object-fit:cover; border-radius:10px; margin-bottom:12px;" onerror="this.style.display='none';" />` : ""}
              
              <div style="font-weight:700; font-size:1.15rem; color:#1e293b; line-height:1.35; margin-bottom:6px;">${esc(data.product_name)}</div>
              <div style="color:#64748b; font-size:0.85rem; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(data.description || "")}</div>
          </div>

          <div style="margin-top:16px; border-top:1px solid #f1f5f9; padding-top:12px; text-align:right;">
              <div style="font-size:1.35rem; font-weight:800; color:#ef4444; margin-bottom:10px;">
                  ${Number(data.price || 0).toLocaleString()} <span style="font-size:0.85rem; font-weight:700; color:#64748b;">VND</span>
              </div>
              <div>
                  <button class="btn btn--primary" style="width:100%; border-radius:10px; font-weight:700; padding:10px;" data-action="add-cart" 
                      data-id="${esc(docSnap.id)}" 
                      data-merchant="${esc(data.merchant_id)}"
                      data-merchant-name="${esc(merchantName)}"
                      data-name="${esc(data.product_name)}" 
                      data-price="${data.price}">
                      🛒 장바구니 담기
                  </button>
              </div>
          </div>
      </div>
    `;
  });
  listEl.innerHTML = html;

  // 장바구니 담기 버튼 바인딩
  listEl.querySelectorAll("button[data-action='add-cart']").forEach(btn => {
    btn.addEventListener("click", () => {
      addToCart({
        id: btn.getAttribute("data-id"),
        merchant_id: btn.getAttribute("data-merchant"),
        merchant_name: btn.getAttribute("data-merchant-name"),
        name: btn.getAttribute("data-name"),
        price: Number(btn.getAttribute("data-price")),
        qty: 1
      });
    });
  });
}

// 2. 장바구니 로직 구현
function saveCartToStorage() {
  localStorage.setItem("jumper_cart", JSON.stringify(cart));
}

function loadCartFromStorage() {
  const saved = localStorage.getItem("jumper_cart");
  if (saved) {
    try {
      cart = JSON.parse(saved);
    } catch (_) {
      cart = [];
    }
  }
  updateCartBadge();
}

function updateCartBadge() {
  const totalQty = cart.reduce((acc, item) => acc + item.qty, 0);
  if ($("cartBadge")) $("cartBadge").textContent = totalQty;
}

function addToCart(item) {
  if (!currentViewer) {
    if (confirm("장바구니를 이용하려면 로그인이 필요합니다.\n로그인 페이지로 이동하시겠습니까?")) {
      window.location.href = "/login.html";
    }
    return;
  }

  // 동일 상품 있으면 수량만 증가
  const existing = cart.find(c => c.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push(item);
  }
  saveCartToStorage();
  updateCartBadge();

  // 톡 튀는 UI 효과
  const badge = $("cartBadge");
  if (badge) {
    badge.style.transform = "scale(1.4)";
    setTimeout(() => badge.style.transform = "scale(1)", 200);
  }
  alert(`🛒 [${item.merchant_name}] "${item.name}" 상품이 장바구니에 담겼습니다!`);
}

// 3. 모달 팝업 렌더링
$("btnShowCart").addEventListener("click", () => {
  $("cartModal").style.display = "flex";
  renderCartModal();
});
$("btnCloseCart").addEventListener("click", () => {
  $("cartModal").style.display = "none";
});

function renderCartModal() {
  const listEl = $("cartList");
  if (cart.length === 0) {
    listEl.innerHTML = "<div class='muted' style='text-align:center; padding:20px;'>장바구니가 비어 있습니다.</div>";
    $("cartTotal").textContent = "0";
    $("btnCheckout").disabled = true;
    return;
  }

  let html = "";
  let total = 0;
  cart.forEach((c, index) => {
    total += (c.price * c.qty);
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding:10px 0;">
          <div>
             <div style="display:inline-block; font-size:0.75rem; background:#eff6ff; color:#1d4ed8; padding:1px 7px; border-radius:99px; font-weight:700; margin-bottom:3px;">
                🏪 ${esc(c.merchant_name || '가맹점')}
             </div>
             <div style="font-weight:700; font-size:1rem; color:#1e293b;">${esc(c.name)}</div>
             <div style="font-size:0.85rem; color:#64748b; margin-top:2px;">${Number(c.price).toLocaleString()} VND x ${c.qty}개</div>
          </div>
          <div>
             <button class="btn btn--sm" data-action="remove-cart" data-index="${index}" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:4px 8px; border-radius:6px;">제외</button>
          </div>
      </div>
    `;
  });
  listEl.innerHTML = html;
  $("cartTotal").textContent = total.toLocaleString();
  $("btnCheckout").disabled = false;

  // 제외 버튼 바인딩
  listEl.querySelectorAll("button[data-action='remove-cart']").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      cart.splice(idx, 1);
      saveCartToStorage();
      updateCartBadge();
      renderCartModal();
    });
  });
}

// 4. 결제(주문) API 호출
$("btnCheckout").addEventListener("click", async () => {
  if (cart.length === 0) return;
  if (!currentViewer) {
    alert("주문을 진행하려면 먼저 로그인해 주세요.");
    window.location.href = "/login.html";
    return;
  }
  if (!confirm("장바구니 상품들을 주문하시겠습니까? (결제 QR이 생성됩니다)")) return;

  const targetMerchantId = cart[0].merchant_id;
  const itemsPayload = cart.map(c => ({
    product_id: c.id,
    name: c.name,
    price: c.price,
    qty: c.qty,
    merchant_name: c.merchant_name
  }));

  let totalAmount = 0;
  cart.forEach(c => totalAmount += c.price * c.qty);

  const btn = $("btnCheckout");
  btn.disabled = true;
  btn.textContent = "주문 처리 중...";

  try {
    const { addDoc, getDoc, doc, updateDoc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

    // 가맹점 계좌 정보 조회
    let merchantInfo = {
      name: cart[0].merchant_name || "가맹점",
      bank_name: "신한베트남은행 (Shinhan Bank VN)",
      account_no: "700-012-345678",
      account_holder: "BESTCLUB / " + (cart[0].merchant_name || "가맹점")
    };

    try {
      const mSnap = await getDoc(doc(db, "merchants", String(targetMerchantId)));
      if (mSnap.exists()) {
        const md = mSnap.data();
        if (md.name) merchantInfo.name = md.name;
        if (md.bank_name) merchantInfo.bank_name = md.bank_name;
        if (md.account_no) merchantInfo.account_no = md.account_no;
        if (md.account_holder) merchantInfo.account_holder = md.account_holder;
      }
    } catch (_) { }

    const docRef = await addDoc(collection(db, "merchant_orders"), {
      merchant_id: targetMerchantId,
      merchant_name: merchantInfo.name,
      buyer_uid: currentViewer.uid,
      buyer_email: currentViewer.email || "",
      buyer_name: currentViewer.displayName || currentViewer.email?.split("@")[0] || "회원",
      items: itemsPayload,
      total_amount: totalAmount,
      status: "pending",
      payment_status: "awaiting_payment",
      payment_method: "undecided",
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    });

    // 주문 성공 후 장바구니 비우기
    cart = [];
    saveCartToStorage();
    updateCartBadge();

    // 결제 QR URL 생성 (안정적인 생성기: qrserver.com 및 클라이언트 Canvas)
    const paymentUrl = window.location.origin + `/pay.html?merchant=${targetMerchantId}&amount=${totalAmount}&currency=VND&orderId=${docRef.id}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentUrl)}`;
    const qrBackupUrl = `https://quickchart.io/qr?size=200&text=${encodeURIComponent(paymentUrl)}`;

    $("cartModal").innerHTML = `
      <div style="background:white; padding:24px; border-radius:14px; max-width:440px; width:92%; max-height:90vh; overflow-y:auto; position:relative; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
        <h3 style="margin-top:0; color:#4f46e5; font-size:1.4rem; text-align:center;">주문 접수 완료</h3>
        <p style="text-align:center; font-size:0.95rem; color:#4b5563; margin-bottom:16px;">
          가맹점: <strong style="color:#2563eb;">${esc(merchantInfo.name)}</strong><br/>
          총 결제금액: <strong style="color:#ef4444; font-size:1.15rem;">${totalAmount.toLocaleString()} VND</strong>
        </p>
        
        <div style="display:flex; flex-direction:column; gap:16px;">
          
          <!-- 결제방식 1. 내 지갑 BM 결제 -->
          <div style="border:1px solid #d1d5db; border-radius:10px; padding:16px; background:#fff;">
            <h4 style="margin:0 0 10px 0; color:#1f2937; font-size:1.05rem;">결제방식 1. 내 지갑 BM으로 결제</h4>
            <div style="text-align:center;">
              <div id="qrCanvasWrap" style="display:inline-block; margin-bottom:8px; padding:8px; background:#fff; border:1px solid #e5e7eb; border-radius:8px;">
                <canvas id="cartQrCanvas" style="display:none; width:160px; height:160px;"></canvas>
                <img id="cartQrImg" src="${qrImageUrl}" onerror="this.onerror=null;this.src='${qrBackupUrl}';" alt="BM 결제 QR" style="width:160px; height:160px; border-radius:4px; display:block;" />
              </div>
              <p style="font-size:0.83rem; color:#6b7280; margin:0 0 10px 0; line-height:1.4;">PC 이용 시 폰으로 위 QR을 스캔하세요.<br/>모바일 기기라면 아래 버튼을 눌러 바로 결제하세요.</p>
              <a href="${paymentUrl}" class="btn btn--primary" style="display:block; text-align:center; padding:10px; border-radius:8px; text-decoration:none; font-weight:600;">💳 스마트폰에서 바로 BM 결제하기</a>
            </div>
          </div>

          <!-- 결제방식 2. 계좌 자동이체 -->
          <div style="border:1px solid #d1d5db; border-radius:10px; padding:16px; background:#fff;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <h4 style="margin:0; color:#1f2937; font-size:1.05rem;">결제방식 2. 계좌 자동이체</h4>
              <span style="font-size:0.75rem; background:#e0e7ff; color:#4338ca; padding:2px 8px; border-radius:4px; font-weight:600;">가맹점 승인</span>
            </div>
            
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:12px; font-size:0.85rem; line-height:1.6;">
              <div>🏦 <strong>은행:</strong> ${merchantInfo.bank_name}</div>
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <span>🔢 <strong>계좌번호:</strong> <span id="textBankAcc" style="font-family:monospace; font-weight:bold; color:#1d4ed8;">${merchantInfo.account_no}</span></span>
                <button type="button" id="btnCopyBankAcc" style="font-size:0.75rem; padding:2px 8px; border:1px solid #cbd5e1; border-radius:4px; background:#fff; cursor:pointer;">복사</button>
              </div>
              <div>👤 <strong>예금주:</strong> ${merchantInfo.account_holder}</div>
              <div>🏷️ <strong>입금 메모:</strong> <span style="color:#ef4444; font-weight:bold;">${docRef.id.slice(0, 8)}</span> (주문번호 앞자리)</div>
            </div>

            <p style="font-size:0.82rem; color:#4b5563; margin:0 0 10px 0; line-height:1.4;">
              이체 완료 후 아래에 <strong>송금자 성명</strong>을 입력하고 확인 요청을 누르면 가맹점 관리자가 통장 확인 후 주문을 승인합니다.
            </p>

            <div id="transferInputBox">
              <div style="display:flex; gap:6px;">
                <input type="text" id="inputDepositor" value="${currentViewer.displayName || currentViewer.email?.split("@")[0] || ""}" placeholder="실제 입금자 성명" style="flex:1; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:0.85rem;" />
                <button type="button" id="btnSubmitTransfer" class="btn btn--primary" style="padding:8px 12px; font-size:0.85rem; white-space:nowrap; background:#2563eb;">💰 송금 확인 요청</button>
              </div>
            </div>
            <div id="transferAlertSuccess" style="display:none; margin-top:8px; background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; padding:10px; border-radius:6px; font-size:0.82rem; line-height:1.4; text-align:center;">
              ✅ <strong>가맹점에 입금 확인 요청이 전송되었습니다!</strong><br/>가맹점 직원이 통장 확인 후 승인하면 배송 및 정산 처리가 진행됩니다.
            </div>
          </div>
          
          <a href="/orders.html" class="btn" style="display:block; text-align:center; background:#10b981; color:#fff; width:100%; padding:12px; border-radius:8px; margin-top:6px; text-decoration:none; font-weight:700; box-sizing:border-box;">📦 내 주문·구매 내역 확인하기</a>
          <button type="button" class="btn" onclick="location.reload()" style="background:#f3f4f6; color:#374151; width:100%; padding:10px; border-radius:8px; margin-top:4px; border:1px solid #e5e7eb;">닫기 및 쇼핑 계속하기</button>
        </div>
      </div>
    `;

    // QRCode 라이브러리가 로드되어 있으면 클라이언트 Canvas로 고해상도 즉시 렌더링
    try {
      if (window.QRCode && $("cartQrCanvas")) {
        const cvs = $("cartQrCanvas");
        window.QRCode.toCanvas(cvs, paymentUrl, { width: 160, margin: 1, color: { dark: "#1a1a2e", light: "#ffffff" } }, (err) => {
          if (!err) {
            cvs.style.display = "block";
            const img = $("cartQrImg");
            if (img) img.style.display = "none";
          }
        });
      }
    } catch (_) { }

    // 계좌번호 복사 버튼 바인딩
    $("btnCopyBankAcc")?.addEventListener("click", () => {
      navigator.clipboard.writeText(merchantInfo.account_no).then(() => {
        alert("계좌번호가 복사되었습니다: " + merchantInfo.account_no);
      }).catch(() => {
        alert("계좌번호: " + merchantInfo.account_no);
      });
    });

    // 송금 확인 요청 버튼 바인딩
    $("btnSubmitTransfer")?.addEventListener("click", async () => {
      const depositor = ($("inputDepositor")?.value || "").trim();
      if (!depositor) {
        alert("입금자 성명을 입력해주세요.");
        return;
      }

      const reqBtn = $("btnSubmitTransfer");
      reqBtn.disabled = true;
      reqBtn.textContent = "전송 중...";

      try {
        await updateDoc(doc(db, "merchant_orders", docRef.id), {
          payment_method: "bank_transfer",
          payment_status: "deposit_requested",
          depositor_name: depositor,
          deposit_requested_at: serverTimestamp(),
          updated_at: serverTimestamp()
        });

        $("transferInputBox").style.display = "none";
        $("transferAlertSuccess").style.display = "block";
      } catch (e) {
        alert("확인 요청 중 오류가 발생했습니다: " + e.message);
        reqBtn.disabled = false;
        reqBtn.textContent = "💰 송금 확인 요청";
      }
    });

  } catch (err) {
    alert("처리 에러: " + err.message);
    btn.disabled = false;
    btn.textContent = "주문하기";
  }
});
