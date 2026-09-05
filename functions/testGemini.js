const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function check() {
    const envText = fs.readFileSync('.env', 'utf8');
    let apiKey = '';
    // parse manually
    envText.split('\n').forEach(line => {
        if (line.startsWith('GEMINI_API_KEY=')) {
            apiKey = line.split('=')[1].trim();
        }
    });

    if (!apiKey || apiKey.includes('여기에')) {
        console.log("Error: API Key seems empty or not set properly.");
        return;
    }

    process.env.GEMINI_API_KEY = apiKey;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    try {
        const result = await model.generateContent('이 문장에 "제미나이 연동 성공"이라고 포함해서 한 문장으로 답변해줘.');
        console.log('--- TEST SUCCESS ---');
        console.log(result.response.text());
    } catch (e) {
        console.log('--- TEST FAILED ---');
        console.error(e);
    }
}
check();
