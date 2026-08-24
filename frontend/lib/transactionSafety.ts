import { getAddress, isAddress, keccak256, maxUint256, toHex, zeroAddress, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import type { SupportedAssetId } from "./assets.ts";
import { findKnownContract, type KnownContractCategory } from "./knownContracts.ts";

export type SafeJson = null | boolean | number | string | SafeJson[] | { [key: string]: SafeJson };
export type TransactionIntentKind = "send" | "memo-send" | "swap" | "bridge" | "vault-create" | "vault-deposit" | "vault-withdraw" | "approval";
export type TransactionIntent = {
  id: string; kind: TransactionIntentKind; chainId: number; account: Address; target: Address; targetLabel?: string;
  calldata: Hex; value: bigint; selector?: Hex; recipient?: Address;
  assetOut?: { assetId: SupportedAssetId; amount: bigint };
  assetIn?: { assetId: SupportedAssetId; expectedAmount?: bigint; minimumAmount?: bigint };
  approval?: { token: Address; spender: Address; amount: bigint; finite: boolean };
  gas?: { gasLimit: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; maxFeeRaw18?: bigint; maxFeeUsdc6?: bigint };
  quoteExpiresAt?: number; preparedAt: number; metadata?: Record<string, SafeJson>;
};
export type SafetyFinding = { code: string; message: string };
export type SafetyCheck = SafetyFinding & { status: "pass" | "warning" | "blocked" | "unknown" };
export type TransactionSafetyAssessment = { status: "ready" | "review" | "blocked" | "unknown"; checks: SafetyCheck[]; blockers: SafetyFinding[]; warnings: SafetyFinding[]; info: SafetyFinding[]; reviewedFingerprint: Hex; simulatedAt: number; target?: { label: string; category: KnownContractCategory } };
export type SafetyContext = { connectedAccount?: Address; connectedChainId?: number; balances?: Partial<Record<SupportedAssetId, bigint>>; allowance?: bigint; simulation: "passed" | "reverted" | "unavailable"; now?: number; expectedTarget?: Address; expectedCategory?: KnownContractCategory; managedTarget?: { label: string; category: KnownContractCategory } };
export type ExpectedChange = { assetId: SupportedAssetId; direction: "decrease" | "increase"; amount: bigint; qualifier: "exact" | "estimated" | "minimum" | "maximum" };

export function expectedTransactionChanges(intent: TransactionIntent): ExpectedChange[] {
  const changes: ExpectedChange[] = [];
  if (intent.assetOut) changes.push({ ...intent.assetOut, direction: "decrease", qualifier: "exact" });
  if (intent.assetIn?.minimumAmount !== undefined) changes.push({ assetId: intent.assetIn.assetId, amount: intent.assetIn.minimumAmount, direction: "increase", qualifier: "minimum" });
  else if (intent.assetIn?.expectedAmount !== undefined) changes.push({ assetId: intent.assetIn.assetId, amount: intent.assetIn.expectedAmount, direction: "increase", qualifier: "estimated" });
  if (intent.gas?.maxFeeUsdc6 !== undefined) changes.push({ assetId: "usdc", amount: intent.gas.maxFeeUsdc6, direction: "decrease", qualifier: "maximum" });
  return changes;
}

export function transactionFingerprint(intent: TransactionIntent): Hex {
  return keccak256(toHex(canonical({ chainId: intent.chainId, account: intent.account.toLowerCase(), target: intent.target.toLowerCase(), calldata: intent.calldata.toLowerCase(), selector: intent.selector?.toLowerCase(), value: intent.value, recipient: intent.recipient?.toLowerCase(), assetOut: intent.assetOut, assetIn: intent.assetIn, approval: intent.approval && { ...intent.approval, token: intent.approval.token.toLowerCase(), spender: intent.approval.spender.toLowerCase() }, gas: intent.gas, quoteExpiresAt: intent.quoteExpiresAt, metadata: intent.metadata })));
}

export function assessTransaction(intent: TransactionIntent, context: SafetyContext): TransactionSafetyAssessment {
  const now = context.now ?? Date.now(), checks: SafetyCheck[] = [];
  add(checks, context.connectedChainId === intent.chainId, "network-match", intent.chainId === arcTestnet.id ? `Arc Testnet · ${arcTestnet.id}` : `Chain · ${intent.chainId}`, "Wrong network");
  add(checks, Boolean(context.connectedAccount && getAddress(context.connectedAccount) === getAddress(intent.account)), "account-match", "Wallet verified", "Connected account changed");
  const known = findKnownContract(intent.target, intent.chainId) ?? context.managedTarget;
  const expectedTargetMatches = !context.expectedTarget || getAddress(context.expectedTarget) === getAddress(intent.target);
  const expectedCategoryMatches = !context.expectedCategory || known?.category === context.expectedCategory;
  checks.push(known && expectedTargetMatches && expectedCategoryMatches ? { code: "known-target", status: "pass", message: `Known contract · ${known.label}` } : { code: "known-target", status: context.expectedTarget || context.expectedCategory ? "blocked" : "unknown", message: "Contract not recognized by Makoto" });
  if (intent.recipient) add(checks, isAddress(intent.recipient) && getAddress(intent.recipient) !== zeroAddress, "recipient-valid", "Recipient verified", "Invalid recipient");
  if (intent.assetOut) {
    const balance = context.balances?.[intent.assetOut.assetId];
    add(checks, intent.assetOut.amount > 0n, "amount-valid", "Amount is valid", "Invalid amount");
    if (balance !== undefined) add(checks, intent.assetOut.amount <= balance, "balance-sufficient", "Amount fits balance", "Insufficient balance");
    if (intent.assetOut.assetId === "usdc" && balance !== undefined && intent.gas?.maxFeeUsdc6 !== undefined) add(checks, intent.assetOut.amount + intent.gas.maxFeeUsdc6 <= balance, "gas-covered", "Amount and maximum fee fit balance", "Insufficient balance for amount and maximum fee");
  }
  if (intent.approval) {
    const finite = intent.approval.finite && intent.approval.amount < maxUint256;
    add(checks, finite, "finite-approval", "Finite approval", "Unlimited approval is blocked");
    if (context.allowance !== undefined) checks.push({ code: "allowance-sufficient", status: context.allowance >= intent.approval.amount ? "pass" : "warning", message: context.allowance >= intent.approval.amount ? "No approval required" : "Finite approval required" });
  }
  if (intent.quoteExpiresAt !== undefined) add(checks, intent.quoteExpiresAt >= now, "quote-current", "Quote current", "Quote expired");
  checks.push(context.simulation === "passed" ? { code: "request-simulated", status: "pass", message: "Simulation passed" } : context.simulation === "reverted" ? { code: "request-simulated", status: "blocked", message: "Transaction simulation failed" } : { code: "request-simulated", status: "unknown", message: "Simulation unavailable" });
  const blockers = findings(checks, "blocked"), warnings = findings(checks, "warning"), unknown = findings(checks, "unknown");
  return { status: blockers.length ? "blocked" : unknown.length ? "unknown" : warnings.length ? "review" : "ready", checks, blockers, warnings, info: findings(checks, "pass"), reviewedFingerprint: transactionFingerprint(intent), simulatedAt: now, ...(known ? { target: { label: known.label, category: known.category } } : {}) };
}

export function assertReviewedRequest(intent: TransactionIntent, reviewedFingerprint: Hex) { if (transactionFingerprint(intent) !== reviewedFingerprint) throw new Error("Transaction details changed. Review again."); }
function add(checks: SafetyCheck[], pass: boolean, code: string, passed: string, blocked: string) { checks.push({ code, status: pass ? "pass" : "blocked", message: pass ? passed : blocked }); }
function findings(checks: SafetyCheck[], status: SafetyCheck["status"]): SafetyFinding[] { return checks.filter((check) => check.status === status).map(({ code, message }) => ({ code, message })); }
function canonical(value: unknown): string { if (typeof value === "bigint") return JSON.stringify(value.toString()); if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }
