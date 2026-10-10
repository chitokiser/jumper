import { app } from "../firebase-init.js";
import { getFirestore, collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthReady } from "../auth.js";

const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentViewer = null;
let cart = []; // 장바구니 아이템 담는 배열

onAuthReady(async ({ loggedIn, user }) => {
  if (!loggedIn) {
    window.location.href = "/login.html";
    return;
  }
  currentViewer = user;
  loadCartFromStorage();
  await loadProducts();
});

// 1. 서버(Firestore)에서 공개된 상품(published) 전부 긁어오기
async function loadProducts() {
  const listEl = $("coopMallProducts");
  listEl.innerHTML = "상품을 불러오는 중...";

  try {
    const q = query(
      collection(db, "merchant_products"),
      where("sale_status", "==", "published")
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      listEl.innerHTML = "<div class='hint'>현재 판매 중인 상품이 없습니다.</div>";
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
    docs.forEach(docSnap => {
      const data = docSnap.data;
      html += `
                <div class="panel" style="padding:16px; border:1px solid #e5e7eb; border-radius:12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between;">
                    <div>
                        ${data.image_url ? `<img src="${data.image_url}" style="width:100%;height:180px;object-fit:cover;border-radius:8px;margin-bottom:12px;" />` : ""}
                        <div style="font-weight:bold; font-size:1.2rem; color:#1f2937;">${data.product_name}</div>
                        <div style="color:#6b7280; font-size:0.85rem; margin-top:4px;">${data.description || ""}</div>
                    </div>
                    <div style="margin-top:16px; border-top:1px solid #f3f4f6; padding-top:12px; text-align:right;">
                        <span style="font-size:1.3rem; font-weight:800; color:#ef4444;">${Number(data.price).toLocaleString()} <span style="font-size:0.9rem;">VND</span></span>
                        <div style="margin-top:8px;">
                            <button class="btn btn--primary" style="width:100%; border-radius:8px;" data-action="add-cart" 
                                data-id="${docSnap.id}" 
                                data-merchant="${data.merchant_id}"
                                data-name="${data.product_name}" 
                                data-price="${data.price}">
                                🛒 장바구니 담기
                            </button>
                        </div>
                    </div>
                </div>
            `;
    });
    listEl.innerHTML = html;

    // 장바구니 닫기 이벤트 바인딩
    listEl.querySelectorAll("button[data-action='add-cart']").forEach(btn => {
      btn.addEventListener("click", () => {
        addToCart({
          id: btn.getAttribute("data-id"),
          merchant_id: btn.getAttribute("data-merchant"),
          name: btn.getAttribute("data-name"),
          price: Number(btn.getAttribute("data-price")),
          qty: 1
        });
      });
    });

  } catch (err) {
    listEl.innerHTML = `<div class='hint' style='color:red;'>에러 발생: ${err.message}</div>`;
    console.error(err);
  }
}

// 2. 장바구니 로직 구현
function saveCartToStorage() {
  localStorage.setItem("jumper_cart", JSON.stringify(cart));
}

function loadCartFromStorage() {
  const saved = localStorage.getItem("jumper_cart");
  if (saved) {
    cart = JSON.parse(saved);
  }
  updateCartBadge();
}

function updateCartBadge() {
  const totalQty = cart.reduce((acc, item) => acc + item.qty, 0);
  $("cartBadge").textContent = totalQty;
}

function addToCart(item) {
  if (!currentViewer) return alert("로그인이 필요합니다.");

  // 동일 상품 있으면 수량만 증가
  const existing = cart.find(c => c.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push(item);
  }
  saveCartToStorage();
  updateCartBadge();

  // 톡 튀는 UI 효과 (옵션)
  const badge = $("cartBadge");
  badge.style.transform = "scale(1.5)";
  setTimeout(() => badge.style.transform = "scale(1)", 200);
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
    listEl.innerHTML = "<div class='muted'>장바구니가 비어 있습니다.</div>";
    $("cartTotal").textContent = "0";
    $("btnCheckout").disabled = true;
    return;
  }

  let html = "";
  let total = 0;
  cart.forEach((c, index) => {
    total += (c.price * c.qty);
    html += `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f3f4f6; padding-bottom:8px;">
                <div>
                   <div style="font-weight:bold;">${c.name}</div>
                   <div style="font-size:0.85rem; color:#6b7280;">${Number(c.price).toLocaleString()} VND x ${c.qty}개</div>
                </div>
                <div>
                   <button class="btn btn--sm" data-action="remove-cart" data-index="${index}" style="background:#ef4444; color:white; border:none; padding:4px 8px;">제외</button>
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
  if (!confirm("장바구니 상품들을 주문하시겠습니까? (자동 결제 및 원장 등록)")) return;

  const targetMerchantId = cart[0].merchant_id;
  const itemsPayload = cart.map(c => ({
    product_id: c.id,
    name: c.name,
    price: c.price,
    qty: c.qty
  }));

  let totalAmount = 0;
  cart.forEach(c => totalAmount += c.price * c.qty);

  const btn = $("btnCheckout");
  btn.disabled = true;
  btn.textContent = "주문 처리 중...";

  try {
    const { addDoc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

    const docRef = await addDoc(collection(db, "merchant_orders"), {
      merchant_id: targetMerchantId,
      buyer_uid: currentViewer.uid,
      items: itemsPayload,
      total_amount: totalAmount,
      status: "pending",
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    });

    alert("주문이 성공적으로 완료되었습니다! (주문번호: " + docRef.id + ")");
    // 장바구니 비우기
    cart = [];
    saveCartToStorage();
    updateCartBadge();
    $("cartModal").style.display = "none";
  } catch (err) {
    alert("처리 에러: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "주문하기";
  }
});
