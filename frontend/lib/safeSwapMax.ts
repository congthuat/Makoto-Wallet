export const SAFE_MAX_MAX_ITERATIONS = 12;
export const SAFE_MAX_CONVERGENCE_UNITS = 1n;

export type SafeMaxEstimate = { fee: bigint };
export type SafeSwapMaxResult = { amount: bigint; fee: bigint; iterations: number; usedBackoff: boolean };

export class SafeSwapMaxError extends Error {
  readonly code: "zero-balance" | "too-small" | "no-estimate" | "no-convergence";
  constructor(code: "zero-balance" | "too-small" | "no-estimate" | "no-convergence") { super(code); this.code = code; }
}

export async function calculateSafeUsdcSwapMax(balance: bigint, estimate: (candidate: bigint) => Promise<SafeMaxEstimate>): Promise<SafeSwapMaxResult> {
  if (balance <= 0n) throw new SafeSwapMaxError("zero-balance");
  let candidate = balance;
  let usedBackoff = false;
  let observed: SafeMaxEstimate | undefined;
  let iterations = 0;

  for (; iterations < SAFE_MAX_MAX_ITERATIONS; iterations += 1) {
    try { observed = await estimate(candidate); }
    catch {
      usedBackoff = true;
      candidate /= 2n;
      if (candidate <= 0n) throw new SafeSwapMaxError("no-estimate");
      continue;
    }
    if (observed.fee <= 0n || observed.fee >= balance) throw new SafeSwapMaxError("too-small");
    const next = balance - observed.fee;
    const difference = candidate > next ? candidate - next : next - candidate;
    candidate = next;
    if (difference <= SAFE_MAX_CONVERGENCE_UNITS) break;
  }
  if (!observed) throw new SafeSwapMaxError("no-estimate");

  for (; iterations < SAFE_MAX_MAX_ITERATIONS; iterations += 1) {
    const final = await estimate(candidate).catch(() => undefined);
    if (!final || final.fee <= 0n || final.fee >= balance) throw new SafeSwapMaxError("no-estimate");
    if (candidate + final.fee <= balance) return { amount: candidate, fee: final.fee, iterations: iterations + 1, usedBackoff };
    candidate = balance - final.fee;
    if (candidate <= 0n) throw new SafeSwapMaxError("too-small");
  }
  throw new SafeSwapMaxError("no-convergence");
}
