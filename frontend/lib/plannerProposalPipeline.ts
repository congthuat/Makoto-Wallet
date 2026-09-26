import { classifyPlannerRequest, validatePlannerClassificationRequest, type PlannerSemanticClassifier } from "./plannerSemanticClassifier.ts";
import { generatePlannerPlan, type PlannerPlanGenerator } from "./plannerPlanGenerator.ts";
import { resolvePlannerParameters, type PlannerParameterResolver } from "./plannerParameterResolver.ts";
import { createPlannerProposal, type PlannerProposalReview } from "./plannerProposal.ts";
import { snapshotPlannerStrategyData } from "./plannerStrategyBinding.ts";
import { validatePlannerPlan } from "./plannerPlan.ts";

export type PlannerProposalResult = Readonly<{ status: "PROPOSAL"; proposal: PlannerProposalReview }> |
  Readonly<{ status: "INVALID_REQUEST" | "CLASSIFICATION_PROVIDER_UNAVAILABLE" | "CLASSIFICATION_INVALID_OUTPUT" | "NOT_APPLICABLE" |
    "PLAN_PROVIDER_UNAVAILABLE" | "PLAN_INVALID" | "PLAN_UNSUPPORTED_VERSION" | "PARAMETERS_PROVIDER_UNAVAILABLE" |
    "PARAMETERS_INVALID" | "PROPOSAL_FAILED" }>;
export type PlannerProposalServices = Readonly<{ classifier: PlannerSemanticClassifier; generator: PlannerPlanGenerator; resolver: PlannerParameterResolver; newId: () => string }>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function runPlannerProposal(input: unknown, services: PlannerProposalServices): Promise<PlannerProposalResult> {
  const copy = snapshotPlannerStrategyData(input);
  if (!copy.valid || !copy.value || typeof copy.value !== "object" || Array.isArray(copy.value)) return { status: "INVALID_REQUEST" };
  const body = copy.value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["text", "locale", "sessionId"].sort()) ||
    typeof body.sessionId !== "string" || !ID.test(body.sessionId)) return { status: "INVALID_REQUEST" };
  const request = validatePlannerClassificationRequest({ text: body.text, locale: body.locale });
  if (!request) return { status: "INVALID_REQUEST" };
  let requestId: string, proposalId: string;
  try { requestId = services.newId(); proposalId = services.newId(); } catch { return { status: "PROPOSAL_FAILED" }; }
  if (!ID.test(requestId) || !ID.test(proposalId) || requestId === proposalId) return { status: "PROPOSAL_FAILED" };
  let classified: Awaited<ReturnType<typeof classifyPlannerRequest>>;
  try { classified = await classifyPlannerRequest(request, services.classifier); }
  catch { return { status: "CLASSIFICATION_INVALID_OUTPUT" }; }
  if (!classified.ok) return { status: classified.error === "PROVIDER_UNAVAILABLE" ? "CLASSIFICATION_PROVIDER_UNAVAILABLE" : "CLASSIFICATION_INVALID_OUTPUT" };
  if (classified.classification.status !== "CLASSIFIED" || classified.classification.category === "INFORMATION") return { status: "NOT_APPLICABLE" };
  const classification = Object.freeze({ status: "CLASSIFIED" as const, category: classified.classification.category });
  let generated: Awaited<ReturnType<typeof generatePlannerPlan>>;
  try { generated = await generatePlannerPlan(request, classification, services.generator); }
  catch { return { status: "PLAN_INVALID" }; }
  if (generated.status !== "GENERATED") return { status: generated.status === "PROVIDER_ERROR" ? "PLAN_PROVIDER_UNAVAILABLE" : generated.status === "INVALID_PLAN" && generated.errors.some((error) => error.code === "UNSUPPORTED_VERSION") ? "PLAN_UNSUPPORTED_VERSION" : "PLAN_INVALID" };
  const planCopy = snapshotPlannerStrategyData(generated.plan);
  if (!planCopy.valid) return { status: "PLAN_INVALID" };
  const checkedPlan = validatePlannerPlan(planCopy.value, classification.category);
  if (!checkedPlan.valid) return { status: "PLAN_INVALID" };
  const plan = Object.freeze({ ...checkedPlan.value, goals: Object.freeze(checkedPlan.value.goals.map((goal) =>
    Object.freeze({ ...goal, dependsOn: Object.freeze([...goal.dependsOn]) }))) });
  let resolution: Awaited<ReturnType<typeof resolvePlannerParameters>>;
  try { resolution = await resolvePlannerParameters(request, plan, services.resolver); }
  catch { return { status: "PARAMETERS_INVALID" }; }
  if (resolution.status !== "RESOLVED" && resolution.status !== "NEEDS_CLARIFICATION") return { status: resolution.status === "PROVIDER_ERROR" ? "PARAMETERS_PROVIDER_UNAVAILABLE" : "PARAMETERS_INVALID" };
  const proposal = createPlannerProposal({ requestId, sessionId: body.sessionId, proposalId, request, plan, resolution });
  return proposal ? { status: "PROPOSAL", proposal } : { status: "PROPOSAL_FAILED" };
}
