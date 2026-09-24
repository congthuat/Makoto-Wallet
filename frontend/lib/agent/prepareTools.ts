import { encodeFunctionData, formatUnits, getAddress, isAddress, keccak256, maxUint256, toHex, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { erc20BalanceAbi } from "../abi/erc20.ts";
import { getAssetById, type SupportedAssetId } from "../assets.ts";
import { addressToBytes32, BASE_SEPOLIA_CCTP_DOMAIN, CCTP_FORWARDING_HOOK_DATA, CCTP_STANDARD_FINALITY, CCTP_TOKEN_MESSENGER_ABI, CCTP_TOKEN_MESSENGER_V2 } from "../cctp.ts";
import { createXyloQuote, prepareXyloSwapRequest, XYLO_ROUTER } from "../swap.ts";
import { normalizeTransactionRequest, type NormalizedTransactionRequest } from "../transactionOrchestrator.ts";
import { prepareAgentActionHandoff, AGENT_HANDOFF_TTL_MS } from "./actions/prepare.ts";
import type { AgentActionHandoff } from "./actions/types.ts";
import { runQuoteTool, type BridgeQuoteData, type QuoteContext, type QuoteProvider, type QuoteResult, type SendQuote, type SwapQuoteData } from "./quoteTools.ts";
import { runReadTool } from "./readTools.ts";
import type { AgentActionDraft } from "./types.ts";
import { requireValidTool, validatePrepareRequest, validatePrepareResult } from "./toolSchemas.ts";

export type PrepareToolId = "send.prepare" | "swap.prepare" | "bridge.prepare";
export type PrepareError = "INVALID_INPUT" | "WALLET_UNAVAILABLE" | "WRONG_CONTEXT" | "UNSUPPORTED" | "INSUFFICIENT_BALANCE" | "QUOTE_UNAVAILABLE" | "QUOTE_EXPIRED" | "QUOTE_MISMATCH" | "EVIDENCE_UNAVAILABLE" | "PREPARATION_FAILED";
export type PrepareStep = Readonly<{ kind: "send" | "finite-approval" | "swap" | "cctp-burn"; chainId: typeof arcTestnet.id; account: Address; target: Address; assetId: SupportedAssetId; amount: bigint; request: NormalizedTransactionRequest; spender?: Address; minimumOutput?: bigint; destinationChainId?: number; requiresConfirmedPriorStep?: true; requiresFreshReview: true }>;
export type PreparedAction = Readonly<{ tool: PrepareToolId; account: Address; chainId: typeof arcTestnet.id; provider: QuoteProvider; inputAsset: SupportedAssetId; inputAmount: bigint; route?: "xylonet-stableswap" | "cctp-direct-forwarding"; destinationChainId?: number; recipient?: Address; preparedAt: number; expiresAt: number; quoteFingerprint: Hex; quoteQuotedAt: number; balanceObservedAt: number; allowance?: bigint; steps: readonly PrepareStep[]; reviewSummary: readonly string[]; provenance: readonly string[]; limitations?: readonly string[]; handoff?: AgentActionHandoff; executionEnabled: false }>;
export type PrepareResult = Readonly<{ tool: PrepareToolId; status: "PREPARED"; data: PreparedAction }> | Readonly<{ tool: PrepareToolId; status: "UNAVAILABLE" | "UNSUPPORTED" | "EXPIRED"; error: PrepareError }>;
type SendRequest = Readonly<{ tool: "send.prepare"; account: Address; chainId: number; assetId: SupportedAssetId; amount: bigint; recipient: Address; quote: QuoteResult<SendQuote> }>;
type SwapRequest = Readonly<{ tool: "swap.prepare"; account: Address; chainId: number; inputAsset: SupportedAssetId; outputAsset: SupportedAssetId; amount: bigint; slippage: 0.005 | 0.01 | 0.03; quote: QuoteResult<SwapQuoteData> }>;
type BridgeRequest = Readonly<{ tool: "bridge.prepare"; account: Address; chainId: number; destinationChainId: number; assetId: SupportedAssetId; amount: bigint; recipient: Address; route: "cctp-direct-forwarding" | "circle-app-kit-cctp"; quote: QuoteResult<BridgeQuoteData> }>;
export type PrepareRequest = SendRequest | SwapRequest | BridgeRequest;
export type PrepareContext = QuoteContext;

const fail = (tool: PrepareToolId, error: PrepareError, status: "UNAVAILABLE" | "UNSUPPORTED" | "EXPIRED" = "UNAVAILABLE"): PrepareResult => Object.freeze({ tool, status, error });
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const validAddress = (value: unknown): value is Address => typeof value === "string" && isAddress(value, { strict: true }) && getAddress(value) !== zeroAddress;
const fingerprint = (quote: QuoteResult<unknown>): Hex => keccak256(toHex(JSON.stringify(quote, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)));
const freeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
const step = (kind: PrepareStep["kind"], account: Address, target: Address, assetId: SupportedAssetId, amount: bigint, data: Hex, extra: Partial<Pick<PrepareStep, "spender" | "minimumOutput" | "destinationChainId" | "requiresConfirmedPriorStep">> = {}): PrepareStep => freeze({ kind, account, chainId: arcTestnet.id, target, assetId, amount, request: normalizeTransactionRequest({ to: target, data, value: 0n, chainId: arcTestnet.id }), ...extra, requiresFreshReview: true as const });

/** Produces bounded data only. Wallet review must re-read, simulate, and obtain user confirmation. */
export async function runPrepareTool(context: PrepareContext, request: PrepareRequest): Promise<PrepareResult> {
  const now = context.now ?? Date.now;
  const input = validatePrepareRequest(request, now());
  if (!input.valid) {
    const codes = input.errors.map((item) => item.code);
    if (!request || !["send.prepare", "swap.prepare", "bridge.prepare"].includes(request.tool)) requireValidTool(input);
    if (!validAddress(request.account) || typeof request.amount !== "bigint" || request.amount <= 0n || request.amount >= maxUint256 || request.tool !== "swap.prepare" && !validAddress(request.recipient) || !request.quote || typeof request.quote !== "object" || input.errors.some((item) => item.path === "request" && item.code === "INVALID_SCHEMA")) return fail(request.tool, "INVALID_INPUT");
    if (request.chainId !== arcTestnet.id) return fail(request.tool, "WRONG_CONTEXT");
    if (!context.snapshot.account || !same(context.snapshot.account, request.account) || context.snapshot.verifiedChainId !== request.chainId || !context.snapshot.isArc) return fail(request.tool, "WRONG_CONTEXT");
    if (request.tool === "swap.prepare" && (request.inputAsset === "cirbtc" || request.outputAsset === "cirbtc" || request.inputAsset === request.outputAsset || ![0.005, 0.01, 0.03].includes(request.slippage))) return fail(request.tool, "UNSUPPORTED", "UNSUPPORTED");
    if (codes.includes("QUOTE_EXPIRED")) return fail(request?.tool, "QUOTE_EXPIRED", "EXPIRED");
    if (codes.includes("UNSUPPORTED")) return fail(request?.tool, "UNSUPPORTED", "UNSUPPORTED");
    if (request.quote.status === "PARTIAL") return fail(request.tool, "EVIDENCE_UNAVAILABLE");
    if (request.quote.status === "UNAVAILABLE") return fail(request.tool, "QUOTE_UNAVAILABLE");
    if (codes.includes("QUOTE_MISMATCH")) return fail(request?.tool, "QUOTE_MISMATCH");
    return fail(request.tool, "QUOTE_MISMATCH");
  }
  let validationQuote: QuoteResult<unknown> | undefined;
  const evaluate = async (): Promise<PrepareResult> => {
  if (!["send.prepare", "swap.prepare", "bridge.prepare"].includes(request.tool) || !validAddress(request.account) || typeof request.amount !== "bigint" || request.amount <= 0n || request.amount >= maxUint256 || request.tool !== "swap.prepare" && !validAddress(request.recipient) || !request.quote || typeof request.quote !== "object") return fail(request.tool, "INVALID_INPUT");
  if (request.tool !== "swap.prepare" && !getAssetById(request.assetId)) return fail(request.tool, "UNSUPPORTED", "UNSUPPORTED");
  if (request.tool === "bridge.prepare" && request.route === "circle-app-kit-cctp") return fail(request.tool, "UNSUPPORTED", "UNSUPPORTED");
  if (request.tool === "bridge.prepare" && (request.assetId !== "usdc" || request.destinationChainId !== baseSepolia.id || !same(request.recipient, request.account))) return fail(request.tool, "UNSUPPORTED", "UNSUPPORTED");
  if (request.tool === "swap.prepare" && (request.inputAsset === "cirbtc" || request.outputAsset === "cirbtc" || request.inputAsset === request.outputAsset || ![0.005, 0.01, 0.03].includes(request.slippage))) return fail(request.tool, "UNSUPPORTED", "UNSUPPORTED");
  if (request.chainId !== arcTestnet.id || !context.snapshot.account || !same(context.snapshot.account, request.account) || context.snapshot.verifiedChainId !== request.chainId || !context.snapshot.isArc) return fail(request.tool, "WRONG_CONTEXT");
  const wallet = await runReadTool({ snapshot: context.snapshot, services: context.reads, now }, { tool: "wallet.state" });
  const network = await runReadTool({ snapshot: context.snapshot, services: context.reads, now }, { tool: "network.verified" });
  if (wallet.status !== "AVAILABLE" || wallet.data.status !== "connected" || !wallet.data.exists) return fail(request.tool, "WALLET_UNAVAILABLE");
  if (network.status !== "AVAILABLE" || !network.data.isArc || network.data.chainId !== request.chainId) return fail(request.tool, "WRONG_CONTEXT");
  const expected = request.quote;
  if (expected.status === "EXPIRED" || expected.expiresAt !== null && now() > expected.expiresAt) return fail(request.tool, "QUOTE_EXPIRED", "EXPIRED");
  if (expected.status === "UNSUPPORTED") return fail(request.tool, "UNSUPPORTED", "UNSUPPORTED");
  if (expected.status === "PARTIAL") return fail(request.tool, "EVIDENCE_UNAVAILABLE");
  if (expected.status !== "AVAILABLE" || typeof expected.account !== "string" || typeof expected.quotedAt !== "number" || typeof expected.expiresAt !== "number" || !Number.isFinite(expected.quotedAt) || !Number.isFinite(expected.expiresAt) || expected.expiresAt <= expected.quotedAt || !expected.data || typeof expected.data !== "object") return fail(request.tool, "QUOTE_UNAVAILABLE");
  const quoteTool = request.tool.replace("prepare", "quote");
  if (expected.tool !== quoteTool || !same(expected.account, request.account) || expected.chainId !== request.chainId || expected.inputAmount !== request.amount || expected.inputAsset !== (request.tool === "swap.prepare" ? request.inputAsset : request.assetId)) return fail(request.tool, "QUOTE_MISMATCH");
  if (request.tool === "send.prepare" && (!same(expected.recipient ?? "", request.recipient) || expected.provider !== "Arc RPC")) return fail(request.tool, "QUOTE_MISMATCH");
  if (request.tool === "swap.prepare" && (expected.outputAsset !== request.outputAsset || expected.route !== "xylonet-stableswap" || expected.provider !== "XyloNet StableSwap" || (expected.data as SwapQuoteData).slippage !== request.slippage)) return fail(request.tool, "QUOTE_MISMATCH");
  if (request.tool === "bridge.prepare" && (expected.destinationChainId !== request.destinationChainId || !same(expected.recipient ?? "", request.recipient) || expected.route !== request.route || expected.provider !== "Circle CCTP V2 Forwarding")) return fail(request.tool, "QUOTE_MISMATCH");
  let live: QuoteResult<SendQuote> | QuoteResult<SwapQuoteData> | QuoteResult<BridgeQuoteData>;
  if (request.tool === "send.prepare") live = await runQuoteTool(context, { tool: "send.quote", account: request.account, chainId: request.chainId, assetId: request.assetId, amount: request.amount, recipient: request.recipient });
  else if (request.tool === "swap.prepare") live = await runQuoteTool(context, { tool: "swap.quote", account: request.account, chainId: request.chainId, inputAsset: request.inputAsset, outputAsset: request.outputAsset, amount: request.amount, slippage: request.slippage });
  else live = await runQuoteTool(context, { tool: "bridge.quote", account: request.account, chainId: request.chainId, destinationChainId: request.destinationChainId, assetId: request.assetId, amount: request.amount, recipient: request.recipient, route: request.route });
  if (live.status === "EXPIRED" || live.expiresAt !== null && now() > live.expiresAt) return fail(request.tool, "QUOTE_EXPIRED", "EXPIRED");
  if (live.status === "PARTIAL") return fail(request.tool, "EVIDENCE_UNAVAILABLE");
  if (live.status !== "AVAILABLE" || live.quotedAt === null || live.expiresAt === null) return fail(request.tool, "QUOTE_UNAVAILABLE");
  validationQuote = live;
  const expiry = Math.min(expected.expiresAt, live.expiresAt, now() + AGENT_HANDOFF_TTL_MS);
  if (now() > expiry) return fail(request.tool, "QUOTE_EXPIRED", "EXPIRED");
  const observedAt = now();
  const provenance = freeze([...new Set([...expected.provenance, ...live.provenance, "canonical-read", "canonical-quote"])]);
  const common = { tool: request.tool, account: request.account, chainId: arcTestnet.id, inputAmount: request.amount, preparedAt: observedAt, expiresAt: expiry, quoteFingerprint: fingerprint(live), quoteQuotedAt: live.quotedAt, provenance, executionEnabled: false as const };

  if (request.tool === "send.prepare") {
    const source = expected.data as SendQuote, current = live.data as SendQuote;
    if (source.maximumFeeRaw18 !== current.maximumFeeRaw18 || source.maximumFeeUsdc6 !== current.maximumFeeUsdc6 || source.availableBalance !== current.availableBalance || source.gasBalance !== current.gasBalance) return fail(request.tool, "QUOTE_MISMATCH");
    if (current.feeAwareAffordable !== true || current.tokenBalanceCovers !== true) return fail(request.tool, "INSUFFICIENT_BALANCE");
    const asset = getAssetById(request.assetId);
    if (!asset) return fail(request.tool, "UNSUPPORTED", "UNSUPPORTED");
    const transfer = step("send", request.account, asset.address, request.assetId, request.amount, encodeFunctionData({ abi: erc20BalanceAbi, functionName: "transfer", args: [getAddress(request.recipient), request.amount] }));
    const handoff = request.assetId === "cirbtc" ? undefined : makeHandoff({ version: 1, mode: "prepare-only", rawUserText: "", executionEnabled: false, kind: "send", asset: asset.symbol as "USDC" | "EURC", amount: formatUnits(request.amount, asset.decimals), recipient: request.recipient, sourceChain: "Arc Testnet" }, request.account, observedAt, expiry);
    return freeze({ tool: request.tool, status: "PREPARED", data: { ...common, provider: "Arc RPC", inputAsset: request.assetId, recipient: request.recipient, balanceObservedAt: live.observedAt, steps: [transfer], reviewSummary: [`Send ${formatUnits(request.amount, asset.decimals)} ${asset.symbol}`, `Maximum estimated fee ${current.maximumFeeUsdc6} USDC atomic units`], ...(handoff ? { handoff } : {}), executionEnabled: false } });
  }

  const balances = await runReadTool({ snapshot: context.snapshot, services: context.reads, now }, { tool: "assets.balances" });
  if (balances.status === "UNAVAILABLE" || balances.freshness !== "live") return fail(request.tool, "EVIDENCE_UNAVAILABLE");
  const inputAsset = request.tool === "swap.prepare" ? request.inputAsset : request.assetId;
  const required = request.tool === "bridge.prepare" ? (live.data as BridgeQuoteData).sourceDebit : request.amount;
  const balance = balances.data[inputAsset];
  if (balance === undefined) return fail(request.tool, "EVIDENCE_UNAVAILABLE");
  if (balance < required) return fail(request.tool, "INSUFFICIENT_BALANCE");

  if (request.tool === "swap.prepare") {
    const source = expected.data as SwapQuoteData, current = live.data as SwapQuoteData;
    if (source.expectedOutput !== current.expectedOutput || source.minimumReceived !== current.minimumReceived || source.router !== XYLO_ROUTER || current.router !== XYLO_ROUTER || source.allowance !== current.allowance || source.approvalRequired !== current.approvalRequired || source.approvalAmount !== current.approvalAmount || source.outputAsset !== request.outputAsset || current.outputAsset !== request.outputAsset) return fail(request.tool, "QUOTE_MISMATCH");
    if (current.allowance === undefined || current.approvalRequired === undefined) return fail(request.tool, "EVIDENCE_UNAVAILABLE");
    const asset = getAssetById(request.inputAsset)!;
    const quote = createXyloQuote(request.inputAsset, request.outputAsset, request.amount, current.expectedOutput, live.quotedAt!);
    let prepared: ReturnType<typeof prepareXyloSwapRequest>;
    try { prepared = prepareXyloSwapRequest(quote, request.slippage, request.account, observedAt); } catch { return fail(request.tool, "PREPARATION_FAILED"); }
    if (prepared.minimumReceive !== current.minimumReceived) return fail(request.tool, "QUOTE_MISMATCH");
    const steps: PrepareStep[] = [];
    if (current.approvalRequired) {
      if (current.approvalAmount !== request.amount || current.approvalAmount >= maxUint256) return fail(request.tool, "QUOTE_MISMATCH");
      steps.push(step("finite-approval", request.account, asset.address, request.inputAsset, request.amount, encodeFunctionData({ abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, request.amount] }), { spender: XYLO_ROUTER }));
    }
    steps.push(step("swap", request.account, XYLO_ROUTER, request.inputAsset, request.amount, prepared.calldata, { minimumOutput: current.minimumReceived, ...(current.approvalRequired ? { requiresConfirmedPriorStep: true } : {}) }));
    const handoff = request.slippage === 0.005 && context.snapshot.accountKind === "external" ? makeHandoff({ version: 1, mode: "prepare-only", rawUserText: "", executionEnabled: false, kind: "swap", inputAsset: asset.symbol as "USDC" | "EURC", outputAsset: getAssetById(request.outputAsset)!.symbol as "USDC" | "EURC", amount: formatUnits(request.amount, asset.decimals), slippage: 0.005, sourceChain: "Arc Testnet" }, request.account, observedAt, expiry) : undefined;
    return freeze({ tool: request.tool, status: "PREPARED", data: { ...common, provider: "XyloNet StableSwap", inputAsset: request.inputAsset, route: "xylonet-stableswap", balanceObservedAt: balances.observedAt ?? observedAt, allowance: current.allowance, steps, reviewSummary: [`Swap ${formatUnits(request.amount, asset.decimals)} ${asset.symbol} for at least ${formatUnits(current.minimumReceived, getAssetById(request.outputAsset)!.decimals)} ${getAssetById(request.outputAsset)!.symbol}`, ...(current.approvalRequired ? [`Finite allowance for ${XYLO_ROUTER}`] : [])], ...(handoff ? { handoff } : {}), executionEnabled: false } });
  }

  const source = expected.data as BridgeQuoteData, current = live.data as BridgeQuoteData;
  if (source.sourceDebit !== current.sourceDebit || source.expectedReceive !== current.expectedReceive || source.protocolFee !== current.protocolFee || source.forwardingFee !== current.forwardingFee || source.maximumFee !== current.maximumFee || source.allowance !== current.allowance || source.approvalRequired !== current.approvalRequired || source.approvalAmount !== current.approvalAmount || source.spender !== CCTP_TOKEN_MESSENGER_V2 || current.spender !== CCTP_TOKEN_MESSENGER_V2 || source.finalityThreshold !== CCTP_STANDARD_FINALITY) return fail(request.tool, "QUOTE_MISMATCH");
  if (current.allowance === undefined || current.approvalRequired === undefined) return fail(request.tool, "EVIDENCE_UNAVAILABLE");
  const usdc = getAssetById("usdc")!;
  const steps: PrepareStep[] = [];
  if (current.approvalRequired) {
    if (current.approvalAmount !== current.sourceDebit || current.approvalAmount >= maxUint256) return fail(request.tool, "QUOTE_MISMATCH");
    steps.push(step("finite-approval", request.account, usdc.address, "usdc", current.sourceDebit, encodeFunctionData({ abi: erc20BalanceAbi, functionName: "approve", args: [CCTP_TOKEN_MESSENGER_V2, current.sourceDebit] }), { spender: CCTP_TOKEN_MESSENGER_V2 }));
  }
  const burn = encodeFunctionData({ abi: CCTP_TOKEN_MESSENGER_ABI, functionName: "depositForBurnWithHook", args: [current.sourceDebit, BASE_SEPOLIA_CCTP_DOMAIN, addressToBytes32(request.account), usdc.address, zeroHash, current.maximumFee, CCTP_STANDARD_FINALITY, CCTP_FORWARDING_HOOK_DATA] });
  steps.push(step("cctp-burn", request.account, CCTP_TOKEN_MESSENGER_V2, "usdc", current.sourceDebit, burn, { destinationChainId: baseSepolia.id, ...(current.approvalRequired ? { requiresConfirmedPriorStep: true } : {}) }));
  return freeze({ tool: request.tool, status: "PREPARED", data: { ...common, provider: "Circle CCTP V2 Forwarding", inputAsset: "usdc", route: "cctp-direct-forwarding", destinationChainId: baseSepolia.id, recipient: request.account, balanceObservedAt: balances.observedAt ?? observedAt, allowance: current.allowance, steps, reviewSummary: [`Bridge ${formatUnits(request.amount, 6)} USDC to Base Sepolia`, `Total source debit ${formatUnits(current.sourceDebit, 6)} USDC`, `Expected receive ${formatUnits(current.expectedReceive, 6)} USDC`], limitations: ["Current Agent handoff does not select the Direct CCTP wallet flow."], executionEnabled: false } });
  };
  const output = await evaluate();
  return requireValidTool(validatePrepareResult(output, { now: now(), quote: output.status === "PREPARED" ? validationQuote : undefined }));
}

function makeHandoff(draft: AgentActionDraft, account: Address, now: number, expiry: number): AgentActionHandoff | undefined {
  const result = prepareAgentActionHandoff(draft, account, now);
  return result.handoff && expiry >= now ? freeze({ ...result.handoff, expiresAt: Math.min(result.handoff.expiresAt, expiry) }) : undefined;
}
