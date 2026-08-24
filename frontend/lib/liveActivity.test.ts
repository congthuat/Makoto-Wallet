import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Address, Hash, PublicClient } from "viem";

import { getAssetById } from "./assets.ts";
import { filterActivity } from "./indexer/filter.ts";
import { loadRecentRpcActivity, RPC_ACTIVITY_BLOCK_WINDOW } from "./indexer/rpcFallback.ts";
import { deserializeWalletActivityPage, serializeWalletActivityPage } from "./onchainActivity.ts";
import type { WalletActivity } from "./wallet.ts";

const wallet = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const hash = `0x${"a".repeat(64)}` as Hash;
const usdc = getAssetById("usdc")!;
function item(overrides: Partial<WalletActivity> = {}): WalletActivity { return { hash, logIndex: 1, direction: "send", kind: "transfer", amount: 5_000_000n, counterparty: other, confirmedAt: 1000, blockNumber: 100n, assetId: usdc.id, assetSymbol: usdc.symbol, tokenAddress: usdc.address, decimals: usdc.decimals, source: "onchain", provider: "arcscan", ...overrides }; }

test("provider metadata and partial history survive API serialization", () => {
  const restored = deserializeWalletActivityPage(serializeWalletActivityPage({ activities: [item()], provider: "rpc", partial: true }));
  assert.equal(restored.provider, "rpc"); assert.equal(restored.partial, true); assert.equal(restored.activities[0].provider, "arcscan");
});

test("All, Send, Receive, Swap, Bridge and Vault filters select canonical kinds", () => {
  const rows = [item(), item({ hash: `0x${"b".repeat(64)}`, direction: "receive" }), item({ hash: `0x${"c".repeat(64)}`, kind: "swap", swapReceive: { amount: 1n, assetId: usdc.id, assetSymbol: usdc.symbol, tokenAddress: usdc.address, decimals: 6, logIndex: 2 } }), item({ hash: `0x${"d".repeat(64)}`, kind: "bridge" }), item({ hash: `0x${"e".repeat(64)}`, kind: "vault-deposit" }), item({ hash: `0x${"f".repeat(64)}`, kind: "vault-withdraw", direction: "receive" })];
  assert.equal(filterActivity(rows, "all", "").length, 6); assert.equal(filterActivity(rows, "send", "").length, 1); assert.equal(filterActivity(rows, "receive", "").length, 1); assert.equal(filterActivity(rows, "swap", "").length, 1); assert.equal(filterActivity(rows, "bridge", "").length, 1); assert.equal(filterActivity(rows, "vault", "").length, 2);
});

test("search is client-side over loaded hash and counterparty", () => {
  assert.equal(filterActivity([item()], "all", "AAAA").length, 1); assert.equal(filterActivity([item()], "all", "222222").length, 1); assert.equal(filterActivity([item()], "all", "deadbeef").length, 0);
});

test("RPC fallback scans a bounded range and normalizes a recent USDC send", async () => {
  const calls: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  let logCall = 0;
  const client = { getBlockNumber: async () => 20_000n, getLogs: async (args: { fromBlock: bigint; toBlock: bigint }) => { calls.push(args); logCall += 1; return logCall === 1 ? [{ address: usdc.address, blockNumber: 19_999n, transactionHash: hash, logIndex: 7, args: { from: wallet, to: other, value: 2_000_000n } }] : []; }, getBlock: async () => ({ timestamp: 123n }), getTransaction: async () => { throw new Error("not expected"); } } as unknown as PublicClient;
  const rows = await loadRecentRpcActivity(wallet, undefined, client);
  assert.equal(rows.length, 1); assert.equal(rows[0].direction, "send"); assert.equal(rows[0].provider, "rpc"); assert.equal(rows[0].confirmedAt, 123_000); assert.equal(calls.length, 4); assert.equal(calls[0].fromBlock, 20_000n - RPC_ACTIVITY_BLOCK_WINDOW + 1n);
});

test("Activity refresh lifecycle and server-only provider safeguards remain wired", () => {
  const hook = readFileSync(new URL("../hooks/useWalletActivity.ts", import.meta.url), "utf8"), route = readFileSync(new URL("../app/api/wallet-activity/route.ts", import.meta.url), "utf8");
  assert.match(hook, /refetchInterval: panelOpen \? 25_000 : false/); assert.match(hook, /visibilitychange/); assert.match(hook, /WALLET_ACTIVITY_UPDATED_EVENT/); assert.match(route, /isAddress\(rawAddress\)/); assert.match(route, /AbortSignal\.timeout\(10_000\)/); assert.match(route, /Cache-Control.*no-store/); assert.match(route, /loadRecentRpcActivity/);
});
