const fs = require('fs');
const path = require('path');

const historyDir = 'C:\\Users\\Asus\\AppData\\Roaming\\Code\\User\\History';
if (!fs.existsSync(historyDir)) {
    console.log("No VS Code history found.");
    process.exit(0);
}

const folders = fs.readdirSync(historyDir);
let targetFound = 0;

for (const folder of folders) {
    const dPath = path.join(historyDir, folder);
    const entriesFile = path.join(dPath, 'entries.json');
    if (fs.existsSync(entriesFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(entriesFile, 'utf8'));
            if (data && data.resource && data.resource.toLowerCase().includes('jumper_v10')) {
                console.log(`Found ${data.resource} in ${dPath}`);
                targetFound++;
            }
        } catch (e) { }
    }
}
if (targetFound === 0) console.log("Did not find any files.");
