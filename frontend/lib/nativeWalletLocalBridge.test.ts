import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hash, type Hex } from "viem";

import {
  bridgeLogicalIntentIdentity,
  bridgeOperationKey,
  createBridgeOperation,
  findDestinationUsdcTransfer,
  isBridgeOperationTerminal,
  isSameBridgeLogicalIntent,
  latestMonitorableBridgeOperation,
  loadBridgeOperations,
  saveBridgeOperation,
  updateBridgeOperation,
  updateBridgeOperationQuote,
  upsertBridgeTransaction,
} from "./bridgeOperation.ts";
import { classifyDestinationVerification, classifySourceReceipt, createCctpGasEnvelope, cctpReviewedRequest } from "./cctpBridge.ts";
import { CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import { approvalIntent, prepareFlowReview } from "./transactionFlowReview.ts";
import { revalidateTransactionReview } from "./transactionOrchestrator.ts";
import { createLocalMakotoWalletAccount, createLocalWalletExecutionAdapter, LocalWalletRuntime } from "./walletAccount.ts";

const sender = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const arcUsdc = getAddress("0x3600000000000000000000000000000000000000");
const baseUsdc = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const approvalHash = `0x${"a".repeat(64)}` as Hash;
const burnHash = `0x${"b".repeat(64)}` as Hash;
const forwardHash = `0x${"c".repeat(64)}` as Hash;

class MemoryStorage {
  #values = new Map<string, string>();
  getItem(key: string) { return this.#values.get(key) ?? null; }
  setItem(key: string, value: string) { this.#values.set(key, value); }
}

function operation(state: "approval-review" | "burn-review" = "approval-review") {
  return createBridgeOperation({ id: "bridge-1", sender, requestedAmount: 1_000_000n, totalSourceDebit: 1_010_000n, protocolFee: 2_000n, forwardingFee: 8_000n, state, now: 100 });
}

test("BridgeOperation persists one operation with distinct approval, burn, and destination hashes", () => {
  const storage = new MemoryStorage();
  let current = operation();
  current = upsertBridgeTransaction(current, { role: "approval", chainId: 5_042_002, hash: approvalHash, status: "confirmed", explorerUrl: `arc/${approvalHash}` }, 110);
  current = upsertBridgeTransaction(current, { role: "burn", chainId: 5_042_002, hash: burnHash, status: "confirmed", explorerUrl: `arc/${burnHash}` }, 120);
  current = upsertBridgeTransaction(current, { role: "forward", chainId: 84_532, hash: forwardHash, status: "submitted", explorerUrl: `base/${forwardHash}` }, 130);
  saveBridgeOperation(current, storage);
  saveBridgeOperation(current, storage);
  const [restored] = loadBridgeOperations(sender, storage);
  assert.equal(loadBridgeOperations(sender, storage).length, 1);
  assert.deepEqual(restored.transactions.map((item) => [item.role, item.hash]), [["approval", approvalHash], ["burn", burnHash], ["forward", forwardHash]]);
});

test("a refreshed unsubmitted Bridge review keeps its ID across reload, quote, fee, gas, and fingerprint changes", () => {
  const storage = new MemoryStorage();
  const firstDraft = operation();
  const refreshedDraft = createBridgeOperation({ id: "bridge-2", sender, requestedAmount: 1_000_000n, totalSourceDebit: 1_020_000n, protocolFee: 3_000n, forwardingFee: 17_000n, state: "approval-review", now: 200 });
  const firstReview = { operation: firstDraft, gasEstimate: 75_000n, fingerprint: "review-a" };
  const refreshedReview = { operation: refreshedDraft, gasEstimate: 88_000n, fingerprint: "review-b" };

  saveBridgeOperation(firstReview.operation, storage);
  const [afterFirstReload] = loadBridgeOperations(sender, storage);
  assert.equal(afterFirstReload.id, "bridge-1");
  assert.equal(bridgeLogicalIntentIdentity(firstReview.operation), bridgeLogicalIntentIdentity(refreshedReview.operation));
  assert.notEqual(firstReview.gasEstimate, refreshedReview.gasEstimate);
  assert.notEqual(firstReview.fingerprint, refreshedReview.fingerprint);

  const savedRefresh = saveBridgeOperation(refreshedReview.operation, storage);
  const [afterSecondReload] = loadBridgeOperations(sender, storage);
  assert.equal(savedRefresh.id, "bridge-1");
  assert.equal(afterSecondReload.id, "bridge-1");
  assert.equal(afterSecondReload.createdAt, firstDraft.createdAt);
  assert.equal(afterSecondReload.updatedAt, refreshedDraft.updatedAt);
  assert.equal(afterSecondReload.totalSourceDebit, "1020000");
  assert.deepEqual(afterSecondReload.fees, { protocol: "3000", forwarding: "17000" });
  assert.equal(loadBridgeOperations(sender, storage).length, 1);
});

test("logical Bridge intent excludes volatile review data and changes only for account, amount, recipient, route, chain, token, or provider", () => {
  const base = operation();
  const quoteChanged = { ...base, totalSourceDebit: "1099999", fees: { protocol: "999", forwarding: "99000" }, updatedAt: 999 };
  assert.equal(isSameBridgeLogicalIntent(base, quoteChanged), true);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, sender: other }), false);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, requestedAmount: "2000000" }), false);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, recipient: other }), false);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, route: "another-route" }), false);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, sourceChainId: 1 }), false);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, destinationChainId: 1 }), false);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, asset: "eurc" }), false);
  assert.equal(isSameBridgeLogicalIntent(base, { ...base, provider: "another-provider" }), false);
});

test("same-intent duplicate drafts consolidate on the oldest stable ID while different intents remain separate", () => {
  const storage = new MemoryStorage();
  const oldest = operation();
  const duplicate = createBridgeOperation({ id: "bridge-2", sender, requestedAmount: 1_000_000n, totalSourceDebit: 1_020_000n, protocolFee: 3_000n, forwardingFee: 17_000n, state: "approval-review", now: 200 });
  storage.setItem(bridgeOperationKey(sender), JSON.stringify([duplicate, oldest]));

  const fresh = createBridgeOperation({ id: "bridge-3", sender, requestedAmount: 1_000_000n, totalSourceDebit: 1_030_000n, protocolFee: 4_000n, forwardingFee: 26_000n, state: "approval-review", now: 300 });
  assert.equal(saveBridgeOperation(fresh, storage).id, oldest.id);
  assert.deepEqual(loadBridgeOperations(sender, storage).map((item) => item.id), [oldest.id]);

  const differentAmount = createBridgeOperation({ id: "bridge-amount", sender, requestedAmount: 2_000_000n, totalSourceDebit: 2_030_000n, protocolFee: 4_000n, forwardingFee: 26_000n, state: "approval-review", now: 400 });
  const differentRecipient = createBridgeOperation({ id: "bridge-recipient", sender, recipient: other, requestedAmount: 1_000_000n, totalSourceDebit: 1_030_000n, protocolFee: 4_000n, forwardingFee: 26_000n, state: "approval-review", now: 500 });
  saveBridgeOperation(differentAmount, storage);
  saveBridgeOperation(differentRecipient, storage);
  assert.deepEqual(new Set(loadBridgeOperations(sender, storage).map((item) => item.id)), new Set([oldest.id, differentAmount.id, differentRecipient.id]));
});

test("approval and burn hashes are never replaced by a new transaction-free same-intent review", () => {
  const storage = new MemoryStorage();
  const submittedApproval = upsertBridgeTransaction(updateBridgeOperation(operation(), { state: "approval-confirmed" }, 210), { role: "approval", chainId: 5_042_002, hash: approvalHash, status: "confirmed", blockNumber: "12", explorerUrl: "arc" }, 220);
  saveBridgeOperation(submittedApproval, storage);
  const firstNewDraft = createBridgeOperation({ id: "bridge-new", sender, requestedAmount: 1_000_000n, totalSourceDebit: 1_020_000n, protocolFee: 3_000n, forwardingFee: 17_000n, state: "burn-review", now: 300 });
  saveBridgeOperation(firstNewDraft, storage);

  const submittedBurn = upsertBridgeTransaction(updateBridgeOperation(submittedApproval, { state: "source-confirming" }, 310), { role: "burn", chainId: 5_042_002, hash: burnHash, status: "confirming", explorerUrl: "arc" }, 320);
  saveBridgeOperation(submittedBurn, storage);
  const secondNewDraft = createBridgeOperation({ id: "bridge-newer", sender, requestedAmount: 1_000_000n, totalSourceDebit: 1_030_000n, protocolFee: 4_000n, forwardingFee: 26_000n, state: "burn-review", now: 400 });
  const savedDraft = saveBridgeOperation(secondNewDraft, storage);

  const restoredSubmitted = loadBridgeOperations(sender, storage).find((item) => item.id === submittedBurn.id);
  assert.equal(savedDraft.id, firstNewDraft.id);
  assert.deepEqual(restoredSubmitted?.transactions.map((item) => [item.role, item.hash]), [["approval", approvalHash], ["burn", burnHash]]);
  assert.equal(loadBridgeOperations(sender, storage).length, 2);
});

test("BridgeOperation transaction upsert is idempotent and quote refresh records the actual burn fees", () => {
  const submitted = upsertBridgeTransaction(operation(), { role: "approval", chainId: 5_042_002, hash: approvalHash, status: "submitted", explorerUrl: "arc" }, 110);
  const confirmed = upsertBridgeTransaction(submitted, { role: "approval", chainId: 5_042_002, hash: approvalHash, status: "confirmed", blockNumber: "12", explorerUrl: "arc" }, 120);
  const refreshed = updateBridgeOperationQuote(confirmed, { totalSourceDebit: 1_020_000n, protocolFee: 3_000n, forwardingFee: 17_000n }, 130);
  assert.equal(refreshed.transactions.length, 1);
  assert.equal(refreshed.transactions[0].status, "confirmed");
  assert.equal(refreshed.totalSourceDebit, "1020000");
  assert.deepEqual(refreshed.fees, { protocol: "3000", forwarding: "17000" });
});

test("unresolved known hashes survive reload and block a blind replacement operation", () => {
  const storage = new MemoryStorage();
  const unresolved = upsertBridgeTransaction(updateBridgeOperation(operation(), { state: "source-confirmation-unknown" }, 110), { role: "burn", chainId: 5_042_002, hash: burnHash, status: "unknown", explorerUrl: "arc" }, 120);
  saveBridgeOperation(unresolved, storage);
  assert.equal(latestMonitorableBridgeOperation(sender, storage)?.id, unresolved.id);
  assert.equal(isBridgeOperationTerminal(unresolved.state), false);
  assert.equal(isBridgeOperationTerminal("source-failed"), true);
  assert.equal(isBridgeOperationTerminal("destination-confirmed"), true);
});

test("malformed persisted operation data fails closed", () => {
  const storage = new MemoryStorage();
  storage.setItem("makoto-wallet:bridge-operations:v1:0x1111111111111111111111111111111111111111", '[{"id":"bad"}]');
  assert.deepEqual(loadBridgeOperations(sender, storage), []);
});

test("CCTP review freezes a non-zero EIP-1559 gas envelope and exact finite approval calldata", () => {
  const envelope = createCctpGasEnvelope(75_000n, 3_000_000_000n, 1_000_000_000n);
  const intent = approvalIntent({ id: "approval", account: sender, target: arcUsdc, token: arcUsdc, spender: CCTP_TOKEN_MESSENGER_V2, amount: 1_010_000n, assetId: "usdc", calldata: "0x", preparedAt: 1_000, expiresAt: 46_000, gas: { gasLimit: envelope.gasLimit, maxFeePerGas: envelope.maxFeePerGas, maxPriorityFeePerGas: envelope.maxPriorityFeePerGas, maxFeeRaw18: envelope.rawMaximumFee } });
  const request = cctpReviewedRequest(intent, envelope);
  const snapshot = prepareFlowReview(intent, { connectedAccount: sender, connectedChainId: 5_042_002, balances: { usdc: 2_000_000n }, allowance: 0n, simulation: "passed", expectedTarget: arcUsdc }, request);
  assert.notEqual(snapshot.request.data, "0x");
  assert.equal(snapshot.intent.approval?.amount, 1_010_000n);
  assert.equal(snapshot.intent.approval?.finite, true);
  assert.equal(snapshot.request.gas, "75000");
  assert.equal(snapshot.request.maxFeePerGas, "3000000000");
});

test("CCTP review revalidation blocks expiry, account change, chain mismatch, and request drift", () => {
  const envelope = createCctpGasEnvelope(75_000n, 3_000_000_000n);
  const intent = approvalIntent({ id: "approval", account: sender, target: arcUsdc, token: arcUsdc, spender: CCTP_TOKEN_MESSENGER_V2, amount: 1_010_000n, assetId: "usdc", calldata: "0x", preparedAt: 1_000, expiresAt: 46_000, gas: { gasLimit: envelope.gasLimit, maxFeePerGas: envelope.maxFeePerGas } });
  const context = { connectedAccount: sender, connectedChainId: 5_042_002, balances: { usdc: 2_000_000n }, allowance: 0n, simulation: "passed" as const, expectedTarget: arcUsdc };
  const request = cctpReviewedRequest(intent, envelope);
  const snapshot = prepareFlowReview(intent, context, request);
  assert.equal(revalidateTransactionReview(snapshot, { intent, context, request, now: 61_001 }).valid, false);
  assert.equal(revalidateTransactionReview(snapshot, { intent, context: { ...context, connectedAccount: other }, request, now: 2_000 }).valid, false);
  assert.equal(revalidateTransactionReview(snapshot, { intent, context: { ...context, connectedChainId: 84_532 }, request, now: 2_000 }).valid, false);
  assert.equal(revalidateTransactionReview(snapshot, { intent, context, request: { ...request, gas: 75_001n }, now: 2_000 }).valid, false);
});

test("locked local wallet keeps its read identity but cannot sign or use an external fallback", async () => {
  const locked = createLocalMakotoWalletAccount({ address: sender, status: "locked" });
  const runtime = new LocalWalletRuntime(locked);
  const adapter = createLocalWalletExecutionAdapter(() => runtime.getSubmitter(), () => runtime.wallet);
  const request = { to: arcUsdc, data: "0x1234" as Hex, value: "0", chainId: 5_042_002 } as const;
  let fallbackCalls = 0;
  assert.equal(runtime.wallet.address, sender);
  assert.equal(runtime.wallet.isArc, true);
  await assert.rejects(adapter.submitReviewed(request, async () => { fallbackCalls += 1; return approvalHash; }), /locked/);
  assert.equal(fallbackCalls, 0);
});

test("source receipt classification never treats an unknown or reverted receipt as confirmed", () => {
  assert.equal(classifySourceReceipt(burnHash).state, "source-confirmation-unknown");
  assert.equal(classifySourceReceipt(burnHash, { status: "reverted", blockNumber: 9n }).state, "source-failed");
  assert.equal(classifySourceReceipt(burnHash, { status: "success" }).state, "source-confirmation-unknown");
  assert.equal(classifySourceReceipt(burnHash, { status: "success", blockNumber: 10n }).state, "source-confirmed");
});

test("destination finality requires hash, successful Base receipt, correct chain, recipient evidence, and balance read", () => {
  assert.equal(classifyDestinationVerification({ hashKnown: false }), "destination-verification-pending");
  assert.equal(classifyDestinationVerification({ hashKnown: true }), "destination-verification-pending");
  assert.equal(classifyDestinationVerification({ hashKnown: true, receipt: "reverted" }), "destination-failed");
  assert.equal(classifyDestinationVerification({ hashKnown: true, receipt: "success", chainMatches: true, recipientEvidence: true, balanceRead: false }), "destination-verification-pending");
  assert.equal(classifyDestinationVerification({ hashKnown: true, receipt: "success", chainMatches: true, recipientEvidence: true, balanceRead: true }), "destination-confirmed");
});

test("9F CCTP source confirmation never proves destination finality", () => {
  const source = classifySourceReceipt(burnHash, { status: "success", blockNumber: 10n });
  assert.equal(source.state, "source-confirmed");
  for (const evidence of [
    { hashKnown: false },
    { hashKnown: true, receipt: "success" as const },
    { hashKnown: true, receipt: "success" as const, chainMatches: false, recipientEvidence: true, balanceRead: true },
    { hashKnown: true, receipt: "success" as const, chainMatches: true, recipientEvidence: false, balanceRead: true },
    { hashKnown: true, receipt: "success" as const, chainMatches: true, recipientEvidence: true, balanceRead: false },
  ]) assert.equal(classifyDestinationVerification(evidence), "destination-verification-pending");
  assert.equal(classifyDestinationVerification({ hashKnown: true, receipt: "reverted" }), "destination-failed");
  const unresolved = updateBridgeOperation(operation("burn-review"), { state: "source-confirmed" }, 110);
  assert.equal(isBridgeOperationTerminal(unresolved.state), false);
  assert.equal(unresolved.state, "source-confirmed");
});

test("9F unresolved CCTP source receipt persists without an automatic replacement burn", () => {
  const storage = new MemoryStorage();
  const unresolved = upsertBridgeTransaction(updateBridgeOperation(operation("burn-review"), { state: "source-confirmation-unknown" }, 110), { role: "burn", chainId: 5_042_002, hash: burnHash, status: "unknown", explorerUrl: "arc" }, 120);
  saveBridgeOperation(unresolved, storage);
  const replacement = createBridgeOperation({ id: "replacement", sender, requestedAmount: 1_000_000n, totalSourceDebit: 1_010_000n, protocolFee: 2_000n, forwardingFee: 8_000n, state: "burn-review", now: 130 });
  saveBridgeOperation(replacement, storage);
  const restored = loadBridgeOperations(sender, storage);
  assert.equal(restored.filter((item) => item.transactions.some((transaction) => transaction.role === "burn" && transaction.hash === burnHash)).length, 1);
  assert.equal(latestMonitorableBridgeOperation(sender, storage)?.state, "source-confirmation-unknown");
});

test("destination USDC evidence must match token, recipient, transaction, and exact requested amount", () => {
  const topics = encodeEventTopics({ abi: [{ type: "event", name: "Transfer", inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }] }] as const, eventName: "Transfer", args: { from: CCTP_TOKEN_MESSENGER_V2, to: sender } });
  const log = { address: baseUsdc, topics, data: encodeAbiParameters([{ type: "uint256" }], [1_000_000n]), logIndex: 4, transactionHash: forwardHash };
  assert.deepEqual(findDestinationUsdcTransfer({ logs: [log], token: baseUsdc, recipient: sender, transactionHash: forwardHash, expectedAmount: 1_000_000n }), { amount: 1_000_000n, logIndex: 4 });
  assert.equal(findDestinationUsdcTransfer({ logs: [log], token: baseUsdc, recipient: sender, transactionHash: forwardHash, expectedAmount: 999_999n }), undefined);
  assert.equal(findDestinationUsdcTransfer({ logs: [log], token: baseUsdc, recipient: other, transactionHash: forwardHash, expectedAmount: 1_000_000n }), undefined);
});

test("production Direct CCTP keeps approval and burn separate with fresh post-approval reads", () => {
  const source = readFileSync(new URL("../components/CctpBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(source, /functionName: "approve"/);
  assert.match(source, /functionName: "depositForBurnWithHook"/);
  assert.match(source, /Approval confirmed\. No burn has been submitted\./);
  assert.match(source, /await prepareFreshBurn\(next, review\.amounts\.transferAmount\)/);
  assert.match(source, /Promise\.all\(\[loadFee\(\), arcClient\.readContract[\s\S]*functionName: "allowance"/);
  assert.match(source, /allowance < amounts\.totalAmount \? "approval" : "burn"/);
  assert.match(source, /submissionGuard\.current\.run/);
});

test("forwardTxHash alone stays pending until Base receipt, exact USDC evidence, and balance re-read", () => {
  const source = readFileSync(new URL("../components/CctpBridgeFlow.tsx", import.meta.url), "utf8");
  const statusRoute = readFileSync(new URL("../app/api/cctp-status/route.ts", import.meta.url), "utf8");
  const forwardFound = source.indexOf('state: "forwarding-submitted"');
  const receiptRead = source.indexOf("getTransactionReceipt", forwardFound);
  const evidence = source.indexOf("findDestinationUsdcTransfer", receiptRead);
  const balanceRead = source.indexOf('functionName: "balanceOf"', evidence);
  const complete = source.indexOf('state: "destination-confirmed"', balanceRead);
  assert.ok(forwardFound >= 0 && receiptRead > forwardFound && evidence > receiptRead && balanceRead > evidence && complete > balanceRead);
  assert.match(source, /state: "destination-verification-pending"/);
  assert.match(source, /chainId !== baseSepolia\.id/);
  assert.match(statusRoute, /messageStatus, attestationStatus, forwardingState, forwardTxHash/);
  assert.doesNotMatch(statusRoute, /attestation:\s*message\.attestation/);
});

test("local Bridge routes to Direct CCTP while external Universal Bridge remains App Kit managed", () => {
  const panel = readFileSync(new URL("../components/SwapPanel.tsx", import.meta.url), "utf8");
  const universal = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  assert.match(panel, /wallet\.kind === "local" \? <CctpBridgeFlow/);
  assert.match(panel, /: <UniversalBridgeFlow/);
  assert.match(universal, /createCircleBrowserAdapter\(connection\.connector/);
  assert.match(universal, /kit\.bridge\(/);
  assert.doesNotMatch(universal, /LocalWalletExecutionAdapter|createLocalWalletExecutionAdapter/);
});

test("Agent and shared Activity persistence receive no Bridge signer or operation identity", () => {
  const context = readFileSync(new URL("./agent/context.ts", import.meta.url), "utf8");
  const tools = readFileSync(new URL("./agent/tools.ts", import.meta.url), "utf8");
  const activity = readFileSync(new URL("./walletActivity.ts", import.meta.url), "utf8");
  assert.doesNotMatch(context, /WalletExecutionAdapter|submitReviewed|privateKey|mnemonic/);
  assert.doesNotMatch(tools, /WalletExecutionAdapter|submitReviewed|useWriteContract|sendTransaction/);
  assert.doesNotMatch(activity, /BridgeOperation|bridgeOperationKey/);
});
