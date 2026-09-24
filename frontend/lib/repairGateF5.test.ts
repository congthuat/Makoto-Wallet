import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifySwapConfirmation, swapBackAllowed, swapContinueAllowed, swapModalBusy, swapStatusAfterConfirmation, type SwapSubmissionStatus } from "./swapSubmissionState.ts";

const source = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const finalReview = source.slice(source.indexOf('walletNotice=""'), source.indexOf('className="create-form wallet-flow compact-swap-flow"'));
const backMatch = finalReview.match(/backDisabled=\{swapLocked\}\s+onBack=\{\(\) => \{([\s\S]*?)\n\s*\}\}/);
assert.ok(backMatch, "Swap Review should expose the pending Back guard");
const backBody = backMatch[1];

function invokeBack(status: SwapSubmissionStatus) {
  let reviewStage: "swap" | undefined = "swap";
  let quote: unknown = { fixture: true };
  const setters = {
    setReviewStage(value: "swap" | undefined) { reviewStage = value; },
    setQuote(value: unknown) { quote = value; },
    setPolicyResult() {},
  };
  new Function(...Object.keys(setters), "submissionStatus", "swapBackAllowed", "executionInFlightRef", backBody)(...Object.values(setters), status, swapBackAllowed, { current: status === "submitted-pending" });
  return { reviewStage, quote };
}

test("Repair Gate F5: pre-submit Swap Review Back remains available", () => {
  assert.equal(swapBackAllowed("not-submitted"), true);
  const state = invokeBack("not-submitted");
  assert.equal(state.reviewStage, undefined);
  assert.equal(state.quote, undefined);
  assert.match(finalReview, /backDisabled=\{swapLocked\}/);
});

test("Repair Gate F5: submitted-pending is authoritative modal protection", () => {
  const oldBusyPredicate = (pending: boolean, hasApprovalReview: boolean, reviewStage: "approval" | "swap" | undefined) => Boolean(pending && (hasApprovalReview || reviewStage));
  assert.equal(oldBusyPredicate(true, false, undefined), false, "the pre-F5 predicate released protection after Back cleared Review");
  assert.equal(swapModalBusy("submitted-pending", false, false, undefined), true);
  assert.equal(swapModalBusy("submitted-pending", true, false, "swap"), true);
  assert.equal(swapModalBusy("submitted-unknown", false, false, undefined), false);
  assert.equal(swapModalBusy("confirmed", false, false, undefined), false);
});

test("Repair Gate F5: pending Swap Back is disabled and defensively inert", () => {
  assert.equal(swapBackAllowed("submitted-pending"), false);
  const state = invokeBack("submitted-pending");
  assert.equal(state.reviewStage, "swap");
  assert.deepEqual(state.quote, { fixture: true });
  assert.match(backBody, /if \(!swapBackAllowed\(submissionStatus, executionInFlightRef\.current\)\) return;/);
});

test("Repair Gate F5: unresolved submission remains blocked from a second wallet write", () => {
  let writes = 0;
  if (swapContinueAllowed("submitted-pending", "swap", false)) writes += 1;
  if (swapContinueAllowed("submitted-unknown", "swap", false)) writes += 1;
  assert.equal(writes, 0);
  assert.match(source, /if \(submittedHash \|\| !swapContinueAllowed\(submissionStatus, reviewStage, Boolean\(pending\)\)\) return/);
  assert.match(source, /setSubmittedHash\(hash\)/);
});

test("Repair Gate F5: F2/F3 and success terminal transitions remain unchanged", () => {
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "unknown"), "submitted-unknown");
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "failure"), "failed");
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "success"), "confirmed");
  assert.equal(classifySwapConfirmation({ submitted: true }), "submitted-unknown");
  assert.equal(classifySwapConfirmation({ submitted: true, receiptStatus: "reverted" }), "confirmed-failure");
  assert.match(source, /setUnknown\(\{ hash: submittedHashLocal, quote \}\)/);
  assert.match(source, /setFailure\(\{ hash: submittedHashLocal, quote \}\)/);
  assert.match(source, /setSuccess\(\{/);
  assert.match(source, /onClick=\{reset\}/);
});

test("Repair Gate F5: shared Review, Send Gate C and Bridge F4 contracts remain intact", () => {
  const review = readFileSync(new URL("../components/TransactionSafetyReview.tsx", import.meta.url), "utf8");
  const send = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
  const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(review, /backDisabled = false/);
  assert.match(send, /backDisabled=\{pending\}/);
  assert.match(send, /if \(pending\) return;/);
  assert.match(bridge, /backDisabled=\{busy === "executing"\}/);
  assert.match(bridge, /if \(busy === "executing"\) return;/);
});

test("Repair Gate F5: deterministic coverage performs no wallet/provider operation", () => {
  const testSource = readFileSync(new URL("./repairGateF5.test.ts", import.meta.url), "utf8");
  for (const token of ["write" + "ContractAsync", "sign" + "Transaction", "eth_" + "sendTransaction", "kit." + "bridge", "getCircle" + "AppKit"]) {
    assert.doesNotMatch(testSource, new RegExp(token));
  }
});
