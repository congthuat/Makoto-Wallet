import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hash } from "viem";

import { getAssetById } from "./assets.ts";
import type { WalletActivity } from "./wallet.ts";
import { addWalletActivity, createAssetActivity, deserializeWalletActivity, legacyWalletActivityKey, loadWalletActivity, mergeWalletActivity, recordWalletActivity, serializeWalletActivity, v2WalletActivityKey, walletActivityKey } from "./walletActivity.ts";

const owner = "0x0000000000000000000000000000000000000001" as Address;
const recipient = "0x000000000000000000000000000000000000dEaD" as Address;
const asset = (id: "usdc" | "eurc") => getAssetById(id)!;
function activity(index: number, id: "usdc" | "eurc" = "usdc", confirmedAt = index, logIndex = index): WalletActivity {
  return createAssetActivity(asset(id), { hash: `0x${index.toString(16).padStart(64, "0")}` as Hash, logIndex, direction: "send", kind: "transfer", amount: BigInt(index + 1), counterparty: recipient, confirmedAt, blockNumber: BigInt(index) });
}
class MemoryStorage { values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } }

test("v3 retains exact USDC and EURC identity and bigint fields", () => {
  const restored = deserializeWalletActivity(serializeWalletActivity([activity(1, "usdc"), activity(2, "eurc")]));
  assert.deepEqual(restored.map((item) => item.assetSymbol), ["EURC", "USDC"]);
  assert.equal(restored[0].blockNumber, 2n);
});

test("v1 records migrate safely to v3 optimistic USDC records", () => {
  const storage = new MemoryStorage();
  storage.setItem(legacyWalletActivityKey(owner, 5042002), JSON.stringify([{ hash: activity(1).hash, direction: "send", amount: "2", counterparty: recipient, confirmedAt: 10 }]));
  const migrated = loadWalletActivity(owner, 5042002, storage);
  assert.equal(migrated[0].assetId, "usdc");
  assert.equal(migrated[0].logIndex, -1);
  assert.notEqual(storage.getItem(walletActivityKey(owner, 5042002)), null);
});

test("v2 records migrate safely and preserve EURC", () => {
  const storage = new MemoryStorage();
  const old = { hash: activity(1).hash, direction: "send", amount: "2", counterparty: recipient, confirmedAt: 10, assetId: "eurc", assetSymbol: "EURC", tokenAddress: asset("eurc").address, decimals: 6 };
  storage.setItem(v2WalletActivityKey(owner, 5042002), JSON.stringify([old]));
  assert.equal(loadWalletActivity(owner, 5042002, storage)[0].assetId, "eurc");
});

test("local optimistic record does not duplicate its canonical on-chain transfer", () => {
  const canonical = activity(4, "usdc", 200, 7);
  const optimistic = { ...canonical, logIndex: -1 };
  assert.deepEqual(mergeWalletActivity([canonical], [optimistic]), [canonical]);
});

test("one transaction hash produces one logical Activity entry", () => {
  const usdc = activity(5, "usdc", 100, 1);
  const eurc = { ...activity(6, "eurc", 100, 2), hash: usdc.hash };
  assert.equal(mergeWalletActivity([usdc, eurc], []).length, 1);
});

test("Phase 4.5 submitted-to-confirmed pattern upserts instead of duplicating", () => {
  const storage = new MemoryStorage();
  const confirmed = activity(7, "usdc", 200, 9);
  const submitted = { ...confirmed, logIndex: -1, confirmedAt: 100, blockNumber: 0n };
  recordWalletActivity(owner, 5042002, submitted, storage);
  recordWalletActivity(owner, 5042002, confirmed, storage);
  const persisted = loadWalletActivity(owner, 5042002, storage);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].logIndex, 9);
  assert.deepEqual(mergeWalletActivity([confirmed], [submitted, confirmed]), [confirmed]);
});

test("malformed v3 and legacy payloads fail safely", () => {
  assert.deepEqual(deserializeWalletActivity(JSON.stringify([{ amount: "bad" }])), []);
  const storage = new MemoryStorage(); storage.setItem(v2WalletActivityKey(owner, 5042002), "{bad");
  assert.deepEqual(loadWalletActivity(owner, 5042002, storage), []);
});

test("activity remains capped at 50 records", () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < 55; index += 1) addWalletActivity(owner, 5042002, activity(index), storage);
  assert.equal(loadWalletActivity(owner, 5042002, storage).length, 50);
});

test("two existing Sends append one Swap and one Makoto Vault Deposit across reload without duplicates or wallet leakage", () => {
  const storage = new MemoryStorage();
  const secondWallet = "0x0000000000000000000000000000000000000002" as Address;
  const oldSendOne = activity(1, "usdc", 100, 1);
  const oldSendTwo = activity(2, "usdc", 200, 2);
  recordWalletActivity(owner, 5042002, oldSendOne, storage);
  recordWalletActivity(owner, 5042002, oldSendTwo, storage);

  const swap = createAssetActivity(asset("usdc"), { hash: `0x${"a".repeat(64)}` as Hash, logIndex: 3, direction: "send", kind: "swap", amount: 100_000n, counterparty: recipient, confirmedAt: 300, blockNumber: 300n, swapReceive: { amount: 90_512n, assetId: "eurc", assetSymbol: "EURC", tokenAddress: asset("eurc").address, decimals: 6, logIndex: 4 } });
  const vaultDeposit = createAssetActivity(asset("usdc"), { hash: `0x${"b".repeat(64)}` as Hash, logIndex: 5, direction: "send", kind: "vault-deposit", amount: 250_000n, counterparty: recipient, confirmedAt: 400, blockNumber: 400n });
  recordWalletActivity(owner, 5042002, swap, storage);
  recordWalletActivity(owner, 5042002, vaultDeposit, storage);

  const reloaded = loadWalletActivity(owner, 5042002, storage);
  assert.equal(reloaded.length, 4);
  assert.deepEqual(reloaded.map((item) => item.kind), ["vault-deposit", "swap", "transfer", "transfer"]);
  assert.deepEqual(reloaded.slice(0, 5), reloaded);
  assert.equal(reloaded.find((item) => item.kind === "swap")?.swapReceive?.amount, 90_512n);

  recordWalletActivity(owner, 5042002, swap, storage);
  assert.equal(loadWalletActivity(owner, 5042002, storage).length, 4);
  assert.deepEqual(loadWalletActivity(secondWallet, 5042002, storage), []);
  assert.deepEqual(loadWalletActivity(owner, 1, storage), []);
});
