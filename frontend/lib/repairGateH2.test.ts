import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress, type Address, type Hash } from "viem";

import { SUPPORTED_ASSETS } from "./assets.ts";
import { buildCanonicalReceiptText, classifyReceiptConfirmation, encodeTransferLog, findUniqueSwapReceive, verifyTransactionReceipt, type MinimalTransactionReceipt, type ReceiptVerification } from "./transactionReceipt.ts";
import type { WalletActivity } from "./wallet.ts";

const wallet = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const usdc = SUPPORTED_ASSETS[0];
const eurc = SUPPORTED_ASSETS[1];
const hashA = `0x${"ab".repeat(32)}` as Hash;
const hashB = `0x${"cd".repeat(32)}` as Hash;

function activity(overrides: Partial<WalletActivity> = {}): WalletActivity {
  return { hash: hashA, logIndex: 4, direction: "send", kind: "transfer", amount: 5_000_000n, counterparty: other, confirmedAt: 1_766_000_000_000, blockNumber: 123n, assetId: usdc.id, assetSymbol: usdc.symbol, tokenAddress: usdc.address, decimals: usdc.decimals, ...overrides };
}

function receipt(logs: MinimalTransactionReceipt["logs"] = [], overrides: Partial<MinimalTransactionReceipt> = {}): MinimalTransactionReceipt {
  return { status: "success", transactionHash: hashA, blockNumber: 123n, logs, ...overrides };
}

function transfer(overrides: Partial<{ token: Address; from: Address; to: Address; value: bigint; logIndex: number; transactionHash: Hash }> = {}) {
  return encodeTransferLog({ token: usdc.address, from: wallet, to: other, value: 5_000_000n, logIndex: 4, transactionHash: hashA, ...overrides });
}

function swapActivity(): WalletActivity {
  return activity({ kind: "swap", swapReceive: { amount: 4_990_000n, assetId: eurc.id, assetSymbol: eurc.symbol, tokenAddress: eurc.address, decimals: eurc.decimals, logIndex: 8 } });
}

function swapReceive(transactionHash: Hash = hashA) {
  return encodeTransferLog({ token: eurc.address, from: other, to: wallet, value: 4_990_000n, logIndex: 8, transactionHash });
}

function verification(overrides: Partial<ReceiptVerification> = {}): ReceiptVerification {
  return { verified: false, from: wallet, to: other, blockNumber: 123n, reason: "hash", ...overrides };
}

test("H2-01 no receipt cannot claim a terminal result", () => assert.equal(classifyReceiptConfirmation(undefined), "submitted-unknown"));

test("H2-02 matching successful receipt remains confirmed success", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer()]));
  assert.equal(result.verified, true);
  assert.equal(classifyReceiptConfirmation(result), "confirmed-success");
});

test("H2-03 matching reverted receipt remains confirmed failure", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([], { status: "reverted" }));
  assert.equal(result.reason, "status");
  assert.equal(classifyReceiptConfirmation(result), "confirmed-failure");
});

test("H2-04 unrelated successful receipt cannot confirm the selected transaction", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer({ transactionHash: hashB })], { transactionHash: hashB }));
  assert.equal(result.reason, "hash");
  assert.equal(classifyReceiptConfirmation(result), "submitted-unknown");
});

test("H2-05 unrelated reverted receipt cannot fail the selected transaction", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([], { status: "reverted", transactionHash: hashB }));
  assert.equal(result.reason, "hash");
  assert.equal(classifyReceiptConfirmation(result), "submitted-unknown");
});

test("H2-06 receipt without transaction identity cannot create terminal certainty", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer()], { status: "reverted", transactionHash: undefined }));
  assert.equal(result.reason, "hash");
  assert.equal(classifyReceiptConfirmation(result), "submitted-unknown");
});

test("H2-07 canonical hash comparison remains case-insensitive", () => {
  const upperHash = hashA.toUpperCase() as Hash;
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer({ transactionHash: upperHash })], { transactionHash: upperHash }));
  assert.equal(result.verified, true);
  assert.equal(classifyReceiptConfirmation(result), "confirmed-success");
});

test("H2-08 H1 not-submitted, unknown, success, and failure states remain distinct", () => {
  assert.equal(classifyReceiptConfirmation(undefined, false), "not-submitted");
  assert.equal(classifyReceiptConfirmation(verification()), "submitted-unknown");
  assert.equal(classifyReceiptConfirmation(verification({ verified: true }), true), "confirmed-success");
  assert.equal(classifyReceiptConfirmation(verification({ reason: "status" }), true), "confirmed-failure");
});

test("H2-09 mismatched receipt export cannot claim success or failure", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([], { status: "reverted", transactionHash: hashB }));
  const text = buildCanonicalReceiptText(activity(), result, "en");
  assert.match(text, /Status: Submitted/);
  assert.doesNotMatch(text, /Status: Confirmed(?: failure)?$/m);
});

test("H2-10 share uses the same unknown canonical text for mismatched evidence", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([], { status: "reverted", transactionHash: hashB }));
  const text = buildCanonicalReceiptText(activity(), result, "en");
  const source = readFileSync(new URL("../components/TransactionReceiptPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /navigator\.share\(\{[^}]*text: receiptText/s);
  assert.match(text, /Status: Submitted/);
  assert.doesNotMatch(text, /Status: Confirmed(?: failure)?$/m);
});

test("H2-11 unrelated receipt cannot provide swap actual received", () => {
  const swap = swapActivity();
  const result = verifyTransactionReceipt(swap, wallet, receipt([transfer({ transactionHash: hashB }), swapReceive(hashB)], { transactionHash: hashB }));
  assert.equal(result.reason, "hash");
  assert.equal(findUniqueSwapReceive(receipt([swapReceive(hashB)], { transactionHash: hashB }), { token: eurc.address, recipient: wallet, transactionHash: hashA }), undefined);
  assert.doesNotMatch(buildCanonicalReceiptText(swap, result, "en"), /Received:/);
});

test("H2-12 matching receipt actual received remains supported", () => {
  const swap = swapActivity();
  const result = verifyTransactionReceipt(swap, wallet, receipt([transfer(), swapReceive()]));
  assert.equal(result.verified, true);
  assert.match(buildCanonicalReceiptText(swap, result, "en"), /Received: 4\.99 EURC/);
});
