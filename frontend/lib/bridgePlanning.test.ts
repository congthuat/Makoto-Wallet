import assert from "node:assert/strict";
import test from "node:test";

import { requestBridgePlanningData, type BridgePlanningDataSource } from "./circle/bridgePlanning.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const now = 100_000;
const request = { account, connectedChainId: 5_042_002, sourceChainId: 5_042_002, destinationChainId: 84_532, amount: 1_000_000n, recipient: account, route: "cctp-direct-forwarding", now } as const;

function source(overrides: Partial<BridgePlanningDataSource> = {}): BridgePlanningDataSource {
  return {
    routeAvailable: async () => true,
    estimateBridge: async () => ({ quotedAt: now - 1_000, sourceDebit: 1_000_000n, expectedReceive: 998_000n, approvalAmount: 1_000_000n, fees: [
      { kind: "forwarding", amount: 2_000n, token: "USDC", chainId: 5_042_002 },
      { kind: "gas", token: "ETH", chainId: 84_532 },
    ] }),
    readSourceBalance: async () => 2_000_000n,
    readAllowance: async () => 1_000_000n,
    estimateApprovalGas: async () => 10n,
    simulateBurn: async () => "PASSED",
    ...overrides,
  };
}

test("bridge plan preserves route, provider estimate, explicit fee units, allowance, and simulation", async () => {
  const plan = await requestBridgePlanningData(request, source());
  assert.equal(plan.status, "READY");
  assert.equal(plan.completeness, "COMPLETE");
  assert.equal(plan.expectedReceive, 998_000n);
  assert.equal(plan.allowanceState, "SUFFICIENT");
  assert.deepEqual(plan.fees, [{ kind: "forwarding", amount: 2_000n, token: "USDC", chainId: 5_042_002 }, { kind: "gas", token: "ETH", chainId: 84_532 }]);
  assert.equal(Object.isFrozen(plan.fees), true);
});

test("bridge approval is exact and finite", async () => {
  const plan = await requestBridgePlanningData(request, source({ readAllowance: async () => 1n }));
  assert.equal(plan.requiredFiniteApproval, 1_000_000n);
  assert.equal(plan.allowanceState, "FINITE_APPROVAL_REQUIRED");
  assert.ok(plan.blockingReasons.includes("allowance-required"));
});

test("route and provider failures are unavailable without fabricated estimates", async () => {
  const route = await requestBridgePlanningData(request, source({ routeAvailable: async () => false }));
  assert.equal(route.status, "UNAVAILABLE");
  assert.equal(route.expectedReceive, undefined);
  assert.ok(route.blockingReasons.includes("route-unavailable"));
  const provider = await requestBridgePlanningData(request, source({ estimateBridge: async () => undefined }));
  assert.ok(provider.blockingReasons.includes("provider-unavailable"));
});

test("invalid route inputs stop before provider reads", async () => {
  let called = false;
  const plan = await requestBridgePlanningData({ ...request, recipient: "invalid", destinationChainId: 1 }, source({ routeAvailable: async () => { called = true; return true; } }));
  assert.equal(plan.status, "UNAVAILABLE");
  assert.equal(called, false);
  assert.ok(plan.blockingReasons.includes("invalid-recipient"));
  assert.ok(plan.blockingReasons.includes("unsupported-chain"));
});

test("partial estimates disclose allowance, gas, balance, and simulation gaps", async () => {
  const plan = await requestBridgePlanningData(request, source({ readSourceBalance: async () => undefined, readAllowance: async () => undefined, simulateBurn: undefined }));
  assert.equal(plan.completeness, "PARTIAL");
  assert.equal(plan.allowanceState, "ALLOWANCE_UNAVAILABLE");
  assert.equal(plan.burnSimulation, "UNAVAILABLE");
});

test("stale estimates, insufficient balance, and burn reverts are blocked", async () => {
  const plan = await requestBridgePlanningData(request, source({ estimateBridge: async () => ({ quotedAt: now - 45_001, sourceDebit: 1_000_000n, approvalAmount: 1_000_000n, fees: [] }), readSourceBalance: async () => 1n, simulateBurn: async () => "REVERTED" }));
  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.blockingReasons.includes("stale-quote"));
  assert.ok(plan.blockingReasons.includes("insufficient-token-balance"));
  assert.ok(plan.blockingReasons.includes("burn-simulation-failed"));
});

test("bridge planning output has no execution or completion authority", async () => {
  const plan = await requestBridgePlanningData(request, source());
  const keys: string[] = [];
  const visit = (value: unknown) => { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { keys.push(key); assert.notEqual(typeof child, "function"); visit(child); } };
  visit(plan);
  for (const forbidden of ["signer", "walletClient", "connector", "provider", "approve", "sign", "sendTransaction", "submit", "execute", "completed", "complete", "success"]) assert.equal(keys.includes(forbidden), false);
});
