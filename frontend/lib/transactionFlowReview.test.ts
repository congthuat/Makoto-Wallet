import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeFunctionData, maxUint256, type Address } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { penguJarV3Abi } from "./abi/penguJarV3.ts";
import { getAssetById } from "./assets.ts";
import { contractAddress } from "./config.ts";
import { XYLO_ROUTER } from "./swap.ts";
import { approvalIntent, bridgeIntent, managedRequest, prepareFlowReview, swapIntent, vaultIntent } from "./transactionFlowReview.ts";
import { revalidateTransactionReview } from "./transactionOrchestrator.ts";
import { assessTransaction, type SafetyContext } from "./transactionSafety.ts";

const account = "0x1111111111111111111111111111111111111111" as Address, recipient = "0x2222222222222222222222222222222222222222" as Address;
const usdc = getAssetById("usdc")!;
const context: SafetyContext = { connectedAccount: account, connectedChainId: arcTestnet.id, balances: { usdc: 10_000_000n, eurc: 10_000_000n }, allowance: 1_000_000n, simulation: "passed", now: 1_000, expectedTarget: XYLO_ROUTER };
const swap = swapIntent({ id: "swap", account, target: XYLO_ROUTER, calldata: "0x1234", preparedAt: 1_000, expiresAt: 61_000, inputAsset: "usdc", outputAsset: "eurc", amount: 1_000_000n, quoteOutput: 990_000n, minimumReceive: 980_000n, slippageBps: 50, route: "xylonet", gas: { gasLimit: 100_000n, maxFeePerGas: 2n, maxFeeRaw18: 200_000n, maxFeeUsdc6: 1n } });

test("swap uses a snapshot binding route, expiry, minimum receive and fee envelope", () => { const review = prepareFlowReview(swap, context); assert.equal(review.intent.kind, "swap"); for (const changed of [{ ...swap, account: recipient }, { ...swap, metadata: { ...swap.metadata, route: "other" } }, { ...swap, assetIn: { ...swap.assetIn!, minimumAmount: 970_000n } }]) assert.equal(revalidateTransactionReview(review, { intent: changed, context, now: 2_000 }).valid, false); assert.deepEqual(revalidateTransactionReview(review, { intent: swap, context, now: 61_001 }), { valid: false, reason: "expired" }); });
test("finite exact approval snapshots and unlimited approval remains blocked", () => { const approval = approvalIntent({ id: "approval", account, target: usdc.address, token: usdc.address, spender: XYLO_ROUTER, amount: 1_000_000n, assetId: "usdc", calldata: "0x", preparedAt: 1_000, gas: { gasLimit: 50_000n, maxFeeRaw18: 1n, maxFeeUsdc6: 1n } }); const review = prepareFlowReview(approval, { ...context, expectedTarget: usdc.address, allowance: 0n }); assert.equal(review.intent.approval?.amount, 1_000_000n); assert.equal(review.intent.approval?.finite, true); assert.equal(assessTransaction({ ...approval, approval: { ...approval.approval!, amount: maxUint256, finite: false } }, { ...context, expectedTarget: usdc.address }).status, "blocked"); });
test("only a valid Circle App Kit-managed final transaction may omit independent simulation", () => {
  const intent = bridgeIntent({ id: "circle", account, chainId: baseSepolia.id, target: usdc.address, calldata: "0x", preparedAt: 1_000, expiresAt: 46_000, assetId: "usdc", amount: 1_000_000n, recipient, destinationChainId: arcTestnet.id, route: "circle-app-kit-cctp", expectedReceive: 990_000n, forwardingFee: "0.01", circleManaged: true });
  const managedContext: SafetyContext = { connectedAccount: account, connectedChainId: baseSepolia.id, balances: { usdc: 2_000_000n }, simulation: "not-performed", simulationPolicy: { requirement: "externally-managed", provider: "circle-app-kit" }, now: 1_000, managedTarget: { label: "Circle App Kit", category: "circle" } };
  const review = prepareFlowReview(intent, managedContext, managedRequest(intent));
  assert.equal(review.intent.metadata?.finalTransaction, "managed-by-circle-app-kit");
  assert.equal(review.assessment.status, "review");
  assert.equal(review.assessment.checks.some((check) => check.code === "request-simulation-not-performed" && !check.message.includes("Simulation passed")), true);
  assert.equal(revalidateTransactionReview(review, { intent, context: managedContext, request: managedRequest(intent), now: 2_000 }).valid, true);
  for (const contextChange of [
    { ...managedContext, connectedChainId: arcTestnet.id },
    { ...managedContext, balances: { usdc: 0n } },
    { ...managedContext, simulation: "reverted" as const },
    { ...managedContext, simulation: "unavailable" as const },
  ]) assert.equal(revalidateTransactionReview(review, { intent, context: contextChange, request: managedRequest(intent), now: 2_000 }).valid, false);
  for (const changedIntent of [
    { ...intent, account: recipient },
    { ...intent, calldata: "0x12" as const },
    { ...intent, metadata: { ...intent.metadata, route: "other" } },
    { ...intent, metadata: { ...intent.metadata, finalTransaction: "exact-calldata" } },
  ]) assert.equal(revalidateTransactionReview(review, { intent: changedIntent, context: managedContext, request: managedRequest(changedIntent), now: 2_000 }).valid, false);
  assert.equal(revalidateTransactionReview(review, { intent, context: managedContext, request: managedRequest(intent), now: 46_001 }).valid, false);
});
test("Circle-managed exemption requires explicit valid policy and Circle context", () => {
  const intent = bridgeIntent({ id: "circle-policy", account, chainId: baseSepolia.id, target: usdc.address, calldata: "0x", preparedAt: 1_000, expiresAt: 46_000, assetId: "usdc", amount: 1_000_000n, recipient, destinationChainId: arcTestnet.id, route: "circle-app-kit-cctp", circleManaged: true });
  const baseContext = { connectedAccount: account, connectedChainId: baseSepolia.id, balances: { usdc: 2_000_000n }, simulation: "not-performed", now: 1_000, managedTarget: { label: "Circle App Kit", category: "circle" as const } };
  assert.equal(assessTransaction(intent, baseContext as unknown as SafetyContext).status, "blocked");
  assert.equal(assessTransaction(intent, { ...baseContext, simulationPolicy: { requirement: "externally-managed", provider: "circle-app-kit" }, managedTarget: { label: "Circle App Kit", category: "token" } }).status, "blocked");
});
test("Universal Bridge source and localized copy never claim a not-performed simulation passed", () => {
  const source = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
  const reviewUi = readFileSync(new URL("../components/TransactionSafetyReview.tsx", import.meta.url), "utf8");
  const en = readFileSync(new URL("../i18n/en.ts", import.meta.url), "utf8");
  const vi = readFileSync(new URL("../i18n/vi.ts", import.meta.url), "utf8");
  assert.match(source, /simulation:\s*"not-performed"/);
  assert.match(source, /simulationPolicy:\s*\{\s*requirement:\s*"externally-managed",\s*provider:\s*"circle-app-kit"\s*\}/);
  assert.doesNotMatch(source.slice(source.indexOf("function reviewContext"), source.indexOf("function active")), /simulation:\s*"passed"/);
  assert.match(reviewUi, /review\.simulationNotPerformed/);
  assert.match(reviewUi, /simulationNotPerformed && <p>\{t\("review\.simulationNotPerformed"\)\}<\/p>/);
  assert.match(en, /Final transaction not independently simulated\. Circle App Kit manages the final transaction\./);
  assert.match(vi, /Giao dịch cuối chưa được Makoto mô phỏng độc lập\. Circle App Kit quản lý giao dịch cuối\./);
});
test("CCTP total burn and fee expiry are material", () => { const intent = bridgeIntent({ id: "cctp", account, target: usdc.address, calldata: "0x1234", preparedAt: 1_000, expiresAt: 46_000, assetId: "usdc", amount: 1_020_000n, recipient: account, destinationChainId: baseSepolia.id, route: "cctp-direct", forwardingFee: "10000", protocolFee: "10000" }); const ctx = { ...context, expectedTarget: usdc.address }; const review = prepareFlowReview(intent, ctx); assert.equal(revalidateTransactionReview(review, { intent: { ...intent, assetOut: { assetId: "usdc", amount: 1_030_000n } }, context: ctx, now: 2_000 }).valid, false); assert.equal(revalidateTransactionReview(review, { intent, context: ctx, now: 46_001 }).valid, false); });
test("Vault deposit and withdrawal snapshots bind configured target and exact calldata", () => { assert.ok(contractAddress); const depositData = encodeFunctionData({ abi: penguJarV3Abi, functionName: "depositToJar", args: [1n, 1_000_000n] }), withdrawData = encodeFunctionData({ abi: penguJarV3Abi, functionName: "withdrawJar", args: [1n] }); for (const intent of [vaultIntent({ id: "deposit", kind: "vault-deposit", account, target: contractAddress!, calldata: depositData, preparedAt: 1_000, assetId: "usdc", amount: 1_000_000n, jarId: 1n }), vaultIntent({ id: "withdraw", kind: "vault-withdraw", account, target: contractAddress!, calldata: withdrawData, preparedAt: 1_000, assetId: "usdc", amount: 1_000_000n, jarId: 1n })]) { const ctx = { ...context, expectedTarget: contractAddress! }; const review = prepareFlowReview(intent, ctx); assert.equal(revalidateTransactionReview(review, { intent: { ...intent, target: recipient }, context: ctx, now: 2_000 }).valid, false); } });
test("all target components import and call the unified orchestrator", () => { for (const file of ["RealSwapFlow.tsx", "UniversalBridgeFlow.tsx", "CctpBridgeFlow.tsx", "OwnerDepositFlow.tsx", "OwnerWithdrawalFlow.tsx"]) { const source = readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8"); assert.match(source, /prepareFlowReview/); assert.match(source, /revalidateTransactionReview/); assert.match(source, /ReviewSubmissionGuard/); } });
