import assert from "node:assert/strict";
import test from "node:test";
import { validatePlannerIntent } from "./plannerIntent.ts";
import { resolvePlannerParameters, type PlannerParameterResolver } from "./plannerParameterResolver.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const swap = { id: "swap", kind: "SWAP", dependsOn: [] };
const send = { id: "send", kind: "SEND", dependsOn: ["swap"] };
const sendPlan = { version: 1, id: "send-plan", classification: "ACTION", goals: [{ ...send, dependsOn: [] }] };
const swapPlan = { version: 1, id: "swap-plan", classification: "ACTION", goals: [swap] };
const strategy = { version: 1, id: "strategy-plan", classification: "STRATEGY", goals: [send, swap] };
const bridgePlan = { version: 1, id: "bridge-plan", classification: "ACTION", goals: [{ id: "bridge", kind: "BRIDGE", dependsOn: [] }] };
const draft = (goalId: string, values: Record<string, unknown> = {}) => ({ goalId, chain: null, asset: null, amount: null, recipient: null, fromAsset: null, toAsset: null, sourceChain: null, destinationChain: null, ...values });
const provider = (...resolutions: unknown[]): PlannerParameterResolver => ({ resolve: async () => ({ resolutions }) });
const run = (text: string, plan: unknown, ...resolutions: unknown[]) => resolvePlannerParameters({ text }, plan, provider(...resolutions));

test("SEND uses canonical registry casing, Arc-only default, and the original goal ID", async () => {
  const result = await run(`Send 10 USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "10", recipient }));
  assert.equal(result.status, "RESOLVED");
  if (result.status !== "RESOLVED") return;
  assert.equal(result.planId, "send-plan");
  assert.deepEqual(result.intents, [{ version: 1, id: "send", kind: "SEND", chainId: 5042002, asset: "usdc", amount: "10", recipient }]);
  assert.equal(validatePlannerIntent(result.intents[0]).valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("missing SEND recipient asks for clarification without inventing a wallet address", async () => {
  const result = await run("Send 10 USDC", sendPlan, draft("send", { asset: "USDC", amount: "10" }));
  assert.equal(result.status, "NEEDS_CLARIFICATION");
  if (result.status === "NEEDS_CLARIFICATION") assert.deepEqual(result.issues, [{ goalId: "send", field: "recipient", code: "MISSING" }]);
});

test("SWAP resolves one user goal without approval and defaults its sole supported chain", async () => {
  const result = await run("Swap 10 USDC to EURC", swapPlan, draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }));
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.deepEqual(result.intents, [{ version: 1, id: "swap", kind: "SWAP", chainId: 5042002, fromAsset: "usdc", toAsset: "eurc", amount: "10" }]);
    assert.equal(validatePlannerIntent(result.intents[0]).valid, true);
  }
});

test("single supported opposite swap asset may be inferred from a known registered asset", async () => {
  const result = await run("Swap 10 USDC", swapPlan, draft("swap", { fromAsset: "USDC", amount: "10" }));
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED" && result.intents[0].kind === "SWAP") assert.equal(result.intents[0].toAsset, "eurc");
});

test("STRATEGY resolves each goal by ID and leaves the input graph unchanged", async () => {
  const before = JSON.parse(JSON.stringify(strategy));
  const result = await run(`Swap 10 USDC to EURC, then send 5 EURC to ${recipient}`, strategy,
    draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }),
    draft("send", { asset: "EURC", amount: "5", recipient }));
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.deepEqual(result.intents.map((intent) => intent.id), ["send", "swap"]);
    assert.ok(result.intents.every((intent) => validatePlannerIntent(intent).valid));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
  assert.deepEqual(strategy, before);
  assert.deepEqual(strategy.goals[0].dependsOn, ["swap"]);
});

test("BRIDGE defaults only its sole supported route and asset and validates recipient", async () => {
  const result = await run(`Bridge 10 USDC from Arc Testnet to Base Sepolia to ${recipient}`, bridgePlan, draft("bridge", { amount: "10", recipient }));
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.deepEqual(result.intents, [{ version: 1, id: "bridge", kind: "BRIDGE", sourceChainId: 5042002, destinationChainId: 84532, asset: "usdc", amount: "10", recipient }]);
    assert.equal(validatePlannerIntent(result.intents[0]).valid, true);
  }
});

test("explicit supported chain names canonicalize; unsupported chains and bridge routes do not", async () => {
  assert.equal((await run(`Send 10 USDC on Arc Testnet to ${recipient}`, sendPlan, draft("send", { chain: "Arc Testnet", asset: "USDC", amount: "10", recipient }))).status, "RESOLVED");
  assert.equal((await run(`Send 10 USDC on Ethereum to ${recipient}`, sendPlan, draft("send", { chain: "Ethereum", asset: "USDC", amount: "10", recipient }))).status, "INVALID_PARAMETERS");
  assert.equal((await run(`Bridge 10 USDC from Arc Testnet to Ethereum to ${recipient}`, bridgePlan, draft("bridge", { sourceChain: "Arc Testnet", destinationChain: "Ethereum", asset: "USDC", amount: "10", recipient }))).status, "INVALID_PARAMETERS");
});

test("unsupported assets, pair, explicit address, and malformed amounts stay invalid", async () => {
  const cases = [
    ["Swap 10 DAI to EURC", swapPlan, draft("swap", { fromAsset: "DAI", toAsset: "EURC", amount: "10" })],
    ["Swap 10 USDC to USDC", swapPlan, draft("swap", { fromAsset: "USDC", toAsset: "USDC", amount: "10" })],
    ["Send 10 USDC to 0x123", sendPlan, draft("send", { asset: "USDC", amount: "10", recipient: "0x123" })],
    [`Send 0 USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "0", recipient })],
    [`Send 1.1234567 USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "1.1234567", recipient })],
  ] as const;
  for (const [text, plan, candidate] of cases) assert.equal((await run(text, plan, candidate)).status, "INVALID_PARAMETERS");
});

test("model cannot silently substitute a supported asset or recipient not present in text", async () => {
  assert.equal((await run("Swap 10 DAI to EURC", swapPlan, draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }))).status, "INVALID_PARAMETERS");
  assert.equal((await run(`Send 10 USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "10", recipient: "0x2222222222222222222222222222222222222222" }))).status, "INVALID_PARAMETERS");
});

test("omitted provider asset fields cannot erase explicit unsupported or contradictory tokens", async () => {
  assert.equal((await run(`Send 10 DAI to ${recipient}`, sendPlan, draft("send", { amount: "10", recipient }))).status, "INVALID_PARAMETERS");
  assert.equal((await run("Swap 10 DAI to EURC", swapPlan, draft("swap", { amount: "10", toAsset: "EURC" }))).status, "INVALID_PARAMETERS");
  assert.equal((await run("Swap 10 USDC to USDC", swapPlan, draft("swap", { amount: "10", fromAsset: "USDC" }))).status, "INVALID_PARAMETERS");
  assert.equal((await run(`Bridge 10 DAI from Arc Testnet to Base Sepolia to ${recipient}`, bridgePlan, draft("bridge", { amount: "10", recipient }))).status, "INVALID_PARAMETERS");
});

test("dynamic and cross-goal runtime amounts need clarification even if provider invents a decimal", async () => {
  assert.equal((await run(`Send half my USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "10", recipient }))).status, "NEEDS_CLARIFICATION");
  assert.equal((await run(`Send max USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "1", recipient }))).status, "NEEDS_CLARIFICATION");
  assert.equal((await run(`Send half my USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "half", recipient }))).status, "NEEDS_CLARIFICATION");
  const result = await run(`Swap 10 USDC to EURC, then send all the EURC I receive to ${recipient}`, strategy,
    draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }), draft("send", { asset: "EURC", amount: "5", recipient }));
  assert.equal(result.status, "NEEDS_CLARIFICATION");
});

test("a null provider recipient cannot hide an explicitly malformed address", async () => {
  assert.equal((await run("Send 10 USDC to 0x123", sendPlan, draft("send", { asset: "USDC", amount: "10" }))).status, "INVALID_PARAMETERS");
});

test("a single unresolved goal prevents the whole plan from being RESOLVED", async () => {
  const result = await run("Swap 10 USDC to EURC, then send 5 EURC", strategy,
    draft("swap", { fromAsset: "USDC", toAsset: "EURC", amount: "10" }), draft("send", { asset: "EURC", amount: "5" }));
  assert.equal(result.status, "NEEDS_CLARIFICATION");
  assert.equal(Object.hasOwn(result, "intents"), false);
});

test("provider cannot add, omit, or duplicate goal IDs or smuggle authority fields", async () => {
  for (const payload of [
    { resolutions: [draft("unknown", { fromAsset: "USDC", toAsset: "EURC", amount: "10" })] },
    { resolutions: [] },
    { resolutions: [draft("swap"), draft("swap")] },
    { resolutions: [draft("swap", { signer: true })] },
    { resolutions: [draft("swap")], privateKey: "forbidden" },
  ]) assert.equal((await resolvePlannerParameters({ text: "Swap 10 USDC to EURC" }, swapPlan, { resolve: async () => payload })).status, "PROVIDER_ERROR");
});

test("provider cannot mutate the 11C plan graph passed for extraction", async () => {
  const before = JSON.parse(JSON.stringify(strategy));
  const result = await resolvePlannerParameters({ text: "Swap 10 USDC to EURC, then send 5 EURC" }, strategy, {
    resolve: async (request) => {
      (request.plan.goals[0].dependsOn as string[]).push("new-edge");
      return { resolutions: [] };
    },
  });
  assert.equal(result.status, "PROVIDER_ERROR");
  assert.deepEqual(strategy, before);
});

test("contradictory behavioral fields and invalid plan/text stop safely", async () => {
  assert.equal((await run(`Send 10 USDC to ${recipient}`, sendPlan, draft("send", { asset: "USDC", amount: "10", recipient, fromAsset: "USDC" }))).status, "INVALID_PARAMETERS");
  let calls = 0;
  const resolver: PlannerParameterResolver = { resolve: async () => { calls++; return {}; } };
  assert.equal((await resolvePlannerParameters({ text: "swap" }, { ...swapPlan, goals: [{ ...swap, kind: "APPROVE" }] }, resolver)).status, "INVALID_PLAN");
  assert.equal((await resolvePlannerParameters({ text: "" }, swapPlan, resolver)).status, "INVALID_PARAMETERS");
  assert.equal(calls, 0);
});

test("technical provider failure cannot fabricate resolved intents", async () => {
  assert.deepEqual(await resolvePlannerParameters({ text: "swap" }, swapPlan, { resolve: async () => { throw Error("provider details"); } }), { status: "PROVIDER_ERROR" });
  assert.deepEqual(await resolvePlannerParameters({ text: "swap" }, swapPlan, { resolve: async () => null }), { status: "PROVIDER_ERROR" });
});
