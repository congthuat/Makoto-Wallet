export const SAFE_MAX_SOLVE_ATTEMPTS = 8;
export const SAFE_MAX_FINAL_VERIFY_ATTEMPTS = 4;
export const SAFE_MAX_MAX_ITERATIONS = SAFE_MAX_SOLVE_ATTEMPTS + SAFE_MAX_FINAL_VERIFY_ATTEMPTS;

export type SafeMaxEstimate = { feeUsdc6: bigint };
export type SafeSwapMaxResult = { amount: bigint; feeUsdc6: bigint; iterations: number; usedBackoff: boolean };

export class SafeSwapMaxError extends Error {
  readonly code: "zero-balance" | "too-small" | "no-estimate" | "no-convergence";
  constructor(code: "zero-balance" | "too-small" | "no-estimate" | "no-convergence") { super(code); this.code = code; }
}

export async function calculateSafeUsdcSwapMax(
  balance: bigint,
  estimate: (candidate: bigint) => Promise<SafeMaxEstimate>,
  finalEstimate: (candidate: bigint) => Promise<SafeMaxEstimate> = estimate,
): Promise<SafeSwapMaxResult> {
  if (balance <= 0n) throw new SafeSwapMaxError("zero-balance");
  let candidate = balance;
  let usedBackoff = false;
  let maxObservedFee = 0n;
  let solveIterations = 0;

  for (; solveIterations < SAFE_MAX_SOLVE_ATTEMPTS; solveIterations += 1) {
    let observed: SafeMaxEstimate;
    try { observed = await estimate(candidate); }
    catch {
      usedBackoff = true;
      candidate /= 2n;
      if (candidate <= 0n) throw new SafeSwapMaxError("no-estimate");
      continue;
    }
    if (observed.feeUsdc6 <= 0n || observed.feeUsdc6 >= balance) throw new SafeSwapMaxError("too-small");
    if (observed.feeUsdc6 > maxObservedFee) maxObservedFee = observed.feeUsdc6;
    const next = balance - maxObservedFee;
    if (next === candidate) { solveIterations += 1; break; }
    candidate = next;
  }
  if (maxObservedFee === 0n) throw new SafeSwapMaxError("no-estimate");

  for (let finalIterations = 0; finalIterations < SAFE_MAX_FINAL_VERIFY_ATTEMPTS; finalIterations += 1) {
    const final = await finalEstimate(candidate).catch(() => undefined);
    if (!final || final.feeUsdc6 <= 0n || final.feeUsdc6 >= balance) throw new SafeSwapMaxError("no-estimate");
    if (candidate + final.feeUsdc6 <= balance) return { amount: candidate, feeUsdc6: final.feeUsdc6, iterations: solveIterations + finalIterations + 1, usedBackoff };
    if (final.feeUsdc6 > maxObservedFee) maxObservedFee = final.feeUsdc6;
    candidate = balance - maxObservedFee;
    if (candidate <= 0n) throw new SafeSwapMaxError("too-small");
  }
  throw new SafeSwapMaxError("no-convergence");
}
