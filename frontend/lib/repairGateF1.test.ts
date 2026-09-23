import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bridgeContinueAllowed, bridgeReviewIsActionable } from "./bridgeTerminalState.ts";

const estimate = {} as Parameters<typeof bridgeReviewIsActionable>[1];
const review = {} as Parameters<typeof bridgeReviewIsActionable>[2];
const result = {} as Parameters<typeof bridgeReviewIsActionable>[0];

test("Repair Gate F1: Review is visible before Bridge submission", () => {
  assert.equal(bridgeReviewIsActionable(undefined, estimate, review), true);
  assert.equal(bridgeContinueAllowed(undefined, false, estimate, review), true);
});

test("Repair Gate F1: successful Bridge result owns the surface over stale Review state", () => {
  assert.equal(bridgeReviewIsActionable(result, estimate, review), false);
});

test("Repair Gate F1: stale Review cannot reach Continue after terminal success", () => {
  assert.equal(bridgeContinueAllowed(result, false, estimate, review), false);
  assert.equal(bridgeContinueAllowed(result, true, estimate, review), false);
});

test("Repair Gate F1: deterministic callback instrumentation reaches Continue once before success and zero times after", () => {
  let callbacks = 0;
  const continueFromReview = (terminalResult: typeof result | undefined) => {
    if (bridgeContinueAllowed(terminalResult, false, estimate, review)) callbacks += 1;
  };
  continueFromReview(undefined);
  assert.equal(callbacks, 1);
  continueFromReview(result);
  assert.equal(callbacks, 1);
});

test("Repair Gate F1: result evidence is retained until the explicit reset path", () => {
  const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(bridge, /setResult\(confirmed\)/);
  assert.match(bridge, /\{result \? \(/);
  assert.match(bridge, /onClick=\{invalidate\}/);
});

test("Repair Gate F1: reset permits a new Bridge flow", () => {
  assert.equal(bridgeReviewIsActionable(undefined, undefined, undefined), false);
  assert.equal(bridgeContinueAllowed(undefined, false, undefined, undefined), false);
});

test("Repair Gate F1: failed Bridge execution keeps its existing error path", () => {
  const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(bridge, /setStages\(\(old\) => \[\.\.\.old, "failed"\]\)/);
  assert.match(bridge, /setError\(sanitizeBridgeError\(e\)\)/);
  assert.match(bridge, /\{error && \(/);
});

test("Repair Gate F1: execution still uses the existing reviewed Bridge parameters", () => {
  const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(bridge, /reviewSnapshot\.fingerprint/);
  assert.match(bridge, /kit\.bridge\(makeBridgeParams\(adapter, estimate\.source, estimate\.destination, estimate\.amount, estimate\.recipient, estimate\.speed\)\)/);
  assert.match(bridge, /submissionGuard\.current\.run/);
});

test("Repair Gate F1: result precedence is owned by Bridge lifecycle code", () => {
  const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(bridge, /bridgeReviewIsActionable\(result, estimate, reviewSnapshot\)/);
  assert.match(bridge, /bridgeContinueAllowed\(result, lock\.current, estimate, reviewSnapshot\)/);
  assert.doesNotMatch(bridge, /TransactionSafetyReview[\s\S]*result\?\.status/);
});
