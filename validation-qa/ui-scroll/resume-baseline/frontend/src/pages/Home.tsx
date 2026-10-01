import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp, Radar, MessageSquare, Zap, ChevronRight, ListChecks, Boxes, Fuel, Timer, Wifi,
} from 'lucide-react'
import { useWallet } from '../lib/store'
import { fmtAmt, usd } from '../lib/wallet'
import { SAMPLE_PROMPTS } from '../lib/scenarios'
import { taskDefinition, taskDisplayTitle, taskItemsForAccount, type Task } from '../lib/tasks'
import { taskDate, taskText } from '../lib/taskText'
import { useT } from '../lib/i18n'
import { Card, CardHeader, EmptyState, LiveDot, Orb, Skeleton, T, TokenIcon } from '../components/wallet/ui'
import { PortfolioHistoryChart } from '../components/wallet/PortfolioHistoryChart'
import { PriceAttribution } from '../components/wallet/PriceAttribution'
import { TxRow } from '../components/wallet/shared'
import { AssetRows, QuickActions } from './Dashboard'
import { getJson, type Stats } from './Insights'
import { History } from 'lucide-react'
import ShareButton from '../components/ShareCard'

const TABS = ['Ask', 'Monitor', 'Automate'] as const
type Tab = (typeof TABS)[number]
const PLACEHOLDER: Record<Tab, string> = {
  Ask: 'Ask anything… e.g. “What is my portfolio worth?”',
  Monitor: 'e.g. “Alert me when USDC balance is below 500”',
  Automate: 'e.g. “Send me a daily portfolio summary at 08:00”',
}


function AgentCommand() {
  const { go, setAgentSeed, setAgentSeedMode, networkError } = useWallet()
  const [tr] = useT()
  const [tab, setTab] = useState<Tab>('Ask')
  const [v, setV] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = (text = v.trim()) => {
    if (!text) return
    setAgentSeedMode(tab === 'Monitor' ? 'monitor' : tab === 'Automate' ? 'automation' : null)
    setAgentSeed(text); go('agent')
  }
  const pick = (t: Tab, text: string) => { setTab(t); setV(text); ref.current?.focus() }
  const suggestions: Record<Tab, { label: string; on: () => void }[]> = {
    Ask: [
      { label: 'What is my portfolio worth?', on: () => submit(SAMPLE_PROMPTS.portfolio) },
      { label: SAMPLE_PROMPTS.send, on: () => submit(SAMPLE_PROMPTS.send) },
      { label: 'Show my last transactions', on: () => submit('Show my recent activity') },
      { label: SAMPLE_PROMPTS.swap, on: () => submit(SAMPLE_PROMPTS.swap) },
      { label: SAMPLE_PROMPTS.bridge, on: () => submit(SAMPLE_PROMPTS.bridge) },
    ],
    Monitor: [
      { label: SAMPLE_PROMPTS.alert, on: () => pick('Monitor', SAMPLE_PROMPTS.alert) },
      { label: 'Alert me when EURC balance is above 200', on: () => pick('Monitor', 'Alert me when EURC balance is above 200') },
    ],
    Automate: [
      { label: SAMPLE_PROMPTS.daily, on: () => pick('Automate', SAMPLE_PROMPTS.daily) },
    ],
  }
  const TAB_ICON: Record<Tab, any> = { Ask: MessageSquare, Monitor: Radar, Automate: Zap }
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.'

  return (
    <section className="mk-in">
      <div className="mk-agent relative overflow-hidden rounded-2xl border border-white/[0.08] px-4 py-7 sm:px-8 sm:py-8">
        <div className="relative z-10 mx-auto max-w-[780px] flex flex-col items-center text-center">
          <div className="mb-3"><Orb size={60} /></div>
          <span className="inline-flex items-center gap-2 h-7 px-3 rounded-full border border-neon-500/40 bg-neon-500/10 text-[12px] font-semibold text-neon-300">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-500" aria-hidden /> {tr('Makoto Agent · Arc Testnet')}{networkError ? ` · ${tr('Unavailable')}` : ''}
          </span>
          <h1 className="mt-4 text-[26px] sm:text-[34px] leading-[1.1] font-extrabold tracking-[-0.025em]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {tr(greet)}{' '}
            <span className="mk-headline bg-gradient-to-r from-[#b6ff9f] via-neon-500 to-[#4fbf4a] bg-clip-text text-transparent">{tr('What should Makoto do')}</span> {tr('for you?')}
          </h1>
          <div className="mk-field-shell mt-5 w-full text-left rounded-2xl border border-white/[0.1] bg-[#0e0e13]/90 transition">
            <textarea
              ref={ref} value={v} rows={2} onChange={(e) => setV(e.target.value)} aria-label={tr('Ask Makoto')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder={tr(PLACEHOLDER[tab])}
              className="w-full resize-none bg-transparent outline-none px-4 pt-4 text-[15px] placeholder:text-[#6f6d7a]"
            />
            <div className="flex items-center gap-2 px-3 pb-3">
              <div role="tablist" className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                {TABS.map((t) => {
                  const Icon = TAB_ICON[t]
                  return (
                    <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); ref.current?.focus() }}
                      className={`h-8 px-1.5 sm:px-3 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition ${tab === t ? 'bg-white/[0.08] text-neon-300' : `${T.sub} hover:text-white`}`}>
                      <Icon size={13} /> {tr(t)}
                    </button>
                  )
                })}
              </div>
              <button onClick={() => submit()} disabled={!v.trim()} className="ml-auto h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-neon-500 text-[#0b0b10] hover:bg-neon-400 disabled:bg-white/[0.06] disabled:text-white/30 transition active:scale-95" aria-label={tr('Submit')}><ArrowUp size={17} strokeWidth={2.4} /></button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {suggestions[tab].map(({ label, on }) => (
              <button key={label} onClick={on} className={`h-8 px-3.5 rounded-full border border-white/[0.1] bg-white/[0.03] text-[12.5px] ${T.sub} hover:text-white hover:border-neon-500/40 hover:bg-neon-500/[0.06] transition max-w-full truncate`}>{tr(label)}</button>
            ))}
          </div>
          {tab !== 'Ask' && <p className={`mt-4 text-[11.5px] ${T.mute}`}>{tr('Makoto will propose a task for you to review.')}</p>}
        </div>
      </div>
    </section>
  )
}

function PortfolioSummary() {
  const { total, holdings, mask, pricesReady, balanceError, refetchBalance, go, live } = useWallet()
  const [tr] = useT()
  const priced = holdings.filter((h) => h.verified && h.value != null && h.change24h != null)
  const pnl = priced.reduce((s, h) => s + (h.value! - h.value! / (1 + h.change24h! / 100)), 0)
  const pnlPct = total - pnl ? (pnl / (total - pnl)) * 100 : 0
  return (
    <Card className="mk-hero p-5 mk-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-[13px] font-medium ${T.sub} flex items-center gap-2`}>{tr('Total balance')} {!live && <span className="px-1.5 py-0.5 rounded text-[10.5px] font-semibold bg-white/[0.06] text-[#b3b0bf]">{tr('Sample data')}</span>}</div>
          <div className="mt-1.5 text-[32px] sm:text-[36px] leading-none font-bold tracking-[-0.03em] font-num mk-grad-text">{balanceError ? '—' : pricesReady ? mask(usd(total)) : <Skeleton className="h-9 w-44" />}</div>
          <div className="mt-2 text-[13px] font-num min-h-5">
            {balanceError ? (
              <span className="text-amber-300" role="alert">{tr(balanceError)} <button onClick={refetchBalance} className="font-semibold text-neon-300 underline">{tr('Retry')}</button></span>
            ) : pricesReady ? (
              <span className={pnl >= 0 ? 'text-live' : 'text-rose-300'}>{mask(`${pnl >= 0 ? '+' : '−'}${usd(Math.abs(pnl), Math.abs(pnl) < 0.01 && pnl !== 0 ? 4 : 2)}`)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%) <span className={T.mute}>24h</span></span>
            ) : <Skeleton className="h-4 w-28" />}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ShareButton />
          <button onClick={() => go('dashboard')} className={`text-[12px] font-medium ${T.sub} hover:text-white inline-flex items-center gap-0.5`}>{tr('Portfolio')} <ChevronRight size={14} /></button>
        </div>
      </div>
      <div className="mt-3"><PortfolioHistoryChart compact /></div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {holdings.filter((h) => h.verified).slice(0, 3).map((h) => (
          <div key={h.symbol} style={{ ['--c' as any]: h.color }} className="mk-tile rounded-xl bg-white/[0.03] border border-white/[0.05] px-2.5 py-2 flex items-center gap-2 min-w-0">
            <TokenIcon color={h.color} glyph={h.glyph} size={22} />
            <span className="min-w-0">
              <span className="block text-[11.5px] font-semibold">{h.symbol}</span>
              <span className={`block text-[11px] font-num truncate ${T.mute}`}>{mask(fmtAmt(h.balance, h.decimals))}</span>
            </span>
          </div>
        ))}
      </div>
      <QuickActions className="mt-4" />
      <PriceAttribution className="mt-3" />
    </Card>
  )
}

const statusStyle: Record<Task['status'], string> = { ACTIVE: 'text-live', PAUSED: 'text-amber-200', TRIGGERED: 'text-live', COMPLETED: 'text-[#9d9aa8]', FAILED: 'text-rose-300', BLOCKED: 'text-amber-300' }
export function TaskLine({ t }: { t: Task }) {
  const [, lang] = useT()
  const locale = lang === 'vi' ? 'vi' : 'en'
  const status = { ACTIVE: 'active', PAUSED: 'paused', TRIGGERED: 'triggered', COMPLETED: 'completed', FAILED: 'failed', BLOCKED: 'blocked' } as const
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.03]">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${t.status === 'ACTIVE' ? 'bg-live' : t.status === 'PAUSED' ? 'bg-amber-300' : 'bg-white/30'}`} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-semibold truncate">{taskDisplayTitle(t, locale)}</span>
        <span className={`block text-[12px] truncate ${T.mute}`}>{taskDefinition(t, locale)}</span>
        {t.nextRunAt && <span className={`block text-[11px] truncate ${T.mute}`}>{taskText('next', locale)}: {taskDate(t.nextRunAt, locale, t.timezone)}</span>}
      </span>
      <span className="text-right shrink-0">
        <span className={`block text-[11.5px] font-semibold ${statusStyle[t.status]}`}>{taskText(status[t.status], locale)}</span>
      </span>
    </div>
  )
}

function TasksPreview() {
  const { tasks, tasksLoading, tasksError, mode, address, go, refreshTasks } = useWallet()
  const [tr, language] = useT()
  const locale = language === 'vi' ? 'vi' : 'en'
  const list = taskItemsForAccount(tasks, mode, address).sort((a, b) => (a.status === 'ACTIVE' ? 0 : a.status === 'PAUSED' ? 1 : 2) - (b.status === 'ACTIVE' ? 0 : b.status === 'PAUSED' ? 1 : 2)).slice(0, 3)
  return (
    <Card className="mk-in flex flex-col">
      <CardHeader title="Tasks" sub="What Makoto is watching for you" />
      <div className="px-2 flex-1">
        {tasksError ? <div className={`p-4 text-[12px] ${T.sub}`}>{taskText('backendOffline', locale)} <button onClick={() => void refreshTasks()} className="text-neon-300">{tr('Retry')}</button></div> : tasksLoading ? <div className="p-4"><Skeleton className="h-12 w-full" /></div> : list.length ? list.map((t) => <TaskLine key={t.id} t={t} />) : <EmptyState icon={ListChecks} title="No tasks" desc="Ask Makoto to monitor something for you." />}
      </div>
      <div className="p-3 pt-1"><button onClick={() => go('tasks')} className={`w-full h-9 rounded-lg border border-white/[0.06] text-[13px] font-medium ${T.sub} hover:text-white hover:bg-white/[0.04]`}>{tr('View all tasks')}</button></div>
    </Card>
  )
}

function ChainPulse() {
  const { network, networkError } = useWallet()
  const [tr] = useT()
  const stats = useQuery<Stats>({ queryKey: ['arc-stats'], queryFn: () => getJson('arc/stats'), refetchInterval: 30_000 })
  const fee = network?.tokenTransferFeeUsdc
  const na = networkError ? tr('Unavailable') : null
  const items = [
    { icon: Wifi, k: 'Network', v: networkError ? tr('Unavailable') : network ? tr('Online') : null, live: !networkError && !!network },
    { icon: Timer, k: 'Network response time', v: network?.rpcLatencyMs != null ? `${network.rpcLatencyMs} ms` : na },
    { icon: Boxes, k: 'Latest block', v: network ? `#${network.blockNumber.toLocaleString()}` : na },
    { icon: Fuel, k: 'Est. network fee', v: fee != null ? `$${fee.toFixed(4)}` : na },
  ]
  return (
    <Card className="mk-in">
      <div className="px-5 pt-4 pb-1 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">{tr('Arc Chain Pulse')}</h2>
        {stats.data && <span className={`text-[11.5px] font-num ${T.mute}`}>{tr('{n} tx today').replace('{n}', stats.data.transactionsToday.toLocaleString())}</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3">
        {items.map(({ icon: Icon, k, v, live }) => (
          <div key={k} className="rounded-xl bg-white/[0.02] border border-white/[0.05] px-3 py-2.5">
            <div className={`flex items-center gap-1.5 text-[11px] ${T.mute}`}><Icon size={12} /> {tr(k)}</div>
            <div className={`mt-1 text-[13.5px] font-semibold font-num flex items-center gap-1.5 ${live ? 'text-live' : ''}`}>{live && <LiveDot />}{v ?? <Skeleton className="h-4 w-16" />}</div>
          </div>
        ))}
      </div>
      {networkError && <p className={`px-5 pb-3 text-[12px] ${T.mute}`}>{tr('Network unavailable. Check Arc connection.')}</p>}
    </Card>
  )
}

export default function Home() {
  const { activity, go } = useWallet()
  const [tr] = useT()
  return (
    <div className="space-y-5">
      <AgentCommand />
      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5">
        <PortfolioSummary />
        <TasksPreview />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5">
        <Card className="mk-in min-w-0">
          <CardHeader title="Assets" right={<button onClick={() => go('assets')} className={`text-[12px] font-medium ${T.sub} hover:text-white inline-flex items-center gap-0.5`}>{tr('All assets')} <ChevronRight size={14} /></button>} />
          <AssetRows limit={4} />
        </Card>
        <Card className="mk-in min-w-0">
          <CardHeader title="Recent activity" right={<button onClick={() => go('activity')} className={`text-[12px] font-medium ${T.sub} hover:text-white inline-flex items-center gap-0.5`}>{tr('View all')} <ChevronRight size={14} /></button>} />
          <div className="px-1.5 pb-2">
            {activity.length ? activity.slice(0, 5).map((tx) => <TxRow key={tx.id} tx={tx} compact />) : <EmptyState icon={History} title="No activity yet" desc="Your wallet activity will appear here." />}
          </div>
        </Card>
      </div>
      <ChainPulse />
    </div>
  )
}
