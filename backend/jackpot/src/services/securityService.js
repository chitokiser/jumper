import { config } from "../config.js";
import {
  isWhitelistedMerchant,
  getMerchantWallet,
  checkRepeatLimit,
  getDailyPayoutWei,
  getConfig,
} from "./jackpotRepo.js";
import { lower } from "../utils/units.js";

export async function validatePaymentForJackpot({
  userAddress,
  merchantId,
  paymentAmountWei,
}) {
  const cfg = await getConfig();

  if (!cfg.enabled) {
    throw new Error("JACKPOT_DISABLED");
  }

  if (paymentAmountWei < cfg.minPaymentWei) {
    throw new Error("PAYMENT_TOO_SMALL");
  }

  if (config.adminExcludedAddresses.includes(lower(userAddress))) {
    throw new Error("ADMIN_ADDRESS_EXCLUDED");
  }

  const whitelistOk = await isWhitelistedMerchant(merchantId);
  if (!whitelistOk) {
    throw new Error("MERCHANT_NOT_WHITELISTED");
  }

  if (config.selfPaymentBlock) {
    const merchantWallet = await getMerchantWallet(merchantId);
    if (merchantWallet && merchantWallet === lower(userAddress)) {
      throw new Error("SELF_PAYMENT_BLOCKED");
    }
  }

  const repeatOk = await checkRepeatLimit({
    userAddress,
    limitCount: config.repeatLimitPer10Min,
  });

  if (!repeatOk) {
    throw new Error("REPEAT_LIMIT_EXCEEDED");
  }

  return cfg;
}

export async function validateDailyPayoutLimit(approvedWei) {
  const cfg = await getConfig();
  const usedToday = await getDailyPayoutWei();
  if (usedToday + approvedWei > cfg.dailyMaxPayoutWei) {
    throw new Error("DAILY_MAX_PAYOUT_EXCEEDED");
  }
}
