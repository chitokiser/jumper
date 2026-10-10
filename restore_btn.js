const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('merchants.html', 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });

if ($('#btnVirtualMode').length === 0) {
    const btnHtml = `<button id="btnVirtualMode" class="map-hud-btn" title="Browse shops — warp to a shop" style="display:none;">🌍</button>`;
    const btnToggleHtml = `<button id="btnModeToggle" class="map-hud-btn" title="GPS Mode" style="display:none;font-size:10px;font-weight:800;flex-direction:column;line-height:1.2;color:#ef4444;"><span style="font-size:14px;margin-bottom:-2px;">📍</span>GPS</button>`;

    // Try inserting next to #btnFullscreen
    $('#btnFullscreen').before(btnHtml);
    $('#btnFullscreen').before(btnToggleHtml);

    fs.writeFileSync('merchants.html', $.html());
    console.log('Restored buttons with display:none');
} else {
    console.log('Buttons already exist');
}
