import type { ReactNode } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { hasBlockingChecks, type SafetyCheck } from "@/lib/transactionReview";

export type ReviewDetail = { label: string; value: ReactNode };

export function TransactionSafetyReview({ title, summary, details, checks, walletNotice, onBack, onContinue, continueDisabled = false, continueLabel, children }: {
  title: string;
  summary: string;
  details: readonly ReviewDetail[];
  checks: readonly SafetyCheck[];
  walletNotice: string;
  onBack(): void;
  onContinue(): void;
  continueDisabled?: boolean;
  continueLabel?: string;
  children?: ReactNode;
}) {
  const { t } = usePreferences();
  const blocked = hasBlockingChecks(checks);
  return <div className="wallet-flow transaction-safety-review">
    <header><p className="eyebrow">{t("review.aboutTo")}</p><h3>{title}</h3><p>{summary}</p></header>
    <section aria-labelledby="review-details"><h4 id="review-details">{t("review.details")}</h4><dl className="wallet-review">{details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl></section>
    <TransactionSafetyChecks checks={checks} />
    {children}
    <div className="wallet-confirmation"><strong>{t("review.walletConfirmation")}</strong><span>{walletNotice}</span><small>{t("review.networkFee")}</small></div>
    <div className="modal-actions"><button type="button" className="secondary-action" onClick={onBack}>{t("review.back")}</button><button type="button" className="primary-action" onClick={onContinue} disabled={blocked || continueDisabled}>{continueLabel ?? t("review.continueWallet")}</button></div>
  </div>;
}

export function TransactionSafetyChecks({ checks }: { checks: readonly SafetyCheck[] }) {
  const { t } = usePreferences();
  return <section aria-labelledby="review-checks"><h4 id="review-checks">{t("review.safetyChecks")}</h4><ul className="transaction-safety-checks">{checks.map((check) => <li key={check.code} className={`safety-${check.status}`}><strong><span aria-hidden="true">{statusIcon(check.status)}</span>{statusLabel(check.status, t)}</strong><span>{checkLabel(check, t)}</span>{check.detail && <code>{check.detail}</code>}</li>)}</ul></section>;
}

function statusIcon(status: SafetyCheck["status"]) { return ({ verified: "✓", info: "i", attention: "!", blocking: "×" })[status]; }
function statusLabel(status: SafetyCheck["status"], t: ReturnType<typeof usePreferences>["t"]) { return ({ verified: t("review.verified"), info: t("review.info"), attention: t("review.attention"), blocking: t("review.blocking") })[status]; }
function checkLabel(check: SafetyCheck, t: ReturnType<typeof usePreferences>["t"]) {
  if (check.code === "wallet") return check.status === "verified" ? t("review.walletConnected") : t("review.walletDisconnected");
  if (check.code === "account") return t("review.changed");
  if (check.code === "network") return check.status === "verified" ? "Arc Testnet · 5042002" : t("review.arcRequired");
  if (check.code === "amount") return t("review.amountInvalid");
  if (check.code === "balance") return check.status === "verified" ? t("review.balanceVerified") : t("review.balanceInsufficient");
  if (check.code === "recipient") return check.status === "verified" ? t("review.recipientVerified") : t("review.recipientInvalid");
  if (check.code === "self") return t("review.selfRecipient");
  if (check.code === "unknown-recipient") return t("review.unknownRecipient");
  if (check.code === "memo") return check.label === "Public on-chain memo" ? t("review.publicMemo") : t("review.noMemo");
  if (check.code === "quote") return check.status === "verified" ? t("review.quoteCurrent") : t("review.quoteExpired");
  return check.label;
}
