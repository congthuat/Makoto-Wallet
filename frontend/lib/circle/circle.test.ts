import assert from "node:assert/strict";
import test from "node:test";
import { circleCapabilities, ARC_DOMAIN, GATEWAY_WALLET } from "./appKit.ts";
import { canAdvanceBridge } from "./bridge.ts";
import { normalizeUnifiedBalance } from "./unifiedBalance.ts";

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
