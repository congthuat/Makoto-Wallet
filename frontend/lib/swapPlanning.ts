import { getAddress, isAddress, zeroAddress, type Address } from "viem";

import { arcFeeToUsdcAtomic } from "./arcFees.ts";
import type { SupportedAssetId } from "./assets.ts";
import {
  createXyloQuote,
  exactApprovalRequired,
  minimumSwapOutput,
  oppositeAssetId,
  SWAP_QUOTE_MAX_AGE_MS,
  type SwapQuote,
} from "./swap.ts";
import type { SwapFeeEnvelope } from "./swapFeeEnvelope.ts";

export type PlanningFreshness = "UNAVAILABLE" | "FRESH" | "EXPIRING" | "STALE";
export type PlanningCompleteness = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
export type PlanningSimulation = "PASSED" | "REVERTED" | "UNAVAILABLE";
export type SwapAllowanceState =
  | "SUFFICIENT"
  | "FINITE_APPROVAL_REQUIRED"
  | "ALLOWANCE_UNAVAILABLE"
  | "APPROVAL_GAS_UNAVAILABLE"
  | "APPROVAL_SIMULATION_FAILED";
export type SwapPlanningBlocker =
  | "wrong-network"
  | "quote-unavailable"
  | "quote-expiring"
  | "stale-quote"
  | "allowance-unavailable"
  | "allowance-required"
  | "approval-gas-unavailable"
  | "insufficient-token-balance"
  | "insufficient-gas-balance"
  | "swap-gas-unavailable"
  | "simulation-reverted";

export type SwapPlanningRequest = Readonly<{
  account: Address;
  inputAsset: SupportedAssetId;
  outputAsset: SupportedAssetId;
  inputAmount: bigint;
  slippage: 0.005 | 0.01 | 0.03;
  isArc: boolean;
  now?: number;
}>;

export type SwapPlanningDataSource = Readonly<{
  readBalance(assetId: SupportedAssetId): Promise<bigint | undefined>;
  readQuote(input: Readonly<{ inputAsset: SupportedAssetId; outputAsset: SupportedAssetId; inputAmount: bigint }>): Promise<Readonly<{ amountOut: bigint; quotedAt: number }> | undefined>;
  readAllowance(input: Readonly<{ account: Address; assetId: SupportedAssetId; amount: bigint }>): Promise<bigint | undefined>;
  estimateApprovalGas?(input: Readonly<{ account: Address; assetId: SupportedAssetId; amount: bigint }>): Promise<bigint | undefined>;
  estimateSwapGasEnvelope?(quote: Readonly<SwapQuote>, slippage: SwapPlanningRequest["slippage"]): Promise<Readonly<SwapFeeEnvelope> | undefined>;
  simulateApproval?(input: Readonly<{ account: Address; assetId: SupportedAssetId; amount: bigint }>): Promise<PlanningSimulation>;
  simulateSwap?(quote: Readonly<SwapQuote>, slippage: SwapPlanningRequest["slippage"]): Promise<PlanningSimulation>;
}>;

export type SwapAffordability = Readonly<{
  completeness: PlanningCompleteness;
  affordable?: boolean;
  inputBalanceCovers?: boolean;
  gasBalanceCovers?: boolean;
  approvalFeeUsdc6?: bigint;
  swapMaximumFeeUsdc6?: bigint;
  totalRequiredUsdc6?: bigint;
}>;

export type SwapPlanningData = Readonly<{
  kind: "swap-planning";
  status: "READY" | "BLOCKED" | "UNAVAILABLE";
  completeness: PlanningCompleteness;
  dataTimestamp: number;
  inputAsset: SupportedAssetId;
  outputAsset: SupportedAssetId;
  inputAmount: bigint;
  inputBalance?: bigint;
  usdcGasBalance?: bigint;
  expectedOutput?: bigint;
  minimumReceived?: bigint;
  slippageBps: 50 | 100 | 300;
  quotedAt?: number;
  expiresAt?: number;
  freshness: PlanningFreshness;
  route: "xylonet";
  providerId: "XyloNet StableSwap";
  allowance?: bigint;
  allowanceState: SwapAllowanceState;
  requiredFiniteApproval?: bigint;
  approvalGasRaw18?: bigint;
  swapGasEnvelope?: Readonly<SwapFeeEnvelope>;
  approvalSimulation: PlanningSimulation;
  swapSimulation: PlanningSimulation;
  affordability: SwapAffordability;
  blockingReasons: readonly SwapPlanningBlocker[];
}>;

export function classifyPlanningFreshness(quotedAt: number | undefined, now: number, ttlMs = SWAP_QUOTE_MAX_AGE_MS): PlanningFreshness {
  if (quotedAt === undefined || !Number.isFinite(quotedAt) || quotedAt > now) return "UNAVAILABLE";
  const expiresAt = quotedAt + ttlMs;
  if (now > expiresAt) return "STALE";
  return expiresAt - now > 10_000 ? "FRESH" : "EXPIRING";
}

export function calculateSwapAffordability(input: Readonly<{
  inputAsset: SupportedAssetId;
  inputAmount: bigint;
  inputBalance?: bigint;
  usdcBalance?: bigint;
  approvalRequired: boolean;
  approvalGasRaw18?: bigint;
  swapMaximumFeeUsdc6?: bigint;
  simulation: PlanningSimulation;
}>): SwapAffordability {
  const inputBalanceCovers = input.inputBalance === undefined ? undefined : input.inputAmount <= input.inputBalance;
  const approvalFeeUsdc6 = input.approvalRequired && input.approvalGasRaw18 !== undefined ? arcFeeToUsdcAtomic(input.approvalGasRaw18) : input.approvalRequired ? undefined : 0n;
  const feesKnown = approvalFeeUsdc6 !== undefined && input.swapMaximumFeeUsdc6 !== undefined;
  const totalGasUsdc6 = feesKnown ? approvalFeeUsdc6 + input.swapMaximumFeeUsdc6 : undefined;
  const totalRequiredUsdc6 = totalGasUsdc6 === undefined ? undefined : totalGasUsdc6 + (input.inputAsset === "usdc" ? input.inputAmount : 0n);
  const gasBalanceCovers = input.usdcBalance === undefined || totalRequiredUsdc6 === undefined ? undefined : totalRequiredUsdc6 <= input.usdcBalance;
  const complete = inputBalanceCovers !== undefined && gasBalanceCovers !== undefined && input.simulation !== "UNAVAILABLE";
  const affordable = complete ? Boolean(inputBalanceCovers && gasBalanceCovers && input.simulation === "PASSED") : undefined;
  return freezeData({
    completeness: complete ? "COMPLETE" : input.inputBalance === undefined && input.usdcBalance === undefined ? "UNAVAILABLE" : "PARTIAL",
    ...(affordable === undefined ? {} : { affordable }),
    ...(inputBalanceCovers === undefined ? {} : { inputBalanceCovers }),
    ...(gasBalanceCovers === undefined ? {} : { gasBalanceCovers }),
    ...(approvalFeeUsdc6 === undefined ? {} : { approvalFeeUsdc6 }),
    ...(input.swapMaximumFeeUsdc6 === undefined ? {} : { swapMaximumFeeUsdc6: input.swapMaximumFeeUsdc6 }),
    ...(totalRequiredUsdc6 === undefined ? {} : { totalRequiredUsdc6 }),
  });
}

export async function requestSwapPlanningData(request: SwapPlanningRequest, source: SwapPlanningDataSource): Promise<SwapPlanningData> {
  const now = request.now ?? Date.now();
  const blockers: SwapPlanningBlocker[] = [];
  if (!request.isArc) blockers.push("wrong-network");
  if (!isAddress(request.account) || getAddress(request.account) === zeroAddress || request.outputAsset !== oppositeAssetId(request.inputAsset) || request.inputAmount <= 0n) {
    return unavailableSwap(request, now, blockers);
  }
  const [inputBalance, usdcBalance, rawQuote, allowance] = await Promise.all([
    source.readBalance(request.inputAsset).catch(() => undefined),
    source.readBalance("usdc").catch(() => undefined),
    source.readQuote({ inputAsset: request.inputAsset, outputAsset: request.outputAsset, inputAmount: request.inputAmount }).catch(() => undefined),
    source.readAllowance({ account: request.account, assetId: request.inputAsset, amount: request.inputAmount }).catch(() => undefined),
  ]);
  let quote: SwapQuote | undefined;
  if (rawQuote && rawQuote.amountOut > 0n && rawQuote.quotedAt <= now) {
    try { quote = createXyloQuote(request.inputAsset, request.outputAsset, request.inputAmount, rawQuote.amountOut, rawQuote.quotedAt); } catch {}
  }
  const freshness = classifyPlanningFreshness(quote?.quotedAt, now);
  if (freshness === "UNAVAILABLE") blockers.push("quote-unavailable");
  else if (freshness === "STALE") blockers.push("stale-quote");
  else if (freshness === "EXPIRING") blockers.push("quote-expiring");
  const approval = allowance === undefined ? undefined : exactApprovalRequired(allowance, request.inputAmount);
  if (allowance === undefined) blockers.push("allowance-unavailable");
  else if (approval !== undefined) blockers.push("allowance-required");
  const approvalGasRaw18 = approval === undefined || !source.estimateApprovalGas
    ? undefined
    : await source.estimateApprovalGas({ account: request.account, assetId: request.inputAsset, amount: approval }).catch(() => undefined);
  const approvalSimulation = approval === undefined
    ? "PASSED"
    : source.simulateApproval
      ? await source.simulateApproval({ account: request.account, assetId: request.inputAsset, amount: approval }).catch(() => "UNAVAILABLE" as const)
      : "UNAVAILABLE";
  if (approval !== undefined && approvalGasRaw18 === undefined) blockers.push("approval-gas-unavailable");
  if (approvalSimulation === "REVERTED") blockers.push("simulation-reverted");
  const swapGasEnvelope = quote && source.estimateSwapGasEnvelope
    ? await source.estimateSwapGasEnvelope(quote, request.slippage).catch(() => undefined)
    : undefined;
  if (!swapGasEnvelope) blockers.push("swap-gas-unavailable");
  const swapSimulation = quote && source.simulateSwap
    ? await source.simulateSwap(quote, request.slippage).catch(() => "UNAVAILABLE" as const)
    : "UNAVAILABLE";
  if (swapSimulation === "REVERTED") blockers.push("simulation-reverted");
  const allowanceState: SwapAllowanceState = allowance === undefined
    ? "ALLOWANCE_UNAVAILABLE"
    : approval === undefined
      ? "SUFFICIENT"
      : approvalSimulation === "REVERTED"
        ? "APPROVAL_SIMULATION_FAILED"
        : approvalGasRaw18 === undefined
          ? "APPROVAL_GAS_UNAVAILABLE"
          : "FINITE_APPROVAL_REQUIRED";
  const affordability = calculateSwapAffordability({
    inputAsset: request.inputAsset,
    inputAmount: request.inputAmount,
    inputBalance,
    usdcBalance,
    approvalRequired: approval !== undefined,
    approvalGasRaw18,
    swapMaximumFeeUsdc6: swapGasEnvelope?.feeUsdc6,
    simulation: swapSimulation,
  });
  if (affordability.inputBalanceCovers === false) blockers.push("insufficient-token-balance");
  if (affordability.gasBalanceCovers === false) blockers.push("insufficient-gas-balance");
  const hardBlockers = blockers.filter((code) => code !== "quote-expiring" && code !== "allowance-required");
  const completeness: PlanningCompleteness = freshness === "UNAVAILABLE" ? "UNAVAILABLE" : allowance === undefined || affordability.completeness !== "COMPLETE" ? "PARTIAL" : "COMPLETE";
  return freezeData({
    kind: "swap-planning",
    status: freshness === "UNAVAILABLE" ? "UNAVAILABLE" : hardBlockers.length ? "BLOCKED" : "READY",
    completeness,
    dataTimestamp: now,
    inputAsset: request.inputAsset,
    outputAsset: request.outputAsset,
    inputAmount: request.inputAmount,
    ...(inputBalance === undefined ? {} : { inputBalance }),
    ...(usdcBalance === undefined ? {} : { usdcGasBalance: usdcBalance }),
    ...(quote ? { expectedOutput: quote.amountOut, minimumReceived: minimumSwapOutput(quote.amountOut, request.slippage), quotedAt: quote.quotedAt, expiresAt: quote.quotedAt + SWAP_QUOTE_MAX_AGE_MS } : {}),
    slippageBps: slippageBps(request.slippage), freshness, route: "xylonet", providerId: "XyloNet StableSwap",
    ...(allowance === undefined ? {} : { allowance }), allowanceState,
    ...(approval === undefined ? {} : { requiredFiniteApproval: approval }),
    ...(approvalGasRaw18 === undefined ? {} : { approvalGasRaw18 }),
    ...(swapGasEnvelope ? { swapGasEnvelope: freezeData({ ...swapGasEnvelope }) } : {}),
    approvalSimulation, swapSimulation, affordability,
    blockingReasons: Object.freeze([...new Set(blockers)]),
  });
}

function unavailableSwap(request: SwapPlanningRequest, now: number, blockers: SwapPlanningBlocker[]): SwapPlanningData {
  return freezeData({ kind: "swap-planning", status: "UNAVAILABLE", completeness: "UNAVAILABLE", dataTimestamp: now, inputAsset: request.inputAsset, outputAsset: request.outputAsset, inputAmount: request.inputAmount, slippageBps: slippageBps(request.slippage), freshness: "UNAVAILABLE", route: "xylonet", providerId: "XyloNet StableSwap", allowanceState: "ALLOWANCE_UNAVAILABLE", approvalSimulation: "UNAVAILABLE", swapSimulation: "UNAVAILABLE", affordability: freezeData({ completeness: "UNAVAILABLE" }), blockingReasons: Object.freeze([...new Set([...blockers, "quote-unavailable" as const])]) });
}
function slippageBps(slippage: SwapPlanningRequest["slippage"]): 50 | 100 | 300 { return slippage === 0.005 ? 50 : slippage === 0.01 ? 100 : 300; }
function freezeData<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freezeData(child); } return value; }
