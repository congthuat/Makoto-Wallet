import type { AgentContextSnapshot } from "./types.ts";

export const AGENT_SAFETY_CAPABILITIES = Object.freeze([
  "read-only simulation", "known-contract verification", "finite approval enforcement",
  "request fingerprint", "fee-envelope checks", "review expiry", "wallet confirmation", "receipt confirmation",
]);

export function createAgentContextSnapshot(input: Omit<AgentContextSnapshot, "safetyCapabilities" | "timestamp"> & { timestamp?: number }): AgentContextSnapshot {
  const snapshot: AgentContextSnapshot = {
    connected: input.connected,
    ...(input.account ? { account: input.account } : {}),
    ...(input.walletType ? { walletType: input.walletType } : {}),
    ...(input.verifiedChainId !== undefined ? { verifiedChainId: input.verifiedChainId } : {}),
    isArc: input.isArc,
    balances: Object.freeze({ ...input.balances }),
    activity: Object.freeze([...input.activity]),
    activityPartial: input.activityPartial,
    activityUnavailable: input.activityUnavailable,
    vault: Object.freeze({ ...input.vault }),
    safetyCapabilities: AGENT_SAFETY_CAPABILITIES,
    timestamp: input.timestamp ?? Date.now(),
  };
  return Object.freeze(snapshot);
}
