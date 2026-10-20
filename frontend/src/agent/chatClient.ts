import { api } from '../lib/api.ts'
import type { ChatTopic } from './chatRouter.ts'
import { boundChatHistory, type ChatHistoryItem } from './chatContext.ts'

export type ChatContext = Readonly<{ locale: 'en' | 'vi'; mode: 'connected' | 'demo' | 'watch'; chain?: 'Arc Testnet'; intent: 'CHAT' | 'INFORMATION'; toolResult?: unknown }>
export type { ChatHistoryItem } from './chatContext.ts'
export type ChatSource = 'REAL_PROVIDER' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_TOOL'
export type ChatResponse = Readonly<{ ok: true; text: string; source: 'REAL_PROVIDER' } | { ok: false; reason: string; source: 'LOCAL_FALLBACK' }>

/** Maximum time to wait for the full chat HTTP response (fetch + response.json). */
export const CHAT_TIMEOUT_MS = 25_000

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
    const abort = () => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(Object.assign(new Error('Chat service timed out'), { name: 'AbortError' }))
      }
    }
    // Case 2: already aborted before we started.
    if (controller.signal.aborted) { abort(); return }
    // Case 3: aborted mid-execution (external signal or deadline from another call).
    controller.signal.addEventListener('abort', abort, { once: true })
    // Case 1: deadline timer.
    const timer = setTimeout(() => { controller.abort(); abort() }, ms)
    fn(controller.signal).then(
      (value) => { if (!done) { done = true; clearTimeout(timer); controller.signal.removeEventListener('abort', abort); resolve(value) } },
      (err)   => { if (!done) { done = true; clearTimeout(timer); controller.signal.removeEventListener('abort', abort); reject(err) } },
    )
  })
}

export async function requestMakotoChat(input: { message: string; topic: ChatTopic; context: ChatContext; history?: readonly ChatHistoryItem[]; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<ChatResponse> {
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
        body: JSON.stringify({ message: input.message.slice(0, 2000), locale: input.context.locale, context: input.context, history: boundChatHistory(input.history) }),
        signal,
      })
      // response.json() is inside the deadline: if it hangs, the outer race
      // fires the timeout rejection before the await can return.
      const payload: unknown = await response.json().catch(() => undefined)
      if (!response.ok || !payload || typeof payload !== 'object' || typeof (payload as { text?: unknown }).text !== 'string' || !(payload as { text: string }).text.trim()) return { ok: false, reason: typeof (payload as { error?: unknown })?.error === 'string' ? (payload as { error: string }).error : `Chat request failed (${response.status})`, source: 'LOCAL_FALLBACK' } as ChatResponse
      return { ok: true, text: (payload as { text: string }).text.trim().slice(0, 4000), source: 'REAL_PROVIDER' } as ChatResponse
    }, CHAT_TIMEOUT_MS, controller)
  } catch (error) {
    // AbortError fires on timeout or external cancellation.
    const reason = error instanceof Error && error.name === 'AbortError' ? 'Chat service timed out' : 'Chat service unavailable'
    return { ok: false, reason, source: 'LOCAL_FALLBACK' }
  }
}
