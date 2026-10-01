import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, keccak256, parseAbiParameters, stringToHex, type Address, type Hash, type Hex } from "viem";

import { ARC_MEMO_ADDRESS, arcMemoAbi } from "./arcMemo.ts";
import { erc20BalanceAbi } from "./abi/erc20.ts";
import { SUPPORTED_ASSETS } from "./assets.ts";
import { buildCanonicalReceiptText, decodeDisplayableUtf8, encodeTransferLog, findMatchingMemo, verifyTransactionReceipt, type MinimalTransactionReceipt, type ReceiptLog } from "./transactionReceipt.ts";
import type { WalletActivity } from "./wallet.ts";

const wallet = getAddress("0x1111111111111111111111111111111111111111"), other = getAddress("0x2222222222222222222222222222222222222222"), wrong = getAddress("0x3333333333333333333333333333333333333333");
const arcGasToken = getAddress("0xfffffffffffffffffffffffffffffffffffffffe");
const usdc = SUPPORTED_ASSETS[0], eurc = SUPPORTED_ASSETS[1];
const hash = `0x${"ab".repeat(32)}` as Hash, otherHash = `0x${"cd".repeat(32)}` as Hash;

function activity(overrides: Partial<WalletActivity> = {}): WalletActivity { return { hash, logIndex: 4, direction: "send", kind: "transfer", amount: 5_000_000n, counterparty: other, confirmedAt: 1_766_000_000_000, blockNumber: 123n, assetId: usdc.id, assetSymbol: usdc.symbol, tokenAddress: usdc.address, decimals: usdc.decimals, ...overrides }; }
function receipt(logs: ReceiptLog[], overrides: Partial<MinimalTransactionReceipt> = {}): MinimalTransactionReceipt { return { status: "success", transactionHash: hash, blockNumber: 123n, logs, ...overrides }; }
function transfer(input: Partial<{ token: Address; from: Address; to: Address; value: bigint; logIndex: number; transactionHash: Hash }> = {}) { return encodeTransferLog({ token: usdc.address, from: wallet, to: other, value: 5_000_000n, logIndex: 4, transactionHash: hash, ...input }); }
function memoLog(note: string | Hex, overrides: Partial<{ sender: Address; target: Address; callDataHash: Hex; memoId: Hex; memoIndex: bigint }> = {}): ReceiptLog {
  const inner = encodeFunctionData({ abi: erc20BalanceAbi, functionName: "transfer", args: [other, 5_000_000n] });
  const args = { sender: wallet, target: usdc.address, callDataHash: keccak256(inner), memoId: `0x${"12".repeat(32)}` as Hex, memo: note.startsWith("0x") ? note as Hex : stringToHex(note), memoIndex: 7n, ...overrides };
  return { address: ARC_MEMO_ADDRESS, topics: encodeEventTopics({ abi: arcMemoAbi, eventName: "Memo", args: { sender: args.sender, target: args.target, memoId: args.memoId } }), data: encodeAbiParameters(parseAbiParameters("bytes32 callDataHash, bytes memo, uint256 memoIndex"), [args.callDataHash, args.memo, args.memoIndex]), logIndex: 5, transactionHash: hash };
}

test("1 confirmed send Transfer verifies", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer()])).verified, true));
test("2 confirmed receive Transfer verifies", () => { const a = activity({ direction: "receive" }); assert.equal(verifyTransactionReceipt(a, wallet, receipt([transfer({ from: other, to: wallet })])).verified, true); });
test("3 wrong token contract fails verification", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ token: eurc.address })])).verified, false));
test("4 wrong amount fails verification", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ value: 4_999_999n })])).verified, false));
test("5 wrong from fails verification", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ from: wrong })])).verified, false));
test("6 wrong to fails verification", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ to: wrong })])).verified, false));
test("7 wrong block number fails verification", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer()], { blockNumber: 124n })).verified, false));
test("8 reverted receipt is not verified", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer()], { status: "reverted" })).verified, false));
test("9 missing transfer log is not verified", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([])).verified, false));
test("10 wrong logIndex uses a unique exact Transfer fallback", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ logIndex: 3 })])).verified, true));
test("Arc gas Transfer at the Activity index does not hide the unique USDC Transfer", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ token: arcGasToken, value: 5_000_000_000_000_000_000n }), transfer({ logIndex: 5 })])).verified, true));
test("wrong logIndex with no full Transfer match fails", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ value: 1n, logIndex: 3 })])).verified, false));
test("wrong logIndex with duplicate full Transfer matches fails ambiguity", () => { const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer({ logIndex: 2 }), transfer({ logIndex: 3 })])); assert.equal(result.verified, false); assert.equal(result.reason, "transfer-ambiguous"); });
test("fallback never accepts the wrong token", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ token: eurc.address, logIndex: 3 })])).verified, false));
test("fallback never accepts the wrong amount", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ value: 4_999_999n, logIndex: 3 })])).verified, false));
test("fallback never accepts the wrong sender", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ from: wrong, logIndex: 3 })])).verified, false));
test("fallback never accepts the wrong recipient", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ to: wrong, logIndex: 3 })])).verified, false));
test("block mismatch fails before a valid fallback", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ logIndex: 3 })], { blockNumber: 124n })).reason, "block"));
test("reverted receipt fails before a valid fallback", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ logIndex: 3 })], { status: "reverted" })).reason, "status"));
test("transaction hash mismatch fails before a valid fallback", () => assert.equal(verifyTransactionReceipt(activity(), wallet, receipt([transfer({ logIndex: 3, transactionHash: otherHash })], { transactionHash: otherHash })).reason, "hash"));

function swapActivity(): WalletActivity { return activity({ kind: "swap", counterparty: other, swapReceive: { amount: 4_990_000n, assetId: eurc.id, assetSymbol: eurc.symbol, tokenAddress: eurc.address, decimals: eurc.decimals, logIndex: 8 } }); }
const swapReceive = () => transfer({ token: eurc.address, from: wrong, to: wallet, value: 4_990_000n, logIndex: 8 });
test("11 swap verifies when both legs match", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer(), swapReceive()])).verified, true));
test("12 missing sent leg fails", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([swapReceive()])).verified, false));
test("13 missing received leg fails", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer()])).verified, false));
test("14 wrong received asset fails", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer(), swapReceive().address === eurc.address ? transfer({ token: usdc.address, from: wrong, to: wallet, value: 4_990_000n, logIndex: 8 }) : swapReceive()])).verified, false));
test("15 wrong received amount fails", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer(), transfer({ token: eurc.address, from: wrong, to: wallet, value: 4_980_000n, logIndex: 8 })])).verified, false));
test("16 legs from different transaction cannot be combined", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer(), transfer({ token: eurc.address, from: wrong, to: wallet, value: 4_990_000n, logIndex: 8, transactionHash: otherHash })])).verified, false));
test("swap sent leg verifies through a unique fallback", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer({ logIndex: 3 }), swapReceive()])).verified, true));
test("swap received leg verifies through a unique fallback", () => assert.equal(verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer(), transfer({ token: eurc.address, from: wrong, to: wallet, value: 4_990_000n, logIndex: 7 })])).verified, true));
test("ambiguous swap sent fallback remains unverified", () => { const result = verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer({ logIndex: 2 }), transfer({ logIndex: 3 }), swapReceive()])); assert.equal(result.verified, false); assert.equal(result.reason, "swap-sent"); });
test("ambiguous swap received fallback remains unverified", () => { const result = verifyTransactionReceipt(swapActivity(), wallet, receipt([transfer(), transfer({ token: eurc.address, from: wrong, to: wallet, value: 4_990_000n, logIndex: 6 }), transfer({ token: eurc.address, from: wrong, to: wallet, value: 4_990_000n, logIndex: 7 })])); assert.equal(result.verified, false); assert.equal(result.reason, "swap-receive"); });

test("17 Arc-side bridge transfer verifies", () => assert.equal(verifyTransactionReceipt(activity({ kind: "bridge" }), wallet, receipt([transfer()])).verified, true));
test("18 bridge verification exposes no destination completion claim", () => assert.equal("destinationCompleted" in verifyTransactionReceipt(activity({ kind: "bridge" }), wallet, receipt([transfer()])), false));

test("19 matching Arc Memo event is detected", () => assert.ok(verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("Dinner")])).memo));
test("20 valid UTF-8 memo decoded", () => assert.equal(findMatchingMemo([memoLog("Dinner")], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n })?.text, "Dinner"));
test("21 Vietnamese memo decoded", () => assert.equal(findMatchingMemo([memoLog("Ăn tối")], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n })?.text, "Ăn tối"));
test("22 emoji memo decoded", () => assert.equal(findMatchingMemo([memoLog("Dinner 🍜")], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n })?.text, "Dinner 🍜"));
test("23 wrong Memo sender ignored", () => assert.equal(findMatchingMemo([memoLog("Dinner", { sender: wrong })], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n }), undefined));
test("24 wrong Memo target ignored", () => assert.equal(findMatchingMemo([memoLog("Dinner", { target: eurc.address })], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n }), undefined));
test("25 wrong callDataHash ignored", () => assert.equal(findMatchingMemo([memoLog("Dinner", { callDataHash: `0x${"99".repeat(32)}` })], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n }), undefined));
test("26 unrelated Memo event ignored", () => assert.equal(findMatchingMemo([memoLog("Dinner", { sender: wrong, target: eurc.address })], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n }), undefined));
test("27 malformed memo log fails safely", () => assert.equal(findMatchingMemo([{ address: ARC_MEMO_ADDRESS, data: "0x12", topics: ["0x12"] }], { sender: wallet, token: usdc.address, recipient: other, amount: 5_000_000n }), undefined));
test("28 missing Memo event means no memo, not receipt failure", () => { const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer()])); assert.equal(result.verified, true); assert.equal(result.memo, undefined); });
test("normal direct Send without Memo verifies through the unique fallback", () => { const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer({ logIndex: 5 })])); assert.equal(result.verified, true); assert.equal(result.memo, undefined); });
test("unrelated Memo remains ignored when Transfer uses fallback", () => { const result = verifyTransactionReceipt(activity(), wallet, receipt([transfer({ logIndex: 5 }), memoLog("Dinner", { sender: wrong })])); assert.equal(result.verified, true); assert.equal(result.memo, undefined); });
test("binary memo is not presented as readable UTF-8", () => assert.equal(decodeDisplayableUtf8("0xff00"), undefined));

test("29 canonical receipt text contains real addresses", () => { const text = buildCanonicalReceiptText(activity(), verifyTransactionReceipt(activity(), wallet, receipt([transfer()])), "en"); assert.match(text, new RegExp(wallet)); assert.match(text, new RegExp(other)); });
test("30 contact display name is not leaked into canonical share text", () => assert.doesNotMatch(buildCanonicalReceiptText(activity(), verifyTransactionReceipt(activity(), wallet, receipt([transfer()])), "en"), /Shizu/));
test("31 note included only when verified", () => assert.match(buildCanonicalReceiptText(activity(), verifyTransactionReceipt(activity(), wallet, receipt([transfer(), memoLog("Dinner")])), "en"), /Note: Dinner/));
test("32 no note line when absent", () => assert.doesNotMatch(buildCanonicalReceiptText(activity(), verifyTransactionReceipt(activity(), wallet, receipt([transfer()])), "en"), /^Note:/m));
test("33 deterministic receipt text", () => { const verified = verifyTransactionReceipt(activity(), wallet, receipt([transfer()])); assert.equal(buildCanonicalReceiptText(activity(), verified, "vi"), buildCanonicalReceiptText(activity(), verified, "vi")); });
