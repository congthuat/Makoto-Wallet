import { ARC } from './wallet.ts'
import type { FeedTx, Feed } from './store.tsx'

export type AnalyticsNetwork = Readonly<{ blockNumber: number; updatedAt: number; fee?: number; latency?: number }>
export type AnalyticsStats = Readonly<{ transactionsToday?: number; totalAddresses?: number; utilization?: number }>
export type AnalyticsHolder = Readonly<{ address: string; name: string | null; contract: boolean; balance: number }>
export type AnalyticsHolders = Readonly<{ holdersCount?: number; items: readonly AnalyticsHolder[] }>

const object = (value: unknown): Record<string, unknown> | null => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const count = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value)
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))

/** Only the network endpoint exposes an observation timestamp for its uncached RPC reads. */
export function analyticsNetwork(value: unknown, failed: boolean, now = Date.now()): AnalyticsNetwork | null {
  const row = object(value)
  if (failed || !row || row.chainId !== ARC.chainId || !count(row.blockNumber) || !positive(row.updatedAt) || row.updatedAt > now + 5000 || now - row.updatedAt > 60_000) return null
  return {
    blockNumber: row.blockNumber, updatedAt: row.updatedAt,
    ...(positive(row.tokenTransferFeeUsdc) ? { fee: row.tokenTransferFeeUsdc } : {}),
    ...(positive(row.rpcLatencyMs) ? { latency: row.rpcLatencyMs } : {}),
  }
}

/** The existing stats route defaults absent fields to zero. Zero is therefore
 * ambiguous here, and is omitted rather than presented as an observed value. */
export function analyticsStats(value: unknown, failed: boolean): AnalyticsStats {
  const row = failed ? null : object(value)
  return {
    ...(count(row?.transactionsToday) ? { transactionsToday: row.transactionsToday } : {}),
    ...(count(row?.totalAddresses) ? { totalAddresses: row.totalAddresses } : {}),
    ...(positive(row?.utilization) && row.utilization <= 100 ? { utilization: row.utilization } : {}),
  }
}

/** Presentation guard only. No synthetic row, amount, hash, or timestamp fallback. */
export function analyticsTransfers(value: unknown): readonly FeedTx[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((entry) => {
    const row = object(entry)
    if (!row || typeof row.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(row.hash) || !Number.isInteger(row.logIndex) || Number(row.logIndex) < 0 || !count(row.block) || !timestamp(row.timestamp) || !positive(row.amount) || typeof row.symbol !== 'string' || !['USDC', 'EURC'].includes(row.symbol) || !(row.from === null || address(row.from)) || !(row.to === null || address(row.to)) || (!row.from && !row.to) || typeof row.fromContract !== 'boolean' || typeof row.toContract !== 'boolean') return []
    const key = `${row.hash.toLowerCase()}:${row.logIndex}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ ...row, fromName: typeof row.fromName === 'string' ? row.fromName : null, toName: typeof row.toName === 'string' ? row.toName : null, method: typeof row.method === 'string' ? row.method : null } as FeedTx]
  })
}

/** The feed ranks a bounded explorer sample with min=0; it has no USD threshold.
 * Preserve its ranking and never display the mixed USDC/EURC unit sum as dollars. */
export function analyticsFeed(value: unknown, failed: boolean): Pick<Feed, 'live' | 'whales'> {
  const row = failed ? null : object(value)
  return { live: [...analyticsTransfers(row?.live)], whales: [...analyticsTransfers(row?.whales)] }
}

export function analyticsTransferKind(row: Pick<FeedTx, 'fromContract' | 'toContract'>): 'Contract transfer' | 'Transfer' {
  return row.fromContract || row.toContract ? 'Contract transfer' : 'Transfer'
}

/** Address balances are displayed without claiming a native-USDC supply
 * distribution. The existing ERC-20 totalSupply/share fields stay undisplayed. */
export function analyticsHolders(value: unknown, failed: boolean): AnalyticsHolders | null {
  const row = failed ? null : object(value)
  if (!row || !Array.isArray(row.items)) return null
  const seen = new Set<string>()
  const items = row.items.flatMap((entry) => {
    const holder = object(entry)
    if (!holder || !address(holder.address) || !positive(holder.balance) || typeof holder.contract !== 'boolean' || seen.has(holder.address.toLowerCase())) return []
    seen.add(holder.address.toLowerCase())
    return [{ address: holder.address, name: typeof holder.name === 'string' ? holder.name : null, contract: holder.contract, balance: holder.balance }]
  })
  if (!items.length) return null
  return { items, ...(count(row.holdersCount) ? { holdersCount: row.holdersCount } : {}) }
}

export function analyticsAge(value: string | number, locale: string, now = Date.now()): string | null {
  const time = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(time) || time > now + 5000) return null
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  const [amount, unit] = seconds < 60 ? [seconds, 'second'] as const : seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] as const : [Math.floor(seconds / 3600), 'hour'] as const
  return new Intl.RelativeTimeFormat(locale === 'vi' ? 'vi-VN' : locale, { numeric: 'always' }).format(-amount, unit)
}
