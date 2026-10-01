import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Zap, Waves, Activity as ActivityIcon, Trophy, Boxes, Users, Fuel, Cpu } from 'lucide-react'
import { useWallet, type FeedTx } from '../lib/store'
import { api } from '../lib/api'
import { explorerAddr, explorerTx, short } from '../lib/wallet'
import { Card, CardHeader, PageHeader, T, Avatar } from '../components/wallet/ui'
import { useT } from '../lib/i18n'
import {
  analyticsAge, analyticsFeed, analyticsHolders, analyticsNetwork, analyticsStats, analyticsTransferKind,
  type AnalyticsHolders,
} from '../lib/analyticsPresentation'

// Home also imports these exports. Keep the shared API shape unchanged.
export type Stats = { totalTransactions: number; transactionsToday: number; totalAddresses: number; totalBlocks: number; utilization: number; gas: { slow: number; average: number; fast: number } | null }
export const getJson = async <X,>(path: string): Promise<X> => {
  const r = await fetch(api(path))
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error ?? path)
  return j
}
export const compact = (n: number) => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const numberLocale = (locale: string) => locale === 'vi' ? 'vi-VN' : locale
const focusLink = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-300'
const DEFAULT_LIST_ROWS = 5

function ListFooter({ listId, hasMore, expanded, onToggle }: { listId: string; hasMore: boolean; expanded: boolean; onToggle: () => void }) {
  const [tr] = useT()
  return <div className="px-2 pt-3 flex flex-wrap items-center justify-between gap-2">
    <Source explorer />
    {hasMore && <button type="button" data-analytics-disclosure aria-controls={listId} aria-expanded={expanded} onClick={onToggle} className={`min-h-9 rounded-lg px-2 text-[12px] font-medium ${T.sub} hover:bg-white/[0.04] ${focusLink}`}>
      {tr(expanded ? 'Show less' : 'View more')}
    </button>}
  </div>
}

function Source({ rpc = false, explorer = false }: { rpc?: boolean; explorer?: boolean }) {
  const [tr] = useT()
  return <p data-analytics-source={[rpc && 'Arc RPC', explorer && 'Arc Explorer'].filter(Boolean).join(', ')} className={`text-[11px] ${T.mute}`}>
    {tr('Source')}: {[rpc && 'Arc RPC', explorer && 'Arc Explorer'].filter(Boolean).join(' · ')}
  </p>
}

function Party({ addr, name, contract }: { addr: string; name: string | null; contract: boolean }) {
  const [tr] = useT()
  return (
    <a href={explorerAddr(addr)} target="_blank" rel="noopener noreferrer" className={`inline-flex max-w-full items-center gap-1.5 min-w-0 rounded ${focusLink}`} title={addr}>
      <Avatar size={16} seed={addr} />
      <span className="truncate font-num text-[12px]">{name || short(addr)}</span>
      {contract && <span className={`shrink-0 text-[9px] px-1 rounded bg-white/[0.05] ${T.mute}`}>{tr('Contract')}</span>}
    </a>
  )
}

function LargestTransfers({ transfers }: { transfers: readonly FeedTx[] }) {
  const [tr, locale] = useT()
  const [expanded, setExpanded] = useState(false)
  const listId = 'analytics-largest-transfers-list'
  return (
    <div data-analytics-section="large-transfers" data-analytics-card="largest-transfers" className="min-w-0">
      <Card className="mk-in">
        <CardHeader title={<span className="flex items-center gap-2"><Waves size={16} aria-hidden="true" className="shrink-0 text-neon-300" /> {tr('Largest recent transfers')}</span>} sub="Ranked by token amount in the explorer sample" />
        <div className="px-3 pb-3">
          <div id={listId}>{(expanded ? transfers : transfers.slice(0, DEFAULT_LIST_ROWS)).map((row, i) => (
            <a data-analytics-transfer={row.hash} key={`${row.hash}-${row.logIndex}`} href={explorerTx(row.hash)} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/[0.04] ${focusLink}`}>
              <span className={`w-5 shrink-0 text-center text-[12px] font-bold font-num ${i < 3 ? 'text-neon-300' : T.mute}`}>{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block break-words text-[14px] font-semibold font-num">{row.amount.toLocaleString(numberLocale(locale), { maximumFractionDigits: 4 })} <span className={T.sub}>{row.symbol}</span></span>
                <span title={`${row.from ?? '—'} → ${row.to ?? '—'}`} className={`block text-[11px] truncate ${T.mute}`}>{row.fromName || short(row.from ?? '')} → {row.toName || short(row.to ?? '')}</span>
              </span>
              <span title={row.timestamp} className={`shrink-0 text-right text-[11px] ${T.mute}`}>{analyticsAge(row.timestamp, locale)}</span>
            </a>
          ))}</div>
          <ListFooter listId={listId} hasMore={transfers.length > DEFAULT_LIST_ROWS} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
        </div>
      </Card>
    </div>
  )
}

function RecentTransfers({ transfers }: { transfers: readonly FeedTx[] }) {
  const [tr, locale] = useT()
  const [expanded, setExpanded] = useState(false)
  const listId = 'analytics-recent-transfers-list'
  const seen = useRef<Set<string>>(new Set())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  useEffect(() => {
    const ids = transfers.map((row) => `${row.hash}-${row.logIndex}`)
    const first = seen.current.size === 0
    const added = new Set(ids.filter((id) => !seen.current.has(id)))
    seen.current = new Set(ids)
    if (!first && added.size) {
      setFresh(added)
      const timer = setTimeout(() => setFresh(new Set()), 2500)
      return () => clearTimeout(timer)
    }
  }, [transfers])
  return (
    <div data-analytics-section="recent-transfers" data-analytics-card="recent-transfers" className="min-w-0">
      <Card className="mk-in">
        <CardHeader title={<span className="flex items-center gap-2"><ActivityIcon size={16} aria-hidden="true" className="shrink-0 text-neon-300" /> {tr('Recent Transfers')}</span>} sub="Recent USDC & EURC transfers on Arc" />
        <div className="px-3 pb-3">
          <div id={listId}>{(expanded ? transfers : transfers.slice(0, DEFAULT_LIST_ROWS)).map((row) => {
            const id = `${row.hash}-${row.logIndex}`
            return (
              <a data-analytics-transfer={row.hash} key={id} href={explorerTx(row.hash)} target="_blank" rel="noopener noreferrer" className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center px-2 py-2 rounded-xl hover:bg-white/[0.04] transition-colors duration-700 motion-reduce:transition-none ${focusLink} ${fresh.has(id) ? 'bg-neon-400/10' : ''}`}>
                <span className="min-w-0 flex items-center gap-2">
                  <span aria-hidden="true" className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${row.symbol === 'EURC' ? 'bg-sky-500/15 text-sky-300' : 'bg-neon-400/10 text-neon-300'}`}>{row.symbol === 'EURC' ? '€' : '$'}</span>
                  <span className="min-w-0">
                    <span className="block break-words text-[13px] font-semibold font-num">{row.amount.toLocaleString(numberLocale(locale), { maximumFractionDigits: 4 })} {row.symbol}</span>
                    <span data-analytics-kind={analyticsTransferKind(row)} className={`block text-[11px] ${T.mute}`}>{tr(analyticsTransferKind(row))}</span>
                    <span title={`${row.from ?? '—'} → ${row.to ?? '—'}`} className={`block text-[11px] truncate ${T.mute}`}>{row.fromName || short(row.from ?? '')} → {row.toName || short(row.to ?? '')}</span>
                  </span>
                </span>
                <span className={`text-right text-[11px] ${T.mute}`}>
                  <span className="block font-num">#{row.block.toLocaleString(numberLocale(locale))}</span>
                  <span title={row.timestamp} className="block">{analyticsAge(row.timestamp, locale)}</span>
                </span>
              </a>
            )
          })}</div>
          <ListFooter listId={listId} hasMore={transfers.length > DEFAULT_LIST_ROWS} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
        </div>
      </Card>
    </div>
  )
}

function TopHolders({ holders }: { holders: AnalyticsHolders }) {
  const [tr, locale] = useT()
  const [expanded, setExpanded] = useState(false)
  const listId = 'analytics-holders-list'
  return (
    <div data-analytics-section="holders" data-analytics-card="holders" className="min-w-0">
      <Card className="mk-in">
        <CardHeader title={<span className="flex items-center gap-2"><Trophy size={16} aria-hidden="true" className="shrink-0 text-neon-300" /> {tr('Top USDC holding addresses')}</span>} sub="Includes contract addresses" />
        <div className="px-3 pb-3">
          <div id={listId}>{(expanded ? holders.items : holders.items.slice(0, DEFAULT_LIST_ROWS)).map((holder, i) => (
            <div data-analytics-holder={holder.address} key={holder.address} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/[0.04]">
              <span className={`w-5 shrink-0 text-center text-[12px] font-bold font-num ${i < 3 ? 'text-neon-300' : T.mute}`}>{i + 1}</span>
              <span className="flex-1 min-w-0"><Party addr={holder.address} name={holder.name} contract={holder.contract} /></span>
              <span className="shrink-0 text-right text-[13px] font-semibold font-num">{holder.balance.toLocaleString(numberLocale(locale), { notation: 'compact', maximumFractionDigits: 2 })}<span className={`block text-[11px] ${T.mute}`}>USDC</span></span>
            </div>
          ))}</div>
          <ListFooter listId={listId} hasMore={holders.items.length > DEFAULT_LIST_ROWS} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
        </div>
      </Card>
    </div>
  )
}

function ChainPulse() {
  const { network, networkError } = useWallet()
  const [tr, locale] = useT()
  const q = useQuery<Stats>({ queryKey: ['arc-stats'], queryFn: () => getJson('arc/stats'), refetchInterval: 30_000 })
  const rpc = analyticsNetwork(network, networkError)
  const stats = analyticsStats(q.data, q.isError)
  const number = (value: number, options?: Intl.NumberFormatOptions) => value.toLocaleString(numberLocale(locale), options)
  const items = [
    ...(rpc ? [{ id: 'block', icon: Boxes, label: 'Latest block', value: `#${number(rpc.blockNumber)}`, source: 'Arc RPC' }] : []),
    ...(stats.transactionsToday != null ? [{ id: 'transactions', icon: ActivityIcon, label: 'Transactions today', value: number(stats.transactionsToday, { notation: 'compact', maximumFractionDigits: 2 }), source: 'Arc Explorer' }] : []),
    ...(stats.totalAddresses != null ? [{ id: 'addresses', icon: Users, label: 'Total addresses', value: number(stats.totalAddresses, { notation: 'compact', maximumFractionDigits: 2 }), source: 'Arc Explorer' }] : []),
    ...(rpc?.fee != null ? [{ id: 'fee', icon: Fuel, label: 'Estimated token transfer fee', value: `${number(rpc.fee, { maximumFractionDigits: 6 })} USDC`, source: 'Arc RPC' }] : []),
    ...(stats.utilization != null ? [{ id: 'utilization', icon: Cpu, label: 'Utilization', value: `${number(stats.utilization, { maximumFractionDigits: 2 })}%`, source: 'Arc Explorer' }] : []),
    ...(rpc?.latency != null ? [{ id: 'latency', icon: Zap, label: 'Network response time', value: `${number(rpc.latency, { maximumFractionDigits: 0 })} ms`, source: 'Arc RPC' }] : []),
  ]
  return (
    <div data-analytics-section="network" data-analytics-card="pulse">
      <Card className="p-5 mk-in">
        <h2 className="text-[15px] font-semibold flex items-center gap-2"><Boxes size={16} aria-hidden="true" className="shrink-0 text-neon-300" /> {tr('Arc Chain Pulse')}</h2>
        {items.length ? <>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {items.map(({ id, icon: Icon, label, value, source }) => (
              <div data-analytics-metric={id} data-analytics-source={source} key={id} className="min-w-0 rounded-xl bg-white/[0.03] border border-white/[0.05] p-3">
                <div className={`flex items-start gap-1.5 text-[11px] ${T.mute}`}><Icon size={12} aria-hidden="true" className="shrink-0 mt-0.5" /> {tr(label)}</div>
                <div className="mt-1 break-words text-[15px] font-bold font-num">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Source rpc={!!rpc} explorer={Object.keys(stats).length > 0} />
            {rpc && <p title={new Date(rpc.updatedAt).toISOString()} data-analytics-observed={rpc.updatedAt} className={`text-[11px] ${T.mute}`}>{tr('RPC observed {age}').replace('{age}', analyticsAge(rpc.updatedAt, locale) ?? '')}</p>}
          </div>
        </> : <p data-analytics-unavailable="pulse" className={`mt-4 text-[13px] ${T.mute}`}>{tr(q.isLoading && !networkError ? 'Loading Arc network data…' : 'Arc network data is unavailable right now.')}</p>}
      </Card>
    </div>
  )
}

export default function Insights() {
  const [tr] = useT()
  const { feed, feedError } = useWallet()
  const q = useQuery<unknown>({ queryKey: ['holders'], queryFn: () => getJson('arc/holders'), refetchInterval: 120_000 })
  const transfers = analyticsFeed(feed, feedError)
  const holders = analyticsHolders(q.data, q.isError)
  const hasRows = transfers.whales.length > 0 || transfers.live.length > 0 || holders != null
  return (
    <div data-analytics-page className="space-y-5 min-w-0" style={{ overflowAnchor: 'none' }}>
      <PageHeader title="Insights" desc="Explore Arc onchain data and network activity." />
      <p data-analytics-read-only className={`text-[11px] ${T.mute}`}>{tr('Read-only · No transaction execution')}</p>
      <ChainPulse />
      {hasRows ? <div className="grid lg:grid-cols-3 gap-5 items-start">
        {transfers.whales.length > 0 && <LargestTransfers transfers={transfers.whales} />}
        {transfers.live.length > 0 && <RecentTransfers transfers={transfers.live} />}
        {holders && <TopHolders holders={holders} />}
      </div> : <p data-analytics-unavailable="explorer" role="status" className={`text-[13px] ${T.mute}`}>{tr(q.isLoading && !feedError ? 'Loading Arc explorer data…' : 'Arc explorer data is unavailable right now.')}</p>}
    </div>
  )
}
