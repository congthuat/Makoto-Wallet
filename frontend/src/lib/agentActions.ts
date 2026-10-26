/**
 * Makoto "Action Buttons": deterministic, ranked next-step suggestions built from the
 * observed wallet state. No model is involved, nothing is executed, and every action
 * either navigates to an existing page or sends a prompt into the normal Agent flow,
 * where any write still needs planner validation, review, and the user's wallet signature.
 */
export type AgentActionIcon = 'bridge' | 'gas' | 'swap' | 'alert' | 'market' | 'portfolio' | 'wallet' | 'news' | 'recover'
export type AgentActionTarget =
  | { type: 'ask'; prompt: string }
  | { type: 'go'; page: 'bridge' | 'swap' | 'faucet' | 'tasks' | 'settings' | 'dashboard' }

/** `title`/`detail` are English source strings translated by the UI i18n layer; `{n}` is replaced with `value`. */
export type AgentAction = Readonly<{ id: string; icon: AgentActionIcon; title: string; detail: string; value?: string; priority: number; target: AgentActionTarget }>

export type AgentActionInput = Readonly<{
  mode: 'connected' | 'watch' | 'demo'
  walletChainId?: number
  balances: Readonly<Record<string, number>>
  activeTasks: number
  pendingBridge: boolean
  pendingSwap: boolean
  /** False while live balances are still loading; balance-based suggestions wait for real data. */
  balancesReady: boolean
}>

const ARC_CHAIN_ID = 5042002
/** Below this USDC (Arc native gas token) balance, gas may run out for a few transactions. */
export const LOW_GAS_USDC = 1
/** Idle USDC worth suggesting a bridge/swap for. */
export const IDLE_USDC = 5

const fmt = (value: number) => (value >= 1000 ? Math.floor(value).toLocaleString('en-US') : String(Math.floor(value * 100) / 100))

export function buildAgentActions(input: AgentActionInput, limit = 4): AgentAction[] {
  const actions: AgentAction[] = []
  const usdc = input.balances.USDC ?? 0
  const eurc = input.balances.EURC ?? 0
  const live = input.mode === 'connected'
  const known = input.balancesReady

  if (live && input.pendingBridge) actions.push({ id: 'recover-bridge', icon: 'recover', title: 'Finish your pending bridge', detail: 'A Circle transfer is waiting for status. Check it before starting another.', priority: 100, target: { type: 'go', page: 'bridge' } })
  if (live && input.pendingSwap) actions.push({ id: 'recover-swap', icon: 'recover', title: 'Check your pending swap', detail: 'A swap is waiting for its receipt. Check it before starting another.', priority: 95, target: { type: 'go', page: 'swap' } })
  if (live && input.walletChainId !== undefined && input.walletChainId !== ARC_CHAIN_ID) actions.push({ id: 'wrong-network', icon: 'wallet', title: 'Switch to Arc Testnet', detail: 'Your wallet is on another network. Makoto actions run on Arc Testnet.', priority: 90, target: { type: 'go', page: 'settings' } })
  if (input.mode === 'demo') actions.push({ id: 'connect', icon: 'wallet', title: 'Connect your wallet', detail: 'See your real balances and let Makoto prepare actions for your review.', priority: 85, target: { type: 'go', page: 'settings' } })
  if (live && known && usdc < LOW_GAS_USDC) actions.push({ id: 'low-gas', icon: 'gas', title: 'Low on gas — get test USDC', detail: 'USDC pays gas on Arc. Top up from the Circle faucet.', priority: 80, target: { type: 'go', page: 'faucet' } })
  if ((live || input.mode === 'watch') && known && usdc + eurc > 0) actions.push({ id: 'analyze-wallet', icon: 'portfolio', title: 'Analyze my wallet', detail: 'Live balances, USD value and recent activity in one summary.', priority: 60, target: { type: 'ask', prompt: 'Analyze my wallet: balances, USD value and recent activity.' } })
  if (live && known && !input.pendingBridge && usdc >= IDLE_USDC) actions.push({ id: 'bridge-idle', icon: 'bridge', title: 'Bridge USDC to Base Sepolia', detail: 'You hold {n} USDC on Arc. Check the Circle fee and review a bridge.', value: fmt(usdc), priority: 50, target: { type: 'ask', prompt: 'What does it cost to bridge USDC from Arc to Base Sepolia right now?' } })
  if (live && known && !input.pendingSwap && usdc >= IDLE_USDC && eurc === 0) actions.push({ id: 'swap-eurc', icon: 'swap', title: 'Diversify into EURC', detail: 'All your stablecoins are in USDC. Review a USDC → EURC swap.', priority: 45, target: { type: 'go', page: 'swap' } })
  if (live && input.activeTasks === 0) actions.push({ id: 'balance-alert', icon: 'alert', title: 'Set a balance alert', detail: 'Get notified when your USDC balance drops below a level you choose.', priority: 40, target: { type: 'ask', prompt: 'Alert me when my USDC balance drops below 10' } })
  actions.push({ id: 'market-brief', icon: 'market', title: 'Market brief for today', detail: 'BTC, ETH and top movers with the Fear & Greed index.', priority: 30, target: { type: 'ask', prompt: 'Give me a short crypto market brief for today: BTC, ETH, top movers and the Fear & Greed index.' } })
  actions.push({ id: 'news-circle', icon: 'news', title: 'Latest Circle & USDC news', detail: 'Recent headlines about Circle, USDC and Arc.', priority: 20, target: { type: 'ask', prompt: 'What is the latest news about Circle, USDC and Arc?' } })

  return actions.sort((a, b) => b.priority - a.priority).slice(0, Math.max(1, limit))
}

const PENDING_PHASES = new Set(['RECOVERING', 'PENDING', 'UNKNOWN', 'SUBMITTED', 'AWAITING_USER', 'SOURCE_CONFIRMED', 'DESTINATION_PENDING', 'FORWARDING_FAILED', 'DESTINATION_FAILED'])

/** Reads the saved protocol strategy checkpoint; unreadable storage is treated as "not pending". */
export function hasPendingStrategy(store: Pick<Storage, 'getItem'> | undefined, protocol: 'cctp' | 'swap', account: string | undefined): boolean {
  if (!store || !account) return false
  try {
    const raw = store.getItem(`mk.strategy.v1:${protocol}:${account.toLowerCase()}`)
    if (!raw) return false
    const phase = (JSON.parse(raw) as { phase?: unknown })?.phase
    return typeof phase === 'string' && PENDING_PHASES.has(phase)
  } catch { return false }
}
