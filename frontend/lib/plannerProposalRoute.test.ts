import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/planner-proposal/route.ts";
import { acceptPlannerProposalResponse } from "./plannerProposal.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const text = `Send 10 USDC to ${recipient}`;
const envelope = (value: unknown) => Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const request = (body: unknown) => new Request("http://localhost/api/planner-proposal", { method: "POST", body: JSON.stringify(body) });

test("production route invokes three mocked provider stages and returns only a non-executable proposal", async () => {
  const previousKey = process.env.OPENAI_API_KEY, oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "fixture-secret";
  const outputs = [
    { classification: { status: "CLASSIFIED", category: "ACTION" } },
    { version: 1, id: "plan-1", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] }] },
    { resolutions: [{ goalId: "send", chain: null, asset: "USDC", amount: "10", recipient, fromAsset: null, toAsset: null, sourceChain: null, destinationChain: null }] },
  ];
  let calls = 0;
  globalThis.fetch = async () => envelope(outputs[calls++]);
  try {
    const response = await POST(request({ text, locale: "en", sessionId: "session-1" }));
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(calls, 3);
    const payload = await response.json();
    assert.equal(payload.status, "PROPOSAL");
    assert.ok(acceptPlannerProposalResponse(payload.proposal, "session-1", { text, locale: "en" }));
    assert.match(payload.proposal.requestId, /^[0-9a-f-]{36}$/);
    assert.match(payload.proposal.proposalId, /^[0-9a-f-]{36}$/);
    assert.notEqual(payload.proposal.requestId, payload.proposal.proposalId);
    assert.doesNotMatch(JSON.stringify(payload), /fixture-secret|OPENAI_API_KEY|FIXED_USER_INPUT|Strategy|wallet|signer|calldata|policy/);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    globalThis.fetch = oldFetch;
  }
});

test("route rejects malformed input before any provider call", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("unexpected"); };
  try {
    for (const body of ["{", "", " ", "x".repeat(9_000),
      JSON.stringify({ text: " ", locale: "en", sessionId: "s" }),
      JSON.stringify({ text: "x".repeat(2_001), locale: "en", sessionId: "s" }),
      JSON.stringify({ text, locale: "fr", sessionId: "s" }),
      JSON.stringify({ text, locale: "en", sessionId: "bad session" }),
      JSON.stringify({ text, locale: "en", sessionId: "s", requestId: "injected" }),
      JSON.stringify({ text, locale: "en", sessionId: "s", proposalId: "injected" }),
      JSON.stringify({ text, locale: "en", sessionId: "s", requestDigest: "0xdead" })]) {
      const response = await POST(new Request("http://localhost/api/planner-proposal", { method: "POST", body }));
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), { status: "INVALID_REQUEST" });
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("route reports provider unavailable without secrets or a proposal", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await POST(request({ text, locale: "en", sessionId: "session-1" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "CLASSIFICATION_PROVIDER_UNAVAILABLE" });
  } finally { if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey; }
});
