import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress, type Hash } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool, type PrepareResult } from "./agent/prepareTools.ts";
import { runQuoteTool, type QuoteContext } from "./agent/quoteTools.ts";
import { runReadTool } from "./agent/readTools.ts";
import { CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import type { FinalPolicyInput } from "./policyEngine.ts";
import { type ActionStep, type Strategy } from "./strategyModel.ts";
import { verifyStrategyReceipt, type StrategyReceiptResult } from "./strategyReceipt.ts";
import { acquirePostReceiptEvidence, evaluatePostReceiptRevalidation, type PostReceiptRequest } from "./strategyRefresh.ts";
import { executeStrategyStep } from "./strategyStep.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const hash = `0x${"a".repeat(64)}` as Hash;
const start = 1_000_000, receiptAt = start + 100, now = start + 200;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };

function context(time: number, allowance: bigint, output = 9_000_000n): QuoteContext {
  const snapshot = createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: time });
  return { snapshot, now: () => time, reads: { readBalance: async (_owner, asset) => balances[asset], readAllowance: async () => allowance }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: output, quotedAt: time }), readDirectCctpFee: async () => ({ finalityThreshold: 2000, minimumFee: 1, forwardFeeMed: "200000", quotedAt: time }) } };
}

async function swapEvidence(ctx: QuoteContext) {
  const quote = await runQuoteTool(ctx, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005 });
  const preparation = await runPrepareTool(ctx, { tool: "swap.prepare", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005, quote });
  assert.equal(preparation.status, "PREPARED");
  if (preparation.status !== "PREPARED") throw Error("fixture");
  return { quote, preparation };
}

function action(id: string, kind: ActionStep["action"], preparation: PrepareResult, index: number, dependsOn: string[] = []): ActionStep {
  if (preparation.status !== "PREPARED") throw Error("fixture");
  return { id, kind: "ACTION", action: kind, dependsOn, confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: preparation.tool, quoteFingerprint: preparation.data.quoteFingerprint, stepIndex: index } };
}

async function setup(rebind = true, freshAllowance = 10_000_000n, freshOutput = 9_000_000n) {
  const before = context(start, 0n);
  const after = context(now, freshAllowance, freshOutput);
  const old = await swapEvidence(before);
  const fresh = await swapEvidence(after);
  const approve = action("approve", "APPROVE", old.preparation, 0);
  const wait = { id: "wait", kind: "WAIT_RECEIPT", dependsOn: ["approve"], receipt: { kind: "RECEIPT", actionStepId: "approve" } } as const;
  const refresh = { id: "refresh", kind: "REVALIDATE", dependsOn: ["wait"] } as const;
  const selected = action("swap", "SWAP", rebind ? fresh.preparation : old.preparation, rebind && fresh.preparation.status === "PREPARED" && fresh.preparation.data.steps.length === 1 ? 0 : 1, ["refresh"]);
  const strategy: Strategy = { version: 1, id: "strategy-10d", createdAt: start, steps: [approve, wait, refresh, selected] };
  if (old.preparation.status !== "PREPARED") throw Error("fixture");
  const request = old.preparation.data.steps[0].request;
  const receipt = verifyStrategyReceipt({ strategy, submitted: { strategyId: strategy.id, stepId: approve.id, action: "APPROVE", preparedAction: approve.preparedAction!, hash, account, chainId: arcTestnet.id }, preparation: old.preparation, observation: { status: "FOUND", observedAt: receiptAt, chainId: arcTestnet.id, receipt: { hash, status: "success", blockNumber: "123" }, transaction: { hash, from: account, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } } });
  assert.equal(receipt.status, "CONFIRMED");
  const task: PostReceiptRequest = { strategy, priorStepId: "approve", selectedStepId: "swap", expectedSubmittedHash: hash, receipt, baselineQuote: rebind ? fresh.quote : old.quote, now };
  const wallet = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "wallet.state" });
  const network = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "network.verified" });
  const balanceRead = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "assets.balances" });
  const allowanceRead = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "token.allowance", assetId: "usdc", spender: getAddress("0x3333333333333333333333333333333333333333") });
  const prepared = fresh.preparation.status === "PREPARED" ? fresh.preparation.data : undefined;
  const index = selected.preparedAction!.stepIndex;
  const policyInput: FinalPolicyInput = { action: "SWAP", account, chainId: arcTestnet.id, now, wallet, network, quote: fresh.quote, preparation: fresh.preparation, stepIndex: index,
    current: { wallet, network, balances: balanceRead, allowance: allowanceRead, quote: fresh.quote, fee: { status: "not-estimated", observedAt: now }, simulation: { status: "passed", account, chainId: arcTestnet.id, request: prepared?.steps[index]?.request, quoteFingerprint: prepared?.quoteFingerprint, observedAt: now } } };
  return { task, after, old, fresh, policyInput };
}

test("confirmed approval refreshes one selected Swap and returns only fresh-evidence readiness", async () => {
  const { task, after, policyInput } = await setup();
  const acquired = await acquirePostReceiptEvidence(task, after);
  assert.equal("status" in acquired, false);
  const result = evaluatePostReceiptRevalidation(task, acquired, policyInput);
  assert.equal(result.status, "READY_WITH_FRESH_EVIDENCE");
  if (result.status === "READY_WITH_FRESH_EVIDENCE") {
    assert.equal(result.selectedStepId, "swap");
    assert.equal(result.evidence.allowance, "10000000");
    assert.equal(result.policy.mustStop, false);
    assert.deepEqual(result.dependencies, [{ kind: "CURRENT_REVALIDATION", stepId: "refresh", quoteFingerprint: result.evidence.quoteFingerprint }]);
    assert.doesNotThrow(() => JSON.stringify(result.evidence));
    if ("status" in acquired || task.receipt.status !== "CONFIRMED") throw Error("fixture");
    const explicitPolicy: FinalPolicyInput = { ...policyInput, quote: acquired.quote, current: { ...policyInput.current, wallet: acquired.wallet, network: acquired.network, balances: acquired.balances, allowance: acquired.allowance, quote: acquired.quote } };
    const laterReview = executeStrategyStep({ strategy: task.strategy, stepId: "swap", policyInput: explicitPolicy, dependencies: [...task.receipt.dependencies, ...result.dependencies] });
    assert.equal(laterReview.status, "READY_FOR_WALLET_REVIEW");
  }
});

test("unconfirmed, reverted, unavailable and mismatched receipts stop before reads", async () => {
  const { task, after } = await setup();
  let reads = 0;
  const guarded = { ...after, reads: { ...after.reads, readBalance: async (...args: Parameters<NonNullable<typeof after.reads.readBalance>>) => { reads++; return after.reads!.readBalance!(...args); } } };
  for (const status of ["PENDING", "REVERTED", "UNAVAILABLE", "MISMATCH", "INVALID_EVIDENCE"] as const) {
    const receipt = { status } as StrategyReceiptResult;
    const result = await acquirePostReceiptEvidence({ ...task, receipt }, guarded);
    assert.deepEqual(result, { status: "RECEIPT_NOT_CONFIRMED", receiptStatus: status });
  }
  assert.equal(reads, 0);
  assert.equal((await acquirePostReceiptEvidence({ ...task, expectedSubmittedHash: `0x${"b".repeat(64)}` }, guarded)).status, "INVALID_EVIDENCE");
  assert.equal((await acquirePostReceiptEvidence({ ...task, priorStepId: "swap" }, guarded)).status, "INVALID_EVIDENCE");
  if (task.receipt.status !== "CONFIRMED") throw Error("fixture");
  for (const receipt of [{ ...task.receipt, strategyId: "other" }, { ...task.receipt, stepId: "swap" }, { ...task.receipt, action: "SEND" as const }]) {
    assert.equal((await acquirePostReceiptEvidence({ ...task, receipt }, guarded)).status, "INVALID_EVIDENCE");
  }
  assert.equal(reads, 0);
});

test("changed post-approval quote requires rebind rather than reusing old preparation", async () => {
  const { task, after, policyInput } = await setup(false);
  const acquired = await acquirePostReceiptEvidence(task, after);
  const result = evaluatePostReceiptRevalidation(task, acquired, policyInput);
  assert.equal(result.status, "REQUOTE_REQUIRED");
  if (result.status === "REQUOTE_REQUIRED") assert.equal(result.reason, "FRESH_QUOTE_CHANGED");
});

test("failed fresh quote has no fallback to the old quote", async () => {
  const { task, after } = await setup();
  const failed = { ...after, services: { ...after.services, readXyloOutput: async () => { throw Error("rpc"); } } };
  assert.deepEqual(await acquirePostReceiptEvidence(task, failed), { status: "REQUOTE_REQUIRED", reason: "FRESH_QUOTE_UNAVAILABLE" });
});

test("insufficient fresh allowance, unavailable simulation and BLOCK never become ready", async () => {
  const { task, after, policyInput } = await setup(true, 1_000_000n);
  const acquired = await acquirePostReceiptEvidence(task, after);
  assert.equal(evaluatePostReceiptRevalidation(task, acquired, policyInput).status, "REVALIDATION_REQUIRED");
  const good = await setup();
  const goodAcquired = await acquirePostReceiptEvidence(good.task, good.after);
  const unavailable = { ...good.policyInput, current: { ...good.policyInput.current, simulation: { ...good.policyInput.current.simulation, status: "unavailable" as const } } };
  assert.equal(evaluatePostReceiptRevalidation(good.task, goodAcquired, unavailable).status, "REVALIDATION_REQUIRED");
  const reverted = { ...good.policyInput, current: { ...good.policyInput.current, simulation: { ...good.policyInput.current.simulation, status: "reverted" as const } } };
  assert.equal(evaluatePostReceiptRevalidation(good.task, goodAcquired, reverted).status, "POLICY_STOP");
});

test("stale wallet snapshot and missing live allowance cannot claim readiness", async () => {
  const { task, after, policyInput } = await setup();
  assert.equal((await acquirePostReceiptEvidence(task, { ...after, snapshot: { ...after.snapshot, timestamp: start } })).status, "REVALIDATION_REQUIRED");
  const acquired = await acquirePostReceiptEvidence(task, after);
  if ("status" in acquired) throw Error("fixture");
  assert.equal(evaluatePostReceiptRevalidation(task, { ...acquired, allowance: undefined }, policyInput).status, "REVALIDATION_REQUIRED");
  if (acquired.allowance?.status !== "AVAILABLE") throw Error("fixture");
  assert.equal(evaluatePostReceiptRevalidation(task, { ...acquired, allowance: { ...acquired.allowance, observedAt: start, data: { ...acquired.allowance.data, amount: 0n } } }, policyInput).status, "REVALIDATION_REQUIRED");
});

test("fresh quote cannot be substituted across pair, amount, account or route", async () => {
  const { task, after, policyInput } = await setup();
  const acquired = await acquirePostReceiptEvidence(task, after);
  if ("status" in acquired) throw Error("fixture");
  const variants = [
    { ...acquired.quote, outputAsset: "usdc" as const },
    { ...acquired.quote, inputAmount: 9_000_000n },
    { ...acquired.quote, account: recipient },
    { ...acquired.quote, route: "cctp-direct-forwarding" as const },
  ];
  for (const quote of variants) assert.equal(evaluatePostReceiptRevalidation(task, { ...acquired, quote }, policyInput).status, "INVALID_EVIDENCE");
});

test("expired supplied quote requires requote and malformed receipt proof cannot reach reads", async () => {
  const { task, after } = await setup();
  const acquired = await acquirePostReceiptEvidence(task, after);
  if ("status" in acquired || acquired.quote.status !== "AVAILABLE") throw Error("fixture");
  assert.deepEqual(evaluatePostReceiptRevalidation({ ...task, now: acquired.quote.expiresAt! + 1 }, acquired), { status: "REQUOTE_REQUIRED", reason: "FRESH_QUOTE_UNAVAILABLE" });
  if (task.receipt.status !== "CONFIRMED") throw Error("fixture");
  const invalid = { ...task.receipt, dependencies: task.receipt.dependencies.map((item) => item.kind === "CONFIRMED_RECEIPT" ? { ...item, submittedHash: "bad" as Hash } : item) } as StrategyReceiptResult;
  assert.equal((await acquirePostReceiptEvidence({ ...task, receipt: invalid }, after)).status, "INVALID_EVIDENCE");
});

test("selected Send refresh uses canonical fee quote and still needs final evidence", async () => {
  const { task } = await setup();
  const after = context(now, 10_000_000n);
  const quote = await runQuoteTool(after, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 5_000_000n, recipient });
  const preparation = await runPrepareTool(after, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount: 5_000_000n, recipient, quote });
  const send = action("send", "SEND", preparation, 0, ["refresh"]);
  const strategy: Strategy = { ...(task.strategy as Strategy), steps: [...(task.strategy as Strategy).steps.slice(0, -1), send] };
  const selected = { ...task, strategy, selectedStepId: "send", baselineQuote: quote };
  const acquired = await acquirePostReceiptEvidence(selected, after);
  assert.equal("status" in acquired, false);
  assert.equal(evaluatePostReceiptRevalidation(selected, acquired).status, "REVALIDATION_REQUIRED");
});

test("only the selected step is acquired; no automatic REVALIDATE or Swap execution", async () => {
  const { task, after } = await setup();
  let quotes = 0;
  const observed = { ...after, services: { ...after.services, readXyloOutput: async (...args: Parameters<NonNullable<typeof after.services.readXyloOutput>>) => { quotes++; return after.services!.readXyloOutput!(...args); } } };
  await acquirePostReceiptEvidence(task, observed);
  assert.equal(quotes, 1);
  const source = readFileSync(new URL("./strategyRefresh.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /executeStrategyStep|waitForTransactionReceipt|setInterval|setTimeout|privateKey|mnemonic|seed|password|unlock|signer|sendTransaction|writeContract|broadcast/);
});

test("another action dependency needs its own receipt instead of implicit completion", async () => {
  const { task, after } = await setup();
  const strategy = task.strategy as Strategy;
  const selected = strategy.steps.find((step) => step.id === "swap");
  const approve = strategy.steps.find((step) => step.id === "approve");
  if (!selected || selected.kind !== "ACTION" || !approve || approve.kind !== "ACTION") throw Error("fixture");
  const extra: ActionStep = { ...approve, id: "extra" };
  const changed: Strategy = { ...strategy, steps: [...strategy.steps.slice(0, -1), extra, { ...selected, dependsOn: ["refresh", "extra"] }] };
  assert.deepEqual(await acquirePostReceiptEvidence({ ...task, strategy: changed }, after), { status: "REVALIDATION_REQUIRED", reason: "ADDITIONAL_RECEIPT_EVIDENCE_REQUIRED" });
});

test("source CCTP confirmation remains separate from destination and Agent handoff", async () => {
  const { task } = await setup();
  const after = context(now, 100_000_000n);
  const bridgeQuote = await runQuoteTool(after, { tool: "bridge.quote", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding" });
  const bridgePreparation = await runPrepareTool(after, { tool: "bridge.prepare", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding", quote: bridgeQuote });
  const bridge = action("bridge", "BRIDGE", bridgePreparation, 0, ["refresh"]);
  const strategy: Strategy = { ...(task.strategy as Strategy), steps: [...(task.strategy as Strategy).steps.slice(0, -1), bridge] };
  const bridgeTask = { ...task, strategy, selectedStepId: "bridge", baselineQuote: bridgeQuote };
  const result = await acquirePostReceiptEvidence(bridgeTask, after);
  assert.equal("status" in result, false);
  const wallet = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "wallet.state" });
  const network = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "network.verified" });
  const balanceRead = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "assets.balances" });
  const allowanceRead = await runReadTool({ snapshot: after.snapshot, services: after.reads, now: () => now }, { tool: "token.allowance", assetId: "usdc", spender: CCTP_TOKEN_MESSENGER_V2 });
  if (bridgeQuote.status !== "AVAILABLE" || bridgePreparation.status !== "PREPARED") throw Error("fixture");
  const policyInput: FinalPolicyInput = { action: "BRIDGE", account, chainId: arcTestnet.id, now, wallet, network, quote: bridgeQuote, preparation: bridgePreparation, stepIndex: 0,
    current: { wallet, network, balances: balanceRead, allowance: allowanceRead, quote: bridgeQuote, fee: { status: "available", observedAt: now, cctpMaximumFee: bridgeQuote.data.maximumFee, cctpSourceDebit: bridgeQuote.data.sourceDebit }, simulation: { status: "passed", account, chainId: arcTestnet.id, request: bridgePreparation.data.steps[0].request, quoteFingerprint: bridgePreparation.data.quoteFingerprint, observedAt: now } } };
  const assessed = evaluatePostReceiptRevalidation(bridgeTask, result, policyInput);
  assert.deepEqual(assessed, { status: "UNSUPPORTED", reason: "NO_WALLET_HANDOFF" });
  assert.equal(JSON.stringify(assessed).includes("DESTINATION_CONFIRMED"), false);
});
