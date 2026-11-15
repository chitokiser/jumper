// /assets/js/pages/events.js - BestClub Event Coupon & Voucher Lounge Controller
import { onAuthReady } from "/assets/js/auth.js";
import { db, functions, auth } from "/assets/js/firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  runTransaction,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const $ = (id) => document.getElementById(id);

let _currentUser = null;
let _userData = null;
let _isSuperAdmin = false;
let _myMerchantId = null;
let _allCampaigns = [];
let _activeTypeFilter = "all"; // all, GOOGLE_REVIEW, COUPON, VOUCHER
let _activePriceFilter = "all"; // all, free, paid
let _activeMerchantFilter = "all";
let _selectedCampaign = null;
let _currentReviewComments = [];
const _merchantGmapMap = new Map([
  ["1794710386", "https://www.google.com/maps?q=21.018389559538733,105.77550303942346"],
  ["baekje_galbi", "https://www.google.com/maps?q=21.018389559538733,105.77550303942346"]
]);

// Firebase Functions Callable 인스턴스
const fnPurchaseOrIssue = httpsCallable(functions, "purchaseOrIssueCoupon");
const fnCreateCampaign = httpsCallable(functions, "createCouponCampaign");
const fnUpdateCampaign = httpsCallable(functions, "updateCouponCampaign");
const fnToggleStatus = httpsCallable(functions, "toggleCouponCampaignStatus");
const fnDeleteCampaign = httpsCallable(functions, "deleteCouponCampaign");
const fnSubmitReviewComment = httpsCallable(functions, "submitCouponReviewComment");
const fnApproveReviewVoucher = httpsCallable(functions, "approveReviewAndTransferVoucher");
const fnDeleteReviewComment = httpsCallable(functions, "deleteCouponReviewComment");

/**
 * 수퍼 어드민 권한 검증
 */
async function checkSuperAdmin(user) {
  if (!user) return false;
  const email = (user.email || "").toLowerCase().trim();
  if (email === "daguri75@gmail.com") return true;

  try {
    const aSnap = await getDoc(doc(db, "admins", user.uid));
    if (aSnap.exists()) return true;
  } catch (_) {}

  try {
    const uSnap = await getDoc(doc(db, "users", user.uid));
    if (uSnap.exists()) {
      const ud = uSnap.data() || {};
      if (ud.isAdmin === true || ["SUPER_ADMIN", "ADMIN", "admin"].includes(ud.role)) {
        return true;
      }
    }
  } catch (_) {}

  return false;
}

const FALLBACK_SEED_CAMPAIGNS = [
  {
    campaignId: "seed-cpn-bestwinner-10pct",
    campaignType: "COUPON",
    issuerType: "MERCHANT",
    issuerId: "1791605366",
    issuerNameSnapshot: "BEST WINNER",
    issuerBadge: "BEST WINNER",
    title: "베스트위너 모든 상품 10% 할인권",
    description: "베스트위너 공식 가맹점의 모든 대상 상품 구매 시 결제 금액의 10%를 즉시 할인해 드립니다.",
    imageUrl: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=800&q=80",
    priceBM: 10000,
    discountType: "PERCENT",
    discountValue: "10%",
    applicableMerchantIds: ["1791605366", "bestwinner"],
    applicableProductIds: [],
    totalQuantity: 200,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 2,
    usageMode: "BOTH",
    terms: "베스트위너 온·오프라인 매장에서 사용 가능하며, 다른 할인 쿠폰과 중복 적용되지 않습니다.",
    status: "active"
  },
  {
    campaignId: "seed-cpn-baekje-10pct-free",
    campaignType: "COUPON",
    issuerType: "MERCHANT",
    issuerId: "baekje_galbi",
    issuerNameSnapshot: "백제갈비",
    issuerBadge: "BAJE GALBI",
    title: "백제갈비 모든 메뉴 10% 할인권",
    description: "하노이 최고의 정통 숯불갈비 명가 백제갈비 전 메뉴 10% 무료 특별 할인 이벤트 쿠폰입니다.",
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80",
    priceBM: 0,
    discountType: "PERCENT",
    discountValue: "10%",
    applicableMerchantIds: ["baekje_galbi", "1791002036"],
    applicableProductIds: [],
    totalQuantity: 500,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 1,
    usageMode: "BOTH",
    terms: "백제갈비 매장 방문 결제 또는 온라인 주문 시 적용 가능하며, 테이블당 1매 사용 가능합니다.",
    status: "active"
  },
  {
    campaignId: "seed-vch-baekje-lunch-meal",
    campaignType: "VOUCHER",
    issuerType: "MERCHANT",
    issuerId: "baekje_galbi",
    issuerNameSnapshot: "백제갈비",
    issuerBadge: "BAJE GALBI",
    title: "백제갈비 점심 무료 식사권 (스페셜 메뉴)",
    description: "백제갈비 지정 매장에서 정성껏 준비한 스페셜 점심 특선 메뉴 1회를 무료로 교환할 수 있는 권리 바우쳐입니다.",
    imageUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80",
    priceBM: 100000,
    discountType: "ITEM_EXCHANGE",
    discountValue: "스페셜 점심 식사 1회",
    applicableMerchantIds: ["baekje_galbi", "1791002036"],
    applicableProductIds: [],
    totalQuantity: 100,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 2,
    usageMode: "OFFLINE",
    terms: "백제갈비 오프라인 지정 매장 방문 시 직원에게 QR 코드를 제시하면 메뉴 1회 교환이 승인됩니다. (점심 시간대 11:30~14:30 한정)",
    status: "active"
  },
  {
    campaignId: "seed-vch-daehan-kimchi-5kg",
    campaignType: "VOUCHER",
    issuerType: "MERCHANT",
    issuerId: "1791002036",
    issuerNameSnapshot: "대한김치",
    issuerBadge: "DAEHAN KIMCHI",
    title: "대한김치 5kg 배추김치 구매권",
    description: "한국산 프리미엄 고춧가루와 비법 레시피로 매일 아침 담그는 정통 포기 배추김치 5kg 1통 실물 교환 바우쳐입니다.",
    imageUrl: "https://images.unsplash.com/photo-1583032015879-6b3a014902b3?auto=format&fit=crop&w=800&q=80",
    priceBM: 200000,
    discountType: "ITEM_EXCHANGE",
    discountValue: "배추김치 5kg 1통",
    applicableMerchantIds: ["1791002036", "daehan_kimchi"],
    applicableProductIds: [],
    totalQuantity: 150,
    issuedQuantity: 0,
    redeemedQuantity: 0,
    maxPerUser: 3,
    usageMode: "BOTH",
    terms: "대한김치 매장 방문 또는 온라인 주문 결제 시 바우쳐 번호를 적용하면 배추김치 5kg 상품과 교환됩니다.",
    status: "active"
  }
];

const MERCHANT_ALIASES = {
  "1791605366": ["1791605366", "bestwinner", "best_winner"],
  "bestwinner": ["1791605366", "bestwinner", "best_winner"],
  "1791002036": ["1791002036", "daehan_kimchi"],
  "daehan_kimchi": ["1791002036", "daehan_kimchi"],
  "1794710386": ["1794710386", "baekje_galbi"],
  "baekje_galbi": ["1794710386", "baekje_galbi"]
};

const DEFAULT_BADGE_MAP = {
  "1791605366": "BEST WINNER",
  "1791002036": "DAEHAN KIMCHI",
  "1794710386": "BAEKJE GALBI",
  "1793671043": "BEST MARIO",
  "1793776651": "SUNVIETNAM"
};

function expandMerchantAliases(mId) {
  const s = String(mId || "").trim();
  return MERCHANT_ALIASES[s] ? [...MERCHANT_ALIASES[s]] : [s];
}

function canManageCampaign(c) {
  if (!c || !_currentUser) return false;
  if (_isSuperAdmin) return true;
  if (!_myMerchantId) return false;
  const myAliases = expandMerchantAliases(_myMerchantId);
  if (myAliases.includes(String(c.issuerId || ""))) return true;
  if (Array.isArray(c.applicableMerchantIds) && c.applicableMerchantIds.some((id) => myAliases.includes(String(id)))) {
    return true;
  }
  return false;
}

function getMerchantGmapUrl(issuerId) {
  const aliases = expandMerchantAliases(issuerId);
  for (const id of aliases) {
    if (_merchantGmapMap.has(id)) return _merchantGmapMap.get(id);
  }
  return "";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function maskEmail(email) {
  const s = String(email || "").trim();
  if (!s.includes("@")) return s || "회원";
  const [local, domain] = s.split("@");
  if (local.length <= 2) return `${local[0] || "*"}***@${domain}`;
  return `${local.slice(0, 3)}***@${domain}`;
}

/**
 * 0. Firestore merchants 컬렉션에서 가맹점 목록 동적 로드 및 드롭다운 갱신
 */
async function loadMerchantMasterList() {
  const defaultMerchants = [
    { id: "1791605366", name: "BEST WINNER", badge: "BEST WINNER" },
    { id: "1791002036", name: "대한김치", badge: "DAEHAN KIMCHI" },
    { id: "1794710386", name: "백제갈비", badge: "BAEKJE GALBI", gmap: "https://www.google.com/maps?q=21.018389559538733,105.77550303942346" },
    { id: "1793671043", name: "베스트마리오", badge: "BEST MARIO" },
    { id: "1793776651", name: "sunvietnam", badge: "SUNVIETNAM" }
  ];

  const merchantMap = new Map();
  defaultMerchants.forEach((m) => {
    merchantMap.set(m.id, m);
    if (m.gmap) _merchantGmapMap.set(m.id, m.gmap);
  });

  try {
    const snap = await getDocs(collection(db, "merchants"));
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.active === false) return;
      const id = String(d.id);
      const name = data.name || data.merchantName || id;
      const badge = data.badge || DEFAULT_BADGE_MAP[id] || name.toUpperCase();
      const gmap = data.gmap || data.googleMapUrl || _merchantGmapMap.get(id) || "";
      merchantMap.set(id, { id, name, badge, gmap });
      if (gmap) _merchantGmapMap.set(id, gmap);
    });
  } catch (err) {
    console.warn("merchants collection load fallback to defaults:", err);
  }

  const merchants = Array.from(merchantMap.values());

  const filterSel = $("filterMerchantSelect");
  if (filterSel) {
    const prevVal = filterSel.value || "all";
    filterSel.innerHTML =
      `<option value="all">== 전체 가맹점 ==</option>` +
      merchants.map((m) => `<option value="${m.id}">${m.name} (${m.id})</option>`).join("");
    if ([...filterSel.options].some((o) => o.value === prevVal)) {
      filterSel.value = prevVal;
    }
  }

  const issuerOptionsHtml =
    merchants
      .map((m) => `<option value="${m.id}" data-badge="${m.badge}">${m.name} (${m.id})</option>`)
      .join("") +
    `<option value="platform" data-badge="SUPER ADMIN">BestClub 공식 (수퍼 어드민)</option>`;

  ["inpIssuerSelect", "editIssuerSelect"].forEach((selId) => {
    const sel = $(selId);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = issuerOptionsHtml;
    if (prev && [...sel.options].some((o) => o.value === prev)) {
      sel.value = prev;
    }
  });

  if (!_isSuperAdmin && _myMerchantId && $("inpIssuerSelect")) {
    $("inpIssuerSelect").value = _myMerchantId;
    $("inpIssuerSelect").disabled = true;
  }
}

/**
 * 1. 캠페인 목록 로드 (Firestore + Preset Seed Fallback)
 */
async function loadCampaigns() {
  try {
    const snap = await getDocs(collection(db, "coupon_campaigns"));
    const list = [];
    snap.forEach((d) => {
      list.push({ id: d.id, ...d.data() });
    });

    if (list.length === 0) {
      _allCampaigns = FALLBACK_SEED_CAMPAIGNS.map(c => ({ id: c.campaignId, ...c }));
    } else {
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return tb - ta;
      });
      _allCampaigns = list;
    }
  } catch (err) {
    console.warn("coupon_campaigns load fallback to seed:", err);
    _allCampaigns = FALLBACK_SEED_CAMPAIGNS.map(c => ({ id: c.campaignId, ...c }));
  }

  renderCampaignGrid();
}

/**
 * 2. 캠페인 그리드 필터링 및 렌더링
 */
function renderCampaignGrid() {
  const grid = $("couponGrid");
  const countBadge = $("evCountBadge");
  if (!grid) return;

  const filtered = _allCampaigns.filter((c) => {
    // 1) 유형 필터
    if (_activeTypeFilter === "GOOGLE_REVIEW") {
      if (c.issueMethod !== "GOOGLE_REVIEW") return false;
    } else if (_activeTypeFilter !== "all" && c.campaignType !== _activeTypeFilter) {
      return false;
    }
    // 2) 가격 필터
    const price = Number(c.priceBM || 0);
    if (_activePriceFilter === "free" && price > 0) return false;
    if (_activePriceFilter === "paid" && price === 0) return false;
    // 3) 가맹점 필터 (별칭 호환)
    if (_activeMerchantFilter !== "all") {
      const allowed = c.applicableMerchantIds || ["all"];
      const filterAliases = expandMerchantAliases(_activeMerchantFilter);
      const matched =
        allowed.includes("all") ||
        filterAliases.includes(String(c.issuerId || "")) ||
        allowed.some((id) => filterAliases.includes(String(id)));
      if (!matched) {
        return false;
      }
    }
    return true;
  });

  if (countBadge) {
    countBadge.textContent = `총 ${filtered.length}개 항목`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="ev-loading-box">
        <span style="font-size:2.4rem; display:block; margin-bottom:12px;">🎟️</span>
        <h3 style="font-size:1.15rem; font-weight:800; color:#334155; margin:0 0 6px;">해당 조건의 쿠폰·바우쳐가 없습니다</h3>
        <p style="color:#64748b; font-size:0.88rem; margin:0;">필터를 변경하거나 상단의 신규 발행 기능을 이용해 보세요.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map((c) => {
    const isVoucher = c.campaignType === "VOUCHER";
    const isGoogleReview = c.issueMethod === "GOOGLE_REVIEW";
    const price = Number(c.priceBM || 0);
    const isFree = price === 0;
    const isPaused = c.status === "paused";
    const badgeClass = getBadgeClass(c.issuerBadge || "");
    const canManage = canManageCampaign(c);

    const remainingQty = Math.max(0, Number(c.totalQuantity || 0) - Number(c.issuedQuantity || 0));

    // 수퍼 어드민 또는 발행 가맹점주 조작 버튼 바
    const adminBarHtml = canManage ? `
      <div class="ev-card-admin-bar">
        <button class="ev-btn-admin ev-btn-admin--edit" type="button" data-act="admin-edit" data-id="${c.id}" title="쿠폰 정보 수정">
          ✏️ 수정
        </button>
        <button class="ev-btn-admin ev-btn-admin--toggle" type="button" data-act="admin-toggle" data-id="${c.id}" data-status="${c.status || 'active'}" title="${isPaused ? '발행 활성화' : '발행 일시 중단'}">
          ${isPaused ? '▶️ 활성화' : '⏸️ 비활성화'}
        </button>
        <button class="ev-btn-admin ev-btn-admin--del" type="button" data-act="admin-del" data-id="${c.id}" title="쿠폰 영구 삭제">
          🗑️ 삭제
        </button>
      </div>
    ` : '';

    return `
      <article class="ev-card ${isPaused ? 'is-paused' : ''}" data-id="${c.id}">
        <div class="ev-card-thumb-wrap">
          <img class="ev-card-img" src="${c.imageUrl || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80'}" alt="${c.title}" loading="lazy" />
          <div class="ev-card-top-badges">
            <span class="ev-tag-type ${isVoucher ? 'ev-tag-type--voucher' : 'ev-tag-type--coupon'}">
              ${isVoucher ? '🍽️ 바우쳐' : '🎟️ 할인 쿠폰'}
            </span>
            ${isPaused ? '<span class="ev-tag-paused">⏸️ 비활성화됨</span>' : ''}
            ${isGoogleReview ? `
              <span class="ev-tag-price ev-tag-price--review">
                ⭐ 구글리뷰 바우쳐 (1인1회)
              </span>
            ` : `
              <span class="ev-tag-price ${isFree ? 'ev-tag-price--free' : 'ev-tag-price--paid'}">
                ${isFree ? 'FREE (무료)' : `${price.toLocaleString()} BM`}
              </span>
            `}
          </div>
        </div>

        <div class="ev-card-body">
          <div class="ev-issuer-line">
            <span class="ev-badge-issuer ${badgeClass}">${c.issuerBadge || 'VERIFIED'}</span>
            <span class="ev-issuer-name">${c.issuerNameSnapshot || '공식 가맹점'}</span>
          </div>

          <h3 class="ev-card-title">${c.title}</h3>
          <p class="ev-card-desc">${c.description || ''}</p>

          <div class="ev-card-meta">
            <div class="ev-card-meta-row">
              <span>제공 혜택</span>
              <strong style="color:var(--ev-accent);">${c.discountValue || '10%'}</strong>
            </div>
            <div class="ev-card-meta-row">
              <span>남은 수량</span>
              <span>${remainingQty.toLocaleString()} / ${Number(c.totalQuantity || 0).toLocaleString()}장</span>
            </div>
            <div class="ev-card-meta-row">
              <span>참여/발급 한도</span>
              <span>${isGoogleReview ? '⭐ 1계정 1회 참여 (리뷰인증)' : `1인 최대 ${c.maxPerUser || 1}장`}</span>
            </div>
          </div>

          <div class="ev-card-actions">
            <button class="ev-btn-view" type="button" data-act="view" data-id="${c.id}">상세보기</button>
            ${isPaused ? `
              <button class="ev-btn-action" style="background:#94a3b8; cursor:not-allowed;" type="button" disabled>
                ⏸️ 발행 중단됨
              </button>
            ` : isGoogleReview ? `
              <button class="ev-btn-action free" type="button" data-act="view" data-id="${c.id}">
                ⭐ 리뷰 URL 댓글 참여
              </button>
            ` : `
              <button class="ev-btn-action ${isFree ? 'free' : ''}" type="button" data-act="buy" data-id="${c.id}">
                ${isFree ? '🎁 무료 발급' : '💎 BM 구매'}
              </button>
            `}
          </div>

          ${adminBarHtml}
        </div>
      </article>
    `;
  }).join("");
}

function getBadgeClass(badgeStr) {
  const b = String(badgeStr).toUpperCase();
  if (b.includes("SUPER") || b.includes("ADMIN")) return "superadmin";
  if (b.includes("WINNER")) return "bestwinner";
  if (b.includes("KIMCHI") || b.includes("DAEHAN")) return "daehan";
  if (b.includes("BAJE") || b.includes("BAEKJE") || b.includes("GALBI")) return "baekje";
  return "";
}

/**
 * 3. 상세 모달 열기
 */
function openDetailModal(campaignId) {
  const c = _allCampaigns.find((item) => item.id === campaignId);
  if (!c) return;
  _selectedCampaign = c;

  const modal = $("couponDetailModal");
  if (!modal) return;

  const isVoucher = c.campaignType === "VOUCHER";
  const isGoogleReview = c.issueMethod === "GOOGLE_REVIEW";
  const price = Number(c.priceBM || 0);
  const isFree = price === 0;
  const isPaused = c.status === "paused";
  const canManage = canManageCampaign(c);

  if ($("detailImg")) $("detailImg").src = c.imageUrl || "";
  if ($("detailBadgeTop")) {
    $("detailBadgeTop").textContent = isGoogleReview
      ? "⭐ 구글 리뷰 인증 바우쳐 이벤트"
      : (isVoucher ? "🍽️ 스페셜 교환 바우쳐" : "🎟️ 공식 할인 쿠폰");
  }
  if ($("detailIssuerBadge")) {
    $("detailIssuerBadge").className = `ev-badge-issuer ${getBadgeClass(c.issuerBadge || "")}`;
    $("detailIssuerBadge").textContent = `${c.issuerBadge || "VERIFIED"} · ${c.issuerNameSnapshot || "가맹점"}`;
  }
  if ($("detailUsageMode")) {
    const modeText = c.usageMode === "OFFLINE" ? "오프라인 전용 (QR)" : (c.usageMode === "ONLINE" ? "온라인 전용" : "온·오프라인 공용");
    $("detailUsageMode").textContent = modeText;
  }

  if ($("detailTitle")) $("detailTitle").textContent = c.title;
  if ($("detailDesc")) $("detailDesc").textContent = c.description || "";
  if ($("detailPrice")) {
    $("detailPrice").textContent = isGoogleReview
      ? "⭐ 구글리뷰 인증 (무료)"
      : (isFree ? "FREE (무료 발급)" : `${price.toLocaleString()} BM`);
  }
  if ($("detailDiscount")) $("detailDiscount").textContent = c.discountValue || "혜택 제공";
  if ($("detailMaxPerUser")) {
    $("detailMaxPerUser").textContent = isGoogleReview ? "1계정 1회 참여 (1매)" : `회원당 ${c.maxPerUser || 1}장`;
  }

  // 유의사항 리스트
  const termsUl = $("detailTermsList");
  if (termsUl) {
    const defaultTerms = isGoogleReview
      ? "매장 구글 지도에 리뷰를 작성한 후 댓글에 구글 리뷰 URL을 등록해 주세요.\n관리자가 구글 리뷰 작성을 확인한 후 바우쳐 1장을 회원님의 쿠폰함으로 즉시 이체합니다.\n본 이벤트는 1계정당 1회만 참여 및 바우쳐 수령이 가능합니다."
      : "지정된 매장에서 유효기간 내에 사용 가능합니다.\n타 할인 및 쿠폰과 중복 적용되지 않을 수 있습니다.\n무료 발급 및 구매 후 마이페이지에서 QR을 제시해 주세요.";
    const terms = (c.terms || defaultTerms)
      .split("\n")
      .filter(Boolean);
    termsUl.innerHTML = terms.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  }

  // 매장 & 유효기간 & 재고
  const allowedMerchants = c.applicableMerchantIds || ["all"];
  const merchDisp = allowedMerchants.includes("all") ? "전체 공식 가맹점" : (c.issuerNameSnapshot || allowedMerchants.join(", "));
  if ($("detailMerchants")) $("detailMerchants").textContent = merchDisp;

  const validStr = c.validEndsAt?.toDate ? c.validEndsAt.toDate().toLocaleDateString("ko-KR") : "발행일로부터 365일";
  if ($("detailValidPeriod")) $("detailValidPeriod").textContent = `사용 만료일: ${validStr}`;

  const remainingQty = Math.max(0, Number(c.totalQuantity || 0) - Number(c.issuedQuantity || 0));
  if ($("detailStock")) $("detailStock").textContent = `${remainingQty.toLocaleString()}장 남음 (총 ${Number(c.totalQuantity || 0).toLocaleString()}장)`;

  // ⭐ 구글 리뷰 인증 섹션 표시 및 댓글 로드
  const reviewSection = $("detailReviewSection");
  if (reviewSection) {
    if (isGoogleReview) {
      reviewSection.style.display = "block";
      const btnGmap = $("btnGoGoogleMapReview");
      if (btnGmap) {
        const targetGmap = (c.googleReviewTargetUrl || "").trim() || getMerchantGmapUrl(c.issuerId);
        if (targetGmap) {
          btnGmap.href = targetGmap;
          btnGmap.style.display = "inline-flex";
          btnGmap.textContent = `📍 [${c.issuerNameSnapshot || "매장"}] 구글 지도에서 리뷰 작성하러 가기 ↗`;
        } else {
          btnGmap.style.display = "none";
        }
      }
      const adminHint = $("reviewAdminHint");
      if (adminHint) {
        adminHint.style.display = canManage ? "inline" : "none";
      }
      loadAndRenderReviewComments(c);
    } else {
      reviewSection.style.display = "none";
    }
  }

  // 액션 버튼 바인딩
  const btnBuy = $("btnActionBuy");
  if (btnBuy) {
    if (isPaused) {
      btnBuy.textContent = "⏸️ 현재 발행이 일시 중단된 상품입니다";
      btnBuy.className = "ev-btn ev-btn--full";
      btnBuy.style.background = "#94a3b8";
      btnBuy.disabled = true;
      btnBuy.onclick = null;
    } else if (isGoogleReview) {
      btnBuy.disabled = false;
      btnBuy.style.background = "";
      btnBuy.textContent = "✍️ 위 댓글창에 구글 리뷰 URL 등록하기 (1계정 1회)";
      btnBuy.className = "ev-btn ev-btn--primary ev-btn--full";
      btnBuy.onclick = () => {
        if (!_currentUser) {
          alert("로그인이 필요합니다. 로그인 후 구글 리뷰 URL을 등록해 주세요.");
          return;
        }
        const inpUrl = $("inpReviewUrl");
        if (inpUrl) {
          inpUrl.scrollIntoView({ behavior: "smooth", block: "center" });
          inpUrl.focus();
        }
      };
    } else {
      btnBuy.disabled = false;
      btnBuy.style.background = "";
      btnBuy.textContent = isFree ? "🎁 무료로 즉시 발급받기" : `💎 ${price.toLocaleString()} BM으로 구매하기`;
      btnBuy.className = `ev-btn ev-btn--full ${isFree ? 'ev-btn--action free' : 'ev-btn--primary'}`;
      btnBuy.onclick = () => executePurchaseOrIssue(c);
    }
  }

  // 수퍼 어드민 또는 발행 가맹점주 제어판 바인딩
  const adminControls = $("detailAdminControls");
  if (adminControls) {
    if (canManage) {
      adminControls.style.display = "block";
      const statusBadge = $("detailAdminStatusBadge");
      if (statusBadge) {
        if (isPaused) {
          statusBadge.textContent = "⏸️ 비활성화 상태";
          statusBadge.style.background = "#fef3c7";
          statusBadge.style.color = "#b45309";
        } else {
          statusBadge.textContent = "🟢 정상 활성 상태";
          statusBadge.style.background = "#d1fae5";
          statusBadge.style.color = "#065f46";
        }
      }
      const btnToggle = $("btnAdminToggleStatus");
      if (btnToggle) {
        btnToggle.textContent = isPaused ? "▶️ 활성화하기" : "⏸️ 비활성화하기";
      }
    } else {
      adminControls.style.display = "none";
    }
  }

  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
}

function closeDetailModal() {
  const modal = $("couponDetailModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

/**
 * 3-B. 구글 리뷰 댓글 목록 로드 및 참여 상태 / 관리자 바우쳐 이체 버튼 렌더링
 */
async function loadAndRenderReviewComments(campaign) {
  const listEl = $("reviewCommentList");
  const countBadge = $("reviewCommentCountBadge");
  const myBanner = $("myReviewStatusBanner");
  const formEl = $("reviewCommentForm");
  const btnBuy = $("btnActionBuy");
  if (!listEl || !campaign) return;

  listEl.innerHTML = `<div class="ev-review-empty">⏳ 구글 리뷰 참여 내역을 불러오는 중입니다...</div>`;

  const canManage = canManageCampaign(campaign);
  let comments = [];

  try {
    const q = query(collection(db, "coupon_review_comments"), where("campaignId", "==", campaign.id));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      comments.push({ id: d.id, ...d.data() });
    });
    comments.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  } catch (err) {
    console.warn("loadAndRenderReviewComments error:", err);
  }

  _currentReviewComments = comments;

  const approvedCount = comments.filter((c) => c.status === "approved").length;
  const pendingCount = comments.filter((c) => c.status === "pending").length;
  if (countBadge) {
    countBadge.textContent = `참여 ${comments.length}건 (대기 ${pendingCount} · 지급완료 ${approvedCount})`;
  }

  // 현재 로그인 회원의 참여 여부 확인 (1계정 1회 참여)
  const myComment = _currentUser
    ? comments.find((item) => String(item.userId) === String(_currentUser.uid))
    : null;

  if (myBanner && formEl) {
    if (!_currentUser) {
      myBanner.style.display = "none";
      formEl.style.display = "block";
    } else if (myComment && myComment.status === "approved") {
      formEl.style.display = "none";
      myBanner.className = "ev-my-review-banner ev-my-review-banner--approved";
      myBanner.style.display = "block";
      myBanner.innerHTML = `
        <div style="font-weight:800; font-size:0.9rem; margin-bottom:4px;">
          🎉 바우쳐 1장 이체 완료! (1계정 1회 참여 완료)
        </div>
        <div>
          관리자가 회원님의 구글 리뷰를 확인하여 <b>바우쳐 1장 (코드: ${escapeHtml(myComment.issuedCouponCode || "발급완료")})</b>을 이체하였습니다.
          <a href="/mypage.html#couponsSection" style="display:inline-block; margin-left:6px; color:#047857; font-weight:800; text-decoration:underline;">
            👉 내 쿠폰함에서 QR 확인하기 &rarr;
          </a>
        </div>
      `;
      if (btnBuy && campaign.status !== "paused") {
        btnBuy.disabled = false;
        btnBuy.textContent = "📦 내 쿠폰함에서 이체받은 바우쳐 QR 확인하기 →";
        btnBuy.onclick = () => {
          window.location.href = "/mypage.html#couponsSection";
        };
      }
    } else if (myComment && myComment.status === "pending") {
      formEl.style.display = "none";
      myBanner.className = "ev-my-review-banner ev-my-review-banner--pending";
      myBanner.style.display = "block";
      myBanner.innerHTML = `
        <div style="font-weight:800; font-size:0.9rem; margin-bottom:4px;">
          ⏳ 구글 리뷰 URL 등록 완료 · 관리자 확인 대기중 (1계정 1회 참여 완료)
        </div>
        <div>
          등록하신 구글 리뷰 URL을 관리자가 확인한 후 <b>바우쳐 1장</b>을 회원님의 계정으로 즉시 이체해 드립니다.
        </div>
      `;
      if (btnBuy && campaign.status !== "paused") {
        btnBuy.disabled = true;
        btnBuy.textContent = "⏳ 관리자 리뷰 확인 대기중 (확인 시 바우쳐 1장 즉시 이체)";
      }
    } else {
      myBanner.style.display = "none";
      formEl.style.display = campaign.status === "paused" ? "none" : "block";
    }
  }

  if (comments.length === 0) {
    listEl.innerHTML = `<div class="ev-review-empty">아직 등록된 구글 리뷰 인증 댓글이 없습니다. 첫 번째로 참여해 보세요!</div>`;
    return;
  }

  listEl.innerHTML = comments.map((cmt) => {
    const isApproved = cmt.status === "approved";
    const isMine = _currentUser && String(cmt.userId) === String(_currentUser.uid);
    const dispEmail = (canManage || isMine) ? (cmt.userEmail || "") : maskEmail(cmt.userEmail || "");
    const dispAuthor = `${escapeHtml(cmt.userName || "회원")}${dispEmail ? ` (${escapeHtml(dispEmail)})` : ""}`;
    const dateStr = cmt.createdAt?.toDate
      ? cmt.createdAt.toDate().toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "방금 전";

    return `
      <div class="ev-review-item ${isApproved ? "ev-review-item--approved" : "ev-review-item--pending"}">
        <div class="ev-review-item-top">
          <span class="ev-review-author">
            👤 ${dispAuthor}
            <span style="font-weight:500; font-size:0.75rem; color:#64748b; margin-left:4px;">${dateStr}</span>
          </span>
          <span class="ev-review-status-pill ${isApproved ? "ev-review-status-pill--approved" : "ev-review-status-pill--pending"}">
            ${isApproved ? `✅ 바우쳐 1장 이체완료 (${escapeHtml(cmt.issuedCouponCode || "지급됨")})` : "⏳ 관리자 확인 대기중"}
          </span>
        </div>

        ${cmt.reviewText ? `<div class="ev-review-text">${escapeHtml(cmt.reviewText)}</div>` : ""}

        <div class="ev-review-url-row">
          <a href="${escapeHtml(cmt.reviewUrl)}" target="_blank" rel="noopener noreferrer" class="ev-review-url-link" title="${escapeHtml(cmt.reviewUrl)}">
            🔗 구글 리뷰 확인: ${escapeHtml(cmt.reviewUrl)} &nearr;
          </a>
          ${(!isApproved && isMine && !canManage) ? `
            <button type="button" class="ev-btn-reject-review" data-review-act="delete" data-comment-id="${escapeHtml(cmt.id)}">
              🗑️ 내 댓글 취소/재등록
            </button>
          ` : ""}
        </div>

        ${canManage ? `
          <div class="ev-review-admin-actions">
            ${!isApproved ? `
              <button type="button" class="ev-btn-transfer-voucher" data-review-act="approve" data-comment-id="${escapeHtml(cmt.id)}">
                🎁 구글리뷰 확인완료 · 바우쳐 1장 즉시 이체
              </button>
              <button type="button" class="ev-btn-reject-review" data-review-act="delete" data-comment-id="${escapeHtml(cmt.id)}">
                ❌ 반려/삭제
              </button>
            ` : `
              <span style="font-size:0.78rem; font-weight:700; color:#047857;">
                ✅ 이체 완료된 바우쳐 코드: <b>${escapeHtml(cmt.issuedCouponCode || "-")}</b>
              </span>
            `}
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

/**
 * 3-C. 회원의 구글 리뷰 URL 댓글 등록 (1계정 1회 참여)
 */
async function handleReviewCommentSubmit(e) {
  e.preventDefault();
  if (!_selectedCampaign) return;
  if (!_currentUser) {
    alert("로그인이 필요합니다. 로그인 후 구글 리뷰 이벤트에 참여해 주세요.");
    return;
  }

  const inpUrl = $("inpReviewUrl");
  const inpText = $("inpReviewText");
  const btnSubmit = $("btnSubmitReviewComment");

  const reviewUrl = (inpUrl?.value || "").trim();
  const reviewText = (inpText?.value || "").trim();

  if (!reviewUrl || !/^https?:\/\//i.test(reviewUrl)) {
    alert("올바른 구글 리뷰 URL(https://...)을 입력해 주세요.");
    if (inpUrl) inpUrl.focus();
    return;
  }

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = "⏳ 구글 리뷰 URL 등록 중...";
  }

  try {
    const campaign = _selectedCampaign;
    try {
      await fnSubmitReviewComment({
        campaignId: campaign.id,
        reviewUrl,
        reviewText
      });
    } catch (cfErr) {
      console.warn("fnSubmitReviewComment fallback to client transaction:", cfErr);
      await fallbackSubmitReviewComment(campaign, reviewUrl, reviewText);
    }

    alert("✅ 구글 리뷰 URL 댓글이 등록되었습니다!\n관리자가 구글 리뷰를 확인한 후 바우쳐 1장을 회원님의 쿠폰함으로 이체해 드립니다. (1계정 1회 참여)");
    if (inpUrl) inpUrl.value = "";
    if (inpText) inpText.value = "";
    await loadAndRenderReviewComments(campaign);
  } catch (err) {
    console.error("Submit review comment error:", err);
    alert("참여 실패: " + (err.message || "오류가 발생했습니다."));
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = "✍️ 구글 리뷰 URL 등록하고 바우쳐 신청하기 (1계정 1회)";
    }
  }
}

async function fallbackSubmitReviewComment(campaign, reviewUrl, reviewText) {
  const uid = _currentUser.uid;
  const commentId = `${campaign.id}_${uid}`;
  const commentRef = doc(db, "coupon_review_comments", commentId);
  const campRef = doc(db, "coupon_campaigns", campaign.id);
  const ucRef = doc(db, "user_coupons", `UC_REV_${campaign.id}_${uid}`);

  return await runTransaction(db, async (tx) => {
    const [campSnap, cmtSnap, ucSnap] = await Promise.all([
      tx.get(campRef),
      tx.get(commentRef),
      tx.get(ucRef)
    ]);

    if (!campSnap.exists()) throw new Error("존재하지 않는 이벤트 캠페인입니다.");
    const cData = campSnap.data() || {};
    if (cData.status !== "active") throw new Error("현재 진행 중인 이벤트가 아닙니다.");

    const totalQty = Number(cData.totalQuantity || 0);
    const issuedQty = Number(cData.issuedQuantity || 0);
    if (totalQty > 0 && issuedQty >= totalQty) {
      throw new Error("준비된 바우쳐 수량이 모두 소진되었습니다.");
    }

    if (ucSnap.exists()) {
      throw new Error("이미 본 이벤트 바우쳐를 지급받으셨습니다. (1계정 1회 참여 가능)");
    }

    if (cmtSnap.exists()) {
      const ex = cmtSnap.data() || {};
      if (ex.status === "approved") {
        throw new Error("이미 리뷰 인증이 완료되어 바우쳐가 지급되었습니다. (1계정 1회 참여 가능)");
      }
      if (ex.status === "pending") {
        throw new Error("이미 구글 리뷰 URL을 등록하셨습니다. 관리자 확인 대기 중입니다. (1계정 1회 참여 가능)");
      }
    }

    const userEmail = _currentUser.email || "";
    const userName = _userData?.name || _userData?.displayName || (userEmail ? userEmail.split("@")[0] : "회원");

    tx.set(commentRef, {
      commentId,
      campaignId: campaign.id,
      campaignTitle: cData.title || campaign.title || "",
      issuerId: cData.issuerId || campaign.issuerId || "",
      userId: uid,
      userEmail,
      userName,
      reviewUrl,
      reviewText: reviewText.slice(0, 200),
      status: "pending",
      issuedCouponCode: null,
      issuedUserCouponId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { success: true, commentId };
  });
}

/**
 * 3-D. 관리자의 구글 리뷰 확인 및 바우쳐 1장 즉시 이체
 */
async function handleApproveReviewAndTransferVoucher(commentId, btnEl) {
  if (!_selectedCampaign || !_currentUser) return;
  const campaign = _selectedCampaign;
  if (!canManageCampaign(campaign)) {
    alert("수퍼 어드민 또는 해당 이벤트 발행 가맹점주만 바우쳐를 이체할 수 있습니다.");
    return;
  }

  const cmt = _currentReviewComments.find((item) => item.id === commentId);
  if (!cmt) return;

  const ok = confirm(
    `🎁 [구글 리뷰 확인 및 바우쳐 1장 이체]\n\n` +
    `• 신청 회원: ${cmt.userName || "회원"} (${cmt.userEmail || cmt.userId})\n` +
    `• 구글 리뷰 URL: ${cmt.reviewUrl}\n` +
    `• 지급 바우쳐: ${campaign.title} (${campaign.discountValue})\n\n` +
    `구글 리뷰 작성을 확인하셨나요?\n[확인]을 누르면 해당 회원에게 바우쳐 1장이 즉시 이체됩니다. (1계정 1회 한정)`
  );
  if (!ok) return;

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "⏳ 바우쳐 1장 이체 중...";
  }

  try {
    let resData = null;
    try {
      const res = await fnApproveReviewVoucher({
        campaignId: campaign.id,
        commentId: cmt.id
      });
      resData = res.data;
    } catch (cfErr) {
      console.warn("fnApproveReviewVoucher fallback to client transaction:", cfErr);
      resData = await fallbackApproveReviewVoucher(campaign, cmt);
    }

    campaign.issuedQuantity = Number(campaign.issuedQuantity || 0) + 1;
    const remainingQty = Math.max(0, Number(campaign.totalQuantity || 0) - Number(campaign.issuedQuantity || 0));
    if ($("detailStock")) {
      $("detailStock").textContent = `${remainingQty.toLocaleString()}장 남음 (총 ${Number(campaign.totalQuantity || 0).toLocaleString()}장)`;
    }

    alert(
      `🎉 바우쳐 1장 이체가 완료되었습니다!\n\n` +
      `• 수령 회원: ${cmt.userName || "회원"} (${cmt.userEmail || ""})\n` +
      `• 발급 바우쳐 코드: ${resData?.couponCode || "발급완료"}\n\n` +
      `회원의 [마이페이지 > 내 쿠폰·바우쳐]로 즉시 지급되었습니다.`
    );

    renderCampaignGrid();
    await loadAndRenderReviewComments(campaign);
  } catch (err) {
    console.error("Approve review voucher error:", err);
    alert("바우쳐 이체 실패: " + (err.message || "오류가 발생했습니다."));
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "🎁 구글리뷰 확인완료 · 바우쳐 1장 즉시 이체";
    }
  }
}

async function fallbackApproveReviewVoucher(campaign, cmt) {
  const adminUid = _currentUser.uid;
  const campRef = doc(db, "coupon_campaigns", campaign.id);
  const commentRef = doc(db, "coupon_review_comments", cmt.id);
  const deterministicCouponId = `UC_REV_${campaign.id}_${cmt.userId}`;
  const userCouponRef = doc(db, "user_coupons", deterministicCouponId);

  return await runTransaction(db, async (tx) => {
    const [campSnap, cmtSnap, ucSnap] = await Promise.all([
      tx.get(campRef),
      tx.get(commentRef),
      tx.get(userCouponRef)
    ]);

    if (!campSnap.exists()) throw new Error("캠페인 정보를 찾을 수 없습니다.");
    if (!cmtSnap.exists()) throw new Error("리뷰 댓글 정보를 찾을 수 없습니다.");

    const cData = campSnap.data() || {};
    const cmtData = cmtSnap.data() || {};

    if (cmtData.status === "approved") {
      throw new Error(`이미 바우쳐 1장이 이체 완료된 참여건입니다. (코드: ${cmtData.issuedCouponCode || "-"})`);
    }

    if (ucSnap.exists()) {
      throw new Error("해당 회원은 이미 본 이벤트 바우쳐를 지급받았습니다. (1계정 1회 참여 제한)");
    }

    const totalQty = Number(cData.totalQuantity || 0);
    const issuedQty = Number(cData.issuedQuantity || 0);
    if (totalQty > 0 && issuedQty >= totalQty) {
      throw new Error("캠페인의 남은 발행 가능 수량이 없습니다.");
    }

    const code =
      "BC-" +
      Math.random().toString(36).substring(2, 6).toUpperCase() +
      "-" +
      Math.random().toString(36).substring(2, 6).toUpperCase() +
      "-" +
      Math.random().toString(36).substring(2, 6).toUpperCase();

    tx.set(userCouponRef, {
      userCouponId: deterministicCouponId,
      campaignId: campaign.id,
      userId: cmtData.userId,
      uid: cmtData.userId,
      userEmail: cmtData.userEmail || "",
      campaignType: cData.campaignType || "VOUCHER",
      title: cData.title,
      description: cData.description || "",
      imageUrl: cData.imageUrl || "",
      issuerType: cData.issuerType || "MERCHANT",
      issuerId: cData.issuerId || "platform",
      issuerNameSnapshot: cData.issuerNameSnapshot || "가맹점",
      issuerBadge: cData.issuerBadge || "VERIFIED MERCHANT",
      applicableMerchantIds: cData.applicableMerchantIds || ["all"],
      discountType: cData.discountType || "ITEM_EXCHANGE",
      discountValue: cData.discountValue || "바우쳐 1매",
      usageMode: cData.usageMode || "BOTH",
      terms: cData.terms || "",
      couponCode: code,
      purchasePriceBM: 0,
      issuedVia: "GOOGLE_REVIEW_ADMIN_TRANSFER",
      reviewUrl: cmtData.reviewUrl || "",
      approvedBy: adminUid,
      issuedAt: serverTimestamp(),
      validStartsAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 365 * 86400000),
      status: "available",
      redeemedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    tx.update(campRef, {
      issuedQuantity: increment(1),
      updatedAt: serverTimestamp()
    });

    tx.update(commentRef, {
      status: "approved",
      issuedCouponCode: code,
      issuedUserCouponId: deterministicCouponId,
      approvedBy: adminUid,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { success: true, couponCode: code, userCouponId: deterministicCouponId };
  });
}

/**
 * 3-E. 구글 리뷰 댓글 반려/삭제
 */
async function handleDeleteReviewComment(commentId) {
  if (!_selectedCampaign || !_currentUser) return;
  const campaign = _selectedCampaign;
  const cmt = _currentReviewComments.find((item) => item.id === commentId);
  if (!cmt) return;

  if (cmt.status === "approved") {
    alert("이미 바우쳐가 이체 완료된 댓글은 삭제할 수 없습니다.");
    return;
  }

  const ok = confirm("해당 구글 리뷰 참여 댓글을 삭제(반려)하시겠습니까?\n삭제 시 회원이 올바른 URL로 다시 등록할 수 있습니다.");
  if (!ok) return;

  try {
    try {
      await fnDeleteReviewComment({ campaignId: campaign.id, commentId: cmt.id });
    } catch (cfErr) {
      console.warn("fnDeleteReviewComment fallback to deleteDoc:", cfErr);
      await deleteDoc(doc(db, "coupon_review_comments", cmt.id));
    }
    await loadAndRenderReviewComments(campaign);
  } catch (err) {
    console.error("Delete review comment error:", err);
    alert("삭제 실패: " + (err.message || "오류가 발생했습니다."));
  }
}

/**
 * 4. 쿠폰 구매 또는 무료 발급 실행
 */
async function executePurchaseOrIssue(campaign) {
  if (!_currentUser) {
    alert("로그인이 필요합니다. 로그인 후 이용해 주세요.");
    return;
  }

  const price = Number(campaign.priceBM || 0);
  const isFree = price === 0;

  if (!isFree) {
    const curBalance = Number(_userData?.pointBalanceVnd || 0);
    if (curBalance < price) {
      alert(`BM 잔액이 부족합니다.\n보유 BM: ${curBalance.toLocaleString()} BM\n필요 BM: ${price.toLocaleString()} BM`);
      return;
    }
    const ok = confirm(`[${campaign.title}]\n구매 금액: ${price.toLocaleString()} BM\n\n결제를 진행하시겠습니까?`);
    if (!ok) return;
  }

  const btnBuy = $("btnActionBuy");
  if (btnBuy) {
    btnBuy.disabled = true;
    btnBuy.textContent = "⏳ 처리 중입니다...";
  }

  try {
    const reqId = String(Date.now());
    let resData = null;

    // 1차: Cloud Function httpsCallable 시도
    try {
      const res = await fnPurchaseOrIssue({ campaignId: campaign.id, reqId });
      resData = res.data;
    } catch (cfErr) {
      console.warn("Callable CF not reached, performing client Firestore transaction fallback:", cfErr);
      // 2차: Firestore 클라이언트 트랜잭션 Fallback
      resData = await fallbackClientPurchase(campaign, reqId);
    }

    alert(`🎉 [${campaign.title}] 발급이 성공적으로 완료되었습니다!\n마이페이지(내 쿠폰·바우쳐)에서 확인하실 수 있습니다.`);
    closeDetailModal();

    // 잔액 및 수량 갱신
    if (_userData && !isFree) {
      _userData.pointBalanceVnd = Math.max(0, Number(_userData.pointBalanceVnd || 0) - price);
      updateUserBalanceDisplay();
    }
    campaign.issuedQuantity = Number(campaign.issuedQuantity || 0) + 1;
    renderCampaignGrid();

    // 마이페이지 이동 권유
    if (confirm("마이페이지로 이동하여 보유 쿠폰 QR 코드를 확인하시겠습니까?")) {
      window.location.href = "/mypage.html#couponsSection";
    }
  } catch (err) {
    console.error("Purchase error:", err);
    alert("발급 실패: " + (err.message || "오류가 발생했습니다."));
  } finally {
    if (btnBuy) {
      btnBuy.disabled = false;
      btnBuy.textContent = isFree ? "🎁 무료로 즉시 발급받기" : `💎 ${price.toLocaleString()} BM으로 구매하기`;
    }
  }
}

/**
 * 로컬 클라이언트 트랜잭션 Fallback (에뮬레이터/오프라인 환경 보장)
 */
async function fallbackClientPurchase(campaign, reqId) {
  const uid = _currentUser.uid;
  const price = Number(campaign.priceBM || 0);

  return await runTransaction(db, async (tx) => {
    const campRef = doc(db, "coupon_campaigns", campaign.id);
    const userRef = doc(db, "users", uid);
    const txRef = doc(db, "transactions", `TX_CPN_${reqId}`);

    const [cSnap, uSnap] = await Promise.all([tx.get(campRef), tx.get(userRef)]);
    if (!cSnap.exists()) throw new Error("캠페인 정보 없음");
    const cData = cSnap.data();

    if (price > 0) {
      const uBal = Number(uSnap.data()?.pointBalanceVnd || 0);
      if (uBal < price) throw new Error("잔액 부족");
      tx.update(userRef, {
        pointBalanceVnd: increment(-price),
        updatedAt: serverTimestamp()
      });
      tx.set(txRef, {
        userId: uid,
        type: "COUPON_PURCHASE",
        campaignId: campaign.id,
        amountVnd: -price,
        currency: "VND",
        status: "completed",
        description: `[쿠폰] ${cData.title} 구매`,
        createdAt: serverTimestamp()
      });
    }

    tx.update(campRef, {
      issuedQuantity: increment(1),
      updatedAt: serverTimestamp()
    });

    const userCouponRef = doc(collection(db, "user_coupons"));
    const code = "BC-" + Math.random().toString(36).substring(2, 6).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();

    tx.set(userCouponRef, {
      userCouponId: userCouponRef.id,
      campaignId: campaign.id,
      userId: uid,
      userEmail: _currentUser.email || "",
      campaignType: cData.campaignType || "COUPON",
      title: cData.title,
      description: cData.description || "",
      imageUrl: cData.imageUrl || "",
      issuerNameSnapshot: cData.issuerNameSnapshot || "가맹점",
      issuerBadge: cData.issuerBadge || "VERIFIED MERCHANT",
      applicableMerchantIds: cData.applicableMerchantIds || ["all"],
      discountType: cData.discountType || "PERCENT",
      discountValue: cData.discountValue || "10%",
      usageMode: cData.usageMode || "BOTH",
      terms: cData.terms || "",
      couponCode: code,
      purchasePriceBM: price,
      issuedAt: serverTimestamp(),
      validStartsAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 365 * 86400000),
      status: "available",
      redeemedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { success: true, couponCode: code };
  });
}

/**
 * 5. 신규 쿠폰·바우쳐 발행 폼 제출 (수퍼 어드민 & 가맹점주)
 */
function syncCreateIssueMethodUI() {
  const sel = $("inpIssueMethod");
  if (!sel) return;
  const isGoogleReview = sel.value === "GOOGLE_REVIEW";
  const urlGroup = $("createGoogleReviewUrlGroup");
  if (urlGroup) urlGroup.style.display = isGoogleReview ? "block" : "none";

  const priceInp = $("inpPriceBM");
  const maxInp = $("inpMaxPerUser");
  const typeSel = $("inpCampType");
  if (isGoogleReview) {
    if (typeSel) typeSel.value = "VOUCHER";
    if (priceInp) {
      priceInp.value = 0;
      priceInp.readOnly = true;
    }
    if (maxInp) {
      maxInp.value = 1;
      maxInp.readOnly = true;
    }
  } else {
    if (priceInp) priceInp.readOnly = false;
    if (maxInp) maxInp.readOnly = false;
  }
}

function syncEditIssueMethodUI() {
  const sel = $("editIssueMethod");
  if (!sel) return;
  const isGoogleReview = sel.value === "GOOGLE_REVIEW";
  const urlGroup = $("editGoogleReviewUrlGroup");
  if (urlGroup) urlGroup.style.display = isGoogleReview ? "block" : "none";

  const priceInp = $("editPriceBM");
  const maxInp = $("editMaxPerUser");
  if (isGoogleReview) {
    if (priceInp) {
      priceInp.value = 0;
      priceInp.readOnly = true;
    }
    if (maxInp) {
      maxInp.value = 1;
      maxInp.readOnly = true;
    }
  } else {
    if (priceInp) priceInp.readOnly = false;
    if (maxInp) maxInp.readOnly = false;
  }
}

async function handleCreateFormSubmit(e) {
  e.preventDefault();
  if (!_currentUser) return;

  const btnSubmit = $("btnSubmitCreate");
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span>⏳</span> 등록 및 발행 중...`;

  try {
    const selIssuer = $("inpIssuerSelect");
    const opt = selIssuer.options[selIssuer.selectedIndex];
    const issuerBadge = $("inpIssuerBadge").value.trim() || opt.dataset.badge || "VERIFIED MERCHANT";
    const issueMethod = $("inpIssueMethod") ? $("inpIssueMethod").value : "DIRECT";
    const isGoogleReview = issueMethod === "GOOGLE_REVIEW";
    const googleReviewTargetUrl = $("inpGoogleReviewTargetUrl") ? $("inpGoogleReviewTargetUrl").value.trim() : "";

    const payload = {
      campaignType: $("inpCampType").value,
      issueMethod,
      googleReviewTargetUrl,
      issuerId: selIssuer.value,
      issuerNameSnapshot: opt.textContent.split(" (")[0],
      issuerBadge,
      title: $("inpTitle").value.trim(),
      description: $("inpDescription").value.trim(),
      imageUrl: $("inpImageUrl").value.trim() || "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80",
      priceBM: isGoogleReview ? 0 : Number($("inpPriceBM").value || 0),
      discountValue: $("inpDiscountValue").value.trim(),
      totalQuantity: Number($("inpTotalQty").value || 100),
      maxPerUser: isGoogleReview ? 1 : Number($("inpMaxPerUser").value || 1),
      usageMode: $("inpUsageMode").value,
      terms: $("inpTerms").value.trim(),
      applicableMerchantIds: selIssuer.value === "platform" ? ["all"] : expandMerchantAliases(selIssuer.value)
    };

    // 1차: Callable Function
    try {
      await fnCreateCampaign(payload);
    } catch (cfErr) {
      console.warn("Callable CF error, using direct Firestore creation:", cfErr);
      const newRef = doc(collection(db, "coupon_campaigns"));
      await addDoc(collection(db, "coupon_campaigns"), {
        ...payload,
        campaignId: newRef.id,
        issuedQuantity: 0,
        redeemedQuantity: 0,
        status: "active",
        createdBy: _currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    alert("🎉 신규 이벤트 쿠폰/바우쳐가 성공적으로 등록 및 발행되었습니다!");
    closeCreateModal();
    $("createCouponForm").reset();
    syncCreateIssueMethodUI();
    await loadCampaigns();
  } catch (err) {
    console.error("Create campaign error:", err);
    alert("발행 실패: " + (err.message || "오류가 발생했습니다."));
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<span>🚀</span> 쿠폰·바우쳐 등록 및 발행 시작`;
  }
}

function openCreateModal() {
  const modal = $("createCouponModal");
  if (!modal) return;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  syncCreateIssueMethodUI();

  // 가맹점 점주인 경우 본인 가맹점 명의로 자동 고정 및 타 가맹점/수퍼어드민 선택 불가
  if (!_isSuperAdmin && _myMerchantId) {
    const sel = $("inpIssuerSelect");
    if (sel) {
      sel.value = _myMerchantId;
      sel.disabled = true;
      const opt = sel.options[sel.selectedIndex];
      if (opt && opt.dataset.badge) {
        $("inpIssuerBadge").value = opt.dataset.badge;
      }
    }
    const badgeInp = $("inpIssuerBadge");
    if (badgeInp) {
      badgeInp.readOnly = true;
    }
  } else if (_isSuperAdmin) {
    const sel = $("inpIssuerSelect");
    if (sel) sel.disabled = false;
    const badgeInp = $("inpIssuerBadge");
    if (badgeInp) badgeInp.readOnly = false;
  }
}

function closeCreateModal() {
  const modal = $("createCouponModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

function updateUserBalanceDisplay() {
  const el = $("evUserBalance");
  if (el && _userData) {
    const bal = Number(_userData.pointBalanceVnd || 0);
    el.textContent = bal.toLocaleString();
  }
}

/**
 * 6. 쿠폰·바우쳐 수정 모달 제어 (수퍼 어드민 & 발행 가맹점주)
 */
function openEditModal(campaignId) {
  const c = _allCampaigns.find((item) => item.id === campaignId);
  if (!c) return;
  if (!canManageCampaign(c)) {
    alert("수정 권한이 없습니다.");
    return;
  }

  const modal = $("editCouponModal");
  if (!modal) return;

  $("editCampaignId").value = c.id;
  if ($("editIssueMethod")) $("editIssueMethod").value = c.issueMethod || "DIRECT";
  if ($("editGoogleReviewTargetUrl")) $("editGoogleReviewTargetUrl").value = c.googleReviewTargetUrl || "";
  $("editCampType").value = c.campaignType || "COUPON";
  $("editStatus").value = c.status || "active";
  if ($("editIssuerSelect")) {
    const normalizedIssuer = c.issuerId === "baekje_galbi" ? "1794710386" : (c.issuerId || "1791605366");
    $("editIssuerSelect").value = normalizedIssuer;
    $("editIssuerSelect").disabled = !_isSuperAdmin;
  }
  if ($("editIssuerBadge")) {
    $("editIssuerBadge").value = c.issuerBadge || "BEST WINNER";
    $("editIssuerBadge").readOnly = !_isSuperAdmin;
  }
  $("editTitle").value = c.title || "";
  $("editPriceBM").value = c.priceBM !== undefined ? c.priceBM : 0;
  $("editDiscountValue").value = c.discountValue || "";
  $("editTotalQty").value = c.totalQuantity || 100;
  $("editMaxPerUser").value = c.maxPerUser || 1;
  $("editUsageMode").value = c.usageMode || "BOTH";
  $("editImageUrl").value = c.imageUrl || "";
  $("editDescription").value = c.description || "";
  $("editTerms").value = c.terms || "";

  syncEditIssueMethodUI();

  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
}

function closeEditModal() {
  const modal = $("editCouponModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

/**
 * 7. 쿠폰·바우쳐 수정 폼 제출 (수퍼 어드민 & 발행 가맹점주)
 */
async function handleEditFormSubmit(e) {
  e.preventDefault();
  const campaignId = $("editCampaignId").value;
  if (!campaignId) return;

  const targetCamp = _allCampaigns.find((item) => item.id === campaignId);
  if (!_currentUser || !canManageCampaign(targetCamp)) {
    alert("수정 권한이 필요합니다.");
    return;
  }

  const btnSubmit = $("btnSubmitEdit");
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span>⏳</span> 저장 중...`;

  try {
    const selIssuer = $("editIssuerSelect");
    const opt = selIssuer.options[selIssuer.selectedIndex];
    const issuerBadge = $("editIssuerBadge").value.trim() || opt?.dataset.badge || "VERIFIED MERCHANT";
    const issueMethod = $("editIssueMethod") ? $("editIssueMethod").value : "DIRECT";
    const isGoogleReview = issueMethod === "GOOGLE_REVIEW";
    const googleReviewTargetUrl = $("editGoogleReviewTargetUrl") ? $("editGoogleReviewTargetUrl").value.trim() : "";

    const updates = {
      campaignType: $("editCampType").value,
      issueMethod,
      googleReviewTargetUrl,
      status: $("editStatus").value,
      issuerId: selIssuer.value,
      issuerNameSnapshot: opt ? opt.textContent.split(" (")[0] : "가맹점",
      issuerBadge,
      title: $("editTitle").value.trim(),
      description: $("editDescription").value.trim(),
      imageUrl: $("editImageUrl").value.trim() || "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80",
      priceBM: isGoogleReview ? 0 : Number($("editPriceBM").value || 0),
      discountValue: $("editDiscountValue").value.trim(),
      totalQuantity: Number($("editTotalQty").value || 100),
      maxPerUser: isGoogleReview ? 1 : Number($("editMaxPerUser").value || 1),
      usageMode: $("editUsageMode").value,
      terms: $("editTerms").value.trim(),
      applicableMerchantIds: selIssuer.value === "platform" ? ["all"] : expandMerchantAliases(selIssuer.value)
    };

    try {
      await fnUpdateCampaign({ campaignId, updates });
    } catch (cfErr) {
      console.warn("Callable CF error, using direct Firestore setDoc/updateDoc fallback:", cfErr);
      await setDoc(doc(db, "coupon_campaigns", campaignId), {
        ...updates,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    // 로컬 메모리 리스트 갱신
    const idx = _allCampaigns.findIndex((item) => item.id === campaignId);
    if (idx !== -1) {
      _allCampaigns[idx] = { ..._allCampaigns[idx], ...updates };
    }

    alert(`🎉 [${updates.title}] 쿠폰·바우쳐 정보가 성공적으로 수정되었습니다.`);
    closeEditModal();
    closeDetailModal();
    await loadCampaigns();
  } catch (err) {
    console.error("Update campaign error:", err);
    alert("수정 실패: " + (err.message || "오류가 발생했습니다."));
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<span>💾</span> 수정 내용 저장`;
  }
}

/**
 * 8. 비활성화 / 활성화 토글 (수퍼 어드민 & 발행 가맹점주)
 */
async function handleToggleStatus(campaignId, currentStatus) {
  const c = _allCampaigns.find((item) => item.id === campaignId);
  if (!_currentUser || !canManageCampaign(c)) {
    alert("관리 권한이 필요합니다.");
    return;
  }

  const cTitle = c ? c.title : campaignId;
  const newStatus = currentStatus === "paused" ? "active" : "paused";

  const confirmMsg = newStatus === "paused"
    ? `[${cTitle}]\n해당 쿠폰·바우쳐를 비활성화하시겠습니까?\n\n비활성화 시 일반 회원은 더 이상 구매하거나 발급받을 수 없습니다.`
    : `[${cTitle}]\n해당 쿠폰·바우쳐를 다시 활성화하시겠습니까?\n\n활성화 시 정상적으로 발행 및 구매가 가능해집니다.`;

  if (!confirm(confirmMsg)) return;

  try {
    try {
      await fnToggleStatus({ campaignId, status: newStatus });
    } catch (cfErr) {
      console.warn("Callable CF error, using direct Firestore fallback:", cfErr);
      await setDoc(doc(db, "coupon_campaigns", campaignId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    if (c) c.status = newStatus;
    const statusText = newStatus === "paused" ? "⏸️ 비활성화" : "🟢 활성화";
    alert(`[${cTitle}] 상태가 '${statusText}'(으)로 변경되었습니다.`);

    renderCampaignGrid();
    if (_selectedCampaign && _selectedCampaign.id === campaignId) {
      openDetailModal(campaignId);
    }
  } catch (err) {
    console.error("Toggle status error:", err);
    alert("상태 변경 실패: " + (err.message || "오류가 발생했습니다."));
  }
}

/**
 * 9. 쿠폰·바우쳐 영구 삭제 (수퍼 어드민 & 발행 가맹점주)
 */
async function handleDeleteCampaign(campaignId) {
  const c = _allCampaigns.find((item) => item.id === campaignId);
  if (!_currentUser || !canManageCampaign(c)) {
    alert("삭제 권한이 필요합니다.");
    return;
  }

  const cTitle = c ? c.title : campaignId;

  const ok = confirm(`⚠️ 경고: 정말로 [${cTitle}] 쿠폰·바우쳐를 삭제하시겠습니까?\n\n삭제된 쿠폰은 플랫폼에서 완전히 제거되며 복구할 수 없습니다.`);
  if (!ok) return;

  try {
    try {
      await fnDeleteCampaign({ campaignId });
    } catch (cfErr) {
      console.warn("Callable CF error, using direct Firestore deleteDoc fallback:", cfErr);
      await deleteDoc(doc(db, "coupon_campaigns", campaignId));
    }

    _allCampaigns = _allCampaigns.filter((item) => item.id !== campaignId);
    alert(`🗑️ [${cTitle}] 쿠폰·바우쳐가 정상적으로 삭제되었습니다.`);
    closeDetailModal();
    renderCampaignGrid();
    await loadCampaigns();
  } catch (err) {
    console.error("Delete campaign error:", err);
    alert("삭제 실패: " + (err.message || "오류가 발생했습니다."));
  }
}

/**
 * 이벤트 리스너 바인딩
 */
function initEvents() {
  // 필터 탭
  const tabWrap = $("filterTabs");
  if (tabWrap) {
    tabWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".ev-tab");
      if (!btn) return;
      tabWrap.querySelectorAll(".ev-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (btn.dataset.type) {
        _activeTypeFilter = btn.dataset.type;
        _activePriceFilter = "all";
      } else if (btn.dataset.price) {
        _activePriceFilter = btn.dataset.price;
        _activeTypeFilter = "all";
      }
      renderCampaignGrid();
    });
  }

  // 가맹점 드롭다운 필터
  const merchSelect = $("filterMerchantSelect");
  if (merchSelect) {
    merchSelect.onchange = () => {
      _activeMerchantFilter = merchSelect.value;
      renderCampaignGrid();
    };
  }

  // 카드 클릭 (상세보기, 구매, 또는 어드민 액션)
  const grid = $("couponGrid");
  if (grid) {
    grid.addEventListener("click", (e) => {
      const btnAct = e.target.closest("[data-act]");
      if (btnAct) {
        const id = btnAct.dataset.id;
        if (btnAct.dataset.act === "view") {
          openDetailModal(id);
        } else if (btnAct.dataset.act === "buy") {
          const c = _allCampaigns.find((item) => item.id === id);
          if (c) executePurchaseOrIssue(c);
        } else if (btnAct.dataset.act === "admin-edit") {
          e.stopPropagation();
          openEditModal(id);
        } else if (btnAct.dataset.act === "admin-toggle") {
          e.stopPropagation();
          handleToggleStatus(id, btnAct.dataset.status);
        } else if (btnAct.dataset.act === "admin-del") {
          e.stopPropagation();
          handleDeleteCampaign(id);
        }
        return;
      }
      const card = e.target.closest(".ev-card");
      if (card && card.dataset.id) {
        openDetailModal(card.dataset.id);
      }
    });
  }

  // 모달 닫기
  const btnCloseDetail = $("btnDetailClose");
  if (btnCloseDetail) btnCloseDetail.onclick = closeDetailModal;

  const btnCloseCreate = $("btnCreateClose");
  if (btnCloseCreate) btnCloseCreate.onclick = closeCreateModal;

  const btnEditClose = $("btnEditClose");
  if (btnEditClose) btnEditClose.onclick = closeEditModal;

  const btnCancelEdit = $("btnCancelEdit");
  if (btnCancelEdit) btnCancelEdit.onclick = closeEditModal;

  // 상세 모달 내 관리자 제어판 버튼
  const btnAdminEditModal = $("btnAdminEditModal");
  if (btnAdminEditModal) {
    btnAdminEditModal.onclick = () => {
      if (_selectedCampaign) openEditModal(_selectedCampaign.id);
    };
  }
  const btnAdminToggleStatus = $("btnAdminToggleStatus");
  if (btnAdminToggleStatus) {
    btnAdminToggleStatus.onclick = () => {
      if (_selectedCampaign) handleToggleStatus(_selectedCampaign.id, _selectedCampaign.status);
    };
  }
  const btnAdminDeleteCampaign = $("btnAdminDeleteCampaign");
  if (btnAdminDeleteCampaign) {
    btnAdminDeleteCampaign.onclick = () => {
      if (_selectedCampaign) handleDeleteCampaign(_selectedCampaign.id);
    };
  }

  // 발행 모달 열기 버튼
  const btnOpenCreate = $("btnOpenCreateModal");
  if (btnOpenCreate) btnOpenCreate.onclick = openCreateModal;

  // 발급 방식 변경 시 UI 동기화 (발행/수정 모달)
  const selCreateIssueMethod = $("inpIssueMethod");
  if (selCreateIssueMethod) {
    selCreateIssueMethod.onchange = syncCreateIssueMethodUI;
  }
  const selEditIssueMethod = $("editIssueMethod");
  if (selEditIssueMethod) {
    selEditIssueMethod.onchange = syncEditIssueMethodUI;
  }

  // 가맹점 선택 시 뱃지 자동 변경 (발행용)
  const selIssuer = $("inpIssuerSelect");
  if (selIssuer) {
    selIssuer.onchange = () => {
      const opt = selIssuer.options[selIssuer.selectedIndex];
      if (opt && opt.dataset.badge) {
        $("inpIssuerBadge").value = opt.dataset.badge;
      }
    };
  }

  // 가맹점 선택 시 뱃지 자동 변경 (수정용)
  const selEditIssuer = $("editIssuerSelect");
  if (selEditIssuer) {
    selEditIssuer.onchange = () => {
      const opt = selEditIssuer.options[selEditIssuer.selectedIndex];
      if (opt && opt.dataset.badge) {
        $("editIssuerBadge").value = opt.dataset.badge;
      }
    };
  }

  // 발행 폼 제출
  const createForm = $("createCouponForm");
  if (createForm) createForm.onsubmit = handleCreateFormSubmit;

  // 수정 폼 제출
  const editForm = $("editCouponForm");
  if (editForm) editForm.onsubmit = handleEditFormSubmit;

  // ⭐ 구글 리뷰 URL 댓글 등록 폼 제출
  const reviewForm = $("reviewCommentForm");
  if (reviewForm) {
    reviewForm.onsubmit = handleReviewCommentSubmit;
  }

  // ⭐ 구글 리뷰 댓글 목록 내 관리자 [바우쳐 1장 이체] 및 [삭제] 클릭 위임
  const reviewList = $("reviewCommentList");
  if (reviewList) {
    reviewList.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-review-act]");
      if (!btn) return;
      const act = btn.dataset.reviewAct;
      const commentId = btn.dataset.commentId;
      if (!commentId) return;
      if (act === "approve") {
        handleApproveReviewAndTransferVoucher(commentId, btn);
      } else if (act === "delete") {
        handleDeleteReviewComment(commentId);
      }
    });
  }

  // 바깥 배경 클릭 모달 닫기
  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("ev-modal")) {
      closeDetailModal();
      closeCreateModal();
      closeEditModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDetailModal();
      closeCreateModal();
      closeEditModal();
    }
  });
}

/**
 * 초기화 및 인증
 */
function boot() {
  initEvents();
  loadMerchantMasterList();
  loadCampaigns();

  onAuthReady(async ({ loggedIn, role, user, profile }) => {
    _currentUser = user;
    const authText = $("evAuthText");
    const btnOpenCreate = $("btnOpenCreateModal");

    if (!loggedIn || !user) {
      if (authText) {
        authText.innerHTML = `<span>🔒</span> <span>로그인하면 보유 BM으로 쿠폰을 구매하거나 무료로 발급받을 수 있습니다.</span>`;
      }
      return;
    }

    try {
      const uSnap = await getDoc(doc(db, "users", user.uid));
      if (uSnap.exists()) {
        _userData = uSnap.data();
        _myMerchantId = _userData.merchantId ? String(_userData.merchantId) : null;
      }
    } catch (_) {}

    _isSuperAdmin = await checkSuperAdmin(user);

    updateUserBalanceDisplay();

    // 수퍼 어드민 권한 확정 시 카드 그리드 및 모달 제어판 즉시 반영
    renderCampaignGrid();

    // 발행 권한 확인 (수퍼 어드민 또는 가맹점 점주)
    if (_isSuperAdmin || _myMerchantId) {
      if (btnOpenCreate) btnOpenCreate.style.display = "inline-flex";
      if (authText) {
        if (_isSuperAdmin) {
          authText.innerHTML = `<span style="color:#7c3aed;">🛡️</span> <b>${user.email}</b> (최고 관리자: SUPER ADMIN) | <span style="color:#059669; font-weight:700;">전체 플랫폼 쿠폰·바우쳐 수정/비활성화/삭제/발행 권한 활성화</span>`;
        } else {
          const mName = _myMerchantId === "1791605366" ? "BEST WINNER" : ((_myMerchantId === "baekje_galbi" || _myMerchantId === "1794710386") ? "백제갈비" : (_userData?.merchantName || _userData?.name || "가맹점"));
          authText.innerHTML = `<span style="color:#059669;">🏪</span> <b>${user.email}</b> (공식 가맹점: <b>${mName}</b>) | <span style="color:#059669; font-weight:700;">가맹점 쿠폰·바우쳐 발행 권한 활성화</span>`;
        }
      }

      // 가맹점주인 경우 가맹점 선택 기본값 고정
      if (!_isSuperAdmin && _myMerchantId && $("inpIssuerSelect")) {
        $("inpIssuerSelect").value = _myMerchantId;
        $("inpIssuerSelect").disabled = true;
      }
    } else {
      if (authText) {
        authText.innerHTML = `<span>👋</span> <b>${user.email}</b> 회원님 환영합니다!`;
      }
    }
  });
}


if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
