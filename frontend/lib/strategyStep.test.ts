import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { runPrepareTool } from "./agent/prepareTools.ts";
import { runQuoteTool } from "./agent/quoteTools.ts";
import { runReadTool, type ReceiptEvidence, type ReadResult } from "./agent/readTools.ts";
import { quoteFingerprint } from "./agent/toolSchemas.ts";
import { getAssetById } from "./assets.ts";
import { CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import type { FinalPolicyInput } from "./policyEngine.ts";
import { type ActionStep, type Strategy } from "./strategyModel.ts";
import { executeStrategyStep, type StrategyDependencyEvidence } from "./strategyStep.ts";
import { XYLO_ROUTER } from "./swap.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const now = 1_000_000;
const balances = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };
const snapshot = createAgentContextSnapshot({ connected: true, account, walletStatus: "connected", accountKind: "external", verifiedChainId: arcTestnet.id, isArc: true, balances, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: now });
const context = { snapshot, now: () => now, reads: { readBalance: async (_owner: typeof account, asset: keyof typeof balances) => balances[asset], readAllowance: async () => 0n }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: now }), readDirectCctpFee: async () => ({ finalityThreshold: 2000 as const, minimumFee: 1, forwardFeeMed: "200000", quotedAt: now }) } };

async function evidence(action: "SEND" | "SWAP" | "BRIDGE", allowance = 0n): Promise<FinalPolicyInput> {
  const ctx = { ...context, reads: { ...context.reads, readAllowance: async () => allowance } };
  const wallet = await runReadTool(ctx, { tool: "wallet.state" });
  const network = await runReadTool(ctx, { tool: "network.verified" });
  const amount = 10_000_000n;
  const quote = action === "SEND" ? await runQuoteTool(ctx, { tool: "send.quote", account, chainId: arcTestnet.id, assetId: "usdc", amount, recipient })
    : action === "SWAP" ? await runQuoteTool(ctx, { tool: "swap.quote", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount, slippage: 0.005 })
    : await runQuoteTool(ctx, { tool: "bridge.quote", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount, recipient: account, route: "cctp-direct-forwarding" });
  const preparation = action === "SEND" ? await runPrepareTool(ctx, { tool: "send.prepare", account, chainId: arcTestnet.id, assetId: "usdc", amount, recipient, quote })
    : action === "SWAP" ? await runPrepareTool(ctx, { tool: "swap.prepare", account, chainId: arcTestnet.id, inputAsset: "usdc", outputAsset: "eurc", amount, slippage: 0.005, quote })
    : await runPrepareTool(ctx, { tool: "bridge.prepare", account, chainId: arcTestnet.id, destinationChainId: baseSepolia.id, assetId: "usdc", amount, recipient: account, route: "cctp-direct-forwarding", quote });
  if (preparation.status !== "PREPARED" || quote.status !== "AVAILABLE") throw Error("fixture requires canonical evidence");
  const quoteData = quote.data as Record<string, unknown>;
  const balanceRead = { tool: "assets.balances", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: balances } as const;
  const allowanceRead = { tool: "token.allowance", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: { assetId: "usdc", token: getAssetById("usdc")!.address, owner: account, spender: action === "SWAP" ? XYLO_ROUTER : CCTP_TOKEN_MESSENGER_V2, amount: allowance } } as const;
  const fee = action === "SEND" ? { status: "available", observedAt: now, maximumFeeRaw18: quoteData.maximumFeeRaw18 as bigint, maximumFeeUsdc6: quoteData.maximumFeeUsdc6 as bigint, gasBalanceRaw18: 10_000_000_000_000_000n }
    : action === "BRIDGE" ? { status: "available", observedAt: now, cctpMaximumFee: quoteData.maximumFee as bigint, cctpSourceDebit: quoteData.sourceDebit as bigint }
    : { status: "not-estimated", observedAt: now };
  return { action, account, chainId: arcTestnet.id, now, wallet, network, quote, preparation, stepIndex: 0, current: { wallet, network, balances: balanceRead, ...(action === "SEND" ? {} : { allowance: allowanceRead }), quote, fee: fee as FinalPolicyInput["current"]["fee"], simulation: { status: "passed", account, chainId: arcTestnet.id, request: preparation.data.steps[0].request, quoteFingerprint: preparation.data.quoteFingerprint, observedAt: now } } };
}

function actionStep(id: string, action: ActionStep["action"], input: FinalPolicyInput, index = 0, dependsOn: string[] = []): ActionStep {
  if (input.preparation?.status !== "PREPARED") throw Error("fixture requires preparation");
  return { id, kind: "ACTION", action, dependsOn, confirmation: "EXPLICIT_USER_CONFIRMATION", preparedAction: { kind: "PREPARED_ACTION", tool: input.preparation.tool, quoteFingerprint: input.preparation.data.quoteFingerprint, stepIndex: index } };
}
const strategy = (steps: Strategy["steps"]): Strategy => ({ version: 1, id: "strategy-10b", createdAt: now, steps });
const run = (input: FinalPolicyInput, steps: Strategy["steps"], stepId = steps[0].id, dependencies: StrategyDependencyEvidence[] = []) => executeStrategyStep({ strategy: strategy(steps), stepId, policyInput: input, dependencies });
const receipt = (stepId: string, action: ActionStep, overrides: Partial<ReadResult<ReceiptEvidence>> = {}): StrategyDependencyEvidence => ({ kind: "CONFIRMED_RECEIPT", strategyId: "strategy-10b", stepId, actionStepId: action.id, preparedAction: action.preparedAction!, submittedHash: `0x${"a".repeat(64)}`, receipt: { tool: "transaction.receipt", account, chainId: arcTestnet.id, capturedAt: now, observedAt: now, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: { hash: `0x${"a".repeat(64)}`, state: "confirmed", verified: true, blockNumber: 1n }, ...overrides } as ReadResult<ReceiptEvidence> });

test("one Send reaches only the existing wallet review handoff", async () => {
  const input = await evidence("SEND");
  const step = actionStep("send", "SEND", input);
  const result = run(input, [step]);
  assert.equal(result.status, "READY_FOR_WALLET_REVIEW");
  if (result.status === "READY_FOR_WALLET_REVIEW") { assert.equal(result.action, "SEND"); assert.equal(result.confirmation, "EXPLICIT_USER_CONFIRMATION"); assert.equal(result.policy.mustStop, false); assert.equal(result.handoff.action, "send"); }
});

test("one finite Xylo approval reaches review without advancing to Swap", async () => {
  const input = await evidence("SWAP");
  const approval = actionStep("approve", "APPROVE", input);
  const later = actionStep("swap", "SWAP", input, 1, ["approve"]);
  const result = run(input, [approval, later], "approve");
  assert.equal(result.status, "READY_FOR_WALLET_REVIEW");
  if (result.status === "READY_FOR_WALLET_REVIEW") { assert.equal(result.action, "APPROVE"); assert.equal(result.stepId, "approve"); assert.equal(result.handoff.action, "swap"); }
});

test("Swap with receipt and revalidation dependencies requires bound canonical evidence", async () => {
  const first = await evidence("SWAP");
  const input = await evidence("SWAP", 10_000_000n);
  const approval = actionStep("approve", "APPROVE", first);
  const wait = { id: "wait", kind: "WAIT_RECEIPT", dependsOn: ["approve"], receipt: { kind: "RECEIPT", actionStepId: "approve" } } as const;
  const refresh = { id: "refresh", kind: "REVALIDATE", dependsOn: ["wait"] } as const;
  const swap = actionStep("swap", "SWAP", input, 0, ["refresh"]);
  const steps = [approval, wait, refresh, swap];
  assert.equal(run(input, steps, "swap").status, "DEPENDENCY_NOT_SATISFIED");
  const good = [receipt("approve", approval), receipt("wait", approval), { kind: "CURRENT_REVALIDATION", stepId: "refresh", quoteFingerprint: quoteFingerprint(input.current.quote) } as const];
  assert.equal(run(input, steps, "swap", [receipt("approve", approval), { ...good[1], actionStepId: "wrong" }, good[2]]).status, "DEPENDENCY_NOT_SATISFIED");
  assert.equal(run(input, steps, "swap", [{ ...good[0], stepId: "wrong" }, good[1], good[2]]).status, "DEPENDENCY_NOT_SATISFIED");
  assert.equal(run(input, steps, "swap", [{ ...good[0], submittedHash: `0x${"b".repeat(64)}` }, good[1], good[2]]).status, "DEPENDENCY_NOT_SATISFIED");
  assert.equal(run(input, steps, "swap", [{ ...good[0], strategyId: "other" }, good[1], good[2]]).status, "DEPENDENCY_NOT_SATISFIED");
  const result = run(input, steps, "swap", good);
  assert.equal(result.status, "READY_FOR_WALLET_REVIEW");
  if (result.status === "READY_FOR_WALLET_REVIEW") { assert.equal(result.stepId, "swap"); assert.equal(result.action, "SWAP"); }
});

test("Direct CCTP Bridge has no canonical Agent wallet handoff", async () => {
  const input = await evidence("BRIDGE", 10_201_000n);
  const step = actionStep("bridge", "BRIDGE", input);
  const result = run(input, [step]);
  assert.equal(result.status, "UNSUPPORTED");
});

test("policy BLOCK, REQUOTE, REVALIDATE stop before review", async () => {
  const input = await evidence("SEND");
  const step = actionStep("send", "SEND", input);
  const cases = [
    { ...input, current: { ...input.current, simulation: { ...input.current.simulation, status: "reverted" as const } } },
    { ...input, now: now + 60_001 },
    { ...input, current: { ...input.current, simulation: { ...input.current.simulation, status: "unavailable" as const } } },
  ];
  for (const [index, candidate] of cases.entries()) {
    const result = run(candidate, [step]);
    assert.equal(result.status, "POLICY_STOP");
    if (result.status === "POLICY_STOP") assert.equal(result.policy.decision, ["BLOCK", "REQUOTE", "REVALIDATE"][index]);
  }
});

test("invalid strategy, wrong step, artifact substitution and non-action steps do not execute", async () => {
  const input = await evidence("SEND");
  const step = actionStep("send", "SEND", input);
  assert.equal(executeStrategyStep({ strategy: { ...strategy([step]), steps: [step, step] }, stepId: "send", policyInput: input }).status, "INVALID_STRATEGY");
  assert.equal(run(input, [step], "missing").status, "INVALID_EVIDENCE");
  assert.equal(run({ ...input, stepIndex: 1 }, [step]).status, "INVALID_EVIDENCE");
  assert.equal(run({ ...input, current: undefined } as unknown as FinalPolicyInput, [step]).status, "INVALID_EVIDENCE");
  assert.equal(run(input, [{ ...step, preparedAction: { ...step.preparedAction!, quoteFingerprint: `0x${"b".repeat(64)}` } }]).status, "INVALID_EVIDENCE");
  if (input.preparation?.status === "PREPARED") {
    const corrupted = { ...input, preparation: { ...input.preparation, data: { ...input.preparation.data, handoff: { ...input.preparation.data.handoff!, account: recipient } } } } as FinalPolicyInput;
    assert.notEqual(run(corrupted, [step]).status, "READY_FOR_WALLET_REVIEW");
  }
  const wait = { id: "wait", kind: "WAIT_RECEIPT", dependsOn: ["send"], receipt: { kind: "RECEIPT", actionStepId: "send" } } as const;
  const refresh = { id: "refresh", kind: "REVALIDATE", dependsOn: ["wait"] } as const;
  assert.deepEqual(run(input, [step, wait, refresh], "wait"), { status: "NON_EXECUTABLE_STEP", stepId: "wait", kind: "WAIT_RECEIPT", requiredEvidence: "CONFIRMED_RECEIPT" });
  assert.deepEqual(run(input, [step, wait, refresh], "refresh"), { status: "NON_EXECUTABLE_STEP", stepId: "refresh", kind: "REVALIDATE", requiredEvidence: "CURRENT_REVALIDATION" });
});

test("runtime carries no wallet writer, provider call or signing authority", () => {
  const source = readFileSync(new URL("./strategyStep.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /privateKey|mnemonic|seed|password|walletClient|sendTransaction|writeContract|broadcast|unlock|runReadTool|runQuoteTool|runPrepareTool/);
});
