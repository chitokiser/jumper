const fs = require('fs');
let b = fs.readFileSync('partials/header.html', 'utf8');

// The original block looks like:
/*
      <div class="nav-group">
        <a href="/find_merchants.html" class="nav-group-title" style="text-decoration:none;"
          data-hdr-i18n="hdr_merchants">Find Merchants</a>
      </div>
*/

b = b.replace(
  '<div class="nav-group">\r\n        <a href="/find_merchants.html" class="nav-group-title" style="text-decoration:none;"\r\n          data-hdr-i18n="hdr_merchants">Find Merchants</a>\r\n      </div>',
  `<div class="nav-group">
        <a href="/merchants.html" class="nav-group-title" style="text-decoration:none;">🎮 게임하기</a>
      </div>
      <div class="nav-group">
        <a href="/find_merchants.html" class="nav-group-title" style="text-decoration:none;">🗺️ 가맹점 찾기 (Find Merchants)</a>
      </div>`
);

b = b.replace(
  '<div class="nav-group">\n        <a href="/find_merchants.html" class="nav-group-title" style="text-decoration:none;"\n          data-hdr-i18n="hdr_merchants">Find Merchants</a>\n      </div>',
  `<div class="nav-group">
        <a href="/merchants.html" class="nav-group-title" style="text-decoration:none;">🎮 게임하기</a>
      </div>
      <div class="nav-group">
        <a href="/find_merchants.html" class="nav-group-title" style="text-decoration:none;">🗺️ 가맹점 찾기 (Find Merchants)</a>
      </div>`
);

fs.writeFileSync('partials/header.html', b, 'utf8');
console.log("Updated header.html");
