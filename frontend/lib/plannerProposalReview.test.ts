import assert from "node:assert/strict";
import test from "node:test";
import { createPlannerProposal, validatePlannerProposal, acceptPlannerProposalResponse, createPlannerProposalHostSource, validatePlannerProposalHostPair } from "./plannerProposal.ts";
import { plannerParameterRequestDigest } from "./plannerParameterEvidence.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const request = { text: `Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`, locale: "en" };
const plan = { version: 1, id: "review-plan", classification: "STRATEGY", goals: [
  { id: "send", kind: "SEND", dependsOn: ["swap"] }, { id: "swap", kind: "SWAP", dependsOn: [] },
] };
const resolution = { status: "RESOLVED", planId: "review-plan", intents: [
  { version: 1, id: "send", kind: "SEND", chainId: 5042002, asset: "eurc", amount: "5", recipient },
  { version: 1, id: "swap", kind: "SWAP", chainId: 5042002, fromAsset: "usdc", toAsset: "eurc", amount: "10" },
] };
const source = { requestId: "request-1", sessionId: "session-1", proposalId: "proposal-1", request, plan, resolution };

test("goal and dependency array ordering cannot change canonical content identity", () => {
  const first = createPlannerProposal(source);
  const reordered = createPlannerProposal({ ...source, plan: { ...plan, goals: [...plan.goals].reverse() }, resolution: { ...resolution, intents: [...resolution.intents].reverse() } });
  assert.ok(first); assert.ok(reordered);
  assert.deepEqual(first, reordered);
  assert.equal(first.proposalDigest, reordered.proposalDigest);
});

test("plain object property insertion order cannot change request or proposal validation", () => {
  const alternateRequest = { locale: "en", text: request.text };
  const proposal = createPlannerProposal({ ...source, request: alternateRequest });
  assert.ok(proposal);
  const reordered = Object.fromEntries(Object.entries({ ...proposal, goals: proposal.goals.map((goal) =>
    Object.fromEntries(Object.entries({ ...goal, parameters: goal.parameters.map((field) => Object.fromEntries(Object.entries(field).reverse())) }).reverse())) }).reverse());
  assert.ok(validatePlannerProposal(reordered));
  assert.ok(acceptPlannerProposalResponse(reordered, source.sessionId, alternateRequest));
  assert.equal(plannerParameterRequestDigest(source.requestId, source.sessionId, alternateRequest), proposal.requestDigest);
});

test("accepted proposal is deeply immutable for live host retention", () => {
  const proposal = createPlannerProposal(source);
  assert.ok(proposal);
  const accepted = acceptPlannerProposalResponse(proposal, source.sessionId, request);
  assert.ok(accepted);
  assert.ok(Object.isFrozen(accepted));
  assert.ok(Object.isFrozen(accepted.goals));
  assert.ok(Object.isFrozen(accepted.goals[0]));
  assert.ok(Object.isFrozen(accepted.goals[0].parameters));
  assert.ok(Object.isFrozen(accepted.goals[0].parameters[0]));
  const retained = createPlannerProposalHostSource(accepted, source.sessionId, request);
  assert.ok(retained);
  assert.deepEqual(retained.request, request);
  assert.equal(retained.proposalDigest, accepted.proposalDigest);
  assert.ok(Object.isFrozen(retained)); assert.ok(Object.isFrozen(retained.request));
  assert.ok(validatePlannerProposalHostPair(accepted, retained));
  assert.equal(validatePlannerProposalHostPair(accepted, { ...retained, proposalId: "legacy-draft" }), undefined);
  assert.equal(validatePlannerProposalHostPair(accepted, { ...retained, request: { ...retained.request, locale: "vi" } }), undefined);
  assert.equal(createPlannerProposalHostSource(accepted, source.sessionId, { text: request.text, locale: "vi" }), undefined);
});

test("malformed nested values and substituted identifiers fail closed", () => {
  const proposal = createPlannerProposal(source);
  assert.ok(proposal);
  for (const value of [null, undefined, [], 4, { ...proposal, goals: [null] },
    { ...proposal, goals: [{ ...proposal.goals[0], dependsOn: ["unknown"] }, proposal.goals[1]] },
    { ...proposal, requestId: "bad id" }, { ...proposal, requestDigest: "0xdead" },
    { ...proposal, goals: [{ ...proposal.goals[0], parameters: [null] }, proposal.goals[1]] }]) {
    assert.equal(validatePlannerProposal(value), undefined);
  }
  assert.equal(createPlannerProposal({ ...source, plan: { ...plan, goals: [plan.goals[0], plan.goals[0]] } }), undefined);
  assert.equal(createPlannerProposal({ ...source, resolution: { ...resolution, secret: "provider" } }), undefined);
  assert.equal(acceptPlannerProposalResponse(proposal, "other-session", request), undefined);
  assert.equal(acceptPlannerProposalResponse(proposal, source.sessionId, { text: request.text, locale: "vi" }), undefined);
});

test("partial clarification does not resurrect raw candidates or default missing fields", () => {
  const partial = createPlannerProposal({ ...source, resolution: { status: "NEEDS_CLARIFICATION", issues: [{ goalId: "send", field: "recipient", code: "MISSING" }] } });
  assert.ok(partial);
  assert.equal(partial.resolutionStatus, "NEEDS_CLARIFICATION");
  assert.ok(partial.goals.every((goal) => goal.parameters.every((item) => item.state === "UNRESOLVED")));
  assert.doesNotMatch(JSON.stringify(partial.goals), /"value"|FIXED_USER_INPUT/);
});

test("meaningful request, plan, field and resolution changes alter provenance", () => {
  const baseline = createPlannerProposal(source);
  assert.ok(baseline);
  const send = resolution.intents[0], swap = resolution.intents[1];
  const cases = [
    { ...source, request: { ...request, text: `${request.text} please` } },
    { ...source, request: { ...request, locale: "vi" } },
    { ...source, plan: { ...plan, id: "review-plan-2" }, resolution: { ...resolution, planId: "review-plan-2" } },
    { ...source, plan: { ...plan, goals: [{ ...plan.goals[0], dependsOn: [] }, { ...plan.goals[1], dependsOn: ["send"] }] } },
    { ...source, resolution: { ...resolution, intents: [{ ...send, amount: "6" }, swap] } },
    { ...source, resolution: { ...resolution, intents: [{ ...send, recipient: "0x2222222222222222222222222222222222222222" }, swap] } },
    { ...source, resolution: { ...resolution, intents: [{ ...send, asset: "usdc" }, swap] } },
    { ...source, resolution: { status: "NEEDS_CLARIFICATION", issues: [{ goalId: "send", field: "amount", code: "MISSING" }] } },
  ];
  for (const changed of cases) {
    const next = createPlannerProposal(changed);
    assert.ok(next);
    assert.notEqual(next.proposalDigest, baseline.proposalDigest);
  }
  assert.equal(createPlannerProposal({ ...source, resolution: { ...resolution, intents: [{ ...send, chainId: 1 }, swap] } }), undefined);
});
