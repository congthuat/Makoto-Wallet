import { encodeFunctionData, formatUnits, type Address, type PublicClient } from "viem";

import { erc20BalanceAbi } from "../abi/erc20.ts";
import { arcFeeToUsdcAtomic, calculateArcFee } from "../arcFees.ts";
import { getAssetById, parseAssetAmount, type SupportedAssetId } from "../assets.ts";
import type { WalletActivity } from "../wallet.ts";
import type { AgentContextSnapshot, AgentIntent } from "./types.ts";

export type AgentBlockingCode =
  | "wrong-network"
  | "invalid-recipient"
  | "insufficient-token-balance"
  | "insufficient-gas-balance"
  | "wallet-rejection"
  | "reverted-simulation"
  | "unknown-confirmation"
  | "allowance-required"
  | "quote-unavailable"
  | "stale-quote"
  | "gas-estimate-unavailable"
  | "bridge-route-unavailable";

export type AgentPlanningResult = Readonly<{
  kind: "latest-transaction" | "today-spending" | "send-affordability" | "send-remaining" | "blocking-explanation";
  status: "ready" | "blocked" | "unavailable";
  dataTimestamp: number;
  expiresAt?: number;
  refreshRequired: boolean;
  completeness: "complete" | "partial" | "unavailable";
  activity?: WalletActivity;
  spending?: Readonly<Partial<Record<SupportedAssetId, bigint>>>;
  assetId?: SupportedAssetId;
  balance?: bigint;
  gasBalance?: bigint;
  amount?: bigint;
  maximumFeeRaw18?: bigint;
  maximumFeeUsdc6?: bigint;
  remainingBeforeFees?: bigint;
  remaining?: bigint;
  remainingGasBalance?: bigint;
  tokenBalanceCovers?: boolean;
  feeAwareAffordable?: boolean;
  blockingReasons: readonly AgentBlockingCode[];
}>;

export type AgentPlanningServices = Readonly<{
  estimateSendMaximumFee(input: Readonly<{ account: Address; recipient: Address; assetId: SupportedAssetId; amount: bigint }>): Promise<bigint | undefined>;
}>;

const FEE_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

function activityCompleteness(snapshot: AgentContextSnapshot): AgentPlanningResult["completeness"] {
  return snapshot.activityUnavailable ? "unavailable" : snapshot.activityPartial ? "partial" : "complete";
}

export function latestConfirmedTransaction(snapshot: AgentContextSnapshot): AgentPlanningResult {
  const activity = [...snapshot.activity].sort(compareActivity)[0];
  const completeness = activityCompleteness(snapshot);
  return Object.freeze({
    kind: "latest-transaction",
    status: completeness === "unavailable" ? "unavailable" : "ready",
    dataTimestamp: snapshot.timestamp,
    refreshRequired: snapshot.activityUnavailable,
    completeness,
    ...(activity ? { activity } : {}),
    blockingReasons: Object.freeze([]),
  });
}

export function confirmedSpendingToday(snapshot: AgentContextSnapshot, timezoneOffsetMinutes = new Date(snapshot.timestamp).getTimezoneOffset()): AgentPlanningResult {
  const day = localDay(snapshot.timestamp, timezoneOffsetMinutes);
  const spending: Partial<Record<SupportedAssetId, bigint>> = {};
  for (const item of snapshot.activity) {
    if (item.direction !== "send" || localDay(item.confirmedAt, timezoneOffsetMinutes) !== day) continue;
    spending[item.assetId] = (spending[item.assetId] ?? 0n) + item.amount;
  }
  const completeness = activityCompleteness(snapshot);
  return Object.freeze({
    kind: "today-spending",
    status: completeness === "unavailable" ? "unavailable" : "ready",
    dataTimestamp: snapshot.timestamp,
    refreshRequired: snapshot.activityUnavailable,
    completeness,
    spending: Object.freeze(spending),
    blockingReasons: Object.freeze([]),
  });
}

export function planSend(snapshot: AgentContextSnapshot, intent: AgentIntent, maximumFeeRaw18?: bigint): AgentPlanningResult {
  const assetId = intent.assetId ?? "usdc";
  const asset = getAssetById(assetId);
  const balance = snapshot.balances[assetId];
  const gasBalance = snapshot.balances.usdc;
  const amount = asset && intent.amount ? parseAssetAmount(intent.amount, asset) : undefined;
  const reasons: AgentBlockingCode[] = [];
  if (!snapshot.isArc) reasons.push("wrong-network");
  if (!amount || balance === undefined) return unavailableSend(snapshot, intent, reasons);
  const tokenBalanceCovers = amount <= balance;
  const remainingBeforeFees = tokenBalanceCovers ? balance - amount : undefined;
  if (!tokenBalanceCovers) reasons.push("insufficient-token-balance");
  const maximumFeeUsdc6 = maximumFeeRaw18 === undefined ? undefined : arcFeeToUsdcAtomic(maximumFeeRaw18);
  let feeAwareAffordable: boolean | undefined;
  let remaining: bigint | undefined;
  let remainingGasBalance: bigint | undefined;
  if (maximumFeeUsdc6 === undefined || gasBalance === undefined) reasons.push("gas-estimate-unavailable");
  else if (assetId === "usdc") {
    feeAwareAffordable = tokenBalanceCovers && amount + maximumFeeUsdc6 <= balance;
    if (!feeAwareAffordable && tokenBalanceCovers) reasons.push("insufficient-gas-balance");
    if (feeAwareAffordable) remaining = balance - amount - maximumFeeUsdc6;
  } else {
    feeAwareAffordable = tokenBalanceCovers && maximumFeeUsdc6 <= gasBalance;
    if (maximumFeeUsdc6 > gasBalance) reasons.push("insufficient-gas-balance");
    if (tokenBalanceCovers) remaining = balance - amount;
    if (maximumFeeUsdc6 <= gasBalance) remainingGasBalance = gasBalance - maximumFeeUsdc6;
  }
  const dynamicReady = maximumFeeUsdc6 !== undefined && gasBalance !== undefined;
  return Object.freeze({
    kind: intent.kind === "send-remaining" ? "send-remaining" : "send-affordability",
    status: reasons.some((reason) => reason !== "gas-estimate-unavailable") ? "blocked" : dynamicReady ? "ready" : "unavailable",
    dataTimestamp: snapshot.timestamp,
    ...(dynamicReady ? { expiresAt: snapshot.timestamp + FEE_TTL_MS } : {}),
    refreshRequired: !dynamicReady,
    completeness: dynamicReady ? "complete" : "partial",
    assetId,
    balance,
    gasBalance,
    amount,
    ...(maximumFeeRaw18 !== undefined ? { maximumFeeRaw18 } : {}),
    ...(maximumFeeUsdc6 !== undefined ? { maximumFeeUsdc6 } : {}),
    ...(remainingBeforeFees !== undefined ? { remainingBeforeFees } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(remainingGasBalance !== undefined ? { remainingGasBalance } : {}),
    tokenBalanceCovers,
    ...(feeAwareAffordable !== undefined ? { feeAwareAffordable } : {}),
    blockingReasons: Object.freeze(reasons),
  });
}

export function explainBlocking(code: AgentBlockingCode, timestamp = Date.now()): AgentPlanningResult {
  return Object.freeze({ kind: "blocking-explanation", status: "blocked", dataTimestamp: timestamp, refreshRequired: false, completeness: "complete", blockingReasons: Object.freeze([code]) });
}

export async function resolveAgentPlanning(snapshot: AgentContextSnapshot, intent: AgentIntent, services?: AgentPlanningServices): Promise<AgentPlanningResult | undefined> {
  if (intent.kind === "latest-transaction") return latestConfirmedTransaction(snapshot);
  if (intent.kind === "today-spending") return confirmedSpendingToday(snapshot, intent.timezoneOffsetMinutes);
  if (intent.kind === "blocking-explanation" && intent.blockingCode) return explainBlocking(intent.blockingCode, snapshot.timestamp);
  if (intent.kind !== "send-affordability" && intent.kind !== "send-remaining") return undefined;
  const assetId = intent.assetId ?? "usdc";
  const asset = getAssetById(assetId);
  const amount = asset && intent.amount ? parseAssetAmount(intent.amount, asset) : undefined;
  let fee: bigint | undefined;
  if (services && snapshot.account && intent.recipient && amount) {
    fee = await services.estimateSendMaximumFee({ account: snapshot.account, recipient: intent.recipient, assetId, amount }).catch(() => undefined);
  }
  return planSend(snapshot, intent, fee);
}

export function createAgentPlanningServices(client: PublicClient | undefined): AgentPlanningServices | undefined {
  if (!client) return undefined;
  return Object.freeze({
    async estimateSendMaximumFee({ account, recipient, assetId, amount }) {
      const asset = getAssetById(assetId);
      if (!asset) return undefined;
      const data = encodeFunctionData({ abi: erc20BalanceAbi, functionName: "transfer", args: [recipient, amount] });
      const gas = await client.estimateGas({ account, to: asset.address, data });
      const fees = await client.estimateFeesPerGas();
      const price = fees.maxFeePerGas ?? (await client.getGasPrice());
      return calculateArcFee(gas, price).rawFee;
    },
  });
}

export function blockingExplanation(code: AgentBlockingCode, vi: boolean) {
  const en: Record<AgentBlockingCode, string> = {
    "wrong-network": "Your wallet is not on Arc Testnet. No transaction was prepared.",
    "invalid-recipient": "The recipient address is invalid. No transaction was prepared.",
    "insufficient-token-balance": "Your token balance does not cover the requested amount.",
    "insufficient-gas-balance": "Your balance covers the amount, but not the current maximum network fee.",
    "wallet-rejection": "The wallet request was rejected. Nothing was submitted.",
    "reverted-simulation": "The read-only simulation reverted. No transaction was prepared.",
    "unknown-confirmation": "A transaction hash exists, but its confirmation state is still unknown.",
    "allowance-required": "This action needs a finite token approval before it can proceed.",
    "quote-unavailable": "A current quote is unavailable. No transaction was prepared.",
    "stale-quote": "The quote expired. Request a fresh quote before reviewing.",
    "gas-estimate-unavailable": "The network fee estimate is unavailable, so safe affordability cannot be confirmed.",
    "bridge-route-unavailable": "The bridge route provider is unavailable; no transaction was prepared.",
  };
  if (!vi) return en[code];
  const translated: Record<AgentBlockingCode, string> = {
    "wrong-network": "Ví của bạn không ở Arc Testnet. Chưa có giao dịch nào được chuẩn bị.",
    "invalid-recipient": "Địa chỉ người nhận không hợp lệ. Chưa có giao dịch nào được chuẩn bị.",
    "insufficient-token-balance": "Số dư token không đủ cho số tiền yêu cầu.",
    "insufficient-gas-balance": "Số dư đủ cho số tiền gửi, nhưng không đủ cho phí mạng tối đa hiện tại.",
    "wallet-rejection": "Yêu cầu đã bị từ chối trong ví. Không có giao dịch nào được gửi.",
    "reverted-simulation": "Mô phỏng chỉ đọc đã thất bại. Chưa có giao dịch nào được chuẩn bị.",
    "unknown-confirmation": "Đã có mã giao dịch, nhưng trạng thái xác nhận vẫn chưa xác định.",
    "allowance-required": "Hành động này cần một quyền token giới hạn trước khi tiếp tục.",
    "quote-unavailable": "Báo giá hiện tại không khả dụng. Chưa có giao dịch nào được chuẩn bị.",
    "stale-quote": "Báo giá đã hết hạn. Hãy yêu cầu báo giá mới trước khi xem xét.",
    "gas-estimate-unavailable": "Ước tính phí mạng không khả dụng nên chưa thể xác nhận khả năng chi trả an toàn.",
    "bridge-route-unavailable": "Nhà cung cấp tuyến bridge không khả dụng; chưa có giao dịch nào được chuẩn bị.",
  };
  return translated[code];
}

export function formatPlanningAmount(value: bigint | undefined, assetId: SupportedAssetId) {
  return value === undefined ? "unavailable" : formatUnits(value, getAssetById(assetId)!.decimals);
}

function unavailableSend(snapshot: AgentContextSnapshot, intent: AgentIntent, reasons: AgentBlockingCode[]): AgentPlanningResult {
  return Object.freeze({ kind: intent.kind === "send-remaining" ? "send-remaining" : "send-affordability", status: "unavailable", dataTimestamp: snapshot.timestamp, refreshRequired: true, completeness: "unavailable", assetId: intent.assetId ?? "usdc", blockingReasons: Object.freeze(reasons) });
}
function compareActivity(a: WalletActivity, b: WalletActivity) {
  if (b.confirmedAt !== a.confirmedAt) return b.confirmedAt - a.confirmedAt;
  if (b.blockNumber !== a.blockNumber) return b.blockNumber > a.blockNumber ? 1 : -1;
  return b.logIndex - a.logIndex;
}
function localDay(timestamp: number, offsetMinutes: number) { return Math.floor((timestamp - offsetMinutes * 60_000) / DAY_MS); }
