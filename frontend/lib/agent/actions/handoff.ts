import type { AgentActionHandoff, AgentActionResult } from "./types.ts";

const HANDOFF_KEY = "makoto.agent.handoff.v1", RESULT_KEY = "makoto.agent.result.v1";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function storeAgentHandoff(store: Store, handoff: AgentActionHandoff) { store.setItem(HANDOFF_KEY, JSON.stringify(handoff)); }

/** Removes before validating so malformed, stale, or account-mutated instructions can never replay. */
export function consumeAgentHandoff(store: Store, id: string | null, account: string | undefined, now = Date.now()): AgentActionHandoff | undefined {
  const raw = store.getItem(HANDOFF_KEY); store.removeItem(HANDOFF_KEY);
  if (!raw || !id || !account) return undefined;
  try {
    const value = JSON.parse(raw) as AgentActionHandoff;
    if (value.id !== id || value.source !== "makoto-agent" || value.account.toLowerCase() !== account.toLowerCase() || value.createdAt > now || value.expiresAt < now || value.expiresAt - value.createdAt > 5 * 60_000) return undefined;
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value.amount) || Number(value.amount) <= 0 || !["USDC", "EURC"].includes(value.asset)) return undefined;
    return Object.freeze(value);
  } catch { return undefined; }
}

export function storeAgentResult(store: Store, result: AgentActionResult) { store.setItem(RESULT_KEY, JSON.stringify(result)); }
export function consumeAgentResult(store: Store, account: string | undefined): AgentActionResult | undefined {
  const raw = store.getItem(RESULT_KEY); store.removeItem(RESULT_KEY); if (!raw || !account) return undefined;
  try { const value = JSON.parse(raw) as AgentActionResult; return value.account.toLowerCase() === account.toLowerCase() ? Object.freeze(value) : undefined; } catch { return undefined; }
}

export function isWalletCancellation(reason: unknown) { return /reject|denied|4001|cancel/i.test(reason instanceof Error ? reason.message : String(reason)); }
