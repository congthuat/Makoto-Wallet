import assert from "node:assert/strict";
import test from "node:test";
import { validatePlannerPlan } from "./plannerPlan.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const swap = { version: 1, id: "swap", kind: "SWAP", chainId: 5042002, fromAsset: "usdc", toAsset: "eurc", amount: "10" };
const send = { version: 1, id: "send", kind: "SEND", chainId: 5042002, asset: "eurc", amount: "5", recipient };
const action = { version: 1, id: "plan", classification: "ACTION", goals: [{ intent: send, dependsOn: [] }] };
const strategy = { version: 1, id: "plan", classification: "STRATEGY", goals: [{ intent: send, dependsOn: ["swap"] }, { intent: swap, dependsOn: [] }] };
const valid = (value: unknown, expected?: "ACTION" | "STRATEGY") => assert.equal(validatePlannerPlan(value, expected).valid, true);
const invalid = (value: unknown, code: string) => {
  const result = validatePlannerPlan(value);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.errors.some((issue) => issue.code === code), JSON.stringify(result.errors));
};

test("ACTION Send and Swap each contain exactly one user goal", () => {
  valid(action, "ACTION");
  valid({ ...action, goals: [{ intent: swap, dependsOn: [] }] }, "ACTION");
  assert.equal(action.goals.length, 1);
});

test("STRATEGY uses explicit dependencies independent of array order and supports fan-in", () => {
  valid(strategy, "STRATEGY");
  valid({ ...strategy, goals: [...strategy.goals].reverse() });
  const send2 = { ...send, id: "send2" };
  valid({ ...strategy, goals: [{ intent: send, dependsOn: ["swap", "send2"] }, { intent: swap, dependsOn: [] }, { intent: send2, dependsOn: [] }] });
});

test("graph, shape, classification, and authority violations are rejected", () => {
  invalid({ ...strategy, goals: [{ intent: swap, dependsOn: [] }, { intent: { ...send, id: "swap" }, dependsOn: ["swap"] }] }, "DUPLICATE_INTENT_ID");
  invalid({ ...strategy, goals: [{ intent: swap, dependsOn: ["swap"] }, { intent: send, dependsOn: [] }] }, "SELF_DEPENDENCY");
  invalid({ ...strategy, goals: [{ intent: swap, dependsOn: ["missing"] }, { intent: send, dependsOn: [] }] }, "UNKNOWN_DEPENDENCY");
  invalid({ ...strategy, goals: [{ intent: swap, dependsOn: ["send"] }, { intent: send, dependsOn: ["swap"] }] }, "DEPENDENCY_CYCLE");
  invalid({ ...action, goals: strategy.goals }, "INVALID_GOAL_COUNT");
  invalid({ ...action, goals: [{ intent: send, dependsOn: ["swap"] }] }, "CLASSIFICATION_MISMATCH");
  invalid({ ...strategy, goals: [action.goals[0]] }, "INVALID_GOAL_COUNT");
  invalid({ ...strategy, goals: [{ intent: swap, dependsOn: [] }, { intent: send, dependsOn: [] }] }, "MISSING_COMPOSITION");
  invalid({ ...strategy, goals: [{ intent: swap, dependsOn: ["send", "send"] }, { intent: send, dependsOn: [] }] }, "DUPLICATE_DEPENDENCY");
  invalid({ ...strategy, goals: [{ intent: swap, dependsOn: "send" }, { intent: send, dependsOn: [] }] }, "INVALID_SCHEMA");
  invalid({ ...action, id: " " }, "INVALID_ID");
  invalid({ ...action, signer: true }, "INVALID_SCHEMA");
  invalid({ ...action, goals: [{ ...action.goals[0], preparedAction: {} }] }, "INVALID_SCHEMA");
  invalid({ ...action, goals: [{ intent: { ...send, calldata: "0x" }, dependsOn: [] }] }, "INVALID_INTENT");
  invalid({ ...action, goals: [{ intent: { ...send, privateKey: "forbidden" }, dependsOn: [] }] }, "INVALID_INTENT");
  const mismatch = validatePlannerPlan(action, "STRATEGY");
  assert.equal(mismatch.valid, false);
  if (!mismatch.valid) assert.ok(mismatch.errors.some((issue) => issue.code === "CLASSIFICATION_MISMATCH"));
});

test("11A rejects unsupported or malformed fields without substitution", () => {
  for (const intent of [
    { ...send, asset: "eth" }, { ...send, chainId: 1 }, { ...send, amount: "0" }, { ...send, recipient: "bad" },
    { ...swap, toAsset: "usdc" }, { ...swap, amount: "1.1234567" },
    { version: 1, id: "bridge", kind: "BRIDGE", sourceChainId: 5042002, destinationChainId: 1, asset: "usdc", amount: "1", recipient },
  ]) invalid({ ...action, goals: [{ intent, dependsOn: [] }] }, "INVALID_INTENT");
});

test("ACTION and STRATEGY survive JSON round trips", () => {
  for (const plan of [action, strategy]) {
    const copy = JSON.parse(JSON.stringify(plan)) as unknown;
    valid(copy);
    assert.deepEqual(copy, plan);
  }
});
