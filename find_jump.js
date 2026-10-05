const fs = require('fs');

const files = ['merchants.html', 'merchants.js', 'merchants.battle.js'];

files.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`\n--- ${file} ---`);
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
            if (/jump/i.test(line)) {
                console.log(`${i + 1}: ${line.trim()}`);
            }
        });
    }
});
