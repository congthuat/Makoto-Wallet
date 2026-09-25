import assert from "node:assert/strict";
import test from "node:test";
import { validatePlannerPlan } from "./plannerPlan.ts";

const swap = { id: "swap", kind: "SWAP", dependsOn: [] };
const send = { id: "send", kind: "SEND", dependsOn: ["swap"] };
const action = { version: 1, id: "plan", classification: "ACTION", goals: [swap] };
const strategy = { version: 1, id: "plan", classification: "STRATEGY", goals: [send, swap] };
const valid = (value: unknown, expected?: "ACTION" | "STRATEGY") => assert.equal(validatePlannerPlan(value, expected).valid, true);
const invalid = (value: unknown, code: string) => {
  const result = validatePlannerPlan(value);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.errors.some((issue) => issue.code === code), JSON.stringify(result.errors));
};

test("ACTION has one SEND, SWAP, or BRIDGE user goal without dependencies", () => {
  for (const kind of ["SEND", "SWAP", "BRIDGE"]) valid({ ...action, goals: [{ id: "goal", kind, dependsOn: [] }] }, "ACTION");
});

test("STRATEGY dependencies are explicit, order-independent, and support fan-in", () => {
  valid(strategy, "STRATEGY");
  valid({ ...strategy, goals: [...strategy.goals].reverse() });
  valid({ ...strategy, goals: [{ id: "bridge", kind: "BRIDGE", dependsOn: ["swap", "send"] }, send, swap] });
});

test("graph, shape, classification, and goal-kind violations are rejected", () => {
  invalid({ ...strategy, goals: [swap, { ...send, id: "swap" }] }, "DUPLICATE_GOAL_ID");
  invalid({ ...strategy, goals: [{ ...swap, dependsOn: ["swap"] }, send] }, "SELF_DEPENDENCY");
  invalid({ ...strategy, goals: [{ ...swap, dependsOn: ["missing"] }, send] }, "UNKNOWN_DEPENDENCY");
  invalid({ ...strategy, goals: [{ ...swap, dependsOn: ["send"] }, send] }, "DEPENDENCY_CYCLE");
  invalid({ ...action, goals: strategy.goals }, "INVALID_GOAL_COUNT");
  invalid({ ...action, goals: [send] }, "CLASSIFICATION_MISMATCH");
  invalid({ ...strategy, goals: [swap] }, "INVALID_GOAL_COUNT");
  invalid({ ...strategy, goals: [swap, { ...send, dependsOn: [] }] }, "MISSING_COMPOSITION");
  invalid({ ...strategy, goals: [swap, { ...send, dependsOn: ["swap", "swap"] }] }, "DUPLICATE_DEPENDENCY");
  invalid({ ...strategy, goals: [swap, { ...send, dependsOn: "swap" }] }, "INVALID_SCHEMA");
  invalid({ ...action, goals: [{ ...swap, kind: "APPROVE" }] }, "INVALID_GOAL_KIND");
  invalid({ ...action, id: " " }, "INVALID_ID");
  invalid({ ...action, goals: [{ ...swap, id: " " }] }, "INVALID_ID");
  const mismatch = validatePlannerPlan(action, "STRATEGY");
  assert.equal(mismatch.valid, false);
  if (!mismatch.valid) assert.ok(mismatch.errors.some((issue) => issue.code === "CLASSIFICATION_MISMATCH"));
});

test("11C refuses resolved parameters, PlannerIntent objects, and execution authority", () => {
  for (const field of [
    { amount: "10" }, { asset: "usdc" }, { chainId: 5042002 },
    { recipient: "0x1111111111111111111111111111111111111111" },
    { intent: { version: 1, id: "swap", kind: "SWAP" } }, { calldata: "0x" },
    { privateKey: "forbidden" }, { signer: true }, { preparedAction: {} },
  ]) invalid({ ...action, goals: [{ ...swap, ...field }] }, "INVALID_SCHEMA");
  invalid({ ...action, sendTransaction: true }, "INVALID_SCHEMA");
});

test("ACTION and STRATEGY survive JSON round trips", () => {
  for (const plan of [action, strategy]) {
    const copy = JSON.parse(JSON.stringify(plan)) as unknown;
    valid(copy);
    assert.deepEqual(copy, plan);
  }
});
