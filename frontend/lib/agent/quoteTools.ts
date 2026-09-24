import { formatUnits, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById, type SupportedAssetId } from "../assets.ts";
import { calculateCctpForwardingAmounts, CCTP_STANDARD_FINALITY, CCTP_TOKEN_MESSENGER_V2, type CctpForwardingFee } from "../cctp.ts";
import { BRIDGE_ESTIMATE_MAX_AGE_MS } from "../circle/bridge.ts";
import { createXyloQuote, exactApprovalRequired, isXyloSwappableAssetId, minimumSwapOutput, oppositeAssetId, SWAP_QUOTE_MAX_AGE_MS, SWAP_SLIPPAGE_OPTIONS, XYLO_ROUTER, type XyloSwappableAssetId } from "../swap.ts";
import { planSend } from "./planning.ts";
import { runReadTool, type ReadServices, type ReadSource } from "./readTools.ts";
import type { AgentContextSnapshot } from "./types.ts";
import { requireValidTool, validateQuoteRequest, validateQuoteResult } from "./toolSchemas.ts";

export type QuoteToolId = "send.quote" | "swap.quote" | "bridge.quote";
export type QuoteStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNSUPPORTED" | "EXPIRED";
export type QuoteError = "INVALID_INPUT" | "WRONG_CONTEXT" | "PROVIDER_UNAVAILABLE" | "ROUTE_UNAVAILABLE" | "QUOTE_FAILED" | "QUOTE_EXPIRED" | "EVIDENCE_UNAVAILABLE";
export type QuoteProvider = "Arc RPC" | "XyloNet StableSwap" | "Circle CCTP V2 Forwarding" | "Circle App Kit";
export type QuoteValidity = "local-max-age" | "observation-only";
type QuoteBase = Readonly<{ tool: QuoteToolId; account: Address; chainId: number; provider: QuoteProvider; inputAsset: SupportedAssetId; inputAmount: bigint; outputAsset?: SupportedAssetId; destinationChainId?: number; route?: "xylonet-stableswap" | "cctp-direct-forwarding" | "circle-app-kit-cctp"; recipient?: Address; observedAt: number; quotedAt: number | null; expiresAt: number | null; validity: QuoteValidity; provenance: readonly (ReadSource | "xylo-router" | "circle-fee-api" | "local-calculation")[]; warnings: readonly string[] }>;
export type QuoteResult<T> =
  | (QuoteBase & Readonly<{ status: "AVAILABLE"; data: T }>)
  | (QuoteBase & Readonly<{ status: "PARTIAL"; data: T; error: QuoteError }>)
  | (QuoteBase & Readonly<{ status: "UNAVAILABLE" | "UNSUPPORTED" | "EXPIRED"; error: QuoteError }>);

export type SendQuote = Readonly<{ recipient: Address; availableBalance: bigint; gasBalance?: bigint; maximumFeeRaw18?: bigint; maximumFeeUsdc6?: bigint; remainingBeforeFees?: bigint; remaining?: bigint; remainingGasBalance?: bigint; tokenBalanceCovers: boolean; feeAwareAffordable?: boolean }>;
export type SwapQuoteData = Readonly<{ outputAsset: XyloSwappableAssetId; expectedOutput: bigint; minimumReceived: bigint; slippage: (typeof SWAP_SLIPPAGE_OPTIONS)[number]; slippageBps: 50 | 100 | 300; route: "xylonet-stableswap"; router: Address; allowance?: bigint; approvalAmount?: bigint; approvalRequired?: boolean; fee: "not-estimated" }>;
export type BridgeQuoteData = Readonly<{ destinationChainId: number; recipient: Address; route: "cctp-direct-forwarding"; expectedReceive: bigint; sourceDebit: bigint; protocolFee: bigint; forwardingFee: bigint; maximumFee: bigint; finalityThreshold: typeof CCTP_STANDARD_FINALITY; spender: Address; allowance?: bigint; approvalAmount?: bigint; approvalRequired?: boolean; gasFee: "not-estimated" }>;

export type QuoteRequest =
  | Readonly<{ tool: "send.quote"; account: Address; chainId: number; assetId: SupportedAssetId; amount: bigint; recipient: Address }>
  | Readonly<{ tool: "swap.quote"; account: Address; chainId: number; inputAsset: SupportedAssetId; outputAsset: SupportedAssetId; amount: bigint; slippage: (typeof SWAP_SLIPPAGE_OPTIONS)[number] }>
  | Readonly<{ tool: "bridge.quote"; account: Address; chainId: number; destinationChainId: number; assetId: SupportedAssetId; amount: bigint; recipient: Address; route: "cctp-direct-forwarding" | "circle-app-kit-cctp" }>;

/** Provider callbacks are estimates and view reads only; no wallet execution adapter enters this boundary. */
export type QuoteServices = Readonly<{
  estimateSendMaximumFee?(input: Readonly<{ account: Address; recipient: Address; assetId: SupportedAssetId; amount: bigint }>): Promise<bigint | undefined>;
  readXyloOutput?(input: Readonly<{ inputAsset: XyloSwappableAssetId; outputAsset: XyloSwappableAssetId; amount: bigint }>): Promise<Readonly<{ amountOut: bigint; quotedAt: number }>>;
  readDirectCctpFee?(): Promise<CctpForwardingFee | undefined>;
}>;
export type QuoteContext = Readonly<{ snapshot: AgentContextSnapshot; reads?: ReadServices; services?: QuoteServices; now?: () => number }>;

function result<T>(base: QuoteBase, status: "AVAILABLE" | "PARTIAL", data: T, error?: QuoteError): QuoteResult<T>;
function result<T>(base: QuoteBase, status: "UNAVAILABLE" | "UNSUPPORTED" | "EXPIRED", data: undefined, error: QuoteError): QuoteResult<T>;
function result<T>(base: QuoteBase, status: QuoteStatus, data?: T, error?: QuoteError): QuoteResult<T> {
  if (status === "AVAILABLE") return Object.freeze({ ...base, status, data: data! });
  if (status === "PARTIAL") return Object.freeze({ ...base, status, data: data!, error: error! });
  return Object.freeze({ ...base, status, error: error! });
}

export function runQuoteTool(context: QuoteContext, request: Extract<QuoteRequest, { tool: "send.quote" }>): Promise<QuoteResult<SendQuote>>;
export function runQuoteTool(context: QuoteContext, request: Extract<QuoteRequest, { tool: "swap.quote" }>): Promise<QuoteResult<SwapQuoteData>>;
export function runQuoteTool(context: QuoteContext, request: Extract<QuoteRequest, { tool: "bridge.quote" }>): Promise<QuoteResult<BridgeQuoteData>>;
export async function runQuoteTool(context: QuoteContext, request: QuoteRequest): Promise<QuoteResult<SendQuote | SwapQuoteData | BridgeQuoteData>> {
  requireValidTool(validateQuoteRequest(request));
  const now = context.now ?? Date.now;
  const evaluate = async (): Promise<QuoteResult<SendQuote | SwapQuoteData | BridgeQuoteData>> => {
  const provider: QuoteProvider = request.tool === "send.quote" ? "Arc RPC" : request.tool === "swap.quote" ? "XyloNet StableSwap" : request.route === "cctp-direct-forwarding" ? "Circle CCTP V2 Forwarding" : "Circle App Kit";
  const inputAsset = request.tool === "swap.quote" ? request.inputAsset : request.assetId;
  const base: QuoteBase = { tool: request.tool, account: request.account, chainId: request.chainId, provider, inputAsset, inputAmount: request.amount, ...(request.tool === "swap.quote" ? { outputAsset: request.outputAsset, route: "xylonet-stableswap" as const } : { recipient: request.recipient }), ...(request.tool === "bridge.quote" ? { destinationChainId: request.destinationChainId, route: request.route } : {}), observedAt: now(), quotedAt: null, expiresAt: null, validity: "observation-only", provenance: [], warnings: [] };
  if (!isAddress(request.account) || request.account === zeroAddress || request.amount <= 0n || request.tool !== "swap.quote" && (!isAddress(request.recipient) || request.recipient === zeroAddress) || !getAssetById(inputAsset)) return result(base, "UNAVAILABLE", undefined, "INVALID_INPUT");
  if (!context.snapshot.account || getAddress(context.snapshot.account) !== getAddress(request.account) || context.snapshot.verifiedChainId !== request.chainId || !context.snapshot.isArc || request.chainId !== arcTestnet.id) return result(base, "UNAVAILABLE", undefined, "WRONG_CONTEXT");

  if (request.tool === "send.quote") {
    const balances = await runReadTool({ snapshot: context.snapshot, services: context.reads, now }, { tool: "assets.balances" });
    const balance = balances.status === "UNAVAILABLE" ? undefined : balances.data[request.assetId];
    if (balance === undefined) return result({ ...base, provenance: balances.source }, "UNAVAILABLE", undefined, "EVIDENCE_UNAVAILABLE");
    let fee: bigint | undefined;
    try { fee = await context.services?.estimateSendMaximumFee?.({ account: request.account, recipient: request.recipient, assetId: request.assetId, amount: request.amount }); } catch { /* A failed estimate is unknown, never zero. */ }
    if (fee !== undefined && fee < 0n) fee = undefined;
    const observedAt = now();
    const snapshot = { ...context.snapshot, balances: balances.status === "UNAVAILABLE" ? {} : balances.data, timestamp: observedAt };
    const planned = planSend(snapshot, { kind: "send-affordability", locale: "en", assetId: request.assetId, amount: formatUnits(request.amount, getAssetById(request.assetId)!.decimals), recipient: request.recipient }, fee);
    const data: SendQuote = { recipient: request.recipient, availableBalance: balance, ...(planned.gasBalance !== undefined ? { gasBalance: planned.gasBalance } : {}), ...(planned.maximumFeeRaw18 !== undefined ? { maximumFeeRaw18: planned.maximumFeeRaw18 } : {}), ...(planned.maximumFeeUsdc6 !== undefined ? { maximumFeeUsdc6: planned.maximumFeeUsdc6 } : {}), ...(planned.remainingBeforeFees !== undefined ? { remainingBeforeFees: planned.remainingBeforeFees } : {}), ...(planned.remaining !== undefined ? { remaining: planned.remaining } : {}), ...(planned.remainingGasBalance !== undefined ? { remainingGasBalance: planned.remainingGasBalance } : {}), tokenBalanceCovers: planned.tokenBalanceCovers ?? false, ...(planned.feeAwareAffordable !== undefined ? { feeAwareAffordable: planned.feeAwareAffordable } : {}) };
    const complete = fee !== undefined && planned.gasBalance !== undefined && balances.freshness === "live";
    return result({ ...base, quotedAt: fee === undefined ? null : observedAt, expiresAt: fee === undefined ? null : planned.expiresAt ?? null, validity: fee === undefined ? "observation-only" : "local-max-age", provenance: [...balances.source, ...(fee === undefined ? [] : ["arc-rpc" as const, "local-calculation" as const])], warnings: [...(balances.freshness !== "live" ? ["Balance evidence is a snapshot."] : []), ...(fee === undefined ? ["Gas fee estimate unavailable."] : [])] }, complete ? "AVAILABLE" : "PARTIAL", data, complete ? undefined : "EVIDENCE_UNAVAILABLE");
  }

  if (request.tool === "swap.quote") {
    if (!isXyloSwappableAssetId(request.inputAsset) || !isXyloSwappableAssetId(request.outputAsset) || request.outputAsset !== oppositeAssetId(request.inputAsset)) return result(base, "UNSUPPORTED", undefined, "ROUTE_UNAVAILABLE");
    if (!SWAP_SLIPPAGE_OPTIONS.includes(request.slippage)) return result(base, "UNAVAILABLE", undefined, "INVALID_INPUT");
    if (!context.services?.readXyloOutput) return result(base, "UNAVAILABLE", undefined, "PROVIDER_UNAVAILABLE");
    let raw: Readonly<{ amountOut: bigint; quotedAt: number }>;
    try { raw = await context.services.readXyloOutput({ inputAsset: request.inputAsset, outputAsset: request.outputAsset, amount: request.amount }); } catch { return result(base, "UNAVAILABLE", undefined, "QUOTE_FAILED"); }
    if (raw.amountOut <= 0n || !Number.isFinite(raw.quotedAt) || raw.quotedAt > now()) return result(base, "UNAVAILABLE", undefined, "QUOTE_FAILED");
    const expiresAt = raw.quotedAt + SWAP_QUOTE_MAX_AGE_MS;
    const quoted = { ...base, quotedAt: raw.quotedAt, expiresAt, validity: "local-max-age" as const, provenance: ["xylo-router" as const, "local-calculation" as const] };
    if (now() > expiresAt) return result(quoted, "EXPIRED", undefined, "QUOTE_EXPIRED");
    const quote = createXyloQuote(request.inputAsset, request.outputAsset, request.amount, raw.amountOut, raw.quotedAt);
    const allowance = await runReadTool({ snapshot: context.snapshot, services: context.reads, now }, { tool: "token.allowance", assetId: request.inputAsset, spender: XYLO_ROUTER });
    const approvalAmount = allowance.status === "UNAVAILABLE" ? undefined : exactApprovalRequired(allowance.data.amount, request.amount);
    const slippageBps = request.slippage === 0.005 ? 50 : request.slippage === 0.01 ? 100 : 300;
    const data: SwapQuoteData = { outputAsset: request.outputAsset, expectedOutput: quote.amountOut, minimumReceived: minimumSwapOutput(quote.amountOut, request.slippage), slippage: request.slippage, slippageBps, route: "xylonet-stableswap", router: quote.router, ...(allowance.status !== "UNAVAILABLE" ? { allowance: allowance.data.amount, approvalAmount, approvalRequired: approvalAmount !== undefined } : {}), fee: "not-estimated" };
    const current = now() <= expiresAt;
    if (!current) return result(quoted, "EXPIRED", undefined, "QUOTE_EXPIRED");
    return result({ ...quoted, provenance: [...quoted.provenance, ...allowance.source], warnings: ["Swap gas fee is not estimated.", ...(allowance.status === "UNAVAILABLE" ? ["Allowance evidence unavailable."] : [])] }, allowance.status === "AVAILABLE" ? "AVAILABLE" : "PARTIAL", data, allowance.status === "AVAILABLE" ? undefined : "EVIDENCE_UNAVAILABLE");
  }

  if (request.assetId !== "usdc" || request.destinationChainId === request.chainId) return result(base, "UNSUPPORTED", undefined, "ROUTE_UNAVAILABLE");
  if (request.destinationChainId !== baseSepolia.id) return result(base, "UNSUPPORTED", undefined, "ROUTE_UNAVAILABLE");
  if (request.route === "circle-app-kit-cctp") return result({ ...base, warnings: ["Agent quote path has no authenticated Circle App Kit estimate adapter."] }, "UNAVAILABLE", undefined, "PROVIDER_UNAVAILABLE");
  if (!context.services?.readDirectCctpFee) return result(base, "UNAVAILABLE", undefined, "PROVIDER_UNAVAILABLE");
  let fee: CctpForwardingFee | undefined;
  try { fee = await context.services.readDirectCctpFee(); } catch { return result(base, "UNAVAILABLE", undefined, "QUOTE_FAILED"); }
  if (!fee || !Number.isFinite(fee.quotedAt) || fee.quotedAt > now()) return result(base, "UNAVAILABLE", undefined, "QUOTE_FAILED");
  let amounts: ReturnType<typeof calculateCctpForwardingAmounts>;
  try { amounts = calculateCctpForwardingAmounts(request.amount, fee); } catch { return result(base, "UNAVAILABLE", undefined, "QUOTE_FAILED"); }
  const expiresAt = fee.quotedAt + BRIDGE_ESTIMATE_MAX_AGE_MS;
  const quoted = { ...base, quotedAt: fee.quotedAt, expiresAt, validity: "local-max-age" as const, provenance: ["circle-fee-api" as const, "local-calculation" as const] };
  if (now() > expiresAt) return result(quoted, "EXPIRED", undefined, "QUOTE_EXPIRED");
  const allowance = await runReadTool({ snapshot: context.snapshot, services: context.reads, now }, { tool: "token.allowance", assetId: "usdc", spender: CCTP_TOKEN_MESSENGER_V2 });
  const approvalAmount = allowance.status === "UNAVAILABLE" ? undefined : exactApprovalRequired(allowance.data.amount, amounts.totalAmount);
  const data: BridgeQuoteData = { destinationChainId: request.destinationChainId, recipient: request.recipient, route: "cctp-direct-forwarding", expectedReceive: amounts.transferAmount, sourceDebit: amounts.totalAmount, protocolFee: amounts.protocolFee, forwardingFee: amounts.forwardingFee, maximumFee: amounts.maxFee, finalityThreshold: fee.finalityThreshold, spender: CCTP_TOKEN_MESSENGER_V2, ...(allowance.status !== "UNAVAILABLE" ? { allowance: allowance.data.amount, approvalAmount, approvalRequired: approvalAmount !== undefined } : {}), gasFee: "not-estimated" };
  if (now() > expiresAt) return result(quoted, "EXPIRED", undefined, "QUOTE_EXPIRED");
  return result({ ...quoted, provenance: [...quoted.provenance, ...allowance.source], warnings: ["Source gas fee is not estimated.", ...(allowance.status === "UNAVAILABLE" ? ["Allowance evidence unavailable."] : [])] }, allowance.status === "AVAILABLE" ? "AVAILABLE" : "PARTIAL", data, allowance.status === "AVAILABLE" ? undefined : "EVIDENCE_UNAVAILABLE");
  };
  const output = await evaluate();
  requireValidTool(validateQuoteResult(output, now()));
  return output;
}
