import { api } from '../lib/api.ts'
import type { ChatTopic } from './chatRouter.ts'
import { boundChatHistory, type ChatHistoryItem } from './chatContext.ts'

export type ChatContext = Readonly<{ locale: 'en' | 'vi'; mode: 'connected' | 'demo' | 'watch'; chain?: 'Arc Testnet'; intent: 'CHAT' | 'INFORMATION'; toolResult?: unknown }>
export type { ChatHistoryItem } from './chatContext.ts'
export type ChatSource = 'REAL_PROVIDER' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_TOOL'
export type ChatResponse = Readonly<{ ok: true; text: string; source: 'REAL_PROVIDER' } | { ok: false; reason: string; source: 'LOCAL_FALLBACK' }>

/** Maximum time to wait for the full chat HTTP response (fetch + response.json). */
export const CHAT_TIMEOUT_MS = 25_000

export async function requestMakotoChat(input: { message: string; topic: ChatTopic; context: ChatContext; history?: readonly ChatHistoryItem[]; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<ChatResponse> {
  const fetcher = input.fetcher || fetch
  // Compose an AbortController that fires after CHAT_TIMEOUT_MS, and also
  // respects any externally-supplied signal (e.g. component-unmount cancellation).
  const localController = new AbortController()
  const timer = setTimeout(() => localController.abort(), CHAT_TIMEOUT_MS)
  // Forward an external signal (e.g. component-unmount) into the local controller.
  input.signal?.addEventListener('abort', () => localController.abort(), { once: true })
  const signal = localController.signal
  try {
    const response = await fetcher(api('agent/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: input.message.slice(0, 2000), locale: input.context.locale, context: input.context, history: boundChatHistory(input.history) }),
      signal,
    })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok || !payload || typeof payload !== 'object' || typeof (payload as { text?: unknown }).text !== 'string' || !(payload as { text: string }).text.trim()) return { ok: false, reason: typeof (payload as { error?: unknown })?.error === 'string' ? (payload as { error: string }).error : `Chat request failed (${response.status})`, source: 'LOCAL_FALLBACK' }
    return { ok: true, text: (payload as { text: string }).text.trim().slice(0, 4000), source: 'REAL_PROVIDER' }
  } catch (error) {
    // AbortError fires on timeout or external cancellation.
    const reason = error instanceof Error && error.name === 'AbortError' ? 'Chat service timed out' : 'Chat service unavailable'
    return { ok: false, reason, source: 'LOCAL_FALLBACK' }
  } finally {
    clearTimeout(timer)
  }
}
