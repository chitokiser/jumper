const fs = require('fs');
const cheerio = require('cheerio');

const hbak = fs.readFileSync('merchants.html.bak', 'utf8');
const $bak = cheerio.load(hbak, { decodeEntities: false });

const html = fs.readFileSync('merchants.html', 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });

// Restore the login overlay
const overlay = $bak('#gameLoginOverlay').html();
// We append the wrapper if it doesn't exist
if ($('#gameLoginOverlay').length === 0) {
    $('body').append('<div id="gameLoginOverlay" style="position:fixed;inset:0;background:rgba(10,15,20,0.85);backdrop-filter:blur(8px);z-index:9000;display:flex;align-items:center;justify-content:center;">' + overlay + '</div>');
}

// Ensure #btnOverlayAnon and #btnOverlayLogin are present, as they were the login buttons
// Let's also restore #btnMyId or things required by treasure map.
// Actually, it's easier to just restore the entire #gameLoginOverlay, since it contains the login buttons.
fs.writeFileSync('merchants.html', $.html());
console.log('Restored gameLoginOverlay');
