import { routeAgentMessage } from './chatRouter.ts'
import type { BrainLocale } from '../brain/types.ts'

export type ChatHistoryItem = Readonly<{ role: 'user' | 'assistant'; content: string }>

export const MAX_CHAT_HISTORY_MESSAGES = 12
export const MAX_CHAT_HISTORY_CHARS = 6000
export const MAX_CHAT_HISTORY_ITEM_CHARS = 600

/** Keep only short-lived conversational text. Transaction flow objects never enter this shape. */
export function boundChatHistory(history: readonly ChatHistoryItem[] | undefined): ChatHistoryItem[] {
  if (!Array.isArray(history)) return []
  const normalized = history.flatMap((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string'
    ? [{ role: item.role, content: item.content.trim().slice(0, MAX_CHAT_HISTORY_ITEM_CHARS) }]
    : [])
  const kept: ChatHistoryItem[] = []
  let chars = 0
  for (let index = normalized.length - 1; index >= 0 && kept.length < MAX_CHAT_HISTORY_MESSAGES; index--) {
    const item = normalized[index]
    if (!item.content) continue
    const remaining = MAX_CHAT_HISTORY_CHARS - chars
    if (remaining <= 0) break
    const content = item.content.slice(0, remaining)
    kept.unshift({ role: item.role, content })
    chars += content.length
  }
  return kept
}

export function appendChatHistory(history: readonly ChatHistoryItem[], item: ChatHistoryItem): ChatHistoryItem[] {
  return boundChatHistory([...history, item])
}

function isAssetFollowUp(message: string, locale: BrainLocale) {
  const text = message.trim().toLocaleLowerCase(locale === 'vi' ? 'vi-VN' : 'en-US').replace(/[!?.,]+$/g, '').trim()
  return /^(?:c\u00f2n|v\u00e0|and|what about|how about)\s+(?:usdc|eurc|cirbtc)$/.test(text)
}

/** Resolve a short asset follow-up only when the preceding user turn was a wallet read. */
export function isWalletContextFollowUp(message: string, history: readonly ChatHistoryItem[], locale: BrainLocale) {
  if (!isAssetFollowUp(message, locale)) return false
  const previous = [...history].reverse().find((item) => item.role === 'user')
  if (!previous) return false
  const routed = routeAgentMessage(previous.content, locale)
  return routed.category === 'INFORMATION' && routed.topic === 'wallet'
}
