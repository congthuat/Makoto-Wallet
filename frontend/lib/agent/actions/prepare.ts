import type { AgentActionDraft } from "../types.ts";
import type { AgentActionHandoff, AgentPreparedAction } from "./types.ts";
import { validateAgentActionDraft } from "./validation.ts";

export const AGENT_HANDOFF_TTL_MS = 5 * 60_000;

export function prepareAgentActionHandoff(draft: AgentActionDraft, account = "", now = Date.now()): AgentPreparedAction {
  const validation = validateAgentActionDraft(draft);
  if (!validation.valid) return Object.freeze({ draft, status: validation.missingFields.length ? "needs-input" : "blocked", missingFields: validation.missingFields, warnings: validation.errors });
  if (!/^0x[a-fA-F0-9]{40}$/.test(account)) return Object.freeze({ draft, status: "blocked", missingFields: Object.freeze([]), warnings: Object.freeze(["Connect the wallet that will review this action."]) });
  return Object.freeze({ draft, status: "preparing", missingFields: Object.freeze([]), warnings: Object.freeze(["Makoto Agent never signs transactions."]), handoff: handoffFor(draft, account, now) });
}

export function handoffUrl(handoff: AgentActionHandoff) { return `${handoff.path}?agentHandoff=${encodeURIComponent(handoff.id)}`; }

export function bindAgentHandoffJar(handoff: AgentActionHandoff, jarId: bigint, now = Date.now()): AgentActionHandoff {
  return Object.freeze({ ...handoff, id: createId(now), jarId: jarId.toString(), createdAt: now, expiresAt: now + AGENT_HANDOFF_TTL_MS });
}

function handoffFor(draft: AgentActionDraft, account: string, now: number): AgentActionHandoff {
  return Object.freeze({ id: createId(now), path: draft.kind === "vault-deposit" || draft.kind === "vault-withdraw" ? "/savings" : "/", action: draft.kind, account, createdAt: now, expiresAt: now + AGENT_HANDOFF_TTL_MS, amount: draft.amount!, asset: draft.asset!, sourceChain: draft.sourceChain, destinationChain: draft.destinationChain, outputAsset: draft.outputAsset, recipient: draft.recipient, source: "makoto-agent" });
}

function createId(now: number) { return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
