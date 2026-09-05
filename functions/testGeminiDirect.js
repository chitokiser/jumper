const fs = require('fs');

async function check() {
    const envText = fs.readFileSync('.env', 'utf8');
    let apiKey = '';
    envText.split('\n').forEach(line => {
        if (line.startsWith('GEMINI_API_KEY=')) {
            apiKey = line.split('=')[1].trim();
        }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
    });

    const data = await resp.json();
    console.log("Status:", resp.status);
    console.dir(data, { depth: null });
}
check();
