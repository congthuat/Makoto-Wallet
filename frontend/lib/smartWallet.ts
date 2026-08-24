import type { Address, Hash, Hex } from "viem";
export type SmartWalletCapabilities = { available: boolean; sponsorship: boolean; batching: boolean; reason?: string };
export interface SmartWalletProvider { capabilities(): Promise<SmartWalletCapabilities>; account(): Promise<Address>; estimate(calls: readonly Hex[]): Promise<bigint>; submit(calls: readonly Hex[]): Promise<Hash>; track(hash: Hash): Promise<"pending" | "success" | "failed">; }
export function smartWalletState(capabilities?: SmartWalletCapabilities): "configuration-required" | "experimental" | "available" { if (!capabilities?.available) return "configuration-required"; return capabilities.sponsorship || capabilities.batching ? "available" : "experimental"; }
export const isSponsored = (capabilities?: SmartWalletCapabilities) => capabilities?.available === true && capabilities.sponsorship === true;
