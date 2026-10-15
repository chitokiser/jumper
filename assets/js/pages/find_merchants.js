import { db } from "../firebase-init.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
let map = null;
let roadmapLayer = null;
let satelliteLayer = null;
const markers = [];

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

function createGmapPin(logoUrl, name) {
    const initial = (name || "가").charAt(0);
    const content = logoUrl
        ? `<img src="${logoUrl}" alt="${name}" onerror="this.onerror=null;this.parentElement.innerHTML='${initial}'">`
        : `<span>${initial}</span>`;

    return L.divIcon({
        className: "custom-gmap-pin-wrap",
        html: `
            <div class="custom-gmap-pin">
                <svg class="pin-svg" viewBox="0 0 38 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 0C8.5 0 0 8.5 0 19C0 32 19 48 19 48C19 48 38 32 38 19C38 8.5 29.5 0 19 0Z" fill="#EA4335"/>
                    <circle cx="19" cy="18" r="14" fill="#B3261E"/>
                    <circle cx="19" cy="18" r="11" fill="#FFFFFF"/>
                </svg>
                <div class="pin-badge">${content}</div>
            </div>
        `,
        iconSize: [38, 48],
        iconAnchor: [19, 48],
        popupAnchor: [0, -46]
    });
}

function initMap() {
    const mapEl = $("merchantMap");
    if (!mapEl || !window.L) return;

    // Center on Hanoi region
    map = L.map("merchantMap", {
        center: [21.005, 105.775],
        zoom: 12,
        zoomControl: true
    });

    // Google Maps Roadmap tile layer (Zero billing error, high definition)
    roadmapLayer = L.tileLayer("https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=ko&gl=VN", {
        maxZoom: 20,
        subdomains: ["0", "1", "2", "3"],
        attribution: '&copy; <a href="https://maps.google.com" target="_blank">Google Maps</a>'
    }).addTo(map);

    // Google Maps Satellite (Hybrid) tile layer
    satelliteLayer = L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=ko&gl=VN", {
        maxZoom: 20,
        subdomains: ["0", "1", "2", "3"],
        attribution: '&copy; <a href="https://maps.google.com" target="_blank">Google Maps</a>'
    });

    // Layer switch controls
    const btnRoadmap = $("btnRoadmap");
    const btnSatellite = $("btnSatellite");

    if (btnRoadmap && btnSatellite) {
        btnRoadmap.addEventListener("click", () => {
            if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
            if (!map.hasLayer(roadmapLayer)) map.addLayer(roadmapLayer);
            btnRoadmap.classList.add("active");
            btnSatellite.classList.remove("active");
        });

        btnSatellite.addEventListener("click", () => {
            if (map.hasLayer(roadmapLayer)) map.removeLayer(roadmapLayer);
            if (!map.hasLayer(satelliteLayer)) map.addLayer(satelliteLayer);
            btnSatellite.classList.add("active");
            btnRoadmap.classList.remove("active");
        });
    }
}

async function init() {
    initMap();

    try {
        const q = query(collection(db, "merchants"), where("active", "==", true));
        const snap = await getDocs(q);
        const grid = $("merchantGrid");
        const mapEl = $("merchantMap");

        if (snap.empty) {
            grid.innerHTML = "<div style='color:#888; font-size:0.9rem; padding: 20px;'>등록된 가맹점이 없습니다.</div>";
            return;
        }

        const validLatLngs = [];

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
              
              <div class="mc-card-footer" style="display:flex; justify-content:space-between; align-items:center;">
                 ${d.website ? `
                 <a href="${d.website}" target="_blank" onclick="event.stopPropagation()" class="mc-link-btn">
                    <i class="fa-solid fa-globe"></i> 홈페이지
                 </a>` : '<span></span>'}
                 <span style="font-size:12px; color:#ea4335; font-weight:700;"><i class="fa-solid fa-location-dot"></i> 지도에서 보기</span>
              </div>
          </div>
        `;

            // Add marker if coordinates exist
            const pos = parseCoords(d);
            if (pos && map) {
                const markerIcon = createGmapPin(d.logoUrl || d.imageUrl, d.name);
                const marker = L.marker([pos.lat, pos.lng], { icon: markerIcon }).addTo(map);
                markers.push(marker);

                const popupHtml = `
                  <div class="gmap-popup-card">
                    <div class="gmap-popup-header">
                      <div class="gmap-popup-name" title="${d.name || "가맹점"}">${d.name || "가맹점"}</div>
                      <div class="gmap-popup-bt">🎟️ ${btCount} BT</div>
                    </div>
                    <div class="gmap-popup-body">
                      <div class="gmap-popup-meta">${d.career || ""} · ${d.region || ""}</div>
                      ${d.phone ? `<div class="gmap-popup-row"><i class="fa-solid fa-phone" style="color:#64748b;"></i> <a href="tel:${d.phone}">${d.phone}</a></div>` : ""}
                      <div class="gmap-popup-actions">
                        ${d.website ? `<a href="${d.website}" target="_blank" class="gmap-btn-link"><i class="fa-solid fa-globe"></i> 홈피</a>` : ""}
                        <a href="https://www.google.com/maps/dir/?api=1&destination=${pos.lat},${pos.lng}" target="_blank" class="gmap-btn-nav"><i class="fa-solid fa-diamond-turn-right"></i> 길찾기</a>
                      </div>
                    </div>
                  </div>
                `;

                marker.bindPopup(popupHtml, { maxWidth: 280, minWidth: 240 });

                // Card click interaction
                card.onclick = () => {
                    map.flyTo([pos.lat, pos.lng], 16, { duration: 0.8 });
                    setTimeout(() => {
                        marker.openPopup();
                    }, 850);
                    if (mapEl) {
                        const top = mapEl.getBoundingClientRect().top + window.pageYOffset - 80;
                        window.scrollTo({ top, behavior: "smooth" });
                    }
                };

                validLatLngs.push([pos.lat, pos.lng]);
            }

            grid.appendChild(card);
        });

        // Fit map to show all markers
        if (map && validLatLngs.length > 0) {
            map.fitBounds(L.latLngBounds(validLatLngs), { padding: [50, 50], maxZoom: 15 });
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
