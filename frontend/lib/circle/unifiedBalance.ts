import { parseUnits } from "viem";
import type { GetBalancesResult, EstimateSpendResult, SpendResult, DepositResult } from "@circle-fin/app-kit";
import type { UnifiedBalance } from "./types.ts";

export function normalizeUnifiedBalance(input: { available: bigint; pending: bigint; sources: UnifiedBalance["sources"] }): UnifiedBalance {
  if (input.available < 0n || input.pending < 0n || input.sources.some((source) => source.amount < 0n)) throw new RangeError("Gateway balances cannot be negative");
  return { ...input, total: input.available + input.pending };
}

export type UnifiedBalanceState = { status: "ready"; balance: UnifiedBalance } | { status: "unavailable" | "disconnected"; reason: string };

export function normalizeCircleBalances(result: GetBalancesResult, account: string): UnifiedBalance {
  const entry = result.breakdown.find((item) => item.depositor.toLowerCase() === account.toLowerCase());
  const available = parseUnits(result.totalConfirmedBalance, 6);
  const pending = parseUnits(result.totalPendingBalance ?? "0", 6);
  return { available, pending, total: available + pending, sources: (entry?.breakdown ?? []).map((item) => ({ domain: 0, chain: String(item.chain), amount: parseUnits(item.confirmedBalance, 6) })) };
}
export function parsePositiveUsdc(value: string): bigint | undefined {
  try {
    const amount = parseUnits(value.trim(), 6);
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}
export const normalizeSpendFees = (estimate: EstimateSpendResult) => estimate.fees.map((fee) => ({ type: fee.type, token: fee.token, amount: fee.amount, allocations: fee.allocations?.map((item) => ({ chain: String(item.chain), amount: item.amount })) ?? [] }));
export function sanitizeCircleError(error: unknown) { const message = error instanceof Error ? error.message : "Circle Gateway request failed"; return /reject|denied|cancel/i.test(message) ? "Transaction cancelled in wallet." : message.slice(0, 240); }
export type CircleDepositResult = DepositResult;
export type CircleSpendResult = SpendResult;
