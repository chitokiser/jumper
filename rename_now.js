const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === '.vscode') continue;
        const filepath = path.join(dir, file);
        const stats = fs.statSync(filepath);
        if (stats.isDirectory()) {
            walk(filepath, callback);
        } else if (stats.isFile()) {
            callback(filepath);
        }
    }
}

let count = 0;
walk(__dirname, (filepath) => {
    const ext = path.extname(filepath);
    if (!['.html', '.js', '.css', '.json', '.md'].includes(ext)) return;

    // Do not touch our own scripts
    if (filepath.endsWith('replace_name.js') || filepath.endsWith('do_changes.js') || filepath.endsWith('do_merchants.js') || filepath.endsWith('rename_now.js')) return;

    try {
        let original = fs.readFileSync(filepath, 'utf8');
        let modified = original;

        // Replace all variants
        modified = modified.replace(/K-MOA/g, 'BestClub');
        modified = modified.replace(/k-moa/g, 'BestClub');
        modified = modified.replace(/B-MOA/g, 'BestClub');
        modified = modified.replace(/b-moa/g, 'BestClub');
        modified = modified.replace(/KMOA/g, 'BestClub');
        modified = modified.replace(/BMOA/g, 'BestClub');
        modified = modified.replace(/Kmoa/g, 'BestClub');
        modified = modified.replace(/Bmoa/g, 'BestClub');

        if (modified !== original) {
            fs.writeFileSync(filepath, modified, 'utf8');
            count++;
        }
    } catch (e) { }
});

console.log(`Replaced K-MOA variants with BestClub in ${count} files.`);
