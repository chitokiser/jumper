// coop-mall.js: 조합 폐쇄몰 메인 로직 (회원 인증, 상품목록, HEX 결제)
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

const auth = getAuth();
const functions = getFunctions();

const coopMallNotice = document.getElementById("coopMallNotice");
const coopMallProducts = document.getElementById("coopMallProducts");

// 회원 인증 (온체인 등록 여부)
async function checkCoopMember() {
  const user = auth.currentUser;
  if (!user) return false;
  const fn = httpsCallable(functions, "getUserOnChainData");
  try {
    const res = await fn();
    return res.data?.level > 0;
  } catch {
    return false;
  }
}

// 상품 목록 불러오기 (예시: Firestore products 컬렉션)
async function loadProducts() {
  // TODO: Firestore에서 상품 불러오기 구현 필요
  // 임시 더미 데이터
  return [
    { id: "p1", name: "조합 한정 상품1", priceHex: "10", desc: "회원만 구매 가능" },
    { id: "p2", name: "조합 한정 상품2", priceHex: "25", desc: "HEX로만 결제 가능" }
  ];
}

// 상품 렌더링
function renderProducts(products) {
  coopMallProducts.innerHTML = products.map(p => `
    <div class="product-card">
      <h3>${p.name}</h3>
      <p>${p.desc}</p>
      <div>가격: <b>${p.priceHex} HEX</b></div>
      <button class="btn btn--primary" onclick="window.buyProduct('${p.id}')">HEX 결제</button>
    </div>
  `).join("");
}

// HEX 결제 (스마트컨트랙트 연동)
window.buyProduct = async function(productId) {
  coopMallNotice.style.display = "block";
  coopMallNotice.textContent = "결제 처리 중...";
  try {
    const fn = httpsCallable(functions, "buyProductWithHex");
    const res = await fn({ productId });
    coopMallNotice.textContent = "결제 성공! 트랜잭션: " + res.data?.txHash;
  } catch (err) {
    coopMallNotice.textContent = "결제 실패: " + (err.message || "오류");
  }
};

// 초기 진입
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    coopMallNotice.style.display = "block";
    coopMallNotice.textContent = "로그인 후 이용 가능합니다.";
    coopMallProducts.innerHTML = "";
    return;
  }
  const isMember = await checkCoopMember();
  if (!isMember) {
    coopMallNotice.style.display = "block";
    coopMallNotice.textContent = "회원만 접근 가능합니다.";
    coopMallProducts.innerHTML = "";
    return;
  }
  coopMallNotice.style.display = "none";
  const products = await loadProducts();
  renderProducts(products);
});
