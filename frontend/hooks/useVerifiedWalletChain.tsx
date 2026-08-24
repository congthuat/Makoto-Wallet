"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useSwitchChain } from "wagmi";
import { arcTestnet } from "viem/chains";
import { isVerifiedArcReview } from "@/lib/transactionReview";

type ChainProvider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: "chainChanged", listener: (chainId: unknown) => void): void;
  removeListener?(event: "chainChanged", listener: (chainId: unknown) => void): void;
};

type VerifiedChain = {
  connectorUid: string;
  connectorChainId: number;
  providerChainId: number;
};

type SwitchStatus = "idle" | "waiting" | "switching" | "connected" | "rejected" | "missing" | "failed";

type WalletNetworkState = {
  connectorChainId?: number;
  providerChainId?: number;
  isArc: boolean;
  switchStatus: SwitchStatus;
  switchMessage?: string;
  verifyNow(): Promise<boolean>;
  switchToArc(): Promise<void>;
};

const WalletNetworkContext = createContext<WalletNetworkState | undefined>(undefined);

export function WalletNetworkProvider({ children }: { children: ReactNode }) {
  const connection = useConnection();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [verified, setVerified] = useState<VerifiedChain>();
  const [switchStatus, setSwitchStatus] = useState<SwitchStatus>("idle");
  const [switchMessage, setSwitchMessage] = useState<string>();
  const connector = connection.connector;

  const readConnectedChain = useCallback(async () => {
    if (connection.status !== "connected" || !connector) return undefined;
    const provider = await connector.getProvider() as ChainProvider | undefined;
    if (!provider) throw new Error("The connected wallet provider is unavailable.");
    const [connectorChainId, providerChainIdValue] = await Promise.all([
      connector.getChainId(),
      provider.request({ method: "eth_chainId" }),
    ]);
    return {
      connectorUid: connector.uid,
      connectorChainId,
      providerChainId: parseChainId(providerChainIdValue),
    };
  }, [connection.status, connector]);

  const synchronize = useCallback(async () => {
    const next = await readConnectedChain();
    if (!next) return undefined;
    setVerified(next);
    setSwitchStatus((current) => isVerifiedArc(next) ? "connected" : current === "connected" ? "idle" : current);
    await queryClient.invalidateQueries();
    return next;
  }, [queryClient, readConnectedChain]);

  useEffect(() => {
    if (connection.status !== "connected" || !connector) return;
    let active = true;
    let provider: ChainProvider | undefined;

    const refreshAfterProviderEvent = () => {
      window.setTimeout(() => {
        if (active) void synchronize().catch(() => undefined);
      }, 0);
    };

    void connector.getProvider().then((value) => {
      if (!active || !value) return;
      provider = value as ChainProvider;
      provider.on?.("chainChanged", refreshAfterProviderEvent);
      void synchronize().catch(() => undefined);
    });

    return () => {
      active = false;
      provider?.removeListener?.("chainChanged", refreshAfterProviderEvent);
    };
  }, [connection.status, connector, synchronize]);

  useEffect(() => {
    if (connection.status !== "connected") return;
    const refresh = () => { if (document.visibilityState === "visible") void synchronize().catch(() => undefined); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [connection.status, synchronize]);

  const switchToArc = useCallback(async () => {
    if (connection.status !== "connected" || !connector) {
      setSwitchStatus("failed");
      setSwitchMessage("Connect a wallet before switching networks.");
      return;
    }

    setSwitchStatus("waiting");
    setSwitchMessage("Confirm the Arc Testnet switch in your wallet.");
    try {
      await switchChainAsync({ chainId: arcTestnet.id });
    } catch (error) {
      if (isUnknownChainError(error)) {
        setSwitchStatus("missing");
        setSwitchMessage("Wallet does not have Arc Testnet. Approve adding the network.");
        try {
          const provider = await connector.getProvider() as ChainProvider | undefined;
          if (!provider) throw new Error("The connected wallet provider is unavailable.");
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x4cef52",
              chainName: arcTestnet.name,
              nativeCurrency: arcTestnet.nativeCurrency,
              rpcUrls: ["https://rpc.testnet.arc.network"],
              blockExplorerUrls: ["https://testnet.arcscan.app"],
            }],
          });
          setSwitchStatus("switching");
          setSwitchMessage("Switching network…");
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x4cef52" }],
          });
        } catch (fallbackError) {
          setSwitchFailure(fallbackError, setSwitchStatus, setSwitchMessage);
          return;
        }
      } else {
        setSwitchFailure(error, setSwitchStatus, setSwitchMessage);
        return;
      }
    }

    setSwitchStatus("switching");
    setSwitchMessage("Switching network…");
    try {
      const confirmed = await synchronize();
      if (!confirmed || !isVerifiedArc(confirmed)) {
        setSwitchStatus("failed");
        setSwitchMessage(`Switch failed: the connected provider still reports chain ${confirmed?.providerChainId ?? "unknown"}.`);
        return;
      }
      setSwitchStatus("connected");
      setSwitchMessage("Arc Testnet connected");
    } catch {
      setSwitchStatus("failed");
      setSwitchMessage("Switch failed: the connected wallet network could not be verified.");
    }
  }, [connection.status, connector, switchChainAsync, synchronize]);

  const current = verified?.connectorUid === connector?.uid ? verified : undefined;
  const verifyNow = useCallback(async () => {
    try {
      const next = await readConnectedChain();
      setVerified(next);
      return isVerifiedArc(next);
    } catch {
      setVerified(undefined);
      return false;
    }
  }, [readConnectedChain]);
  const value = useMemo<WalletNetworkState>(() => ({
    connectorChainId: current?.connectorChainId,
    providerChainId: current?.providerChainId,
    isArc: isVerifiedArc(current),
    switchStatus,
    switchMessage,
    verifyNow,
    switchToArc,
  }), [current, switchMessage, switchStatus, switchToArc, verifyNow]);

  return <WalletNetworkContext.Provider value={value}>{children}</WalletNetworkContext.Provider>;
}

export function useVerifiedWalletChain() {
  const value = useContext(WalletNetworkContext);
  if (!value) throw new Error("useVerifiedWalletChain must be used inside WalletNetworkProvider.");
  return value;
}

function isVerifiedArc(chain?: VerifiedChain) {
  return isVerifiedArcSnapshot(chain?.connectorChainId, chain?.providerChainId);
}

export function isVerifiedArcSnapshot(connectorChainId?: number, providerChainId?: number) {
  return isVerifiedArcReview(connectorChainId, providerChainId);
}

function parseChainId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^(0x[0-9a-f]+|[0-9]+)$/i.test(value)) {
    const parsed = Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error("The wallet returned an invalid chain ID.");
}

function isUnknownChainError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown; data?: { originalError?: unknown } };
  return candidate.code === 4902
    || isUnknownChainError(candidate.cause)
    || isUnknownChainError(candidate.data?.originalError);
}

function isRejectedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown; message?: unknown };
  return candidate.code === 4001
    || (typeof candidate.message === "string" && /reject|denied/i.test(candidate.message))
    || isRejectedError(candidate.cause);
}

function setSwitchFailure(
  error: unknown,
  setStatus: (status: SwitchStatus) => void,
  setMessage: (message: string) => void,
) {
  if (isRejectedError(error)) {
    setStatus("rejected");
    setMessage("User rejected switch");
    return;
  }
  setStatus("failed");
  setMessage("Switch failed");
}
