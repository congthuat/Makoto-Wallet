import assert from "node:assert/strict";
import test from "node:test";

import { addressToBytes32, calculateCctpForwardingAmounts } from "./cctp.ts";

test("CCTP forwarding total includes the forwarding fee", () => {
  const amounts = calculateCctpForwardingAmounts(10_000_000n, {
    finalityThreshold: 2000,
    minimumFee: 0,
    forwardFeeMed: "57543",
    quotedAt: Date.now(),
  });
  assert.equal(amounts.protocolFee, 0n);
  assert.equal(amounts.forwardingFee, 57_543n);
  assert.equal(amounts.totalAmount, 10_057_543n);
});

test("CCTP decimal basis points are calculated without floating token math", () => {
  const amounts = calculateCctpForwardingAmounts(10_000_000n, {
    finalityThreshold: 2000,
    minimumFee: 1.3,
    forwardFeeMed: "50000",
    quotedAt: Date.now(),
  });
  assert.equal(amounts.protocolFee, 1_300n);
  assert.equal(amounts.maxFee, 51_300n);
});

test("EVM recipients are padded to CCTP bytes32", () => {
  assert.equal(
    addressToBytes32("0x1111111111111111111111111111111111111111"),
    "0x0000000000000000000000001111111111111111111111111111111111111111",
  );
});
