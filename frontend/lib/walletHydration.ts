export type WalletConnectionStatus = "connecting" | "reconnecting" | "connected" | "disconnected";
export type WalletUiState = "hydrating" | "arc" | "wrong-network" | "disconnected";
export type FinancialDataState = "loading" | "ready" | "unavailable";

export function deriveWalletUiState({
  hydrated,
  connectionStatus,
  isConnected,
  connectorChainId,
  providerChainId,
  isArc,
}: {
  hydrated: boolean;
  connectionStatus: WalletConnectionStatus;
  isConnected: boolean;
  connectorChainId?: number;
  providerChainId?: number;
  isArc: boolean;
}): WalletUiState {
  if (!hydrated || connectionStatus === "connecting" || connectionStatus === "reconnecting") return "hydrating";
  if (connectionStatus !== "connected" || !isConnected) return "disconnected";
  if (connectorChainId === undefined || providerChainId === undefined) return "hydrating";
  return isArc ? "arc" : "wrong-network";
}

export function deriveFinancialDataState({ enabled, isLoading, isError }: { enabled: boolean; isLoading: boolean; isError: boolean }): FinancialDataState {
  if (!enabled || isError) return "unavailable";
  return isLoading ? "loading" : "ready";
}

export function canConsumeAgentHandoff(walletState: WalletUiState, balancesSettled: boolean) {
  return walletState === "wrong-network" || (walletState === "arc" && balancesSettled);
}
