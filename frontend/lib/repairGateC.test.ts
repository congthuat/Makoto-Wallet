import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const send = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
const review = readFileSync(new URL("../components/TransactionSafetyReview.tsx", import.meta.url), "utf8");

function productionBack(initialStage: "awaiting" | "confirming" | "idle") {
  const match = send.match(/onBack=\{\(\) => \{([\s\S]*?)\}\}\s*onContinue=/);
  assert.ok(match, "Send Review Back callback should remain explicit");
  let reviewing = true;
  const pending = initialStage === "awaiting" || initialStage === "confirming";
  let stage: "awaiting" | "confirming" | "idle" = initialStage;
  new Function("pending", "setReviewing", "setStage", match[1])(pending, (value: boolean) => { reviewing = value; }, (value: typeof stage) => { stage = value; });
  return { reviewing, stage };
}

test("Repair Gate C: shared Review exposes caller-controlled Back disabling", () => {
  assert.match(review, /backDisabled = false/);
  assert.match(review, /onClick=\{onBack\} disabled=\{backDisabled\}/g);
  assert.equal((review.match(/onClick=\{onBack\} disabled=\{backDisabled\}/g) ?? []).length, 2);
  assert.doesNotMatch(review, /pending|SendFlow/);
});

test("Repair Gate C: Send disables Review Back during awaiting and confirming", () => {
  assert.match(send, /const pending = stage === "awaiting" \|\| stage === "confirming"/);
  assert.match(send, /backDisabled=\{pending\}/);
  assert.match(send, /if \(pending\) return;/);
});

for (const stage of ["awaiting", "confirming"] as const) {
  test(`Repair Gate C: Back cannot reset ${stage} to idle`, () => {
    const result = productionBack(stage);
    assert.equal(result.reviewing, true);
    assert.equal(result.stage, stage);
    assert.match(send, new RegExp(`stage === "${stage}"`));
  });
}

test("Repair Gate C: Back still returns editable Review to the form", () => {
  const result = productionBack("idle");
  assert.equal(result.reviewing, false);
  assert.equal(result.stage, "idle");
  assert.match(send, /setReviewing\(false\);\s*setStage\("idle"\);/);
});

test("Repair Gate C: Send keeps modal close protection tied to pending lifecycle", () => {
  assert.match(send, /<WalletPanel title=\{copy\.title\} onClose=\{onClose\} closeDisabled=\{pending\}>/);
  assert.match(send, /continueDisabled=\{pending \|\|/);
});

test("Repair Gate C: wallet resolution paths remain unchanged", () => {
  for (const marker of ["setStage(\"awaiting\")", "setStage(\"confirming\")", "setStage(\"confirmed\")", "setStage(\"failed\")", "\"unknown\"", "writeContractAsync", "waitForTransactionReceipt"]) assert.ok(send.includes(marker), marker);
});

test("Repair Gate C: non-pending Review callers retain default Back behavior", () => {
  assert.match(review, /backDisabled\?: boolean/);
  for (const file of ["CctpBridgeFlow.tsx", "CreateJarFlow.tsx", "OwnerDepositFlow.tsx", "OwnerWithdrawalFlow.tsx"]) {
    const source = readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /backDisabled=/, file);
  }
  const swap = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
  assert.match(swap, /backDisabled=\{swapLocked\}/);
  const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(bridge, /backDisabled=\{busy === "executing"\}/);
});

test("Repair Gate C: no new provider call or submission was added", () => {
  const before = send.slice(0, send.indexOf("function productionBack"));
  assert.doesNotMatch(before, /navigator\.wallet|eth_sendTransaction|signMessage/);
  assert.equal((send.match(/writeContractAsync/g) ?? []).length, 2);
});
