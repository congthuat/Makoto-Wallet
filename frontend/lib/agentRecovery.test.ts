import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, type Hash } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool } from "./agent/prepareTools.ts";
import { runQuoteTool } from "./agent/quoteTools.ts";
import { evaluateAgentRecovery } from "./agentRecovery.ts";
import { createPreparedAgentState } from "./agentState.ts";
import { agentStateStorageKey, restoreAgentState, storeAgentState } from "./agentStatePersistence.ts";
import type { StrategyReceiptObservation } from "./strategyReceipt.ts";
import type { StrategyRecoveryRecord } from "./strategyRecovery.ts";
import type { ActionStep, Strategy } from "./strategyModel.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const hash = `0x${"a".repeat(64)}` as Hash;
const otherHash = `0x${"b".repeat(64)}` as Hash;
const now = 1_000_000;
const sessionId = "session:12e";
class MemoryStore {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const historical = (state: unknown) => ({ status: "HISTORICAL", state }) as const;
const at = <T>(time: number, run: () => T): T => { const original = Date.now; try { Date.now = () => time; return run(); } finally { Date.now = original; } };

async function fixture(owner = account, transactionHash = hash, action: "SEND" | "BRIDGE" = "SEND") {
  const balances = { usdc: 100_000_000n, eurc: 0n, cirbtc: 0n };
  const snapshot = createAgentContextSnapshot({ connected: true, account: owner, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: now });
  const context = { snapshot, now: () => now, reads: { readBalance: async (_owner: typeof owner, asset: keyof typeof balances) => balances[asset], readAllowance: async () => 0n }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: now }), readDirectCctpFee: async () => ({ finalityThreshold: 2000 as const, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now }) } };
  const quote = action === "SEND"
    ? await runQuoteTool(context, { tool: "send.quote", account: owner, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient: other })
    : await runQuoteTool(context, { tool: "bridge.quote", account: owner, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: owner, route: "cctp-direct-forwarding" });
  const preparation = action === "SEND"
    ? await runPrepareTool(context, { tool: "send.prepare", account: owner, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient: other, quote })
    : await runPrepareTool(context, { tool: "bridge.prepare", account: owner, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: owner, route: "cctp-direct-forwarding", quote });
  if (preparation.status !== "PREPARED") throw Error("canonical preparation required");
  const stepId = action.toLowerCase();
  const step: ActionStep = { id: stepId, kind: "ACTION", action, dependsOn: [], confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: preparation.tool, quoteFingerprint: preparation.data.quoteFingerprint, stepIndex: action === "BRIDGE" ? 1 : 0 } };
  const strategy: Strategy = { version: 1, id: "strategy:12e", createdAt: now, steps: [step] };
  const prepared = createPreparedAgentState({ sessionId, stateId: "prepared:12e" }, { strategy, stepId, quote, preparation });
  if (!prepared || prepared.kind !== "TRANSACTION") throw Error("bound state required");
  const attempt = { kind: "TRANSACTION_ATTEMPT", id: "attempt_12e" } as const;
  const state = (status: string, stateId: string, extra = {}) => ({ ...prepared, stateId, status, ...(["SUBMITTED", "CONFIRMING", "SUCCESS", "FAILED"].includes(status) ? { attempt, submittedHash: transactionHash } : {}), ...extra });
  const request = preparation.data.steps[step.preparedAction!.stepIndex].request;
  const observation: StrategyReceiptObservation = { status: "FOUND", observedAt: now, chainId: arcTestnet.id, receipt: { hash: transactionHash, status: "success", blockNumber: "123" }, transaction: { hash: transactionHash, from: owner, to: request.to, input: request.data, value: request.value, chainId: arcTestnet.id } };
  const record: StrategyRecoveryRecord = { version: 1, attemptId: attempt.id, strategyId: strategy.id, stepId, action, account: owner, chainId: arcTestnet.id, preparedAction: step.preparedAction!, event: "SUBMITTED", submittedHash: transactionHash };
  const submitted = state("SUBMITTED", "submitted:12e");
  const confirming = state("CONFIRMING", "confirming:12e");
  const success = state("SUCCESS", "success:12e", { receipt: { kind: "RECEIPT", chainId: arcTestnet.id, transactionHash } });
  const failed = state("FAILED", "failed:12e");
  return { prepared, state, strategy, record, preparation, observation, submitted, confirming, success, failed, attempt };
}

test("12E classifies all historical states without restoring execution authority", async () => {
  const f = await fixture();
  const requested = { version: 2, sessionId, stateId: "requested:12e", kind: "REQUESTED" };
  const plan = { version: 2, sessionId, stateId: "plan:12e", kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "plan:12e" } };
  const cases = [
    [requested, "DESCRIPTIVE_ONLY"], [plan, "MISSING_PLAN_STRATEGY_BINDING"], [f.prepared, "FRESH_REVIEW_REQUIRED"],
    [f.state("AWAITING_SIGNATURE", "awaiting:12e"), "FRESH_REVIEW_AND_CONFIRMATION_REQUIRED"],
    ...[f.success, f.state("REJECTED", "rejected:12e", { attempt: f.attempt }), f.state("EXPIRED", "expired:12e", { attempt: f.attempt }), f.failed].map((state) => [state, "TERMINAL_HISTORICAL"]),
  ] as const;
  for (const [state, expected] of cases) {
    const store = new MemoryStore();
    assert.equal(storeAgentState(store, state, { account, chainId: arcTestnet.id }), true);
    const restored = restoreAgentState(store, sessionId, { account, chainId: arcTestnet.id });
    assert.equal(evaluateAgentRecovery({ restored }).status, expected);
    assert.equal("state" in evaluateAgentRecovery({ restored }), false);
  }
});

test("12E known hash stays non-resubmittable until bounded 10C observation", async () => {
  const f = await fixture();
  const base = { restored: historical(f.submitted), strategy: f.strategy, record: f.record, preparation: f.preparation };
  assert.equal(evaluateAgentRecovery({ restored: historical(f.submitted) }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateAgentRecovery(base).status, "RECEIPT_VERIFICATION_REQUIRED");
  for (const status of ["PENDING", "UNAVAILABLE"] as const) {
    const result = evaluateAgentRecovery({ ...base, observation: { status, observedAt: now } });
    assert.equal(result.status, status === "PENDING" ? "PENDING_CONFIRMATION" : "OUTCOME_UNKNOWN");
    assert.equal("state" in result, false);
  }
  const awaiting = f.state("AWAITING_SIGNATURE", "awaiting:12e");
  assert.equal(evaluateAgentRecovery({ restored: historical(awaiting), strategy: f.strategy, record: { ...f.record, event: "SUBMISSION_OUTCOME_UNKNOWN", submittedHash: undefined } as unknown as StrategyRecoveryRecord }).status, "INVALID_EVIDENCE");
  const { submittedHash: _hash, ...unsubmitted } = f.record;
  assert.equal(_hash, hash);
  assert.equal(evaluateAgentRecovery({ restored: historical(awaiting), strategy: f.strategy, record: { ...unsubmitted, event: "SUBMISSION_OUTCOME_UNKNOWN" } }).status, "OUTCOME_UNKNOWN");
  assert.equal(evaluateAgentRecovery({ restored: historical(awaiting), strategy: f.strategy, record: { ...unsubmitted, event: "USER_REJECTED" } }).status, "PREVIOUS_ATTEMPT_STOPPED");
});

test("12E confirmed and reverted observations use only existing legal edges", async () => {
  const f = await fixture();
  const base = { strategy: f.strategy, record: f.record, preparation: f.preparation };
  assert.equal(evaluateAgentRecovery({ ...base, restored: historical(f.submitted), observation: f.observation, next: f.success }).status, "NO_DIRECT_SUCCESS_EDGE");
  assert.deepEqual(evaluateAgentRecovery({ ...base, restored: historical(f.confirming), observation: f.observation }), { status: "LEGAL_TRANSITION_REQUIRED", target: "SUCCESS" });
  assert.deepEqual(evaluateAgentRecovery({ ...base, restored: historical(f.confirming), observation: f.observation, next: f.success }), { status: "GUARDED_TRANSITION", state: f.success, sourceOnly: false });
  assert.equal(f.confirming.status, "CONFIRMING", "recovery does not mutate or persist the historical state");
  const reverted: StrategyReceiptObservation = { ...f.observation, receipt: { hash, status: "reverted", blockNumber: "123" } } as StrategyReceiptObservation;
  for (const state of [f.submitted, f.confirming]) {
    assert.deepEqual(evaluateAgentRecovery({ ...base, restored: historical(state), observation: reverted }), { status: "LEGAL_TRANSITION_REQUIRED", target: "FAILED" });
    assert.deepEqual(evaluateAgentRecovery({ ...base, restored: historical(state), observation: reverted, next: f.failed }), { status: "GUARDED_TRANSITION", state: f.failed, sourceOnly: false });
  }
  assert.equal(evaluateAgentRecovery({ ...base, restored: historical(f.confirming), observation: reverted, next: f.success }).status, "INVALID_EVIDENCE");
});

test("12E denies coordinated alternate account, attempt, hash and observed transaction", async () => {
  const f = await fixture();
  const alternate = await fixture(other, otherHash);
  const otherRecord = { ...alternate.record, attemptId: "attempt_other" };
  assert.equal(evaluateAgentRecovery({ restored: historical(f.confirming), strategy: alternate.strategy, record: otherRecord, preparation: alternate.preparation, observation: alternate.observation, next: f.success }).status, "INVALID_EVIDENCE");
  const base = { restored: historical(f.confirming), strategy: f.strategy, record: f.record, preparation: f.preparation, observation: f.observation, next: f.success };
  for (const changed of [
    { record: { ...f.record, account: other } }, { record: { ...f.record, chainId: baseSepolia.id } }, { record: { ...f.record, strategyId: "other" } }, { record: { ...f.record, stepId: "other" } },
    { record: { ...f.record, action: "SWAP" } }, { record: { ...f.record, attemptId: "attempt_other" } }, { record: { ...f.record, submittedHash: otherHash } },
    { record: { ...f.record, preparedAction: { ...f.record.preparedAction, quoteFingerprint: otherHash } } },
    { observation: { ...f.observation, transaction: { ...(f.observation as Extract<StrategyReceiptObservation, { status: "FOUND" }>).transaction, from: other } } },
    { next: { ...f.success, scope: "DESTINATION_CHAIN" } },
  ]) assert.equal(evaluateAgentRecovery({ ...base, ...changed } as typeof base).status, "INVALID_EVIDENCE");
  assert.equal(evaluateAgentRecovery({ ...base, observation: { status: "FOUND", observedAt: now, chainId: arcTestnet.id, receipt: { hash: otherHash, status: "success", blockNumber: "123" }, transaction: (f.observation as Extract<StrategyReceiptObservation, { status: "FOUND" }>).transaction } }).status, "INVALID_EVIDENCE");
  const throwing = new Proxy({}, { getPrototypeOf() { throw Error("malformed"); } });
  assert.equal(evaluateAgentRecovery({ ...base, observation: throwing as StrategyReceiptObservation }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateAgentRecovery({ ...base, restored: throwing as never }).status, "INVALID_EVIDENCE");
});

test("12E preserves CCTP source truth and rejects destination inference", async () => {
  const f = await fixture(account, hash, "BRIDGE");
  const base = { strategy: f.strategy, record: f.record, preparation: f.preparation };
  assert.deepEqual(evaluateAgentRecovery({ ...base, restored: historical(f.confirming), observation: f.observation, next: f.success }), { status: "GUARDED_TRANSITION", state: f.success, sourceOnly: true });
  const reverted: StrategyReceiptObservation = { ...f.observation, receipt: { hash, status: "reverted", blockNumber: "123" } } as StrategyReceiptObservation;
  assert.deepEqual(evaluateAgentRecovery({ ...base, restored: historical(f.submitted), observation: reverted, next: f.failed }), { status: "GUARDED_TRANSITION", state: f.failed, sourceOnly: true });
  assert.equal(evaluateAgentRecovery({ ...base, restored: historical({ ...f.confirming, scope: "DESTINATION_CHAIN" }), observation: f.observation, next: f.success }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateAgentRecovery({ ...base, restored: historical(f.confirming), observation: f.observation, next: { ...f.success, scope: "DESTINATION_CHAIN" } }).status, "INVALID_EVIDENCE");
});

test("12E rejects v1 restore, stale or future observations, and malformed evidence", async () => {
  const f = await fixture();
  const base = { restored: historical(f.confirming), strategy: f.strategy, record: f.record, preparation: f.preparation, observation: f.observation, next: f.success };
  assert.equal(evaluateAgentRecovery({ restored: historical({ ...f.confirming, version: 1 }) }).status, "INVALID_EVIDENCE");
  const store = new MemoryStore();
  assert.equal(storeAgentState(store, { ...f.confirming, version: 1 }, { account, chainId: arcTestnet.id }), false);
  store.values.set(agentStateStorageKey(sessionId, { account, chainId: arcTestnet.id })!, JSON.stringify({ version: 1, account, chainId: arcTestnet.id, state: { ...f.confirming, version: 1 } }));
  assert.deepEqual(restoreAgentState(store, sessionId, { account, chainId: arcTestnet.id }), { status: "INVALID" });
  assert.equal(evaluateAgentRecovery({ restored: { status: "INVALID" } }).status, "INVALID_EVIDENCE");
  assert.equal(at(now - 1, () => evaluateAgentRecovery(base).status), "INVALID_EVIDENCE");
  assert.equal(at(NaN, () => evaluateAgentRecovery(base).status), "INVALID_EVIDENCE");
  assert.equal(evaluateAgentRecovery({ ...base, next: { ...f.success, stateId: f.confirming.stateId } }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateAgentRecovery({ ...base, preparation: undefined }).status, "RECEIPT_VERIFICATION_REQUIRED");
  assert.equal(evaluateAgentRecovery({ ...base, observation: undefined }).status, "RECEIPT_VERIFICATION_REQUIRED");
});

test("12E mismatch, invalid receipt, and caller time cannot claim recovery", async () => {
  const f = await fixture();
  const base = { restored: historical(f.confirming), strategy: f.strategy, record: f.record, preparation: f.preparation, next: f.success };
  const found = f.observation as Extract<StrategyReceiptObservation, { status: "FOUND" }>;
  for (const observation of [
    { ...found, receipt: { ...found.receipt, hash: otherHash } },
    { ...found, transaction: { ...found.transaction, hash: otherHash } },
    { ...found, transaction: { ...found.transaction, from: other } },
    { ...found, transaction: { ...found.transaction, input: "0x" } },
    { ...found, chainId: baseSepolia.id },
    { status: "FOUND", observedAt: now } as unknown,
  ]) assert.equal(evaluateAgentRecovery({ ...base, observation: observation as StrategyReceiptObservation }).status, "INVALID_EVIDENCE");
  assert.equal(at(now - 1, () => evaluateAgentRecovery({ ...base, observation: found, now: now + 1_000_000 } as typeof base).status), "INVALID_EVIDENCE");
  assert.equal(at(Infinity, () => evaluateAgentRecovery({ ...base, observation: found }).status), "INVALID_EVIDENCE");
  assert.equal(evaluateAgentRecovery({ ...base, record: { ...f.record, event: "SUBMISSION_OUTCOME_UNKNOWN", submittedHash: undefined } as StrategyRecoveryRecord }).status, "INVALID_EVIDENCE");
});
