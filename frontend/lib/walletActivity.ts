import { getAddress, isAddress, isHash, type Address, type Hash } from "viem";

import { getAssetById, type SupportedAsset } from "./assets.ts";
import { activityIdentity, normalizeWalletActivities } from "./onchainActivity.ts";
import type { WalletActivity } from "./wallet.ts";

const V3_PREFIX = "makoto-wallet:activity:v3";
const V2_PREFIX = "makoto-wallet:activity:v2";
const V1_PREFIX = "makoto-wallet:activity:v1";
const MAX_ACTIVITY = 50;
export const WALLET_ACTIVITY_UPDATED_EVENT = "makoto-wallet:activity-updated";
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type StoredActivity = Omit<WalletActivity, "amount" | "blockNumber" | "swapReceive"> & { amount: string; blockNumber: string; swapReceive?: Omit<NonNullable<WalletActivity["swapReceive"]>, "amount"> & { amount: string } };

export function walletActivityKey(address: Address, chainId: number) { return `${V3_PREFIX}:${address.toLowerCase()}:${chainId}`; }
export function v2WalletActivityKey(address: Address, chainId: number) { return `${V2_PREFIX}:${address.toLowerCase()}:${chainId}`; }
export function legacyWalletActivityKey(address: Address, chainId: number) { return `${V1_PREFIX}:${address.toLowerCase()}:${chainId}`; }

export function createAssetActivity(asset: SupportedAsset, record: Omit<WalletActivity, "assetId" | "assetSymbol" | "tokenAddress" | "decimals">): WalletActivity {
  return { source: "local", provider: "local-receipt", ...record, assetId: asset.id, assetSymbol: asset.symbol, tokenAddress: asset.address, decimals: asset.decimals };
}

export function serializeWalletActivity(records: WalletActivity[]) {
  return JSON.stringify(records.map((record) => { const { swapReceive, ...rest } = record; return { ...rest, amount: record.amount.toString(), blockNumber: record.blockNumber.toString(), ...(swapReceive ? { swapReceive: { ...swapReceive, amount: swapReceive.amount.toString() } } : {}) }; }) satisfies StoredActivity[]);
}

export function deserializeWalletActivity(payload: string): WalletActivity[] {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) return [];
    const records = parsed.map(parseV3Record);
    return records.every(Boolean) ? normalizeWalletActivities(records as WalletActivity[], MAX_ACTIVITY) : [];
  } catch { return []; }
}

export function loadWalletActivity(address: Address, chainId: number, storage = browserStorage()): WalletActivity[] {
  if (!storage) return [];
  try {
    const v3 = storage.getItem(walletActivityKey(address, chainId));
    if (v3 !== null) return deserializeWalletActivity(v3);
    const v2 = storage.getItem(v2WalletActivityKey(address, chainId));
    const v1 = storage.getItem(legacyWalletActivityKey(address, chainId));
    const migrated = v2 !== null ? deserializeOldActivity(v2, true) : v1 !== null ? deserializeOldActivity(v1, false) : [];
    storage.setItem(walletActivityKey(address, chainId), serializeWalletActivity(migrated));
    return migrated;
  } catch { return []; }
}

export function saveWalletActivity(address: Address, chainId: number, records: WalletActivity[], storage = browserStorage()) {
  const normalized = normalizeWalletActivities(records, MAX_ACTIVITY);
  try { storage?.setItem(walletActivityKey(address, chainId), serializeWalletActivity(normalized)); } catch { /* local cache is non-authoritative */ }
  return normalized;
}

export function addWalletActivity(address: Address, chainId: number, record: WalletActivity, storage = browserStorage()) {
  return saveWalletActivity(address, chainId, [record, ...loadWalletActivity(address, chainId, storage)], storage);
}

export function recordWalletActivity(address: Address, chainId: number, record: WalletActivity, storage = browserStorage()) {
  const records = addWalletActivity(address, chainId, record, storage);
  if (typeof window !== "undefined" && storage === window.localStorage) {
    window.dispatchEvent(new CustomEvent(WALLET_ACTIVITY_UPDATED_EVENT, { detail: { address: address.toLowerCase(), chainId } }));
  }
  return records;
}

export function mergeWalletActivity(onchain: WalletActivity[], local: WalletActivity[], limit = 250) {
  const canonical = new Set(onchain.map(canonicalTransferIdentity));
  return normalizeWalletActivities([...onchain, ...local.filter((item) => !canonical.has(canonicalTransferIdentity(item)))], limit);
}

function canonicalTransferIdentity(item: WalletActivity) {
  return `${item.hash.toLowerCase()}:${item.tokenAddress.toLowerCase()}:${item.direction}:${item.amount}:${item.counterparty.toLowerCase()}`;
}

function parseV3Record(value: unknown): WalletActivity | undefined {
  if (!isRecord(value) || typeof value.hash !== "string" || !isHash(value.hash) || !isSafeInteger(value.logIndex, -1) || (value.direction !== "send" && value.direction !== "receive") || !isActivityKind(value.kind) || typeof value.amount !== "string" || !/^\d+$/.test(value.amount) || BigInt(value.amount) <= 0n || typeof value.counterparty !== "string" || !isAddress(value.counterparty) || !isSafeInteger(value.confirmedAt, 0) || typeof value.blockNumber !== "string" || !/^\d+$/.test(value.blockNumber) || typeof value.assetId !== "string") return undefined;
  const asset = getAssetById(value.assetId);
  if (!asset || value.assetSymbol !== asset.symbol || typeof value.tokenAddress !== "string" || !isAddress(value.tokenAddress) || getAddress(value.tokenAddress) !== asset.address || value.decimals !== asset.decimals) return undefined;
  let swapReceive: WalletActivity["swapReceive"];
  if (value.swapReceive !== undefined) {
    if (!isRecord(value.swapReceive) || typeof value.swapReceive.assetId !== "string" || typeof value.swapReceive.amount !== "string" || !/^\d+$/.test(value.swapReceive.amount) || BigInt(value.swapReceive.amount) <= 0n || !isSafeInteger(value.swapReceive.logIndex, 0)) return undefined;
    const receivedAsset = getAssetById(value.swapReceive.assetId);
    if (!receivedAsset || value.swapReceive.assetSymbol !== receivedAsset.symbol || value.swapReceive.tokenAddress !== receivedAsset.address || value.swapReceive.decimals !== receivedAsset.decimals) return undefined;
    swapReceive = { amount: BigInt(value.swapReceive.amount), assetId: receivedAsset.id, assetSymbol: receivedAsset.symbol, tokenAddress: receivedAsset.address, decimals: receivedAsset.decimals, logIndex: value.swapReceive.logIndex };
  }
  if ((value.kind === "swap") !== Boolean(swapReceive)) return undefined;
  return { hash: value.hash, logIndex: value.logIndex, direction: value.direction, kind: value.kind, amount: BigInt(value.amount), counterparty: getAddress(value.counterparty), confirmedAt: value.confirmedAt, blockNumber: BigInt(value.blockNumber), assetId: asset.id, assetSymbol: asset.symbol, tokenAddress: asset.address, decimals: asset.decimals, source: "local", provider: "local-receipt", ...(swapReceive ? { swapReceive } : {}) };
}

function deserializeOldActivity(payload: string, hasAsset: boolean): WalletActivity[] {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) return [];
    const records: WalletActivity[] = [];
    for (const value of parsed) {
      if (!isRecord(value) || typeof value.hash !== "string" || !isHash(value.hash) || value.direction !== "send" || typeof value.amount !== "string" || !/^\d+$/.test(value.amount) || BigInt(value.amount) <= 0n || typeof value.counterparty !== "string" || !isAddress(value.counterparty) || !isSafeInteger(value.confirmedAt, 0)) return [];
      const asset = hasAsset && typeof value.assetId === "string" ? getAssetById(value.assetId) : getAssetById("usdc");
      if (!asset) return [];
      records.push(createAssetActivity(asset, { hash: value.hash as Hash, logIndex: -1, direction: "send", kind: "transfer", amount: BigInt(value.amount), counterparty: getAddress(value.counterparty), confirmedAt: value.confirmedAt, blockNumber: 0n }));
    }
    return normalizeWalletActivities(records, MAX_ACTIVITY);
  } catch { return []; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isSafeInteger(value: unknown, minimum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum; }
function isActivityKind(value: unknown): value is WalletActivity["kind"] { return value === "transfer" || value === "swap" || value === "bridge" || value === "vault-deposit" || value === "vault-withdraw"; }
function browserStorage(): StorageLike | undefined { return typeof window === "undefined" ? undefined : window.localStorage; }

export { activityIdentity };
