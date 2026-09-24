import { getAddress, isAddress, isHash } from "viem";
import { arcTestnet } from "viem/chains";
import { validateReadResult } from "./agent/toolSchemas.ts";
import type { PolicyResult } from "./policyEngine.ts";
import { validateStrategy, type ActionStep, type PreparedActionReference, type StrategyValidationIssue } from "./strategyModel.ts";
import type { StrategyReceiptResult } from "./strategyReceipt.ts";

/** Persistable attempt identity from the user-controlled wallet boundary.
 * PRE_SUBMISSION_FAILURE requires proof the wallet submission call was never entered;
 * a thrown submission call without a hash is SUBMISSION_OUTCOME_UNKNOWN.
 */
export type StrategyRecoveryRecord = Readonly<{
  version: 1;
  attemptId: string;
  strategyId: string;
  stepId: string;
  action: ActionStep["action"];
  account: string;
  chainId: number;
  preparedAction: PreparedActionReference;
  event: "USER_REJECTED" | "PRE_SUBMISSION_FAILURE" | "SUBMISSION_OUTCOME_UNKNOWN" | "SUBMITTED";
  submittedHash?: `0x${string}`;
}>;

/** Data-only freshness summary. A separate 10B call must verify full canonical evidence. */
export type RecoveryArtifacts = Readonly<{
  quote: Readonly<{ tool: string; account: string; chainId: number; fingerprint: `0x${string}`; expiresAt: number }>;
  preparation: Readonly<{ tool: string; account: string; chainId: number; quoteFingerprint: `0x${string}`; stepIndex: number; expiresAt: number }>;
  handoff?: Readonly<{ account: string; expiresAt: number }>;
}>;

export type StrategyRecoveryInput = Readonly<{
  strategy: unknown;
  record: unknown;
  now: number;
  receipt?: StrategyReceiptResult;
  artifacts?: RecoveryArtifacts;
  currentPolicy?: PolicyResult;
}>;

type Identity = Readonly<{ strategyId: string; stepId: string; attemptId: string }>;
export type StrategyRecoveryResult =
  | Readonly<{ status: "USER_REJECTED" | "SUBMISSION_OUTCOME_UNKNOWN" | "WAIT_FOR_RECEIPT" | "REQUOTE_REQUIRED" | "REPREPARE_REQUIRED" | "REVALIDATION_REQUIRED" | "NON_RETRYABLE" | "CONTINUATION_RECHECK_REQUIRED" | "DESTINATION_STATUS_UNRESOLVED"; next: "STOP" | "VERIFY_RECEIPT_SEPARATELY" | "REQUEST_FRESH_QUOTE" | "REQUEST_FRESH_PREPARATION" | "REQUEST_FRESH_REVALIDATION" | "INVOKE_10E_SEPARATELY" | "CHECK_DESTINATION_SEPARATELY" } & Identity>
  | Readonly<{ status: "RETRY_ELIGIBLE"; next: "NEW_USER_CONTROLLED_10B_INVOCATION"; confirmation: "EXPLICIT_USER_CONFIRMATION" } & Identity>
  | Readonly<{ status: "POLICY_STOP"; policy: PolicyResult } & Identity>
  | Readonly<{ status: "INVALID_STRATEGY"; errors: readonly StrategyValidationIssue[] }>
  | Readonly<{ status: "INVALID_EVIDENCE"; reason: string }>;

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const sameAddress = (a: string, b: string) => isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);
const sameReference = (a: PreparedActionReference, b: PreparedActionReference) => a.kind === b.kind && a.tool === b.tool && a.quoteFingerprint === b.quoteFingerprint && a.stepIndex === b.stepIndex;

function validRecord(value: unknown): value is StrategyRecoveryRecord {
  if (!object(value) || !keys(value, ["version", "attemptId", "strategyId", "stepId", "action", "account", "chainId", "preparedAction", "event"], ["submittedHash"])) return false;
  if (value.version !== 1 || typeof value.attemptId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.attemptId) || typeof value.strategyId !== "string" || typeof value.stepId !== "string" || !isAddress(value.account as string) || value.chainId !== arcTestnet.id || !["APPROVE", "SEND", "SWAP", "BRIDGE"].includes(value.action as string)) return false;
  if (!["USER_REJECTED", "PRE_SUBMISSION_FAILURE", "SUBMISSION_OUTCOME_UNKNOWN", "SUBMITTED"].includes(value.event as string) || (value.event === "SUBMITTED") !== Object.hasOwn(value, "submittedHash") || value.event === "SUBMITTED" && (typeof value.submittedHash !== "string" || !isHash(value.submittedHash))) return false;
  const ref = value.preparedAction;
  return object(ref) && keys(ref, ["kind", "tool", "quoteFingerprint", "stepIndex"]) && ref.kind === "PREPARED_ACTION" && ["send.prepare", "swap.prepare", "bridge.prepare"].includes(ref.tool as string) && isHash(ref.quoteFingerprint as string) && Number.isSafeInteger(ref.stepIndex) && (ref.stepIndex as number) >= 0;
}

function validArtifacts(value: RecoveryArtifacts, step: ActionStep, record: StrategyRecoveryRecord): boolean {
  if (!object(value) || !keys(value, ["quote", "preparation"], ["handoff"]) || !object(value.quote) || !keys(value.quote, ["tool", "account", "chainId", "fingerprint", "expiresAt"]) || !object(value.preparation) || !keys(value.preparation, ["tool", "account", "chainId", "quoteFingerprint", "stepIndex", "expiresAt"]) || value.handoff !== undefined && (!object(value.handoff) || !keys(value.handoff, ["account", "expiresAt"]))) return false;
  const ref = step.preparedAction;
  return !!ref && value.quote.tool === ref.tool.replace("prepare", "quote") && value.preparation.tool === ref.tool && sameAddress(value.quote.account, record.account) && sameAddress(value.preparation.account, record.account) && value.quote.chainId === record.chainId && value.preparation.chainId === record.chainId && isHash(value.quote.fingerprint) && value.quote.fingerprint === ref.quoteFingerprint && value.preparation.quoteFingerprint === ref.quoteFingerprint && value.preparation.stepIndex === ref.stepIndex && Number.isSafeInteger(value.quote.expiresAt) && value.quote.expiresAt >= 0 && Number.isSafeInteger(value.preparation.expiresAt) && value.preparation.expiresAt >= 0 && (value.handoff === undefined || sameAddress(value.handoff.account, record.account) && Number.isSafeInteger(value.handoff.expiresAt) && value.handoff.expiresAt >= 0);
}

function validReceipt(result: StrategyReceiptResult, record: StrategyRecoveryRecord, step: ActionStep, now: number): boolean {
  if (!object(result) || result.status === "MISMATCH" || result.status === "INVALID_EVIDENCE") return false;
  if (result.status === "PENDING" || result.status === "UNAVAILABLE") {
    if (!keys(result, ["status", "strategyId", "stepId", "hash"])) return false;
  } else if (result.status === "REVERTED") {
    if (!keys(result, ["status", "strategyId", "stepId", "hash", "chainId", "blockNumber"])) return false;
  } else if (result.status === "CONFIRMED") {
    if (!keys(result, ["status", "strategyId", "stepId", "action", "hash", "chainId", "blockNumber", "scope", "dependencies"])) return false;
  } else return false;
  if (result.strategyId !== record.strategyId || result.stepId !== record.stepId || !isHash(result.hash) || result.hash.toLowerCase() !== record.submittedHash?.toLowerCase()) return false;
  if (result.status === "PENDING" || result.status === "UNAVAILABLE") return true;
  if (result.status !== "CONFIRMED" && result.status !== "REVERTED") return false;
  if (result.chainId !== record.chainId || !/^[1-9][0-9]*$/.test(result.blockNumber)) return false;
  if (result.status === "REVERTED") return true;
  if (result.status !== "CONFIRMED") return false;
  if (!Array.isArray(result.dependencies)) return false;
  const proof = result.dependencies.find((item) => item?.kind === "CONFIRMED_RECEIPT" && item.stepId === step.id);
  if (result.action !== step.action || result.scope !== "SOURCE_TRANSACTION" || !proof || proof.kind !== "CONFIRMED_RECEIPT") return false;
  if (!keys(proof as unknown as Record<string, unknown>, ["kind", "strategyId", "stepId", "actionStepId", "preparedAction", "submittedHash", "receipt"]) || !object(proof.preparedAction) || !keys(proof.preparedAction as unknown as Record<string, unknown>, ["kind", "tool", "quoteFingerprint", "stepIndex"])) return false;
  const receipt = proof.receipt;
  return proof.strategyId === record.strategyId && proof.actionStepId === step.id && sameReference(record.preparedAction, proof.preparedAction as PreparedActionReference) && isHash(proof.submittedHash) && proof.submittedHash.toLowerCase() === result.hash.toLowerCase() && validateReadResult(receipt).valid && receipt.tool === "transaction.receipt" && receipt.status === "AVAILABLE" && receipt.freshness === "live" && receipt.source.includes("arc-rpc") && sameAddress(receipt.account ?? "", record.account) && receipt.chainId === record.chainId && receipt.data.state === "confirmed" && receipt.data.verified === true && receipt.data.hash.toLowerCase() === result.hash.toLowerCase() && receipt.observedAt !== null && receipt.observedAt <= now;
}

function validPolicy(value: PolicyResult): boolean {
  if (!object(value) || !keys(value, ["decision", "findings", "requiredAction", "mustStop", "requiresUserReview", "requiresFreshQuote", "requiresRevalidation"], ["winningReason"]) || !Array.isArray(value.findings)) return false;
  const decision = value.decision;
  if (!["ALLOW", "WARN", "REQUIRE_REVIEW", "REVALIDATE", "REQUOTE", "BLOCK"].includes(decision)) return false;
  const required = decision === "BLOCK" ? "STOP" : decision === "REQUOTE" ? "REQUOTE" : decision === "REVALIDATE" ? "REVALIDATE" : decision === "REQUIRE_REVIEW" ? "REVIEW" : "NONE";
  return value.requiredAction === required && value.mustStop === ["BLOCK", "REQUOTE", "REVALIDATE"].includes(decision) && value.requiresUserReview === ["ALLOW", "WARN", "REQUIRE_REVIEW"].includes(decision) && value.requiresFreshQuote === (decision === "REQUOTE") && value.requiresRevalidation === (decision === "REVALIDATE") && value.findings.every((finding) => object(finding) && typeof finding.code === "string" && typeof finding.evidence === "string" && typeof finding.decision === "string" && ["ALLOW", "WARN", "REQUIRE_REVIEW", "REVALIDATE", "REQUOTE", "BLOCK"].includes(finding.decision)) && (value.winningReason === undefined || typeof value.winningReason === "string");
}

/** Evaluates one recorded attempt once; acquisition and every user action stay with separate callers. */
export function evaluateStrategyRecovery(input: StrategyRecoveryInput): StrategyRecoveryResult {
  const checked = validateStrategy(input.strategy);
  if (!checked.valid) return { status: "INVALID_STRATEGY", errors: checked.errors };
  if (!validRecord(input.record) || !Number.isSafeInteger(input.now) || input.now < 0) return { status: "INVALID_EVIDENCE", reason: "RECOVERY_RECORD" };
  const record = input.record;
  const step = checked.value.steps.find((item) => item.id === record.stepId);
  if (checked.value.id !== record.strategyId || !step || step.kind !== "ACTION" || step.action !== record.action || !step.preparedAction || !sameReference(step.preparedAction, record.preparedAction)) return { status: "INVALID_EVIDENCE", reason: "STRATEGY_BINDING" };
  const id: Identity = { strategyId: record.strategyId, stepId: record.stepId, attemptId: record.attemptId };

  // Submission identity takes precedence over any expired artifact or policy result.
  if (record.event === "SUBMITTED") {
    if (!input.receipt) return { ...id, status: "WAIT_FOR_RECEIPT", next: "VERIFY_RECEIPT_SEPARATELY" };
    if (!validReceipt(input.receipt, record, step, input.now)) return { status: "INVALID_EVIDENCE", reason: "RECEIPT_BINDING" };
    if (input.receipt.status === "PENDING" || input.receipt.status === "UNAVAILABLE") return { ...id, status: "WAIT_FOR_RECEIPT", next: "VERIFY_RECEIPT_SEPARATELY" };
    if (input.receipt.status === "REVERTED") return { ...id, status: "REVALIDATION_REQUIRED", next: "REQUEST_FRESH_REVALIDATION" };
    if (step.action === "BRIDGE") return { ...id, status: "DESTINATION_STATUS_UNRESOLVED", next: "CHECK_DESTINATION_SEPARATELY" };
    if (step.action === "APPROVE") return { ...id, status: "REVALIDATION_REQUIRED", next: "REQUEST_FRESH_REVALIDATION" };
    return { ...id, status: "CONTINUATION_RECHECK_REQUIRED", next: "INVOKE_10E_SEPARATELY" };
  }
  if (input.receipt) return { status: "INVALID_EVIDENCE", reason: "UNSUBMITTED_RECEIPT" };
  if (record.event === "SUBMISSION_OUTCOME_UNKNOWN") return { ...id, status: "SUBMISSION_OUTCOME_UNKNOWN", next: "STOP" };
  if (record.event === "USER_REJECTED") return { ...id, status: "USER_REJECTED", next: "STOP" };
  const artifacts = input.artifacts;
  if (artifacts && !validArtifacts(artifacts, step, record)) return { status: "INVALID_EVIDENCE", reason: "ARTIFACT_BINDING" };
  if (input.currentPolicy) {
    const policy = input.currentPolicy;
    if (!validPolicy(policy)) return { status: "INVALID_EVIDENCE", reason: "POLICY" };
    if (policy.mustStop || policy.decision === "BLOCK" || policy.decision === "REQUOTE" || policy.decision === "REVALIDATE") return { ...id, status: "POLICY_STOP", policy };
  }
  if (!artifacts) return { ...id, status: "REVALIDATION_REQUIRED", next: "REQUEST_FRESH_REVALIDATION" };
  if (input.now > artifacts.quote.expiresAt) return { ...id, status: "REQUOTE_REQUIRED", next: "REQUEST_FRESH_QUOTE" };
  if (input.now > artifacts.preparation.expiresAt || artifacts.handoff !== undefined && input.now > artifacts.handoff.expiresAt) return { ...id, status: "REPREPARE_REQUIRED", next: "REQUEST_FRESH_PREPARATION" };
  if (step.action === "BRIDGE" || step.action === "APPROVE" && step.preparedAction.tool === "bridge.prepare") return { ...id, status: "NON_RETRYABLE", next: "STOP" };
  if (artifacts.handoff === undefined) return { ...id, status: "REPREPARE_REQUIRED", next: "REQUEST_FRESH_PREPARATION" };
  if (!input.currentPolicy) return { ...id, status: "REVALIDATION_REQUIRED", next: "REQUEST_FRESH_REVALIDATION" };
  return { ...id, status: "RETRY_ELIGIBLE", next: "NEW_USER_CONTROLLED_10B_INVOCATION", confirmation: step.confirmation };
}
