import assert from "node:assert/strict";
import test from "node:test";
import { runPlannerProposal } from "./plannerProposalPipeline.ts";
import { acceptPlannerProposalResponse, createPlannerProposal, validatePlannerProposal } from "./plannerProposal.ts";
import { plannerParameterRequestDigest } from "./plannerParameterEvidence.ts";
import { createAgentRequestGeneration } from "./agent/sessionContext.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const draft = (goalId: string, values: Record<string, unknown> = {}) => ({ goalId, chain: null, asset: null, amount: null, recipient: null, fromAsset: null, toAsset: null, sourceChain: null, destinationChain: null, ...values });
const fixtures = {
  send: { text: `Send 10 USDC to ${recipient}`, category: "ACTION", plan: { version: 1, id: "send-plan", classification: "ACTION", goals: [{ id: "send", kind: "SEND", dependsOn: [] }] }, candidates: [draft("send", { asset: "USDC", amount: "10", recipient })] },
  swap: { text: "Swap 10 USDC to EURC", category: "ACTION", plan: { version: 1, id: "swap-plan", classification: "ACTION", goals: [{ id: "swap", kind: "SWAP", dependsOn: [] }] }, candidates: [draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" })] },
  bridge: { text: `Bridge 10 USDC from Arc Testnet to Base Sepolia to ${recipient}`, category: "ACTION", plan: { version: 1, id: "bridge-plan", classification: "ACTION", goals: [{ id: "bridge", kind: "BRIDGE", dependsOn: [] }] }, candidates: [draft("bridge", { amount: "10", recipient })] },
  multi: { text: `Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`, category: "STRATEGY", plan: { version: 1, id: "multi-plan", classification: "STRATEGY", goals: [{ id: "send", kind: "SEND", dependsOn: ["swap"] }, { id: "swap", kind: "SWAP", dependsOn: [] }] }, candidates: [draft("send", { asset: "EURC", amount: "5", recipient }), draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" })] },
} as const;

async function run(fixture: { text: string; category: string; plan: unknown; candidates: readonly unknown[] }, overrides: Record<string, unknown> = {}) {
  let id = 0;
  const services = { classifier: { classify: async () => overrides.classification ?? { status: "CLASSIFIED", category: fixture.category } },
    generator: { generate: async () => overrides.plan ?? fixture.plan }, resolver: { resolve: async () => overrides.resolver ?? { resolutions: fixture.candidates } },
    newId: () => `server-${++id}` };
  return runPlannerProposal({ text: fixture.text, locale: "en", sessionId: "session-1" }, services);
}

for (const [name, fixture] of Object.entries(fixtures)) test(`${name} proposal preserves canonical identity and parameters`, async () => {
  const result = await run(fixture);
  assert.equal(result.status, "PROPOSAL");
  if (result.status !== "PROPOSAL") return;
  const p = result.proposal;
  assert.equal(p.version, 1); assert.equal(p.executionEnabled, false);
  assert.equal(p.requestId, "server-1"); assert.equal(p.proposalId, "server-2"); assert.equal(p.sessionId, "session-1");
  assert.equal(p.requestDigest, plannerParameterRequestDigest("server-1", "session-1", { text: fixture.text, locale: "en" }));
  assert.equal(p.planId, fixture.plan.id); assert.equal(p.goals.length, fixture.plan.goals.length);
  assert.equal(p.resolutionStatus, "RESOLVED"); assert.ok(p.planDigest); assert.ok(p.resolutionDigest); assert.ok(p.proposalDigest);
  assert.ok(p.goals.every((goal) => goal.parameters.every((field) => field.state === "FIXED_CANDIDATE" && field.origin === "UNVERIFIED_PROVIDER")));
  assert.deepEqual(validatePlannerProposal(JSON.parse(JSON.stringify(p))), p);
  assert.deepEqual(acceptPlannerProposalResponse(p, "session-1", { text: fixture.text, locale: "en" }), p);
  assert.equal(acceptPlannerProposalResponse(p, "session-2", { text: fixture.text, locale: "en" }), undefined);
  assert.equal(acceptPlannerProposalResponse(p, "session-1", { text: "different", locale: "en" }), undefined);
  assert.doesNotMatch(JSON.stringify(p), /FIXED_USER_INPUT|Strategy|wallet|signer|prepared|policy|calldata|secret/);
  if (name === "multi") assert.deepEqual(p.goals.find((goal) => goal.goalId === "send")?.dependsOn, ["swap"]);
});

for (const text of [`Swap 10 USDC to EURC, then send 50% of previous output to ${recipient}`, `Swap 10 USDC to EURC, then send all EURC received to ${recipient}`, `Swap 10 USDC to EURC, then send amount from receipt to ${recipient}`, `Swap 10 USDC to EURC, then send amount from previous transaction to ${recipient}`]) test(`dynamic amount remains unresolved: ${text.slice(0, 55)}`, async () => {
  const fixture = { ...fixtures.multi, text, candidates: [draft("send", { asset: "EURC", amount: "10", recipient }), draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" })] };
  const result = await run(fixture);
  assert.equal(result.status, "PROPOSAL");
  if (result.status !== "PROPOSAL") return;
  const amount = result.proposal.goals.find((goal) => goal.goalId === "send")?.parameters.find((field) => field.key === "amount");
  assert.equal(amount?.state, "UNRESOLVED"); assert.doesNotMatch(JSON.stringify(amount), /"value":"10"/);
});

test("stage failures and malformed requests fail closed", async () => {
  assert.equal((await run(fixtures.send, { classification: { status: "CLASSIFIED", category: "ACTION", secret: "x" } })).status, "CLASSIFICATION_INVALID_OUTPUT");
  assert.equal((await run(fixtures.send, { plan: { ...fixtures.send.plan, version: 2 } })).status, "PLAN_UNSUPPORTED_VERSION");
  assert.equal((await run(fixtures.send, { resolver: { resolutions: [draft("wrong")] } })).status, "PARAMETERS_PROVIDER_UNAVAILABLE");
  assert.equal((await run(fixtures.send, { resolver: { resolutions: [draft("send", { amount: "1000", asset: "USDC", recipient })] } })).status, "PARAMETERS_INVALID");
  const base = { classifier: { classify: async () => { throw Error("offline"); } }, generator: { generate: async () => fixtures.send.plan }, resolver: { resolve: async () => ({ resolutions: [] }) }, newId: () => "id" };
  assert.equal((await runPlannerProposal({ text: fixtures.send.text, locale: "en", sessionId: "bad session" }, base)).status, "INVALID_REQUEST");
  assert.equal((await runPlannerProposal({ text: fixtures.send.text, locale: "en", sessionId: "session", requestId: "injected" }, base)).status, "INVALID_REQUEST");
  assert.equal((await runPlannerProposal({ text: fixtures.send.text, locale: "en", sessionId: "session" }, base)).status, "PROPOSAL_FAILED");
});

test("proposal validation rejects mutation, unexpected fields, symbols, getters and proxies", async () => {
  const result = await run(fixtures.send);
  assert.equal(result.status, "PROPOSAL"); if (result.status !== "PROPOSAL") return;
  const p = result.proposal;
  for (const changed of [{ ...p, sessionId: "other" }, { ...p, goals: [{ ...p.goals[0], goalId: "other" }] }, { ...p, extra: true }]) assert.equal(validatePlannerProposal(changed), undefined);
  assert.equal(validatePlannerProposal({ ...p, [Symbol("x")]: true }), undefined);
  assert.equal(validatePlannerProposal(Object.defineProperty({ ...p }, "proposalId", { get() { throw Error("getter"); } })), undefined);
  assert.equal(validatePlannerProposal(new Proxy(p, { ownKeys() { throw Error("proxy"); } })), undefined);
  assert.equal(createPlannerProposal({}), undefined);
});

test("a late response cannot replace a newer live request generation", async () => {
  const generation = createAgentRequestGeneration();
  generation.invalidate(); const requestA = generation.capture();
  generation.invalidate(); const requestB = generation.capture();
  const resultB = await run(fixtures.swap), resultA = await run(fixtures.send);
  assert.equal(resultA.status, "PROPOSAL"); assert.equal(resultB.status, "PROPOSAL");
  assert.equal(generation.isCurrent(requestB), true); assert.equal(generation.isCurrent(requestA), false);
  if (resultA.status === "PROPOSAL" && resultB.status === "PROPOSAL") {
    assert.ok(acceptPlannerProposalResponse(resultB.proposal, "session-1", { text: fixtures.swap.text, locale: "en" }));
    assert.equal(generation.isCurrent(requestA) && Boolean(acceptPlannerProposalResponse(resultA.proposal, "session-1", { text: fixtures.send.text, locale: "en" })), false);
  }
});

test("new proposal identity changes on replanning", async () => {
  const first = await run(fixtures.multi);
  const second = await run({ ...fixtures.multi, plan: { ...fixtures.multi.plan, id: "replanned", goals: [{ id: "send", kind: "SEND", dependsOn: ["swap"] }, { id: "swap", kind: "SWAP", dependsOn: [] }] } });
  assert.equal(first.status, "PROPOSAL"); assert.equal(second.status, "PROPOSAL");
  if (first.status === "PROPOSAL" && second.status === "PROPOSAL") {
    assert.notEqual(first.proposal.planDigest, second.proposal.planDigest);
    assert.notEqual(first.proposal.proposalDigest, second.proposal.proposalDigest);
  }
});

test("hostile provider values fail closed at each stage without an uncaught route error", async () => {
  const hostile = new Proxy({}, { getPrototypeOf() { throw Error("hostile proxy"); } });
  assert.equal((await run(fixtures.send, { classification: hostile })).status, "CLASSIFICATION_INVALID_OUTPUT");
  assert.equal((await run(fixtures.send, { plan: hostile })).status, "PLAN_INVALID");
  assert.equal((await run(fixtures.send, { resolver: hostile })).status, "PARAMETERS_INVALID");
});

test("the same accepted request and validated plan reach every provider stage", async () => {
  const seen: unknown[] = [];
  let id = 0;
  const result = await runPlannerProposal({ text: `  ${fixtures.send.text}  `, locale: "en", sessionId: "session-1" }, {
    classifier: { classify: async (value) => { seen.push(value); return { status: "CLASSIFIED", category: "ACTION" }; } },
    generator: { generate: async (value) => { seen.push(value); return fixtures.send.plan; } },
    resolver: { resolve: async (value) => { seen.push(value); return { resolutions: fixtures.send.candidates }; } },
    newId: () => `server-${++id}`,
  });
  assert.equal(result.status, "PROPOSAL");
  assert.equal(seen.length, 3);
  assert.ok(seen.every((stage) => (stage as { text: string; locale: string }).text === fixtures.send.text && (stage as { locale: string }).locale === "en"));
  assert.deepEqual((seen[2] as { plan: unknown }).plan, fixtures.send.plan);
  assert.equal((await run(fixtures.send, { plan: { ...fixtures.send.plan, classification: "STRATEGY" } })).status, "PLAN_INVALID");
});

test("a provider-owned plan cannot change its dependency graph during resolution", async () => {
  const providerPlan = JSON.parse(JSON.stringify(fixtures.multi.plan));
  let id = 0;
  const result = await runPlannerProposal({ text: fixtures.multi.text, locale: "en", sessionId: "session-1" }, {
    classifier: { classify: async () => ({ status: "CLASSIFIED", category: "STRATEGY" }) },
    generator: { generate: async () => providerPlan },
    resolver: { resolve: async () => {
      providerPlan.goals[0].dependsOn = [];
      providerPlan.goals[1].dependsOn = ["send"];
      return { resolutions: fixtures.multi.candidates };
    } },
    newId: () => `server-${++id}`,
  });
  assert.equal(result.status, "PROPOSAL");
  if (result.status === "PROPOSAL") assert.deepEqual(result.proposal.goals.find((goal) => goal.goalId === "send")?.dependsOn, ["swap"]);
});
