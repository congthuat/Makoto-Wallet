import type { Address, Hash, Hex, SignableMessage } from "viem";
import { arcTestnet } from "viem/chains";
import type { NormalizedTransactionRequest } from "./transactionOrchestrator.ts";

export type WalletAccountKind = "external" | "local";
export type WalletAccountStatus = "connected" | "locked" | "unavailable";
export type WalletConnectionStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

export type WalletReadContext = Readonly<{
  kind: WalletAccountKind;
  address?: Address;
  chainId?: number;
  connectorChainId?: number;
  providerChainId?: number;
  status: WalletAccountStatus;
  connectionStatus: WalletConnectionStatus;
  isArc: boolean;
  providerName?: string;
  connectorId?: string;
}>;

export type ExternalWalletAccount = WalletReadContext & {
  kind: "external";
  connectionStatus: WalletConnectionStatus;
};

/** Future type only. Phase 1 intentionally has no local signer or key material. */
export type LocalMakotoWalletAccount = WalletReadContext & {
  kind: "local";
  status: "connected" | "locked" | "unavailable";
};

export type WalletAccount = ExternalWalletAccount | LocalMakotoWalletAccount;

/** Signing capability is separate from read identity and is never part of Agent context. */
export type WalletExecutionAdapter = Readonly<{
  kind: WalletAccountKind;
  submitReviewed(request: NormalizedTransactionRequest, legacySubmit?: () => Promise<Hash>): Promise<Hash>;
  signMessage?(message: SignableMessage): Promise<Hex>;
}>;

export type LocalWalletSubmitter = Readonly<{
  address: Address;
  send(request: NormalizedTransactionRequest): Promise<Hash>;
}>;

export type LocalWalletLifecycleStatus = "unavailable" | "locked" | "unlocking" | "unlocked";

/**
 * The only owner of an in-memory local signer. Storage contains encrypted
 * material only; every lock, refresh, remote invalidation, or unmount advances
 * the generation and makes previously captured submitters stale.
 */
export class LocalWalletRuntime {
  #wallet: LocalMakotoWalletAccount;
  #submitter?: LocalWalletSubmitter;
  #generation = 0;
  #status: LocalWalletLifecycleStatus;

  constructor(wallet: LocalMakotoWalletAccount) {
    this.#wallet = wallet;
    this.#status = lifecycleStatus(wallet);
  }

  get wallet() { return this.#wallet; }
  get status() { return this.#status; }
  getSubmitter() { return this.#submitter; }

  beginUnlock(wallet: LocalMakotoWalletAccount) {
    this.#generation += 1;
    this.#submitter = undefined;
    this.#wallet = wallet;
    this.#status = "unlocking";
    return this.#generation;
  }

  completeUnlock(generation: number, wallet: LocalMakotoWalletAccount, submitter: LocalWalletSubmitter) {
    if (generation !== this.#generation || this.#status !== "unlocking") return false;
    if (wallet.status !== "connected" || !wallet.address || submitter.address.toLowerCase() !== wallet.address.toLowerCase()) return false;
    this.#wallet = wallet;
    this.#submitter = submitter;
    this.#status = "unlocked";
    return true;
  }

  failUnlock(generation: number, wallet: LocalMakotoWalletAccount) {
    if (generation !== this.#generation) return false;
    this.lock(wallet);
    return true;
  }

  lock(wallet: LocalMakotoWalletAccount) {
    this.#generation += 1;
    this.#submitter = undefined;
    this.#wallet = wallet;
    this.#status = lifecycleStatus(wallet);
  }

  isCurrentSubmitter(submitter: LocalWalletSubmitter) {
    return this.#status === "unlocked" && this.#submitter === submitter && this.#wallet.status === "connected";
  }

  destroy() {
    this.lock(createLocalMakotoWalletAccount({ address: this.#wallet.address, status: this.#wallet.address ? "locked" : "unavailable" }));
  }
}

export type ExternalWalletAccountInput = {
  address?: Address;
  chainId?: number;
  connectorChainId?: number;
  providerChainId?: number;
  connectionStatus: WalletConnectionStatus;
  isArc: boolean;
  providerName?: string;
  connectorId?: string;
};

export type LocalMakotoWalletAccountInput = {
  address?: Address;
  status: LocalMakotoWalletAccount["status"];
};

export function createExternalWalletAccount(input: ExternalWalletAccountInput): ExternalWalletAccount {
  const connected = input.connectionStatus === "connected" && Boolean(input.address);
  return Object.freeze({
    kind: "external" as const,
    address: input.address,
    chainId: input.providerChainId ?? input.connectorChainId ?? input.chainId,
    connectorChainId: input.connectorChainId,
    providerChainId: input.providerChainId,
    status: connected ? "connected" : "unavailable",
    connectionStatus: input.connectionStatus,
    isArc: input.isArc,
    providerName: input.providerName,
    connectorId: input.connectorId,
  });
}

export function createLocalMakotoWalletAccount(input: LocalMakotoWalletAccountInput): LocalMakotoWalletAccount {
  const connected = input.status === "connected" && Boolean(input.address);
  const locked = input.status === "locked" && Boolean(input.address);
  return Object.freeze({
    kind: "local" as const,
    address: input.address,
    chainId: input.address ? arcTestnet.id : undefined,
    providerChainId: input.address ? arcTestnet.id : undefined,
    status: connected ? "connected" : locked ? "locked" : "unavailable",
    connectionStatus: connected ? "connected" : "disconnected",
    isArc: Boolean(input.address),
    providerName: "Makoto Local Wallet",
  });
}

/** The submitter remains inside the local-wallet runtime; callers receive only this guarded adapter. */
export function createLocalWalletExecutionAdapter(
  getSubmitter: () => LocalWalletSubmitter | undefined,
  getWallet: () => LocalMakotoWalletAccount,
): WalletExecutionAdapter {
  return Object.freeze({
    kind: "local" as const,
    async submitReviewed(request) {
      const wallet = getWallet();
      const submitter = getSubmitter();
      if (wallet.status !== "connected" || !wallet.address || !submitter) throw new Error("Local wallet is locked.");
      if (request.chainId !== arcTestnet.id || wallet.chainId !== arcTestnet.id) throw new Error("Arc Testnet is required.");
      if (submitter.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Local wallet account changed. Review again.");
      return submitter.send(request);
    },
  });
}

export function isWalletConnected(context: WalletReadContext): context is WalletReadContext & { address: Address; status: "connected" } {
  return context.status === "connected" && context.address !== undefined;
}

function lifecycleStatus(wallet: LocalMakotoWalletAccount): LocalWalletLifecycleStatus {
  return wallet.status === "connected" ? "unlocked" : wallet.status === "locked" ? "locked" : "unavailable";
}
