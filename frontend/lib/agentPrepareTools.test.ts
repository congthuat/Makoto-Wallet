import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeFunctionData, getAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { erc20BalanceAbi } from "./abi/erc20.ts";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { consumeAgentHandoff, storeAgentHandoff } from "./agent/actions/handoff.ts";
import { runPrepareTool, type PrepareContext } from "./agent/prepareTools.ts";
import { runQuoteTool, type QuoteServices } from "./agent/quoteTools.ts";
import type { ReadServices } from "./agent/readTools.ts";
import { getAssetById } from "./assets.ts";
import { CCTP_TOKEN_MESSENGER_ABI, CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import { xyloRouterAbi, XYLO_ROUTER } from "./swap.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const at = 1_000_000;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };
const snapshot = (overrides: Partial<Parameters<typeof createAgentContextSnapshot>[0]> = {}) => createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: at, ...overrides });
const reads: ReadServices = { readBalance: async (_owner, asset) => balances[asset], readAllowance: async () => 0n };
const services: QuoteServices = { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: at }), readDirectCctpFee: async () => ({ finalityThreshold: 2000, minimumFee: 1, forwardFeeMed: "200000", quotedAt: at }) };
const context = (overrides: Partial<PrepareContext> = {}): PrepareContext => ({ snapshot: snapshot(), reads, services, now: () => at, ...overrides });
const send = async (ctx: PrepareContext, assetId: "usdc" | "eurc" | "cirbtc" = "usdc", amount = 10_000_000n) => ({ tool: "send.prepare" as const, account, chainId: arcTestnet.id, assetId, amount, recipient, quote: await runQuoteTool(ctx, { tool: "send.quote", account, chainId: arcTestnet.id, assetId, amount, recipient }) });
const swap = async (ctx: PrepareContext, inputAsset: "usdc" | "eurc" = "usdc", outputAsset: "usdc" | "eurc" = "eurc") => ({ tool: "swap.prepare" as const, account, chainId: arcTestnet.id, inputAsset, outputAsset, amount: 10_000_000n, slippage: 0.005 as const, quote: await runQuoteTool(ctx, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset, outputAsset, amount: 10_000_000n, slippage: 0.005 }) });
const bridge = async (ctx: PrepareContext) => ({ tool: "bridge.prepare" as const, account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc" as const, amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding" as const, quote: await runQuoteTool(ctx, { tool: "bridge.quote", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding" }) });

test("Send prepares bounded USDC, EURC, and cirBTC transfers without a signer", async () => {
  const ctx = context();
  for (const asset of ["usdc", "eurc", "cirbtc"] as const) {
    const result = await runPrepareTool(ctx, await send(ctx, asset));
    assert.equal(result.status, "PREPARED"); if (result.status !== "PREPARED") continue;
    assert.equal(result.data.executionEnabled, false); assert.equal(result.data.account, account); assert.equal(result.data.chainId, arcTestnet.id);
    assert.equal(result.data.steps.length, 1); assert.equal(result.data.steps[0].target, getAssetById(asset)!.address); assert.equal(result.data.steps[0].request.value, "0");
    assert.deepEqual(decodeFunctionData({ abi: erc20BalanceAbi, data: result.data.steps[0].request.data }), { functionName: "transfer", args: [recipient, 10_000_000n] });
    assert.equal(result.data.expiresAt, at + 60_000); assert.equal(result.data.steps[0].requiresFreshReview, true);
    assert.equal(Boolean(result.data.handoff), true);
    if (asset === "cirbtc") { assert.equal(result.data.handoff?.asset, "cirBTC"); assert.equal(result.data.handoff?.amount, "0.1"); }
  }
});

test("Send rejects invalid recipients, amounts, changed context and insufficiency", async () => {
  const ctx = context(); const good = await send(ctx);
  assert.equal((await runPrepareTool(ctx, { ...good, recipient: "0x0000000000000000000000000000000000000000" })).error, "INVALID_INPUT");
  assert.equal((await runPrepareTool(ctx, { ...good, amount: 0n })).error, "INVALID_INPUT");
  assert.equal((await runPrepareTool(ctx, { ...good, quote: undefined as unknown as typeof good.quote })).error, "INVALID_INPUT");
  assert.equal((await runPrepareTool(ctx, { ...good, account: recipient })).error, "WRONG_CONTEXT");
  assert.equal((await runPrepareTool(ctx, { ...good, chainId: baseSepolia.id })).error, "WRONG_CONTEXT");
  assert.equal((await runPrepareTool(context({ snapshot: snapshot({ walletStatus: "locked", connected: false }) }), good)).error, "WALLET_UNAVAILABLE");
  const tooMuch = await send(ctx, "usdc", 101_000_000n);
  assert.equal((await runPrepareTool(ctx, tooMuch)).error, "INSUFFICIENT_BALANCE");
});

test("Send rejects fee or balance changes after the quoted evidence", async () => {
  const ctx = context(); const good = await send(ctx);
  const changedFee = context({ services: { ...services, estimateSendMaximumFee: async () => 2_000_000_000_000_000n } });
  assert.equal((await runPrepareTool(changedFee, good)).error, "QUOTE_MISMATCH");
  const changedBalance = context({ reads: { ...reads, readBalance: async (_owner, asset) => asset === "usdc" ? 90_000_000n : balances[asset] } });
  assert.equal((await runPrepareTool(changedBalance, good)).error, "QUOTE_MISMATCH");
});

test("Swap prepares both supported directions and exact Xylo calldata", async () => {
  const ctx = context();
  for (const [input, output] of [["usdc", "eurc"], ["eurc", "usdc"]] as const) {
    const result = await runPrepareTool(ctx, await swap(ctx, input, output));
    assert.equal(result.status, "PREPARED"); if (result.status !== "PREPARED") continue;
    assert.equal(result.data.provider, "XyloNet StableSwap"); assert.equal(result.data.steps.length, 2); assert.equal(result.data.expiresAt, at + 45_000);
    const approval = result.data.steps[0], exchange = result.data.steps[1];
    assert.equal(approval.kind, "finite-approval"); assert.equal(approval.target, getAssetById(input)!.address); assert.equal(approval.spender, XYLO_ROUTER);
    assert.deepEqual(decodeFunctionData({ abi: erc20BalanceAbi, data: approval.request.data }), { functionName: "approve", args: [XYLO_ROUTER, 10_000_000n] });
    assert.equal(exchange.kind, "swap"); assert.equal(exchange.target, XYLO_ROUTER); assert.equal(exchange.minimumOutput, 8_955_000n);
    assert.equal(exchange.requiresConfirmedPriorStep, true);
    const decoded = decodeFunctionData({ abi: xyloRouterAbi, data: exchange.request.data });
    assert.equal(decoded.functionName, "swap"); assert.equal(decoded.args[0].amountIn, 10_000_000n); assert.equal(decoded.args[0].minAmountOut, 8_955_000n); assert.equal(decoded.args[0].to, account);
    assert.ok(result.data.handoff); assert.equal(result.data.handoff?.expiresAt, at + 45_000);
  }
});

test("Swap omits approval when allowance covers input", async () => {
  const ctx = context({ reads: { ...reads, readAllowance: async () => 10_000_000n } });
  const result = await runPrepareTool(ctx, await swap(ctx));
  assert.equal(result.status, "PREPARED"); if (result.status === "PREPARED") assert.deepEqual(result.data.steps.map((item) => item.kind), ["swap"]);
});

test("Swap handoff is available to the local wallet review route", async () => {
  const ctx = context({ snapshot: snapshot({ accountKind: "local" }) });
  const result = await runPrepareTool(ctx, await swap(ctx));
  assert.equal(result.status, "PREPARED"); if (result.status === "PREPARED") assert.equal(result.data.handoff?.action, "swap");
});

test("Swap rejects unsupported pair, expired or mismatched quote and missing allowance", async () => {
  const ctx = context(); const good = await swap(ctx);
  assert.equal((await runPrepareTool(ctx, { ...good, inputAsset: "cirbtc" })).status, "UNSUPPORTED");
  assert.equal((await runPrepareTool(ctx, { ...good, amount: 9_000_000n })).error, "QUOTE_MISMATCH");
  assert.equal((await runPrepareTool(ctx, { ...good, quote: { ...good.quote, account: recipient } })).error, "QUOTE_MISMATCH");
  assert.equal((await runPrepareTool(ctx, { ...good, quote: { ...good.quote, chainId: baseSepolia.id } })).error, "QUOTE_MISMATCH");
  assert.equal((await runPrepareTool(context({ now: () => at + 45_001 }), good)).status, "EXPIRED");
  const partialCtx = context({ reads: { ...reads, readAllowance: async () => { throw Error("offline"); } } });
  assert.equal((await runPrepareTool(partialCtx, { ...good, quote: await runQuoteTool(partialCtx, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005 }) })).error, "EVIDENCE_UNAVAILABLE");
});

test("Bridge prepares exact finite approval and CCTP burn steps", async () => {
  const ctx = context(); const result = await runPrepareTool(ctx, await bridge(ctx));
  assert.equal(result.status, "PREPARED"); if (result.status !== "PREPARED") return;
  assert.equal(result.data.provider, "Circle CCTP V2 Forwarding"); assert.equal(result.data.destinationChainId, baseSepolia.id); assert.equal(result.data.inputAmount, 10_000_000n);
  assert.deepEqual(result.data.steps.map((item) => item.kind), ["finite-approval", "cctp-burn"]);
  assert.equal(result.data.steps[0].spender, CCTP_TOKEN_MESSENGER_V2);
  assert.deepEqual(decodeFunctionData({ abi: erc20BalanceAbi, data: result.data.steps[0].request.data }), { functionName: "approve", args: [CCTP_TOKEN_MESSENGER_V2, 10_201_000n] });
  const burn = result.data.steps[1]; assert.equal(burn.target, CCTP_TOKEN_MESSENGER_V2); assert.equal(burn.destinationChainId, baseSepolia.id);
  assert.equal(burn.requiresConfirmedPriorStep, true);
  const decoded = decodeFunctionData({ abi: CCTP_TOKEN_MESSENGER_ABI, data: burn.request.data });
  assert.equal(decoded.functionName, "depositForBurnWithHook"); assert.equal(decoded.args[0], 10_201_000n); assert.equal(decoded.args[1], 6); assert.equal(decoded.args[5], 201_000n);
  assert.equal(result.data.expiresAt, at + 45_000); assert.equal(result.data.handoff, undefined); assert.ok(result.data.limitations?.length);
});

test("Bridge rejects unsupported route, asset, recipient, stale fees and changed quote", async () => {
  const ctx = context(); const good = await bridge(ctx);
  assert.equal((await runPrepareTool(ctx, { ...good, assetId: "eurc" })).status, "UNSUPPORTED");
  assert.equal((await runPrepareTool(ctx, { ...good, destinationChainId: 1 })).status, "UNSUPPORTED");
  assert.equal((await runPrepareTool(ctx, { ...good, recipient })).status, "UNSUPPORTED");
  assert.equal((await runPrepareTool(ctx, { ...good, route: "circle-app-kit-cctp" })).status, "UNSUPPORTED");
  assert.equal((await runPrepareTool(ctx, { ...good, quote: { ...good.quote, inputAmount: 11_000_000n } })).error, "QUOTE_MISMATCH");
  assert.equal((await runPrepareTool(context({ now: () => at + 45_001 }), good)).status, "EXPIRED");
  const changed = context({ services: { ...services, readDirectCctpFee: async () => ({ finalityThreshold: 2000, minimumFee: 2, forwardFeeMed: "200000", quotedAt: at }) } });
  assert.equal((await runPrepareTool(changed, good)).error, "QUOTE_MISMATCH");
});

test("Bridge omits approval if current allowance is sufficient and blocks insufficient balance", async () => {
  const covered = context({ reads: { ...reads, readAllowance: async () => 10_201_000n } });
  const result = await runPrepareTool(covered, await bridge(covered));
  assert.equal(result.status, "PREPARED"); if (result.status === "PREPARED") assert.deepEqual(result.data.steps.map((item) => item.kind), ["cctp-burn"]);
  const short = context({ reads: { ...reads, readBalance: async (_owner, asset) => asset === "usdc" ? 10_000_000n : balances[asset] } });
  assert.equal((await runPrepareTool(short, await bridge(short))).error, "INSUFFICIENT_BALANCE");
});

test("Prepared handoff is account bound, quote bounded and consumed once", async () => {
  const ctx = context(); const result = await runPrepareTool(ctx, await send(ctx));
  assert.equal(result.status, "PREPARED"); if (result.status !== "PREPARED" || !result.data.handoff) return;
  const map = new Map<string, string>();
  const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  storeAgentHandoff(store, result.data.handoff);
  assert.equal(consumeAgentHandoff(store, result.data.handoff.id, recipient, at), undefined);
  storeAgentHandoff(store, result.data.handoff);
  assert.equal(consumeAgentHandoff(store, result.data.handoff.id, account, at)?.id, result.data.handoff.id);
  assert.equal(consumeAgentHandoff(store, result.data.handoff.id, account, at), undefined);
  storeAgentHandoff(store, result.data.handoff);
  assert.equal(consumeAgentHandoff(store, result.data.handoff.id, account, result.data.expiresAt + 1), undefined);
});

test("Prepared output is immutable data with no submit authority or arbitrary destination input", async () => {
  const ctx = context(); const request = await send(ctx);
  const rejected = await runPrepareTool(ctx, { ...request, to: recipient, calldata: "0xdeadbeef" });
  assert.equal(rejected.status, "UNAVAILABLE");
  const result = await runPrepareTool(ctx, request);
  assert.equal(result.status, "PREPARED"); if (result.status !== "PREPARED") return;
  assert.ok(Object.isFrozen(result.data)); assert.ok(Object.isFrozen(result.data.steps)); assert.ok(Object.isFrozen(result.data.steps[0].request));
  assert.equal("submit" in result.data, false); assert.equal("signer" in result.data, false); assert.equal("sendTransaction" in result.data, false);
  assert.equal(result.data.steps[0].target, getAssetById("usdc")!.address);
  assert.notEqual(result.data.steps[0].request.data, "0xdeadbeef");
  const source = readFileSync(new URL("./agent/prepareTools.ts", import.meta.url), "utf8");
  for (const forbidden of ["privateKey", "mnemonic", "walletClient", "writeContractAsync", "sendTransaction(", "submitReviewedTransaction("]) assert.equal(source.includes(forbidden), false, forbidden);
  const requestKeys = Object.keys(await send(ctx)); assert.equal(requestKeys.includes("to"), false); assert.equal(requestKeys.includes("calldata"), false);
  assert.ok(result.data.quoteFingerprint.startsWith("0x")); assert.ok(result.data.provenance.includes("canonical-quote"));
});
