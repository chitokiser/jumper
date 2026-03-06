import { ethers } from "ethers";
import { config } from "../config.js";
import { getContractHexBalance, transferHex } from "../chain/client.js";
import {
  getWallet,
  getHistory,
  createWithdrawRequest,
  getConfig,
  markClaimPaid,
  getClaimById,
  markClaimRejected,
  getPublicStats,
} from "./jackpotRepo.js";
import { validateDailyPayoutLimit } from "./securityService.js";

export async function getCurrentJackpot() {
  const balanceWei = await getContractHexBalance();
  const jackpotWei = balanceWei / 2n;
  const cfg = await getConfig();

  return {
    contractBalanceWei: balanceWei.toString(),
    contractBalanceHex: ethers.formatUnits(balanceWei, config.hexDecimals),
    jackpotDisplayWei: jackpotWei.toString(),
    jackpotDisplayHex: ethers.formatUnits(jackpotWei, config.hexDecimals),
    payoutScale: cfg.payoutScale.toString(),
    maxWinPercent: cfg.maxWinPercent,
    enabled: cfg.enabled,
  };
}

export async function getJackpotPublicStats() {
  const stats = await getPublicStats();
  return {
    winnerCount: stats.winnerCount,
    highestWinWei: stats.highestWinWei.toString(),
    highestWinHex: ethers.formatUnits(stats.highestWinWei, config.hexDecimals),
    lastRoundAt: stats.lastRoundAt,
  };
}

export async function getUserBalance(wallet) {
  return getWallet(wallet);
}

export async function getUserHistory(wallet, limit) {
  return getHistory(wallet, limit);
}

export async function requestWithdraw({ wallet, amountHex }) {
  const cfg = await getConfig();
  const requestedWei = ethers.parseUnits(String(amountHex), config.hexDecimals);

  if (requestedWei < cfg.minClaimWei) {
    throw new Error("MIN_CLAIM_NOT_MET");
  }

  const claim = await createWithdrawRequest({ userAddress: wallet, requestedWei });

  if (!config.autoApproveWithdraw) {
    return {
      claimId: claim.id,
      status: claim.status,
      requestedAt: claim.requestedAt,
      txHash: null,
    };
  }

  await validateDailyPayoutLimit(requestedWei);
  const txHash = await transferHex({ to: wallet, amountWei: requestedWei });

  await markClaimPaid({ claimId: claim.id, txHash, approvedWei: requestedWei });

  return {
    claimId: claim.id,
    status: "paid",
    requestedAt: claim.requestedAt,
    txHash,
  };
}

export async function adminApproveWithdraw({ claimId }) {
  const claim = await getClaimById(claimId);
  if (!claim) throw new Error("CLAIM_NOT_FOUND");
  if (claim.status !== "requested") throw new Error("INVALID_CLAIM_STATUS");

  const approvedWei = BigInt(claim.requestedWei);
  await validateDailyPayoutLimit(approvedWei);

  const txHash = await transferHex({ to: claim.userAddress, amountWei: approvedWei });
  await markClaimPaid({ claimId, txHash, approvedWei });

  return { claimId, status: "paid", txHash };
}

export async function adminRejectWithdraw({ claimId }) {
  const claim = await getClaimById(claimId);
  if (!claim) throw new Error("CLAIM_NOT_FOUND");
  if (claim.status !== "requested") throw new Error("INVALID_CLAIM_STATUS");

  await markClaimRejected(claimId);
  return { claimId, status: "rejected" };
}
