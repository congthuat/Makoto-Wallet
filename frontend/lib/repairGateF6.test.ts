import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifySwapConfirmation, swapBackAllowed, swapContinueAllowed, swapModalBusy, swapStatusAfterConfirmation, type SwapSubmissionStatus } from "./swapSubmissionState.ts";

const source = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const review = source.slice(source.indexOf('if (reviewStage === "swap" && quote && route)'), source.indexOf('className="create-form wallet-flow compact-swap-flow"'));
const backBody = review.match(/onBack=\{\(\) => \{([\s\S]*?)\}\}/)?.[1];
assert.ok(backBody, "Swap Review Back callback should remain explicit");
const resetBody = source.match(/function reset\(\) \{([\s\S]*?)\n  \}/)?.[1];
assert.ok(resetBody, "Swap reset callback should remain explicit");
const invalidateBody = source.match(/function invalidate\(\) \{([\s\S]*?)\n  \}/)?.[1];
assert.ok(invalidateBody, "Swap invalidate callback should remain explicit");

function invokeBack(status: SwapSubmissionStatus, executionInFlight: boolean) {
  let reviewStage: "swap" | undefined = "swap";
  let quote: unknown = { fixture: true };
  const setters = {
    setReviewStage(value: "swap" | undefined) { reviewStage = value; },
    setQuote(value: unknown) { quote = value; },
    setPolicyResult() {},
  };
  new Function(...Object.keys(setters), "submissionStatus", "swapBackAllowed", "executionInFlightRef", backBody)(...Object.values(setters), status, swapBackAllowed, { current: executionInFlight });
  return { reviewStage, quote };
}

function invokeReset(status: SwapSubmissionStatus, executionInFlight: boolean) {
  const state: { amount: string; submittedHash: unknown; submissionStatus: SwapSubmissionStatus; invalidated: boolean } = {
    amount: "1",
    submittedHash: "0xfixture",
    submissionStatus: status,
    invalidated: false,
  };
  const setters = {
    setAmount(value: string) { state.amount = value; },
    setSuccess() {},
    setSubmittedHash(value: unknown) { state.submittedHash = value; },
    setSubmissionStatus(value: SwapSubmissionStatus) { state.submissionStatus = value; },
    setUnknown() {},
    setFailure() {},
  };
  const invalidate = () => { state.invalidated = true; };
  const swapIsInFlight = () => executionInFlight || status === "submitted-pending";
  new Function(...Object.keys(setters), "invalidate", "swapIsInFlight", resetBody)(...Object.values(setters), invalidate, swapIsInFlight);
  return state;
}

test("Repair Gate F6: pre-submit Review Back remains available", () => {
  assert.equal(swapBackAllowed("not-submitted", false), true);
  const state = invokeBack("not-submitted", false);
  assert.equal(state.reviewStage, undefined);
  assert.equal(state.quote, undefined);
});

test("Repair Gate F6: final wallet handoff marks in-flight before the wallet write", () => {
  const mark = source.indexOf("executionInFlightRef.current = true;");
  const write = source.indexOf(`writer.${"write" + "ContractAsync"}(simulation.request)`);
  assert.ok(mark >= 0 && mark < write, "in-flight marker must precede the final wallet write");
  assert.match(source.slice(mark, write), /setExecutionInFlight\(true\)/);
  assert.equal(swapBackAllowed("not-submitted", true), false);
  assert.equal(swapModalBusy("not-submitted", false, false, "swap", true), true);
});

test("Repair Gate F6: wallet-awaiting-hash Back is disabled and cannot clear Review or quote", () => {
  assert.match(review, /backDisabled=\{swapLocked\}/);
  assert.match(backBody, /if \(!swapBackAllowed\(submissionStatus, executionInFlightRef\.current\)\) return;/);
  const state = invokeBack("not-submitted", true);
  assert.equal(state.reviewStage, "swap");
  assert.deepEqual(state.quote, { fixture: true });
  assert.equal(swapModalBusy("not-submitted", true, false, "swap", true), true);
});

test("Repair Gate F6: the synthetic hash race keeps the same operation authoritative", () => {
  const beforeHash = { status: "not-submitted" as const, hash: undefined, inFlight: true };
  const attemptedBack = invokeBack(beforeHash.status, beforeHash.inFlight);
  const afterHash = { status: "submitted-pending" as const, hash: `0x${"ab".repeat(32)}`, inFlight: true };
  assert.equal(attemptedBack.reviewStage, "swap");
  assert.deepEqual(attemptedBack.quote, { fixture: true });
  assert.equal(swapModalBusy(beforeHash.status, true, false, "swap", beforeHash.inFlight), true);
  assert.equal(swapModalBusy(afterHash.status, true, false, "swap", afterHash.inFlight), true);
  assert.equal(afterHash.hash.length, 66);
  assert.equal(swapContinueAllowed(afterHash.status, "swap", true), false);
});

test("Repair Gate F6: source, amount, quick amount, routing, and slippage edits are locked in flight", () => {
  const form = source.slice(source.indexOf('className="create-form wallet-flow compact-swap-flow"'));
  assert.match(form, /value=\{fromId\}[\s\S]*disabled=\{swapLocked\}/);
  assert.match(form, /<select className="asset-selector" value=\{to\.id\} disabled>/);
  assert.match(form, /value=\{amount\} disabled=\{swapLocked\}/);
  assert.match(form, /disabled=\{swapLocked \|\| balance <= 0n \|\| Boolean\(pending\)\}/);
  assert.match(form, /disabled=\{swapLocked \|\| Boolean\(pending\) \|\| !wallet\.isArc\}/);
  assert.equal((form.match(/disabled=\{swapLocked\}/g) ?? []).length >= 5, true);
  assert.match(form, /if \(swapIsInFlight\(\)\) return;[\s\S]*setFromId/);
  assert.match(form, /if \(swapIsInFlight\(\)\) return;[\s\S]*setAmount/);
  assert.match(form, /if \(swapIsInFlight\(\)\) return;[\s\S]*setMode/);
  assert.match(form, /if \(swapIsInFlight\(\)\) return;[\s\S]*setSlippage/);
  assert.match(source, /async function review\(\) \{\s*if \(swapIsInFlight\(\)\) return;/);
});

test("Repair Gate F6: reset and invalidate cannot erase an unresolved operation, while terminal reset remains available", () => {
  const pending = invokeReset("not-submitted", true);
  assert.equal(pending.amount, "1");
  assert.equal(pending.submittedHash, "0xfixture");
  assert.equal(pending.submissionStatus, "not-submitted");
  assert.equal(pending.invalidated, false);
  const submitted = invokeReset("submitted-pending", true);
  assert.equal(submitted.submittedHash, "0xfixture");
  assert.equal(submitted.submissionStatus, "submitted-pending");
  const terminal = invokeReset("confirmed", false);
  assert.equal(terminal.amount, "");
  assert.equal(terminal.submittedHash, undefined);
  assert.equal(terminal.submissionStatus, "not-submitted");
});

test("Repair Gate F6: F5, F2, F3, and success transitions remain intact", () => {
  assert.equal(swapModalBusy("submitted-pending", false, false, undefined), true);
  assert.equal(swapBackAllowed("submitted-pending", false), false);
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "unknown"), "submitted-unknown");
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "failure"), "failed");
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "success"), "confirmed");
  assert.equal(classifySwapConfirmation({ submitted: true }), "submitted-unknown");
  assert.equal(classifySwapConfirmation({ submitted: true, receiptStatus: "reverted" }), "confirmed-failure");
  assert.match(source, /setSubmittedHash\(hash\)/);
  assert.match(source, /setUnknown\(\{ hash: submittedHashLocal, quote \}\)/);
  assert.match(source, /setFailure\(\{ hash: submittedHashLocal, quote \}\)/);
  assert.match(source, /setSuccess\(\{/);
});

test("Repair Gate F6: Send Gate C and Bridge F4 remain protected with no live wallet calls", () => {
  const send = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
  const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(send, /backDisabled=\{pending\}/);
  assert.match(send, /if \(pending\) return;/);
  assert.match(bridge, /backDisabled=\{busy === "executing"\}/);
  assert.match(bridge, /if \(busy === "executing"\) return;/);
  const testSource = readFileSync(new URL("./repairGateF6.test.ts", import.meta.url), "utf8");
  for (const token of ["write" + "ContractAsync", "sign" + "Transaction", "eth_" + "sendTransaction", "kit." + "bridge", "getCircle" + "AppKit"]) {
    assert.doesNotMatch(testSource, new RegExp(token));
  }
});
