import { ethers } from "ethers";

export function toWei(hexAmount, decimals = 18) {
  return ethers.parseUnits(String(hexAmount), decimals);
}

export function fromWei(wei, decimals = 18) {
  return ethers.formatUnits(BigInt(wei), decimals);
}

export function lower(addr) {
  return String(addr || "").toLowerCase();
}
