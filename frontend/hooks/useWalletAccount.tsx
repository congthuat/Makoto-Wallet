"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConnection, useSendTransaction, useSignMessage } from "wagmi";
import { createWalletClient, fallback, http, type Address, type SignableMessage } from "viem";
import { arcTestnet } from "viem/chains";
import { useVerifiedWalletChain } from "./useVerifiedWalletChain";
import {
  createExternalWalletAccount,
  createLocalWalletExecutionAdapter,
  LocalWalletRuntime,
  type LocalMakotoWalletAccount,
  type LocalWalletSubmitter,
  type LocalWalletLifecycleStatus,
  type WalletExecutionAdapter,
  type WalletReadContext,
} from "@/lib/walletAccount";
import { hasLocalWalletKeystoreRecord, isLocalWalletLifecycleStorageKey, loadLocalWalletKeystore, loadLocalWalletRuntimeState, LOCAL_WALLET_SIGNAL_STORAGE_KEY, LocalWalletUnlockError, lockLocalWallet, unlockLocalWallet } from "@/lib/localWalletKeystore";
import { ARC_PUBLIC_RPC_URLS } from "@/lib/config";
import type { NormalizedTransactionRequest } from "@/lib/transactionOrchestrator";

type LocalWalletControls = Readonly<{
  wallet: LocalMakotoWalletAccount;
  lifecycleStatus: LocalWalletLifecycleStatus;
  unlock(password: string): Promise<void>;
  lock(): void;
  refresh(): void;
}>;

const LocalWalletReadContext = createContext<LocalMakotoWalletAccount | undefined>(undefined);
const LocalWalletExecutionContext = createContext<WalletExecutionAdapter | undefined>(undefined);
const LocalWalletControlsContext = createContext<LocalWalletControls | undefined>(undefined);

export function LocalWalletProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadLocalWalletRuntimeState(), []);
  const [wallet, setWallet] = useState<LocalMakotoWalletAccount>(initial.wallet);
  const [lifecycleStatus, setLifecycleStatus] = useState<LocalWalletLifecycleStatus>(initial.status === "locked" ? "locked" : "unavailable");
  const [runtime] = useState(() => new LocalWalletRuntime(initial.wallet));

  const publish = useCallback(() => {
    setWallet(runtime.wallet);
    setLifecycleStatus(runtime.status);
  }, [runtime]);

  const lock = useCallback(() => {
    const next = lockLocalWallet({ status: runtime.wallet.address ? "locked" : "unavailable", wallet: runtime.wallet }).wallet;
    runtime.lock(next);
    publish();
    try { localStorage.setItem(LOCAL_WALLET_SIGNAL_STORAGE_KEY, JSON.stringify({ action: "lock", at: Date.now() })); } catch { /* Cross-tab invalidation is best effort; this tab is already locked. */ }
  }, [publish, runtime]);

  const refresh = useCallback(() => {
    const next = loadLocalWalletRuntimeState().wallet;
    runtime.lock(next);
    publish();
  }, [publish, runtime]);

  const unlock = useCallback(async (password: string) => {
    const keystore = loadLocalWalletKeystore();
    if (!keystore) throw new LocalWalletUnlockError(hasLocalWalletKeystoreRecord() ? "INVALID_KEYSTORE_FORMAT" : "KEYSTORE_NOT_FOUND");
    const lockedWallet = loadLocalWalletRuntimeState().wallet;
    const generation = runtime.beginUnlock(lockedWallet);
    publish();
    try {
      const unlocked = await unlockLocalWallet(keystore, password);
      if (unlocked.account.address.toLowerCase() !== keystore.account.address.toLowerCase()) throw new LocalWalletUnlockError("DERIVED_ADDRESS_MISMATCH");
      const current = loadLocalWalletKeystore();
      if (!current || JSON.stringify(current) !== JSON.stringify(keystore)) throw new LocalWalletUnlockError("KEYSTORE_NOT_FOUND");
      const account = unlocked.account;
      const submitter: LocalWalletSubmitter = {
        address: account.address,
        send: async (request: NormalizedTransactionRequest) => {
          if (!runtime.isCurrentSubmitter(submitter)) throw new Error("Local wallet is locked.");
          const client = createWalletClient({
            account,
            chain: arcTestnet,
            transport: fallback(ARC_PUBLIC_RPC_URLS.map((url) => http(url, { retryCount: 1, retryDelay: 250, timeout: 10_000 })), { rank: false, retryCount: 1, retryDelay: 300 }),
          });
          if (!runtime.isCurrentSubmitter(submitter)) throw new Error("Local wallet is locked.");
          return client.sendTransaction({
            account,
            chain: arcTestnet,
            to: request.to,
            data: request.data,
            value: BigInt(request.value),
            ...(request.gas === undefined ? {} : { gas: BigInt(request.gas) }),
            ...(request.maxFeePerGas === undefined ? {} : { maxFeePerGas: BigInt(request.maxFeePerGas) }),
            ...(request.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas) }),
          });
        },
      };
      if (!runtime.completeUnlock(generation, unlocked.wallet, submitter)) throw new LocalWalletUnlockError("RUNTIME_STATE_ERROR");
      publish();
    } catch (error) {
      runtime.failUnlock(generation, loadLocalWalletRuntimeState().wallet);
      publish();
      throw error;
    }
  }, [publish, runtime]);

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (isLocalWalletLifecycleStorageKey(event.key)) refresh(); };
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("storage", sync); runtime.destroy(); };
  }, [refresh, runtime]);

  const execution = useMemo(() => createLocalWalletExecutionAdapter(
    () => runtime.getSubmitter(),
    () => runtime.wallet,
  ), [runtime]);

  const controls = useMemo<LocalWalletControls>(() => ({ wallet, lifecycleStatus, unlock, lock, refresh }), [lifecycleStatus, lock, refresh, unlock, wallet]);
  return <LocalWalletReadContext.Provider value={wallet}>
    <LocalWalletExecutionContext.Provider value={execution}>
      <LocalWalletControlsContext.Provider value={controls}>{children}</LocalWalletControlsContext.Provider>
    </LocalWalletExecutionContext.Provider>
  </LocalWalletReadContext.Provider>;
}

export function useLocalWalletControls() {
  const value = useContext(LocalWalletControlsContext);
  if (!value) throw new Error("useLocalWalletControls must be used inside LocalWalletProvider");
  return value;
}

export function useExternalWalletExecutionAdapter(address?: Address): WalletExecutionAdapter | undefined {
  const { sendTransactionAsync } = useSendTransaction();
  const { signMessageAsync } = useSignMessage();
  return useMemo(() => {
    if (!address) return undefined;
    return {
      kind: "external" as const,
      submitReviewed: (request: NormalizedTransactionRequest, legacySubmit?: () => Promise<`0x${string}`>) => legacySubmit ? legacySubmit() : sendTransactionAsync({
        account: address,
        to: request.to,
        data: request.data,
        value: BigInt(request.value),
        chainId: request.chainId as 5042002 | 84532,
        ...(request.gas === undefined ? {} : { gas: BigInt(request.gas) }),
        ...(request.maxFeePerGas === undefined ? {} : { maxFeePerGas: BigInt(request.maxFeePerGas) }),
        ...(request.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas) }),
      }),
      signMessage: (message: SignableMessage) => signMessageAsync({ account: address, message }),
    } satisfies WalletExecutionAdapter;
  }, [address, sendTransactionAsync, signMessageAsync]);
}

function useExternalWalletReadContext(): WalletReadContext {
  const connection = useConnection();
  const verifiedChain = useVerifiedWalletChain();
  return useMemo(() => createExternalWalletAccount({
    address: connection.address,
    chainId: verifiedChain.providerChainId ?? verifiedChain.connectorChainId ?? connection.chainId,
    connectorChainId: verifiedChain.connectorChainId,
    providerChainId: verifiedChain.providerChainId,
    connectionStatus: connection.status,
    isArc: verifiedChain.isArc,
    providerName: connection.connector?.name,
    connectorId: connection.connector?.id,
  }), [connection.address, connection.chainId, connection.connector?.id, connection.connector?.name, connection.status, verifiedChain.connectorChainId, verifiedChain.isArc, verifiedChain.providerChainId]);
}

export function useWalletReadContext(): WalletReadContext {
  const external = useExternalWalletReadContext();
  const local = useContext(LocalWalletReadContext);
  if (!local) throw new Error("useWalletReadContext must be used inside LocalWalletProvider");
  return external.connectionStatus !== "disconnected" ? external : local.status !== "unavailable" ? local : external;
}

export function useWalletExecutionAdapter(): WalletExecutionAdapter | undefined {
  const read = useWalletReadContext();
  const external = useExternalWalletExecutionAdapter(read.kind === "external" ? read.address : undefined);
  const local = useContext(LocalWalletExecutionContext);
  return read.kind === "local" && read.status === "connected" ? local : read.kind === "external" ? external : undefined;
}

export function useWalletAccount() {
  const read = useWalletReadContext();
  const execution = useWalletExecutionAdapter();
  return useMemo(() => ({ read, execution }), [execution, read]);
}
