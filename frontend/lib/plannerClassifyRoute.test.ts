import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/planner-classify/route.ts";

const request = (text: string) => new Request("http://localhost/api/planner-classify", { method: "POST", body: JSON.stringify({ text }) });

test("HTTP classifier stays disabled unless the server setting is exactly true", async () => {
  const previous = process.env.PLANNER_CLASSIFIER_HTTP_ENABLED;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("Unexpected provider call"); };
  try {
    for (const setting of [undefined, "false", "TRUE", "1", " true "]) {
      if (setting === undefined) delete process.env.PLANNER_CLASSIFIER_HTTP_ENABLED;
      else process.env.PLANNER_CLASSIFIER_HTTP_ENABLED = setting;
      const response = await POST(request("Swap 10 USDC to EURC"));
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(await response.text(), "");
      assert.equal(calls, 0);
    }
  } finally {
    if (previous === undefined) delete process.env.PLANNER_CLASSIFIER_HTTP_ENABLED;
    else process.env.PLANNER_CLASSIFIER_HTTP_ENABLED = previous;
    globalThis.fetch = oldFetch;
  }
});

test("explicit server enable reaches the mocked provider and canonical validator", async () => {
  const previousGate = process.env.PLANNER_CLASSIFIER_HTTP_ENABLED;
  const previousKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.PLANNER_CLASSIFIER_HTTP_ENABLED = "true";
  process.env.OPENAI_API_KEY = "fixture-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ classification: { status: "CLASSIFIED", category: "ACTION" } }) }] }] });
  };
  try {
    const response = await POST(request("Swap 10 USDC to EURC"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { classification: { status: "CLASSIFIED", category: "ACTION" } });
    assert.equal(calls, 1);
  } finally {
    if (previousGate === undefined) delete process.env.PLANNER_CLASSIFIER_HTTP_ENABLED;
    else process.env.PLANNER_CLASSIFIER_HTTP_ENABLED = previousGate;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    globalThis.fetch = oldFetch;
  }
});

test("API rejects invalid browser payloads without a provider request or secret echo", async () => {
  const previous = process.env.PLANNER_CLASSIFIER_HTTP_ENABLED;
  const oldFetch = globalThis.fetch;
  process.env.PLANNER_CLASSIFIER_HTTP_ENABLED = "true";
  globalThis.fetch = async () => { throw Error("Unexpected provider call"); };
  try {
    for (const body of [
      { text: " " },
      { text: "balance", apiKey: "fixture-secret" },
      { text: "balance", locale: "other" },
    ]) {
      const response = await POST(new Request("http://localhost/api/planner-classify", { method: "POST", body: JSON.stringify(body) }));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const payload = await response.json();
      assert.deepEqual(payload, { classification: { status: "INVALID_INPUT" } });
      assert.doesNotMatch(JSON.stringify(payload), /fixture-secret|OPENAI_API_KEY/);
    }
  } finally {
    if (previous === undefined) delete process.env.PLANNER_CLASSIFIER_HTTP_ENABLED;
    else process.env.PLANNER_CLASSIFIER_HTTP_ENABLED = previous;
    globalThis.fetch = oldFetch;
  }
});
