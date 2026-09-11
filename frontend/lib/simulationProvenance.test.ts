import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(name: string) {
  return readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
}

function ordered(text: string, before: string, after: string) {
  assert.ok(text.indexOf(before) >= 0, `missing ${before}`);
  assert.ok(text.indexOf(after) >= 0, `missing ${after}`);
  assert.ok(text.indexOf(before) < text.indexOf(after), `${before} must precede ${after}`);
}

test("Create Jar binds passed evidence only after exact-request simulation", () => {
  const text = source("CreateJarFlow.tsx");
  assert.match(text, /publicClient\.call\(\{ account: intent\.account, to: intent\.target, data: intent\.calldata, value: intent\.value \}\)/);
  ordered(text, "await simulateIntent(intent);", "return prepareFlowReview(intent");
  ordered(text, "await simulateIntent(reviewedIntent);", "revalidateTransactionReview(reviewSnapshot");
});

test("Vault approval and deposit simulate before review binding and final revalidation", () => {
  const text = source("OwnerDepositFlow.tsx");
  ordered(text, "await simulateIntent(approval);", "const approvalSnapshot = prepareFlowReview(approval");
  ordered(text, "await simulateIntent(intent);", "const checked = revalidateTransactionReview(reviewSnapshot");
  assert.match(text, /const approvalChecked = revalidateTransactionReview\(approvalSnapshot/);
});

test("Vault withdrawal simulates the exact request before review and wallet write", () => {
  const text = source("OwnerWithdrawalFlow.tsx");
  assert.match(text, /publicClient\.call\(\{ account: intent\.account, to: intent\.target, data: intent\.calldata, value: intent\.value \}\)/);
  ordered(text, "await simulateIntent(intent);", "setReviewSnapshot(prepareFlowReview(intent");
  ordered(text, "await simulateIntent(intent);", "const checked = revalidateTransactionReview(reviewSnapshot");
});

test("Direct CCTP approval and burn revalidate after actual simulation", () => {
  const text = source("CctpBridgeFlow.tsx");
  ordered(text, "await simulateIntent(approval);", "const approvalSnapshot = prepareFlowReview(approval");
  ordered(text, "client.simulateContract({ address: usdc.address", "const approvalChecked = revalidateTransactionReview(approvalSnapshot");
  ordered(text, "await simulateIntent(intent);", "const checked = revalidateTransactionReview(reviewSnapshot");
});

test("Send binds passed evidence only after exact simulation and revalidates after final simulation", () => {
  const text = source("SendFlow.tsx");
  assert.doesNotMatch(text, /simulation:\s*feeEstimate\.status\s*===\s*"ready"\s*\?\s*"passed"/);
  assert.match(text, /const simulationPassed = Boolean\(reviewSnapshot && safetyIntent && reviewSnapshot\.fingerprint === transactionFingerprint\(safetyIntent\)\)/);
  ordered(text, "await simulateSendIntent(intent);", "simulation: \"passed\"");
  ordered(text, "setReviewSnapshot(undefined);", "await simulateSendIntent(intent);");
  ordered(text, "await simulateSendIntent(finalIntent);", "const finalRevalidation = revalidateTransactionReview(reviewSnapshot");
  ordered(text, "const finalRevalidation = revalidateTransactionReview(reviewSnapshot", "writer.writeContractAsync");
});

test("Swap approval and swap reviews simulate before passed evidence and revalidate after final simulation", () => {
  const text = source("RealSwapFlow.tsx");
  const reviewText = text.slice(text.indexOf("async function review"));
  ordered(reviewText, "await client.simulateContract({", "setApprovalReview(");
  ordered(reviewText, "await client.simulateContract({", "setSwapReview(");
  ordered(text, "await client.simulateContract(preparedRequest)", "simulatedReview = revalidateTransactionReview(swapReview");
  ordered(text, "simulatedReview = revalidateTransactionReview(swapReview", "writer.writeContractAsync(simulation.request)");
  assert.ok(text.indexOf("args: [XYLO_ROUTER, approval]") < text.indexOf("const simulatedApproval = revalidateTransactionReview(approvalReview"));
});
