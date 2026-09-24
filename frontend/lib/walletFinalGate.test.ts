import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { calculateCctpForwardingAmounts, type CctpForwardingFee } from "./cctp.ts";
import { evaluateFinalWalletSwapPolicy } from "./policyEngine.ts";
import { createXyloQuote, prepareXyloSwapRequest, XYLO_ROUTER } from "./swap.ts";
import { swapIntent, prepareFlowReview } from "./transactionFlowReview.ts";
import { refreshReviewedCctpBurnFee, refreshReviewedSendFee } from "./walletFinalGate.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const now = 1_000_000;

function swapEvidence() {
  const quote = createXyloQuote("usdc", "eurc", 10_000_000n, 9_000_000n, now);
  const prepared = prepareXyloSwapRequest(quote, 0.005, account, now);
  const intent = swapIntent({ id: "smart-swap", account, target: XYLO_ROUTER, calldata: prepared.calldata, preparedAt: now, expiresAt: now + 45_000, inputAsset: "usdc", outputAsset: "eurc", amount: quote.amountIn, quoteOutput: quote.amountOut, minimumReceive: prepared.minimumReceive, slippageBps: 50, route: "xylonet", gas: { gasLimit: 200_000n, maxFeePerGas: 1_000_000n, maxFeeUsdc6: 200n }, metadata: { deadline: prepared.deadline.toString(), recipient: account } });
  const request = { to: XYLO_ROUTER, data: intent.calldata, value: 0n, chainId: arcTestnet.id, gas: 200_000n, maxFeePerGas: 1_000_000n };
  const snapshot = prepareFlowReview(intent, { connectedAccount: account, connectedChainId: arcTestnet.id, balances: { usdc: 20_000_000n }, allowance: 10_000_000n, simulation: "passed", expectedTarget: XYLO_ROUTER }, request);
  return { snapshot, intent, prepared, quote, request, account, chainId: arcTestnet.id, balance: 20_000_000n, usdcBalance: 20_000_000n, allowance: 10_000_000n, reviewedBalance: 20_000_000n, reviewedAllowance: 10_000_000n, liveOutput: 9_000_000n, slippage: 0.005, feeValid: true, simulation: "passed" as const, now: now + 1000 };
}

test("production Swap final gate accepts fresh bound evidence and blocks expiry", () => {
  const input = swapEvidence();
  assert.equal(evaluateFinalWalletSwapPolicy(input).decision, "ALLOW");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, now: now + 45_001 }).decision, "REQUOTE");
});

test("production Swap final gate stops changed allowance, balance, and failed simulation", () => {
  const input = swapEvidence();
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, allowance: input.allowance + 1n }).decision, "REVALIDATE");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, balance: input.balance - 1n, usdcBalance: input.usdcBalance - 1n }).decision, "REVALIDATE");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, simulation: "reverted" }).decision, "BLOCK");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, simulation: "unavailable" }).mustStop, true);
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, account: getAddress("0x2222222222222222222222222222222222222222") }).decision, "BLOCK");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, chainId: 1 }).decision, "BLOCK");
});

test("Send confirmation fee refresh fails closed", async () => {
  const reviewed = { status: "ready", rawFee: 1_000_000n };
  assert.equal(await refreshReviewedSendFee(reviewed, async () => { throw Error("rpc"); }), undefined);
  assert.equal(await refreshReviewedSendFee(reviewed, async () => undefined), undefined);
  assert.equal(await refreshReviewedSendFee(reviewed, async () => 1_500_000n), undefined);
  assert.equal(await refreshReviewedSendFee(reviewed, async () => 1_000_000n), 1_000_000n);
});

test("Direct CCTP burn fee refresh fails closed on unavailable or changed fee", async () => {
  const fee: CctpForwardingFee = { finalityThreshold: 2000, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now };
  const reviewed = calculateCctpForwardingAmounts(10_000_000n, fee);
  assert.equal(await refreshReviewedCctpBurnFee(reviewed, async () => { throw Error("provider"); }, now + 1000, 45_000), false);
  assert.equal(await refreshReviewedCctpBurnFee(reviewed, async () => ({ ...fee, forwardFeeMed: "200001" }), now + 1000, 45_000), false);
  assert.equal(await refreshReviewedCctpBurnFee(reviewed, async () => fee, now + 1000, 45_000), true);
});

test("production confirmation handlers call the tested gates before wallet submission", () => {
  const component = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
  const send = component("SendFlow.tsx"), swap = component("RealSwapFlow.tsx"), cctp = component("CctpBridgeFlow.tsx");
  assert.ok(send.indexOf("refreshReviewedSendFee(feeEstimate") < send.indexOf("submittedHash = await submitReviewedTransaction"));
  assert.ok(swap.indexOf("const finalPolicy = evaluateFinalWalletSwapPolicy") < swap.indexOf("const hash = await submissionGuard.current.run(swapReview.fingerprint"));
  assert.ok(cctp.indexOf("refreshReviewedCctpBurnFee(review.amounts") < cctp.indexOf("submittedHash = await submissionGuard.current.run"));
});

test("9F production Swap gate blocks target, pool, pair, slippage and minimum substitution", () => {
  const input = swapEvidence();
  const attacks = [
    { ...input, quote: { ...input.quote, pool: account } },
    { ...input, quote: { ...input.quote, router: account } },
    { ...input, quote: { ...input.quote, toAssetId: "usdc" as typeof input.quote.toAssetId } },
    { ...input, prepared: { ...input.prepared, request: { ...input.prepared.request, address: account } } },
    ...[0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY].map((slippage) => ({ ...input, slippage })),
    { ...input, prepared: { ...input.prepared, minimumReceive: input.prepared.minimumReceive + 1n } },
  ];
  for (const [index, attack] of attacks.entries()) assert.equal(evaluateFinalWalletSwapPolicy(attack).decision, "BLOCK", `attack ${index}`);
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, liveOutput: input.prepared.minimumReceive - 1n }).decision, "REQUOTE");
});

test("9F production Swap gate preserves precedence and never turns absent simulation into ALLOW", () => {
  const input = swapEvidence();
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, feeValid: false }).decision, "REQUOTE");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, simulation: "unavailable" }).decision, "BLOCK");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, simulation: "reverted", now: now + 45_001 }).decision, "BLOCK");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, quote: { ...input.quote, pool: account }, feeValid: false, allowance: input.allowance + 1n }).decision, "BLOCK");
  assert.equal(evaluateFinalWalletSwapPolicy({ ...input, allowance: input.allowance + 1n, feeValid: false }).decision, "REQUOTE");
});

test("9F reviewed Send and Direct CCTP fees fail closed on stale, malformed and unavailable refresh", async () => {
  const reviewedSend = { status: "ready", rawFee: 1_000_000n };
  for (const load of [async () => undefined, async () => { throw Error("rpc"); }, async () => 10_000_000n]) assert.equal(await refreshReviewedSendFee(reviewedSend, load), undefined);
  assert.equal(await refreshReviewedSendFee({ status: "unavailable" }, async () => 1_000_000n), undefined);
  const fee: CctpForwardingFee = { finalityThreshold: 2000, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now };
  const reviewed = calculateCctpForwardingAmounts(10_000_000n, fee);
  for (const load of [
    async () => { throw Error("circle"); },
    async () => ({ ...fee, quotedAt: now - 46_000 }),
    async () => ({ ...fee, quotedAt: now + 2_000 }),
    async () => ({ ...fee, quotedAt: Number.NaN }),
    async () => ({ ...fee, forwardFeeMed: "200001" }),
  ]) assert.equal(await refreshReviewedCctpBurnFee(reviewed, load, now + 1_000, 45_000), false);
});
