import { api } from '../lib/api.ts'
import type { ChatTopic } from './chatRouter.ts'
import { boundChatHistory, type ChatHistoryItem } from './chatContext.ts'

export type ChatContext = Readonly<{ locale: 'en' | 'vi'; mode: 'connected' | 'demo' | 'watch'; chain?: 'Arc Testnet'; intent: 'CHAT' | 'INFORMATION'; toolResult?: unknown }>
export type { ChatHistoryItem } from './chatContext.ts'
export type ChatSource = 'REAL_PROVIDER' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_TOOL'
export type ChatResponse = Readonly<{ ok: true; text: string; source: 'REAL_PROVIDER' } | { ok: false; reason: string; source: 'LOCAL_FALLBACK' }>

export async function requestMakotoChat(input: { message: string; topic: ChatTopic; context: ChatContext; history?: readonly ChatHistoryItem[]; fetcher?: typeof fetch }): Promise<ChatResponse> {
  const fetcher = input.fetcher || fetch
  try {
    const response = await fetcher(api('agent/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: input.message.slice(0, 2000), locale: input.context.locale, context: input.context, history: boundChatHistory(input.history) }),
    })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok || !payload || typeof payload !== 'object' || typeof (payload as { text?: unknown }).text !== 'string' || !(payload as { text: string }).text.trim()) return { ok: false, reason: typeof (payload as { error?: unknown })?.error === 'string' ? (payload as { error: string }).error : `Chat request failed (${response.status})`, source: 'LOCAL_FALLBACK' }
    return { ok: true, text: (payload as { text: string }).text.trim().slice(0, 4000), source: 'REAL_PROVIDER' }
  } catch { return { ok: false, reason: 'Chat service unavailable', source: 'LOCAL_FALLBACK' } }
}
