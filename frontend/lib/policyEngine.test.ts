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
import { evaluateFinalPolicy, evaluatePolicy, type FinalPolicyInput, type PolicyInput } from "./policyEngine.ts";

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

async function finalEvidence(action: "SEND" | "SWAP" | "BRIDGE" = "SEND", allowance = 0n): Promise<FinalPolicyInput> {
  const input = await evidence(action, { allowance });
  if (input.preparation?.status !== "PREPARED" || input.quote?.status !== "AVAILABLE") throw Error("final fixture requires prepared action and quote");
  const prepared = input.preparation.data;
  const quoteData = input.quote.data as Record<string, unknown>;
  const amount = action === "BRIDGE" ? 100_000_000n : action === "SWAP" ? 100_000_000n : 100_000_000n;
  const balancesRead = { tool: "assets.balances", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: { usdc: amount, eurc: 50_000_000n, cirbtc: 200_000_000n } } as const;
  const spender = action === "SWAP" ? XYLO_ROUTER : CCTP_TOKEN_MESSENGER_V2;
  const allowanceRead = { tool: "token.allowance", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: { assetId: action === "BRIDGE" ? "usdc" : prepared.inputAsset, token: getAssetById(prepared.inputAsset)!.address, owner: account, spender, amount: allowance } } as const;
  const fee = action === "SEND"
    ? { status: "available", observedAt: now, maximumFeeRaw18: quoteData.maximumFeeRaw18 as bigint, maximumFeeUsdc6: quoteData.maximumFeeUsdc6 as bigint, gasBalanceRaw18: 10_000_000_000_000_000n }
    : action === "BRIDGE" ? { status: "available", observedAt: now, cctpMaximumFee: quoteData.maximumFee as bigint, cctpSourceDebit: quoteData.sourceDebit as bigint }
    : { status: "not-estimated", observedAt: now };
  return { ...input, stepIndex: 0, current: { wallet: input.wallet!, network: input.network!, balances: balancesRead, ...(action === "SEND" ? {} : { allowance: allowanceRead }), quote: input.quote, fee: fee as FinalPolicyInput["current"]["fee"], simulation: { status: "passed", account, chainId: arcTestnet.id, request: prepared.steps[0].request, quoteFingerprint: prepared.quoteFingerprint, observedAt: now } } };
}
function finalFinding(input: FinalPolicyInput, code: string, decision: string): void {
  const result = evaluateFinalPolicy(input);
  assert.equal(result.decision, decision, code);
  assert.ok(result.findings.some((finding) => finding.code === code), code);
}

test("9D final gate accepts current evidence for one reviewed step and is deterministic", async () => {
  for (const action of ["SEND", "SWAP", "BRIDGE"] as const) {
    const input = await finalEvidence(action);
    const result = evaluateFinalPolicy(input);
    assert.equal(result.mustStop, false, action);
    assert.equal(result.requiresUserReview, true, action);
    assert.deepEqual(evaluateFinalPolicy(input), result);
  }
});

test("9D account, chain, balance, expiry and absent evidence fail closed", async () => {
  const send = await finalEvidence();
  finalFinding({ ...send, current: { ...send.current, wallet: { ...send.current.wallet, account: other } } }, "ACCOUNT_MISMATCH", "BLOCK");
  finalFinding({ ...send, current: { ...send.current, network: { ...send.current.network, data: { chainId: baseSepolia.id, isArc: false, requiredChainId: arcTestnet.id } } as FinalPolicyInput["current"]["network"] } }, "CHAIN_MISMATCH", "BLOCK");
  finalFinding({ ...send, current: { ...send.current, balances: { ...send.current.balances, account: other } } }, "PREPARATION_MISMATCH", "BLOCK");
  finalFinding({ ...send, current: { ...send.current, network: { ...send.current.network, account: other } } }, "PREPARATION_MISMATCH", "BLOCK");
  finalFinding({ ...send, current: { ...send.current, balances: { ...send.current.balances, data: { usdc: 1n } } as FinalPolicyInput["current"]["balances"] } }, "BALANCE_INSUFFICIENT", "BLOCK");
  const balanceUnavailable = { tool: "assets.balances", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "live", source: ["arc-rpc"], status: "UNAVAILABLE", error: "PROVIDER_FAILURE" } as const;
  finalFinding({ ...send, current: { ...send.current, balances: balanceUnavailable } }, "UNAVAILABLE_EVIDENCE", "REVALIDATE");
  finalFinding({ ...send, now: now + 60_001 }, "EXPIRED_QUOTE", "REQUOTE");
  finalFinding({ ...send, current: { ...send.current, quote: { ...send.current.quote, observedAt: now + 1 } as FinalPolicyInput["current"]["quote"] }, now: now + 1 }, "QUOTE_MISMATCH", "REQUOTE");
  const prepared = send.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>;
  finalFinding({ ...send, now: now + 2, preparation: { ...prepared, data: { ...prepared.data, expiresAt: now + 1 } } }, "EXPIRED_QUOTE", "REQUOTE");
});

test("9D Send fee refresh and exact simulation fail safely", async () => {
  const send = await finalEvidence();
  finalFinding({ ...send, current: { ...send.current, fee: { ...send.current.fee, status: "unavailable" } } }, "FEE_UNAVAILABLE", "REVALIDATE");
  finalFinding({ ...send, current: { ...send.current, fee: { ...send.current.fee, maximumFeeRaw18: (send.current.fee.maximumFeeRaw18 ?? 0n) + 1n } } }, "FEE_CHANGED", "REQUOTE");
  finalFinding({ ...send, current: { ...send.current, fee: { ...send.current.fee, observedAt: now - 1 } } }, "FEE_UNAVAILABLE", "REVALIDATE");
  finalFinding({ ...send, current: { ...send.current, simulation: { ...send.current.simulation, status: "reverted" } } }, "SIMULATION_FAILED", "BLOCK");
  finalFinding({ ...send, current: { ...send.current, simulation: { ...send.current.simulation, status: "unavailable" } } }, "SIMULATION_UNAVAILABLE", "REVALIDATE");
  finalFinding({ ...send, current: { ...send.current, simulation: { ...send.current.simulation, observedAt: now - 1 } } }, "STALE_EVIDENCE", "REVALIDATE");
  finalFinding({ ...send, current: { ...send.current, simulation: { ...send.current.simulation, account: other } } }, "SIMULATION_MISMATCH", "BLOCK");
  finalFinding({ ...send, current: { ...send.current, simulation: { ...send.current.simulation, request: { ...send.current.simulation.request, to: other } } } }, "SIMULATION_MISMATCH", "BLOCK");
});

test("9D Swap revalidates allowance, route and simulation after state changes", async () => {
  const swap = await finalEvidence("SWAP");
  finalFinding({ ...swap, current: { ...swap.current, allowance: { ...swap.current.allowance!, data: { ...(swap.current.allowance as Extract<typeof swap.current.allowance, { status: "AVAILABLE" }>).data, amount: 10_000_000n } } as FinalPolicyInput["current"]["allowance"] } }, "ALLOWANCE_CHANGED", "REVALIDATE");
  finalFinding({ ...swap, current: { ...swap.current, quote: { ...swap.current.quote, route: "cctp-direct-forwarding" } as FinalPolicyInput["current"]["quote"] } }, "UNSUPPORTED_ROUTE", "BLOCK");
  finalFinding({ ...swap, current: { ...swap.current, simulation: { ...swap.current.simulation, status: "reverted" } } }, "SIMULATION_FAILED", "BLOCK");
  finalFinding({ ...swap, current: { ...swap.current, balances: { ...swap.current.balances, data: { usdc: 1n } } as FinalPolicyInput["current"]["balances"] } }, "BALANCE_INSUFFICIENT", "BLOCK");
  const prepared = swap.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>;
  finalFinding({ ...swap, stepIndex: 1, priorStepConfirmed: false, current: { ...swap.current, simulation: { ...swap.current.simulation, request: prepared.data.steps[1].request } } }, "STALE_EVIDENCE", "REVALIDATE");
});

test("9D Direct CCTP requires current matching fee, allowance and simulation", async () => {
  const bridge = await finalEvidence("BRIDGE");
  finalFinding({ ...bridge, current: { ...bridge.current, fee: { ...bridge.current.fee, status: "unavailable" } } }, "FEE_UNAVAILABLE", "REVALIDATE");
  finalFinding({ ...bridge, current: { ...bridge.current, fee: { ...bridge.current.fee, cctpMaximumFee: (bridge.current.fee.cctpMaximumFee ?? 0n) + 1n } } }, "FEE_CHANGED", "REQUOTE");
  finalFinding({ ...bridge, current: { ...bridge.current, fee: { ...bridge.current.fee, observedAt: now - 1 } } }, "FEE_UNAVAILABLE", "REVALIDATE");
  finalFinding({ ...bridge, current: { ...bridge.current, balances: { ...bridge.current.balances, data: { usdc: 1n } } as FinalPolicyInput["current"]["balances"] } }, "BALANCE_INSUFFICIENT", "BLOCK");
  finalFinding({ ...bridge, current: { ...bridge.current, allowance: { ...bridge.current.allowance!, data: { ...(bridge.current.allowance as Extract<typeof bridge.current.allowance, { status: "AVAILABLE" }>).data, amount: 1n } } as FinalPolicyInput["current"]["allowance"] } }, "ALLOWANCE_CHANGED", "REVALIDATE");
  finalFinding({ ...bridge, current: { ...bridge.current, simulation: { ...bridge.current.simulation, status: "reverted" } } }, "SIMULATION_FAILED", "BLOCK");
  finalFinding({ ...bridge, current: { ...bridge.current, quote: { ...bridge.current.quote, destinationChainId: arcTestnet.id } as FinalPolicyInput["current"]["quote"] } }, "UNSUPPORTED_CHAIN", "BLOCK");
});

test("9F malformed canonical evidence never becomes ALLOW", async () => {
  const send = await evidence(), swap = await evidence("SWAP"), bridge = await evidence("BRIDGE");
  const attacks: PolicyInput[] = [
    { ...send, account: "0x1234" }, { ...send, chainId: Number.NaN },
    { ...send, chainId: Number.POSITIVE_INFINITY }, { ...send, chainId: -1 },
    changedQuote(send, { inputAmount: 0n }), changedQuote(send, { inputAmount: -1n }),
    changedQuote(send, { inputAmount: Number.NaN }), changedQuote(send, { quotedAt: Number.NaN }),
    changedQuote(send, { provider: "forged" }), changedQuote(send, { inputAsset: "unknown" }),
    changedStep(send, 0, { kind: "arbitrary-call" }), changedStep(send, 0, { amount: -1n }),
    changedStep(swap, 0, { spender: other }), changedStep(swap, 0, { amount: maxUint256 }),
    changedStep(bridge, 1, { destinationChainId: arcTestnet.id }),
  ];
  for (const [index, attack] of attacks.entries()) {
    const result = evaluatePolicy(attack);
    assert.equal(result.mustStop, true, `attack ${index}: ${result.decision}`);
    assert.notEqual(result.decision, "ALLOW", `attack ${index}`);
  }
});

test("9F token, pair, route, target, approval and slippage substitutions stay blocked", async () => {
  const send = await evidence(), swap = await evidence("SWAP"), bridge = await evidence("BRIDGE");
  for (const attack of [
    changedStep(send, 0, { target: getAssetById("eurc")!.address }),
    changedStep(send, 0, { assetId: "usdc", target: other }),
    changedQuote(swap, { outputAsset: "usdc" }), changedQuote(swap, { inputAsset: "cirbtc" }),
    changedQuote(swap, {}, { router: other }),
    changedStep(swap, 0, { spender: other }), changedStep(swap, 0, { amount: 20_000_000n }),
    changedStep(swap, 0, { assetId: "eurc" }),
    changedQuote(bridge, { inputAsset: "eurc" }), changedQuote(bridge, { inputAsset: "cirbtc" }),
    changedQuote(bridge, { destinationChainId: arcTestnet.id }), changedStep(bridge, 1, { target: other }),
    changedStep(bridge, 0, { spender: other }),
    ...[0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY].map((slippage) => changedQuote(swap, {}, { slippage })),
    changedQuote(swap, {}, { minimumReceived: undefined }), changedQuote(swap, {}, { minimumReceived: 99_000_000n }),
    changedStep(swap, 1, { minimumOutput: 1n }),
  ].entries()) assert.equal(evaluatePolicy(attack[1]).decision, "BLOCK", `substitution ${attack[0]}`);
  assert.equal(evaluatePolicy(send).decision, "ALLOW", "ordinary Send recipient remains user controlled");
});

test("9F quote and preparation mutations retain REQUOTE, REVALIDATE and BLOCK precedence", async () => {
  const send = await evidence();
  const prepared = send.preparation as Extract<PolicyInput["preparation"], { status: "PREPARED" }>;
  const staleNetwork = { tool: "network.verified", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "snapshot", source: ["wallet-provider"], status: "UNAVAILABLE", error: "PROVIDER_FAILURE" } as const;
  const expired = { ...send, now: now + 60_001 };
  assert.equal(evaluatePolicy(expired).decision, "REQUOTE");
  assert.equal(evaluatePolicy({ ...send, network: staleNetwork }).decision, "REVALIDATE");
  assert.equal(evaluatePolicy({ ...expired, network: staleNetwork }).decision, "REQUOTE");
  assert.equal(evaluatePolicy({ ...expired, chainId: baseSepolia.id }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...send, network: staleNetwork, preparation: { ...prepared, data: { ...prepared.data, steps: [{ ...prepared.data.steps[0], target: other }] } } }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...send, preparation: { ...prepared, data: { ...prepared.data, executionEnabled: true } } as PolicyInput["preparation"] }).decision, "BLOCK");
  assert.equal(evaluatePolicy({ ...send, preparation: { ...prepared, data: { ...prepared.data, quoteFingerprint: `0x${"00".repeat(32)}` } } }).decision, "REQUOTE");
});

test("9F final gate rejects unavailable identity, stale reads and dependent-step shortcuts", async () => {
  const send = await finalEvidence(), swap = await finalEvidence("SWAP"), bridge = await finalEvidence("BRIDGE");
  const unavailableWallet = { ...send.current.wallet, status: "UNAVAILABLE", error: "WALLET_UNAVAILABLE" } as FinalPolicyInput["current"]["wallet"];
  assert.equal(evaluateFinalPolicy({ ...send, current: { ...send.current, wallet: unavailableWallet } }).mustStop, true);
  assert.equal(evaluateFinalPolicy({ ...send, current: { ...send.current, balances: { ...send.current.balances, observedAt: null, freshness: "unknown" } as FinalPolicyInput["current"]["balances"] } }).decision, "REVALIDATE");
  assert.equal(evaluateFinalPolicy({ ...send, current: { ...send.current, simulation: { ...send.current.simulation, quoteFingerprint: `0x${"00".repeat(32)}` } } }).decision, "BLOCK");
  assert.equal(evaluateFinalPolicy({ ...swap, stepIndex: 1, priorStepConfirmed: false }).mustStop, true);
  assert.equal(evaluateFinalPolicy({ ...bridge, stepIndex: 1, priorStepConfirmed: false }).mustStop, true);
  assert.equal(evaluateFinalPolicy({ ...bridge, current: { ...bridge.current, allowance: { ...bridge.current.allowance!, status: "UNAVAILABLE", error: "PROVIDER_FAILURE" } as FinalPolicyInput["current"]["allowance"] } }).mustStop, true);
});
