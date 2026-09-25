import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/planner-classify/route.ts";

test("API rejects invalid browser payloads without a provider request or secret echo", async () => {
  const oldFetch = globalThis.fetch;
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
  } finally { globalThis.fetch = oldFetch; }
});
