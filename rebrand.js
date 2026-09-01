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

// Perform replacements
walkSync(directory, (filePath) => {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;

    // 1. Rebrand K-MOA to K-MOA
    content = content.replace(/K-MOA/g, 'K-MOA');

    // 2. Remove obsolete marketing text exactly (Korean)
    content = content.replace(//g, '');
    content = content.replace(//g, '');
    // English version
    content = content.replace(//g, '');
    content = content.replace(//g, '');

    // 3. Remove JUMP texts in town_home.i18n.js marquee
    if (filePath.endsWith('town_home.i18n.js')) {
        // English
        content = content.replace(/🌟 A win-win economic ecosystem, grow endlessly with JUMP &nbsp;•&nbsp; /g, '');
        // Korean
        content = content.replace(/🌟 상생하는 경제 생태계, JUMP와 함께 끝없이 성장하세요 &nbsp;•&nbsp; /g, '');
    }

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated: ${filePath}`);
    }
});

console.log('Rebranding and cleanup complete!');
