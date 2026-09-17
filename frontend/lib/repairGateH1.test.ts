import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress, type Address, type Hash } from "viem";

import { SUPPORTED_ASSETS } from "./assets.ts";
import { formatAgentActionResult } from "./agent/resultFormatter.ts";
import { buildCanonicalReceiptText, classifyReceiptConfirmation, encodeTransferLog, verifyTransactionReceipt, type MinimalTransactionReceipt, type ReceiptVerification } from "./transactionReceipt.ts";
import type { WalletActivity } from "./wallet.ts";

const wallet = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const usdc = SUPPORTED_ASSETS[0];
const hash = `0x${"ab".repeat(32)}` as Hash;

function activity(overrides: Partial<WalletActivity> = {}): WalletActivity {
  return { hash, logIndex: 4, direction: "send", kind: "transfer", amount: 5_000_000n, counterparty: other, confirmedAt: 1_766_000_000_000, blockNumber: 123n, assetId: usdc.id, assetSymbol: usdc.symbol, tokenAddress: usdc.address, decimals: usdc.decimals, ...overrides };
}
function receipt(logs: MinimalTransactionReceipt["logs"], overrides: Partial<MinimalTransactionReceipt> = {}): MinimalTransactionReceipt {
  return { status: "success", transactionHash: hash, blockNumber: 123n, logs, ...overrides };
}
function transfer(overrides: Partial<{ token: Address; from: Address; to: Address; value: bigint; logIndex: number; transactionHash: Hash }> = {}) {
  return encodeTransferLog({ token: usdc.address, from: wallet, to: other, value: 5_000_000n, logIndex: 4, transactionHash: hash, ...overrides });
}
function verification(overrides: Partial<ReceiptVerification> = {}): ReceiptVerification {
  return { verified: true, from: wallet, to: other, blockNumber: 123n, ...overrides };
}

test("H1-01 not-submitted is never a receipt success", () => assert.equal(classifyReceiptConfirmation(undefined, false), "not-submitted"));
test("H1-02 a submitted hash without evidence is unknown", () => assert.equal(classifyReceiptConfirmation(undefined), "submitted-unknown"));
test("H1-03 a matched receipt is confirmed success", () => assert.equal(classifyReceiptConfirmation(verification()), "confirmed-success"));
test("H1-04 a reverted receipt is confirmed failure", () => assert.equal(classifyReceiptConfirmation(verification({ verified: false, reason: "status" })), "confirmed-failure"));
test("H1-05 a mismatched receipt stays unknown", () => assert.equal(classifyReceiptConfirmation(verification({ verified: false, reason: "transfer-missing" })), "submitted-unknown"));

test("H1-06 canonical success text says Confirmed", () => assert.match(buildCanonicalReceiptText(activity(), verification(), "en"), /Status: Confirmed/));
test("H1-07 canonical failure text says Confirmed failure", () => { const text = buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "status" }), "en"); assert.match(text, /Status: Confirmed failure/); assert.doesNotMatch(text, /Status: Confirmed$/m); });
test("H1-08 canonical unknown text says submitted and unknown", () => { const text = buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "transfer-missing" }), "en"); assert.match(text, /Status: Submitted — confirmation status unknown/); });
test("H1-09 unknown export never claims confirmed success", () => assert.doesNotMatch(buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "hash" }), "en"), /Status: Confirmed(?:$|\n)/));
test("H1-10 failure export never claims successful confirmation", () => assert.doesNotMatch(buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "status" }), "en"), /Status: Confirmed\n/));

const swap = activity({ kind: "swap", swapReceive: { amount: 4_990_000n, assetId: "eurc", assetSymbol: "EURC", tokenAddress: SUPPORTED_ASSETS[1].address, decimals: 6, logIndex: 8 } });
test("H1-11 verified swap export includes only receipt-evidenced actual received", () => { const text = buildCanonicalReceiptText(swap, verification(), "en"); assert.match(text, /Received: 4\.99 EURC/); });
test("H1-12 unknown swap export withholds the expected output", () => { const text = buildCanonicalReceiptText(swap, verification({ verified: false, reason: "swap-receive" }), "en"); assert.doesNotMatch(text, /Received:/); assert.doesNotMatch(text, /4\.99 EURC/); });
test("H1-13 failed swap export withholds the expected output", () => { const text = buildCanonicalReceiptText(swap, verification({ verified: false, reason: "status" }), "en"); assert.doesNotMatch(text, /Received:/); assert.doesNotMatch(text, /4\.99 EURC/); });
test("H1-14 unverified receipt cannot export an on-chain note", () => { const text = buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "transfer-missing", memo: { text: "Dinner", data: "0x44", memoId: "0x55", memoIndex: 1n } }), "en"); assert.doesNotMatch(text, /^Note:/m); });
test("H1-15 unknown export preserves the submitted transaction hash", () => assert.match(buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "hash" }), "en"), new RegExp(hash)));
test("H1-16 unknown export preserves ArcScan deep link", () => assert.match(buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "hash" }), "en"), /https:\/\/testnet\.arcscan\.app\/tx\//));
test("H1-17 canonical English text is deterministic", () => { const value = buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "transfer-missing" }), "en"); assert.equal(value, buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "transfer-missing" }), "en")); });
test("H1-18 canonical Vietnamese text is deterministic and truthful", () => { const value = buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "transfer-missing" }), "vi"); assert.equal(value, buildCanonicalReceiptText(activity(), verification({ verified: false, reason: "transfer-missing" }), "vi")); assert.match(value, /Trạng thái: Đã gửi/); });

test("H1-19 Agent unknown result never says confirmed", () => { const text = formatAgentActionResult({ id: "h1", account: wallet, action: "swap", status: "unknown", createdAt: 1, transactionHash: hash }, "en"); assert.match(text, /status is unknown/i); assert.doesNotMatch(text, /Swap confirmed/i); });
test("H1-20 Agent failed result never says confirmed", () => { const text = formatAgentActionResult({ id: "h1", account: wallet, action: "send", status: "failed", createdAt: 1 }, "en"); assert.match(text, /failed/i); assert.doesNotMatch(text, /Send confirmed/i); });

test("H1-21 panel source gates canonical exports and confirmed output on evidence", () => {
  const source = readFileSync(new URL("../components/TransactionReceiptPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /const receiptText = verification \? buildCanonicalReceiptText/);
  assert.match(source, /actualSwapReceive = confirmationStatus === "confirmed-success"/);
  assert.match(source, /data-receipt-status=\{confirmationStatus\}/);
  assert.doesNotMatch(source, /<strong>\{vi \? "Đã xác nhận" : "Confirmed"\}<\/strong>/);
});

test("H1-22 receipt verification still recognizes a matched direct transfer", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer()])).verified, true));
test("H1-23 share uses the same evidence-bound canonical receipt text", () => {
  const source = readFileSync(new URL("../components/TransactionReceiptPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /navigator\.share\(\{[^}]*text: receiptText/s);
  assert.match(source, /disabled=\{!receiptText\}/);
});
