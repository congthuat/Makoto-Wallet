import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlannerReplan, validatePlannerReplanInput, type PlannerReplanGenerator } from "./plannerReplan.ts";
import { validatePlannerPlan } from "./plannerPlan.ts";
import { createOpenAIPlannerReplanGenerator, REPLAN_INSTRUCTIONS } from "./openaiPlannerReplan.server.ts";

const plan = { version: 1, id: "original", classification: "STRATEGY", goals: [
  { id: "swap", kind: "SWAP", dependsOn: [] },
  { id: "send", kind: "SEND", dependsOn: ["swap"] },
] } as const;
const replacement = { version: 1, id: "replacement", classification: "STRATEGY", goals: [
  { id: "swap", kind: "SWAP", dependsOn: ["send"] },
  { id: "send", kind: "SEND", dependsOn: [] },
] } as const;
const request = { text: "Swap 10 USDC to EURC and send 5 EURC to 0x1111111111111111111111111111111111111111", locale: "en" } as const;
const input = (trigger: unknown, current: unknown = plan) => ({ version: 1, request, plan: current, trigger });
const changed = (impact: string, affectedGoalId: string | null = "send") => ({ kind: "CHANGED_STATE", impact, affectedGoalId });
const quiet: PlannerReplanGenerator = { generate: async () => { throw Error("provider must not be called"); } };

test("unchanged semantics and nonstructural policy stops retain the plan without execution permission", async () => {
  for (const trigger of [changed("NONE"), { kind: "POLICY_STOP", decision: "REQUOTE", affectedGoalId: "swap" }, { kind: "POLICY_STOP", decision: "REVALIDATE", affectedGoalId: "swap" }]) {
    assert.deepEqual(await evaluatePlannerReplan(input(trigger), quiet), { status: "NO_REPLAN_REQUIRED", planId: "original", affectedGoalId: trigger.affectedGoalId });
  }
});

test("stale or invalid parameters preserve the validated 11C graph for a separate 11D call", async () => {
  for (const trigger of [changed("PARAMETERS"), { kind: "PARAMETERS_INVALIDATED", affectedGoalId: "send" }]) {
    const result = await evaluatePlannerReplan(input(trigger), quiet);
    assert.deepEqual(result, { status: "RE_RESOLVE_PARAMETERS", planId: "original", affectedGoalId: "send" });
    assert.equal(Object.hasOwn(result, "plan"), false);
  }
});

test("ambiguous change requests clarification rather than guessing a replacement goal", async () => {
  for (const trigger of [changed("AMBIGUOUS"), { kind: "CAPABILITY_UNAVAILABLE", impact: "AMBIGUOUS", affectedGoalId: "swap" }]) {
    assert.equal((await evaluatePlannerReplan(input(trigger), quiet)).status, "NEEDS_CLARIFICATION");
  }
});

test("a changed strategy graph is a proposal only after 11C validation and original-goal binding", async () => {
  let calls = 0;
  const original = JSON.stringify(plan);
  const result = await evaluatePlannerReplan(input(changed("GOAL_STRUCTURE")), { generate: async (value) => {
    calls++;
    assert.deepEqual(value.request, request);
    assert.deepEqual(value.plan, plan);
    return replacement;
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, "REPLAN_REQUIRED");
  if (result.status === "REPLAN_REQUIRED") {
    assert.equal(result.originalPlanId, plan.id);
    assert.equal(validatePlannerPlan(result.plan, plan.classification).valid, true);
    assert.deepEqual(result.plan.goals, replacement.goals);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    assert.equal(Object.isFrozen(result.plan.goals[0].dependsOn), true);
    assert.equal(Object.hasOwn(result, "executionEnabled"), false);
  }
  assert.equal(JSON.stringify(plan), original);
});

test("capability loss cannot invent a replacement ACTION kind or execution route", async () => {
  const action = { version: 1, id: "action", classification: "ACTION", goals: [{ id: "swap", kind: "SWAP", dependsOn: [] }] };
  const trigger = { kind: "CAPABILITY_UNAVAILABLE", impact: "GOAL_STRUCTURE", affectedGoalId: "swap" };
  assert.deepEqual(await evaluatePlannerReplan(input(trigger, action), quiet), { status: "UNSUPPORTED", reason: "CAPABILITY_REQUIRES_USER_DECISION" });
  assert.deepEqual(await evaluatePlannerReplan(input(trigger), quiet), { status: "UNSUPPORTED", reason: "CAPABILITY_REQUIRES_USER_DECISION" });
  assert.deepEqual(await evaluatePlannerReplan(input(changed("GOAL_STRUCTURE", "swap"), action), quiet), { status: "UNSUPPORTED", reason: "NO_AUTHORIZED_GRAPH_CHANGE" });
});

test("provider cannot mutate the validated source plan while proposing a graph", async () => {
  const before = JSON.stringify(plan);
  assert.deepEqual(await evaluatePlannerReplan(input(changed("GOAL_STRUCTURE")), { generate: async (value) => {
    (value.plan.goals[0].dependsOn as string[]).push("send");
    return replacement;
  } }), { status: "PROVIDER_ERROR" });
  assert.equal(JSON.stringify(plan), before);
});

test("malformed, cyclic, executable, identical, and unrelated replacement plans are rejected", async () => {
  const unrelated = { ...replacement, goals: [...replacement.goals, { id: "bridge", kind: "BRIDGE", dependsOn: ["send"] }] };
  for (const candidate of [null, { ...replacement, goals: [{ ...replacement.goals[0], dependsOn: ["unknown"] }, replacement.goals[1]] }, { ...replacement, signer: true }, { ...replacement, goals: [{ ...replacement.goals[0], amount: "10" }, replacement.goals[1]] }, { ...replacement, goals: [{ ...replacement.goals[0], kind: "BRIDGE" }, replacement.goals[1]] }, { ...replacement, goals: [replacement.goals[0]] }, unrelated, { ...plan, id: "new-but-same-graph" }, { ...replacement, id: plan.id }, { ...replacement, classification: "ACTION" }]) {
    assert.deepEqual(await evaluatePlannerReplan(input(changed("GOAL_STRUCTURE")), { generate: async () => candidate }), { status: "UNSUPPORTED", reason: "INVALID_REPLACEMENT_PLAN" });
  }
});

test("provider failure has no fabricated replacement", async () => {
  assert.deepEqual(await evaluatePlannerReplan(input(changed("GOAL_STRUCTURE")), { generate: async () => { throw Error("sensitive error"); } }), { status: "PROVIDER_ERROR" });
});

test("policy BLOCK remains a stop, not replan or wallet permission", async () => {
  assert.deepEqual(await evaluatePlannerReplan(input({ kind: "POLICY_STOP", decision: "BLOCK", affectedGoalId: "swap" }), quiet), { status: "UNSUPPORTED", reason: "POLICY_BLOCK" });
});

test("ambiguous or known submitted attempts defer to 10F without retry or provider call", async () => {
  for (const submissionState of ["SUBMISSION_OUTCOME_UNKNOWN", "SUBMITTED"]) {
    assert.deepEqual(await evaluatePlannerReplan(input({ kind: "EXECUTION_FAILURE", submissionState, impact: "GOAL_STRUCTURE", affectedGoalId: "swap" }), quiet), { status: "UNSUPPORTED", reason: "PHASE_10F_RECOVERY_REQUIRED" });
  }
  assert.equal((await evaluatePlannerReplan(input({ kind: "EXECUTION_FAILURE", submissionState: "PRE_SUBMISSION_FAILURE", impact: "PARAMETERS", affectedGoalId: "swap" }), quiet)).status, "RE_RESOLVE_PARAMETERS");
});

test("invalid input, unknown goal, graph corruption, and smuggled authority stop before provider use", async () => {
  const cases = [
    { ...input(changed("NONE")), privateKey: "forbidden" },
    input({ ...changed("NONE"), signer: true }),
    input(changed("NONE", "unknown")),
    input({ kind: "POLICY_STOP", decision: "ALLOW", affectedGoalId: "swap" }),
    input({ kind: "EXECUTION_FAILURE", submissionState: "RETRY_ELIGIBLE", impact: "NONE", affectedGoalId: "swap" }),
    input(changed("NONE"), { ...plan, goals: [{ ...plan.goals[0], dependsOn: ["send"] }, plan.goals[1]] }),
    { ...input(changed("NONE")), request: { ...request, rawTransaction: "0x" } },
  ];
  for (const value of cases) assert.equal((await evaluatePlannerReplan(value, quiet)).status, "INVALID_INPUT");
});

test("versioned input survives JSON serialization and restore", async () => {
  const original = input(changed("PARAMETERS", "send"));
  const restored = JSON.parse(JSON.stringify(original));
  assert.deepEqual(validatePlannerReplanInput(restored), original);
  assert.equal((await evaluatePlannerReplan(restored, quiet)).status, "RE_RESOLVE_PARAMETERS");
});

test("server adapter makes one bounded Responses request with strict 11C shape and no tools", async () => {
  let calls = 0;
  const adapter = createOpenAIPlannerReplanGenerator({ apiKey: "test-key", fetcher: async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.text.format.strict, true);
    assert.match(REPLAN_INSTRUCTIONS, /Preserve the supplied classification/);
    assert.deepEqual(JSON.parse(body.input[0].content[0].text).plan, plan);
    return { ok: true, json: async () => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(replacement) }] }] }) } as Response;
  } });
  assert.equal((await evaluatePlannerReplan(input(changed("GOAL_STRUCTURE")), adapter)).status, "REPLAN_REQUIRED");
  assert.equal(calls, 1);
});
