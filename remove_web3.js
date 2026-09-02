const fs = require('fs');
let html = fs.readFileSync('mypage.html', 'utf8');

html = html.replace(/온체인 결제/g, '인앱 자동 결제');
html = html.replace(/온체인 등록/g, '앱 서비스 등록');
html = html.replace(/수탁 지갑의 Point가/g, '가맹점 전용 잔고가');
html = html.replace(/수탁 지갑으로/g, '내 정보로');
html = html.replace(/수탁 지갑 생성/g, '계정 생성');
html = html.replace(/내 지갑 정보/g, '내 멤버십 정보');
html = html.replace(/지갑 주소/g, '멤버십 주소');
html = html.replace(/jp-onchain-badge/g, 'jp-onchain-badge'); // CSS class, keep it if it's there
html = html.replace(/<span class="jp-onchain-badge">On-chain<\/span>/g, '');

fs.writeFileSync('mypage.html', html, 'utf8');
console.log('mypage.html replaced');

let js = fs.readFileSync('assets/js/pages/mypage.js', 'utf8');
js = js.replace(/온체인/g, '서비스');
js = js.replace(/On-chain/g, 'System');
js = js.replace(/수탁 지갑/g, '포인트 계좌');
fs.writeFileSync('assets/js/pages/mypage.js', js, 'utf8');
console.log('mypage.js replaced');
