import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { arcTestnet } from "viem/chains";

export function isVerifiedArcReview(connectorChainId?: number, providerChainId?: number): boolean {
  return connectorChainId === arcTestnet.id && providerChainId === arcTestnet.id;
}

export type TransactionReviewKind = "send" | "swap" | "bridge" | "savingsDeposit" | "createJar" | "withdrawal" | "batchPayment" | "unifiedBalanceSpend";
export type SafetyCheckStatus = "verified" | "info" | "attention" | "blocking";
export type SafetyCheck = { code: string; status: SafetyCheckStatus; label: string; detail?: string };
export type ReviewSnapshot = {
  kind: TransactionReviewKind;
  account?: Address;
  chainId?: number;
  fields: Record<string, string | number | bigint | boolean | undefined>;
};

export function reviewFingerprint(snapshot: ReviewSnapshot): string {
  const fields = Object.entries(snapshot.fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${typeof value === "bigint" ? value.toString() : String(value ?? "")}`)
    .join("|");
  return `${snapshot.kind}|${snapshot.account?.toLowerCase() ?? ""}|${snapshot.chainId ?? ""}|${fields}`;
}

export function reviewStillCurrent(reviewed: ReviewSnapshot, current: ReviewSnapshot): boolean {
  return reviewFingerprint(reviewed) === reviewFingerprint(current);
}

export function globalReviewChecks(input: {
  connected: boolean;
  account?: Address;
  reviewedAccount?: Address;
  isArc: boolean;
  amount?: bigint;
  balance?: bigint;
}): SafetyCheck[] {
  const checks: SafetyCheck[] = [];
  if (!input.connected || !input.account) checks.push({ code: "wallet", status: "blocking", label: "Wallet not connected" });
  else if (input.reviewedAccount && getAddress(input.account) !== getAddress(input.reviewedAccount)) checks.push({ code: "account", status: "blocking", label: "Connected account changed" });
  else checks.push({ code: "wallet", status: "verified", label: "Connected wallet verified" });
  checks.push(input.isArc
    ? { code: "network", status: "verified", label: `Arc Testnet · ${arcTestnet.id}` }
    : { code: "network", status: "blocking", label: "Arc Testnet required" });
  if (input.amount === undefined || input.amount <= 0n) checks.push({ code: "amount", status: "blocking", label: "Enter a valid amount greater than zero" });
  else if (input.balance !== undefined && input.amount > input.balance) checks.push({ code: "balance", status: "blocking", label: "Insufficient available balance" });
  else checks.push({ code: "balance", status: "verified", label: "Amount is within available balance" });
  return checks;
}

export function sendRecipientChecks(recipient: string, account?: Address, knownRecipient = false, hasMemo = false): SafetyCheck[] {
  if (!isAddress(recipient) || getAddress(recipient) === zeroAddress) return [{ code: "recipient", status: "blocking", label: "Enter a valid non-zero recipient" }];
  const address = getAddress(recipient);
  const checks: SafetyCheck[] = [{ code: "recipient", status: "verified", label: "Recipient address is valid", detail: address }];
  if (account && address === getAddress(account)) checks.push({ code: "self", status: "attention", label: "Recipient is your connected wallet" });
  else if (!knownRecipient) checks.push({ code: "unknown-recipient", status: "attention", label: "Recipient is not saved in Contacts or Recents" });
  checks.push({ code: "memo", status: "info", label: hasMemo ? "Public on-chain memo" : "No on-chain memo" });
  return checks;
}

export function quoteFreshnessCheck(quotedAt: number, now: number, maxAgeMs: number): SafetyCheck {
  return now - quotedAt <= maxAgeMs
    ? { code: "quote", status: "verified", label: "Quote is current" }
    : { code: "quote", status: "blocking", label: "Quote expired" };
}

export function duplicateRecipientCheck(recipients: readonly string[]): SafetyCheck {
  const normalized = recipients.filter((recipient) => isAddress(recipient)).map((recipient) => getAddress(recipient).toLowerCase());
  return new Set(normalized).size === normalized.length
    ? { code: "duplicates", status: "verified", label: "Recipients are unique" }
    : { code: "duplicates", status: "blocking", label: "Remove duplicate recipients" };
}

export function hasBlockingChecks(checks: readonly SafetyCheck[]): boolean {
  return checks.some((check) => check.status === "blocking");
}
