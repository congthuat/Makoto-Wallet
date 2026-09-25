import type { PrepareResult } from "./agent/prepareTools.ts";
import { validateAgentState, type AgentState } from "./agentState.ts";
import type { AgentStateRestoreResult } from "./agentStatePersistence.ts";
import { evaluateAgentTransition } from "./agentTransition.ts";
import { evaluateStrategyRecovery, type StrategyRecoveryRecord } from "./strategyRecovery.ts";
import { verifyStrategyReceipt, type StrategyReceiptObservation } from "./strategyReceipt.ts";

/** Supplied observation must come from a separate, read-only Phase 10C acquisition. */
export type AgentRecoveryInput = Readonly<{
  restored: AgentStateRestoreResult;
  strategy?: unknown;
  record?: StrategyRecoveryRecord;
  preparation?: PrepareResult;
  observation?: StrategyReceiptObservation;
  next?: unknown;
}>;

export type AgentRecoveryResult =
  | Readonly<{ status: "INVALID_EVIDENCE" | "OUTCOME_UNKNOWN" | "PENDING_CONFIRMATION" | "RECEIPT_VERIFICATION_REQUIRED" | "FRESH_REVIEW_REQUIRED" | "FRESH_REVIEW_AND_CONFIRMATION_REQUIRED" | "PREVIOUS_ATTEMPT_STOPPED" | "DESCRIPTIVE_ONLY" | "TERMINAL_HISTORICAL" | "MISSING_PLAN_STRATEGY_BINDING" | "NO_DIRECT_SUCCESS_EDGE" }>
  | Readonly<{ status: "LEGAL_TRANSITION_REQUIRED"; target: "SUCCESS" | "FAILED" }>
  | Readonly<{ status: "GUARDED_TRANSITION"; state: AgentState; sourceOnly: boolean }>;

type Transaction = Extract<AgentState, { kind: "TRANSACTION" }>;
const sameHash = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const matching = (state: Transaction, record: StrategyRecoveryRecord) =>
  record.strategyId === state.step.strategyId && record.stepId === state.step.stepId &&
  record.action === state.binding.action && record.account.toLowerCase() === state.binding.account.toLowerCase() && record.chainId === state.binding.chainId &&
  record.preparedAction.kind === state.binding.preparedAction.kind && record.preparedAction.tool === state.binding.preparedAction.tool && record.preparedAction.quoteFingerprint === state.binding.preparedAction.quoteFingerprint && record.preparedAction.stepIndex === state.binding.preparedAction.stepIndex &&
  (state.binding.action === "BRIDGE" ? state.scope === "SOURCE_CHAIN" : state.scope === "SINGLE_CHAIN") &&
  (!("attempt" in state) || state.attempt?.id === record.attemptId) &&
  (!("submittedHash" in state) || typeof record.submittedHash === "string" && sameHash(state.submittedHash, record.submittedHash));

/** One finite evaluation. It performs no storage write, RPC call, wallet call, or next edge. */
function core(input: AgentRecoveryInput): AgentRecoveryResult {
  if (!input || typeof input !== "object" || !input.restored || input.restored.status !== "HISTORICAL") return { status: "INVALID_EVIDENCE" };
  const checked = validateAgentState(input.restored.state);
  if (!checked.valid) return { status: "INVALID_EVIDENCE" };
  const state = checked.value;
  if (state.kind === "REQUESTED") return { status: "DESCRIPTIVE_ONLY" };
  if (state.kind === "PLAN_READY") return { status: "MISSING_PLAN_STRATEGY_BINDING" };
  if (["SUCCESS", "REJECTED", "EXPIRED", "FAILED"].includes(state.status)) return { status: "TERMINAL_HISTORICAL" };
  if (state.status === "PREPARED") return { status: "FRESH_REVIEW_REQUIRED" };
  const now = Date.now();
  if (!Number.isSafeInteger(now) || now < 0) return { status: "INVALID_EVIDENCE" };
  if (state.status === "AWAITING_SIGNATURE") {
    if (input.record !== undefined) {
      if (!input.strategy || !matching(state, input.record)) return { status: "INVALID_EVIDENCE" };
      const recovery = evaluateStrategyRecovery({ strategy: input.strategy, record: input.record, now });
      if (recovery.status === "SUBMISSION_OUTCOME_UNKNOWN" || recovery.status === "WAIT_FOR_RECEIPT") return { status: "OUTCOME_UNKNOWN" };
      if (recovery.status === "USER_REJECTED") return { status: "PREVIOUS_ATTEMPT_STOPPED" };
      if (recovery.status === "INVALID_EVIDENCE" || recovery.status === "INVALID_STRATEGY") return { status: "INVALID_EVIDENCE" };
      if (recovery.status !== "REVALIDATION_REQUIRED") return { status: "INVALID_EVIDENCE" };
    }
    return { status: "FRESH_REVIEW_AND_CONFIRMATION_REQUIRED" };
  }
  if (state.scope === "DESTINATION_CHAIN" || !input.strategy || !input.record || !matching(state, input.record) || input.record.event !== "SUBMITTED") return { status: "INVALID_EVIDENCE" };
  const current = evaluateStrategyRecovery({ strategy: input.strategy, record: input.record, now });
  if (current.status !== "WAIT_FOR_RECEIPT") return { status: "INVALID_EVIDENCE" };
  if (input.observation === undefined || input.preparation === undefined) return { status: "RECEIPT_VERIFICATION_REQUIRED" };
  if (!Number.isSafeInteger(input.observation.observedAt) || input.observation.observedAt < 0 || input.observation.observedAt > now) return { status: "INVALID_EVIDENCE" };
  const receipt = verifyStrategyReceipt({ strategy: input.strategy, submitted: { strategyId: input.record.strategyId, stepId: input.record.stepId, action: input.record.action, preparedAction: input.record.preparedAction, hash: input.record.submittedHash!, account: input.record.account as `0x${string}`, chainId: input.record.chainId }, preparation: input.preparation, observation: input.observation });
  if (receipt.status === "INVALID_EVIDENCE" || receipt.status === "MISMATCH") return { status: "INVALID_EVIDENCE" };
  const recovery = evaluateStrategyRecovery({ strategy: input.strategy, record: input.record, receipt, now });
  if (recovery.status === "INVALID_EVIDENCE" || recovery.status === "INVALID_STRATEGY") return { status: "INVALID_EVIDENCE" };
  if (receipt.status === "PENDING") return recovery.status === "WAIT_FOR_RECEIPT" ? { status: "PENDING_CONFIRMATION" } : { status: "INVALID_EVIDENCE" };
  if (receipt.status === "UNAVAILABLE") return recovery.status === "WAIT_FOR_RECEIPT" ? { status: "OUTCOME_UNKNOWN" } : { status: "INVALID_EVIDENCE" };
  if (receipt.status === "CONFIRMED" && state.status === "SUBMITTED") return { status: "NO_DIRECT_SUCCESS_EDGE" };
  const target = receipt.status === "REVERTED" ? "FAILED" : "SUCCESS";
  if (receipt.status === "REVERTED" && recovery.status !== "REVALIDATION_REQUIRED" || receipt.status === "CONFIRMED" && !["CONTINUATION_RECHECK_REQUIRED", "REVALIDATION_REQUIRED", "DESTINATION_STATUS_UNRESOLVED"].includes(recovery.status)) return { status: "INVALID_EVIDENCE" };
  if (input.next === undefined) return { status: "LEGAL_TRANSITION_REQUIRED", target };
  const next = validateAgentState(input.next);
  if (!next.valid || next.value.kind !== "TRANSACTION" || next.value.status !== target) return { status: "INVALID_EVIDENCE" };
  const transition = evaluateAgentTransition(state, next.value, { kind: "RECEIPT", sessionId: state.sessionId, stateId: state.stateId, strategy: input.strategy, record: input.record, receipt, now });
  return transition.allowed ? { status: "GUARDED_TRANSITION", state: transition.state, sourceOnly: state.scope === "SOURCE_CHAIN" } : { status: "INVALID_EVIDENCE" };
}

/** Historical restoration never becomes authority by itself. */
export function evaluateAgentRecovery(input: AgentRecoveryInput): AgentRecoveryResult {
  try { return core(input); }
  catch { return { status: "INVALID_EVIDENCE" }; }
}
