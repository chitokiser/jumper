// /assets/js/pages/cart.js
import { onAuthReady } from "../auth.js";
import { db } from "/assets/js/firebase-init.js";

import {
  doc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function $(id){ return document.getElementById(id); }

const KEY = "jovial_cart_v1";

function loadCart(){
  try{
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    return [];
  }
}

function saveCart(arr){
  localStorage.setItem(KEY, JSON.stringify(arr || []));
}

function fmtMoney(v){
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (Number.isFinite(n)) return n.toLocaleString();
  return String(v);
}

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function render(cart){
  const listEl = $("cartList");
  const stateEl = $("cartState");
  const sumCount = $("sumCount");
  const sumTotal = $("sumTotal");

  if (!listEl || !stateEl || !sumCount || !sumTotal) return;

  const count = cart.length;
  let total = 0;

  if (!count){
    listEl.innerHTML = "";
    stateEl.textContent = "장바구니가 비어 있습니다. 상품 상세에서 '장바구니 담기'를 눌러주세요.";
    sumCount.textContent = "0";
    sumTotal.textContent = "0";
    return;
  }

  stateEl.textContent = "";
  listEl.innerHTML = cart.map((it, idx) => {
    const price = it.price ?? "";
    const priceNum = Number(price);
    if (Number.isFinite(priceNum)) total += priceNum;

    const thumb = it.thumb
      ? `<img src="${esc(it.thumb)}" alt="${esc(it.title)}" onerror="this.remove()" />`
      : "";

    return `
      <div class="cart-item">
        <div class="cart-thumb">${thumb}</div>
        <div class="cart-main">
          <div class="cart-name">${esc(it.title || "")}</div>
          <div class="cart-meta">
            ${it.region ? `<span class="badge">${esc(it.region)}</span>` : ""}
            ${it.category ? `<span class="badge">${esc(it.category)}</span>` : ""}
            ${price !== "" ? `<span class="badge">가격: ${esc(fmtMoney(price))}</span>` : ""}
          </div>
        </div>
        <div class="cart-right">
          <div class="price">${price !== "" ? esc(fmtMoney(price)) : "-"}</div>
          <button class="btn" type="button" data-rm="${idx}">삭제</button>
        </div>
      </div>
    `;
  }).join("");

  sumCount.textContent = String(count);
  sumTotal.textContent = fmtMoney(total);

  // remove handlers
  listEl.querySelectorAll("button[data-rm]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.getAttribute("data-rm"));
      if (!Number.isFinite(i)) return;
      const next = loadCart().filter((_,k)=>k!==i);
      saveCart(next);
      render(next);
    });
  });
}

async function createOrder({ itemId, itemTitle, ownerUid, price, user, itemThumb }){
  // /assets/js/pages/cart.js
  // NOTE:
  // - 주문 생성 시 status=paid 로 저장합니다(구매자가 구매 완료).
  // - 관리자는 이후 주문관리에서 결제확인(confirmed) 처리합니다.
  // - settlementMonth는 월 정산(락) 단위로 사용합니다.
  const now = new Date();
  const settlementMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const payload = {
    itemId,
    itemTitle: itemTitle || "",
    ownerUid: ownerUid || "", // legacy
    guideUid: ownerUid || "", // SSOT
    buyerUid: user.uid,
    buyerEmail: user.email || "",
    amount: price ?? "",
    currency: "KRW",
    status: "paid",
    paymentStatus: "paid",
    payment: "offline",
    memo: "",
    itemThumb: itemThumb || "",
    settlementMonth,
    paidAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "orders"), payload);
  return ref.id;
}

async function checkout(cart, user){
  const btn = $("btnCheckout");
  const stateEl = $("cartState");
  if (!user){
    stateEl.textContent = "로그인이 필요합니다. 우측 상단에서 구글 로그인 후 다시 시도하세요.";
    return;
  }
  if (!cart.length) return;

  btn && (btn.disabled = true);
  stateEl.textContent = "주문 생성 중...";

  const created = [];
  const skipped = [];

  for (const c of cart){
    try{
      const itemId = c.itemId;
      if (!itemId){ skipped.push({title:c.title, reason:"no itemId"}); continue; }

      const snap = await getDoc(doc(db, "items", itemId));
      if (!snap.exists()){ skipped.push({title:c.title, reason:"not found"}); continue; }

      const d = snap.data() || {};
      const status = d.status || "";
      if (status !== "published"){
        skipped.push({title:c.title, reason:`status:${status||"unknown"}`});
        continue;
      }

      const ownerUid = d.ownerUid || d.guideUid || "";
      const price = d.price ?? d.amount ?? c.price ?? "";
      const title = d.title || d.name || c.title || "";

      const oid = await createOrder({
        itemId,
        itemTitle: title,
        ownerUid,
        price,
        user,
        itemThumb: c.thumb || "",
      });

      created.push(oid);
    }catch(e){
      console.error(e);
      skipped.push({title:c.title, reason:e?.message || String(e)});
    }
  }

  // 결과 처리
  if (created.length){
    saveCart([]); // 성공한 경우 비움 (단순화)
  }

  const msgParts = [];
  msgParts.push(`생성된 주문: ${created.length}건`);
  if (skipped.length){
    msgParts.push(`제외: ${skipped.length}건 (비공개/삭제 등)`);
  }

  stateEl.textContent = msgParts.join(" · ");

  btn && (btn.disabled = false);

  // 주문 목록으로 이동
  if (created.length){
    location.href = "/orders.html";
  }
}

(async function init(){
  const cart = loadCart();
  render(cart);

  $("btnClear")?.addEventListener("click", ()=>{
    saveCart([]);
    render([]);
  });

  const { user } = await onAuthReady();
  $("btnCheckout")?.addEventListener("click", ()=>{
    checkout(loadCart(), user);
  });
})();
