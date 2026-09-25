import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool, type PrepareResult } from "./agent/prepareTools.ts";
import { runQuoteTool, type QuoteContext } from "./agent/quoteTools.ts";
import { runReadTool } from "./agent/readTools.ts";
import type { FinalPolicyInput } from "./policyEngine.ts";
import { evaluateStrategyContinuation } from "./strategyContinuation.ts";
import { validateStrategy, type ActionStep, type Strategy } from "./strategyModel.ts";
import { verifyStrategyReceipt } from "./strategyReceipt.ts";
import { evaluateStrategyRecovery, type StrategyRecoveryRecord } from "./strategyRecovery.ts";
import { acquirePostReceiptEvidence, evaluatePostReceiptRevalidation } from "./strategyRefresh.ts";
import { executeStrategyStep } from "./strategyStep.ts";
import { XYLO_ROUTER } from "./swap.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const hash = `0x${"a".repeat(64)}` as Hash;
const start = 1_000_000, receiptAt = start + 100, now = start + 200;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };

function context(time: number, allowance: bigint): QuoteContext {
  const snapshot = createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: time });
  return { snapshot, now: () => time, reads: { readBalance: async (_owner, asset) => balances[asset], readAllowance: async () => allowance }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: time }) } };
}

async function swapEvidence(ctx: QuoteContext) {
  const quote = await runQuoteTool(ctx, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005 });
  const preparation = await runPrepareTool(ctx, { tool: "swap.prepare", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005, quote });
  if (quote.status !== "AVAILABLE" || preparation.status !== "PREPARED") throw Error("fixture requires available canonical evidence");
  return { quote, preparation };
}

async function policy(ctx: QuoteContext, prepared: Awaited<ReturnType<typeof swapEvidence>>, index: number): Promise<FinalPolicyInput> {
  const reads = { snapshot: ctx.snapshot, services: ctx.reads, now: ctx.now };
  const wallet = await runReadTool(reads, { tool: "wallet.state" });
  const network = await runReadTool(reads, { tool: "network.verified" });
  const balanceRead = await runReadTool(reads, { tool: "assets.balances" });
  const allowance = await runReadTool(reads, { tool: "token.allowance", assetId: "usdc", spender: XYLO_ROUTER });
  const time = ctx.now!();
  return { action: "SWAP", account, chainId: arcTestnet.id, now: time, wallet, network, quote: prepared.quote, preparation: prepared.preparation, stepIndex: index, current: { wallet, network, balances: balanceRead, allowance, quote: prepared.quote, fee: { status: "not-estimated", observedAt: time }, simulation: { status: "passed", account, chainId: arcTestnet.id, request: prepared.preparation.data.steps[index].request, quoteFingerprint: prepared.preparation.data.quoteFingerprint, observedAt: time } } };
}

function action(id: string, kind: ActionStep["action"], preparation: PrepareResult, index: number, dependsOn: string[] = []): ActionStep {
  if (preparation.status !== "PREPARED") throw Error("fixture requires preparation");
  return { id, kind: "ACTION", action: kind, dependsOn, confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: preparation.tool, quoteFingerprint: preparation.data.quoteFingerprint, stepIndex: index } };
}

test("approval, receipt, fresh revalidation and Swap compose only through separate invocations", async () => {
  const before = context(start, 0n), after = context(now, 10_000_000n);
  const old = await swapEvidence(before), fresh = await swapEvidence(after);
  const approve = action("approve", "APPROVE", old.preparation, 0);
  const wait = { id: "wait", kind: "WAIT_RECEIPT", dependsOn: ["approve"], receipt: { kind: "RECEIPT", actionStepId: "approve" } } as const;
  const refresh = { id: "refresh", kind: "REVALIDATE", dependsOn: ["wait"] } as const;
  const swap = action("swap", "SWAP", fresh.preparation, 0, ["refresh"]);
  const strategy: Strategy = { version: 1, id: "phase10-integration", createdAt: start, steps: [approve, wait, refresh, swap] };
  assert.equal(validateStrategy(strategy).valid, true);
  const first = evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now: start });
  assert.equal(first.status, "NEXT_STEP_READY");
  if (first.status === "NEXT_STEP_READY") assert.deepEqual(first.steps.map((step) => step.stepId), ["approve"]);
  assert.equal(executeStrategyStep({ strategy, stepId: "approve", policyInput: await policy(before, old, 0) }).status, "READY_FOR_WALLET_REVIEW");
  const submitted = { strategyId: strategy.id, stepId: approve.id, action: approve.action, preparedAction: approve.preparedAction!, hash, account, chainId: arcTestnet.id };
  const request = old.preparation.data.steps[0].request;
  const receipt = verifyStrategyReceipt({ strategy, submitted, preparation: old.preparation, observation: { status: "FOUND", observedAt: receiptAt, chainId: arcTestnet.id, receipt: { hash, status: "success", blockNumber: "123" }, transaction: { hash, from: account, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } } });
  assert.equal(receipt.status, "CONFIRMED");
  if (receipt.status !== "CONFIRMED") throw Error("fixture requires confirmation");
  assert.equal(evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [receipt] }).status, "REVALIDATION_REQUIRED");
  const task = { strategy, priorStepId: approve.id, selectedStepId: swap.id, expectedSubmittedHash: hash, receipt, baselineQuote: fresh.quote, now };
  const acquired = await acquirePostReceiptEvidence(task, after);
  assert.equal("status" in acquired, false);
  const refreshed = evaluatePostReceiptRevalidation(task, acquired, await policy(after, fresh, 0));
  assert.equal(refreshed.status, "READY_WITH_FRESH_EVIDENCE");
  if (refreshed.status !== "READY_WITH_FRESH_EVIDENCE" || "status" in acquired) throw Error("fixture requires fresh evidence");
  const next = evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [receipt], revalidations: [refreshed], currentPolicy: refreshed.policy });
  assert.equal(next.status, "NEXT_STEP_READY");
  if (next.status === "NEXT_STEP_READY") assert.deepEqual(next.steps.map((step) => [step.stepId, step.confirmation]), [["swap", "EXPLICIT_USER_CONFIRMATION"]]);
  const currentPolicy = await policy(after, fresh, 0);
  const freshPolicy: FinalPolicyInput = { ...currentPolicy, quote: acquired.quote, current: { ...currentPolicy.current, wallet: acquired.wallet, network: acquired.network, balances: acquired.balances, allowance: acquired.allowance, quote: acquired.quote } };
  assert.equal(executeStrategyStep({ strategy, stepId: "swap", policyInput: freshPolicy, dependencies: [...receipt.dependencies, ...refreshed.dependencies] }).status, "READY_FOR_WALLET_REVIEW");
  assert.equal(evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [receipt], revalidations: [refreshed] }).status, "NEXT_STEP_READY");
  assert.equal(evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [{ ...receipt, hash: `0x${"c".repeat(64)}` }], revalidations: [refreshed] }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [receipt], revalidations: [{ ...refreshed, evidence: { ...refreshed.evidence, account: recipient } }] }).status, "INVALID_EVIDENCE");
  const blocked = executeStrategyStep({ strategy, stepId: "swap", policyInput: { ...freshPolicy, current: { ...freshPolicy.current, simulation: { ...freshPolicy.current.simulation, status: "reverted" } } }, dependencies: [...receipt.dependencies, ...refreshed.dependencies] });
  assert.equal(blocked.status, "POLICY_STOP");
  if (blocked.status === "POLICY_STOP") assert.equal(evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [receipt], revalidations: [refreshed], currentPolicy: blocked.policy }).status, "POLICY_STOP");
});

test("single Send reaches review, confirms through 10C, then completes without another action", async () => {
  const ctx = context(now, 0n), reads = { snapshot: ctx.snapshot, services: ctx.reads, now: ctx.now };
  const quote = await runQuoteTool(ctx, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient });
  const preparation = await runPrepareTool(ctx, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient, quote });
  if (quote.status !== "AVAILABLE" || preparation.status !== "PREPARED") throw Error("fixture requires Send evidence");
  const send = action("send", "SEND", preparation, 0);
  const strategy: Strategy = { version: 1, id: "phase10-send", createdAt: start, steps: [send] };
  assert.equal(evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now }).status, "NEXT_STEP_READY");
  const wallet = await runReadTool(reads, { tool: "wallet.state" }), network = await runReadTool(reads, { tool: "network.verified" }), balanceRead = await runReadTool(reads, { tool: "assets.balances" });
  const input: FinalPolicyInput = { action: "SEND", account, chainId: arcTestnet.id, now, wallet, network, quote, preparation, stepIndex: 0, current: { wallet, network, balances: balanceRead, quote, fee: { status: "available", observedAt: now, maximumFeeRaw18: quote.data.maximumFeeRaw18, maximumFeeUsdc6: quote.data.maximumFeeUsdc6, gasBalanceRaw18: 10_000_000_000_000_000n }, simulation: { status: "passed", account, chainId: arcTestnet.id, request: preparation.data.steps[0].request, quoteFingerprint: preparation.data.quoteFingerprint, observedAt: now } } };
  assert.equal(executeStrategyStep({ strategy, stepId: send.id, policyInput: input }).status, "READY_FOR_WALLET_REVIEW");
  const request = preparation.data.steps[0].request;
  const receipt = verifyStrategyReceipt({ strategy, submitted: { strategyId: strategy.id, stepId: send.id, action: "SEND", preparedAction: send.preparedAction!, hash, account, chainId: arcTestnet.id }, preparation, observation: { status: "FOUND", observedAt: now, chainId: arcTestnet.id, receipt: { hash, status: "success", blockNumber: "123" }, transaction: { hash, from: account, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } } });
  assert.equal(receipt.status, "CONFIRMED");
  assert.equal(evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [receipt] }).status, "STRATEGY_COMPLETE");
});

test("restart recovery keeps known and unknown submissions out of retry eligibility", async () => {
  const ctx = context(start, 0n), prepared = await swapEvidence(ctx);
  const approve = action("approve", "APPROVE", prepared.preparation, 0);
  const strategy: Strategy = { version: 1, id: "phase10-recovery", createdAt: start, steps: [approve] };
  const base: StrategyRecoveryRecord = { version: 1, attemptId: "attempt_10g", strategyId: strategy.id, stepId: approve.id, action: approve.action, account, chainId: arcTestnet.id, preparedAction: approve.preparedAction!, event: "SUBMITTED", submittedHash: hash };
  const restored = JSON.parse(JSON.stringify({ strategy, record: base }));
  assert.equal(evaluateStrategyRecovery({ ...restored, now }).status, "WAIT_FOR_RECEIPT");
  assert.equal(evaluateStrategyRecovery({ strategy, record: { ...base, event: "SUBMISSION_OUTCOME_UNKNOWN", submittedHash: undefined }, now }).status, "INVALID_EVIDENCE");
  const unknown: StrategyRecoveryRecord = { version: 1, attemptId: base.attemptId, strategyId: base.strategyId, stepId: base.stepId, action: base.action, account: base.account, chainId: base.chainId, preparedAction: base.preparedAction, event: "SUBMISSION_OUTCOME_UNKNOWN" };
  assert.equal(evaluateStrategyRecovery({ strategy, record: unknown, now }).status, "SUBMISSION_OUTCOME_UNKNOWN");
  assert.equal(evaluateStrategyRecovery({ strategy, record: { ...base, event: "USER_REJECTED", submittedHash: undefined }, now }).status, "INVALID_EVIDENCE");
  const rejected: StrategyRecoveryRecord = { ...unknown, event: "USER_REJECTED" };
  assert.equal(evaluateStrategyRecovery({ strategy, record: rejected, now }).status, "USER_REJECTED");
  const pending = { status: "PENDING", strategyId: strategy.id, stepId: approve.id, hash } as const;
  assert.equal(evaluateStrategyRecovery({ strategy, record: base, now, receipt: pending }).status, "WAIT_FOR_RECEIPT");
  const reverted = { status: "REVERTED", strategyId: strategy.id, stepId: approve.id, action: approve.action, account, preparedAction: approve.preparedAction!, hash, chainId: arcTestnet.id, blockNumber: "123", scope: "SOURCE_TRANSACTION" } as const;
  assert.equal(evaluateStrategyRecovery({ strategy, record: base, now, receipt: reverted }).status, "REVALIDATION_REQUIRED");
  const failed: StrategyRecoveryRecord = { ...unknown, event: "PRE_SUBMISSION_FAILURE" };
  const artifacts = { quote: { tool: "swap.quote", account, chainId: arcTestnet.id, fingerprint: approve.preparedAction!.quoteFingerprint, expiresAt: now - 1 }, preparation: { tool: "swap.prepare", account, chainId: arcTestnet.id, quoteFingerprint: approve.preparedAction!.quoteFingerprint, stepIndex: 0, expiresAt: now + 100 } };
  assert.equal(evaluateStrategyRecovery({ strategy, record: failed, now, artifacts }).status, "REQUOTE_REQUIRED");
});

test("fan-in uses two independent confirmed receipts, not array position", async () => {
  const ctx = context(now, 0n);
  const quote = await runQuoteTool(ctx, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient });
  const preparation = await runPrepareTool(ctx, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient, quote });
  if (preparation.status !== "PREPARED") throw Error("fixture requires Send preparation");
  const a = action("a", "SEND", preparation, 0), b = action("b", "SEND", preparation, 0), child = action("child", "SEND", preparation, 0, ["a", "b"]);
  const strategy: Strategy = { version: 1, id: "phase10-fan-in", createdAt: start, steps: [child, b, a] };
  const initial = evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now });
  assert.equal(initial.status, "NEXT_STEP_READY");
  if (initial.status === "NEXT_STEP_READY") assert.deepEqual(initial.steps.map((step) => step.stepId), ["b", "a"]);
  const request = preparation.data.steps[0].request;
  const receipt = (step: ActionStep, txHash: Hash) => verifyStrategyReceipt({ strategy, submitted: { strategyId: strategy.id, stepId: step.id, action: "SEND", preparedAction: step.preparedAction!, hash: txHash, account, chainId: arcTestnet.id }, preparation, observation: { status: "FOUND", observedAt: now, chainId: arcTestnet.id, receipt: { hash: txHash, status: "success", blockNumber: "123" }, transaction: { hash: txHash, from: account, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } } });
  const proofA = receipt(a, hash), proofB = receipt(b, `0x${"b".repeat(64)}`);
  assert.equal(proofA.status, "CONFIRMED"); assert.equal(proofB.status, "CONFIRMED");
  const one = evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [proofA] });
  assert.equal(one.status, "NEXT_STEP_READY");
  if (one.status === "NEXT_STEP_READY") assert.deepEqual(one.steps.map((step) => step.stepId), ["b"]);
  const both = evaluateStrategyContinuation({ strategy, account, chainId: arcTestnet.id, now, receipts: [proofA, proofB] });
  assert.equal(both.status, "NEXT_STEP_READY");
  if (both.status === "NEXT_STEP_READY") assert.deepEqual(both.steps.map((step) => step.stepId), ["child"]);
});
