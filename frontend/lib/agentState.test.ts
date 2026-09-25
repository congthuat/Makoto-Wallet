import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentState } from "./agentState.ts";

const identity = { version: 2, sessionId: "session:1", stateId: "state:1" };
const step = { kind: "STRATEGY_STEP", strategyId: "strategy:1", stepId: "approval:1" };
const attempt = { kind: "TRANSACTION_ATTEMPT", id: "attempt:1" };
const receipt = { kind: "RECEIPT", chainId: 5042002, transactionHash: `0x${"a".repeat(64)}` };
const transaction = { ...identity, kind: "TRANSACTION", step, scope: "SOURCE_CHAIN", binding: { account: "0x1111111111111111111111111111111111111111", chainId: 5042002, action: "BRIDGE", preparedAction: { kind: "PREPARED_ACTION", tool: "bridge.prepare", quoteFingerprint: `0x${"b".repeat(64)}`, stepIndex: 1 }, quoteExpiresAt: 2000, preparationExpiresAt: 2000, handoffExpiresAt: null } };
const valid = (value: unknown) => assert.equal(validateAgentState(value).valid, true);
const invalid = (value: unknown) => assert.equal(validateAgentState(value).valid, false);

test("12A states round-trip through JSON with stable identity and structural references", () => {
  const states = [
    { ...identity, kind: "REQUESTED" },
    { ...identity, kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "plan:1" } },
    { ...transaction, status: "SUCCESS", submittedHash: receipt.transactionHash, attempt, receipt },
  ];
  for (const state of states) {
    valid(state);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  }
});

test("12A represents every truthful transaction state without collapsing boundaries", () => {
  const states = [
    { ...transaction, status: "PREPARED" },
    { ...transaction, status: "AWAITING_SIGNATURE" },
    { ...transaction, status: "SUBMITTED", submittedHash: receipt.transactionHash, attempt },
    { ...transaction, status: "CONFIRMING", submittedHash: receipt.transactionHash, attempt },
    { ...transaction, status: "SUCCESS", submittedHash: receipt.transactionHash, attempt, receipt },
    { ...transaction, status: "REJECTED", attempt: null },
    { ...transaction, status: "EXPIRED", attempt: null },
    { ...transaction, status: "FAILED", submittedHash: receipt.transactionHash, attempt },
  ];
  for (const state of states) valid(state);
  assert.equal(new Set(states.map((state) => state.status)).size, 8);
  invalid({ ...transaction, status: "PREPARED", attempt });
  invalid({ ...transaction, status: "AWAITING_SIGNATURE", receipt });
  invalid({ ...transaction, status: "SUBMITTED", submittedHash: receipt.transactionHash, receipt });
  invalid({ ...transaction, status: "CONFIRMING", submittedHash: receipt.transactionHash, attempt, receipt });
  invalid({ ...transaction, status: "SUCCESS", submittedHash: receipt.transactionHash, attempt });
});

test("12A distinguishes source confirmation from destination completion", () => {
  const source = { ...transaction, status: "SUCCESS", submittedHash: receipt.transactionHash, attempt, receipt };
  const destination = { ...source, stateId: "state:2", scope: "DESTINATION_CHAIN", receipt: { ...receipt, chainId: 84532, transactionHash: `0x${"b".repeat(64)}` } };
  valid(source);
  valid(destination);
  assert.notDeepEqual(source, destination);
});

test("12A rejects malformed shape, references, versions, runtime values, and authority fields", () => {
  const cases: unknown[] = [null, [], "state", { ...identity, kind: "REQUESTED", version: 99 },
    { ...identity, kind: "UNKNOWN" }, { ...identity, kind: "REQUESTED", sessionId: "bad id" },
    { ...identity, kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "" } },
    { ...transaction, status: "SUBMITTED", submittedHash: receipt.transactionHash, attempt: { ...attempt, signer: "wallet" } },
    { ...transaction, status: "SUCCESS", submittedHash: receipt.transactionHash, attempt, receipt: { ...receipt, transactionHash: "0x00" } },
    { ...transaction, status: "PREPARED", sign: () => undefined },
    { ...transaction, status: "PREPARED", provider: Promise.resolve() },
    { ...transaction, status: "PREPARED", submit: true },
    { ...transaction, status: "PREPARED", extra: BigInt(1) },
    { ...identity, kind: "REQUESTED", stateId: undefined },
    { ...identity, kind: "REQUESTED", stateId: Number.NaN },
    Object.defineProperty({ ...identity, kind: "REQUESTED" }, "stateId", { get: () => "state:1", enumerable: true }),
  ];
  for (const value of cases) invalid(value);
});

test("12G exported state validation fails closed for throwing runtime objects", () => {
  const throwing = new Proxy({}, { getPrototypeOf() { throw Error("hostile prototype"); } });
  const nested = new Proxy({ kind: "PLANNER_PLAN", id: "plan:1" }, { ownKeys() { throw Error("hostile keys"); } });
  for (const value of [throwing, { ...identity, kind: "PLAN_READY", plan: nested }]) {
    assert.doesNotThrow(() => invalid(value));
  }
});

test("prerequisite v2 state requires complete data-only transaction identity", () => {
  const state = { ...transaction, status: "PREPARED" };
  for (const binding of [undefined, {}, { ...transaction.binding, account: "0x00" }, { ...transaction.binding, chainId: NaN }, { ...transaction.binding, quoteExpiresAt: Infinity }, { ...transaction.binding, preparationExpiresAt: -1 }, { ...transaction.binding, handoffExpiresAt: 1.1 }, { ...transaction.binding, preparedAction: { ...transaction.binding.preparedAction, stepIndex: -1 } }, { ...transaction.binding, now: 123 }]) invalid({ ...state, binding });
  invalid({ ...state, version: 1 });
  invalid({ ...transaction, status: "SUBMITTED", attempt });
  invalid({ ...transaction, status: "FAILED", attempt, submittedHash: "bad" });
});
