import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPlannerDataJSON } from "./plannerStrategyBinding.ts";
import { isLiveConfirmedPlannerSource } from "./plannerConfirmationAuthority.ts";
import { createPlannerParameterEvidence } from "./plannerParameterEvidence.ts";
import { materializePlannerStrategy, validateStrategyMaterialization } from "./strategyMaterialization.ts";
import { createAeiDOrchestrator, validateAeiDOperationalEnvelope } from "./aeiDOrchestration.ts";
import { integrateAeiDOperationalState, validateAeiEReviewEligibility } from "./agentTransition.ts";
import { createProductionAgentFlow, validateProductionReviewPresentation } from "./aeiFProduction.ts";

const digest = `0x${"a".repeat(64)}`;
const malformed = () => {
  const accessor = {};
  Object.defineProperty(accessor, "version", { enumerable: true, get() { throw Error("getter"); } });
  const symbol = { version: 1 };
  Object.defineProperty(symbol, Symbol("hidden"), { value: true });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  return [null, undefined, 0, true, "PREPARED", [], {}, accessor, symbol, cycle,
    Object.create({ version: 1 }), new Proxy({}, { ownKeys() { throw Error("proxy"); } }),
    { version: 1, digest: "malformed" }, { version: 1, digest, executionEnabled: true }];
};

test("hostile inputs fail closed across live B2, C, D, E and F authority boundaries", async () => {
  let observations = 0;
  const host = { current: async () => { observations++; throw Error("host should not be reached"); }, reads: {}, quotes: {} };
  const orchestrator = createAeiDOrchestrator(host);
  for (const input of malformed()) {
    assert.equal(isLiveConfirmedPlannerSource(input), false);
    assert.equal(createPlannerParameterEvidence(input).valid, false);
    assert.notEqual(materializePlannerStrategy(input).status, "MATERIALIZED");
    assert.equal(validateStrategyMaterialization(input, input).valid, false);
    assert.equal((await orchestrator.orchestrate(input as never)).envelope, undefined);
    assert.equal(await validateAeiDOperationalEnvelope(input, input), false);
    assert.equal((await integrateAeiDOperationalState(input)).status, "REJECTED");
    assert.equal((await validateAeiEReviewEligibility(input)).eligible, false);
    assert.equal(validateProductionReviewPresentation(input), false);
  }
  assert.equal(observations, 0);
});

test("bounded canonical property permutation preserves object meaning but not ordered arrays", () => {
  const fields = ["requestId", "sessionId", "strategyId", "actionStepId", "account", "chainId"];
  let seed = 0x5eedae1;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const base = Object.fromEntries(fields.map((key, index) => [key, index + 1]));
  const expected = canonicalPlannerDataJSON(base);
  for (let trial = 0; trial < 64; trial++) {
    const order = [...fields];
    for (let i = order.length - 1; i > 0; i--) { const j = next() % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const variant = Object.fromEntries(order.map((key) => [key, base[key]]));
    assert.equal(canonicalPlannerDataJSON(variant), expected);
    const mutated = { ...variant, [fields[next() % fields.length]]: -trial - 1 };
    assert.notEqual(canonicalPlannerDataJSON(mutated), expected);
  }
  assert.notEqual(canonicalPlannerDataJSON({ dependencies: ["A", "B"] }),
    canonicalPlannerDataJSON({ dependencies: ["B", "A"] }));
});

test("reentrant cancellation and duplicate untrusted B2 cannot reach host or Review", async () => {
  let observations = 0;
  const views: string[] = [];
  const host = { current: async () => { observations++; throw Error("host should not be reached"); }, reads: {}, quotes: {} };
  const flow = createProductionAgentFlow(host, (view) => {
    views.push(view.status);
    if (view.status === "CONFIRMATION_REVOKED" && views.length === 1) flow.cancel();
  });
  const forged = { requestId: "request", sessionId: "session", structuredInput: { proposalDigest: digest },
    confirmed: true, executionEnabled: false };
  await flow.confirm(forged as never);
  await flow.confirm(forged as never);
  await flow.openReview();
  assert.equal(observations, 0);
  assert.deepEqual(views, ["CONFIRMATION_REVOKED", "CANCELLED", "CONFIRMATION_REVOKED"]);
  assert.ok(!views.includes("REVIEW_ELIGIBLE"));
});
