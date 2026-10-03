const fs = require('fs');
let h = fs.readFileSync('index.html', 'utf8');

// The file has a massive block of space in the middle of <meta name="keywords" ...>
let kIndex = h.indexOf('<meta name="keywords"');
let pIndex = h.indexOf('<meta name="robots"');
if (kIndex > 0 && pIndex > kIndex) {
    let cleanKeywords = '<meta name="keywords" content="BestClub, k-culture, treasure hunt, monster racing, speed memory, archery, monster defense, coin game, TON game, USDT game, Toncoin rewards, game points, GP, Treasure Hunt, Monster Racing, Speed Memory, Archery, Monster Defense, Game Points, Toncoin Rewards, USDT Rewards, Web3 game, blockchain game, M2E, location-based game, AR treasure" />\n  ';
    h = h.substring(0, kIndex) + cleanKeywords + h.substring(pIndex);
}

// And a massive block of space in the middle of the FAQ JSON
let qIndex = h.indexOf('"What is BestClub?"');
let rIndex = h.indexOf('"name": "Is it available in Vietnam?"');
if (qIndex > 0 && rIndex > qIndex) {
    let cleanFAQ = '"What is BestClub?", "acceptedAnswer": { "@type": "Answer", "text": "BestClub is a location-based Web3 M2E platform that hides digital treasures in real spaces and connects human movement to economic value." } },\n      { "@type": "Question", ';
    h = h.substring(0, qIndex) + cleanFAQ + h.substring(rIndex);
}

// And the hero banner town-title
let h1Index = h.indexOf('<h1 class="town-title"');
let pSubIndex = h.indexOf('class="town-subtitle"');
if (h1Index > 0 && pSubIndex > h1Index) {
    let cleanH1 = '<h1 class="town-title" style="font-size: clamp(2.5rem, 6vw, 4rem); font-weight: 900; background: linear-gradient(to right, #facc15, #f59e0b); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));">\n          BestClub ALLIANCE\n        </h1>\n        <p ';
    h = h.substring(0, h1Index) + cleanH1 + h.substring(pSubIndex);
}

// And the hero-actions cta
let aIndex = h.indexOf('<a class="btn hero-cta-btn" href="/mypage.html#merchantPaySection"');
let aEndIndex = h.indexOf('<a class="btn hero-cta-btn" href="/merchant-qr.html"');
if (aIndex > 0 && aEndIndex > aIndex) {
    let cleanA = '<a class="btn hero-cta-btn" href="/mypage.html#merchantPaySection"\n            style="background: linear-gradient(135deg, #10b981, #059669); color: white; border:none; padding: 14px 28px; font-weight: 700; border-radius: 99px; transition: all 0.3s ease; cursor: pointer; box-shadow: 0 4px 15px rgba(16, 185, 127, 0.4); display:flex; align-items:center; gap:8px;">\n            <span style="font-size:1.2rem;">💰</span> 머니 충전하기\n          </a>\n          ';
    h = h.substring(0, aIndex) + cleanA + h.substring(aEndIndex);
}

fs.writeFileSync('index.html', h, 'utf8');
console.log('index.html Fixed!');
