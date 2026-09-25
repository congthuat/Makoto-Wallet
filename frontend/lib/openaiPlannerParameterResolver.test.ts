import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIPlannerParameterResolver } from "./openaiPlannerParameterResolver.server.ts";
import { resolvePlannerParameters } from "./plannerParameterResolver.ts";

const plan = { version: 1, id: "plan", classification: "ACTION", goals: [{ id: "swap", kind: "SWAP", dependsOn: [] }] };
const draft = { resolutions: [{ goalId: "swap", chain: null, asset: null, amount: "10", recipient: null, fromAsset: "USDC", toAsset: "EURC", sourceChain: null, destinationChain: null }] };
const envelope = (value: unknown) => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });

test("actual adapter sends one strict Responses request and only extracts parameters", async () => {
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
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.type, "object");
    assert.equal(body.text.format.schema.additionalProperties, false);
    const item = body.text.format.schema.properties.resolutions.items;
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(item.required, Object.keys(item.properties));
    assert.deepEqual(item.properties.amount.type, ["string", "null"]);
    assert.equal(item.properties.kind, undefined);
    assert.equal(item.properties.dependsOn, undefined);
    return new Response(JSON.stringify(envelope(draft)), { status: 200 });
  };
  const result = await resolvePlannerParameters({ text: "Swap 10 USDC to EURC" }, plan, createOpenAIPlannerParameterResolver({ apiKey: "test-only-key", fetcher }));
  assert.equal(result.status, "RESOLVED");
  assert.equal(calls, 1);
});

test("missing key, timeout, HTTP 500, and malformed responses yield PROVIDER_ERROR", async () => {
  const cases: { apiKey: string; fetcher: typeof fetch }[] = [
    { apiKey: "", fetcher: async () => { throw Error("must not call"); } },
    { apiKey: "test-only-key", fetcher: async () => { throw new DOMException("timeout", "TimeoutError"); } },
    { apiKey: "test-only-key", fetcher: async () => new Response("error", { status: 500 }) },
    { apiKey: "test-only-key", fetcher: async () => new Response(JSON.stringify({ status: "completed", output: [] }), { status: 200 }) },
    { apiKey: "test-only-key", fetcher: async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{" }] }] }), { status: 200 }) },
  ];
  for (const options of cases) {
    const result = await resolvePlannerParameters({ text: "swap" }, plan, createOpenAIPlannerParameterResolver(options));
    assert.deepEqual(result, { status: "PROVIDER_ERROR" });
  }
});
