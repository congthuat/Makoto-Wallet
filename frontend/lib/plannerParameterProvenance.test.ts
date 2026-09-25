import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlannerParameters, resolvePlannerParametersWithEvidence } from "./plannerParameterResolver.ts";
import { compilePlannerStrategy } from "./plannerStrategyCompiler.ts";
import { createPlannerParameterEvidence, plannerParameterPlanDigest, plannerParameterRequestDigest,
  validatePlannerParameterEvidence } from "./plannerParameterEvidence.ts";
import { validatePlannerStrategyBinding } from "./plannerStrategyBinding.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const plan = { version: 1, id: "plan-1", classification: "STRATEGY", goals: [
  { id: "swap", kind: "SWAP", dependsOn: [] },
  { id: "send", kind: "SEND", dependsOn: ["swap"] },
] };
const draft = (goalId: string, fields: Record<string, string | null>) => ({ goalId, chain: null, asset: null, amount: null, recipient: null,
  fromAsset: null, toAsset: null, sourceChain: null, destinationChain: null, ...fields });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function source() {
  const requestId = "request-1", sessionId = "session-1";
  const sendPlan = { version: 1, id: "send-plan", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] }] };
  const resolution = { status: "RESOLVED", planId: "send-plan", intents: [
    { version: 1, id: "send", kind: "SEND", chainId: 5042002, asset: "eurc", amount: "10", recipient },
  ] };
  const fields = [
    { goalId: "send", parameterKey: "asset", value: "eurc" },
    { goalId: "send", parameterKey: "amount", value: "10" },
    { goalId: "send", parameterKey: "recipient", value: recipient },
    { goalId: "send", parameterKey: "chainId", value: 5042002 },
  ];
  return { requestId, sessionId, request: { text: `Send 10 EURC to ${recipient}` }, plan: sendPlan,
    resolution, structuredInput: { version: 1, eventId: "event-1", requestId, sessionId,
      requestDigest: plannerParameterRequestDigest(requestId, sessionId, { text: `Send 10 EURC to ${recipient}` }),
      planId: sendPlan.id, planDigest: plannerParameterPlanDigest(sendPlan as Parameters<typeof plannerParameterPlanDigest>[0]), fields } };
}
function confirmed() {
  const retained = source();
  const made = createPlannerParameterEvidence(retained);
  assert.equal(made.valid, true, JSON.stringify(made));
  if (!made.valid || made.value.status !== "RESOLVED_WITH_EVIDENCE") throw new Error("Expected evidence");
  const input = { version: 2, requestId: retained.requestId, sessionId: retained.sessionId, createdAt: 1,
    plan: retained.plan, resolution: made.value, provenanceSource: retained };
  return { retained, evidence: made.value, input };
}

test("provider's fixed downstream guess cannot authorize a dynamic request", async () => {
  for (const text of [
    `Swap 10 USDC to EURC, then send 50% of actual previous output EURC to ${recipient}`,
    `Swap 10 USDC to EURC, then send the amount from the receipt in EURC to ${recipient}`,
    `Swap 10 USDC to EURC, then send all received EURC to ${recipient}`,
  ]) {
    const resolution = await resolvePlannerParameters({ text }, plan, { resolve: async () => ({ resolutions: [
      draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }),
      draft("send", { asset: "EURC", amount: "10", recipient }),
    ] }) });
    const compiled = compilePlannerStrategy({ version: 1, requestId: "request-1", sessionId: "session-1", createdAt: 1, plan, resolution });
    assert.notEqual(compiled.status, "COMPILED", text);
  }
});

test("11D v2 leaves provider-only fixed candidates unverified and rejects provider origin claims", async () => {
  const request = { text: `Send 10 EURC to ${recipient}` };
  const current = source();
  const candidate = draft("send", { asset: "EURC", amount: "10", recipient });
  const unverified = await resolvePlannerParametersWithEvidence(request, current.plan,
    { resolve: async () => ({ resolutions: [candidate] }) },
    { requestId: current.requestId, sessionId: current.sessionId, structuredInput: null });
  assert.ok("valid" in unverified && unverified.valid && unverified.value.status === "UNVERIFIED");
  const liar = await resolvePlannerParametersWithEvidence(request, current.plan,
    { resolve: async () => ({ resolutions: [{ ...candidate, origin: "FIXED_USER_INPUT" }] }) },
    { requestId: current.requestId, sessionId: current.sessionId, structuredInput: null });
  assert.deepEqual(liar, { status: "PROVIDER_ERROR" });
});

test("11D recognized dynamic amount has no fixed fallback in v2 evidence", async () => {
  const current = source();
  const result = await resolvePlannerParametersWithEvidence({ text: `Send all received EURC to ${recipient}` }, current.plan,
    { resolve: async () => ({ resolutions: [draft("send", { asset: "EURC", amount: "10", recipient })] }) },
    { requestId: current.requestId, sessionId: current.sessionId, structuredInput: null });
  assert.ok("valid" in result && result.valid && result.value.status === "UNVERIFIED");
  if ("valid" in result && result.valid) {
    assert.equal(result.value.evidence[0].state, "NONFIXED");
    assert.equal(result.value.evidence[0].origin, "DYNAMIC_EXPRESSION");
    assert.equal("value" in result.value.evidence[0], false);
  }
});

test("explicit structured field event compiles and v2 binding retains evidence digest", () => {
  const { retained, evidence, input } = confirmed();
  const output = compilePlannerStrategy(input);
  assert.equal(output.status, "COMPILED", JSON.stringify(output));
  if (output.status !== "COMPILED") return;
  assert.equal(output.executionEnabled, false);
  assert.equal(output.binding.version, 2);
  assert.equal(output.binding.parameterEvidenceDigest, evidence.evidenceDigest);
  assert.equal(evidence.evidence.length, 4);
  assert.ok(evidence.evidence.every((item) => item.origin === "FIXED_USER_INPUT" && item.source.kind === "USER_EVENT"));
  assert.equal(validatePlannerStrategyBinding(output.binding, { requestId: retained.requestId, sessionId: retained.sessionId,
    plan: retained.plan, resolution: retained.resolution, strategy: output.strategy, goalSteps: output.binding.goalSteps,
    provenance: evidence, provenanceSource: retained }).valid, true);
  const tampered = copy(output.binding);
  tampered.parameterEvidenceDigest = `0x${"0".repeat(64)}`;
  assert.equal(validatePlannerStrategyBinding(tampered, { requestId: retained.requestId, sessionId: retained.sessionId,
    plan: retained.plan, resolution: retained.resolution, strategy: output.strategy, goalSteps: output.binding.goalSteps,
    provenance: evidence, provenanceSource: retained }).valid, false);
});

test("free-text-only 11D result remains UNVERIFIED; legacy RESOLVED cannot compile", () => {
  const retained = source();
  retained.structuredInput = null as never;
  const made = createPlannerParameterEvidence(retained);
  assert.equal(made.valid, true);
  if (made.valid) {
    assert.equal(made.value.status, "UNVERIFIED");
    assert.ok(made.value.evidence.every((item) => item.state === "NONFIXED" && !("value" in item)));
    assert.equal(compilePlannerStrategy({ version: 2, requestId: retained.requestId, sessionId: retained.sessionId,
      createdAt: 1, plan: retained.plan, resolution: made.value, provenanceSource: retained }).status, "REJECTED");
  }
  assert.deepEqual(compilePlannerStrategy({ version: 2, requestId: retained.requestId, sessionId: retained.sessionId,
    createdAt: 1, plan: retained.plan, resolution: retained.resolution, provenanceSource: retained }),
    { status: "REJECTED", reason: "MISSING_PARAMETER_EVIDENCE" });
});

test("provider origin claim is not a structured user event", () => {
  const { retained, evidence, input } = confirmed();
  const lie = copy(evidence) as unknown as Record<string, unknown>;
  (lie.evidence as Record<string, unknown>[])[1].origin = "FIXED_USER_INPUT";
  (lie.evidence as Record<string, unknown>[])[1].source = { kind: "USER_EVENT", eventId: "provider-made", eventDigest: evidence.evidence[1].source.eventDigest };
  assert.equal(validatePlannerParameterEvidence(lie, retained).valid, false);
  assert.deepEqual(compilePlannerStrategy({ ...input, resolution: lie }), { status: "REJECTED", reason: "INVALID_PARAMETER_EVIDENCE" });
  const noEvent = copy(retained); noEvent.structuredInput = null as never;
  assert.equal(validatePlannerParameterEvidence(evidence, noEvent).valid, false);
});

test("request, session, plan, goal, key and value substitution fail against retained source", () => {
  const { retained, evidence } = confirmed();
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => { value.requestId = "other"; },
    (value) => { value.sessionId = "other"; },
    (value) => { value.planId = "other"; },
    (value) => { value.goalId = "other"; },
    (value) => { value.parameterKey = "recipient"; },
    (value) => { value.value = "11"; },
    (value) => { value.origin = "DETERMINISTIC_DEFAULT"; },
    (value) => { value.digest = `0x${"0".repeat(64)}`; },
  ];
  for (const mutate of mutations) {
    const changed = copy(evidence) as unknown as { evidence: Record<string, unknown>[] };
    mutate(changed.evidence.find((item) => item.parameterKey === "amount")!);
    assert.equal(validatePlannerParameterEvidence(changed, retained).valid, false);
  }
});

test("different retained request, session, graph, confirmation and value invalidate evidence", () => {
  const { retained, evidence } = confirmed();
  const changes = [
    (value: ReturnType<typeof source>) => { value.requestId = "request-2"; value.structuredInput.requestId = "request-2";
      value.structuredInput.requestDigest = plannerParameterRequestDigest(value.requestId, value.sessionId, value.request); },
    (value: ReturnType<typeof source>) => { value.sessionId = "session-2"; value.structuredInput.sessionId = "session-2";
      value.structuredInput.requestDigest = plannerParameterRequestDigest(value.requestId, value.sessionId, value.request); },
    (value: ReturnType<typeof source>) => { value.plan.id = "replan-2"; value.resolution.planId = "replan-2"; value.structuredInput.planId = "replan-2";
      value.structuredInput.planDigest = plannerParameterPlanDigest(value.plan as Parameters<typeof plannerParameterPlanDigest>[0]); },
    (value: ReturnType<typeof source>) => { value.request.text = "Send 11 EURC"; },
    (value: ReturnType<typeof source>) => { value.structuredInput.fields[1].value = "11"; },
    (value: ReturnType<typeof source>) => { value.resolution.intents[0].amount = "11"; value.structuredInput.fields[1].value = "11"; },
  ];
  for (const change of changes) {
    const altered = copy(retained);
    change(altered);
    assert.equal(validatePlannerParameterEvidence(evidence, altered).valid, false);
  }
});

test("closed evidence rejects extra and symbol fields, duplicates, missing fields and malformed runtime", () => {
  const { retained, evidence } = confirmed();
  const extra = copy(evidence) as unknown as { evidence: Record<string, unknown>[] };
  extra.evidence[0].wallet = true;
  assert.equal(validatePlannerParameterEvidence(extra, retained).valid, false);
  const symbol = copy(evidence); Object.defineProperty(symbol.evidence[0], Symbol("hidden"), { value: true });
  assert.equal(validatePlannerParameterEvidence(symbol, retained).valid, false);
  const duplicate = copy(retained); duplicate.structuredInput.fields[1] = copy(duplicate.structuredInput.fields[0]);
  assert.equal(createPlannerParameterEvidence(duplicate).valid, false);
  const missing = copy(retained); missing.structuredInput.fields.pop();
  assert.equal(createPlannerParameterEvidence(missing).valid, false);
  const duplicateRecord = copy(evidence); duplicateRecord.evidence[1] = copy(duplicateRecord.evidence[0]);
  assert.equal(validatePlannerParameterEvidence(duplicateRecord, retained).valid, false);
  const missingRecord = copy(evidence); missingRecord.evidence.pop();
  assert.equal(validatePlannerParameterEvidence(missingRecord, retained).valid, false);
  const getter = copy(evidence); Object.defineProperty(getter.evidence[0], "value", { enumerable: true, get() { throw Error("getter"); } });
  assert.equal(validatePlannerParameterEvidence(getter, retained).valid, false);
  const proxy = new Proxy(evidence, { getPrototypeOf() { throw Error("proxy"); } });
  assert.equal(validatePlannerParameterEvidence(proxy, retained).valid, false);
  const malformed = copy(evidence) as unknown as Record<string, unknown>; malformed.evidenceDigest = "bad";
  assert.equal(validatePlannerParameterEvidence(malformed, retained).valid, false);
});

test("unsupported default-origin claim cannot replace an exact user event", () => {
  const { retained, evidence } = confirmed();
  const changed = copy(evidence) as unknown as { evidence: Record<string, unknown>[] };
  changed.evidence[0].origin = "DETERMINISTIC_DEFAULT";
  changed.evidence[0].source = { kind: "RULE", ruleId: "arc", ruleVersion: 1, inputKeys: [] };
  assert.equal(validatePlannerParameterEvidence(changed, retained).valid, false);
});
