import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIPlannerPlanGenerator } from "./openaiPlannerPlanGenerator.server.ts";
import { generatePlannerPlan } from "./plannerPlanGenerator.ts";

const classification = { status: "CLASSIFIED", category: "ACTION" };
const plan = { version: 1, id: "p", classification: "ACTION", goals: [{ id: "swap", kind: "SWAP", dependsOn: [] }] };
const envelope = (value: unknown) => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });

test("server adapter sends one bounded Responses request with strict schema and no tools", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.properties.goals.items.required, ["id", "kind", "dependsOn"]);
    assert.deepEqual(body.text.format.schema.properties.goals.items.properties.kind.enum, ["SEND", "SWAP", "BRIDGE"]);
    assert.equal(body.text.format.schema.properties.goals.items.additionalProperties, false);
    assert.equal(body.text.format.schema.properties.goals.items.properties.intent, undefined);
    return new Response(JSON.stringify(envelope(plan)), { status: 200 });
  };
  const generator = createOpenAIPlannerPlanGenerator({ apiKey: "test-only-key", fetcher });
  const result = await generatePlannerPlan({ text: "Swap 10 USDC to EURC" }, classification, generator);
  assert.equal(result.status, "GENERATED");
  assert.equal(calls, 1);
});

test("missing key, timeout, HTTP error, and malformed envelopes return provider failure", async () => {
  const cases: { apiKey: string; fetcher: typeof fetch }[] = [
    { apiKey: "", fetcher: async () => { throw Error("must not call"); } },
    { apiKey: "test-only-key", fetcher: async () => { throw new DOMException("timeout", "TimeoutError"); } },
    { apiKey: "test-only-key", fetcher: async () => new Response("failure", { status: 500 }) },
    { apiKey: "test-only-key", fetcher: async () => new Response(JSON.stringify({ status: "completed", output: [] }), { status: 200 }) },
    { apiKey: "test-only-key", fetcher: async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{" }] }] }), { status: 200 }) },
  ];
  for (const options of cases) {
    const result = await generatePlannerPlan({ text: "swap" }, classification, createOpenAIPlannerPlanGenerator(options));
    assert.deepEqual(result, { status: "PROVIDER_ERROR" });
  }
});

test("well-formed provider envelope with invalid plan remains INVALID_PLAN", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(envelope({ ...plan, signer: true })), { status: 200 });
  const result = await generatePlannerPlan({ text: "swap" }, classification, createOpenAIPlannerPlanGenerator({ apiKey: "test-only-key", fetcher }));
  assert.equal(result.status, "INVALID_PLAN");
});
