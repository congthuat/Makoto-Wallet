import { planAgentRequest, type AgentPlanResult } from '../migrated/planner.ts'
import type { BrainLocale } from '../brain/types.ts'

export type ChatCategory = 'CHAT' | 'INFORMATION' | 'ACTION' | 'STRATEGY'
export type ChatTopic = 'greeting' | 'capabilities' | 'identity' | 'thanks' | 'goodbye' | 'general' | 'wallet' | 'activity' | 'network' | 'datetime' | 'safety' | 'action'
export type ChatRoute = Readonly<{ category: ChatCategory; topic: ChatTopic; plan: AgentPlanResult }>

const includesAny = (value: string, terms: readonly string[]) => terms.some((term) => value.includes(term))

export function routeAgentMessage(raw: string, locale: BrainLocale = 'en'): ChatRoute {
  const text = raw.trim().toLocaleLowerCase(locale === 'vi' ? 'vi-VN' : 'en-US')
  const plan = planAgentRequest(raw, locale)
  const actionWords = ['send', 'transfer', 'swap', 'bridge', 'gửi', 'chuyển', 'đổi', 'hoán đổi']
  if (plan.status === 'STRATEGY' || (includesAny(text, ['then', 'and then', 'sau đó', 'rồi']) && includesAny(text, actionWords))) return { category: 'STRATEGY', topic: 'action', plan }
  if (plan.status === 'ACTION' || (includesAny(text, actionWords) && plan.status === 'NEEDS_CLARIFICATION')) return { category: 'ACTION', topic: 'action', plan }
  if (plan.status === 'INFORMATION' && plan.topic === 'safety-capabilities') return { category: 'CHAT', topic: 'safety', plan }
  if (plan.status === 'INFORMATION') {
    const topic: ChatTopic = plan.topic === 'current-datetime' ? 'datetime' : text.includes('network') || text.includes('chain') || text.includes('mạng') || text.includes('chuỗi') ? 'network' : text.includes('activity') || text.includes('transaction') || text.includes('giao dịch') ? 'activity' : 'wallet'
    return { category: 'INFORMATION', topic, plan }
  }
  if (includesAny(text, ['xin chào', 'chào bạn', 'hello', 'hey']) || /(^|\s)hi($|[!?.\s])/.test(text)) return { category: 'CHAT', topic: 'greeting', plan }
  if (includesAny(text, ['bạn là ai', 'who are you', 'what is makoto'])) return { category: 'CHAT', topic: 'identity', plan }
  if (includesAny(text, ['bạn làm được gì', 'what can you do', 'capabilities', 'help'])) return { category: 'CHAT', topic: 'capabilities', plan }
  if (includesAny(text, ['cảm ơn', 'thank you', 'thanks'])) return { category: 'CHAT', topic: 'thanks', plan }
  if (includesAny(text, ['tạm biệt', 'goodbye', 'bye'])) return { category: 'CHAT', topic: 'goodbye', plan }
  if (includesAny(text, ['safety', 'security', 'an toàn', 'bảo mật'])) return { category: 'CHAT', topic: 'safety', plan }
  return { category: 'CHAT', topic: 'general', plan }
}

export function localChatReply(topic: ChatTopic, locale: BrainLocale, providerUnavailable = false): string {
  if (locale === 'vi') {
    if (topic === 'greeting') return 'Chào bạn 👋 Mình là Makoto Agent. Mình có thể giúp bạn kiểm tra tài sản, gửi token, swap hoặc bridge trên Arc.'
    if (topic === 'identity') return 'Mình là Makoto Agent của Makotowallet.xyz. Mình đọc dữ liệu ví, chuẩn bị kế hoạch và để bạn xem lại trước khi ví của bạn ký.'
    if (topic === 'capabilities') return 'Mình có thể đọc số dư và hoạt động, chuẩn bị Send, Swap và Direct CCTP trên Arc, rồi chuyển bạn sang màn hình review. Mình không giữ khóa và không tự ký giao dịch.'
    if (topic === 'thanks') return 'Không có gì — mình luôn sẵn sàng hỗ trợ.'
    if (topic === 'goodbye') return 'Hẹn gặp lại. Ví của bạn vẫn giữ quyền ký cuối cùng.'
    if (topic === 'safety') return 'Makoto luôn tách bước chuẩn bị, review, yêu cầu ví, hash và receipt. Policy/Risk quyết định tính hợp lệ; model không thể bỏ qua các bước đó.'
    return providerUnavailable ? 'Dịch vụ chat đang tạm thời không khả dụng, nhưng đọc ví và các luồng chuẩn bị cục bộ vẫn hoạt động.' : 'Mình có thể giúp gì cho bạn? Bạn có thể hỏi về số dư, hoạt động hoặc mô tả một Send, Swap hay Bridge.'
  }
  if (topic === 'greeting') return 'Hello 👋 I’m Makoto Agent. I can help you check assets, prepare Send, Swap, or Bridge actions on Arc.'
  if (topic === 'identity') return 'I’m Makoto Agent for Makotowallet.xyz. I read wallet data, prepare plans, and keep you in control of every wallet review and signature.'
  if (topic === 'capabilities') return 'I can read balances and activity, prepare Send, Swap, and Direct CCTP actions on Arc, then hand you to a review screen. I never hold keys or sign for you.'
  if (topic === 'thanks') return 'You’re welcome — I’m here to help.'
  if (topic === 'goodbye') return 'See you later. Your wallet remains the final signing authority.'
  if (topic === 'safety') return 'Makoto separates preparation, review, wallet request, hash, and receipt evidence. Deterministic Policy/Risk remains authoritative; model text cannot bypass it.'
  return providerUnavailable ? 'Chat service is temporarily unavailable, but wallet reads and local preparation flows are still available.' : 'How can I help? Ask about a balance or activity, or describe a Send, Swap, or Bridge request.'
}
