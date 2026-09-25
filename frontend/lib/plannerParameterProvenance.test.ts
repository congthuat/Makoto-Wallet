import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, stringToHex } from "viem";
import { resolvePlannerParameters, resolvePlannerParametersWithEvidence } from "./plannerParameterResolver.ts";
import { createPlannerParameterEvidence, plannerParameterPlanDigest, plannerParameterRequestDigest,
  validatePlannerParameterEvidence } from "./plannerParameterEvidence.ts";
import { compilePlannerStrategy } from "./plannerStrategyCompiler.ts";
import { createPlannerStrategyBinding, createPlannerStrategyBindingV2, validatePlannerStrategyBinding } from "./plannerStrategyBinding.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (kind: string, value: unknown) => keccak256(stringToHex(JSON.stringify(["makoto.planner-parameter-evidence", 1, kind, value])));
const draft = (goalId: string, fields: Record<string, string | null>) => ({ goalId, chain: null, asset: null, amount: null, recipient: null,
  fromAsset: null, toAsset: null, sourceChain: null, destinationChain: null, ...fields });

function source(withEvent = false) {
  const requestId = "request-1", sessionId = "session-1", request = { text: `Send 10 EURC to ${recipient}` };
  const plan = { version: 1, id: "send-plan", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] as string[] }] };
  const resolution = { status: "RESOLVED", planId: plan.id, intents: [
    { version: 1, id: "send", kind: "SEND", chainId: 5042002, asset: "eurc", amount: "10", recipient },
  ] };
  const requestDigest = plannerParameterRequestDigest(requestId, sessionId, request);
  const planDigest = plannerParameterPlanDigest(plan as Parameters<typeof plannerParameterPlanDigest>[0]);
  const fields = [
    { goalId: "send", parameterKey: "asset", value: "eurc" },
    { goalId: "send", parameterKey: "amount", value: "10" },
    { goalId: "send", parameterKey: "recipient", value: recipient },
    { goalId: "send", parameterKey: "chainId", value: 5042002 },
  ];
  return { requestId, sessionId, request, plan, resolution, structuredInput: withEvent
    ? { version: 1, eventId: "caller-made-event", requestId, sessionId, requestDigest, planId: plan.id, planDigest, fields } : null };
}
function unverified() {
  const retained = source();
  const made = createPlannerParameterEvidence(retained);
  assert.equal(made.valid, true, JSON.stringify(made));
  if (!made.valid || made.value.status !== "UNVERIFIED") throw new Error("Expected unverified evidence");
  return { retained, result: made.value };
}
function input(retained: ReturnType<typeof source>, resolution: unknown) {
  return { version: 2, requestId: retained.requestId, sessionId: retained.sessionId, createdAt: 1,
    plan: retained.plan, resolution, provenanceSource: retained };
}
function forgedFixed(retained: ReturnType<typeof source>) {
  const event = retained.structuredInput!;
  const fields = [...event.fields].sort((a, b) => `${a.goalId}:${a.parameterKey}` < `${b.goalId}:${b.parameterKey}` ? -1 : 1);
  const eventDigest = hash("USER_EVENT", [1, event.eventId, event.requestId, event.sessionId,
    event.requestDigest, event.planId, event.planDigest, fields.map((field) => [field.goalId, field.parameterKey, field.value])]);
  const evidence = fields.map((field) => {
    const base = { version: 1, requestId: retained.requestId, sessionId: retained.sessionId,
      requestDigest: event.requestDigest, planId: retained.plan.id, planDigest: event.planDigest,
      goalId: field.goalId, parameterKey: field.parameterKey, state: "FIXED", value: field.value,
      origin: "FIXED_USER_INPUT", source: { kind: "USER_EVENT", eventId: event.eventId, eventDigest } };
    const digest = hash("FIELD", [base.version, base.requestId, base.sessionId, base.requestDigest, base.planId,
      base.planDigest, base.goalId, base.parameterKey, base.state, base.value, base.origin,
      base.source.kind, base.source.eventId, base.source.eventDigest]);
    return { ...base, digest };
  });
  return { status: "RESOLVED_WITH_EVIDENCE", version: 2, planId: retained.plan.id, intents: retained.resolution.intents,
    evidence, evidenceDigest: hash("SET", evidence.map((item) => item.digest)) };
}

test("caller-fabricated structured event and correct digests cannot mint user origin", () => {
  const fabricated = source(true);
  assert.deepEqual(createPlannerParameterEvidence(fabricated), { valid: false, reason: "UNVERIFIED" });
  const fake = forgedFixed(fabricated);
  assert.equal(validatePlannerParameterEvidence(fake, fabricated).valid, false);
  assert.deepEqual(compilePlannerStrategy(input(fabricated, fake)), { status: "REJECTED", reason: "INVALID_PARAMETER_EVIDENCE" });
});

test("fixed natural language and provider-only values remain unverified without a trusted source", async () => {
  const retained = source();
  const result = await resolvePlannerParametersWithEvidence(retained.request, retained.plan,
    { resolve: async () => ({ resolutions: [draft("send", { asset: "EURC", amount: "10", recipient })] }) },
    { requestId: retained.requestId, sessionId: retained.sessionId, structuredInput: null });
  assert.ok("valid" in result && result.valid && result.value.status === "UNVERIFIED");
  if ("valid" in result && result.valid) {
    assert.ok(result.value.evidence.every((field) => field.state === "NONFIXED" && !("value" in field)));
    assert.deepEqual(compilePlannerStrategy(input(retained, result.value)),
      { status: "REJECTED", reason: "MISSING_PARAMETER_EVIDENCE" });
  }
});

test("provider self-certification is rejected by the closed 11D proposal schema", async () => {
  const retained = source();
  const candidate = draft("send", { asset: "EURC", amount: "10", recipient });
  assert.deepEqual(await resolvePlannerParametersWithEvidence(retained.request, retained.plan,
    { resolve: async () => ({ resolutions: [{ ...candidate, origin: "FIXED_USER_INPUT" }] }) },
    { requestId: retained.requestId, sessionId: retained.sessionId, structuredInput: null }), { status: "PROVIDER_ERROR" });
});

test("dynamic amount variants never compile a provider's fixed fallback", async () => {
  const plan = { version: 1, id: "plan-1", classification: "STRATEGY", goals: [
    { id: "swap", kind: "SWAP", dependsOn: [] as string[] }, { id: "send", kind: "SEND", dependsOn: ["swap"] },
  ] };
  for (const phrase of ["50% of actual previous output", "all received", "amount from receipt",
    "amount from previous transaction", "amount from quote", "25% of runtime balance"]) {
    const request = { text: `Swap 10 USDC to EURC, then send ${phrase} EURC to ${recipient}` };
    const proposal = { resolve: async () => ({ resolutions: [
      draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }),
      draft("send", { asset: "EURC", amount: "10", recipient }),
    ] }) };
    const legacy = await resolvePlannerParameters(request, plan, proposal);
    assert.notEqual(compilePlannerStrategy({ version: 2, requestId: "request-1", sessionId: "session-1", createdAt: 1,
      plan, resolution: legacy, provenanceSource: null }).status, "COMPILED", phrase);
    const v2 = await resolvePlannerParametersWithEvidence(request, plan, proposal,
      { requestId: "request-1", sessionId: "session-1", structuredInput: null });
    if ("valid" in v2 && v2.valid) {
      assert.ok(v2.value.evidence.every((field) => field.state === "NONFIXED" && !("value" in field)));
      assert.notEqual(compilePlannerStrategy({ version: 2, requestId: "request-1", sessionId: "session-1", createdAt: 1,
        plan, resolution: v2.value, provenanceSource: null }).status, "COMPILED", phrase);
    }
  }
});

test("request, session, plan, goal, key, value and digest substitution invalidate retained nonfixed evidence", () => {
  const { retained, result } = unverified();
  const changes: Array<(item: Record<string, unknown>) => void> = [
    (item) => { item.requestId = "other"; }, (item) => { item.sessionId = "other"; },
    (item) => { item.planId = "other"; }, (item) => { item.goalId = "other"; },
    (item) => { item.parameterKey = "other"; }, (item) => { item.expressionClass = "OTHER_DYNAMIC"; },
    (item) => { item.digest = `0x${"0".repeat(64)}`; },
  ];
  for (const change of changes) {
    const altered = copy(result) as unknown as { evidence: Record<string, unknown>[] };
    change(altered.evidence[0]);
    assert.equal(validatePlannerParameterEvidence(altered, retained).valid, false);
  }
  const value = copy(result) as unknown as { evidence: Record<string, unknown>[] };
  value.evidence[0].value = "10";
  assert.equal(validatePlannerParameterEvidence(value, retained).valid, false);
});

test("coordinated other-request and same-goal replan cannot reuse even nonfixed evidence", () => {
  const { retained, result } = unverified();
  const other = copy(retained); other.requestId = "request-2";
  assert.equal(validatePlannerParameterEvidence(result, other).valid, false);
  const replan = copy(retained); replan.plan.id = "plan-2"; replan.resolution.planId = "plan-2";
  assert.equal(validatePlannerParameterEvidence(result, replan).valid, false);
  for (const field of ["amount", "recipient", "asset"] as const) {
    const changed = copy(retained);
    (changed.resolution.intents[0] as Record<string, unknown>)[field] = field === "recipient"
      ? "0x2222222222222222222222222222222222222222" : field === "asset" ? "usdc" : "11";
    // Nonfixed evidence carries no value and grants no compilation authority.
    assert.notEqual(compilePlannerStrategy(input(changed, result)).status, "COMPILED");
  }
  const chain = copy(retained); chain.resolution.intents[0].chainId = 1;
  assert.equal(validatePlannerParameterEvidence(result, chain).valid, false);
  const kind = copy(retained); kind.plan.goals[0].kind = "SWAP";
  assert.equal(validatePlannerParameterEvidence(result, kind).valid, false);
});

test("v1 binding remains structural but cannot bypass the v2 compiler gate", () => {
  const retained = source();
  const strategy = { version: 1, id: "strategy-1", createdAt: 1, steps: [
    { id: "step-1", kind: "ACTION", action: "SEND", confirmation: "EXPLICIT_USER_CONFIRMATION", dependsOn: [] },
  ] };
  const bindingSource = { requestId: retained.requestId, sessionId: retained.sessionId,
    plan: retained.plan, resolution: retained.resolution, strategy, goalSteps: [{ goalId: "send", actionStepId: "step-1" }] };
  const v1 = createPlannerStrategyBinding(bindingSource);
  assert.equal(v1.valid, true);
  if (v1.valid) assert.equal(validatePlannerStrategyBinding(v1.value, bindingSource).valid, true);
  assert.deepEqual(compilePlannerStrategy(input(retained, retained.resolution)),
    { status: "REJECTED", reason: "MISSING_PARAMETER_EVIDENCE" });
  const fake = source(true);
  assert.equal(createPlannerStrategyBindingV2({ ...bindingSource, provenance: forgedFixed(fake), provenanceSource: fake }).valid, false);
});

test("malformed data, extra and symbol fields, getters, proxies and duplicate records fail closed", () => {
  const { retained, result } = unverified();
  for (const value of [null, undefined, [], 1, "evidence"]) assert.equal(validatePlannerParameterEvidence(value, retained).valid, false);
  const extra = copy(result) as unknown as Record<string, unknown>; extra.wallet = true;
  assert.equal(validatePlannerParameterEvidence(extra, retained).valid, false);
  const symbol = copy(result); Object.defineProperty(symbol, Symbol("hidden"), { value: true });
  assert.equal(validatePlannerParameterEvidence(symbol, retained).valid, false);
  const getter = copy(result); Object.defineProperty(getter.evidence[0], "digest", { enumerable: true, get() { throw Error("getter"); } });
  assert.equal(validatePlannerParameterEvidence(getter, retained).valid, false);
  const proxy = new Proxy(result, { getPrototypeOf() { throw Error("proxy"); } });
  assert.equal(validatePlannerParameterEvidence(proxy, retained).valid, false);
  const duplicate = copy(result); duplicate.evidence[1] = copy(duplicate.evidence[0]);
  assert.equal(validatePlannerParameterEvidence(duplicate, retained).valid, false);
  const missing = copy(result); missing.evidence.pop();
  assert.equal(validatePlannerParameterEvidence(missing, retained).valid, false);
  const prototype = Object.assign(Object.create({ trusted: true }) as object, retained);
  assert.equal(createPlannerParameterEvidence(prototype).valid, false);
});
