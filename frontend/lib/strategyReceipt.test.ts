import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress, type Hash, type PublicClient } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool } from "./agent/prepareTools.ts";
import { runQuoteTool } from "./agent/quoteTools.ts";
import { type ActionStep, type Strategy } from "./strategyModel.ts";
import { acquireStrategyReceipt, verifyStrategyReceipt, type StrategyReceiptObservation, type SubmittedStrategyAction } from "./strategyReceipt.ts";
import { evaluateStrategyRecovery, type StrategyRecoveryRecord } from "./strategyRecovery.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const hash = `0x${"a".repeat(64)}` as Hash;
const otherHash = `0x${"b".repeat(64)}` as Hash;
const now = 1_000_000;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };
const snapshot = createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: now });
const context = { snapshot, now: () => now, reads: { readBalance: async (_owner: typeof account, asset: keyof typeof balances) => balances[asset], readAllowance: async () => 0n }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: now }), readDirectCctpFee: async () => ({ finalityThreshold: 2000 as const, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now }) } };

async function fixture(action: ActionStep["action"]) {
  const amount = 10_000_000n;
  const quote = action === "SEND" ? await runQuoteTool(context, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount, recipient })
    : action === "APPROVE" || action === "SWAP" ? await runQuoteTool(context, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount, slippage: 0.005 })
    : await runQuoteTool(context, { tool: "bridge.quote", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount, recipient: account, route: "cctp-direct-forwarding" });
  const preparation = action === "SEND" ? await runPrepareTool(context, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount, recipient, quote })
    : action === "APPROVE" || action === "SWAP" ? await runPrepareTool(context, { tool: "swap.prepare", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount, slippage: 0.005, quote })
    : await runPrepareTool(context, { tool: "bridge.prepare", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount, recipient: account, route: "cctp-direct-forwarding", quote });
  assert.equal(preparation.status, "PREPARED");
  if (preparation.status !== "PREPARED") throw Error("fixture requires preparation");
  const index = action === "SWAP" || action === "BRIDGE" ? 1 : 0;
  const step: ActionStep = { id: action.toLowerCase(), kind: "ACTION", action, dependsOn: [], confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: preparation.tool, quoteFingerprint: preparation.data.quoteFingerprint, stepIndex: index } };
  const strategy: Strategy = { version: 1, id: "strategy-10c", createdAt: now, steps: [step] };
  const submitted: SubmittedStrategyAction = { strategyId: strategy.id, stepId: step.id, action, preparedAction: step.preparedAction!, hash, account, chainId: arcTestnet.id };
  const request = preparation.data.steps[index].request;
  const observation: StrategyReceiptObservation = { status: "FOUND", observedAt: now, chainId: arcTestnet.id, receipt: { hash, status: "success", blockNumber: "123" }, transaction: { hash, from: account, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } };
  return { strategy, submitted, preparation, observation };
}

test("confirmed exact Send receipt yields 10B dependency evidence, not a next step", async () => {
  const input = await fixture("SEND");
  const result = verifyStrategyReceipt(input);
  assert.equal(result.status, "CONFIRMED");
  if (result.status === "CONFIRMED") {
    assert.equal(result.scope, "SOURCE_TRANSACTION");
    assert.equal(result.dependencies[0].kind, "CONFIRMED_RECEIPT");
    assert.equal(result.dependencies[0].stepId, input.submitted.stepId);
    assert.equal(result.dependencies[0].submittedHash, hash);
    assert.doesNotThrow(() => JSON.stringify(result));
  }
});

test("reverted, pending and unavailable remain separate stopping states", async () => {
  const input = await fixture("SEND");
  for (const [observation, status] of [
    [{ ...input.observation, receipt: { hash, status: "reverted", blockNumber: "123" } }, "REVERTED"],
    [{ status: "PENDING", observedAt: now }, "PENDING"],
    [{ status: "UNAVAILABLE", observedAt: now }, "UNAVAILABLE"],
  ] as const) {
    const result = verifyStrategyReceipt({ ...input, observation: observation as StrategyReceiptObservation });
    assert.equal(result.status, status);
    assert.equal("dependencies" in result, false);
  }
});

test("reverted result retains identity already verified against the transaction", async () => {
  const input = await fixture("SEND");
  if (input.observation.status !== "FOUND") throw Error("fixture");
  const observation = { ...input.observation, receipt: { ...input.observation.receipt, status: "reverted" as const } };
  const result = verifyStrategyReceipt({ ...input, observation });
  assert.deepEqual(result, { status: "REVERTED", strategyId: input.submitted.strategyId, stepId: input.submitted.stepId, action: input.submitted.action, account, preparedAction: input.submitted.preparedAction, hash, chainId: arcTestnet.id, blockNumber: "123", scope: "SOURCE_TRANSACTION" });
  for (const [transaction, reason] of [
    [{ ...observation.transaction, from: recipient }, "ACCOUNT"],
    [{ ...observation.transaction, to: account }, "TRANSACTION"],
    [{ ...observation.transaction, input: "0x" }, "TRANSACTION"],
    [{ ...observation.transaction, value: "1" }, "TRANSACTION"],
  ] as const) assert.deepEqual(verifyStrategyReceipt({ ...input, observation: { ...observation, transaction } as StrategyReceiptObservation }), { status: "MISMATCH", reason });
  assert.deepEqual(verifyStrategyReceipt({ ...input, observation: { ...observation, chainId: baseSepolia.id } }), { status: "MISMATCH", reason: "CHAIN" });
  assert.deepEqual(verifyStrategyReceipt({ ...input, observation: { ...observation, receipt: { ...observation.receipt, hash: otherHash } } }), { status: "MISMATCH", reason: "HASH" });
});

test("verified source reverts bind recovery to the exact submitted action", async () => {
  for (const action of ["SEND", "BRIDGE"] as const) {
    const input = await fixture(action);
    if (input.observation.status !== "FOUND") throw Error("fixture");
    const receipt = verifyStrategyReceipt({ ...input, observation: { ...input.observation, receipt: { ...input.observation.receipt, status: "reverted" } } });
    assert.equal(receipt.status, "REVERTED");
    if (receipt.status !== "REVERTED") throw Error("fixture");
    assert.equal(receipt.scope, "SOURCE_TRANSACTION");
    const record: StrategyRecoveryRecord = { version: 1, attemptId: "attempt_10c", strategyId: input.submitted.strategyId, stepId: input.submitted.stepId, action, account, chainId: arcTestnet.id, preparedAction: input.submitted.preparedAction, event: "SUBMITTED", submittedHash: hash };
    assert.equal(evaluateStrategyRecovery({ strategy: input.strategy, record, receipt, now }).status, "REVALIDATION_REQUIRED");
    assert.equal(evaluateStrategyRecovery({ strategy: input.strategy, record: { ...record, account: recipient }, receipt, now }).status, "INVALID_EVIDENCE");
    assert.equal(evaluateStrategyRecovery({ strategy: input.strategy, record: { ...record, preparedAction: { ...record.preparedAction, quoteFingerprint: otherHash } }, receipt, now }).status, "INVALID_EVIDENCE");
  }
});

test("hash, chain, account, transaction and submitted identity cannot be substituted", async () => {
  const input = await fixture("SEND");
  const found = input.observation;
  if (found.status !== "FOUND") throw Error("fixture");
  const cases = [
    [{ ...input, submitted: { ...input.submitted, hash: otherHash } }, "HASH"],
    [{ ...input, observation: { ...found, receipt: { ...found.receipt, hash: otherHash } } }, "HASH"],
    [{ ...input, observation: { ...found, chainId: baseSepolia.id } }, "CHAIN"],
    [{ ...input, observation: { ...found, transaction: { ...found.transaction, chainId: baseSepolia.id } } }, "CHAIN"],
    [{ ...input, observation: { ...found, transaction: { ...found.transaction, from: recipient } } }, "ACCOUNT"],
    [{ ...input, observation: { ...found, transaction: { ...found.transaction, input: "0x" as const } } }, "TRANSACTION"],
    [{ ...input, submitted: { ...input.submitted, strategyId: "other" } }, "STRATEGY"],
    [{ ...input, submitted: { ...input.submitted, stepId: "other" } }, "STEP"],
  ] as const;
  for (const [candidate, reason] of cases) assert.deepEqual(verifyStrategyReceipt(candidate as typeof input), { status: "MISMATCH", reason });
  assert.deepEqual(verifyStrategyReceipt({ ...input, submitted: { ...input.submitted, hash: "bad" as Hash } }), { status: "INVALID_EVIDENCE", reason: "SUBMISSION" });
});

test("malformed strategy and receipt objects are technical failures, not transaction states", async () => {
  const input = await fixture("SEND");
  assert.deepEqual(verifyStrategyReceipt({ ...input, strategy: { ...input.strategy, steps: [] } }), { status: "INVALID_EVIDENCE", reason: "STRATEGY" });
  if (input.observation.status !== "FOUND") throw Error("fixture");
  assert.deepEqual(verifyStrategyReceipt({ ...input, observation: { ...input.observation, receipt: { ...input.observation.receipt, blockNumber: 123 as unknown as string } } }), { status: "INVALID_EVIDENCE", reason: "OBSERVATION" });
  assert.deepEqual(verifyStrategyReceipt({ ...input, observation: { ...input.observation, receipt: { ...input.observation.receipt, hash: "bad" as Hash } } }), { status: "INVALID_EVIDENCE", reason: "OBSERVATION" });
});

test("approval, Send, Swap and source burn are bound to distinct prepared steps", async () => {
  const actions = await Promise.all((["APPROVE", "SEND", "SWAP", "BRIDGE"] as const).map(fixture));
  for (const input of actions) {
    const result = verifyStrategyReceipt(input);
    assert.equal(result.status, "CONFIRMED", input.submitted.action);
    if (result.status === "CONFIRMED") assert.equal(result.scope, "SOURCE_TRANSACTION");
  }
  const [approval, send, swap, bridge] = actions;
  assert.deepEqual(verifyStrategyReceipt({ ...approval, submitted: { ...approval.submitted, action: "SWAP" } }), { status: "MISMATCH", reason: "ACTION" });
  assert.deepEqual(verifyStrategyReceipt({ ...swap, observation: approval.observation }), { status: "MISMATCH", reason: "TRANSACTION" });
  assert.deepEqual(verifyStrategyReceipt({ ...bridge, observation: send.observation }), { status: "MISMATCH", reason: "TRANSACTION" });
});

test("approval receipt is historical only; source burn never claims destination confirmation", async () => {
  const approval = verifyStrategyReceipt(await fixture("APPROVE"));
  const bridge = verifyStrategyReceipt(await fixture("BRIDGE"));
  assert.equal(approval.status, "CONFIRMED");
  assert.equal(bridge.status, "CONFIRMED");
  if (bridge.status === "CONFIRMED") assert.equal(bridge.scope, "SOURCE_TRANSACTION");
  assert.equal(JSON.stringify(bridge).includes("DESTINATION_CONFIRMED"), false);
  assert.equal(JSON.stringify(approval).includes("allowance"), false);
});

test("APPROVE receipt supplies the modeled WAIT_RECEIPT evidence without running REVALIDATE or SWAP", async () => {
  const input = await fixture("APPROVE");
  const wait = { id: "wait", kind: "WAIT_RECEIPT", dependsOn: [input.submitted.stepId], receipt: { kind: "RECEIPT", actionStepId: input.submitted.stepId } } as const;
  const refresh = { id: "refresh", kind: "REVALIDATE", dependsOn: ["wait"] } as const;
  const swap = { id: "swap", kind: "ACTION", action: "SWAP", dependsOn: ["refresh"], confirmation: "EXPLICIT_USER_CONFIRMATION" } as const;
  const strategy: Strategy = { ...input.strategy, steps: [...input.strategy.steps, wait, refresh, swap] };
  const result = verifyStrategyReceipt({ ...input, strategy });
  assert.equal(result.status, "CONFIRMED");
  if (result.status === "CONFIRMED") {
    assert.deepEqual(result.dependencies.map((item) => item.stepId), ["approve", "wait"]);
    assert.equal(result.dependencies.every((item) => item.kind === "CONFIRMED_RECEIPT"), true);
    assert.equal(result.dependencies.some((item) => item.stepId === "refresh" || item.stepId === "swap"), false);
  }
});

test("one bounded read-only acquisition distinguishes pending and provider failure", async () => {
  let receipts = 0, transactions = 0;
  const client = (receipt: () => Promise<unknown>) => ({ chain: arcTestnet, getTransactionReceipt: async () => { receipts++; return receipt(); }, getTransaction: async () => { transactions++; throw Error("rpc"); } }) as unknown as PublicClient;
  const notFound = new Error("pending"); notFound.name = "TransactionReceiptNotFoundError";
  assert.equal((await acquireStrategyReceipt(client(async () => { throw notFound; }), hash, now)).status, "PENDING");
  assert.equal(transactions, 0);
  assert.equal((await acquireStrategyReceipt(client(async () => { throw Error("rpc"); }), hash, now)).status, "UNAVAILABLE");
  assert.equal((await acquireStrategyReceipt(client(async () => ({ transactionHash: hash, status: "success", blockNumber: 123n })), hash, now)).status, "UNAVAILABLE");
  assert.equal(receipts, 3); assert.equal(transactions, 1);
});

test("bounded adapter normalizes a successful read without signing or polling", async () => {
  const input = await fixture("SEND");
  if (input.observation.status !== "FOUND") throw Error("fixture");
  let receipts = 0, transactions = 0;
  const client = { chain: arcTestnet,
    getTransactionReceipt: async () => { receipts++; return { transactionHash: hash, status: "success", blockNumber: 123n }; },
    getTransaction: async () => { transactions++; return { ...input.observation.transaction, value: 0n }; },
  } as unknown as PublicClient;
  const observation = await acquireStrategyReceipt(client, hash, now);
  assert.equal(observation.status, "FOUND");
  assert.equal(receipts, 1); assert.equal(transactions, 1);
  assert.equal(verifyStrategyReceipt({ ...input, observation }).status, "CONFIRMED");
});

test("verifier has no execution, polling, signer or next-step authority", () => {
  const source = readFileSync(new URL("./strategyReceipt.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /privateKey|mnemonic|seed|password|unlock|signer|sendTransaction|writeContract|broadcast|waitForTransactionReceipt|executeStrategyStep|setInterval|setTimeout/);
});
