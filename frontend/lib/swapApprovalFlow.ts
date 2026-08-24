export type SwapReviewPlan = {
  stage: "approval" | "swap";
  estimateApprovalGas: boolean;
  estimateSwapGas: boolean;
};

export function planSwapReview(allowance: bigint, amountIn: bigint): SwapReviewPlan {
  if (allowance < 0n || amountIn <= 0n) throw new RangeError("Invalid swap approval inputs");
  return allowance < amountIn
    ? { stage: "approval", estimateApprovalGas: true, estimateSwapGas: false }
    : { stage: "swap", estimateApprovalGas: false, estimateSwapGas: true };
}

export function safeMaxCanUseSwapEstimate(allowance: bigint, candidateAmount: bigint) {
  return candidateAmount > 0n && allowance >= candidateAmount;
}

export function stageAfterApproval(receiptSucceeded: boolean, allowance: bigint, amountIn: bigint) {
  return receiptSucceeded && allowance >= amountIn ? "swap-review" as const : "approval" as const;
}
