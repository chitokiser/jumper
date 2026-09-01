const fs = require('fs');
const content = fs.readFileSync('index.js', 'utf8');

const regexes = [
    /exports\.createWallet\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.adminSelfOnboard\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.registerMember\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.linkMentor\s*=\s*onRequest\([\s\S]*?\n\);\n/m,
    /exports\.getMyOnChain\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.requestLevelUp\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.buyProduct\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.withdraw\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.adminApproveHex\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.adminCheckAllowance\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.adminGetContractStatus\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.adminRecordP2pTransfer\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.mergeWalletHexToPoints\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.redeemPoints\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.registerMerchant\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.adminUpdateMerchantFee\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.getMyOnChainMentees\s*=\s*onCall\([\s\S]*?\n\);\n/m,
    /exports\.getJumpBankStatus\s*=\s*onCall\([\s\S]*?\n\);\n/m,
];

let newContent = content;
for (const rx of regexes) {
    newContent = newContent.replace(rx, '');
}

fs.writeFileSync('index.js', newContent);
console.log('Successfully removed web3 endpoints.');
