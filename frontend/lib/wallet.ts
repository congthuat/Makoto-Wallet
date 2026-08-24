import { getAddress, isAddress, parseUnits, type Address, type Hash } from "viem";
import type { SupportedAsset, SupportedAssetId } from "./assets";
import { normalizeDecimalInput } from "./decimalInput.ts";
const ARC_SCAN_URL = "https://testnet.arcscan.app";

export type WalletActivity = {
  hash: Hash;
  logIndex: number;
  direction: "send" | "receive";
  kind: "transfer" | "swap" | "bridge" | "vault-deposit" | "vault-withdraw";
  amount: bigint;
  counterparty: Address;
  confirmedAt: number;
  blockNumber: bigint;
  assetId: SupportedAssetId;
  assetSymbol: SupportedAsset["symbol"];
  tokenAddress: Address;
  decimals: number;
  source?: "local" | "onchain";
  provider?: "arcscan" | "rpc" | "local-receipt";
  swapReceive?: {
    amount: bigint;
    assetId: SupportedAssetId;
    assetSymbol: SupportedAsset["symbol"];
    tokenAddress: Address;
    decimals: number;
    logIndex: number;
  };
};

export function normalizeRecipient(value: string): Address | undefined {
  const trimmed = value.trim();
  return isAddress(trimmed) ? getAddress(trimmed) : undefined;
}

export function parseUsdcAmount(value: string): bigint | undefined {
  const normalized = normalizeDecimalInput(value, 6);
  if (!normalized) return undefined;
  try {
    const amount = parseUnits(normalized, 6);
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

export function isSelfSend(recipient: Address, sender?: Address) {
  return Boolean(sender && recipient.toLowerCase() === sender.toLowerCase());
}

export function maxUsdcAmount(balance: bigint) {
  return balance < 0n ? 0n : balance;
}

export function remainingUsdcBalance(balance: bigint, amount: bigint) {
  return amount > balance ? undefined : balance - amount;
}

export function validateUsdcSend(recipient: string, amount: string, balance: bigint, sender?: Address) {
  const address = normalizeRecipient(recipient);
  if (!address) return { error: "address" as const };
  if (isSelfSend(address, sender)) return { error: "self" as const };
  const parsedAmount = parseUsdcAmount(amount);
  if (!parsedAmount) return { error: "amount" as const };
  if (parsedAmount > balance) return { error: "balance" as const };
  return { address, amount: parsedAmount, remaining: balance - parsedAmount };
}

export function validateAssetSend(recipient: string, amount: string, balance: bigint, asset: SupportedAsset, sender?: Address) {
  const address = normalizeRecipient(recipient);
  if (!address) return { error: "address" as const };
  void sender;
  const normalized = normalizeDecimalInput(amount, asset.decimals);
  if (!normalized) return { error: "amount" as const };
  let parsedAmount: bigint;
  try { parsedAmount = parseUnits(normalized, asset.decimals); } catch { return { error: "amount" as const }; }
  if (parsedAmount <= 0n) return { error: "amount" as const };
  if (parsedAmount > balance) return { error: "balance" as const };
  return { address, amount: parsedAmount, remaining: balance - parsedAmount, tokenAddress: asset.address };
}

export const arcScanTransactionUrl = (hash: Hash | string) => `${ARC_SCAN_URL}/tx/${hash}`;
export const arcScanAddressUrl = (address: Address | string) => `${ARC_SCAN_URL}/address/${address}`;
