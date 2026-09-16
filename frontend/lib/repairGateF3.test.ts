import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifySwapConfirmation, swapStatusAfterConfirmation } from "./swapSubmissionState.ts";
import { classifyWalletFailure } from "./walletSafety.ts";

const source = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const catchStart = source.lastIndexOf("} catch (caught)");
const catchEnd = source.indexOf("} finally", catchStart);
const catchBlock = source.slice(catchStart, catchEnd);

test("Repair Gate F3: receipt-proven revert reaches confirmed failure on the RealSwapFlow path", () => {
  assert.equal(classifySwapConfirmation({ submitted: true, receiptStatus: "reverted" }), "confirmed-failure");
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "failure"), "failed");
  assert.match(source, /receiptStatus = receipt\.status/);
  assert.match(catchBlock, /const confirmationOutcome = classifySwapConfirmation\(\{ submitted, receiptStatus \}\)/);
  assert.match(catchBlock, /confirmationOutcome === "confirmed-failure" \? "reverted"/);
  assert.match(catchBlock, /setSubmissionStatus\(swapStatusAfterConfirmation\("submitted-pending", "failure"\)\)/);
  assert.match(catchBlock, /setFailure\(\{ hash: submittedHashLocal, quote \}\)/);
  const failureBranch = catchBlock.slice(catchBlock.indexOf("if (confirmationOutcome === \"confirmed-failure\")"), catchBlock.indexOf("} else if (kind === \"confirmation-unknown\")"));
  assert.doesNotMatch(failureBranch, /setUnknown/);
});

test("Repair Gate F3: receipt evidence is ordered before the unresolved-submission fallback", () => {
  assert.equal(classifySwapConfirmation({ submitted: true, receiptStatus: "success" }), "confirmed-success");
  assert.equal(classifySwapConfirmation({ submitted: true }), "submitted-unknown");
  assert.equal(classifySwapConfirmation({ submitted: false }), "not-submitted");
  assert.equal(classifyWalletFailure(new Error("confirmation polling timed out"), true), "confirmation-unknown");
  assert.equal(classifyWalletFailure(new Error("rpc unavailable"), true), "confirmation-unknown");
  assert.equal(classifyWalletFailure(new Error("execution reverted"), false), "reverted");
  assert.match(source, /const receipt = await client\.waitForTransactionReceipt\(\{ hash \}\);\s*receiptStatus = receipt\.status;\s*if \(receipt\.status !== "success"\) throw new Error\("revert"\)/);
  assert.match(source, /setSuccess\(\{/);
});

test("Repair Gate F3: confirmed failure preserves the submitted hash and offers explicit recovery", () => {
  assert.match(source, /transactionHash: submittedHashLocal/);
  const failureBlock = source.slice(source.indexOf("if (failure)"));
  assert.match(failureBlock, /data-status="confirmed-failure"/);
  assert.match(failureBlock, /failure\.hash/);
  assert.match(failureBlock, /ARC_EXPLORER_URL}\/tx\/\$\{failure\.hash\}/);
  assert.match(failureBlock, /onClick=\{reset\}/);
  assert.doesNotMatch(failureBlock, /setSuccess|Swap confirmed|recordWalletActivity|swapReceive|Actual received/);
});

test("Repair Gate F3: deterministic coverage never invokes wallet or provider writes", () => {
  const testSource = readFileSync(new URL("./repairGateF3.test.ts", import.meta.url), "utf8");
  for (const token of ["write" + "ContractAsync", "sign" + "Transaction", "eth_" + "sendTransaction"]) {
    assert.doesNotMatch(testSource, new RegExp(token));
  }
});
