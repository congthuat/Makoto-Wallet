import assert from "node:assert/strict";
import test from "node:test";
import { arcMaximumCost, calculateArcFee, formatArcFee } from "./arcFees.ts";

test("calculates Arc native fee units without mixing USDC token decimals", () => {
  assert.equal(calculateArcFee(21_000n, 1_000_000_000n).rawFee, 21_000_000_000_000n);
  assert.deepEqual(arcMaximumCost(1_500_000n, 20_000_000_000_000_000n), { amountUsdc: 1.5, feeUsdc: 0.02, totalUsdc: 1.52 });
});

test("formats user-facing Arc fees in USDC", () => {
  assert.equal(formatArcFee(1n), "< $0.01 USDC");
  assert.equal(formatArcFee(20_000_000_000_000_000n), "~$0.02 USDC");
  assert.equal(formatArcFee(20_000_000_000_000_000n, { maximum: true }), "≤$0.02 USDC");
  assert.throws(() => formatArcFee(-1n), RangeError);
});
