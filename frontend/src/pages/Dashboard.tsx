import { useState } from 'react'
import { ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Rainbow, Eye, EyeOff, ChevronRight, Zap, Activity as ActivityIcon, Fuel, Boxes, Coins, ReceiptText } from 'lucide-react'
import { useWallet } from '../lib/store'
import { fmtAmt, pct, usd, type Holding } from '../lib/wallet'
import { PortfolioHistoryChart } from '../components/wallet/PortfolioHistoryChart'
import { PriceAttribution } from '../components/wallet/PriceAttribution'
import { Badge, Button, Card, CardHeader, Change, EmptyState, Modal, PageHeader, Skeleton, T, TokenIcon } from '../components/wallet/ui'
import { TxRow } from '../components/wallet/shared'
import { useT } from '../lib/i18n'
import { AnimatedUsd } from '../components/wallet/AnimatedNumber'

export function QuickActions({ className = '' }: { className?: string }) {
  const { go, setReceiveOpen } = useWallet()
  const [tr] = useT()
  const items = [
    { icon: ArrowUpRight, t: 'Send', on: () => go('send'), nudge: ['2px', '-2px'] },
    { icon: ArrowDownLeft, t: 'Receive', on: () => setReceiveOpen(true), nudge: ['-2px', '2px'] },
    { icon: ReceiptText, t: 'Request', on: () => go('pay'), nudge: ['0px', '-1px'] },
    { icon: ArrowLeftRight, t: 'Swap', on: () => go('swap'), nudge: ['2px', '0px'] },
    { icon: Rainbow, t: 'Bridge', on: () => go('bridge'), nudge: ['0px', '-2px'] },
  ]
  return (
    <div className={`grid grid-cols-5 gap-1.5 sm:gap-2 ${className}`}>
      {items.map(({ icon: Icon, t, on, nudge }) => (
        <button key={t} onClick={on} className="mk-qa group flex flex-col items-center justify-start gap-1.5 pt-3 pb-2.5 px-1 rounded-xl border border-transparent hover:bg-white/[0.04] hover:border-white/[0.06] active:scale-[0.97] transition min-w-0">
          <span style={{ '--nx': nudge[0], '--ny': nudge[1] } as React.CSSProperties} className="mk-qa-ic w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-neon-500/[0.12] border border-neon-500/20 group-hover:bg-neon-500/20 flex items-center justify-center transition"><Icon size={18} className="text-neon-300" /></span>
          <span className="text-[11px] sm:text-[12.5px] font-semibold leading-tight text-center sm:whitespace-nowrap">{tr(t)}</span>
        </button>
      ))}
    </div>
  )
}

export function PortfolioCard() {
  const { total, holdings, pricesReady, balanceError, refetchBalance, hidden, setHidden, mask, loading } = useWallet()
  const [tr] = useT()
  const priced = holdings.filter((holding) => holding.verified && holding.value != null && holding.change24h != null)
  const delta = priced.reduce((sum, holding) => sum + (holding.value! - holding.value! / (1 + holding.change24h! / 100)), 0)
  const change = total - delta ? ((delta / (total - delta)) * 100) : 0

  return (
    <Card className="mk-in overflow-hidden">
      <div className="p-5 sm:p-6 pb-0 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={`flex items-center gap-2 text-[13px] font-medium ${T.sub}`}>
            {tr('Total balance')}
            <button onClick={() => setHidden(!hidden)} className="p-1 -m-1 rounded-md hover:bg-white/10 hover:text-white" aria-label={tr(hidden ? 'Show balances' : 'Hide balances')}>
              {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="mk-display-num mt-2 text-[36px] sm:text-[42px] leading-none font-bold tracking-[-0.03em] tabular-nums">
            {balanceError ? '—' : loading || !pricesReady ? <Skeleton className="w-56 h-11 align-middle" /> : hidden ? '••••••' : <AnimatedUsd value={total} split />}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[13px] min-h-[22px]">
            {balanceError ? (
              <span className="text-amber-300" role="alert">{tr(balanceError)} <button onClick={refetchBalance} className="font-semibold text-neon-300 underline">{tr('Retry')}</button></span>
            ) : pricesReady ? (
              <>
                <span className={`px-2 py-0.5 rounded-md font-semibold tabular-nums ${change >= 0 ? 'bg-live/10 text-live' : 'bg-rose-500/12 text-rose-400'}`}>{pct(change)}</span>
                <span className={`tabular-nums ${T.sub}`}>
                  {mask(`${delta >= 0 ? '+' : '−'}${usd(Math.abs(delta))}`)} <span className={T.mute}>24h</span>
                </span>
              </>
            ) : <Skeleton className="w-40 h-5" />}
          </div>
        </div>
      </div>
      <div className="mt-4 px-5 sm:px-6"><PortfolioHistoryChart /></div>
      <p className={`px-5 sm:px-6 pt-2 pb-1 text-[11px] ${T.mute}`}>{tr('Recorded portfolio balance over time.')}</p>
      <QuickActions className="p-4 sm:p-5 border-t border-white/[0.06] mt-3" />
      <PriceAttribution className="px-5 sm:px-6 pb-4" />
    </Card>
  )
}

/** Asset table — Asset / Balance / Price / Value / 24h. Row opens asset detail. */
export function AssetRows({ limit, query = '' }: { limit?: number; query?: string }) {
  const { holdings, mask, hidden, settings } = useWallet()
  const [tr] = useT()
  const [open, setOpen] = useState<Holding | null>(null)
  const q = query.trim().toLowerCase()
  let rows = holdings.filter((h) => h.verified || !settings.hideSpam)
  if (settings.hideSmall) rows = rows.filter((h) => h.value == null || h.value >= 1 || !h.verified)
  rows = rows.filter((h) => !q || h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q))
  if (limit) rows = rows.slice(0, limit)

  if (!rows.length) return <EmptyState icon={Coins} title={q ? `${tr('No assets match')} “${query}”` : tr('No assets')} desc={q ? undefined : tr('Assets on Arc will appear here.')} />

  return (
    <div className="px-2 pb-2">
      <div className={`hidden md:grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr_0.7fr] gap-4 px-3 py-2 text-[11.5px] font-medium ${T.mute}`}>
        <span>{tr('Asset')}</span><span className="text-right">{tr('Balance')}</span><span className="text-right">{tr('Price')}</span><span className="text-right">{tr('Value')}</span><span className="text-right">24h</span>
      </div>
      {rows.map((r) => (
        <button key={r.address} onClick={() => setOpen(r)} className={`w-full text-left grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr_0.7fr] gap-4 items-center px-3 py-3 rounded-xl hover:bg-white/[0.03] transition ${r.verified ? '' : 'opacity-70'}`}>
          <span className="flex items-center gap-3 min-w-0">
            <TokenIcon color={r.color} glyph={r.glyph} size={34} />
            <span className="min-w-0">
              <span className="flex items-center gap-2"><span className="font-semibold text-[14px] truncate" title={r.symbol}>{r.symbol}</span>{!r.verified && <Badge tone="warn">{tr('Unverified')}</Badge>}</span>
              <span className={`block text-[12px] truncate ${T.mute}`} title={r.name}>{r.name}</span>
            </span>
          </span>
          <span className="hidden md:block text-right text-[14px] font-num">{mask(fmtAmt(r.balance, r.decimals))}</span>
          <span className="hidden md:block text-right text-[14px] font-num">{r.price != null ? usd(r.price, r.price > 1000 ? 0 : 4) : '—'}</span>
          <span className="text-right">
            <span className="block text-[14px] font-semibold font-num">{r.value != null ? <AnimatedUsd value={r.value} mask={mask} hidden={hidden} /> : <span className={T.mute}>—</span>}</span>
            <span className={`md:hidden block text-[12px] font-num ${T.mute}`}>{mask(`${fmtAmt(r.balance, r.decimals)} ${r.symbol}`)}</span>
          </span>
          <span className="hidden md:block text-right text-[13px]"><Change v={r.change24h} /></span>
        </button>
      ))}
      <AssetDetail asset={open} onClose={() => setOpen(null)} />
    </div>
  )
}

export function AssetDetail({ asset, onClose }: { asset: Holding | null; onClose: () => void }) {
  const { activity, mask, go, setSendDraft, setReceiveOpen, total, pricesReady } = useWallet()
  const [tr] = useT()
  if (!asset) return null
  const txs = activity.filter((t) => t.symbol === asset.symbol || t.toSymbol === asset.symbol).slice(0, 5)
  const share = pricesReady && asset.value != null && total ? (asset.value / total) * 100 : undefined
  return (
    <Modal open onClose={onClose} title={asset.name} width={480}>
      <div className="flex items-center gap-3">
        <TokenIcon color={asset.color} glyph={asset.glyph} size={44} />
        <div>
          <div className="text-[24px] font-bold font-num leading-tight">{mask(`${fmtAmt(asset.balance, asset.decimals)} ${asset.symbol}`)}</div>
          <div className={`text-[13px] ${T.sub}`}>{asset.value != null ? mask(usd(asset.value)) : tr('No price')} {share != null && <span className={T.mute}>· {tr('{pct}% of portfolio').replace('{pct}', share.toFixed(1))}</span>}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
        {[['Price', asset.price != null ? usd(asset.price, asset.price > 1000 ? 0 : 4) : '—'], ['24h', asset.change24h != null ? pct(asset.change24h) : '—'], ['Network', 'Arc']].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3 py-2"><div className={T.mute}>{tr(k)}</div><div className="font-semibold font-num mt-0.5">{v}</div></div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="primary" disabled={!asset.verified} onClick={() => { setSendDraft({ symbol: asset.symbol }); onClose(); go('send') }}><ArrowUpRight size={15} /> {tr('Send')}</Button>
        <Button onClick={() => { onClose(); setReceiveOpen(true) }}><ArrowDownLeft size={15} /> {tr('Receive')}</Button>
      </div>
      <div className={`mt-5 mb-1 text-[12px] font-semibold ${T.mute}`}>{tr('Activity')}</div>
      {txs.length ? <div className="-mx-2">{txs.map((t) => <TxRow key={t.id} tx={t} compact />)}</div> : <p className={`py-4 text-center text-[13px] ${T.mute}`}>{tr('No {asset} activity yet.').replace('{asset}', asset.symbol)}</p>}
    </Modal>
  )
}

export function Allocation() {
  const { holdings, total, pricesReady, balanceError, mask } = useWallet()
  const [tr] = useT()
  const rows = holdings.filter((h) => h.verified && (h.value ?? 0) > 0)
  return (
    <Card className="p-5 mk-in">
      <h2 className="text-[15px] font-semibold">{tr('Allocation')}</h2>
      {!pricesReady ? balanceError ? <p className={`mt-3 text-[13px] ${T.mute}`}>{tr(balanceError)}</p> : <Skeleton className="mt-4 h-3 w-full" /> : !rows.length ? <p className={`mt-3 text-[13px] ${T.mute}`}>{tr('No priced assets yet.')}</p> : (
        <>
          <div className="mt-4 flex h-2.5 rounded-full overflow-hidden gap-0.5">
            {rows.map((h) => <span key={h.symbol} style={{ width: `${((h.value ?? 0) / total) * 100}%`, background: h.color }} />)}
          </div>
          <ul className="mt-4 space-y-2.5">
            {rows.map((h) => (
              <li key={h.symbol} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: h.color }} />
                <span className="font-medium">{h.symbol}</span>
                <span className={`ml-auto font-num ${T.sub}`}>{mask(usd(h.value ?? 0))}</span>
                <span className="w-14 text-right font-num font-semibold">{(((h.value ?? 0) / total) * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

export function NetworkCard() {
  const { network, networkError, networkStatus, retryNetwork } = useWallet()
  const [tr] = useT()
  const stats = [
    { icon: Boxes, k: 'Latest block', v: network ? `#${network.blockNumber.toLocaleString()}` : null },
    { icon: Fuel, k: 'Transfer fee', v: network ? `~${network.tokenTransferFeeUsdc.toFixed(4)} USDC` : null },
    { icon: Zap, k: 'Gas price', v: network ? `${network.gasPriceGwei.toFixed(1)} gwei` : null },
    { icon: ActivityIcon, k: 'Network response time', v: network ? `${network.rpcLatencyMs} ms` : null },
  ]
  // Never show skeleton forever — after retries are exhausted show dashes and a Retry button.
  const isLoading = networkStatus === 'loading'
  const isUnavailable = networkStatus === 'unavailable'
  const isStale = networkStatus === 'stale'
  return (
    <Card className="mk-in">
      <CardHeader
        title="Arc network"
        sub="Gas is paid in USDC"
        right={
          isUnavailable || isStale
            ? <Badge tone="err">{tr('Unavailable')}</Badge>
            : isLoading
              ? <Badge>{tr('Connecting to Arc…')}</Badge>
              : <Badge tone="live">{tr('Online')}</Badge>
        }
      />
      <div className="grid grid-cols-2 gap-2 px-5 pb-5">
        {stats.map(({ icon: Icon, k, v }) => (
          <div key={k} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3">
            <div className={`flex items-center gap-1.5 text-[11px] ${T.mute}`}><Icon size={12} /> {tr(k)}</div>
            <div className="mt-1 text-[13px] font-semibold font-num">
              {v ?? (isLoading ? <Skeleton className="w-20 h-4" /> : '—')}
            </div>
          </div>
        ))}
      </div>
      {(isUnavailable || isStale) && (
        <div className="px-5 pb-4 flex items-center gap-2 text-[12px]">
          <span className={T.mute}>{networkError ? tr('Arc unreachable') : tr('Arc data is stale — last seen')}</span>
          <button onClick={() => retryNetwork()} className="text-neon-400 hover:text-neon-300 underline underline-offset-2 shrink-0">{tr('Retry')}</button>
        </div>
      )}
    </Card>
  )
}

/** Per-asset 24h move from the same verified holdings and price feed used for the total. */
function AssetChanges() {
  const { holdings, mask, pricesReady } = useWallet()
  const [tr] = useT()
  const rows = holdings.filter((h) => h.verified && h.value != null && h.change24h != null)
    .map((h) => ({ ...h, delta: h.value! - h.value! / (1 + h.change24h! / 100) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return (
    <Card className="mk-in">
      <CardHeader title="24h change by asset" />
      <div className="px-5 pb-4 space-y-3">
        {!pricesReady ? <Skeleton className="h-16 w-full" /> : rows.length ? rows.map((h) => (
          <div key={h.symbol} className="flex items-center gap-3 text-[13px]">
            <span className="font-semibold w-14 shrink-0">{h.symbol}</span>
            <span className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
              <span className={`block h-full rounded-full ${h.change24h! >= 0 ? 'bg-live' : 'bg-rose-400'}`} style={{ width: `${Math.min(100, Math.max(4, Math.abs(h.change24h!) * 20))}%` }} />
            </span>
            <span className={`font-num w-16 text-right ${h.change24h! >= 0 ? 'text-live' : 'text-rose-300'}`}>{h.change24h! >= 0 ? '+' : ''}{h.change24h!.toFixed(2)}%</span>
            <span className={`font-num w-20 text-right ${T.sub}`}>{mask(`${h.delta >= 0 ? '+' : '−'}${usd(Math.abs(h.delta), Math.abs(h.delta) < 0.01 && h.delta !== 0 ? 4 : 2)}`)}</span>
          </div>
        )) : <p className={`text-[12.5px] ${T.mute}`}>{tr('No price data yet.')}</p>}
      </div>
    </Card>
  )
}

export default function Dashboard() {
  const { go, mode } = useWallet()
  const [tr] = useT()
  return (
    <>
      <PageHeader title="Portfolio" desc={mode === 'demo' ? tr('Sample data') : undefined} />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
        <div className="space-y-5 min-w-0">
          <PortfolioCard />
          <Card className="mk-in">
            <CardHeader title="Assets" right={<button onClick={() => go('assets')} className={`text-[13px] font-medium ${T.sub} hover:text-white inline-flex items-center gap-1`}>{tr('View all')} <ChevronRight size={14} /></button>} />
            <AssetRows />
          </Card>
        </div>
        <div className="space-y-5 self-start">
          <Allocation />
          <AssetChanges />
        </div>
      </div>
    </>
  )
}
