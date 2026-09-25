import { keccak256, stringToHex, type Hex } from "viem";
import { validatePlannerIntent, type PlannerIntent } from "./plannerIntent.ts";
import { validatePlannerPlan, type PlannerPlan } from "./plannerPlan.ts";
import { validateStrategy, type ActionStep, type Strategy } from "./strategyModel.ts";

/** AEI-A binds an existing, non-executable skeleton. It never creates Strategy steps. */
export type PlannerStrategyGoalStep = Readonly<{ goalId: string; actionStepId: string }>;
export type PlannerStrategyBinding = Readonly<{
  version: 1;
  digestVersion: 1;
  requestId: string;
  sessionId: string;
  plan: Readonly<{ id: string; version: 1; digest: Hex }>;
  resolvedIntentsDigest: Hex;
  strategy: Readonly<{ id: string; version: 1; stage: "SKELETON"; digest: Hex }>;
  goalSteps: readonly PlannerStrategyGoalStep[];
  digest: Hex;
}>;

/** requestId/sessionId must originate at a trusted caller, never at the Planner provider. */
export type PlannerStrategyBindingSource = Readonly<{
  requestId: string;
  sessionId: string;
  plan: unknown;
  resolution: unknown;
  strategy: unknown;
  goalSteps: unknown;
}>;

export type PlannerStrategyBindingIssue =
  | "INVALID_SCHEMA" | "UNSUPPORTED_VERSION" | "INVALID_ID" | "INVALID_PLAN"
  | "UNRESOLVED_INTENTS" | "INVALID_INTENT" | "GOAL_MISMATCH"
  | "INVALID_STRATEGY" | "UNSUPPORTED_SKELETON" | "INVALID_MAPPING"
  | "PROVENANCE_MISMATCH" | "INVALID_RUNTIME";
export type PlannerStrategyBindingResult =
  | Readonly<{ valid: true; value: PlannerStrategyBinding }>
  | Readonly<{ valid: false; reason: PlannerStrategyBindingIssue }>;

type Data = Record<string, unknown>;
type Checked = Readonly<{
  requestId: string; sessionId: string; plan: PlannerPlan;
  intents: readonly PlannerIntent[]; strategy: Strategy;
  goalSteps: readonly PlannerStrategyGoalStep[];
}>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/; // Phase 12 v2 identity syntax.
const HASH = /^0x[0-9a-f]{64}$/;
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const digestShape = (value: unknown): value is Hex => typeof value === "string" && HASH.test(value);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0; // Code-point order, never locale order.
const reject = (reason: PlannerStrategyBindingIssue): PlannerStrategyBindingResult => ({ valid: false, reason });

/** Copy descriptor values once, never reading getters or a proxy's later get trap. */
const INVALID = Symbol("invalid-plain-data");
function snapshot(value: unknown, ancestors = new Set<object>(), budget = { nodes: 0 }, depth = 0): unknown | typeof INVALID {
  if (++budget.nodes > 4096 || depth > 32) return INVALID;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID;
  if (typeof value !== "object" || ancestors.has(value)) return INVALID;
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return INVALID;
  const own = Reflect.ownKeys(value);
  if (own.length > 256) return INVALID;
  const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;
  if (array && (!Number.isSafeInteger(length) || length < 0 || own.length !== length + 1)) return INVALID;
  ancestors.add(value);
  const names = array ? Array.from({ length }, (_, i) => String(i)) : own;
  const result: Data | unknown[] = array ? [] : {};
  for (const name of names) {
    if (typeof name !== "string" || !Object.hasOwn(value, name)) return INVALID;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, "value")) return INVALID;
    const child = snapshot(descriptor.value, ancestors, budget, depth + 1);
    if (child === INVALID) return INVALID;
    Object.defineProperty(result, name, { value: child, enumerable: true, configurable: true, writable: true });
  }
  ancestors.delete(value);
  return result;
}
const object = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Data, names: readonly string[]) => Reflect.ownKeys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));

/** UTF-8 bytes of JSON.stringify([domain, digestVersion, kind, payload]), hashed with viem keccak256.
 * Payloads below are fixed-order tuples of validated primitives, never generic object serialization.
 */
function hash(kind: "PLAN" | "INTENTS" | "SKELETON" | "BINDING", payload: unknown): Hex {
  return keccak256(stringToHex(JSON.stringify(["makoto.planner-strategy-binding", 1, kind, payload])));
}
const ordered = (values: readonly string[]) => [...values].sort(compare);
function planDigest(plan: PlannerPlan): Hex {
  return hash("PLAN", [plan.version, plan.id, plan.classification,
    [...plan.goals].sort((a, b) => compare(a.id, b.id)).map((goal) => [goal.id, goal.kind, ordered(goal.dependsOn)])]);
}
function intentTuple(intent: PlannerIntent): unknown[] {
  if (intent.kind === "SEND") return [intent.version, intent.id, intent.kind, intent.chainId, intent.asset, intent.amount, intent.recipient];
  if (intent.kind === "SWAP") return [intent.version, intent.id, intent.kind, intent.chainId, intent.fromAsset, intent.toAsset, intent.amount];
  return [intent.version, intent.id, intent.kind, intent.sourceChainId, intent.destinationChainId, intent.asset, intent.amount, intent.recipient];
}
function intentsDigest(intents: readonly PlannerIntent[]): Hex {
  return hash("INTENTS", [...intents].sort((a, b) => compare(a.id, b.id)).map(intentTuple));
}
function skeletonDigest(strategy: Strategy): Hex {
  // Phase 10E uses step order to break ties among eligible actions; bind that order.
  return hash("SKELETON", [strategy.version, strategy.id, strategy.createdAt,
    strategy.steps.map((step) => [step.id, (step as ActionStep).action, (step as ActionStep).confirmation, ordered(step.dependsOn)])]);
}
function bindingDigest(binding: Omit<PlannerStrategyBinding, "digest">): Hex {
  return hash("BINDING", [binding.requestId, binding.sessionId,
    binding.plan.id, binding.plan.version, binding.plan.digest, binding.resolvedIntentsDigest,
    binding.strategy.id, binding.strategy.version, binding.strategy.stage, binding.strategy.digest,
    [...binding.goalSteps].sort((a, b) => compare(a.goalId, b.goalId)).map((item) => [item.goalId, item.actionStepId])]);
}

function checkedSource(input: unknown): Checked | PlannerStrategyBindingIssue {
  input = snapshot(input);
  if (input === INVALID || !object(input) || !exact(input, ["requestId", "sessionId", "plan", "resolution", "strategy", "goalSteps"])) return "INVALID_SCHEMA";
  if (!id(input.requestId) || !id(input.sessionId)) return "INVALID_ID";
  const planResult = validatePlannerPlan(input.plan);
  if (!planResult.valid) return "INVALID_PLAN";
  const plan = planResult.value;
  if (!id(plan.id) || plan.goals.some((goal) => !id(goal.id) || goal.dependsOn.some((dep) => !id(dep)))) return "INVALID_ID";
  const resolution = input.resolution;
  if (!object(resolution) || !exact(resolution, ["status", "planId", "intents"]) || resolution.status !== "RESOLVED" || resolution.planId !== plan.id || !Array.isArray(resolution.intents) || resolution.intents.length !== plan.goals.length) return "UNRESOLVED_INTENTS";
  const intents: PlannerIntent[] = [];
  const intentIds = new Set<string>();
  for (const item of resolution.intents) {
    const result = validatePlannerIntent(item);
    if (!result.valid) return "INVALID_INTENT";
    const intent = result.value;
    const goal = plan.goals.find((candidate) => candidate.id === intent.id);
    if (!goal || goal.kind !== intent.kind || intentIds.has(intent.id)) return "GOAL_MISMATCH";
    intentIds.add(intent.id); intents.push(intent);
  }
  if (intentIds.size !== plan.goals.length) return "GOAL_MISMATCH";
  const strategyResult = validateStrategy(input.strategy);
  if (!strategyResult.valid) return "INVALID_STRATEGY";
  const strategy = strategyResult.value;
  if (!id(strategy.id) || strategy.steps.some((step) => !id(step.id) || step.dependsOn.some((dep) => !id(dep)))) return "INVALID_ID";
  if (strategy.steps.length !== plan.goals.length || "metadata" in strategy || strategy.steps.some((step) => step.kind !== "ACTION" || "preparedAction" in step || "metadata" in step)) return "UNSUPPORTED_SKELETON";
  if (!Array.isArray(input.goalSteps) || input.goalSteps.length !== plan.goals.length) return "INVALID_MAPPING";
  const mappings: PlannerStrategyGoalStep[] = [];
  const mappedGoals = new Set<string>(), mappedSteps = new Set<string>();
  for (const item of input.goalSteps) {
    if (!object(item) || !exact(item, ["goalId", "actionStepId"]) || !id(item.goalId) || !id(item.actionStepId)) return "INVALID_MAPPING";
    if (mappedGoals.has(item.goalId) || mappedSteps.has(item.actionStepId)) return "INVALID_MAPPING";
    const goal = plan.goals.find((candidate) => candidate.id === item.goalId);
    const step = strategy.steps.find((candidate) => candidate.id === item.actionStepId);
    if (!goal || !step || step.kind !== "ACTION" || step.action !== goal.kind) return "INVALID_MAPPING";
    mappedGoals.add(item.goalId); mappedSteps.add(item.actionStepId);
    mappings.push({ goalId: item.goalId, actionStepId: item.actionStepId });
  }
  if (mappedGoals.size !== plan.goals.length || mappedSteps.size !== strategy.steps.length) return "INVALID_MAPPING";
  const byGoal = new Map(mappings.map((item) => [item.goalId, item.actionStepId]));
  for (const item of mappings) {
    const goal = plan.goals.find((candidate) => candidate.id === item.goalId)!;
    const step = strategy.steps.find((candidate) => candidate.id === item.actionStepId)!;
    const expected = goal.dependsOn.map((dependency) => byGoal.get(dependency)!);
    if (expected.length !== step.dependsOn.length || ordered(expected).some((value, index) => value !== ordered(step.dependsOn)[index])) return "INVALID_MAPPING";
  }
  return { requestId: input.requestId, sessionId: input.sessionId, plan, intents, strategy, goalSteps: mappings };
}

function expectedBinding(source: Checked): PlannerStrategyBinding {
  const base: Omit<PlannerStrategyBinding, "digest"> = {
    version: 1, digestVersion: 1, requestId: source.requestId, sessionId: source.sessionId,
    plan: { id: source.plan.id, version: 1, digest: planDigest(source.plan) },
    resolvedIntentsDigest: intentsDigest(source.intents),
    strategy: { id: source.strategy.id, version: 1, stage: "SKELETON", digest: skeletonDigest(source.strategy) },
    goalSteps: [...source.goalSteps].sort((a, b) => compare(a.goalId, b.goalId)),
  };
  return { ...base, digest: bindingDigest(base) };
}
function freezeBinding(value: PlannerStrategyBinding): PlannerStrategyBinding {
  return Object.freeze({ ...value, plan: Object.freeze(value.plan), strategy: Object.freeze(value.strategy),
    goalSteps: Object.freeze(value.goalSteps.map((item) => Object.freeze(item))) });
}

/** Source includes an existing skeleton and explicit mapping; this function does not compile either. */
export function createPlannerStrategyBinding(input: unknown): PlannerStrategyBindingResult {
  try {
    const source = checkedSource(input);
    if (typeof source === "string") return reject(source);
    return { valid: true, value: freezeBinding(expectedBinding(source)) };
  } catch { return reject("INVALID_RUNTIME"); }
}

/** Recomputes provenance from separately retained authoritative inputs. A digest alone is not proof. */
export function validatePlannerStrategyBinding(input: unknown, sourceInput: unknown): PlannerStrategyBindingResult {
  try {
    input = snapshot(input);
    if (input === INVALID || !object(input) || !exact(input, ["version", "digestVersion", "requestId", "sessionId", "plan", "resolvedIntentsDigest", "strategy", "goalSteps", "digest"])) return reject("INVALID_SCHEMA");
    if (input.version !== 1 || input.digestVersion !== 1) return reject("UNSUPPORTED_VERSION");
    if (!id(input.requestId) || !id(input.sessionId)) return reject("INVALID_ID");
    if (!object(input.plan) || !exact(input.plan, ["id", "version", "digest"]) || !object(input.strategy) || !exact(input.strategy, ["id", "version", "stage", "digest"])) return reject("INVALID_SCHEMA");
    if (input.plan.version !== 1 || input.strategy.version !== 1 || input.strategy.stage !== "SKELETON") return reject("UNSUPPORTED_VERSION");
    if (!id(input.plan.id) || !id(input.strategy.id)) return reject("INVALID_ID");
    if (![input.plan.digest, input.resolvedIntentsDigest, input.strategy.digest, input.digest].every(digestShape)) return reject("INVALID_SCHEMA");
    if (!Array.isArray(input.goalSteps) || input.goalSteps.length < 1 || input.goalSteps.length > 32) return reject("INVALID_MAPPING");
    const goalIds = new Set<string>(), stepIds = new Set<string>();
    for (const item of input.goalSteps) {
      if (!object(item) || !exact(item, ["goalId", "actionStepId"]) || !id(item.goalId) || !id(item.actionStepId) || goalIds.has(item.goalId) || stepIds.has(item.actionStepId)) return reject("INVALID_MAPPING");
      goalIds.add(item.goalId); stepIds.add(item.actionStepId);
    }
    const source = checkedSource(sourceInput);
    if (typeof source === "string") return reject(source);
    const expected = expectedBinding(source);
    // Compare declared fields independently of object-key and mapping order.
    const actual = input as unknown as PlannerStrategyBinding;
    if (actual.requestId !== expected.requestId || actual.sessionId !== expected.sessionId || actual.plan.id !== expected.plan.id || actual.plan.digest !== expected.plan.digest || actual.resolvedIntentsDigest !== expected.resolvedIntentsDigest || actual.strategy.id !== expected.strategy.id || actual.strategy.digest !== expected.strategy.digest || actual.digest !== expected.digest || actual.goalSteps.length !== expected.goalSteps.length ||
      [...actual.goalSteps].sort((a, b) => compare(a.goalId, b.goalId)).some((item, index) => item.goalId !== expected.goalSteps[index].goalId || item.actionStepId !== expected.goalSteps[index].actionStepId)) return reject("PROVENANCE_MISMATCH");
    return { valid: true, value: freezeBinding(expected) };
  } catch { return reject("INVALID_RUNTIME"); }
}
