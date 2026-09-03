const fs = require('fs');

let header = fs.readFileSync('partials/header.html', 'utf8');

// Find the nav container (by the first <a> link inside <nav id="hdrNav"> )
const navRegex = /<nav class="nav" id="hdrNav">\s*<a/;
if (header.match(navRegex)) {
    header = header.replace(navRegex, `<nav class="nav" id="hdrNav">
      <a href="/treasure.html" data-hdr-i18n="hdr_play">게임하기</a>
      <a`);
}

fs.writeFileSync('partials/header.html', header, 'utf8');

let partialsJs = fs.readFileSync('assets/js/partials.js', 'utf8');
if (!partialsJs.includes('hdr_play')) {
    partialsJs = partialsJs.replace(/hdr_mall: 'Member Mall',/g, "hdr_mall: 'Member Mall', hdr_play: '🎮 Play',");
    partialsJs = partialsJs.replace(/hdr_mall: '회원전용몰',/g, "hdr_mall: '회원전용몰', hdr_play: '🎮 게임하기',");
    partialsJs = partialsJs.replace(/hdr_mall: 'Mall thành viên',/g, "hdr_mall: 'Mall thành viên', hdr_play: '🎮 Chơi game',");
    fs.writeFileSync('assets/js/partials.js', partialsJs, 'utf8');
}

console.log('Added 게임하기 nav link');
