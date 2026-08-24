import type { UnifiedBalance } from "./types.ts";

export function normalizeUnifiedBalance(input: { available: bigint; pending: bigint; sources: UnifiedBalance["sources"] }): UnifiedBalance {
  if (input.available < 0n || input.pending < 0n || input.sources.some((source) => source.amount < 0n)) throw new RangeError("Gateway balances cannot be negative");
  return { ...input, total: input.available + input.pending };
}

export type UnifiedBalanceState = { status: "ready"; balance: UnifiedBalance } | { status: "unavailable" | "disconnected"; reason: string };
