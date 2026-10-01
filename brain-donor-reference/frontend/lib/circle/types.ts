import type { Address } from "viem";

export type CapabilityState = "supported" | "unsupported" | "temporarily-unavailable" | "configuration-required";
export type CircleCapability = "send" | "bridge" | "swap" | "unifiedBalance";
export type CircleCapabilityMap = Record<CircleCapability, CapabilityState>;
export type UnifiedBalance = { available: bigint; pending: bigint; total: bigint; sources: ReadonlyArray<{ domain: number; chain: string; amount: bigint }> };
export type BridgeRoute = { sourceDomain: number; destinationDomain: number; token: Address; provider: "circle-app-kit" | "cctp-v2"; available: boolean };
