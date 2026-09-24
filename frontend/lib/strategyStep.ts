import { formatUnits, getAddress, isAddress, isHash, type Hash } from "viem";
import type { AgentActionHandoff } from "./agent/actions/types.ts";
import type { PreparedAction } from "./agent/prepareTools.ts";
import type { QuoteResult } from "./agent/quoteTools.ts";
import type { ReceiptEvidence, ReadResult } from "./agent/readTools.ts";
import { quoteFingerprint, validatePrepareResult, validateQuoteResult, validateReadResult } from "./agent/toolSchemas.ts";
import { getAssetById } from "./assets.ts";
import { evaluateFinalPolicy, type FinalPolicyInput, type PolicyResult } from "./policyEngine.ts";
import { validateStrategy, type ActionStep, type PreparedActionReference, type Strategy, type StrategyValidationIssue } from "./strategyModel.ts";

/** Supplied canonical READ evidence; this module never fetches or verifies a receipt itself. */
export type StrategyDependencyEvidence =
  | Readonly<{ kind: "CONFIRMED_RECEIPT"; strategyId: string; stepId: string; actionStepId: string; preparedAction: PreparedActionReference; submittedHash: Hash; receipt: ReadResult<ReceiptEvidence> }>
  | Readonly<{ kind: "CURRENT_REVALIDATION"; stepId: string; quoteFingerprint: `0x${string}`; policyResultId?: string }>;

export type StrategyStepResult =
  | Readonly<{ status: "READY_FOR_WALLET_REVIEW"; strategyId: string; stepId: string; action: ActionStep["action"]; confirmation: "EXPLICIT_USER_CONFIRMATION"; policy: PolicyResult; handoff: AgentActionHandoff }>
  | Readonly<{ status: "POLICY_STOP"; stepId: string; policy: PolicyResult }>
  | Readonly<{ status: "DEPENDENCY_NOT_SATISFIED"; stepId: string; dependencyStepId: string }>
  | Readonly<{ status: "NON_EXECUTABLE_STEP"; stepId: string; kind: "WAIT_RECEIPT" | "REVALIDATE"; requiredEvidence: "CONFIRMED_RECEIPT" | "CURRENT_REVALIDATION" }>
  | Readonly<{ status: "UNSUPPORTED"; stepId: string; reason: "NO_WALLET_HANDOFF" }>
  | Readonly<{ status: "INVALID_STRATEGY"; errors: readonly StrategyValidationIssue[] }>
  | Readonly<{ status: "INVALID_EVIDENCE"; stepId?: string; reason: "STEP_NOT_FOUND" | "POLICY_INPUT_REQUIRED" | "ARTIFACT_MISMATCH" | "MALFORMED_EVIDENCE" } >;

export type StrategyStepInput = Readonly<{
  strategy: unknown;
  stepId: string;
  policyInput?: FinalPolicyInput;
  dependencies?: readonly StrategyDependencyEvidence[];
}>;

const same = (left: string, right: string) => isAddress(left) && isAddress(right) && getAddress(left) === getAddress(right);
const sameReference = (left: PreparedActionReference | undefined, right: PreparedActionReference) => left?.kind === right.kind && left.tool === right.tool && left.quoteFingerprint === right.quoteFingerprint && left.stepIndex === right.stepIndex;
const actionMatches = (step: ActionStep, kind: string) => step.action === "APPROVE" ? kind === "finite-approval" : step.action === "SEND" ? kind === "send" : step.action === "SWAP" ? kind === "swap" : kind === "cctp-burn";

function receiptMatches(evidence: StrategyDependencyEvidence | undefined, strategyId: string, action: ActionStep, account: string, chainId: number): boolean {
  if (!evidence || evidence.kind !== "CONFIRMED_RECEIPT" || evidence.strategyId !== strategyId || evidence.actionStepId !== action.id || !action.preparedAction || !sameReference(action.preparedAction, evidence.preparedAction)) return false;
  const receipt = evidence.receipt;
  return isHash(evidence.submittedHash) && validateReadResult(receipt).valid && receipt.tool === "transaction.receipt" && receipt.status === "AVAILABLE" && receipt.freshness === "live" && receipt.source.includes("arc-rpc") && same(receipt.account ?? "", account) && receipt.chainId === chainId && receipt.data.verified === true && receipt.data.state === "confirmed" && receipt.data.hash.toLowerCase() === evidence.submittedHash.toLowerCase();
}

function handoffMatches(handoff: AgentActionHandoff, prepared: PreparedAction, quote: QuoteResult<unknown>, action: ActionStep["action"], now: number): boolean {
  const asset = getAssetById(prepared.inputAsset);
  const expectedAction = action === "SEND" ? "send" : "swap";
  return !!asset && handoff.action === expectedAction && handoff.path === "/" && handoff.sourceChain === "Arc Testnet" && same(handoff.account, prepared.account) && handoff.expiresAt >= now && handoff.asset === asset.symbol && handoff.amount === formatUnits(prepared.inputAmount, asset.decimals) && (action === "SEND" ? same(handoff.recipient ?? "", prepared.recipient ?? "") : handoff.outputAsset === getAssetById(quote.outputAsset ?? "")?.symbol);
}

function dependencyFailure(strategy: Strategy, selected: ActionStep, evidence: readonly StrategyDependencyEvidence[], policyInput: FinalPolicyInput, policy: PolicyResult): string | undefined {
  const steps = new Map(strategy.steps.map((step) => [step.id, step]));
  const byId = new Map(evidence.map((item) => [item.stepId, item]));
  if (byId.size !== evidence.length) return selected.id;
  const checked = new Set<string>();
  const check = (stepId: string): string | undefined => {
    if (checked.has(stepId)) return undefined;
    const step = steps.get(stepId)!;
    for (const dependency of step.dependsOn) {
      const failure = check(dependency);
      if (failure) return failure;
    }
    const item = byId.get(stepId);
    if (step.kind === "ACTION") {
      if (!receiptMatches(item, strategy.id, step, policyInput.account, policyInput.chainId)) return stepId;
    } else if (step.kind === "WAIT_RECEIPT") {
      const action = steps.get(step.receipt.actionStepId);
      if (!action || action.kind !== "ACTION" || !receiptMatches(item, strategy.id, action, policyInput.account, policyInput.chainId)) return stepId;
    } else {
      const fresh = policyInput.current.quote;
      if (!item || item.kind !== "CURRENT_REVALIDATION" || item.quoteFingerprint !== quoteFingerprint(fresh) || step.quote && (step.quote.tool !== fresh.tool || step.quote.fingerprint !== item.quoteFingerprint) || step.policy && step.policy.id !== item.policyResultId || policy.mustStop) return stepId;
    }
    checked.add(stepId);
    return undefined;
  };
  for (const dependency of selected.dependsOn) {
    const failure = check(dependency);
    if (failure) return failure;
  }
  return undefined;
}

/** Assesses exactly one selected step. READY is a handoff for the existing wallet review, never a submission. */
export function executeStrategyStep(input: StrategyStepInput): StrategyStepResult {
  const validated = validateStrategy(input.strategy);
  if (!validated.valid) return { status: "INVALID_STRATEGY", errors: validated.errors };
  const strategy = validated.value;
  const selected = strategy.steps.find((step) => step.id === input.stepId);
  if (!selected) return { status: "INVALID_EVIDENCE", reason: "STEP_NOT_FOUND" };
  if (selected.kind !== "ACTION") return { status: "NON_EXECUTABLE_STEP", stepId: selected.id, kind: selected.kind, requiredEvidence: selected.kind === "WAIT_RECEIPT" ? "CONFIRMED_RECEIPT" : "CURRENT_REVALIDATION" };
  const policyInput = input.policyInput;
  if (!policyInput || !Number.isFinite(policyInput.now) || policyInput.now < 0) return { status: "INVALID_EVIDENCE", stepId: selected.id, reason: "POLICY_INPUT_REQUIRED" };
  if (!policyInput.current?.wallet || !policyInput.current.network || !policyInput.current.balances || !policyInput.current.fee || !policyInput.current.simulation || !Array.isArray(input.dependencies ?? [])) return { status: "INVALID_EVIDENCE", stepId: selected.id, reason: "MALFORMED_EVIDENCE" };
  const preparation = policyInput.preparation;
  const quote = policyInput.quote;
  if (!preparation || !quote || !validatePrepareResult(preparation, { now: 0 }).valid || !validateQuoteResult(quote, 0).valid || !validateQuoteResult(policyInput.current.quote, 0).valid) return { status: "INVALID_EVIDENCE", stepId: selected.id, reason: "MALFORMED_EVIDENCE" };
  if (preparation.status !== "PREPARED" || quote.status !== "AVAILABLE" || policyInput.current.quote.status !== "AVAILABLE") {
    const policy = evaluateFinalPolicy({ ...policyInput, priorStepConfirmed: false });
    return { status: "POLICY_STOP", stepId: selected.id, policy };
  }
  const reference = selected.preparedAction;
  const index = reference?.stepIndex;
  const preparedStep = index === undefined ? undefined : preparation.data.steps[index];
  const expectedAction = selected.action === "APPROVE" ? preparation.tool === "swap.prepare" ? "SWAP" : "BRIDGE" : selected.action;
  if (!reference || !preparedStep || reference.tool !== preparation.tool || reference.quoteFingerprint !== preparation.data.quoteFingerprint || policyInput.stepIndex !== index || policyInput.action !== expectedAction || !actionMatches(selected, preparedStep.kind) || !same(policyInput.account, preparation.data.account) || policyInput.chainId !== preparation.data.chainId || quoteFingerprint(quote) !== reference.quoteFingerprint) return { status: "INVALID_EVIDENCE", stepId: selected.id, reason: "ARTIFACT_MISMATCH" };
  const dependencies = input.dependencies ?? [];
  const ancestors = new Set<string>();
  const collect = (stepId: string) => { for (const dependency of strategy.steps.find((step) => step.id === stepId)!.dependsOn) { if (!ancestors.has(dependency)) { ancestors.add(dependency); collect(dependency); } } };
  collect(selected.id);
  const prior = index !== undefined && index > 0 && strategy.steps.some((step) => step.kind === "ACTION" && ancestors.has(step.id) && step.preparedAction && sameReference(step.preparedAction, { ...reference, stepIndex: index - 1 }) && dependencies.some((item) => receiptMatches(item, strategy.id, step, policyInput.account, policyInput.chainId)));
  const policy = evaluateFinalPolicy({ ...policyInput, priorStepConfirmed: Boolean(prior) });
  if (policy.mustStop) return { status: "POLICY_STOP", stepId: selected.id, policy };
  const failure = dependencyFailure(strategy, selected, dependencies, policyInput, policy);
  if (failure) return { status: "DEPENDENCY_NOT_SATISFIED", stepId: selected.id, dependencyStepId: failure };
  const handoff = preparation.data.handoff;
  if (!handoff || selected.action === "BRIDGE" || selected.action === "APPROVE" && preparation.tool !== "swap.prepare") return { status: "UNSUPPORTED", stepId: selected.id, reason: "NO_WALLET_HANDOFF" };
  if (!handoffMatches(handoff, preparation.data, quote, selected.action, policyInput.now)) return { status: "INVALID_EVIDENCE", stepId: selected.id, reason: "ARTIFACT_MISMATCH" };
  return { status: "READY_FOR_WALLET_REVIEW", strategyId: strategy.id, stepId: selected.id, action: selected.action, confirmation: selected.confirmation, policy, handoff };
}
