import { api } from '../lib/api.ts'
import type { ChatTopic } from './chatRouter.ts'
import { boundChatHistory, type ChatHistoryItem } from './chatContext.ts'
import { parsePlan, parsePlanStep, type PlanStep } from '../lib/agentPlan.ts'

export type ChatLocale = 'en' | 'vi'
export type ChatContext = Readonly<{ locale: ChatLocale; mode: 'connected' | 'demo' | 'watch'; chain?: 'Arc Testnet'; intent: 'CHAT' | 'INFORMATION'; toolResult?: unknown }>
/** Data sources the backend Agent actually read for this answer (labels only, no raw data). */
export type ChatDataSource = Readonly<{ source: string; ok: boolean; observedAt?: string }>
/** Untrusted model proposal. It must be re-parsed by Makoto's deterministic planner before any review card. */
export type ChatProposal = PlanStep
/** Memory changes the model asked for: notes are saved on the device; contacts need a user click. */
export type ChatMemoryUpdate = Readonly<{ type: 'note'; note: string } | { type: 'contact'; name: string; address: string }>
export type ChatChart = Readonly<{ symbol: string; timeRange: string; currency: string; points: readonly (readonly [number, number])[] }>
export type { ChatHistoryItem } from './chatContext.ts'
export type ChatSource = 'REAL_PROVIDER' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_TOOL'
export type ChatResponse = Readonly<{ ok: true; text: string; source: 'REAL_PROVIDER'; sources?: readonly ChatDataSource[]; proposal?: ChatProposal; plan?: readonly PlanStep[]; memory?: readonly ChatMemoryUpdate[]; charts?: readonly ChatChart[]; followups?: readonly string[] } | { ok: false; reason: string; source: 'LOCAL_FALLBACK'; aborted?: boolean }>
export type ChatStreamEvent = Readonly<{ type: 'status'; tool: string; source: string | null } | { type: 'delta'; text: string }>
/** What the Agent may know about the user: notes, contact NAMES and preferences (no addresses). */
export type ChatMemoryContext = Readonly<{ notes: readonly string[]; contacts: readonly string[]; preferences: Readonly<{ bridgeSpeed?: 'FAST' | 'SLOW' }> }>

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

type ChatRequestInput = { message: string; topic: ChatTopic; context: ChatContext; history?: readonly ChatHistoryItem[]; address?: string; memory?: ChatMemoryContext; fetcher?: typeof fetch; signal?: AbortSignal }

function requestBody(input: ChatRequestInput) {
  return JSON.stringify({
    message: input.message.slice(0, 2000), locale: input.context.locale, context: input.context, history: boundChatHistory(input.history),
    ...(input.address && /^0x[0-9a-fA-F]{40}$/.test(input.address) ? { address: input.address } : {}),
    ...(input.memory ? { memory: input.memory } : {}),
  })
}

/** Validates a backend reply; anything malformed becomes a local fallback signal. */
export function parseChatReply(payload: unknown, status = 200): ChatResponse {
  if (!payload || typeof payload !== 'object' || typeof (payload as { text?: unknown }).text !== 'string' || !(payload as { text: string }).text.trim()) {
    return { ok: false, reason: typeof (payload as { error?: unknown })?.error === 'string' ? (payload as { error: string }).error : `Chat request failed (${status})`, source: 'LOCAL_FALLBACK' }
  }
  const value = payload as Record<string, unknown>
  const sources = parseSources(value.sources)
  const proposal = parseProposal(value.proposal)
  const plan = parsePlan(value.plan)
  const memory = parseMemory(value.memory)
  const charts = parseCharts(value.charts)
  const followups = Array.isArray(value.followups) ? value.followups.filter((item): item is string => typeof item === 'string' && item.trim().length >= 3).map((item) => item.trim().slice(0, 90)).slice(0, 3) : []
  return {
    ok: true, text: (value.text as string).trim().slice(0, 6000), source: 'REAL_PROVIDER',
    ...(sources.length ? { sources } : {}), ...(proposal ? { proposal } : {}), ...(plan ? { plan } : {}),
    ...(memory.length ? { memory } : {}), ...(charts.length ? { charts } : {}), ...(followups.length ? { followups } : {}),
  }
}

/**
 * Streaming chat (Server-Sent Events). Calls onEvent for tool status and text deltas,
 * resolves with the authoritative final reply. Falls back to POST /agent/chat when the
 * stream endpoint is unavailable before anything was shown.
 */
export async function requestMakotoChatStream(input: ChatRequestInput & { onEvent: (event: ChatStreamEvent) => void }): Promise<ChatResponse> {
  const fetcher = input.fetcher || fetch
  const controller = new AbortController()
  if (input.signal?.aborted) controller.abort()
  else input.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  let shown = false
  try {
    return await withChatDeadline(async (signal) => {
      const response = await fetcher(api('agent/chat/stream'), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: requestBody(input), signal })
      const type = response.headers?.get?.('content-type') ?? ''
      if (!response.ok || !response.body || !type.includes('text/event-stream')) {
        if (response.status === 400 || response.status === 429) return parseChatReply(await response.json().catch(() => undefined), response.status)
        return requestMakotoChat(input)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let final: ChatResponse | undefined
      const handle = (block: string) => {
        let event = 'message'
        const data: string[] = []
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        if (!data.length) return
        let value: unknown
        try { value = JSON.parse(data.join('\n')) } catch { return }
        const record = value as Record<string, unknown>
        if (event === 'delta' && typeof record?.text === 'string') { shown = true; input.onEvent({ type: 'delta', text: record.text }) }
        else if (event === 'status' && typeof record?.tool === 'string') input.onEvent({ type: 'status', tool: record.tool.slice(0, 40), source: typeof record.source === 'string' ? record.source.slice(0, 40) : null })
        else if (event === 'done') final = parseChatReply(value)
        else if (event === 'error') final = { ok: false, reason: typeof record?.error === 'string' ? record.error : 'Chat service unavailable', source: 'LOCAL_FALLBACK' }
      }
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
          handle(buffer.slice(0, index))
          buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '')
        }
        if (final) break
      }
      if (!final && buffer.trim()) handle(buffer)
      if (final) return final
      return shown ? { ok: false, reason: 'Chat stream ended early', source: 'LOCAL_FALLBACK' } as ChatResponse : requestMakotoChat(input)
    }, CHAT_TIMEOUT_MS, controller)
  } catch (error) {
    if (input.signal?.aborted) return { ok: false, reason: 'Stopped', source: 'LOCAL_FALLBACK', aborted: true }
    if (!shown && !(error instanceof Error && error.name === 'AbortError')) return requestMakotoChat(input)
    return { ok: false, reason: error instanceof Error && error.name === 'AbortError' ? 'Chat service timed out' : 'Chat service unavailable', source: 'LOCAL_FALLBACK' }
  }
}

export async function requestMakotoChat(input: ChatRequestInput): Promise<ChatResponse> {
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
        body: requestBody(input),
        signal,
      })
      // response.json() is inside the deadline: if it hangs, the outer race
      // fires the timeout rejection before the await can return.
      const payload: unknown = await response.json().catch(() => undefined)
      if (!response.ok) return parseChatReply({ error: (payload as { error?: unknown })?.error }, response.status)
      return parseChatReply(payload, response.status)
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

/** Shape-check only. Authority stays with the deterministic planner and Policy/Risk review. */
export function parseProposal(value: unknown): ChatProposal | undefined {
  return parsePlanStep(value)
}

/** Canonical English command for a proposal that already carries a full recipient address. */
export function proposalCommand(proposal: ChatProposal): string {
  if (proposal.kind === 'send') return `send ${proposal.amount} ${proposal.asset} to ${proposal.recipient ?? ''}`.trim()
  if (proposal.kind === 'swap') return `swap ${proposal.amount} ${proposal.asset} to ${proposal.outputAsset}`
  return `bridge ${proposal.amount} USDC from Arc Testnet to Base Sepolia`
}

function parseMemory(value: unknown): ChatMemoryUpdate[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 3).flatMap((item): ChatMemoryUpdate[] => {
    if (!item || typeof item !== 'object') return []
    const v = item as Record<string, unknown>
    if (v.type === 'note' && typeof v.note === 'string' && v.note.trim()) return [{ type: 'note', note: v.note.trim().slice(0, 200) }]
    if (v.type === 'contact' && typeof v.name === 'string' && v.name.trim() && typeof v.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.address)) return [{ type: 'contact', name: v.name.trim().slice(0, 40), address: v.address }]
    return []
  })
}

function parseCharts(value: unknown): ChatChart[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 3).flatMap((item): ChatChart[] => {
    if (!item || typeof item !== 'object') return []
    const v = item as Record<string, unknown>
    if (typeof v.symbol !== 'string' || !/^[A-Za-z0-9]{1,15}$/.test(v.symbol) || !Array.isArray(v.points)) return []
    const points = v.points.slice(0, 200).filter((point): point is [number, number] => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n)))
    return points.length >= 2 ? [{ symbol: v.symbol.toUpperCase(), timeRange: typeof v.time_range === 'string' ? v.time_range.slice(0, 6) : '', currency: typeof v.currency === 'string' ? v.currency.slice(0, 6) : 'USD', points }] : []
  })
}

/** Streaming text without the trailing "[[followups: …]]" marker the backend strips from the final reply. */
export function visibleStreamText(text: string): string {
  const index = text.indexOf('[[')
  return index >= 0 ? text.slice(0, index).trimEnd() : text
}
