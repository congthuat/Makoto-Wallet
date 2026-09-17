import type { AgentIntent } from "./types.ts";

/** Display classification only; never authorizes or prepares an action. */
export function agentWorkspaceMode(intent?: AgentIntent, hasDraft = false, isResult = false) {
  if (isResult) return "result";
  if (hasDraft || intent?.kind === "prepare-action" || intent?.preparation) return "action";
  if (!intent || intent.kind === "unknown" || intent.kind === "clarification") return "answer";
  return "read";
}
