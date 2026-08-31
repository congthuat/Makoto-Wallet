import assert from "node:assert/strict";
import test from "node:test";

import { calculateSwapAffordability, classifyPlanningFreshness, requestSwapPlanningData, type SwapPlanningDataSource } from "./swapPlanning.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const now = 100_000;
const feeEnvelope = { gasLimit: 10n, maxFeePerGas: 100n, rawMaxFee18: 1_000n, feeUsdc6: 2n, preparedAt: now, walletEstimateUsed: false } as const;

function source(overrides: Partial<SwapPlanningDataSource> = {}): SwapPlanningDataSource {
  return {
    readBalance: async (asset) => asset === "usdc" ? 2_000_000n : 1_000_000n,
    readQuote: async () => ({ amountOut: 900_000n, quotedAt: now - 1_000 }),
    readAllowance: async () => 1_000_000n,
    estimateApprovalGas: async () => 1_000_000_000_000n,
    estimateSwapGasEnvelope: async () => feeEnvelope,
    simulateApproval: async () => "PASSED",
    simulateSwap: async () => "PASSED",
    ...overrides,
  };
}

test("freshness has deterministic fresh, expiring, stale, and unavailable states", () => {
  assert.equal(classifyPlanningFreshness(now - 1_000, now), "FRESH");
  assert.equal(classifyPlanningFreshness(now - 40_000, now), "EXPIRING");
  assert.equal(classifyPlanningFreshness(now - 45_001, now), "STALE");
  assert.equal(classifyPlanningFreshness(now + 1, now), "UNAVAILABLE");
  assert.equal(classifyPlanningFreshness(undefined, now), "UNAVAILABLE");
});

test("swap plan exposes quote, minimum, route, finite allowance, fees, simulation, and exact USDC affordability", async () => {
  const plan = await requestSwapPlanningData({ account, inputAsset: "usdc", outputAsset: "eurc", inputAmount: 1_000_000n, slippage: 0.01, isArc: true, now }, source({ readAllowance: async () => 0n }));
  assert.equal(plan.expectedOutput, 900_000n);
  assert.equal(plan.minimumReceived, 891_000n);
  assert.equal(plan.requiredFiniteApproval, 1_000_000n);
  assert.equal(plan.allowanceState, "FINITE_APPROVAL_REQUIRED");
  assert.deepEqual(plan.affordability, { completeness: "COMPLETE", affordable: true, inputBalanceCovers: true, gasBalanceCovers: true, approvalFeeUsdc6: 1n, swapMaximumFeeUsdc6: 2n, totalRequiredUsdc6: 1_000_003n });
  assert.equal(plan.route, "xylonet");
  assert.equal(Object.isFrozen(plan), true);
});

test("EURC input and USDC gas affordability remain separate", async () => {
  const result = calculateSwapAffordability({ inputAsset: "eurc", inputAmount: 1_000_000n, inputBalance: 1_000_000n, usdcBalance: 2n, approvalRequired: false, swapMaximumFeeUsdc6: 2n, simulation: "PASSED" });
  assert.equal(result.totalRequiredUsdc6, 2n);
  assert.equal(result.affordable, true);
});

test("missing reads and simulations are partial or unavailable, never optimistic", async () => {
  const plan = await requestSwapPlanningData({ account, inputAsset: "usdc", outputAsset: "eurc", inputAmount: 1_000_000n, slippage: 0.005, isArc: true, now }, source({ readQuote: async () => undefined, readAllowance: async () => undefined, simulateSwap: undefined }));
  assert.equal(plan.status, "UNAVAILABLE");
  assert.equal(plan.affordability.affordable, undefined);
  assert.ok(plan.blockingReasons.includes("quote-unavailable"));
  assert.ok(plan.blockingReasons.includes("allowance-unavailable"));
});

test("insufficient balances, reverted simulation, and unavailable gas are explicit blockers", async () => {
  const plan = await requestSwapPlanningData({ account, inputAsset: "usdc", outputAsset: "eurc", inputAmount: 1_000_000n, slippage: 0.03, isArc: true, now }, source({ readBalance: async () => 1n, readAllowance: async () => 0n, estimateApprovalGas: async () => undefined, estimateSwapGasEnvelope: async () => undefined, simulateSwap: async () => "REVERTED" }));
  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.blockingReasons.includes("insufficient-token-balance"));
  assert.ok(plan.blockingReasons.includes("approval-gas-unavailable"));
  assert.ok(plan.blockingReasons.includes("swap-gas-unavailable"));
  assert.ok(plan.blockingReasons.includes("simulation-reverted"));
});

test("swap planning output cannot carry execution authority", async () => {
  const plan = await requestSwapPlanningData({ account, inputAsset: "usdc", outputAsset: "eurc", inputAmount: 1n, slippage: 0.005, isArc: true, now }, source());
  const serializedKeys: string[] = [];
  const visit = (value: unknown) => { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { serializedKeys.push(key); assert.notEqual(typeof child, "function"); visit(child); } };
  visit(plan);
  for (const forbidden of ["signer", "walletClient", "connector", "provider", "approve", "sign", "sendTransaction", "submit", "execute"]) assert.equal(serializedKeys.includes(forbidden), false);
});
