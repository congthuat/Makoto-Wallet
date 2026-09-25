import { validatePlannerIntent, type PlannerIntent, type PlannerIntentValidationIssue } from "./plannerIntent.ts";

/** User-level goals and dependencies. Phase 10 owns technical execution steps. */
export type PlannerPlan = Readonly<{
  version: 1;
  id: string;
  classification: "ACTION" | "STRATEGY";
  goals: readonly Readonly<{ intent: PlannerIntent; dependsOn: readonly string[] }>[];
}>;

export type PlannerPlanValidationCode = "INVALID_SCHEMA" | "UNSUPPORTED_VERSION" | "INVALID_ID" | "INVALID_CLASSIFICATION" | "CLASSIFICATION_MISMATCH" | "INVALID_GOAL_COUNT" | "MISSING_COMPOSITION" | "INVALID_INTENT" | "DUPLICATE_INTENT_ID" | "DUPLICATE_DEPENDENCY" | "SELF_DEPENDENCY" | "UNKNOWN_DEPENDENCY" | "DEPENDENCY_CYCLE";
export type PlannerPlanValidationIssue = Readonly<{ path: string; code: PlannerPlanValidationCode; message: string; intentIssues?: readonly PlannerIntentValidationIssue[] }>;
export type PlannerPlanValidationResult =
  | Readonly<{ valid: true; value: PlannerPlan }>
  | Readonly<{ valid: false; errors: readonly PlannerPlanValidationIssue[] }>;

type Data = Record<string, unknown>;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
const keys = (value: Data, required: readonly string[]) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).length === required.length;
const denseArray = (value: unknown): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Object.keys(value).length === value.length && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index))!, "value")).every(Boolean);

/** Structural support only. Phase 9 still decides whether any transaction is safe. */
export function validatePlannerPlan(input: unknown, expectedClassification?: "ACTION" | "STRATEGY"): PlannerPlanValidationResult {
  const errors: PlannerPlanValidationIssue[] = [];
  const add = (path: string, code: PlannerPlanValidationCode, message: string, intentIssues?: readonly PlannerIntentValidationIssue[]) => errors.push({ path, code, message, ...(intentIssues ? { intentIssues } : {}) });
  if (!record(input) || !keys(input, ["version", "id", "classification", "goals"])) return { valid: false, errors: [{ path: "plan", code: "INVALID_SCHEMA", message: "Plan must contain only its declared fields." }] };
  if (input.version !== 1) add("plan.version", "UNSUPPORTED_VERSION", "Unsupported plan version.");
  if (!nonempty(input.id)) add("plan.id", "INVALID_ID", "Plan ID is required.");
  if (input.classification !== "ACTION" && input.classification !== "STRATEGY") add("plan.classification", "INVALID_CLASSIFICATION", "Plan must be ACTION or STRATEGY.");
  if (expectedClassification && input.classification !== expectedClassification) add("plan.classification", "CLASSIFICATION_MISMATCH", "Plan classification must match canonical 11B classification.");
  if (!denseArray(input.goals) || input.goals.length > 32) {
    add("plan.goals", "INVALID_SCHEMA", "Goals must be a bounded plain array.");
    return { valid: false, errors };
  }
  if (input.classification === "ACTION" && input.goals.length !== 1 || input.classification === "STRATEGY" && input.goals.length < 2) add("plan.goals", "INVALID_GOAL_COUNT", "Goal count does not match classification.");

  const byId = new Map<string, string[]>();
  let edgeCount = 0;
  input.goals.forEach((goal, index) => {
    const path = `plan.goals[${index}]`;
    if (!record(goal) || !keys(goal, ["intent", "dependsOn"])) { add(path, "INVALID_SCHEMA", "Goal must contain an intent and dependencies only."); return; }
    const checked = validatePlannerIntent(goal.intent);
    if (!checked.valid) add(`${path}.intent`, "INVALID_INTENT", "Goal intent failed 11A validation.", checked.errors);
    if (!denseArray(goal.dependsOn) || goal.dependsOn.length > 32 || goal.dependsOn.some((dependency) => !nonempty(dependency))) {
      add(`${path}.dependsOn`, "INVALID_SCHEMA", "Dependencies must be a bounded array of intent IDs.");
      return;
    }
    edgeCount += goal.dependsOn.length;
    if (input.classification === "ACTION" && goal.dependsOn.length) add(`${path}.dependsOn`, "CLASSIFICATION_MISMATCH", "One ACTION goal cannot have dependencies.");
    const id = record(goal.intent) && nonempty(goal.intent.id) ? goal.intent.id : undefined;
    if (!id) return;
    if (byId.has(id)) add(`${path}.intent.id`, "DUPLICATE_INTENT_ID", "Intent IDs must be unique.");
    else byId.set(id, goal.dependsOn as string[]);
    if (new Set(goal.dependsOn).size !== goal.dependsOn.length) add(`${path}.dependsOn`, "DUPLICATE_DEPENDENCY", "Each dependency must occur once.");
    if (goal.dependsOn.includes(id)) add(`${path}.dependsOn`, "SELF_DEPENDENCY", "A goal cannot depend on itself.");
  });
  if (input.classification === "STRATEGY" && edgeCount === 0) add("plan.goals", "MISSING_COMPOSITION", "A strategy needs an explicit dependency edge.");
  for (const [id, dependencies] of byId) for (const dependency of dependencies) if (!byId.has(dependency)) add(`plan.goals[${id}].dependsOn`, "UNKNOWN_DEPENDENCY", "Dependency must reference a goal intent ID.");
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const found = (byId.get(id) ?? []).some((dependency) => byId.has(dependency) && cycle(dependency));
    visiting.delete(id); visited.add(id);
    return found;
  };
  if ([...byId.keys()].some(cycle)) add("plan.goals", "DEPENDENCY_CYCLE", "Goal dependencies contain a cycle.");
  return errors.length ? { valid: false, errors } : { valid: true, value: input as PlannerPlan };
}
