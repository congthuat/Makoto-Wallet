import { getAddress, type Address, type Hex } from "viem";
import { assessTransaction, transactionFingerprint, type SafetyContext, type TransactionIntent, type TransactionSafetyAssessment } from "./transactionSafety.ts";

export const DEFAULT_REVIEW_TTL_MS = 60_000;

export type TransactionRequestInput = {
  to: Address;
  data: Hex;
  value?: bigint;
  chainId: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

/** Provider-free and JSON-safe. Never store clients, connectors, signers, or callbacks here. */
export type NormalizedTransactionRequest = Readonly<{
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}>;

export type TransactionReviewSnapshot = Readonly<{
  intent: Readonly<TransactionIntent>;
  assessment: Readonly<TransactionSafetyAssessment>;
  fingerprint: Hex;
  preparedAt: number;
  expiresAt: number;
  request: NormalizedTransactionRequest;
}>;

export type ReviewInvalidationReason = "expired" | "intent-changed" | "request-changed" | "blocked";
export type ReviewRevalidation =
  | { valid: true; assessment: TransactionSafetyAssessment }
  | { valid: false; reason: ReviewInvalidationReason; assessment?: TransactionSafetyAssessment };

export function requestFromIntent(intent: TransactionIntent): TransactionRequestInput {
  return { to: intent.target, data: intent.calldata, value: intent.value, chainId: intent.chainId, gas: intent.gas?.gasLimit, maxFeePerGas: intent.gas?.maxFeePerGas, maxPriorityFeePerGas: intent.gas?.maxPriorityFeePerGas };
}

export function normalizeTransactionRequest(request: TransactionRequestInput): NormalizedTransactionRequest {
  return Object.freeze({
    to: getAddress(request.to), data: request.data.toLowerCase() as Hex, value: (request.value ?? 0n).toString(), chainId: request.chainId,
    ...(request.gas === undefined ? {} : { gas: request.gas.toString() }),
    ...(request.maxFeePerGas === undefined ? {} : { maxFeePerGas: request.maxFeePerGas.toString() }),
    ...(request.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: request.maxPriorityFeePerGas.toString() }),
  });
}

export function prepareTransactionReview({ intent, context, request = requestFromIntent(intent), preparedAt = context.now ?? Date.now(), expiresAt = intent.quoteExpiresAt ?? preparedAt + DEFAULT_REVIEW_TTL_MS }: {
  intent: TransactionIntent; context: SafetyContext; request?: TransactionRequestInput; preparedAt?: number; expiresAt?: number;
}): TransactionReviewSnapshot {
  const normalized = normalizeTransactionRequest(request);
  assertRequestMatchesIntent(intent, normalized);
  const assessment = assessTransaction(intent, { ...context, now: preparedAt });
  const fingerprint = transactionFingerprint(intent);
  const frozenIntent = deepFreeze(cloneIntent(intent));
  return Object.freeze({ intent: frozenIntent, assessment: deepFreeze(assessment), fingerprint, preparedAt, expiresAt, request: normalized });
}

export function revalidateTransactionReview(snapshot: TransactionReviewSnapshot, { intent, context, request = requestFromIntent(intent), now = context.now ?? Date.now() }: {
  intent: TransactionIntent; context: SafetyContext; request?: TransactionRequestInput; now?: number;
}): ReviewRevalidation {
  if (now > snapshot.expiresAt || (intent.quoteExpiresAt !== undefined && now > intent.quoteExpiresAt)) return { valid: false, reason: "expired" };
  const assessment = assessTransaction(intent, { ...context, now });
  if (transactionFingerprint(intent) !== snapshot.fingerprint) return { valid: false, reason: "intent-changed", assessment };
  const normalized = normalizeTransactionRequest(request);
  try { assertRequestMatchesIntent(intent, normalized); } catch { return { valid: false, reason: "request-changed", assessment }; }
  if (canonicalRequest(normalized) !== canonicalRequest(snapshot.request)) return { valid: false, reason: "request-changed", assessment };
  if (assessment.status === "blocked" || assessment.status === "unknown") return { valid: false, reason: "blocked", assessment };
  return { valid: true, assessment };
}

export class ReviewSubmissionGuard {
  #active = new Set<Hex>();
  isSubmitting(fingerprint: Hex) { return this.#active.has(fingerprint); }
  async run<T>(fingerprint: Hex, submit: () => Promise<T>): Promise<T> {
    if (this.#active.has(fingerprint)) throw new Error("Transaction submission is already in progress.");
    this.#active.add(fingerprint);
    try { return await submit(); } finally { this.#active.delete(fingerprint); }
  }
}

export async function submitReviewedTransaction<T>(snapshot: TransactionReviewSnapshot, options: {
  intent: TransactionIntent; context: SafetyContext; request?: TransactionRequestInput; now?: number;
  guard: ReviewSubmissionGuard; submit(request: NormalizedTransactionRequest): Promise<T>;
}): Promise<T> {
  const result = revalidateTransactionReview(snapshot, options);
  if (!result.valid) throw new Error(reviewInvalidationMessage(result.reason));
  return options.guard.run(snapshot.fingerprint, () => options.submit(snapshot.request));
}

export function reviewInvalidationMessage(reason: ReviewInvalidationReason) {
  if (reason === "expired") return "Transaction review expired. Review again.";
  if (reason === "blocked") return "Transaction safety checks no longer pass. Review again.";
  return "Transaction details changed. Review again.";
}

function assertRequestMatchesIntent(intent: TransactionIntent, request: NormalizedTransactionRequest) {
  if (request.chainId !== intent.chainId || getAddress(request.to) !== getAddress(intent.target) || request.data !== intent.calldata.toLowerCase() || request.value !== intent.value.toString()) throw new Error("Prepared request does not match transaction intent.");
}
function canonicalRequest(request: NormalizedTransactionRequest) { return JSON.stringify(request, Object.keys(request).sort()); }
function cloneIntent(intent: TransactionIntent): TransactionIntent { return { ...intent, assetOut: intent.assetOut && { ...intent.assetOut }, assetIn: intent.assetIn && { ...intent.assetIn }, approval: intent.approval && { ...intent.approval }, gas: intent.gas && { ...intent.gas }, metadata: intent.metadata && structuredClone(intent.metadata) }; }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
