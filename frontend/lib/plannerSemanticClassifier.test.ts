import assert from "node:assert/strict";
import test from "node:test";
import { classifyPlannerRequest, validatePlannerClassificationRequest, type PlannerSemanticClassifier } from "./plannerSemanticClassifier.ts";

const recipient = "0x1111111111111111111111111111111111111111";

test("mocked semantic results cover user goals without resolving transaction fields", async () => {
  const cases = [
    ["What is my USDC balance?", { status: "CLASSIFIED", category: "INFORMATION" }],
    ["Did my transaction confirm?", { status: "CLASSIFIED", category: "INFORMATION" }],
    [`Send 10 USDC to ${recipient}`, { status: "CLASSIFIED", category: "ACTION" }],
    ["Swap 10 USDC to EURC", { status: "CLASSIFIED", category: "ACTION" }],
    [`Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`, { status: "CLASSIFIED", category: "STRATEGY" }],
    ["Do something with my USDC", { status: "AMBIGUOUS" }],
    ["Stake my USDC", { status: "UNSUPPORTED" }],
  ] as const;
  for (const [text, output] of cases) {
    const classifier: PlannerSemanticClassifier = { classify: async (request) => { assert.deepEqual(request, { text, locale: "en" }); return output; } };
    assert.deepEqual(await classifyPlannerRequest({ text, locale: "en" }, classifier), { ok: true, classification: output });
  }
});

test("input validation blocks malformed requests before provider use", async () => {
  let calls = 0;
  const classifier: PlannerSemanticClassifier = { classify: async () => { calls++; return { status: "CLASSIFIED", category: "ACTION" }; } };
  for (const input of [null, "swap", {}, { text: "" }, { text: "  " }, { text: "x".repeat(2_001) }, { text: "balance", locale: "fr" }, { text: "balance", apiKey: "should-never-pass" }]) {
    assert.deepEqual(await classifyPlannerRequest(input, classifier), { ok: true, classification: { status: "INVALID_INPUT" } });
  }
  assert.equal(calls, 0);
  assert.deepEqual(validatePlannerClassificationRequest({ text: " balance " }), { text: "balance" });
});

test("untrusted provider shape and failure cannot invent a semantic category", async () => {
  for (const output of [null, "ACTION", {}, { status: "CLASSIFIED" }, { status: "CLASSIFIED", category: "SEND" }, { status: "CLASSIFIED", category: ["ACTION", "STRATEGY"] }, { status: "CLASSIFIED", category: "ACTION", signer: true }, { status: "CLASSIFIED", category: "ACTION", plannerIntent: {} }, { status: "CLASSIFIED", category: "STRATEGY", steps: [] }, { status: "AMBIGUOUS", category: "ACTION" }, { status: "INVALID_INPUT" }]) {
    assert.deepEqual(await classifyPlannerRequest({ text: "balance" }, { classify: async () => output }), { ok: false, error: "INVALID_PROVIDER_OUTPUT" });
  }
  assert.deepEqual(await classifyPlannerRequest({ text: "balance" }, { classify: async () => { throw Error("provider details"); } }), { ok: false, error: "PROVIDER_UNAVAILABLE" });
});
