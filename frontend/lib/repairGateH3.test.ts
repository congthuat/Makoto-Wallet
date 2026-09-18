import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, keccak256, parseAbiParameters, stringToHex, type Hash, type Hex } from "viem";

import { ARC_MEMO_ADDRESS, arcMemoAbi } from "./arcMemo.ts";
import { erc20BalanceAbi } from "./abi/erc20.ts";
import { SUPPORTED_ASSETS } from "./assets.ts";
import { buildCanonicalReceiptText, classifyReceiptConfirmation, encodeTransferLog, findUniqueSwapReceive, verifyTransactionReceipt, type MinimalTransactionReceipt, type ReceiptLog } from "./transactionReceipt.ts";
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

function receipt(logs: MinimalTransactionReceipt["logs"], overrides: Partial<MinimalTransactionReceipt> = {}): MinimalTransactionReceipt {
  return { status: "success", transactionHash: hashA, blockNumber: 123n, logs, ...overrides };
}

function transfer(transactionHash: Hash = hashA) {
  return encodeTransferLog({ token: usdc.address, from: wallet, to: other, value: 5_000_000n, logIndex: 4, transactionHash });
}

function memoLog(note: string, transactionHash?: Hash, logIndex = 5): ReceiptLog {
  const callDataHash = keccak256(encodeFunctionData({ abi: erc20BalanceAbi, functionName: "transfer", args: [other, 5_000_000n] }));
  const memoId = `0x${logIndex.toString(16).padStart(64, "0")}` as Hex;
  return {
    address: ARC_MEMO_ADDRESS,
    ...(transactionHash === undefined ? {} : { transactionHash }),
    logIndex,
    topics: encodeEventTopics({ abi: arcMemoAbi, eventName: "Memo", args: { sender: wallet, target: usdc.address, memoId } }),
    data: encodeAbiParameters(parseAbiParameters("bytes32 callDataHash, bytes memo, uint256 memoIndex"), [callDataHash, stringToHex(note), BigInt(logIndex)]),
  };
}

function swapActivity(): WalletActivity {
  return activity({ kind: "swap", swapReceive: { amount: 4_990_000n, assetId: eurc.id, assetSymbol: eurc.symbol, tokenAddress: eurc.address, decimals: eurc.decimals, logIndex: 8 } });
}

function swapReceive(transactionHash: Hash = hashA) {
  return encodeTransferLog({ token: eurc.address, from: other, to: wallet, value: 4_990_000n, logIndex: 8, transactionHash });
}

test("H3-01 matching memo A remains verified and exportable", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("NOTE FROM TRANSACTION A", hashA)]));
  assert.equal(result.verified, true);
  assert.equal(result.memo?.text, "NOTE FROM TRANSACTION A");
  assert.match(buildCanonicalReceiptText(activity(), result, "en"), /Note: NOTE FROM TRANSACTION A/);
});

test("H3-02 unrelated memo B is rejected while transaction A stays confirmed", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("NOTE FROM TRANSACTION B", hashB)]));
  assert.equal(result.verified, true);
  assert.equal(result.memo, undefined);
  assert.equal(classifyReceiptConfirmation(result), "confirmed-success");
});

test("H3-03 unrelated memo cannot appear as Verified or in canonical export", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("NOTE FROM TRANSACTION B", hashB)]));
  const text = buildCanonicalReceiptText(activity(), result, "en");
  assert.doesNotMatch(text, /NOTE FROM TRANSACTION B/);
  assert.doesNotMatch(text, /^Note:/m);
});

test("H3-04 unrelated memo cannot enter share text", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("NOTE FROM TRANSACTION B", hashB)]));
  const text = buildCanonicalReceiptText(activity(), result, "en");
  const source = readFileSync(new URL("../components/TransactionReceiptPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /navigator\.share\(\{[^}]*text: receiptText/s);
  assert.doesNotMatch(text, /NOTE FROM TRANSACTION B/);
});

test("H3-05 identical transfer fields do not establish memo identity", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("IDENTICAL FIELDS FROM B", hashB)]));
  assert.equal(result.verified, true);
  assert.equal(result.memo, undefined);
});

test("H3-06 memo without transaction identity remains unavailable", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("MISSING TRANSACTION IDENTITY") ]));
  assert.equal(result.verified, true);
  assert.equal(result.memo, undefined);
});

test("H3-07 normalized matching transaction hash still verifies memo A", () => {
  const upperHash = hashA.toUpperCase() as Hash;
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(upperHash), memoLog("CASE NORMALIZED MEMO", upperHash)], { transactionHash: upperHash }));
  assert.equal(result.verified, true);
  assert.equal(result.memo?.text, "CASE NORMALIZED MEMO");
});

test("H3-08 valid failure remains failure and does not gain an unrelated memo", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([memoLog("NOTE FROM TRANSACTION B", hashB)], { status: "reverted" }));
  assert.equal(result.reason, "status");
  assert.equal(result.memo, undefined);
  assert.equal(classifyReceiptConfirmation(result), "confirmed-failure");
});

test("H3-09 memo evidence cannot alter terminal receipt status", () => {
  const success = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("NOTE FROM TRANSACTION B", hashB)]));
  const failure = verifyTransactionReceipt(activity(), wallet, receipt([memoLog("NOTE FROM TRANSACTION B", hashB)], { status: "reverted" }));
  assert.equal(classifyReceiptConfirmation(success), "confirmed-success");
  assert.equal(classifyReceiptConfirmation(failure), "confirmed-failure");
});

test("H3-10 memo repair leaves receipt-evidenced actual received unchanged", () => {
  const swap = swapActivity();
  const result = verifyTransactionReceipt(swap, wallet, receipt([transfer(), swapReceive(), memoLog("NOTE FROM TRANSACTION B", hashB)]));
  assert.equal(result.verified, true);
  assert.equal(result.memo, undefined);
  assert.deepEqual(findUniqueSwapReceive(receipt([swapReceive()]), { token: eurc.address, recipient: wallet, transactionHash: hashA }), { amount: 4_990_000n, logIndex: 8 });
  assert.match(buildCanonicalReceiptText(swap, result, "en"), /Received: 4\.99 EURC/);
});

test("H3-11 valid memo remains available to existing receipt consumers", () => {
  const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("VALID NOTE", hashA)]));
  assert.equal(result.memo?.text, "VALID NOTE");
  assert.match(buildCanonicalReceiptText(activity(), result, "vi"), /Ghi chú: VALID NOTE/);
});

test("H3-12 memo identity is required before event details are accepted", () => {
  const source = readFileSync(new URL("./transactionReceipt.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!log\.transactionHash \|\| log\.transactionHash\.toLowerCase\(\) !== expected\.transactionHash\.toLowerCase\(\)\) continue;/);
});
