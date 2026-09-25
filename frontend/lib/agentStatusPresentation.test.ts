import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { presentAgentStatus } from "./agentStatusPresentation.ts";
import { translate } from "../i18n/index.ts";
// The fixture renders the production TSX component with isolated wallet hooks.
// @ts-expect-error Test-only JavaScript renderer.
import { renderAgentStatus, renderWorkspace } from "../scripts/phase7g-workspace-fixture.mjs";

const identity = { version: 2, sessionId: "session:12f", stateId: "state:12f" } as const;
const hash = `0x${"a".repeat(64)}`;
const requested = { ...identity, kind: "REQUESTED" } as const;
const planned = { ...identity, kind: "PLAN_READY", plan: { kind: "PLANNER_PLAN", id: "plan:12f" } } as const;
const transaction = { ...identity, kind: "TRANSACTION", step: { kind: "STRATEGY_STEP", strategyId: "strategy:12f", stepId: "bridge:12f" }, scope: "SOURCE_CHAIN", binding: { account: "0x1111111111111111111111111111111111111111", chainId: 5042002, action: "BRIDGE", preparedAction: { kind: "PREPARED_ACTION", tool: "bridge.prepare", quoteFingerprint: `0x${"b".repeat(64)}`, stepIndex: 0 }, quoteExpiresAt: 2000, preparationExpiresAt: 2000, handoffExpiresAt: null } } as const;
const attempt = { kind: "TRANSACTION_ATTEMPT", id: "attempt:12f" } as const;
const receipt = { kind: "RECEIPT", chainId: 5042002, transactionHash: hash } as const;
const states = [
  requested, planned,
  { ...transaction, status: "PREPARED" },
  { ...transaction, status: "AWAITING_SIGNATURE" },
  { ...transaction, status: "SUBMITTED", submittedHash: hash, attempt },
  { ...transaction, status: "CONFIRMING", submittedHash: hash, attempt },
  { ...transaction, status: "SUCCESS", submittedHash: hash, attempt, receipt },
  { ...transaction, status: "REJECTED", attempt: null },
  { ...transaction, status: "EXPIRED", attempt: null },
  { ...transaction, status: "FAILED", submittedHash: hash, attempt },
] as const;

test("12F presents all ten validated restored statuses as history", () => {
  const expected = ["REQUESTED", "PLAN_READY", "PREPARED", "AWAITING_SIGNATURE", "SUBMITTED", "CONFIRMING", "SUCCESS", "REJECTED", "EXPIRED", "FAILED"];
  states.forEach((state, index) => {
    const view = presentAgentStatus({ kind: "RESTORED", result: { status: "HISTORICAL", state } });
    assert.equal(view.status, expected[index]);
    assert.equal(view.historical, true);
    assert.equal(view.sourceOnly, index >= 2);
    for (const locale of ["en", "vi"] as const) {
      assert.ok(translate(locale, `agent.status.${view.status}`));
      assert.ok(translate(locale, `agent.status.detail.${view.status}`));
      assert.ok(translate(locale, "agent.status.historical"));
    }
  });
});

test("12F never promotes a plan, hash or structural success into current transaction status", () => {
  assert.equal(presentAgentStatus({ kind: "CURRENT_REQUEST", state: requested }).status, "REQUESTED");
  assert.equal(presentAgentStatus({ kind: "CURRENT_REQUEST", state: planned }).status, "UNAVAILABLE");
  assert.equal(presentAgentStatus({ kind: "CURRENT_REQUEST", state: states[6] }).status, "UNAVAILABLE");
  assert.equal(presentAgentStatus({ kind: "GUARDED_TRANSITION", result: { allowed: false, reason: "MISSING_CANONICAL_STRATEGY_BINDING" } }).status, "UNAVAILABLE");
  assert.equal(presentAgentStatus({ kind: "GUARDED_TRANSITION", result: { allowed: true, state: states[2] } }).status, "UNAVAILABLE");
  assert.equal(presentAgentStatus({ kind: "GUARDED_TRANSITION", result: { allowed: true, state: planned } }).status, "PLAN_READY");
  for (const state of states.slice(3)) assert.equal(presentAgentStatus({ kind: "GUARDED_TRANSITION", result: { allowed: true, state } }).status, "UNAVAILABLE");
  assert.equal(presentAgentStatus({ kind: "RESTORED", result: { status: "HISTORICAL", state: states[6] } }).historical, true);
});

test("12F keeps pending and unavailable recovery separate from success and failure", () => {
  const pending = presentAgentStatus({ kind: "RECOVERY_EVALUATION", result: { status: "PENDING_CONFIRMATION" } });
  const unknown = presentAgentStatus({ kind: "RECOVERY_EVALUATION", result: { status: "OUTCOME_UNKNOWN" } });
  assert.equal(pending.status, "PENDING");
  assert.equal(unknown.status, "UNKNOWN");
  assert.equal(pending.historical, true);
  assert.equal(unknown.historical, true);
  assert.equal(presentAgentStatus({ kind: "RECOVERY_EVALUATION", result: { status: "RECEIPT_VERIFICATION_REQUIRED" } }).status, "UNKNOWN");
  assert.equal(presentAgentStatus({ kind: "RECOVERY_EVALUATION", result: { status: "LEGAL_TRANSITION_REQUIRED", target: "SUCCESS" } }).status, "UNAVAILABLE");
  assert.equal(presentAgentStatus({ kind: "RECOVERY_EVALUATION", result: { status: "GUARDED_TRANSITION", state: states[6], sourceOnly: true } }).status, "UNAVAILABLE");
});

test("12F source-chain outcomes never claim destination arrival or failure", () => {
  for (const state of [states[6], states[9]]) {
    const view = presentAgentStatus({ kind: "RESTORED", result: { status: "HISTORICAL", state } });
    assert.equal(view.sourceOnly, true);
    for (const locale of ["en", "vi"] as const) assert.ok(translate(locale, "agent.status.sourceOnly"));
  }
});

test("12F fails closed on malformed status input and adds no execution controls", () => {
  const throwing = new Proxy({}, { get() { throw new Error("untrusted getter"); } });
  const accessor = Object.defineProperty({ kind: "RESTORED" }, "result", { enumerable: true, get() { throw new Error("getter"); } });
  for (const input of [null, undefined, {}, [], throwing, accessor, { kind: "UNKNOWN" }, { kind: "UNAVAILABLE", state: requested }, { kind: "CURRENT_REQUEST", state: requested, extra: true }, { kind: "RESTORED", result: { status: "HISTORICAL", state: requested, now: 0 } }, { kind: "RECOVERY_EVALUATION", result: { status: "PENDING_CONFIRMATION", retry: true } }, { kind: "GUARDED_TRANSITION", result: { allowed: true, state: planned, extra: true } }, { kind: "RESTORED", result: { status: "HISTORICAL", state: { ...requested, version: 1 } } }, { kind: "RESTORED", result: { status: "HISTORICAL", state: { ...requested, kind: "UNKNOWN" } } }, { kind: "RESTORED", result: { status: "HISTORICAL", state: { ...transaction, status: "UNKNOWN" } } }, { kind: "GUARDED_TRANSITION", result: { allowed: true, state: { ...states[6], receipt: null } } }]) {
    assert.equal(presentAgentStatus(input).status, "UNAVAILABLE");
  }
  const component = readFileSync(new URL("../components/AgentStatusSurface.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  assert.match(page, /<AgentStatusSurface input=\{\{ kind: "UNAVAILABLE" \}\}/);
  assert.doesNotMatch(component, /<button|<a\s|onClick|sendTransaction|writeContract|signMessage|setInterval|retry/i);
});

test("12F rendered history stays visibly recorded and never opens action controls", () => {
  for (const locale of ["en", "vi"] as const) for (const state of states) {
    const html = renderAgentStatus({ kind: "RESTORED", result: { status: "HISTORICAL", state } }, locale);
    assert.match(html, /data-historical="true"/);
    assert.match(html, /role="status"/);
    assert.ok(html.includes(translate(locale, "agent.status.recorded", { label: translate(locale, `agent.status.${state.kind === "TRANSACTION" ? state.status : state.kind}`) })));
    assert.ok(html.includes(translate(locale, "agent.status.historicalDetail")));
    assert.doesNotMatch(html, /<button|<a\s|<form|<input|onClick/);
    assert.ok(!html.includes(hash), "historical hash is not displayed as current evidence");
  }
});

test("12F rendered source outcomes explicitly leave destination unverified", () => {
  for (const locale of ["en", "vi"] as const) for (const state of [states[6], states[9]]) {
    const html = renderAgentStatus({ kind: "RESTORED", result: { status: "HISTORICAL", state } }, locale);
    assert.ok(html.includes(translate(locale, "agent.status.sourceOnly")));
    assert.doesNotMatch(html, /bridge complete|funds arrived|destination confirmed|destination failed/i);
  }
});

test("12F production action drafts report unavailable in both locales", () => {
  for (const locale of ["en", "vi"] as const) {
    const html = renderWorkspace({ locale, scenario: "fresh" });
    assert.match(html, /data-agent-status="UNAVAILABLE" data-historical="false"/);
    assert.ok(html.includes(translate(locale, "agent.status.detail.UNAVAILABLE")));
    assert.doesNotMatch(html, /agent\.status\./);
  }
});
