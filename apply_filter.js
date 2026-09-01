const fs = require('fs');
const file = 'assets/js/pages/merchants.js';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `  allMerchants.sort((a, b) => (b._latLng ? 1 : 0) - (a._latLng ? 1 : 0));

  // 지도 + 카드 즉시 표시`;

const replaceStr = `  allMerchants.sort((a, b) => (b._latLng ? 1 : 0) - (a._latLng ? 1 : 0));

  // KCA: URL 쿼리 파라미터(type) 기반 카테고리 필터링
  const urlParams = new URLSearchParams(window.location.search);
  const filterType = urlParams.get('type');
  
  if (filterType) {
    allMerchants = allMerchants.filter(m => {
      const typeStr = (m.type || '').toLowerCase();
      const catStr = (m.category || '').toLowerCase();
      const target = filterType.toLowerCase();
      return typeStr === target || catStr === target || typeStr.includes(target) || catStr.includes(target);
    });
  }

  // 필터가 'food'일 경우 상단에 K-Food 웹진 렌더링
  if (filterType === 'food') {
    _loadKFoodWebzine();
  }

  // 지도 + 카드 즉시 표시`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, replaceStr);

    // _loadKFoodWebzine 함수 추가 (init 함수 바로 앞에)
    const fnStr = `
// ── [KCA] K-Food 웹진 연동 (Zentaro API) ──────────────────────────────────
async function _loadKFoodWebzine() {
  const container = document.createElement('div');
  container.className = 'kca-webzine-container';
  container.style.cssText = 'padding:16px; margin: 16px 0; background:rgba(0,0,0,0.4); border-radius:12px; border:1px solid rgba(255,100,50,0.3);';
  container.innerHTML = '<h3 style="color:#fcd34d; margin-bottom:12px; font-weight:700;">🔥 K-Food DNA & Webzine</h3><div id="webzineList" style="display:flex; gap:12px; overflow-x:auto; padding-bottom:8px;"></div>';
  
  const grid = document.getElementById('mcGrid');
  if (grid) {
    grid.parentNode.insertBefore(container, grid);
  }

  try {
    const listEl = document.getElementById('webzineList');
    listEl.innerHTML = '<span style="color:#aaa;">웹진 로딩 중...</span>';
    
    // Zentaro 프로젝트 API (포트 3000 가정)
    const res = await fetch('http://localhost:3000/api/webzine-post');
    if (!res.ok) throw new Error('API fetch failed');
    const posts = await res.json();
    
    if (posts && posts.length > 0) {
      listEl.innerHTML = posts.map(p => \`
        <div style="min-width:200px; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; display:inline-block; vertical-align:top;">
          <h4 style="margin:0 0 6px 0; font-size:14px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">\${p.titleKo || p.titleEn}</h4>
          <p style="margin:0; font-size:11px; color:#aaa; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">\${(p.contentHtmlKo || p.contentHtmlEn || '').replace(/<[^>]*>?/gm, '')}</p>
        </div>
      \`).join('');
    } else {
      listEl.innerHTML = '<span style="color:#aaa;">현재 발행된 웹진이 없습니다.</span>';
    }
  } catch(e) {
    console.warn('Webzine load error:', e);
    const listEl = document.getElementById('webzineList');
    if (listEl) listEl.innerHTML = '<span style="color:#f87171; font-size:12px;">오프라인 모드: 웹진 서버(Zentaro)에 연결할 수 없습니다. 포트(3000)를 확인해주세요.</span>';
  }
}

async function init() {`;

    content = content.replace('async function init() {', fnStr);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Successfully patched merchants.js with url filtering and webzine load');
} else {
    console.log('Target string not found in merchants.js!');
}
