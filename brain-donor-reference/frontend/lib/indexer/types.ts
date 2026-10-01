import type { Address, Hash } from "viem";
export type ActivityKind = "send" | "receive" | "memo" | "swap" | "bridge" | "vault" | "pay" | "batch" | "guardian" | "recovery";
export type IndexedActivity = { chainId: number; account: Address; hash: Hash; logIndex?: number; kind: ActivityKind; status: "pending" | "verified"; timestamp?: number; memo?: string };
