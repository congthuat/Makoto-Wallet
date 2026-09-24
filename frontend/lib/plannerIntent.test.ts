import assert from "node:assert/strict";
import test from "node:test";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById } from "./assets.ts";
import { validatePlannerIntent, type PlannerIntentValidationCode } from "./plannerIntent.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const send = { version: 1, id: "intent-1", kind: "SEND", chainId: arcTestnet.id, asset: "cirbtc", amount: "0.00000001", recipient };
const swap = { version: 1, id: "intent-2", kind: "SWAP", chainId: arcTestnet.id, fromAsset: "usdc", toAsset: "eurc", amount: "1.25" };
const bridge = { version: 1, id: "intent-3", kind: "BRIDGE", sourceChainId: arcTestnet.id, destinationChainId: baseSepolia.id, asset: "usdc", amount: "2", recipient };

function rejects(input: unknown, code: PlannerIntentValidationCode) {
  const result = validatePlannerIntent(input);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.errors.some((error) => error.code === code), JSON.stringify(result.errors));
}

test("Send uses registered asset precision and survives a JSON round trip", () => {
  assert.equal(getAssetById("cirbtc")?.decimals, 8);
  const result = validatePlannerIntent(send);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(JSON.parse(JSON.stringify(result.value)), send);
    assert.equal(validatePlannerIntent(JSON.parse(JSON.stringify(result.value))).valid, true);
  }
});

test("Swap supports only the current opposite stablecoin pair in both directions", () => {
  assert.equal(validatePlannerIntent(swap).valid, true);
  assert.equal(validatePlannerIntent({ ...swap, fromAsset: "eurc", toAsset: "usdc" }).valid, true);
  assert.notEqual(swap.fromAsset, swap.toAsset);
});

test("Bridge uses the current Arc to Base Sepolia USDC route and explicit recipient", () => {
  assert.equal(validatePlannerIntent(bridge).valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(bridge)), bridge);
});

test("malformed identity, unknown kinds, missing fields and unsupported versions fail", () => {
  rejects(null, "INVALID_SCHEMA");
  rejects([], "INVALID_SCHEMA");
  rejects({ ...send, version: 2 }, "UNSUPPORTED_VERSION");
  rejects({ ...send, id: " " }, "INVALID_INPUT");
  rejects({ ...send, kind: "OTHER" }, "UNSUPPORTED_KIND");
  rejects({ ...send, kind: "APPROVE" }, "UNSUPPORTED_KIND");
  const missing = { ...send } as Record<string, unknown>;
  delete missing.recipient;
  rejects(missing, "INVALID_SCHEMA");
});

test("amounts and addresses are structurally validated without floating point", () => {
  for (const amount of ["bad", "0", "-1", "1e3", "0.000000001", 1.5, " 1", "01"]) rejects({ ...bridge, amount }, "INVALID_INPUT");
  rejects({ ...send, amount: "0.000000001" }, "INVALID_INPUT");
  rejects({ ...send, recipient: "0x123" }, "INVALID_INPUT");
  rejects({ ...bridge, recipient: "0x0000000000000000000000000000000000000000" }, "INVALID_INPUT");
});

test("unsupported asset, pair, chain and Bridge direction are not coerced", () => {
  rejects({ ...send, asset: "weth" }, "UNSUPPORTED");
  rejects({ ...send, chainId: baseSepolia.id }, "UNSUPPORTED");
  rejects({ ...swap, toAsset: "usdc" }, "UNSUPPORTED");
  rejects({ ...swap, toAsset: "cirbtc" }, "UNSUPPORTED");
  rejects({ ...swap, chainId: "5042002" }, "UNSUPPORTED");
  rejects({ ...bridge, asset: "eurc" }, "UNSUPPORTED");
  rejects({ ...bridge, destinationChainId: arcTestnet.id }, "UNSUPPORTED");
  rejects({ ...bridge, sourceChainId: baseSepolia.id, destinationChainId: arcTestnet.id }, "UNSUPPORTED");
});

test("undeclared behavior and non-JSON values cannot enter a valid intent", () => {
  for (const field of ["to", "data", "value", "calldata", "spender", "privateKey", "signer", "sendTransaction", "quote", "strategy", "rawUserText"]) rejects({ ...send, [field]: "injected" }, "INVALID_SCHEMA");
  rejects({ ...send, callback: () => undefined }, "INVALID_SCHEMA");
  rejects({ ...send, amount: 1n }, "INVALID_SCHEMA");
  rejects({ ...send, extra: Promise.resolve(1) }, "INVALID_SCHEMA");
  const cyclic: Record<string, unknown> = { ...send };
  cyclic.self = cyclic;
  rejects(cyclic, "INVALID_SCHEMA");
});
