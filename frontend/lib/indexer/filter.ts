import type { WalletActivity } from "../wallet.ts";

export type ActivityFilter = "all" | "send" | "receive" | "swap" | "bridge" | "vault";

export function filterActivity(activities: WalletActivity[], filter: ActivityFilter, search: string) {
  const needle = search.trim().toLowerCase();
  return activities.filter((item) => {
    const kindMatches = filter === "all"
      || (filter === "send" && item.kind === "transfer" && item.direction === "send")
      || (filter === "receive" && item.kind === "transfer" && item.direction === "receive")
      || item.kind === filter
      || (filter === "vault" && (item.kind === "vault-deposit" || item.kind === "vault-withdraw"));
    return kindMatches && (!needle || item.hash.toLowerCase().includes(needle) || item.counterparty.toLowerCase().includes(needle));
  });
}
