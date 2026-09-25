import { validatePlannerRequestClassification } from "./plannerRequestClassification.ts";
import { validatePlannerClassificationRequest, type PlannerClassificationRequest } from "./plannerSemanticClassifier.ts";
import { validatePlannerPlan, type PlannerPlan, type PlannerPlanValidationIssue } from "./plannerPlan.ts";

export type PlannerPlanGenerationRequest = PlannerClassificationRequest & Readonly<{ classification: "ACTION" | "STRATEGY" }>;
/** Provider-specific transport stays behind this port; its output is untrusted. */
export interface PlannerPlanGenerator {
  generate(request: PlannerPlanGenerationRequest): Promise<unknown>;
}
export type PlannerPlanGenerationResult =
  | Readonly<{ status: "GENERATED"; plan: PlannerPlan }>
  | Readonly<{ status: "NOT_APPLICABLE" }>
  | Readonly<{ status: "INVALID_PLAN"; errors: readonly PlannerPlanValidationIssue[] }>
  | Readonly<{ status: "PROVIDER_ERROR" }>;

/** Classification and request validation happen before any provider invocation. */
export async function generatePlannerPlan(
  input: unknown,
  classification: unknown,
  generator: PlannerPlanGenerator,
): Promise<PlannerPlanGenerationResult> {
  const checked = validatePlannerRequestClassification(classification);
  if (!checked.valid || checked.value.status !== "CLASSIFIED" ||
    (checked.value.category !== "ACTION" && checked.value.category !== "STRATEGY")) return { status: "NOT_APPLICABLE" };
  const request = validatePlannerClassificationRequest(input);
  if (!request) return { status: "NOT_APPLICABLE" };
  const category = checked.value.category;
  let output: unknown;
  try { output = await generator.generate({ ...request, classification: category }); }
  catch { return { status: "PROVIDER_ERROR" }; }
  const validated = validatePlannerPlan(output, category);
  return validated.valid
    ? { status: "GENERATED", plan: validated.value }
    : { status: "INVALID_PLAN", errors: validated.errors };
}
