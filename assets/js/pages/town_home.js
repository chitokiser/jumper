// /assets/js/pages/town_home.js
import { auth, db } from "/assets/js/auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function formatHexForUi(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} HEX`;
}

function formatCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("ko-KR")}명`;
}

function getFxRates() {
  const src = window.__jackpotFx || {};
  const krw = Number(src.krw);
  const vnd = Number(src.vnd);
  return {
    krw: Number.isFinite(krw) && krw > 0 ? krw : 1380,
    vnd: Number.isFinite(vnd) && vnd > 0 ? vnd : 25000,
  };
}

function formatFiatLine(hexValue) {
  const n = Number(hexValue);
  if (!Number.isFinite(n)) return "약 - KRW / - VND";

  const fx = getFxRates();
  const krw = n * fx.krw;
  const vnd = n * fx.vnd;
  return `약 ${Math.round(krw).toLocaleString("ko-KR")} KRW / ${Math.round(vnd).toLocaleString("ko-KR")} VND`;
}

function jackpotEndpoints(path) {
  const base = String(window.__jackpotApiBase || "").trim().replace(/\/$/, "");
  if (base) return [`${base}${path}`];

  const host = (location.hostname || "").trim().toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const isApiOrigin = location.port === "8787";

  if (isApiOrigin) return [`${location.origin}${path}`];
  if (isLocal) return [`http://${host || "127.0.0.1"}:8787${path}`, path];
  return [path];
}

async function fetchJackpotJson(path) {
  let lastError = null;
  for (const url of jackpotEndpoints(path)) {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return await res.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("JACKPOT_FETCH_FAILED");
}

function setJackpotUi({ valueText, fiatText, updatedText, winnerCountText, highestWinText }) {
  const valueEl = $("jackpotDisplayValue");
  const fiatEl = $("jackpotFiatValue");
  const updatedEl = $("jackpotUpdated");
  const winnerEl = $("jackpotWinnerCount");
  const highestEl = $("jackpotHighestWin");

  if (valueEl) valueEl.textContent = valueText;
  if (fiatEl) fiatEl.textContent = fiatText;
  if (updatedEl) updatedEl.innerHTML = `<span class="jackpot-dot"></span>${escHtml(updatedText)}`;
  if (winnerEl) winnerEl.textContent = winnerCountText;
  if (highestEl) highestEl.textContent = highestWinText;
}

async function loadJackpotCurrent() {
  try {
    const currentJson = await fetchJackpotJson("/jackpot/current");
    const current = currentJson?.data || {};
    const now = new Date();

    let winnerCountText = "-";
    let highestWinText = "- HEX";

    try {
      const statsJson = await fetchJackpotJson("/jackpot/public-stats");
      const stats = statsJson?.data || {};
      winnerCountText = formatCount(stats.winnerCount);
      highestWinText = formatHexForUi(stats.highestWinHex);
    } catch (e) {
      console.warn("loadJackpot stats failed:", e);
    }

    setJackpotUi({
      valueText: formatHexForUi(current.jackpotDisplayHex),
      fiatText: formatFiatLine(current.jackpotDisplayHex),
      updatedText: `${now.toLocaleTimeString("ko-KR", { hour12: false })} 기준 조회`,
      winnerCountText,
      highestWinText,
    });
  } catch (e) {
    console.warn("loadJackpotCurrent failed:", e);
    try {
      await loadJackpotFirestoreFallback();
    } catch (fe) {
      console.warn("loadJackpotFirestoreFallback failed:", fe);
      setJackpotUi({
        valueText: "연결 대기중",
        fiatText: "약 - KRW / - VND",
        updatedText: "잭팟 서버에 연결할 수 없습니다",
        winnerCountText: "-",
        highestWinText: "- HEX",
      });
    }
  }
}

async function loadJackpotFirestoreFallback() {
  let winnerCountText = "-";
  let highestWinText = "- HEX";
  let valueText = "연결 대기중";
  let fiatText = "약 - KRW / - VND";
  let updatedText = "잭팟 서버에 연결할 수 없습니다";

  try {
    const cntSnap = await getCountFromServer(
      query(collection(db, "jackpot_rounds"), where("isWinner", "==", true))
    );
    winnerCountText = formatCount(cntSnap.data().count);
  } catch {}

  try {
    const highSnap = await getDocs(
      query(collection(db, "jackpot_rounds"), orderBy("finalWinSort", "desc"), limit(1))
    );
    if (!highSnap.empty) {
      const wei = highSnap.docs[0].data().finalWinWei || "0";
      highestWinText = formatHexForUi(Number(BigInt(wei)) / 1e18);
    }
  } catch {}

  try {
    const latestSnap = await getDocs(
      query(collection(db, "jackpot_rounds"), orderBy("createdAt", "desc"), limit(1))
    );
    if (!latestSnap.empty) {
      const wei = latestSnap.docs[0].data().jackpotDisplayWei || "0";
      const hexVal = Number(BigInt(wei)) / 1e18;
      if (hexVal > 0) {
        valueText = formatHexForUi(hexVal);
        fiatText = formatFiatLine(hexVal);
        updatedText = "최근 결제 기준 (실시간 아님)";
      }
    }
  } catch {}

  setJackpotUi({ valueText, fiatText, updatedText, winnerCountText, highestWinText });
}

function initJackpotTicker() {
  if (!$("jackpotSection")) return;
  loadJackpotCurrent();
  setInterval(loadJackpotCurrent, 15000);
}

async function isAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch {
    return false;
  }
}

function setupAdminUI(admin) {
  const btnAdminPlace = $("btnAdminPlace");
  const noticeAdminLink = $("noticeAdminLink");
  if (btnAdminPlace) btnAdminPlace.style.display = admin ? "" : "none";
  if (noticeAdminLink) noticeAdminLink.style.display = admin ? "" : "none";
}

function makeNoticeRow(v) {
  const li = document.createElement("li");
  li.className = "notice-row";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "notice-head";
  head.textContent = v.title || v.text || "(제목 없음)";

  const body = document.createElement("div");
  body.className = "notice-body";
  body.textContent = v.text || "";
  body.style.display = "none";

  head.onclick = () => {
    body.style.display = body.style.display === "none" ? "block" : "none";
  };

  li.appendChild(head);
  li.appendChild(body);
  return li;
}

async function loadNotices() {
  const list = $("noticeList");
  if (!list) return;
  list.innerHTML = "";

  try {
    const snap = await getDocs(
      query(collection(db, "notices"), orderBy("createdAt", "desc"), limit(30))
    );

    const docs = [];
    snap.forEach((d) => docs.push(d.data() || {}));

    const visible = docs
      .filter((v) => v.visible !== false)
      .sort((a, b) => {
        const ap = a.pinned ? 1 : 0;
        const bp = b.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        const am = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
        const bm = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
        return bm - am;
      });

    visible.forEach((v, i) => {
      const row = makeNoticeRow(v);
      if (i >= 5) row.style.display = "none";
      list.appendChild(row);
    });

    if (!list.children.length) {
      const li = document.createElement("li");
      li.textContent = "표시할 공지사항이 없습니다.";
      list.appendChild(li);
    }

    const moreBtn = $("noticeMoreBtn");
    if (moreBtn) {
      if (visible.length > 5) {
        moreBtn.style.display = "";
        moreBtn.onclick = () => {
          list.querySelectorAll("li[style*='display: none'], li[style*='display:none']").forEach((el) => (el.style.display = ""));
          moreBtn.style.display = "none";
        };
      } else {
        moreBtn.style.display = "none";
      }
    }
  } catch (e) {
    console.warn("loadNotices failed:", e);
    const li = document.createElement("li");
    li.textContent = "공지사항을 불러오지 못했습니다.";
    list.appendChild(li);
  }
}

function renderMerchantCard(mid, m) {
  const name = m.name || "가맹점";
  const career = m.career || "";
  const region = m.region || "";
  const desc = m.description || "";
  const ownerUid = m.ownerUid || "";

  return `
    <div class="merchant-card">
      <div class="merchant-card-head">
        <span class="merchant-name">${escHtml(name)}</span>
        ${career ? `<span class="merchant-career">${escHtml(career)}</span>` : ""}
      </div>
      ${region ? `<div class="merchant-region">📍 ${escHtml(region)}</div>` : ""}
      ${desc ? `<div class="merchant-desc">${escHtml(desc)}</div>` : ""}
      <div class="merchant-id">가맹점 ID: ${escHtml(String(mid))}</div>
      ${ownerUid ? `<button class="btn-merchant-products" type="button" data-owner-uid="${escHtml(ownerUid)}" data-merchant-name="${escHtml(name)}">상품 보기</button>` : ""}
    </div>`;
}

let merchantGridBound = false;

async function loadMerchants() {
  const grid = $("merchantListGrid");
  const state = $("merchantListState");
  if (!grid) return;

  if (state) state.textContent = "불러오는 중...";

  try {
    const snap = await getDocs(collection(db, "merchants"));
    const list = [];
    snap.forEach((d) => {
      const m = d.data() || {};
      if (m.active !== false) list.push({ id: d.id, ...m });
    });

    if (state) state.textContent = `총 ${list.length}개`;

    if (!list.length) {
      grid.innerHTML = '<p class="help">등록된 가맹점이 없습니다.</p>';
      return;
    }

    grid.innerHTML = list.map((m) => renderMerchantCard(m.id, m)).join("");

    if (!merchantGridBound) {
      merchantGridBound = true;
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-merchant-products");
        if (!btn) return;
        const ownerUid = btn.dataset.ownerUid;
        const merchantName = btn.dataset.merchantName;
        if (ownerUid) openMerchantProductModal(ownerUid, merchantName);
      });
    }
  } catch (e) {
    console.warn("loadMerchants failed:", e);
    if (state) state.textContent = "가맹점 목록을 불러오지 못했습니다.";
  }
}

const TYPE_COLOR = {
  homestay: "#6366f1",
  restaurant: "#f97316",
  food: "#f97316",
  cafe: "#854d0e",
  hospital: "#ef4444",
  school: "#16a34a",
  park: "#22c55e",
  shopping: "#ec4899",
};

function getMarkerColor(type) {
  return TYPE_COLOR[String(type).toLowerCase()] || "#6b7280";
}

function loadMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    window.__gmapsCb = resolve;
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${window.__mapsKey || ""}&callback=__gmapsCb&language=ko&region=KR`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps 로드 실패"));
    document.head.appendChild(s);
  });
}

function parseLatLng(gmapUrl) {
  if (!gmapUrl) return null;
  try {
    const m1 = gmapUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
    const url = new URL(gmapUrl);
    const q = url.searchParams.get("q");
    if (q) {
      const m2 = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
  } catch {}
  return null;
}

async function loadPlacesMap() {
  const mapEl = $("villageMap");
  if (!mapEl) return;

  if (!window.__mapsKey) {
    mapEl.innerHTML = '<div style="padding:32px;text-align:center;color:#9ca3af;">Google Maps API 키가 없습니다.</div>';
    return;
  }

  try {
    await loadMapsScript();

    const [placesSnap, merchantsSnap] = await Promise.all([
      getDocs(collection(db, "places")),
      getDocs(collection(db, "merchants")),
    ]);

    const places = [];
    placesSnap.forEach((d) => {
      const p = d.data() || {};
      if (p.visible !== false) places.push({ id: d.id, _src: "place", ...p });
    });

    merchantsSnap.forEach((d) => {
      const m = d.data() || {};
      if (m.active !== false && m.gmap) {
        places.push({
          id: d.id,
          _src: "merchant",
          name: m.name || "가맹점",
          type: m.career || "merchant",
          gmap: m.gmap,
          phone: m.phone || "",
          description: m.description || "",
        });
      }
    });

    const map = new google.maps.Map(mapEl, {
      center: { lat: 20.9947, lng: 105.9487 },
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    if (!places.length) return;

    const bounds = new google.maps.LatLngBounds();
    const infoWindow = new google.maps.InfoWindow();
    let markerCount = 0;

    places.forEach((p) => {
      let latLng = null;
      if (typeof p.lat === "number" && typeof p.lng === "number") latLng = { lat: p.lat, lng: p.lng };
      else latLng = parseLatLng(p.gmap);
      if (!latLng) return;

      const isMerchant = p._src === "merchant";
      markerCount += 1;
      const marker = new google.maps.Marker({
        position: latLng,
        map,
        title: p.name || "",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: isMerchant ? "#f59e0b" : getMarkerColor(p.type),
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: isMerchant ? 3 : 2,
          scale: isMerchant ? 11 : 9,
        },
        zIndex: isMerchant ? 10 : 1,
      });
      bounds.extend(latLng);

      const content = isMerchant
        ? `<div style="max-width:240px;font-size:13px;line-height:1.5;">
             <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏪 ${escHtml(p.name)}</div>
             <div style="color:#f59e0b;margin-bottom:2px;font-size:12px;">가맹점</div>
             ${p.type ? `<div style="color:#6b7280;">${escHtml(p.type)}</div>` : ""}
             ${p.phone ? `<div style="color:#374151;">${escHtml(p.phone)}</div>` : ""}
             ${p.description ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(p.description)}</div>` : ""}
             <a href="${escHtml(p.gmap)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#2563eb;">구글 지도에서 보기</a>
           </div>`
        : `<div style="max-width:240px;font-size:13px;line-height:1.5;">
             <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escHtml(p.name || "")}</div>
             ${p.type ? `<div style="color:#7c3aed;margin-bottom:2px;">${escHtml(p.type)}</div>` : ""}
             ${p.area ? `<div style="color:#6b7280;">구역: ${escHtml(p.area)}</div>` : ""}
             ${p.address ? `<div style="color:#374151;">${escHtml(p.address)}</div>` : ""}
             ${p.phone ? `<div style="color:#374151;">${escHtml(p.phone)}</div>` : ""}
             ${p.note ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(p.note)}</div>` : ""}
             ${p.gmap ? `<a href="${escHtml(p.gmap)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#2563eb;">구글 지도에서 보기</a>` : ""}
           </div>`;

      marker.addListener("click", () => {
        infoWindow.setContent(content);
        infoWindow.open(map, marker);
      });
    });

    if (markerCount > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds);
      google.maps.event.addListenerOnce(map, "bounds_changed", () => {
        if (map.getZoom() > 17) map.setZoom(17);
      });
    }
  } catch (e) {
    console.warn("loadPlacesMap failed:", e);
    mapEl.innerHTML = `<div style="padding:32px;text-align:center;color:#9ca3af;">지도를 불러오지 못했습니다.<br><small>${e.message || ""}</small></div>`;
  }
}

function renderProductCard(p) {
  const thumb = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
  const price = p.price ? `${Number(p.price).toLocaleString()}원` : "가격 문의";
  return `
    <a class="mp-product-card" href="/item.html?id=${escHtml(p.id)}" target="_blank" rel="noopener">
      ${thumb ? `<img class="mp-product-thumb" src="${escHtml(thumb)}" alt="${escHtml(p.title || "")}" loading="lazy">` : `<div class="mp-product-thumb-ph">📦</div>`}
      <div class="mp-product-body">
        <div class="mp-product-title">${escHtml(p.title || "")}</div>
        ${p.region ? `<div class="mp-product-region">📍 ${escHtml(p.region)}</div>` : ""}
        <div class="mp-product-price">${escHtml(price)}</div>
      </div>
    </a>`;
}

function closeMerchantProductModal() {
  const modal = $("merchantProductsModal");
  if (modal) modal.style.display = "none";
}

function openMerchantProductModal(ownerUid, merchantName) {
  const modal = $("merchantProductsModal");
  const title = $("mpModalTitle");
  const stateEl = $("mpModalState");
  const grid = $("mpModalGrid");
  if (!modal || !grid) return;

  if (title) title.textContent = `${merchantName || "가맹점"} 상품 목록`;
  if (stateEl) stateEl.textContent = "불러오는 중...";
  grid.innerHTML = "";
  modal.style.display = "flex";

  const closeBtn = $("mpModalClose");
  const backdrop = $("mpModalBackdrop");
  if (closeBtn) closeBtn.onclick = closeMerchantProductModal;
  if (backdrop) backdrop.onclick = closeMerchantProductModal;

  const onKey = (e) => {
    if (e.key === "Escape") {
      closeMerchantProductModal();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  const q = query(
    collection(db, "items"),
    where("ownerUid", "==", ownerUid),
    where("status", "in", ["published", "approved"])
  );

  getDocs(q)
    .then((snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));

      if (!list.length) {
        if (stateEl) stateEl.textContent = "등록된 상품이 없습니다.";
        return;
      }

      if (stateEl) stateEl.textContent = `총 ${list.length}개`;
      grid.innerHTML = list.map(renderProductCard).join("");
    })
    .catch((e) => {
      console.warn("loadMerchantProducts failed:", e);
      if (stateEl) stateEl.textContent = "상품 목록을 불러오지 못했습니다.";
    });
}

function renderCoopCard(p) {
  const imgHtml = p.imageUrl
    ? `<img class="mp-product-thumb" src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="mp-product-thumb-ph" style="display:none;">📦</div>`
    : `<div class="mp-product-thumb-ph">📦</div>`;

  const typeBadge = p.type === "voucher"
    ? `<span style="font-size:0.7rem;background:#fef3c7;color:#92400e;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:3px;">바우처</span>`
    : `<span style="font-size:0.7rem;background:#e0e7ff;color:#3730a3;border-radius:99px;padding:1px 7px;display:inline-block;margin-bottom:3px;">일반상품</span>`;

  return `
    <a class="mp-product-card" href="/coop.html">
      ${imgHtml}
      <div class="mp-product-body">
        ${typeBadge}
        <div class="mp-product-title">${escHtml(p.name)}</div>
        <div class="mp-product-price">${Number(p.price || 0).toLocaleString()} 원</div>
      </div>
    </a>`;
}

async function loadCoopProducts() {
  const grid = $("coopProductsGrid");
  if (!grid) return;

  try {
    const snap = await getDocs(query(collection(db, "coopProducts"), where("active", "==", true)));
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    if (!list.length) {
      const sec = $("coopProductsSection");
      if (sec) sec.style.display = "none";
      return;
    }

    grid.innerHTML = list.map(renderCoopCard).join("");
  } catch (e) {
    console.warn("loadCoopProducts failed:", e);
    const sec = $("coopProductsSection");
    if (sec) sec.style.display = "none";
  }
}

function usedStateText(s) {
  return s === "sold" ? "판매완료" : s === "reserved" ? "예약중" : "판매중";
}

function usedThumb(post) {
  if (Array.isArray(post?.imageUrls) && post.imageUrls[0]) return post.imageUrls[0];
  if (post?.imageUrl) return post.imageUrl;
  return "/assets/images/jump/BI.png";
}

function renderUsedCard(post) {
  return `
    <a class="used-card" href="/used-market-item.html?id=${encodeURIComponent(post.id)}">
      <img class="used-thumb" src="${escHtml(usedThumb(post))}" alt="${escHtml(post.title || "중고물품")}" loading="lazy" />
      <div class="used-body">
        <div class="used-title">${escHtml(post.title || "제목 없음")}</div>
        <div class="used-meta">
          <span class="used-price">${Number(post.price || 0).toLocaleString()}원</span>
          <span class="used-state">${usedStateText(post.status)}</span>
        </div>
      </div>
    </a>`;
}

async function loadUsedMarketPreview() {
  const grid = $("usedMarketPreviewGrid");
  const state = $("usedMarketPreviewState");
  if (!grid) return;

  if (state) state.textContent = "불러오는 중...";
  try {
    const snap = await getDocs(query(collection(db, "usedMarketPosts"), orderBy("createdAt", "desc"), limit(8)));
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));

    if (!list.length) {
      if (state) state.textContent = "등록된 중고물품이 없습니다.";
      grid.innerHTML = "";
      return;
    }

    if (state) state.textContent = `최신 ${list.length}개`;
    grid.innerHTML = list.map(renderUsedCard).join("");
  } catch (e) {
    console.warn("loadUsedMarketPreview failed:", e);
    if (state) state.textContent = "중고물품을 불러오지 못했습니다.";
  }
}
async function loadSponsorBannersFromDb() {
  try {
    const snap = await getDocs(query(collection(db, "sponsorBanners"), limit(20)));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    return rows
      .filter((x) => x.active !== false)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  } catch (e) {
    console.warn("loadSponsorBannersFromDb failed:", e);
    return [];
  }
}

function sponsorSlideHtml(row, idx) {
  const title = escHtml(row.title || "스폰서");
  const subtitle = escHtml(row.subtitle || "");
  const imageUrl = escHtml(row.imageUrl || "/assets/images/jump/BI.png");
  const linkUrl = escHtml(row.linkUrl || "/");
  const activeClass = idx === 0 ? " is-active" : "";

  return `
    <a class="sponsor-slide${activeClass}" data-idx="${idx}" href="${linkUrl}" ${String(linkUrl).startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>
      <img class="sponsor-slide-logo" src="${imageUrl}" alt="${title}" />
      <div class="sponsor-slide-copy">
        <strong>${title}</strong>
        <span>${subtitle}</span>
      </div>
    </a>`;
}
async function initSponsorRotator() {
  const root = $("sponsorRotator");
  const dotsWrap = $("sponsorDots");
  if (!root || !dotsWrap) return;

  const dbRows = await loadSponsorBannersFromDb();
  if (dbRows.length) {
    root.innerHTML = dbRows.map((r, i) => sponsorSlideHtml(r, i)).join("");
  }

  const slides = Array.from(root.querySelectorAll(".sponsor-slide"));
  if (!slides.length) return;

  let idx = 0;
  let timer = null;

  function renderDots() {
    dotsWrap.innerHTML = slides
      .map((_, i) => `<button type="button" class="sponsor-dot ${i === idx ? "is-active" : ""}" data-idx="${i}" aria-label="배너 ${i + 1}"></button>`)
      .join("");
  }

  function show(next) {
    idx = ((next % slides.length) + slides.length) % slides.length;
    slides.forEach((el, i) => el.classList.toggle("is-active", i === idx));
    dotsWrap.querySelectorAll(".sponsor-dot").forEach((el, i) => el.classList.toggle("is-active", i === idx));
  }

  function start() {
    stop();
    timer = setInterval(() => show(idx + 1), 4000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  dotsWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".sponsor-dot");
    if (!btn) return;
    const next = Number(btn.dataset.idx);
    if (Number.isFinite(next)) show(next);
  });

  root.addEventListener("mouseenter", stop);
  root.addEventListener("mouseleave", start);
  root.addEventListener("focusin", stop);
  root.addEventListener("focusout", start);

  renderDots();
  show(0);
  start();
}
function initUISlider() {
  // 기존 슬라이더 섹션이 없으면 아무 작업 안함
}

onAuthStateChanged(auth, async (user) => {
  const admin = await isAdmin(user?.uid);
  setupAdminUI(admin);
});

loadNotices();
initJackpotTicker();
loadUsedMarketPreview();
loadMerchants();
loadCoopProducts();
initSponsorRotator().catch((e) => console.warn("sponsor init failed:", e));
initUISlider();
loadPlacesMap();

