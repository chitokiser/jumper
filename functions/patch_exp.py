"""
EXP 연동 패치 스크립트
- transaction.js: expH require 추가, payMerchantFirebase + receiveBtQrFirebase에 EXP 부여
- membership.js: processReferralReward에 EXP 부여
"""
import re

# ── transaction.js ──────────────────────────────────────────────
with open('handlers/transaction.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1) expH require 추가 (파일 상단 'use strict'; 바로 다음)
if "require('./exp')" not in content:
    content = content.replace("'use strict';", "'use strict';\nconst expH = require('./exp');", 1)
    print("✓ Added expH require to transaction.js")

# 2) payMerchantFirebase: 반환 직전에 EXP 부여
# 현재 패턴: return { txHash, isJackpot... };\n  });\n}
old_pay = "    return { txHash, isJackpot: isWinner, amountHex: finalVnd, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '' };\n  });\n}"
new_pay = (
    "    const payResult = { txHash, isJackpot: isWinner, amountHex: finalVnd, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '' };\n"
    "    return payResult;\n"
    "  });\n"
    "\n"
    "  // EXP 부여: 100,000 VND당 100 EXP (트랜잭션 외부)\n"
    "  try {\n"
    "    const payExpAmt = Math.floor(finalVnd / 1000);\n"
    "    if (payExpAmt > 0) await expH.grantExp(uid, payExpAmt, 'payment');\n"
    "  } catch (_) { /* EXP 실패해도 결제 영향 없음 */ }\n"
    "\n"
    "  return result;\n"
    "}"
)
if old_pay in content:
    content = content.replace(old_pay, new_pay, 1)
    print("✓ payMerchantFirebase EXP added")
else:
    print("✗ payMerchantFirebase pattern not found — manual check needed")

# 3) receiveBtQrFirebase: BT 수령 후 EXP 부여 (BT 1개당 100 EXP)
# 현재 패턴: return { success: true, txHash, ...};\n  });\n}  (함수 끝)
old_bt = (
    "    return {\n"
    "      success: true,\n"
    "      txHash,\n"
    "      isJackpot: totalJackpotReward > 0,\n"
    "      amountVnd: 0, amountKrw: 0,\n"
    "      pointsEarned: totalJackpotReward,\n"
    "      btReceived: numBt,\n"
    "      merchantName: merchName,\n"
    "      potionsAdded, mpPotionsAdded, reviveAdded,\n"
    "      randomValue: firstGrade\n"
    "    };\n"
    "  });\n"
    "}"
)
new_bt = (
    "    const btResult = {\n"
    "      success: true,\n"
    "      txHash,\n"
    "      isJackpot: totalJackpotReward > 0,\n"
    "      amountVnd: 0, amountKrw: 0,\n"
    "      pointsEarned: totalJackpotReward,\n"
    "      btReceived: numBt,\n"
    "      merchantName: merchName,\n"
    "      potionsAdded, mpPotionsAdded, reviveAdded,\n"
    "      randomValue: firstGrade\n"
    "    };\n"
    "    return btResult;\n"
    "  });\n"
    "\n"
    "  // EXP 부여: BT 1개당 100 EXP (트랜잭션 외부)\n"
    "  try {\n"
    "    const btExpAmt = numBt * 100;\n"
    "    if (btExpAmt > 0) await expH.grantExp(uid, btExpAmt, 'bt');\n"
    "  } catch (_) { /* EXP 실패해도 BT 수령 영향 없음 */ }\n"
    "\n"
    "  return btResult;\n"
    "}"
)
if old_bt in content:
    content = content.replace(old_bt, new_bt, 1)
    print("✓ receiveBtQrFirebase EXP added")
else:
    print("✗ receiveBtQrFirebase pattern not found — manual check needed")

with open('handlers/transaction.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("transaction.js saved")

# ── membership.js ────────────────────────────────────────────────
with open('handlers/membership.js', 'r', encoding='utf-8') as f:
    mc = f.read()

if "require('./exp')" not in mc:
    mc = mc.replace("'use strict';", "'use strict';\nconst expH = require('./exp');", 1)
    print("✓ Added expH require to membership.js")

old_ref = (
    "  return { gpRewarded: REFERRAL_GP };\n"
    "}"
)
new_ref = (
    "  // EXP 부여: 추천인에게 1,000 EXP\n"
    "  try { await expH.grantExp(referrerUid, 1000, 'referral'); } catch (_) {}\n"
    "\n"
    "  return { gpRewarded: REFERRAL_GP };\n"
    "}"
)
if old_ref in mc:
    mc = mc.replace(old_ref, new_ref, 1)
    print("✓ processReferralReward EXP added")
else:
    print("✗ processReferralReward pattern not found")

with open('handlers/membership.js', 'w', encoding='utf-8') as f:
    f.write(mc)
print("membership.js saved")
