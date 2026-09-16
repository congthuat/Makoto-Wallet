import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
const review = readFileSync(new URL("../components/TransactionSafetyReview.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/SwapPanel.tsx", import.meta.url), "utf8");
const invalidateMatch = bridge.match(/const invalidate = \(\) => \{([\s\S]*?)\n  \};/);
assert.ok(invalidateMatch, "Bridge invalidate callback should remain explicit");
const invalidateBody = invalidateMatch[1];
const reviewBlock = bridge.slice(bridge.indexOf("<TransactionSafetyReview"), bridge.indexOf("</TransactionSafetyReview>"));

function runInvalidate(initialBusy: "review" | "executing") {
  let busy = initialBusy;
  let estimate: unknown = { fixture: true };
  let reviewSnapshot: unknown = { fixture: true };
  let result: unknown = undefined;
  let error: unknown = "fixture error";
  const setters = {
    setEstimate(value: unknown) { estimate = value; },
    setReviewSnapshot(value: unknown) { reviewSnapshot = value; },
    setResult(value: unknown) { result = value; },
    setError(value: unknown) { error = value; },
    setBusy(value: "idle") { busy = value; },
  };
  new Function(...Object.keys(setters), "busy", invalidateBody)(...Object.values(setters), busy);
  return { busy, estimate, reviewSnapshot, result, error, setters };
}

test("Repair Gate F4: Bridge Review Back remains available before execution", () => {
  assert.match(reviewBlock, /backDisabled=\{busy === "executing"\}/);
  assert.match(reviewBlock, /onBack=\{invalidate\}/);
  const state = runInvalidate("review");
  assert.equal(state.busy, "idle");
  assert.equal(state.reviewSnapshot, undefined);
  assert.equal(state.estimate, undefined);
});

test("Repair Gate F4: executing Bridge Back is disabled and the callback is defensively inert", () => {
  assert.match(reviewBlock, /backDisabled=\{busy === "executing"\}/);
  assert.match(reviewBlock, /continueDisabled=\{busy === "executing"\}/);
  assert.match(invalidateBody, /if \(busy === "executing"\) return;/);
  const state = runInvalidate("executing");
  assert.equal(state.busy, "executing");
  assert.notEqual(state.reviewSnapshot, undefined);
  assert.notEqual(state.estimate, undefined);
});

test("Repair Gate F4: execution remains modal-protected while Bridge is pending", () => {
  assert.match(bridge, /onBusyChange\(busy === "executing"\)/);
  assert.match(panel, /closeDisabled=\{busy\}/);
  assert.match(reviewBlock, /backDisabled=\{busy === "executing"\}/);
  assert.match(reviewBlock, /continueDisabled=\{busy === "executing"\}/);
  const executing = runInvalidate("executing");
  assert.equal(executing.busy === "executing", true);
});

test("Repair Gate F4: F1 terminal result and existing failure/reset paths remain owned by Bridge", () => {
  assert.match(bridge, /setResult\(confirmed\)/);
  assert.match(bridge, /\{result \? \(/);
  assert.match(bridge, /onClick=\{invalidate\}/);
  assert.match(bridge, /setStages\(\(old\) => \[\.\.\.old, "failed"\]\)/);
  assert.match(bridge, /setError\(sanitizeBridgeError\(e\)\)/);
  assert.match(bridge, /bridgeReviewIsActionable\(result, estimate, reviewSnapshot\)/);
  assert.match(bridge, /bridgeContinueAllowed\(result, lock\.current, estimate, reviewSnapshot\)/);
});

test("Repair Gate F4: shared Review and Send Gate C contracts remain unchanged", () => {
  assert.match(review, /backDisabled = false/);
  assert.equal((review.match(/onClick=\{onBack\} disabled=\{backDisabled\}/g) ?? []).length, 2);
  const send = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
  assert.match(send, /backDisabled=\{pending\}/);
  assert.match(send, /if \(pending\) return;/);
});

test("Repair Gate F4: deterministic coverage performs no wallet or provider operation", () => {
  const testSource = readFileSync(new URL("./repairGateF4.test.ts", import.meta.url), "utf8");
  for (const token of ["write" + "ContractAsync", "sign" + "Transaction", "eth_" + "sendTransaction", "kit." + "bridge", "getCircle" + "AppKit"]) {
    assert.doesNotMatch(testSource, new RegExp(token));
  }
});
