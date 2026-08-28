import type { ReactNode } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { hasBlockingChecks, type SafetyCheck } from "@/lib/transactionReview";
import type { TransactionSafetyAssessment } from "@/lib/transactionSafety";
import { expectedTransactionChanges, type TransactionIntent } from "@/lib/transactionSafety";
import { formatAssetAmount, getAssetById } from "@/lib/assets";
import type { TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";

export type ReviewDetail = { label: string; value: ReactNode };

export function TransactionSafetyReview({ title, summary, details, compactDetails, technicalDetails = [], technicalDetailIndexes = [], technicalContent, compact = false, checks, assessment, review, walletNotice, onBack, onContinue, continueDisabled = false, continueLabel, children }: { title: string; summary: string; details: readonly ReviewDetail[]; compactDetails?: readonly ReviewDetail[]; technicalDetails?: readonly ReviewDetail[]; technicalDetailIndexes?: readonly number[]; technicalContent?: ReactNode; compact?: boolean; checks: readonly SafetyCheck[]; assessment?: TransactionSafetyAssessment; review?: TransactionReviewSnapshot; walletNotice: string; onBack(): void; onContinue(): void; continueDisabled?: boolean; continueLabel?: string; children?: ReactNode }) {
  const { t, locale } = usePreferences();
  const blocked = hasBlockingChecks(checks) || assessment?.status === "blocked" || assessment?.status === "unknown";
  const attentionChecks = checks.filter((check) => check.status === "attention" || check.status === "blocking");
  const visibleDetails = compactDetails ?? details.filter((_, index) => !technicalDetailIndexes.includes(index));
  const collapsedDetails = [...details.filter((_, index) => technicalDetailIndexes.includes(index)), ...technicalDetails];
  if (compact)
    return (
      <div className="wallet-flow transaction-safety-review compact-transaction-review">
        <header>
          <h3>{title}</h3>
        </header>
        <section aria-labelledby="compact-review-summary">
          <h4 className="sr-only" id="compact-review-summary">
            {t("review.details")}
          </h4>
          <dl className="wallet-review compact-review-summary">
            {visibleDetails.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <CompactSafetySummary checks={checks} assessment={assessment ?? review?.assessment} />
        {attentionChecks.length > 0 && (
          <div className="compact-safety-issues">
            <TransactionSafetyChecks checks={attentionChecks} />
          </div>
        )}
        <details className="compact-review-details">
          <summary>{t("review.details")}</summary>
          <div className="compact-review-details-body">
            {collapsedDetails.length > 0 && (
              <dl className="wallet-review">
                {collapsedDetails.map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <TransactionSafetyChecks checks={checks} />
            {review && (
              <p className="review-validity">
                {t("review.details")} · {new Date(review.expiresAt).toLocaleTimeString()}
              </p>
            )}
            {(assessment || review) && <p className="review-validity">Simulation · {(assessment ?? review!.assessment).status}</p>}
            {review && <TransactionExpectedChanges intent={review.intent} />}
            {technicalContent}
          </div>
        </details>
        {children}
        {walletNotice && <p className="compact-wallet-notice">{locale === "vi" ? "Bạn xác nhận lần cuối trong ví." : "Final confirmation happens in your wallet."}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onBack}>
            {t("review.back")}
          </button>
          <button type="button" className="primary-action" onClick={onContinue} disabled={blocked || continueDisabled}>
            {continueLabel ?? t("review.continueWallet")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="wallet-flow transaction-safety-review">
      <header>
        <p className="eyebrow">{t("review.aboutTo")}</p>
        <h3>{title}</h3>
        <p>{summary}</p>
      </header>
      <section aria-labelledby="review-details">
        <h4 id="review-details">{t("review.details")}</h4>
        <dl className="wallet-review">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <TransactionSafetyChecks checks={checks} />
      {review && (
        <p className="review-validity">
          {t("review.details")} · {new Date(review.expiresAt).toLocaleTimeString()}
        </p>
      )}
      {(assessment || review) && <TransactionSafetyAssessmentView assessment={assessment ?? review!.assessment} />}
      {review && <TransactionExpectedChanges intent={review.intent} />}
      {children}
      <div className="wallet-confirmation">
        <strong>{t("review.walletConfirmation")}</strong>
        <span>{walletNotice}</span>
        <small>{t("review.networkFee")}</small>
      </div>
      <div className="modal-actions">
        <button type="button" className="secondary-action" onClick={onBack}>
          {t("review.back")}
        </button>
        <button type="button" className="primary-action" onClick={onContinue} disabled={blocked || continueDisabled}>
          {continueLabel ?? t("review.continueWallet")}
        </button>
      </div>
    </div>
  );
}

function CompactSafetySummary({ checks, assessment }: { checks: readonly SafetyCheck[]; assessment?: TransactionSafetyAssessment }) {
  const { locale } = usePreferences(),
    vi = locale === "vi";
  const blocking = hasBlockingChecks(checks) || assessment?.status === "blocked" || assessment?.status === "unknown";
  const attention = checks.some((check) => check.status === "attention") || assessment?.status === "review";
  const state = blocking ? "blocking" : attention ? "attention" : "verified";
  const label = blocking ? (vi ? "Cần xử lý" : "Action required") : attention ? (vi ? "Cần xem lại" : "Review") : vi ? "Đã kiểm tra" : "Checks passed";
  return (
    <div className={`compact-safety-summary safety-${state}`} role="status">
      <span aria-hidden="true">{statusIcon(state)}</span>
      <strong>{vi ? "Kiểm tra an toàn" : "Safety checks"}</strong>
      <span>{label}</span>
    </div>
  );
}

export function TransactionSafetyAssessmentView({ assessment }: { assessment: TransactionSafetyAssessment }) {
  const { locale } = usePreferences(),
    vi = locale === "vi";
  return (
    <section className="transaction-safety-engine" aria-labelledby="transaction-safety-engine-title">
      <h4 id="transaction-safety-engine-title">{vi ? "An toàn giao dịch" : "Transaction safety"}</h4>
      <p className={`safety-engine-status safety-engine-${assessment.status}`}>{statusText(assessment.status, vi)}</p>
      <ul className="transaction-safety-checks">
        {assessment.checks.map((check) => (
          <li key={check.code} className={`safety-${check.status === "pass" ? "verified" : check.status === "warning" || check.status === "unknown" ? "attention" : "blocking"}`}>
            <strong>
              <span aria-hidden="true">{check.status === "pass" ? "✓" : check.status === "blocked" ? "×" : "!"}</span>
              {check.status === "pass" ? (vi ? "Đã kiểm tra" : "Verified") : check.status === "blocked" ? (vi ? "Đã chặn" : "Blocked") : vi ? "Cần kiểm tra" : "Review"}
            </strong>
            <span>{check.message}</span>
          </li>
        ))}
      </ul>
      <details>
        <summary>{vi ? "Chi tiết giao dịch nâng cao" : "Advanced transaction details"}</summary>
        <dl className="wallet-review">
          <div>
            <dt>{vi ? "Mục tiêu" : "Target"}</dt>
            <dd>{assessment.target?.label ?? (vi ? "Chưa nhận diện" : "Unknown contract")}</dd>
          </div>
          <div>
            <dt>{vi ? "Dấu vân tay đã kiểm tra" : "Reviewed fingerprint"}</dt>
            <dd>
              <code>
                {assessment.reviewedFingerprint.slice(0, 14)}…{assessment.reviewedFingerprint.slice(-8)}
              </code>
            </dd>
          </div>
          <div>
            <dt>{vi ? "Mô phỏng" : "Simulation"}</dt>
            <dd>{vi ? "Yêu cầu hiện tại" : "Current review request"}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

export function TransactionExpectedChanges({ intent }: { intent: TransactionIntent }) {
  const { locale } = usePreferences(),
    vi = locale === "vi",
    changes = expectedTransactionChanges(intent);
  if (!changes.length)
    return (
      <section aria-labelledby="expected-transaction-changes">
        <h4 id="expected-transaction-changes">{vi ? "Thay đổi dự kiến" : "Expected changes"}</h4>
        <p className="wallet-notice">{vi ? "Không chuyển token trong giao dịch này." : "No token transfer in this transaction."}</p>
      </section>
    );
  return (
    <section aria-labelledby="expected-transaction-changes">
      <h4 id="expected-transaction-changes">{vi ? "Thay đổi dự kiến" : "Expected changes"}</h4>
      <dl className="wallet-review">
        {changes.map((change, index) => {
          const asset = getAssetById(change.assetId)!;
          return (
            <div key={`${change.assetId}-${change.direction}-${index}`}>
              <dt>{asset.symbol}</dt>
              <dd>
                {qualifier(change.qualifier, vi)} · {change.direction === "increase" ? "+" : "-"}
                {formatAssetAmount(change.amount, asset)} {asset.symbol}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function statusText(status: TransactionSafetyAssessment["status"], vi: boolean) {
  return {
    ready: vi ? "Sẵn sàng ký" : "Ready to sign",
    review: vi ? "Cần kiểm tra" : "Review required",
    blocked: vi ? "Đã chặn" : "Blocked",
    unknown: vi ? "Hợp đồng chưa được Makoto nhận diện" : "Unknown contract",
  }[status];
}
function qualifier(value: "exact" | "estimated" | "minimum" | "maximum", vi: boolean) {
  return {
    exact: vi ? "Chính xác" : "Exact",
    estimated: vi ? "Ước tính" : "Estimated",
    minimum: vi ? "Tối thiểu" : "Minimum",
    maximum: vi ? "Tối đa" : "Maximum",
  }[value];
}

export function TransactionSafetyChecks({ checks }: { checks: readonly SafetyCheck[] }) {
  const { t } = usePreferences();
  return (
    <section aria-labelledby="review-checks">
      <h4 id="review-checks">{t("review.safetyChecks")}</h4>
      <ul className="transaction-safety-checks">
        {checks.map((check) => (
          <li key={check.code} className={`safety-${check.status}`}>
            <strong>
              <span aria-hidden="true">{statusIcon(check.status)}</span>
              {statusLabel(check.status, t)}
            </strong>
            <span>{checkLabel(check, t)}</span>
            {check.detail && <code>{check.detail}</code>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusIcon(status: SafetyCheck["status"]) {
  return { verified: "✓", info: "i", attention: "!", blocking: "×" }[status];
}
function statusLabel(status: SafetyCheck["status"], t: ReturnType<typeof usePreferences>["t"]) {
  return {
    verified: t("review.verified"),
    info: t("review.info"),
    attention: t("review.attention"),
    blocking: t("review.blocking"),
  }[status];
}
function checkLabel(check: SafetyCheck, t: ReturnType<typeof usePreferences>["t"]) {
  if (check.code === "wallet") return check.status === "verified" ? t("review.walletConnected") : t("review.walletDisconnected");
  if (check.code === "account") return check.status === "verified" ? check.label : t("review.changed");
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
