import { api } from './api.ts'
import type { PortfolioAssetValue } from '../../../shared/portfolioValuation.mjs'
import type { Prices, WalletApi } from './wallet.ts'

export const HISTORY_RANGES = ['1d', '1w', '1m', '1y', 'all'] as const
export type HistoryRange = typeof HISTORY_RANGES[number]
export const SNAPSHOT_INTERVAL_MS = 300_000
export type HistorySnapshot = {
  id: string
  walletAddress: string
  chainId: number
  capturedAt: string
  totalUsd: number
  assets: PortfolioAssetValue[]
  priceProvider: 'COINGECKO'
  priceStatus: 'FRESH'
  priceObservedAt: string
  balanceObservedAt: string
}
export type HistoryResponse = {
  walletAddress: string
  chainId: number
  range: HistoryRange
  snapshots: HistorySnapshot[]
  nextCaptureAt: string | null
  totalSnapshots?: number
  rangeSnapshots?: number
  downsampled?: boolean
}
export type SnapshotResponse = {
  status: 'SAVED' | 'THROTTLED' | 'SKIPPED'
  reason?: string
  snapshot: HistorySnapshot | null
  nextCaptureAt: string | null
  wallet?: WalletApi
  prices?: Prices
}
export type HistoryScope = { walletAddress: string; chainId: number }

export function historyScope(input: { mode: string; address: string; accountConfirmed: boolean; chainId?: number }): HistoryScope | null {
  if (input.mode !== 'connected' || !input.accountConfirmed || input.chainId !== 5042002 || !/^0x[0-9a-f]{40}$/i.test(input.address) || /^0x0{40}$/i.test(input.address)) return null
  return { walletAddress: input.address.toLowerCase(), chainId: input.chainId }
}

// The query cache lives only in this browser; its HttpOnly backend capability
// scopes all history requests independently of any task/SIWE session.
export function historyQueryKey(scope: HistoryScope | null, range?: HistoryRange) {
  const base = ['portfolio-history', 'local-browser', scope?.walletAddress ?? '', scope?.chainId ?? 0] as const
  return range ? [...base, range] as const : base
}

export function captureEligible(input: {
  scope: HistoryScope | null
  wallet?: WalletApi
  balanceFailed: boolean
  complete: boolean
  totalUsd?: number
  assets: readonly PortfolioAssetValue[]
  now?: number
}) {
  const { scope, wallet, assets, totalUsd } = input
  if (!scope || input.balanceFailed || !input.complete || !wallet || wallet.address.toLowerCase() !== scope.walletAddress || wallet.chainId !== scope.chainId || !Number.isFinite(totalUsd) || totalUsd! < 0) return false
  const now = input.now ?? Date.now()
  const balanceObserved = Date.parse(wallet.observedAt ?? '')
  if (!Number.isFinite(balanceObserved) || balanceObserved > now + 1000 || now - balanceObserved > 60_000) return false
  // Backend records only when all canonical prices are FRESH, including zeros.
  if (!assets.length) return false
  return assets.every((asset) => {
    if (!Number.isFinite(asset.balance) || asset.balance < 0) return false
    const price = asset.price
    const observed = Date.parse(price?.observedAt ?? '')
    return price?.provider === 'CoinGecko' && price.status === 'FRESH'
      && typeof asset.usdPrice === 'number' && Number.isFinite(asset.usdPrice) && asset.usdPrice > 0
      && typeof asset.usdValue === 'number' && Number.isFinite(asset.usdValue) && asset.usdValue >= 0
      && Number.isFinite(observed) && observed <= now + 1000 && now - observed <= SNAPSHOT_INTERVAL_MS
  })
}

export function historyPoints(data: HistoryResponse | undefined, scope: HistoryScope | null): [number, number][] {
  if (!scope || !data || data.walletAddress.toLowerCase() !== scope.walletAddress || data.chainId !== scope.chainId) return []
  // Never infer or backfill points. The server returns real capture timestamps.
  return data.snapshots.flatMap((snapshot) => {
    const time = Date.parse(snapshot.capturedAt)
    return snapshot.walletAddress.toLowerCase() === scope.walletAddress && snapshot.chainId === scope.chainId && Number.isFinite(time) && Number.isFinite(snapshot.totalUsd) && snapshot.totalUsd >= 0
      ? [[time / 1000, snapshot.totalUsd] as [number, number]] : []
  }).sort((a, b) => a[0] - b[0])
}

export function historyDisplayState(count: number, loading: boolean, failed: boolean): 'loading' | 'error' | 'empty' | 'starting' | 'chart' {
  if (loading) return 'loading'
  if (failed) return 'error'
  return count >= 2 ? 'chart' : count === 1 ? 'starting' : 'empty'
}

async function historyRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(api(`portfolio/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'X-Makoto-Request': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof result?.code === 'string' ? result.code : 'PORTFOLIO_HISTORY_UNAVAILABLE')
  return result as T
}

export const portfolioHistoryApi = {
  history(scope: HistoryScope, range: HistoryRange, signal?: AbortSignal) {
    const params = new URLSearchParams({ walletAddress: scope.walletAddress, chainId: String(scope.chainId), range })
    return historyRequest<HistoryResponse>(`history?${params}`, undefined, signal)
  },
  snapshot(scope: HistoryScope, signal?: AbortSignal) {
    // A caller never supplies balances, prices, a timestamp, or a fabricated total.
    return historyRequest<SnapshotResponse>('snapshot', scope, signal)
  },
}
