import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool, type PrepareContext } from "./agent/prepareTools.ts";
import {
  quoteFingerprint,
  isCurrentlyUsableQuote,
  validateHandoff,
  validatePrepareRequest,
  validatePrepareResult,
  validatePreparedAction,
  validateQuoteResult,
  validateReadResult,
} from "./agent/toolSchemas.ts";
import { runQuoteTool, type QuoteServices } from "./agent/quoteTools.ts";
import type { ReadServices } from "./agent/readTools.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const at = 1_000_000;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };
const snapshot = (overrides: Partial<Parameters<typeof createAgentContextSnapshot>[0]> = {}) => createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: at, ...overrides });
const reads: ReadServices = { readBalance: async (_owner, asset) => balances[asset], readAllowance: async () => 0n };
const services: QuoteServices = { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: at }), readDirectCctpFee: async () => ({ finalityThreshold: 2000, minimumFee: 1, forwardFeeMed: "200000", quotedAt: at }) };
const context = (overrides: Partial<PrepareContext> = {}): PrepareContext => ({ snapshot: snapshot(), reads, services, now: () => at, ...overrides });

test("READ schemas accept complete evidence and preserve locked versus disconnected state", () => {
  const locked = { tool: "wallet.state", account, chainId: arcTestnet.id, capturedAt: at, observedAt: at, freshness: "snapshot", source: ["wallet-provider"], status: "AVAILABLE", data: { exists: true, externallyConnected: false, localSigningLocked: true, status: "locked" } };
  assert.equal(validateReadResult(locked).valid, true);
  const disconnected = { ...locked, account: undefined, data: { exists: false, externallyConnected: false, localSigningLocked: false, status: "unavailable" } };
  assert.equal(validateReadResult(disconnected).valid, true);
  const unknownSource = { ...locked, source: ["provider-i-do-not-know"] };
  assert.equal(validateReadResult(unknownSource).valid, false);
  const missingData = { ...locked, status: "UNAVAILABLE", error: "DATA_UNAVAILABLE" };
  assert.equal(validateReadResult(missingData).valid, false);
});

test("QUOTE schemas bind identity, provider, provenance, and expiry", () => {
  const quote = { tool: "send.quote", account, chainId: arcTestnet.id, provider: "Arc RPC", inputAsset: "usdc", inputAmount: 10_000_000n, recipient, observedAt: at, quotedAt: at, expiresAt: at + 60_000, validity: "local-max-age", provenance: ["arc-rpc", "local-calculation"], warnings: [], status: "AVAILABLE", data: { recipient, availableBalance: 100_000_000n, gasBalance: 10n, maximumFeeRaw18: 1n, maximumFeeUsdc6: 1n, remainingBeforeFees: 90_000_000n, remaining: 89_999_999n, remainingGasBalance: 9n, tokenBalanceCovers: true, feeAwareAffordable: true } };
  assert.equal(validateQuoteResult(quote, at).valid, true);
  assert.equal(validateQuoteResult({ ...quote, provider: "XyloNet StableSwap" }, at).valid, false);
  assert.equal(validateQuoteResult({ ...quote, expiresAt: at - 1 }, at).valid, false);
  const expired = { ...quote } as Record<string, unknown>;
  delete expired.data;
  expired.status = "EXPIRED";
  expired.error = "QUOTE_EXPIRED";
  expired.quotedAt = null;
  expired.expiresAt = null;
  assert.equal(validateQuoteResult(expired, at).valid, true);
  assert.equal(isCurrentlyUsableQuote(expired as never, at), false);
  const unavailable = { ...quote } as Record<string, unknown>;
  delete unavailable.data;
  unavailable.status = "UNAVAILABLE";
  unavailable.error = "PROVIDER_UNAVAILABLE";
  unavailable.quotedAt = null;
  unavailable.expiresAt = null;
  assert.equal(validateQuoteResult(unavailable, at).valid, true);
});

test("PARTIAL quotes remain valid evidence without becoming usable", async () => {
  const ctx = context({ services: { readXyloOutput: services.readXyloOutput } });
  const partial = await runQuoteTool(ctx, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient });
  assert.equal(partial.status, "PARTIAL");
  assert.equal(validateQuoteResult(partial, at).valid, true);
  assert.equal(isCurrentlyUsableQuote(partial, at), false);
});

test("PREPARE request schemas reject arbitrary calldata and unsupported routes", async () => {
  const ctx = context();
  const quote = await runQuoteTool(ctx, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient });
  const request = { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient, quote };
  assert.equal(validatePrepareRequest(request, at).valid, true);
  assert.equal(validatePrepareRequest({ ...request, to: recipient }, at).valid, false);
  assert.equal(validatePrepareRequest({ ...request, chainId: baseSepolia.id }, at).valid, false);
  assert.equal(validatePrepareRequest({ ...request, quote: { ...quote, status: "EXPIRED", error: "QUOTE_EXPIRED", quotedAt: null, expiresAt: null } }, at).valid, false);
});

test("PREPARE output schemas decode only bounded send, approval, swap, and CCTP steps", async () => {
  const ctx = context();
  const sendRequest = { tool: "send.prepare" as const, account, chainId: arcTestnet.id, assetId: "usdc" as const, amount: 10_000_000n, recipient, quote: await runQuoteTool(ctx, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient }) };
  const sendPrepared = await runPrepareTool(ctx, sendRequest);
  assert.equal(sendPrepared.status, "PREPARED");
  if (sendPrepared.status !== "PREPARED") return;
  assert.equal(validatePreparedAction(sendPrepared.data, { now: at, quote: sendRequest.quote }).valid, true);
  assert.equal(validatePreparedAction({ ...sendPrepared.data, executionEnabled: true }, { now: at, quote: sendRequest.quote }).valid, false);
  assert.equal(validatePreparedAction({ ...sendPrepared.data, expiresAt: at + 120_000 }, { now: at, quote: sendRequest.quote }).valid, false);
  assert.equal(validatePreparedAction({ ...sendPrepared.data, quoteFingerprint: quoteFingerprint(sendRequest.quote) }, { now: at, quote: { ...sendRequest.quote, inputAmount: 11_000_000n } }).valid, false);
  const handoff = sendPrepared.data.handoff;
  assert.equal(handoff ? validateHandoff(handoff, at).valid : false, true);
  assert.equal(handoff ? validateHandoff({ ...handoff, expiresAt: at - 1 }, at).valid : true, false);
  const forged = { ...sendPrepared.data, steps: [{ ...sendPrepared.data.steps[0], request: { ...sendPrepared.data.steps[0].request, data: "0xdeadbeef" } }] };
  assert.equal(validatePreparedAction(forged, { now: at, quote: sendRequest.quote }).valid, false);
  assert.equal(validatePrepareResult(sendPrepared, { now: at, quote: sendRequest.quote }).valid, true);
  const swapRequest = { tool: "swap.prepare" as const, account, chainId: arcTestnet.id, inputAsset: "usdc" as const, outputAsset: "eurc" as const, amount: 10_000_000n, slippage: 0.005 as const, quote: await runQuoteTool(ctx, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005 }) };
  const swapPrepared = await runPrepareTool(ctx, swapRequest);
  assert.equal(swapPrepared.status, "PREPARED");
  if (swapPrepared.status === "PREPARED") assert.equal(validatePreparedAction(swapPrepared.data, { now: at, quote: swapRequest.quote }).valid, true);
  const bridgeRequest = { tool: "bridge.prepare" as const, account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc" as const, amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding" as const, quote: await runQuoteTool(ctx, { tool: "bridge.quote", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding" }) };
  const bridgePrepared = await runPrepareTool(ctx, bridgeRequest);
  assert.equal(bridgePrepared.status, "PREPARED");
  if (bridgePrepared.status === "PREPARED") assert.equal(validatePreparedAction(bridgePrepared.data, { now: at, quote: bridgeRequest.quote }).valid, true);
});

test("PREPARE schema rejects execution callbacks and unknown provenance", () => {
  const value = { tool: "send.prepare", account, chainId: arcTestnet.id, provider: "Arc RPC", inputAsset: "usdc", inputAmount: 1n, preparedAt: at, expiresAt: at + 1, quoteQuotedAt: at, balanceObservedAt: at, quoteFingerprint: `0x${"00".repeat(32)}`, provenance: ["arc-rpc"], steps: [], reviewSummary: [], executionEnabled: false, submit: () => undefined };
  assert.equal(validatePreparedAction(value, { now: at }).valid, false);
  const handoff = { id: "a", path: "/agent", action: "send", account, createdAt: at, expiresAt: at + 1, amount: "1", asset: "USDC", source: "foreign-agent" };
  assert.equal(validateHandoff(handoff, at).valid, false);
});
