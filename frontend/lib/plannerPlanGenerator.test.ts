import assert from "node:assert/strict";
import test from "node:test";
import { generatePlannerPlan, type PlannerPlanGenerator } from "./plannerPlanGenerator.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const swap = { id: "swap", kind: "SWAP", dependsOn: [] };
const send = { id: "send", kind: "SEND", dependsOn: ["swap"] };
const classification = (category: "ACTION" | "STRATEGY") => ({ status: "CLASSIFIED", category });

test("mocked provider yields goal kinds and graph without resolving parameters", async () => {
  for (const [text, category, goals] of [
    [`Send 5 EURC to ${recipient}`, "ACTION", [{ id: "send", kind: "SEND", dependsOn: [] }]],
    ["Swap 10 USDC to EURC", "ACTION", [swap]],
    [`Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`, "STRATEGY", [send, swap]],
    [`Bridge 10 USDC from Arc to Base Sepolia to ${recipient}`, "ACTION", [{ id: "bridge", kind: "BRIDGE", dependsOn: [] }]],
  ] as const) {
    let calls = 0;
    const result = await generatePlannerPlan({ text, locale: "en" }, classification(category), {
      generate: async (request) => { calls++; assert.deepEqual(request, { text, locale: "en", classification: category }); return { version: 1, id: "plan", classification: category, goals }; },
    });
    assert.equal(result.status, "GENERATED");
    assert.equal(calls, 1);
    if (result.status === "GENERATED") assert.deepEqual(result.plan.goals, goals);
  }
});

test("non-actionable classification, technical failure, and invalid text never invoke provider", async () => {
  let calls = 0;
  const provider: PlannerPlanGenerator = { generate: async () => { calls++; return {}; } };
  for (const result of [
    { status: "CLASSIFIED", category: "INFORMATION" }, { status: "AMBIGUOUS" }, { status: "UNSUPPORTED" },
    { status: "INVALID_INPUT" }, { ok: false, error: "PROVIDER_UNAVAILABLE" }, null,
  ]) assert.deepEqual(await generatePlannerPlan({ text: "balance" }, result, provider), { status: "NOT_APPLICABLE" });
  for (const input of [{ text: "" }, { text: "x".repeat(2001) }, { text: "swap", apiKey: "bad" }])
    assert.deepEqual(await generatePlannerPlan(input, classification("ACTION"), provider), { status: "NOT_APPLICABLE" });
  assert.equal(calls, 0);
});

test("untrusted output and provider failures never fabricate plans", async () => {
  for (const output of [null, {}, { version: 1, id: "x", classification: "OTHER", goals: [] },
    { version: 1, id: "x", classification: "ACTION", goals: [swap], sendTransaction: true },
    { version: 1, id: "x", classification: "ACTION", goals: [{ ...swap, dependsOn: ["missing"] }] },
    { version: 1, id: "x", classification: "ACTION", goals: [{ ...swap, amount: "10" }] },
  ]) assert.equal((await generatePlannerPlan({ text: "swap" }, classification("ACTION"), { generate: async () => output })).status, "INVALID_PLAN");
  assert.deepEqual(await generatePlannerPlan({ text: "swap" }, classification("ACTION"), { generate: async () => { throw Error("sensitive provider detail"); } }), { status: "PROVIDER_ERROR" });
});
