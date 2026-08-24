import assert from "node:assert/strict";
import test from "node:test";
import { arcFeeMateriallyChanged, arcFeeToUsdcAtomic, arcMaximumCost, calculateArcFee, formatArcFee, formatArcFeeEstimate, maxSendAmountAfterArcFee, sendCostWithArcFee } from "./arcFees.ts";

test("calculates Arc native fee units without mixing USDC token decimals", () => {
  assert.equal(calculateArcFee(21_000n, 1_000_000_000n).rawFee, 21_000_000_000_000n);
  assert.deepEqual(arcMaximumCost(1_500_000n, 20_000_000_000_000_000n), { amountUsdc: 1.5, feeUsdc: 0.02, totalUsdc: 1.52 });
});

test("send totals reserve Arc native fees in six-decimal USDC without truncation", () => {
  assert.equal(arcFeeToUsdcAtomic(2_584_000_000_000_000n), 2_584n);
  assert.equal(arcFeeToUsdcAtomic(1n), 1n);
  assert.deepEqual(sendCostWithArcFee(1_000_000n, 2_000_000n, 2_584_000_000_000_000n), { feeUsdc6: 2_584n, totalUsdc6: 1_002_584n, remainingUsdc6: 997_416n });
  assert.equal(sendCostWithArcFee(1_000_000n, 1_002_583n, 2_584_000_000_000_000n).remainingUsdc6, undefined);
  assert.equal(maxSendAmountAfterArcFee(1_000_000n, 2_584_000_000_000_000n), 997_416n);
  assert.equal(maxSendAmountAfterArcFee(1n, 1n), undefined);
  assert.equal(arcFeeMateriallyChanged(100n, 109n), false);
  assert.equal(arcFeeMateriallyChanged(100n, 111n), true);
});

test("formats user-facing Arc fees in USDC", () => {
  assert.equal(formatArcFee(1n), "< $0.01 USDC");
  assert.equal(formatArcFee(20_000_000_000_000_000n), "~$0.02 USDC");
  assert.equal(formatArcFee(20_000_000_000_000_000n, { maximum: true }), "≤$0.02 USDC");
  assert.throws(() => formatArcFee(-1n), RangeError);
  assert.equal(formatArcFeeEstimate(2_584_000_000_000_000n), "~0.002584 USDC");
});
