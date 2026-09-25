import assert from "node:assert/strict";
import test from "node:test";
import { createPlannerParameterEvidence } from "./plannerParameterEvidence.ts";
import { compilePlannerStrategy } from "./plannerStrategyCompiler.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function source() {
  const plan = { version: 1, id: "plan-1", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] as string[] }] };
  const resolution = { status: "RESOLVED", planId: plan.id, intents: [
    { version: 1, id: "send", kind: "SEND", chainId: 5042002, asset: "eurc", amount: "10", recipient },
  ] };
  const retained = { requestId: "request-1", sessionId: "session-1", request: { text: `Send 10 EURC to ${recipient}` },
    plan, resolution, structuredInput: null };
  return { version: 2, requestId: retained.requestId, sessionId: retained.sessionId, createdAt: 1000,
    plan, resolution, provenanceSource: retained };
}
function rejected(value: unknown, reason: string) {
  assert.deepEqual(compilePlannerStrategy(value), { status: "REJECTED", reason });
}

test("legacy v1 compiler input and legacy RESOLVED result cannot bypass field provenance", () => {
  const value = source();
  rejected({ ...value, version: 1 }, "UNSUPPORTED_VERSION");
  rejected(value, "MISSING_PARAMETER_EVIDENCE");
});

test("free-text-only v2 result cannot compile even a valid fixed Send intent", () => {
  const value = source();
  const made = createPlannerParameterEvidence(value.provenanceSource);
  assert.equal(made.valid, true);
  if (made.valid) rejected({ ...value, resolution: made.value }, "MISSING_PARAMETER_EVIDENCE");
});

test("caller supplied fixed-origin result without an authoritative source fails closed", () => {
  const value = source();
  const forged = { status: "RESOLVED_WITH_EVIDENCE", version: 2, planId: value.plan.id,
    intents: value.resolution.intents, evidence: [], evidenceDigest: `0x${"0".repeat(64)}` };
  rejected({ ...value, resolution: forged }, "INVALID_PARAMETER_EVIDENCE");
});

test("dynamic, missing and unsupported parameter results cannot create partial skeletons", () => {
  const value = source();
  rejected({ ...value, resolution: { status: "NEEDS_CLARIFICATION", issues: [{ goalId: "send", field: "amount", code: "DYNAMIC_AMOUNT" }] } },
    "DYNAMIC_VALUE_DEPENDENCY_UNSUPPORTED");
  rejected({ ...value, resolution: { status: "NEEDS_CLARIFICATION", issues: [{ goalId: "send", field: "amount", code: "MISSING" }] } },
    "UNRESOLVED_PARAMETER");
  rejected({ ...value, resolution: { status: "INVALID_PARAMETERS", issues: [] } }, "UNRESOLVED_PARAMETER");
});

test("plan graph and identity validation precede any provenance claim", () => {
  const value = source();
  const duplicate = copy(value); duplicate.plan.classification = "STRATEGY"; duplicate.plan.goals.push(copy(duplicate.plan.goals[0]));
  rejected(duplicate, "DUPLICATE_GOAL_ID");
  const unknown = copy(value); unknown.plan.goals[0].dependsOn = ["other"];
  rejected(unknown, "INVALID_PLAN");
  const mismatch = copy(value); mismatch.resolution.planId = "other";
  rejected(mismatch, "MISSING_PARAMETER_EVIDENCE");
});

test("extra authority fields and unsupported versions reject", () => {
  const value = source();
  rejected({ ...value, signer: true }, "UNEXPECTED_FIELD");
  rejected({ ...value, wallet: true }, "UNEXPECTED_FIELD");
  rejected({ ...value, version: 3 }, "UNSUPPORTED_VERSION");
});

test("malformed runtime values, symbols, accessors, prototypes and proxies reject", () => {
  for (const value of [null, [], 1, "input"]) rejected(value, "INVALID_SCHEMA");
  rejected(undefined, "INVALID_RUNTIME");
  const symbol = source(); Object.defineProperty(symbol, Symbol("hidden"), { value: true });
  rejected(symbol, "INVALID_RUNTIME");
  const getter = source(); Object.defineProperty(getter, "requestId", { enumerable: true, get() { throw Error("getter"); } });
  rejected(getter, "INVALID_RUNTIME");
  const proxy = new Proxy(source(), { getPrototypeOf() { throw Error("proxy"); } });
  rejected(proxy, "INVALID_RUNTIME");
  const prototype = Object.assign(Object.create({ trusted: true }) as object, source());
  rejected(prototype, "INVALID_RUNTIME");
});

test("createdAt is structural and cannot act as a provenance or freshness override", () => {
  const value = source();
  for (const createdAt of [0, Number.MAX_SAFE_INTEGER]) rejected({ ...value, createdAt }, "MISSING_PARAMETER_EVIDENCE");
  for (const createdAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) rejected({ ...value, createdAt }, "INVALID_CREATED_AT");
  rejected({ ...value, createdAt: Number.NaN }, "INVALID_RUNTIME");
});

test("input mutation cannot turn unverified provenance into a compiled result", () => {
  const value = source();
  const made = createPlannerParameterEvidence(value.provenanceSource);
  assert.equal(made.valid, true);
  if (!made.valid) return;
  const before = { ...value, resolution: made.value };
  rejected(before, "MISSING_PARAMETER_EVIDENCE");
  const after = copy(before) as unknown as Record<string, unknown>;
  (after.resolution as Record<string, unknown>).status = "RESOLVED_WITH_EVIDENCE";
  rejected(after, "PLAN_RESULT_MISMATCH");
});
