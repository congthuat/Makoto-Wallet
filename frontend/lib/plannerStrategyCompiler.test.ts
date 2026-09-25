import assert from "node:assert/strict";
import test from "node:test";
import { compilePlannerStrategy } from "./plannerStrategyCompiler.ts";
import { snapshotPlannerStrategyData, validatePlannerStrategyBinding } from "./plannerStrategyBinding.ts";
import { evaluateStrategyContinuation } from "./strategyContinuation.ts";
import { createPlannerParameterEvidence, plannerParameterPlanDigest, plannerParameterRequestDigest } from "./plannerParameterEvidence.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const send = (id: string, amount = "5") => ({ version: 1, id, kind: "SEND", chainId: 5042002, asset: "eurc", amount, recipient });
const swap = (id: string) => ({ version: 1, id, kind: "SWAP", chainId: 5042002, fromAsset: "usdc", toAsset: "eurc", amount: "100" });
const bridge = (id: string) => ({ version: 1, id, kind: "BRIDGE", sourceChainId: 5042002, destinationChainId: 84532, asset: "usdc", amount: "10", recipient });
const single = (kind: "SEND" | "SWAP" | "BRIDGE" = "SEND") => ({
  version: 1, requestId: "request-1", sessionId: "session-1", createdAt: 1000,
  plan: { version: 1, id: "plan-1", classification: "ACTION", goals: [{ id: "g1", kind, dependsOn: [] as string[] }] },
  resolution: { status: "RESOLVED", planId: "plan-1", intents: [kind === "SEND" ? send("g1") : kind === "SWAP" ? swap("g1") : bridge("g1")] },
});
const multi = () => ({
  version: 1, requestId: "request-2", sessionId: "session-2", createdAt: 1000,
  plan: { version: 1, id: "plan-2", classification: "STRATEGY", goals: [
    { id: "g-swap", kind: "SWAP", dependsOn: [] as string[] },
    { id: "g-send", kind: "SEND", dependsOn: ["g-swap"] },
  ] },
  resolution: { status: "RESOLVED", planId: "plan-2", intents: [swap("g-swap"), send("g-send")] },
});
function withEvidence(input: unknown): unknown {
  const captured = snapshotPlannerStrategyData(input);
  if (!captured.valid || !captured.value || typeof captured.value !== "object" || Array.isArray(captured.value)) return input;
  const value = captured.value as Record<string, unknown>;
  if (value.version !== 1 || typeof value.requestId !== "string" || typeof value.sessionId !== "string" ||
    !value.plan || typeof value.plan !== "object") return input;
  const resolution = value.resolution as { status?: string; planId?: string; intents?: Record<string, unknown>[] };
  const plan = value.plan as { id?: string };
  const fields = resolution?.status === "RESOLVED" && Array.isArray(resolution.intents)
    ? resolution.intents.flatMap((intent) => Object.keys(intent).filter((key) => !["version", "id", "kind"].includes(key))
      .map((parameterKey) => ({ goalId: intent.id, parameterKey, value: intent[parameterKey] }))) : [];
  const provenanceSource = { requestId: value.requestId, sessionId: value.sessionId,
    request: { text: `Fixture ${value.requestId}` }, plan: value.plan, resolution: value.resolution,
    structuredInput: { version: 1, eventId: "fixture-event", requestId: value.requestId, sessionId: value.sessionId,
      requestDigest: plannerParameterRequestDigest(value.requestId, value.sessionId, { text: `Fixture ${value.requestId}` }),
      planId: plan.id, planDigest: plannerParameterPlanDigest(value.plan as Parameters<typeof plannerParameterPlanDigest>[0]), fields } };
  const checked = createPlannerParameterEvidence(provenanceSource);
  const v2 = checked.valid && checked.value.status === "RESOLVED_WITH_EVIDENCE" ? checked.value :
    resolution?.status === "RESOLVED" ? { status: "RESOLVED_WITH_EVIDENCE", version: 2, planId: resolution.planId,
      intents: resolution.intents, evidence: [], evidenceDigest: `0x${"0".repeat(64)}` } : value.resolution;
  return { ...value, version: 2, resolution: v2, provenanceSource };
}
function compiled(input: unknown) {
  const result = compilePlannerStrategy(withEvidence(input));
  assert.equal(result.status, "COMPILED", JSON.stringify(result));
  if (result.status !== "COMPILED") throw new Error("Expected compilation");
  return result;
}
function rejected(input: unknown, reason: string) {
  assert.deepEqual(compilePlannerStrategy(withEvidence(input)), { status: "REJECTED", reason });
}
function bindingSource(input: ReturnType<typeof single>, output: ReturnType<typeof compiled>) {
  const enriched = withEvidence(input) as { provenanceSource: unknown; resolution: unknown };
  return { requestId: input.requestId, sessionId: input.sessionId, plan: input.plan,
    resolution: input.resolution, strategy: output.strategy, goalSteps: output.binding.goalSteps,
    provenance: enriched.resolution, provenanceSource: enriched.provenanceSource };
}

test("single SEND, SWAP and BRIDGE compile to unprepared Phase 10 ACTION skeletons", () => {
  for (const kind of ["SEND", "SWAP", "BRIDGE"] as const) {
    const source = single(kind), output = compiled(source);
    assert.equal(output.executionEnabled, false);
    assert.equal(output.strategy.createdAt, 1000);
    assert.equal(output.strategy.steps.length, 1);
    assert.deepEqual(output.strategy.steps[0], { id: output.binding.goalSteps[0].actionStepId, kind: "ACTION", action: kind,
      confirmation: "EXPLICIT_USER_CONFIRMATION", dependsOn: [] });
    assert.equal(output.binding.strategy.stage, "SKELETON");
    assert.equal(validatePlannerStrategyBinding(output.binding, bindingSource(source, output)).valid, true);
  }
});

test("fixed SWAP then fixed SEND preserves only the order edge and exact goal mapping", () => {
  const source = multi(), output = compiled(source);
  const ids = new Map(output.binding.goalSteps.map((item) => [item.goalId, item.actionStepId]));
  assert.deepEqual(output.strategy.steps.map((step) => step.action), ["SEND", "SWAP"]); // Stable ID order, not execution order.
  assert.deepEqual(output.strategy.steps[0].dependsOn, [ids.get("g-swap")]);
  assert.deepEqual(output.strategy.steps[1].dependsOn, []);
  assert.equal(validatePlannerStrategyBinding(output.binding, { requestId: source.requestId, sessionId: source.sessionId,
    plan: source.plan, resolution: source.resolution, strategy: output.strategy, goalSteps: output.binding.goalSteps,
    provenance: (withEvidence(source) as { resolution: unknown }).resolution,
    provenanceSource: (withEvidence(source) as { provenanceSource: unknown }).provenanceSource }).valid, true);
});

test("same input and reordered object properties, goals and intents give identical identities", () => {
  const source = multi(), original = compiled(source), reordered = copy(source);
  reordered.plan.goals.reverse(); reordered.resolution.intents.reverse();
  const permuted = { resolution: reordered.resolution, plan: reordered.plan, createdAt: reordered.createdAt,
    sessionId: reordered.sessionId, requestId: reordered.requestId, version: reordered.version };
  assert.deepEqual(compiled(permuted), original);
  assert.deepEqual(compiled(source), original);
});

test("meaningful changed parameter or graph changes identity or fails unsupported validation", () => {
  const source = multi(), original = compiled(source);
  const amount = copy(source); amount.resolution.intents[1].amount = "6";
  assert.notEqual(compiled(amount).binding.resolvedIntentsDigest, original.binding.resolvedIntentsDigest);
  assert.notEqual(compiled(amount).strategy.id, original.strategy.id);
  const recipientChange = copy(source); recipientChange.resolution.intents[1].recipient = "0x2222222222222222222222222222222222222222";
  assert.notEqual(compiled(recipientChange).strategy.id, original.strategy.id);
  const asset = single(); const first = compiled(asset); asset.resolution.intents[0].asset = "usdc";
  assert.notEqual(compiled(asset).strategy.id, first.strategy.id);
  const graph = copy(source); graph.plan.goals[0].dependsOn = ["g-send"]; graph.plan.goals[1].dependsOn = [];
  assert.notEqual(compiled(graph).binding.plan.digest, original.binding.plan.digest);
  const chain = single(); chain.resolution.intents[0].chainId = 1;
  rejected(chain, "UNSUPPORTED_CHAIN");
});

test("request, session and plan identity are bound without ambient time or labels", () => {
  const source = single(), original = compiled(source);
  const request = copy(source); request.requestId = "request-2"; assert.notEqual(compiled(request).strategy.id, original.strategy.id);
  const session = copy(source); session.sessionId = "session-2"; assert.notEqual(compiled(session).strategy.id, original.strategy.id);
  const plan = copy(source); plan.plan.id = "plan-2"; plan.resolution.planId = "plan-2";
  assert.notEqual(compiled(plan).strategy.id, original.strategy.id);
  const time = copy(source); time.createdAt = 2000;
  assert.equal(compiled(time).strategy.id, original.strategy.id);
  assert.notEqual(compiled(time).binding.strategy.digest, original.binding.strategy.digest);
});

test("unresolved and dynamic output amounts fail closed without guessed fixed values", () => {
  const source = multi() as unknown as Record<string, unknown>;
  source.resolution = { status: "NEEDS_CLARIFICATION", issues: [{ goalId: "g-send", field: "amount", code: "DYNAMIC_AMOUNT" }] };
  rejected(source, "DYNAMIC_VALUE_DEPENDENCY_UNSUPPORTED");
  const missing = single() as unknown as Record<string, unknown>;
  missing.resolution = { status: "NEEDS_CLARIFICATION", issues: [{ goalId: "g1", field: "amount", code: "MISSING" }] };
  rejected(missing, "UNRESOLVED_PARAMETER");
  const invented = single(); invented.resolution.intents[0].amount = "all received";
  rejected(invented, "AMBIGUOUS_AMOUNT");
});

test("invalid plan graph, goal kind and binding substitutions reject without partial output", () => {
  const duplicate = multi(); duplicate.plan.goals[1].id = "g-swap"; rejected(duplicate, "DUPLICATE_GOAL_ID");
  const unknown = multi(); unknown.plan.goals[1].dependsOn = ["unknown"]; rejected(unknown, "UNKNOWN_DEPENDENCY");
  const cycle = multi(); cycle.plan.goals[0].dependsOn = ["g-send"]; rejected(cycle, "DEPENDENCY_CYCLE");
  const badKind = single(); badKind.plan.goals[0].kind = "APPROVE"; rejected(badKind, "UNSUPPORTED_GOAL_KIND");
  const wrong = single(); wrong.resolution.intents[0].id = "other"; rejected(wrong, "GOAL_BINDING_MISMATCH");
  const wrongKind = single(); wrongKind.resolution.intents[0] = swap("g1"); rejected(wrongKind, "GOAL_BINDING_MISMATCH");
  const mismatch = single(); mismatch.resolution.planId = "other"; rejected(mismatch, "PLAN_RESULT_MISMATCH");
});

test("unsupported parameters and extra authority fields reject", () => {
  const unsupportedAsset = single(); unsupportedAsset.resolution.intents[0].asset = "fake"; rejected(unsupportedAsset, "UNSUPPORTED_ASSET");
  const badRecipient = single(); badRecipient.resolution.intents[0].recipient = "bad"; rejected(badRecipient, "INVALID_RECIPIENT");
  rejected({ ...single(), version: 3 }, "UNSUPPORTED_VERSION");
  rejected({ ...single(), signer: true }, "UNEXPECTED_FIELD");
  rejected({ ...single(), text: "Send 5 EURC" }, "UNEXPECTED_FIELD");
  rejected({ ...single(), locale: "en" }, "UNEXPECTED_FIELD");
  const extraPlan = single(); Object.assign(extraPlan.plan, { wallet: true }); rejected(extraPlan, "INVALID_SCHEMA");
});

test("malformed runtime values, symbols, getters, proxies and prototypes reject", () => {
  for (const value of [null, [], 1, "source"]) rejected(value, "INVALID_SCHEMA");
  rejected(undefined, "INVALID_RUNTIME");
  const symbol = single(); Object.defineProperty(symbol, Symbol("sign"), { value: true }); rejected(symbol, "INVALID_RUNTIME");
  const getter = single(); Object.defineProperty(getter, "requestId", { enumerable: true, get() { throw new Error("getter"); } }); rejected(getter, "INVALID_RUNTIME");
  const proxy = new Proxy(single(), { getPrototypeOf() { throw new Error("proxy"); } }); rejected(proxy, "INVALID_RUNTIME");
  const proto = Object.assign(Object.create({ sign: true }) as object, single()); rejected(proto, "INVALID_RUNTIME");
  const sparse = multi(); delete sparse.plan.goals[0]; rejected(sparse, "INVALID_RUNTIME");
});

test("descriptor snapshot prevents later mutation and proxy get substitution", () => {
  const source = single(), expected = compiled(source);
  let reads = 0;
  const proxy = new Proxy(source, { get() { reads++; source.resolution.intents[0].amount = "999"; throw new Error("late get"); } });
  assert.deepEqual(compiled(proxy), expected);
  assert.equal(reads, 0);
  source.resolution.intents[0].amount = "7";
  assert.equal(expected.binding.resolvedIntentsDigest === compiled(source).binding.resolvedIntentsDigest, false);
});

test("successful output carries no quote, preparation, account or execution authority", () => {
  const output = compiled(multi());
  const encoded = JSON.stringify(output);
  for (const field of ["preparedAction", "quote", "policy", "account", "wallet", "calldata", "target", "receipt", "retry", "submit", "signature"])
    assert.equal(encoded.includes(`"${field}"`), false, field);
  assert.equal(Object.isFrozen(output.strategy), true);
  assert.equal(Object.isFrozen(output.strategy.steps[0]), true);
  assert.equal(Object.isFrozen(output.binding), true);
});

test("invalid Bridge source and destination chains receive the specific unsupported-chain result", () => {
  for (const field of ["sourceChainId", "destinationChainId"] as const) {
    const source = single("BRIDGE");
    source.resolution.intents[0][field] = 1;
    rejected(source, "UNSUPPORTED_CHAIN");
  }
});

test("valid token and goal identity changes alter canonical provenance", () => {
  const swapSource = single("SWAP"), original = compiled(swapSource);
  const reverse = copy(swapSource); reverse.resolution.intents[0].fromAsset = "eurc"; reverse.resolution.intents[0].toAsset = "usdc";
  assert.notEqual(compiled(reverse).strategy.id, original.strategy.id);
  const badIn = copy(swapSource); badIn.resolution.intents[0].fromAsset = "cirbtc"; rejected(badIn, "UNSUPPORTED_ASSET");
  const badOut = copy(swapSource); badOut.resolution.intents[0].toAsset = "cirbtc"; rejected(badOut, "UNSUPPORTED_ASSET");
  const goalId = copy(swapSource); goalId.plan.goals[0].id = "g2"; goalId.resolution.intents[0].id = "g2";
  assert.notEqual(compiled(goalId).strategy.id, original.strategy.id);
  const kind = copy(swapSource); kind.plan.goals[0].kind = "SEND"; kind.resolution.intents[0] = send("g1");
  assert.notEqual(compiled(kind).strategy.id, original.strategy.id);
});

test("fan-out, fan-in and independent branches preserve exact goal dependency sets", () => {
  const source = multi() as unknown as Record<string, unknown>;
  source.plan = { version: 1, id: "branch-plan", classification: "STRATEGY", goals: [
    { id: "a", kind: "SEND", dependsOn: [] },
    { id: "b", kind: "SWAP", dependsOn: ["a"] },
    { id: "c", kind: "SEND", dependsOn: ["a"] },
    { id: "d", kind: "BRIDGE", dependsOn: [] },
    { id: "e", kind: "SEND", dependsOn: ["b", "c"] },
  ] };
  source.resolution = { status: "RESOLVED", planId: "branch-plan", intents: [send("a"), swap("b"), send("c"), bridge("d"), send("e")] };
  const output = compiled(source), ids = new Map(output.binding.goalSteps.map((item) => [item.goalId, item.actionStepId]));
  const byId = new Map(output.strategy.steps.map((step) => [step.id, step]));
  assert.deepEqual(byId.get(ids.get("a")!)?.dependsOn, []);
  assert.deepEqual(byId.get(ids.get("b")!)?.dependsOn, [ids.get("a")]);
  assert.deepEqual(byId.get(ids.get("c")!)?.dependsOn, [ids.get("a")]);
  assert.deepEqual(byId.get(ids.get("d")!)?.dependsOn, []);
  assert.deepEqual(byId.get(ids.get("e")!)?.dependsOn, [ids.get("b"), ids.get("c")].sort());
  type BranchCopy = { plan: { goals: { id: string; dependsOn: string[] }[] }; resolution: { intents: unknown[] } };
  const reordered = copy(source) as unknown as BranchCopy;
  reordered.plan.goals.reverse(); reordered.resolution.intents.reverse();
  reordered.plan.goals.find((goal: { id: string }) => goal.id === "e").dependsOn.reverse();
  assert.deepEqual(compiled(reordered), output);
  const self = copy(source) as unknown as BranchCopy; self.plan.goals[1].dependsOn = ["b"];
  rejected(self, "INVALID_DEPENDENCY");
  const duplicate = copy(source) as unknown as BranchCopy; duplicate.plan.goals[4].dependsOn = ["b", "b"];
  rejected(duplicate, "INVALID_DEPENDENCY");
});

test("coordinated plan/request substitution fails validation against retained authoritative inputs", () => {
  const current = single(), currentOutput = compiled(current);
  const other = copy(current); other.requestId = "other-request"; other.sessionId = "other-session";
  other.plan.id = "other-plan"; other.resolution.planId = "other-plan";
  other.resolution.intents[0].amount = "8";
  const substituted = compiled(other);
  assert.notEqual(substituted.strategy.id, currentOutput.strategy.id);
  assert.equal(validatePlannerStrategyBinding(substituted.binding, bindingSource(current, currentOutput)).valid, false);
  const otherIntent = copy(current); otherIntent.resolution.planId = "other-plan";
  rejected(otherIntent, "PLAN_RESULT_MISMATCH");
  const otherGoal = copy(current); otherGoal.resolution.intents[0].id = "other-goal";
  rejected(otherGoal, "GOAL_BINDING_MISMATCH");
});

test("createdAt is structural only and cannot introduce freshness or executable fields", () => {
  const source = single(), original = compiled(source);
  const eligibility = (strategy: typeof original.strategy) => evaluateStrategyContinuation({ strategy,
    account: recipient, chainId: 5042002, now: 3000 });
  for (const createdAt of [0, Number.MAX_SAFE_INTEGER]) {
    const changed = { ...source, createdAt }, result = compiled(changed);
    assert.equal(result.strategy.id, original.strategy.id);
    assert.deepEqual(result.strategy.steps, original.strategy.steps);
    assert.equal(result.binding.plan.digest, original.binding.plan.digest);
    assert.equal(result.binding.resolvedIntentsDigest, original.binding.resolvedIntentsDigest);
    assert.equal(result.executionEnabled, false);
    assert.notEqual(result.binding.strategy.digest, original.binding.strategy.digest);
    assert.deepEqual(eligibility(result.strategy), eligibility(original.strategy));
  }
  for (const createdAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])
    rejected({ ...source, createdAt }, Number.isFinite(createdAt) ? "INVALID_CREATED_AT" : "INVALID_RUNTIME");
});

test("nested mutations and second-read traps cannot change captured identity or dependencies", () => {
  const source = multi(), original = compiled(source);
  let reads = 0;
  const goal = new Proxy(source.plan.goals[1], { get() { reads++; source.plan.goals[1].dependsOn = []; throw Error("late read"); } });
  source.plan.goals[1] = goal;
  assert.deepEqual(compiled(source), original);
  assert.equal(reads, 0);
  const later = multi(), snapshot = compiled(later);
  later.plan.goals[1].dependsOn = [];
  assert.equal(validatePlannerStrategyBinding(snapshot.binding, { requestId: later.requestId, sessionId: later.sessionId,
    plan: later.plan, resolution: later.resolution, strategy: snapshot.strategy, goalSteps: snapshot.binding.goalSteps,
    provenance: (withEvidence(later) as { resolution: unknown }).resolution,
    provenanceSource: (withEvidence(later) as { provenanceSource: unknown }).provenanceSource }).valid, false);
  const symbol = multi(); Object.defineProperty(symbol.resolution.intents[0], Symbol("extra"), { value: true });
  rejected(symbol, "INVALID_RUNTIME");
});
