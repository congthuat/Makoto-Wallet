import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, maxUint256 } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById, type SupportedAssetId } from "./assets.ts";
import { CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import { minimumSwapOutput, SWAP_SLIPPAGE_OPTIONS, XYLO_ROUTER } from "./swap.ts";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool } from "./agent/prepareTools.ts";
import { runQuoteTool, type SendQuote } from "./agent/quoteTools.ts";
import { runReadTool } from "./agent/readTools.ts";
import { evaluatePolicy, type PolicyInput } from "./policyEngine.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const other = getAddress("0x2222222222222222222222222222222222222222");
const now = 1_000_000;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };

async function evidence(action: "SEND" | "SWAP" | "BRIDGE" = "SEND", options: { asset?: SupportedAssetId; slippage?: 0.005 | 0.01 | 0.03; allowance?: bigint } = {}): Promise<PolicyInput> {
  const snapshot = createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: now });
  const context = { snapshot, now: () => now, reads: { readBalance: async (_owner: typeof account, asset: keyof typeof balances) => balances[asset], readAllowance: async () => options.allowance ?? 0n }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: now }), readDirectCctpFee: async () => ({ finalityThreshold: 2000 as const, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now }) } };
  const wallet = await runReadTool(context, { tool: "wallet.state" });
  const network = await runReadTool(context, { tool: "network.verified" });
  if (action === "SEND") {
    const assetId = options.asset ?? "usdc";
    const quote = await runQuoteTool(context, { tool: "send.quote", account, chainId: arcTestnet.id, assetId, amount: 10_000_000n, recipient: other });
    const preparation = await runPrepareTool(context, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId, amount: 10_000_000n, recipient: other, quote });
    return { action, account, chainId: arcTestnet.id, now, wallet, network, quote, preparation };
  }
  if (action === "SWAP") {
    const inputAsset = options.asset === "eurc" ? "eurc" : "usdc", outputAsset = inputAsset === "usdc" ? "eurc" : "usdc", slippage = options.slippage ?? 0.005;
    const quote = await runQuoteTool(context, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset, outputAsset, amount: 10_000_000n, slippage });
    const preparation = await runPrepareTool(context, { tool: "swap.prepare", account, chainId: arcTestnet.id, inputAsset, outputAsset, amount: 10_000_000n, slippage, quote });
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

function changedQuote(input: PolicyInput, fields: Record<string, unknown>, data: Record<string, unknown> = {}): PolicyInput {
  const quote = input.quote as Extract<PolicyInput["quote"], { status: "AVAILABLE" }>;
  return { ...input, quote: { ...quote, ...fields, data: { ...(quote.data as object), ...data } } as PolicyInput["quote"] };
}
function changedStep(input: PolicyInput, index: number, fields: Record<string, unknown>): PolicyInput {
  const preparation = input.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>;
  const steps = preparation.data.steps.map((step, position) => position === index ? { ...step, ...fields } : step);
  return { ...input, preparation: { ...preparation, data: { ...preparation.data, steps } } as PolicyInput["preparation"] };
}
function hasBlock(input: PolicyInput, code: string): void {
  const result = evaluatePolicy(input);
  assert.equal(result.decision, "BLOCK", code);
  assert.ok(result.findings.some((finding) => finding.code === code && finding.decision === "BLOCK"), code);
}

test("9C supported chain, token, pair, target and user-controlled Send recipient", async () => {
  for (const asset of ["usdc", "eurc", "cirbtc"] as const) {
    const send = await evidence("SEND", { asset });
    assert.equal(evaluatePolicy(send).decision, "ALLOW");
    assert.equal((send.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>).data.steps[0].target, getAssetById(asset)!.address);
  }
  for (const asset of ["usdc", "eurc"] as const) for (const slippage of SWAP_SLIPPAGE_OPTIONS) {
    const swap = await evidence("SWAP", { asset, slippage });
    assert.equal(evaluatePolicy(swap).decision, "REQUIRE_REVIEW");
    const quote = swap.quote as Extract<PolicyInput["quote"], { status: "AVAILABLE" }>;
    const data = quote.data as { expectedOutput: bigint; minimumReceived: bigint };
    assert.equal(data.minimumReceived, minimumSwapOutput(data.expectedOutput, slippage));
  }
  assert.equal(evaluatePolicy(await evidence("BRIDGE")).decision, "REQUIRE_REVIEW");
  const send = await evidence();
  assert.equal(evaluatePolicy(send).decision, "ALLOW");
  hasBlock({ ...send, chainId: baseSepolia.id }, "UNSUPPORTED_CHAIN");
  hasBlock({ ...(await evidence("SWAP")), chainId: baseSepolia.id }, "UNSUPPORTED_CHAIN");
  hasBlock({ ...(await evidence("BRIDGE")), chainId: baseSepolia.id }, "UNSUPPORTED_CHAIN");
});

test("9C blocks unsupported chain, token, pair, route and target substitution", async () => {
  const send = await evidence(), swap = await evidence("SWAP"), bridge = await evidence("BRIDGE");
  hasBlock(changedQuote(send, { inputAsset: "unknown" }), "UNSUPPORTED_TOKEN");
  hasBlock(changedStep(send, 0, { target: other }), "UNTRUSTED_TARGET");
  hasBlock(changedQuote(swap, { inputAsset: "cirbtc" }), "UNSUPPORTED_PAIR");
  hasBlock(changedQuote(swap, { outputAsset: "usdc" }), "UNSUPPORTED_PAIR");
  hasBlock(changedQuote(swap, { route: "unknown" }), "UNSUPPORTED_ROUTE");
  hasBlock(changedQuote(swap, {}, { router: other }), "UNTRUSTED_TARGET");
  hasBlock(changedStep(swap, 1, { target: other }), "UNTRUSTED_TARGET");
  hasBlock(changedQuote(bridge, { inputAsset: "eurc" }), "UNSUPPORTED_TOKEN");
  hasBlock(changedQuote(bridge, { inputAsset: "cirbtc" }), "UNSUPPORTED_TOKEN");
  hasBlock(changedQuote(bridge, { destinationChainId: arcTestnet.id }), "UNSUPPORTED_CHAIN");
  hasBlock(changedQuote(bridge, { route: "circle-app-kit-cctp", provider: "Circle App Kit" }), "UNSUPPORTED_ROUTE");
  hasBlock(changedStep(bridge, 1, { target: XYLO_ROUTER }), "UNTRUSTED_TARGET");
  hasBlock(changedQuote(bridge, {}, { spender: XYLO_ROUTER }), "SPENDER_MISMATCH");
});

test("9C finite route-bound approvals reflect actual allowance and required debit", async () => {
  const swap = await evidence("SWAP"), bridge = await evidence("BRIDGE");
  const swapData = (swap.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>).data;
  const bridgeData = (bridge.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>).data;
  assert.equal(swapData.steps[0].spender, XYLO_ROUTER);
  assert.equal(bridgeData.steps[0].spender, CCTP_TOKEN_MESSENGER_V2);
  assert.equal(evaluatePolicy(await evidence("SWAP", { allowance: 10_000_000n })).decision, "WARN");
  assert.equal(evaluatePolicy(await evidence("BRIDGE", { allowance: 20_000_000n })).decision, "WARN");
  hasBlock(changedStep(swap, 0, { spender: other }), "SPENDER_MISMATCH");
  hasBlock(changedStep(bridge, 0, { spender: XYLO_ROUTER }), "SPENDER_MISMATCH");
  hasBlock(changedStep(swap, 0, { target: getAssetById("eurc")!.address, assetId: "eurc" }), "UNSUPPORTED_TOKEN");
  hasBlock(changedStep(swap, 0, { chainId: baseSepolia.id }), "UNSUPPORTED_CHAIN");
  hasBlock(changedStep(swap, 0, { amount: maxUint256 }), "APPROVAL_UNBOUNDED");
  hasBlock(changedStep(swap, 0, { amount: 20_000_000n }), "APPROVAL_AMOUNT_MISMATCH");
  hasBlock(changedStep(swap, 0, { amount: -1n }), "APPROVAL_UNBOUNDED");
  hasBlock(changedStep(bridge, 0, { amount: 20_000_000n }), "APPROVAL_AMOUNT_MISMATCH");
  hasBlock(changedQuote(swap, {}, { allowance: "unknown" }), "APPROVAL_AMOUNT_MISMATCH");
  hasBlock(changedQuote(bridge, {}, { approvalAmount: maxUint256 }), "APPROVAL_AMOUNT_MISMATCH");
  const sufficient = await evidence("SWAP", { allowance: 10_000_000n });
  const approval = swapData.steps[0];
  const sufficientPrepared = sufficient.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>;
  hasBlock({ ...sufficient, preparation: { ...sufficientPrepared, data: { ...sufficientPrepared.data, steps: [approval, ...sufficientPrepared.data.steps] } } }, "APPROVAL_AMOUNT_MISMATCH");
});

test("9C Xylo slippage and minimum output fail closed and compose with 9B precedence", async () => {
  const swap = await evidence("SWAP"), send = await evidence();
  for (const value of [0.02, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) hasBlock(changedQuote(swap, {}, { slippage: value }), "SLIPPAGE_UNSUPPORTED");
  for (const value of [undefined, 0n, 10_000_000n]) hasBlock(changedQuote(swap, {}, { minimumReceived: value }), "MIN_OUTPUT_INVALID");
  hasBlock(changedStep(swap, 1, { minimumOutput: 1n }), "MIN_OUTPUT_INVALID");
  assert.equal(evaluatePolicy({ ...changedQuote(swap, {}, { router: other }), now: now + 60_001 }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...send, now: now + 60_001 }).decision, "REQUOTE");
  assert.equal(evaluatePolicy({ ...send, chainId: baseSepolia.id }).decision, "BLOCK");
});
