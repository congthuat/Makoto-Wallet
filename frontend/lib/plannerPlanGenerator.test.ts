import assert from "node:assert/strict";
import test from "node:test";
import { generatePlannerPlan, type PlannerPlanGenerator } from "./plannerPlanGenerator.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const swap = { version: 1, id: "swap", kind: "SWAP", chainId: 5042002, fromAsset: "usdc", toAsset: "eurc", amount: "10" };
const send = { version: 1, id: "send", kind: "SEND", chainId: 5042002, asset: "eurc", amount: "5", recipient };
const classification = (category: "ACTION" | "STRATEGY") => ({ status: "CLASSIFIED", category });

test("mocked provider yields Send ACTION, Swap ACTION, and dependent Swap then Send STRATEGY", async () => {
  for (const [text, category, goals] of [
    [`Send 5 EURC to ${recipient}`, "ACTION", [{ intent: send, dependsOn: [] }]],
    ["Swap 10 USDC to EURC", "ACTION", [{ intent: swap, dependsOn: [] }]],
    [`Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`, "STRATEGY", [{ intent: send, dependsOn: ["swap"] }, { intent: swap, dependsOn: [] }]],
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
    { version: 1, id: "x", classification: "ACTION", goals: [{ intent: send, dependsOn: [] }], sendTransaction: true },
    { version: 1, id: "x", classification: "ACTION", goals: [{ intent: send, dependsOn: ["missing"] }] },
  ]) assert.equal((await generatePlannerPlan({ text: "send" }, classification("ACTION"), { generate: async () => output })).status, "INVALID_PLAN");
  assert.deepEqual(await generatePlannerPlan({ text: "send" }, classification("ACTION"), { generate: async () => { throw Error("sensitive provider detail"); } }), { status: "PROVIDER_ERROR" });
});
