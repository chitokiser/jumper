import re

def fix_map():
    with open('assets/js/pages/admin-treasure-box.js', 'r', encoding='utf-8') as f:
        content = f.read()

    new_init_map = """function initMap() {
  const defaultPos = [21.0285, 105.8542];
  map = L.map('map').setView(defaultPos, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  pinMarker = L.marker(defaultPos, {
    draggable: true,
    icon: L.divIcon({ html: '🎯', iconSize: [30, 30], className: '' })
  }).addTo(map);

  pinMarker.on('dragend', e => {
    const p = e.target.getLatLng();
    valLat.value = p.lat.toFixed(6);
    valLng.value = p.lng.toFixed(6);
  });

  // 유저 현재 위치 (GPS) 가져와서 지도 중심 맞추기
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const userLat = pos.coords.latitude;
      const userLng = pos.coords.longitude;
      const userPos = [userLat, userLng];
      
      map.setView(userPos, 16); // 내 위치로 이동 및 줌인
      pinMarker.setLatLng(userPos); // 과녁(저장포인트)을 내 위치로
      valLat.value = userLat.toFixed(6);
      valLng.value = userLng.toFixed(6);
      
      // 내 위치 파란 마커 추가
      L.marker(userPos, {
        icon: L.divIcon({ html: '🔵', iconSize: [20, 20], className: 'animate-bounce' })
      }).addTo(map).bindPopup("Current GPS").openPopup();
      
    }, (err) => {
      console.warn("GPS failed", err);
    }, { enableHighAccuracy: true });
  }
}
"""

    match = re.search(r'function initMap.*?async function loadBoxes', content, flags=re.DOTALL)
    if not match:
        print("Couldn't match.")
        return
        
    content = content[:match.start()] + new_init_map + "\nasync function loadBoxes" + content[match.end():]
    
    with open('assets/js/pages/admin-treasure-box.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed!")

fix_map()
