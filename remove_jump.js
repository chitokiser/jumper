const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('merchants.html', 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });

$('#coordJumpPanel').remove();
$('#coordJumpPopup').remove();
$('#btnCoordJumpFloat').remove();
$('#floatJumpCoordInput, #btnFloatJumpGo').remove();
$('[id*="jumpCoords"], [id*="jumpLat"], [id*="jumpLng"]').remove();

// Maybe also a toggle button for jump/gps if it exists
// Often it's an icon. A lot of the floating buttons might have it.
$('#btnGpsToggle').remove(); // If a toggle exists, we might want to keep it forced on GPS or just leave it.

fs.writeFileSync('merchants.html', $.html());
console.log('Removed jump UI from merchants.html');
