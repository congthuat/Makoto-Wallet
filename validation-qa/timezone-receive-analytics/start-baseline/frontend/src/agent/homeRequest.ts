import { parseBrainRequest } from '../brain/parser.ts'
import type { BrainLocale } from '../brain/types.ts'
import { planAgentRequest } from '../migrated/planner.ts'
import { readActivitySnapshot, readAgentNetworkSnapshot, readAgentWalletSnapshot, readWallet, type ToolResult, type WalletObservation } from '../migrated/toolLayer.ts'
import { ARC, fmtAmt, getProvider, usd, type Holding, type NetworkInfo, type Tx } from '../lib/wallet.ts'
import { taskIntentMode } from '../lib/tasks.ts'
import { agentStatusLabel } from '../lib/agentPresentation.ts'

export type HomeMode = 'ask' | 'monitor' | 'automation'
export type QuickQuery = 'portfolio' | 'holdings' | 'balances' | 'activity' | 'network'
type RequestBase = Readonly<{ originalText: string; plannerText: string; locale: BrainLocale }>
export type HomeRequest = RequestBase & (
  | Readonly<{ route: 'INLINE'; query: QuickQuery; normalizedIntent: string; symbols: readonly string[]; limit: number }>
  | Readonly<{ route: 'AGENT'; taskMode: 'monitor' | 'automation' | null }>
)

/** Only a proven single deterministic read belongs on Home. Original input is
 * display/history truth; normalizedIntent is an internal classification only. */
export function routeHomeRequest(originalText: string, locale: BrainLocale, mode: HomeMode = 'ask'): HomeRequest {
  const base = { originalText, plannerText: originalText, locale }
  const taskMode = mode === 'ask' ? taskIntentMode(originalText) : mode
  if (taskMode) return Object.freeze({ ...base, route: 'AGENT', taskMode })
  const plan = planAgentRequest(originalText, locale)
  const intent = parseBrainRequest(originalText, locale)
  if (plan.status !== 'INFORMATION' || !['wallet-overview', 'recent-activity', 'network-status'].includes(intent.kind)) return Object.freeze({ ...base, route: 'AGENT', taskMode: null })
  const text = originalText.toLocaleLowerCase('vi-VN').normalize('NFC')
  const query: QuickQuery = intent.kind === 'recent-activity' ? 'activity' : intent.kind === 'network-status' ? 'network'
    : /portfolio|worth|value|danh mục|trị giá/.test(text) ? 'portfolio'
      : /assets|holdings|holding|tài sản/.test(text) ? 'holdings' : 'balances'
  const symbols = ['USDC', 'EURC', 'cirBTC'].filter((symbol) => text.includes(symbol.toLowerCase()))
  return Object.freeze({ ...base, route: 'INLINE', query, normalizedIntent: intent.kind, symbols: Object.freeze(symbols), limit: Math.min(intent.limit ?? 3, 3) })
}

export type QuickReadContext = Readonly<{
  mode: 'demo' | 'watch' | 'connected'; address: string; walletChainId?: number;
  holdings: readonly Holding[]; activity: readonly Tx[]; total: number; pricesReady: boolean;
  loading: boolean; walletError?: string | null; balanceError?: string | null;
  network?: NetworkInfo; networkError: boolean;
}>
export type QuickAnswer = Readonly<{
  query: QuickQuery; status: 'OK' | 'PARTIAL' | 'STALE' | 'UNAVAILABLE';
  source: string; reason?: 'address' | 'identity' | 'balances' | 'activity' | 'network' | 'loading';
  scope?: Readonly<Pick<QuickReadContext, 'mode' | 'address' | 'walletChainId'>>;
  holdings?: readonly Holding[]; activity?: readonly Tx[]; totalUsd?: number; network?: NetworkInfo;
}>
type QuickDependencies = Readonly<{ now?: () => number; readWalletIdentity?: () => Promise<ToolResult<WalletObservation>> }>

const unavailable = (query: QuickQuery, reason: QuickAnswer['reason'], source: string, status: QuickAnswer['status'] = 'UNAVAILABLE'): QuickAnswer => Object.freeze({ query, reason, source, status })

export async function readHomeAnswer(request: Extract<HomeRequest, { route: 'INLINE' }>, context: QuickReadContext, dependencies: QuickDependencies = {}): Promise<QuickAnswer> {
  const observedAt = (dependencies.now ?? Date.now)()
  if (request.query === 'network') {
    const result = readAgentNetworkSnapshot(context.network, { error: context.networkError, observedAt })
    return result.status === 'OK' && result.data ? Object.freeze({ query: request.query, status: 'OK', source: result.source, network: result.data }) : unavailable(request.query, 'network', result.source, result.status === 'STALE' ? 'STALE' : 'UNAVAILABLE')
  }
  if (context.mode === 'demo' || !context.address) return unavailable(request.query, 'address', 'arc-wallet-snapshot')
  // Revalidate a connected account through the selected provider. Watch-only
  // reads use the API-bound public address and never request a wallet/signer.
  if (context.mode === 'connected') {
    const provider = getProvider()
    const identity = dependencies.readWalletIdentity ? await dependencies.readWalletIdentity() : provider ? await readWallet(provider) : undefined
    if (!identity?.data || identity.status !== 'OK' || identity.data.account.toLowerCase() !== context.address.toLowerCase() || identity.data.chainId !== ARC.chainId || context.walletChainId !== ARC.chainId) return unavailable(request.query, 'identity', 'eip-1193')
  }
  const scope = Object.freeze({ mode: context.mode, address: context.address, walletChainId: context.walletChainId })
  if (request.query === 'activity') {
    const result = readActivitySnapshot(context.activity, { connected: true, loading: context.loading, error: context.walletError, observedAt })
    return result.status === 'OK' && result.data ? Object.freeze({ query: request.query, status: 'OK', source: result.source, scope, activity: Object.freeze(result.data.slice(0, request.limit).map((entry) => Object.freeze({ ...entry }))) }) : unavailable(request.query, result.status === 'STALE' ? 'loading' : 'activity', result.source, result.status === 'STALE' ? 'STALE' : 'UNAVAILABLE')
  }
  const result = readAgentWalletSnapshot({ ...context, observedAt })
  if (result.status !== 'OK' || !result.data) return unavailable(request.query, result.status === 'STALE' ? 'loading' : 'balances', result.source, result.status === 'STALE' ? 'STALE' : 'UNAVAILABLE')
  const holdings = result.data.holdings.filter((holding) => request.query === 'holdings' ? holding.balance > 0 : request.query !== 'balances' || !request.symbols.length || request.symbols.includes(holding.symbol))
  return Object.freeze({ query: request.query, status: request.query === 'portfolio' && result.data.totalUsd === undefined ? 'PARTIAL' : 'OK', source: result.source, scope, holdings: Object.freeze(holdings), totalUsd: result.data.totalUsd })
}

/** Render data in the current app locale; user text is never translated. */
export function renderHomeAnswer(answer: QuickAnswer, locale: BrainLocale, mask: (value: string) => string = (value) => value, currentContext?: Pick<QuickReadContext, 'mode' | 'address' | 'walletChainId'>): { text: string; rows: readonly [string, string][] } {
  if (answer.scope && currentContext && (answer.scope.mode !== currentContext.mode || answer.scope.address.toLowerCase() !== currentContext.address.toLowerCase() || answer.scope.walletChainId !== currentContext.walletChainId)) return renderHomeAnswer(unavailable(answer.query, 'identity', answer.source), locale, mask)
  const vi = locale === 'vi'
  if (answer.status === 'UNAVAILABLE' || answer.status === 'STALE') {
    const text = answer.reason === 'address' ? vi ? 'Kết nối ví hoặc theo dõi một địa chỉ để xem dữ liệu thật.' : 'Connect a wallet or watch an address to read live data.'
      : answer.reason === 'identity' ? vi ? 'Tài khoản hoặc mạng ví đã thay đổi. Hãy kết nối đúng ví trên Arc Testnet rồi thử lại.' : 'Wallet account or network changed. Connect the intended wallet on Arc Testnet and try again.'
        : answer.reason === 'loading' ? vi ? 'Dữ liệu ví đang cập nhật. Hãy thử lại sau ít giây.' : 'Wallet data is updating. Try again in a moment.'
          : answer.reason === 'network' ? vi ? 'Dữ liệu mạng Arc hiện chưa khả dụng. Hãy thử lại.' : 'Current Arc network data is unavailable. Try again.'
            : answer.reason === 'activity' ? vi ? 'Hoạt động ví hiện chưa khả dụng. Hãy thử lại.' : 'Wallet activity is currently unavailable. Try again.'
              : vi ? 'Số dư đã xác minh hiện chưa khả dụng. Hãy thử lại.' : 'Verified wallet balances are currently unavailable. Try again.'
    return { text, rows: [] }
  }
  if (answer.query === 'network' && answer.network) return {
    text: vi ? `Arc Testnet đang trực tuyến. Khối mới nhất: #${answer.network.blockNumber.toLocaleString('vi-VN')}.` : `Arc Testnet is online. Latest block: #${answer.network.blockNumber.toLocaleString('en-US')}.`,
    rows: [],
  }
  if (answer.query === 'activity') {
    const entries = answer.activity ?? []
    const statuses: Record<string, string> = vi ? { Confirmed: 'Đã xác nhận', Submitted: 'Đã gửi', Pending: 'Đang chờ', Failed: 'Thất bại', 'Status unknown': 'Chưa rõ trạng thái', 'Wallet request cancelled': 'Đã hủy yêu cầu ví', Completed: 'Hoàn tất' } : {}
    const kinds = vi ? { send: 'Gửi', receive: 'Nhận', swap: 'Hoán đổi', bridge: 'Chuyển chuỗi' } : { send: 'Send', receive: 'Receive', swap: 'Swap', bridge: 'Bridge' }
    return { text: entries.length ? vi ? `${entries.length} giao dịch gần đây của bạn:` : `Your ${entries.length} recent transactions:` : vi ? 'Chưa có giao dịch được ghi nhận cho địa chỉ này.' : 'No transactions have been observed for this address.', rows: entries.map((entry) => {
      const label = agentStatusLabel(entry.status)
      return [`${kinds[entry.kind ?? (entry.direction === 'in' ? 'receive' : 'send')]} ${entry.symbol}`, `${mask(fmtAmt(entry.amount))} · ${statuses[label] ?? label}`] as [string, string]
    }) }
  }
  const holdings = answer.holdings ?? []
  const rows = holdings.slice(0, 3).map((holding): [string, string] => [holding.symbol, mask(fmtAmt(holding.balance, holding.decimals))])
  if (answer.query === 'portfolio') return { text: answer.totalUsd === undefined ? vi ? 'Số dư đã xác minh bên dưới; giá hiện chưa khả dụng để tính tổng danh mục.' : 'Verified balances are below; current pricing is unavailable for a complete portfolio total.' : vi ? `Tổng danh mục hiện tại của bạn là ${mask(usd(answer.totalUsd))}.` : `Your portfolio is currently worth ${mask(usd(answer.totalUsd))}.`, rows }
  if (answer.query === 'holdings') return { text: holdings.length ? vi ? 'Các tài sản bạn đang nắm giữ:' : 'Your current holdings:' : vi ? 'Bạn chưa có số dư trong các tài sản đã xác minh.' : 'You have no balance in the verified assets.', rows }
  return { text: vi ? 'Số dư hiện tại đã xác minh của bạn:' : 'Your current verified balances:', rows }
}
