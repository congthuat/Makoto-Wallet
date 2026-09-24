import { arcTestnet } from "viem/chains";
import type { WalletActivity } from "../wallet.ts";
import type { AgentPlanningResult, AgentPlanningServices } from "./planning.ts";
import { resolveAgentPlanning } from "./planning.ts";
import { routeAgentRequest, type AgentBindingMetadata, type AgentCapabilityId, type AgentOrchestrationDecision } from "./orchestration.ts";
import type { AgentContextSnapshot, AgentIntent, AgentToolResult } from "./types.ts";
import type { AgentIntelligenceResult } from "./intelligence/types.ts";
import type { OnchainIntelligenceServices } from "./intelligence/onchain.ts";
import { runReadTool } from "./readTools.ts";
import type { QuoteContext } from "./quoteTools.ts";
import { runCanonicalIntent, type CanonicalQuote } from "./canonicalIntegration.ts";
import type { PrepareResult } from "./prepareTools.ts";

export type AgentCapabilityPermission = "READ_ONLY" | "PREPARE_ONLY";
export const AGENT_EXECUTION_POLICY = "EXECUTION_FORBIDDEN" as const;
export type AgentOutcomeCategory = "NEEDS_CLARIFICATION" | "WALLET_NOT_CONNECTED" | "WRONG_NETWORK" | "INSUFFICIENT_BALANCE" | "QUOTE_UNAVAILABLE" | "ROUTE_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "STALE_DATA" | "PLANNING_FAILED";
export type AgentCapabilityContext = Readonly<{ snapshot: AgentContextSnapshot; planningServices?: AgentPlanningServices; quoteContext?: QuoteContext; onchainServices?: OnchainIntelligenceServices; research?: (sourceId: string, subject?: "bridging") => Promise<AgentIntelligenceResult>; now: number; binding: AgentBindingMetadata }>;
export type AgentCapabilityOutput = Readonly<{ result?: AgentToolResult; planning?: AgentPlanningResult; quote?: CanonicalQuote; prepared?: PrepareResult; intelligence?: AgentIntelligenceResult; category?: AgentOutcomeCategory; error?: string }>;
export type AgentCapabilityDefinition<I extends AgentIntent = AgentIntent, O extends AgentCapabilityOutput = AgentCapabilityOutput> = Readonly<{
  id: AgentCapabilityId; topic: AgentOrchestrationDecision["topic"]; mode: AgentOrchestrationDecision["mode"]; permission: AgentCapabilityPermission; execution: typeof AGENT_EXECUTION_POLICY; requiresWallet: boolean; requiresArc: boolean;
  validateInput(input: AgentIntent, decision: AgentOrchestrationDecision): input is I;
  run(context: AgentCapabilityContext, input: I): Promise<O>;
}>;

const informational = (id: AgentCapabilityId, topic: AgentOrchestrationDecision["topic"], run: (snapshot: AgentContextSnapshot, intent: AgentIntent) => AgentToolResult | Promise<AgentToolResult>): AgentCapabilityDefinition => Object.freeze({
  id, topic, mode: "informational", permission: "READ_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: id !== "network_status" && id !== "safety_capabilities", requiresArc: false,
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === id && routeAgentRequest(input).capabilityId === id,
  run: async ({ snapshot }, input) => Object.freeze({ result: await run(snapshot, input) }),
});
const planning = (id: AgentCapabilityId, topic: AgentOrchestrationDecision["topic"]): AgentCapabilityDefinition => Object.freeze({
  id, topic, mode: "planning", permission: "READ_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: id !== "blocking_explanation", requiresArc: id === "send_planning" || id === "swap_planning",
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === id && routeAgentRequest(input).capabilityId === id,
  async run({ snapshot, planningServices, quoteContext }, input) {
    if (["send-affordability", "send-remaining", "swap-quote", "swap-allowance", "swap-affordability", "bridge-estimate", "bridge-route"].includes(input.kind)) return canonicalOutput(quoteContext ? await runCanonicalIntent(quoteContext, input, false) : { error: "PROVIDER_UNAVAILABLE" });
    const value = await resolveAgentPlanning(snapshot, input, planningServices); return planningOutput(input, value);
  },
});
const preparation = (id: AgentCapabilityId, topic: "send" | "swap" | "bridge" | "vault"): AgentCapabilityDefinition => Object.freeze({
  id, topic, mode: "preparation", permission: "PREPARE_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: true, requiresArc: topic !== "bridge",
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === id && input.kind === "prepare-action" && Boolean(input.preparation),
  async run({ snapshot, quoteContext }, input) {
    if (!snapshot.account || !snapshot.connected && !(snapshot.accountKind === "local" && snapshot.walletStatus === "locked")) return Object.freeze({ category: "WALLET_NOT_CONNECTED" });
    if (topic !== "bridge" && !snapshot.isArc) return Object.freeze({ category: "WRONG_NETWORK" });
    if (topic === "vault") return Object.freeze({ result: result(id, { ready: true }) });
    const planningIntent = preparationPlanningIntent(input);
    if (!planningIntent) return Object.freeze({ category: "NEEDS_CLARIFICATION" });
    return canonicalOutput(quoteContext ? await runCanonicalIntent(quoteContext, input, true) : { error: "PROVIDER_UNAVAILABLE" });
  },
});
const onchainIntelligence: AgentCapabilityDefinition = Object.freeze({ id: "onchain_intelligence", topic: "intelligence", mode: "informational", permission: "READ_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: false, requiresArc: true,
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === "onchain_intelligence" && input.kind === "onchain-intelligence" && Boolean(input.intelligenceOperation && input.intelligenceAddress),
  async run({ snapshot, onchainServices, now }, input) {
    if (!onchainServices || !input.intelligenceAddress || !input.intelligenceOperation) return Object.freeze({ category: "PROVIDER_UNAVAILABLE" });
    const intelligence = await onchainServices.inspect({ operation: input.intelligenceOperation, address: input.intelligenceAddress, tokenAddress: input.tokenAddress, spender: input.spender }, snapshot.activity, snapshot.activityLoadState, now, snapshot.account);
    return Object.freeze({ intelligence, result: result("onchain_intelligence", intelligence) });
  },
});
const officialResearch: AgentCapabilityDefinition = Object.freeze({ id: "official_research", topic: "research", mode: "informational", permission: "READ_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: false, requiresArc: false,
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === "official_research" && input.kind === "official-research" && Boolean(input.researchTopic),
  async run({ research }, input) { if (!research || !input.researchTopic) return Object.freeze({ category: "PROVIDER_UNAVAILABLE" }); const intelligence = await research(input.researchTopic, input.researchSubject); return Object.freeze({ intelligence, result: result("official_research", intelligence) }); },
});

export const AGENT_CAPABILITIES: readonly AgentCapabilityDefinition[] = Object.freeze([
  informational("wallet_overview", "wallet", walletOverview), informational("recent_activity", "activity", recentActivity), informational("activity_explanation", "activity", explainActivity), informational("vault_summary", "vault", vaultSummary), informational("network_status", "network", networkStatus), informational("safety_capabilities", "safety", safetyCapabilities),
  planning("latest_transaction", "activity"), planning("today_spending", "activity"), planning("send_planning", "send"), planning("swap_planning", "swap"), planning("bridge_planning", "bridge"), planning("blocking_explanation", "safety"),
  preparation("send_preparation", "send"), preparation("swap_preparation", "swap"), preparation("bridge_preparation", "bridge"), preparation("vault_preparation", "vault"),
  onchainIntelligence, officialResearch,
]);

export async function runAgentCapability(context: AgentCapabilityContext, intent: AgentIntent, decision: AgentOrchestrationDecision): Promise<AgentCapabilityOutput> {
  const capability = AGENT_CAPABILITIES.find((item) => item.id === decision.capabilityId);
  if (!capability || capability.mode !== decision.mode || capability.topic !== decision.topic || !capability.validateInput(intent, decision)) return Object.freeze({ category: "NEEDS_CLARIFICATION" });
  if (capability.requiresWallet && (!context.snapshot.account || !context.snapshot.connected && !(context.snapshot.accountKind === "local" && context.snapshot.walletStatus === "locked"))) {
    const unavailable = unavailableWallet(context.snapshot, capability.id);
    return Object.freeze({ category: "WALLET_NOT_CONNECTED", ...(unavailable ? { result: unavailable } : {}) });
  }
  if (capability.requiresArc && !context.snapshot.isArc) return Object.freeze({ category: "WRONG_NETWORK" });
  const output = await capability.run(Object.freeze(context), intent).catch((error: unknown) => Object.freeze({ category: "PLANNING_FAILED" as const, error: error instanceof Error && error.message.startsWith("Tool schema validation failed:") ? error.message.split(": ")[1] : "DATA_UNAVAILABLE" }));
  return validOutput(output) ? Object.freeze(output) : Object.freeze({ category: "PLANNING_FAILED" });
}

/** Parsed-intent compatibility entry point. Raw user text is deliberately not accepted. */
export async function runAgentTool(snapshot: AgentContextSnapshot, intent: AgentIntent, suppliedPlanning?: AgentPlanningResult): Promise<AgentToolResult | undefined> {
  if (suppliedPlanning) return planningOutput(intent, suppliedPlanning).result;
  const decision = routeAgentRequest(intent);
  if (decision.mode === "clarification") return undefined;
  return (await runAgentCapability({ snapshot, now: snapshot.timestamp, binding: { generation: 0, account: snapshot.account, chainId: snapshot.verifiedChainId } }, intent, decision)).result;
}

function preparationPlanningIntent(intent: AgentIntent): AgentIntent | undefined {
  const input = intent.preparation; if (!input) return undefined;
  const shared = { locale: intent.locale, amount: input.amount, assetId: input.assetId, recipient: input.recipient, sourceChainId: input.sourceChainId, destinationChainId: input.destinationChainId, outputAssetId: input.outputAssetId };
  if (input.kind === "send") return { ...shared, kind: "send-affordability" };
  if (input.kind === "swap") return { ...shared, kind: "swap-affordability" };
  if (input.kind === "bridge") return { ...shared, kind: "bridge-estimate" };
  return undefined;
}
function planningOutput(intent: AgentIntent, value: AgentPlanningResult | undefined): AgentCapabilityOutput {
  if (!value) return Object.freeze({ category: "PLANNING_FAILED" });
  const toolResult = Object.freeze({ tool: intent.kind.replaceAll("-", "_"), ok: value.status !== "unavailable", data: value, partial: value.completeness !== "complete", ...(value.status === "unavailable" ? { unavailable: "Required planning data is unavailable." } : {}) });
  const category = outcomeFor(value);
  return Object.freeze({ result: toolResult, planning: value, ...(category ? { category } : {}) });
}
function outcomeFor(value: AgentPlanningResult): AgentOutcomeCategory | undefined {
  if (value.blockingReasons.includes("wrong-network")) return "WRONG_NETWORK";
  if (value.blockingReasons.includes("insufficient-token-balance") || value.blockingReasons.includes("insufficient-gas-balance")) return "INSUFFICIENT_BALANCE";
  if (value.blockingReasons.includes("stale-quote")) return "STALE_DATA";
  if (value.blockingReasons.includes("quote-unavailable")) return "QUOTE_UNAVAILABLE";
  if (value.blockingReasons.includes("route-unavailable") || value.blockingReasons.includes("bridge-route-unavailable")) return "ROUTE_UNAVAILABLE";
  if (value.blockingReasons.includes("provider-unavailable")) return "PROVIDER_UNAVAILABLE";
  return value.status === "unavailable" ? "PLANNING_FAILED" : undefined;
}
function validOutput(value: unknown): value is AgentCapabilityOutput { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => ["result", "planning", "quote", "prepared", "intelligence", "category", "error"].includes(key)); }
function canonicalOutput(value: Awaited<ReturnType<typeof runCanonicalIntent>>): AgentCapabilityOutput {
  if (value.error) return Object.freeze({ error: value.error, category: value.error === "WALLET_UNAVAILABLE" ? "WALLET_NOT_CONNECTED" : value.error === "INVALID_INPUT" ? "NEEDS_CLARIFICATION" : "PLANNING_FAILED" });
  const status = value.prepared?.status ?? value.quote?.status;
  const error = value.prepared && value.prepared.status !== "PREPARED" ? value.prepared.error : value.quote && value.quote.status !== "AVAILABLE" && value.quote.status !== "PARTIAL" ? value.quote.error : undefined;
  const category = error === "WRONG_CONTEXT" ? "WRONG_NETWORK" : error === "INSUFFICIENT_BALANCE" ? "INSUFFICIENT_BALANCE" : error === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : error === "ROUTE_UNAVAILABLE" || error === "UNSUPPORTED" ? "ROUTE_UNAVAILABLE" : error === "QUOTE_EXPIRED" || status === "EXPIRED" ? "STALE_DATA" : error ? "QUOTE_UNAVAILABLE" : undefined;
  return Object.freeze({ ...value, ...(error ? { error } : {}), ...(category ? { category } : {}) });
}
async function walletOverview(s: AgentContextSnapshot): Promise<AgentToolResult> {
  const context = { snapshot: s };
  const identity = await runReadTool(context, { tool: "wallet.identity" });
  const state = await runReadTool(context, { tool: "wallet.state" });
  const network = await runReadTool(context, { tool: "network.verified" });
  const read = await runReadTool(context, { tool: "assets.balances" });
  if (identity.status === "UNAVAILABLE" || state.status === "UNAVAILABLE") return { tool: "wallet_overview", ok: false, unavailable: "Wallet state is unavailable." };
  if (!identity.data.exists) return unavailableWallet(s, "wallet_overview")!;
  const balances = read.status === "UNAVAILABLE" ? {} : read.data;
  return { tool: "wallet_overview", ok: true, data: { connected: state.data.externallyConnected || state.data.status === "connected", account: identity.data.address, network: network.status === "UNAVAILABLE" ? undefined : network.data.chainId, walletStatus: state.data.status, usdc: balances.usdc, eurc: balances.eurc, cirbtc: balances.cirbtc }, partial: read.status !== "AVAILABLE" || network.status !== "AVAILABLE", read };
}
function vaultSummary(s: AgentContextSnapshot): AgentToolResult { return unavailableWallet(s, "vault_summary") ?? (!s.vault.available ? { tool: "vault_summary", ok: false, unavailable: "Vault data is unavailable." } : result("vault_summary", s.vault)); }
async function networkStatus(s: AgentContextSnapshot): Promise<AgentToolResult> { const read = await runReadTool({ snapshot: s }, { tool: "network.verified" }); const state = await runReadTool({ snapshot: s }, { tool: "wallet.state" }); if (state.status === "UNAVAILABLE") return { tool: "network_status", ok: false, unavailable: "Wallet state is unavailable.", read }; return { tool: "network_status", ok: true, data: { connected: state.data.externallyConnected || state.data.status === "connected", walletStatus: state.data.status, accountKind: s.accountKind, currentChainId: read.status === "UNAVAILABLE" ? undefined : read.data.chainId, requiredChainId: arcTestnet.id, arcActionsAvailable: state.data.status === "connected" && read.status === "AVAILABLE" && read.data.isArc }, partial: read.status !== "AVAILABLE", read }; }
function safetyCapabilities(s: AgentContextSnapshot): AgentToolResult { return result("safety_capabilities", s.safetyCapabilities); }
async function recentActivity(s: AgentContextSnapshot, intent: AgentIntent): Promise<AgentToolResult> { const missing = unavailableWallet(s, "recent_activity"); if (missing) return missing; const read = await runReadTool({ snapshot: s }, { tool: "activity.recent", filter: intent.activityFilter, limit: intent.limit }); return read.status === "UNAVAILABLE" ? { tool: "recent_activity", ok: false, unavailable: "Activity data is unavailable.", read } : { tool: "recent_activity", ok: true, data: read.data, partial: read.status === "PARTIAL", read }; }
async function explainActivity(s: AgentContextSnapshot, intent: AgentIntent): Promise<AgentToolResult> { const missing = unavailableWallet(s, "activity_explanation"); if (missing) return missing; const read = await runReadTool({ snapshot: s }, { tool: "activity.recent", filter: intent.activityFilter, limit: 100 }); const item = read.status === "UNAVAILABLE" ? undefined : (read.data as WalletActivity[]).find((activity) => !intent.transactionHash || activity.hash.toLowerCase() === intent.transactionHash.toLowerCase()); return item ? { ...result("activity_explanation", item), read } : { tool: "activity_explanation", ok: false, unavailable: read.status === "UNAVAILABLE" ? "Activity data is unavailable." : read.status === "PARTIAL" ? "A matching loaded activity is unavailable; history is partial." : "No matching loaded activity is available.", read }; }
function unavailableWallet(s: AgentContextSnapshot, tool: string): AgentToolResult | undefined { return s.account && (s.connected || s.accountKind === "local" && s.walletStatus === "locked") ? undefined : { tool, ok: false, unavailable: "Connect your wallet to inspect balances and activity." }; }
function result<T>(tool: string, data: T): AgentToolResult<T> { return { tool, ok: true, data }; }
