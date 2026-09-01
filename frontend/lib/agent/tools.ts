import { arcTestnet } from "viem/chains";
import type { WalletActivity } from "../wallet.ts";
import type { AgentPlanningResult, AgentPlanningServices } from "./planning.ts";
import { resolveAgentPlanning } from "./planning.ts";
import { routeAgentRequest, type AgentBindingMetadata, type AgentCapabilityId, type AgentOrchestrationDecision } from "./orchestration.ts";
import type { AgentContextSnapshot, AgentIntent, AgentToolResult } from "./types.ts";

export type AgentCapabilityPermission = "READ_ONLY" | "PREPARE_ONLY";
export const AGENT_EXECUTION_POLICY = "EXECUTION_FORBIDDEN" as const;
export type AgentOutcomeCategory = "NEEDS_CLARIFICATION" | "WALLET_NOT_CONNECTED" | "WRONG_NETWORK" | "INSUFFICIENT_BALANCE" | "QUOTE_UNAVAILABLE" | "ROUTE_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "STALE_DATA" | "PLANNING_FAILED";
export type AgentCapabilityContext = Readonly<{ snapshot: AgentContextSnapshot; planningServices?: AgentPlanningServices; now: number; binding: AgentBindingMetadata }>;
export type AgentCapabilityOutput = Readonly<{ result?: AgentToolResult; planning?: AgentPlanningResult; category?: AgentOutcomeCategory }>;
export type AgentCapabilityDefinition<I extends AgentIntent = AgentIntent, O extends AgentCapabilityOutput = AgentCapabilityOutput> = Readonly<{
  id: AgentCapabilityId; topic: AgentOrchestrationDecision["topic"]; mode: AgentOrchestrationDecision["mode"]; permission: AgentCapabilityPermission; execution: typeof AGENT_EXECUTION_POLICY; requiresWallet: boolean; requiresArc: boolean;
  validateInput(input: AgentIntent, decision: AgentOrchestrationDecision): input is I;
  run(context: AgentCapabilityContext, input: I): Promise<O>;
}>;

const informational = (id: AgentCapabilityId, topic: AgentOrchestrationDecision["topic"], run: (snapshot: AgentContextSnapshot, intent: AgentIntent) => AgentToolResult): AgentCapabilityDefinition => Object.freeze({
  id, topic, mode: "informational", permission: "READ_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: id !== "network_status" && id !== "safety_capabilities", requiresArc: false,
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === id && routeAgentRequest(input).capabilityId === id,
  run: async ({ snapshot }, input) => Object.freeze({ result: run(snapshot, input) }),
});
const planning = (id: AgentCapabilityId, topic: AgentOrchestrationDecision["topic"]): AgentCapabilityDefinition => Object.freeze({
  id, topic, mode: "planning", permission: "READ_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: id !== "blocking_explanation", requiresArc: id === "send_planning" || id === "swap_planning",
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === id && routeAgentRequest(input).capabilityId === id,
  async run({ snapshot, planningServices }, input) { const value = await resolveAgentPlanning(snapshot, input, planningServices); return planningOutput(input, value); },
});
const preparation = (id: AgentCapabilityId, topic: "send" | "swap" | "bridge" | "vault"): AgentCapabilityDefinition => Object.freeze({
  id, topic, mode: "preparation", permission: "PREPARE_ONLY", execution: AGENT_EXECUTION_POLICY, requiresWallet: true, requiresArc: topic !== "bridge",
  validateInput: (input, decision): input is AgentIntent => decision.capabilityId === id && input.kind === "prepare-action" && Boolean(input.preparation),
  async run({ snapshot, planningServices }, input) {
    if (!snapshot.connected || !snapshot.account) return Object.freeze({ category: "WALLET_NOT_CONNECTED" });
    if (topic !== "bridge" && !snapshot.isArc) return Object.freeze({ category: "WRONG_NETWORK" });
    if (topic === "vault") return Object.freeze({ result: result(id, { ready: true }) });
    const planningIntent = preparationPlanningIntent(input);
    if (!planningIntent) return Object.freeze({ category: "NEEDS_CLARIFICATION" });
    return planningOutput(planningIntent, await resolveAgentPlanning(snapshot, planningIntent, planningServices));
  },
});

export const AGENT_CAPABILITIES: readonly AgentCapabilityDefinition[] = Object.freeze([
  informational("wallet_overview", "wallet", walletOverview), informational("recent_activity", "activity", recentActivity), informational("activity_explanation", "activity", explainActivity), informational("vault_summary", "vault", vaultSummary), informational("network_status", "network", networkStatus), informational("safety_capabilities", "safety", safetyCapabilities),
  planning("latest_transaction", "activity"), planning("today_spending", "activity"), planning("send_planning", "send"), planning("swap_planning", "swap"), planning("bridge_planning", "bridge"), planning("blocking_explanation", "safety"),
  preparation("send_preparation", "send"), preparation("swap_preparation", "swap"), preparation("bridge_preparation", "bridge"), preparation("vault_preparation", "vault"),
]);

export async function runAgentCapability(context: AgentCapabilityContext, intent: AgentIntent, decision: AgentOrchestrationDecision): Promise<AgentCapabilityOutput> {
  const capability = AGENT_CAPABILITIES.find((item) => item.id === decision.capabilityId);
  if (!capability || capability.mode !== decision.mode || capability.topic !== decision.topic || !capability.validateInput(intent, decision)) return Object.freeze({ category: "NEEDS_CLARIFICATION" });
  if (capability.requiresWallet && (!context.snapshot.connected || !context.snapshot.account)) {
    const unavailable = unavailableWallet(context.snapshot, capability.id);
    return Object.freeze({ category: "WALLET_NOT_CONNECTED", ...(unavailable ? { result: unavailable } : {}) });
  }
  if (capability.requiresArc && !context.snapshot.isArc) return Object.freeze({ category: "WRONG_NETWORK" });
  const output = await capability.run(Object.freeze(context), intent).catch(() => Object.freeze({ category: "PLANNING_FAILED" as const }));
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
function validOutput(value: unknown): value is AgentCapabilityOutput { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => ["result", "planning", "category"].includes(key)); }
function walletOverview(s: AgentContextSnapshot): AgentToolResult { return unavailableWallet(s, "wallet_overview") ?? result("wallet_overview", { connected: true, account: s.account, network: s.verifiedChainId, usdc: s.balances.usdc, eurc: s.balances.eurc }); }
function vaultSummary(s: AgentContextSnapshot): AgentToolResult { return unavailableWallet(s, "vault_summary") ?? (!s.vault.available ? { tool: "vault_summary", ok: false, unavailable: "Vault data is unavailable." } : result("vault_summary", s.vault)); }
function networkStatus(s: AgentContextSnapshot): AgentToolResult { return result("network_status", { connected: s.connected, currentChainId: s.verifiedChainId, requiredChainId: arcTestnet.id, arcActionsAvailable: s.connected && s.isArc }); }
function safetyCapabilities(s: AgentContextSnapshot): AgentToolResult { return result("safety_capabilities", s.safetyCapabilities); }
function recentActivity(s: AgentContextSnapshot, intent: AgentIntent): AgentToolResult { const missing = unavailableWallet(s, "recent_activity"); if (missing) return missing; const data = s.activity.filter((item) => matches(item, intent.activityFilter ?? "all")).slice(0, intent.limit ?? 5); return { tool: "recent_activity", ok: true, data, partial: s.activityPartial || s.activityUnavailable }; }
function explainActivity(s: AgentContextSnapshot, intent: AgentIntent): AgentToolResult { const missing = unavailableWallet(s, "activity_explanation"); if (missing) return missing; const item = s.activity.find((activity) => (!intent.transactionHash || activity.hash.toLowerCase() === intent.transactionHash.toLowerCase()) && matches(activity, intent.activityFilter ?? "all")); return item ? result("activity_explanation", item) : { tool: "activity_explanation", ok: false, unavailable: s.activityPartial ? "A matching loaded activity is unavailable; history is partial." : "No matching loaded activity is available." }; }
function unavailableWallet(s: AgentContextSnapshot, tool: string): AgentToolResult | undefined { return s.connected ? undefined : { tool, ok: false, unavailable: "Connect your wallet to inspect balances and activity." }; }
function matches(item: WalletActivity, filter: string) { return filter === "all" || filter === "swap" && item.kind === "swap" || filter === "bridge" && item.kind === "bridge" || filter === "vault" && item.kind.startsWith("vault-") || filter === "send" && item.direction === "send" || filter === "receive" && item.direction === "receive"; }
function result<T>(tool: string, data: T): AgentToolResult<T> { return { tool, ok: true, data }; }
