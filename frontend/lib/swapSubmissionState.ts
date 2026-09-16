export type SwapSubmissionStatus =
  | "not-submitted"
  | "submitted-pending"
  | "submitted-unknown"
  | "confirmed"
  | "failed";

/** Continue is available only while no prior wallet submission is unresolved. */
export function swapContinueAllowed(status: SwapSubmissionStatus, reviewStage: "approval" | "swap" | undefined, pending: boolean) {
  return status === "not-submitted" && reviewStage === "swap" && !pending;
}

export function swapStatusAfterConfirmation(status: SwapSubmissionStatus, confirmation: "success" | "failure" | "unknown"): SwapSubmissionStatus {
  if (status !== "submitted-pending") return status;
  return confirmation === "success" ? "confirmed" : confirmation === "failure" ? "failed" : "submitted-unknown";
}
