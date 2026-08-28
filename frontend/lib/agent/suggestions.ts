import type { WalletActivity } from "../wallet";

export type AgentSuggestionId = "overview" | "activity" | "network" | "send" | "swap" | "bridge";
export type AgentSuggestionPromptKey = `agentDashboard.suggestion${"Overview" | "Activity" | "Network" | "Send" | "Swap" | "Bridge"}`;
export type AgentSuggestion = { id: AgentSuggestionId; promptKey: AgentSuggestionPromptKey };

export function suggestionStorageKey(account: string | undefined, chainId: number | undefined) {
  return `makoto-wallet:agent-suggestions:v1:${chainId ?? "unknown"}:${account?.toLowerCase() ?? "guest"}`;
}

export function rankAgentSuggestions(input: { activities: readonly WalletActivity[]; isArc: boolean; usage?: Partial<Record<AgentSuggestionId, number>> }): AgentSuggestion[] {
  const scores: Record<AgentSuggestionId, number> = { overview: 6, activity: input.activities.length ? 7 : 3, network: input.isArc ? 2 : 20, send: 0, swap: 0, bridge: 0 };
  for (const item of input.activities.slice(0, 12)) {
    if (item.kind === "swap") scores.swap += 5;
    else if (item.kind === "bridge") scores.bridge += 5;
    else scores.send += 3;
  }
  for (const [id, count] of Object.entries(input.usage ?? {}) as [AgentSuggestionId, number][]) scores[id] += Math.min(count, 6) * 2;
  const prompts: Record<AgentSuggestionId, AgentSuggestionPromptKey> = {
    overview: "agentDashboard.suggestionOverview", activity: "agentDashboard.suggestionActivity", network: "agentDashboard.suggestionNetwork",
    send: "agentDashboard.suggestionSend", swap: "agentDashboard.suggestionSwap", bridge: "agentDashboard.suggestionBridge",
  };
  return (Object.keys(scores) as AgentSuggestionId[])
    .sort((a, b) => scores[b] - scores[a] || a.localeCompare(b))
    .slice(0, 3)
    .map((id) => ({ id, promptKey: prompts[id] }));
}

export function readSuggestionUsage(storage: Pick<Storage, "getItem">, key: string): Partial<Record<AgentSuggestionId, number>> {
  try { return JSON.parse(storage.getItem(key) ?? "{}"); } catch { return {}; }
}

export function recordSuggestionUsage(storage: Pick<Storage, "getItem" | "setItem">, key: string, id: AgentSuggestionId) {
  const current = readSuggestionUsage(storage, key);
  storage.setItem(key, JSON.stringify({ ...current, [id]: (current[id] ?? 0) + 1 }));
}
