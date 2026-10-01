export type AgentSuggestionMode = 'ask' | 'monitor' | 'automation'
export type AgentSuggestionLocale = 'en' | 'vi'
export type AgentSuggestion = Readonly<{ id: string; text: string }>

type LocalizedSuggestion = Readonly<{ id: string; en: string; vi: string }>

// These are ordinary user inputs. Keep the visible text and submitted text identical.
// Monitors use token thresholds; scheduled reads use the current daily scheduler.
const suggestions: Readonly<Record<AgentSuggestionMode, readonly LocalizedSuggestion[]>> = {
  ask: [
    { id: 'portfolio-value', en: 'What is my portfolio worth right now?', vi: 'Danh mục của tôi hiện trị giá bao nhiêu?' },
    { id: 'holdings', en: 'What assets am I currently holding?', vi: 'Tôi đang nắm giữ những tài sản nào?' },
    { id: 'recent-activity', en: 'Show me my recent transactions', vi: 'Cho tôi xem các giao dịch gần đây' },
    { id: 'token-balances', en: 'What are my current USDC, EURC and cirBTC balances?', vi: 'USDC, EURC và cirBTC của tôi hiện có số dư bao nhiêu?' },
    { id: 'network-status', en: 'What is the current Arc network status?', vi: 'Tình trạng mạng Arc hiện tại thế nào?' },
  ],
  monitor: [
    { id: 'usdc-below-100', en: 'Notify me when my USDC balance falls below 100', vi: 'Báo tôi khi số dư USDC xuống dưới 100' },
    { id: 'eurc-below-50', en: 'Notify me when my EURC balance falls below 50', vi: 'Báo tôi khi số dư EURC xuống dưới 50' },
    { id: 'cirbtc-below-001', en: 'Notify me when my cirBTC balance falls below 0.01', vi: 'Báo tôi khi số dư cirBTC xuống dưới 0.01' },
    { id: 'usdc-above-1000', en: 'Notify me when my USDC balance rises above 1000', vi: 'Báo tôi khi số dư USDC lên trên 1000' },
    { id: 'eurc-above-200', en: 'Notify me when my EURC balance rises above 200', vi: 'Báo tôi khi số dư EURC lên trên 200' },
  ],
  automation: [
    { id: 'portfolio-morning', en: 'Send me a portfolio summary every day at 08:00', vi: 'Gửi tôi tóm tắt danh mục lúc 08:00 mỗi ngày' },
    { id: 'activity-evening', en: 'Summarize my wallet activity every day at 20:00', vi: 'Tóm tắt hoạt động ví cho tôi lúc 20:00 mỗi ngày' },
    { id: 'balances-morning', en: 'Show me my USDC, EURC and cirBTC balances every day at 08:00', vi: 'Cho tôi biết số dư USDC, EURC và cirBTC lúc 08:00 mỗi ngày' },
    { id: 'portfolio-evening', en: 'Send me a portfolio summary every day at 20:00', vi: 'Gửi tôi tóm tắt danh mục lúc 20:00 mỗi ngày' },
    { id: 'transactions-evening', en: "Summarize today's wallet transactions every day at 21:00", vi: 'Tóm tắt giao dịch ví hôm nay lúc 21:00 mỗi ngày' },
  ],
}

/** Locale comes from app state. There is no normalized or hidden command payload. */
export function getAgentSuggestions(mode: AgentSuggestionMode, locale: AgentSuggestionLocale): readonly AgentSuggestion[] {
  return suggestions[mode].map(({ id, en, vi }) => ({ id, text: locale === 'vi' ? vi : en }))
}
