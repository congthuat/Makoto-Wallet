import { getAddress, isAddress, isHash, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { runQuoteTool, type QuoteContext, type QuoteResult, type SwapQuoteData } from "./agent/quoteTools.ts";
import { runReadTool, type Allowance, type Balances, type ReadResult, type VerifiedNetwork, type WalletState } from "./agent/readTools.ts";
import { quoteFingerprint, validatePrepareResult, validateQuoteResult, validateReadResult } from "./agent/toolSchemas.ts";
import { CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import { evaluateFinalPolicy, type FinalPolicyInput, type PolicyResult } from "./policyEngine.ts";
import type { StrategyReceiptResult } from "./strategyReceipt.ts";
import type { StrategyDependencyEvidence } from "./strategyStep.ts";
import { validateStrategy, type ActionStep, type Strategy } from "./strategyModel.ts";
import { XYLO_ROUTER } from "./swap.ts";

export type PostReceiptRequest = Readonly<{
  strategy: unknown;
  priorStepId: string;
  selectedStepId: string;
  expectedSubmittedHash: Hash;
  receipt: StrategyReceiptResult;
  baselineQuote: QuoteResult<unknown>;
  now: number;
}>;

export type PostReceiptFreshEvidence = Readonly<{
  strategyId: string;
  selectedStepId: string;
  priorStepId: string;
  priorHash: Hash;
  receiptObservedAt: number;
  wallet: ReadResult<WalletState>;
  network: ReadResult<VerifiedNetwork>;
  balances: ReadResult<Balances>;
  allowance?: ReadResult<Allowance>;
  quote: QuoteResult<unknown>;
}>;

export type PostReceiptResult =
  | Readonly<{ status: "READY_WITH_FRESH_EVIDENCE"; strategyId: string; selectedStepId: string; action: ActionStep["action"]; evidence: FreshEvidenceSummary; policy: PolicyResult; dependencies: readonly StrategyDependencyEvidence[] }>
  | Readonly<{ status: "REQUOTE_REQUIRED" | "REVALIDATION_REQUIRED"; reason: string; evidence?: FreshEvidenceSummary; policy?: PolicyResult }>
  | Readonly<{ status: "POLICY_STOP"; policy: PolicyResult }>
  | Readonly<{ status: "RECEIPT_NOT_CONFIRMED"; receiptStatus: StrategyReceiptResult["status"] }>
  | Readonly<{ status: "UNSUPPORTED"; reason: "STEP" | "ROUTE" | "NO_WALLET_HANDOFF" }>
  | Readonly<{ status: "INVALID_EVIDENCE"; reason: "STRATEGY" | "STEP" | "RECEIPT" | "QUOTE" | "FRESH_EVIDENCE" | "POLICY_INPUT" }>;

/** Data-only summary; canonical BigInt READ/QUOTE objects stay with the caller. */
export type FreshEvidenceSummary = Readonly<{
  strategyId: string;
  selectedStepId: string;
  priorHash: Hash;
  account: string;
  chainId: number;
  observedAt: number;
  quoteFingerprint: `0x${string}`;
  quoteExpiresAt: number;
  balance: string;
  allowance?: string;
}>;

type Validated = Readonly<{ strategy: Strategy; selected: ActionStep; account: string; chainId: number; receiptObservedAt: number }>;
const sameAddress = (a: string, b: string) => isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);

/** Checks explicit ancestry and the strategy-bound 10C proof before any provider access. */
function preflight(input: PostReceiptRequest): Validated | PostReceiptResult {
  if (!Number.isFinite(input.now) || input.now < 0 || !isHash(input.expectedSubmittedHash)) return { status: "INVALID_EVIDENCE", reason: "RECEIPT" };
  const checked = validateStrategy(input.strategy);
  if (!checked.valid) return { status: "INVALID_EVIDENCE", reason: "STRATEGY" };
  const strategy = checked.value;
  const selected = strategy.steps.find((step) => step.id === input.selectedStepId);
  const prior = strategy.steps.find((step) => step.id === input.priorStepId);
  if (!selected || !prior || prior.kind !== "ACTION" || selected.id === prior.id) return { status: "INVALID_EVIDENCE", reason: "STEP" };
  if (selected.kind !== "ACTION" || selected.action === "APPROVE") return { status: "UNSUPPORTED", reason: "STEP" };
  const byId = new Map(strategy.steps.map((step) => [step.id, step]));
  const ancestors = new Set<string>();
  const visit = (step: string) => { for (const dependency of byId.get(step)!.dependsOn) if (!ancestors.has(dependency)) { ancestors.add(dependency); visit(dependency); } };
  visit(selected.id);
  if (!ancestors.has(prior.id)) return { status: "INVALID_EVIDENCE", reason: "STEP" };
  if (input.receipt.status !== "CONFIRMED") return { status: "RECEIPT_NOT_CONFIRMED", receiptStatus: input.receipt.status };
  const result = input.receipt;
  if (!Array.isArray(result.dependencies)) return { status: "INVALID_EVIDENCE", reason: "RECEIPT" };
  const proof = result.dependencies.find((item) => item.kind === "CONFIRMED_RECEIPT" && item.stepId === prior.id);
  if (!proof || proof.kind !== "CONFIRMED_RECEIPT" || result.strategyId !== strategy.id || result.stepId !== prior.id || result.action !== prior.action || result.scope !== "SOURCE_TRANSACTION" || result.chainId !== arcTestnet.id || !isHash(result.hash) || result.hash.toLowerCase() !== input.expectedSubmittedHash.toLowerCase() || proof.strategyId !== strategy.id || proof.actionStepId !== prior.id || !isHash(proof.submittedHash) || proof.submittedHash.toLowerCase() !== result.hash.toLowerCase() || !prior.preparedAction || proof.preparedAction?.kind !== prior.preparedAction.kind || proof.preparedAction.tool !== prior.preparedAction.tool || proof.preparedAction.quoteFingerprint !== prior.preparedAction.quoteFingerprint || proof.preparedAction.stepIndex !== prior.preparedAction.stepIndex || !validateReadResult(proof.receipt).valid || proof.receipt.tool !== "transaction.receipt" || proof.receipt.status !== "AVAILABLE" || proof.receipt.data.state !== "confirmed" || proof.receipt.data.verified !== true || proof.receipt.data.hash.toLowerCase() !== result.hash.toLowerCase() || proof.receipt.chainId !== result.chainId || !proof.receipt.source.includes("arc-rpc") || proof.receipt.freshness !== "live" || !isAddress(proof.receipt.account ?? "") || proof.receipt.observedAt === null || input.now <= proof.receipt.observedAt) return { status: "INVALID_EVIDENCE", reason: "RECEIPT" };
  if (strategy.steps.some((step) => ancestors.has(step.id) && step.kind === "ACTION" && step.id !== prior.id)) return { status: "REVALIDATION_REQUIRED", reason: "ADDITIONAL_RECEIPT_EVIDENCE_REQUIRED" };
  const quote = input.baselineQuote;
  if (!validateQuoteResult(quote, 0).valid || quote.status !== "AVAILABLE" || !selected.preparedAction || selected.preparedAction.quoteFingerprint !== quoteFingerprint(quote) || selected.preparedAction.tool !== `${quote.tool.replace("quote", "prepare")}` || quote.chainId !== result.chainId || !sameAddress(quote.account, proof.receipt.account!) || quote.tool !== `${selected.action.toLowerCase()}.quote`) return { status: "INVALID_EVIDENCE", reason: "QUOTE" };
  if (selected.action === "BRIDGE" && quote.route !== "cctp-direct-forwarding") return { status: "UNSUPPORTED", reason: "ROUTE" };
  return { strategy, selected, account: quote.account, chainId: quote.chainId, receiptObservedAt: proof.receipt.observedAt };
}

/** One bounded refresh using the existing Phase 8 READ and QUOTE tools. No polling or preparation. */
export async function acquirePostReceiptEvidence(input: PostReceiptRequest, context: QuoteContext): Promise<PostReceiptFreshEvidence | PostReceiptResult> {
  const ready = preflight(input);
  if (!("selected" in ready)) return ready;
  if (context.snapshot.timestamp <= ready.receiptObservedAt || !sameAddress(context.snapshot.account ?? "", ready.account) || context.snapshot.verifiedChainId !== ready.chainId) return { status: "REVALIDATION_REQUIRED", reason: "CURRENT_CONTEXT_UNAVAILABLE" };
  const current = { ...context, now: () => input.now };
  try {
    const reads = { snapshot: current.snapshot, services: current.reads, now: current.now };
    const wallet = await runReadTool(reads, { tool: "wallet.state" });
    const network = await runReadTool(reads, { tool: "network.verified" });
    const balances = await runReadTool(reads, { tool: "assets.balances" });
    const quoteBase = input.baselineQuote;
    if (quoteBase.status !== "AVAILABLE") return { status: "INVALID_EVIDENCE", reason: "QUOTE" };
    const allowance = ready.selected.action === "SWAP" || ready.selected.action === "BRIDGE"
      ? await runReadTool(reads, { tool: "token.allowance", assetId: quoteBase.inputAsset, spender: ready.selected.action === "SWAP" ? XYLO_ROUTER : CCTP_TOKEN_MESSENGER_V2 })
      : undefined;
    if (wallet.status !== "AVAILABLE" || network.status !== "AVAILABLE" || balances.status !== "AVAILABLE" || balances.freshness !== "live" || allowance && (allowance.status !== "AVAILABLE" || allowance.freshness !== "live")) return { status: "REVALIDATION_REQUIRED", reason: "FRESH_READ_UNAVAILABLE" };
    let quote: QuoteResult<unknown>;
    if (ready.selected.action === "SEND") quote = await runQuoteTool(current, { tool: "send.quote", account: quoteBase.account, chainId: quoteBase.chainId, assetId: quoteBase.inputAsset, amount: quoteBase.inputAmount, recipient: quoteBase.recipient! });
    else if (ready.selected.action === "SWAP") quote = await runQuoteTool(current, { tool: "swap.quote", account: quoteBase.account, chainId: quoteBase.chainId, inputAsset: quoteBase.inputAsset, outputAsset: quoteBase.outputAsset!, amount: quoteBase.inputAmount, slippage: (quoteBase.data as SwapQuoteData).slippage });
    else quote = await runQuoteTool(current, { tool: "bridge.quote", account: quoteBase.account, chainId: quoteBase.chainId, destinationChainId: quoteBase.destinationChainId!, assetId: quoteBase.inputAsset, amount: quoteBase.inputAmount, recipient: quoteBase.recipient!, route: "cctp-direct-forwarding" });
    if (quote.status !== "AVAILABLE") return { status: "REQUOTE_REQUIRED", reason: "FRESH_QUOTE_UNAVAILABLE" };
    return { strategyId: ready.strategy.id, selectedStepId: ready.selected.id, priorStepId: input.priorStepId, priorHash: input.expectedSubmittedHash, receiptObservedAt: ready.receiptObservedAt, wallet, network, balances, ...(allowance ? { allowance } : {}), quote };
  } catch { return { status: "REVALIDATION_REQUIRED", reason: "FRESH_READ_FAILED" }; }
}

/** Provider-free assessment. READY means a separate caller may request normal wallet review later. */
export function evaluatePostReceiptRevalidation(input: PostReceiptRequest, fresh: PostReceiptFreshEvidence | PostReceiptResult, policyInput?: FinalPolicyInput): PostReceiptResult {
  const ready = preflight(input);
  if (!("selected" in ready)) return ready;
  if ("status" in fresh) return fresh;
  const quote = fresh.quote;
  if (fresh.strategyId !== ready.strategy.id || fresh.selectedStepId !== ready.selected.id || fresh.priorStepId !== input.priorStepId || !isHash(fresh.priorHash) || fresh.priorHash.toLowerCase() !== input.expectedSubmittedHash.toLowerCase() || fresh.receiptObservedAt !== ready.receiptObservedAt || !validateQuoteResult(quote, 0).valid || quote.tool !== input.baselineQuote.tool || quote.provider !== input.baselineQuote.provider || quote.route !== input.baselineQuote.route || !sameAddress(quote.account, ready.account) || quote.chainId !== ready.chainId || quote.inputAsset !== input.baselineQuote.inputAsset || quote.inputAmount !== input.baselineQuote.inputAmount || quote.outputAsset !== input.baselineQuote.outputAsset || quote.destinationChainId !== input.baselineQuote.destinationChainId || quote.recipient !== input.baselineQuote.recipient) return { status: "INVALID_EVIDENCE", reason: "FRESH_EVIDENCE" };
  if (quote.status !== "AVAILABLE" || quote.expiresAt === null || quote.expiresAt < input.now) return { status: "REQUOTE_REQUIRED", reason: "FRESH_QUOTE_UNAVAILABLE" };
  if (quote.observedAt <= ready.receiptObservedAt) return { status: "REQUOTE_REQUIRED", reason: "FRESH_QUOTE_STALE" };
  const reads = [fresh.wallet, fresh.network, fresh.balances, ...(fresh.allowance ? [fresh.allowance] : [])];
  if (reads.some((item) => !validateReadResult(item).valid || item.status !== "AVAILABLE" || !sameAddress(item.account ?? "", ready.account) || item.chainId !== ready.chainId || (item.observedAt ?? item.capturedAt) <= ready.receiptObservedAt)) return { status: "REVALIDATION_REQUIRED", reason: "FRESH_READ_UNAVAILABLE" };
  if (fresh.balances.freshness !== "live" || ready.selected.action !== "SEND" && (!fresh.allowance || fresh.allowance.freshness !== "live")) return { status: "REVALIDATION_REQUIRED", reason: "LIVE_BALANCE_OR_ALLOWANCE_REQUIRED" };
  const balance = fresh.balances.status === "AVAILABLE" ? fresh.balances.data[quote.inputAsset] : undefined;
  if (balance === undefined) return { status: "REVALIDATION_REQUIRED", reason: "BALANCE_UNAVAILABLE" };
  const summary: FreshEvidenceSummary = { strategyId: ready.strategy.id, selectedStepId: ready.selected.id, priorHash: input.expectedSubmittedHash, account: ready.account, chainId: ready.chainId, observedAt: quote.observedAt, quoteFingerprint: quoteFingerprint(quote), quoteExpiresAt: quote.expiresAt, balance: balance.toString(), ...(fresh.allowance?.status === "AVAILABLE" ? { allowance: fresh.allowance.data.amount.toString() } : {}) };
  if (summary.quoteFingerprint !== ready.selected.preparedAction?.quoteFingerprint) return { status: "REQUOTE_REQUIRED", reason: "FRESH_QUOTE_CHANGED", evidence: summary };
  const preparedKind = ready.selected.action === "SEND" ? "send" : ready.selected.action === "SWAP" ? "swap" : "cctp-burn";
  if (!policyInput?.preparation || !validatePrepareResult(policyInput.preparation, { now: 0 }).valid || policyInput.preparation.status !== "PREPARED" || policyInput.preparation.data.quoteFingerprint !== summary.quoteFingerprint || policyInput.preparation.data.preparedAt <= ready.receiptObservedAt || policyInput.preparation.data.steps[ready.selected.preparedAction!.stepIndex]?.kind !== preparedKind || policyInput.stepIndex !== ready.selected.preparedAction?.stepIndex || policyInput.action !== ready.selected.action || !sameAddress(policyInput.account, ready.account) || policyInput.chainId !== ready.chainId || !policyInput.current?.fee || !policyInput.current.simulation) return { status: "REVALIDATION_REQUIRED", reason: "FRESH_FINAL_EVIDENCE_REQUIRED", evidence: summary };
  const finalInput: FinalPolicyInput = { ...policyInput, now: input.now, wallet: fresh.wallet, network: fresh.network, quote, priorStepConfirmed: true, current: { ...policyInput.current, wallet: fresh.wallet, network: fresh.network, balances: fresh.balances, ...(fresh.allowance ? { allowance: fresh.allowance } : {}), quote } };
  let policy: PolicyResult;
  try { policy = evaluateFinalPolicy(finalInput); } catch { return { status: "INVALID_EVIDENCE", reason: "POLICY_INPUT" }; }
  if (policy.decision === "BLOCK") return { status: "POLICY_STOP", policy };
  if (policy.decision === "REQUOTE") return { status: "REQUOTE_REQUIRED", reason: "PHASE_9_REQUOTE", evidence: summary, policy };
  if (policy.decision === "REVALIDATE") return { status: "REVALIDATION_REQUIRED", reason: "PHASE_9_REVALIDATE", evidence: summary, policy };
  if (policy.mustStop) return { status: "POLICY_STOP", policy };
  if (policyInput.current.fee.observedAt <= ready.receiptObservedAt || policyInput.current.simulation.observedAt <= ready.receiptObservedAt) return { status: "REVALIDATION_REQUIRED", reason: "POST_RECEIPT_FINAL_EVIDENCE_REQUIRED", evidence: summary, policy };
  if (ready.selected.action === "BRIDGE") return { status: "UNSUPPORTED", reason: "NO_WALLET_HANDOFF" };
  const byId = new Map(ready.strategy.steps.map((step) => [step.id, step]));
  const ancestors = new Set<string>();
  const visit = (stepId: string) => { for (const dependency of byId.get(stepId)!.dependsOn) if (!ancestors.has(dependency)) { ancestors.add(dependency); visit(dependency); } };
  visit(ready.selected.id);
  const revalidations = ready.strategy.steps.filter((step) => ancestors.has(step.id) && step.kind === "REVALIDATE");
  if (revalidations.some((step) => step.kind === "REVALIDATE" && step.policy)) return { status: "REVALIDATION_REQUIRED", reason: "POLICY_REFERENCE_UNRESOLVED", evidence: summary, policy };
  if (revalidations.some((step) => step.kind === "REVALIDATE" && step.quote && (step.quote.tool !== quote.tool || step.quote.fingerprint !== summary.quoteFingerprint))) return { status: "REQUOTE_REQUIRED", reason: "REVALIDATE_QUOTE_CHANGED", evidence: summary, policy };
  const dependencies: StrategyDependencyEvidence[] = revalidations.map((step) => ({ kind: "CURRENT_REVALIDATION", stepId: step.id, quoteFingerprint: summary.quoteFingerprint }));
  return { status: "READY_WITH_FRESH_EVIDENCE", strategyId: ready.strategy.id, selectedStepId: ready.selected.id, action: ready.selected.action, evidence: summary, policy, dependencies };
}
