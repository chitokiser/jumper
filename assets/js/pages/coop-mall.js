import { app } from "../firebase-init.js";
import { getFirestore, collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthReady } from "../auth.js";

const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentViewer = null;
let cart = []; // 장바구니 아이템 담는 배열
let rawProducts = [];
let selectedMerchantFilter = "all";
let selectedChannelFilter = "all";
let selectedDealMode = "all"; // 'all' | 'deals_only' | 'team_recruit' | 'weekly_cycle'
let selectedRegionFilter = "all";
let countdownTimerId = null;

// 판매 채널: BestERP 상품의 sales_channel ('in_store' 매장 전용 · 'online' 온라인 전용 · 'both' 둘 다)
// 값이 없는 예전 상품은 'both' 로 본다
const SALES_CHANNEL = {
  in_store: { label: "🏬 매장 전용", color: "#9a3412", bg: "#ffedd5", border: "#fdba74" },
  online: { label: "📦 온라인 전용", color: "#1e40af", bg: "#dbeafe", border: "#93c5fd" },
  both: { label: "🏬+🌐 매장·온라인", color: "#166534", bg: "#dcfce7", border: "#86efac" },
};
// 매장에서만 파는 가맹점: 상품 설정과 관계없이 모든 상품을 매장 전용으로 본다 (백제갈비, 2026-11-19)
const IN_STORE_ONLY_MERCHANTS = new Set(["1794710386", "baekje_galbi"]);
function isInStoreOnlyMerchant(merchantId) {
  return IN_STORE_ONLY_MERCHANTS.has(String(merchantId || "").trim());
}
function salesChannelOf(data) {
  if (isInStoreOnlyMerchant(data?.merchant_id)) return "in_store";
  const v = String(data?.sales_channel || "").trim();
  return SALES_CHANNEL[v] ? v : "both";
}
function matchesChannel(channel, filter) {
  if (filter === "all") return true;
  if (filter === "online_ok") return channel !== "in_store";
  return channel === filter;
}

// ───────────── 🔥 공동구매(Group Buy) & 타임딜(Flash Deal) 정규화 헬퍼 ─────────────
// Firestore 문서의 group_buy 객체 또는 최상위 group_buy_* 필드를 정규화하고,
// 아직 공구 설정이 없는 대표 가맹점(대한김치 등) 주요 상품에도 스마트 프리셋을 지원해 즉시 시연·구매 가능하게 한다.
function getNextWeeklyCutoffIso(cutoffDay = 4, cutoffHour = 18) {
  const now = new Date();
  const target = new Date(now);
  const currentDay = now.getDay(); // 0(일) ~ 6(토)
  let daysUntil = (cutoffDay - currentDay + 7) % 7;
  target.setDate(now.getDate() + daysUntil);
  target.setHours(cutoffHour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 7);
  }
  return target.toISOString();
}

function resolveGroupBuyConfig(docId, data) {
  const gb = (data && typeof data.group_buy === "object" && data.group_buy !== null) ? data.group_buy : {};
  const enabledExplicit = gb.enabled === true || data?.group_buy_enabled === true;

  // 관리자/가맹점이 실제로 공동구매·타임딜을 켠 상품만 공동구매로 적용
  if (!enabledExplicit) {
    return { enabled: false };
  }

  const dealPrice = Number(gb.deal_price || data.group_buy_price || data.price || 0);
  const basePrice = Number(gb.original_price || data.original_price || dealPrice);
  const discountRate = basePrice > dealPrice && basePrice > 0
    ? Math.round(((basePrice - dealPrice) / basePrice) * 100)
    : 0;
  const mode = gb.mode || data.group_buy_mode || "team_recruit"; // 'team_recruit' | 'weekly_cycle'
  const targetCount = Math.max(2, Number(gb.target_count || data.group_buy_target || 10));
  const currentCount = Math.max(0, Number(gb.current_count ?? data.group_buy_current ?? 0));
  const bonusBm = Math.max(0, Number(gb.bonus_bm ?? data.group_buy_bonus_bm ?? 0));
  const region = String(gb.region || data.group_buy_region || "미딩·하동·서호 전지역");
  const deadlineIso = gb.deadline_iso || data.group_buy_deadline || getNextWeeklyCutoffIso(4, 18);
  const deliveryNote = String(
    gb.delivery_note ||
    (mode === "weekly_cycle"
      ? "매주 목요일 18시 마감 → 금요일 오전 일괄 배송"
      : "타임딜 주문 즉시 할인가 확정 · 목표 달성 시 BM 보너스 추가 적립")
  );

  return {
    enabled: true,
    mode,
    originalPrice: basePrice,
    dealPrice,
    discountRate,
    targetCount,
    currentCount,
    bonusBm,
    region,
    deadlineIso,
    deliveryNote,
  };
}

function formatRemainingTime(deadlineIso) {
  const end = new Date(deadlineIso).getTime();
  const now = Date.now();
  const diff = end - now;
  if (!Number.isFinite(end) || diff <= 0) {
    return { expired: true, text: "마감 임박 (연장 진행중)" };
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (days > 0) {
    return { expired: false, text: `D-${days}일 ${pad(hours)}:${pad(mins)}:${pad(secs)}` };
  }
  return { expired: false, text: `${pad(hours)}:${pad(mins)}:${pad(secs)} 남음` };
}

function startCountdownTicker() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  countdownTimerId = setInterval(() => {
    document.querySelectorAll("[data-countdown-until]").forEach((el) => {
      const iso = el.getAttribute("data-countdown-until");
      const r = formatRemainingTime(iso);
      el.textContent = `⏰ ${r.text}`;
    });
  }, 1000);
}

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
  setupGroupBuyFilterEvents();
  await loadMerchants();
  await loadProducts();
  startCountdownTicker();
});

function setupGroupBuyFilterEvents() {
  // 공구 모드 탭 전환
  document.querySelectorAll("#dealModeTabs .deal-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDealMode = btn.getAttribute("data-deal-mode") || "all";
      document.querySelectorAll("#dealModeTabs .deal-mode-btn").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.style.background = active ? "#f43f5e" : "transparent";
        b.style.color = active ? "#fff" : "#e2e8f0";
      });
      renderProductsList();
    });
  });

  // 하노이 권역 필터 전환
  document.querySelectorAll("#regionFilterBar .region-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRegionFilter = btn.getAttribute("data-region") || "all";
      document.querySelectorAll("#regionFilterBar .region-btn").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.style.background = active ? "rgba(255,255,255,0.18)" : "transparent";
        b.style.color = active ? "#fff" : "#cbd5e1";
        b.style.fontWeight = active ? "700" : "400";
      });
      renderProductsList();
    });
  });

  // 단톡방 공유 모달 닫기 및 복사
  $("btnCloseShareModal")?.addEventListener("click", () => {
    $("groupShareModal").style.display = "none";
  });
  $("btnCopyShareText")?.addEventListener("click", () => {
    const txt = $("sharePromoText")?.value || "";
    navigator.clipboard.writeText(txt).then(() => {
      alert("✅ 단톡방 공유 문구가 복사되었습니다!\n카카오톡·Zalo·텔레그램 교민 단톡방에 붙여넣기(Ctrl+V) 하세요.");
    }).catch(() => {
      $("sharePromoText")?.select();
      document.execCommand("copy");
      alert("✅ 단톡방 공유 문구가 복사되었습니다!");
    });
  });
}

function openViralShareModal(productItem, gb, merchantName) {
  const modal = $("groupShareModal");
  if (!modal) return;
  const remain = Math.max(0, gb.targetCount - gb.currentCount);
  const shareUrl = `${window.location.origin}/mall.html?deal=${encodeURIComponent(productItem.id)}`;
  const modeTitle = gb.mode === "weekly_cycle" ? "[하노이 주간 정기 공동구매]" : "[하노이 교민 뭉쳐야 산다 타임딜]";

  const promo = `${modeTitle} 🔥 ${merchantName} — ${productItem.data.product_name}
📍 배송/픽업 권역: ${gb.region}
💰 타임딜 즉시 할인가: ${gb.dealPrice.toLocaleString()} VND (${gb.discountRate}% 할인 확정!)
🎁 목표 ${gb.targetCount}명 달성 시 전원 +${gb.bonusBm.toLocaleString()} BM 추가 보너스!
👥 현재 ${gb.currentCount}/${gb.targetCount}명 참여 중 (${remain > 0 ? `보너스 달성까지 딱 ${remain}명 남음!` : `🎉 목표 달성 완료! 지금 참여해도 BM 보너스 100% 지급!`})
👉 공구 참여하기: ${shareUrl}`;

  if ($("sharePromoText")) $("sharePromoText").value = promo;
  if ($("btnTelegramShareLink")) {
    $("btnTelegramShareLink").href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(promo)}`;
  }
  modal.style.display = "flex";
}

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
    snap.forEach(d => {
      const data = d.data();
      const gb = resolveGroupBuyConfig(d.id, data);
      rawProducts.push({ id: d.id, data, gb });
    });

    // 공동구매/타임딜 활성 상품을 상단에 우선 노출하고 최신순 정렬
    rawProducts.sort((a, b) => {
      const gbA = a.gb?.enabled ? 1 : 0;
      const gbB = b.gb?.enabled ? 1 : 0;
      if (gbA !== gbB) return gbB - gbA;
      const timeA = a.data.created_at?.toMillis?.() || (a.data.created_at?.seconds ? a.data.created_at.seconds * 1000 : 0);
      const timeB = b.data.created_at?.toMillis?.() || (b.data.created_at?.seconds ? b.data.created_at.seconds * 1000 : 0);
      return timeB - timeA;
    });

    updateGroupBuyLiveSummary();

    const params = new URLSearchParams(window.location.search);
    if (params.get("filter") === "groupbuy") {
      selectedDealMode = "deals_only";
      document.querySelectorAll("#dealModeTabs .deal-mode-btn").forEach((b) => {
        const active = b.getAttribute("data-deal-mode") === "deals_only";
        b.classList.toggle("is-active", active);
        b.style.background = active ? "#f43f5e" : "transparent";
        b.style.color = active ? "#fff" : "#e2e8f0";
      });
    }

    renderProductsList();

    const targetPid = params.get("product") || params.get("deal");
    if (targetPid) {
      setTimeout(() => {
        const btn = listEl.querySelector(`button[data-id="${CSS.escape(targetPid)}"]`);
        const card = btn?.closest(".mall-card");
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.style.boxShadow = "0 0 0 3px #f43f5e, 0 12px 28px rgba(244,63,94,0.28)";
        }
      }, 150);
    }
  } catch (err) {
    listEl.innerHTML = `<div class='hint' style='grid-column: 1 / -1; color:red;'>상품 목록 로드 실패: ${err.message}</div>`;
    console.error(err);
  }
}

function updateGroupBuyLiveSummary() {
  const el = $("groupBuyLiveSummary");
  if (!el) return;
  const activeDeals = rawProducts.filter(p => p.gb?.enabled);
  const totalParticipants = activeDeals.reduce((acc, p) => acc + (p.gb?.currentCount || 0), 0);
  const achievedDeals = activeDeals.filter(p => (p.gb?.currentCount || 0) >= (p.gb?.targetCount || 10)).length;
  el.innerHTML = `🔥 진행중 공구·타임딜 <b>${activeDeals.length}건</b> · 누적 참여 <b>${totalParticipants}명</b> · 보너스 달성 <b>${achievedDeals}팀</b>`;
}

// 상품 대표 이미지: BestERP 는 images[] (공통 규격), 예전 상품은 image_url/imageUrl/image
// ERP 에서 상대 경로로 저장된 이미지는 ERP 사이트 기준 주소로 바꾼다
const ERP_ORIGIN_BASE = "https://besterp.netlify.app/admin/";
function productImageUrl(data) {
  const raw = (Array.isArray(data.images) ? data.images.find(u => typeof u === "string" && u.trim()) : "")
    || data.image_url || data.imageUrl || data.image || "";
  const u = String(raw).trim();
  if (!u) return "";
  if (/^(https?:|data:image\/)/i.test(u)) return u;
  try { return new URL(u, ERP_ORIGIN_BASE).href; } catch (_) { return ""; }
}

// 상품 카드 목록 렌더링
function renderProductsList() {
  const listEl = $("coopMallProducts");
  listEl.innerHTML = "";

  const filtered = rawProducts.filter(item => {
    const gb = item.gb || { enabled: false };
    if (!matchesMerchant(item.data.merchant_id, selectedMerchantFilter)) return false;
    if (!matchesChannel(salesChannelOf(item.data), selectedChannelFilter)) return false;

    if (selectedDealMode === "deals_only" && !gb.enabled) return false;
    if (selectedDealMode === "team_recruit" && (!gb.enabled || gb.mode !== "team_recruit")) return false;
    if (selectedDealMode === "weekly_cycle" && (!gb.enabled || gb.mode !== "weekly_cycle")) return false;

    if (selectedRegionFilter !== "all") {
      if (!gb.enabled) return false;
      if (!String(gb.region || "").includes(selectedRegionFilter) && !String(gb.region || "").includes("전지역")) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = "<div class='hint' style='grid-column: 1 / -1; text-align:center; padding:40px;'>선택하신 필터 조건에 해당하는 공동구매/상품이 없습니다.</div>";
    return;
  }

  let html = "";
  filtered.forEach(docSnap => {
    const data = docSnap.data;
    const gb = docSnap.gb || { enabled: false };
    const merchantName = resolveMerchantName(data.merchant_id, data.merchant_name);

    const pTypeMap = {
      physical_product: "일반상품",
      menu: "메뉴(음식)",
      service: "서비스",
      booking: "예약형"
    };
    const typeLabel = pTypeMap[data.product_type] || "";
    const channel = salesChannelOf(data);
    const chInfo = SALES_CHANNEL[channel];

    const progressPct = gb.enabled ? Math.min(100, Math.round((gb.currentCount / gb.targetCount) * 100)) : 0;
    const isGoalMet = gb.enabled && gb.currentCount >= gb.targetCount;
    const remainCount = gb.enabled ? Math.max(0, gb.targetCount - gb.currentCount) : 0;
    const countdown = gb.enabled ? formatRemainingTime(gb.deadlineIso) : null;
    const effectivePrice = gb.enabled ? gb.dealPrice : Number(data.price || 0);

    html += `
      <div class="panel product-card" style="padding:16px; border:${gb.enabled ? "2px solid #f43f5e" : "1px solid #e2e8f0"}; border-radius:16px; background:#fff; box-shadow: ${gb.enabled ? "0 8px 22px rgba(244,63,94,0.10)" : "0 4px 12px rgba(0,0,0,0.04)"}; display:flex; flex-direction:column; justify-content:space-between; transition: transform 0.2s, box-shadow 0.2s; position:relative;">
          <div>
              <!-- 🏪 가맹점 뱃지 + 공구/타임딜 태그 -->
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:6px; flex-wrap:wrap;">
                  <span class="merchant-badge" style="display:inline-flex; align-items:center; gap:6px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-size:0.8rem; font-weight:700; padding:4px 10px; border-radius:99px;">
                      <span>🏪</span>
                      <span>${esc(merchantName)}</span>
                  </span>
                  ${gb.enabled ? `
                    <span style="font-size:0.75rem; font-weight:800; padding:3px 9px; border-radius:99px; background:${gb.mode === "weekly_cycle" ? "#ecfdf5" : "#fff1f2"}; color:${gb.mode === "weekly_cycle" ? "#047857" : "#e11d48"}; border:1px solid ${gb.mode === "weekly_cycle" ? "#6ee7b7" : "#fecdd3"};">
                      ${gb.mode === "weekly_cycle" ? "🥬 주간 정기공구" : "👥 뭉쳐야 산다 타임딜"}
                    </span>
                  ` : (typeLabel ? `<span style="font-size:0.75rem; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:6px; font-weight:600;">${esc(typeLabel)}</span>` : '')}
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:6px; flex-wrap:wrap;">
                <span class="channel-badge" style="display:inline-block; font-size:0.74rem; font-weight:700; padding:2px 9px; border-radius:99px; color:${chInfo.color}; background:${chInfo.bg}; border:1px solid ${chInfo.border};">${chInfo.label}</span>
                ${gb.enabled ? `<span style="font-size:0.74rem; font-weight:700; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; padding:2px 8px; border-radius:99px;">📍 ${esc(gb.region)}</span>` : ""}
              </div>

              ${productImageUrl(data) ? `
                <div style="position:relative; margin-bottom:12px;">
                  <img src="${esc(productImageUrl(data))}" style="width:100%; height:180px; object-fit:cover; border-radius:10px; display:block;" onerror="this.style.display='none';" />
                  ${gb.enabled ? `
                    <div style="position:absolute; top:8px; left:8px; background:rgba(225,29,72,0.94); color:#fff; font-size:0.78rem; font-weight:800; padding:4px 10px; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.2);">
                      ${gb.discountRate > 0 ? `🔥 ${gb.discountRate}% 타임딜 즉시할인` : `🔥 타임딜 특가 + BM 보너스`}
                    </div>
                    <div data-countdown-until="${esc(gb.deadlineIso)}" style="position:absolute; bottom:8px; right:8px; background:rgba(15,23,42,0.88); color:#fde047; font-size:0.76rem; font-weight:800; padding:4px 9px; border-radius:8px; font-family:monospace;">
                      ⏰ ${esc(countdown.text)}
                    </div>
                  ` : ""}
                </div>
              ` : (gb.enabled ? `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; color:#fde047; padding:7px 11px; border-radius:8px; font-size:0.76rem; font-weight:800; margin-bottom:10px;">
                  <span>${gb.discountRate > 0 ? `🔥 ${gb.discountRate}% 타임딜 특가` : `🔥 타임딜 특가 + BM 보너스`}</span>
                  <span data-countdown-until="${esc(gb.deadlineIso)}" style="font-family:monospace;">⏰ ${esc(countdown.text)}</span>
                </div>
              ` : "")}
              
              <div style="font-weight:800; font-size:1.12rem; color:#1e293b; line-height:1.35; margin-bottom:6px;">${esc(data.product_name)}</div>
              <div style="color:#64748b; font-size:0.84rem; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(data.description || "")}</div>

              ${gb.enabled ? `
                <!-- 📊 공동구매 인원 모집 게이지 & BM 추가 적립 박스 -->
                <div style="margin-top:12px; padding:11px 12px; border-radius:12px; background:${isGoalMet ? "#ecfdf5" : "#fff1f2"}; border:1px solid ${isGoalMet ? "#a7f3d0" : "#fecdd3"};">
                  <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.79rem; font-weight:800; color:${isGoalMet ? "#065f46" : "#9f1239"}; margin-bottom:6px;">
                    <span>👥 현재 <b>${gb.currentCount}명</b> / 목표 ${gb.targetCount}명 (${progressPct}%)</span>
                    <span>${isGoalMet ? "🎉 보너스 확정!" : `${remainCount}명 더 모이면 보너스!`}</span>
                  </div>
                  <div style="width:100%; height:8px; background:rgba(0,0,0,0.08); border-radius:99px; overflow:hidden; margin-bottom:8px;">
                    <div style="width:${progressPct}%; height:100%; background:${isGoalMet ? "linear-gradient(90deg,#10b981,#059669)" : "linear-gradient(90deg,#f43f5e,#fb7185)"}; border-radius:99px; transition:width 0.3s;"></div>
                  </div>
                  <div style="font-size:0.77rem; color:#1e293b; font-weight:700; display:flex; align-items:center; justify-content:space-between; gap:4px; flex-wrap:wrap;">
                    <span>🎁 목표 달성 보너스: <b style="color:#d97706;">+${gb.bonusBm.toLocaleString()} BM</b> 추가 적립</span>
                    <span style="font-size:0.72rem; color:#64748b;">(할인가 즉시 확정)</span>
                  </div>
                  <div style="margin-top:5px; font-size:0.73rem; color:#475569; line-height:1.35;">
                    ${esc(gb.deliveryNote)}
                  </div>
                </div>
              ` : ""}
          </div>

          <div style="margin-top:14px; border-top:1px solid #f1f5f9; padding-top:12px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px;">
                ${gb.enabled ? `
                  <div>
                    ${gb.originalPrice > effectivePrice ? `<div style="font-size:0.78rem; color:#94a3b8; text-decoration:line-through;">정상가 ${gb.originalPrice.toLocaleString()} VND</div>` : ""}
                    <div style="font-size:0.75rem; font-weight:800; color:#e11d48;">⚡ 타임딜 즉시 확정가</div>
                  </div>
                ` : `<div></div>`}
                <div style="font-size:1.35rem; font-weight:800; color:#ef4444; text-align:right;">
                    ${effectivePrice.toLocaleString()} <span style="font-size:0.85rem; font-weight:700; color:#64748b;">VND</span>
                </div>
              </div>
              <div>
                  ${channel === "in_store" ? `<div style="width:100%; box-sizing:border-box; border-radius:10px; font-weight:700; padding:10px; text-align:center; background:#fff7ed; color:#9a3412; border:1px solid #fed7aa; font-size:0.9rem;">🏬 매장에서만 구매할 수 있습니다</div>` : `
                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="btn btn--primary" style="flex:1; min-width:115px; border-radius:10px; font-weight:800; padding:10px; background:linear-gradient(135deg,#2563eb,#1d4ed8); border:none;" data-action="buy-now" 
                        data-id="${esc(docSnap.id)}" 
                        data-merchant="${esc(data.merchant_id)}"
                        data-merchant-name="${esc(merchantName)}"
                        data-name="${esc(data.product_name)}" 
                        data-price="${effectivePrice}"
                        data-is-groupbuy="${gb.enabled ? "1" : "0"}"
                        data-bonus-bm="${gb.enabled ? gb.bonusBm : 0}"
                        data-gb-mode="${gb.enabled ? gb.mode : ""}">
                        ⚡ 즉시 구매
                    </button>
                    <button class="btn" style="flex:1; min-width:115px; border-radius:10px; font-weight:800; padding:10px; background:${gb.enabled ? "#fff1f2" : "#f8fafc"}; color:${gb.enabled ? "#e11d48" : "#1e293b"}; border:1px solid ${gb.enabled ? "#fecdd3" : "#cbd5e1"};" data-action="add-cart" 
                        data-id="${esc(docSnap.id)}" 
                        data-merchant="${esc(data.merchant_id)}"
                        data-merchant-name="${esc(merchantName)}"
                        data-name="${esc(data.product_name)}" 
                        data-price="${effectivePrice}"
                        data-is-groupbuy="${gb.enabled ? "1" : "0"}"
                        data-bonus-bm="${gb.enabled ? gb.bonusBm : 0}"
                        data-gb-mode="${gb.enabled ? gb.mode : ""}">
                        🛒 장바구니
                    </button>
                    ${gb.enabled ? `
                    <button type="button" class="btn" data-action="share-deal" data-id="${esc(docSnap.id)}" title="카톡/잘로/텔레그램 단톡방 공유"
                        style="border-radius:10px; font-weight:700; padding:10px 11px; background:#f8fafc; color:#0f172a; border:1px solid #cbd5e1; cursor:pointer;">
                        📣
                    </button>
                    ` : ""}
                  </div>`}
              </div>
          </div>
      </div>
    `;
  });
  listEl.innerHTML = html;

  // 즉시 구매 버튼 바인딩 (공구 여부와 관계없이 즉시 결제/주문 모달 오픈)
  listEl.querySelectorAll("button[data-action='buy-now']").forEach(btn => {
    btn.addEventListener("click", () => {
      const isGb = btn.getAttribute("data-is-groupbuy") === "1";
      const bonusBm = Number(btn.getAttribute("data-bonus-bm") || 0);
      buyNow({
        id: btn.getAttribute("data-id"),
        merchant_id: btn.getAttribute("data-merchant"),
        merchant_name: btn.getAttribute("data-merchant-name"),
        name: btn.getAttribute("data-name"),
        price: Number(btn.getAttribute("data-price")),
        qty: 1,
        is_group_buy: isGb,
        bonus_bm: bonusBm,
        group_buy_mode: btn.getAttribute("data-gb-mode") || ""
      });
    });
  });

  // 장바구니 담기 버튼 바인딩
  listEl.querySelectorAll("button[data-action='add-cart']").forEach(btn => {
    btn.addEventListener("click", () => {
      const isGb = btn.getAttribute("data-is-groupbuy") === "1";
      const bonusBm = Number(btn.getAttribute("data-bonus-bm") || 0);
      addToCart({
        id: btn.getAttribute("data-id"),
        merchant_id: btn.getAttribute("data-merchant"),
        merchant_name: btn.getAttribute("data-merchant-name"),
        name: btn.getAttribute("data-name"),
        price: Number(btn.getAttribute("data-price")),
        qty: 1,
        is_group_buy: isGb,
        bonus_bm: bonusBm,
        group_buy_mode: btn.getAttribute("data-gb-mode") || ""
      });
    });
  });

  // 단톡방 공유 버튼 바인딩
  listEl.querySelectorAll("button[data-action='share-deal']").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-id");
      const found = rawProducts.find(p => p.id === pid);
      if (!found || !found.gb?.enabled) return;
      const mName = resolveMerchantName(found.data.merchant_id, found.data.merchant_name);
      openViralShareModal(found, found.gb, mName);
    });
  });
}

// 2. 장바구니 & 즉시 구매 로직 구현
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

function isInStoreOnly(cartItem) {
  if (isInStoreOnlyMerchant(cartItem?.merchant_id)) return true;
  const p = rawProducts.find(r => r.id === cartItem?.id);
  return !!p && salesChannelOf(p.data) === "in_store";
}

function buyNow(item) {
  if (isInStoreOnly(item)) {
    alert("이 상품은 매장에서만 구매할 수 있습니다.");
    return;
  }
  if (!currentViewer) {
    if (confirm("즉시 구매를 진행하려면 로그인이 필요합니다.\n로그인 페이지로 이동하시겠습니까?")) {
      window.location.href = "/login.html";
    }
    return;
  }
  const existing = cart.find(c => c.id === item.id);
  if (!existing) {
    cart.push(item);
  }
  saveCartToStorage();
  updateCartBadge();
  $("cartModal").style.display = "flex";
  renderCartModal();
}

function addToCart(item) {
  if (isInStoreOnly(item)) {
    alert("이 상품은 매장에서만 구매할 수 있습니다.");
    return;
  }
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
  let totalBonusBm = 0;
  cart.forEach((c, index) => {
    total += (c.price * c.qty);
    if (c.is_group_buy && c.bonus_bm) {
      totalBonusBm += Number(c.bonus_bm) * c.qty;
    }
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding:10px 0;">
          <div>
             <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap; margin-bottom:3px;">
               <span style="display:inline-block; font-size:0.75rem; background:#eff6ff; color:#1d4ed8; padding:1px 7px; border-radius:99px; font-weight:700;">
                  🏪 ${esc(c.merchant_name || '가맹점')}
               </span>
               ${c.is_group_buy ? `<span style="display:inline-block; font-size:0.72rem; background:#fff1f2; color:#e11d48; border:1px solid #fecdd3; padding:1px 7px; border-radius:99px; font-weight:800;">🔥 타임딜 할인가 확정</span>` : ""}
             </div>
             <div style="font-weight:700; font-size:1rem; color:#1e293b;">${esc(c.name)}</div>
             <div style="font-size:0.85rem; color:#64748b; margin-top:2px;">
               ${Number(c.price).toLocaleString()} VND x ${c.qty}개
               ${c.is_group_buy && c.bonus_bm ? `<span style="color:#d97706; font-weight:700; margin-left:6px;">(목표 달성 시 +${(Number(c.bonus_bm) * c.qty).toLocaleString()} BM)</span>` : ""}
             </div>
          </div>
          <div>
             <button class="btn btn--sm" data-action="remove-cart" data-index="${index}" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:4px 8px; border-radius:6px;">제외</button>
          </div>
      </div>
    `;
  });
  if (totalBonusBm > 0) {
    html += `
      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; font-size:0.82rem; color:#92400e; line-height:1.45;">
        🎁 <b>공동구매·타임딜 혜택 안내:</b><br/>
        • 타임딜 시간 내 주문으로 <b>즉시 할인가가 100% 확정</b>되었습니다.<br/>
        • 목표 인원 달성 시 <b>총 +${totalBonusBm.toLocaleString()} BM</b>이 내 지갑에 추가 적립됩니다!
      </div>
    `;
  }
  listEl.innerHTML = html;
  $("cartTotal").textContent = total.toLocaleString();
    if ($("cartBuyerPhone") && ! $("cartBuyerPhone").value) {
      try {
        const savedShip = JSON.parse(localStorage.getItem("bc_mall_shipping") || "{}");
        if (savedShip.phone && $("cartBuyerPhone")) $("cartBuyerPhone").value = savedShip.phone;
        if (savedShip.address && $("cartBuyerAddress")) $("cartBuyerAddress").value = savedShip.address;
      } catch (_) {}
    }
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
  const storeOnly = cart.filter(c => isInStoreOnly(c));
  if (storeOnly.length) {
    if (!confirm(`매장에서만 구매할 수 있는 상품이 장바구니에 있습니다:\n${storeOnly.map(c => `· ${c.name}`).join("\n")}\n\n이 상품을 빼고 계속할까요?`)) return;
    cart = cart.filter(c => !isInStoreOnly(c));
    saveCartToStorage();
    updateCartBadge();
    renderCartModal();
    if (cart.length === 0) return;
  }
  const shippingPhone = ($("cartBuyerPhone")?.value || "").trim();
  const shippingAddress = ($("cartBuyerAddress")?.value || "").trim();
  const deliveryMemo = ($("cartBuyerMemo")?.value || "").trim();
  if (!shippingPhone || !shippingAddress) {
    alert("가맹점이 상품을 배송하거나 연락드릴 수 있도록 [연락처/Zalo ID]와 [하노이 배송지 주소(또는 매장 픽업)]를 입력해 주세요.");
    if (!shippingPhone) $("cartBuyerPhone")?.focus();
    else $("cartBuyerAddress")?.focus();
    return;
  }
  try {
    localStorage.setItem("bc_mall_shipping", JSON.stringify({ phone: shippingPhone, address: shippingAddress }));
  } catch (_) {}

  if (!confirm("입력하신 배송지 정보로 주문하시겠습니까? (결제 QR 및 계좌 안내가 생성됩니다)")) return;

  const targetMerchantId = cart[0].merchant_id;
  const itemsPayload = cart.map(c => ({
    product_id: c.id,
    name: c.name,
    price: c.price,
    qty: c.qty,
    merchant_name: c.merchant_name,
    is_group_buy: !!c.is_group_buy,
    bonus_bm: Number(c.bonus_bm || 0),
    group_buy_mode: c.group_buy_mode || ""
  }));

  let totalAmount = 0;
  let totalExpectedBonusBm = 0;
  const groupBuyCartItems = [];
  cart.forEach(c => {
    totalAmount += c.price * c.qty;
    if (c.is_group_buy) {
      totalExpectedBonusBm += Number(c.bonus_bm || 0) * c.qty;
      groupBuyCartItems.push(c);
    }
  });

  const btn = $("btnCheckout");
  btn.disabled = true;
  btn.textContent = "주문 처리 중...";

  try {
    const { addDoc, getDoc, doc, updateDoc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

    // 가맹점 계좌 정보 조회 — 가맹점이 등록한 실제 계좌만 안내 (임의 기본 계좌 표시 금지)
    let merchantInfo = {
      name: cart[0].merchant_name || "가맹점",
      bank_name: "",
      account_no: "",
      account_holder: ""
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

    const hasBankAccount = !!(merchantInfo.bank_name && merchantInfo.account_no);

    const docRef = await addDoc(collection(db, "merchant_orders"), {
      merchant_id: targetMerchantId,
      merchant_name: merchantInfo.name,
      buyer_uid: currentViewer.uid,
      buyer_email: currentViewer.email || "",
      buyer_name: currentViewer.displayName || currentViewer.email?.split("@")[0] || "회원",
      shipping_phone: shippingPhone,
      shipping_address: shippingAddress,
      delivery_memo: deliveryMemo,
      items: itemsPayload,
      total_amount: totalAmount,
      order_type: groupBuyCartItems.length > 0 ? "group_buy_flash_deal" : "regular",
      is_group_buy: groupBuyCartItems.length > 0,
      group_buy_price_locked: groupBuyCartItems.length > 0,
      group_buy_expected_bonus_bm: totalExpectedBonusBm,
      status: "pending",
      payment_status: "awaiting_payment",
      payment_method: "undecided",
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    });

    // 공동구매 상품인 경우 참여 인원(current_count) 자동 업데이트
    for (const gbItem of groupBuyCartItems) {
      const found = rawProducts.find(p => p.id === gbItem.id);
      if (found && found.gb?.enabled) {
        const nextCount = (found.gb.currentCount || 0) + Number(gbItem.qty || 1);
        found.gb.currentCount = nextCount;
        try {
          await updateDoc(doc(db, "merchant_products", gbItem.id), {
            group_buy_current: nextCount,
            "group_buy.current_count": nextCount,
            updated_at: serverTimestamp()
          });
        } catch (_) { }
      }
    }
    updateGroupBuyLiveSummary();
    renderProductsList();

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
          ${groupBuyCartItems.length > 0 ? `<br/><span style="display:inline-block; margin-top:6px; background:#fff1f2; color:#e11d48; border:1px solid #fecdd3; font-size:0.8rem; font-weight:800; padding:3px 10px; border-radius:99px;">🔥 타임딜 할인가 즉시 확정 (+${totalExpectedBonusBm.toLocaleString()} BM 목표달성 보너스 대기)</span>` : ""}
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
          ${!hasBankAccount ? `
          <div style="border:1px solid #fde68a; border-radius:10px; padding:16px; background:#fffbeb; font-size:0.85rem; line-height:1.5; color:#92400e;">
            <h4 style="margin:0 0 6px 0; color:#1f2937; font-size:1.05rem;">결제방식 2. 계좌이체 (현금)</h4>
            이 가맹점은 아직 입금 계좌를 등록하지 않았습니다.<br/>
            현금 결제를 원하시면 <strong>${esc(merchantInfo.name)}</strong> 가맹점에 직접 문의해 주세요. (주문번호: <strong>${docRef.id.slice(0, 8)}</strong>)
          </div>` : `
          <div style="border:1px solid #d1d5db; border-radius:10px; padding:16px; background:#fff;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <h4 style="margin:0; color:#1f2937; font-size:1.05rem;">결제방식 2. 계좌 자동이체</h4>
              <span style="font-size:0.75rem; background:#e0e7ff; color:#4338ca; padding:2px 8px; border-radius:4px; font-weight:600;">가맹점 승인</span>
            </div>
            
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:12px; font-size:0.85rem; line-height:1.6;">
              <div>🏦 <strong>은행:</strong> ${esc(merchantInfo.bank_name)}</div>
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <span>🔢 <strong>계좌번호:</strong> <span id="textBankAcc" style="font-family:monospace; font-weight:bold; color:#1d4ed8;">${esc(merchantInfo.account_no)}</span></span>
                <button type="button" id="btnCopyBankAcc" style="font-size:0.75rem; padding:2px 8px; border:1px solid #cbd5e1; border-radius:4px; background:#fff; cursor:pointer;">복사</button>
              </div>
              <div>👤 <strong>예금주:</strong> ${esc(merchantInfo.account_holder || merchantInfo.name)}</div>
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
          </div>`}
          
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

// 판매 채널 필터 버튼
document.querySelectorAll('#channelFilterBar .channel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedChannelFilter = btn.getAttribute('data-channel') || 'all';
    document.querySelectorAll('#channelFilterBar .channel-btn').forEach(b => b.classList.toggle('btn--primary', b === btn));
    renderProductsList();
  });
});
