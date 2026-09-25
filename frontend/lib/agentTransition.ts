import { validateAgentState, type AgentState } from "./agentState.ts";
import { validatePlannerPlan } from "./plannerPlan.ts";
import type { PlannerPlanGenerationResult } from "./plannerPlanGenerator.ts";
import { executeStrategyStep, type StrategyStepInput } from "./strategyStep.ts";
import { evaluateStrategyRecovery, type RecoveryArtifacts, type StrategyRecoveryRecord } from "./strategyRecovery.ts";
import type { StrategyReceiptResult } from "./strategyReceipt.ts";

type EvidenceBase = Readonly<{ sessionId: string; stateId: string }>;
export type AgentTransitionEvidence = EvidenceBase & (
  | Readonly<{ kind: "PLAN"; result: PlannerPlanGenerationResult }>
  | Readonly<{ kind: "REVIEW"; input: StrategyStepInput }>
  | Readonly<{ kind: "ATTEMPT"; strategy: unknown; record: StrategyRecoveryRecord; now: number }>
  | Readonly<{ kind: "RECEIPT"; strategy: unknown; record: StrategyRecoveryRecord; receipt: StrategyReceiptResult; now: number }>
  | Readonly<{ kind: "OUTCOME"; strategy: unknown; record: StrategyRecoveryRecord; now: number; artifacts?: RecoveryArtifacts }>
);
export type AgentTransitionRejection =
  | "INVALID_STATE" | "INVALID_EVIDENCE" | "IDENTITY_MISMATCH" | "ILLEGAL_TRANSITION"
  | "MISSING_CANONICAL_STRATEGY_BINDING" | "DEFERRED_TO_LATER_PHASE"
  | "POLICY_STOP" | "RECEIPT_NOT_CONFIRMED" | "SCOPE_MISMATCH" | "TERMINAL_NOT_PROVEN";
export type AgentTransitionResult =
  | Readonly<{ allowed: true; state: AgentState }>
  | Readonly<{ allowed: false; reason: AgentTransitionRejection }>;

type TransactionState = Extract<AgentState, { kind: "TRANSACTION" }>;
const deny = (reason: AgentTransitionRejection): AgentTransitionResult => ({ allowed: false, reason });
const sameHash = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const status = (state: AgentState) => state.kind === "TRANSACTION" ? state.status : state.kind;
const transaction = (state: AgentState): state is TransactionState => state.kind === "TRANSACTION";
const exactEvidence = (value: Record<string, unknown>) => {
  if (value.kind === "OUTCOME") {
    const required = ["kind", "sessionId", "stateId", "strategy", "record", "now"];
    return required.every((field) => Object.hasOwn(value, field)) && Reflect.ownKeys(value).every((field) => typeof field === "string" && [...required, "artifacts"].includes(field) && Object.getOwnPropertyDescriptor(value, field)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, field)!, "value"));
  }
  const fields = value.kind === "PLAN" ? ["kind", "sessionId", "stateId", "result"]
    : value.kind === "REVIEW" ? ["kind", "sessionId", "stateId", "input"]
    : value.kind === "ATTEMPT" ? ["kind", "sessionId", "stateId", "strategy", "record", "now"]
    : value.kind === "RECEIPT" ? ["kind", "sessionId", "stateId", "strategy", "record", "receipt", "now"] : [];
  return fields.length > 0 && Reflect.ownKeys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field) && Object.getOwnPropertyDescriptor(value, field)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, field)!, "value"));
};
const recordMatches = (state: TransactionState, record: StrategyRecoveryRecord) =>
  record.strategyId === state.step.strategyId && record.stepId === state.step.stepId &&
  ("attempt" in state ? state.attempt?.id === record.attemptId : true);

/** Classifies one requested 12D outcome using the existing 10F guard. */
function terminalTransition(from: TransactionState, to: TransactionState, evidence: Record<string, unknown>): AgentTransitionResult {
  if ((evidence.kind !== "OUTCOME" && evidence.kind !== "RECEIPT") || !evidence.record || typeof evidence.record !== "object" || !Number.isSafeInteger(evidence.now) || (evidence.now as number) < 0) return deny("INVALID_EVIDENCE");
  if (evidence.kind === "RECEIPT" && evidence.receipt === undefined) return deny("INVALID_EVIDENCE");
  const record = evidence.record as StrategyRecoveryRecord;
  if (!recordMatches(from, record) || !recordMatches(to, record) || !("attempt" in to) || to.attempt?.id !== record.attemptId) return deny("IDENTITY_MISMATCH");
  if (record.action === "BRIDGE" ? from.scope !== "SOURCE_CHAIN" : from.scope !== "SINGLE_CHAIN") return deny("SCOPE_MISMATCH");
  const beforeSubmission = from.status === "AWAITING_SIGNATURE" && evidence.kind === "OUTCOME" && record.event !== "SUBMITTED";
  const submitted = (from.status === "SUBMITTED" || from.status === "CONFIRMING") && evidence.kind === "RECEIPT" && record.event === "SUBMITTED";
  if (!beforeSubmission && !submitted) return deny("TERMINAL_NOT_PROVEN");
  const receipt = evidence.kind === "RECEIPT" ? evidence.receipt as StrategyReceiptResult : undefined;
  const artifacts = evidence.kind === "OUTCOME" ? evidence.artifacts as RecoveryArtifacts | undefined : undefined;
  const now = evidence.now as number;
  const recovery = evaluateStrategyRecovery({ strategy: evidence.strategy, record, now, ...(receipt === undefined ? {} : { receipt }), ...(artifacts === undefined ? {} : { artifacts }) });
  if (recovery.status === "INVALID_STRATEGY" || recovery.status === "INVALID_EVIDENCE") return deny("INVALID_EVIDENCE");
  if (!("attemptId" in recovery) || recovery.attemptId !== record.attemptId) return deny("IDENTITY_MISMATCH");
  if (to.status === "REJECTED") return beforeSubmission && record.event === "USER_REJECTED" && artifacts === undefined && recovery.status === "USER_REJECTED" ? { allowed: true, state: to } : deny("TERMINAL_NOT_PROVEN");
  if (to.status === "EXPIRED") {
    const expired = artifacts && (now > artifacts.quote.expiresAt || now > artifacts.preparation.expiresAt || artifacts.handoff !== undefined && now > artifacts.handoff.expiresAt);
    return beforeSubmission && record.event === "PRE_SUBMISSION_FAILURE" && expired && (recovery.status === "REQUOTE_REQUIRED" || recovery.status === "REPREPARE_REQUIRED") ? { allowed: true, state: to } : deny("TERMINAL_NOT_PROVEN");
  }
  if (to.status === "FAILED") return submitted && receipt?.status === "REVERTED" && recovery.status === "REVALIDATION_REQUIRED" ? { allowed: true, state: to } : deny("TERMINAL_NOT_PROVEN");
  return deny("ILLEGAL_TRANSITION");
}

/** Evaluates one requested edge. No state is stored, signed, submitted, or advanced again. */
function evaluateAgentTransitionCore(currentInput: unknown, nextInput: unknown, evidenceInput: unknown): AgentTransitionResult {
  const current = validateAgentState(currentInput), next = validateAgentState(nextInput);
  if (!current.valid || !next.valid) return deny("INVALID_STATE");
  const from = current.value, to = next.value;
  if (from.sessionId !== to.sessionId || from.stateId === to.stateId) return deny("IDENTITY_MISMATCH");
  if (from.kind === "PLAN_READY" && transaction(to) && to.status === "PREPARED") return deny("MISSING_CANONICAL_STRATEGY_BINDING");

  const edge = `${status(from)}>${status(to)}`;
  const terminal = transaction(to) && ["REJECTED", "EXPIRED", "FAILED"].includes(to.status);
  if (terminal && (!transaction(from) || !(to.status === "FAILED" ? ["SUBMITTED", "CONFIRMING"].includes(from.status) : from.status === "AWAITING_SIGNATURE"))) return deny("ILLEGAL_TRANSITION");
  if (!terminal && !["REQUESTED>PLAN_READY", "PREPARED>AWAITING_SIGNATURE", "AWAITING_SIGNATURE>SUBMITTED", "SUBMITTED>CONFIRMING", "CONFIRMING>SUCCESS"].includes(edge)) return deny("ILLEGAL_TRANSITION");
  if (!evidenceInput || typeof evidenceInput !== "object" || Array.isArray(evidenceInput) || Object.getPrototypeOf(evidenceInput) !== Object.prototype) return deny("INVALID_EVIDENCE");
  const evidence = evidenceInput as Record<string, unknown>;
  if (!exactEvidence(evidence)) return deny("INVALID_EVIDENCE");
  if (evidence.sessionId !== from.sessionId || evidence.stateId !== from.stateId) return deny("IDENTITY_MISMATCH");

  if (edge === "REQUESTED>PLAN_READY") {
    if (to.kind !== "PLAN_READY" || evidence.kind !== "PLAN" || !evidence.result || typeof evidence.result !== "object" || (evidence.result as { status?: unknown }).status !== "GENERATED") return deny("INVALID_EVIDENCE");
    const plan = (evidence.result as Extract<PlannerPlanGenerationResult, { status: "GENERATED" }>).plan;
    const checked = validatePlannerPlan(plan);
    return checked.valid && checked.value.id === to.plan.id ? { allowed: true, state: to } : deny("INVALID_EVIDENCE");
  }

  if (!transaction(from) || !transaction(to) || from.step.strategyId !== to.step.strategyId || from.step.stepId !== to.step.stepId || from.scope !== to.scope) return deny("IDENTITY_MISMATCH");
  if (terminal) return terminalTransition(from, to, evidence);
  if (edge === "PREPARED>AWAITING_SIGNATURE") {
    if (evidence.kind !== "REVIEW" || !evidence.input || typeof evidence.input !== "object") return deny("INVALID_EVIDENCE");
    let result;
    try { result = executeStrategyStep(evidence.input as StrategyStepInput); }
    catch { return deny("INVALID_EVIDENCE"); }
    if (result.status === "POLICY_STOP") return deny("POLICY_STOP");
    if (result.status !== "READY_FOR_WALLET_REVIEW" || result.strategyId !== from.step.strategyId || result.stepId !== from.step.stepId || result.confirmation !== "EXPLICIT_USER_CONFIRMATION") return deny("INVALID_EVIDENCE");
    if (result.policy.mustStop || !result.policy.requiresUserReview || !["ALLOW", "WARN", "REQUIRE_REVIEW"].includes(result.policy.decision)) return deny("POLICY_STOP");
    if (result.action === "BRIDGE" ? from.scope !== "SOURCE_CHAIN" : from.scope !== "SINGLE_CHAIN") return deny("SCOPE_MISMATCH");
    return { allowed: true, state: to };
  }

  if ((evidence.kind !== "ATTEMPT" && evidence.kind !== "RECEIPT") || !evidence.record || typeof evidence.record !== "object" || !Number.isSafeInteger(evidence.now) || (evidence.now as number) < 0) return deny("INVALID_EVIDENCE");
  const record = evidence.record as StrategyRecoveryRecord;
  if (!recordMatches(from, record) || !recordMatches(to, record) || record.event !== "SUBMITTED") return deny("IDENTITY_MISMATCH");
  if (record.action === "BRIDGE" ? from.scope !== "SOURCE_CHAIN" : from.scope !== "SINGLE_CHAIN") return deny("SCOPE_MISMATCH");
  if (edge === "AWAITING_SIGNATURE>SUBMITTED" && evidence.kind !== "ATTEMPT" || edge !== "AWAITING_SIGNATURE>SUBMITTED" && evidence.kind !== "RECEIPT") return deny("INVALID_EVIDENCE");
  const receipt = evidence.kind === "RECEIPT" ? evidence.receipt as StrategyReceiptResult : undefined;
  let recovery;
  try { recovery = evaluateStrategyRecovery({ strategy: evidence.strategy, record, now: evidence.now as number, ...(receipt ? { receipt } : {}) }); }
  catch { return deny("INVALID_EVIDENCE"); }
  if (recovery.status === "INVALID_STRATEGY" || recovery.status === "INVALID_EVIDENCE") return deny("INVALID_EVIDENCE");
  if (edge === "AWAITING_SIGNATURE>SUBMITTED") return recovery.status === "WAIT_FOR_RECEIPT" ? { allowed: true, state: to } : deny("INVALID_EVIDENCE");
  if (!receipt || receipt.status === "UNAVAILABLE" || receipt.status === "PENDING" && edge === "CONFIRMING>SUCCESS") return deny("RECEIPT_NOT_CONFIRMED");
  if (edge === "SUBMITTED>CONFIRMING") return receipt.status === "PENDING" && recovery.status === "WAIT_FOR_RECEIPT" ? { allowed: true, state: to } : deny("RECEIPT_NOT_CONFIRMED");
  if (receipt.status !== "CONFIRMED" || to.status !== "SUCCESS" || !("receipt" in to) || !record.submittedHash || !sameHash(receipt.hash, record.submittedHash) || !sameHash(to.receipt.transactionHash, receipt.hash) || to.receipt.chainId !== receipt.chainId || receipt.scope !== "SOURCE_TRANSACTION") return deny("RECEIPT_NOT_CONFIRMED");
  if (!["CONTINUATION_RECHECK_REQUIRED", "REVALIDATION_REQUIRED", "DESTINATION_STATUS_UNRESOLVED"].includes(recovery.status)) return deny("RECEIPT_NOT_CONFIRMED");
  return { allowed: true, state: to };
}

/** Malformed runtime objects must deny the requested edge rather than escape the guard. */
export function evaluateAgentTransition(currentInput: unknown, nextInput: unknown, evidenceInput: unknown): AgentTransitionResult {
  try { return evaluateAgentTransitionCore(currentInput, nextInput, evidenceInput); }
  catch { return deny("INVALID_EVIDENCE"); }
}
