import { getAddress, isAddress, isHash, type Address } from "viem";

import { getAssetByAddress } from "./assets.ts";
import { CCTP_TOKEN_MINTER_V2 } from "./cctp.ts";
import { XYLO_POOL, XYLO_ROUTER } from "./swap.ts";
import type { WalletActivity } from "./wallet.ts";

export type WalletActivityPage = { activities: WalletActivity[]; nextCursor?: string; partial?: boolean; provider?: "arcscan" | "rpc" | "arcscan+rpc" };
export type SerializedWalletActivity = Omit<WalletActivity, "amount" | "blockNumber" | "swapReceive"> & { amount: string; blockNumber: string; swapReceive?: Omit<NonNullable<WalletActivity["swapReceive"]>, "amount"> & { amount: string } };
export type SerializedWalletActivityPage = { activities: SerializedWalletActivity[]; nextCursor?: string; partial?: boolean; provider?: WalletActivityPage["provider"] };

type RecordValue = Record<string, unknown>;

export function activityIdentity(activity: Pick<WalletActivity, "hash" | "logIndex" | "tokenAddress">) {
  return `${activity.hash.toLowerCase()}:${activity.logIndex}:${activity.tokenAddress.toLowerCase()}`;
}

export function normalizeWalletActivities(records: WalletActivity[], limit = 50) {
  const unique = new Map<string, WalletActivity>();
  for (const record of [...records].sort(compareActivity)) {
    const key = activityIdentity(record);
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()].slice(0, limit);
}

export function parseArcScanActivity(payload: unknown, wallet: Address, vaultAddress?: Address): WalletActivityPage {
  if (!isRecord(payload) || !Array.isArray(payload.items)) throw new Error("Invalid ArcScan activity response");
  const records: WalletActivity[] = [];
  for (const value of payload.items) {
    const parsed = parseTransfer(value, wallet, vaultAddress);
    if (parsed) records.push(parsed);
  }
  const nextCursor = encodeArcScanCursor(payload.next_page_params);
  return { activities: normalizeWalletActivities(groupXyloSwaps(records), 50), ...(nextCursor ? { nextCursor } : {}), provider: "arcscan" };
}

export function serializeWalletActivityPage(page: WalletActivityPage): SerializedWalletActivityPage {
  return {
    activities: page.activities.map((item) => { const { swapReceive, ...rest } = item; return { ...rest, amount: item.amount.toString(), blockNumber: item.blockNumber.toString(), ...(swapReceive ? { swapReceive: { ...swapReceive, amount: swapReceive.amount.toString() } } : {}) }; }),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    ...(page.partial ? { partial: true } : {}),
    ...(page.provider ? { provider: page.provider } : {}),
  };
}

export function deserializeWalletActivityPage(payload: unknown): WalletActivityPage {
  if (!isRecord(payload) || !Array.isArray(payload.activities)) throw new Error("Invalid wallet activity response");
  const activities: WalletActivity[] = [];
  for (const value of payload.activities) {
    if (!isRecord(value)) throw new Error("Invalid wallet activity record");
    const asset = typeof value.tokenAddress === "string" ? getAssetByAddress(value.tokenAddress) : undefined;
    if (!asset || typeof value.hash !== "string" || !isHash(value.hash) || !isSafeNonNegativeInteger(value.logIndex) || (value.direction !== "send" && value.direction !== "receive") || !isActivityKind(value.kind) || typeof value.amount !== "string" || !/^\d+$/.test(value.amount) || BigInt(value.amount) <= 0n || typeof value.counterparty !== "string" || !isAddress(value.counterparty) || !isSafeNonNegativeInteger(value.confirmedAt) || typeof value.blockNumber !== "string" || !/^\d+$/.test(value.blockNumber) || value.assetId !== asset.id || value.assetSymbol !== asset.symbol || value.decimals !== asset.decimals) throw new Error("Invalid wallet activity record");
    const swapReceive = parseSwapReceive(value.swapReceive);
    if ((value.kind === "swap") !== Boolean(swapReceive)) throw new Error("Invalid wallet activity record");
    activities.push({ ...value, hash: value.hash, tokenAddress: asset.address, counterparty: getAddress(value.counterparty), amount: BigInt(value.amount), blockNumber: BigInt(value.blockNumber), assetId: asset.id, assetSymbol: asset.symbol, decimals: asset.decimals, ...(swapReceive ? { swapReceive } : {}) } as WalletActivity);
  }
  const nextCursor = typeof payload.nextCursor === "string" && decodeArcScanCursor(payload.nextCursor) ? payload.nextCursor : undefined;
  const partial = payload.partial === true;
  const provider = payload.provider === "arcscan" || payload.provider === "rpc" || payload.provider === "arcscan+rpc" ? payload.provider : undefined;
  return { activities: normalizeWalletActivities(activities, 50), ...(nextCursor ? { nextCursor } : {}), ...(partial ? { partial } : {}), ...(provider ? { provider } : {}) };
}

export function encodeArcScanCursor(value: unknown) {
  if (!isRecord(value) || !isSafeNonNegativeInteger(value.block_number) || !isSafeNonNegativeInteger(value.index)) return undefined;
  return `${value.block_number}.${value.index}`;
}

export function decodeArcScanCursor(cursor: string) {
  const match = /^(\d{1,16})\.(\d{1,16})$/.exec(cursor);
  if (!match) return undefined;
  const block_number = Number(match[1]);
  const index = Number(match[2]);
  return Number.isSafeInteger(block_number) && Number.isSafeInteger(index) ? { block_number, index } : undefined;
}

function parseTransfer(value: unknown, wallet: Address, vaultAddress?: Address): WalletActivity | undefined {
  if (!isRecord(value) || !isRecord(value.from) || !isRecord(value.to) || !isRecord(value.token) || !isRecord(value.total)) return undefined;
  const tokenAddress = value.token.address_hash;
  const fromRaw = value.from.hash;
  const toRaw = value.to.hash;
  if (typeof tokenAddress !== "string" || typeof fromRaw !== "string" || typeof toRaw !== "string" || !isAddress(fromRaw) || !isAddress(toRaw)) return undefined;
  const asset = getAssetByAddress(tokenAddress);
  if (!asset || typeof value.transaction_hash !== "string" || !isHash(value.transaction_hash) || !isSafeNonNegativeInteger(value.log_index) || !isSafeNonNegativeInteger(value.block_number) || typeof value.timestamp !== "string" || typeof value.total.value !== "string" || !/^\d+$/.test(value.total.value)) return undefined;
  const amount = BigInt(value.total.value);
  if (amount <= 0n) return undefined;
  const from = getAddress(fromRaw);
  const to = getAddress(toRaw);
  const normalizedWallet = getAddress(wallet);
  const isFrom = from === normalizedWallet;
  const isTo = to === normalizedWallet;
  if (isFrom === isTo) return undefined;
  const confirmedAt = Date.parse(value.timestamp);
  if (!Number.isFinite(confirmedAt) || confirmedAt < 0) return undefined;
  const isCctpBridge = isFrom
    && asset.id === "usdc"
    && to === CCTP_TOKEN_MINTER_V2
    && value.method === "depositForBurnWithHook";
  const isVaultTransfer = Boolean(vaultAddress && (isFrom ? to : from) === vaultAddress);
  return {
    hash: value.transaction_hash,
    logIndex: value.log_index,
    direction: isFrom ? "send" : "receive",
    kind: isCctpBridge ? "bridge" : isVaultTransfer ? (isFrom ? "vault-deposit" : "vault-withdraw") : "transfer",
    amount,
    counterparty: isFrom ? to : from,
    confirmedAt,
    blockNumber: BigInt(value.block_number),
    assetId: asset.id,
    assetSymbol: asset.symbol,
    tokenAddress: asset.address,
    decimals: asset.decimals,
    source: "onchain",
    provider: "arcscan",
  };
}

export function groupXyloSwaps(records: WalletActivity[]) {
  const byTransaction = new Map<string, WalletActivity[]>();
  for (const record of records) {
    const key = record.hash.toLowerCase();
    const transaction = byTransaction.get(key) ?? [];
    transaction.push(record);
    byTransaction.set(key, transaction);
  }

  const grouped = new Map<string, WalletActivity>();
  const consumed = new Set<string>();
  for (const transaction of byTransaction.values()) {
    const receives = transaction.filter((item) => item.direction === "receive" && item.counterparty === XYLO_POOL);
    for (const sent of transaction.filter((item) => item.direction === "send" && item.counterparty === XYLO_ROUTER)) {
      if (consumed.has(activityIdentity(sent))) continue;
      const received = receives.find((item) => !consumed.has(activityIdentity(item)) && item.assetId !== sent.assetId);
      if (!received) continue;
      const sentKey = activityIdentity(sent);
      consumed.add(sentKey);
      consumed.add(activityIdentity(received));
      grouped.set(sentKey, { ...sent, kind: "swap", swapReceive: { amount: received.amount, assetId: received.assetId, assetSymbol: received.assetSymbol, tokenAddress: received.tokenAddress, decimals: received.decimals, logIndex: received.logIndex } });
    }
  }

  return records.flatMap((record) => {
    const key = activityIdentity(record);
    const swap = grouped.get(key);
    if (swap) return [swap];
    return consumed.has(key) ? [] : [record];
  });
}

function parseSwapReceive(value: unknown): WalletActivity["swapReceive"] {
  if (!isRecord(value) || typeof value.tokenAddress !== "string") return undefined;
  const asset = getAssetByAddress(value.tokenAddress);
  if (!asset || typeof value.amount !== "string" || !/^\d+$/.test(value.amount) || BigInt(value.amount) <= 0n || value.assetId !== asset.id || value.assetSymbol !== asset.symbol || value.decimals !== asset.decimals || !isSafeNonNegativeInteger(value.logIndex)) return undefined;
  return { amount: BigInt(value.amount), assetId: asset.id, assetSymbol: asset.symbol, tokenAddress: asset.address, decimals: asset.decimals, logIndex: value.logIndex };
}

function compareActivity(a: WalletActivity, b: WalletActivity) {
  if (b.confirmedAt !== a.confirmedAt) return b.confirmedAt - a.confirmedAt;
  return b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : b.logIndex - a.logIndex;
}

function isRecord(value: unknown): value is RecordValue { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isSafeNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isActivityKind(value: unknown): value is WalletActivity["kind"] { return value === "transfer" || value === "swap" || value === "bridge" || value === "vault-deposit" || value === "vault-withdraw"; }
