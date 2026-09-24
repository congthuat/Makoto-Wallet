import { getAddress, isAddress, maxUint256, zeroAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById } from "./assets.ts";
import { CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import { isSwapQuoteFresh, minimumSwapOutput, SWAP_SLIPPAGE_OPTIONS, XYLO_POOL, XYLO_ROUTER, type PreparedXyloSwapRequest, type SwapQuote } from "./swap.ts";
import type { PrepareResult } from "./agent/prepareTools.ts";
import type { QuoteResult } from "./agent/quoteTools.ts";
import type { Allowance, Balances, ReadResult, VerifiedNetwork, WalletState } from "./agent/readTools.ts";
import { quoteFingerprint, validatePrepareResult, validateQuoteResult, validateReadResult } from "./agent/toolSchemas.ts";
import { revalidateTransactionReview, type NormalizedTransactionRequest, type TransactionRequestInput, type TransactionReviewSnapshot } from "./transactionOrchestrator.ts";
import type { TransactionIntent } from "./transactionSafety.ts";

export type PolicyAction = "SEND" | "SWAP" | "BRIDGE";
export type PolicyDecision = "ALLOW" | "WARN" | "REQUIRE_REVIEW" | "REVALIDATE" | "REQUOTE" | "BLOCK";
export type PolicyReason =
  | "INVALID_CONTEXT" | "ACCOUNT_MISMATCH" | "CHAIN_MISMATCH" | "WALLET_UNAVAILABLE"
  | "MISSING_EVIDENCE" | "MALFORMED_EVIDENCE" | "UNAVAILABLE_EVIDENCE"
  | "UNSUPPORTED_ACTION" | "EXPIRED_QUOTE" | "QUOTE_MISMATCH" | "PREPARATION_MISMATCH"
  | "EXECUTION_AUTHORITY" | "REQUIRES_REVIEW" | "QUOTE_WARNING" | "PREPARATION_LIMITATION"
  | "UNSUPPORTED_CHAIN" | "UNSUPPORTED_TOKEN" | "UNSUPPORTED_PAIR" | "UNSUPPORTED_ROUTE"
  | "UNTRUSTED_TARGET" | "SPENDER_MISMATCH" | "APPROVAL_UNBOUNDED" | "APPROVAL_AMOUNT_MISMATCH"
  | "SLIPPAGE_UNSUPPORTED" | "MIN_OUTPUT_INVALID"
  | "STALE_EVIDENCE" | "BALANCE_INSUFFICIENT" | "ALLOWANCE_CHANGED" | "FEE_UNAVAILABLE"
  | "FEE_CHANGED" | "SIMULATION_FAILED" | "SIMULATION_UNAVAILABLE" | "SIMULATION_MISMATCH";
export type PolicyFinding = Readonly<{ code: PolicyReason; decision: PolicyDecision; evidence: string }>;
export type PolicyInput = Readonly<{
  action: PolicyAction;
  account: string;
  chainId: number;
  now: number;
  wallet?: ReadResult<WalletState>;
  network?: ReadResult<VerifiedNetwork>;
  quote?: QuoteResult<unknown>;
  preparation?: PrepareResult;
}>;
export type PolicyResult = Readonly<{
  decision: PolicyDecision;
  findings: readonly PolicyFinding[];
  winningReason?: PolicyReason;
  requiredAction: "NONE" | "REVIEW" | "REVALIDATE" | "REQUOTE" | "STOP";
  mustStop: boolean;
  requiresUserReview: boolean;
  requiresFreshQuote: boolean;
  requiresRevalidation: boolean;
}>;

/** This order applies to every finding; input traversal never decides the winner. */
const precedence: readonly PolicyDecision[] = ["ALLOW", "WARN", "REQUIRE_REVIEW", "REVALIDATE", "REQUOTE", "BLOCK"];
const tools: Record<PolicyAction, { quote: string; prepare: string }> = {
  SEND: { quote: "send.quote", prepare: "send.prepare" },
  SWAP: { quote: "swap.quote", prepare: "swap.prepare" },
  BRIDGE: { quote: "bridge.quote", prepare: "bridge.prepare" },
};
const sameAddress = (a: string, b: string) => getAddress(a) === getAddress(b);
const matchesAddress = (value: unknown, expected: string) => typeof value === "string" && isAddress(value) && sameAddress(value, expected);
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Pure assessment of already obtained canonical evidence. ALLOW never authorizes execution.
 * mustStop prevents progression to wallet review; a non-stopping decision still needs user consent.
 */
export function evaluatePolicy(input: PolicyInput): PolicyResult {
  if (!Number.isFinite(input.now) || input.now < 0) throw new RangeError("Policy evaluation requires an explicit finite observation time.");
  const findings: PolicyFinding[] = [];
  const add = (code: PolicyReason, decision: PolicyDecision, evidence: string) => findings.push({ code, decision, evidence });
  const route = tools[input.action];
  if (!route) add("UNSUPPORTED_ACTION", "BLOCK", "action");
  if (typeof input.account !== "string" || !isAddress(input.account) || input.account.toLowerCase() === zeroAddress || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) add("INVALID_CONTEXT", "BLOCK", "account/chainId");
  if (Number.isSafeInteger(input.chainId) && input.chainId > 0 && input.chainId !== arcTestnet.id) add("UNSUPPORTED_CHAIN", "BLOCK", "chainId");
  if (!input.wallet) add("MISSING_EVIDENCE", "BLOCK", "wallet.state");
  else if (!validateReadResult(input.wallet).valid || input.wallet.tool !== "wallet.state") add("MALFORMED_EVIDENCE", "BLOCK", "wallet.state");
  else if (input.wallet.status === "UNAVAILABLE") add("UNAVAILABLE_EVIDENCE", "REVALIDATE", "wallet.state");
  else if (input.wallet.status === "PARTIAL") add("UNAVAILABLE_EVIDENCE", "REVALIDATE", "wallet.state");
  else {
    if (!input.wallet.data.exists || input.wallet.data.status === "locked") add("WALLET_UNAVAILABLE", "BLOCK", "wallet.state.data.status");
    else if (input.wallet.data.status !== "connected") add("UNAVAILABLE_EVIDENCE", "REVALIDATE", "wallet.state.data.status");
    if (typeof input.account === "string" && isAddress(input.account) && (!input.wallet.account || !sameAddress(input.wallet.account, input.account))) add("ACCOUNT_MISMATCH", "BLOCK", "wallet.state.account");
  }
  if (!input.network) add("MISSING_EVIDENCE", "BLOCK", "network.verified");
  else if (!validateReadResult(input.network).valid || input.network.tool !== "network.verified") add("MALFORMED_EVIDENCE", "BLOCK", "network.verified");
  else if (input.network.status !== "AVAILABLE" || input.network.data.chainId === undefined) add("UNAVAILABLE_EVIDENCE", "REVALIDATE", "network.verified");
  else if (input.network.data.chainId !== input.chainId) add("CHAIN_MISMATCH", "BLOCK", "network.verified.data.chainId");

  const quote = input.quote;
  // Static product rules use supplied evidence only. Schema validation below remains the structural gate.
  const quoteData = quote?.status === "AVAILABLE" ? record(quote.data) : undefined;
  if (quote) {
    if (quote.chainId !== arcTestnet.id) add("UNSUPPORTED_CHAIN", "BLOCK", "quote.chainId");
    const asset = getAssetById(quote.inputAsset);
    if (!asset || asset.chainId !== arcTestnet.id) add("UNSUPPORTED_TOKEN", "BLOCK", "quote.inputAsset");
    if (input.action === "SEND") {
      if (quote.provider !== "Arc RPC" || quote.route !== undefined || quote.destinationChainId !== undefined) add("UNSUPPORTED_ROUTE", "BLOCK", "quote.provider/route");
    } else if (input.action === "SWAP") {
      if (quote.provider !== "XyloNet StableSwap" || quote.route !== "xylonet-stableswap") add("UNSUPPORTED_ROUTE", "BLOCK", "quote.provider/route");
      if (!((quote.inputAsset === "usdc" && quote.outputAsset === "eurc") || (quote.inputAsset === "eurc" && quote.outputAsset === "usdc"))) add("UNSUPPORTED_PAIR", "BLOCK", "quote.inputAsset/outputAsset");
      if (quoteData) {
        if (!matchesAddress(quoteData.router, XYLO_ROUTER)) add("UNTRUSTED_TARGET", "BLOCK", "quote.data.router");
        if (quoteData.route !== "xylonet-stableswap" || quoteData.outputAsset !== quote.outputAsset) add("UNSUPPORTED_ROUTE", "BLOCK", "quote.data.route/outputAsset");
        const slippage = quoteData.slippage;
        if (typeof slippage !== "number" || !Number.isFinite(slippage) || !SWAP_SLIPPAGE_OPTIONS.includes(slippage as typeof SWAP_SLIPPAGE_OPTIONS[number])) add("SLIPPAGE_UNSUPPORTED", "BLOCK", "quote.data.slippage");
        const expected = quoteData.expectedOutput, minimum = quoteData.minimumReceived;
        if (typeof expected !== "bigint" || expected <= 0n || typeof minimum !== "bigint" || minimum <= 0n || minimum > expected || typeof slippage === "number" && SWAP_SLIPPAGE_OPTIONS.includes(slippage as typeof SWAP_SLIPPAGE_OPTIONS[number]) && minimum !== minimumSwapOutput(expected, slippage as typeof SWAP_SLIPPAGE_OPTIONS[number])) add("MIN_OUTPUT_INVALID", "BLOCK", "quote.data.minimumReceived");
      }
    } else if (input.action === "BRIDGE") {
      if (quote.inputAsset !== "usdc") add("UNSUPPORTED_TOKEN", "BLOCK", "quote.inputAsset");
      if (quote.destinationChainId !== baseSepolia.id) add("UNSUPPORTED_CHAIN", "BLOCK", "quote.destinationChainId");
      if (quote.provider !== "Circle CCTP V2 Forwarding" || quote.route !== "cctp-direct-forwarding") add("UNSUPPORTED_ROUTE", "BLOCK", "quote.provider/route");
      if (quoteData && !matchesAddress(quoteData.spender, CCTP_TOKEN_MESSENGER_V2)) add("SPENDER_MISMATCH", "BLOCK", "quote.data.spender");
    }
  }
  if (!quote) add("MISSING_EVIDENCE", "BLOCK", "quote");
  else {
    // Validate structure at a neutral time; expiry is a policy outcome below.
    const validation = validateQuoteResult(quote, 0);
    if (!validation.valid) add("MALFORMED_EVIDENCE", "BLOCK", "quote");
    else {
      if (!route || quote.tool !== route.quote) add("QUOTE_MISMATCH", "REQUOTE", "quote.tool");
      if (quote.status === "UNSUPPORTED") add("UNSUPPORTED_ACTION", "BLOCK", "quote.status");
      else if (quote.status === "EXPIRED" || quote.expiresAt !== null && input.now > quote.expiresAt) add("EXPIRED_QUOTE", "REQUOTE", "quote.expiresAt");
      else if (quote.status !== "AVAILABLE") add("UNAVAILABLE_EVIDENCE", "REQUOTE", "quote.status");
      if (typeof input.account === "string" && isAddress(input.account) && !sameAddress(quote.account, input.account)) add("ACCOUNT_MISMATCH", "BLOCK", "quote.account");
      if (quote.chainId !== input.chainId) add("CHAIN_MISMATCH", "BLOCK", "quote.chainId");
      if (quote.status === "AVAILABLE" && quote.warnings.length) add("QUOTE_WARNING", "WARN", "quote.warnings");
    }
  }

  const preparation = input.preparation;
  if (preparation?.status === "PREPARED") {
    const prepared = record(preparation.data);
    if (prepared) {
      if (prepared.chainId !== arcTestnet.id) add("UNSUPPORTED_CHAIN", "BLOCK", "preparation.data.chainId");
      if (!getAssetById(String(prepared.inputAsset)) || input.action === "BRIDGE" && prepared.inputAsset !== "usdc") add("UNSUPPORTED_TOKEN", "BLOCK", "preparation.data.inputAsset");
      if (input.action === "SWAP" && (prepared.provider !== "XyloNet StableSwap" || prepared.route !== "xylonet-stableswap") || input.action === "BRIDGE" && (prepared.provider !== "Circle CCTP V2 Forwarding" || prepared.route !== "cctp-direct-forwarding") || input.action === "SEND" && (prepared.provider !== "Arc RPC" || prepared.route !== undefined || prepared.destinationChainId !== undefined)) add("UNSUPPORTED_ROUTE", "BLOCK", "preparation.data.provider/route");
      if (input.action === "BRIDGE" && prepared.destinationChainId !== baseSepolia.id) add("UNSUPPORTED_CHAIN", "BLOCK", "preparation.data.destinationChainId");
      const steps = Array.isArray(prepared.steps) ? prepared.steps : [];
      const expectedSpender = input.action === "SWAP" ? XYLO_ROUTER : input.action === "BRIDGE" ? CCTP_TOKEN_MESSENGER_V2 : undefined;
      const required = input.action === "BRIDGE" ? quoteData?.sourceDebit : quote?.inputAmount;
      const allowance = quoteData?.allowance;
      const approvalRequired = typeof allowance === "bigint" && typeof required === "bigint" ? allowance < required : undefined;
      const approvals = steps.map(record).filter((step) => step?.kind === "finite-approval");
      if (expectedSpender && (approvalRequired === undefined || prepared.allowance !== allowance || quoteData?.approvalRequired !== approvalRequired || approvalRequired && quoteData?.approvalAmount !== required || !approvalRequired && quoteData?.approvalAmount !== undefined)) add("APPROVAL_AMOUNT_MISMATCH", "BLOCK", "quote.data.allowance/approvalAmount");
      if (expectedSpender && approvalRequired !== undefined && (approvalRequired ? approvals.length !== 1 : approvals.length !== 0)) add("APPROVAL_AMOUNT_MISMATCH", "BLOCK", "preparation.data.steps");
      for (const [index, rawStep] of steps.entries()) {
        const step = record(rawStep);
        if (!step) continue;
        const path = `preparation.data.steps[${index}]`;
        if (step.chainId !== arcTestnet.id) add("UNSUPPORTED_CHAIN", "BLOCK", `${path}.chainId`);
        const asset = getAssetById(String(step.assetId));
        if (!asset || step.assetId !== prepared.inputAsset || step.assetId !== quote?.inputAsset || input.action === "BRIDGE" && step.assetId !== "usdc") add("UNSUPPORTED_TOKEN", "BLOCK", `${path}.assetId`);
        const target = step.kind === "send" || step.kind === "finite-approval" ? asset?.address : step.kind === "swap" ? XYLO_ROUTER : step.kind === "cctp-burn" ? CCTP_TOKEN_MESSENGER_V2 : undefined;
        if (!target || !matchesAddress(step.target, target)) add("UNTRUSTED_TARGET", "BLOCK", `${path}.target`);
        if (expectedSpender && step.kind === "finite-approval") {
          if (!matchesAddress(step.spender, expectedSpender)) add("SPENDER_MISMATCH", "BLOCK", `${path}.spender`);
          if (typeof step.amount !== "bigint" || step.amount <= 0n || step.amount >= maxUint256) add("APPROVAL_UNBOUNDED", "BLOCK", `${path}.amount`);
          else if (typeof required !== "bigint" || step.amount !== required || quoteData?.approvalAmount !== required || prepared.allowance !== allowance) add("APPROVAL_AMOUNT_MISMATCH", "BLOCK", `${path}.amount`);
        }
        if (step.kind === "swap" && (typeof step.minimumOutput !== "bigint" || step.minimumOutput !== quoteData?.minimumReceived)) add("MIN_OUTPUT_INVALID", "BLOCK", `${path}.minimumOutput`);
        if (step.kind === "cctp-burn" && step.destinationChainId !== baseSepolia.id) add("UNSUPPORTED_CHAIN", "BLOCK", `${path}.destinationChainId`);
      }
    }
  }
  if (!preparation) add("MISSING_EVIDENCE", "BLOCK", "preparation");
  else if (preparation.status === "PREPARED" && preparation.data && typeof preparation.data === "object" && (preparation.data as { executionEnabled?: unknown }).executionEnabled !== false) add("EXECUTION_AUTHORITY", "BLOCK", "preparation.data.executionEnabled");
  else {
    const boundQuote = quote?.status === "AVAILABLE" && validateQuoteResult(quote, 0).valid ? quote : undefined;
    const validation = validatePrepareResult(preparation, { now: 0, ...(boundQuote ? { quote: boundQuote } : {}) });
    if (!validation.valid) {
      if (validation.errors.every((issue) => issue.code === "QUOTE_MISMATCH" || issue.code === "QUOTE_EXPIRED")) add("QUOTE_MISMATCH", "REQUOTE", "preparation.data.quoteFingerprint");
      else add("MALFORMED_EVIDENCE", "BLOCK", "preparation");
    }
    else {
      if (!route || preparation.tool !== route.prepare) add("PREPARATION_MISMATCH", "BLOCK", "preparation.tool");
      if (preparation.status === "UNSUPPORTED") add("UNSUPPORTED_ACTION", "BLOCK", "preparation.status");
      else if (preparation.status === "EXPIRED" || preparation.status === "UNAVAILABLE" && preparation.error === "QUOTE_EXPIRED") add("EXPIRED_QUOTE", "REQUOTE", "preparation.status");
      else if (preparation.status === "UNAVAILABLE") add(preparation.error === "QUOTE_MISMATCH" || preparation.error === "QUOTE_UNAVAILABLE" ? "QUOTE_MISMATCH" : "UNAVAILABLE_EVIDENCE", preparation.error === "QUOTE_MISMATCH" || preparation.error === "QUOTE_UNAVAILABLE" ? "REQUOTE" : "REVALIDATE", "preparation.error");
      else if (preparation.status === "PREPARED") {
        const prepared = preparation.data;
        if (typeof input.account === "string" && isAddress(input.account) && !sameAddress(prepared.account, input.account)) add("ACCOUNT_MISMATCH", "BLOCK", "preparation.data.account");
        if (prepared.chainId !== input.chainId) add("CHAIN_MISMATCH", "BLOCK", "preparation.data.chainId");
        if (input.now > prepared.expiresAt) add("EXPIRED_QUOTE", "REQUOTE", "preparation.data.expiresAt");
        if (quote?.status === "AVAILABLE" && (prepared.provider !== quote.provider || prepared.inputAsset !== quote.inputAsset || prepared.inputAmount !== quote.inputAmount || prepared.quoteQuotedAt !== quote.quotedAt)) add("PREPARATION_MISMATCH", "BLOCK", "preparation.data/quote");
        if (prepared.limitations?.length) add("PREPARATION_LIMITATION", "WARN", "preparation.data.limitations");
        if (prepared.steps.length > 1) add("REQUIRES_REVIEW", "REQUIRE_REVIEW", "preparation.data.steps");
      }
    }
  }

  return policyResult(findings);
}

function policyResult(findings: readonly PolicyFinding[]): PolicyResult {
  const decision = findings.reduce<PolicyDecision>((current, finding) => precedence.indexOf(finding.decision) > precedence.indexOf(current) ? finding.decision : current, "ALLOW");
  const winner = findings.find((finding) => finding.decision === decision);
  const requiredAction = decision === "BLOCK" ? "STOP" : decision === "REQUOTE" ? "REQUOTE" : decision === "REVALIDATE" ? "REVALIDATE" : decision === "REQUIRE_REVIEW" ? "REVIEW" : "NONE";
  return { decision, findings, ...(winner ? { winningReason: winner.code } : {}), requiredAction, mustStop: decision === "BLOCK" || decision === "REQUOTE" || decision === "REVALIDATE", requiresUserReview: decision === "ALLOW" || decision === "WARN" || decision === "REQUIRE_REVIEW", requiresFreshQuote: decision === "REQUOTE", requiresRevalidation: decision === "REVALIDATE" };
}

export type FinalSimulationEvidence = Readonly<{
  status: "passed" | "reverted" | "unavailable";
  account: string;
  chainId: number;
  request: NormalizedTransactionRequest;
  quoteFingerprint: string;
  observedAt: number;
}>;
export type FinalFeeEvidence = Readonly<{
  status: "available" | "unavailable" | "not-estimated";
  observedAt: number;
  maximumFeeRaw18?: bigint;
  gasBalanceRaw18?: bigint;
  maximumFeeUsdc6?: bigint;
  cctpMaximumFee?: bigint;
  cctpSourceDebit?: bigint;
}>;
export type FinalPolicyInput = PolicyInput & Readonly<{
  current: Readonly<{
    wallet: ReadResult<WalletState>;
    network: ReadResult<VerifiedNetwork>;
    balances: ReadResult<Balances>;
    allowance?: ReadResult<Allowance>;
    quote: QuoteResult<unknown>;
    fee: FinalFeeEvidence;
    simulation: FinalSimulationEvidence;
  }>;
  stepIndex?: number;
  priorStepConfirmed?: boolean;
}>;

/** Final, provider-free decision for one prepared step. Callers acquire current evidence separately. */
export function evaluateFinalPolicy(input: FinalPolicyInput): PolicyResult {
  const base = evaluatePolicy(input);
  const currentPolicy = evaluatePolicy({ ...input, wallet: input.current.wallet, network: input.current.network, quote: input.current.quote });
  const findings: PolicyFinding[] = [...base.findings, ...currentPolicy.findings];
  const add = (code: PolicyReason, decision: PolicyDecision, evidence: string) => findings.push({ code, decision, evidence });
  const prepared = input.preparation?.status === "PREPARED" ? input.preparation.data : undefined;
  const quote = input.quote?.status === "AVAILABLE" ? input.quote : undefined;
  const fresh = input.current.quote;
  const steps = Array.isArray(prepared?.steps) ? prepared.steps : [];
  const stepIndex = input.stepIndex ?? steps.length - 1;
  const step = steps[stepIndex];
  if (!prepared || !quote || !step || !Number.isSafeInteger(stepIndex) || stepIndex < 0) return policyResult([...findings, { code: "MISSING_EVIDENCE", decision: "BLOCK", evidence: "final.step" }]);
  if (stepIndex > 0 && input.priorStepConfirmed !== true) add("STALE_EVIDENCE", "REVALIDATE", "final.priorStepConfirmed");
  const baselineTime = prepared.preparedAt;
  for (const [path, read] of [["wallet.state", input.current.wallet], ["network.verified", input.current.network]] as const) {
    if (!validateReadResult(read).valid) add("MALFORMED_EVIDENCE", "BLOCK", `final.${path}`);
    else if (!matchesAddress(read.account, prepared.account) || read.chainId !== prepared.chainId) add("PREPARATION_MISMATCH", "BLOCK", `final.${path}.account/chainId`);
    else if (read.capturedAt < baselineTime) add("STALE_EVIDENCE", "REVALIDATE", `final.${path}.capturedAt`);
  }
  const balances = input.current.balances;
  const balanceValid = validateReadResult(balances).valid && balances.tool === "assets.balances";
  const balanceObserved = balanceValid && balances.freshness === "live" && balances.observedAt !== null && balances.observedAt >= baselineTime;
  const balance = balanceObserved && balances.status !== "UNAVAILABLE" ? balances.data[prepared.inputAsset] : undefined;
  if (!balanceValid) add("MALFORMED_EVIDENCE", "BLOCK", "final.balances");
  else if (!matchesAddress(balances.account, prepared.account) || balances.chainId !== prepared.chainId) add("PREPARATION_MISMATCH", "BLOCK", "final.balances.account/chainId");
  else if (balance === undefined) add("UNAVAILABLE_EVIDENCE", "REVALIDATE", "final.balances");
  const originalData = record(quote.data);
  const debit = input.action === "BRIDGE" ? originalData?.sourceDebit : prepared.inputAmount;
  if (typeof debit !== "bigint" || debit <= 0n) add("MALFORMED_EVIDENCE", "BLOCK", "final.requiredDebit");
  else if (balance !== undefined && balance < debit) add("BALANCE_INSUFFICIENT", "BLOCK", "final.balances.data");

  if (input.action !== "SEND") {
    const allowance = input.current.allowance;
    const allowanceValid = allowance && validateReadResult(allowance).valid && allowance.tool === "token.allowance";
    const expectedSpender = input.action === "SWAP" ? XYLO_ROUTER : CCTP_TOKEN_MESSENGER_V2;
    if (allowance && !allowanceValid) add("MALFORMED_EVIDENCE", "BLOCK", "final.allowance");
    else if (!allowanceValid || allowance.status !== "AVAILABLE" || allowance.freshness !== "live" || allowance.observedAt === null || allowance.observedAt < baselineTime) add("UNAVAILABLE_EVIDENCE", "REVALIDATE", "final.allowance");
    else {
      const asset = getAssetById(prepared.inputAsset);
      if (!asset || !matchesAddress(allowance.data.owner, prepared.account) || allowance.chainId !== prepared.chainId || allowance.data.assetId !== prepared.inputAsset || !matchesAddress(allowance.data.spender, expectedSpender) || !matchesAddress(allowance.data.token, asset.address)) add("PREPARATION_MISMATCH", "BLOCK", "final.allowance.data");
      if (allowance.data.amount !== prepared.allowance) add("ALLOWANCE_CHANGED", "REVALIDATE", "final.allowance.data.amount");
      if (step.kind !== "finite-approval" && typeof debit === "bigint" && allowance.data.amount < debit) add("ALLOWANCE_CHANGED", "REVALIDATE", "final.allowance.data.amount");
    }
  }

  if (fresh.status === "EXPIRED" || fresh.expiresAt !== null && input.now > fresh.expiresAt || input.now > prepared.expiresAt) add("EXPIRED_QUOTE", "REQUOTE", "final.quote.expiresAt");
  else if (fresh.status !== "AVAILABLE") add("UNAVAILABLE_EVIDENCE", "REQUOTE", "final.quote.status");
  else if (!validateQuoteResult(fresh, 0).valid) add("MALFORMED_EVIDENCE", "BLOCK", "final.quote");
  else if (fresh.observedAt < baselineTime) add("STALE_EVIDENCE", "REVALIDATE", "final.quote.observedAt");
  else if (quoteFingerprint(fresh) !== prepared.quoteFingerprint) add("QUOTE_MISMATCH", "REQUOTE", "final.quote.fingerprint");

  const fee = input.current.fee;
  const feeValid = fee.status === "available" && Number.isFinite(fee.observedAt) && fee.observedAt >= baselineTime && fee.observedAt <= input.now;
  if (input.action === "SWAP" && fee.status !== "not-estimated" || input.action !== "SWAP" && !feeValid) add("FEE_UNAVAILABLE", "REVALIDATE", "final.fee");
  else if (input.action === "SEND") {
    const expected = originalData?.maximumFeeRaw18;
    if (typeof fee.maximumFeeRaw18 !== "bigint" || fee.maximumFeeRaw18 < 0n || typeof fee.gasBalanceRaw18 !== "bigint" || fee.gasBalanceRaw18 < 0n || typeof fee.maximumFeeUsdc6 !== "bigint" || fee.maximumFeeUsdc6 < 0n || typeof expected !== "bigint" || typeof originalData?.maximumFeeUsdc6 !== "bigint") add("FEE_UNAVAILABLE", "REVALIDATE", "final.fee");
    else {
      if (fee.maximumFeeRaw18 !== expected || fee.maximumFeeUsdc6 !== originalData.maximumFeeUsdc6) add("FEE_CHANGED", "REQUOTE", "final.fee.maximumFeeRaw18");
      if (fee.gasBalanceRaw18 < fee.maximumFeeRaw18 || prepared.inputAsset === "usdc" && balance !== undefined && balance < prepared.inputAmount + fee.maximumFeeUsdc6) add("BALANCE_INSUFFICIENT", "BLOCK", "final.fee/gasBalance");
    }
  } else if (input.action === "BRIDGE") {
    if (typeof fee.cctpMaximumFee !== "bigint" || typeof fee.cctpSourceDebit !== "bigint" || fee.cctpMaximumFee < 0n || fee.cctpSourceDebit <= 0n) add("FEE_UNAVAILABLE", "REVALIDATE", "final.fee");
    else if (fee.cctpMaximumFee !== originalData?.maximumFee || fee.cctpSourceDebit !== originalData?.sourceDebit) add("FEE_CHANGED", "REQUOTE", "final.fee");
  }

  const simulation = input.current.simulation;
  if (simulation.status === "reverted") add("SIMULATION_FAILED", "BLOCK", "final.simulation.status");
  else if (simulation.status !== "passed") add("SIMULATION_UNAVAILABLE", "REVALIDATE", "final.simulation.status");
  const latestRead = Math.max(balances.observedAt ?? 0, input.current.allowance?.observedAt ?? 0, fee.observedAt, fresh.observedAt, input.current.wallet.capturedAt, input.current.network.capturedAt);
  if (!Number.isFinite(simulation.observedAt) || simulation.observedAt < latestRead || simulation.observedAt > input.now) add("STALE_EVIDENCE", "REVALIDATE", "final.simulation.observedAt");
  if (!matchesAddress(simulation.account, prepared.account) || simulation.chainId !== prepared.chainId || simulation.quoteFingerprint !== prepared.quoteFingerprint || !simulation.request || !step.request || !sameRequest(simulation.request, step.request)) add("SIMULATION_MISMATCH", "BLOCK", "final.simulation.request");
  return policyResult(findings);
}

/** Phase 9D final gate for the production wallet Swap review format. Provider reads stay with the caller. */
export function evaluateFinalWalletSwapPolicy(input: Readonly<{
  snapshot: TransactionReviewSnapshot;
  intent: TransactionIntent;
  prepared: PreparedXyloSwapRequest;
  quote: SwapQuote;
  request: TransactionRequestInput;
  account: string;
  chainId: number;
  balance: bigint;
  usdcBalance: bigint;
  allowance: bigint;
  reviewedBalance: bigint;
  reviewedAllowance: bigint;
  liveOutput: bigint;
  slippage: number;
  feeValid: boolean;
  simulation: "passed" | "reverted" | "unavailable";
  now: number;
}>): PolicyResult {
  const findings: PolicyFinding[] = [];
  const add = (code: PolicyReason, decision: PolicyDecision, evidence: string) => findings.push({ code, decision, evidence });
  const from = getAssetById(input.quote.fromAssetId);
  const to = getAssetById(input.quote.toAssetId);
  if (!isAddress(input.account) || !matchesAddress(input.account, input.snapshot.intent.account) || !matchesAddress(input.prepared.recipient, input.snapshot.intent.account)) add("ACCOUNT_MISMATCH", "BLOCK", "wallet.account");
  if (input.chainId !== arcTestnet.id || input.quote.chainId !== input.chainId) add("CHAIN_MISMATCH", "BLOCK", "wallet.chainId");
  if (!isSwapQuoteFresh(input.quote.quotedAt, input.now) || input.now > input.snapshot.expiresAt || BigInt(Math.floor(input.now / 1000)) >= input.prepared.deadline) add("EXPIRED_QUOTE", "REQUOTE", "swap.quote.expiresAt");
  const preparedQuote = input.prepared.quote;
  if (input.quote.fromAssetId !== preparedQuote.fromAssetId || input.quote.toAssetId !== preparedQuote.toAssetId || input.quote.amountIn !== preparedQuote.amountIn || input.quote.amountOut !== preparedQuote.amountOut || input.quote.quotedAt !== preparedQuote.quotedAt) add("QUOTE_MISMATCH", "REQUOTE", "swap.prepared.quote");
  if (!from || !to || from.id === to.id || !matchesAddress(input.quote.router, XYLO_ROUTER) || !matchesAddress(input.quote.pool, XYLO_POOL) || !matchesAddress(input.prepared.request.address, XYLO_ROUTER) || input.intent.metadata?.route !== "xylonet") add("UNSUPPORTED_ROUTE", "BLOCK", "swap.route");
  if (!SWAP_SLIPPAGE_OPTIONS.includes(input.slippage as typeof SWAP_SLIPPAGE_OPTIONS[number]) || input.intent.metadata?.slippageBps !== Math.round(input.slippage * 10_000)) add("SLIPPAGE_UNSUPPORTED", "BLOCK", "swap.slippage");
  if (input.prepared.minimumReceive !== minimumSwapOutput(input.quote.amountOut, input.slippage as typeof SWAP_SLIPPAGE_OPTIONS[number]) || input.intent.assetIn?.minimumAmount !== input.prepared.minimumReceive) add("MIN_OUTPUT_INVALID", "BLOCK", "swap.minimumReceive");
  if (input.liveOutput < input.prepared.minimumReceive) add("MIN_OUTPUT_INVALID", "REQUOTE", "swap.liveOutput");
  if (input.intent.assetOut?.assetId !== input.quote.fromAssetId || input.intent.assetOut.amount !== input.quote.amountIn || input.intent.assetIn?.assetId !== input.quote.toAssetId) add("PREPARATION_MISMATCH", "BLOCK", "swap.amountPair");
  if (input.balance !== input.reviewedBalance || input.allowance !== input.reviewedAllowance) add("STALE_EVIDENCE", "REVALIDATE", "swap.balanceAllowance");
  if (input.balance < input.quote.amountIn || input.quote.fromAssetId === "usdc" && input.usdcBalance < input.quote.amountIn + (input.intent.gas?.maxFeeUsdc6 ?? 0n)) add("BALANCE_INSUFFICIENT", "BLOCK", "swap.balance");
  if (input.allowance < input.quote.amountIn) add("ALLOWANCE_CHANGED", "REVALIDATE", "swap.allowance");
  if (!input.feeValid) add("FEE_CHANGED", "REQUOTE", "swap.fee");
  if (input.simulation === "reverted") add("SIMULATION_FAILED", "BLOCK", "swap.simulation");
  else if (input.simulation !== "passed") add("SIMULATION_UNAVAILABLE", "REVALIDATE", "swap.simulation");
  const checked = revalidateTransactionReview(input.snapshot, { intent: input.intent, context: { connectedAccount: isAddress(input.account) ? getAddress(input.account) : undefined, connectedChainId: input.chainId, balances: { [input.quote.fromAssetId]: input.balance, usdc: input.usdcBalance }, allowance: input.allowance, simulation: input.simulation, expectedTarget: XYLO_ROUTER }, request: input.request, now: input.now });
  if (!checked.valid) add(checked.reason === "expired" ? "EXPIRED_QUOTE" : "PREPARATION_MISMATCH", checked.reason === "expired" ? "REQUOTE" : "BLOCK", "swap.reviewSnapshot");
  return policyResult(findings);
}

function sameRequest(left: NormalizedTransactionRequest, right: NormalizedTransactionRequest): boolean {
  return left.to === right.to && left.data === right.data && left.value === right.value && left.chainId === right.chainId && left.gas === right.gas && left.maxFeePerGas === right.maxFeePerGas && left.maxPriorityFeePerGas === right.maxPriorityFeePerGas;
}
