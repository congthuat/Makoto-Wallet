import assert from "node:assert/strict";
import test from "node:test";
import { createPlannerProposal, createPlannerProposalHostSource, validatePlannerProposalHostPair } from "./plannerProposal.ts";
import { createPlannerParameterEvidence, validatePlannerParameterEvidence } from "./plannerParameterEvidence.ts";
import { compilePlannerStrategy } from "./plannerStrategyCompiler.ts";
import { isLiveConfirmedPlannerSource } from "./plannerConfirmationAuthority.ts";

const recipient = "0x2222222222222222222222222222222222222222";
const request = { text: `Send 10 EURC to ${recipient}`, locale: "en" };
const plan = { version: 1, id: "b2-plan", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] }] };
const resolution = { status: "RESOLVED", planId: "b2-plan", intents: [
  { version: 1, id: "send", kind: "SEND", asset: "eurc", amount: "10", recipient, chainId: 5042002 },
] };
function fixture() {
  const proposal = createPlannerProposal({ requestId: "b2-request", sessionId: "b2-session", proposalId: "b2-proposal", request, plan, resolution });
  assert.ok(proposal);
  const host = createPlannerProposalHostSource(proposal, "b2-session", request);
  assert.ok(host);
  const event = { version: 1, eventId: "fake-click", requestId: proposal.requestId, sessionId: proposal.sessionId,
    requestDigest: proposal.requestDigest, planId: proposal.planId, planDigest: proposal.planDigest,
    proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest,
    fields: proposal.goals.flatMap((goal) => goal.parameters.map((field) => ({ goalId: goal.goalId, parameterKey: field.key,
      value: field.state === "FIXED_CANDIDATE" ? field.value : "" }))) };
  const source = { requestId: proposal.requestId, sessionId: proposal.sessionId, request, plan, resolution, structuredInput: event };
  return { proposal, host, source };
}

test("B1 proposal and exact host source are accepted, but display and matching JSON do not confirm", () => {
  const { proposal, host, source } = fixture();
  assert.ok(validatePlannerProposalHostPair(proposal, host));
  assert.equal(isLiveConfirmedPlannerSource(source), false);
  assert.deepEqual(createPlannerParameterEvidence(source), { valid: false, reason: "UNVERIFIED" });
  assert.equal(validatePlannerParameterEvidence({ status: "RESOLVED_WITH_EVIDENCE" }, source).valid, false);
});

test("fake click, copied JSON, matching digests and fixed-origin flags cannot compile", () => {
  const { source } = fixture();
  for (const altered of [source, structuredClone(source), { ...source, trusted: true },
    { ...source, confirmed: true }, { ...source, origin: "FIXED_USER_INPUT" }]) {
    assert.equal(isLiveConfirmedPlannerSource(altered), false);
    assert.equal(createPlannerParameterEvidence(altered).valid, false);
  }
  const forged = { status: "RESOLVED_WITH_EVIDENCE", version: 2, planId: plan.id, intents: resolution.intents,
    evidence: source.structuredInput.fields.map((field) => ({ ...field, origin: "FIXED_USER_INPUT" })), evidenceDigest: proposalDigest(source) };
  assert.deepEqual(compilePlannerStrategy({ version: 2, requestId: source.requestId, sessionId: source.sessionId,
    createdAt: 1, plan, resolution: forged, provenanceSource: source }), { status: "REJECTED", reason: "INVALID_PARAMETER_EVIDENCE" });
});

function proposalDigest(source: ReturnType<typeof fixture>["source"]) { return source.structuredInput.proposalDigest; }

test("substitution of request, session, proposal, goal, plan or candidate fails live pair validation", () => {
  const { proposal, host } = fixture();
  for (const changed of [{ ...host, requestId: "other" }, { ...host, sessionId: "other" },
    { ...host, proposalId: "other" }, { ...host, proposalDigest: `0x${"0".repeat(64)}` },
    { ...host, request: { ...request, text: "other" } }]) assert.equal(validatePlannerProposalHostPair(proposal, changed), undefined);
  for (const changed of [{ ...proposal, planId: "other" }, { ...proposal, planDigest: `0x${"0".repeat(64)}` },
    { ...proposal, goals: [{ ...proposal.goals[0], goalId: "other" }] },
    { ...proposal, goals: [{ ...proposal.goals[0], parameters: [{ ...proposal.goals[0].parameters[0], value: "usdc" }, ...proposal.goals[0].parameters.slice(1)] }] }])
    assert.equal(validatePlannerProposalHostPair(changed, host), undefined);
});

test("malformed, hidden and hostile runtime values never register authority", () => {
  const { source, proposal, host } = fixture();
  const symbol = { ...source }; Object.defineProperty(symbol, Symbol("hidden"), { value: true });
  const getter = { ...source }; Object.defineProperty(getter, "requestId", { get() { throw Error("getter"); } });
  const proxy = new Proxy(source, { getPrototypeOf() { throw Error("proxy"); } });
  for (const value of [null, undefined, [], 1, symbol, getter, proxy]) {
    assert.equal(isLiveConfirmedPlannerSource(value), false);
    assert.equal(createPlannerParameterEvidence(value).valid, false);
  }
  assert.equal(validatePlannerProposalHostPair({ ...proposal, trusted: true }, host), undefined);
  assert.equal(validatePlannerProposalHostPair({ ...proposal, origin: "FIXED_USER_INPUT" }, host), undefined);
});

test("production confirmation module exposes no test-only authority shortcut", async () => {
  const exports = Object.keys(await import("./plannerConfirmationAuthority.ts"));
  assert.deepEqual(exports.sort(), ["PlannerParameterConfirmControl", "isLiveConfirmedPlannerSource"].sort());
});
