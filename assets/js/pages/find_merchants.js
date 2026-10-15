import { db } from "../firebase-init.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
let map = null;
let infoWindow = null;
const markers = [];

function loadGoogleMapsScript() {
    return new Promise((resolve, reject) => {
        if (window.google?.maps) return resolve();
        window.__findMerchantMapCb = () => resolve();
        const apiKey = window.__mapsKey || "AIzaSyC5zrzVsTqshKYI4vS3og6jXaS-vlx2ujM";
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=__findMerchantMapCb&language=ko&region=VN`;
        script.async = true;
        script.onerror = () => reject(new Error("구글 지도 스크립트 로드에 실패했습니다."));
        document.head.appendChild(script);
    });
}

function parseCoords(d) {
    if (d.lat && d.lng && !isNaN(d.lat) && !isNaN(d.lng)) {
        return { lat: Number(d.lat), lng: Number(d.lng) };
    }
    const gUrl = d.gmapUrl || d.mapUrl || d.gmap || "";
    if (typeof gUrl === "string") {
        const m1 = gUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
        const m2 = gUrl.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
        if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
    return null;
}

async function init() {
    const mapEl = $("merchantMap");
    if (mapEl) {
        mapEl.innerHTML = "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-weight:600;'>구글 지도를 불러오는 중입니다...</div>";
    }

    try {
        await loadGoogleMapsScript();
        if (mapEl) {
            mapEl.innerHTML = "";
            mapEl.style.display = "block";
            map = new google.maps.Map(mapEl, {
                center: { lat: 21.005, lng: 105.775 }, // Centered on Hanoi region
                zoom: 12,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: true,
                zoomControl: true,
                styles: [
                    { featureType: "poi.business", stylers: [{ visibility: "off" }] },
                    { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] }
                ]
            });
            infoWindow = new google.maps.InfoWindow();
        }
    } catch (mapErr) {
        console.error("Google Maps failed to load:", mapErr);
        if (mapEl) {
            mapEl.innerHTML = `<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;font-weight:600;'>구글 지도를 불러올 수 없습니다. (${mapErr.message})</div>`;
        }
    }

    try {
        const q = query(collection(db, "merchants"), where("active", "==", true));
        const snap = await getDocs(q);
        const grid = $("merchantGrid");

        if (snap.empty) {
            grid.innerHTML = "<div style='color:#888; font-size:0.9rem; padding: 20px;'>등록된 가맹점이 없습니다.</div>";
            return;
        }

        const bounds = map ? new google.maps.LatLngBounds() : null;
        let validCoordsCount = 0;

        snap.forEach(docSnap => {
            const d = docSnap.data();

            // Create card
            const card = document.createElement("div");
            card.className = "mc-card";
            const btCount = d.btBalance || 0;
            const kmFee = d.feeBps ? (d.feeBps / 100) : (d.kmFeeRatio || 10);
            const reviews = d.reviewCount || Math.floor(Math.random() * 50);
            const likes = d.likeCount || Math.floor(Math.random() * 100);

            const logoUrl = d.logoUrl || d.imageUrl || "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=150&h=150&q=80";

            card.innerHTML = `
          <div class="mc-card-hero">
              <div class="mc-card-badge">🎟️ ${btCount} BT</div>
              <img src="${logoUrl}" alt="${d.name}" class="mc-card-hero-img">
          </div>
          <div class="mc-card-inner">
              <div class="mc-card-name">${d.name || "이름 없음"}</div>
              <div class="mc-card-career">${d.career || "미분류"} <span class="mc-card-region">${d.region || ""}</span></div>
              
              <div class="mc-card-stats">
                 <span title="고객 리뷰">💬 ${reviews}</span>
                 <span title="좋아요">❤️ ${likes}</span>
                 <span title="BM 결제 수수료" style="color:#10b981; font-weight:bold;">⚡ ${kmFee}% 수수료</span>
              </div>

              <div style="margin-top: 10px;">
                  <div class="mc-card-info-row">
                     <i class="fa-solid fa-phone" style="width:16px; text-align:center; color:#94a3b8;"></i> 
                     <span style="font-weight:600; color:#334155;">${d.phone || "번호 미등록"}</span>
                  </div>
                  ${d.email ? `<div class="mc-card-info-row"><i class="fa-solid fa-envelope" style="width:16px; text-align:center; color:#94a3b8;"></i> <span>${d.email}</span></div>` : ''}
              </div>
              
              <div class="mc-card-desc">${d.desc || d.description || "상세 설명이 없습니다."}</div>
              
              ${d.website ? `
              <div class="mc-card-footer">
                 <a href="${d.website}" target="_blank" onclick="event.stopPropagation()" class="mc-link-btn">
                    <i class="fa-solid fa-globe"></i> 홈페이지 방문
                 </a>
              </div>
              ` : ''}
          </div>
        `;

            // Add Google Maps marker if coordinates exist
            const pos = parseCoords(d);
            if (pos && map) {
                const marker = new google.maps.Marker({
                    position: pos,
                    map: map,
                    title: d.name || "가맹점",
                    animation: google.maps.Animation.DROP
                });
                markers.push(marker);

                const infoHtml = `
                  <div style="padding:10px;font-family:sans-serif;max-width:240px;line-height:1.4;">
                    <div style="font-weight:800;font-size:15px;color:#0f172a;margin-bottom:4px;">${d.name || "가맹점"}</div>
                    <div style="font-size:12px;color:#f59e0b;font-weight:700;margin-bottom:6px;">🎟️ ${btCount} BT 보유</div>
                    <div style="font-size:12px;color:#64748b;margin-bottom:8px;">${d.career || ""} · ${d.region || ""}</div>
                    ${d.phone ? `<div style="font-size:12px;color:#334155;margin-bottom:8px;">📞 ${d.phone}</div>` : ""}
                    ${d.website ? `<a href="${d.website}" target="_blank" style="display:inline-block;padding:5px 10px;background:#7c3aed;color:#fff;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;">홈페이지 방문 →</a>` : ""}
                  </div>
                `;

                marker.addListener("click", () => {
                    infoWindow.setContent(infoHtml);
                    infoWindow.open(map, marker);
                });

                card.onclick = () => {
                    map.panTo(pos);
                    map.setZoom(16);
                    infoWindow.setContent(infoHtml);
                    infoWindow.open(map, marker);
                    window.scrollTo({ top: mapEl.offsetTop - 100, behavior: "smooth" });
                };

                bounds.extend(pos);
                validCoordsCount++;
            }

            grid.appendChild(card);
        });

        if (map && bounds && validCoordsCount > 0) {
            map.fitBounds(bounds);
            const listener = google.maps.event.addListener(map, "idle", () => {
                if (map.getZoom() > 16) map.setZoom(16);
                google.maps.event.removeListener(listener);
            });
        }
    } catch (err) {
        console.error("Error fetching merchants:", err);
        $("merchantGrid").innerHTML = "<div style='color:#e53e3e; font-size:0.9rem; padding: 20px;'>가맹점 데이터를 불러오는데 실패했습니다: " + err.message + "</div>";
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
