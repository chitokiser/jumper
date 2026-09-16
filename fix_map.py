import re

def fix_map():
    with open('assets/js/pages/admin-treasure-box.js', 'r', encoding='utf-8') as f:
        content = f.read()

    idx = content.find('function initMap()')
    end_idx = content.find('\n// ── 데이터 로드', idx)
    
    if idx == -1 or end_idx == -1:
        print("Couldn't find target")
        return
        
    old_init_map = content[idx:end_idx]
    
    new_init_map = """function initMap() {
  // 기본값 (하노이)로 먼저 렌더링하고, GPS 권한을 얻으면 유저 위치로 이동
  const defaultPos = [21.0285, 105.8542];
  map = L.map('map').setView(defaultPos, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  editMarker = L.marker(defaultPos, {
    draggable: true,
    icon: L.divIcon({ html: '🎯', iconSize: [30, 30], className: '' })
  }).addTo(map);

  editMarker.on('dragend', e => {
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
      
      map.setView(userPos, 16); // 줌 인해서 내 위치 띄워줌
      editMarker.setLatLng(userPos);
      valLat.value = userLat.toFixed(6);
      valLng.value = userLng.toFixed(6);
      
      // 내 위치 표시용 파란 마커 추가
      L.marker(userPos, {
        icon: L.divIcon({ html: '🔵', iconSize: [20, 20], className: 'animate-bounce' })
      }).addTo(map).bindPopup("내 현재 위치").openPopup();
      
    }, (err) => {
      console.warn("GPS Location fetch failed or denied:", err.message);
    }, { enableHighAccuracy: true, timeout: 10000 });
  }
}"""
    # Replace the chunk
    new_content = content[:idx] + new_init_map + content[end_idx:]
    
    with open('assets/js/pages/admin-treasure-box.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Fixed!")

fix_map()
