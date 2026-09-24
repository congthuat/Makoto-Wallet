import { translate, type Locale, type TranslationKey } from "../i18n/index.ts";
import type { PolicyDecision, PolicyFinding, PolicyReason, PolicyResult } from "./policyEngine.ts";

export type PolicyUXState = Readonly<{
  decision: PolicyDecision;
  requiredAction: PolicyResult["requiredAction"];
  title: string;
  summary: string;
  reasons: readonly Readonly<{ code: PolicyReason; evidence: string; text: string }>[];
  primaryReason?: PolicyReason;
  blocksProgression: boolean;
  requiresFreshQuote: boolean;
  requiresRevalidation: boolean;
  requiresExplicitReview: boolean;
  warningIsNonBlocking: boolean;
  nextAction: string;
}>;

const rank: Record<PolicyDecision, number> = { BLOCK: 5, REQUOTE: 4, REVALIDATE: 3, REQUIRE_REVIEW: 2, WARN: 1, ALLOW: 0 };
const copy: Record<PolicyDecision, readonly [TranslationKey, TranslationKey, TranslationKey]> = {
  BLOCK: ["policy.block.title", "policy.block.summary", "policy.block.action"],
  REQUOTE: ["policy.requote.title", "policy.requote.summary", "policy.requote.action"],
  REVALIDATE: ["policy.revalidate.title", "policy.revalidate.summary", "policy.revalidate.action"],
  REQUIRE_REVIEW: ["policy.review.title", "policy.review.summary", "policy.review.action"],
  WARN: ["policy.warn.title", "policy.warn.summary", "policy.warn.action"],
  ALLOW: ["policy.allow.title", "policy.allow.summary", "policy.allow.action"],
};

function reasonKey(code: PolicyReason): TranslationKey {
  if (code === "ACCOUNT_MISMATCH" || code === "WALLET_UNAVAILABLE") return "policy.reason.account";
  if (code === "CHAIN_MISMATCH" || code === "UNSUPPORTED_CHAIN") return "policy.reason.chain";
  if (code === "EXPIRED_QUOTE" || code === "QUOTE_MISMATCH") return "policy.reason.quote";
  if (code === "FEE_UNAVAILABLE" || code === "FEE_CHANGED") return "policy.reason.fee";
  if (code === "BALANCE_INSUFFICIENT") return "policy.reason.balance";
  if (code === "ALLOWANCE_CHANGED" || code === "APPROVAL_AMOUNT_MISMATCH" || code === "APPROVAL_UNBOUNDED") return "policy.reason.allowance";
  if (code === "SIMULATION_FAILED" || code === "SIMULATION_UNAVAILABLE" || code === "SIMULATION_MISMATCH") return "policy.reason.simulation";
  if (code === "UNSUPPORTED_ROUTE" || code === "UNTRUSTED_TARGET" || code === "SPENDER_MISMATCH" || code === "UNSUPPORTED_PAIR" || code === "UNSUPPORTED_TOKEN") return "policy.reason.route";
  if (code === "SLIPPAGE_UNSUPPORTED" || code === "MIN_OUTPUT_INVALID") return "policy.reason.slippage";
  if (code === "STALE_EVIDENCE" || code === "UNAVAILABLE_EVIDENCE" || code === "MISSING_EVIDENCE") return "policy.reason.evidence";
  return "policy.reason.details";
}

/** Presentation only: the supplied deterministic decision controls every progression flag. */
export function mapPolicyResultToUX(result: PolicyResult, locale: Locale): PolicyUXState {
  const [titleKey, summaryKey, actionKey] = copy[result.decision];
  const ordered = [...result.findings].sort((a, b) => rank[b.decision] - rank[a.decision]);
  const primary = ordered.find((finding) => finding.decision === result.decision && finding.code === result.winningReason) ?? ordered.find((finding) => finding.decision === result.decision);
  const findings: PolicyFinding[] = primary ? [primary, ...ordered.filter((finding) => finding !== primary)] : ordered;
  return {
    decision: result.decision,
    requiredAction: result.requiredAction,
    title: translate(locale, titleKey), summary: translate(locale, summaryKey), nextAction: translate(locale, actionKey),
    reasons: findings.map((finding) => ({ code: finding.code, evidence: finding.evidence, text: translate(locale, reasonKey(finding.code)) })),
    primaryReason: primary?.code,
    blocksProgression: result.decision === "BLOCK" || result.decision === "REQUOTE" || result.decision === "REVALIDATE",
    requiresFreshQuote: result.decision === "REQUOTE",
    requiresRevalidation: result.decision === "REVALIDATE",
    requiresExplicitReview: result.decision === "ALLOW" || result.decision === "WARN" || result.decision === "REQUIRE_REVIEW",
    warningIsNonBlocking: result.decision === "WARN",
  };
}

/** Labels an already-failed wallet gate for display; it does not evaluate safety. */
export function existingGateOutcome(decision: "BLOCK" | "REQUOTE" | "REVALIDATE", code: PolicyReason, evidence: string): PolicyResult {
  return { decision, findings: [{ decision, code, evidence }], winningReason: code,
    requiredAction: decision === "BLOCK" ? "STOP" : decision,
    mustStop: true, requiresUserReview: false, requiresFreshQuote: decision === "REQUOTE", requiresRevalidation: decision === "REVALIDATE" };
}
