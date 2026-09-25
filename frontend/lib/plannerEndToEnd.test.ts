import assert from "node:assert/strict";
import test from "node:test";
import { classifyPlannerRequest } from "./plannerSemanticClassifier.ts";
import { generatePlannerPlan } from "./plannerPlanGenerator.ts";
import { resolvePlannerParameters } from "./plannerParameterResolver.ts";
import { evaluatePlannerReplan } from "./plannerReplan.ts";
import { validatePlannerIntent } from "./plannerIntent.ts";
import { validatePlannerPlan } from "./plannerPlan.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const draft = (goalId: string, fields: Record<string, string | null>) => ({ goalId, chain: null, asset: null,
  amount: null, recipient: null, fromAsset: null, toAsset: null, sourceChain: null, destinationChain: null, ...fields });
const action = (kind: "SEND" | "SWAP" | "BRIDGE") => ({ version: 1, id: `${kind.toLowerCase()}-plan`,
  classification: "ACTION", goals: [{ id: kind.toLowerCase(), kind, dependsOn: [] }] });
const strategy = { version: 1, id: "strategy", classification: "STRATEGY", goals: [
  { id: "swap", kind: "SWAP", dependsOn: [] }, { id: "send", kind: "SEND", dependsOn: ["swap"] },
] };

async function classify(text: string, output: unknown) {
  return classifyPlannerRequest({ text }, { classify: async () => output });
}

test("INFORMATION, ambiguous, and unsupported classification stop before plan generation", async () => {
  for (const [text, output] of [
    ["What is my balance?", { status: "CLASSIFIED", category: "INFORMATION" }],
    ["Do something", { status: "AMBIGUOUS" }],
    ["Stake my USDC", { status: "UNSUPPORTED" }],
  ] as const) {
    const classified = await classify(text, output);
    assert.equal(classified.ok, true);
    let planCalls = 0;
    const result = await generatePlannerPlan({ text }, classified.ok ? classified.classification : null,
      { generate: async () => { planCalls++; return action("SEND"); } });
    assert.deepEqual(result, { status: "NOT_APPLICABLE" });
    assert.equal(planCalls, 0);
  }
});

test("ACTION Send, Swap, and Bridge compose classification, graph validation, and 11A intent binding", async () => {
  const cases = [
    { kind: "SEND", text: `Send 10 USDC to ${recipient}`,
      fields: { asset: "USDC", amount: "10", recipient } },
    { kind: "SWAP", text: "Swap 10 USDC to EURC",
      fields: { fromAsset: "USDC", toAsset: "EURC", amount: "10" } },
    { kind: "BRIDGE", text: `Bridge 10 USDC from Arc Testnet to Base Sepolia to ${recipient}`,
      fields: { asset: "USDC", amount: "10", recipient } },
  ] as const;
  for (const item of cases) {
    const classified = await classify(item.text, { status: "CLASSIFIED", category: "ACTION" });
    assert.equal(classified.ok, true);
    const planResult = await generatePlannerPlan({ text: item.text }, classified.ok ? classified.classification : null,
      { generate: async () => action(item.kind) });
    assert.equal(planResult.status, "GENERATED");
    if (planResult.status !== "GENERATED") continue;
    assert.equal(validatePlannerPlan(planResult.plan, "ACTION").valid, true);
    const resolved = await resolvePlannerParameters({ text: item.text }, planResult.plan,
      { resolve: async () => ({ resolutions: [draft(item.kind.toLowerCase(), item.fields)] }) });
    assert.equal(resolved.status, "RESOLVED");
    if (resolved.status === "RESOLVED") {
      assert.equal(resolved.planId, planResult.plan.id);
      assert.deepEqual(resolved.intents.map((intent) => [intent.id, intent.kind]), [[item.kind.toLowerCase(), item.kind]]);
      assert.equal(validatePlannerIntent(resolved.intents[0]).valid, true);
    }
  }
});

test("STRATEGY Swap then Send retains the explicit graph while resolving both original goal IDs", async () => {
  const text = `Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`;
  const classified = await classify(text, { status: "CLASSIFIED", category: "STRATEGY" });
  assert.equal(classified.ok, true);
  const planned = await generatePlannerPlan({ text }, classified.ok ? classified.classification : null,
    { generate: async () => strategy });
  assert.equal(planned.status, "GENERATED");
  if (planned.status !== "GENERATED") return;
  assert.deepEqual(planned.plan.goals[1].dependsOn, ["swap"]);
  const resolved = await resolvePlannerParameters({ text }, planned.plan, { resolve: async () => ({ resolutions: [
    draft("send", { asset: "EURC", amount: "5", recipient }),
    draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }),
  ] }) });
  assert.equal(resolved.status, "RESOLVED");
  if (resolved.status === "RESOLVED") {
    assert.deepEqual(resolved.intents.map((intent) => intent.id), ["swap", "send"]);
    assert.ok(resolved.intents.every((intent) => validatePlannerIntent(intent).valid));
  }
  assert.deepEqual(planned.plan.goals[1].dependsOn, ["swap"]);
});

test("changed-state replan remains bounded and submitted or ambiguous attempts defer to 10F", async () => {
  const text = `Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`;
  const request = { text };
  const replacement = { ...strategy, id: "replacement", goals: [
    { id: "swap", kind: "SWAP", dependsOn: ["send"] }, { id: "send", kind: "SEND", dependsOn: [] },
  ] };
  const input = (trigger: unknown) => ({ version: 1, request, plan: strategy, trigger });
  const trigger = { kind: "CHANGED_STATE", impact: "GOAL_STRUCTURE", affectedGoalId: "send" };
  const result = await evaluatePlannerReplan(input(trigger), { generate: async () => replacement });
  assert.equal(result.status, "REPLAN_REQUIRED");
  if (result.status === "REPLAN_REQUIRED") {
    assert.equal(validatePlannerPlan(result.plan, "STRATEGY").valid, true);
    assert.deepEqual(result.plan.goals.map((goal) => [goal.id, goal.kind]), strategy.goals.map((goal) => [goal.id, goal.kind]));
    assert.equal(Object.hasOwn(result, "transaction"), false);
  }
  let calls = 0;
  for (const submissionState of ["SUBMITTED", "SUBMISSION_OUTCOME_UNKNOWN"]) {
    const deferred = await evaluatePlannerReplan(input({ kind: "EXECUTION_FAILURE", submissionState,
      impact: "GOAL_STRUCTURE", affectedGoalId: "send" }), { generate: async () => { calls++; return replacement; } });
    assert.deepEqual(deferred, { status: "UNSUPPORTED", reason: "PHASE_10F_RECOVERY_REQUIRED" });
  }
  assert.equal(calls, 0);
});
