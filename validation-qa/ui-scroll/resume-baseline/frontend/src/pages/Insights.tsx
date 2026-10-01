import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Zap, Waves, Activity as ActivityIcon, Trophy, Gauge, Boxes, Users, Fuel, Cpu,
} from 'lucide-react'
import { useWallet, type FeedTx } from '../lib/store'
import { api } from '../lib/api'
import { explorerAddr, explorerTx, short, usd } from '../lib/wallet'
import { Card, CardHeader, PageHeader, Skeleton, T, Avatar } from '../components/wallet/ui'
import { useT } from '../lib/i18n'

type Sentiment = { value: number | null; label: string | null; btcPrice: number | null; yesterday: number | null; weekAgo: number | null; monthAgo: number | null; history: [number, number][] }
type Holders = { holdersCount: number; totalSupply: number; items: { address: string; name: string | null; contract: boolean; balance: number; share: number }[] }
export type Stats = { totalTransactions: number; transactionsToday: number; totalAddresses: number; totalBlocks: number; utilization: number; gas: { slow: number; average: number; fast: number } | null }

export const getJson = async <X,>(path: string): Promise<X> => {
  const r = await fetch(api(path))
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error ?? path)
  return j
}
export const compact = (n: number) => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const secsAgo = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

/* ---------------- Fear & Greed gauge ---------------- */
function FearGreed() {
  const [tr] = useT()
  const q = useQuery<Sentiment>({ queryKey: ['sentiment'], queryFn: () => getJson('sentiment'), refetchInterval: 600_000 })
  const v = q.data?.value ?? null
  const ang = v == null ? -90 : -90 + (v / 100) * 180
  const tone = (x: number | null) => x == null ? T.mute : x >= 75 ? 'text-live' : x >= 55 ? 'text-live/70' : x >= 45 ? 'text-amber-300' : x >= 25 ? 'text-orange-300' : 'text-rose-400'
  return (
    <Card className="p-5 mk-in">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold flex items-center gap-2"><Gauge size={16} className="text-neon-300" /> {tr('Fear & Greed')}</h2>
        <span className={`text-[11px] ${T.mute}`}>{tr('Crypto market')}</span>
      </div>
      {q.isLoading ? <Skeleton className="h-36 mt-4" /> : q.isError || v == null ? <p className={`mt-6 text-[13px] ${T.mute}`}>{tr('Sentiment data unavailable right now.')}</p> : (
        <>
          <div className="relative mx-auto mt-3 w-[210px] h-[118px]">
            <svg viewBox="0 0 200 110" className="w-full h-full">
              <defs>
                <linearGradient id="fg" x1="0" x2="1">
                  <stop offset="0%" stopColor="#f43f5e" /><stop offset="35%" stopColor="#fb923c" /><stop offset="55%" stopColor="#facc15" /><stop offset="100%" style={{ stopColor: 'var(--live)' }} />
                </linearGradient>
              </defs>
              <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="14" strokeLinecap="round" />
              <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="url(#fg)" strokeWidth="14" strokeLinecap="round" strokeDasharray="267" strokeDashoffset={267 * (1 - v / 100)} style={{ transition: 'stroke-dashoffset 1s ease' }} />
              <g style={{ transform: `rotate(${ang}deg)`, transformOrigin: '100px 100px', transition: 'transform 1s ease' }}>
                <line x1="100" y1="100" x2="100" y2="30" stroke="white" strokeWidth="3" strokeLinecap="round" />
              </g>
              <circle cx="100" cy="100" r="6" fill="white" />
            </svg>
          </div>
          <div className="text-center -mt-1">
            <div className="text-[34px] font-extrabold font-num leading-none">{v}</div>
            <div className={`mt-1 text-[13px] font-semibold ${tone(v)}`}>{tr(q.data?.label)}</div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px]">
            {[['Yesterday', q.data?.yesterday], ['Last week', q.data?.weekAgo], ['Last month', q.data?.monthAgo]].map(([l, x]) => (
              <div key={l as string} className="rounded-xl bg-white/[0.03] border border-white/[0.05] py-2">
                <div className={T.mute}>{tr(l as string)}</div>
                <div className={`font-semibold font-num ${tone(x as number | null)}`}>{(x as number | null) ?? '—'}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

/* ---------------- Whale monitor ---------------- */
function Party({ addr, name, contract }: { addr: string | null; name: string | null; contract: boolean }) {
  if (!addr) return <span className={T.mute}>—</span>
  return (
    <a href={explorerAddr(addr)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-w-0 hover:text-white">
      <Avatar size={16} seed={addr} />
      <span className="truncate font-num text-[12px]">{name ?? short(addr)}</span>
      {contract && <span className="text-[9px] px-1 rounded bg-white/10 text-white/60">SC</span>}
    </a>
  )
}

function WhaleMonitor() {
  const [tr] = useT()
  const { feed, feedError } = useWallet()
  const whales = feed?.whales ?? []
  const max = whales[0]?.amount ?? 1
  return (
    <Card className="mk-in">
      <CardHeader title={<span className="flex items-center gap-2"><Waves size={16} className="text-neon-300" /> {tr('Large Transfers')}</span>} sub="Largest stablecoin moves in recent Arc blocks" />
      <div className="px-3 pb-3">
        {!feed && !feedError && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 my-1.5 mx-2" />)}
        {feedError && <p className={`px-2 py-6 text-center text-[13px] ${T.mute}`}>{tr('Explorer unreachable — retrying…')}</p>}
        {whales.slice(0, 7).map((w, i) => (
          <a key={`${w.hash}-${w.logIndex}`} href={explorerTx(w.hash)} target="_blank" rel="noreferrer" className="relative flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/[0.04] overflow-hidden">
            <span className="absolute inset-y-1 left-0 rounded-xl bg-neon-400/[0.06]" style={{ width: `${Math.max(6, (w.amount / max) * 100)}%` }} />
            <span className={`relative w-6 text-center text-[12px] font-bold font-num ${i < 3 ? 'text-neon-300' : T.mute}`}>{i + 1}</span>
            <span className="relative flex-1 min-w-0">
              <span className="block text-[14px] font-semibold font-num">{w.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} <span className={T.sub}>{w.symbol}</span></span>
              <span className={`block text-[11px] truncate ${T.mute}`}>{w.fromName ?? short(w.from ?? '')} → {w.toName ?? short(w.to ?? '')}</span>
            </span>
            <span className={`relative text-[11px] font-num ${T.mute}`}>{tr('{t} ago').replace('{t}', secsAgo(w.timestamp))}</span>
          </a>
        ))}
      </div>
    </Card>
  )
}

/* ---------------- Live trade feed ---------------- */
function LiveFeed() {
  const [tr] = useT()
  const { feed, feedError } = useWallet()
  const seen = useRef<Set<string>>(new Set())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!feed) return
    const ids = feed.live.map((t) => `${t.hash}-${t.logIndex}`)
    const first = seen.current.size === 0
    const n = new Set(ids.filter((id) => !seen.current.has(id)))
    ids.forEach((id) => seen.current.add(id))
    if (!first && n.size) { setFresh(n); const t = setTimeout(() => setFresh(new Set()), 2500); return () => clearTimeout(t) }
  }, [feed])
  const kind = (t: FeedTx) => t.fromName ?? t.toName ? (t.fromName ?? t.toName) : t.fromContract || t.toContract ? 'Contract' : 'Transfer'
  return (
    <Card className="mk-in">
      <CardHeader
        title={<span className="flex items-center gap-2"><ActivityIcon size={16} className="text-neon-300" /> {tr('Recent Transfers')}</span>}
        sub={feed ? `${feed.sampled} ${tr('latest transfers')} · ${usd(feed.sampledVolume, 0)} ${tr('volume')}` : 'Recent USDC & EURC transfers on Arc'}
        right={<span className={`text-[11px] font-semibold ${T.mute}`}>{tr('Refreshed periodically')}</span>}
      />
      <div className="px-3 pb-3 max-h-[392px] overflow-y-auto">
        {!feed && !feedError && Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-10 my-1.5 mx-2" />)}
        {feed?.live.slice(0, 14).map((t) => {
          const id = `${t.hash}-${t.logIndex}`
          return (
            <a key={id} href={explorerTx(t.hash)} target="_blank" rel="noreferrer" className={`grid grid-cols-[1fr_auto] gap-x-3 items-center px-2 py-1.5 rounded-xl hover:bg-white/[0.04] transition-colors duration-700 ${fresh.has(id) ? 'bg-neon-400/10' : ''}`}>
              <span className="min-w-0 flex items-center gap-2">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${t.symbol === 'EURC' ? 'bg-sky-500/15 text-sky-300' : 'bg-neon-400/10 text-neon-300'}`}>{t.symbol === 'EURC' ? '€' : '$'}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold font-num">{t.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} {t.symbol}</span>
                  <span className={`block text-[11px] truncate ${T.mute}`}>{tr(kind(t))} · {short(t.from ?? '')} → {short(t.to ?? '')}</span>
                </span>
              </span>
              <span className={`text-[11px] font-num ${T.mute}`}>#{t.block.toLocaleString()}</span>
            </a>
          )
        })}
      </div>
    </Card>
  )
}

/* ---------------- Top holders ---------------- */
function TopHolders() {
  const [tr] = useT()
  const q = useQuery<Holders>({ queryKey: ['holders'], queryFn: () => getJson('arc/holders'), refetchInterval: 120_000 })
  return (
    <Card className="mk-in">
      <CardHeader title={<span className="flex items-center gap-2"><Trophy size={16} className="text-neon-300" /> {tr('Top USDC Holders')}</span>} sub={q.data ? `${compact(q.data.holdersCount)} ${tr('holders')} · ${compact(q.data.totalSupply)} ${tr('USDC supply')}` : 'Largest wallets on Arc Testnet'} />
      <div className="px-3 pb-3">
        {q.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 my-1.5 mx-2" />)}
        {q.isError && <p className={`px-2 py-6 text-center text-[13px] ${T.mute}`}>{tr('Holder data unavailable.')}</p>}
        {q.data?.items.slice(0, 7).map((h, i) => (
          <div key={h.address ?? i} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/[0.04]">
            <span className={`w-6 text-center text-[12px] font-bold font-num ${i < 3 ? 'text-neon-300' : T.mute}`}>{i + 1}</span>
            <span className="flex-1 min-w-0"><Party addr={h.address} name={h.name} contract={h.contract} /></span>
            <span className="text-right">
              <span className="block text-[13px] font-semibold font-num">{compact(h.balance)}</span>
              <span className={`block text-[11px] font-num ${T.mute}`}>{h.share.toFixed(2)}%</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ---------------- Chain pulse + tasks ---------------- */
function ChainPulse() {
  const { network } = useWallet()
  const [tr] = useT()
  const q = useQuery<Stats>({ queryKey: ['arc-stats'], queryFn: () => getJson('arc/stats'), refetchInterval: 30_000 })
  const items = [
    { icon: Boxes, label: 'Latest block', value: network ? `#${network.blockNumber.toLocaleString()}` : '—' },
    { icon: ActivityIcon, label: 'Transactions today', value: q.data ? compact(q.data.transactionsToday) : '—' },
    { icon: Users, label: 'Total addresses', value: q.data ? compact(q.data.totalAddresses) : '—' },
    { icon: Fuel, label: 'USDC transfer fee', value: network ? `$${network.tokenTransferFeeUsdc.toFixed(4)}` : '—' },
    { icon: Cpu, label: 'Utilization', value: q.data ? `${q.data.utilization.toFixed(2)}%` : '—' },
    { icon: Zap, label: 'Network response time', value: network ? `${network.rpcLatencyMs} ms` : '—' },
  ]
  return (
    <Card className="p-5 mk-in">
      <h2 className="text-[15px] font-semibold flex items-center gap-2"><Boxes size={16} className="text-neon-300" /> {tr('Arc Chain Pulse')}</h2>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {items.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3">
            <div className={`flex items-center gap-1.5 text-[11px] ${T.mute}`}><Icon size={12} /> {tr(label)}</div>
            <div className="mt-1 text-[15px] font-bold font-num">{value}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function Insights() {
  return (
    <div className="space-y-5">
      <PageHeader title="Insights" desc="Experimental · read-only onchain data, not used for wallet actions. Market sentiment, large transfers and holders for Arc Testnet." />
      <div className="grid lg:grid-cols-[340px_1fr] gap-5">
        <FearGreed />
        <ChainPulse />
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <WhaleMonitor />
        <LiveFeed />
        <TopHolders />
      </div>
    </div>
  )
}
