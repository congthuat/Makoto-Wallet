import { useMemo, useState } from 'react'
import { Download, History, Search } from 'lucide-react'
import { useWallet } from '../lib/store'
import { ARC, fmtAmt, txKind, usd } from '../lib/wallet'
import { activityDay } from '../lib/activity'
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, T, Toggle } from '../components/wallet/ui'
import { TxRow } from '../components/wallet/shared'
import { AssetRows } from './Dashboard'
import { useT } from '../lib/i18n'

export function AssetsPage() {
  const { holdings, total, settings, setSettings, mask, pricesReady } = useWallet()
  const [tr] = useT()
  const [q, setQ] = useState('')
  const verified = holdings.filter((h) => h.verified && (h.value ?? 0) > 0)
  const spam = holdings.filter((h) => !h.verified)
  return (
    <>
      <PageHeader title="Assets" desc={tr('Tokens held on {network}. Only verified Circle assets are priced and counted in your total. Tap an asset for details.').replace('{network}', ARC.name)} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card className="p-5 lg:col-span-2">
          <div className={`text-[13px] ${T.sub}`}>{tr('Allocation')}</div>
          <div className="mt-1 text-[28px] font-bold tabular-nums tracking-tight">{pricesReady ? mask(usd(total)) : '—'}</div>
          {pricesReady ? <><div className="mt-4 flex h-3 rounded-full overflow-hidden bg-white/[0.06] gap-0.5">
            {verified.map((h) => <div key={h.address} style={{ width: `${((h.value ?? 0) / (total || 1)) * 100}%`, background: h.color }} title={h.symbol} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
            {verified.map((h) => (
              <span key={h.address} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: h.color }} />
                <span className="font-medium">{h.symbol}</span>
                <span className={`tabular-nums ${T.mute}`}>{(((h.value ?? 0) / (total || 1)) * 100).toFixed(1)}%</span>
              </span>
            ))}
          </div></> : <p className={`mt-4 text-[13px] ${T.mute}`}>{tr('Pricing data is unavailable.')}</p>}
        </Card>
        <Card className="p-5">
          <div className="text-[14px] font-semibold">{tr('Display')}</div>
          <p className={`text-[13px] mt-1 ${T.sub}`}>{tr(spam.length === 1 ? '{n} unverified token found.' : '{n} unverified tokens found.').replace('{n}', String(spam.length))} {tr('Unknown airdrops can impersonate real assets.')}</p>
          <div className="mt-4 space-y-3 text-[13px]">
            <label className="flex items-center justify-between gap-3"><span>{tr('Hide unverified tokens')}</span><Toggle on={settings.hideSpam} onChange={() => setSettings({ ...settings, hideSpam: !settings.hideSpam })} /></label>
            <label className="flex items-center justify-between gap-3"><span>{tr('Hide balances under $1')}</span><Toggle on={settings.hideSmall} onChange={() => setSettings({ ...settings, hideSmall: !settings.hideSmall })} /></label>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="All assets"
          right={
            <label className="mk-field-shell flex items-center gap-2 h-9 w-[150px] sm:w-[220px] px-3 rounded-xl bg-white/[0.04] border border-white/[0.07]">
              <Search size={14} className={T.mute} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search tokens')} className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-[#83838E]" />
            </label>
          }
        />
        <AssetRows query={q} />
      </Card>
    </>
  )
}

const FILTERS = ['All', 'Send', 'Receive', 'Swap', 'Bridge'] as const

export function ActivityPage() {
  const { activity, mode } = useWallet()
  const [tr, lang] = useT()
  const [tab, setTab] = useState<(typeof FILTERS)[number]>('All')
  const [q, setQ] = useState('')

  const list = activity.filter((a) =>
    (tab === 'All' || txKind(a) === tab.toLowerCase()) &&
    (!q || [a.symbol, a.counterparty, a.counterpartyName ?? '', a.hash ?? '', a.route ?? ''].some((s) => s.toLowerCase().includes(q.toLowerCase()))),
  )
  const groups = useMemo(() => {
    const m = new Map<string, typeof list>()
    for (const tx of list) { const k = activityDay(tx.timestamp, lang); m.set(k, [...(m.get(k) ?? []), tx]) }
    return Array.from(m.entries())
  }, [list, lang])
  const pending = activity.filter((a) => a.status === 'pending').length

  const exportCsv = () => {
    const rows = [['date', 'type', 'status', 'token', 'amount', 'counterparty_or_route', 'tx_hash'], ...list.map((a) => [new Date(a.timestamp).toISOString(), txKind(a), a.status, a.symbol, String(a.amount), a.route ?? a.counterparty, a.hash ?? ''])]
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a'); el.href = url; el.download = 'makoto-activity.csv'; el.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader title="Activity" desc={mode === 'demo' ? tr('Sample transactions. Connect or watch an address to load real history.') : tr('Latest token transfers from the {network} explorer.').replace('{network}', ARC.name)} right={<Button size="sm" onClick={exportCsv} disabled={!list.length}><Download size={14} /> {tr('Export CSV')}</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 pt-4 pb-3">
          <div className="flex gap-1 overflow-x-auto max-w-full">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setTab(f)} className={`h-8 px-3 rounded-lg text-[12.5px] font-semibold shrink-0 transition ${tab === f ? 'bg-white/[0.08] text-white' : `${T.mute} hover:text-white`}`}>{tr(f)}</button>
            ))}
          </div>
          {pending > 0 && <Badge tone="warn">{pending} {tr('pending')}</Badge>}
          <label className="mk-field-shell sm:ml-auto flex items-center gap-2 h-9 w-full sm:w-[240px] px-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <Search size={14} className={T.mute} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Address, asset or hash')} className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-[#83838E]" />
          </label>
        </div>
        <div className="px-1.5 sm:px-2 pb-3">
          {activity.length === 0 ? (
            <EmptyState icon={History} title={tr('No activity yet')} desc={tr('Your wallet activity will appear here.')} />
          ) : groups.length === 0 ? (
            <EmptyState icon={History} title={tr('No activity for this filter')} desc={tr('Try another filter or clear your search.')} />
          ) : groups.map(([day, txs]) => (
            <div key={day}>
              <div className={`px-3 pt-3 pb-1 text-[11.5px] font-semibold ${T.mute}`}>{tr(day)}</div>
              {txs.map((tx) => <TxRow key={tx.id} tx={tx} />)}
            </div>
          ))}
        </div>
      </Card>
      <p className={`mt-3 text-[12px] ${T.mute}`}>{tr('{n} of {total} shown · tap a row for details.').replace('{n}', fmtAmt(list.length, 0)).replace('{total}', String(activity.length))}</p>
    </>
  )
}
