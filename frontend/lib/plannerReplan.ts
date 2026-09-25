import { validatePlannerPlan, type PlannerPlan } from "./plannerPlan.ts";
import { validatePlannerClassificationRequest, type PlannerClassificationRequest } from "./plannerSemanticClassifier.ts";
import type { PolicyDecision } from "./policyEngine.ts";
import type { StrategyRecoveryRecord } from "./strategyRecovery.ts";

export type ReplanTrigger =
  | Readonly<{ kind: "CHANGED_STATE"; impact: "NONE" | "PARAMETERS" | "AMBIGUOUS" | "GOAL_STRUCTURE"; affectedGoalId: string | null }>
  | Readonly<{ kind: "PARAMETERS_INVALIDATED"; affectedGoalId: string }>
  | Readonly<{ kind: "CAPABILITY_UNAVAILABLE"; impact: "AMBIGUOUS" | "GOAL_STRUCTURE"; affectedGoalId: string }>
  | Readonly<{ kind: "POLICY_STOP"; decision: Extract<PolicyDecision, "BLOCK" | "REQUOTE" | "REVALIDATE">; affectedGoalId: string }>
  | Readonly<{ kind: "EXECUTION_FAILURE"; submissionState: Extract<StrategyRecoveryRecord["event"], "PRE_SUBMISSION_FAILURE" | "SUBMISSION_OUTCOME_UNKNOWN" | "SUBMITTED">; impact: "NONE" | "PARAMETERS" | "AMBIGUOUS" | "GOAL_STRUCTURE"; affectedGoalId: string }>;

export type PlannerReplanInput = Readonly<{ version: 1; request: PlannerClassificationRequest; plan: PlannerPlan; trigger: ReplanTrigger }>;
export type PlannerReplanResult =
  | Readonly<{ status: "NO_REPLAN_REQUIRED" | "RE_RESOLVE_PARAMETERS" | "NEEDS_CLARIFICATION"; planId: string; affectedGoalId: string | null }>
  | Readonly<{ status: "REPLAN_REQUIRED"; originalPlanId: string; plan: PlannerPlan }>
  | Readonly<{ status: "INVALID_INPUT" | "UNSUPPORTED"; reason: string }>
  | Readonly<{ status: "PROVIDER_ERROR" }>;

/** A provider proposes only an 11C graph. It cannot authorize a transaction or recover an attempt. */
export interface PlannerReplanGenerator { generate(input: PlannerReplanInput): Promise<unknown> }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
const keys = (value: Record<string, unknown>, required: readonly string[]) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).length === required.length;
const among = (value: unknown, options: readonly string[]): boolean => typeof value === "string" && options.includes(value);

function validateTrigger(value: unknown, plan: PlannerPlan): ReplanTrigger | undefined {
  if (!record(value) || typeof value.kind !== "string") return undefined;
  const affected = value.affectedGoalId;
  if (affected !== null && (typeof affected !== "string" || !plan.goals.some((goal) => goal.id === affected))) return undefined;
  if (value.kind === "CHANGED_STATE" && keys(value, ["kind", "impact", "affectedGoalId"]) && among(value.impact, ["NONE", "PARAMETERS", "AMBIGUOUS", "GOAL_STRUCTURE"])) return value as ReplanTrigger;
  if (typeof affected !== "string") return undefined;
  if (value.kind === "PARAMETERS_INVALIDATED" && keys(value, ["kind", "affectedGoalId"])) return value as ReplanTrigger;
  if (value.kind === "CAPABILITY_UNAVAILABLE" && keys(value, ["kind", "impact", "affectedGoalId"]) && among(value.impact, ["AMBIGUOUS", "GOAL_STRUCTURE"])) return value as ReplanTrigger;
  if (value.kind === "POLICY_STOP" && keys(value, ["kind", "decision", "affectedGoalId"]) && among(value.decision, ["BLOCK", "REQUOTE", "REVALIDATE"])) return value as ReplanTrigger;
  if (value.kind === "EXECUTION_FAILURE" && keys(value, ["kind", "submissionState", "impact", "affectedGoalId"]) && among(value.submissionState, ["PRE_SUBMISSION_FAILURE", "SUBMISSION_OUTCOME_UNKNOWN", "SUBMITTED"]) && among(value.impact, ["NONE", "PARAMETERS", "AMBIGUOUS", "GOAL_STRUCTURE"])) return value as ReplanTrigger;
  return undefined;
}

export function validatePlannerReplanInput(value: unknown): PlannerReplanInput | undefined {
  if (!record(value) || !keys(value, ["version", "request", "plan", "trigger"]) || value.version !== 1 || !record(value.request)) return undefined;
  const request = validatePlannerClassificationRequest(value.request);
  const checked = validatePlannerPlan(value.plan);
  if (!request || !checked.valid) return undefined;
  const trigger = validateTrigger(value.trigger, checked.value);
  if (!trigger) return undefined;
  const plan = Object.freeze({ ...checked.value, goals: Object.freeze(checked.value.goals.map((goal) => Object.freeze({ ...goal, dependsOn: Object.freeze([...goal.dependsOn]) }))) });
  return Object.freeze({ version: 1, request, plan, trigger: Object.freeze({ ...trigger }) });
}

const sameGoals = (oldPlan: PlannerPlan, proposed: PlannerPlan) => oldPlan.goals.length === proposed.goals.length && proposed.goals.every((goal) => oldPlan.goals.some((previous) => previous.id === goal.id && previous.kind === goal.kind));
const sameGraph = (oldPlan: PlannerPlan, proposed: PlannerPlan) => proposed.goals.every((goal) => {
  const old = oldPlan.goals.find((item) => item.id === goal.id)!;
  return old.dependsOn.length === goal.dependsOn.length && old.dependsOn.every((id) => goal.dependsOn.includes(id));
});

/** Semantic advice only. The caller must acquire and validate real change evidence; 10F and Phase 9 retain authority. */
export async function evaluatePlannerReplan(value: unknown, generator: PlannerReplanGenerator): Promise<PlannerReplanResult> {
  const input = validatePlannerReplanInput(value);
  if (!input) return { status: "INVALID_INPUT", reason: "REPLAN_INPUT" };
  const { plan, trigger } = input;
  const affectedGoalId = trigger.affectedGoalId;
  if (trigger.kind === "POLICY_STOP") return trigger.decision === "BLOCK"
    ? { status: "UNSUPPORTED", reason: "POLICY_BLOCK" }
    : { status: "NO_REPLAN_REQUIRED", planId: plan.id, affectedGoalId };
  if (trigger.kind === "EXECUTION_FAILURE" && trigger.submissionState !== "PRE_SUBMISSION_FAILURE") return { status: "UNSUPPORTED", reason: "PHASE_10F_RECOVERY_REQUIRED" };
  if (trigger.kind === "CAPABILITY_UNAVAILABLE" && trigger.impact === "GOAL_STRUCTURE") return { status: "UNSUPPORTED", reason: "CAPABILITY_REQUIRES_USER_DECISION" };
  if (trigger.kind === "PARAMETERS_INVALIDATED") return { status: "RE_RESOLVE_PARAMETERS", planId: plan.id, affectedGoalId };
  const impact = trigger.impact;
  if (impact === "NONE") return { status: "NO_REPLAN_REQUIRED", planId: plan.id, affectedGoalId };
  if (impact === "PARAMETERS") return { status: "RE_RESOLVE_PARAMETERS", planId: plan.id, affectedGoalId };
  if (impact === "AMBIGUOUS") return { status: "NEEDS_CLARIFICATION", planId: plan.id, affectedGoalId };
  // ACTION has no alterable 11C graph. A new goal kind or ID needs fresh user intent, not model invention.
  if (plan.classification !== "STRATEGY") return { status: "UNSUPPORTED", reason: "NO_AUTHORIZED_GRAPH_CHANGE" };
  let output: unknown;
  try { output = await generator.generate(input); }
  catch { return { status: "PROVIDER_ERROR" }; }
  const checked = validatePlannerPlan(output, plan.classification);
  if (!checked.valid || !sameGoals(plan, checked.value) || sameGraph(plan, checked.value) || checked.value.id === plan.id) return { status: "UNSUPPORTED", reason: "INVALID_REPLACEMENT_PLAN" };
  const proposed = Object.freeze({ ...checked.value, goals: Object.freeze(checked.value.goals.map((goal) => Object.freeze({ ...goal, dependsOn: Object.freeze([...goal.dependsOn]) }))) });
  return { status: "REPLAN_REQUIRED", originalPlanId: plan.id, plan: proposed };
}
