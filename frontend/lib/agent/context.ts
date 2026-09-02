import type { AgentActivityLoadState, AgentContextSnapshot } from "./types.ts";

export const AGENT_SAFETY_CAPABILITIES = Object.freeze([
  "read-only simulation", "known-contract verification", "finite approval enforcement",
  "request fingerprint", "fee-envelope checks", "review expiry", "wallet confirmation", "receipt confirmation",
]);

type AgentContextSnapshotInput = Omit<AgentContextSnapshot, "safetyCapabilities" | "timestamp" | "activityLoadState" | "activityPartial" | "activityUnavailable"> & { timestamp?: number; activityLoadState?: AgentActivityLoadState; activityPartial?: boolean; activityUnavailable?: boolean };
export function createAgentContextSnapshot(input: AgentContextSnapshotInput): AgentContextSnapshot {
  const activityLoadState = input.activityLoadState ?? (input.activityUnavailable ? "unavailable" : input.activityPartial ? "partial" : "loaded");
  const snapshot: AgentContextSnapshot = {
    connected: input.connected,
    ...(input.account ? { account: input.account } : {}),
    ...(input.walletType ? { walletType: input.walletType } : {}),
    ...(input.verifiedChainId !== undefined ? { verifiedChainId: input.verifiedChainId } : {}),
    isArc: input.isArc,
    balances: Object.freeze({ ...input.balances }),
    activity: Object.freeze([...input.activity]),
    activityLoadState,
    activityPartial: activityLoadState === "partial",
    activityUnavailable: activityLoadState === "unavailable",
    vault: Object.freeze({ ...input.vault }),
    safetyCapabilities: AGENT_SAFETY_CAPABILITIES,
    timestamp: input.timestamp ?? Date.now(),
  };
  return Object.freeze(snapshot);
}
