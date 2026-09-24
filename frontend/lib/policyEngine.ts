import { getAddress, isAddress, maxUint256, zeroAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById } from "./assets.ts";
import { CCTP_TOKEN_MESSENGER_V2 } from "./cctp.ts";
import { minimumSwapOutput, SWAP_SLIPPAGE_OPTIONS, XYLO_ROUTER } from "./swap.ts";
import type { PrepareResult } from "./agent/prepareTools.ts";
import type { QuoteResult } from "./agent/quoteTools.ts";
import type { ReadResult, VerifiedNetwork, WalletState } from "./agent/readTools.ts";
import { validatePrepareResult, validateQuoteResult, validateReadResult } from "./agent/toolSchemas.ts";

export type PolicyAction = "SEND" | "SWAP" | "BRIDGE";
export type PolicyDecision = "ALLOW" | "WARN" | "REQUIRE_REVIEW" | "REVALIDATE" | "REQUOTE" | "BLOCK";
export type PolicyReason =
  | "INVALID_CONTEXT" | "ACCOUNT_MISMATCH" | "CHAIN_MISMATCH" | "WALLET_UNAVAILABLE"
  | "MISSING_EVIDENCE" | "MALFORMED_EVIDENCE" | "UNAVAILABLE_EVIDENCE"
  | "UNSUPPORTED_ACTION" | "EXPIRED_QUOTE" | "QUOTE_MISMATCH" | "PREPARATION_MISMATCH"
  | "EXECUTION_AUTHORITY" | "REQUIRES_REVIEW" | "QUOTE_WARNING" | "PREPARATION_LIMITATION"
  | "UNSUPPORTED_CHAIN" | "UNSUPPORTED_TOKEN" | "UNSUPPORTED_PAIR" | "UNSUPPORTED_ROUTE"
  | "UNTRUSTED_TARGET" | "SPENDER_MISMATCH" | "APPROVAL_UNBOUNDED" | "APPROVAL_AMOUNT_MISMATCH"
  | "SLIPPAGE_UNSUPPORTED" | "MIN_OUTPUT_INVALID";
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

  const decision = findings.reduce<PolicyDecision>((current, finding) => precedence.indexOf(finding.decision) > precedence.indexOf(current) ? finding.decision : current, "ALLOW");
  const winner = findings.find((finding) => finding.decision === decision);
  const requiredAction = decision === "BLOCK" ? "STOP" : decision === "REQUOTE" ? "REQUOTE" : decision === "REVALIDATE" ? "REVALIDATE" : decision === "REQUIRE_REVIEW" ? "REVIEW" : "NONE";
  return { decision, findings, ...(winner ? { winningReason: winner.code } : {}), requiredAction, mustStop: decision === "BLOCK" || decision === "REQUOTE" || decision === "REVALIDATE", requiresUserReview: decision === "ALLOW" || decision === "WARN" || decision === "REQUIRE_REVIEW", requiresFreshQuote: decision === "REQUOTE", requiresRevalidation: decision === "REVALIDATE" };
}
