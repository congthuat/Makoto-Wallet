import type { TranslationKey } from "../../i18n/types";

type AgentSuggestion = {
  id: string;
  promptKey: TranslationKey;
};

type AgentSuggestionGroup = {
  id: "wallet" | "activity" | "prepare" | "explain";
  labelKey: TranslationKey;
  suggestions: readonly AgentSuggestion[];
};

/** Presentation-only prompt catalog. Selecting an item fills the composer; it never submits an action. */
export const agentSuggestionGroups = [
  {
    id: "wallet",
    labelKey: "agentDashboard.suggestionCategoryWallet",
    suggestions: [
      { id: "wallet-balances", promptKey: "agentDashboard.suggestionWalletBalances" },
      { id: "wallet-assets", promptKey: "agentDashboard.suggestionWalletAssets" },
      { id: "wallet-address", promptKey: "agentDashboard.suggestionWalletAddress" },
      { id: "wallet-network", promptKey: "agentDashboard.suggestionWalletNetwork" },
      { id: "wallet-chain-id", promptKey: "agentDashboard.suggestionWalletChainId" },
      { id: "wallet-local-lock", promptKey: "agentDashboard.suggestionWalletLocalLock" },
      { id: "wallet-status", promptKey: "agentDashboard.suggestionWalletStatus" },
      { id: "wallet-app-lock", promptKey: "agentDashboard.suggestionWalletAppLock" },
      { id: "wallet-supported-assets", promptKey: "agentDashboard.suggestionWalletSupportedAssets" },
      { id: "wallet-agent-capabilities", promptKey: "agentDashboard.suggestionWalletAgentCapabilities" },
    ],
  },
  {
    id: "activity",
    labelKey: "agentDashboard.suggestionCategoryActivity",
    suggestions: [
      { id: "activity-recent", promptKey: "agentDashboard.suggestionActivityRecent" },
      { id: "activity-summary", promptKey: "agentDashboard.suggestionActivitySummary" },
      { id: "activity-sends", promptKey: "agentDashboard.suggestionActivitySends" },
      { id: "activity-receives", promptKey: "agentDashboard.suggestionActivityReceives" },
      { id: "activity-swaps", promptKey: "agentDashboard.suggestionActivitySwaps" },
      { id: "activity-bridges", promptKey: "agentDashboard.suggestionActivityBridges" },
      { id: "activity-latest-explain", promptKey: "agentDashboard.suggestionActivityLatestExplain" },
      { id: "activity-usdc", promptKey: "agentDashboard.suggestionActivityUsdc" },
      { id: "activity-eurc", promptKey: "agentDashboard.suggestionActivityEurc" },
      { id: "activity-cirbtc", promptKey: "agentDashboard.suggestionActivityCirbtc" },
    ],
  },
  {
    id: "prepare",
    labelKey: "agentDashboard.suggestionCategoryPrepare",
    suggestions: [
      { id: "prepare-send-10", promptKey: "agentDashboard.suggestionPrepareSend10" },
      { id: "prepare-send-small", promptKey: "agentDashboard.suggestionPrepareSendSmall" },
      { id: "prepare-receive", promptKey: "agentDashboard.suggestionPrepareReceive" },
      { id: "prepare-swap-usdc-eurc", promptKey: "agentDashboard.suggestionPrepareSwapUsdcEurc" },
      { id: "prepare-swap-eurc-usdc", promptKey: "agentDashboard.suggestionPrepareSwapEurcUsdc" },
      { id: "prepare-bridge-arc-base", promptKey: "agentDashboard.suggestionPrepareBridgeArcBase" },
    ],
  },
  {
    id: "explain",
    labelKey: "agentDashboard.suggestionCategoryExplain",
    suggestions: [
      { id: "explain-send-receive", promptKey: "agentDashboard.suggestionExplainSendReceive" },
      { id: "explain-swap-bridge", promptKey: "agentDashboard.suggestionExplainSwapBridge" },
      { id: "explain-bridge-status", promptKey: "agentDashboard.suggestionExplainBridgeStatus" },
      { id: "explain-agent-boundary", promptKey: "agentDashboard.suggestionExplainAgentBoundary" },
    ],
  },
] as const satisfies readonly AgentSuggestionGroup[];

export const AGENT_SUGGESTION_COUNT = agentSuggestionGroups.reduce((count, group) => count + group.suggestions.length, 0);
