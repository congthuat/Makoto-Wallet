import { getAddress, isAddress, zeroAddress } from "viem";
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
  | "EXECUTION_AUTHORITY" | "REQUIRES_REVIEW" | "QUOTE_WARNING" | "PREPARATION_LIMITATION";
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
