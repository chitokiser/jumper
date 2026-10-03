const fs = require('fs');
['assets/js/pages/mypage.js', 'mypage.html'].forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/KM/g, 'BM').replace(/BestClub 가맹점 전용 머니/g, 'BEST CLUB MONEY');
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
});
