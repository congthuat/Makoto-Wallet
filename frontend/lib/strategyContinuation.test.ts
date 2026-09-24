import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { arcTestnet } from "viem/chains";
import { evaluateStrategyContinuation } from "./strategyContinuation.ts";
import type { StrategyReceiptResult } from "./strategyReceipt.ts";
import type { PostReceiptResult } from "./strategyRefresh.ts";
import type { Strategy, StrategyStep } from "./strategyModel.ts";
import type { PolicyResult } from "./policyEngine.ts";

const account = "0x1111111111111111111111111111111111111111";
const fingerprint = `0x${"a".repeat(64)}` as const;
const hash = `0x${"b".repeat(64)}` as const;
const now = 1_000_200;
const allow: PolicyResult = { decision: "ALLOW", findings: [], requiredAction: "NONE", mustStop: false, requiresUserReview: false, requiresFreshQuote: false, requiresRevalidation: false };
const action = (id: string, kind: "APPROVE" | "SEND" | "SWAP" | "BRIDGE", dependsOn: string[] = []): StrategyStep => ({ id, kind: "ACTION", action: kind, dependsOn, confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: kind === "SEND" ? "send.prepare" : kind === "BRIDGE" ? "bridge.prepare" : "swap.prepare", quoteFingerprint: fingerprint, stepIndex: kind === "APPROVE" ? 0 : 1 } });
const wait: StrategyStep = { id: "wait", kind: "WAIT_RECEIPT", dependsOn: ["approve"], receipt: { kind: "RECEIPT", actionStepId: "approve" } };
const refresh: StrategyStep = { id: "refresh", kind: "REVALIDATE", dependsOn: ["wait"] };
const strategy = (steps: StrategyStep[]): Strategy => ({ version: 1, id: "continuation", createdAt: 1_000_000, steps });
const input = (steps: StrategyStep[], receipts: StrategyReceiptResult[] = [], revalidations: PostReceiptResult[] = []) => ({ strategy: strategy(steps), account, chainId: arcTestnet.id, now, receipts, revalidations });
function confirmed(step: Extract<StrategyStep, { kind: "ACTION" }>, transactionHash = hash): StrategyReceiptResult {
  return { status: "CONFIRMED", strategyId: "continuation", stepId: step.id, action: step.action, hash: transactionHash, chainId: arcTestnet.id, blockNumber: "123", scope: "SOURCE_TRANSACTION", dependencies: [{ kind: "CONFIRMED_RECEIPT", strategyId: "continuation", stepId: step.id, actionStepId: step.id, preparedAction: step.preparedAction!, submittedHash: transactionHash, receipt: { tool: "transaction.receipt", account, chainId: arcTestnet.id, capturedAt: now - 100, observedAt: now - 100, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: { hash: transactionHash, state: "confirmed", verified: true } } }] };
}
function renewed(selected: "swap" | "bridge" = "swap"): PostReceiptResult {
  return { status: "READY_WITH_FRESH_EVIDENCE", strategyId: "continuation", selectedStepId: selected, action: selected === "swap" ? "SWAP" : "BRIDGE", evidence: { strategyId: "continuation", selectedStepId: selected, priorStepId: "approve", priorHash: hash, account, chainId: arcTestnet.id, observedAt: now - 10, quoteFingerprint: fingerprint, quoteExpiresAt: now + 100, balance: "10000000", allowance: "10000000" }, policy: allow, dependencies: [{ kind: "CURRENT_REVALIDATION", stepId: "refresh", quoteFingerprint: fingerprint }] };
}

test("single Send is eligible without submission, then complete only after 10C proof", () => {
  const send = action("send", "SEND") as Extract<StrategyStep, { kind: "ACTION" }>;
  assert.deepEqual(evaluateStrategyContinuation(input([send])).status, "NEXT_STEP_READY");
  assert.equal(evaluateStrategyContinuation(input([send], [confirmed(send)])).status, "STRATEGY_COMPLETE");
});

test("approval to Swap waits for receipt and then fresh 10D evidence", () => {
  const approve = action("approve", "APPROVE") as Extract<StrategyStep, { kind: "ACTION" }>;
  const steps = [approve, wait, refresh, action("swap", "SWAP", ["refresh"])];
  assert.equal(evaluateStrategyContinuation(input(steps)).status, "NEXT_STEP_READY");
  const pending = { status: "PENDING", strategyId: "continuation", stepId: "approve", hash } as const;
  assert.equal(evaluateStrategyContinuation(input(steps, [pending])).status, "WAITING_FOR_RECEIPT");
  assert.equal(evaluateStrategyContinuation(input(steps, [confirmed(approve)])).status, "REVALIDATION_REQUIRED");
  const result = evaluateStrategyContinuation(input(steps, [confirmed(approve)], [renewed()]));
  assert.equal(result.status, "NEXT_STEP_READY");
  if (result.status === "NEXT_STEP_READY") assert.deepEqual(result.steps.map((step) => step.stepId), ["swap"]);
  const swap = steps[3] as Extract<StrategyStep, { kind: "ACTION" }>;
  assert.equal(evaluateStrategyContinuation(input(steps, [confirmed(approve), confirmed(swap, `0x${"c".repeat(64)}`)], [renewed()])).status, "STRATEGY_COMPLETE");
});

test("wrong receipt and revalidation bindings cannot satisfy dependencies", () => {
  const approve = action("approve", "APPROVE") as Extract<StrategyStep, { kind: "ACTION" }>;
  const steps = [approve, wait, refresh, action("swap", "SWAP", ["refresh"])];
  const receipt = confirmed(approve);
  if (receipt.status !== "CONFIRMED") throw Error("fixture");
  for (const altered of [{ ...receipt, strategyId: "other" }, { ...receipt, stepId: "swap" }, { ...receipt, action: "SEND" as const }, { ...receipt, dependencies: [{ ...receipt.dependencies[0], submittedHash: `0x${"c".repeat(64)}` }] }]) assert.equal(evaluateStrategyContinuation(input(steps, [altered])).status, "INVALID_EVIDENCE");
  const fresh = renewed();
  if (fresh.status !== "READY_WITH_FRESH_EVIDENCE") throw Error("fixture");
  for (const altered of [{ ...fresh, selectedStepId: "approve" }, { ...fresh, evidence: { ...fresh.evidence, priorHash: `0x${"c".repeat(64)}` as typeof hash } }, { ...fresh, evidence: { ...fresh.evidence, account: "0x2222222222222222222222222222222222222222" } }, { ...fresh, evidence: { ...fresh.evidence, observedAt: now - 101 } }, { ...fresh, dependencies: [{ kind: "CURRENT_REVALIDATION" as const, stepId: "wait", quoteFingerprint: fingerprint }] }]) assert.equal(evaluateStrategyContinuation(input(steps, [receipt], [altered])).status, "INVALID_EVIDENCE");
});

test("fan-in and multiple ready use dependencies and strategy order", () => {
  const a = action("a", "SEND") as Extract<StrategyStep, { kind: "ACTION" }>;
  const b = action("b", "SEND") as Extract<StrategyStep, { kind: "ACTION" }>;
  const c = action("c", "SEND", ["a", "b"]);
  const steps = [c, b, a];
  const first = evaluateStrategyContinuation(input(steps));
  assert.equal(first.status, "NEXT_STEP_READY");
  if (first.status === "NEXT_STEP_READY") assert.deepEqual(first.steps.map((step) => step.stepId), ["b", "a"]);
  const one = evaluateStrategyContinuation(input(steps, [confirmed(a)]));
  assert.equal(one.status, "NEXT_STEP_READY");
  if (one.status === "NEXT_STEP_READY") assert.deepEqual(one.steps.map((step) => step.stepId), ["b"]);
  const both = evaluateStrategyContinuation(input(steps, [confirmed(a), confirmed(b, `0x${"c".repeat(64)}`)]));
  assert.equal(both.status, "NEXT_STEP_READY");
  if (both.status === "NEXT_STEP_READY") assert.deepEqual(both.steps.map((step) => step.stepId), ["c"]);
});

test("Phase 9 stops and Direct CCTP unsupported handoff remain visible", () => {
  const send = action("send", "SEND");
  for (const decision of ["BLOCK", "REQUOTE", "REVALIDATE"] as const) assert.equal(evaluateStrategyContinuation({ ...input([send]), currentPolicy: { ...allow, decision, mustStop: true } }).status, "POLICY_STOP");
  const review = evaluateStrategyContinuation({ ...input([send]), currentPolicy: { ...allow, decision: "REQUIRE_REVIEW", requiredAction: "REVIEW", requiresUserReview: true } });
  assert.equal(review.status, "NEXT_STEP_READY");
  if (review.status === "NEXT_STEP_READY") assert.equal(review.policy?.decision, "REQUIRE_REVIEW");
  assert.equal(evaluateStrategyContinuation(input([action("bridge", "BRIDGE")])).status, "UNSUPPORTED");
  const branching = evaluateStrategyContinuation(input([action("bridge", "BRIDGE"), send]));
  assert.equal(branching.status, "NEXT_STEP_READY");
  if (branching.status === "NEXT_STEP_READY") assert.deepEqual(branching.steps.map((step) => step.execution), ["NO_WALLET_HANDOFF", "SEPARATE_10B_INVOCATION_REQUIRED"]);
  assert.equal(evaluateStrategyContinuation(input([action("a", "SEND", ["b"]), action("b", "SEND", ["a"])] )).status, "INVALID_STRATEGY");
});

test("continuation core has no execution, polling, signer or secret authority", () => {
  const source = readFileSync(new URL("./strategyContinuation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /executeStrategyStep|acquireStrategyReceipt|acquirePostReceiptEvidence|verifyStrategyReceipt|evaluatePostReceiptRevalidation|setInterval|setTimeout|privateKey|mnemonic|seedPhrase|password/i);
  assert.doesNotMatch(source, /\b(await|async|Promise|while)\b/);
});
