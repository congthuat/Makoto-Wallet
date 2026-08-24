import assert from "node:assert/strict";
import test from "node:test";
import type { Hash, TransactionReceipt } from "viem";
import { arcTransactionGuidance, pollArcTransaction, transitionArcTransaction } from "./arcTransactionLifecycle.ts";

const hash = `0x${"1".repeat(64)}` as Hash;
const receipt = (status: "success" | "reverted") => ({ status, transactionHash: hash }) as TransactionReceipt;

test("lifecycle moves through signature, submission and pending without confirmation counts", () => {
  const signing = transitionArcTransaction({ stage: "preparing", retrySafe: true }, { type: "signature-requested" });
  const submitted = transitionArcTransaction(signing, { type: "submitted", hash });
  assert.equal(signing.stage, "awaiting-signature");
  assert.equal(submitted.stage, "submitted");
  assert.equal(transitionArcTransaction(submitted, { type: "pending" }).stage, "pending");
});

test("receipt polling returns final success and reverted states", async () => {
  for (const status of ["success", "reverted"] as const) {
    const result = await pollArcTransaction({ hash, getReceipt: async () => receipt(status), wait: async () => undefined });
    assert.equal(result.stage, status === "success" ? "final-success" : "final-reverted");
  }
});

test("receipt polling reports dropped timeout and RPC errors without automatic retry", async () => {
  let clock = 0;
  const dropped = await pollArcTransaction({ hash, getReceipt: async () => null, timeoutMs: 2, now: () => clock++, wait: async () => undefined });
  assert.equal(dropped.stage, "dropped");
  assert.match(arcTransactionGuidance(dropped), /ArcScan before retrying/);
  const failed = await pollArcTransaction({ hash, getReceipt: async () => { throw new Error("offline"); }, wait: async () => undefined });
  assert.equal(failed.stage, "rpc-error");
  assert.equal(failed.retrySafe, false);
});
