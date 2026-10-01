import assert from "node:assert/strict";
import test from "node:test";
import { confirmThenRefresh } from "./confirmedTransaction.ts";

test("does not show success or refresh before the receipt resolves", async () => {
  let resolveReceipt!: (receipt: { status: "success" }) => void;
  const receipt = new Promise<{ status: "success" }>((resolve) => { resolveReceipt = resolve; });
  let confirmed = false;
  let refreshed = false;
  const completion = confirmThenRefresh({ receipt, onConfirmed: () => { confirmed = true; }, refresh: async () => { refreshed = true; } });
  await Promise.resolve();
  assert.equal(confirmed, false);
  assert.equal(refreshed, false);
  resolveReceipt({ status: "success" });
  await completion;
  assert.equal(confirmed, true);
});

test("confirmed receipt shows success without waiting for background refresh", async () => {
  let finishRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
  const events: string[] = [];
  let refreshFinished = false;
  await confirmThenRefresh({ receipt: Promise.resolve({ status: "success" as const }), onConfirmed: () => events.push("success"), refresh: async () => { events.push("refresh"); await refresh; refreshFinished = true; } });
  assert.deepEqual(events, ["success", "refresh"]);
  assert.equal(refreshFinished, false);
  finishRefresh();
});

test("background refresh failure is handled and cannot reverse confirmation", async () => {
  const errors: unknown[] = [];
  let confirmed = false;
  await confirmThenRefresh({ receipt: Promise.resolve({ status: "success" as const }), onConfirmed: () => { confirmed = true; }, refresh: async () => { throw new Error("RPC unavailable"); }, onRefreshError: (error) => errors.push(error) });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(confirmed, true);
  assert.equal(errors.length, 1);
});

test("reverted receipt remains failure and never refreshes", async () => {
  let confirmed = false;
  let refreshed = false;
  await assert.rejects(confirmThenRefresh({ receipt: Promise.resolve({ status: "reverted" as const }), onConfirmed: () => { confirmed = true; }, refresh: async () => { refreshed = true; } }), /revert/);
  assert.equal(confirmed, false);
  assert.equal(refreshed, false);
});

test("confirmed callback retains the authoritative transaction hash", async () => {
  const hash = "0x1234";
  let retainedHash: string | undefined;
  await confirmThenRefresh({ receipt: Promise.resolve({ status: "success" as const, transactionHash: hash }), onConfirmed: (receipt) => { retainedHash = receipt.transactionHash; }, refresh: async () => undefined });
  assert.equal(retainedHash, hash);
});
