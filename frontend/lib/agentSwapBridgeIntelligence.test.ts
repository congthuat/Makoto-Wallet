import assert from "node:assert/strict";
import test from "node:test";

import { requestBridgePlanningData, type BridgePlanningDataSource } from "./circle/bridgePlanning.ts";
import { parseAgentRequest } from "./agent/parser.ts";
import { answerAgentRequest } from "./agent/planner.ts";
import { createAgentActionDraft, routeAgentRequest } from "./agent/orchestration.ts";
import { resolveAgentPlanning, type AgentPlanningServices } from "./agent/planning.ts";
import type { AgentContextSnapshot, AgentIntent } from "./agent/types.ts";
import { requestSwapPlanningData, type SwapPlanningDataSource } from "./swapPlanning.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const now = 100_000;
const snapshot: AgentContextSnapshot = Object.freeze({ connected: true, account, verifiedChainId: 5_042_002, isArc: true, balances: Object.freeze({ usdc: 50_000_000n, eurc: 40_000_000n }), activity: Object.freeze([]), activityPartial: false, activityUnavailable: false, vault: Object.freeze({ available: true }), safetyCapabilities: Object.freeze([]), timestamp: now });
const feeEnvelope = { gasLimit: 10n, maxFeePerGas: 100n, rawMaxFee18: 1_000n, feeUsdc6: 2n, preparedAt: now, walletEstimateUsed: false } as const;

function swapSource(overrides: Partial<SwapPlanningDataSource> = {}): SwapPlanningDataSource {
  return { readBalance: async (asset) => asset === "usdc" ? 50_000_000n : 40_000_000n, readQuote: async () => ({ amountOut: 18_420_000n, quotedAt: now - 1_000 }), readAllowance: async () => 50_000_000n, estimateApprovalGas: async () => 1_000_000_000_000n, estimateSwapGasEnvelope: async () => feeEnvelope, simulateApproval: async () => "PASSED", simulateSwap: async () => "PASSED", ...overrides };
}
function bridgeSource(overrides: Partial<BridgePlanningDataSource> = {}): BridgePlanningDataSource {
  return { routeAvailable: async () => true, estimateBridge: async () => ({ quotedAt: now - 1_000, sourceDebit: 10_002_000n, expectedReceive: 10_000_000n, approvalAmount: 10_002_000n, fees: [{ kind: "forwarding", amount: 2_000n, token: "USDC", chainId: 5_042_002 }, { kind: "gas", amount: 100_000_000_000_000n, token: "ETH", chainId: 84_532 }] }), readSourceBalance: async () => 50_000_000n, readAllowance: async () => 50_000_000n, estimateApprovalGas: async () => 10n, simulateBurn: async () => "PASSED", ...overrides };
}
function services(swapOverrides: Partial<SwapPlanningDataSource> = {}, bridgeOverrides: Partial<BridgePlanningDataSource> = {}): AgentPlanningServices {
  return { estimateSendMaximumFee: async () => undefined, planSwap: (request) => requestSwapPlanningData(request, swapSource(swapOverrides)), planBridge: (request) => requestBridgePlanningData(request, bridgeSource(bridgeOverrides)) };
}
function parse(text: string, locale: "en" | "vi" = "en", previousIntent?: AgentIntent) { return parseAgentRequest({ text, locale, previousIntent }); }
function format(intent: AgentIntent, planning: Awaited<ReturnType<typeof resolveAgentPlanning>>) {
  const decision = routeAgentRequest(intent);
  const result = planning ? { tool: intent.kind.replaceAll("-", "_"), ok: planning.status !== "unavailable", data: planning, partial: planning.completeness !== "complete" } : undefined;
  return answerAgentRequest(snapshot, intent, decision, { planning, result });
}

test("Swap quote questions are planning in English and Vietnamese", () => {
  assert.equal(parse("If I swap 20 USDC to EURC, how much will I receive?").kind, "swap-quote");
  assert.equal(parse("Swap 20 USDC sang EURC được bao nhiêu?", "vi").kind, "swap-quote");
});

test("conditional and affordability Swap questions never create drafts", () => {
  assert.equal(parse("If I swap 20 USDC to EURC, what happens?").kind, "swap-quote");
  assert.equal(parse("Can I swap 30 USDC to EURC?").kind, "swap-affordability");
});

test("explicit Swap and Bridge preparation remain data-only drafts", () => {
  const swap = parse("Prepare a swap of 20 USDC to EURC.");
  const bridge = parse("Set up a bridge of 10 USDC from Base to Arc.");
  assert.equal(swap.kind, "prepare-action"); assert.equal(routeAgentRequest(swap).mode, "preparation");
  assert.equal(bridge.kind, "prepare-action"); assert.equal(routeAgentRequest(bridge).mode, "preparation");
  const fresh = { kind: "swap-affordability", status: "ready", dataTimestamp: now, expiresAt: now + 30_000, refreshRequired: false, completeness: "complete", blockingReasons: [] } as const;
  assert.equal(createAgentActionDraft(swap, fresh)?.executionEnabled, false);
  assert.equal(createAgentActionDraft(bridge, { ...fresh, kind: "bridge-estimate" })?.executionEnabled, false);
});

test("Bridge fee and route questions parse in English and Vietnamese", () => {
  assert.equal(parse("How much will it cost to bridge 10 USDC to Arc?").kind, "bridge-estimate");
  assert.equal(parse("Bridge 10 USDC sang Arc tốn bao nhiêu?", "vi").kind, "bridge-estimate");
  assert.equal(parse("Is the Base to Arc bridge route available?").kind, "bridge-route");
});

test("safe Swap follow-ups reuse only the prior request context", () => {
  const prior = parse("If I swap 20 USDC to EURC, how much will I receive?");
  assert.equal(parse("What is the minimum I would receive?", "en", prior).kind, "swap-quote");
  assert.equal(parse("Do I need approval?", "en", prior).kind, "swap-allowance");
  const next = parse("What about 30 USDC?", "en", prior);
  assert.equal(next.kind, "swap-quote"); assert.equal(next.amount, "30");
});

test("fresh Swap quote keeps expected and minimum output distinct", async () => {
  const intent = parse("If I swap 20 USDC to EURC, how much will I receive?");
  const planning = await resolveAgentPlanning(snapshot, intent, services());
  assert.equal(planning?.swap?.expectedOutput, 18_420_000n);
  assert.equal(planning?.swap?.minimumReceived, 18_327_900n);
  const response = format(intent, planning);
  assert.match(response.text, /estimated 18\.42 EURC/); assert.match(response.text, /Minimum received: 18\.3279 EURC/); assert.match(response.text, /No transaction has been prepared/);
});

test("expiring, stale, and unavailable Swap quotes are truthful", async () => {
  const intent = parse("How much would I get if I swap 20 USDC to EURC?");
  const expiring = await resolveAgentPlanning(snapshot, intent, services({ readQuote: async () => ({ amountOut: 1n, quotedAt: now - 40_000 }) }));
  assert.equal(expiring?.swap?.freshness, "EXPIRING");
  const stale = await resolveAgentPlanning(snapshot, intent, services({ readQuote: async () => ({ amountOut: 1n, quotedAt: now - 45_001 }) }));
  assert.equal(stale?.swap?.freshness, "STALE"); assert.match(format(intent, stale).text, /quote expired/i);
  const unavailable = await resolveAgentPlanning(snapshot, intent, services({ readQuote: async () => undefined }));
  assert.equal(unavailable?.swap?.expectedOutput, undefined); assert.match(format(intent, unavailable).text, /quote is unavailable/i);
});

test("Swap allowance reports sufficient, finite required, and unavailable without approving", async () => {
  const intent = parse("Do I need approval for a swap of 20 USDC to EURC?");
  const sufficient = await resolveAgentPlanning(snapshot, intent, services()); assert.equal(sufficient?.swap?.allowanceState, "SUFFICIENT");
  const finite = await resolveAgentPlanning(snapshot, intent, services({ readAllowance: async () => 0n })); assert.equal(finite?.swap?.requiredFiniteApproval, 20_000_000n);
  const unavailable = await resolveAgentPlanning(snapshot, intent, services({ readAllowance: async () => undefined })); assert.equal(unavailable?.swap?.allowanceState, "ALLOWANCE_UNAVAILABLE");
});

test("USDC and EURC affordability stay fee-aware and fail closed", async () => {
  const usdc = await resolveAgentPlanning(snapshot, parse("Can I swap 20 USDC to EURC?"), services()); assert.equal(usdc?.swap?.affordability.affordable, true);
  const eurc = await resolveAgentPlanning(snapshot, parse("Can I swap 20 EURC to USDC?"), services()); assert.equal(eurc?.swap?.affordability.affordable, true);
  const missingGas = await resolveAgentPlanning(snapshot, parse("Can I swap 20 USDC to EURC?"), services({ estimateSwapGasEnvelope: async () => undefined })); assert.equal(missingGas?.swap?.affordability.affordable, undefined);
  const reverted = await resolveAgentPlanning(snapshot, parse("Can I swap 20 USDC to EURC?"), services({ simulateSwap: async () => "REVERTED" })); assert.equal(reverted?.status, "blocked");
});

test("Bridge estimate preserves fees by token and chain", async () => {
  const intent = parse("How much will it cost to bridge 10 USDC from Arc to Base?");
  const planning = await resolveAgentPlanning(snapshot, intent, services());
  assert.equal(planning?.bridge?.expectedReceive, 10_000_000n);
  assert.deepEqual(planning?.bridge?.fees.map((fee) => [fee.token, fee.chainId]), [["USDC", 5_042_002], ["ETH", 84_532]]);
  const response = format(intent, planning);
  assert.match(response.text, /Forwarding fee: 0\.002 USDC .* network 5042002/); assert.match(response.text, /Network fee: 0\.0001 ETH .* network 84532/); assert.doesNotMatch(response.text, /total.*ETH.*USDC/i);
});

test("Bridge route, provider, unsupported chain, and invalid recipient remain structured", async () => {
  const route = parse("Can I bridge from Base to Arc?");
  const available = await resolveAgentPlanning(snapshot, route, services()); assert.equal(available?.bridge?.routeAvailable, true);
  const unavailable = await resolveAgentPlanning(snapshot, route, services({}, { routeAvailable: async () => false })); assert.ok(unavailable?.bridge?.blockingReasons.includes("route-unavailable"));
  const provider = await resolveAgentPlanning(snapshot, route, services({}, { estimateBridge: async () => undefined })); assert.ok(provider?.bridge?.blockingReasons.includes("provider-unavailable"));
  const unsupported = await resolveAgentPlanning(snapshot, { ...route, sourceChainId: 1 }, services()); assert.ok(unsupported?.bridge?.blockingReasons.includes("unsupported-chain"));
  const invalid = await services().planBridge({ account, connectedChainId: 5_042_002, sourceChainId: 5_042_002, destinationChainId: 84_532, amount: 1n, recipient: "invalid", route: "cctp-direct-forwarding", now }); assert.ok(invalid.blockingReasons.includes("invalid-recipient"));
});

test("bridge completion remains deferred and source burn is never completion", async () => {
  const text = "Has my bridge completed?", intent = parse(text), planning = await resolveAgentPlanning(snapshot, intent, services());
  const response = format(intent, planning);
  assert.equal(intent.kind, "bridge-completion"); assert.match(response.text, /destination-chain transaction evidence/); assert.match(response.text, /does not prove completion/);
});

test("Agent intelligence results contain no execution authority", async () => {
  const plans = [await resolveAgentPlanning(snapshot, parse("Can I swap 20 USDC to EURC?"), services()), await resolveAgentPlanning(snapshot, parse("Can I bridge from Base to Arc?"), services())];
  const keys: string[] = [];
  const visit = (value: unknown) => { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { keys.push(key); assert.notEqual(typeof child, "function"); visit(child); } };
  plans.forEach(visit);
  for (const forbidden of ["signer", "walletClient", "connector", "provider", "approve", "sign", "sendTransaction", "submit", "execute"]) assert.equal(keys.includes(forbidden), false);
});
