const { readdirSync, lstatSync, readFileSync, writeFileSync } = require('fs');
const { join, extname } = require('path');

const directory = 'c:\\Users\\Asus\\Desktop\\project\\jumper\\jumper_v10';
const extensions = ['.html', '.js', '.json', '.md', '.py', '.css'];
const skipDirs = ['node_modules', '.git', '.firebase', '.claude'];

function traverse(dir) {
    let files;
    try {
        files = readdirSync(dir);
    } catch (e) {
        return;
    }

    for (const file of files) {
        if (skipDirs.includes(file)) continue;
        const fullPath = join(dir, file);
        try {
            if (lstatSync(fullPath).isDirectory()) {
                traverse(fullPath);
            } else {
                if (extensions.includes(extname(fullPath))) {
                    replaceInFile(fullPath);
                }
            }
        } catch (e) {
            console.error(`Error on ${fullPath}:`, e.message);
        }
    }
}

function replaceInFile(filePath) {
    try {
        const content = readFileSync(filePath, 'utf8');
        let replaced = content.replace(/K-MOA/g, "K-MOA");
        replaced = replaced.replace(/k-culture/g, "k-culture");
        replaced = replaced.replace(/K-MOA/g, "K-MOA");
        replaced = replaced.replace(/K-Culture Alliance/g, "K-Culture Alliance");
        replaced = replaced.replace(/K-컬쳐/g, "K-컬쳐");

        if (content !== replaced) {
            writeFileSync(filePath, replaced, 'utf8');
            console.log(`Updated: ${filePath}`);
        }
    } catch (e) { }
}

traverse(directory);
console.log("Done.");
