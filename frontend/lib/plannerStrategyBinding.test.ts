import assert from "node:assert/strict";
import test from "node:test";
import { createPlannerStrategyBinding, validatePlannerStrategyBinding } from "./plannerStrategyBinding.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sendIntent = (id: string, amount = "5") => ({ version: 1, id, kind: "SEND", chainId: 5042002, asset: "eurc", amount, recipient });
const swapIntent = (id: string) => ({ version: 1, id, kind: "SWAP", chainId: 5042002, fromAsset: "usdc", toAsset: "eurc", amount: "100" });
const action = (id: string, kind: "SEND" | "SWAP" | "BRIDGE", dependsOn: string[] = []) => ({ id, kind: "ACTION", action: kind, confirmation: "EXPLICIT_USER_CONFIRMATION", dependsOn });
const single = () => ({
  requestId: "request-1", sessionId: "session-1",
  plan: { version: 1, id: "plan-1", classification: "ACTION", goals: [{ id: "goal-send", kind: "SEND", dependsOn: [] }] },
  resolution: { status: "RESOLVED", planId: "plan-1", intents: [sendIntent("goal-send")] },
  strategy: { version: 1, id: "strategy-1", createdAt: 1000, steps: [action("step-send", "SEND")] },
  goalSteps: [{ goalId: "goal-send", actionStepId: "step-send" }],
});
const multi = () => ({
  requestId: "request-2", sessionId: "session-2",
  plan: { version: 1, id: "plan-2", classification: "STRATEGY", goals: [
    { id: "g-swap", kind: "SWAP", dependsOn: [] }, { id: "g-send", kind: "SEND", dependsOn: ["g-swap"] },
  ] },
  resolution: { status: "RESOLVED", planId: "plan-2", intents: [swapIntent("g-swap"), sendIntent("g-send")] },
  strategy: { version: 1, id: "strategy-2", createdAt: 1000, steps: [action("s-swap", "SWAP"), action("s-send", "SEND", ["s-swap"])] },
  goalSteps: [{ goalId: "g-swap", actionStepId: "s-swap" }, { goalId: "g-send", actionStepId: "s-send" }],
});
function binding(source: unknown) {
  const result = createPlannerStrategyBinding(source);
  assert.equal(result.valid, true, JSON.stringify(result));
  if (!result.valid) throw new Error("Expected binding");
  return result.value;
}
function denied(source: unknown, reason?: string) {
  const result = createPlannerStrategyBinding(source);
  assert.equal(result.valid, false, JSON.stringify(result));
  if (!result.valid && reason) assert.equal(result.reason, reason);
}

test("AEI-A creates and verifies a versioned minimal provenance binding", () => {
  const source = single(), value = binding(source);
  assert.equal(value.version, 1); assert.equal(value.digestVersion, 1);
  assert.equal(value.plan.id, "plan-1"); assert.equal(value.strategy.id, "strategy-1");
  assert.equal(value.strategy.stage, "SKELETON");
  assert.deepEqual(value.goalSteps, [{ goalId: "goal-send", actionStepId: "step-send" }]);
  assert.equal(validatePlannerStrategyBinding(copy(value), source).valid, true);
  assert.equal(Object.isFrozen(value), true);
});

test("AEI-A binds every goal exactly once in a multi-goal graph", () => {
  const source = multi(), value = binding(source);
  assert.deepEqual(value.goalSteps, [{ goalId: "g-send", actionStepId: "s-send" }, { goalId: "g-swap", actionStepId: "s-swap" }]);
  assert.equal(validatePlannerStrategyBinding(value, source).valid, true);
});

test("same validated source yields stable digests regardless of object-key, plan-goal, intent or mapping order", () => {
  const source = multi(), value = binding(source), changed = copy(source);
  changed.plan.goals.reverse(); changed.resolution.intents.reverse(); changed.goalSteps.reverse();
  const reordered = { goalSteps: changed.goalSteps, strategy: { steps: changed.strategy.steps, createdAt: changed.strategy.createdAt, id: changed.strategy.id, version: 1 }, resolution: changed.resolution, plan: changed.plan, sessionId: changed.sessionId, requestId: changed.requestId };
  assert.deepEqual(binding(reordered), value);
  const reorderedBinding = { digest: value.digest, goalSteps: [...value.goalSteps].reverse(), strategy: { digest: value.strategy.digest, stage: "SKELETON", version: 1, id: value.strategy.id }, resolvedIntentsDigest: value.resolvedIntentsDigest, plan: { digest: value.plan.digest, version: 1, id: value.plan.id }, sessionId: value.sessionId, requestId: value.requestId, digestVersion: 1, version: 1 };
  assert.equal(validatePlannerStrategyBinding(reorderedBinding, source).valid, true);
});

test("a changed resolved amount changes provenance and invalidates the former binding", () => {
  const source = single(), value = binding(source), changed = copy(source);
  changed.resolution.intents[0].amount = "6";
  assert.notEqual(binding(changed).resolvedIntentsDigest, value.resolvedIntentsDigest);
  assert.deepEqual(validatePlannerStrategyBinding(value, changed), { valid: false, reason: "PROVENANCE_MISMATCH" });
});

test("a changed dependency graph changes plan provenance even with the same goals", () => {
  const source = multi(), value = binding(source), changed = copy(source);
  changed.plan.goals[0].dependsOn = ["g-send"];
  changed.plan.goals[1].dependsOn = [];
  changed.strategy.steps[0].dependsOn = ["s-send"];
  changed.strategy.steps[1].dependsOn = [];
  assert.notEqual(binding(changed).plan.digest, value.plan.digest);
  assert.equal(validatePlannerStrategyBinding(value, changed).valid, false);
});

test("goal, Strategy, and step substitution do not validate against the retained source", () => {
  const source = single(), value = binding(source);
  for (const field of ["goal", "strategy", "step"] as const) {
    const changed = copy(source);
    if (field === "goal") { changed.plan.goals[0].id = "other-goal"; changed.resolution.intents[0].id = "other-goal"; changed.goalSteps[0].goalId = "other-goal"; }
    if (field === "strategy") changed.strategy.id = "other-strategy";
    if (field === "step") { changed.strategy.steps[0].id = "other-step"; changed.goalSteps[0].actionStepId = "other-step"; }
    assert.equal(validatePlannerStrategyBinding(value, changed).valid, false, field);
  }
});

test("duplicate goal ID, duplicate step ID, duplicate map, missing map and unknown goal fail", () => {
  const duplicateGoal = multi(); duplicateGoal.plan.goals[1].id = "g-swap"; denied(duplicateGoal, "INVALID_PLAN");
  const duplicateStep = multi(); duplicateStep.strategy.steps[1].id = "s-swap"; denied(duplicateStep, "INVALID_STRATEGY");
  const duplicateMap = multi(); duplicateMap.goalSteps[1].goalId = "g-swap"; denied(duplicateMap, "INVALID_MAPPING");
  const duplicateStepMap = multi(); duplicateStepMap.goalSteps[1].actionStepId = "s-swap"; denied(duplicateStepMap, "INVALID_MAPPING");
  const missing = multi(); missing.goalSteps.pop(); denied(missing, "INVALID_MAPPING");
  const unknown = multi(); unknown.goalSteps[1].goalId = "unknown"; denied(unknown, "INVALID_MAPPING");
});

test("array position and matching action names cannot replace explicit ID/dependency mapping", () => {
  const source = multi(); source.goalSteps.reverse(); assert.equal(binding(source).goalSteps[0].goalId, "g-send");
  const swapped = multi(); swapped.goalSteps[0].actionStepId = "s-send"; swapped.goalSteps[1].actionStepId = "s-swap"; denied(swapped, "INVALID_MAPPING");
  const sameNames = multi(); sameNames.plan.goals[0].kind = "SEND"; sameNames.resolution.intents[0] = sendIntent("g-swap"); sameNames.strategy.steps[0].action = "SEND";
  sameNames.goalSteps[0].actionStepId = "s-send"; sameNames.goalSteps[1].actionStepId = "s-swap";
  denied(sameNames, "INVALID_MAPPING");
});

test("a fixed order edge does not claim a dynamic output value", () => {
  const source = multi(); assert.equal(binding(source).goalSteps.length, 2);
  const dynamic = copy(source) as unknown as Record<string, unknown>;
  dynamic.resolution = { status: "NEEDS_CLARIFICATION", issues: [{ goalId: "g-send", field: "amount", code: "DYNAMIC_AMOUNT" }] };
  denied(dynamic, "UNRESOLVED_INTENTS");
  const invented = multi(); invented.resolution.intents[1].amount = "all received"; denied(invented, "INVALID_INTENT");
});

test("unexpected fields, symbols, accessors and prototype tricks fail closed", () => {
  denied({ ...single(), sign: true }, "INVALID_SCHEMA");
  const symbol = single() as object; Object.defineProperty(symbol, Symbol("submit"), { value: true }); denied(symbol, "INVALID_SCHEMA");
  const hidden = single(); Object.defineProperty(hidden.goalSteps[0], "retry", { value: true }); denied(hidden, "INVALID_SCHEMA");
  const getter = single(); Object.defineProperty(getter, "requestId", { get() { throw new Error("getter"); }, enumerable: true }); denied(getter, "INVALID_SCHEMA");
  const proto = Object.assign(Object.create({ signer: true }) as object, single()); denied(proto, "INVALID_SCHEMA");
});

test("throwing proxies and malformed runtime values return a rejection instead of throwing", () => {
  const hostile = new Proxy(single(), { getPrototypeOf() { throw new Error("proxy"); } });
  denied(hostile, "INVALID_RUNTIME");
  assert.deepEqual(validatePlannerStrategyBinding(hostile, single()), { valid: false, reason: "INVALID_RUNTIME" });
  for (const value of [null, undefined, [], () => 1]) denied(value, "INVALID_SCHEMA");
});

test("a stateful proxy get trap cannot change descriptor-snapshotted provenance", () => {
  const source = single(), expected = binding(source);
  let reads = 0;
  const proxy = new Proxy(source, { get() { reads++; throw new Error("mutable get trap"); } });
  assert.deepEqual(binding(proxy), expected);
  assert.equal(reads, 0);
});

test("sparse, cyclic and oversized runtime containers fail without partial binding", () => {
  const sparse = multi(); delete sparse.goalSteps[0]; denied(sparse, "INVALID_SCHEMA");
  const cyclic = single() as object & { self?: unknown }; cyclic.self = cyclic; denied(cyclic, "INVALID_SCHEMA");
  const oversized = single() as { goalSteps: unknown[] }; oversized.goalSteps = new Array(100_000).fill({ goalId: "goal-send", actionStepId: "step-send" }); denied(oversized, "INVALID_SCHEMA");
});

test("invalid IDs, versions, malformed digests and altered mapping are rejected", () => {
  denied({ ...single(), requestId: "bad id" }, "INVALID_ID");
  const source = single(), value = binding(source);
  assert.deepEqual(validatePlannerStrategyBinding({ ...value, version: 2 }, source), { valid: false, reason: "UNSUPPORTED_VERSION" });
  assert.deepEqual(validatePlannerStrategyBinding({ ...value, digest: "0x1234" }, source), { valid: false, reason: "INVALID_SCHEMA" });
  assert.equal(validatePlannerStrategyBinding({ ...value, goalSteps: [{ goalId: "goal-send", actionStepId: "other" }] }, source).valid, false);
  assert.deepEqual(validatePlannerStrategyBinding({ ...value, signer: true }, source), { valid: false, reason: "INVALID_SCHEMA" });
});

test("binding cannot carry preparation, policy, consent, submission, receipt or retry authority", () => {
  const source = single(), value = binding(source);
  for (const field of ["preparedAction", "policy", "walletApproval", "sign", "submit", "receipt", "retry", "calldata", "target"])
    assert.equal(validatePlannerStrategyBinding({ ...value, [field]: true }, source).valid, false, field);
  const prepared = single(); Object.assign(prepared.strategy.steps[0], { preparedAction: { kind: "PREPARED_ACTION" } }); denied(prepared, "INVALID_STRATEGY");
  assert.equal(Object.hasOwn(value, "account"), false);
  assert.equal(Object.hasOwn(value, "wallet"), false);
});
