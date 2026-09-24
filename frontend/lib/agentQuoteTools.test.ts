import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runQuoteTool, type QuoteContext, type QuoteServices } from "./agent/quoteTools.ts";
import type { ReadServices } from "./agent/readTools.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const at = 1_000_000;
const snapshot = (overrides: Partial<Parameters<typeof createAgentContextSnapshot>[0]> = {}) => createAgentContextSnapshot({ connected: true, account, verifiedChainId: arcTestnet.id, isArc: true, balances: { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n }, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: at, ...overrides });
const reads: ReadServices = { readBalance: async (_account, asset) => ({ usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n })[asset], readAllowance: async () => 0n };
const services: QuoteServices = { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: at }), readDirectCctpFee: async () => ({ finalityThreshold: 2000, minimumFee: 1, forwardFeeMed: "200000", quotedAt: at }) };
const context = (options: Partial<QuoteContext> = {}): QuoteContext => ({ snapshot: snapshot(), reads, services, now: () => at, ...options });
const send = (assetId: "usdc" | "eurc" | "cirbtc" = "usdc", amount = 10_000_000n) => ({ tool: "send.quote" as const, account, chainId: arcTestnet.id, assetId, amount, recipient });
const swap = (inputAsset: "usdc" | "eurc" | "cirbtc" = "usdc", outputAsset: "usdc" | "eurc" | "cirbtc" = "eurc") => ({ tool: "swap.quote" as const, account, chainId: arcTestnet.id, inputAsset, outputAsset, amount: 10_000_000n, slippage: 0.005 as const });
const bridge = (options: Partial<Parameters<typeof runQuoteTool>[1]> = {}) => ({ tool: "bridge.quote" as const, account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc" as const, amount: 10_000_000n, recipient, route: "cctp-direct-forwarding" as const, ...options });

test("Send quotes reuse fee and affordability math for USDC, EURC, and cirBTC", async () => {
  for (const asset of ["usdc", "eurc", "cirbtc"] as const) {
    const quote = await runQuoteTool(context(), send(asset));
    assert.equal(quote.status, "AVAILABLE"); assert.equal(quote.account, account); assert.equal(quote.chainId, arcTestnet.id); assert.equal(quote.provider, "Arc RPC");
    assert.equal(quote.quotedAt, at); assert.equal(quote.expiresAt, at + 60_000); assert.equal(quote.validity, "local-max-age");
    assert.equal(quote.data.maximumFeeRaw18, 1_000_000_000_000_000n); assert.equal(quote.data.feeAwareAffordable, true);
    assert.equal(quote.data.remaining, asset === "usdc" ? 89_999_000n : asset === "eurc" ? 40_000_000n : 190_000_000n);
  }
});

test("Send insufficiency and missing fee remain truthful", async () => {
  const short = await runQuoteTool(context(), send("eurc", 60_000_000n));
  assert.equal(short.status, "AVAILABLE"); assert.equal(short.data.tokenBalanceCovers, false); assert.equal(short.data.feeAwareAffordable, false);
  const failed = await runQuoteTool(context({ services: { estimateSendMaximumFee: async () => { throw Error("RPC offline"); } } }), send());
  assert.equal(failed.status, "PARTIAL"); assert.equal(failed.error, "EVIDENCE_UNAVAILABLE"); assert.equal(failed.data.maximumFeeRaw18, undefined); assert.equal(failed.data.feeAwareAffordable, undefined); assert.equal(failed.expiresAt, null);
  const noBalance = await runQuoteTool(context({ reads: { readBalance: async () => { throw Error("RPC offline"); } } }), send());
  assert.equal(noBalance.status, "UNAVAILABLE"); assert.equal(noBalance.error, "EVIDENCE_UNAVAILABLE");
});

test("Every quote is bound to the current account and verified chain", async () => {
  const wrongAccount = await runQuoteTool(context(), { ...send(), account: recipient }); assert.equal(wrongAccount.error, "WRONG_CONTEXT");
  const wrongChain = await runQuoteTool(context(), { ...swap(), chainId: baseSepolia.id }); assert.equal(wrongChain.error, "WRONG_CONTEXT");
  const missing = await runQuoteTool(context({ snapshot: snapshot({ account: undefined }) }), bridge()); assert.equal(missing.error, "WRONG_CONTEXT");
});

test("Xylo quotes preserve pair, output, slippage, route, allowance and provider", async () => {
  for (const [input, output] of [["usdc", "eurc"], ["eurc", "usdc"]] as const) {
    const quote = await runQuoteTool(context(), swap(input, output));
    assert.equal(quote.status, "AVAILABLE"); assert.equal(quote.provider, "XyloNet StableSwap"); assert.deepEqual(quote.provenance.slice(0, 2), ["xylo-router", "local-calculation"]);
    assert.equal(quote.data.outputAsset, output); assert.equal(quote.data.expectedOutput, 9_000_000n); assert.equal(quote.data.minimumReceived, 8_955_000n);
    assert.equal(quote.data.slippageBps, 50); assert.equal(quote.data.allowance, 0n); assert.equal(quote.data.approvalRequired, true); assert.equal(quote.data.approvalAmount, 10_000_000n);
    assert.equal(quote.data.fee, "not-estimated"); assert.equal(quote.expiresAt, at + 45_000);
  }
  const covered = await runQuoteTool(context({ reads: { ...reads, readAllowance: async () => 10_000_000n } }), swap());
  assert.equal(covered.data.approvalRequired, false);
});

test("Xylo rejects unsupported pairs and invalid slippage", async () => {
  assert.equal((await runQuoteTool(context(), swap("cirbtc", "usdc"))).status, "UNSUPPORTED");
  assert.equal((await runQuoteTool(context(), swap("usdc", "usdc"))).status, "UNSUPPORTED");
  assert.equal((await runQuoteTool(context(), { ...swap(), slippage: 0.2 as 0.005 })).error, "INVALID_INPUT");
});

test("Xylo expiry and provider/allowance failures are distinct", async () => {
  const stale = await runQuoteTool(context({ now: () => at + 45_001 }), swap()); assert.equal(stale.status, "EXPIRED"); assert.equal(stale.error, "QUOTE_EXPIRED");
  const failed = await runQuoteTool(context({ services: { readXyloOutput: async () => { throw Error("no quote"); } } }), swap()); assert.equal(failed.status, "UNAVAILABLE"); assert.equal(failed.error, "QUOTE_FAILED");
  const zero = await runQuoteTool(context({ services: { readXyloOutput: async () => ({ amountOut: 0n, quotedAt: at }) } }), swap()); assert.equal(zero.status, "UNAVAILABLE");
  const partial = await runQuoteTool(context({ reads: {} }), swap()); assert.equal(partial.status, "PARTIAL"); assert.equal(partial.data.approvalRequired, undefined);
});

test("Direct CCTP quote retains fee, receive, source debit, route and expiry", async () => {
  const quote = await runQuoteTool(context(), bridge());
  assert.equal(quote.status, "AVAILABLE"); assert.equal(quote.provider, "Circle CCTP V2 Forwarding"); assert.equal(quote.data.expectedReceive, 10_000_000n);
  assert.equal(quote.data.protocolFee, 1_000n); assert.equal(quote.data.forwardingFee, 200_000n); assert.equal(quote.data.maximumFee, 201_000n); assert.equal(quote.data.sourceDebit, 10_201_000n);
  assert.equal(quote.data.approvalAmount, 10_201_000n); assert.equal(quote.data.gasFee, "not-estimated"); assert.equal(quote.expiresAt, at + 45_000); assert.ok(quote.provenance.includes("circle-fee-api"));
});

test("Bridge rejects unsupported assets/routes and truthfully reports App Kit gap", async () => {
  assert.equal((await runQuoteTool(context(), bridge({ assetId: "eurc" }))).status, "UNSUPPORTED");
  assert.equal((await runQuoteTool(context(), bridge({ destinationChainId: 1 }))).status, "UNSUPPORTED");
  const appKit = await runQuoteTool(context(), bridge({ route: "circle-app-kit-cctp" })); assert.equal(appKit.status, "UNAVAILABLE"); assert.equal(appKit.error, "PROVIDER_UNAVAILABLE"); assert.equal(appKit.provider, "Circle App Kit");
});

test("Bridge expiry, invalid fee, and provider failure never become zero-fee success", async () => {
  const expired = await runQuoteTool(context({ now: () => at + 45_001 }), bridge()); assert.equal(expired.status, "EXPIRED");
  const malformed = await runQuoteTool(context({ services: { readDirectCctpFee: async () => ({ finalityThreshold: 2000, minimumFee: -1, forwardFeeMed: "0", quotedAt: at }) } }), bridge()); assert.equal(malformed.status, "UNAVAILABLE"); assert.equal(malformed.error, "QUOTE_FAILED");
  const offline = await runQuoteTool(context({ services: { readDirectCctpFee: async () => { throw Error("offline"); } } }), bridge()); assert.equal(offline.status, "UNAVAILABLE"); assert.equal(offline.error, "QUOTE_FAILED");
  const partial = await runQuoteTool(context({ reads: {} }), bridge()); assert.equal(partial.status, "PARTIAL"); assert.equal(partial.data.allowance, undefined);
});

test("Quote API has no execution authority or unsigned transaction payload", async () => {
  const source = readFileSync(new URL("./agent/quoteTools.ts", import.meta.url), "utf8");
  for (const forbidden of ["sendTransaction", "writeContract", "privateKey", "mnemonic", "signer", "calldata", "encodeFunctionData"]) assert.equal(source.includes(forbidden), false, forbidden);
  for (const quote of [await runQuoteTool(context(), send()), await runQuoteTool(context(), swap()), await runQuoteTool(context(), bridge())]) {
    assert.equal("request" in quote, false); assert.equal("calldata" in quote, false);
  }
});
