const fs = require('fs');
const file = 'functions/handlers/transaction.js';
let lines = fs.readFileSync(file, 'utf8').split('\n');
// find the index of "const admin = require('firebase-admin');"
const idx = lines.findIndex(l => l.includes("require('firebase-admin')"));
if (idx !== -1 && !lines.some(l => l.includes("require('firebase-functions')"))) {
    lines.splice(idx + 1, 0, "const functions = require('firebase-functions');\r");
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    console.log("SUCCESS: functions imported.");
} else {
    console.log("ALREADY IMPORTED OR ADMIN NOT FOUND");
}
