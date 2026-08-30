import { arcTestnet } from "viem/chains";
import type { WalletActivity } from "../wallet.ts";
import type { AgentContextSnapshot, AgentIntent, AgentToolDefinition, AgentToolResult } from "./types.ts";
import { confirmedSpendingToday, explainBlocking, latestConfirmedTransaction, planSend, type AgentPlanningResult } from "./planning.ts";

export const READ_ONLY_AGENT_TOOLS: readonly AgentToolDefinition[] = Object.freeze([
  { name: "wallet_overview", run: (s) => unavailableWallet(s, "wallet_overview") ?? result("wallet_overview", { connected: true, account: s.account, network: s.verifiedChainId, usdc: s.balances.usdc, eurc: s.balances.eurc }) },
  { name: "recent_activity", run: recentActivity },
  { name: "activity_explanation", run: explainActivity },
  { name: "vault_summary", run: (s) => unavailableWallet(s, "vault_summary") ?? (!s.vault.available ? { tool: "vault_summary", ok: false, unavailable: "Vault data is unavailable." } : result("vault_summary", s.vault)) },
  { name: "network_status", run: (s) => result("network_status", { connected: s.connected, currentChainId: s.verifiedChainId, requiredChainId: arcTestnet.id, arcActionsAvailable: s.connected && s.isArc }) },
  { name: "safety_capabilities", run: (s) => result("safety_capabilities", s.safetyCapabilities) },
]);

export function runAgentTool(snapshot: AgentContextSnapshot, intent: AgentIntent, planning?: AgentPlanningResult): AgentToolResult | undefined {
  const planningResult = planning ?? defaultPlanning(snapshot, intent);
  if (planningResult) return { tool: intent.kind.replaceAll("-", "_"), ok: planningResult.status !== "unavailable", data: planningResult, partial: planningResult.completeness !== "complete", ...(planningResult.status === "unavailable" ? { unavailable: "Required planning data is unavailable." } : {}) };
  const name = ({ "wallet-overview": "wallet_overview", "recent-activity": "recent_activity", "activity-explanation": "activity_explanation", "vault-summary": "vault_summary", "network-status": "network_status", "safety-capabilities": "safety_capabilities" } as Record<string, string>)[intent.kind];
  return READ_ONLY_AGENT_TOOLS.find((tool) => tool.name === name)?.run(snapshot, intent);
}

function defaultPlanning(snapshot: AgentContextSnapshot, intent: AgentIntent): AgentPlanningResult | undefined {
  if (intent.kind === "latest-transaction") return latestConfirmedTransaction(snapshot);
  if (intent.kind === "today-spending") return confirmedSpendingToday(snapshot, intent.timezoneOffsetMinutes);
  if (intent.kind === "send-affordability" || intent.kind === "send-remaining") return planSend(snapshot, intent);
  if (intent.kind === "blocking-explanation" && intent.blockingCode) return explainBlocking(intent.blockingCode, snapshot.timestamp);
  return undefined;
}

function recentActivity(s: AgentContextSnapshot, intent: AgentIntent): AgentToolResult {
  const missing = unavailableWallet(s, "recent_activity"); if (missing) return missing;
  const data = s.activity.filter((item) => matches(item, intent.activityFilter ?? "all")).slice(0, intent.limit ?? 5);
  return { tool: "recent_activity", ok: true, data, partial: s.activityPartial || s.activityUnavailable };
}
function explainActivity(s: AgentContextSnapshot, intent: AgentIntent): AgentToolResult {
  const missing = unavailableWallet(s, "activity_explanation"); if (missing) return missing;
  const item = s.activity.find((activity) => (!intent.transactionHash || activity.hash.toLowerCase() === intent.transactionHash.toLowerCase()) && matches(activity, intent.activityFilter ?? "all"));
  return item ? result("activity_explanation", item) : { tool: "activity_explanation", ok: false, unavailable: s.activityPartial ? "A matching loaded activity is unavailable; history is partial." : "No matching loaded activity is available." };
}
function unavailableWallet(s: AgentContextSnapshot, tool: string): AgentToolResult | undefined { return s.connected ? undefined : { tool, ok: false, unavailable: "Connect your wallet to inspect balances and activity." }; }
function matches(item: WalletActivity, filter: string) { return filter === "all" || filter === "swap" && item.kind === "swap" || filter === "bridge" && item.kind === "bridge" || filter === "vault" && item.kind.startsWith("vault-") || filter === "send" && item.direction === "send" || filter === "receive" && item.direction === "receive"; }
function result(tool: string, data: unknown): AgentToolResult { return { tool, ok: true, data }; }
