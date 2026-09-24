import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool } from "./agent/prepareTools.ts";
import { runQuoteTool, type SendQuote } from "./agent/quoteTools.ts";
import { runReadTool } from "./agent/readTools.ts";
import { evaluatePolicy, type PolicyInput } from "./policyEngine.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const now = 1_000_000;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };

async function evidence(action: "SEND" | "SWAP" | "BRIDGE" = "SEND"): Promise<PolicyInput> {
  const snapshot = createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: now });
  const context = { snapshot, now: () => now, reads: { readBalance: async (_owner: typeof account, asset: keyof typeof balances) => balances[asset], readAllowance: async () => 0n }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: now }), readDirectCctpFee: async () => ({ finalityThreshold: 2000 as const, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now }) } };
  const wallet = await runReadTool(context, { tool: "wallet.state" });
  const network = await runReadTool(context, { tool: "network.verified" });
  if (action === "SEND") {
    const quote = await runQuoteTool(context, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient: other });
    const preparation = await runPrepareTool(context, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount: 10_000_000n, recipient: other, quote });
    return { action, account, chainId: arcTestnet.id, now, wallet, network, quote, preparation };
  }
  if (action === "SWAP") {
    const quote = await runQuoteTool(context, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005 });
    const preparation = await runPrepareTool(context, { tool: "swap.prepare", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount: 10_000_000n, slippage: 0.005, quote });
    return { action, account, chainId: arcTestnet.id, now, wallet, network, quote, preparation };
  }
  const quote = await runQuoteTool(context, { tool: "bridge.quote", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding" });
  const preparation = await runPrepareTool(context, { tool: "bridge.prepare", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount: 10_000_000n, recipient: account, route: "cctp-direct-forwarding", quote });
  return { action, account, chainId: arcTestnet.id, now, wallet, network, quote, preparation };
}

test("canonical Send evidence allows progression but still requires user wallet review", async () => {
  const input = await evidence();
  assert.equal(input.quote?.status, "AVAILABLE");
  assert.equal(input.preparation?.status, "PREPARED");
  const result = evaluatePolicy(input);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.requiresUserReview, true);
  assert.equal(result.mustStop, false);
  assert.deepEqual(evaluatePolicy(input), result);
});

test("warnings and dependent steps have explicit decisions without submission authority", async () => {
  const send = await evidence();
  if (send.preparation?.status !== "PREPARED") throw Error("fixture must prepare");
  assert.equal(evaluatePolicy({ ...send, preparation: { ...send.preparation, data: { ...send.preparation.data, limitations: ["Review fee caveat"] } } }).decision, "WARN");
  for (const action of ["SWAP", "BRIDGE"] as const) {
    const result = evaluatePolicy(await evidence(action));
    assert.equal(result.decision, "REQUIRE_REVIEW");
    assert.equal(result.requiredAction, "REVIEW");
    assert.equal(result.requiresUserReview, true);
  }
});

test("account, chain, wallet and malformed context fail closed", async () => {
  const input = await evidence();
  assert.equal(evaluatePolicy({ ...input, account: other }).winningReason, "ACCOUNT_MISMATCH");
  assert.equal(evaluatePolicy({ ...input, chainId: baseSepolia.id }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, chainId: 0 }).winningReason, "INVALID_CONTEXT");
  assert.equal(evaluatePolicy({ ...input, wallet: undefined }).winningReason, "MISSING_EVIDENCE");
  assert.equal(evaluatePolicy({ ...input, wallet: { ...input.wallet!, data: { ...(input.wallet as Extract<typeof input.wallet, { status: "AVAILABLE" }>).data, status: "locked", localSigningLocked: true } } as PolicyInput }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, network: undefined }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, network: { tool: "network.verified", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "snapshot", source: ["wallet-provider"], status: "UNAVAILABLE", error: "DATA_UNAVAILABLE" } }).decision, "REVALIDATE");
});

test("quote states, expiry and identity have distinct outcomes without a refetch", async () => {
  const input = await evidence();
  assert.equal(evaluatePolicy({ ...input, now: now + 60_001 }).decision, "REQUOTE");
  if (input.quote?.status !== "AVAILABLE") throw Error("fixture must quote");
  const { data: rawData, ...quoteBase } = input.quote;
  const data = rawData as SendQuote;
  assert.ok(data);
  assert.equal(evaluatePolicy({ ...input, quote: { ...quoteBase, status: "UNAVAILABLE", quotedAt: null, expiresAt: null, validity: "observation-only", error: "PROVIDER_UNAVAILABLE" } }).decision, "REQUOTE");
  assert.equal(evaluatePolicy({ ...input, quote: { ...input.quote, status: "PARTIAL", error: "EVIDENCE_UNAVAILABLE" } }).decision, "REQUOTE");
  assert.equal(evaluatePolicy({ ...input, quote: { ...input.quote, data: { ...data, maximumFeeRaw18: data.maximumFeeRaw18! + 1n } } }).winningReason, "QUOTE_MISMATCH");
  assert.equal(evaluatePolicy({ ...input, quote: { ...input.quote!, tool: "swap.quote" } as PolicyInput["quote"] }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, quote: { ...input.quote!, account: other } }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, quote: undefined }).decision, "BLOCK");
});

test("preparation states reject execution authority and malformed data", async () => {
  const input = await evidence();
  assert.equal(evaluatePolicy({ ...input, preparation: undefined }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, preparation: { tool: "send.prepare", status: "UNAVAILABLE", error: "EVIDENCE_UNAVAILABLE" } }).decision, "REVALIDATE");
  assert.equal(evaluatePolicy({ ...input, preparation: { tool: "send.prepare", status: "UNAVAILABLE", error: "QUOTE_MISMATCH" } }).decision, "REQUOTE");
  assert.equal(evaluatePolicy({ ...input, preparation: { tool: "send.prepare", status: "UNSUPPORTED", error: "UNSUPPORTED" } }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, preparation: { tool: "send.prepare", status: "PREPARED" } as PolicyInput["preparation"] }).winningReason, "MALFORMED_EVIDENCE");
  if (input.preparation?.status !== "PREPARED") throw Error("fixture must prepare");
  assert.equal(evaluatePolicy({ ...input, preparation: { ...input.preparation, data: { ...input.preparation.data, executionEnabled: true } } as unknown as PolicyInput["preparation"] }).winningReason, "EXECUTION_AUTHORITY");
  assert.equal(evaluatePolicy({ ...input, preparation: { ...input.preparation, data: { ...input.preparation.data, steps: [] } } }).winningReason, "MALFORMED_EVIDENCE");
  assert.equal(evaluatePolicy({ ...input, preparation: { ...input.preparation, data: { ...input.preparation.data, account: other } } }).decision, "BLOCK");
});

test("BLOCK wins over REQUOTE and WARN; unsupported action is a policy result", async () => {
  const input = await evidence();
  const result = evaluatePolicy({ ...input, account: other, now: now + 60_001, quote: { ...input.quote!, warnings: ["caveat"] } });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.mustStop, true);
  assert.equal(result.requiresUserReview, false);
  assert.ok(result.findings.some((finding) => finding.decision === "REQUOTE"));
  assert.equal(evaluatePolicy({ ...input, action: "VAULT" as PolicyInput["action"] }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...input, now: now + 60_001, network: { tool: "network.verified", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "snapshot", source: ["wallet-provider"], status: "UNAVAILABLE", error: "DATA_UNAVAILABLE" } }).decision, "REQUOTE");
  assert.throws(() => evaluatePolicy({ ...input, now: Number.NaN }), RangeError);
});

test("evaluation leaves canonical evidence unchanged", async () => {
  const input = await evidence();
  const before = structuredClone(input);
  evaluatePolicy(input);
  assert.deepEqual(input, before);
});
