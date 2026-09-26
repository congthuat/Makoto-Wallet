import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateAgentTransition, integrateAeiDOperationalState, validateAeiEReviewEligibility, evaluateAeiECurrentness,
  createAeiEHistoricalSnapshot, validateAeiEHistoricalSnapshot } from "./agentTransition.ts";
import { restoreAeiEHistoricalState, storeAeiEHistoricalState } from "./agentStatePersistence.ts";

const from = { version: 2, sessionId: "session:aei-e", stateId: "state:plan", kind: "PLAN_READY",
  plan: { kind: "PLANNER_PLAN", id: "plan:one" } } as const;
const binding = { account: "0x1111111111111111111111111111111111111111", chainId: 5_042_002 };
const hash = `0x${"a".repeat(64)}`;
const prepared = { version: 2, sessionId: from.sessionId, stateId: "state:prepared", kind: "TRANSACTION", status: "PREPARED",
  step: { kind: "STRATEGY_STEP", strategyId: "strategy:one", stepId: "step:one" }, scope: "SINGLE_CHAIN",
  binding: { ...binding, action: "SEND", preparedAction: { kind: "PREPARED_ACTION", tool: "send.prepare", quoteFingerprint: hash, stepIndex: 0 },
    quoteExpiresAt: 2000, preparationExpiresAt: 2000, handoffExpiresAt: null } } as const;

test("AEI-E public entry fails closed on unregistered, malformed and hostile inputs", async () => {
  const bad = [null, undefined, 1, "legacy draft", [], {}, { version: 1, envelope: {}, retainedLiveInput: {}, currentState: from },
    { version: 1, envelope: {}, retainedLiveInput: {}, currentState: from, wallet: true },
    { version: 2, envelope: {}, retainedLiveInput: {}, currentState: from },
    { version: 1, envelope: {}, retainedLiveInput: {}, currentState: prepared }];
  const getter = { version: 1, envelope: {}, retainedLiveInput: {}, currentState: from };
  Object.defineProperty(getter, "envelope", { enumerable: true, get() { throw Error("getter"); } });
  bad.push(getter);
  bad.push(new Proxy({ version: 1, envelope: {}, retainedLiveInput: {}, currentState: from }, { ownKeys() { throw Error("proxy"); } }));
  const symbol = { version: 1, envelope: {}, retainedLiveInput: {}, currentState: from };
  Object.defineProperty(symbol, Symbol("hidden"), { value: true }); bad.push(symbol);
  for (const input of bad) assert.equal((await integrateAeiDOperationalState(input)).status, "REJECTED");
  assert.deepEqual(await validateAeiEReviewEligibility({ ...prepared }), { eligible: false, reason: "UNREGISTERED" });
  assert.deepEqual(await evaluateAeiECurrentness({ ...prepared }), { status: "INVALID" });
});

test("public Phase 12 reducer cannot mint PREPARED from copied or rehashed proof", () => {
  const evidence = { kind: "AEI_E_PREPARED", sessionId: from.sessionId, stateId: from.stateId, proof: {} };
  assert.deepEqual(evaluateAgentTransition(from, prepared, evidence), { allowed: false, reason: "MISSING_CANONICAL_STRATEGY_BINDING" });
  assert.deepEqual(evaluateAgentTransition(from, prepared, { ...evidence, proof: { digest: hash } }),
    { allowed: false, reason: "MISSING_CANONICAL_STRATEGY_BINDING" });
  assert.deepEqual(evaluateAgentTransition(prepared, { ...prepared, stateId: "state:submitted", status: "SUBMITTED", submittedHash: hash,
    attempt: { kind: "TRANSACTION_ATTEMPT", id: "attempt:one" } }, evidence), { allowed: false, reason: "ILLEGAL_TRANSITION" });
  assert.deepEqual(evaluateAgentTransition(prepared, { ...prepared, stateId: "state:success", status: "SUCCESS", submittedHash: hash,
    attempt: { kind: "TRANSACTION_ATTEMPT", id: "attempt:one" }, receipt: { kind: "RECEIPT", chainId: binding.chainId, transactionHash: hash } }, evidence),
    { allowed: false, reason: "ILLEGAL_TRANSITION" });
});

test("AEI-E persistence rejects caller-created state and never restores it as live", () => {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(createAeiEHistoricalSnapshot({ status: "MAPPED", state: prepared, sidecar: {} }), undefined);
  assert.equal(storeAeiEHistoricalState(store, { status: "MAPPED", state: prepared, sidecar: {} }, binding), false);
  assert.deepEqual(restoreAeiEHistoricalState(store, from.sessionId, binding), { status: "ABSENT" });
  assert.equal(validateAeiEHistoricalSnapshot({ state: prepared, sidecar: { currentness: "CURRENT" } }), false);
  values.set("makoto.agent.operational.v1:0x1111111111111111111111111111111111111111:5042002:session:aei-e", "{}");
  assert.deepEqual(restoreAeiEHistoricalState(store, from.sessionId, binding), { status: "INVALID" });
});

test("AEI-E production imports and source have no transaction side effect", () => {
  const source = readFileSync(new URL("./agentTransition.ts", import.meta.url), "utf8");
  const persistence = readFileSync(new URL("./agentStatePersistence.ts", import.meta.url), "utf8");
  for (const text of [source, persistence]) for (const pattern of [/personal_sign/, /eth_sendTransaction/, /\.sendTransaction\(/,
    /\.writeContract\(/, /\.signMessage\(/, /\.signTypedData\(/, /runQuoteTool\(/, /runPrepareTool\(/, /runReadTool\(/]) assert.doesNotMatch(text, pattern);
});
