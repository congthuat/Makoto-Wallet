import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentState } from "./agentState.ts";
import { AGENT_STATE_STORAGE_PREFIX, agentStateStorageKey, restoreAgentState, storeAgentState } from "./agentStatePersistence.ts";
import { evaluateAgentTransition } from "./agentTransition.ts";

const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const binding = { account, chainId: 5_042_002 } as const;
const identity = { version: 2, sessionId: "session:1", stateId: "state:1" } as const;
const step = { kind: "STRATEGY_STEP", strategyId: "strategy:1", stepId: "burn" } as const;
const attempt = { kind: "TRANSACTION_ATTEMPT", id: "attempt_123" } as const;
const receipt = { kind: "RECEIPT", chainId: binding.chainId, transactionHash: `0x${"a".repeat(64)}` } as const;
const requested = { ...identity, kind: "REQUESTED" } as const;
const planned = { ...identity, kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "plan:1" } } as const;
const transaction = (status: string, extra = {}) => ({ ...identity, kind: "TRANSACTION", step, scope: "SOURCE_CHAIN", binding: { account: "0x1111111111111111111111111111111111111111", chainId: 5042002, action: "BRIDGE", preparedAction: { kind: "PREPARED_ACTION", tool: "bridge.prepare", quoteFingerprint: `0x${"b".repeat(64)}`, stepIndex: 1 }, quoteExpiresAt: 2000, preparationExpiresAt: 2000, handoffExpiresAt: null }, status, ...(["SUBMITTED", "CONFIRMING", "SUCCESS", "FAILED"].includes(status) ? { submittedHash: receipt.transactionHash } : {}), ...extra });
const key = agentStateStorageKey(identity.sessionId, binding)!;

class MemoryStore {
  values = new Map<string, string>();
  reads = 0;
  writes = 0;
  getItem(name: string) { this.reads++; return this.values.get(name) ?? null; }
  setItem(name: string, value: string) { this.writes++; this.values.set(name, value); }
}

test("12C round-trips only 12A-valid states as historical data", () => {
  const store = new MemoryStore();
  const states = [requested, planned, transaction("PREPARED"), transaction("AWAITING_SIGNATURE"), transaction("SUBMITTED", { attempt }), transaction("CONFIRMING", { attempt }), transaction("SUCCESS", { attempt, receipt }), ...["REJECTED", "EXPIRED", "FAILED"].map((status) => transaction(status, { attempt: null }))];
  for (const state of states) {
    assert.equal(storeAgentState(store, state, binding), true, state.kind === "TRANSACTION" ? state.status : state.kind);
    const restored = restoreAgentState(store, identity.sessionId, binding);
    assert.deepEqual(restored, { status: "HISTORICAL", state });
    if (restored.status === "HISTORICAL") assert.equal(validateAgentState(restored.state).valid, true);
  }
  assert.equal(store.writes, states.length);
  assert.equal(store.reads, states.length);
});

test("12C isolates sessions, accounts, and chains in keys and stored bindings", () => {
  const store = new MemoryStore();
  const second = { ...requested, sessionId: "session:2" };
  assert.equal(storeAgentState(store, requested, binding), true);
  assert.equal(storeAgentState(store, second, binding), true);
  assert.notEqual(key, agentStateStorageKey(second.sessionId, binding));
  assert.deepEqual(restoreAgentState(store, second.sessionId, binding), { status: "HISTORICAL", state: second });
  assert.deepEqual(restoreAgentState(store, identity.sessionId, { account: other, chainId: binding.chainId }), { status: "ABSENT" });
  assert.deepEqual(restoreAgentState(store, identity.sessionId, { account, chainId: 84_532 }), { status: "ABSENT" });
  assert.deepEqual(restoreAgentState(store, "session:missing", binding), { status: "ABSENT" });
  assert.equal(store.values.size, 2);
  assert.equal(key.startsWith(`${AGENT_STATE_STORAGE_PREFIX}:${account.toLowerCase()}:${binding.chainId}:`), true);
  store.values.set(key, JSON.stringify({ version: 2, account: other, chainId: binding.chainId, state: requested }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
  store.values.set(key, JSON.stringify({ version: 2, account, chainId: 84_532, state: requested }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
  store.values.set(key, JSON.stringify({ version: 2, account, chainId: binding.chainId, state: second }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
});

test("12C rejects invalid JSON, versions, shapes, extra fields, and corrupted references", () => {
  const store = new MemoryStore();
  const envelope = { version: 2, account, chainId: binding.chainId, state: transaction("SUCCESS", { attempt, receipt }) };
  const invalid = ["{", "null", "[]", "42", JSON.stringify({ ...envelope, version: 99 }), JSON.stringify({ ...envelope, extra: true }), JSON.stringify({ ...envelope, state: { ...requested, version: 99 } }), JSON.stringify({ ...envelope, state: { ...requested, signer: "wallet" } }), JSON.stringify({ ...envelope, state: { ...envelope.state, receipt: { ...receipt, transactionHash: "bad" } } }), JSON.stringify({ ...envelope, state: { ...envelope.state, attempt: { ...attempt, id: "bad id" } } }), JSON.stringify({ ...envelope, state: { ...envelope.state, step: { ...step, stepId: "" } } })];
  for (const raw of invalid) {
    store.values.set(key, raw);
    assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" }, raw);
    assert.equal(store.values.get(key), raw, "corrupt data is not silently repaired");
  }
});

test("12C never stores invalid runtime state or uses incomplete wallet binding", () => {
  const store = new MemoryStore();
  for (const state of [null, { ...requested, version: 99 }, { ...requested, sign: () => undefined }, { ...planned, plan: { kind: "PLANNER_PLAN", id: "" } }, { ...transaction("SUCCESS", { attempt, receipt }), receipt: { ...receipt, privateKey: "forbidden" } }]) assert.equal(storeAgentState(store, state, binding), false);
  for (const context of [{ account: undefined, chainId: binding.chainId }, { account, chainId: undefined }, { account: "not-an-address", chainId: binding.chainId }, { account, chainId: 0 }]) {
    assert.equal(storeAgentState(store, requested, context), false);
    assert.deepEqual(restoreAgentState(store, identity.sessionId, context), { status: "INVALID" });
  }
  assert.equal(store.writes, 0);
  assert.equal(agentStateStorageKey("bad id", binding), undefined);
});

test("12C restore does not promote references, in-flight states, or CCTP source scope", () => {
  const store = new MemoryStore();
  storeAgentState(store, planned, binding);
  const historicalPlan = restoreAgentState(store, identity.sessionId, binding);
  assert.equal(historicalPlan.status, "HISTORICAL");
  if (historicalPlan.status === "HISTORICAL") {
    const prepared = { ...transaction("PREPARED"), stateId: "state:2" };
    const decision = evaluateAgentTransition(historicalPlan.state, prepared, null);
    assert.deepEqual(decision, { allowed: false, reason: "MISSING_CANONICAL_STRATEGY_BINDING" });
  }
  const states = [planned, transaction("AWAITING_SIGNATURE"), transaction("SUBMITTED", { attempt }), transaction("CONFIRMING", { attempt }), transaction("SUCCESS", { attempt, receipt })];
  for (const state of states) {
    storeAgentState(store, state, binding);
    const result = restoreAgentState(store, identity.sessionId, binding);
    assert.equal(result.status, "HISTORICAL");
    if (result.status === "HISTORICAL") {
      assert.deepEqual(result.state, state);
      assert.equal("policy" in result || "retry" in result || "confirmed" in result || "signature" in result, false);
      if (result.state.kind === "TRANSACTION") assert.equal(result.state.scope, "SOURCE_CHAIN");
    }
  }
  assert.equal(store.values.get(key)?.includes("DESTINATION_CHAIN"), false);
});

test("12C handles storage faults and malformed runtime objects fail closed", () => {
  const broken = { getItem: () => { throw Error("storage unavailable"); }, setItem: () => { throw Error("storage unavailable"); } };
  assert.deepEqual(restoreAgentState(broken, identity.sessionId, binding), { status: "INVALID" });
  assert.equal(storeAgentState(broken, requested, binding), false);
  const throwing = new Proxy({}, { getPrototypeOf() { throw Error("untrusted object"); } });
  assert.equal(storeAgentState(new MemoryStore(), throwing, binding), false);
  assert.equal(agentStateStorageKey(identity.sessionId, throwing), undefined);
});

test("12C key encoding keeps all valid delimiter-bearing session IDs distinct", () => {
  const sessions = ["a", "a:b", "a::b", "a:b:c", "a:b:c:", "a.b", "a_b", "a-b", "a:b:5042002", `a:${account}:${binding.chainId}:b`];
  const keys = sessions.map((sessionId) => agentStateStorageKey(sessionId, binding));
  assert.equal(new Set(keys).size, sessions.length);
  for (const sessionId of sessions) {
    const store = new MemoryStore();
    const state = { ...requested, sessionId };
    assert.equal(storeAgentState(store, state, binding), true);
    assert.deepEqual(restoreAgentState(store, sessionId, binding), { status: "HISTORICAL", state });
  }
  assert.notEqual(agentStateStorageKey("a:b", binding), agentStateStorageKey("b", binding));
  assert.notEqual(agentStateStorageKey("a:b", binding), agentStateStorageKey("a:b", { ...binding, chainId: 1 }));
  assert.notEqual(agentStateStorageKey("a:b", binding), agentStateStorageKey("a:b", { ...binding, account: other }));
});

test("12C rejects copied records even when their inner state is valid", () => {
  const store = new MemoryStore();
  const cases = [
    { context: { account: other, chainId: binding.chainId }, state: requested },
    { context: { account, chainId: 1 }, state: requested },
    { context: binding, state: { ...requested, sessionId: "session:2" } },
  ];
  for (const { context, state } of cases) {
    assert.equal(validateAgentState(state).valid, true);
    store.values.set(key, JSON.stringify({ version: 2, ...context, state }));
    assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
  }
  store.values.set(key, JSON.stringify({ version: 2, ...binding, state: requested }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "HISTORICAL", state: requested });
});

test("12C fails closed for storage and serialization failures", () => {
  const readFailure = { getItem: () => { throw Error("read failed"); } };
  const writeFailure = { setItem: () => { throw Error("write failed"); } };
  assert.deepEqual(restoreAgentState(readFailure, identity.sessionId, binding), { status: "INVALID" });
  assert.equal(storeAgentState(writeFailure, requested, binding), false);

  const originalStringify = JSON.stringify;
  try {
    JSON.stringify = () => { throw Error("serialization failed"); };
    assert.equal(storeAgentState(new MemoryStore(), requested, binding), false);
  } finally {
    JSON.stringify = originalStringify;
  }
  const malformed = new Proxy({}, { getPrototypeOf() { throw Error("malformed binding"); } });
  assert.deepEqual(restoreAgentState(new MemoryStore(), identity.sessionId, malformed), { status: "INVALID" });
  assert.equal(storeAgentState(new MemoryStore(), requested, malformed), false);
});

test("12C restores transaction labels and references without fresh authority", () => {
  const store = new MemoryStore();
  const states = [
    transaction("PREPARED"),
    transaction("AWAITING_SIGNATURE"),
    transaction("SUBMITTED", { attempt }),
    transaction("CONFIRMING", { attempt }),
    transaction("SUCCESS", { attempt, receipt }),
  ];
  for (const state of states) {
    assert.equal(storeAgentState(store, state, binding), true);
    assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "HISTORICAL", state });
  }
  const historical = restoreAgentState(store, identity.sessionId, binding);
  assert.equal(historical.status, "HISTORICAL");
  if (historical.status === "HISTORICAL" && historical.state.kind === "TRANSACTION" && historical.state.status === "SUCCESS") {
    assert.deepEqual(historical.state.attempt, attempt);
    assert.deepEqual(historical.state.receipt, receipt);
    assert.equal(historical.state.scope, "SOURCE_CHAIN");
    assert.equal("destinationReceipt" in historical.state, false);
  }
  assert.equal(store.reads, states.length + 1);
  assert.equal(store.writes, states.length);
});

test("prerequisite v2 persistence rejects legacy identity and envelope account substitution", () => {
  const store = new MemoryStore();
  const state = transaction("AWAITING_SIGNATURE");
  assert.equal(storeAgentState(store, state, { account: other, chainId: binding.chainId }), false);
  assert.equal(storeAgentState(store, state, { account, chainId: 84532 }), false);
  store.values.set(key, JSON.stringify({ version: 2, account, chainId: binding.chainId, state: { ...state, binding: { ...state.binding, account: other } } }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
  store.values.set(key, JSON.stringify({ version: 1, account, chainId: binding.chainId, state: { ...state, version: 1 } }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
  assert.equal(storeAgentState(store, { ...state, version: 1 }, binding), false);
  assert.equal(storeAgentState(store, state, binding), true);
  const restored = restoreAgentState(store, identity.sessionId, binding);
  assert.equal(restored.status, "HISTORICAL");
  if (restored.status === "HISTORICAL") assert.equal(evaluateAgentTransition(restored.state, { ...state, status: "REJECTED", stateId: "next", attempt }, restored).allowed, false);
});

test("review: every restored v2 terminal label remains historical", () => {
  const store = new MemoryStore();
  for (const status of ["SUCCESS", "FAILED", "REJECTED", "EXPIRED"] as const) {
    const state = status === "SUCCESS" ? transaction(status, { attempt, receipt }) : transaction(status, { attempt });
    assert.equal(storeAgentState(store, state, binding), true);
    const historical = restoreAgentState(store, identity.sessionId, binding);
    assert.deepEqual(historical, { status: "HISTORICAL", state });
    assert.equal(evaluateAgentTransition(state, transaction("AWAITING_SIGNATURE", { stateId: "next" }), historical).allowed, false);
  }
});
