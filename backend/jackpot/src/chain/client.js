import { ethers } from "ethers";
import { config } from "../config.js";
import { ERC20_ABI, PAYMENT_EVENT_ABI } from "./abi.js";

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);

export const paymentContract = new ethers.Contract(
  config.paymentContractAddress,
  PAYMENT_EVENT_ABI,
  provider,
);

export const hexTokenRead = new ethers.Contract(
  config.hexTokenAddress,
  ERC20_ABI,
  provider,
);

export function getHexTokenWriteContract() {
  if (!config.hotWalletPrivateKey) {
    throw new Error("HOT_WALLET_PRIVATE_KEY_MISSING");
  }
  const signer = new ethers.Wallet(config.hotWalletPrivateKey, provider);
  return new ethers.Contract(config.hexTokenAddress, ERC20_ABI, signer);
}

export async function getContractHexBalance() {
  return BigInt(await hexTokenRead.balanceOf(config.paymentContractAddress));
}

export async function getReceipt(txHash) {
  return provider.getTransactionReceipt(txHash);
}

export async function getCurrentBlock() {
  return provider.getBlockNumber();
}

export async function transferHex({ to, amountWei }) {
  const token = getHexTokenWriteContract();
  const tx = await token.transfer(to, amountWei, {
    gasLimit: BigInt(config.withdrawGasLimit),
  });
  const receipt = await tx.wait(config.confirmations);
  if (!receipt || Number(receipt.status) !== 1) {
    throw new Error("WITHDRAW_TX_FAILED");
  }
  return tx.hash;
}
