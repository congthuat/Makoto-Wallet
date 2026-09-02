import type { Address } from "viem";
import type { WalletActivity } from "../wallet.ts";
import type { SupportedAssetId } from "../assets.ts";
import type { AgentBlockingCode, AgentPlanningResult } from "./planning.ts";
import type { AgentSessionContext } from "./sessionContext.ts";
import type { AgentIntelligenceResult, OfficialResearchTopic, OnchainIntelligenceOperation } from "./intelligence/types.ts";

export type AgentLocale = "en" | "vi";
export type AgentActivityFilter = "send" | "receive" | "swap" | "bridge" | "vault" | "all";
export type AgentReadIntent = "wallet-overview" | "recent-activity" | "activity-explanation" | "onchain-intelligence" | "official-research" | "latest-transaction" | "today-spending" | "send-affordability" | "send-remaining" | "swap-quote" | "swap-allowance" | "swap-affordability" | "bridge-estimate" | "bridge-route" | "bridge-completion" | "blocking-explanation" | "vault-summary" | "network-status" | "safety-capabilities" | "clarification" | "unknown";
export type AgentActionKind = "send" | "swap" | "bridge" | "vault-deposit" | "vault-withdraw";
export type AgentPreparationField = "amount" | "asset" | "recipient" | "outputAsset" | "sourceChain" | "destinationChain";
export type AgentRequestMode = "informational" | "planning" | "preparation" | "clarification";
export type AgentTopic = "wallet" | "activity" | "network" | "vault" | "send" | "swap" | "bridge" | "safety" | "intelligence" | "research" | "unknown";
export type AgentActivityLoadState = "loading" | "loaded" | "partial" | "unavailable";

export type AgentContextSnapshot = Readonly<{
  connected: boolean;
  account?: Address;
  walletType?: string;
  verifiedChainId?: number;
  isArc: boolean;
  balances: Readonly<{ usdc?: bigint; eurc?: bigint }>;
  activity: readonly WalletActivity[];
  activityLoadState: AgentActivityLoadState;
  activityPartial: boolean;
  activityUnavailable: boolean;
  vault: Readonly<{ available: boolean; total?: bigint; goalCount?: number; activeCount?: number }>;
  safetyCapabilities: readonly string[];
  timestamp: number;
}>;

type AgentDraftBase = Readonly<{
  version: 1;
  mode: "prepare-only";
  rawUserText: string;
  executionEnabled: false;
}>;

export type SendActionDraft = AgentDraftBase & Readonly<{ kind: "send"; asset: "USDC" | "EURC"; amount: string; recipient: Address; sourceChain: "Arc Testnet" }>;
export type SwapActionDraft = AgentDraftBase & Readonly<{ kind: "swap"; inputAsset: "USDC" | "EURC"; outputAsset: "USDC" | "EURC"; amount: string; slippage: 0.005; sourceChain: "Arc Testnet" }>;
export type BridgeActionDraft = AgentDraftBase & Readonly<{ kind: "bridge"; asset: "USDC"; amount: string; sourceChain: "Arc Testnet" | "Base Sepolia"; destinationChain: "Arc Testnet" | "Base Sepolia"; recipient?: Address; routeMode: "cctp-direct-forwarding" | "circle-app-kit-cctp" }>;
export type VaultActionDraft = AgentDraftBase & Readonly<{ kind: "vault-deposit" | "vault-withdraw"; asset: "USDC"; amount: string }>;
export type AgentActionDraft = SendActionDraft | SwapActionDraft | BridgeActionDraft | VaultActionDraft;

export type AgentPreparationInput = Readonly<{
  kind: AgentActionKind;
  assetId?: SupportedAssetId;
  amount?: string;
  recipient?: Address;
  sourceChainId?: number;
  destinationChainId?: number;
  outputAssetId?: SupportedAssetId;
  rawUserText: string;
  invalidRecipient?: boolean;
}>;

export type AgentIntent = Readonly<{
  kind: AgentReadIntent | "prepare-action";
  locale: AgentLocale;
  activityFilter?: AgentActivityFilter;
  limit?: number;
  transactionHash?: string;
  amount?: string;
  assetId?: SupportedAssetId;
  outputAssetId?: SupportedAssetId;
  recipient?: Address;
  sourceChainId?: number;
  destinationChainId?: number;
  timezoneOffsetMinutes?: number;
  blockingCode?: AgentBlockingCode;
  clarification?: "missing-topic" | "swap-or-bridge" | "approval-topic" | "missing-details" | "missing-intelligence-target" | "missing-token-address";
  preparation?: AgentPreparationInput;
  intelligenceOperation?: OnchainIntelligenceOperation;
  intelligenceAddress?: Address;
  tokenAddress?: Address;
  spender?: Address;
  researchTopic?: OfficialResearchTopic;
}>;

export type AgentRequest = Readonly<{ text: string; locale: AgentLocale; account?: Address; previousIntent?: AgentIntent; sessionContext?: AgentSessionContext }>;
export type AgentToolResult<T = unknown> = Readonly<{ tool: string; ok: boolean; data?: T; unavailable?: string; partial?: boolean }>;
export type AgentResponse = Readonly<{ text: string; intent: AgentIntent; result?: AgentToolResult; planning?: AgentPlanningResult; actionDraft?: AgentActionDraft; intelligence?: AgentIntelligenceResult }>;
