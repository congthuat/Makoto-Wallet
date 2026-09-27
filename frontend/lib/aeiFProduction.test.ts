import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createProductionAgentFlow, validateProductionReviewPresentation } from "./aeiFProduction.ts";

test("untrusted B2 objects cannot start operational reads or open Review", async () => {
  let calls = 0;
  const views: string[] = [];
  const host = { current: async () => { calls++; throw Error("must not observe host"); }, reads: {}, quotes: {} };
  const flow = createProductionAgentFlow(host, (view) => views.push(view.status));
  const hostile = new Proxy({}, { getPrototypeOf() { throw Error("hostile"); } });
  for (const source of [null, undefined, 0, "proposal", {}, hostile,
    { requestId: "copy", sessionId: "copy", plan: {}, resolution: {}, structuredInput: null }]) {
    await flow.confirm(source as never);
    await flow.openReview();
  }
  assert.equal(calls, 0);
  assert.deepEqual(views, Array(7).fill("CONFIRMATION_REVOKED"));
  flow.cancel();
  assert.equal(views.at(-1), "CANCELLED");
  await flow.openReview();
  assert.equal(calls, 0);
});

test("Review presentation schema rejects copied labels, hostile fields and execution callbacks", () => {
  const callback = { version: 1, executionEnabled: false, submit: () => undefined };
  const getter = { version: 1, executionEnabled: false };
  Object.defineProperty(getter, "account", { enumerable: true, get() { throw Error("getter"); } });
  for (const value of [null, undefined, 1, "PREPARED", {}, callback, getter,
    new Proxy({}, { ownKeys() { throw Error("proxy"); } }), Object.create({ version: 1 })])
    assert.equal(validateProductionReviewPresentation(value), false);
});

test("production composition retains B2 and uses canonical C, D, E and fresh Review boundaries", () => {
  const coordinator = readFileSync(new URL("./aeiFProduction.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  assert.match(page, /PlannerParameterConfirmControl/);
  assert.match(page, /createProductionAgentFlow/);
  assert.doesNotMatch(page, /confirmation === "AWAITING" && <PlannerParameterConfirmControl/);
  for (const name of ["createPlannerParameterEvidence", "compilePlannerStrategy", "materializePlannerStrategy",
    "createAeiDOrchestrator", "integrateAeiDOperationalState", "validateAeiEReviewEligibility"])
    assert.match(coordinator, new RegExp(`${name}\\(`));
  assert.match(coordinator, /isLiveConfirmedPlannerSource/);
  assert.match(coordinator, /action\.dependsOnStepIds\.length === 0/);
  assert.match(coordinator, /mapped !== e \|\| envelope !== d/);
  for (const pattern of [/personal_sign/, /eth_sendTransaction/, /\.sendTransaction\(/, /\.writeContract\(/,
    /\.signMessage\(/, /\.signTypedData\(/, /\.submitReviewed\(/, /useWalletClient/, /useWriteContract/,
    /runReadTool\(/, /runQuoteTool\(/, /runPrepareTool\(/, /transaction\.receipt/])
    assert.doesNotMatch(coordinator, pattern);
});
