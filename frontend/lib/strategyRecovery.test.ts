import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { arcTestnet } from "viem/chains";
import type { PolicyResult } from "./policyEngine.ts";
import { evaluateStrategyRecovery, type StrategyRecoveryRecord } from "./strategyRecovery.ts";
import type { StrategyReceiptResult } from "./strategyReceipt.ts";
import type { ActionStep, Strategy } from "./strategyModel.ts";

const account = "0x1111111111111111111111111111111111111111";
const fingerprint = `0x${"a".repeat(64)}` as const;
const hash = `0x${"b".repeat(64)}` as const;
const now = 1_000_200;
const action = (kind: ActionStep["action"] = "SEND"): ActionStep => ({ id: "action", kind: "ACTION", action: kind, dependsOn: [], confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: kind === "SEND" ? "send.prepare" : kind === "BRIDGE" ? "bridge.prepare" : "swap.prepare", quoteFingerprint: fingerprint, stepIndex: kind === "APPROVE" ? 0 : 1 } });
const strategy = (kind: ActionStep["action"] = "SEND"): Strategy => ({ version: 1, id: "strategy", createdAt: 1_000_000, steps: [action(kind)] });
const record = (kind: ActionStep["action"] = "SEND", event: StrategyRecoveryRecord["event"] = "PRE_SUBMISSION_FAILURE"): StrategyRecoveryRecord => ({ version: 1, attemptId: "attempt_123", strategyId: "strategy", stepId: "action", action: kind, account, chainId: arcTestnet.id, preparedAction: action(kind).preparedAction!, event, ...(event === "SUBMITTED" ? { submittedHash: hash } : {}) });
const artifacts = (kind: ActionStep["action"] = "SEND") => ({ quote: { tool: kind === "SEND" ? "send.quote" : kind === "BRIDGE" ? "bridge.quote" : "swap.quote", account, chainId: arcTestnet.id, fingerprint, expiresAt: now + 100 }, preparation: { tool: action(kind).preparedAction!.tool, account, chainId: arcTestnet.id, quoteFingerprint: fingerprint, stepIndex: action(kind).preparedAction!.stepIndex, expiresAt: now + 100 }, handoff: { account, expiresAt: now + 100 } });
const allow: PolicyResult = { decision: "ALLOW", findings: [], requiredAction: "NONE", mustStop: false, requiresUserReview: true, requiresFreshQuote: false, requiresRevalidation: false };
const stopped = (decision: "BLOCK" | "REQUOTE" | "REVALIDATE"): PolicyResult => ({ ...allow, decision, requiredAction: decision === "BLOCK" ? "STOP" : decision, mustStop: true, requiresUserReview: false, requiresFreshQuote: decision === "REQUOTE", requiresRevalidation: decision === "REVALIDATE" });
const evaluate = (kind: ActionStep["action"], event: StrategyRecoveryRecord["event"], extra = {}) => evaluateStrategyRecovery({ strategy: strategy(kind), record: record(kind, event), now, ...extra });
const confirmed = (kind: ActionStep["action"] = "SEND"): StrategyReceiptResult => ({ status: "CONFIRMED", strategyId: "strategy", stepId: "action", action: kind, hash, chainId: arcTestnet.id, blockNumber: "123", scope: "SOURCE_TRANSACTION", dependencies: [{ kind: "CONFIRMED_RECEIPT", strategyId: "strategy", stepId: "action", actionStepId: "action", preparedAction: action(kind).preparedAction!, submittedHash: hash, receipt: { tool: "transaction.receipt", account, chainId: arcTestnet.id, capturedAt: now - 100, observedAt: now - 100, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: { hash, state: "confirmed", verified: true } } }] });
const reverted = (kind: ActionStep["action"] = "SEND"): StrategyReceiptResult => ({ status: "REVERTED", strategyId: "strategy", stepId: "action", action: kind, account, preparedAction: action(kind).preparedAction!, hash, chainId: arcTestnet.id, blockNumber: "123", scope: "SOURCE_TRANSACTION" });

test("user rejection stops without a receipt or implicit retry", () => {
  assert.deepEqual(evaluate("SEND", "USER_REJECTED"), { strategyId: "strategy", stepId: "action", attemptId: "attempt_123", status: "USER_REJECTED", next: "STOP" });
  assert.equal(evaluate("SEND", "USER_REJECTED", { receipt: confirmed() }).status, "INVALID_EVIDENCE");
});

test("known hash and ambiguous no-hash outcomes never become retry-eligible", () => {
  assert.equal(evaluate("SEND", "SUBMITTED", { artifacts: artifacts(), currentPolicy: allow }).status, "WAIT_FOR_RECEIPT");
  assert.equal(evaluate("SEND", "SUBMITTED", { receipt: { status: "PENDING", strategyId: "strategy", stepId: "action", hash } }).status, "WAIT_FOR_RECEIPT");
  assert.equal(evaluate("SEND", "SUBMITTED", { receipt: { status: "UNAVAILABLE", strategyId: "strategy", stepId: "action", hash } }).status, "WAIT_FOR_RECEIPT");
  assert.equal(evaluate("SEND", "SUBMISSION_OUTCOME_UNKNOWN", { artifacts: artifacts(), currentPolicy: allow }).status, "SUBMISSION_OUTCOME_UNKNOWN");
});

test("10C confirmation permits separate continuation check; approval needs fresh allowance; CCTP destination remains unresolved", () => {
  assert.equal(evaluate("SEND", "SUBMITTED", { receipt: confirmed() }).status, "CONTINUATION_RECHECK_REQUIRED");
  assert.equal(evaluate("SWAP", "SUBMITTED", { receipt: confirmed("SWAP") }).status, "CONTINUATION_RECHECK_REQUIRED");
  assert.equal(evaluate("APPROVE", "SUBMITTED", { receipt: confirmed("APPROVE") }).status, "REVALIDATION_REQUIRED");
  assert.equal(evaluate("BRIDGE", "SUBMITTED", { receipt: confirmed("BRIDGE") }).status, "DESTINATION_STATUS_UNRESOLVED");
});

test("reverted attempt remains unsatisfied and requires fresh evidence", () => {
  assert.equal(evaluate("SEND", "SUBMITTED", { receipt: reverted(), artifacts: artifacts(), currentPolicy: allow }).status, "REVALIDATION_REQUIRED");
});

test("reverted evidence cannot be reused for another valid account", () => {
  const otherAccount = "0x2222222222222222222222222222222222222222";
  assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: { ...record("SEND", "SUBMITTED"), account: otherAccount }, now, receipt: reverted() }).status, "INVALID_EVIDENCE");
});

test("reverted evidence binds action, artifact, hash, chain, step, and source scope", () => {
  const receipt = reverted();
  if (receipt.status !== "REVERTED") throw Error("fixture");
  const changes = [
    { ...receipt, strategyId: "other" }, { ...receipt, stepId: "other" }, { ...receipt, action: "SWAP" },
    { ...receipt, preparedAction: { ...receipt.preparedAction, quoteFingerprint: `0x${"c".repeat(64)}` } },
    { ...receipt, hash: `0x${"c".repeat(64)}` }, { ...receipt, chainId: 1 },
    { ...receipt, scope: "DESTINATION_TRANSACTION" }, { ...receipt, account: "bad" },
    { ...receipt, preparedAction: { ...receipt.preparedAction, extra: true } },
  ];
  for (const changed of changes) assert.equal(evaluate("SEND", "SUBMITTED", { receipt: changed }).status, "INVALID_EVIDENCE");
  const throwing = new Proxy({}, { getPrototypeOf() { throw Error("malformed receipt"); } });
  assert.equal(evaluate("SEND", "SUBMITTED", { receipt: throwing }).status, "INVALID_EVIDENCE");
});

test("expired quote, preparation, and handoff cannot be replayed", () => {
  assert.equal(evaluate("SWAP", "PRE_SUBMISSION_FAILURE", { artifacts: { ...artifacts("SWAP"), quote: { ...artifacts("SWAP").quote, expiresAt: now - 1 } }, currentPolicy: allow }).status, "REQUOTE_REQUIRED");
  assert.equal(evaluate("SWAP", "PRE_SUBMISSION_FAILURE", { artifacts: { ...artifacts("SWAP"), preparation: { ...artifacts("SWAP").preparation, expiresAt: now - 1 } }, currentPolicy: allow }).status, "REPREPARE_REQUIRED");
  assert.equal(evaluate("SEND", "PRE_SUBMISSION_FAILURE", { artifacts: { ...artifacts(), handoff: { account, expiresAt: now - 1 } }, currentPolicy: allow }).status, "REPREPARE_REQUIRED");
});

test("only proven pre-submission failure with current evidence permits a new explicit 10B invocation", () => {
  assert.equal(evaluate("SEND", "PRE_SUBMISSION_FAILURE").status, "REVALIDATION_REQUIRED");
  const result = evaluate("SEND", "PRE_SUBMISSION_FAILURE", { artifacts: artifacts(), currentPolicy: allow });
  assert.equal(result.status, "RETRY_ELIGIBLE");
  if (result.status === "RETRY_ELIGIBLE") assert.deepEqual([result.next, result.confirmation], ["NEW_USER_CONTROLLED_10B_INVOCATION", "EXPLICIT_USER_CONFIRMATION"]);
});

test("Phase 9 BLOCK, REQUOTE, and REVALIDATE are preserved", () => {
  for (const decision of ["BLOCK", "REQUOTE", "REVALIDATE"] as const) {
    const result = evaluate("SEND", "PRE_SUBMISSION_FAILURE", { artifacts: artifacts(), currentPolicy: stopped(decision) });
    assert.equal(result.status, "POLICY_STOP");
    if (result.status === "POLICY_STOP") assert.equal(result.policy.decision, decision);
  }
  assert.equal(evaluate("SEND", "PRE_SUBMISSION_FAILURE", { artifacts: artifacts(), currentPolicy: { ...allow, decision: "BLOCK", mustStop: false } }).status, "INVALID_EVIDENCE");
});

test("missing handoff and unsupported Direct CCTP route cannot be retry-eligible", () => {
  const withoutHandoff = { quote: artifacts().quote, preparation: artifacts().preparation };
  assert.equal(evaluate("SEND", "PRE_SUBMISSION_FAILURE", { artifacts: withoutHandoff, currentPolicy: allow }).status, "REPREPARE_REQUIRED");
  assert.equal(evaluate("BRIDGE", "PRE_SUBMISSION_FAILURE", { artifacts: artifacts("BRIDGE"), currentPolicy: allow }).status, "NON_RETRYABLE");
  assert.equal(evaluate("SEND", "PRE_SUBMISSION_FAILURE", { artifacts: { ...artifacts(), quote: { ...artifacts().quote, account: "0x2222222222222222222222222222222222222222" } }, currentPolicy: allow }).status, "INVALID_EVIDENCE");
  assert.equal(evaluate("SEND", "PRE_SUBMISSION_FAILURE", { artifacts: { ...artifacts(), preparation: { ...artifacts().preparation, chainId: 1 } }, currentPolicy: allow }).status, "INVALID_EVIDENCE");
});

test("JSON recovery record round trip and corrupt identity or authority fail closed", () => {
  const saved = JSON.parse(JSON.stringify(record())) as StrategyRecoveryRecord;
  assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: saved, now, artifacts: artifacts(), currentPolicy: allow }).status, "RETRY_ELIGIBLE");
  for (const corrupt of [{ ...saved, strategyId: "other" }, { ...saved, stepId: "other" }, { ...saved, action: "SWAP" }, { ...saved, chainId: 1 }, { ...saved, preparedAction: { ...saved.preparedAction, quoteFingerprint: `0x${"c".repeat(64)}` } }, { ...saved, privateKey: "forbidden" }, { ...saved, submittedHash: hash }, { ...saved, event: "UNKNOWN" }]) assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: corrupt, now }).status, "INVALID_EVIDENCE");
  const submitted = record("SEND", "SUBMITTED");
  assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: { ...submitted, submittedHash: `0x${"c".repeat(64)}` }, now, receipt: confirmed() }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: submitted, now, receipt: { ...confirmed(), strategyId: "other" } }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: submitted, now, receipt: { ...confirmed(), action: "SWAP" } }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: submitted, now, receipt: { ...confirmed(), dependencies: [{ kind: "CONFIRMED_RECEIPT", stepId: "action" }] } }).status, "INVALID_EVIDENCE");
  assert.equal(evaluateStrategyRecovery({ strategy: strategy(), record: submitted, now, receipt: { status: "PENDING", strategyId: "strategy", stepId: "action", hash, chainId: 1 } }).status, "INVALID_EVIDENCE");
});

test("recovery core has no provider, signing, automatic retry or continuation calls", () => {
  const source = readFileSync(new URL("./strategyRecovery.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /executeStrategyStep|verifyStrategyReceipt|acquireStrategyReceipt|acquirePostReceiptEvidence|evaluatePostReceiptRevalidation|evaluateStrategyContinuation|setInterval|setTimeout|privateKey|mnemonic|seedPhrase|password|sendTransaction|writeContract/i);
  assert.doesNotMatch(source, /\b(await|async|Promise|while)\b/);
});
