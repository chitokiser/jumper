const fs = require('fs');
const cheerio = require('cheerio');

const hbak = fs.readFileSync('merchants.html.bak', 'utf8');
const $bak = cheerio.load(hbak, { decodeEntities: false });

const overlay = $bak('#gameLoginOverlay');
if (overlay) {
    console.log(overlay.html().substring(0, 1000));
}
