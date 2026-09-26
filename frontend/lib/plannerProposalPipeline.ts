import { classifyPlannerRequest, validatePlannerClassificationRequest, type PlannerSemanticClassifier } from "./plannerSemanticClassifier.ts";
import { generatePlannerPlan, type PlannerPlanGenerator } from "./plannerPlanGenerator.ts";
import { resolvePlannerParameters, type PlannerParameterResolver } from "./plannerParameterResolver.ts";
import { createPlannerProposal, type PlannerProposalReview } from "./plannerProposal.ts";
import { snapshotPlannerStrategyData } from "./plannerStrategyBinding.ts";

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
  const classified = await classifyPlannerRequest(request, services.classifier);
  if (!classified.ok) return { status: classified.error === "PROVIDER_UNAVAILABLE" ? "CLASSIFICATION_PROVIDER_UNAVAILABLE" : "CLASSIFICATION_INVALID_OUTPUT" };
  if (classified.classification.status !== "CLASSIFIED" || classified.classification.category === "INFORMATION") return { status: "NOT_APPLICABLE" };
  const generated = await generatePlannerPlan(request, classified.classification, services.generator);
  if (generated.status !== "GENERATED") return { status: generated.status === "PROVIDER_ERROR" ? "PLAN_PROVIDER_UNAVAILABLE" : generated.status === "INVALID_PLAN" && generated.errors.some((error) => error.code === "UNSUPPORTED_VERSION") ? "PLAN_UNSUPPORTED_VERSION" : "PLAN_INVALID" };
  const resolution = await resolvePlannerParameters(request, generated.plan, services.resolver);
  if (resolution.status !== "RESOLVED" && resolution.status !== "NEEDS_CLARIFICATION") return { status: resolution.status === "PROVIDER_ERROR" ? "PARAMETERS_PROVIDER_UNAVAILABLE" : "PARAMETERS_INVALID" };
  const proposal = createPlannerProposal({ requestId, sessionId: body.sessionId, proposalId, request, plan: generated.plan, resolution });
  return proposal ? { status: "PROPOSAL", proposal } : { status: "PROPOSAL_FAILED" };
}
