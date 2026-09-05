const fs = require('fs');
let file = fs.readFileSync('index.js', 'utf8');

// Strip out the corrupted buildWebzineContent attempts
file = file.replace(/exports\.buildWebzineContent =.*?exports\.payMerchantFirebase = onCall\(/s, 'exports.payMerchantFirebase = onCall(');
file = file.replace(/exports\.buildWebzineContent.*?(?=\n)/g, ''); // strip any single line attempt

// Now properly insert it
const toInsert = `
// ════════════════════════════════════════════════════════════════════════════
// 19-B. 웹진 기사 생성 (AI)
//     클라이언트: httpsCallable(functions, 'buildWebzineContent')({ merchantId: 1 })
// ════════════════════════════════════════════════════════════════════════════
exports.buildWebzineContent = onCall(
  { secrets: [geminiSecret], timeoutSeconds: 60 },
  wrapError(async (request) => {
    const adminUid = requireAuth(request);
    await requireAdmin(adminUid);
    return await webzineH.buildWebzineContent(adminUid, request.data ?? {}, geminiSecret.value());
  })
);

exports.payMerchantFirebase = onCall(`;

file = file.replace('exports.payMerchantFirebase = onCall(', toInsert);

fs.writeFileSync('index.js', file);
