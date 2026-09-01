import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createAgentActionDraft, routeAgentRequest, type AgentCapabilityId, type AgentOrchestrationDecision } from "./agent/orchestration.ts";
import { parseAgentRequest } from "./agent/parser.ts";
import type { AgentPlanningServices } from "./agent/planning.ts";
import { AGENT_CAPABILITIES, AGENT_EXECUTION_POLICY, runAgentCapability } from "./agent/tools.ts";
import type { AgentContextSnapshot, AgentIntent } from "./agent/types.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const now = 100_000;
const connected: AgentContextSnapshot = Object.freeze({ connected: true, account, verifiedChainId: 5_042_002, isArc: true, balances: Object.freeze({ usdc: 50_000_000n, eurc: 20_000_000n }), activity: Object.freeze([]), activityPartial: false, activityUnavailable: false, vault: Object.freeze({ available: true }), safetyCapabilities: Object.freeze([]), timestamp: now });
const context = (snapshot = connected, planningServices?: AgentPlanningServices) => Object.freeze({ snapshot, planningServices, now, binding: Object.freeze({ generation: 7, account: snapshot.account, chainId: snapshot.verifiedChainId }) });
const parse = (text: string, locale: "en" | "vi" = "en") => parseAgentRequest({ text, locale });

test("router deterministically separates informational, planning, preparation, and clarification modes", () => {
  assert.deepEqual([routeAgentRequest(parse("balance")).mode, routeAgentRequest(parse("How much would I get swapping 1 USDC to EURC?")).mode, routeAgentRequest(parse(`Send 1 USDC to ${recipient}`)).mode, routeAgentRequest(parse("Prepare a swap of USDC to EURC")).mode], ["informational", "planning", "preparation", "clarification"]);
  assert.equal(routeAgentRequest(parse("Swap 1 USDC sang EURC", "vi")).mode, "preparation");
});

test("capability registry is typed, asynchronous, permission-bounded, and execution-forbidden", async () => {
  assert.ok(AGENT_CAPABILITIES.length > 0);
  for (const capability of AGENT_CAPABILITIES) {
    assert.ok(capability.permission === "READ_ONLY" || capability.permission === "PREPARE_ONLY");
    assert.equal(capability.execution, AGENT_EXECUTION_POLICY);
    assert.equal(capability.run.constructor.name, "AsyncFunction");
  }
  assert.equal(AGENT_EXECUTION_POLICY, "EXECUTION_FORBIDDEN");
});

test("registry rejects unknown capabilities, mode mismatches, and invalid capability input", async () => {
  const intent = parse("balance");
  const routed = routeAgentRequest(intent);
  const unknown = { ...routed, capabilityId: "not_registered" as AgentCapabilityId };
  assert.equal((await runAgentCapability(context(), intent, unknown)).category, "NEEDS_CLARIFICATION");
  assert.equal((await runAgentCapability(context(), intent, { ...routed, mode: "preparation" })).category, "NEEDS_CLARIFICATION");
  const invalidIntent: AgentIntent = Object.freeze({ kind: "unknown", locale: "en" });
  assert.equal((await runAgentCapability(context(), invalidIntent, routed)).category, "NEEDS_CLARIFICATION");
});

test("fresh Send planning runs before a complete non-executable serializable draft", async () => {
  let planningCalls = 0;
  const services: AgentPlanningServices = { estimateSendMaximumFee: async () => { planningCalls++; return 1_000n; } };
  const intent = parse(`Prepare a send of 1 USDC to ${recipient}`);
  const decision = routeAgentRequest(intent);
  const output = await runAgentCapability(context(connected, services), intent, decision);
  const draft = createAgentActionDraft(intent, output.planning);
  assert.equal(planningCalls, 1);
  assert.equal(draft?.kind, "send");
  assert.equal(draft?.executionEnabled, false);
  assert.doesNotThrow(() => JSON.stringify(draft));
  const serialized = JSON.stringify(draft);
  for (const forbidden of ["signer", "walletClient", "connector", "privateKey", "approve", "sign", "submit", "execute", "sendTransaction"]) assert.equal(serialized.includes(forbidden), false);
});

test("preparation fails closed for disconnected wallets and wrong Arc network", async () => {
  const intent = parse(`Send 1 USDC to ${recipient}`), decision = routeAgentRequest(intent);
  const disconnected = Object.freeze({ ...connected, connected: false, account: undefined, isArc: false });
  assert.equal((await runAgentCapability(context(disconnected), intent, decision)).category, "WALLET_NOT_CONNECTED");
  const wrong = Object.freeze({ ...connected, verifiedChainId: 84_532, isArc: false });
  assert.equal((await runAgentCapability(context(wrong), intent, decision)).category, "WRONG_NETWORK");
});

test("parse-once hook passes only the typed intent through routing and capability execution", () => {
  const source = readFileSync(new URL("../hooks/useMakotoAgent.ts", import.meta.url), "utf8");
  assert.equal((source.match(/parseAgentRequest\(/g) ?? []).length, 1);
  assert.match(source, /const intent = parseAgentRequest\(request\);[\s\S]*routeAgentRequest\(intent\)[\s\S]*runAgentCapability\([^;]*intent, decision\)/);
  assert.doesNotMatch(source, /runAgentCapability\([^;]*value/);
});

test("draft creation requires fresh complete planning and rejects stale or blocked truth", () => {
  const intent = parse("Prepare a swap of 1 USDC to EURC");
  const ready = { kind: "swap-affordability", status: "ready", dataTimestamp: now, expiresAt: now + 30_000, refreshRequired: false, completeness: "complete", blockingReasons: [] } as const;
  assert.equal(createAgentActionDraft(intent), undefined);
  assert.equal(createAgentActionDraft(intent, { ...ready, refreshRequired: true }), undefined);
  assert.equal(createAgentActionDraft(intent, { ...ready, blockingReasons: ["insufficient-token-balance"] }), undefined);
  assert.equal(createAgentActionDraft(intent, ready)?.kind, "swap");
});

test("orchestration decisions and drafts remain frozen data-only values", () => {
  const decision: AgentOrchestrationDecision = routeAgentRequest(parse("recent transactions"));
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(typeof decision.capabilityId, "string");
  assert.equal("run" in decision, false);
});
