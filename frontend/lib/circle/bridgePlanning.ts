import { getAddress, isAddress, zeroAddress, type Address } from "viem";

import { exactApprovalRequired, SWAP_QUOTE_MAX_AGE_MS } from "../swap.ts";
import { classifyPlanningFreshness, type PlanningCompleteness, type PlanningFreshness, type PlanningSimulation } from "../swapPlanning.ts";
import { isBridgeRoute } from "./bridge.ts";
import { unifiedChainById } from "./chains.ts";

export type BridgePlanningRoute = "circle-app-kit-cctp" | "cctp-direct-forwarding";
export type BridgeAllowanceState = "SUFFICIENT" | "FINITE_APPROVAL_REQUIRED" | "ALLOWANCE_UNAVAILABLE" | "APPROVAL_GAS_UNAVAILABLE";
export type BridgePlanningBlocker =
  | "wrong-network"
  | "invalid-recipient"
  | "unsupported-chain"
  | "route-unavailable"
  | "quote-expiring"
  | "stale-quote"
  | "fee-unavailable"
  | "allowance-unavailable"
  | "allowance-required"
  | "approval-gas-unavailable"
  | "insufficient-token-balance"
  | "provider-unavailable"
  | "burn-simulation-failed"
  | "destination-status-pending"
  | "destination-status-unknown"
  | "destination-evidence-unavailable";

export type BridgePlanningFee = Readonly<{
  kind: "protocol" | "forwarding" | "provider" | "gas";
  amount?: bigint;
  token: string;
  chainId: number;
}>;
export type BridgeProviderEstimate = Readonly<{
  quotedAt: number;
  sourceDebit: bigint;
  expectedReceive?: bigint;
  approvalAmount?: bigint;
  fees: readonly BridgePlanningFee[];
}>;
export type BridgePlanningRequest = Readonly<{
  account: Address;
  connectedChainId?: number;
  sourceChainId: number;
  destinationChainId: number;
  amount: bigint;
  recipient: string;
  route: BridgePlanningRoute;
  now?: number;
}>;
export type BridgePlanningDataSource = Readonly<{
  routeAvailable(request: BridgePlanningRequest): Promise<boolean>;
  estimateBridge(request: BridgePlanningRequest): Promise<BridgeProviderEstimate | undefined>;
  readSourceBalance(request: BridgePlanningRequest): Promise<bigint | undefined>;
  readAllowance(request: BridgePlanningRequest, requiredAmount: bigint): Promise<bigint | undefined>;
  estimateApprovalGas?(request: BridgePlanningRequest, requiredAmount: bigint): Promise<bigint | undefined>;
  simulateBurn?(request: BridgePlanningRequest, estimate: BridgeProviderEstimate): Promise<PlanningSimulation>;
}>;
export type BridgePlanningData = Readonly<{
  kind: "bridge-planning";
  status: "READY" | "BLOCKED" | "UNAVAILABLE";
  completeness: PlanningCompleteness;
  dataTimestamp: number;
  sourceChainId: number;
  destinationChainId: number;
  sourceChain?: string;
  destinationChain?: string;
  amount: bigint;
  recipient?: Address;
  route: BridgePlanningRoute;
  providerId: "Circle App Kit" | "Circle CCTP V2 Forwarding";
  routeAvailable: boolean;
  sourceBalance?: bigint;
  sourceDebit?: bigint;
  fees: readonly BridgePlanningFee[];
  expectedReceive?: bigint;
  estimateTimestamp?: number;
  expiresAt?: number;
  freshness: PlanningFreshness;
  allowance?: bigint;
  allowanceState: BridgeAllowanceState;
  requiredFiniteApproval?: bigint;
  approvalGasRaw?: bigint;
  burnSimulation: PlanningSimulation;
  blockingReasons: readonly BridgePlanningBlocker[];
}>;

export async function requestBridgePlanningData(request: BridgePlanningRequest, source: BridgePlanningDataSource): Promise<BridgePlanningData> {
  const now = request.now ?? Date.now(), blockers: BridgePlanningBlocker[] = [];
  const sourceChain = unifiedChainById(request.sourceChainId), destinationChain = unifiedChainById(request.destinationChainId);
  if (!sourceChain || !destinationChain || !isBridgeRoute(request.sourceChainId, request.destinationChainId) || request.route === "cctp-direct-forwarding" && (sourceChain.sdk !== "Arc_Testnet" || destinationChain.sdk !== "Base_Sepolia")) blockers.push("unsupported-chain");
  if (request.connectedChainId !== request.sourceChainId) blockers.push("wrong-network");
  const recipient = isAddress(request.recipient) && getAddress(request.recipient) !== zeroAddress ? getAddress(request.recipient) : undefined;
  if (!recipient) blockers.push("invalid-recipient");
  if (request.amount <= 0n || !sourceChain || !destinationChain || blockers.includes("unsupported-chain") || !recipient) {
    return unavailableBridge(request, now, blockers, sourceChain?.name, destinationChain?.name);
  }
  const routeAvailable = await source.routeAvailable(request).catch(() => false);
  if (!routeAvailable) blockers.push("route-unavailable");
  const [estimate, sourceBalance] = await Promise.all([
    routeAvailable ? source.estimateBridge(request).catch(() => undefined) : Promise.resolve(undefined),
    source.readSourceBalance(request).catch(() => undefined),
  ]);
  if (routeAvailable && !estimate) blockers.push("provider-unavailable");
  const validEstimate = estimate && estimate.quotedAt <= now && estimate.sourceDebit > 0n && estimate.fees.every(validFee) ? estimate : undefined;
  const freshness = classifyPlanningFreshness(validEstimate?.quotedAt, now, SWAP_QUOTE_MAX_AGE_MS);
  if (estimate && !validEstimate) blockers.push("fee-unavailable");
  if (freshness === "STALE") blockers.push("stale-quote");
  else if (freshness === "EXPIRING") blockers.push("quote-expiring");
  else if (freshness === "UNAVAILABLE" && routeAvailable && !blockers.includes("provider-unavailable")) blockers.push("fee-unavailable");
  const approvalAmount = validEstimate?.approvalAmount;
  const allowance = approvalAmount === undefined ? undefined : await source.readAllowance(request, approvalAmount).catch(() => undefined);
  const approval = allowance === undefined || approvalAmount === undefined ? undefined : exactApprovalRequired(allowance, approvalAmount);
  if ((validEstimate && approvalAmount === undefined) || (approvalAmount !== undefined && allowance === undefined)) blockers.push("allowance-unavailable");
  else if (approval !== undefined) blockers.push("allowance-required");
  const approvalGasRaw = approval === undefined || !source.estimateApprovalGas
    ? undefined
    : await source.estimateApprovalGas(request, approval).catch(() => undefined);
  if (approval !== undefined && approvalGasRaw === undefined) blockers.push("approval-gas-unavailable");
  const burnSimulation = validEstimate && source.simulateBurn
    ? await source.simulateBurn(request, validEstimate).catch(() => "UNAVAILABLE" as const)
    : "UNAVAILABLE";
  if (burnSimulation === "REVERTED") blockers.push("burn-simulation-failed");
  if (sourceBalance !== undefined && validEstimate && validEstimate.sourceDebit > sourceBalance) blockers.push("insufficient-token-balance");
  const allowanceState: BridgeAllowanceState = approvalAmount === undefined || allowance === undefined ? "ALLOWANCE_UNAVAILABLE" : approval === undefined ? "SUFFICIENT" : approvalGasRaw === undefined ? "APPROVAL_GAS_UNAVAILABLE" : "FINITE_APPROVAL_REQUIRED";
  const hardBlockers = blockers.filter((code) => code !== "quote-expiring" && code !== "allowance-required");
  const completeness: PlanningCompleteness = !validEstimate ? "UNAVAILABLE" : sourceBalance === undefined || allowance === undefined || burnSimulation === "UNAVAILABLE" || approval !== undefined && approvalGasRaw === undefined ? "PARTIAL" : "COMPLETE";
  return freezeData({
    kind: "bridge-planning", status: !validEstimate ? "UNAVAILABLE" : hardBlockers.length ? "BLOCKED" : "READY", completeness, dataTimestamp: now,
    sourceChainId: request.sourceChainId, destinationChainId: request.destinationChainId, sourceChain: sourceChain.name, destinationChain: destinationChain.name,
    amount: request.amount, recipient, route: request.route, providerId: request.route === "circle-app-kit-cctp" ? "Circle App Kit" : "Circle CCTP V2 Forwarding", routeAvailable,
    ...(sourceBalance === undefined ? {} : { sourceBalance }), ...(validEstimate ? { sourceDebit: validEstimate.sourceDebit, fees: freezeData(validEstimate.fees.map((fee) => ({ ...fee }))), estimateTimestamp: validEstimate.quotedAt, expiresAt: validEstimate.quotedAt + SWAP_QUOTE_MAX_AGE_MS } : { fees: Object.freeze([]) }),
    ...(validEstimate?.expectedReceive === undefined ? {} : { expectedReceive: validEstimate.expectedReceive }), freshness,
    ...(allowance === undefined ? {} : { allowance }), allowanceState, ...(approval === undefined ? {} : { requiredFiniteApproval: approval }), ...(approvalGasRaw === undefined ? {} : { approvalGasRaw }), burnSimulation,
    blockingReasons: Object.freeze([...new Set(blockers)]),
  });
}

function validFee(fee: BridgePlanningFee) { return Number.isSafeInteger(fee.chainId) && fee.chainId > 0 && Boolean(fee.token) && (fee.amount === undefined || fee.amount >= 0n); }
function unavailableBridge(request: BridgePlanningRequest, now: number, blockers: BridgePlanningBlocker[], sourceChain?: string, destinationChain?: string): BridgePlanningData { return freezeData({ kind: "bridge-planning", status: "UNAVAILABLE", completeness: "UNAVAILABLE", dataTimestamp: now, sourceChainId: request.sourceChainId, destinationChainId: request.destinationChainId, ...(sourceChain ? { sourceChain } : {}), ...(destinationChain ? { destinationChain } : {}), amount: request.amount, route: request.route, providerId: request.route === "circle-app-kit-cctp" ? "Circle App Kit" : "Circle CCTP V2 Forwarding", routeAvailable: false, fees: Object.freeze([]), freshness: "UNAVAILABLE", allowanceState: "ALLOWANCE_UNAVAILABLE", burnSimulation: "UNAVAILABLE", blockingReasons: Object.freeze([...new Set(blockers)]) }); }
function freezeData<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freezeData(child); } return value; }
