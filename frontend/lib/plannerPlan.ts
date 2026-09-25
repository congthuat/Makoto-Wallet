/** 11C describes user-goal kinds and dependencies; 11D resolves PlannerIntent fields. */
export type PlannerGoalKind = "SEND" | "SWAP" | "BRIDGE";
export type PlannerGoal = Readonly<{ id: string; kind: PlannerGoalKind; dependsOn: readonly string[] }>;
export type PlannerPlan = Readonly<{
  version: 1;
  id: string;
  classification: "ACTION" | "STRATEGY";
  goals: readonly PlannerGoal[];
}>;

export type PlannerPlanValidationCode = "INVALID_SCHEMA" | "UNSUPPORTED_VERSION" | "INVALID_ID" | "INVALID_CLASSIFICATION" | "CLASSIFICATION_MISMATCH" | "INVALID_GOAL_COUNT" | "MISSING_COMPOSITION" | "INVALID_GOAL_KIND" | "DUPLICATE_GOAL_ID" | "DUPLICATE_DEPENDENCY" | "SELF_DEPENDENCY" | "UNKNOWN_DEPENDENCY" | "DEPENDENCY_CYCLE";
export type PlannerPlanValidationIssue = Readonly<{ path: string; code: PlannerPlanValidationCode; message: string }>;
export type PlannerPlanValidationResult =
  | Readonly<{ valid: true; value: PlannerPlan }>
  | Readonly<{ valid: false; errors: readonly PlannerPlanValidationIssue[] }>;

type Data = Record<string, unknown>;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
const keys = (value: Data, required: readonly string[]) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).length === required.length;
const denseArray = (value: unknown): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Object.keys(value).length === value.length && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index))!, "value")).every(Boolean);

/** Graph validity only. Resolved fields and transaction safety belong to later boundaries. */
export function validatePlannerPlan(input: unknown, expectedClassification?: "ACTION" | "STRATEGY"): PlannerPlanValidationResult {
  const errors: PlannerPlanValidationIssue[] = [];
  const add = (path: string, code: PlannerPlanValidationCode, message: string) => errors.push({ path, code, message });
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
    if (!record(goal) || !keys(goal, ["id", "kind", "dependsOn"])) { add(path, "INVALID_SCHEMA", "Goal must contain only ID, kind, and dependencies."); return; }
    if (goal.kind !== "SEND" && goal.kind !== "SWAP" && goal.kind !== "BRIDGE") add(`${path}.kind`, "INVALID_GOAL_KIND", "Unsupported user-goal kind.");
    if (!nonempty(goal.id)) add(`${path}.id`, "INVALID_ID", "Goal ID is required.");
    if (!denseArray(goal.dependsOn) || goal.dependsOn.length > 32 || goal.dependsOn.some((dependency) => !nonempty(dependency))) {
      add(`${path}.dependsOn`, "INVALID_SCHEMA", "Dependencies must be a bounded array of goal IDs.");
      return;
    }
    edgeCount += goal.dependsOn.length;
    if (input.classification === "ACTION" && goal.dependsOn.length) add(`${path}.dependsOn`, "CLASSIFICATION_MISMATCH", "One ACTION goal cannot have dependencies.");
    if (!nonempty(goal.id)) return;
    if (byId.has(goal.id)) add(`${path}.id`, "DUPLICATE_GOAL_ID", "Goal IDs must be unique.");
    else byId.set(goal.id, goal.dependsOn as string[]);
    if (new Set(goal.dependsOn).size !== goal.dependsOn.length) add(`${path}.dependsOn`, "DUPLICATE_DEPENDENCY", "Each dependency must occur once.");
    if (goal.dependsOn.includes(goal.id)) add(`${path}.dependsOn`, "SELF_DEPENDENCY", "A goal cannot depend on itself.");
  });
  if (input.classification === "STRATEGY" && edgeCount === 0) add("plan.goals", "MISSING_COMPOSITION", "A strategy needs an explicit dependency edge.");
  for (const [id, dependencies] of byId) for (const dependency of dependencies) if (!byId.has(dependency)) add(`plan.goals[${id}].dependsOn`, "UNKNOWN_DEPENDENCY", "Dependency must reference a goal ID.");
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
