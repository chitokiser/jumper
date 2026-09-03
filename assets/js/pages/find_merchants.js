import { db } from "../firebase-init.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
let map = null;
let markers = [];

async function loadMapScript() {
    let apiKey = window.__mapsKey || "";
    if (!apiKey) {
        try {
            const sysSnap = await getDocs(collection(db, "sys"));
            sysSnap.forEach(doc => {
                if (doc.id === "config" && doc.data().mapsKey) apiKey = doc.data().mapsKey;
            });
        } catch (e) {
            console.warn("Failed to fetch sys/config mapsKey:", e);
        }
    }

    // Fallback key (from index.html)
    if (!apiKey) {
        apiKey = "AIzaSyC5zrzVsTqshKYI4vS3og6jXaS-vlx2ujM";
    }

    return new Promise(resolve => {
        window.__findMerchantMapCb = () => resolve(true);
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=__findMerchantMapCb&language=ko`;
        document.head.appendChild(script);
    });
}

async function init() {
    const mapEl = $("merchantMap");
    const loaded = await loadMapScript();

    if (loaded) {
        map = new google.maps.Map(mapEl, {
            center: { lat: 21.0285, lng: 105.8542 }, // Default to Hanoi
            zoom: 12,
            disableDefaultUI: false,
        });
    } else {
        if (mapEl) mapEl.innerHTML = "지도 정보를 불러올 수 없습니다.";
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

        snap.forEach(docSnap => {
            const d = docSnap.data();

            // Create card
            const card = document.createElement("div");
            card.className = "mc-card";
            card.innerHTML = `
          <div class="mc-card-name">${d.name || "이름 없음"}</div>
          <div class="mc-card-career">${d.career || "미분류"}</div>
          <div class="mc-card-region">${d.region || ""}</div>
          <div class="mc-card-phone">📞 ${d.phone || "번호 미등록"}</div>
          <div class="mc-card-desc">${d.desc || ""}</div>
        `;

            // Add marker if coordinates exist
            if (d.lat && d.lng && map) {
                const pos = { lat: Number(d.lat), lng: Number(d.lng) };
                const marker = new google.maps.Marker({
                    position: pos,
                    map: map,
                    title: d.name
                });
                bounds.extend(pos);

                card.onclick = () => {
                    map.setCenter(pos);
                    map.setZoom(15);
                    window.scrollTo({ top: mapEl.offsetTop - 120, behavior: "smooth" });
                };
            }

            grid.appendChild(card);
        });

        if (map && bounds && !bounds.isEmpty()) {
            map.fitBounds(bounds);
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
