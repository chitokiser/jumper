const fs = require('fs');
const path = require('path');

function replaceInFile(filepath, replacements) {
    if (!fs.existsSync(filepath)) return;
    try {
        let original = fs.readFileSync(filepath, 'utf8');
        let modified = original;

        for (const { from, to } of replacements) {
            modified = modified.replace(from, to);
        }

        if (modified !== original) {
            fs.writeFileSync(filepath, modified, 'utf8');
            console.log(`Updated: ${filepath}`);
        }
    } catch (e) {
        // ignore
    }
}

// 1. Rebrand BestClub / BestClub / BestClub / BestClub to BestClub
function walk(dir, callback) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file.startsWith('.env') || file.startsWith('.antigravity')) continue;
        const filepath = path.join(dir, file);
        const stats = fs.statSync(filepath);
        if (stats.isDirectory()) {
            walk(filepath, callback);
        } else if (stats.isFile()) {
            callback(filepath);
        }
    }
}

walk(__dirname, (filepath) => {
    const ext = path.extname(filepath);
    if (!['.html', '.js', '.css', '.json', '.md'].includes(ext)) {
        return;
    }
    try {
        let content = fs.readFileSync(filepath, 'utf8');
        let newContent = content.replace(/BestClub/g, 'BestClub');
        newContent = newContent.replace(/BestClub/g, 'BestClub');
        newContent = newContent.replace(/BestClub/g, 'BestClub');
        newContent = newContent.replace(/BestClub/g, 'BestClub');
        newContent = newContent.replace(/BestClub/g, 'BestClub');
        newContent = newContent.replace(/BestClub/g, 'BestClub');
        newContent = newContent.replace(/BestClub/g, 'BestClub');
        newContent = newContent.replace(/BestClub/g, 'BestClub');
        if (content !== newContent) {
            fs.writeFileSync(filepath, newContent, 'utf8');
        }
    } catch (e) { }
});

// 2. Remove BestClub text next to logo in header.html
let headerPath = path.join(__dirname, 'partials', 'header.html');
replaceInFile(headerPath, [
    {
        from: /<span[^>]*>BestClub<\/span>/i,
        to: ''
    },
    {
        from: /<div class="nav-group">\s*<a href="\/kca_webzine.html"[^>]*>K-CULTURE<\/a>\s*<\/div>/i,
        to: ''
    }
]);

// 3. Change BestClub to best-club in admin_notices.html title
let adminNoticesPath = path.join(__dirname, 'admin_notices.html');
replaceInFile(adminNoticesPath, [
    {
        from: /<title>공지관리 - BestClub<\/title>/i,
        to: '<title>공지관리 - best-club</title>'
    },
    {
        // just in case it was already corrupted or wasn't changed
        from: /<title>怨듭\?愿由\?- BestClub<\/title>/i,
        to: '<title>怨듭?愿由?- best-club</title>'
    }
]);

console.log("All requested UI changes done safely.");
