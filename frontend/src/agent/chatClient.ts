import { api } from '../lib/api.ts'
import type { ChatTopic } from './chatRouter.ts'
import { boundChatHistory, type ChatHistoryItem } from './chatContext.ts'

export type ChatLocale = 'en' | 'vi' | 'zh' | 'ja' | 'ko'
export type ChatContext = Readonly<{ locale: ChatLocale; mode: 'connected' | 'demo' | 'watch'; chain?: 'Arc Testnet'; intent: 'CHAT' | 'INFORMATION'; toolResult?: unknown }>
/** Data sources the backend Agent actually read for this answer (labels only, no raw data). */
export type ChatDataSource = Readonly<{ source: string; ok: boolean; observedAt?: string }>
/** Untrusted model proposal. It must be re-parsed by Makoto's deterministic planner before any review card. */
export type ChatProposal = Readonly<
  | { kind: 'send'; asset: 'USDC' | 'EURC' | 'cirBTC'; amount: string; recipient: string }
  | { kind: 'swap'; asset: 'USDC' | 'EURC'; amount: string; outputAsset: 'USDC' | 'EURC' }
  | { kind: 'bridge'; asset: 'USDC'; amount: string; destination: 'Base Sepolia' }
>
export type { ChatHistoryItem } from './chatContext.ts'
export type ChatSource = 'REAL_PROVIDER' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_TOOL'
export type ChatResponse = Readonly<{ ok: true; text: string; source: 'REAL_PROVIDER'; sources?: readonly ChatDataSource[]; proposal?: ChatProposal } | { ok: false; reason: string; source: 'LOCAL_FALLBACK' }>

/** Maximum time to wait for the full chat HTTP response (fetch + response.json). */
export const CHAT_TIMEOUT_MS = 60_000

/**
 * Race the async callback `fn` against a hard deadline of `ms` milliseconds.
 * Rejects with a labelled error when the deadline fires regardless of whether
 * the callback honours the abort signal — the signal is best-effort I/O
 * cancellation; the race is the guaranteed cutoff.
 * The `signal` is forwarded to `fn` so compliant I/O (fetch, XHR) can cancel
 * early; non-compliant implementations are still bounded by the race.
 */
export function withChatDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  controller: AbortController,
): Promise<T> {
  // Three ways to cut the race: (1) timer fires after ms, (2) controller.signal
  // is already aborted, (3) controller.signal fires during execution.
  // All three settle the outer Promise immediately via `done`, regardless of
  // whether `fn` honours the signal — this is the independent guarantee.
  return new Promise<T>((resolve, reject) => {
    let done = false
    // Use a ref object so `timerRef` is const (satisfies prefer-const) while
    // `timerRef.id` remains mutable.  The closure captures the ref before the
    // timer is started, so there is no temporal dead zone: clearTimeout(undefined)
    // is always a safe no-op if abort() fires before the timer is assigned.
    const timerRef: { id: ReturnType<typeof setTimeout> | undefined } = { id: undefined }
    const abort = () => {
      if (!done) {
        done = true
        clearTimeout(timerRef.id)
        reject(Object.assign(new Error('Chat service timed out'), { name: 'AbortError' }))
      }
    }
    // Case 2: already aborted before we started — timerRef.id is undefined here,
    // clearTimeout(undefined) is a no-op, so this is safe.
    if (controller.signal.aborted) { abort(); return }
    // Case 3: aborted mid-execution (external signal or deadline from another call).
    controller.signal.addEventListener('abort', abort, { once: true })
    // Case 1: deadline timer — only started when signal was not already aborted.
    timerRef.id = setTimeout(() => { controller.abort(); abort() }, ms)
    fn(controller.signal).then(
      (value) => { if (!done) { done = true; clearTimeout(timerRef.id); controller.signal.removeEventListener('abort', abort); resolve(value) } },
      (err)   => { if (!done) { done = true; clearTimeout(timerRef.id); controller.signal.removeEventListener('abort', abort); reject(err) } },
    )
  })
}

export async function requestMakotoChat(input: { message: string; topic: ChatTopic; context: ChatContext; history?: readonly ChatHistoryItem[]; address?: string; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<ChatResponse> {
  const fetcher = input.fetcher || fetch
  // One AbortController for both the deadline and any external signal.
  const controller = new AbortController()
  // Forward external signal (e.g. component-unmount) into the controller.
  // If already aborted, abort immediately so withChatDeadline sees it in Case 2.
  if (input.signal?.aborted) {
    controller.abort()
  } else {
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    return await withChatDeadline(async (signal) => {
      const response = await fetcher(api('agent/chat'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: input.message.slice(0, 2000), locale: input.context.locale, context: input.context, history: boundChatHistory(input.history), ...(input.address && /^0x[0-9a-fA-F]{40}$/.test(input.address) ? { address: input.address } : {}) }),
        signal,
      })
      // response.json() is inside the deadline: if it hangs, the outer race
      // fires the timeout rejection before the await can return.
      const payload: unknown = await response.json().catch(() => undefined)
      if (!response.ok || !payload || typeof payload !== 'object' || typeof (payload as { text?: unknown }).text !== 'string' || !(payload as { text: string }).text.trim()) return { ok: false, reason: typeof (payload as { error?: unknown })?.error === 'string' ? (payload as { error: string }).error : `Chat request failed (${response.status})`, source: 'LOCAL_FALLBACK' } as ChatResponse
      const sources = parseSources((payload as { sources?: unknown }).sources)
      const proposal = parseProposal((payload as { proposal?: unknown }).proposal)
      return { ok: true, text: (payload as { text: string }).text.trim().slice(0, 6000), source: 'REAL_PROVIDER', ...(sources.length ? { sources } : {}), ...(proposal ? { proposal } : {}) } as ChatResponse
    }, CHAT_TIMEOUT_MS, controller)
  } catch (error) {
    // AbortError fires on timeout or external cancellation.
    const reason = error instanceof Error && error.name === 'AbortError' ? 'Chat service timed out' : 'Chat service unavailable'
    return { ok: false, reason, source: 'LOCAL_FALLBACK' }
  }
}

function parseSources(value: unknown): ChatDataSource[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).flatMap((item) => item && typeof item === 'object' && typeof (item as { source?: unknown }).source === 'string'
    ? [{ source: (item as { source: string }).source.slice(0, 40), ok: (item as { ok?: unknown }).ok === true, ...(typeof (item as { observedAt?: unknown }).observedAt === 'string' ? { observedAt: (item as { observedAt: string }).observedAt } : {}) }]
    : [])
}

const AMOUNT = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** Shape-check only. Authority stays with the deterministic planner and Policy/Risk review. */
export function parseProposal(value: unknown): ChatProposal | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (typeof v.amount !== 'string' || !AMOUNT.test(v.amount) || !(Number(v.amount) > 0)) return undefined
  if (v.kind === 'send' && (v.asset === 'USDC' || v.asset === 'EURC' || v.asset === 'cirBTC') && typeof v.recipient === 'string' && ADDRESS.test(v.recipient)) return { kind: 'send', asset: v.asset, amount: v.amount, recipient: v.recipient }
  if (v.kind === 'swap' && (v.asset === 'USDC' || v.asset === 'EURC') && (v.outputAsset === 'USDC' || v.outputAsset === 'EURC') && v.asset !== v.outputAsset) return { kind: 'swap', asset: v.asset, amount: v.amount, outputAsset: v.outputAsset }
  if (v.kind === 'bridge' && v.asset === 'USDC') return { kind: 'bridge', asset: 'USDC', amount: v.amount, destination: 'Base Sepolia' }
  return undefined
}

/** Canonical English command for Makoto's deterministic parser (planBrainRequest). */
export function proposalCommand(proposal: ChatProposal): string {
  if (proposal.kind === 'send') return `send ${proposal.amount} ${proposal.asset} to ${proposal.recipient}`
  if (proposal.kind === 'swap') return `swap ${proposal.amount} ${proposal.asset} to ${proposal.outputAsset}`
  return `bridge ${proposal.amount} USDC from Arc Testnet to Base Sepolia`
}
