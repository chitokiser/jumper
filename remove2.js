const fs = require('fs');
const cheerio = require('cheerio');

const filePath = 'merchants.html';
const html = fs.readFileSync(filePath, 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });

$('#gameHub').remove();
$('#floatingGhCloseBtn').remove();
$('[id*="gameHub"]').remove();
$('[id*="floatingGh"]').remove();
$('[class*="gh-"]').remove(); // To remove any game hub related classes if left behind outside

// specifically for "온체인" and "TON" that might be elsewhere:
$('*').contents().filter(function () {
    return this.nodeType === 3 && (this.data.includes('온체인') || this.data.includes('TON'));
}).parent().remove();

// Check if any Ton script is there
$('script').each((i, el) => {
    const content = $(el).html();
    if (content && (content.includes('TON') || content.includes('gameHub') || content.includes('gh-'))) {
        // If it's a huge script, we can't just delete it. We only delete scripts with src.
    }
});

fs.writeFileSync('merchants.html', $.html());
console.log("merchants.html cleaned successfully round 2.");
