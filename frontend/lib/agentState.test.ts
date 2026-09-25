import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentState } from "./agentState.ts";

const identity = { version: 1, sessionId: "session:1", stateId: "state:1" };
const step = { kind: "STRATEGY_STEP", strategyId: "strategy:1", stepId: "approval:1" };
const attempt = { kind: "TRANSACTION_ATTEMPT", id: "attempt:1" };
const receipt = { kind: "RECEIPT", chainId: 5042002, transactionHash: `0x${"a".repeat(64)}` };
const transaction = { ...identity, kind: "TRANSACTION", step, scope: "SOURCE_CHAIN" };
const valid = (value: unknown) => assert.equal(validateAgentState(value).valid, true);
const invalid = (value: unknown) => assert.equal(validateAgentState(value).valid, false);

test("12A states round-trip through JSON with stable identity and structural references", () => {
  const states = [
    { ...identity, kind: "REQUESTED" },
    { ...identity, kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "plan:1" } },
    { ...transaction, status: "SUCCESS", attempt, receipt },
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
    { ...transaction, status: "SUBMITTED", attempt },
    { ...transaction, status: "CONFIRMING", attempt },
    { ...transaction, status: "SUCCESS", attempt, receipt },
    { ...transaction, status: "REJECTED", attempt: null },
    { ...transaction, status: "EXPIRED", attempt: null },
    { ...transaction, status: "FAILED", attempt },
  ];
  for (const state of states) valid(state);
  assert.equal(new Set(states.map((state) => state.status)).size, 8);
  invalid({ ...transaction, status: "PREPARED", attempt });
  invalid({ ...transaction, status: "AWAITING_SIGNATURE", receipt });
  invalid({ ...transaction, status: "SUBMITTED", receipt });
  invalid({ ...transaction, status: "CONFIRMING", attempt, receipt });
  invalid({ ...transaction, status: "SUCCESS", attempt });
});

test("12A distinguishes source confirmation from destination completion", () => {
  const source = { ...transaction, status: "SUCCESS", attempt, receipt };
  const destination = { ...source, stateId: "state:2", scope: "DESTINATION_CHAIN", receipt: { ...receipt, chainId: 84532, transactionHash: `0x${"b".repeat(64)}` } };
  valid(source);
  valid(destination);
  assert.notDeepEqual(source, destination);
});

test("12A rejects malformed shape, references, versions, runtime values, and authority fields", () => {
  const cases: unknown[] = [null, [], "state", { ...identity, kind: "REQUESTED", version: 2 },
    { ...identity, kind: "UNKNOWN" }, { ...identity, kind: "REQUESTED", sessionId: "bad id" },
    { ...identity, kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "" } },
    { ...transaction, status: "SUBMITTED", attempt: { ...attempt, signer: "wallet" } },
    { ...transaction, status: "SUCCESS", attempt, receipt: { ...receipt, transactionHash: "0x00" } },
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
