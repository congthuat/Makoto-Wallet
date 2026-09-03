import type { Address } from "viem";

export type AgentSourceTrust = "ONCHAIN_VERIFIED" | "OFFICIAL_PROTOCOL" | "OFFICIAL_DOCUMENTATION" | "OFFICIAL_STATUS" | "TRUSTED_EXPLORER" | "THIRD_PARTY_REFERENCE" | "UNVERIFIED_WEB";
export type AgentIntelligenceStatus = "AVAILABLE" | "PARTIAL" | "STALE" | "UNAVAILABLE" | "UNVERIFIED" | "SOURCE_ERROR";
export type AgentResearchSource = Readonly<{ id: string; title: string; sourceType: AgentSourceTrust; canonicalUrl: string; publisher: string; fetchedAt: number }>;
export type AgentIntelligenceFact = Readonly<{ label: "chain" | "address" | "addressType" | "balance" | "activity" | "counterparties" | "tokenName" | "tokenSymbol" | "tokenDecimals" | "tokenSupply" | "allowance" | "protocol" | "officialSummary" | "providerStatus" | "cctpPurpose" | "cctpSupportedChains" | "cctpFees" | "cctpTransferModes" | "cctpForwarding" | "arcBridging"; value: string; sourceIds: readonly string[] }>;
export type AgentIntelligenceResult = Readonly<{ kind: "onchain" | "official-research"; status: AgentIntelligenceStatus; summary: "address" | "token" | "activity" | "official"; facts: readonly AgentIntelligenceFact[]; sources: readonly AgentResearchSource[]; fetchedAt: number; expiresAt?: number; limitations: readonly string[] }>;
export type OnchainIntelligenceOperation = "address" | "token" | "activity";
export type OfficialResearchTopic = "arc-updates" | "arc-docs" | "circle-cctp" | "circle-status";
export type OnchainIntelligenceInput = Readonly<{ operation: OnchainIntelligenceOperation; address: Address; tokenAddress?: Address; spender?: Address }>;
