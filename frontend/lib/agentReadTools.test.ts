import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPublicClient, getAddress, http, type Address, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { createReadServices, runReadTool, type ReadServices } from "./agent/readTools.ts";
import { runAgentTool } from "./agent/tools.ts";
import { answerAgentRequest } from "./agent/planner.ts";
import { routeAgentRequest } from "./agent/orchestration.ts";
import { parseAgentRequest } from "./agent/parser.ts";
import { createBridgeOperation, updateBridgeOperation, upsertBridgeTransaction } from "./bridgeOperation.ts";
import { SUPPORTED_ASSETS } from "./assets.ts";
import { encodeTransferLog, type MinimalTransactionReceipt } from "./transactionReceipt.ts";
import type { WalletActivity } from "./wallet.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const spender = getAddress("0x3333333333333333333333333333333333333333");
const hash = `0x${"ab".repeat(32)}` as Hash;
const item: WalletActivity = { hash, logIndex: 4, direction: "send", kind: "transfer", amount: 5_000_000n, counterparty: other, confirmedAt: 100, blockNumber: 123n, assetId: "usdc", assetSymbol: "USDC", tokenAddress: SUPPORTED_ASSETS[0].address, decimals: 6, source: "onchain", provider: "arcscan" };
const snapshot = (overrides: Partial<Parameters<typeof createAgentContextSnapshot>[0]> = {}) => createAgentContextSnapshot({ connected: true, account, accountKind: "external", walletStatus: "connected", walletType: "Browser Wallet", verifiedChainId: 5042002, isArc: true, balances: { usdc: 1n, eurc: 2n, cirbtc: 3n }, activity: [item], activityLoadState: "loaded", vault: { available: false }, timestamp: 1000, ...overrides });
const receipt = (status: "success" | "reverted" = "success"): MinimalTransactionReceipt => ({ status, transactionHash: hash, blockNumber: 123n, logs: [encodeTransferLog({ token: item.tokenAddress, from: account, to: other, value: item.amount, logIndex: 4, transactionHash: hash })] });

test("wallet identity and state distinguish external connection, local lock, and missing identity", async () => {
  const external = snapshot();
  assert.deepEqual((await runReadTool({ snapshot: external }, { tool: "wallet.identity" })).data, { exists: true, kind: "external", address: account, providerName: "Browser Wallet" });
  assert.deepEqual((await runReadTool({ snapshot: external }, { tool: "wallet.state" })).data, { exists: true, externallyConnected: true, localSigningLocked: false, status: "connected" });
  const locked = snapshot({ connected: false, accountKind: "local", walletStatus: "locked", walletType: "Makoto Local Wallet", balances: {} });
  const lockState = await runReadTool({ snapshot: locked }, { tool: "wallet.state" });
  assert.deepEqual(lockState.data, { exists: true, externallyConnected: false, localSigningLocked: true, status: "locked" });
  assert.equal((await runReadTool({ snapshot: locked }, { tool: "wallet.identity" })).status, "AVAILABLE");
  const unlocked = await runReadTool({ snapshot: snapshot({ accountKind: "local" }) }, { tool: "wallet.state" });
  assert.equal((unlocked.data as { localSigningLocked: boolean }).localSigningLocked, false);
  const absent = await runReadTool({ snapshot: snapshot({ connected: false, account: undefined, accountKind: undefined, walletStatus: "unavailable" }) }, { tool: "wallet.state" });
  assert.equal((absent.data as { exists: boolean }).exists, false);
  const answer = await runAgentTool(locked, parseAgentRequest({ text: "balance", locale: "en" }));
  assert.equal(answer?.ok, true);
  assert.equal((answer?.data as { walletStatus: string }).walletStatus, "locked");
  assert.equal(answer?.read?.status, "UNAVAILABLE");
  const intent = parseAgentRequest({ text: "network", locale: "en" });
  const decision = routeAgentRequest(intent);
  const output = { result: await runAgentTool(locked, intent) };
  assert.equal((output.result?.data as { walletStatus: string }).walletStatus, "locked");
  assert.match(answerAgentRequest(locked, intent, decision, output).text, /locked/i);
});

test("verified network, account and chain binding, provenance, and observation time", async () => {
  const read = await runReadTool({ snapshot: snapshot() }, { tool: "network.verified" });
  assert.equal(read.status, "AVAILABLE"); assert.equal(read.account, account); assert.equal(read.chainId, 5042002); assert.equal(read.observedAt, 1000); assert.deepEqual(read.source, ["wallet-provider"]);
  const wrong = await runReadTool({ snapshot: snapshot({ verifiedChainId: 84532, isArc: false }) }, { tool: "assets.balances" });
  assert.equal(wrong.status, "UNAVAILABLE"); assert.equal(wrong.error, "UNSUPPORTED");
});

test("USDC, EURC, and cirBTC balance reads preserve partial failure without invented zero", async () => {
  const live: ReadServices = { readBalance: async (_account, assetId) => ({ usdc: 11n, eurc: 22n, cirbtc: 33n })[assetId] };
  const all = await runReadTool({ snapshot: snapshot(), services: live, now: () => 2000 }, { tool: "assets.balances" });
  assert.equal(all.status, "AVAILABLE"); assert.deepEqual(all.data, { usdc: 11n, eurc: 22n, cirbtc: 33n }); assert.equal(all.observedAt, 2000); assert.deepEqual(all.source, ["arc-rpc"]);
  const oneFails = await runReadTool({ snapshot: snapshot(), services: { readBalance: async (_account, assetId) => { if (assetId === "eurc") throw Error("offline"); return assetId === "usdc" ? 11n : 33n; } } }, { tool: "assets.balances" });
  assert.equal(oneFails.status, "PARTIAL"); assert.deepEqual(oneFails.data, { usdc: 11n, cirbtc: 33n });
  const allFail = await runReadTool({ snapshot: snapshot(), services: { readBalance: async () => { throw Error("offline"); } } }, { tool: "assets.balances" }); assert.equal(allFail.error, "PROVIDER_FAILURE");
  const cached = await runReadTool({ snapshot: snapshot({ balances: { usdc: 1n } }) }, { tool: "assets.balances" });
  assert.equal(cached.status, "PARTIAL"); assert.deepEqual(cached.source, ["wallet-balance-hook"]); assert.equal(cached.observedAt, null); assert.equal(cached.freshness, "unknown");
});

test("activity states and provenance preserve partial and unavailable loading", async () => {
  const loaded = await runReadTool({ snapshot: snapshot() }, { tool: "activity.recent", limit: 5 });
  assert.equal(loaded.status, "AVAILABLE"); assert.deepEqual(loaded.source, ["arcscan-api"]);
  const partial = await runReadTool({ snapshot: snapshot({ activityLoadState: "partial" }) }, { tool: "activity.status" });
  assert.equal(partial.status, "PARTIAL"); assert.equal((partial.data as { completeHistory: boolean }).completeHistory, false); assert.equal((partial.data as { confirmedCount: number }).confirmedCount, 1);
  const unavailable = await runReadTool({ snapshot: snapshot({ activityLoadState: "unavailable", activity: [] }) }, { tool: "activity.recent" });
  assert.equal(unavailable.status, "UNAVAILABLE"); assert.equal(unavailable.error, "DATA_UNAVAILABLE");
  const invalid = await runReadTool({ snapshot: snapshot() }, { tool: "activity.recent", limit: 0 });
  assert.equal(invalid.error, "INVALID_REQUEST");
});

test("allowance is owner, token, spender and chain bound", async () => {
  let observed: { owner?: Address; asset?: string; spender?: Address } = {};
  const read = await runReadTool({ snapshot: snapshot(), services: { readAllowance: async (owner, asset, target) => { observed = { owner, asset, spender: target }; return 75n; } } }, { tool: "token.allowance", assetId: "usdc", spender });
  assert.equal(read.status, "AVAILABLE"); assert.deepEqual(observed, { owner: account, asset: "usdc", spender }); assert.equal((read.data as { amount: bigint }).amount, 75n);
  assert.equal((await runReadTool({ snapshot: snapshot({ verifiedChainId: 84532 }) }, { tool: "token.allowance", assetId: "usdc", spender })).error, "UNSUPPORTED");
});

test("receipt pending, confirmed, failed, and unresolved remain distinct", async () => {
  const read = (value?: MinimalTransactionReceipt, current = snapshot()) => runReadTool({ snapshot: current, services: { readReceipt: async () => value } }, { tool: "transaction.receipt", hash });
  const pending = await read(undefined, snapshot({ activity: [{ ...item, source: "local", provider: "local-receipt", blockNumber: 0n }] }));
  assert.equal(pending.status, "AVAILABLE"); assert.equal((pending.data as { state: string }).state, "pending");
  assert.equal(((await read(receipt())).data as { state: string }).state, "confirmed");
  assert.equal(((await read(receipt("reverted"))).data as { state: string }).state, "failed");
  const unknown = await read(receipt(), snapshot({ activity: [] })); assert.equal(unknown.status, "PARTIAL"); assert.equal((unknown.data as { state: string }).state, "unknown");
  const mismatched = await read({ ...receipt("reverted"), transactionHash: `0x${"cd".repeat(32)}` as Hash }); assert.equal((mismatched.data as { state: string }).state, "unknown");
  const failure = await runReadTool({ snapshot: snapshot(), services: { readReceipt: async () => { throw Error("rpc"); } } }, { tool: "transaction.receipt", hash }); assert.equal(failure.error, "PROVIDER_FAILURE");
});

test("bridge source confirmation never implies destination confirmation", async () => {
  const draft = createBridgeOperation({ id: "op-1", sender: account, requestedAmount: 1_000_000n, totalSourceDebit: 1_010_000n, protocolFee: 2_000n, forwardingFee: 8_000n, state: "burn-review", now: 100 });
  const source = upsertBridgeTransaction(updateBridgeOperation(draft, { state: "source-confirmed", circle: { messageStatus: "pending", checkedAt: 180 } }, 180), { role: "burn", chainId: 5042002, hash, status: "confirmed", explorerUrl: "arc" }, 200);
  const read = (operation: typeof source) => runReadTool({ snapshot: snapshot(), services: { readBridgeOperations: () => [operation] } }, { tool: "bridge.operation", operationId: "op-1" });
  const pending = await read(source); assert.equal(pending.status, "AVAILABLE"); assert.equal((pending.data as { source: string }).source, "confirmed"); assert.equal((pending.data as { destination: string }).destination, "pending"); assert.equal(pending.observedAt, 200); assert.deepEqual(pending.source, ["bridge-operation-persistence", "circle-status"]);
  assert.equal((pending.data as { sourceChainId: number }).sourceChainId, 5042002); assert.equal((pending.data as { destinationChainId: number }).destinationChainId, 84532);
  const destination = await read(updateBridgeOperation(source, { state: "destination-confirmed", destinationEvidence: { transactionHash: hash, transferAmount: "1000000", transferLogIndex: 1, balance: "1000000", verifiedAt: 300 } }, 300));
  assert.equal((destination.data as { destination: string }).destination, "confirmed");
  const incomplete = await read(updateBridgeOperation(source, { state: "destination-confirmed" }, 310)); assert.equal(incomplete.status, "PARTIAL"); assert.equal((incomplete.data as { destination: string }).destination, "unknown");
  const missingSourceReceipt = await read(updateBridgeOperation(draft, { state: "source-confirmed" }, 220)); assert.equal(missingSourceReceipt.status, "PARTIAL"); assert.equal((missingSourceReceipt.data as { source: string }).source, "unknown");
  const foreign = await runReadTool({ snapshot: snapshot({ account: other }), services: { readBridgeOperations: () => [source] } }, { tool: "bridge.operation", operationId: "op-1" }); assert.equal(foreign.status, "UNAVAILABLE");
});

test("canonical context exposes only data and read services", () => {
  const source = readFileSync(new URL("./agent/readTools.ts", import.meta.url), "utf8");
  assert.equal(/(?:sendTransaction|writeContract|submitReviewed|signMessage)\s*\(/.test(source), false);
  assert.equal("readContract" in ({ readBalance: async () => 0n } satisfies ReadServices), false);
  const services = createReadServices(createPublicClient({ chain: arcTestnet, transport: http() }));
  assert.deepEqual(Object.keys(services).sort(), ["readAllowance", "readBalance", "readBridgeOperations", "readReceipt"]);
});
