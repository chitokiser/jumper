export function errorHandler(err, _req, res, _next) {
  const code = String(err.message || "INTERNAL_ERROR");
  const map = {
    VALIDATION_ERROR: 400,
    JACKPOT_DISABLED: 403,
    PAYMENT_TOO_SMALL: 400,
    MIN_CLAIM_NOT_MET: 400,
    ADMIN_ADDRESS_EXCLUDED: 403,
    MERCHANT_NOT_WHITELISTED: 403,
    SELF_PAYMENT_BLOCKED: 403,
    REPEAT_LIMIT_EXCEEDED: 429,
    INSUFFICIENT_CLAIMABLE: 400,
    DAILY_MAX_PAYOUT_EXCEEDED: 429,
    HOT_WALLET_PRIVATE_KEY_MISSING: 500,
    CLAIM_NOT_FOUND: 404,
    INVALID_CLAIM_STATUS: 400,
    ADMIN_UNAUTHORIZED: 401,
    ADMIN_KEY_NOT_CONFIGURED: 500,
  };

  res.status(map[code] || 500).json({
    ok: false,
    error: code,
    details: err.details || undefined,
  });
}
