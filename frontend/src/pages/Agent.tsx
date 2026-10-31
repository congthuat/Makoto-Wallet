import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, ArrowLeftRight, Rainbow, PieChart, Radar, Check, Trash2, Wallet, Boxes, ListChecks, Pencil, Lock, Zap, Fuel, BellRing, TrendingUp, Newspaper, RefreshCw, Sparkles, Database, Brain, UserPlus, X, ListOrdered, Play, RotateCcw, Square, Copy, Mic, MicOff, CornerDownRight, ImagePlus } from 'lucide-react'
import { RecipientSafety } from './Send'
import { AgentSendCard, type AgentSendStage } from '../components/AgentSendCard'
import { AgentSwapCard } from '../components/AgentSwapCard'
import { AgentBridgeCard } from '../components/AgentBridgeCard'
import type { CctpTransferSpeed } from '../migrated/toolLayer'
import { useWallet } from '../lib/store'
import { ARC, TOKENS, ensureArcNetwork, fmtAmt, getProvider, isAddress, short, usd } from '../lib/wallet'
import { pickScenario, SAMPLE_PROMPTS } from '../lib/scenarios'
import { taskApi, taskBinding, taskDefinition, taskDisplayTitle, taskError, taskIntentMode, taskItemsForAccount, type TaskCandidate } from '../lib/tasks'
import { taskText, type TaskTextKey } from '../lib/taskText'
import { TaskReviewCard } from '../components/TaskReviewCard'
import { Badge, Button, Card, LiveDot, Orb, PreviewTag, T, TokenIcon } from '../components/wallet/ui'
import { useT } from '../lib/i18n'
import { planBrainRequest } from '../brain/adapter'
import { prepareBrainReview, revalidateBrainReview } from '../brain/policy'
import { createBrainHandoff, storeBrainHandoff } from '../brain/handoff'
import type { BrainPreparation, BrainReviewSnapshot } from '../brain/types'
import { planAgentRequest, replanAgentFromEvidence, type AgentEvidence } from '../migrated/planner'
import { withRpcTimeout, AGENT_EVIDENCE_TIMEOUT_MS } from '../lib/rpcTimeout'
import { readHomeAnswer, renderHomeAnswer, routeHomeRequest, type QuickAnswer } from '../agent/homeRequest'
import { createAgentSession, rememberAgentSession, transitionAgentSession, type AgentSession } from '../brain/agentSession'
import { localChatReply, routeAgentMessage, type ChatTopic } from '../agent/chatRouter'
import { requestMakotoChat, requestMakotoChatStream, visibleStreamText, type ChatChart, type ChatDataSource, type ChatHistoryItem, type ChatMemoryUpdate, type ChatSource, type ChatTaskDraft } from '../agent/chatClient'
import { addNote, contactInText, contactSaveCheck, loadAgentMemory, memoryForRequest, removeNote, saveAgentMemory, setBridgeSpeed, type AgentMemory, type AgentNote } from '../lib/agentMemory'
import { describeStep, planStatuses, planStepsFromText, stepCommand, type PlanStep } from '../lib/agentPlan'
import { AreaChart } from '../components/wallet/charts'
import { AgentMarkdown } from '../components/AgentMarkdown'
import { buildAgentActions, hasPendingStrategy, type AgentAction, type AgentActionIcon } from '../lib/agentActions'
import { appendChatHistory, isWalletContextFollowUp } from '../agent/chatContext'
import { formatCurrentDateTime, getCurrentDateTime, type CurrentDateTime } from '../agent/time'
import { agentFieldLabel, agentStatusLabel } from '../lib/agentPresentation'


/* ---------- Truthful state machine ---------- */
export const STEPS = [
  'User request', 'Planner proposal', 'Review parameters', 'Parameters confirmed', 'Strategy prepared',
  'Review transaction', 'Wallet signature', 'Submitted', 'Confirming', 'Completed',
] as const

/** Map real Send execution evidence to the 10-step UI.
 * UNKNOWN, REJECTED and FAILED must never promote the flow to completed.
 * 'confirmed' is emitted only after the Send card verified a matching on-chain receipt. */
export function agentSendProgressStage(state: AgentSendStage, previous: number): number {
  switch (state) {
    case 'preparing': return 4
    case 'review': return 5
    case 'requesting': return 6
    case 'submitted': return 7
    case 'pending': return 8
    case 'confirmed': return STEPS.length
    default: return previous
  }
}

type Intent = 'send' | 'swap' | 'bridge'
type Params = { asset: string; amount: string; recipient: string; toAsset: string; dest: string }
/** execCard: 'pending' = params confirmed, user has not yet clicked Execute in Chat
 *            'active'  = execution component is mounted and running
 *            undefined = not in native execution mode (handoff path)   */
type ExecCardState = 'pending' | 'active'
type SlipOption = '0.5%' | '1%' | '3%'
type Flow = {
  intent: Intent; params: Params; stage: number; handedOff?: boolean
  brainReview?: BrainReviewSnapshot; session: AgentSession; execCard?: ExecCardState
  /** Slippage chosen by user before Swap card mounts. Defaults to '0.5%'. */
  execSlip?: SlipOption
  /** Transfer speed chosen by user before Bridge card mounts. Defaults to 'FAST'. */
  execSpeed?: CctpTransferSpeed
} // stage = index of the CURRENT (not yet done) step
type TaskReply = { kind: 'COPY'; key: TaskTextKey } | { kind: 'ERROR'; code: string } | { kind: 'REVIEW' }
type Msg = { id: string; role: 'user' | 'agent'; text: string; rows?: [string, string][]; quick?: QuickAnswer; taskReply?: TaskReply; taskMissingFields?: readonly string[]; liveEvidence?: Pick<AgentEvidence, 'status' | 'reason' | 'quoteExpiresAt'>; strategyKinds?: readonly string[]; datetime?: CurrentDateTime; localChatTopic?: ChatTopic; flow?: Flow; task?: TaskCandidate; taskAdded?: boolean; link?: { label: string; page: any; taskTextKey?: TaskTextKey }; sample?: boolean; conversation?: boolean; source?: ChatSource; dataSources?: readonly ChatDataSource[]; aiProposal?: boolean
  /** Streaming placeholder (text grows; replaced by the final reply). */
  streaming?: boolean; toolStatus?: string
  charts?: readonly ChatChart[]
  /** Notes saved on this device from this reply (undo-able). */
  memoryNotes?: readonly AgentNote[]
  /** Contacts the Agent offered to save; saving needs a click. */
  contactOffers?: readonly ContactOffer[]
  /** A multi-step plan checklist. */
  plan?: PlanState
  /** This review card is step `index` of the plan in message `planId`. */
  planRef?: Readonly<{ planId: string; index: number }>
  /** Suggested next questions (AI replies). */
  followups?: readonly string[]
  /** The user question that produced this AI reply (for "Ask again"). */
  question?: string
  stopped?: boolean
  /** Screenshot attached to a user message (kept in memory only, never saved). */
  image?: string
}
type ContactOffer = Readonly<{ name: string; address: string; state: 'pending' | 'saved' | 'dismissed' | 'duplicate' }>
type PlanState = Readonly<{ steps: readonly PlanStep[]; done: readonly boolean[]; activeIndex?: number; failedIndex?: number }>

const SUGGEST = [
  { icon: ArrowUpRight, t: SAMPLE_PROMPTS.send },
  { icon: ArrowLeftRight, t: SAMPLE_PROMPTS.swap },
  { icon: Rainbow, t: SAMPLE_PROMPTS.bridge },
  { icon: PieChart, t: SAMPLE_PROMPTS.portfolio },
  { icon: Radar, t: SAMPLE_PROMPTS.alert },
  { icon: Newspaper, t: 'Morning briefing for today' },
  { icon: TrendingUp, t: 'Wallet profit and loss over 7 days' },
]
/** Shrinks a screenshot in the browser before it is sent (long side ≤ 1280px, JPEG). */
const MAX_IMAGE_CHARS = 1_500_000
async function compressImage(file: Blob): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) throw new Error('UNSUPPORTED_IMAGE')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error('UNREADABLE_IMAGE')); el.src = url })
    for (const [side, quality] of [[1280, 0.8], [1024, 0.72], [800, 0.65]] as const) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const g = canvas.getContext('2d')
      if (!g) throw new Error('UNREADABLE_IMAGE')
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height)
      g.drawImage(img, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= MAX_IMAGE_CHARS) return data
    }
    throw new Error('IMAGE_TOO_LARGE')
  } finally { URL.revokeObjectURL(url) }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
let uid = 0
const nid = () => `m${Date.now()}${uid++}`
/** Analysis-style questions go to the tool-using AI instead of the single deterministic quick read. */
const ANALYSIS_WORDS = ['analy', 'insight', 'explain', 'compare', 'should i', 'phân tích', 'đánh giá', 'nhận xét', 'so sánh', 'giải thích', 'nên ', '分析', '解释', '比较', '分析して', '説明', '比較', '분석', '설명', '비교']
const wantsAnalysis = (text: string) => { const lower = text.toLocaleLowerCase(); return ANALYSIS_WORDS.some((word) => lower.includes(word)) }
const ACTION_ICONS: Record<AgentActionIcon, typeof Rainbow> = { bridge: Rainbow, gas: Fuel, swap: ArrowLeftRight, alert: BellRing, market: TrendingUp, portfolio: PieChart, wallet: Wallet, news: Newspaper, recover: RefreshCw }

function ActionButtons({ actions, onRun, compact = false }: { actions: readonly AgentAction[]; onRun: (action: AgentAction) => void; compact?: boolean }) {
  const [tr] = useT()
  if (!actions.length) return null
  return (
    <div className={compact ? 'space-y-2' : 'grid sm:grid-cols-2 gap-2 text-left'}>
      {actions.map((action) => {
        const Icon = ACTION_ICONS[action.icon]
        return (
          <button key={action.id} type="button" onClick={() => onRun(action)} data-action={action.id}
            className="group w-full min-w-0 flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-left hover:bg-white/[0.05] hover:border-neon-500/30 transition">
            <span className="mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-neon-500/10 text-neon-300 inline-flex items-center justify-center"><Icon size={14} /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-white group-hover:text-neon-200">{tr(action.title)}</span>
              {!compact && <span className={`block mt-0.5 text-[12px] leading-snug ${T.mute}`}>{tr(action.detail).replace('{n}', action.value ?? '')}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SourcesLine({ sources }: { sources: readonly ChatDataSource[] }) {
  const [tr, lang] = useT()
  const latest = sources.map((item) => item.observedAt).filter(Boolean).sort().pop()
  const time = latest ? new Date(latest).toLocaleTimeString(lang === 'en' ? 'en-US' : lang, { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <p className={`mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] ${T.mute}`}>
      <Database size={11} className="shrink-0" /> {tr('Sources')}:
      {sources.map((item) => <span key={item.source} className={`px-1.5 py-0.5 rounded-md border ${item.ok ? 'border-white/[0.08] bg-white/[0.03]' : 'border-amber-400/20 text-amber-200/80'}`}>{tr(item.source)}</span>)}
      {time && <span>· {time}</span>}
    </p>
  )
}

const L = (vi: boolean, en: string, viText: string) => (vi ? viText : en)

function AgentPriceChart({ chart }: { chart: ChatChart }) {
  const [, lang] = useT()
  const vi = lang === 'vi'
  const points = chart.points.map(([t, v]) => [t, v] as [number, number])
  const first = points[0]?.[1] ?? 0
  const last = points[points.length - 1]?.[1] ?? 0
  const change = first ? ((last - first) / first) * 100 : 0
  return (
    <figure className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3" data-agent-chart={chart.symbol}>
      <figcaption className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-semibold text-white">{chart.symbol} · {chart.timeRange.toUpperCase()}</span>
        <span className={`font-num ${T.sub}`}>{last.toLocaleString('en-US', { maximumFractionDigits: last >= 100 ? 2 : 6 })} {chart.currency} · {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span>
      </figcaption>
      <div className="mt-2"><AreaChart points={points} height={140} label={L(vi, `${chart.symbol} price, ${chart.timeRange}`, `Giá ${chart.symbol}, ${chart.timeRange}`)} /></div>
      <p className={`mt-1.5 text-[11px] ${T.mute}`}>{chart.source ?? 'CoinGecko'} · {L(vi, 'use arrow keys on the chart to read values', 'dùng phím mũi tên trên biểu đồ để đọc giá trị')}</p>
    </figure>
  )
}

function PlanCard({ msg, onStart, onReset }: { msg: Msg; onStart: (index: number) => void; onReset: (index: number) => void }) {
  const [, lang] = useT()
  const vi = lang === 'vi'
  const plan = msg.plan!
  const statuses = planStatuses(plan.done, plan.activeIndex, plan.failedIndex)
  const allDone = plan.done.every(Boolean)
  const label: Record<string, string> = vi
    ? { waiting: 'Chờ bước trước', ready: 'Sẵn sàng', active: 'Đang thực hiện', done: 'Đã xác nhận', failed: 'Chưa hoàn tất' }
    : { waiting: 'Waits for previous step', ready: 'Ready', active: 'In progress', done: 'Confirmed', failed: 'Not completed' }
  return (
    <div className="mt-2 rounded-xl border border-white/[0.08] bg-[#0e0e13] overflow-hidden" data-agent-plan>
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
        <ListOrdered size={13} className="text-neon-300" />
        <span className={`text-[11px] font-bold tracking-[0.12em] ${T.mute}`}>{L(vi, 'MULTI-STEP PLAN', 'KẾ HOẠCH NHIỀU BƯỚC')}</span>
      </div>
      <ol className="divide-y divide-white/[0.05]">
        {plan.steps.map((step, index) => {
          const status = statuses[index]
          return (
            <li key={index} className="px-4 py-3 flex items-center gap-3 text-[13px]" data-plan-step={index} data-plan-status={status}>
              <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${status === 'done' ? 'bg-neon-500 text-[#0b0b10]' : status === 'active' ? 'ring-1 ring-neon-400 text-neon-200' : 'ring-1 ring-white/10 text-[#8a8796]'}`}>{status === 'done' ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{describeStep(step, vi)}</span>
                <span className={`block text-[11.5px] ${T.mute}`}>{label[status]}</span>
              </span>
              {(status === 'ready' || status === 'failed') && (
                <Button size="sm" variant={status === 'ready' ? 'primary' : undefined} onClick={() => onStart(index)}>
                  {status === 'ready' ? <Play size={12} /> : <RotateCcw size={12} />} {status === 'ready' ? L(vi, `Prepare step ${index + 1}`, `Chuẩn bị bước ${index + 1}`) : L(vi, 'Try again', 'Thử lại')}
                </Button>
              )}
              {status === 'active' && <button type="button" onClick={() => onReset(index)} className={`text-[11.5px] underline ${T.mute} hover:text-white`}>{L(vi, 'Reset step', 'Đặt lại bước')}</button>}
            </li>
          )
        })}
      </ol>
      <p className={`px-4 py-2.5 border-t border-white/[0.05] text-[11.5px] ${T.mute}`}>
        {allDone ? L(vi, 'All steps confirmed on-chain.', 'Tất cả các bước đã được xác nhận trên chuỗi.') : L(vi, 'Each step gets its own review and wallet signature. The next step opens only after the previous one is confirmed on-chain in this chat.', 'Mỗi bước có thẻ duyệt và chữ ký ví riêng. Bước sau chỉ mở khi bước trước đã được xác nhận trên chuỗi ngay trong khung chat này.')}
      </p>
    </div>
  )
}

function MemoryReplyLines({ msg, onUndoNote, onSaveContact, onDismissContact }: { msg: Msg; onUndoNote: (id: string) => void; onSaveContact: (offer: ContactOffer) => void; onDismissContact: (offer: ContactOffer) => void }) {
  const [, lang] = useT()
  const vi = lang === 'vi'
  return (
    <div className="mt-2 space-y-1.5">
      {msg.memoryNotes?.map((note) => (
        <p key={note.id} className={`flex items-center gap-2 text-[12px] ${T.sub}`} data-memory-note>
          <Brain size={13} className="text-neon-300 shrink-0" /> <span className="min-w-0">{L(vi, 'Remembered on this device:', 'Đã ghi nhớ trên thiết bị này:')} “{note.text}”</span>
          <button type="button" onClick={() => onUndoNote(note.id)} className={`shrink-0 underline ${T.mute} hover:text-white`}>{L(vi, 'Undo', 'Hoàn tác')}</button>
        </p>
      ))}
      {msg.contactOffers?.map((offer) => (
        <div key={offer.address} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] px-3 py-2 text-[12.5px]" data-contact-offer={offer.state}>
          <UserPlus size={14} className="text-neon-300 shrink-0" />
          <span className="min-w-0 flex-1"><b>{offer.name}</b> · <span className="font-mono text-[11.5px]">{short(offer.address)}</span></span>
          {offer.state === 'pending' && <>
            <Button size="sm" variant="primary" onClick={() => onSaveContact(offer)}>{L(vi, 'Save contact', 'Lưu danh bạ')}</Button>
            <button type="button" aria-label={L(vi, 'Dismiss', 'Bỏ qua')} onClick={() => onDismissContact(offer)} className={`p-1 rounded ${T.mute} hover:text-white`}><X size={14} /></button>
          </>}
          {offer.state === 'saved' && <span className="text-neon-300">{L(vi, 'Saved', 'Đã lưu')}</span>}
          {offer.state === 'duplicate' && <span className={T.mute}>{L(vi, 'Already in your contacts', 'Đã có trong danh bạ')}</span>}
          {offer.state === 'dismissed' && <span className={T.mute}>{L(vi, 'Not saved', 'Không lưu')}</span>}
        </div>
      ))}
    </div>
  )
}

function MemoryPanel({ notes, contacts, onRemove, onOpenContacts }: { notes: readonly AgentNote[]; contacts: number; onRemove: (id: string) => void; onOpenContacts: () => void }) {
  const [tr, lang] = useT()
  const vi = lang === 'vi'
  return (
    <Card className="p-4"><div data-memory-panel>
      <div className={`flex items-center justify-between text-[12px] font-semibold ${T.mute}`}>
        <span className="flex items-center gap-2"><Brain size={13} /> {L(vi, 'MEMORY', 'TRÍ NHỚ')}</span>
        <button onClick={onOpenContacts} className="text-[12px] text-neon-300 hover:text-neon-200">{tr('Contacts')} ({contacts})</button>
      </div>
      {notes.length ? (
        <ul className="mt-2 space-y-1.5">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 break-words">{note.text}</span>
              <button type="button" aria-label={L(vi, 'Forget', 'Quên')} onClick={() => onRemove(note.id)} className={`shrink-0 p-0.5 rounded ${T.mute} hover:text-rose-300`}><X size={13} /></button>
            </li>
          ))}
        </ul>
      ) : <p className={`mt-2 text-[12.5px] ${T.mute}`}>{L(vi, 'Say “remember that…” and Makoto keeps it on this device.', 'Nói “hãy nhớ là…” để Makoto ghi nhớ trên thiết bị này.')}</p>}
    </div></Card>
  )
}

function Stepper({ stage, compact = false }: { stage: number; compact?: boolean }) {
  const [tr] = useT()
  if (compact) return (
    <div className="flex items-center gap-2 text-[12px]" data-step={stage}>
      <div className="flex gap-0.5">{STEPS.map((_, i) => <span key={i} className={`h-1 w-3 rounded-full ${i < stage || (i === 3 && stage === 3) ? 'bg-neon-400' : i === stage ? 'bg-neon-300/60' : 'bg-white/10'}`} />)}</div>
      <span className={T.sub}>{tr('Step')} {Math.min(stage + 1, STEPS.length)} · {tr(STEPS[Math.min(stage, STEPS.length - 1)])}</span>
    </div>
  )
  return (
    <ol className="space-y-0" data-step={stage}>
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

function PreSignSummary({ flow }: { flow: Flow }) {
  const { contacts, network } = useWallet()
  const [, lang] = useT()
  const vi = lang === 'vi'
  const p = flow.params
  const contact = contacts.find((c) => c.address.toLowerCase() === p.recipient.toLowerCase())
  const who = contact ? `${contact.name} (${short(p.recipient)})` : short(p.recipient)
  const fee = network?.tokenTransferFeeUsdc ? ` ${vi ? 'Phí mạng khoảng' : 'Network fee about'} ${fmtAmt(network.tokenTransferFeeUsdc, 6)} USDC.` : ''
  const text = flow.intent === 'send'
    ? (vi ? `Bạn sắp gửi ${p.amount} ${p.asset} cho ${who} trên Arc Testnet.${fee} Giao dịch blockchain không thể hoàn tác.` : `You are about to send ${p.amount} ${p.asset} to ${who} on Arc Testnet.${fee} Blockchain transfers cannot be reversed.`)
    : flow.intent === 'swap'
      ? (vi ? `Bạn sắp đổi ${p.amount} ${p.asset} sang ${p.toAsset} trên Arc. Số nhận cuối cùng theo báo giá trực tiếp và mức trượt giá bạn chọn.` : `You are about to swap ${p.amount} ${p.asset} to ${p.toAsset} on Arc. The final amount follows the live quote and your slippage.`)
      : (vi ? `Bạn sắp chuyển ${p.amount} USDC từ Arc Testnet sang Base Sepolia qua Circle CCTP. Có thể cần 2 lần ký (phê duyệt và chuyển); tiền tới đích sau khi Circle xác nhận.` : `You are about to bridge ${p.amount} USDC from Arc Testnet to Base Sepolia via Circle CCTP. It may need 2 signatures (approval and transfer); funds arrive after Circle confirms.`)
  return <p data-presign-summary className="rounded-lg border border-neon-500/20 bg-neon-500/[0.05] px-3 py-2 text-[12.5px] leading-relaxed">{text}</p>
}

function ReviewCard({ msg, onChange, onSlipChange, onSpeedChange, onConfirm, onContinue, onHandoff, onEdit }: {
  msg: Msg; onChange: (p: Partial<Params>) => void
  onSlipChange: (s: SlipOption) => void; onSpeedChange: (s: CctpTransferSpeed) => void
  onConfirm: () => void; onContinue: () => void; onHandoff: () => void; onEdit: () => void
}) {
  const { holdings, contacts, activity, mode, walletChainId, notify } = useWallet()
  const [tr] = useT()
  const [switching, setSwitching] = useState(false)
  const wrongNetwork = mode === 'connected' && walletChainId !== undefined && walletChainId !== ARC.chainId
  const switchNetwork = async () => {
    const provider = getProvider()
    if (!provider || switching) return
    setSwitching(true)
    try { await ensureArcNetwork(provider); notify(tr('Switched to Arc Testnet')) }
    catch { notify(tr('Could not switch network. Open your wallet and choose Arc Testnet.'), 'err') }
    finally { setSwitching(false) }
  }
  const f = msg.flow!
  const p = f.params
  const locked = f.stage > 2
  const bal = holdings.find((h) => h.verified && h.symbol === p.asset)?.balance
  const amt = Number(p.amount) || 0
  const errs: string[] = []
  if (!(amt > 0)) errs.push('Enter an amount')
  if (f.intent === 'send' && !isAddress(p.recipient)) errs.push('Add a valid 0x recipient address')
  if (f.intent === 'swap' && p.toAsset === p.asset) errs.push('Choose a different asset to receive')
  if (f.intent === 'bridge' && p.dest !== 'Base Sepolia') errs.push('Only Arc Testnet → Base Sepolia is supported.')
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
          <span className={T.mute}>{tr('Source')}</span>
          <span className="h-9 flex items-center">{ARC.name}</span>
          <span className={T.mute}>{tr('Destination')}</span>
          <span id={`${msg.id}-dest`} className="h-9 flex items-center">Base Sepolia</span>
        </>}
        {f.intent !== 'bridge' && <>
          <span className={T.mute}>{tr('Network')}</span>
          <span className="h-9 flex items-center">Arc</span>
        </>}
      </div>
      {f.intent === 'send' && isAddress(p.recipient) && <div className="px-4 pb-3"><RecipientSafety recipient={p.recipient} contacts={contacts} activity={activity} /></div>}
      {wrongNetwork && f.session.stage !== 'HANDED_OFF' && (
        <div className="mx-4 mb-3 p-3 rounded-lg border border-amber-300/30 bg-amber-300/[0.06] text-[12.5px]" data-wrong-network>
          <p className="text-amber-200">{tr('Your wallet is on another network. Makoto actions run on Arc Testnet.')}</p>
          <Button size="sm" variant="primary" className="mt-2" disabled={switching} onClick={() => void switchNetwork()}>{switching ? '…' : tr('Switch to Arc Testnet')}</Button>
        </div>
      )}
      {!locked && (
        <div className="px-4 pb-4">
          {errs.length > 0 ? <p className={`mb-2.5 text-[12px] ${T.mute}`}>{tr(errs[0])}.</p>
            : bal != null && amt > bal ? <p className="mb-2.5 text-[12px] text-amber-200/90">{tr('Amount is above your {asset} balance').replace('{asset}', p.asset)} ({fmtAmt(bal)}).</p> : null}
          <Button variant="primary" className="w-full" disabled={errs.length > 0} onClick={onConfirm}>{tr('Confirm parameters')}</Button>
          <p className={`mt-2 text-[11.5px] text-center ${T.mute}`}>{tr('Confirms these values reflect what you intend. It does not approve or sign anything.')}</p>
        </div>
      )}
      {locked && (
        <div className="border-t border-white/[0.06] p-4 space-y-3">
          <PreSignSummary flow={f} />
          {/* Native execution — only available in connected mode */}
          {!f.execCard && f.session.stage !== 'HANDED_OFF' && (
            <div className="rounded-xl border border-neon-500/20 bg-neon-500/[0.05] p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-neon-300">
                <Zap size={13} /> {tr('Execute directly in chat')}
              </div>
              <p className={`text-[12px] ${T.mute}`}>
                {tr(f.intent === 'send'
                  ? 'Live review, then confirm transfer in your wallet — right here.'
                  : f.intent === 'swap'
                    ? 'Live quote from XyloNet, review, then confirm each step in your wallet — right here.'
                    : 'Live Circle quote, separate approval and burn confirmations — right here.')}
              </p>
              {/* Slippage selector (Swap only) — changing invalidates any mounted quote */}
              {f.intent === 'swap' && (
                <div className="flex items-center gap-2 text-[12px]">
                  <span className={T.mute}>{tr('Slippage')}:</span>
                  {(['0.5%', '1%', '3%'] as SlipOption[]).map((opt) => (
                    <button
                      key={opt}
                      aria-pressed={f.execSlip === opt || (!f.execSlip && opt === '0.5%')}
                      onClick={() => onSlipChange(opt)}
                      className={`px-2.5 py-1 rounded-lg border text-[11.5px] font-semibold transition ${(f.execSlip ?? '0.5%') === opt ? 'border-neon-400 bg-neon-500/10 text-neon-300' : `border-white/[0.08] ${T.mute} hover:text-white`}`}
                    >{opt}</button>
                  ))}
                </div>
              )}
              {/* Speed selector (Bridge only) — changing invalidates any mounted quote */}
              {f.intent === 'bridge' && (
                <div className="flex items-center gap-2 text-[12px]">
                  <span className={T.mute}>{tr('Speed')}:</span>
                  {(['FAST', 'SLOW'] as CctpTransferSpeed[]).map((opt) => (
                    <button
                      key={opt}
                      aria-pressed={f.execSpeed === opt || (!f.execSpeed && opt === 'FAST')}
                      onClick={() => onSpeedChange(opt)}
                      className={`px-2.5 py-1 rounded-lg border text-[11.5px] font-semibold transition ${(f.execSpeed ?? 'FAST') === opt ? 'border-neon-400 bg-neon-500/10 text-neon-300' : `border-white/[0.08] ${T.mute} hover:text-white`}`}
                    >{opt === 'FAST' ? tr('Fast') : tr('Standard')}</button>
                  ))}
                </div>
              )}
              <Button size="sm" variant="primary" className="w-full" onClick={onContinue}>
                <Zap size={13} />
                {tr(f.intent === 'send' ? 'Execute Send in chat' : f.intent === 'swap' ? 'Execute Swap in chat' : 'Execute Bridge in chat')}
              </Button>
            </div>
          )}
          {/* Handoff to dedicated page */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onEdit}><Pencil size={13} /> {tr('Edit parameters')}</Button>
            <Button size="sm" className="flex-1 min-w-[140px]" onClick={onHandoff}>
              {tr(f.intent === 'send' ? 'Open Send page' : f.intent === 'swap' ? 'Open Swap page' : 'Open Bridge page')}
            </Button>
          </div>
        </div>
      )}
      <div className="px-4 py-2 border-t border-white/[0.05] flex justify-end"><PreviewTag /></div>
    </div>
  )
}

function ContextPanel({ flow, actions = [], onAction = () => {}, memoryNotes, onRemoveNote = () => {} }: { flow?: Flow; actions?: readonly AgentAction[]; onAction?: (action: AgentAction) => void; memoryNotes?: readonly AgentNote[]; onRemoveNote?: (id: string) => void }) {
  const { mode, address, displayAddress, total, pricesReady, mask, holdings, network, networkError, tasks, go, contacts } = useWallet()
  const [tr, language] = useT()
  const locale = language === 'vi' ? 'vi' : 'en'
  const active = taskItemsForAccount(tasks, mode, address).filter((task) => task.status === 'ACTIVE')
  return (
    <div className="space-y-3">
      {flow && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3"><span className="text-[13px] font-semibold">{tr('Progress')}</span></div>
          <Stepper stage={flow.stage} />
          {flow.stage >= STEPS.length ? (
            <p className={`mt-3 text-[11.5px] ${T.mute}`}>{tr('Transaction complete')}</p>
          ) : !flow.execCard ? (
            <p className={`mt-3 text-[11.5px] ${T.mute}`}>{tr(flow.stage >= 3 ? 'The preview stops at Parameters confirmed. Later steps are shown for reference only.' : 'Waiting for you to review the parameters.')}</p>
          ) : null}
        </Card>
      )}
      {actions.length > 0 && (
        <Card className="p-4">
          <div className={`flex items-center gap-2 text-[12px] font-semibold ${T.mute} mb-2.5`}><Sparkles size={13} /> {tr('Suggested for you').toUpperCase()}</div>
          <ActionButtons actions={actions.slice(0, 3)} onRun={onAction} compact />
        </Card>
      )}
      <Card className="p-4">
        <div className={`flex items-center gap-2 text-[12px] font-semibold ${T.mute}`}><Wallet size={13} /> {tr('WALLET')}</div>
        <div className="mt-2 flex items-center justify-between text-[13px]"><span className="font-mono">{short(displayAddress)}</span><Badge>{tr(mode === 'demo' ? 'Demo' : mode === 'watch' ? 'Watch-only' : 'Connected')}</Badge></div>
        <div className="mt-1 text-[20px] font-bold font-num">{pricesReady ? mask(usd(total)) : '—'}</div>
        <div className={`text-[11px] ${T.mute}`}>{mode === 'demo' ? tr('Sample data') : 'ArcScan'}</div>
        <div className="mt-2 space-y-1.5">
          {holdings.filter((h) => h.verified).slice(0, 3).map((h) => (
            <div key={h.symbol} className="flex items-center gap-2 text-[12.5px]"><TokenIcon color={h.color} glyph={h.glyph} size={18} /><span>{h.symbol}</span><span className={`ml-auto font-num ${T.sub}`}>{mask(fmtAmt(h.balance, h.decimals))}</span></div>
          ))}
        </div>
      </Card>
      {memoryNotes && <MemoryPanel notes={memoryNotes} contacts={contacts.length} onRemove={onRemoveNote} onOpenContacts={() => go('settings')} />}
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
  const chatHistory = useRef<ChatHistoryItem[]>([])
  const current = [...msgs].reverse().find((m) => m.flow)?.flow
  const locale = lang === 'vi' ? 'vi' : 'en'
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  const agentActions = buildAgentActions({
    mode: w.mode, walletChainId: w.walletChainId, balancesReady: !w.loading && !w.walletError,
    balances: Object.fromEntries(w.holdings.filter((h) => h.verified).map((h) => [h.symbol, h.balance])),
    activeTasks: taskItemsForAccount(w.tasks, w.mode, w.address).filter((task) => task.status === 'ACTIVE').length,
    pendingBridge: hasPendingStrategy(storage, 'cctp', w.mode === 'connected' ? w.address : undefined),
    pendingSwap: hasPendingStrategy(storage, 'swap', w.mode === 'connected' ? w.address : undefined),
  })
  const [memory, setMemory] = useState<AgentMemory>(() => loadAgentMemory(storage))
  const memoryRef = useRef(memory)
  memoryRef.current = memory
  const updateMemory = (fn: (current: AgentMemory) => AgentMemory) => {
    const next = fn(memoryRef.current)
    memoryRef.current = next
    setMemory(next)
    saveAgentMemory(typeof localStorage === 'undefined' ? undefined : localStorage, next)
  }
  const requestMemory = () => memoryForRequest(memoryRef.current, w.contacts)
  // Conversation history is kept on this device per wallet. Only text is restored:
  // review cards, plans and tasks are never restored, so nothing old can be executed.
  const chatKey = `mk.agent.chat.v1:${w.mode === 'demo' || !w.address ? 'demo' : w.address.toLowerCase()}`
  const loadedChatKey = useRef('')
  const [savedChat, setSavedChat] = useState<Msg[]>([])
  // Saved history is offered, never auto-shown: the welcome screen and suggestions stay first.
  useEffect(() => {
    if (loadedChatKey.current === chatKey || typeof localStorage === 'undefined') return
    loadedChatKey.current = chatKey
    try {
      const saved = JSON.parse(localStorage.getItem(chatKey) ?? '[]') as Msg[]
      const restored = Array.isArray(saved) ? saved.filter((m) => m && (m.role === 'user' || m.role === 'agent') && typeof m.text === 'string' && m.text.trim()).slice(-30)
        .map((m) => ({ id: nid(), role: m.role, text: m.text, ...(m.role === 'agent' ? { source: 'REAL_PROVIDER' as const, conversation: true } : {}), ...(m.dataSources ? { dataSources: m.dataSources } : {}), ...(m.charts ? { charts: m.charts } : {}) }) as Msg) : []
      setSavedChat(restored)
    } catch { setSavedChat([]) }
  }, [chatKey])
  const restoreChat = () => {
    if (!savedChat.length) return
    setMsgs(savedChat)
    chatHistory.current = savedChat.slice(-12).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 600) }))
    setSavedChat([])
  }
  useEffect(() => {
    // Nothing new to save until the user chats (or restores); never overwrite an offered history with an empty view.
    if (typeof localStorage === 'undefined' || loadedChatKey.current !== chatKey || (!msgs.length && savedChat.length)) return
    const keep = msgs.filter((m) => !m.streaming && m.text?.trim() && !m.task && !m.taskReply && !m.quick)
      .map((m) => ({ role: m.role, text: m.role === 'agent' && m.source !== 'REAL_PROVIDER' ? tr(m.text) : m.text, ...(m.dataSources ? { dataSources: m.dataSources } : {}), ...(m.charts ? { charts: m.charts } : {}) }))
      .slice(-30)
    try { if (keep.length) localStorage.setItem(chatKey, JSON.stringify(keep)); else localStorage.removeItem(chatKey) } catch { /* Storage full or blocked. */ }
  }, [msgs, chatKey, tr, savedChat.length])
  // Voice input (browser speech recognition, where available).
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const speechCtor = typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition) : undefined
  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); return }
    if (!speechCtor) return
    const recognition = new speechCtor() as { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }
    recognition.lang = lang === 'vi' ? 'vi-VN' : 'en-US'
    recognition.interimResults = true
    recognition.onresult = (event) => setInput(Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ').trim())
    recognition.onend = () => { setListening(false); recognitionRef.current = null }
    recognition.onerror = () => { setListening(false); recognitionRef.current = null }
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }
  const messageText = (message: Msg) => {
    if (message.quick) return renderHomeAnswer(message.quick, locale, w.mask, w).text
    if (message.taskReply?.kind === 'COPY') return taskText(message.taskReply.key, locale)
    if (message.taskReply?.kind === 'ERROR') return taskError(message.taskReply.code, locale)
    if (message.taskReply?.kind === 'REVIEW') return locale === 'vi' ? 'Hãy xem lại định nghĩa trước khi tạo nhiệm vụ nền.' : 'Review the definition before creating a background task.'
    if (message.datetime) return `${locale === 'vi' ? 'Hiện tại là' : 'It is'} ${formatCurrentDateTime(message.datetime, locale)}.`
    if (message.localChatTopic) return lang === 'vi' ? localChatReply(message.localChatTopic, 'vi', true) : tr(localChatReply(message.localChatTopic, 'en', true))
    if (message.source === 'REAL_PROVIDER') return message.text
    return tr(message.text)
  }
  const taskMissingFieldLabel = (field: string) => ({
    asset: tr('Asset'), operator: locale === 'vi' ? 'Điều kiện so sánh' : 'Comparison',
    threshold: taskText('threshold', locale), time: taskText('time', locale),
    action: locale === 'vi' ? 'Nội dung tóm tắt' : 'Summary type', recurrence: locale === 'vi' ? 'Chu kỳ' : 'Recurrence',
  } as Record<string, string>)[field] ?? field
  const messageRows = (message: Msg): readonly [string, string][] => {
    if (message.quick) return renderHomeAnswer(message.quick, locale, w.mask, w).rows
    if (message.taskMissingFields) return message.taskMissingFields.map((field) => [taskText('missing', locale), taskMissingFieldLabel(field)])
    const rows: [string, string][] = message.strategyKinds ? message.strategyKinds.map((kind, index) => [`${index + 1}. ${tr(cap(kind.toLowerCase()))}`, index ? tr('After step {n} is confirmed and checked again.').replace('{n}', String(index)) : tr('First step')]) : (message.rows ?? []).map(([label, value]) => [tr(label), tr(value)])
    if (message.liveEvidence) {
      const evidence = message.liveEvidence
      rows.push([tr('Live evidence'), `${tr(agentStatusLabel(evidence.status))}: ${tr(evidence.reason === 'Chain changed' ? 'Wallet is not on Arc Testnet' : evidence.reason)}`])
      if (evidence.quoteExpiresAt) rows.push([tr('Quote expires'), new Date(evidence.quoteExpiresAt).toLocaleTimeString(locale === 'vi' ? 'vi-VN' : 'en-US')])
    }
    return rows
  }

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
  const BASE_PARAMS: Params = { asset: 'USDC', amount: '', recipient: '', toAsset: 'EURC', dest: 'Base Sepolia' }
  const makeFlowMsg = (intent: Intent, params: Params, text: string, liveEvidence?: Msg['liveEvidence']): Msg => {
    const requested = createAgentSession(nid())
    const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: nid(), now: Date.now() })
    if (planned.accepted && w.mode === 'connected' && w.address && typeof sessionStorage !== 'undefined') rememberAgentSession(sessionStorage, planned.state, w.address)
    const execSpeed = intent === 'bridge' ? memoryRef.current.preferences.bridgeSpeed : undefined
    return { id: nid(), role: 'agent', text, liveEvidence, flow: { intent, params, stage: 2, session: planned.accepted ? planned.state : requested, ...(execSpeed ? { execSpeed } : {}) }, sample: false }
  }
  /**
   * An untrusted step (model proposal or plan step) becomes a review card only after it is
   * rebuilt as a canonical command (contacts resolved on this device) and re-parsed by the
   * deterministic planner. Returns an explanatory message when that is not possible.
   */
  const actionMessageFromStep = async (step: PlanStep, text: string, extra: Partial<Msg> = {}): Promise<Msg> => {
    const vi = lang === 'vi'
    const built = stepCommand(step, w.contacts)
    if (!built.ok) {
      const note = built.reason === 'contact-ambiguous'
        ? (vi ? `Có nhiều liên hệ tên “${built.name}”. Hãy dùng địa chỉ 0x đầy đủ.` : `Several contacts are named “${built.name}”. Use the full 0x address.`)
        : (vi ? `Không tìm thấy “${built.name}” trong danh bạ trên thiết bị này. Hãy thêm liên hệ trong Cài đặt hoặc dùng địa chỉ 0x đầy đủ.` : `“${built.name}” is not in the contacts on this device. Add the contact in Settings or use the full 0x address.`)
      return { id: nid(), role: 'agent', text: text ? `${text}\n\n${note}` : note, link: { label: 'Open Settings', page: 'settings' }, source: 'REAL_PROVIDER', conversation: true, ...extra }
    }
    const checked = planBrainRequest(built.command, 'en', brainContext())
    const a = checked.action
    if (!a || a.kind !== step.kind || checked.decision.blockers.length || checked.decision.missingFields.length) {
      const rows: [string, string][] = [
        ...checked.decision.missingFields.map((field) => ['Missing', agentFieldLabel(field)] as [string, string]),
        ...checked.decision.blockers.map((reason) => ['Blocked', reason] as [string, string]),
      ]
      return { id: nid(), role: 'agent', text: `${text}\n\n${tr('Makoto could not prepare this action safely.')}`, rows, source: 'REAL_PROVIDER', conversation: true, ...extra }
    }
    let liveEvidence: Msg['liveEvidence']
    if (w.mode === 'connected') {
      const commandPlan = planAgentRequest(built.command, 'en')
      if (commandPlan.status === 'ACTION') {
        const observed = await withRpcTimeout(replanAgentFromEvidence(commandPlan, getProvider(), w.address), AGENT_EVIDENCE_TIMEOUT_MS, 'Agent evidence preflight')
          .catch((e): AgentEvidence => ({ status: 'UNAVAILABLE', reason: e instanceof Error ? e.message : 'Live evidence unavailable', observedAt: Date.now(), executionEnabled: false }))
        liveEvidence = { status: observed.status, reason: observed.reason, quoteExpiresAt: observed.quoteExpiresAt }
      }
    }
    const params: Params = a.kind === 'send' ? { ...BASE_PARAMS, asset: a.asset ?? 'USDC', amount: a.amount ?? '', recipient: a.recipient ?? '' }
      : a.kind === 'swap' ? { ...BASE_PARAMS, asset: a.asset ?? 'USDC', amount: a.amount ?? '', toAsset: a.outputAsset ?? 'EURC' }
        : { ...BASE_PARAMS, asset: 'USDC', amount: a.amount ?? '', dest: a.destinationChain ?? 'Base Sepolia' }
    const flowText = built.contactName ? `${text}${text ? '\n\n' : ''}${vi ? `Người nhận: ${built.contactName} (danh bạ trên thiết bị này).` : `Recipient: ${built.contactName} (contacts on this device).`}` : text
    return { ...makeFlowMsg(a.kind, params, flowText, liveEvidence), source: 'REAL_PROVIDER', conversation: true, aiProposal: true, ...extra }
  }
  /** Applies memory changes from a reply: notes are saved on the device, contacts wait for a click. */
  const applyMemoryUpdates = (updates: readonly ChatMemoryUpdate[] | undefined): Partial<Msg> => {
    if (!updates?.length) return {}
    const notes: AgentNote[] = []
    const offers: ContactOffer[] = []
    for (const update of updates) {
      if (update.type === 'note') {
        let saved: AgentNote | undefined
        updateMemory((current) => { const result = addNote(current, update.note); saved = result.note; return result.memory })
        if (saved) notes.push(saved)
      } else {
        const check = contactSaveCheck(update.name, update.address, w.contacts)
        if (check !== 'invalid') offers.push({ name: update.name, address: update.address, state: check === 'ok' || check === 'duplicate-name' ? 'pending' : 'duplicate' })
      }
    }
    return { ...(notes.length ? { memoryNotes: notes } : {}), ...(offers.length ? { contactOffers: offers } : {}) }
  }
  /** The AI drafted an alert/daily task: show the confirm card; nothing runs until the user clicks Create. */
  const taskMessageFromDraft = (draft: ChatTaskDraft, text: string, extra: Partial<Msg>): Msg => {
    const vi = lang === 'vi'
    const base: Msg = { id: nid(), role: 'agent', text, sample: false, conversation: true, source: 'REAL_PROVIDER', ...extra }
    const binding = taskBinding({ mode: w.mode, address: w.address, walletChainId: w.walletChainId })
    if (!binding.ok) return { ...base, text: `${text}\n\n${taskText(binding.reason === 'CHAIN_REQUIRED' ? 'chainFirst' : 'connectFirst', vi ? 'vi' : 'en')}` }
    if (!w.taskAuthenticated) return { ...base, text: `${text}\n\n${taskText('verifyWallet', vi ? 'vi' : 'en')}`, link: { label: '', taskTextKey: 'verifyWallet', page: 'tasks' } }
    const label = draft.type === 'CONDITION_MONITOR' ? `${draft.condition.asset} ${draft.condition.metric === 'TOKEN_PRICE' ? 'price' : 'balance'} ${draft.condition.operator} ${draft.condition.threshold}` : `${draft.schedule.action} ${draft.schedule.time}`
    const candidate: TaskCandidate = { ...draft, title: label, description: label, sourceIntent: label, account: binding.account, chainId: binding.chainId, timezone: binding.timezone, locale: vi ? 'vi' : 'en', authority: 'NOTIFY_ONLY', createdBy: 'AGENT' }
    return { ...base, task: candidate }
  }
  const plan = async (q: string, history: readonly ChatHistoryItem[], forcedTaskMode?: 'monitor' | 'automation' | null, onStream?: (partial: { text: string; toolStatus?: string }) => void, signal?: AbortSignal, image?: string): Promise<Msg> => {
    const locale = lang === 'vi' ? 'vi' : 'en'
    const taskMode = image ? forcedTaskMode : forcedTaskMode ?? taskIntentMode(q)
    if (taskMode) {
      const binding = taskBinding({ mode: w.mode, address: w.address, walletChainId: w.walletChainId })
      if (!binding.ok) return { id: nid(), role: 'agent', text: '', taskReply: { kind: 'COPY', key: binding.reason === 'CHAIN_REQUIRED' ? 'chainFirst' : 'connectFirst' } }
      if (!w.taskAuthenticated) return { id: nid(), role: 'agent', text: '', taskReply: { kind: 'COPY', key: 'verifyWallet' }, link: { label: '', taskTextKey: 'verifyWallet', page: 'tasks' } }
      try {
        const parsed = await taskApi.parse({ text: q, mode: taskMode, account: binding.account, chainId: binding.chainId, timezone: binding.timezone, locale })
        if (parsed.blocked?.code === 'TASK_WRITE_REQUIRES_USER') return { id: nid(), role: 'agent', text: '', taskReply: { kind: 'COPY', key: 'writeBoundary' } }
        if (parsed.candidate) return { id: nid(), role: 'agent', text: '', taskReply: { kind: 'REVIEW' }, task: { ...parsed.candidate, createdBy: 'AGENT' } }
        // Loosely phrased ("báo mình khi BTC rớt 10%"): the AI reads prices and drafts the card.
        if (forcedTaskMode) return { id: nid(), role: 'agent', text: '', taskReply: { kind: 'COPY', key: 'unsupported' }, taskMissingFields: parsed.missingFields }
      } catch (cause) { return { id: nid(), role: 'agent', text: '', taskReply: { kind: 'ERROR', code: cause instanceof Error ? cause.message : String(cause ?? '') } } }
    }
    const contextualWallet = !image && isWalletContextFollowUp(q, history, locale)
    const quickRequest = routeHomeRequest(contextualWallet ? 'What is my balance?' : q, locale)
    if (!image && quickRequest.route === 'INLINE' && !wantsAnalysis(q)) {
      const quick = await readHomeAnswer(quickRequest, w)
      return { id: nid(), role: 'agent', text: renderHomeAnswer(quick, locale, w.mask).text, quick, conversation: true, source: 'DETERMINISTIC_TOOL' }
    }
    const routed = contextualWallet ? routeAgentMessage('What is my balance?', locale) : routeAgentMessage(q, locale)
    const structured = contextualWallet ? routed.plan : planAgentRequest(q, lang === 'vi' ? 'vi' : 'en')
    const brain = planBrainRequest(contextualWallet ? 'What is my balance?' : q, lang, brainContext())
    const base: Params = { asset: 'USDC', amount: '', recipient: '', toAsset: 'EURC', dest: 'Base Sepolia' }
    // Filled by the live-evidence preflight below; flows created afterwards carry it.
    const evidence: { value?: Msg['liveEvidence'] } = {}
    const flow = (intent: Intent, params: Params, text: string): Msg => makeFlowMsg(intent, params, text, evidence.value)
    // "send 2 USDC to Nam": a saved contact named in the request is resolved on this device,
    // deterministically, before any model call. The address never leaves the browser.
    if (!contextualWallet && brain.action?.kind === 'send' && !brain.action.recipient && !brain.action.maxRequested && brain.action.amount && brain.action.asset
      && brain.decision.missingFields.every((field) => field === 'recipient') && !brain.decision.blockers.length) {
      const contact = contactInText(q, w.contacts)
      if (contact) return actionMessageFromStep({ kind: 'send', asset: brain.action.asset as PlanStep['asset'], amount: brain.action.amount, recipientContact: contact.name }, lang === 'vi' ? 'Mình đã chuẩn bị lệnh gửi theo danh bạ của bạn.' : 'I prepared the transfer using your contacts.')
    }
    // Tool-using AI first for questions, analysis and loosely phrased requests. Complete
    // deterministic actions, strategies and the clock stay on the proven local path.
    const deterministicAction = !image && (structured.status === 'STRATEGY'
      || (structured.status === 'INFORMATION' && structured.topic === 'current-datetime')
      || (routed.category === 'ACTION' && Boolean(brain.action) && !brain.decision.blockers.length && !brain.decision.missingFields.length))
    let aiUnavailable = false
    if (!deterministicAction) {
      let streamed = ''
      let toolStatus: string | undefined
      const response = await requestMakotoChatStream({
        message: q, topic: routed.topic, history,
        context: { locale: lang, mode: w.mode, ...(w.mode === 'connected' ? { chain: ARC.name as 'Arc Testnet' } : {}), intent: routed.category === 'CHAT' ? 'CHAT' : 'INFORMATION' },
        address: w.mode !== 'demo' ? w.address : undefined,
        memory: requestMemory(),
        ...(image ? { image } : {}),
        signal,
        onEvent: (event) => {
          if (event.type === 'delta') streamed += event.text
          else toolStatus = event.source ?? event.tool
          onStream?.({ text: visibleStreamText(streamed), toolStatus })
        },
      })
      if (!response.ok && response.aborted) {
        const partial = visibleStreamText(streamed)
        return { id: nid(), role: 'agent', text: partial ? `${partial}\n\n_${lang === 'vi' ? 'Đã dừng.' : 'Stopped.'}_` : (lang === 'vi' ? 'Đã dừng.' : 'Stopped.'), source: 'REAL_PROVIDER', conversation: Boolean(partial), stopped: true, question: q }
      }
      if (response.ok) {
        const extra: Partial<Msg> = { dataSources: response.sources, question: q, ...(response.followups ? { followups: response.followups } : {}), ...(response.charts ? { charts: response.charts } : {}), ...applyMemoryUpdates(response.memory) }
        if (response.plan) return { id: nid(), role: 'agent', text: response.text, sample: false, conversation: true, source: 'REAL_PROVIDER', plan: { steps: response.plan, done: response.plan.map(() => false) }, ...extra }
        if (response.proposal) return actionMessageFromStep(response.proposal, response.text, extra)
        if (response.task) return taskMessageFromDraft(response.task, response.text, extra)
        return { id: nid(), role: 'agent', text: response.text, sample: false, conversation: true, source: 'REAL_PROVIDER', ...extra }
      }
      aiUnavailable = true
      if (image) return { id: nid(), role: 'agent', text: lang === 'vi' ? 'Mình chưa đọc được ảnh lúc này. Bạn thử lại sau ít phút nhé.' : 'I could not read the image right now. Please try again in a few minutes.', source: 'REAL_PROVIDER', conversation: true, question: q }
    }
    const chat = async (topic: typeof routed.topic, intent: 'CHAT' | 'INFORMATION', toolResult?: unknown, fallback?: string) => {
      if (aiUnavailable) return { text: fallback || localChatReply(topic, locale, true), source: 'LOCAL_FALLBACK' as const }
      const response = await requestMakotoChat({ message: q, topic, context: { locale: lang, mode: w.mode, ...(w.mode === 'connected' ? { chain: ARC.name as 'Arc Testnet' } : {}), intent, toolResult }, history, address: w.mode !== 'demo' ? w.address : undefined, memory: requestMemory() })
      return response.ok ? { text: response.text, source: response.source } : { text: fallback || localChatReply(topic, locale, true), source: 'LOCAL_FALLBACK' as const }
    }
    if (routed.category === 'CHAT') {
      const answer = await chat(routed.topic, 'CHAT')
      return { id: nid(), role: 'agent', text: answer.text, sample: false, conversation: true, source: answer.source, ...(answer.source === 'LOCAL_FALLBACK' ? { localChatTopic: routed.topic } : {}) }
    }
    const evidencePromise = w.mode === 'connected' && (structured.status === 'ACTION' || structured.status === 'STRATEGY')
      ? replanAgentFromEvidence(structured, getProvider(), w.address)
      : undefined
    const observed: AgentEvidence | undefined = evidencePromise
      ? await withRpcTimeout(evidencePromise, AGENT_EVIDENCE_TIMEOUT_MS, 'Agent evidence preflight').catch(
          (e): AgentEvidence => ({ status: 'UNAVAILABLE', reason: e instanceof Error ? e.message : 'Live evidence unavailable', observedAt: Date.now(), executionEnabled: false })
        )
      : undefined
    evidence.value = observed ? { status: observed.status, reason: observed.reason, quoteExpiresAt: observed.quoteExpiresAt } : undefined
    const liveEvidence = evidence.value
    if (structured.status === 'INFORMATION' && structured.topic === 'current-datetime') {
      const currentTime = getCurrentDateTime()
      const rendered = formatCurrentDateTime(currentTime, locale)
      return { id: nid(), role: 'agent', text: locale === 'vi' ? `Hi\u1ec7n t\u1ea1i l\u00e0 ${rendered}.` : `It is ${rendered}.`, datetime: currentTime, conversation: true, source: 'DETERMINISTIC_TOOL' }
    }
    if (structured.status === 'STRATEGY') {
      const steps = planStepsFromText(q, locale)
      if (steps) return { id: nid(), role: 'agent', text: lang === 'vi' ? 'Mình đã chia yêu cầu thành các bước. Mỗi bước có thẻ duyệt và chữ ký ví riêng.' : 'I split your request into steps. Each step gets its own review and wallet signature.', source: 'REAL_PROVIDER', conversation: true, plan: { steps, done: steps.map(() => false) } }
      return { id: nid(), role: 'agent', text: 'This is a structured sequential plan for review only. Each action needs fresh reads, policy review, its own wallet confirmation and receipt before the next step.', strategyKinds: structured.intents.map((intent) => intent.kind), liveEvidence }
    }
    if (q.toLowerCase().match(/\b(?:and then|then|sau đó|rồi)\b/)) return { id: nid(), role: 'agent', text: 'I cannot safely prepare this sequence yet.', rows: 'reasons' in structured ? structured.reasons.map((reason) => ['Missing', reason]) : [] }
    if (brain.action) {
      const a = brain.action
      if (brain.decision.blockers.length || brain.decision.missingFields.length) {
        const rows: [string, string][] = [
          ...brain.decision.missingFields.map((field) => ['Missing', agentFieldLabel(field)] as [string, string]),
          ...brain.decision.blockers.map((reason) => ['Blocked', reason] as [string, string]),
        ]
        return { id: nid(), role: 'agent', text: 'I need a little more information before I can prepare this safely.', rows }
      }
      if (a.kind === 'send') return flow('send', { ...base, asset: a.asset ?? 'USDC', amount: a.amount ?? '', recipient: a.recipient ?? '' }, 'I parsed the transfer locally. Review the parameters before anything reaches your wallet.')
      if (a.kind === 'swap') return flow('swap', { ...base, asset: a.asset ?? 'USDC', amount: a.amount ?? '', toAsset: a.outputAsset ?? 'EURC' }, 'I parsed the swap locally. A fresh quote and safety revalidation are still required before wallet confirmation.')
      if ((a.sourceChain && a.sourceChain !== ARC.name) || (a.destinationChain && a.destinationChain !== 'Base Sepolia')) return { id: nid(), role: 'agent', text: 'Only Arc Testnet → Base Sepolia is supported.' }
      return flow('bridge', { ...base, asset: a.asset ?? 'USDC', amount: a.amount ?? '', dest: a.destinationChain ?? 'Base Sepolia' }, 'I parsed the bridge locally. Source submission and destination completion remain separate states.')
    }
    if (brain.intent.kind === 'safety-capabilities') return { id: nid(), role: 'agent', text: 'Makoto prepares actions but never signs for you. Every write must be reviewed again immediately before the connected wallet is opened.', rows: [['Policy', 'Prepare-only Agent'], ['Signing', 'User wallet only'], ['Revalidation', 'Required before wallet request'], ['Bridge completion', 'Destination evidence required']] }
    const sc = pickScenario(q)
    switch (sc.kind) {
      case 'send': return flow('send', { ...base, asset: sc.asset, amount: sc.amount, recipient: sc.recipient }, 'I found the details. Review the parameters before continuing.')
      case 'swap': return flow('swap', { ...base, asset: sc.asset, amount: sc.amount, toAsset: sc.toAsset }, 'I found the details. Review the parameters before continuing. Any price shown later is a preview estimate, not a quote.')
      case 'bridge': return flow('bridge', { ...base, asset: 'USDC', amount: sc.amount, dest: sc.dest }, 'I found the details. Review the parameters before continuing.')
      case 'portfolio': {
        const v = w.holdings.filter((h) => h.verified && h.balance > 0)
        return { id: nid(), role: 'agent', text: `${tr('Your assets on {network} are worth {value}').replace('{network}', ARC.name).replace('{value}', w.pricesReady ? w.mask(usd(w.total)) : `— (${tr('prices unavailable')})`)}${w.mode === 'demo' ? ` — ${tr('sample demo data')}` : ''}.`, rows: v.map((h) => [h.symbol, w.mask(`${fmtAmt(h.balance, h.decimals)} · ${w.pricesReady && h.value != null ? usd(h.value) : '—'}`)] as [string, string]), link: { label: tr('Open Portfolio'), page: 'dashboard' } }
      }
      case 'activity': {
        const r = w.activity.slice(0, 4)
        return { id: nid(), role: 'agent', text: r.length ? `${tr('Your last {n} transactions').replace('{n}', String(r.length))}${w.mode === 'demo' ? ` (${tr('sample data')})` : ''}:` : tr('No activity yet.'), rows: r.map((a) => [`${tr(cap(a.kind ?? a.direction))} ${a.symbol}`, `${fmtAmt(a.amount)} · ${tr(agentStatusLabel(a.status ?? 'completed'))}`] as [string, string]), link: { label: tr('Open Activity'), page: 'activity' } }
      }
      default:
        return { id: nid(), role: 'agent', text: lang === 'vi'
          ? 'Makoto có thể đọc thông tin ví, tạo nhiệm vụ theo dõi và tóm tắt, hoặc chuẩn bị giao dịch để bạn xem lại. Hãy thử một gợi ý bên dưới.'
          : 'Makoto can read wallet information, create monitoring and summary tasks, or prepare a transaction for your review. Try a suggestion below.' }
    }
  }

  const abortRef = useRef<AbortController | null>(null)
  const [attachment, setAttachment] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attachImage = async (file: Blob | null | undefined) => {
    if (!file) return
    try { setAttachment(await compressImage(file)) }
    catch (cause) {
      const tooLarge = cause instanceof Error && cause.message === 'IMAGE_TOO_LARGE'
      w.notify(lang === 'vi' ? (tooLarge ? 'Ảnh quá lớn, bạn thử ảnh nhỏ hơn nhé.' : 'Không đọc được ảnh này. Hãy dùng ảnh PNG hoặc JPG.') : (tooLarge ? 'Image is too large. Try a smaller one.' : 'Could not read this image. Use a PNG or JPG.'), 'err')
    }
  }
  const stop = () => abortRef.current?.abort()
  const ask = (rawQ: string, forcedTaskMode?: 'monitor' | 'automation' | null) => {
    const image = attachment ?? undefined
    const q = rawQ.trim() || (image ? (lang === 'vi' ? 'Đọc giúp mình ảnh này.' : 'Please read this image.') : '')
    if (!q || abortRef.current) return
    setAttachment(null)
    const controller = new AbortController()
    abortRef.current = controller
    const history = chatHistory.current
    chatHistory.current = appendChatHistory(history, { role: 'user', content: q })
    setMsgs((m) => [...m, { id: nid(), role: 'user', text: q, ...(image ? { image } : {}) }])
    setInput('')
    setTyping(true)
    const streamId = nid()
    const onStream = ({ text, toolStatus }: { text: string; toolStatus?: string }) => setMsgs((m) => {
      const placeholder: Msg = { id: streamId, role: 'agent', text, source: 'REAL_PROVIDER', streaming: true, toolStatus }
      return m.some((x) => x.id === streamId) ? m.map((x) => x.id === streamId ? placeholder : x) : [...m, placeholder]
    })
    const finish = (answer: Msg) => {
      if (abortRef.current === controller) abortRef.current = null
      setMsgs((m) => [...m.filter((x) => x.id !== streamId), answer])
      setTyping(false)
    }
    setTimeout(() => {
      void plan(q, history, forcedTaskMode, onStream, controller.signal, image).then((answer) => {
        if (answer.conversation) chatHistory.current = appendChatHistory(chatHistory.current, { role: 'assistant', content: answer.text })
        finish(answer)
      }).catch(() => {
        const answer: Msg = { id: nid(), role: 'agent', text: 'Live data is unavailable. Please try again.', conversation: true, source: 'LOCAL_FALLBACK' }
        chatHistory.current = appendChatHistory(chatHistory.current, { role: 'assistant', content: tr(answer.text) })
        finish(answer)
      })
    }, 150)
  }
  const runAction = (action: AgentAction) => {
    if (typing) return
    if (action.target.type === 'go') w.go(action.target.page)
    else ask(tr(action.target.prompt))
  }
  const patchPlan = (planId: string, fn: (plan: PlanState) => PlanState) => setMsgs((m) => m.map((x) => x.id === planId && x.plan ? { ...x, plan: fn(x.plan) } : x))
  const startPlanStep = async (planId: string, index: number) => {
    const owner = msgs.find((x) => x.id === planId)
    const step = owner?.plan?.steps[index]
    if (!owner?.plan || !step || owner.plan.activeIndex !== undefined || owner.plan.done.slice(0, index).some((value) => !value)) return
    patchPlan(planId, (plan) => ({ ...plan, activeIndex: index, failedIndex: undefined }))
    const vi = lang === 'vi'
    const answer = await actionMessageFromStep(step, vi ? `Bước ${index + 1}/${owner.plan.steps.length}: ${describeStep(step, true)}.` : `Step ${index + 1}/${owner.plan.steps.length}: ${describeStep(step, false)}.`, { planRef: { planId, index } })
    if (!answer.flow) patchPlan(planId, (plan) => ({ ...plan, activeIndex: undefined, failedIndex: index }))
    setMsgs((m) => [...m, answer])
  }
  const resetPlanStep = (planId: string, index: number) => patchPlan(planId, (plan) => plan.activeIndex === index ? { ...plan, activeIndex: undefined, failedIndex: index } : plan)
  const setOffer = (msgId: string, address: string, state: ContactOffer['state']) => setMsgs((m) => m.map((x) => x.id === msgId && x.contactOffers ? { ...x, contactOffers: x.contactOffers.map((o) => o.address === address ? { ...o, state } : o) } : x))
  const saveOffer = (msgId: string, offer: ContactOffer) => {
    const check = contactSaveCheck(offer.name, offer.address, w.contacts)
    if (check === 'invalid') return
    if (check === 'duplicate-address') { setOffer(msgId, offer.address, 'duplicate'); return }
    const name = check === 'duplicate-name' ? `${offer.name} (${offer.address.slice(2, 6)})` : offer.name
    w.setContacts([...w.contacts, { name, address: offer.address }])
    setOffer(msgId, offer.address, 'saved')
    w.notify(tr('Contact saved'))
  }
  const undoNote = (msgId: string, id: string) => {
    updateMemory((current) => removeNote(current, id))
    setMsgs((m) => m.map((x) => x.id === msgId && x.memoryNotes ? { ...x, memoryNotes: x.memoryNotes.filter((note) => note.id !== id) } : x))
  }
  const patch = (id: string, fn: (f: Flow) => Flow) => setMsgs((m) => m.map((x) => x.id === id && x.flow ? { ...x, flow: fn(x.flow) } : x))

  // The Agent remains prepare-only. Confirmation freezes a data-only review; the wallet is never opened here.
  const confirm = (id: string) => patch(id, (f) => {
    const brainReview = prepareBrainReview(actionFromFlow(f), brainContext())
    const transition = w.mode === 'connected' && w.address ? transitionAgentSession(f.session, { type: 'review-ready', account: w.address, expiresAt: brainReview.expiresAt, now: Date.now() }) : undefined
    if (transition?.accepted && typeof sessionStorage !== 'undefined') rememberAgentSession(sessionStorage, transition.state, w.address)
    return { ...f, stage: 3, brainReview, session: transition?.accepted ? transition.state : f.session }
  })
  /** Execute in chat: activate the native execution card directly in the message. */
  const cont = (m: Msg) => {
    const f = m.flow!
    const action = actionFromFlow(f)
    if (f.brainReview) {
      const checked = revalidateBrainReview(f.brainReview, action, brainContext())
      if (!checked.valid) {
        w.notify(tr(checked.reason === 'expired' ? 'Review expired — review the parameters again' : checked.reason === 'changed' ? 'Details changed — review again' : checked.assessment.blockers[0] ?? 'Action blocked by safety policy'), 'err')
        patch(m.id, (x) => {
          const requested = createAgentSession(nid())
          const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: nid(), now: Date.now() })
          return { ...x, stage: 2, handedOff: false, brainReview: undefined, execCard: undefined, session: planned.accepted ? planned.state : requested }
        })
        return
      }
    }
    // Mount the execution card in-chat. The wallet is NOT opened here.
    patch(m.id, (x) => ({ ...x, execCard: 'active' }))
  }

  /** Handoff to dedicated Send/Swap/Bridge page (original cont behaviour). */
  const handoff = (m: Msg) => {
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
          return { ...x, stage: 2, handedOff: false, brainReview: undefined, execCard: undefined, session: planned.accepted ? planned.state : requested }
        })
        return
      }
    }
    if (w.mode === 'connected' && typeof sessionStorage !== 'undefined') {
      const bh = createBrainHandoff(action, w.address)
      const transition = transitionAgentSession(f.session, { type: 'handed-off', account: w.address, now: Date.now() })
      if (!bh || !transition.accepted) { w.notify(tr('Review state expired or invalid; review again.'), 'err'); return }
      storeBrainHandoff(sessionStorage, bh)
      rememberAgentSession(sessionStorage, transition.state, w.address)
      patch(m.id, (x) => ({ ...x, session: transition.state }))
    }
    patch(m.id, (x) => ({ ...x, handedOff: true }))
    if (f.intent === 'send') { w.setSendDraft({ symbol: p.asset, amount: p.amount, to: p.recipient, review: true }); w.go('send') }
    else if (f.intent === 'swap') { w.setSwapDraft({ from: p.asset, to: p.toAsset, amount: p.amount }); w.go('swap') }
    else { w.setSwapDraft({ amount: p.amount, dest: p.dest }); w.go('bridge') }
  }

  useEffect(() => {
    if (w.agentSeed) { ask(w.agentSeed, w.agentSeedMode); w.setAgentSeed(null); w.setAgentSeedMode(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.agentSeed])
  useEffect(() => { if (msgs.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, typing])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
      <Card className="flex flex-col min-w-0 min-h-[calc(100vh-200px)]">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            <Orb size={32} thinking={typing} />
            <div className="min-w-0">
              <div className="font-semibold text-[14.5px]">{tr('Makoto Agent')}</div>
              <div className={`text-[12px] flex items-center gap-1.5 ${T.mute}`}><span className="w-2 h-2 rounded-full bg-neon-400/70 shrink-0" /> {tr('Your wallet assistant')}</div>
            </div>
          </div>
          {msgs.length > 0 && <Button variant="ghost" size="sm" onClick={() => { stop(); setMsgs([]); setSavedChat([]); chatHistory.current = []; try { localStorage.removeItem(chatKey) } catch { /* ignore */ } }}><Trash2 size={13} /> {tr('Clear')}</Button>}
        </div>
        {current && <div className="lg:hidden px-4 py-2.5 border-b border-white/[0.05]"><Stepper stage={current.stage} compact /></div>}

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-4">
          {msgs.length === 0 && (
            <div className="text-center pt-8 sm:pt-14">
              <div className="mx-auto w-fit"><Orb size={64} float /></div>
              <h2 className="mt-5 text-[20px] font-bold tracking-tight">{tr('What should Makoto do for you?')}</h2>
              <p className={`mt-1.5 text-[13.5px] max-w-[460px] mx-auto ${T.sub}`}>{tr('Ask about your wallet or the market.')}</p>
              {savedChat.length > 0 && (
                <button type="button" onClick={restoreChat} data-restore-chat className={`mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12.5px] ${T.sub} hover:text-white`}>
                  <RotateCcw size={13} /> {lang === 'vi' ? `Xem lại cuộc trò chuyện trước (${savedChat.length} tin)` : `Continue previous chat (${savedChat.length} messages)`}
                </button>
              )}
              {agentActions.length > 0 && (
                <div className="mt-6 max-w-[620px] mx-auto">
                  <div className={`mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-[0.08em] ${T.mute}`}><Sparkles size={12} /> {tr('Suggested for you').toUpperCase()}</div>
                  <ActionButtons actions={agentActions} onRun={runAction} />
                </div>
              )}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGEST.map(({ icon: Icon, t }) => (
                  <button key={t} onClick={() => ask(tr(t))} title={tr(t)} className={`h-9 max-w-full min-w-0 px-3 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[12.5px] ${T.sub} hover:text-white hover:bg-white/[0.05] inline-flex items-center gap-2`}><Icon size={14} className="text-neon-300 shrink-0" /><span className="truncate">{tr(t)}</span></button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m) => m.role === 'user' ? (
            <div key={m.id} className="flex justify-end mk-in"><div className="max-w-[80%] [overflow-wrap:anywhere] px-3.5 py-2 rounded-2xl rounded-br-md bg-neon-500/10 border border-white/[0.08] text-[14px]">{m.image && <img src={m.image} alt={lang === 'vi' ? 'Ảnh đính kèm' : 'Attached image'} className="mb-2 max-h-48 rounded-lg border border-white/[0.08] object-contain" />}{m.text}</div></div>
          ) : (
            <div key={m.id} className="flex gap-2.5 mk-in">
              <span className="mt-0.5"><Orb size={26} thinking={!!m.streaming} /></span>
              <div className="flex-1 min-w-0 max-w-[560px]">
                {m.streaming && m.toolStatus && !m.text && <p className={`text-[13px] ${T.sub} animate-pulse`} data-tool-status>{lang === 'vi' ? 'Đang tra' : 'Checking'}: {tr(m.toolStatus)}…</p>}
                {(!m.streaming || m.text) && <div className="text-[14px] leading-relaxed" aria-live={m.streaming ? 'polite' : undefined} aria-busy={m.streaming || undefined}>{m.source === 'REAL_PROVIDER' ? <AgentMarkdown text={m.text} /> : messageText(m)}{m.streaming && <span aria-hidden className="inline-block w-1.5 h-3.5 ml-0.5 align-[-2px] bg-neon-300/70 animate-pulse" />}</div>}
                {m.charts?.map((chart) => <AgentPriceChart key={`${chart.symbol}-${chart.timeRange}`} chart={chart} />)}
                {m.dataSources && m.dataSources.length > 0 && <SourcesLine sources={m.dataSources} />}
                {(m.memoryNotes?.length || m.contactOffers?.length) ? <MemoryReplyLines msg={m} onUndoNote={(id) => undoNote(m.id, id)} onSaveContact={(offer) => saveOffer(m.id, offer)} onDismissContact={(offer) => setOffer(m.id, offer.address, 'dismissed')} /> : null}
                {m.plan && <PlanCard msg={m} onStart={(index) => void startPlanStep(m.id, index)} onReset={(index) => resetPlanStep(m.id, index)} />}
                {m.source === 'REAL_PROVIDER' && !m.streaming && m.question && (
                  <div className={`mt-2 flex items-center gap-3 text-[11.5px] ${T.mute}`}>
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(m.text).then(() => w.notify(lang === 'vi' ? 'Đã sao chép' : 'Copied')).catch(() => {}) }} className="inline-flex items-center gap-1 hover:text-white"><Copy size={12} /> {lang === 'vi' ? 'Sao chép' : 'Copy'}</button>
                    <button type="button" disabled={typing} onClick={() => ask(m.question!)} className="inline-flex items-center gap-1 hover:text-white disabled:opacity-40"><RotateCcw size={12} /> {lang === 'vi' ? 'Hỏi lại' : 'Ask again'}</button>
                  </div>
                )}
                {m.followups?.length && m.id === msgs[msgs.length - 1]?.id && !typing ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5" data-followups>
                    {m.followups.map((question) => (
                      <button key={question} type="button" onClick={() => ask(question)} className={`inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[12.5px] ${T.sub} hover:text-white hover:border-neon-500/30`}><CornerDownRight size={12} className="text-neon-300" /> {question}</button>
                    ))}
                  </div>
                ) : null}
                {m.aiProposal && <p className="mt-2 text-[12px] text-neon-300/90">{tr('Makoto prepared a review card below. Nothing is sent until you confirm in your wallet.')}</p>}
                {messageRows(m).length ? (
                  <dl className="mt-2 rounded-xl border border-white/[0.07] divide-y divide-white/[0.05] text-[13px]">
                    {messageRows(m).map(([k, v], index) => <div key={`${k}-${index}`} className="flex justify-between gap-3 px-3.5 py-2"><dt className={`capitalize ${T.mute}`}>{k}</dt><dd className="font-num text-right">{v}</dd></div>)}
                  </dl>
                ) : null}
                {m.flow && !m.flow.execCard && m.flow.stage < STEPS.length && (
                  <ReviewCard
                    msg={m}
                    onChange={(p) => patch(m.id, (f) => ({ ...f, params: { ...f.params, ...p } }))}
                    onSlipChange={(s) => patch(m.id, (f) => ({ ...f, execSlip: s }))}
                    onSpeedChange={(s) => { patch(m.id, (f) => ({ ...f, execSpeed: s })); updateMemory((current) => setBridgeSpeed(current, s)) }}
                    onConfirm={() => confirm(m.id)}
                    onEdit={() => patch(m.id, (f) => { const requested = createAgentSession(nid()); const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: nid(), now: Date.now() }); return { ...f, stage: 2, handedOff: false, brainReview: undefined, execCard: undefined, session: planned.accepted ? planned.state : requested } })}
                    onContinue={() => cont(m)}
                    onHandoff={() => handoff(m)}
                  />
                )}
                {m.flow && !m.flow.execCard && m.flow.stage >= STEPS.length && (
                  <p role="status" className="mt-3 text-[12px] text-neon-300">{tr('Transaction complete')}</p>
                )}
                {m.flow?.execCard === 'active' && w.mode === 'connected' && (() => {
                  const f = m.flow!
                  const p = f.params
                  const dismissExec = () => patch(m.id, (x) => ({ ...x, execCard: undefined, stage: 3 }))
                  /** onDone(outcome) — called by the execution card when the user clicks Done/Hoàn tất.
                   *  'confirmed' / 'completed' → success toast + mark handed-off.
                   *  'failed' / 'rejected' / 'unknown' → card closes silently — the card already showed the error.
                   *  'unknown' must NEVER fire a success toast; the user must check Activity for evidence. */
                  const doneExec = (outcome: 'confirmed' | 'failed' | 'rejected' | 'unknown' | 'completed') => {
                    const succeeded = outcome === 'confirmed' || outcome === 'completed'
                    patch(m.id, (x) => ({ ...x, execCard: undefined, handedOff: succeeded, stage: succeeded ? STEPS.length : 3 }))
                    if (succeeded) w.notify(tr('Transaction complete'), 'ok')
                    // A plan step counts as done only with this in-chat, receipt-confirmed outcome.
                    if (m.planRef) {
                      const { planId, index } = m.planRef
                      patchPlan(planId, (plan) => plan.activeIndex !== index ? plan : succeeded
                        ? { ...plan, activeIndex: undefined, failedIndex: undefined, done: plan.done.map((value, i) => i === index ? true : value) }
                        : { ...plan, activeIndex: undefined, failedIndex: index })
                    }
                    // failed / rejected / unknown: card closes silently — the card already showed the error
                  }
                  if (f.intent === 'send') {
                    return (
                      <AgentSendCard
                        params={{ account: w.address, symbol: p.asset, amount: p.amount, recipient: p.recipient }}
                        onStageChange={(stage) => patch(m.id, (x) => ({ ...x, stage: agentSendProgressStage(stage, x.stage) }))}
                        onDone={doneExec}
                        onCancel={dismissExec}
                      />
                    )
                  }
                  if (f.intent === 'swap') {
                    return (
                      <AgentSwapCard
                        params={{ account: w.address, from: p.asset, to: p.toAsset, amount: p.amount, slip: f.execSlip ?? '0.5%' }}
                        onDone={doneExec}
                        onCancel={dismissExec}
                      />
                    )
                  }
                  // bridge
                  return (
                    <AgentBridgeCard
                      params={{ account: w.address, amount: p.amount, transferSpeed: f.execSpeed ?? 'FAST' as CctpTransferSpeed }}
                      onDone={doneExec}
                      onCancel={dismissExec}
                    />
                  )
                })()}
                {m.task && <TaskReviewCard candidate={m.task} tasks={w.tasks} created={m.taskAdded} onCreate={async () => { await w.createTask(m.task!); w.notify(taskText('created', lang === 'vi' ? 'vi' : 'en')); setMsgs((messages) => messages.map((entry) => entry.id === m.id ? { ...entry, taskAdded: true } : entry)) }} />}
                {m.taskAdded && <Button size="sm" className="mt-2" onClick={() => w.go('tasks')}>{tr('View in Tasks')}</Button>}
                {m.link && <Button size="sm" className="mt-2" onClick={() => w.go(m.link!.page)}>{m.link.taskTextKey ? taskText(m.link.taskTextKey, locale) : tr(m.link.label)}</Button>}
              </div>
            </div>
          ))}
          {typing && !msgs.some((x) => x.streaming) && <div className="flex gap-2.5 items-center"><Orb size={26} thinking /><span className={`text-[13px] ${T.sub} animate-pulse`}>{tr('Checking live data…')}</span></div>}
          <div ref={end} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="p-3 sm:p-4 border-t border-white/[0.06]">
          {attachment && (
            <div className="mb-2 inline-flex items-start gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-1.5">
              <img src={attachment} alt={lang === 'vi' ? 'Ảnh sẽ gửi' : 'Image to send'} className="h-16 max-w-[140px] rounded-md object-cover" />
              <button type="button" onClick={() => setAttachment(null)} aria-label={lang === 'vi' ? 'Bỏ ảnh' : 'Remove image'} className={`h-6 w-6 inline-flex items-center justify-center rounded-md ${T.sub} hover:text-white hover:bg-white/[0.08]`}><X size={13} /></button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void attachImage(e.target.files?.[0]); e.target.value = '' }} />
          <div className="mk-field-shell flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/25 p-1.5 transition">
            <input value={input} onChange={(e) => setInput(e.target.value)} onPaste={(e) => { const item = Array.from(e.clipboardData.items).find((entry) => entry.type.startsWith('image/')); if (item) { e.preventDefault(); void attachImage(item.getAsFile()) } }} placeholder={tr(SAMPLE_PROMPTS.send)} aria-label={tr('Message Makoto')} className="flex-1 min-w-0 bg-transparent px-2.5 py-2 text-[14px] outline-none placeholder:text-[#6f6d7a]" />
            {!typing && <button type="button" onClick={() => fileRef.current?.click()} aria-label={lang === 'vi' ? 'Gửi ảnh chụp màn hình' : 'Attach a screenshot'} title={lang === 'vi' ? 'Gửi ảnh biểu đồ hoặc giao dịch' : 'Attach a chart or transaction screenshot'} className={`h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg ${T.sub} hover:text-white hover:bg-white/[0.06]`}><ImagePlus size={16} /></button>}
            {speechCtor && !typing && <button type="button" onClick={toggleVoice} aria-pressed={listening} aria-label={lang === 'vi' ? (listening ? 'Dừng nghe' : 'Nói để nhập') : (listening ? 'Stop listening' : 'Voice input')} className={`h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg ${listening ? 'bg-rose-500/20 text-rose-200 animate-pulse' : `${T.sub} hover:text-white hover:bg-white/[0.06]`}`}>{listening ? <MicOff size={16} /> : <Mic size={16} />}</button>}
            {typing
              ? <button type="button" onClick={stop} className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-white/[0.1] text-white hover:bg-white/[0.16]" aria-label={lang === 'vi' ? 'Dừng trả lời' : 'Stop answering'} title={lang === 'vi' ? 'Dừng' : 'Stop'}><Square size={14} fill="currentColor" /></button>
              : <button disabled={!input.trim() && !attachment} className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-neon-500 text-[#0b0b10] hover:bg-neon-400 disabled:bg-white/[0.06] disabled:text-white/30" aria-label={tr('Send message')}><ArrowUp size={17} /></button>}
          </div>
        </form>
      </Card>
      <aside className="hidden lg:block sticky top-[76px]"><ContextPanel flow={current} actions={msgs.length ? agentActions : []} onAction={runAction} memoryNotes={memory.notes} onRemoveNote={(id) => updateMemory((current) => removeNote(current, id))} /></aside>
    </div>
  )
}
