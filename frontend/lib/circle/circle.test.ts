import assert from "node:assert/strict";
import test from "node:test";
import { circleCapabilities, ARC_DOMAIN, GATEWAY_WALLET } from "./appKit.ts";
import { canAdvanceBridge } from "./bridge.ts";
import { normalizeCircleBalances, normalizeUnifiedBalance, parsePositiveUsdc, sanitizeCircleError } from "./unifiedBalance.ts";
import { UNIFIED_EVM_CHAINS } from "./chains.ts";

test("Circle capabilities fail closed until the real integration is configured", () => {
  assert.equal(circleCapabilities({ appKitConfigured: false, gatewayConfigured: false }).bridge, "configuration-required");
  assert.equal(circleCapabilities({ appKitConfigured: true, gatewayConfigured: true }).unifiedBalance, "supported");
  assert.equal(ARC_DOMAIN, 26);
  assert.equal(GATEWAY_WALLET, "0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
});
test("unified balance uses provider values and exposes unavailable separately", () => {
  assert.deepEqual(normalizeUnifiedBalance({ available: 2n, pending: 1n, sources: [{ domain: 26, chain: "Arc Testnet", amount: 2n }] }), { available: 2n, pending: 1n, total: 3n, sources: [{ domain: 26, chain: "Arc Testnet", amount: 2n }] });
  assert.throws(() => normalizeUnifiedBalance({ available: -1n, pending: 0n, sources: [] }), RangeError);
});
test("bridge completion requires destination progression", () => {
  assert.equal(canAdvanceBridge("source-submitted", "source-final"), true);
  assert.equal(canAdvanceBridge("source-final", "completed"), false);
  assert.equal(canAdvanceBridge("destination-pending", "completed"), true);
});

test("live Gateway chain configuration includes Arc and official Base Sepolia USDC", () => {
  assert.deepEqual(UNIFIED_EVM_CHAINS.slice(0, 2).map(({ id, sdk, usdc }) => ({ id, sdk, usdc })), [
    { id: 5_042_002, sdk: "Arc_Testnet", usdc: "0x3600000000000000000000000000000000000000" },
    { id: 84_532, sdk: "Base_Sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  ]);
});

test("USDC validation rejects zero, excess decimals, and malformed input", () => {
  assert.equal(parsePositiveUsdc("1.25"), 1_250_000n);
  assert.equal(parsePositiveUsdc("0"), undefined);
  assert.equal(parsePositiveUsdc("0.0000001"), undefined);
  assert.equal(parsePositiveUsdc("nope"), undefined);
});

test("Circle balance response is separated by depositor and preserves pending", () => {
  const result = {
    totalConfirmedBalance: "3.5",
    totalPendingBalance: "0.25",
    breakdown: [
      { depositor: "0x1111111111111111111111111111111111111111", breakdown: [{ chain: "Arc_Testnet", confirmedBalance: "1.5" }] },
      { depositor: "0x2222222222222222222222222222222222222222", breakdown: [{ chain: "Base_Sepolia", confirmedBalance: "2" }] },
    ],
  } as Parameters<typeof normalizeCircleBalances>[0];
  const balance = normalizeCircleBalances(result, "0x1111111111111111111111111111111111111111");
  assert.equal(balance.available, 3_500_000n);
  assert.equal(balance.pending, 250_000n);
  assert.deepEqual(balance.sources, [{ domain: 0, chain: "Arc_Testnet", amount: 1_500_000n }]);
});

test("wallet rejection is presented as cancellation without leaking arbitrary length", () => {
  assert.equal(sanitizeCircleError(new Error("User rejected the request")), "Transaction cancelled in wallet.");
  assert.equal(sanitizeCircleError(new Error("x".repeat(500))).length, 240);
});
