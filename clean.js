const fs = require('fs');
const cheerio = require('cheerio');

const filePath = 'merchants.html';
const html = fs.readFileSync(filePath, 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });

// The main game hub wrapper missing from round 1
$('#gameHub').remove();
$('#floatingGhCloseBtn').remove();
$('#gameHubModal').remove();
$('#gameLoginOverlay').remove();
$('#walletModal, #connectModal, #tonHistoryModal, #usdtHistoryModal').remove();

// Buttons triggering the hub or on-chain
$('[onclick*="showGhTab"]').remove();
$('[onclick*="gameHub"]').remove();
$('[onclick*="ghEnterGame"]').remove();
$('[onclick*="closeGh"]').remove();
$('#btnOverlayLogin, #btnOverlayTelegram, #btnOverlayAnon').remove();
$('.gh-tab-btn').remove();
$('.game-hub').remove();

// Other elements related to Game hub mechanics or Ton
$('[id*="ghTab"]').remove();
$('[id*="tonHistory"]').remove();
$('[id*="coin"]').remove();

// Nav/Footer words filtering
$('li, a, button').filter(function () {
    const text = $(this).text();
    return text.includes('게임 허브') || text.includes('게임허브') || text.includes('USDT') || text.includes('TON') || text.includes('지갑');
}).remove();

// Clean meta tags
$('title').text('보물 지도 · 숨기기 | BestClub — 위치기반 보물 게임');
$('meta[name="description"]').attr('content', '내 보물을 지도에 숨겨 다른 유저가 찾게 하세요. 베트남 여행 중 즐기는 위치기반 보물 게임 — BestClub.');
$('meta[name="keywords"]').attr('content', 'K-컬쳐, BestClub, k-culture, 위치기반게임, 보물찾기');
$('link[href*="ton"]').remove();
$('script[src*="ton"]').remove();
$('script[src*="telegram.org"]').remove();
$('script[src*="twa"]').remove();

// Any element having id with "gh" that looks like gamehub UI
$('[id^="gh"]').each(function () {
    if (this.attribs.id && !this.attribs.id.includes('ghLang')) {
        $(this).remove();
    }
});

// Write it back
fs.writeFileSync('merchants.html', $.html());
console.log('Cleaned');
