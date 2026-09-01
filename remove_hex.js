const fs = require('fs');
const path = require('path');

const directory = '.';
const ignoreFolders = ['node_modules', '.git', '.gemini', 'assets/images'];
const targetExtensions = ['.html', '.js', '.md', '.txt'];

function walkSync(dir, callback) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!ignoreFolders.some(i => fullPath.includes(i))) {
                walkSync(fullPath, callback);
            }
        } else {
            const ext = path.extname(fullPath).toLowerCase();
            if (targetExtensions.includes(ext)) {
                callback(fullPath);
            }
        }
    }
}

walkSync(directory, (filePath) => {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;

    // Replace Point-related keywords in Korean / General
    content = content.replace(/포인트 잔고/g, '포인트 잔고');
    content = content.replace(/포인트/g, '포인트');
    content = content.replace(/Point Balance/gi, 'Point Balance');
    content = content.replace(/Points/gi, 'Points');
    content = content.replace(/Point/g, 'Point');

    // Replace Token concepts
    content = content.replace(/포인트 거래소/g, '포인트 거래소');
    content = content.replace(/포인트 거래소/g, '포인트 거래소');
    content = content.replace(/포인트 거래/g, '포인트 거래');
    content = content.replace(/Point Exchange/gi, 'Point Exchange');
    content = content.replace(/Point Trade/gi, 'Point Trade');
    content = content.replace(/포인트/g, '포인트');

    // Also catch 'hexdao_title' and 'hexdao_sub' in town_home.i18n.js
    if (filePath.endsWith('town_home.i18n.js')) {
        content = content.replace(/Point DAO 거래소/g, 'DAO 거래소');
        content = content.replace(/Point DAO Exchange/g, 'DAO Exchange');
    }

    if (filePath.endsWith('mypage.js') || filePath.endsWith('merchant-qr.js') || filePath.endsWith('pay.js')) {
        // Ensure any code variables that we blindly search-and-replace to 'Point' that might break don't break,
        // But wait! We already removed the on-chain logic which used 'hexBalance'. The backend now uses 'pointBalanceVnd'.
        // Replacing 'Point' with 'Point' globally might change variable names like 'payMerchantHex' to 'payMerchantPoint'.
        // But we already refactored them to 'payMerchantFirebase'.
    }

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated: ${filePath}`);
    }
});
console.log('Point token removal complete!');
