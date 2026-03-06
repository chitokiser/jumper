import crypto from "node:crypto";

const TEN_THOUSAND = 10000n;
const ONE_MILLION = 1000000n;

export function hmacRandom({ secret, txHash, userAddress, paymentAmountWei, blockNumber }) {
  const message = `${txHash}${userAddress}${paymentAmountWei.toString()}${blockNumber}`;
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const rand = BigInt(`0x${digest}`) % TEN_THOUSAND;
  return Number(rand);
}

export function minBigInt(...values) {
  return values.reduce((a, b) => (a < b ? a : b));
}

// Uses token-unit formula with wei-safe conversion.
// rawWin = jackpot * payment * random / 1,000,000 / payoutScale
export function calcJackpotWin({
  jackpotWei,
  paymentWei,
  random,
  payoutScale,
  maxWinPercent,
  decimals,
}) {
  const base = 10n ** BigInt(decimals);

  const jackpotUnits = (jackpotWei * ONE_MILLION) / base;
  const paymentUnits = (paymentWei * ONE_MILLION) / base;

  const rawUnits =
    (jackpotUnits * paymentUnits * BigInt(random)) /
    ONE_MILLION /
    payoutScale /
    ONE_MILLION;

  const rawWinWei = (rawUnits * base) / ONE_MILLION;
  const maxWinWei = (jackpotWei * BigInt(Math.floor(maxWinPercent * 100))) / 10000n;

  const finalWinWei = minBigInt(rawWinWei, maxWinWei, jackpotWei);

  return {
    rawWinWei,
    maxWinWei,
    finalWinWei,
  };
}
