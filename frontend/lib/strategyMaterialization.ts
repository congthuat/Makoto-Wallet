import { keccak256, stringToHex, type Hex } from "viem";
import { compilePlannerStrategy, type StrategyCompilationResult } from "./plannerStrategyCompiler.ts";
import { canonicalPlannerDataJSON, snapshotPlannerStrategyData, validatePlannerStrategyBindingV2, type PlannerStrategyBindingV2 } from "./plannerStrategyBinding.ts";
import { isLiveConfirmedPlannerSource } from "./plannerConfirmationAuthority.ts";
import { validateStrategy } from "./strategyModel.ts";
import type { PlannerIntent } from "./plannerIntent.ts";

export type StrategyMaterializationInputV1 = Readonly<{
  version: 1;
  compilation: StrategyCompilationResult;
  bindingSource: Readonly<{
    requestId: string; sessionId: string; plan: unknown; resolution: unknown;
    strategy: unknown; goalSteps: unknown; provenance: unknown; provenanceSource: unknown;
  }>;
}>;

/** A semantic descriptor only. Operational evidence belongs to AEI-D and later boundaries. */
export type MaterializationRequirement =
  | "ACCOUNT_CONTEXT" | "LIVE_READ" | "QUOTE" | "POLICY_EVALUATION"
  | "PREPARATION" | "EXPLICIT_REVIEW" | "SUPPORTED_WALLET_HANDOFF";
export type StrategyActionMaterialization = Readonly<{
  version: 1; stage: "SEMANTIC_ONLY"; executionEnabled: false;
  strategyId: string; strategyDigest: Hex; bindingDigest: Hex; revision: Hex;
  actionStepId: string; goalId: string; actionKind: "SEND" | "SWAP" | "BRIDGE";
  dependsOnStepIds: readonly string[]; parameters: PlannerIntent;
  requirements: readonly MaterializationRequirement[]; digest: Hex;
}>;
export type StrategyMaterialization = Readonly<{
  version: 1; stage: "SEMANTIC_ONLY"; executionEnabled: false;
  strategyId: string; strategyVersion: 1; strategyCreatedAt: number; strategyDigest: Hex;
  bindingVersion: 2; binding: PlannerStrategyBindingV2; bindingDigest: Hex; parameterEvidenceDigest: Hex;
  requestId: string; sessionId: string; requestDigest: Hex; proposalId: string; proposalDigest: Hex;
  planId: string; planDigest: Hex; revision: Hex;
  actions: readonly StrategyActionMaterialization[]; digest: Hex;
}>;
export type StrategyMaterializationIssue =
  | "INVALID_RUNTIME" | "INVALID_SCHEMA" | "UNSUPPORTED_VERSION"
  | "NON_EXECUTABLE_INVARIANT_FAILED" | "INVALID_STRATEGY" | "BINDING_MISMATCH"
  | "PROVENANCE_MISMATCH" | "MISSING_PARAMETER_EVIDENCE" | "INVALID_MAPPING"
  | "INVALID_DEPENDENCY" | "UNSUPPORTED_ACTION" | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_ASSET" | "INCOMPLETE_PARAMETERS" | "IDENTITY_COLLISION";
export type StrategyMaterializationResult =
  | Readonly<{ status: "MATERIALIZED"; executionEnabled: false; materialization: StrategyMaterialization }>
  | Readonly<{ status: "REJECTED"; reason: StrategyMaterializationIssue }>;
export type StrategyMaterializationValidation =
  | Readonly<{ valid: true; value: StrategyMaterialization }>
  | Readonly<{ valid: false; reason: StrategyMaterializationIssue }>;

type Data = Record<string, unknown>;
const object = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Data, fields: readonly string[]) => Reflect.ownKeys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const reject = (reason: StrategyMaterializationIssue): StrategyMaterializationResult => ({ status: "REJECTED", reason });
const hash = (domain: string, tuple: unknown): Hex => keccak256(stringToHex(JSON.stringify([domain, 1, ...tuple as unknown[]])));
const requirements = Object.freeze([
  "ACCOUNT_CONTEXT", "LIVE_READ", "QUOTE", "POLICY_EVALUATION", "PREPARATION", "EXPLICIT_REVIEW", "SUPPORTED_WALLET_HANDOFF",
] as const satisfies readonly MaterializationRequirement[]);

function intentTuple(intent: PlannerIntent): unknown[] {
  if (intent.kind === "SEND") return [intent.version, intent.id, intent.kind, intent.chainId, intent.asset, intent.amount, intent.recipient];
  if (intent.kind === "SWAP") return [intent.version, intent.id, intent.kind, intent.chainId, intent.fromAsset, intent.toAsset, intent.amount];
  return [intent.version, intent.id, intent.kind, intent.sourceChainId, intent.destinationChainId, intent.asset, intent.amount, intent.recipient];
}
function canonicalIntent(intent: PlannerIntent): PlannerIntent {
  if (intent.kind === "SEND") return { version: 1, id: intent.id, kind: "SEND", chainId: intent.chainId,
    asset: intent.asset, amount: intent.amount, recipient: intent.recipient };
  if (intent.kind === "SWAP") return { version: 1, id: intent.id, kind: "SWAP", chainId: intent.chainId,
    fromAsset: intent.fromAsset, toAsset: intent.toAsset, amount: intent.amount };
  return { version: 1, id: intent.id, kind: "BRIDGE", sourceChainId: intent.sourceChainId,
    destinationChainId: intent.destinationChainId, asset: intent.asset, amount: intent.amount, recipient: intent.recipient };
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Pure, bounded, live-provenance-checked conversion of the exact AEI-B result. */
export function materializePlannerStrategy(input: unknown): StrategyMaterializationResult {
  try {
    const checked = snapshotPlannerStrategyData(input);
    if (!checked.valid) return reject("INVALID_RUNTIME");
    const value = checked.value;
    if (!object(value) || !exact(value, ["version", "compilation", "bindingSource"])) return reject("INVALID_SCHEMA");
    if (value.version !== 1) return reject("UNSUPPORTED_VERSION");
    const compilation = value.compilation, source = value.bindingSource;
    if (!object(compilation) || !exact(compilation, ["status", "executionEnabled", "strategy", "binding"]) ||
      compilation.status !== "COMPILED" || !object(source) || !exact(source, ["requestId", "sessionId", "plan", "resolution", "strategy", "goalSteps", "provenance", "provenanceSource"])) return reject("INVALID_SCHEMA");
    if (compilation.executionEnabled !== false) return reject("NON_EXECUTABLE_INVARIANT_FAILED");
    if (!object(compilation.binding) || compilation.binding.version !== 2 || compilation.binding.digestVersion !== 2) return reject("BINDING_MISMATCH");
    const strategy = validateStrategy(compilation.strategy);
    if (!strategy.valid) return reject("INVALID_STRATEGY");
    if (canonicalPlannerDataJSON(source.strategy) !== canonicalPlannerDataJSON(strategy.value)) return reject("BINDING_MISMATCH");

    // A snapshot cannot carry B2's private WeakMap identity. Recover only the exact original descriptor value.
    const rawSourceContainer = input && typeof input === "object" ? Object.getOwnPropertyDescriptor(input, "bindingSource")?.value : undefined;
    const liveSource = rawSourceContainer && typeof rawSourceContainer === "object" ? Object.getOwnPropertyDescriptor(rawSourceContainer, "provenanceSource")?.value : undefined;
    if (!isLiveConfirmedPlannerSource(liveSource)) return reject("MISSING_PARAMETER_EVIDENCE");
    const liveCopy = snapshotPlannerStrategyData(liveSource);
    if (!liveCopy.valid || canonicalPlannerDataJSON(liveCopy.value) !== canonicalPlannerDataJSON(source.provenanceSource)) return reject("PROVENANCE_MISMATCH");
    const retained = { ...source, provenanceSource: liveSource };
    const validated = validatePlannerStrategyBindingV2(compilation.binding, retained);
    if (!validated.valid) return reject(validated.reason === "UNRESOLVED_INTENTS" ? "MISSING_PARAMETER_EVIDENCE" : "BINDING_MISMATCH");
    const binding = validated.value;
    if (binding.version !== 2) return reject("BINDING_MISMATCH");
    const rebuilt = compilePlannerStrategy({ version: 2, requestId: source.requestId, sessionId: source.sessionId,
      createdAt: strategy.value.createdAt, plan: source.plan, resolution: source.provenance, provenanceSource: liveSource });
    if (rebuilt.status !== "COMPILED" || canonicalPlannerDataJSON(rebuilt) !== canonicalPlannerDataJSON(compilation)) return reject("PROVENANCE_MISMATCH");

    const b = binding as PlannerStrategyBindingV2;
    const event = object(source.provenanceSource) ? source.provenanceSource.structuredInput : undefined;
    if (!object(event) || typeof event.requestDigest !== "string" || typeof event.proposalId !== "string" || typeof event.proposalDigest !== "string") return reject("MISSING_PARAMETER_EVIDENCE");
    const evidence = source.provenance;
    if (!object(evidence) || !Array.isArray(evidence.intents)) return reject("MISSING_PARAMETER_EVIDENCE");
    const intents = new Map<string, PlannerIntent>((evidence.intents as PlannerIntent[]).map((item) => [item.id, item]));
    const goals = new Map(b.goalSteps.map((item) => [item.actionStepId, item.goalId]));
    if (goals.size !== strategy.value.steps.length || intents.size !== strategy.value.steps.length) return reject("INVALID_MAPPING");
    const revision = hash("makoto.strategy-materialization-revision", [b.digest, b.strategy.digest]);
    const actions: StrategyActionMaterialization[] = [];
    for (const step of strategy.value.steps) {
      if (step.kind !== "ACTION" || step.action === "APPROVE") return reject("UNSUPPORTED_ACTION");
      const goalId = goals.get(step.id), intent = goalId ? intents.get(goalId) : undefined;
      if (!goalId || !intent || intent.kind !== step.action) return reject("INVALID_MAPPING");
      const deps = [...step.dependsOn].sort(compare);
      const base = { version: 1 as const, stage: "SEMANTIC_ONLY" as const, executionEnabled: false as const,
        strategyId: strategy.value.id, strategyDigest: b.strategy.digest, bindingDigest: b.digest, revision,
        actionStepId: step.id, goalId, actionKind: step.action, dependsOnStepIds: deps,
        parameters: canonicalIntent(intent), requirements };
      const digest = hash("makoto.strategy-action-materialization", [base.strategyId, base.strategyDigest, base.bindingDigest,
        base.revision, base.actionStepId, base.goalId, base.actionKind, deps, intentTuple(intent), requirements]);
      actions.push({ ...base, digest });
    }
    const base = { version: 1 as const, stage: "SEMANTIC_ONLY" as const, executionEnabled: false as const,
      strategyId: strategy.value.id, strategyVersion: 1 as const, strategyCreatedAt: strategy.value.createdAt,
      strategyDigest: b.strategy.digest, bindingVersion: 2 as const, binding: b, bindingDigest: b.digest,
      parameterEvidenceDigest: b.parameterEvidenceDigest, requestId: b.requestId, sessionId: b.sessionId,
      requestDigest: event.requestDigest as Hex, proposalId: event.proposalId, proposalDigest: event.proposalDigest as Hex,
      planId: b.plan.id, planDigest: b.plan.digest, revision, actions };
    const digest = hash("makoto.strategy-materialization", [base.strategyId, base.strategyVersion, base.strategyCreatedAt,
      base.strategyDigest, base.bindingVersion, base.bindingDigest, base.parameterEvidenceDigest,
      base.requestId, base.sessionId, base.requestDigest, base.proposalId, base.proposalDigest,
      base.planId, base.planDigest, base.revision, actions.map((action) => action.digest)]);
    return { status: "MATERIALIZED", executionEnabled: false, materialization: deepFreeze({ ...base, digest }) };
  } catch { return reject("INVALID_RUNTIME"); }
}

/** An AEI-D consumer must validate against the same retained live upstream input. */
export function validateStrategyMaterialization(candidate: unknown, sourceInput: unknown): StrategyMaterializationValidation {
  try {
    const actual = snapshotPlannerStrategyData(candidate);
    if (!actual.valid) return { valid: false, reason: "INVALID_RUNTIME" };
    const expected = materializePlannerStrategy(sourceInput);
    if (expected.status !== "MATERIALIZED") return { valid: false, reason: expected.reason };
    if (canonicalPlannerDataJSON(actual.value) !== canonicalPlannerDataJSON(expected.materialization)) return { valid: false, reason: "PROVENANCE_MISMATCH" };
    return { valid: true, value: expected.materialization };
  } catch { return { valid: false, reason: "INVALID_RUNTIME" }; }
}
