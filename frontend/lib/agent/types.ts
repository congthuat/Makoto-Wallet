import type { Address } from "viem";
import type { WalletActivity } from "../wallet.ts";

export type AgentLocale = "en" | "vi";
export type AgentActivityFilter = "send" | "receive" | "swap" | "bridge" | "vault" | "all";
export type AgentReadIntent = "wallet-overview" | "recent-activity" | "activity-explanation" | "vault-summary" | "network-status" | "safety-capabilities" | "unknown";
export type AgentActionKind = "send" | "swap" | "bridge" | "vault-deposit" | "vault-withdraw";

export type AgentContextSnapshot = Readonly<{
  connected: boolean;
  account?: Address;
  walletType?: string;
  verifiedChainId?: number;
  isArc: boolean;
  balances: Readonly<{ usdc?: bigint; eurc?: bigint }>;
  activity: readonly WalletActivity[];
  activityPartial: boolean;
  activityUnavailable: boolean;
  vault: Readonly<{ available: boolean; total?: bigint; goalCount?: number; activeCount?: number }>;
  safetyCapabilities: readonly string[];
  timestamp: number;
}>;

export type AgentActionDraft = Readonly<{
  kind: AgentActionKind;
  asset?: string;
  amount?: string;
  recipient?: string;
  sourceChain?: string;
  destinationChain?: string;
  outputAsset?: string;
  rawUserText: string;
  missingFields: readonly string[];
  executionEnabled: false;
}>;

export type AgentIntent = Readonly<{
  kind: AgentReadIntent | "action-draft";
  locale: AgentLocale;
  activityFilter?: AgentActivityFilter;
  limit?: number;
  transactionHash?: string;
  actionDraft?: AgentActionDraft;
}>;

export type AgentRequest = Readonly<{ text: string; locale: AgentLocale }>;
export type AgentToolResult = Readonly<{ tool: string; ok: boolean; data?: unknown; unavailable?: string; partial?: boolean }>;
export type AgentToolDefinition = Readonly<{ name: string; run(snapshot: AgentContextSnapshot, intent: AgentIntent): AgentToolResult }>;
export type AgentResponse = Readonly<{ text: string; intent: AgentIntent; result?: AgentToolResult; actionDraft?: AgentActionDraft }>;
