const fs = require('fs');
let lines = fs.readFileSync('functions/index.js', 'utf8').split('\n');

const i = lines.findIndex(l => l.includes('exports.adminSetMerchantFee = onCall('));
if (i !== -1) {
  let e = i + 1;
  while (e < lines.length && !lines[e].includes('// ════════════════════════════════════════════════════════════════════════════')) {
    e++;
  }
  lines.splice(i, e - i, `exports.adminSetMerchantFee = onCall(
  wrapError(async (request) => {
    requireAuth(request);
    const { merchantId, feeBps } = request.data ?? {};
    if (merchantId == null) throw new HttpsError('invalid-argument', 'merchantId 누락');
    const bps = feeBps !== undefined ? Number(feeBps) : 1000;
    if (!Number.isFinite(bps) || bps < 0 || bps > 10000)
      throw new HttpsError('invalid-argument', 'feeBps 오류');
    const result = await txH.adminSetMerchantFeeOnChain(Number(merchantId), bps);
    logger.info('adminSetMerchantFee', result);
    return result;
  })
);`);
  fs.writeFileSync('functions/index.js', lines.join('\n'));
  console.log('Fixed syntax');
} else {
  console.log('Not found');
}
