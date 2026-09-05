const fs = require('fs');

let file = fs.readFileSync('index.js', 'utf8');

const toInsert = `
exports.claimWebzineShareReward = onCall(wrapError(async (request) => {
    const uid = requireAuth(request);
    return await webzineH.claimWebzineShareReward(uid, request.data ?? {});
}));

exports.adminGrantWebzineBonus = onCall(wrapError(async (request) => {
    const adminUid = requireAuth(request);
    await requireAdmin(adminUid);
    return await webzineH.adminGrantWebzineBonus(adminUid, request.data ?? {});
}));

exports.payMerchantFirebase = onCall(
`;

file = file.replace('exports.payMerchantFirebase = onCall(', toInsert);

fs.writeFileSync('index.js', file);
