import { parseUnits } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById } from "../assets.ts";
import { evaluatePolicy, type PolicyAction, type PolicyResult } from "../policyEngine.ts";
import { runReadTool } from "./readTools.ts";
import { runQuoteTool, type QuoteContext, type QuoteResult, type SendQuote, type SwapQuoteData, type BridgeQuoteData } from "./quoteTools.ts";
import { runPrepareTool, type PrepareResult } from "./prepareTools.ts";
import type { AgentIntent } from "./types.ts";

export type CanonicalQuote = QuoteResult<SendQuote> | QuoteResult<SwapQuoteData> | QuoteResult<BridgeQuoteData>;
export type CanonicalOutcome = Readonly<{ quote?: CanonicalQuote; prepared?: PrepareResult; policy?: PolicyResult; error?: string }>;

async function preparedOutcome(context: QuoteContext, action: PolicyAction, quote: CanonicalQuote, prepared: PrepareResult): Promise<CanonicalOutcome> {
  const readContext = { snapshot: context.snapshot, services: context.reads, now: context.now };
  const [wallet, network] = await Promise.all([runReadTool(readContext, { tool: "wallet.state" }), runReadTool(readContext, { tool: "network.verified" })]);
  return { quote, prepared, policy: evaluatePolicy({ action, account: quote.account, chainId: quote.chainId, now: context.now?.() ?? Date.now(), wallet, network, quote, preparation: prepared }) };
}

/** The Agent supplies intent fields only. Provider reads and validation stay inside the canonical tools. */
export async function runCanonicalIntent(context: QuoteContext, intent: AgentIntent, prepare: boolean): Promise<CanonicalOutcome> {
  const input = prepare ? intent.preparation : intent;
  if (!input || !context.snapshot.account || context.snapshot.verifiedChainId === undefined) return { error: "WALLET_UNAVAILABLE" };
  const assetId = input.assetId ?? "usdc";
  const asset = getAssetById(assetId);
  let amount: bigint;
  try { amount = parseUnits(input.amount ?? "", asset?.decimals ?? 6); } catch { return { error: "INVALID_INPUT" }; }
  if (!asset || amount <= 0n) return { error: "INVALID_INPUT" };
  const account = context.snapshot.account, chainId = context.snapshot.verifiedChainId;
  if (input.kind === "send" || input.kind === "send-affordability" || input.kind === "send-remaining") {
    if (!input.recipient) return { error: "INVALID_INPUT" };
    const request = { tool: "send.quote" as const, account, chainId, assetId, amount, recipient: input.recipient };
    const quote = await runQuoteTool(context, request);
    return prepare ? preparedOutcome(context, "SEND", quote, await runPrepareTool(context, { ...request, tool: "send.prepare", quote })) : { quote };
  }
  if (input.kind === "swap" || input.kind === "swap-quote" || input.kind === "swap-allowance" || input.kind === "swap-affordability") {
    const outputAsset = input.outputAssetId ?? (assetId === "usdc" ? "eurc" : "usdc");
    const request = { tool: "swap.quote" as const, account, chainId, inputAsset: assetId, outputAsset, amount, slippage: 0.005 as const };
    const quote = await runQuoteTool(context, request);
    return prepare ? preparedOutcome(context, "SWAP", quote, await runPrepareTool(context, { ...request, tool: "swap.prepare", quote })) : { quote };
  }
  if (input.kind === "bridge" || input.kind === "bridge-estimate" || input.kind === "bridge-route") {
    const request = { tool: "bridge.quote" as const, account, chainId, destinationChainId: input.destinationChainId ?? baseSepolia.id, assetId, amount, recipient: input.recipient ?? account, route: input.sourceChainId === undefined || input.sourceChainId === arcTestnet.id ? "cctp-direct-forwarding" as const : "circle-app-kit-cctp" as const };
    const quote = await runQuoteTool(context, request);
    return prepare ? preparedOutcome(context, "BRIDGE", quote, await runPrepareTool(context, { ...request, tool: "bridge.prepare", quote })) : { quote };
  }
  return { error: "UNSUPPORTED" };
}
