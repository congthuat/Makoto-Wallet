import { useRef, useState } from 'react'
import {
  ArrowUp, Radar, MessageSquare, Zap, ChevronRight, AlertTriangle, Fuel, RotateCcw, Network, BellRing, Eye, EyeOff,
} from 'lucide-react'
import { useWallet } from '../lib/store'
import { usd } from '../lib/wallet'
import { getAgentSuggestions } from '../lib/agentSuggestions'
import { readHomeAnswer, renderHomeAnswer, routeHomeRequest, type HomeMode, type HomeRequest, type QuickAnswer } from '../agent/homeRequest'
import { taskDefinition, taskDisplayTitle, taskItemsForAccount, type Task } from '../lib/tasks'
import { taskDate, taskText } from '../lib/taskText'
import { useT } from '../lib/i18n'
import { Card, CardHeader, EmptyState, Orb, Skeleton, T, TokenIcon } from '../components/wallet/ui'
import { PortfolioHistoryChart } from '../components/wallet/PortfolioHistoryChart'
import { PriceAttribution } from '../components/wallet/PriceAttribution'
import { TxRow } from '../components/wallet/shared'
import { AssetRows, QuickActions } from './Dashboard'
import { buildAgentActions, hasPendingStrategy, type AgentAction } from '../lib/agentActions'
import { History } from 'lucide-react'
import ShareButton from '../components/ShareCard'
import { WelcomeHero } from '../components/wallet/WelcomeHero'

const TABS = ['Ask', 'Monitor', 'Automate'] as const
type Tab = (typeof TABS)[number]
const PLACEHOLDER: Record<Tab, string> = {
  Ask: 'Ask anything about your wallet or the market…',
  Monitor: 'What should Makoto watch for you?',
  Automate: 'What should Makoto do on a schedule?',
}


function AgentCommand() {
  const w = useWallet()
  const { go, setAgentSeed, setAgentSeedMode, networkError } = w
  const [tr, language] = useT()
  const locale = language === 'vi' ? 'vi' : 'en'
  const [tab, setTab] = useState<Tab>('Ask')
  const [v, setV] = useState('')
  const [exchange, setExchange] = useState<{ request: HomeRequest; answer?: QuickAnswer; loading: boolean } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const requestId = useRef(0)
  const currentWallet = useRef(w)
  currentWallet.current = w
  const mode: HomeMode = tab === 'Monitor' ? 'monitor' : tab === 'Automate' ? 'automation' : 'ask'

  const submit = async (text = v) => {
    if (!text.trim()) return
    const request = routeHomeRequest(text, locale, mode)
    const id = ++requestId.current
    if (request.route === 'AGENT') {
      setAgentSeedMode(request.taskMode)
      setAgentSeed(request.originalText)
      go('agent')
      return
    }
    const address = w.address
    const walletMode = w.mode
    setExchange({ request, loading: true })
    setV('')
    try {
      const answer = await readHomeAnswer(request, w)
      if (requestId.current !== id) return
      const current = currentWallet.current
      const unchanged = current.mode === walletMode && current.address.toLowerCase() === address.toLowerCase() && current.walletChainId === w.walletChainId
      setExchange({ request, loading: false, answer: unchanged || request.query === 'network' ? answer : { query: request.query, status: 'UNAVAILABLE', source: 'eip-1193', reason: 'identity' } })
    } catch {
      if (requestId.current === id) setExchange({ request, loading: false, answer: { query: request.query, status: 'UNAVAILABLE', source: 'arc-wallet-snapshot', reason: request.query === 'network' ? 'network' : request.query === 'activity' ? 'activity' : 'balances' } })
    }
  }
  const suggestions = getAgentSuggestions(mode, locale)
  const answer = exchange?.answer ? renderHomeAnswer(exchange.answer, locale, w.mask, w) : undefined
  const TAB_ICON: Record<Tab, any> = { Ask: MessageSquare, Monitor: Radar, Automate: Zap }
  const watching = taskItemsForAccount(w.tasks, w.mode, w.address).filter((task) => task.status === 'ACTIVE').length
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.'

  return (
    <section className="mk-in" aria-label={tr('Ask Makoto')}>
      <div className="mk-card rounded-2xl border border-white/[0.08] bg-[#121219] p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <Orb size={26} glow={false} />
          <h2 className="mk-h text-[14px] font-semibold">{tr('Ask Makoto')}</h2>
          <span className={`text-[12px] ${T.mute} hidden sm:inline`}>· {tr(greet)}</span>
          <span className="ml-auto flex items-center gap-3">
            {networkError && <span className="text-[11.5px] text-amber-300">{tr('Unavailable')}</span>}
            {watching > 0 && <button onClick={() => go('tasks')} className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${T.sub} hover:text-white`}><span className="w-1.5 h-1.5 rounded-full bg-live" aria-hidden /><span className="hidden sm:inline">{tr('Makoto is watching {n} things').replace('{n}', String(watching))}</span><span className="sm:hidden">{tr('{n} watching').replace('{n}', String(watching))}</span><ChevronRight size={13} /></button>}
          </span>
        </div>
        <div className="mk-field-shell rounded-xl border border-white/[0.1] bg-[#0e0e13]/90 transition flex items-end gap-2 pr-2">
          <textarea
            ref={ref} value={v} rows={1} aria-label={tr('Ask Makoto')}
            onChange={(e) => { setV(e.target.value); const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px` }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
            placeholder={tr(PLACEHOLDER[tab])}
            className="flex-1 min-w-0 resize-none overflow-hidden bg-transparent outline-none px-3.5 py-3 text-[14.5px] leading-6 placeholder:text-[#6f6d7a] max-h-32 placeholder:truncate"
          />
          <button onClick={() => void submit()} disabled={!v.trim()} className="mb-2 h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-neon-500 text-[#0b0b10] hover:bg-neon-400 disabled:bg-white/[0.06] disabled:text-white/30 transition active:scale-95" aria-label={tr('Submit')}><ArrowUp size={17} strokeWidth={2.4} /></button>
        </div>
        <div className="mt-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
          <div role="tablist" className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06] self-start shrink-0">
            {TABS.map((t) => {
              const Icon = TAB_ICON[t]
              return (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); ref.current?.focus() }}
                  className={`h-7 px-2.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition ${tab === t ? 'bg-white/[0.08] text-neon-300' : `${T.sub} hover:text-white`}`}>
                  <Icon size={12} /> {tr(t)}
                </button>
              )
            })}
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar min-w-0" data-agent-suggestions={mode}>
            {suggestions.slice(0, 3).map(({ id, text }) => (
              <button key={id} onClick={() => void submit(text)} className={`shrink-0 h-7 px-3 rounded-full border border-white/[0.08] bg-white/[0.02] text-[12px] ${T.sub} hover:text-white hover:border-neon-500/40 transition whitespace-nowrap`}>{text}</button>
            ))}
          </div>
        </div>
        {exchange && <div className="mt-3 w-full rounded-xl border border-white/[0.08] bg-black/20 p-4 text-left" data-home-agent-answer>
          <p className={`text-[12.5px] leading-5 whitespace-pre-wrap break-words ${T.sub}`} data-home-user-message>{exchange.request.originalText}</p>
          <div className="mt-2 text-[14px] leading-6" role="status" aria-live="polite">
            {exchange.loading ? tr('Preparing response…') : answer?.text}
          </div>
          {!!answer?.rows.length && <dl className="mt-2 space-y-1.5 text-[13px]">
            {answer.rows.map(([label, value], index) => <div key={`${label}-${index}`} className="flex justify-between gap-3"><dt className={T.mute}>{label}</dt><dd className="font-num text-right break-words">{value}</dd></div>)}
          </dl>}
          <button onClick={() => { if (exchange?.request) { setAgentSeedMode(null); setAgentSeed(exchange.request.originalText); go('agent') } }} className="mt-3 text-[12.5px] font-semibold text-neon-300 inline-flex items-center gap-1">{tr('Continue in Agent')} <ChevronRight size={13} /></button>
        </div>}
      </div>
    </section>
  )
}

/** Share of the total per verified, priced holding — same numbers as the total above. */
function AllocationBar() {
  const { holdings, pricesReady, mask } = useWallet()
  const [tr] = useT()
  const rows = holdings.filter((h) => h.verified && (h.value ?? 0) > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const sum = rows.reduce((total, h) => total + (h.value ?? 0), 0)
  if (!pricesReady || !sum) return null
  return (
    <div className="mt-4">
      <div className={`mb-2 text-[12px] font-medium ${T.sub}`}>{tr('Allocation')}</div>
      <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.05] gap-[2px]" aria-hidden>
        {rows.map((h) => <span key={h.symbol} style={{ width: `${((h.value ?? 0) / sum) * 100}%`, background: h.color }} />)}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((h) => (
          <span key={h.symbol} className="inline-flex items-center gap-1.5 text-[12px]">
            <TokenIcon color={h.color} glyph={h.glyph} size={16} />
            <span className="font-semibold">{h.symbol}</span>
            <span className={`font-num ${T.mute}`}>{mask(`${(((h.value ?? 0) / sum) * 100).toFixed(1)}%`)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function BalanceHero() {
  const { total, holdings, mask, pricesReady, balanceError, refetchBalance, go, live, hidden, setHidden } = useWallet()
  const [tr] = useT()
  const priced = holdings.filter((h) => h.verified && h.value != null && h.change24h != null)
  const pnl = priced.reduce((s, h) => s + (h.value! - h.value! / (1 + h.change24h! / 100)), 0)
  const pnlPct = total - pnl ? (pnl / (total - pnl)) * 100 : 0
  return (
    <Card className="mk-hero p-5 sm:p-6 mk-in">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5 lg:gap-8 items-stretch">
        <div className="min-w-0 flex flex-col">
          <div className="flex items-center justify-between gap-2">
            <div className={`text-[13px] font-medium ${T.sub} flex items-center gap-2`}>
              {tr('Total balance')}
              <button onClick={() => setHidden(!hidden)} className={`p-1 rounded-md hover:bg-white/[0.06] ${T.mute} hover:text-white`} aria-label={tr(hidden ? 'Show balances' : 'Hide balances')}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              {!live && <span className="px-1.5 py-0.5 rounded text-[10.5px] font-semibold bg-white/[0.06] text-[#b3b0bf]">{tr('Sample data')}</span>}
            </div>
            <div className="flex items-center gap-1 lg:hidden">
              <ShareButton />
            </div>
          </div>
          <div className="mk-display-num mt-2 text-[38px] sm:text-[46px] leading-none font-bold tracking-[-0.035em] font-num">{balanceError ? '—' : pricesReady ? mask(usd(total)) : <Skeleton className="h-11 w-52" />}</div>
          <div className="mt-2.5 text-[13.5px] font-num min-h-5">
            {balanceError ? (
              <span className="text-amber-300" role="alert">{tr(balanceError)} <button onClick={refetchBalance} className="font-semibold text-neon-300 underline">{tr('Retry')}</button></span>
            ) : pricesReady ? (
              <span className={pnl >= 0 ? 'text-live' : 'text-rose-300'}>{mask(`${pnl >= 0 ? '+' : '−'}${usd(Math.abs(pnl), Math.abs(pnl) < 0.01 && pnl !== 0 ? 4 : 2)}`)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%) <span className={T.mute}>24h</span></span>
            ) : <Skeleton className="h-4 w-28" />}
          </div>
          <QuickActions className="mt-5 lg:mt-auto lg:pt-6 -mx-1" />
        </div>
        <div className="min-w-0">
          <div className="hidden lg:flex items-center justify-end gap-1 mb-1">
            <ShareButton />
            <button onClick={() => go('dashboard')} className={`text-[12px] font-medium ${T.sub} hover:text-white inline-flex items-center gap-0.5`}>{tr('Portfolio')} <ChevronRight size={14} /></button>
          </div>
          <PortfolioHistoryChart compact />
          <AllocationBar />
        </div>
      </div>
      <PriceAttribution className="mt-4" />
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

const ATTENTION_ICON: Record<string, typeof AlertTriangle> = { 'recover-bridge': RotateCcw, 'recover-swap': RotateCcw, 'wrong-network': Network, 'low-gas': Fuel }

/** Only items that need the user now: unfinished transfers, wrong network, low gas, triggered tasks. */
function AttentionStrip() {
  const w = useWallet()
  const [tr, language] = useT()
  const locale = language === 'vi' ? 'vi' : 'en'
  if (w.mode === 'demo') return null
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  const tasks = taskItemsForAccount(w.tasks, w.mode, w.address)
  const active = tasks.filter((task) => task.status === 'ACTIVE').length
  const triggered = tasks.filter((task) => task.status === 'TRIGGERED')
  const urgent: AgentAction[] = buildAgentActions({
    mode: w.mode, walletChainId: w.walletChainId, balancesReady: !w.loading && !w.walletError,
    balances: Object.fromEntries(w.holdings.filter((h) => h.verified).map((h) => [h.symbol, h.balance])),
    activeTasks: active,
    pendingBridge: hasPendingStrategy(storage, 'cctp', w.mode === 'connected' ? w.address : undefined),
    pendingSwap: hasPendingStrategy(storage, 'swap', w.mode === 'connected' ? w.address : undefined),
  }, 8).filter((action) => action.priority >= 80 && action.target.type === 'go')
  if (!urgent.length && !triggered.length) return null
  return (
    <section className="mk-in" aria-label={tr('Needs your attention')}>
      <div className="flex flex-wrap gap-2">
        {urgent.map((action) => {
          const Icon = ATTENTION_ICON[action.id] ?? AlertTriangle
          return (
            <button key={action.id} onClick={() => { if (action.target.type === 'go') w.go(action.target.page) }}
              className="flex items-center gap-2.5 h-11 pl-3 pr-3.5 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] hover:bg-amber-300/[0.1] text-left transition">
              <Icon size={15} className="text-amber-300 shrink-0" />
              <span className="text-[13px] font-semibold">{tr(action.title)}</span>
              <ChevronRight size={14} className={T.mute} />
            </button>
          )
        })}
        {triggered.slice(0, 2).map((task) => (
          <button key={task.id} onClick={() => w.go('tasks')} className="flex items-center gap-2.5 h-11 pl-3 pr-3.5 rounded-xl border border-neon-500/30 bg-neon-500/[0.06] hover:bg-neon-500/[0.1] text-left transition min-w-0 max-w-full">
            <BellRing size={15} className="text-neon-300 shrink-0" />
            <span className="text-[13px] font-semibold truncate">{taskDisplayTitle(task, locale)}</span>
            <span className="text-[11.5px] text-neon-300 shrink-0">{taskText('triggered', locale)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  const { activity, go, mode } = useWallet()
  const [tr] = useT()
  return (
    <div className="space-y-5">
      {mode === 'demo' && <WelcomeHero />}
      <BalanceHero />
      <AgentCommand />
      <AttentionStrip />
      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5">
        <Card className="mk-in min-w-0">
          <CardHeader title="Assets" right={<button onClick={() => go('assets')} className={`text-[12px] font-medium ${T.sub} hover:text-white inline-flex items-center gap-0.5`}>{tr('All assets')} <ChevronRight size={14} /></button>} />
          <AssetRows limit={5} />
        </Card>
        <Card className="mk-in min-w-0">
          <CardHeader title="Recent activity" right={<button onClick={() => go('activity')} className={`text-[12px] font-medium ${T.sub} hover:text-white inline-flex items-center gap-0.5`}>{tr('View all')} <ChevronRight size={14} /></button>} />
          <div className="px-1.5 pb-2">
            {activity.length ? activity.slice(0, 5).map((tx) => <TxRow key={tx.id} tx={tx} compact />) : <EmptyState icon={History} title="No activity yet" desc="Your wallet activity will appear here." />}
          </div>
        </Card>
      </div>
    </div>
  )
}
