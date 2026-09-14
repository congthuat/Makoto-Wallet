import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress, type Hash } from "viem";

import { formatAgentActionResult } from "./agent/resultFormatter.ts";
import { getAssetById } from "./assets.ts";
import { createXyloQuote, minimumSwapOutput, prepareXyloSwapRequest } from "./swap.ts";
import { buildCanonicalReceiptText, encodeTransferLog, findUniqueSwapReceive, verifyTransactionReceipt, type MinimalTransactionReceipt, type ReceiptLog } from "./transactionReceipt.ts";
import type { WalletActivity } from "./wallet.ts";
import { createAssetActivity, deserializeWalletActivity, serializeWalletActivity } from "./walletActivity.ts";

const wallet = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const hash = `0x${"ab".repeat(32)}` as Hash;
const usdc = getAssetById("usdc")!;
const eurc = getAssetById("eurc")!;

function receipt(logs: ReceiptLog[], overrides: Partial<MinimalTransactionReceipt> = {}): MinimalTransactionReceipt {
  return { status: "success", transactionHash: hash, blockNumber: 123n, logs, ...overrides };
}

function receiveLog(amount: bigint, logIndex = 8, transactionHash = hash) {
  return encodeTransferLog({ token: eurc.address, from: other, to: wallet, value: amount, logIndex, transactionHash });
}

function swapActivity(swapReceive?: WalletActivity["swapReceive"]): WalletActivity {
  return createAssetActivity(usdc, {
    hash,
    logIndex: 4,
    direction: "send",
    kind: "swap",
    amount: 1_000_000n,
    counterparty: other,
    confirmedAt: 1_766_000_000_000,
    blockNumber: 123n,
    ...(swapReceive ? { swapReceive } : {}),
  });
}

test("receipt evidence can differ from the quote and actual output uses the unique matching Transfer", () => {
  const quote = createXyloQuote("usdc", "eurc", 1_000_000n, 1_000_000n);
  const actual = findUniqueSwapReceive(receipt([receiveLog(999_000n)]), { token: eurc.address, recipient: wallet, transactionHash: hash });
  assert.equal(quote.amountOut, 1_000_000n);
  assert.equal(actual?.amount, 999_000n);
  assert.notEqual(actual?.amount, quote.amountOut);
});

test("missing or ambiguous output evidence remains unavailable", () => {
  const expected = { token: eurc.address, recipient: wallet, transactionHash: hash };
  assert.equal(findUniqueSwapReceive(receipt([]), expected), undefined);
  assert.equal(findUniqueSwapReceive(receipt([receiveLog(999_000n), receiveLog(998_000n, 9)]), expected), undefined);
  assert.equal(findUniqueSwapReceive(receipt([receiveLog(999_000n, 8, `0x${"cd".repeat(32)}` as Hash)]), expected), undefined);
});

test("output evidence requires the correct token, recipient, Transfer semantics, and log index", () => {
  const expected = { token: eurc.address, recipient: wallet, transactionHash: hash };
  assert.equal(findUniqueSwapReceive(receipt([encodeTransferLog({ token: usdc.address, from: other, to: wallet, value: 999_000n, logIndex: 8, transactionHash: hash })]), expected), undefined);
  assert.equal(findUniqueSwapReceive(receipt([encodeTransferLog({ token: eurc.address, from: other, to: getAddress("0x3333333333333333333333333333333333333333"), value: 999_000n, logIndex: 8, transactionHash: hash })]), expected), undefined);
  assert.equal(findUniqueSwapReceive(receipt([{ address: eurc.address, data: "0x12", topics: ["0x12"] }]), expected), undefined);
  assert.equal(findUniqueSwapReceive(receipt([{ ...receiveLog(999_000n), logIndex: null }]), expected), undefined);
});

test("minimum output remains execution protection and is not actual received", () => {
  const prepared = prepareXyloSwapRequest(createXyloQuote("usdc", "eurc", 1_000_000n, 1_000_000n), 0.005, wallet);
  assert.equal(prepared.minimumReceive, minimumSwapOutput(1_000_000n, 0.005));
  assert.notEqual(prepared.minimumReceive, 999_000n);
});

test("unknown actual output round-trips without storing a quote-derived amount", () => {
  const restored = deserializeWalletActivity(serializeWalletActivity([swapActivity()]));
  assert.equal(restored[0].kind, "swap");
  assert.equal(restored[0].swapReceive, undefined);
  const canonical = buildCanonicalReceiptText(restored[0], verifyTransactionReceipt(restored[0], wallet, receipt([])), "en");
  assert.doesNotMatch(canonical, /Received:/);
});

test("actual output is the only amount included in Activity, Agent, and canonical receipt data", () => {
  const actual = 999_000n;
  const activity = swapActivity({ amount: actual, assetId: "eurc", assetSymbol: eurc.symbol, tokenAddress: eurc.address, decimals: 6, logIndex: 8 });
  const roundTripped = deserializeWalletActivity(serializeWalletActivity([activity]))[0];
  assert.equal(roundTripped.swapReceive?.amount, actual);
  const verified = verifyTransactionReceipt(roundTripped, wallet, receipt([encodeTransferLog({ token: usdc.address, from: wallet, to: other, value: 1_000_000n, logIndex: 4, transactionHash: hash }), receiveLog(actual)]));
  const canonical = buildCanonicalReceiptText(roundTripped, verified, "en");
  assert.match(canonical, /Received: 0\.999 EURC/);
  assert.match(formatAgentActionResult({ id: "swap", account: wallet, action: "swap", status: "confirmed", createdAt: 1, amount: "1", asset: "USDC", outputAmount: "0.999", outputAsset: "EURC", transactionHash: hash }, "en"), /0\.999 EURC/);
  assert.doesNotMatch(formatAgentActionResult({ id: "swap", account: wallet, action: "swap", status: "confirmed", createdAt: 1, amount: "1", asset: "USDC", transactionHash: hash }, "en"), /→/);
});

test("swap flow never promotes fresh quote output and preserves safety gates", () => {
  const source = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
  assert.match(source, /findUniqueSwapReceive/);
  assert.match(source, /actualReceive\.amount/);
  assert.doesNotMatch(source, /swapReceive:\s*\{[\s\S]*amount:\s*freshOutput/);
  assert.match(source, /validatePreparedXyloSwap\(preparedSwap, freshOutput/);
  assert.match(source, /revalidateTransactionReview\(/);
  assert.match(source, /writer\.writeContractAsync\(simulation\.request\)/);
  assert.match(source, /expected.*formatAssetAmount\(success\.quote\.amountOut/);
});
