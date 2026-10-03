const fs = require('fs');
let content = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

// Remove existing module.exports block
content = content.replace(/module\.exports\s*=\s*\{[\s\S]*?\};/m, '');

// Append at the end
content += `

module.exports = {
  adminChargeBt,
  createBtRewardSession,
  receiveBtQrFirebase,
  consumeUserBtFirebase,
  exchangePointsToFiat,
  buyProduct,
  withdrawPayable,
  requestLevelUp,
  registerMerchantOnChain,
  adminSetMerchantFeeOnChain,
  adminApproveHex,
  adminCheckAllowance,
  adminGetContractStatus,
  adminRecordP2pTransfer,
  mergeWalletHexToPoints,
  payMerchantFirebase,
  adminOwnerDepositHex,
  payProductWithHex,
  adminBulkChangeMentor,
  adminSetUserLevel,
  transferHexToPersonal,
  redeemPoints,
};
`;

fs.writeFileSync('functions/handlers/transaction.js', content);
console.log('transaction.js patched');
