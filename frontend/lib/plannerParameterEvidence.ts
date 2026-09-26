import { keccak256, stringToHex, type Hex } from "viem";
import { validatePlannerIntent, type PlannerIntent } from "./plannerIntent.ts";
import { validatePlannerPlan, type PlannerPlan } from "./plannerPlan.ts";
import { validatePlannerClassificationRequest, type PlannerClassificationRequest } from "./plannerSemanticClassifier.ts";
import { snapshotPlannerStrategyData } from "./plannerStrategyBinding.ts";
import { isLiveConfirmedPlannerSource } from "./plannerConfirmationAuthority.ts";

/** A host-retained structured user event, created only by the B2 confirmation control. */
export type PlannerStructuredInput = Readonly<{ version: 1; eventId: string; requestId: string; sessionId: string;
  requestDigest: Hex; planId: string; planDigest: Hex; proposalId: string; proposalDigest: Hex;
  fields: readonly Readonly<{ goalId: string; parameterKey: string; value: string | number }>[] }>;
export type PlannerEvidenceSource = Readonly<{ requestId: string; sessionId: string; request: PlannerClassificationRequest;
  plan: PlannerPlan; resolution: unknown; structuredInput: PlannerStructuredInput | null }>;
export type ResolvedParameterEvidence = Readonly<{ version: 1; requestId: string; sessionId: string;
  requestDigest: Hex; planId: string; planDigest: Hex; proposalId: string; proposalDigest: Hex; goalId: string; parameterKey: string;
  state: "FIXED"; value: string | number; origin: "FIXED_USER_INPUT";
  source: Readonly<{ kind: "USER_EVENT"; eventId: string; eventDigest: Hex }>; digest: Hex }>;
export type NonfixedParameterEvidence = Readonly<{ version: 1; requestId: string; sessionId: string;
  requestDigest: Hex; planId: string; planDigest: Hex; goalId: string; parameterKey: string;
  state: "NONFIXED"; origin: "DYNAMIC_EXPRESSION" | "UNVERIFIED";
  expressionClass: "OTHER_DYNAMIC" | "UNKNOWN"; sourceGoalId: string | null; digest: Hex }>;
export type PlannerProvenanceResolution =
  | Readonly<{ status: "RESOLVED_WITH_EVIDENCE"; version: 2; planId: string; intents: readonly PlannerIntent[];
      evidence: readonly ResolvedParameterEvidence[]; evidenceDigest: Hex }>
  | Readonly<{ status: "UNVERIFIED"; version: 2; evidence: readonly NonfixedParameterEvidence[] }>;
export type PlannerEvidenceResult = Readonly<{ valid: true; value: PlannerProvenanceResolution }> |
  Readonly<{ valid: false; reason: "INVALID_RUNTIME" | "INVALID_SOURCE" | "UNVERIFIED" | "PROVENANCE_MISMATCH" }>;

type Data = Record<string, unknown>;
const object = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Data, fields: readonly string[]) => Reflect.ownKeys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hash = (kind: string, value: unknown): Hex => keccak256(stringToHex(JSON.stringify(["makoto.planner-parameter-evidence", 1, kind, value])));
const keysFor = (kind: PlannerIntent["kind"]): readonly string[] => kind === "SEND"
  ? ["asset", "amount", "recipient", "chainId"] : kind === "SWAP"
    ? ["fromAsset", "toAsset", "amount", "chainId"]
    : ["asset", "amount", "recipient", "sourceChainId", "destinationChainId"];
const fieldValue = (intent: PlannerIntent, key: string): string | number => (intent as unknown as Record<string, string | number>)[key];
const planHash = (plan: PlannerPlan) => hash("PLAN", [plan.version, plan.id, plan.classification,
  [...plan.goals].sort((a, b) => compare(a.id, b.id)).map((goal) => [goal.id, goal.kind, [...goal.dependsOn].sort(compare)])]);
export const plannerParameterRequestDigest = (requestId: string, sessionId: string, request: PlannerClassificationRequest): Hex =>
  hash("REQUEST", [requestId, sessionId, request.text, request.locale ?? null]);
export const plannerParameterPlanDigest = (plan: PlannerPlan): Hex => planHash(plan);
const evidenceHash = (item: Omit<ResolvedParameterEvidence, "digest"> | Omit<NonfixedParameterEvidence, "digest">) => hash("FIELD", item.state === "FIXED"
  ? [item.version, item.requestId, item.sessionId, item.requestDigest, item.planId, item.planDigest, item.goalId,
      item.parameterKey, item.state, item.value, item.origin, item.proposalId, item.proposalDigest,
      item.source.kind, item.source.eventId, item.source.eventDigest]
  : [item.version, item.requestId, item.sessionId, item.requestDigest, item.planId, item.planDigest, item.goalId,
      item.parameterKey, item.state, item.origin, item.expressionClass, item.sourceGoalId]);

/** Fixed evidence requires a live source registered by the B2 confirmation control. */
export function createPlannerParameterEvidence(sourceInput: unknown): PlannerEvidenceResult {
  try {
    const captured = snapshotPlannerStrategyData(sourceInput);
    if (!captured.valid) return { valid: false, reason: "INVALID_RUNTIME" };
    const source = captured.value;
    if (!object(source) || !exact(source, ["requestId", "sessionId", "request", "plan", "resolution", "structuredInput"]) ||
      !id(source.requestId) || !id(source.sessionId)) return { valid: false, reason: "INVALID_SOURCE" };
    const request = validatePlannerClassificationRequest(source.request);
    const checkedPlan = validatePlannerPlan(source.plan);
    if (!request || !checkedPlan.valid || !exact(source.request as Data, Object.keys(request)) ||
      (source.request as Data).text !== request.text || !id(checkedPlan.value.id) ||
      checkedPlan.value.goals.some((goal) => !id(goal.id) || goal.dependsOn.some((dep) => !id(dep)))) return { valid: false, reason: "INVALID_SOURCE" };
    const plan = checkedPlan.value;
    const resolution = source.resolution;
    if (!object(resolution) || !exact(resolution, ["status", "planId", "intents"]) || resolution.status !== "RESOLVED" ||
      resolution.planId !== plan.id || !Array.isArray(resolution.intents) || resolution.intents.length !== plan.goals.length) return { valid: false, reason: "INVALID_SOURCE" };
    const intents: PlannerIntent[] = [];
    for (const raw of resolution.intents) {
      const checked = validatePlannerIntent(raw);
      if (!checked.valid || !plan.goals.some((goal) => goal.id === checked.value.id && goal.kind === checked.value.kind) ||
        intents.some((intent) => intent.id === checked.value.id)) return { valid: false, reason: "INVALID_SOURCE" };
      intents.push(checked.value);
    }
    const requestDigest = plannerParameterRequestDigest(source.requestId, source.sessionId, request);
    const planDigest = planHash(plan);
    const event = source.structuredInput;
    const allFields = intents.flatMap((intent) => keysFor(intent.kind).map((parameterKey) => ({ goalId: intent.id, parameterKey, value: fieldValue(intent, parameterKey) })))
      .sort((a, b) => compare(`${a.goalId}:${a.parameterKey}`, `${b.goalId}:${b.parameterKey}`));
    if (event === null) {
      const evidence = allFields.map((field): NonfixedParameterEvidence => {
        const base = { version: 1 as const, requestId: source.requestId as string, sessionId: source.sessionId as string,
          requestDigest, planId: plan.id, planDigest, goalId: field.goalId, parameterKey: field.parameterKey,
          state: "NONFIXED" as const, origin: "UNVERIFIED" as const, expressionClass: "UNKNOWN" as const, sourceGoalId: null };
        return { ...base, digest: evidenceHash(base) };
      });
      return { valid: true, value: { status: "UNVERIFIED", version: 2, evidence } };
    }
    // The serializable event is inert without the exact live source registered by the owned UI control.
    if (!isLiveConfirmedPlannerSource(sourceInput) || !object(event) ||
      !exact(event, ["version", "eventId", "requestId", "sessionId", "requestDigest", "planId", "planDigest", "proposalId", "proposalDigest", "fields"]) ||
      event.version !== 1 || !id(event.eventId) || !id(event.proposalId) ||
      typeof event.proposalDigest !== "string" || !/^0x[0-9a-f]{64}$/.test(event.proposalDigest) ||
      event.requestId !== source.requestId || event.sessionId !== source.sessionId || event.requestDigest !== requestDigest ||
      event.planId !== plan.id || event.planDigest !== planDigest || !Array.isArray(event.fields) ||
      event.fields.length !== allFields.length) return { valid: false, reason: "UNVERIFIED" };
    const eventFields = event.fields.map((field) => {
      if (!object(field) || !exact(field, ["goalId", "parameterKey", "value"])) throw Error("invalid field");
      return field;
    }).sort((a, b) => compare(`${a.goalId}:${a.parameterKey}`, `${b.goalId}:${b.parameterKey}`));
    if (JSON.stringify(eventFields.map((field) => [field.goalId, field.parameterKey, field.value])) !==
      JSON.stringify(allFields.map((field) => [field.goalId, field.parameterKey, field.value]))) return { valid: false, reason: "PROVENANCE_MISMATCH" };
    const eventDigest = hash("USER_EVENT", [event.version, event.eventId, event.requestId, event.sessionId,
      event.requestDigest, event.planId, event.planDigest, event.proposalId, event.proposalDigest,
      eventFields.map((field) => [field.goalId, field.parameterKey, field.value])]);
    const evidence = allFields.map((field): ResolvedParameterEvidence => {
      const base = { version: 1 as const, requestId: source.requestId as string, sessionId: source.sessionId as string,
        requestDigest, planId: plan.id, planDigest, proposalId: event.proposalId as string, proposalDigest: event.proposalDigest as Hex,
        goalId: field.goalId, parameterKey: field.parameterKey, state: "FIXED" as const, value: field.value,
        origin: "FIXED_USER_INPUT" as const, source: { kind: "USER_EVENT" as const, eventId: event.eventId as string, eventDigest } };
      return { ...base, digest: evidenceHash(base) };
    });
    return { valid: true, value: { status: "RESOLVED_WITH_EVIDENCE", version: 2, planId: plan.id,
      intents, evidence, evidenceDigest: hash("SET", evidence.map((item) => item.digest)) } };
  } catch { return { valid: false, reason: "INVALID_RUNTIME" }; }
}

/** A recognized 11D dynamic issue stays nonfixed and carries no provider numeric fallback. */
export function createDynamicPlannerParameterEvidence(sourceInput: unknown, goalId: string): PlannerEvidenceResult {
  try {
    const captured = snapshotPlannerStrategyData(sourceInput);
    if (!captured.valid) return { valid: false, reason: "INVALID_RUNTIME" };
    const source = captured.value;
    if (!object(source) || !exact(source, ["requestId", "sessionId", "request", "plan"]) ||
      !id(source.requestId) || !id(source.sessionId)) return { valid: false, reason: "INVALID_SOURCE" };
    const request = validatePlannerClassificationRequest(source.request);
    const checked = validatePlannerPlan(source.plan);
    if (!request || !checked.valid || !id(checked.value.id) || !checked.value.goals.some((goal) => goal.id === goalId))
      return { valid: false, reason: "INVALID_SOURCE" };
    const base = { version: 1 as const, requestId: source.requestId, sessionId: source.sessionId,
      requestDigest: plannerParameterRequestDigest(source.requestId, source.sessionId, request), planId: checked.value.id,
      planDigest: planHash(checked.value), goalId, parameterKey: "amount", state: "NONFIXED" as const,
      origin: "DYNAMIC_EXPRESSION" as const, expressionClass: "OTHER_DYNAMIC" as const, sourceGoalId: null };
    return { valid: true, value: { status: "UNVERIFIED", version: 2, evidence: [{ ...base, digest: evidenceHash(base) }] } };
  } catch { return { valid: false, reason: "INVALID_RUNTIME" }; }
}

/** Recompute against separately retained host evidence; supplied digests and origins have no authority alone. */
export function validatePlannerParameterEvidence(resultInput: unknown, sourceInput: unknown): PlannerEvidenceResult {
  const captured = snapshotPlannerStrategyData(resultInput);
  if (!captured.valid) return { valid: false, reason: "INVALID_RUNTIME" };
  const expected = createPlannerParameterEvidence(sourceInput);
  if (!expected.valid) return expected;
  const actual = captured.value;
  if (!object(actual) || !exact(actual, expected.value.status === "RESOLVED_WITH_EVIDENCE"
    ? ["status", "version", "planId", "intents", "evidence", "evidenceDigest"] : ["status", "version", "evidence"])) return { valid: false, reason: "PROVENANCE_MISMATCH" };
  // Both sides are descriptor-safe plain data. Exact serialization also rejects nested extras, symbols and changed order.
  if (JSON.stringify(actual) !== JSON.stringify(expected.value)) return { valid: false, reason: "PROVENANCE_MISMATCH" };
  return expected;
}
