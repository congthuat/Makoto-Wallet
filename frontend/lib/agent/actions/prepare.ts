import type { AgentActionDraft } from "../types.ts";
import type { AgentActionHandoff, AgentPreparedAction } from "./types.ts";
import { validateAgentActionDraft } from "./validation.ts";

export function prepareAgentActionHandoff(draft: AgentActionDraft): AgentPreparedAction {
  const validation = validateAgentActionDraft(draft);
  if (!validation.valid) return Object.freeze({ draft, status: validation.missingFields.length ? "needs-input" : "blocked", missingFields: validation.missingFields, warnings: validation.errors });
  return Object.freeze({ draft, status: "preparing", missingFields: Object.freeze([]), warnings: Object.freeze(["Makoto Agent never signs transactions."]), handoff: handoffFor(draft) });
}

export function handoffUrl(handoff: AgentActionHandoff) {
  const query = new URLSearchParams({ ...handoff.query, source: handoff.source });
  return `${handoff.path}?${query.toString()}`;
}

function handoffFor(draft: AgentActionDraft): AgentActionHandoff {
  const common = { action: draft.kind, amount: draft.amount!, asset: draft.asset!, sourceChain: draft.sourceChain ?? "Arc Testnet" };
  if (draft.kind === "send") return Object.freeze({ path: "/", source: "makoto-agent", query: Object.freeze({ ...common, recipient: draft.recipient! }) });
  if (draft.kind === "swap") return Object.freeze({ path: "/", source: "makoto-agent", query: Object.freeze({ ...common, outputAsset: draft.outputAsset! }) });
  if (draft.kind === "bridge") return Object.freeze({ path: "/unified-balance", source: "makoto-agent", query: Object.freeze({ ...common, destinationChain: draft.destinationChain!, ...(draft.recipient ? { recipient: draft.recipient } : {}) }) });
  return Object.freeze({ path: "/savings", source: "makoto-agent", query: Object.freeze(common) });
}
