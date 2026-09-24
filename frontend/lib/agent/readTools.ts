import { getAddress, isAddress, isHash, type Address, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { erc20BalanceAbi } from "../abi/erc20.ts";
import { getAssetById, SUPPORTED_ASSETS, type SupportedAssetId } from "../assets.ts";
import { loadBridgeOperations, type BridgeOperation } from "../bridgeOperation.ts";
import { verifyTransactionReceipt, type MinimalTransactionReceipt } from "../transactionReceipt.ts";
import type { WalletActivity } from "../wallet.ts";
import type { AgentActivityFilter, AgentContextSnapshot } from "./types.ts";
import { requireValidTool, validateReadRequest, validateReadResult } from "./toolSchemas.ts";

export type ReadToolId = "wallet.identity" | "wallet.state" | "network.verified" | "assets.balances" | "activity.recent" | "activity.status" | "token.allowance" | "transaction.receipt" | "bridge.operation";
export type ReadError = "INVALID_REQUEST" | "UNSUPPORTED" | "WALLET_UNAVAILABLE" | "DATA_UNAVAILABLE" | "PROVIDER_FAILURE";
export type ReadSource = "wallet-provider" | "wallet-balance-hook" | "arc-rpc" | "arcscan-api" | "local-receipt" | "bridge-operation-persistence" | "circle-status" | "unknown";
type ReadBase = Readonly<{ tool: ReadToolId; account?: Address; chainId?: number; capturedAt: number; observedAt: number | null; freshness: "live" | "snapshot" | "unknown" | "persisted"; source: readonly ReadSource[] }>;
export type ReadResult<T> =
  | (ReadBase & Readonly<{ status: "AVAILABLE"; data: T }>)
  | (ReadBase & Readonly<{ status: "PARTIAL"; data: T; error: ReadError }>)
  | (ReadBase & Readonly<{ status: "UNAVAILABLE"; error: ReadError }>);

export type ReadRequest =
  | Readonly<{ tool: "wallet.identity" | "wallet.state" | "network.verified" | "assets.balances" | "activity.status" }>
  | Readonly<{ tool: "activity.recent"; filter?: AgentActivityFilter; limit?: number }>
  | Readonly<{ tool: "token.allowance"; assetId: SupportedAssetId; spender: Address }>
  | Readonly<{ tool: "transaction.receipt"; hash: Hash }>
  | Readonly<{ tool: "bridge.operation"; operationId: string }>;

/** This boundary accepts only read operations. It cannot carry a wallet execution adapter. */
export type ReadServices = Readonly<{
  readBalance?(account: Address, assetId: SupportedAssetId): Promise<bigint>;
  readAllowance?(account: Address, assetId: SupportedAssetId, spender: Address): Promise<bigint>;
  readReceipt?(hash: Hash): Promise<MinimalTransactionReceipt | undefined>;
  readBridgeOperations?(account: Address): readonly BridgeOperation[];
}>;
export type ReadContext = Readonly<{ snapshot: AgentContextSnapshot; services?: ReadServices; now?: () => number }>;

export type WalletIdentity = Readonly<{ exists: boolean; kind?: "external" | "local"; address?: Address; providerName?: string }>;
export type WalletState = Readonly<{ exists: boolean; externallyConnected: boolean; localSigningLocked: boolean; status: "connected" | "locked" | "unavailable" }>;
export type VerifiedNetwork = Readonly<{ chainId?: number; isArc: boolean; requiredChainId: number }>;
export type Balances = Readonly<Partial<Record<SupportedAssetId, bigint>>>;
export type ActivityStatus = Readonly<{ loadState: AgentContextSnapshot["activityLoadState"]; loadedCount: number; confirmedCount: number; unresolvedCount: number; completeHistory: false }>;
export type Allowance = Readonly<{ assetId: SupportedAssetId; token: Address; owner: Address; spender: Address; amount: bigint }>;
export type ReceiptEvidence = Readonly<{ hash: Hash; state: "pending" | "confirmed" | "failed" | "unknown"; blockNumber?: bigint; verified: boolean; reason?: string }>;
export type BridgeEvidence = Readonly<{ operationId: string; sourceChainId: number; destinationChainId: number; state: BridgeOperation["state"]; source: "not-submitted" | "submitted" | "confirmed" | "failed" | "unknown"; destination: "pending" | "confirmed" | "failed" | "unknown"; sourceHash?: Hash; destinationHash?: Hash; circle?: BridgeOperation["circle"]; destinationVerifiedAt?: number }>;

const available = <T>(base: ReadBase, data: T): ReadResult<T> => Object.freeze({ ...base, status: "AVAILABLE", data });
const partial = <T>(base: ReadBase, data: T, error: ReadError): ReadResult<T> => Object.freeze({ ...base, status: "PARTIAL", data, error });
const unavailable = <T>(base: ReadBase, error: ReadError): ReadResult<T> => Object.freeze({ ...base, status: "UNAVAILABLE", error });
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const activitySource = (items: readonly WalletActivity[]): ReadSource[] => [...new Set(items.map((item) => item.provider === "local-receipt" ? "local-receipt" : item.provider === "arcscan" ? "arcscan-api" : item.provider === "rpc" ? "arc-rpc" : "unknown" as ReadSource))];

/** A single typed entry point for Agent READ capabilities. */
export function runReadTool(context: ReadContext, request: { tool: "wallet.identity" }): Promise<ReadResult<WalletIdentity>>;
export function runReadTool(context: ReadContext, request: { tool: "wallet.state" }): Promise<ReadResult<WalletState>>;
export function runReadTool(context: ReadContext, request: { tool: "network.verified" }): Promise<ReadResult<VerifiedNetwork>>;
export function runReadTool(context: ReadContext, request: { tool: "assets.balances" }): Promise<ReadResult<Balances>>;
export function runReadTool(context: ReadContext, request: { tool: "activity.status" }): Promise<ReadResult<ActivityStatus>>;
export function runReadTool(context: ReadContext, request: { tool: "activity.recent"; filter?: AgentActivityFilter; limit?: number }): Promise<ReadResult<readonly WalletActivity[]>>;
export function runReadTool(context: ReadContext, request: { tool: "token.allowance"; assetId: SupportedAssetId; spender: Address }): Promise<ReadResult<Allowance>>;
export function runReadTool(context: ReadContext, request: { tool: "transaction.receipt"; hash: Hash }): Promise<ReadResult<ReceiptEvidence>>;
export function runReadTool(context: ReadContext, request: { tool: "bridge.operation"; operationId: string }): Promise<ReadResult<BridgeEvidence>>;
export async function runReadTool(context: ReadContext, request: ReadRequest): Promise<ReadResult<unknown>> {
  requireValidTool(validateReadRequest(request));
  const evaluate = async (): Promise<ReadResult<unknown>> => {
  const { snapshot: s, services } = context;
  const now = context.now ?? Date.now;
  const base = (tool: ReadToolId, source: readonly ReadSource[]): ReadBase => ({ tool, ...(s.account ? { account: s.account } : {}), ...(s.verifiedChainId !== undefined ? { chainId: s.verifiedChainId } : {}), capturedAt: s.timestamp, observedAt: s.timestamp, freshness: "snapshot", source });
  const wallet = base(request.tool, ["wallet-provider"]);
  const exists = Boolean(s.account);
  switch (request.tool) {
    case "wallet.identity": return available(wallet, { exists, ...(s.accountKind ? { kind: s.accountKind } : {}), ...(s.account ? { address: s.account } : {}), ...(s.walletType ? { providerName: s.walletType } : {}) } satisfies WalletIdentity);
    case "wallet.state": return available(wallet, { exists, externallyConnected: s.accountKind === "external" && s.connected, localSigningLocked: s.accountKind === "local" && s.walletStatus === "locked", status: s.walletStatus ?? (s.connected ? "connected" : "unavailable") } satisfies WalletState);
    case "network.verified": return s.verifiedChainId === undefined ? unavailable(wallet, "DATA_UNAVAILABLE") : available(wallet, { chainId: s.verifiedChainId, isArc: s.verifiedChainId === arcTestnet.id && s.isArc, requiredChainId: arcTestnet.id } satisfies VerifiedNetwork);
    case "assets.balances": {
      const b = { ...base(request.tool, services?.readBalance ? ["arc-rpc"] : ["wallet-balance-hook"]), observedAt: services?.readBalance ? now() : null, freshness: services?.readBalance ? "live" as const : "unknown" as const };
      if (!s.account) return unavailable(b, "WALLET_UNAVAILABLE");
      if (s.verifiedChainId !== arcTestnet.id) return unavailable(b, "UNSUPPORTED");
      const values: Partial<Record<SupportedAssetId, bigint>> = {};
      if (services?.readBalance) {
        const settled = await Promise.allSettled(SUPPORTED_ASSETS.map((asset) => services.readBalance!(s.account!, asset.id)));
        settled.forEach((item, index) => { if (item.status === "fulfilled") values[SUPPORTED_ASSETS[index].id] = item.value; });
      } else Object.assign(values, s.balances);
      const count = Object.values(values).filter((value) => typeof value === "bigint").length;
      return count === 3 ? available(b, Object.freeze(values)) : count ? partial(b, Object.freeze(values), "DATA_UNAVAILABLE") : unavailable(b, services?.readBalance ? "PROVIDER_FAILURE" : "DATA_UNAVAILABLE");
    }
    case "activity.status": {
      const b = { ...base(request.tool, activitySource(s.activity)), observedAt: null, freshness: "unknown" as const };
      if (!s.account) return unavailable(b, "WALLET_UNAVAILABLE");
      const confirmedCount = s.activity.filter((item) => item.blockNumber > 0n).length;
      const data: ActivityStatus = { loadState: s.activityLoadState, loadedCount: s.activity.length, confirmedCount, unresolvedCount: s.activity.length - confirmedCount, completeHistory: false };
      return s.activityLoadState === "unavailable" && s.activity.length === 0 ? unavailable(b, "DATA_UNAVAILABLE") : s.activityLoadState !== "loaded" ? partial(b, data, "DATA_UNAVAILABLE") : available(b, data);
    }
    case "activity.recent": {
      const b = { ...base(request.tool, activitySource(s.activity)), observedAt: null, freshness: "unknown" as const };
      if (!s.account) return unavailable(b, "WALLET_UNAVAILABLE");
      if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100)) return unavailable(b, "INVALID_REQUEST");
      const filter = request.filter ?? "all";
      if (!["all", "send", "receive", "swap", "bridge", "vault"].includes(filter)) return unavailable(b, "INVALID_REQUEST");
      const data = s.activity.filter((item) => filter === "all" || filter === "swap" && item.kind === "swap" || filter === "bridge" && item.kind === "bridge" || filter === "vault" && item.kind.startsWith("vault-") || filter === "send" && item.direction === "send" || filter === "receive" && item.direction === "receive").slice(0, request.limit ?? 5);
      return s.activityLoadState === "unavailable" && data.length === 0 ? unavailable(b, "DATA_UNAVAILABLE") : s.activityLoadState === "loaded" ? available(b, data) : partial(b, data, "DATA_UNAVAILABLE");
    }
    case "token.allowance": {
      const b = { ...base(request.tool, ["arc-rpc"]), observedAt: now(), freshness: "live" as const };
      const asset = getAssetById(request.assetId);
      if (!asset || !isAddress(request.spender)) return unavailable(b, "INVALID_REQUEST");
      if (!s.account) return unavailable(b, "WALLET_UNAVAILABLE");
      if (s.verifiedChainId !== arcTestnet.id) return unavailable(b, "UNSUPPORTED");
      if (!services?.readAllowance) return unavailable(b, "DATA_UNAVAILABLE");
      try { return available(b, { assetId: asset.id, token: asset.address, owner: s.account, spender: getAddress(request.spender), amount: await services.readAllowance(s.account, asset.id, getAddress(request.spender)) } satisfies Allowance); }
      catch { return unavailable(b, "PROVIDER_FAILURE"); }
    }
    case "transaction.receipt": {
      const b = { ...base(request.tool, ["arc-rpc"]), observedAt: now(), freshness: "live" as const };
      if (!isHash(request.hash)) return unavailable(b, "INVALID_REQUEST");
      if (!s.account) return unavailable(b, "WALLET_UNAVAILABLE");
      if (s.verifiedChainId !== arcTestnet.id) return unavailable(b, "UNSUPPORTED");
      if (!services?.readReceipt) return unavailable(b, "DATA_UNAVAILABLE");
      const record = s.activity.find((item) => same(item.hash, request.hash));
      try {
        const receipt = await services.readReceipt(request.hash);
        if (!receipt) return available(b, { hash: request.hash, state: record?.source === "local" && record.blockNumber === 0n ? "pending" : "unknown", verified: false } satisfies ReceiptEvidence);
        if (!receipt.transactionHash || !same(receipt.transactionHash, request.hash)) return partial(b, { hash: request.hash, state: "unknown", verified: false, reason: "hash-mismatch" } satisfies ReceiptEvidence, "DATA_UNAVAILABLE");
        if (!record) return partial(b, { hash: request.hash, state: "unknown", blockNumber: receipt.blockNumber, verified: false, reason: "activity-evidence-unavailable" } satisfies ReceiptEvidence, "DATA_UNAVAILABLE");
        if (receipt.status === "reverted") return available(b, { hash: request.hash, state: "failed", blockNumber: receipt.blockNumber, verified: true } satisfies ReceiptEvidence);
        const verification = verifyTransactionReceipt(record, s.account, receipt);
        return verification.verified ? available(b, { hash: request.hash, state: "confirmed", blockNumber: receipt.blockNumber, verified: true } satisfies ReceiptEvidence) : partial(b, { hash: request.hash, state: "unknown", blockNumber: receipt.blockNumber, verified: false, reason: verification.reason } satisfies ReceiptEvidence, "DATA_UNAVAILABLE");
      } catch { return unavailable(b, "PROVIDER_FAILURE"); }
    }
    case "bridge.operation": {
      const b = base(request.tool, ["bridge-operation-persistence"]);
      if (!s.account) return unavailable(b, "WALLET_UNAVAILABLE");
      if (!request.operationId) return unavailable(b, "INVALID_REQUEST");
      if (!services?.readBridgeOperations) return unavailable(b, "DATA_UNAVAILABLE");
      try {
        const operation = services.readBridgeOperations(s.account).find((item) => item.id === request.operationId && same(item.sender, s.account!));
        if (!operation) return unavailable(b, "DATA_UNAVAILABLE");
        const burn = operation.transactions.find((item) => item.role === "burn");
        const destination = operation.transactions.find((item) => item.role === "mint" || item.role === "forward");
        const source: BridgeEvidence["source"] = burn?.status === "reverted" || operation.state === "source-failed" ? "failed" : burn?.status === "confirmed" ? "confirmed" : burn?.status === "submitted" || burn?.status === "confirming" ? "submitted" : burn?.status === "unknown" || operation.state === "source-confirmation-unknown" || ["source-confirmed", "waiting-circle", "forwarding-submitted", "destination-verification-pending", "destination-confirmed", "destination-failed"].includes(operation.state) ? "unknown" : "not-submitted";
        const destinationState: BridgeEvidence["destination"] = operation.state === "destination-confirmed" && operation.destinationEvidence ? "confirmed" : operation.state === "destination-failed" ? "failed" : operation.state === "destination-confirmed" ? "unknown" : source === "confirmed" ? "pending" : "unknown";
        const data: BridgeEvidence = { operationId: operation.id, sourceChainId: operation.sourceChainId, destinationChainId: operation.destinationChainId, state: operation.state, source, destination: destinationState, ...(burn ? { sourceHash: burn.hash } : {}), ...(destination ? { destinationHash: destination.hash } : {}), ...(operation.circle ? { circle: operation.circle } : {}), ...(operation.destinationEvidence ? { destinationVerifiedAt: operation.destinationEvidence.verifiedAt } : {}) };
        const sourceList: ReadSource[] = operation.circle ? ["bridge-operation-persistence", "circle-status"] : ["bridge-operation-persistence"];
        const evidenceBase = { ...b, source: sourceList, observedAt: operation.updatedAt, freshness: "persisted" as const };
        return destinationState === "unknown" || source === "unknown" ? partial(evidenceBase, data, "DATA_UNAVAILABLE") : available(evidenceBase, data);
      } catch { return unavailable(b, "DATA_UNAVAILABLE"); }
    }
  }
  };
  return requireValidTool(validateReadResult(await evaluate()));
}

/** Read-only adapters reuse the wallet asset registry, ERC-20 ABI, receipt verifier, and bridge persistence. */
export function createReadServices(client: Readonly<{
  chain: { id: number };
  readContract(args: { address: Address; abi: typeof erc20BalanceAbi; functionName: "balanceOf" | "allowance"; args: readonly Address[] }): Promise<bigint>;
  getTransactionReceipt(args: { hash: Hash }): Promise<MinimalTransactionReceipt>;
}>): ReadServices {
  if (client.chain.id !== arcTestnet.id) throw new Error("Arc Testnet read client required.");
  return Object.freeze({
    readBalance: (account: Address, assetId: SupportedAssetId) => client.readContract({ address: getAssetById(assetId)!.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account] }),
    readAllowance: (account: Address, assetId: SupportedAssetId, spender: Address) => client.readContract({ address: getAssetById(assetId)!.address, abi: erc20BalanceAbi, functionName: "allowance", args: [account, spender] }),
    readReceipt: async (hash: Hash) => { try { return await client.getTransactionReceipt({ hash }); } catch (error) { if (error instanceof Error && /TransactionReceiptNotFoundError/.test(error.name)) return undefined; throw error; } },
    readBridgeOperations: (account: Address) => loadBridgeOperations(account),
  });
}
