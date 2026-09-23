export type SwapSubmissionStatus =
  | "not-submitted"
  | "submitted-pending"
  | "submitted-unknown"
  | "confirmed"
  | "failed";

export type SwapReceiptStatus = "success" | "reverted";
export type SwapConfirmationOutcome = "not-submitted" | "submitted-unknown" | "confirmed-success" | "confirmed-failure";

/** Receipt evidence takes precedence over the generic post-submit error classifier. */
export function classifySwapConfirmation(input: { submitted: boolean; receiptStatus?: SwapReceiptStatus }): SwapConfirmationOutcome {
  if (input.receiptStatus === "success") return "confirmed-success";
  if (input.receiptStatus === "reverted") return "confirmed-failure";
  return input.submitted ? "submitted-unknown" : "not-submitted";
}

/** Continue is available only while no prior wallet submission is unresolved. */
export function swapContinueAllowed(status: SwapSubmissionStatus, reviewStage: "approval" | "swap" | undefined, pending: boolean) {
  return status === "not-submitted" && reviewStage === "swap" && !pending;
}

/** A submitted transaction keeps the wallet flow protected until it reaches a terminal state. */
export function swapModalBusy(status: SwapSubmissionStatus, pending: boolean, hasApprovalReview: boolean, reviewStage: "approval" | "swap" | undefined, executionInFlight = false) {
  return executionInFlight || status === "submitted-pending" || Boolean(pending && (hasApprovalReview || reviewStage));
}

/** Back is safe before submission and after a terminal result, but never during unresolved confirmation. */
export function swapBackAllowed(status: SwapSubmissionStatus, executionInFlight = false) {
  return !executionInFlight && status !== "submitted-pending";
}

export function swapStatusAfterConfirmation(status: SwapSubmissionStatus, confirmation: "success" | "failure" | "unknown"): SwapSubmissionStatus {
  if (status !== "submitted-pending") return status;
  return confirmation === "success" ? "confirmed" : confirmation === "failure" ? "failed" : "submitted-unknown";
}
