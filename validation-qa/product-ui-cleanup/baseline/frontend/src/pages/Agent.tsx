import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, ArrowLeftRight, Rainbow, PieChart, Radar, Check, Trash2, Wallet, Boxes, ListChecks, Pencil, Lock } from 'lucide-react'
import { useWallet } from '../lib/store'
import { ARC, TOKENS, fmtAmt, getProvider, isAddress, short, usd } from '../lib/wallet'
import { pickScenario, SAMPLE_PROMPTS } from '../lib/scenarios'
import { taskApi, taskBinding, taskDefinition, taskDisplayTitle, taskError, taskIntentMode, taskItemsForAccount, type TaskCandidate } from '../lib/tasks'
import { taskText } from '../lib/taskText'
import { TaskReviewCard } from '../components/TaskReviewCard'
import { Badge, Button, Card, LiveDot, Orb, PreviewTag, T, TokenIcon } from '../components/wallet/ui'
import { useT } from '../lib/i18n'
import { planBrainRequest } from '../brain/adapter'
import { prepareBrainReview, revalidateBrainReview } from '../brain/policy'
import { createBrainHandoff, storeBrainHandoff } from '../brain/handoff'
import type { BrainPreparation, BrainReviewSnapshot } from '../brain/types'
import { planAgentRequest, replanAgentFromEvidence } from '../migrated/planner'
import { readActivitySnapshot, readAgentNetwork, readAgentWalletSummary } from '../migrated/toolLayer'
import { formatUnits } from 'viem'
import { createAgentSession, recoverLatestAgentSession, rememberAgentSession, transitionAgentSession, type AgentSession } from '../brain/agentSession'
import { localChatReply, routeAgentMessage } from '../agent/chatRouter'
import { requestMakotoChat, type ChatHistoryItem, type ChatSource } from '../agent/chatClient'
import { appendChatHistory, isWalletContextFollowUp } from '../agent/chatContext'
import { formatCurrentDateTime, getCurrentDateTime } from '../agent/time'


/* ---------- Truthful state machine ---------- */
export const STEPS = [
  'User request', 'Planner proposal', 'Review parameters', 'Parameters confirmed', 'Strategy prepared',
  'Review transaction', 'Wallet signature', 'Submitted', 'Confirming', 'Completed',
] as const

type Intent = 'send' | 'swap' | 'bridge'
type Params = { asset: string; amount: string; recipient: string; toAsset: string; dest: string }
type Flow = { intent: Intent; params: Params; stage: number; handedOff?: boolean; brainReview?: BrainReviewSnapshot; session: AgentSession } // stage = index of the CURRENT (not yet done) step
type Msg = { id: string; role: 'user' | 'agent'; text: string; rows?: [string, string][]; flow?: Flow; task?: TaskCandidate; taskAdded?: boolean; link?: { label: string; page: any }; sample?: boolean; conversation?: boolean; source?: ChatSource }

const SUGGEST = [
  { icon: ArrowUpRight, t: SAMPLE_PROMPTS.send },
  { icon: ArrowLeftRight, t: SAMPLE_PROMPTS.swap },
  { icon: Rainbow, t: SAMPLE_PROMPTS.bridge },
  { icon: PieChart, t: SAMPLE_PROMPTS.portfolio },
  { icon: Radar, t: SAMPLE_PROMPTS.alert },
]
const DESTS = ['Base Sepolia', 'Ethereum Sepolia', 'Arbitrum Sepolia']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
let uid = 0
const nid = () => `m${Date.now()}${uid++}`

function Stepper({ stage, compact = false }: { stage: number; compact?: boolean }) {
  const [tr] = useT()
  if (compact) return (
    <div className="flex items-center gap-2 text-[12px]">
      <div className="flex gap-0.5">{STEPS.map((_, i) => <span key={i} className={`h-1 w-3 rounded-full ${i < stage || (i === 3 && stage === 3) ? 'bg-neon-400' : i === stage ? 'bg-neon-300/60' : 'bg-white/10'}`} />)}</div>
      <span className={T.sub}>{tr('Step')} {Math.min(stage + 1, STEPS.length)} · {tr(STEPS[Math.min(stage, STEPS.length - 1)])}</span>
    </div>
  )
  return (
    <ol className="space-y-0">
      {STEPS.map((s, i) => {
        const done = i < stage || (i === 3 && stage === 3) // "Parameters confirmed" is a reached state, not an action
        const cur = i === stage && !done
        return (
          <li key={s} className="flex items-start gap-2.5">
            <span className="flex flex-col items-center">
              <span className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9.5px] font-bold ${done ? 'bg-neon-500 text-[#0b0b10]' : cur ? 'ring-1 ring-neon-400 text-neon-200 bg-neon-500/10' : 'ring-1 ring-white/10 text-[#6f6d7a]'}`}>{done ? <Check size={10} strokeWidth={3} /> : i + 1}</span>
              {i < STEPS.length - 1 && <span className={`w-px h-3.5 ${done ? 'bg-neon-500/60' : 'bg-white/[0.08]'}`} />}
            </span>
            <span className={`text-[12.5px] leading-[18px] ${done ? 'text-[#d6d3e6]' : cur ? 'text-white font-semibold' : 'text-[#6f6d7a]'}`}>{tr(s)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function ReviewCard({ msg, onChange, onConfirm, onContinue, onEdit }: {
  msg: Msg; onChange: (p: Partial<Params>) => void; onConfirm: () => void; onContinue: () => void; onEdit: () => void
}) {
  const { holdings } = useWallet()
  const [tr] = useT()
  const f = msg.flow!
  const p = f.params
  const locked = f.stage > 2
  const bal = holdings.find((h) => h.verified && h.symbol === p.asset)?.balance
  const amt = Number(p.amount) || 0
  const errs: string[] = []
  if (!(amt > 0)) errs.push('Enter an amount')
  if (f.intent === 'send' && !isAddress(p.recipient)) errs.push('Add a valid 0x recipient address')
  if (f.intent === 'swap' && p.toAsset === p.asset) errs.push('Choose a different asset to receive')
  const field = 'h-9 w-full min-w-0 px-2.5 rounded-lg bg-black/30 border border-white/[0.08] text-[13px] disabled:opacity-100 disabled:bg-transparent disabled:border-transparent disabled:px-0'
  const assets = f.intent === 'bridge' ? ['USDC'] : TOKENS.map((t) => t.sym)
  const title = f.intent === 'send' ? 'Transfer' : f.intent === 'swap' ? 'Swap' : 'Bridge'

  return (
    <div className="mt-2 rounded-xl border border-white/[0.08] bg-[#0e0e13] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold tracking-[0.12em] ${T.mute}`}>{tr('REVIEW PARAMETERS')} · {tr(title).toUpperCase()}</span>
        {locked ? <Badge tone="ai"><Lock size={10} /> {tr('Parameters confirmed')}</Badge> : <Badge>{tr('Editable')}</Badge>}
      </div>
      <p className={`px-4 pt-2 text-[11px] ${T.mute}`}>{f.session.stage === 'HANDED_OFF' ? tr('Prepared handoff only; no wallet transaction has been submitted.') : f.session.stage === 'REVIEW_READY' ? tr('Parameters reviewed; product flow must revalidate before wallet request.') : tr('Planning state only; no wallet request.')}</p>
      <div className="p-4 grid grid-cols-[88px_minmax(0,1fr)] gap-y-2.5 gap-x-3 items-center text-[13px]">
        <label htmlFor={`${msg.id}-asset`} className={T.mute}>{tr('Asset')}</label>
        <select id={`${msg.id}-asset`} disabled={locked} value={p.asset} onChange={(e) => onChange({ asset: e.target.value })} className={field}>
          {assets.map((s) => <option key={s} value={s} className="bg-[#17171d]">{s}</option>)}
        </select>
        <label htmlFor={`${msg.id}-amt`} className={T.mute}>{tr('Amount')}</label>
        <input id={`${msg.id}-amt`} disabled={locked} value={p.amount} onChange={(e) => onChange({ amount: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" placeholder="0.00" className={`${field} font-num`} />
        {f.intent === 'send' && <>
          <label htmlFor={`${msg.id}-to`} className={T.mute}>{tr('Recipient')}</label>
          {locked
            ? <span className="font-mono text-[12px] truncate" title={p.recipient}>{short(p.recipient)}</span>
            : <input id={`${msg.id}-to`} value={p.recipient} onChange={(e) => onChange({ recipient: e.target.value.trim() })} placeholder="0x…" spellCheck={false} className={`${field} font-mono text-[12px]`} />}
        </>}
        {f.intent === 'swap' && <>
          <label htmlFor={`${msg.id}-recv`} className={T.mute}>{tr('Receive')}</label>
          <select id={`${msg.id}-recv`} disabled={locked} value={p.toAsset} onChange={(e) => onChange({ toAsset: e.target.value })} className={field}>
            {TOKENS.map((t) => <option key={t.sym} value={t.sym} className="bg-[#17171d]">{t.sym}</option>)}
          </select>
        </>}
        {f.intent === 'bridge' && <>
          <label htmlFor={`${msg.id}-dest`} className={T.mute}>{tr('Destination')}</label>
          <select id={`${msg.id}-dest`} disabled={locked} value={p.dest} onChange={(e) => onChange({ dest: e.target.value })} className={field}>
            {DESTS.map((d) => <option key={d} className="bg-[#17171d]">{d}</option>)}
          </select>
        </>}
        <span className={T.mute}>{tr('Network')}</span>
        <span className="h-9 flex items-center">Arc</span>
      </div>
      {!locked && (
        <div className="px-4 pb-4">
          {errs.length > 0 ? <p className={`mb-2.5 text-[12px] ${T.mute}`}>{tr(errs[0])}.</p>
            : bal != null && amt > bal ? <p className="mb-2.5 text-[12px] text-amber-200/90">{tr('Amount is above your {asset} balance').replace('{asset}', p.asset)} ({fmtAmt(bal)}).</p> : null}
          <Button variant="primary" className="w-full" disabled={errs.length > 0} onClick={onConfirm}>{tr('Confirm parameters')}</Button>
          <p className={`mt-2 text-[11.5px] text-center ${T.mute}`}>{tr('Confirms these values reflect what you intend. It does not approve or sign anything.')}</p>
        </div>
      )}
      {locked && (
        <div className="border-t border-white/[0.06] p-4">
          <p className={`text-[12.5px] ${T.sub}`}>
            {tr('Next in the real product: the Planner prepares a strategy, you')} <b className="text-white font-semibold">{tr('review the transaction')}</b>{tr(', then')} <b className="text-white font-semibold">{tr('sign in your wallet')}</b> {tr('— three separate steps.')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={onEdit}><Pencil size={13} /> {tr('Edit parameters')}</Button>
            <Button size="sm" variant="primary" className="flex-1 min-w-[180px]" onClick={onContinue}>
              {tr(f.intent === 'send' ? 'Continue to Send preview' : f.intent === 'swap' ? 'Open Swap preview' : 'Open Bridge preview')}
            </Button>
          </div>
        </div>
      )}
      <div className="px-4 py-2 border-t border-white/[0.05] flex justify-end"><PreviewTag /></div>
    </div>
  )
}

function ContextPanel({ flow }: { flow?: Flow }) {
  const { mode, address, displayAddress, total, pricesReady, mask, holdings, network, networkError, tasks, go } = useWallet()
  const [tr, language] = useT()
  const locale = language === 'vi' ? 'vi' : 'en'
  const active = taskItemsForAccount(tasks, mode, address).filter((task) => task.status === 'ACTIVE')
  return (
    <div className="space-y-3">
      {flow && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3"><span className="text-[13px] font-semibold">{tr('Progress')}</span></div>
          <Stepper stage={flow.stage} />
          <p className={`mt-3 text-[11.5px] ${T.mute}`}>{tr(flow.stage >= 3 ? 'The preview stops at Parameters confirmed. Later steps are shown for reference only.' : 'Waiting for you to review the parameters.')}</p>
        </Card>
      )}
      <Card className="p-4">
        <div className={`flex items-center gap-2 text-[12px] font-semibold ${T.mute}`}><Wallet size={13} /> {tr('WALLET')}</div>
        <div className="mt-2 flex items-center justify-between text-[13px]"><span className="font-mono">{short(displayAddress)}</span><Badge>{tr(mode === 'demo' ? 'Demo' : mode === 'watch' ? 'Watch-only' : 'Connected')}</Badge></div>
        <div className="mt-1 text-[20px] font-bold font-num">{pricesReady ? mask(usd(total)) : '—'}</div>
        <div className={`text-[11px] ${T.mute}`}>{mode === 'demo' ? tr('Sample data') : `${tr('Live data')} · ArcScan`}</div>
        <div className="mt-2 space-y-1.5">
          {holdings.filter((h) => h.verified).slice(0, 3).map((h) => (
            <div key={h.symbol} className="flex items-center gap-2 text-[12.5px]"><TokenIcon color={h.color} glyph={h.glyph} size={18} /><span>{h.symbol}</span><span className={`ml-auto font-num ${T.sub}`}>{mask(fmtAmt(h.balance, h.decimals))}</span></div>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <div className={`flex items-center gap-2 text-[12px] font-semibold ${T.mute}`}><Boxes size={13} /> {tr('NETWORK')}</div>
        <div className="mt-2 flex items-center gap-2 text-[13px]"><LiveDot off={networkError} /> {networkError ? tr('Network unavailable') : network ? `${ARC.name} · ${tr('Online')}` : tr('Checking network…')}</div>
        <div className={`mt-1 text-[12px] font-num ${T.mute}`}>{network ? `${tr('Block')} #${network.blockNumber.toLocaleString()} · ${tr('Network response time')} ${network.rpcLatencyMs} ms` : networkError ? tr('Unavailable') : '—'}</div>
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between"><span className={`flex items-center gap-2 text-[12px] font-semibold ${T.mute}`}><ListChecks size={13} /> {tr('TASKS')}</span><button onClick={() => go('tasks')} className="text-[12px] text-neon-300 hover:text-neon-200">{tr('View')}</button></div>
        {active.length ? active.slice(0, 3).map((task) => <div key={task.id} className="mt-2 text-[12.5px]"><div className="font-medium truncate">{taskDisplayTitle(task, locale)}</div><div className={`truncate ${T.mute}`}>{taskDefinition(task, locale)}</div></div>) : <p className={`mt-2 text-[12.5px] ${T.mute}`}>{tr('No active tasks.')}</p>}
      </Card>
    </div>
  )
}

export default function AgentPage() {
  const w = useWallet()
  const [tr, lang] = useT()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const restoredAccount = useRef('')
  const chatHistory = useRef<ChatHistoryItem[]>([])
  const current = [...msgs].reverse().find((m) => m.flow)?.flow

  /** Deterministic Makoto brain first; legacy sample scenarios remain as fallback so the canonical ZIP loses nothing. */
  const brainContext = () => ({
    connected: w.mode === 'connected',
    account: w.mode === 'connected' ? w.address : undefined,
    chainId: w.walletChainId,
    balances: Object.fromEntries(w.holdings.filter((h) => h.verified).map((h) => [h.symbol, h.balance])),
    knownRecipients: [
      ...w.contacts.map((c) => c.address),
      ...w.activity.map((a) => a.counterparty),
    ],
  })
  const actionFromFlow = (f: Flow): BrainPreparation => ({
    kind: f.intent,
    rawUserText: 'Makoto Agent reviewed parameters',
    amount: f.params.amount || undefined,
    asset: f.params.asset || undefined,
    ...(f.intent === 'send' ? { recipient: f.params.recipient || undefined } : {}),
    ...(f.intent === 'swap' ? { outputAsset: f.params.toAsset || undefined } : {}),
    ...(f.intent === 'bridge' ? { sourceChain: ARC.name, destinationChain: f.params.dest || undefined } : {}),
  })
  const plan = async (q: string, history: readonly ChatHistoryItem[], forcedTaskMode?: 'monitor' | 'automation' | null): Promise<Msg> => {
    const locale = lang === 'vi' ? 'vi' : 'en'
    const taskMode = forcedTaskMode ?? taskIntentMode(q)
    if (taskMode) {
      const binding = taskBinding({ mode: w.mode, address: w.address, walletChainId: w.walletChainId })
      if (!binding.ok) return { id: nid(), role: 'agent', text: binding.reason === 'CHAIN_REQUIRED' ? taskText('chainFirst', locale) : taskText('connectFirst', locale) }
      if (!w.taskAuthenticated) return { id: nid(), role: 'agent', text: taskText('verifyWallet', locale), link: { label: taskText('verifyWallet', locale), page: 'tasks' } }
      try {
        const parsed = await taskApi.parse({ text: q, mode: taskMode, account: binding.account, chainId: binding.chainId, timezone: binding.timezone, locale })
        if (parsed.blocked?.code === 'TASK_WRITE_REQUIRES_USER') return { id: nid(), role: 'agent', text: taskText('writeBoundary', locale) }
        if (!parsed.candidate) return { id: nid(), role: 'agent', text: taskText('unsupported', locale), rows: parsed.missingFields?.map((field) => [taskText('missing', locale), field]) }
        return { id: nid(), role: 'agent', text: locale === 'vi' ? 'Hãy xem lại định nghĩa trước khi tạo nhiệm vụ nền.' : 'Review the definition before creating a background task.', task: { ...parsed.candidate, createdBy: 'AGENT' } }
      } catch (cause) { return { id: nid(), role: 'agent', text: taskError(cause, locale) } }
    }
    const contextualWallet = isWalletContextFollowUp(q, history, locale)
    const routed = contextualWallet ? routeAgentMessage('What is my balance?', locale) : routeAgentMessage(q, locale)
    const structured = contextualWallet ? routed.plan : planAgentRequest(q, lang === 'vi' ? 'vi' : 'en')
    const chat = async (topic: typeof routed.topic, intent: 'CHAT' | 'INFORMATION', toolResult?: unknown, fallback?: string) => {
      const response = await requestMakotoChat({ message: q, topic, context: { locale, mode: w.mode, ...(w.mode === 'connected' ? { chain: ARC.name as 'Arc Testnet' } : {}), intent, toolResult }, history })
      return response.ok ? { text: response.text, source: response.source } : { text: fallback || localChatReply(topic, locale, true), source: 'LOCAL_FALLBACK' as const }
    }
    if (routed.category === 'CHAT') {
      const answer = await chat(routed.topic, 'CHAT')
      return { id: nid(), role: 'agent', text: answer.text, sample: false, conversation: true, source: answer.source }
    }
    const observed = w.mode === 'connected' && (structured.status === 'ACTION' || structured.status === 'STRATEGY') ? await replanAgentFromEvidence(structured, getProvider(), w.address) : undefined
    const evidenceRows: [string, string][] = observed ? [[tr('Live evidence'), `${observed.status}: ${observed.reason}`], ...(observed.quoteExpiresAt ? [[tr('Quote expires'), new Date(observed.quoteExpiresAt).toLocaleTimeString()] as [string, string]] : [])] : []
    if (structured.status === 'INFORMATION' && structured.topic === 'current-datetime') {
      const currentTime = getCurrentDateTime()
      const rendered = formatCurrentDateTime(currentTime, locale)
      return { id: nid(), role: 'agent', text: locale === 'vi' ? `Hi\u1ec7n t\u1ea1i l\u00e0 ${rendered}.` : `It is ${rendered}.`, conversation: true, source: 'DETERMINISTIC_TOOL' }
    }
    if (structured.status === 'STRATEGY') return { id: nid(), role: 'agent', text: tr('This is a structured sequential plan for review only. Each action needs fresh reads, policy review, its own wallet confirmation and receipt before the next step.'), rows: [...structured.intents.map((intent, index): [string, string] => [`${index + 1}. ${tr(intent.kind)}`, `ID ${intent.id} · ${index ? (lang === 'vi' ? `sau biên nhận và kiểm tra lại bước ${index}` : `after goal-${index} receipt and revalidation`) : (lang === 'vi' ? 'bước đầu tiên' : 'first step')}`]), ...evidenceRows] }
    if (q.toLowerCase().match(/\b(?:and then|then|sau đó|rồi)\b/)) return { id: nid(), role: 'agent', text: tr('I cannot safely prepare this sequence yet.'), rows: 'reasons' in structured ? structured.reasons.map((reason) => [tr('Missing'), reason]) : [] }
    const brain = planBrainRequest(contextualWallet ? 'What is my balance?' : q, lang, brainContext())
    const flow = (intent: Intent, params: Params, text: string): Msg => {
      const requested = createAgentSession(nid())
      const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: nid(), now: Date.now() })
      if (planned.accepted && w.mode === 'connected' && w.address && typeof sessionStorage !== 'undefined') rememberAgentSession(sessionStorage, planned.state, w.address)
      return { id: nid(), role: 'agent', text, rows: evidenceRows, flow: { intent, params, stage: 2, session: planned.accepted ? planned.state : requested }, sample: false }
    }
    const base: Params = { asset: 'USDC', amount: '', recipient: '', toAsset: 'EURC', dest: 'Base Sepolia' }
    if (brain.action) {
      const a = brain.action
      if (brain.decision.blockers.length || brain.decision.missingFields.length) {
        const rows: [string, string][] = [
          ...brain.decision.missingFields.map((field) => [tr('Missing'), field] as [string, string]),
          ...brain.decision.blockers.map((reason) => [tr('Blocked'), reason] as [string, string]),
        ]
        return { id: nid(), role: 'agent', text: tr('I need a little more information before I can prepare this safely.'), rows }
      }
      if (a.kind === 'send') return flow('send', { ...base, asset: a.asset ?? 'USDC', amount: a.amount ?? '', recipient: a.recipient ?? '' }, tr('I parsed the transfer locally. Review the parameters before anything reaches your wallet.'))
      if (a.kind === 'swap') return flow('swap', { ...base, asset: a.asset ?? 'USDC', amount: a.amount ?? '', toAsset: a.outputAsset ?? 'EURC' }, tr('I parsed the swap locally. A fresh quote and safety revalidation are still required before wallet confirmation.'))
      return flow('bridge', { ...base, asset: a.asset ?? 'USDC', amount: a.amount ?? '', dest: a.destinationChain ?? 'Base Sepolia' }, tr('I parsed the bridge locally. Source submission and destination completion remain separate states.'))
    }
    if (brain.intent.kind === 'safety-capabilities') return { id: nid(), role: 'agent', text: tr('Makoto prepares actions but never signs for you. Every write must be reviewed again immediately before the connected wallet is opened.'), rows: [[tr('Policy'), tr('Prepare-only Agent')], [tr('Signing'), tr('User wallet only')], [tr('Revalidation'), tr('Required before wallet request')], [tr('Bridge completion'), tr('Destination evidence required')]] }
    if (brain.intent.kind === 'wallet-overview') {
      if (w.mode !== 'connected') return { id: nid(), role: 'agent', text: tr('Connect a wallet for live balances. Demo balances are samples, not wallet evidence.') }
      const result = await readAgentWalletSummary()
      if (result.status === 'OK' && result.data) {
        const rows: [string, string][] = result.data.balances.map((balance) => [balance.asset.sym, formatUnits(balance.units, balance.asset.decimals)])
        const answer = await chat('wallet', 'INFORMATION', { status: result.status, source: result.source, balances: rows.map(([symbol, amount]) => ({ symbol, amount })) }, tr('Verified Arc wallet balances from the connected wallet.'))
        return { id: nid(), role: 'agent', text: answer.text, rows, conversation: true, source: answer.source }
      }
      return { id: nid(), role: 'agent', text: tr('Live wallet balances are unavailable.'), rows: [[tr('Reason'), tr(result.reason ?? 'Provider unavailable')]] }
    }
    if (brain.intent.kind === 'recent-activity') {
      const result = readActivitySnapshot(w.activity, { connected: w.mode === 'connected', loading: w.loading, error: w.walletError, observedAt: Date.now() })
      if (result.status === 'OK' && result.data) {
        const rows: [string, string][] = result.data.slice(0, brain.intent.limit ?? 5).map((entry) => [tr(cap(entry.kind ?? entry.direction)), `${entry.amount} ${entry.symbol} · ${tr(cap(entry.status))}`])
        const answer = await chat('activity', 'INFORMATION', { status: result.status, source: result.source, rows }, tr('Recent observed wallet activity.'))
        return { id: nid(), role: 'agent', text: answer.text, rows, conversation: true, source: answer.source }
      }
      return { id: nid(), role: 'agent', text: tr('Live activity is unavailable.'), rows: [[tr('Reason'), tr(result.reason ?? 'Provider unavailable')]] }
    }
    if (brain.intent.kind === 'network-status') {
      const result = await readAgentNetwork()
      if (result.status === 'OK' && result.data) {
        const rows: [string, string][] = [[tr('Chain'), String(result.data.chainId)], [tr('Block'), result.data.blockNumber.toString()]]
        const answer = await chat('network', 'INFORMATION', { status: result.status, source: result.source, rows }, tr('Connected Arc network state.'))
        return { id: nid(), role: 'agent', text: answer.text, rows, conversation: true, source: answer.source }
      }
      return { id: nid(), role: 'agent', text: tr('Live network state is unavailable.'), rows: [[tr('Reason'), tr(result.reason ?? 'Provider unavailable')]] }
    }
    const sc = pickScenario(q)
    switch (sc.kind) {
      case 'send': return flow('send', { ...base, asset: sc.asset, amount: sc.amount, recipient: sc.recipient }, tr('I found the details. Review the parameters before continuing.'))
      case 'swap': return flow('swap', { ...base, asset: sc.asset, amount: sc.amount, toAsset: sc.toAsset }, tr('I found the details. Review the parameters before continuing. Any price shown later is a preview estimate, not a quote.'))
      case 'bridge': return flow('bridge', { ...base, asset: 'USDC', amount: sc.amount, dest: sc.dest }, tr('I found the details. Review the parameters before continuing.'))
      case 'portfolio': {
        const v = w.holdings.filter((h) => h.verified && h.balance > 0)
        return { id: nid(), role: 'agent', text: `${tr('Your assets on {network} are worth {value}').replace('{network}', ARC.name).replace('{value}', w.pricesReady ? w.mask(usd(w.total)) : `— (${tr('prices unavailable')})`)}${w.mode === 'demo' ? ` — ${tr('sample demo data')}` : ''}.`, rows: v.map((h) => [h.symbol, w.mask(`${fmtAmt(h.balance, h.decimals)} · ${w.pricesReady && h.value != null ? usd(h.value) : '—'}`)] as [string, string]), link: { label: tr('Open Portfolio'), page: 'dashboard' } }
      }
      case 'activity': {
        const r = w.activity.slice(0, 4)
        return { id: nid(), role: 'agent', text: r.length ? `${tr('Your last {n} transactions').replace('{n}', String(r.length))}${w.mode === 'demo' ? ` (${tr('sample data')})` : ''}:` : tr('No activity yet.'), rows: r.map((a) => [`${tr(cap(a.kind ?? a.direction))} ${a.symbol}`, `${fmtAmt(a.amount)} · ${tr(cap(a.status ?? 'completed'))}`] as [string, string]), link: { label: tr('Open Activity'), page: 'activity' } }
      }
      default:
        return { id: nid(), role: 'agent', text: lang === 'vi'
          ? 'Makoto có thể đọc thông tin ví, tạo nhiệm vụ theo dõi và tóm tắt, hoặc chuẩn bị giao dịch để bạn xem lại. Hãy thử một gợi ý bên dưới.'
          : 'Makoto can read wallet information, create monitoring and summary tasks, or prepare a transaction for your review. Try a suggestion below.' }
    }
  }

  const ask = (q: string, display = q, forcedTaskMode?: 'monitor' | 'automation' | null) => {
    if (!q.trim()) return
    const history = chatHistory.current
    chatHistory.current = appendChatHistory(history, { role: 'user', content: q })
    setMsgs((m) => [...m, { id: nid(), role: 'user', text: display }])
    setInput('')
    setTyping(true)
    setTimeout(() => {
      void plan(q, history, forcedTaskMode).then((answer) => {
        if (answer.conversation) chatHistory.current = appendChatHistory(chatHistory.current, { role: 'assistant', content: answer.text })
        setMsgs((m) => [...m, answer])
        setTyping(false)
      }).catch(() => {
        const answer: Msg = { id: nid(), role: 'agent', text: tr('Live data is unavailable. Please try again.'), conversation: true, source: 'LOCAL_FALLBACK' }
        chatHistory.current = appendChatHistory(chatHistory.current, { role: 'assistant', content: answer.text })
        setMsgs((m) => [...m, answer])
        setTyping(false)
      })
    }, 500)
  }
  const patch = (id: string, fn: (f: Flow) => Flow) => setMsgs((m) => m.map((x) => x.id === id && x.flow ? { ...x, flow: fn(x.flow) } : x))

  // The Agent remains prepare-only. Confirmation freezes a data-only review; the wallet is never opened here.
  const confirm = (id: string) => patch(id, (f) => {
    const brainReview = prepareBrainReview(actionFromFlow(f), brainContext())
    const transition = w.mode === 'connected' && w.address ? transitionAgentSession(f.session, { type: 'review-ready', account: w.address, expiresAt: brainReview.expiresAt, now: Date.now() }) : undefined
    if (transition?.accepted && typeof sessionStorage !== 'undefined') rememberAgentSession(sessionStorage, transition.state, w.address)
    return { ...f, stage: 3, brainReview, session: transition?.accepted ? transition.state : f.session }
  })
  const cont = (m: Msg) => {
    const f = m.flow!
    const p = f.params
    const action = actionFromFlow(f)
    if (f.brainReview) {
      const checked = revalidateBrainReview(f.brainReview, action, brainContext())
      if (!checked.valid) {
        w.notify(tr(checked.reason === 'expired' ? 'Review expired — review the parameters again' : checked.reason === 'changed' ? 'Details changed — review again' : checked.assessment.blockers[0] ?? 'Action blocked by safety policy'), 'err')
        patch(m.id, (x) => {
          const requested = createAgentSession(nid())
          const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: nid(), now: Date.now() })
          return { ...x, stage: 2, handedOff: false, brainReview: undefined, session: planned.accepted ? planned.state : requested }
        })
        return
      }
    }
    if (w.mode === 'connected' && typeof sessionStorage !== 'undefined') {
      const handoff = createBrainHandoff(action, w.address)
      const transition = transitionAgentSession(f.session, { type: 'handed-off', account: w.address, now: Date.now() })
      if (!handoff || !transition.accepted) { w.notify(tr('Review state expired or invalid; review again.'), 'err'); return }
      storeBrainHandoff(sessionStorage, handoff)
      rememberAgentSession(sessionStorage, transition.state, w.address)
      patch(m.id, (x) => ({ ...x, session: transition.state }))
    }
    patch(m.id, (x) => ({ ...x, handedOff: true }))
    if (f.intent === 'send') { w.setSendDraft({ symbol: p.asset, amount: p.amount, to: p.recipient, review: true }); w.go('send') }
    else if (f.intent === 'swap') { w.setSwapDraft({ from: p.asset, to: p.toAsset, amount: p.amount }); w.go('swap') }
    else { w.setSwapDraft({ amount: p.amount, dest: p.dest }); w.go('bridge') }
  }

  useEffect(() => {
    if (w.agentSeed) { ask(w.agentSeed, w.agentSeed, w.agentSeedMode); w.setAgentSeed(null); w.setAgentSeedMode(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.agentSeed])
  useEffect(() => {
    if (w.mode !== 'connected' || !w.address || restoredAccount.current === w.address.toLowerCase() || typeof sessionStorage === 'undefined') return
    restoredAccount.current = w.address.toLowerCase()
    const historical = recoverLatestAgentSession(sessionStorage, w.address)
    if (historical.status === 'HISTORICAL') setMsgs((current) => [...current, { id: nid(), role: 'agent', text: tr('A previous Agent session is available as history only. Request a fresh plan and review to continue.'), rows: [[tr('Previous state'), historical.state.stage]] }])
  }, [w.mode, w.address, tr])
  useEffect(() => { if (msgs.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, typing])

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
      <Card className="flex flex-col min-h-[calc(100vh-200px)]">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            <Orb size={32} />
            <div className="min-w-0">
              <div className="font-semibold text-[14.5px]">{tr('Makoto Agent')}</div>
              <div className={`text-[12px] flex items-center gap-1.5 ${T.mute}`}><span className="w-2 h-2 rounded-full bg-neon-400/70 shrink-0" /> {tr('Local planner · prepare-only · you review and sign')}</div>
            </div>
          </div>
          {msgs.length > 0 && <Button variant="ghost" size="sm" onClick={() => { setMsgs([]); chatHistory.current = [] }}><Trash2 size={13} /> {tr('Clear')}</Button>}
        </div>
        {current && <div className="lg:hidden px-4 py-2.5 border-b border-white/[0.05]"><Stepper stage={current.stage} compact /></div>}

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-4">
          {msgs.length === 0 && (
            <div className="text-center pt-8 sm:pt-14">
              <div className="mx-auto w-fit"><Orb size={64} /></div>
              <h2 className="mt-5 text-[20px] font-bold tracking-tight">{tr('What should Makoto do for you?')}</h2>
              <p className={`mt-1.5 text-[13.5px] max-w-[420px] mx-auto ${T.sub}`}>{tr('Describe it in plain language. Makoto proposes the parameters, you review them.')}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGEST.map(({ icon: Icon, t }) => (
                  <button key={t} onClick={() => ask(t, tr(t))} className={`h-9 px-3 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[12.5px] ${T.sub} hover:text-white hover:bg-white/[0.05] inline-flex items-center gap-2`}><Icon size={14} className="text-neon-300" />{tr(t)}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m) => m.role === 'user' ? (
            <div key={m.id} className="flex justify-end mk-in"><div className="max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-md bg-neon-500/10 border border-white/[0.08] text-[14px]">{m.text}</div></div>
          ) : (
            <div key={m.id} className="flex gap-2.5 mk-in">
              <span className="mt-0.5"><Orb size={26} /></span>
              <div className="flex-1 min-w-0 max-w-[560px]">
                <div className="text-[14px] leading-relaxed">{tr(m.text)}</div>
                {m.rows && m.rows.length > 0 && (
                  <dl className="mt-2 rounded-xl border border-white/[0.07] divide-y divide-white/[0.05] text-[13px]">
                    {m.rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-3.5 py-2"><dt className={`capitalize ${T.mute}`}>{k}</dt><dd className="font-num text-right">{v}</dd></div>)}
                  </dl>
                )}
                {m.flow && (
                  <ReviewCard
                    msg={m}
                    onChange={(p) => patch(m.id, (f) => ({ ...f, params: { ...f.params, ...p } }))}
                    onConfirm={() => confirm(m.id)}
                    onEdit={() => patch(m.id, (f) => { const requested = createAgentSession(nid()); const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: nid(), now: Date.now() }); return { ...f, stage: 2, handedOff: false, brainReview: undefined, session: planned.accepted ? planned.state : requested } })}
                    onContinue={() => cont(m)}
                  />
                )}
                {m.task && <TaskReviewCard candidate={m.task} tasks={w.tasks} created={m.taskAdded} onCreate={async () => { await w.createTask(m.task!); w.notify(taskText('created', lang === 'vi' ? 'vi' : 'en')); setMsgs((messages) => messages.map((entry) => entry.id === m.id ? { ...entry, taskAdded: true } : entry)) }} />}
                {m.taskAdded && <Button size="sm" className="mt-2" onClick={() => w.go('tasks')}>{tr('View in Tasks')}</Button>}
                {m.link && <Button size="sm" className="mt-2" onClick={() => w.go(m.link!.page)}>{m.link.label}</Button>}
              </div>
            </div>
          ))}
          {typing && <div className="flex gap-2.5 items-center"><Orb size={26} /><span className={`text-[13px] ${T.sub}`}>{tr('Preparing response…')}</span></div>}
          <div ref={end} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="p-3 sm:p-4 border-t border-white/[0.06]">
          <div className="mk-field-shell flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/25 p-1.5 transition">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={tr('Send 10 EURC to 0x1234…7890')} aria-label={tr('Message Makoto')} className="flex-1 min-w-0 bg-transparent px-2.5 py-2 text-[14px] outline-none placeholder:text-[#6f6d7a]" />
            <button disabled={!input.trim() || typing} className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-neon-500 text-[#0b0b10] hover:bg-neon-400 disabled:bg-white/[0.06] disabled:text-white/30" aria-label={tr('Send message')}><ArrowUp size={17} /></button>
          </div>
        </form>
      </Card>
      <aside className="hidden lg:block sticky top-[76px]"><ContextPanel flow={current} /></aside>
    </div>
  )
}
