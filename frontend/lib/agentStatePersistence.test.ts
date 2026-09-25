import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentState } from "./agentState.ts";
import { AGENT_STATE_STORAGE_PREFIX, agentStateStorageKey, restoreAgentState, storeAgentState } from "./agentStatePersistence.ts";
import { evaluateAgentTransition } from "./agentTransition.ts";

const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const binding = { account, chainId: 5_042_002 } as const;
const identity = { version: 1, sessionId: "session:1", stateId: "state:1" } as const;
const step = { kind: "STRATEGY_STEP", strategyId: "strategy:1", stepId: "burn" } as const;
const attempt = { kind: "TRANSACTION_ATTEMPT", id: "attempt_123" } as const;
const receipt = { kind: "RECEIPT", chainId: binding.chainId, transactionHash: `0x${"a".repeat(64)}` } as const;
const requested = { ...identity, kind: "REQUESTED" } as const;
const planned = { ...identity, kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "plan:1" } } as const;
const transaction = (status: string, extra = {}) => ({ ...identity, kind: "TRANSACTION", step, scope: "SOURCE_CHAIN", status, ...extra });
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
  store.values.set(key, JSON.stringify({ version: 1, account: other, chainId: binding.chainId, state: requested }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
  store.values.set(key, JSON.stringify({ version: 1, account, chainId: 84_532, state: requested }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
  store.values.set(key, JSON.stringify({ version: 1, account, chainId: binding.chainId, state: second }));
  assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" });
});

test("12C rejects invalid JSON, versions, shapes, extra fields, and corrupted references", () => {
  const store = new MemoryStore();
  const envelope = { version: 1, account, chainId: binding.chainId, state: transaction("SUCCESS", { attempt, receipt }) };
  const invalid = ["{", "null", "[]", "42", JSON.stringify({ ...envelope, version: 2 }), JSON.stringify({ ...envelope, extra: true }), JSON.stringify({ ...envelope, state: { ...requested, version: 2 } }), JSON.stringify({ ...envelope, state: { ...requested, signer: "wallet" } }), JSON.stringify({ ...envelope, state: { ...envelope.state, receipt: { ...receipt, transactionHash: "bad" } } }), JSON.stringify({ ...envelope, state: { ...envelope.state, attempt: { ...attempt, id: "bad id" } } }), JSON.stringify({ ...envelope, state: { ...envelope.state, step: { ...step, stepId: "" } } })];
  for (const raw of invalid) {
    store.values.set(key, raw);
    assert.deepEqual(restoreAgentState(store, identity.sessionId, binding), { status: "INVALID" }, raw);
    assert.equal(store.values.get(key), raw, "corrupt data is not silently repaired");
  }
});

test("12C never stores invalid runtime state or uses incomplete wallet binding", () => {
  const store = new MemoryStore();
  for (const state of [null, { ...requested, version: 2 }, { ...requested, sign: () => undefined }, { ...planned, plan: { kind: "PLANNER_PLAN", id: "" } }, { ...transaction("SUCCESS", { attempt, receipt }), receipt: { ...receipt, privateKey: "forbidden" } }]) assert.equal(storeAgentState(store, state, binding), false);
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
