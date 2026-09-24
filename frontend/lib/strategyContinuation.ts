import { getAddress, isAddress, isHash } from "viem";
import { arcTestnet } from "viem/chains";
import { validateReadResult } from "./agent/toolSchemas.ts";
import type { PolicyResult } from "./policyEngine.ts";
import { validateStrategy, type ActionStep, type StrategyStep, type StrategyValidationIssue } from "./strategyModel.ts";
import type { StrategyReceiptResult } from "./strategyReceipt.ts";
import type { PostReceiptResult } from "./strategyRefresh.ts";

/** Caller-owned canonical results. IDs or booleans alone cannot satisfy a step. */
export type StrategyContinuationInput = Readonly<{
  strategy: unknown;
  account: string;
  chainId: number;
  now: number;
  receipts?: readonly StrategyReceiptResult[];
  revalidations?: readonly PostReceiptResult[];
  currentPolicy?: PolicyResult;
}>;

export type StrategyContinuationResult =
  | Readonly<{ status: "NEXT_STEP_READY"; strategyId: string; steps: readonly Readonly<{ stepId: string; action: ActionStep["action"]; confirmation: "EXPLICIT_USER_CONFIRMATION"; execution: "SEPARATE_10B_INVOCATION_REQUIRED" | "NO_WALLET_HANDOFF" }>[]; policy?: PolicyResult }>
  | Readonly<{ status: "WAITING_FOR_RECEIPT" | "REVALIDATION_REQUIRED" | "DEPENDENCY_NOT_SATISFIED"; stepId: string }>
  | Readonly<{ status: "POLICY_STOP"; policy: PolicyResult }>
  | Readonly<{ status: "STRATEGY_COMPLETE"; strategyId: string }>
  | Readonly<{ status: "UNSUPPORTED"; stepId: string; reason: "NO_WALLET_HANDOFF" }>
  | Readonly<{ status: "INVALID_STRATEGY"; errors: readonly StrategyValidationIssue[] }>
  | Readonly<{ status: "INVALID_EVIDENCE"; reason: string }>;

const sameAddress = (a: string, b: string) => isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);
const stopping = (policy: PolicyResult) => policy.mustStop || policy.decision === "BLOCK" || policy.decision === "REQUOTE" || policy.decision === "REVALIDATE";

/** One provider-free graph evaluation. Step order is only the tie-break among eligible ACTIONs. */
export function evaluateStrategyContinuation(input: StrategyContinuationInput): StrategyContinuationResult {
  const checked = validateStrategy(input.strategy);
  if (!checked.valid) return { status: "INVALID_STRATEGY", errors: checked.errors };
  const strategy = checked.value;
  if (!isAddress(input.account) || input.chainId !== arcTestnet.id || !Number.isSafeInteger(input.now) || input.now < 0 || !Array.isArray(input.receipts ?? []) || !Array.isArray(input.revalidations ?? [])) return { status: "INVALID_EVIDENCE", reason: "CONTEXT" };
  const receipts = input.receipts ?? [];
  const revalidations = input.revalidations ?? [];
  const byId = new Map(strategy.steps.map((step) => [step.id, step]));
  const receiptByStep = new Map<string, StrategyReceiptResult>();
  for (const result of receipts) {
    if (!result || !("stepId" in result) || receiptByStep.has(result.stepId) || result.strategyId !== strategy.id || !byId.has(result.stepId) || byId.get(result.stepId)?.kind !== "ACTION" || !isHash(result.hash)) return { status: "INVALID_EVIDENCE", reason: "RECEIPT_BINDING" };
    receiptByStep.set(result.stepId, result);
    if (result.status !== "CONFIRMED") continue;
    const action = byId.get(result.stepId) as ActionStep;
    const proof = result.dependencies?.find((item) => item.kind === "CONFIRMED_RECEIPT" && item.stepId === action.id);
    if (result.action !== action.action || result.scope !== "SOURCE_TRANSACTION" || result.chainId !== input.chainId || !action.preparedAction || !proof || proof.kind !== "CONFIRMED_RECEIPT" || proof.strategyId !== strategy.id || proof.actionStepId !== action.id || proof.preparedAction.kind !== action.preparedAction.kind || proof.preparedAction.tool !== action.preparedAction.tool || proof.preparedAction.quoteFingerprint !== action.preparedAction.quoteFingerprint || proof.preparedAction.stepIndex !== action.preparedAction.stepIndex || !isHash(proof.submittedHash) || proof.submittedHash.toLowerCase() !== result.hash.toLowerCase() || !validateReadResult(proof.receipt).valid || proof.receipt.tool !== "transaction.receipt" || proof.receipt.status !== "AVAILABLE" || proof.receipt.freshness !== "live" || !proof.receipt.source.includes("arc-rpc") || !sameAddress(proof.receipt.account ?? "", input.account) || proof.receipt.chainId !== input.chainId || proof.receipt.data.verified !== true || proof.receipt.data.state !== "confirmed" || proof.receipt.data.hash.toLowerCase() !== result.hash.toLowerCase() || proof.receipt.observedAt === null || proof.receipt.observedAt > input.now) return { status: "INVALID_EVIDENCE", reason: "RECEIPT_BINDING" };
  }
  const refreshByStep = new Map<string, Extract<PostReceiptResult, { status: "READY_WITH_FRESH_EVIDENCE" }>>();
  for (const result of revalidations) {
    if (result?.status === "POLICY_STOP") return { status: "POLICY_STOP", policy: result.policy };
    if (result?.status === "REQUOTE_REQUIRED" || result?.status === "REVALIDATION_REQUIRED") {
      if (result.policy && stopping(result.policy)) return { status: "POLICY_STOP", policy: result.policy };
      continue;
    }
    if (!result || result.status !== "READY_WITH_FRESH_EVIDENCE" || result.strategyId !== strategy.id || !isHash(result.evidence?.priorHash) || !sameAddress(result.evidence.account, input.account) || result.evidence.chainId !== input.chainId || result.evidence.quoteExpiresAt < input.now || result.evidence.observedAt > input.now || stopping(result.policy)) return { status: "INVALID_EVIDENCE", reason: "REVALIDATION_BINDING" };
    const selected = byId.get(result.selectedStepId);
    const prior = [...byId.values()].find((step) => {
      const receipt = receiptByStep.get(step.id);
      return step.kind === "ACTION" && receipt?.status === "CONFIRMED" && receipt.hash.toLowerCase() === result.evidence.priorHash.toLowerCase();
    });
    const priorReceipt = prior ? receiptByStep.get(prior.id) : undefined;
    const priorProof = priorReceipt?.status === "CONFIRMED" ? priorReceipt.dependencies.find((item) => item.kind === "CONFIRMED_RECEIPT" && item.stepId === prior?.id) : undefined;
    const priorObservedAt = priorProof?.kind === "CONFIRMED_RECEIPT" ? priorProof.receipt.observedAt : null;
    if (!selected || selected.kind !== "ACTION" || selected.action !== result.action || selected.preparedAction?.quoteFingerprint !== result.evidence.quoteFingerprint || !prior || priorObservedAt === null || priorObservedAt === undefined || result.evidence.observedAt <= priorObservedAt) return { status: "INVALID_EVIDENCE", reason: "REVALIDATION_BINDING" };
    for (const proof of result.dependencies) {
      const step = byId.get(proof.stepId);
      if (proof.kind !== "CURRENT_REVALIDATION" || !step || step.kind !== "REVALIDATE" || refreshByStep.has(step.id) || proof.quoteFingerprint !== result.evidence.quoteFingerprint || step.quote && step.quote.fingerprint !== proof.quoteFingerprint || step.policy && step.policy.id !== proof.policyResultId || !isAncestor(step.id, selected.id, byId) || !isAncestor(prior.id, step.id, byId)) return { status: "INVALID_EVIDENCE", reason: "REVALIDATION_BINDING" };
      refreshByStep.set(step.id, result);
    }
  }
  const policy = input.currentPolicy;
  if (policy && stopping(policy)) return { status: "POLICY_STOP", policy };
  const satisfied = (step: StrategyStep): boolean => step.kind === "ACTION" ? receiptByStep.get(step.id)?.status === "CONFIRMED" : step.kind === "WAIT_RECEIPT" ? receiptByStep.get(step.receipt.actionStepId)?.status === "CONFIRMED" : refreshByStep.has(step.id);
  if (strategy.steps.every(satisfied)) return { status: "STRATEGY_COMPLETE", strategyId: strategy.id };
  const ready: ActionStep[] = [];
  let waiting: StrategyContinuationResult | undefined;
  for (const step of strategy.steps) {
    if (satisfied(step)) continue;
    if (!step.dependsOn.every((id) => satisfied(byId.get(id)!))) {
      waiting ??= { status: "DEPENDENCY_NOT_SATISFIED", stepId: step.id };
      continue;
    }
    if (step.kind === "ACTION") {
      if (receiptByStep.has(step.id)) waiting ??= { status: "WAITING_FOR_RECEIPT", stepId: step.id };
      else ready.push(step);
    } else if (step.kind === "WAIT_RECEIPT") waiting ??= { status: "WAITING_FOR_RECEIPT", stepId: step.id };
    else waiting ??= { status: "REVALIDATION_REQUIRED", stepId: step.id };
  }
  if (ready.length) {
    // Direct CCTP has graph eligibility but no canonical Agent wallet handoff.
    const unsupported = (step: ActionStep) => step.action === "BRIDGE" || step.action === "APPROVE" && step.preparedAction?.tool === "bridge.prepare";
    if (ready.length === 1 && unsupported(ready[0])) return { status: "UNSUPPORTED", stepId: ready[0].id, reason: "NO_WALLET_HANDOFF" };
    return { status: "NEXT_STEP_READY", strategyId: strategy.id, steps: ready.map((step) => ({ stepId: step.id, action: step.action, confirmation: step.confirmation, execution: unsupported(step) ? "NO_WALLET_HANDOFF" : "SEPARATE_10B_INVOCATION_REQUIRED" })), ...(policy ? { policy } : {}) };
  }
  return waiting ?? { status: "INVALID_EVIDENCE", reason: "NO_ELIGIBLE_STEP" };
}

function isAncestor(ancestor: string, descendant: string, byId: Map<string, StrategyStep>): boolean {
  return byId.get(descendant)!.dependsOn.some((id) => id === ancestor || isAncestor(ancestor, id, byId));
}
