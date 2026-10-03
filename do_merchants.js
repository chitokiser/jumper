const fs = require('fs');
const path = require('path');

// 1. Modify header.css
const headerCssPath = path.join(__dirname, 'assets', 'css', 'header.css');
let headerCss = fs.readFileSync(headerCssPath, 'utf8');
headerCss = headerCss.replace(/z-index: 50;/g, 'z-index: 10000;');
fs.writeFileSync(headerCssPath, headerCss, 'utf8');

// 2. Modify merchants.html
const merchantsPath = path.join(__dirname, 'merchants.html');
let merchantsHtml = fs.readFileSync(merchantsPath, 'utf8');

// Hide .gh-header
merchantsHtml = merchantsHtml.replace(
    /(\.gh-header\s*\{\s*position:\s*relative;)/,
    '.gh-header { display: none !important; position: relative;'
);

// Add top padding to gameHub to avoid overlapping with new standard header
merchantsHtml = merchantsHtml.replace(
    /(#gameHub\s*\{\s*position:\s*fixed;)/,
    '$1 padding-top: 60px;'
);

// Add floating close button since we hid the gh-header which contained the close button
merchantsHtml = merchantsHtml.replace(
    /(<div id="gameHub">)/,
    `$1\n<button id="floatingGhCloseBtn" style="position:absolute; top:70px; right:20px; z-index:9999; background:rgba(0,0,0,0.5); color:#fff; border:none; padding:8px 12px; border-radius:8px; cursor:pointer; font-weight:bold;">&times; Close Hub</button>`
);

// Bind the new close button in JS
merchantsHtml = merchantsHtml.replace(
    /(document\.getElementById\('ghCloseBtn'\)\?\.addEventListener\('click',\s*hideHub\);)/,
    `$1\ndocument.getElementById('floatingGhCloseBtn')?.addEventListener('click', hideHub);`
);

fs.writeFileSync(merchantsPath, merchantsHtml, 'utf8');

console.log("merchants.html header update applied!");
