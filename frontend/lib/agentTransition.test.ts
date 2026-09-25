import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, type Hash } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool } from "./agent/prepareTools.ts";
import { runQuoteTool } from "./agent/quoteTools.ts";
import { runReadTool } from "./agent/readTools.ts";
import { evaluateAgentTransition } from "./agentTransition.ts";
import { validateAgentState } from "./agentState.ts";
import type { FinalPolicyInput } from "./policyEngine.ts";
import type { Strategy, ActionStep } from "./strategyModel.ts";
import type { StrategyRecoveryRecord } from "./strategyRecovery.ts";
import { verifyStrategyReceipt, type StrategyReceiptResult } from "./strategyReceipt.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const hash = `0x${"a".repeat(64)}` as Hash;
const fingerprint = `0x${"b".repeat(64)}` as Hash;
const now = 1_000_000;
const identity = { version: 1, sessionId: "session:1" } as const;
const stepRef = { kind: "STRATEGY_STEP", strategyId: "strategy:1", stepId: "send" } as const;
const attemptRef = { kind: "TRANSACTION_ATTEMPT", id: "attempt_123" } as const;
const receiptRef = { kind: "RECEIPT", chainId: arcTestnet.id, transactionHash: hash } as const;
const state = (status: string, stateId: string, extra = {}) => ({ ...identity, stateId, kind: "TRANSACTION", step: stepRef, scope: "SINGLE_CHAIN", status, ...extra });
const prepared = state("PREPARED", "state:1");
const awaiting = state("AWAITING_SIGNATURE", "state:2");
const submitted = state("SUBMITTED", "state:3", { attempt: attemptRef });
const confirming = state("CONFIRMING", "state:4", { attempt: attemptRef });
const success = state("SUCCESS", "state:5", { attempt: attemptRef, receipt: receiptRef });
const bind = (kind: string, stateId: string, extra = {}) => ({ kind, sessionId: identity.sessionId, stateId, ...extra });
const reason = (result: ReturnType<typeof evaluateAgentTransition>) => result.allowed ? "ALLOWED" : result.reason;

async function fixture() {
  const balances = { usdc: 100_000_000n, eurc: 0n, cirbtc: 0n };
  const snapshot = createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: now });
  const context = { snapshot, now: () => now, reads: { readBalance: async (_owner: typeof account, asset: keyof typeof balances) => balances[asset], readAllowance: async () => 0n }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: now }), readDirectCctpFee: async () => ({ finalityThreshold: 2000 as const, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now }) } };
  const wallet = await runReadTool(context, { tool: "wallet.state" });
  const network = await runReadTool(context, { tool: "network.verified" });
  const quote = await runQuoteTool(context, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient });
  const preparation = await runPrepareTool(context, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient, quote });
  if (quote.status !== "AVAILABLE" || preparation.status !== "PREPARED") throw Error("fixture requires canonical preparation");
  const step: ActionStep = { id: "send", kind: "ACTION", action: "SEND", dependsOn: [], confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: "send.prepare", quoteFingerprint: preparation.data.quoteFingerprint, stepIndex: 0 } };
  const strategy: Strategy = { version: 1, id: stepRef.strategyId, createdAt: now, steps: [step] };
  const policyInput: FinalPolicyInput = { action: "SEND", account, chainId: arcTestnet.id, now, wallet, network, quote, preparation, stepIndex: 0, current: { wallet, network, balances: { tool: "assets.balances", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: balances }, quote, fee: { status: "available", observedAt: now, maximumFeeRaw18: (quote.data as { maximumFeeRaw18: bigint }).maximumFeeRaw18, maximumFeeUsdc6: (quote.data as { maximumFeeUsdc6: bigint }).maximumFeeUsdc6, gasBalanceRaw18: 10_000_000_000_000_000n }, simulation: { status: "passed", account, chainId: arcTestnet.id, request: preparation.data.steps[0].request, quoteFingerprint: preparation.data.quoteFingerprint, observedAt: now } } };
  const record: StrategyRecoveryRecord = { version: 1, attemptId: attemptRef.id, strategyId: strategy.id, stepId: step.id, action: step.action, account, chainId: arcTestnet.id, preparedAction: step.preparedAction!, event: "SUBMITTED", submittedHash: hash };
  const request = preparation.data.steps[0].request;
  const receipt = verifyStrategyReceipt({ strategy, submitted: { strategyId: strategy.id, stepId: step.id, action: step.action, preparedAction: step.preparedAction!, hash, account, chainId: arcTestnet.id }, preparation, observation: { status: "FOUND", observedAt: now, chainId: arcTestnet.id, receipt: { hash, status: "success", blockNumber: "123" }, transaction: { hash, from: account, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } } });
  assert.equal(receipt.status, "CONFIRMED");
  return { strategy, policyInput, record, receipt, context };
}

async function bridgeFixture() {
  const { context } = await fixture();
  const quote = await runQuoteTool(context, { tool: "bridge.quote", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding" });
  const preparation = await runPrepareTool(context, { tool: "bridge.prepare", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding", quote });
  if (preparation.status !== "PREPARED") throw Error("fixture requires canonical Bridge preparation");
  const step: ActionStep = { id: "bridge", kind: "ACTION", action: "BRIDGE", dependsOn: [], confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: "bridge.prepare", quoteFingerprint: preparation.data.quoteFingerprint, stepIndex: 1 } };
  const strategy: Strategy = { version: 1, id: "strategy:bridge", createdAt: now, steps: [step] };
  const record: StrategyRecoveryRecord = { version: 1, attemptId: "attempt_bridge", strategyId: strategy.id, stepId: step.id, action: "BRIDGE", account, chainId: arcTestnet.id, preparedAction: step.preparedAction!, event: "SUBMITTED", submittedHash: hash };
  const request = preparation.data.steps[1].request;
  const receipt = verifyStrategyReceipt({ strategy, submitted: { strategyId: strategy.id, stepId: step.id, action: "BRIDGE", preparedAction: step.preparedAction!, hash, account, chainId: arcTestnet.id }, preparation, observation: { status: "FOUND", observedAt: now, chainId: arcTestnet.id, receipt: { hash, status: "success", blockNumber: "123" }, transaction: { hash, from: account, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } } });
  assert.equal(receipt.status, "CONFIRMED");
  return { strategy, record, receipt };
}

test("12B accepts a validated plan, but denies unbound Plan to Strategy preparation", () => {
  const requested = { ...identity, stateId: "request:1", kind: "REQUESTED" };
  const plan = { version: 1, id: "plan:1", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] }] } as const;
  const planned = { ...identity, stateId: "plan:state", kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: plan.id } };
  const evidence = bind("PLAN", requested.stateId, { result: { status: "GENERATED", plan } });
  assert.equal(evaluateAgentTransition(requested, planned, evidence).allowed, true);
  assert.equal(reason(evaluateAgentTransition(requested, { ...planned, plan: { ...planned.plan, id: "other" } }, evidence)), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(planned, prepared, bind("REVIEW", planned.stateId))), "MISSING_CANONICAL_STRATEGY_BINDING");
  assert.equal(reason(evaluateAgentTransition(requested, success, evidence)), "ILLEGAL_TRANSITION");
  assert.equal(reason(evaluateAgentTransition(planned, submitted, evidence)), "ILLEGAL_TRANSITION");
});

test("12B guards review with 10B and Phase 9, then binds the submitted attempt", async () => {
  const f = await fixture();
  const review = bind("REVIEW", prepared.stateId, { input: { strategy: f.strategy, stepId: "send", policyInput: f.policyInput } });
  assert.equal(evaluateAgentTransition(prepared, awaiting, review).allowed, true);
  assert.equal(reason(evaluateAgentTransition({ ...prepared, scope: "DESTINATION_CHAIN" }, { ...awaiting, scope: "DESTINATION_CHAIN" }, review)), "SCOPE_MISMATCH");
  const stopped = { ...f.policyInput, current: { ...f.policyInput.current, simulation: { ...f.policyInput.current.simulation, status: "reverted" as const } } };
  assert.equal(reason(evaluateAgentTransition(prepared, awaiting, bind("REVIEW", prepared.stateId, { input: { strategy: f.strategy, stepId: "send", policyInput: stopped } }))), "POLICY_STOP");
  assert.equal(reason(evaluateAgentTransition(prepared, awaiting, bind("REVIEW", prepared.stateId, { input: { strategy: f.strategy, stepId: "send", policyInput: { ...f.policyInput, now: now + 60_001 } } }))), "POLICY_STOP");
  assert.equal(reason(evaluateAgentTransition(prepared, awaiting, bind("REVIEW", prepared.stateId, { input: { strategy: f.strategy, stepId: "other", policyInput: f.policyInput } }))), "INVALID_EVIDENCE");
  const attempt = bind("ATTEMPT", awaiting.stateId, { strategy: f.strategy, record: f.record, now });
  assert.equal(evaluateAgentTransition(awaiting, submitted, attempt).allowed, true);
  assert.equal(reason(evaluateAgentTransition(awaiting, submitted, { ...attempt, stateId: "other" })), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(awaiting, { ...submitted, attempt: { ...attemptRef, id: "other" } }, attempt)), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(awaiting, submitted, null)), "INVALID_EVIDENCE");
  const { submittedHash: _hash, ...unsubmitted } = f.record;
  assert.equal(_hash, hash);
  for (const event of ["SUBMISSION_OUTCOME_UNKNOWN", "PRE_SUBMISSION_FAILURE", "USER_REJECTED"] as const) assert.equal(reason(evaluateAgentTransition(awaiting, submitted, { ...attempt, record: { ...unsubmitted, event } })), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(prepared, submitted, attempt)), "ILLEGAL_TRANSITION");
  assert.equal(reason(evaluateAgentTransition(prepared, success, attempt)), "ILLEGAL_TRANSITION");
});

test("12B requires pending then canonical confirmed receipt and exact transitive binding", async () => {
  const f = await fixture();
  const pending: StrategyReceiptResult = { status: "PENDING", strategyId: f.strategy.id, stepId: "send", hash };
  const check = bind("RECEIPT", submitted.stateId, { strategy: f.strategy, record: f.record, receipt: pending, now });
  assert.equal(evaluateAgentTransition(submitted, confirming, check).allowed, true);
  const evidence = bind("RECEIPT", confirming.stateId, { strategy: f.strategy, record: f.record, receipt: f.receipt, now });
  assert.equal(evaluateAgentTransition(confirming, success, evidence).allowed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(evaluateAgentTransition(confirming, success, evidence))), { allowed: true, state: success });
  for (const [current, next] of [[submitted, success], [awaiting, success], [awaiting, confirming]] as const) assert.equal(reason(evaluateAgentTransition(current, next, evidence)), "ILLEGAL_TRANSITION");
  assert.equal(reason(evaluateAgentTransition(confirming, success, bind("RECEIPT", confirming.stateId, { strategy: f.strategy, record: f.record, receipt: pending, now }))), "RECEIPT_NOT_CONFIRMED");
  const unavailable: StrategyReceiptResult = { status: "UNAVAILABLE", strategyId: f.strategy.id, stepId: "send", hash };
  const reverted: StrategyReceiptResult = { status: "REVERTED", strategyId: f.strategy.id, stepId: "send", action: "SEND", account, preparedAction: f.record.preparedAction, hash, chainId: arcTestnet.id, blockNumber: "123", scope: "SOURCE_TRANSACTION" };
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, receipt: unavailable })), "RECEIPT_NOT_CONFIRMED");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, receipt: reverted })), "RECEIPT_NOT_CONFIRMED");
  for (const receipt of [{ status: "MISMATCH", reason: "HASH" }, { status: "INVALID_EVIDENCE", reason: "OBSERVATION" }] as StrategyReceiptResult[]) assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, receipt })), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, receipt: { ...f.receipt, hash: fingerprint } })), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, { ...success, receipt: { ...receiptRef, transactionHash: fingerprint } }, evidence)), "RECEIPT_NOT_CONFIRMED");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, strategyId: "other" } })), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, stepId: "other" } })), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, attemptId: "attempt_other" } })), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, account: recipient } })), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, action: "SWAP" } })), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, preparedAction: { ...f.record.preparedAction, quoteFingerprint: fingerprint } } })), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, chainId: baseSepolia.id } })), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, record: { ...f.record, submittedHash: fingerprint } })), "INVALID_EVIDENCE");
});

test("12B rejects malformed requests, terminal mappings, cross scope, and structural-only proof", async () => {
  const f = await fixture();
  const evidence = bind("RECEIPT", confirming.stateId, { strategy: f.strategy, record: f.record, receipt: f.receipt, now });
  assert.equal(reason(evaluateAgentTransition(null, success, evidence)), "INVALID_STATE");
  assert.equal(reason(evaluateAgentTransition(confirming, { ...success, stateId: confirming.stateId }, evidence)), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, { ...success, sessionId: "session:other" }, evidence)), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, sessionId: "session:other" })), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, stateId: "state:other" })), "IDENTITY_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, success, bind("RECEIPT", confirming.stateId, { receipt: receiptRef }))), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, sign: () => undefined })), "INVALID_EVIDENCE");
  assert.equal(reason(evaluateAgentTransition(confirming, success, null)), "INVALID_EVIDENCE");
  for (const terminal of ["REJECTED", "EXPIRED", "FAILED"]) assert.equal(reason(evaluateAgentTransition(confirming, state(terminal, `state:${terminal}`, { attempt: attemptRef }), evidence)), "DEFERRED_TO_LATER_PHASE");
  assert.equal(reason(evaluateAgentTransition(confirming, { ...success, scope: "DESTINATION_CHAIN" }, evidence)), "IDENTITY_MISMATCH");
  const destination = { ...confirming, scope: "DESTINATION_CHAIN" };
  assert.equal(reason(evaluateAgentTransition(destination, { ...success, scope: "DESTINATION_CHAIN" }, evidence)), "SCOPE_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(confirming, success, { ...evidence, receipt: { ...f.receipt, scope: "DESTINATION_TRANSACTION" } })), "INVALID_EVIDENCE");
});

test("12B rejects invalid plans and malformed input without escaping the guard", () => {
  const requested = { ...identity, stateId: "request:1", kind: "REQUESTED" };
  const planned = { ...identity, stateId: "plan:state", kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "plan:1" } };
  const plan = { version: 1, id: "plan:1", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] }] };
  for (const invalidPlan of [{ ...plan, version: 2 }, { ...plan, goals: [] }, { ...plan, goals: [{ ...plan.goals[0], kind: "UNKNOWN" }] }]) {
    assert.equal(reason(evaluateAgentTransition(requested, planned, bind("PLAN", requested.stateId, { result: { status: "GENERATED", plan: invalidPlan } }))), "INVALID_EVIDENCE");
  }
  assert.equal(reason(evaluateAgentTransition(requested, planned, bind("PLAN", requested.stateId, { result: { status: "PROVIDER_ERROR" } }))), "INVALID_EVIDENCE");
  for (const malformed of [null, [], 42, { ...requested, stateId: "bad id" }]) assert.equal(evaluateAgentTransition(malformed, planned, bind("PLAN", requested.stateId, { result: { status: "GENERATED", plan } })).allowed, false);
  const throwing = new Proxy({}, { getPrototypeOf() { throw Error("malformed input"); } });
  assert.equal(reason(evaluateAgentTransition(throwing, planned, null)), "INVALID_EVIDENCE");
});

test("12B never promotes a hash, receipt reference, or another attempt to SUCCESS", async () => {
  const f = await fixture();
  const canonical = bind("RECEIPT", confirming.stateId, { strategy: f.strategy, record: f.record, receipt: f.receipt, now });
  const cases = [
    ["reference only", bind("RECEIPT", confirming.stateId, { receipt: receiptRef })],
    ["hash only", bind("RECEIPT", confirming.stateId, { transactionHash: hash })],
    ["different attempt record", { ...canonical, record: { ...f.record, attemptId: "attempt_other" } }],
    ["different state attempt", { ...canonical, stateId: submitted.stateId }],
    ["different session", { ...canonical, sessionId: "session:other" }],
    ["missing 10C result", { ...canonical, receipt: undefined }],
  ] as const;
  for (const [label, evidence] of cases) assert.equal(evaluateAgentTransition(confirming, success, evidence).allowed, false, label);
  const accepted = evaluateAgentTransition(confirming, success, canonical);
  assert.equal(accepted.allowed, true);
  if (accepted.allowed) assert.equal(validateAgentState(accepted.state).valid, true);
});

test("12B keeps a Phase 10C CCTP source receipt within source scope", async () => {
  const f = await bridgeFixture();
  const bridgeStep = { kind: "STRATEGY_STEP", strategyId: f.strategy.id, stepId: "bridge" };
  const bridgeAttempt = { kind: "TRANSACTION_ATTEMPT", id: f.record.attemptId };
  const source = { ...confirming, step: bridgeStep, attempt: bridgeAttempt, scope: "SOURCE_CHAIN" };
  const sourceSuccess = { ...success, step: bridgeStep, attempt: bridgeAttempt, scope: "SOURCE_CHAIN" };
  const evidence = bind("RECEIPT", source.stateId, { strategy: f.strategy, record: f.record, receipt: f.receipt, now });
  assert.equal(evaluateAgentTransition(source, sourceSuccess, evidence).allowed, true);
  const destination = { ...source, scope: "DESTINATION_CHAIN" };
  const destinationSuccess = { ...sourceSuccess, scope: "DESTINATION_CHAIN", receipt: { ...receiptRef, chainId: baseSepolia.id } };
  assert.equal(reason(evaluateAgentTransition(destination, destinationSuccess, evidence)), "SCOPE_MISMATCH");
  assert.equal(reason(evaluateAgentTransition(source, destinationSuccess, evidence)), "IDENTITY_MISMATCH");
});

test("12B evaluates only the requested edge and leaves its input state untouched", async () => {
  const f = await fixture();
  const before = JSON.stringify(awaiting);
  const result = evaluateAgentTransition(awaiting, submitted, bind("ATTEMPT", awaiting.stateId, { strategy: f.strategy, record: f.record, now }));
  assert.deepEqual(result, { allowed: true, state: submitted });
  assert.equal(JSON.stringify(awaiting), before);
  assert.equal(result.allowed && result.state.kind === "TRANSACTION" && result.state.status, "SUBMITTED");
  assert.equal(validateAgentState(submitted).valid, true);
});
