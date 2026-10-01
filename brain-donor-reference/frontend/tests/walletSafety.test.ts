import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyWalletFailure, isLargeSend } from "./walletSafety.ts";

describe("classifyWalletFailure", () => {
  it("finds a nested 4001 wallet rejection", () => {
    assert.equal(classifyWalletFailure({ cause: { data: { originalError: { code: 4001 } } } }), "rejected");
  });

  it("classifies common pre-submission failures", () => {
    assert.equal(classifyWalletFailure(new Error("Unsupported chain: wrong network")), "wrong-network");
    assert.equal(classifyWalletFailure(new Error("insufficient funds for gas * price + value")), "insufficient-gas");
    assert.equal(classifyWalletFailure(new Error("execution reverted during simulation")), "reverted");
    assert.equal(classifyWalletFailure(new Error("RPC request timed out")), "rpc");
  });

  it("treats every error after a hash as unknown confirmation status", () => {
    assert.equal(classifyWalletFailure({ code: 4001 }, true), "confirmation-unknown");
  });
});

describe("isLargeSend", () => {
  it("requires acknowledgement at half the balance and above", () => {
    assert.equal(isLargeSend(49n, 100n), false);
    assert.equal(isLargeSend(50n, 100n), true);
    assert.equal(isLargeSend(100n, 100n), true);
  });

  it("handles zero values safely", () => {
    assert.equal(isLargeSend(0n, 100n), false);
    assert.equal(isLargeSend(1n, 0n), false);
  });

  it("applies the same threshold to EURC balances", () => {
    assert.equal(isLargeSend(6_000_000n, 10_000_000n), true);
  });
});
