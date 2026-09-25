import { keccak256, stringToHex } from "viem";
import { validatePlannerIntent, type PlannerIntent } from "./plannerIntent.ts";
import { validatePlannerPlan, type PlannerGoalKind, type PlannerPlanValidationCode } from "./plannerPlan.ts";
import { createPlannerStrategyBinding, snapshotPlannerStrategyData, type PlannerStrategyBinding } from "./plannerStrategyBinding.ts";
import { validateStrategy, type ActionStep, type Strategy } from "./strategyModel.ts";

/** The caller owns request/session identity and the observed creation time. */
export type StrategyCompilationInput = Readonly<{
  version: 1;
  requestId: string;
  sessionId: string;
  createdAt: number;
  plan: unknown;
  resolution: unknown;
}>;
export type StrategyCompilationIssue =
  | "INVALID_RUNTIME" | "INVALID_SCHEMA" | "UNEXPECTED_FIELD" | "UNSUPPORTED_VERSION" | "INVALID_ID"
  | "INVALID_CREATED_AT" | "INVALID_PLAN" | "DUPLICATE_GOAL_ID" | "UNKNOWN_DEPENDENCY"
  | "DEPENDENCY_CYCLE" | "INVALID_DEPENDENCY" | "UNSUPPORTED_GOAL_KIND"
  | "UNRESOLVED_PARAMETER" | "DYNAMIC_VALUE_DEPENDENCY_UNSUPPORTED" | "PLAN_RESULT_MISMATCH"
  | "GOAL_BINDING_MISMATCH" | "INVALID_INTENT" | "UNSUPPORTED_CHAIN" | "UNSUPPORTED_ASSET"
  | "INVALID_RECIPIENT" | "AMBIGUOUS_AMOUNT" | "UNSUPPORTED_ACTION_MAPPING"
  | "INVALID_STRATEGY" | "IDENTITY_COLLISION" | "BINDING_CREATION_FAILED";
export type StrategyCompilationResult =
  | Readonly<{ status: "COMPILED"; executionEnabled: false; strategy: Strategy; binding: PlannerStrategyBinding }>
  | Readonly<{ status: "REJECTED"; reason: StrategyCompilationIssue }>;

type Data = Record<string, unknown>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const object = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Data, names: readonly string[]) => Reflect.ownKeys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const reject = (reason: StrategyCompilationIssue): StrategyCompilationResult => ({ status: "REJECTED", reason });
const hash = (kind: "STRATEGY" | "ACTION", value: unknown) => keccak256(stringToHex(JSON.stringify(["makoto.strategy-skeleton", 1, kind, value])));

function intentTuple(intent: PlannerIntent): unknown[] {
  if (intent.kind === "SEND") return [intent.version, intent.id, intent.kind, intent.chainId, intent.asset, intent.amount, intent.recipient];
  if (intent.kind === "SWAP") return [intent.version, intent.id, intent.kind, intent.chainId, intent.fromAsset, intent.toAsset, intent.amount];
  return [intent.version, intent.id, intent.kind, intent.sourceChainId, intent.destinationChainId, intent.asset, intent.amount, intent.recipient];
}

function planIssue(code: PlannerPlanValidationCode): StrategyCompilationIssue {
  if (code === "UNSUPPORTED_VERSION") return "UNSUPPORTED_VERSION";
  if (code === "DUPLICATE_GOAL_ID") return "DUPLICATE_GOAL_ID";
  if (code === "UNKNOWN_DEPENDENCY") return "UNKNOWN_DEPENDENCY";
  if (code === "DEPENDENCY_CYCLE") return "DEPENDENCY_CYCLE";
  if (code === "INVALID_GOAL_KIND") return "UNSUPPORTED_GOAL_KIND";
  if (code === "SELF_DEPENDENCY" || code === "DUPLICATE_DEPENDENCY") return "INVALID_DEPENDENCY";
  if (code === "INVALID_SCHEMA") return "INVALID_SCHEMA";
  return "INVALID_PLAN";
}
function intentIssue(path: string, code: string): StrategyCompilationIssue {
  if (path.endsWith("chainId") || path.endsWith("ChainId")) return "UNSUPPORTED_CHAIN";
  if (path.endsWith("asset") || path.endsWith("Asset")) return "UNSUPPORTED_ASSET";
  if (path.endsWith("recipient")) return "INVALID_RECIPIENT";
  if (path.endsWith("amount")) return "AMBIGUOUS_AMOUNT";
  if (code === "UNSUPPORTED_KIND") return "UNSUPPORTED_GOAL_KIND";
  return "INVALID_INTENT";
}
function actionFor(kind: PlannerGoalKind): ActionStep["action"] | undefined {
  switch (kind) {
    case "SEND": return "SEND";
    case "SWAP": return "SWAP";
    case "BRIDGE": return "BRIDGE";
    default: return undefined;
  }
}

/** Pure Phase 11 to Phase 10 skeleton conversion. No quote, account, policy or execution evidence. */
export function compilePlannerStrategy(input: unknown): StrategyCompilationResult {
  try {
    const captured = snapshotPlannerStrategyData(input);
    if (!captured.valid) return reject("INVALID_RUNTIME");
    const source = captured.value;
    if (!object(source)) return reject("INVALID_SCHEMA");
    const fields = ["version", "requestId", "sessionId", "createdAt", "plan", "resolution"];
    if (Reflect.ownKeys(source).some((key) => !fields.includes(String(key)))) return reject("UNEXPECTED_FIELD");
    if (!exact(source, fields)) return reject("INVALID_SCHEMA");
    if (source.version !== 1) return reject("UNSUPPORTED_VERSION");
    if (typeof source.requestId !== "string" || !ID.test(source.requestId) || typeof source.sessionId !== "string" || !ID.test(source.sessionId)) return reject("INVALID_ID");
    if (!Number.isSafeInteger(source.createdAt) || (source.createdAt as number) < 0) return reject("INVALID_CREATED_AT");
    const planResult = validatePlannerPlan(source.plan);
    if (!planResult.valid) return reject(planIssue(planResult.errors[0].code));
    const plan = planResult.value;
    if (!ID.test(plan.id) || plan.goals.some((goal) => !ID.test(goal.id) || goal.dependsOn.some((dep) => !ID.test(dep)))) return reject("INVALID_ID");

    const resolution = source.resolution;
    if (!object(resolution)) return reject("UNRESOLVED_PARAMETER");
    if (resolution.status !== "RESOLVED") {
      if (Array.isArray(resolution.issues) && resolution.issues.some((issue) => object(issue) && issue.code === "DYNAMIC_AMOUNT")) return reject("DYNAMIC_VALUE_DEPENDENCY_UNSUPPORTED");
      return reject("UNRESOLVED_PARAMETER");
    }
    if (!exact(resolution, ["status", "planId", "intents"]) || resolution.planId !== plan.id || !Array.isArray(resolution.intents)) return reject("PLAN_RESULT_MISMATCH");
    if (resolution.intents.length !== plan.goals.length) return reject("GOAL_BINDING_MISMATCH");
    const goals = new Map(plan.goals.map((goal) => [goal.id, goal]));
    const intents = new Map<string, PlannerIntent>();
    for (const raw of resolution.intents) {
      const result = validatePlannerIntent(raw);
      if (!result.valid) return reject(intentIssue(result.errors[0].path, result.errors[0].code));
      const intent = result.value;
      if (!ID.test(intent.id) || !goals.has(intent.id) || goals.get(intent.id)!.kind !== intent.kind || intents.has(intent.id)) return reject("GOAL_BINDING_MISMATCH");
      intents.set(intent.id, intent);
    }
    if (intents.size !== goals.size) return reject("GOAL_BINDING_MISMATCH");

    const orderedGoals = [...plan.goals].sort((a, b) => compare(a.id, b.id));
    const semanticIdentity = [source.requestId, source.sessionId, plan.version, plan.id, plan.classification,
      orderedGoals.map((goal) => [goal.id, goal.kind, [...goal.dependsOn].sort(compare)]),
      [...intents.values()].sort((a, b) => compare(a.id, b.id)).map(intentTuple)];
    const strategyId = `strategy:${hash("STRATEGY", semanticIdentity).slice(2)}`;
    const stepIds = new Map(orderedGoals.map((goal) => [goal.id, `action:${hash("ACTION", [strategyId, goal.id]).slice(2)}`]));
    if (new Set(stepIds.values()).size !== orderedGoals.length) return reject("IDENTITY_COLLISION");
    const steps: ActionStep[] = [];
    for (const goal of orderedGoals) {
      const action = actionFor(goal.kind);
      if (!action) return reject("UNSUPPORTED_ACTION_MAPPING");
      steps.push({ id: stepIds.get(goal.id)!, kind: "ACTION", action, confirmation: "EXPLICIT_USER_CONFIRMATION",
        dependsOn: goal.dependsOn.map((dep) => stepIds.get(dep)!).sort(compare) });
    }
    const strategy: Strategy = { version: 1, id: strategyId, createdAt: source.createdAt as number, steps };
    if (!validateStrategy(strategy).valid) return reject("INVALID_STRATEGY");
    const goalSteps = orderedGoals.map((goal) => ({ goalId: goal.id, actionStepId: stepIds.get(goal.id)! }));
    const bound = createPlannerStrategyBinding({ requestId: source.requestId, sessionId: source.sessionId,
      plan, resolution, strategy, goalSteps });
    if (!bound.valid) return reject("BINDING_CREATION_FAILED");
    const frozen: Strategy = Object.freeze({ ...strategy, steps: Object.freeze(steps.map((step) => Object.freeze({ ...step, dependsOn: Object.freeze([...step.dependsOn]) }))) });
    return { status: "COMPILED", executionEnabled: false, strategy: frozen, binding: bound.value };
  } catch { return reject("INVALID_RUNTIME"); }
}
