export type WalletFailureKind =
  | "rejected"
  | "wrong-network"
  | "insufficient-gas"
  | "reverted"
  | "confirmation-unknown"
  | "rpc";

export function isLargeSend(amount: bigint, balance: bigint) {
  if (amount <= 0n || balance <= 0n) return false;
  return amount >= balance || amount * 2n >= balance;
}

export function classifyWalletFailure(error: unknown, hashSubmitted = false): WalletFailureKind {
  if (hashSubmitted) return "confirmation-unknown";
  if (hasNestedCode(error, 4001) || matchesError(error, /reject|denied|declined/i)) return "rejected";
  if (matchesError(error, /wrong network|wrong chain|chain mismatch|unsupported chain|chain id/i)) return "wrong-network";
  if (matchesError(error, /insufficient funds.*gas|insufficient.*gas|gas required exceeds allowance/i)) return "insufficient-gas";
  if (matchesError(error, /execution reverted|revert|simulation failed|call exception/i)) return "reverted";
  return "rpc";
}

function hasNestedCode(value: unknown, expected: number, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const candidate = value as Record<string, unknown>;
  if (candidate.code === expected || candidate.code === String(expected)) return true;
  return Object.values(candidate).some((nested) => hasNestedCode(nested, expected, seen));
}

function matchesError(value: unknown, pattern: RegExp, seen = new Set<object>()): boolean {
  if (typeof value === "string") return pattern.test(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Error && pattern.test(value.message)) return true;
  return Object.values(value as Record<string, unknown>).some((nested) => matchesError(nested, pattern, seen));
}
