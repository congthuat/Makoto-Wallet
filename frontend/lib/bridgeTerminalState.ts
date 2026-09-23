import type { MakotoBridgeEstimate, MakotoBridgeResult } from "./circle/bridge";
import type { TransactionReviewSnapshot } from "./transactionOrchestrator";

/** A successful result owns the surface until the user explicitly resets the flow. */
export function bridgeReviewIsActionable(
  result: MakotoBridgeResult | undefined,
  estimate: MakotoBridgeEstimate | undefined,
  reviewSnapshot: TransactionReviewSnapshot | undefined,
) {
  return result === undefined && estimate !== undefined && reviewSnapshot !== undefined;
}

/** Stale review state must never be able to invoke the completed Bridge callback. */
export function bridgeContinueAllowed(
  result: MakotoBridgeResult | undefined,
  locked: boolean,
  estimate: MakotoBridgeEstimate | undefined,
  reviewSnapshot: TransactionReviewSnapshot | undefined,
) {
  return result === undefined && !locked && estimate !== undefined && reviewSnapshot !== undefined;
}
