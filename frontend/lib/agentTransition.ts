import { bindAgentTransaction, sameAgentBinding } from "./agentTransactionBinding.ts";
import { validateAgentState, type AgentState } from "./agentState.ts";
import { validatePlannerPlan } from "./plannerPlan.ts";
import type { PlannerPlanGenerationResult } from "./plannerPlanGenerator.ts";
import { executeStrategyStep, type StrategyStepInput } from "./strategyStep.ts";
import { evaluateStrategyRecovery, type RecoveryArtifacts, type StrategyRecoveryRecord } from "./strategyRecovery.ts";
import type { StrategyReceiptResult } from "./strategyReceipt.ts";
import { validateAeiDOperationalEnvelope, type AEIDOperationalEnvelopeV1 } from "./aeiDOrchestration.ts";
import { createPreparedAgentState } from "./agentState.ts";
import { validateStrategy, type Strategy } from "./strategyModel.ts";
import { keccak256, stringToHex } from "viem";
import { arcTestnet } from "viem/chains";
import { canonicalPlannerDataJSON } from "./plannerStrategyBinding.ts";

type EvidenceBase = Readonly<{ sessionId: string; stateId: string }>;
export type AgentTransitionEvidence = EvidenceBase & (
  | Readonly<{ kind: "PLAN"; result: PlannerPlanGenerationResult }>
  | Readonly<{ kind: "REVIEW"; input: StrategyStepInput }>
  | Readonly<{ kind: "ATTEMPT"; strategy: unknown; record: StrategyRecoveryRecord; now: number }>
  | Readonly<{ kind: "RECEIPT"; strategy: unknown; record: StrategyRecoveryRecord; receipt: StrategyReceiptResult; now: number }>
  | Readonly<{ kind: "OUTCOME"; strategy: unknown; record: StrategyRecoveryRecord; artifacts?: RecoveryArtifacts }>
  | Readonly<{ kind: "AEI_E_PREPARED"; proof: object }>
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
const preparedProofs = new WeakMap<object, Readonly<{ fromId: string; toId: string; envelope: AEIDOperationalEnvelopeV1; strategy: Strategy }>>();
const activeIntegrations = new WeakMap<object, Readonly<{ envelope: AEIDOperationalEnvelopeV1; retainedLiveInput: unknown; digest: string }>>();
const latestOperationalDigest = new Map<string, string>();
const preparedStateIds = new Set<string>();
const sameHash = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const status = (state: AgentState) => state.kind === "TRANSACTION" ? state.status : state.kind;
const transaction = (state: AgentState): state is TransactionState => state.kind === "TRANSACTION";
const exactEvidence = (value: Record<string, unknown>) => {
  if (value.kind === "OUTCOME") {
    const required = ["kind", "sessionId", "stateId", "strategy", "record"];
    return required.every((field) => Object.hasOwn(value, field)) && Reflect.ownKeys(value).every((field) => typeof field === "string" && [...required, "artifacts"].includes(field) && Object.getOwnPropertyDescriptor(value, field)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, field)!, "value"));
  }
  const fields = value.kind === "PLAN" ? ["kind", "sessionId", "stateId", "result"]
    : value.kind === "AEI_E_PREPARED" ? ["kind", "sessionId", "stateId", "proof"]
    : value.kind === "REVIEW" ? ["kind", "sessionId", "stateId", "input"]
    : value.kind === "ATTEMPT" ? ["kind", "sessionId", "stateId", "strategy", "record", "now"]
    : value.kind === "RECEIPT" ? ["kind", "sessionId", "stateId", "strategy", "record", "receipt", "now"] : [];
  return fields.length > 0 && Reflect.ownKeys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field) && Object.getOwnPropertyDescriptor(value, field)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, field)!, "value"));
};
const recordMatches = (state: TransactionState, record: StrategyRecoveryRecord) =>
  (!("submittedHash" in state) || typeof record.submittedHash === "string" && sameHash(state.submittedHash, record.submittedHash)) &&
  record.account.toLowerCase() === state.binding.account.toLowerCase() && record.chainId === state.binding.chainId && record.action === state.binding.action &&
  record.preparedAction.kind === state.binding.preparedAction.kind && record.preparedAction.tool === state.binding.preparedAction.tool && record.preparedAction.quoteFingerprint === state.binding.preparedAction.quoteFingerprint && record.preparedAction.stepIndex === state.binding.preparedAction.stepIndex &&
  record.strategyId === state.step.strategyId && record.stepId === state.step.stepId &&
  ("attempt" in state ? state.attempt?.id === record.attemptId : true);

/** Classifies one requested 12D outcome using the existing 10F guard. */
function terminalTransition(from: TransactionState, to: TransactionState, evidence: Record<string, unknown>, observedNow: number): AgentTransitionResult {
  if ((evidence.kind !== "OUTCOME" && evidence.kind !== "RECEIPT") || !evidence.record || typeof evidence.record !== "object" || !Number.isSafeInteger(observedNow) || observedNow < 0) return deny("INVALID_EVIDENCE");
  if (evidence.kind === "RECEIPT" && evidence.receipt === undefined) return deny("INVALID_EVIDENCE");
  const record = evidence.record as StrategyRecoveryRecord;
  if (!recordMatches(from, record) || !recordMatches(to, record) || !("attempt" in to) || to.attempt?.id !== record.attemptId) return deny("IDENTITY_MISMATCH");
  if (record.action === "BRIDGE" ? from.scope !== "SOURCE_CHAIN" : from.scope !== "SINGLE_CHAIN") return deny("SCOPE_MISMATCH");
  const beforeSubmission = from.status === "AWAITING_SIGNATURE" && evidence.kind === "OUTCOME" && record.event !== "SUBMITTED";
  const submitted = (from.status === "SUBMITTED" || from.status === "CONFIRMING") && evidence.kind === "RECEIPT" && record.event === "SUBMITTED";
  if (!beforeSubmission && !submitted) return deny("TERMINAL_NOT_PROVEN");
  const receipt = evidence.kind === "RECEIPT" ? evidence.receipt as StrategyReceiptResult : undefined;
  const artifacts = evidence.kind === "OUTCOME" ? evidence.artifacts as RecoveryArtifacts | undefined : undefined;
  const now = observedNow;
  if (artifacts && (artifacts.quote.expiresAt !== from.binding.quoteExpiresAt || artifacts.preparation.expiresAt !== from.binding.preparationExpiresAt || (artifacts.handoff?.expiresAt ?? null) !== from.binding.handoffExpiresAt)) return deny("INVALID_EVIDENCE");
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
function evaluateAgentTransitionCore(currentInput: unknown, nextInput: unknown, evidenceInput: unknown, clock: () => number): AgentTransitionResult {
  const current = validateAgentState(currentInput), next = validateAgentState(nextInput);
  if (!current.valid || !next.valid) return deny((!current.valid && current.reason === "INVALID_RUNTIME") || (!next.valid && next.reason === "INVALID_RUNTIME") ? "INVALID_EVIDENCE" : "INVALID_STATE");
  const from = current.value, to = next.value;
  if (from.sessionId !== to.sessionId || from.stateId === to.stateId) return deny("IDENTITY_MISMATCH");
  if (from.kind === "PLAN_READY" && transaction(to) && to.status === "PREPARED") {
    if (!evidenceInput || typeof evidenceInput !== "object" || Array.isArray(evidenceInput) || Object.getPrototypeOf(evidenceInput) !== Object.prototype) return deny("MISSING_CANONICAL_STRATEGY_BINDING");
    const evidence = evidenceInput as Record<string, unknown>;
    if (!exactEvidence(evidence) || evidence.kind !== "AEI_E_PREPARED" || evidence.sessionId !== from.sessionId || evidence.stateId !== from.stateId || !evidence.proof || typeof evidence.proof !== "object") return deny("MISSING_CANONICAL_STRATEGY_BINDING");
    const proof = preparedProofs.get(evidence.proof);
    preparedProofs.delete(evidence.proof);
    if (!proof) return deny("MISSING_CANONICAL_STRATEGY_BINDING");
    if (proof.fromId !== from.stateId || proof.toId !== to.stateId || from.plan.id !== proof.envelope.materialization.planId || from.sessionId !== proof.envelope.materialization.sessionId ||
        to.step.strategyId !== proof.envelope.materialization.strategyId || !proof.strategy.steps.some((step) => step.id === to.step.stepId && step.kind === "ACTION") ||
        proof.envelope.accountContext?.account.toLowerCase() !== to.binding.account.toLowerCase() || proof.envelope.accountContext.chainId !== to.binding.chainId || to.scope !== "SINGLE_CHAIN") return deny("IDENTITY_MISMATCH");
    const bound = bindAgentTransaction({ strategy: proof.strategy, stepId: to.step.stepId, quote: proof.envelope.quote?.result, preparation: proof.envelope.prepared?.result });
    return bound && sameAgentBinding(bound, to.binding) ? { allowed: true, state: to } : deny("IDENTITY_MISMATCH");
  }

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

  if (!transaction(from) || !transaction(to) || from.step.strategyId !== to.step.strategyId || from.step.stepId !== to.step.stepId || from.scope !== to.scope || !sameAgentBinding(from.binding, to.binding)) return deny("IDENTITY_MISMATCH");
  if (terminal) return terminalTransition(from, to, evidence, clock());
  if (edge === "PREPARED>AWAITING_SIGNATURE") {
    if (evidence.kind !== "REVIEW" || !evidence.input || typeof evidence.input !== "object") return deny("INVALID_EVIDENCE");
    let result;
    try { result = executeStrategyStep(evidence.input as StrategyStepInput); }
    catch { return deny("INVALID_EVIDENCE"); }
    if (result.status === "POLICY_STOP") return deny("POLICY_STOP");
    if (result.status !== "READY_FOR_WALLET_REVIEW" || result.strategyId !== from.step.strategyId || result.stepId !== from.step.stepId || result.confirmation !== "EXPLICIT_USER_CONFIRMATION") return deny("INVALID_EVIDENCE");
    if (result.policy.mustStop || !result.policy.requiresUserReview || !["ALLOW", "WARN", "REQUIRE_REVIEW"].includes(result.policy.decision)) return deny("POLICY_STOP");
    if (result.action === "BRIDGE" ? from.scope !== "SOURCE_CHAIN" : from.scope !== "SINGLE_CHAIN") return deny("SCOPE_MISMATCH");
    const input = evidence.input as StrategyStepInput;
    const bound = bindAgentTransaction({ strategy: input.strategy, stepId: input.stepId, quote: input.policyInput?.quote, preparation: input.policyInput?.preparation });
    if (!bound || !sameAgentBinding(from.binding, bound)) return deny("IDENTITY_MISMATCH");
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

/** Sample the runtime clock once per terminal edge; callers cannot supply it as evidence. */
export function evaluateAgentTransition(currentInput: unknown, nextInput: unknown, evidenceInput: unknown): AgentTransitionResult {
  try { return evaluateAgentTransitionCore(currentInput, nextInput, evidenceInput, () => Date.now()); }
  catch { return deny("INVALID_EVIDENCE"); }
}

/** AEI-E records one live D outcome without creating another transaction lifecycle. */
export type Phase12OperationalStateBindingV1 = Readonly<{
  version: 1; stateId: string; sessionId: string; planId: string; strategyId: string; strategyDigest: string;
  actionStepId: string; goalId: string; overlayDigest: string | null; account: string; chainId: number; materializationRevision: string;
  materializationDigest: string; orchestrationRevision: string; orchestrationDigest: string;
  readDigests: readonly string[]; quoteDigest: string | null; quoteFingerprint: string | null;
  quoteExpiresAt: number | null; preparationDigest: string | null; preparationExpiresAt: number | null;
  policyDigest: string | null; policyDecision: string | null; technicalStepId: string | null;
  technicalStepIndex: number | null; technicalStepKind: string | null; technicalSteps: readonly Readonly<{ index: number; stepId: string; kind: string; requiresConfirmedPriorStep: boolean }>[];
  outcome: AEIDOperationalEnvelopeV1["status"]; warnings: readonly string[]; reviewRequirements: readonly string[];
  currentness: "ISSUED_LIVE" | "HISTORICAL"; executionEnabled: false; executionAuthority: "FORBIDDEN"; digest: string;
}>;
export type AeiEIntegrationResult =
  | Readonly<{ status: "MAPPED"; state: AgentState; sidecar: Phase12OperationalStateBindingV1 }>
  | Readonly<{ status: "REJECTED"; reason: "INVALID_INPUT" | "INVALID_STATE" | "INVALID_OPERATIONAL_ENVELOPE" | "IDENTITY_MISMATCH" | "UNSUPPORTED_PREPARED_MAPPING" | "TRANSITION_DENIED" }>;
type AeiEInput = Readonly<{ version: 1; envelope: AEIDOperationalEnvelopeV1; retainedLiveInput: unknown; currentState: unknown }>;
const aeiEId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const operationalKey = (e: AEIDOperationalEnvelopeV1) => [e.materialization.sessionId, e.materialization.strategyId, e.action.actionStepId, e.accountContext?.account.toLowerCase(), e.accountContext?.chainId].join(":");
const aeiEHash = (tuple: unknown) => keccak256(stringToHex(JSON.stringify(["makoto-aei-e-state", 1, tuple])));
const sidecarDigest = (base: Omit<Phase12OperationalStateBindingV1, "digest">) => aeiEHash([base.version, base.stateId, base.sessionId,
  base.planId, base.strategyId, base.strategyDigest, base.actionStepId, base.goalId, base.overlayDigest,
  base.account, base.chainId, base.materializationRevision, base.materializationDigest, base.orchestrationRevision,
  base.orchestrationDigest, base.readDigests, base.quoteDigest, base.quoteFingerprint, base.quoteExpiresAt,
  base.preparationDigest, base.preparationExpiresAt, base.policyDigest, base.policyDecision, base.technicalStepId,
  base.technicalStepIndex, base.technicalStepKind, base.technicalSteps.map((s) => [s.index, s.stepId, s.kind, s.requiresConfirmedPriorStep]), base.outcome,
  base.warnings, base.reviewRequirements, base.currentness, base.executionEnabled, base.executionAuthority]);
const exactInput = (value: unknown): value is AeiEInput => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const fields = ["version", "envelope", "retainedLiveInput", "currentState"];
  return Reflect.ownKeys(value).length === fields.length && fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
};
const frozenStateCopy = (value: AgentState): AgentState => {
  const freeze = (part: unknown): void => {
    if (part && typeof part === "object") {
      for (const child of Object.values(part)) freeze(child);
      Object.freeze(part);
    }
  };
  const copy = JSON.parse(JSON.stringify(value)) as AgentState;
  freeze(copy);
  return copy;
};
const integrationReject = (reason: Extract<AeiEIntegrationResult, { status: "REJECTED" }>["reason"]): AeiEIntegrationResult => ({ status: "REJECTED", reason });

/** Validates D's private live registration immediately before the single reducer edge. */
export async function integrateAeiDOperationalState(raw: unknown): Promise<AeiEIntegrationResult> {
  try {
    if (!exactInput(raw) || raw.version !== 1) return integrationReject("INVALID_INPUT");
    const checked = validateAgentState(raw.currentState);
    if (!checked.valid || checked.value.kind !== "PLAN_READY") return integrationReject("INVALID_STATE");
    const from = checked.value, e = raw.envelope;
    if (!await validateAeiDOperationalEnvelope(e, raw.retainedLiveInput)) return integrationReject("INVALID_OPERATIONAL_ENVELOPE");
    if (e.version !== 1 || e.stage !== "OPERATIONAL_ONLY" || e.executionEnabled !== false || e.executionAuthority !== "FORBIDDEN" ||
        !e.accountContext || e.accountContext.chainId !== arcTestnet.id || from.sessionId !== e.materialization.sessionId || from.plan.id !== e.materialization.planId ||
        e.action.strategyId !== e.materialization.strategyId || e.action.actionStepId !== e.materialization.actions.find((a) => a.goalId === e.action.goalId)?.actionStepId ||
        !aeiEId(e.action.actionStepId) || !aeiEId(e.action.goalId)) return integrationReject("IDENTITY_MISMATCH");
    const prepared = e.prepared?.result.status === "PREPARED" ? e.prepared.result : undefined;
    const reviewable = (e.status === "ORCHESTRATED" || e.status === "REVIEW_REQUIRED") && e.action.dependsOnStepIds.length === 0 && !!e.quote && !!prepared && !!e.policy &&
      !e.policy.result.mustStop && e.policy.result.requiresUserReview && ["ALLOW", "WARN", "REQUIRE_REVIEW"].includes(e.policy.result.decision) &&
      e.quote.digest === e.prepared?.quoteDigest && e.quote.digest === e.policy.quoteDigest && e.prepared?.digest === e.policy.preparedDigest;
    if ((e.status === "ORCHESTRATED" || e.status === "REVIEW_REQUIRED") && !reviewable) return integrationReject("INVALID_OPERATIONAL_ENVELOPE");
    let state: AgentState = from;
    let strategy: Strategy | undefined;
    let overlayDigest: string | null = null;
    let technicalStepId: string | null = null;
    let technicalStepIndex: number | null = null;
    let technicalStepKind: string | null = null;
    const technicalSteps = prepared?.data.steps.map((step, index) => Object.freeze({ index,
      stepId: step.kind === "finite-approval" ? `aei-approve:${e.revision.slice(2, 26)}` : e.action.actionStepId,
      kind: step.kind, requiresConfirmedPriorStep: step.requiresConfirmedPriorStep === true })) ?? [];
    if (reviewable && e.quote && prepared) {
      const source = raw.retainedLiveInput as { compilation?: { status?: string; strategy?: Strategy } };
      const skeleton = source.compilation?.strategy;
      const validated = validateStrategy(skeleton);
      if (!validated.valid || validated.value.id !== e.materialization.strategyId) return integrationReject("UNSUPPORTED_PREPARED_MAPPING");
      const selected = validated.value.steps.find((step) => step.id === e.action.actionStepId);
      if (!selected || selected.kind !== "ACTION" || selected.action !== e.action.actionKind || selected.preparedAction !== undefined) return integrationReject("UNSUPPORTED_PREPARED_MAPPING");
      const steps = prepared.data.steps;
      const approval = e.action.actionKind === "SWAP" && steps.length === 2 && steps[0].kind === "finite-approval" && steps[1].kind === "swap" && steps[1].requiresConfirmedPriorStep === true;
      if (!(e.action.actionKind === "SEND" && steps.length === 1 && steps[0].kind === "send" ||
            e.action.actionKind === "SWAP" && steps.length === 1 && steps[0].kind === "swap" || approval)) return integrationReject("UNSUPPORTED_PREPARED_MAPPING");
      const reference = (index: number) => ({ kind: "PREPARED_ACTION" as const, tool: prepared.tool, quoteFingerprint: prepared.data.quoteFingerprint, stepIndex: index });
      technicalStepIndex = 0;
      technicalStepKind = steps[0].kind;
      technicalStepId = approval ? `aei-approve:${e.revision.slice(2, 26)}` : selected.id;
      if (!aeiEId(technicalStepId) || validated.value.steps.some((step) => approval && step.id === technicalStepId)) return integrationReject("UNSUPPORTED_PREPARED_MAPPING");
      const derivedSteps = approval ? [...validated.value.steps, { id: technicalStepId, kind: "ACTION" as const, action: "APPROVE" as const,
        confirmation: "EXPLICIT_USER_CONFIRMATION" as const, dependsOn: [...selected.dependsOn], preparedAction: reference(0) }]
        : validated.value.steps.map((step) => step.id === selected.id ? { ...selected, preparedAction: reference(0) } : step);
      const overlay = validateStrategy({ ...validated.value, steps: derivedSteps });
      if (!overlay.valid) return integrationReject("UNSUPPORTED_PREPARED_MAPPING");
      strategy = overlay.value;
      overlayDigest = keccak256(stringToHex(canonicalPlannerDataJSON(strategy)));
      const stateId = `aei-e:${aeiEHash([from.stateId, e.digest, technicalStepId]).slice(2, 34)}`;
      if (preparedStateIds.has(`${from.sessionId}:${stateId}`)) return integrationReject("IDENTITY_MISMATCH");
      const candidate = createPreparedAgentState({ sessionId: from.sessionId, stateId }, { strategy, stepId: technicalStepId, quote: e.quote.result, preparation: prepared });
      if (!candidate || candidate.kind !== "TRANSACTION" || candidate.status !== "PREPARED" || candidate.binding.account !== e.accountContext.account.toLowerCase() || candidate.binding.chainId !== e.accountContext.chainId) return integrationReject("UNSUPPORTED_PREPARED_MAPPING");
      state = candidate;
    }
    const base = { version: 1 as const, stateId: state.stateId, sessionId: from.sessionId, planId: from.plan.id,
      strategyId: e.materialization.strategyId, strategyDigest: e.materialization.strategyDigest, actionStepId: e.action.actionStepId,
      goalId: e.action.goalId, overlayDigest, account: e.accountContext.account.toLowerCase(), chainId: e.accountContext.chainId,
      materializationRevision: e.materialization.revision, materializationDigest: e.materialization.digest,
      orchestrationRevision: e.revision, orchestrationDigest: e.digest, readDigests: e.reads.map((r) => r.digest),
      quoteDigest: e.quote?.digest ?? null, quoteFingerprint: e.quote?.fingerprint ?? null, quoteExpiresAt: e.quote?.result.expiresAt ?? null,
      preparationDigest: e.prepared?.digest ?? null, preparationExpiresAt: prepared?.data.expiresAt ?? null,
      policyDigest: e.policy?.digest ?? null, policyDecision: e.policy?.result.decision ?? null,
      technicalStepId, technicalStepIndex, technicalStepKind, technicalSteps,
      outcome: e.status, warnings: [...e.warnings], reviewRequirements: [...e.unmetRequirements],
      currentness: "ISSUED_LIVE" as const, executionEnabled: false as const, executionAuthority: "FORBIDDEN" as const };
    const sidecar = Object.freeze({ ...base, readDigests: Object.freeze(base.readDigests), technicalSteps: Object.freeze(technicalSteps),
      warnings: Object.freeze(base.warnings), reviewRequirements: Object.freeze(base.reviewRequirements),
      digest: sidecarDigest(base) });
    if (strategy && state.kind === "TRANSACTION") {
      if (!await validateAeiDOperationalEnvelope(e, raw.retainedLiveInput)) return integrationReject("INVALID_OPERATIONAL_ENVELOPE");
      const proof = Object.freeze({});
      preparedProofs.set(proof, { fromId: from.stateId, toId: state.stateId, envelope: e, strategy });
      const transition = evaluateAgentTransition(from, state, { kind: "AEI_E_PREPARED", sessionId: from.sessionId, stateId: from.stateId, proof });
      if (!transition.allowed) return integrationReject("TRANSITION_DENIED");
      preparedStateIds.add(`${from.sessionId}:${state.stateId}`);
    }
    const result = Object.freeze({ status: "MAPPED" as const, state: frozenStateCopy(state), sidecar });
    activeIntegrations.set(result, { envelope: e, retainedLiveInput: raw.retainedLiveInput, digest: sidecar.digest });
    latestOperationalDigest.set(operationalKey(e), e.digest);
    return result;
  } catch { return integrationReject("INVALID_INPUT"); }
}

/** A saved or caller-rehashed sidecar cannot regain live review eligibility. */
export async function validateAeiEReviewEligibility(candidate: unknown): Promise<Readonly<{ eligible: true } | { eligible: false; reason: string }>> {
  try {
    if (!candidate || typeof candidate !== "object") return { eligible: false, reason: "UNREGISTERED" };
    const registered = activeIntegrations.get(candidate);
    if (!registered) return { eligible: false, reason: "UNREGISTERED" };
    const value = candidate as Extract<AeiEIntegrationResult, { status: "MAPPED" }>;
    if (value.status !== "MAPPED" || value.sidecar.digest !== registered.digest || value.sidecar.currentness !== "ISSUED_LIVE" ||
        value.state.kind !== "TRANSACTION" || value.state.status !== "PREPARED" ||
        value.state.stateId !== value.sidecar.stateId || value.sidecar.orchestrationDigest !== latestOperationalDigest.get(operationalKey(registered.envelope))) return { eligible: false, reason: "STALE" };
    return await validateAeiDOperationalEnvelope(registered.envelope, registered.retainedLiveInput) ? { eligible: true } : { eligible: false, reason: "STALE" };
  } catch { return { eligible: false, reason: "INVALID_RUNTIME" }; }
}

/** Currentness is evaluated now; the issuance label in a sidecar is never a cached permission. */
export async function evaluateAeiECurrentness(candidate: unknown): Promise<Readonly<{ status: "CURRENT" | "STALE" | "HISTORICAL" | "INVALID" }>> {
  try {
    if (!candidate || typeof candidate !== "object") return { status: "INVALID" };
    const registration = activeIntegrations.get(candidate);
    if (registration) {
      const value = candidate as Extract<AeiEIntegrationResult, { status: "MAPPED" }>;
      const state = validateAgentState(value.state);
      if (value.status !== "MAPPED" || !state.valid || value.sidecar.currentness !== "ISSUED_LIVE" ||
          state.value.stateId !== value.sidecar.stateId || state.value.sessionId !== value.sidecar.sessionId ||
          value.sidecar.digest !== registration.digest) return { status: "INVALID" };
      if (value.sidecar.orchestrationDigest !== latestOperationalDigest.get(operationalKey(registration.envelope))) return { status: "STALE" };
      return await validateAeiDOperationalEnvelope(registration.envelope, registration.retainedLiveInput) ? { status: "CURRENT" } : { status: "STALE" };
    }
    const value = candidate as Record<string, unknown>;
    const historical = value.status === "HISTORICAL" ? { state: value.state, sidecar: value.sidecar } : candidate;
    return validateAeiEHistoricalSnapshot(historical) ? { status: "HISTORICAL" } : { status: "INVALID" };
  } catch { return { status: "INVALID" }; }
}

const sidecarFields = ["version", "stateId", "sessionId", "planId", "strategyId", "strategyDigest", "actionStepId", "goalId", "overlayDigest",
  "account", "chainId", "materializationRevision", "materializationDigest", "orchestrationRevision", "orchestrationDigest",
  "readDigests", "quoteDigest", "quoteFingerprint", "quoteExpiresAt", "preparationDigest", "preparationExpiresAt",
  "policyDigest", "policyDecision", "technicalStepId", "technicalStepIndex", "technicalStepKind", "technicalSteps",
  "outcome", "warnings", "reviewRequirements", "currentness", "executionEnabled", "executionAuthority", "digest"] as const;
const hexDigest = (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactPlain = (value: Record<string, unknown>, names: readonly string[]) => Reflect.ownKeys(value).length === names.length && names.every((name) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
});
const digestOrNull = (value: unknown) => value === null || hexDigest(value);
const timeOrNull = (value: unknown) => value === null || Number.isSafeInteger(value) && Number(value) >= 0;

/** Converts an accepted live integration to plain historical data; this never serializes D's live registry. */
export function createAeiEHistoricalSnapshot(candidate: unknown): Readonly<{ state: AgentState; sidecar: Phase12OperationalStateBindingV1 }> | undefined {
  try {
    if (!candidate || typeof candidate !== "object") return undefined;
    const registration = activeIntegrations.get(candidate);
    if (!registration) return undefined;
    const value = candidate as Extract<AeiEIntegrationResult, { status: "MAPPED" }>;
    if (value.status !== "MAPPED" || value.sidecar.digest !== registration.digest) return undefined;
    const state = validateAgentState(value.state);
    if (!state.valid || state.value.stateId !== value.sidecar.stateId || state.value.sessionId !== value.sidecar.sessionId) return undefined;
    const sidecarBase = { ...value.sidecar, currentness: "HISTORICAL" as const };
    const sidecar = { ...sidecarBase, digest: sidecarDigest(sidecarBase) };
    return { state: JSON.parse(JSON.stringify(state.value)) as AgentState,
      sidecar: JSON.parse(JSON.stringify(sidecar)) as Phase12OperationalStateBindingV1 };
  } catch { return undefined; }
}

/** Structural history check only. Matching saved digests never create runtime registration. */
export function validateAeiEHistoricalSnapshot(input: unknown): input is Readonly<{ state: AgentState; sidecar: Phase12OperationalStateBindingV1 }> {
  try {
    if (!plain(input) || !exactPlain(input, ["state", "sidecar"])) return false;
    const state = validateAgentState(input.state), s = input.sidecar;
    if (!state.valid || !plain(s) || !exactPlain(s, sidecarFields) || s.version !== 1 || s.currentness !== "HISTORICAL" ||
      s.executionEnabled !== false || s.executionAuthority !== "FORBIDDEN" || !hexDigest(s.digest) ||
      !aeiEId(s.stateId as string) || !aeiEId(s.sessionId as string) || !aeiEId(s.planId as string) ||
      !aeiEId(s.strategyId as string) || !aeiEId(s.actionStepId as string) || !aeiEId(s.goalId as string) ||
      state.value.stateId !== s.stateId || state.value.sessionId !== s.sessionId ||
      !/^0x[0-9a-fA-F]{40}$/.test(s.account as string) || s.chainId !== arcTestnet.id ||
      !["ORCHESTRATED", "REVIEW_REQUIRED", "BLOCKED_BY_POLICY", "REQUOTE_REQUIRED", "REVALIDATION_REQUIRED", "HANDOFF_REQUIRED",
        "UNSUPPORTED_ACTION", "UNSUPPORTED_ACCOUNT_CONTEXT", "READ_FAILED", "QUOTE_FAILED", "QUOTE_STALE", "PREPARATION_FAILED", "DEPENDENCY_BLOCKED"].includes(s.outcome as string) ||
      ![s.strategyDigest, s.materializationRevision, s.materializationDigest, s.orchestrationRevision, s.orchestrationDigest].every(hexDigest) ||
      ![s.overlayDigest, s.quoteDigest, s.quoteFingerprint, s.preparationDigest, s.policyDigest].every(digestOrNull) ||
      !(s.policyDecision === null || ["ALLOW", "WARN", "REQUIRE_REVIEW", "REVALIDATE", "REQUOTE", "BLOCK"].includes(s.policyDecision as string)) ||
      !timeOrNull(s.quoteExpiresAt) || !timeOrNull(s.preparationExpiresAt) || !Array.isArray(s.readDigests) || s.readDigests.length > 64 || !s.readDigests.every(hexDigest) ||
      !Array.isArray(s.warnings) || s.warnings.length > 64 || !s.warnings.every((x) => typeof x === "string" && x.length <= 512) ||
      !Array.isArray(s.reviewRequirements) || s.reviewRequirements.length > 64 || !s.reviewRequirements.every((x) => typeof x === "string" && x.length <= 512) ||
      !Array.isArray(s.technicalSteps) || s.technicalSteps.length > 8 || !s.technicalSteps.every((step, index) => plain(step) && exactPlain(step, ["index", "stepId", "kind", "requiresConfirmedPriorStep"]) &&
        step.index === index && aeiEId(step.stepId as string) && typeof step.requiresConfirmedPriorStep === "boolean" &&
        ["send", "finite-approval", "swap", "cctp-burn"].includes(step.kind as string))) return false;
    if (state.value.kind === "PLAN_READY") {
      if (state.value.plan.id !== s.planId || s.technicalStepId !== null || s.technicalStepIndex !== null || s.technicalStepKind !== null || s.overlayDigest !== null) return false;
    } else if (state.value.kind === "TRANSACTION" && state.value.status === "PREPARED") {
      if (state.value.step.strategyId !== s.strategyId || state.value.step.stepId !== s.technicalStepId || state.value.binding.account.toLowerCase() !== s.account ||
          state.value.binding.chainId !== s.chainId || state.value.binding.preparedAction.stepIndex !== s.technicalStepIndex ||
          state.value.binding.preparedAction.quoteFingerprint !== s.quoteFingerprint || s.outcome !== "ORCHESTRATED" && s.outcome !== "REVIEW_REQUIRED" ||
          !hexDigest(s.overlayDigest) || !s.technicalSteps.some((step) => step.index === s.technicalStepIndex && step.stepId === s.technicalStepId && step.kind === s.technicalStepKind) ||
          state.value.binding.action === "SEND" && s.technicalStepKind !== "send" ||
          state.value.binding.action === "APPROVE" && s.technicalStepKind !== "finite-approval" ||
          state.value.binding.action === "SWAP" && s.technicalStepKind !== "swap" || state.value.binding.action === "BRIDGE") return false;
    } else return false;
    return sidecarDigest(s as Omit<Phase12OperationalStateBindingV1, "digest">) === s.digest;
  } catch { return false; }
}
