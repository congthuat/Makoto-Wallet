import { encodeFunctionData, formatUnits, getAddress, parseUnits, zeroHash, type Address, type PublicClient } from "viem";

import { erc20BalanceAbi } from "../abi/erc20.ts";
import { arcFeeToUsdcAtomic, calculateArcFee } from "../arcFees.ts";
import { getAssetById, parseAssetAmount, type SupportedAssetId } from "../assets.ts";
import { requestBridgePlanningData, type BridgePlanningData, type BridgePlanningRequest } from "../circle/bridgePlanning.ts";
import { getCircleAppKit } from "../circle/appKit.ts";
import { routeSupportedByAppKit } from "../circle/bridge.ts";
import { unifiedChainById } from "../circle/chains.ts";
import { addressToBytes32, BASE_SEPOLIA_CCTP_DOMAIN, calculateCctpForwardingAmounts, CCTP_FORWARDING_HOOK_DATA, CCTP_STANDARD_FINALITY, CCTP_TOKEN_MESSENGER_ABI, CCTP_TOKEN_MESSENGER_V2, type CctpForwardingFee } from "../cctp.ts";
import { createSwapFeeEnvelope } from "../swapFeeEnvelope.ts";
import { buildXyloSwapRequest, XYLO_ROUTER, xyloRouterAbi } from "../swap.ts";
import { requestSwapPlanningData, type SwapPlanningData, type SwapPlanningRequest } from "../swapPlanning.ts";
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
  | "bridge-route-unavailable"
  | "unsupported-chain"
  | "route-unavailable"
  | "quote-expiring"
  | "fee-unavailable"
  | "allowance-unavailable"
  | "approval-gas-unavailable"
  | "swap-gas-unavailable"
  | "simulation-reverted"
  | "burn-simulation-failed"
  | "provider-unavailable";

export type AgentPlanningResult = Readonly<{
  kind: "latest-transaction" | "today-spending" | "send-affordability" | "send-remaining" | "swap-quote" | "swap-allowance" | "swap-affordability" | "bridge-estimate" | "bridge-route" | "bridge-completion" | "blocking-explanation";
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
  swap?: SwapPlanningData;
  bridge?: BridgePlanningData;
  blockingReasons: readonly AgentBlockingCode[];
}>;

export type AgentPlanningServices = Readonly<{
  estimateSendMaximumFee(input: Readonly<{ account: Address; recipient: Address; assetId: SupportedAssetId; amount: bigint }>): Promise<bigint | undefined>;
  planSwap(request: SwapPlanningRequest): Promise<SwapPlanningData>;
  planBridge(request: BridgePlanningRequest): Promise<BridgePlanningData>;
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
  if (intent.kind === "bridge-completion") return Object.freeze({ kind: "bridge-completion", status: "unavailable", dataTimestamp: snapshot.timestamp, refreshRequired: false, completeness: "unavailable", blockingReasons: Object.freeze([]) });
  if (intent.kind === "swap-quote" || intent.kind === "swap-allowance" || intent.kind === "swap-affordability") {
    const inputAsset = intent.assetId ?? "usdc", outputAsset = intent.outputAssetId ?? (inputAsset === "usdc" ? "eurc" : "usdc");
    const asset = getAssetById(inputAsset), amount = asset && intent.amount ? parseAssetAmount(intent.amount, asset) : undefined;
    if (!services || !snapshot.account || !amount) return unavailableIntelligence(intent.kind, snapshot.timestamp, "quote-unavailable");
    const swap = await services.planSwap({ account: snapshot.account, inputAsset, outputAsset, inputAmount: amount, slippage: 0.005, isArc: snapshot.isArc, now: snapshot.timestamp });
    return Object.freeze({ kind: intent.kind, status: swap.status === "READY" ? "ready" : swap.status === "BLOCKED" ? "blocked" : "unavailable", dataTimestamp: swap.dataTimestamp, expiresAt: swap.expiresAt, refreshRequired: swap.freshness !== "FRESH", completeness: lowerCompleteness(swap.completeness), swap, blockingReasons: Object.freeze(swap.blockingReasons.map(agentBlocker)) });
  }
  if (intent.kind === "bridge-estimate" || intent.kind === "bridge-route") {
    const amount = intent.amount ? parseUsdcAmount(intent.amount) : intent.kind === "bridge-route" ? 1n : undefined;
    if (!services || !snapshot.account || !amount) return unavailableIntelligence(intent.kind, snapshot.timestamp, "fee-unavailable");
    const sourceChainId = intent.sourceChainId ?? 5_042_002, destinationChainId = intent.destinationChainId ?? (sourceChainId === 5_042_002 ? 84_532 : 5_042_002);
    const bridge = await services.planBridge({ account: snapshot.account, connectedChainId: snapshot.verifiedChainId, sourceChainId, destinationChainId, amount, recipient: intent.recipient ?? snapshot.account, route: sourceChainId === 5_042_002 && destinationChainId === 84_532 ? "cctp-direct-forwarding" : "circle-app-kit-cctp", now: snapshot.timestamp });
    return Object.freeze({ kind: intent.kind, status: bridge.status === "READY" ? "ready" : bridge.status === "BLOCKED" ? "blocked" : "unavailable", dataTimestamp: bridge.dataTimestamp, expiresAt: bridge.expiresAt, refreshRequired: bridge.freshness !== "FRESH", completeness: lowerCompleteness(bridge.completeness), bridge, blockingReasons: Object.freeze(bridge.blockingReasons.map(agentBlocker)) });
  }
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
    async planSwap(request) {
      const source = {
        readBalance: async (assetId: SupportedAssetId) => client.readContract({ address: getAssetById(assetId)!.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [request.account] }),
        readQuote: async () => ({ amountOut: await client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [getAssetById(request.inputAsset)!.address, getAssetById(request.outputAsset)!.address, request.inputAmount] }), quotedAt: request.now ?? Date.now() }),
        readAllowance: async () => client.readContract({ address: getAssetById(request.inputAsset)!.address, abi: erc20BalanceAbi, functionName: "allowance", args: [request.account, XYLO_ROUTER] }),
        estimateApprovalGas: async (input: { amount: bigint }) => client.estimateGas({ account: request.account, to: getAssetById(request.inputAsset)!.address, data: encodeFunctionData({ abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, input.amount] }) }),
        simulateApproval: async (input: { amount: bigint }) => { await client.simulateContract({ account: request.account, address: getAssetById(request.inputAsset)!.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, input.amount] }); return "PASSED" as const; },
        estimateSwapGasEnvelope: async (quote: Parameters<typeof buildXyloSwapRequest>[0], slippage: SwapPlanningRequest["slippage"]) => { const built = buildXyloSwapRequest(quote, quote.amountOut, slippage, request.account, request.now); const gas = await client.estimateGas({ account: request.account, to: built.address, data: encodeFunctionData({ abi: built.abi, functionName: built.functionName, args: built.args }) }); const fees = await client.estimateFeesPerGas(); const price = fees.maxFeePerGas ?? await client.getGasPrice(); return createSwapFeeEnvelope(gas, undefined, price, fees.maxPriorityFeePerGas, request.now); },
        simulateSwap: async (quote: Parameters<typeof buildXyloSwapRequest>[0], slippage: SwapPlanningRequest["slippage"]) => { const built = buildXyloSwapRequest(quote, quote.amountOut, slippage, request.account, request.now); await client.simulateContract(built); return "PASSED" as const; },
      };
      return requestSwapPlanningData(request, source);
    },
    async planBridge(request) {
      const sourceChain = unifiedChainById(request.sourceChainId), destinationChain = unifiedChainById(request.destinationChainId);
      const direct = request.route === "cctp-direct-forwarding";
      let directFee: CctpForwardingFee | undefined;
      return requestBridgePlanningData(request, {
        routeAvailable: async () => direct ? true : Boolean(sourceChain && destinationChain && routeSupportedByAppKit((await getCircleAppKit()).getSupportedChains("bridge"), sourceChain, destinationChain)),
        estimateBridge: async () => {
          if (!direct) return undefined;
          const response = await fetch("/api/cctp-fees", { cache: "no-store" });
          const payload = await response.json().catch(() => undefined) as CctpForwardingFee | undefined;
          if (!response.ok || !payload) return undefined;
          directFee = payload;
          const amounts = calculateCctpForwardingAmounts(request.amount, payload);
          return { quotedAt: payload.quotedAt, sourceDebit: amounts.totalAmount, expectedReceive: request.amount, approvalAmount: amounts.totalAmount, fees: [{ kind: "protocol", amount: amounts.protocolFee, token: "USDC", chainId: request.sourceChainId }, { kind: "forwarding", amount: amounts.forwardingFee, token: "USDC", chainId: request.sourceChainId }] };
        },
        readSourceBalance: async () => direct ? client.readContract({ address: getAssetById("usdc")!.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [request.account] }) : undefined,
        readAllowance: async (_request, requiredAmount) => direct ? client.readContract({ address: getAssetById("usdc")!.address, abi: erc20BalanceAbi, functionName: "allowance", args: [request.account, CCTP_TOKEN_MESSENGER_V2] }) : requiredAmount && undefined,
        estimateApprovalGas: async (_request, requiredAmount) => direct ? client.estimateGas({ account: request.account, to: getAssetById("usdc")!.address, data: encodeFunctionData({ abi: erc20BalanceAbi, functionName: "approve", args: [CCTP_TOKEN_MESSENGER_V2, requiredAmount] }) }) : undefined,
        simulateBurn: async () => { if (!direct || !directFee) return "UNAVAILABLE" as const; const amounts = calculateCctpForwardingAmounts(request.amount, directFee); await client.simulateContract({ account: request.account, address: CCTP_TOKEN_MESSENGER_V2, abi: CCTP_TOKEN_MESSENGER_ABI, functionName: "depositForBurnWithHook", args: [amounts.totalAmount, BASE_SEPOLIA_CCTP_DOMAIN, addressToBytes32(getAddress(request.recipient)), getAssetById("usdc")!.address, zeroHash, amounts.maxFee, CCTP_STANDARD_FINALITY, CCTP_FORWARDING_HOOK_DATA] }); return "PASSED" as const; },
      });
    },
  });
}

function unavailableIntelligence(kind: AgentPlanningResult["kind"], timestamp: number, reason: AgentBlockingCode): AgentPlanningResult { return Object.freeze({ kind, status: "unavailable", dataTimestamp: timestamp, refreshRequired: true, completeness: "unavailable", blockingReasons: Object.freeze([reason]) }); }
function lowerCompleteness(value: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"): AgentPlanningResult["completeness"] { return value.toLowerCase() as AgentPlanningResult["completeness"]; }
function agentBlocker(value: string): AgentBlockingCode { return (value === "stale-quote" || value === "quote-unavailable" || value === "quote-expiring" || value === "wrong-network" || value === "invalid-recipient" || value === "unsupported-chain" || value === "route-unavailable" || value === "fee-unavailable" || value === "allowance-unavailable" || value === "allowance-required" || value === "approval-gas-unavailable" || value === "insufficient-token-balance" || value === "insufficient-gas-balance" || value === "swap-gas-unavailable" || value === "simulation-reverted" || value === "burn-simulation-failed" || value === "provider-unavailable") ? value : "provider-unavailable"; }

function parseUsdcAmount(value: string): bigint | undefined {
  try {
    const amount = parseUnits(value, 6);
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
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
    "unsupported-chain": "That bridge chain pair is not supported.",
    "route-unavailable": "The requested bridge route is currently unavailable.",
    "quote-expiring": "The quote is about to expire; request a fresh quote before preparation.",
    "fee-unavailable": "A current provider fee estimate is unavailable.",
    "allowance-unavailable": "The current token allowance could not be read.",
    "approval-gas-unavailable": "Approval gas is unavailable, so full affordability cannot be confirmed.",
    "swap-gas-unavailable": "Swap gas is unavailable, so full affordability cannot be confirmed.",
    "simulation-reverted": "The read-only swap simulation reverted.",
    "burn-simulation-failed": "The read-only bridge burn simulation reverted.",
    "provider-unavailable": "The current provider estimate is unavailable.",
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
    "unsupported-chain": "Cặp mạng bridge này chưa được hỗ trợ.",
    "route-unavailable": "Tuyến bridge yêu cầu hiện không khả dụng.",
    "quote-expiring": "Báo giá sắp hết hạn; hãy lấy báo giá mới trước khi chuẩn bị.",
    "fee-unavailable": "Ước tính phí hiện tại từ nhà cung cấp không khả dụng.",
    "allowance-unavailable": "Không đọc được allowance token hiện tại.",
    "approval-gas-unavailable": "Không có gas approve nên chưa thể xác nhận đầy đủ khả năng chi trả.",
    "swap-gas-unavailable": "Không có gas swap nên chưa thể xác nhận đầy đủ khả năng chi trả.",
    "simulation-reverted": "Mô phỏng swap chỉ đọc đã thất bại.",
    "burn-simulation-failed": "Mô phỏng burn bridge chỉ đọc đã thất bại.",
    "provider-unavailable": "Ước tính hiện tại từ nhà cung cấp không khả dụng.",
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
