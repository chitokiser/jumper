const fs = require('fs');
const html = fs.readFileSync('merchants.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
$('script').each((i, el) => {
    const src = $(el).attr('src');
    if (src) console.log(src);
});
