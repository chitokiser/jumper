const fs = require('fs');
let file = fs.readFileSync('index.js', 'utf8');
file = file.replace("const geminiSecret = defineSecret('GEMINI_API_KEY');\n", "");
file = file.replace("{ secrets: [geminiSecret], timeoutSeconds: 60 }", "{ timeoutSeconds: 60 }");
file = file.replace("geminiSecret.value()", "process.env.GEMINI_API_KEY");

// the other place
file = file.replace("secrets: [geminiSecret]", "");
file = file.replace("geminiSecret.value()", "process.env.GEMINI_API_KEY");
fs.writeFileSync('index.js', file);
