import { ethers } from "ethers";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { paymentContract, getCurrentBlock, getContractHexBalance, getReceipt } from "./client.js";
import {
  getListenerBlock,
  setListenerBlock,
  txExists,
  recordRound,
} from "../services/jackpotRepo.js";
import { validatePaymentForJackpot } from "../services/securityService.js";
import { hmacRandom, calcJackpotWin } from "../services/jackpotMath.js";

function toMerchantId(rawValue) {
  if (typeof rawValue === "string" && rawValue.startsWith("0x") && rawValue.length === 66) {
    try {
      return ethers.decodeBytes32String(rawValue).replace(/\u0000/g, "");
    } catch {
      return rawValue;
    }
  }
  return String(rawValue ?? "");
}

function mapEventLog(log) {
  return {
    txHash: log.transactionHash,
    blockNumber: Number(log.blockNumber),
    merchantId: toMerchantId(log.args?.merchantId),
    userAddress: String(log.args?.buyer ?? ""),
    paymentAmountWei: BigInt(log.args?.amountWei ?? 0n),
    feeAmountWei: BigInt(log.args?.feeWei ?? 0n),
  };
}

async function processEvent(ev) {
  const exists = await txExists(ev.txHash);
  if (exists) return;

  const receipt = await getReceipt(ev.txHash);
  if (!receipt || Number(receipt.status) !== 1) {
    logger.warn({ txHash: ev.txHash }, "skip failed tx");
    return;
  }

  const currentBlock = await getCurrentBlock();
  if (currentBlock - ev.blockNumber < config.confirmations) {
    logger.info({ txHash: ev.txHash }, "skip tx without enough confirmations");
    return;
  }

  const cfg = await validatePaymentForJackpot({
    userAddress: ev.userAddress,
    merchantId: ev.merchantId,
    paymentAmountWei: ev.paymentAmountWei,
  });

  const contractBalanceWei = await getContractHexBalance();
  const jackpotDisplayWei = contractBalanceWei / 2n;

  const randomValue = hmacRandom({
    secret: config.jackpotHmacSecret,
    txHash: ev.txHash,
    userAddress: ev.userAddress,
    paymentAmountWei: ev.paymentAmountWei,
    blockNumber: ev.blockNumber,
  });

  const { rawWinWei, maxWinWei, finalWinWei } = calcJackpotWin({
    jackpotWei: jackpotDisplayWei,
    paymentWei: ev.paymentAmountWei,
    random: randomValue,
    payoutScale: cfg.payoutScale,
    maxWinPercent: cfg.maxWinPercent,
    decimals: config.hexDecimals,
  });

  if (finalWinWei > jackpotDisplayWei) {
    throw new Error("INVALID_FINAL_WIN_GT_JACKPOT");
  }
  if (finalWinWei > maxWinWei) {
    throw new Error("INVALID_FINAL_WIN_GT_MAX");
  }

  const block = await paymentContract.runner.provider.getBlock(ev.blockNumber);

  await recordRound({
    txHash: ev.txHash,
    userAddress: ev.userAddress,
    merchantId: ev.merchantId,
    paymentAmountWei: ev.paymentAmountWei,
    feeAmountWei: ev.feeAmountWei,
    blockNumber: ev.blockNumber,
    paidAt: block ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString(),
    contractBalanceWei,
    jackpotDisplayWei,
    randomValue,
    rawWinWei,
    maxWinWei,
    finalWinWei,
  });

  logger.info(
    {
      txHash: ev.txHash,
      userAddress: ev.userAddress,
      paymentAmountWei: ev.paymentAmountWei.toString(),
      finalWinWei: finalWinWei.toString(),
      randomValue,
    },
    "jackpot round recorded",
  );
}

function paymentFilter() {
  const named = paymentContract.filters?.[config.paymentEventName];
  if (typeof named === "function") return named();
  return paymentContract.filters.PaidHex();
}

export async function runListenerOnce() {
  const networkBlock = await getCurrentBlock();
  const safeToBlock = networkBlock - config.confirmations;
  if (safeToBlock <= 0) return;

  const lastSaved = await getListenerBlock();
  const fromBlock = lastSaved > 0 ? lastSaved + 1 : config.startBlock || safeToBlock;
  const toBlock = Math.max(fromBlock, safeToBlock);

  if (fromBlock > toBlock) return;

  logger.info({ fromBlock, toBlock }, "scan payment events");

  const logs = await paymentContract.queryFilter(paymentFilter(), fromBlock, toBlock);

  for (const log of logs) {
    try {
      await processEvent(mapEventLog(log));
    } catch (err) {
      logger.error({ err, txHash: log.transactionHash }, "failed to process payment event");
    }
  }

  await setListenerBlock(toBlock);
}

export async function runListenerLoop() {
  logger.info({ pollMs: config.pollIntervalMs }, "listener started");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runListenerOnce();
    } catch (err) {
      logger.error({ err }, "listener cycle failed");
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  runListenerLoop().catch((err) => {
    logger.error({ err }, "listener fatal");
    process.exit(1);
  });
}
