/** Adapted from donor Phase 12 guarded state and historical persistence boundaries. */
export type AgentSessionStage = 'REQUESTED' | 'PLAN_READY' | 'REVIEW_READY' | 'HANDED_OFF' | 'BLOCKED' | 'EXPIRED'
export type AgentSession = Readonly<{ version: 1; id: string; stage: AgentSessionStage; account?: string; planId?: string; reviewExpiresAt?: number; updatedAt: number; reason?: string }>
export type AgentEvent =
  | Readonly<{ type: 'plan-ready'; planId: string; now: number }>
  | Readonly<{ type: 'review-ready'; account: string; expiresAt: number; now: number }>
  | Readonly<{ type: 'handed-off'; account: string; now: number }>
  | Readonly<{ type: 'blocked' | 'expired'; reason: string; now: number }>
export type AgentTransition = Readonly<{ accepted: true; state: AgentSession } | { accepted: false; reason: string }>
const id = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
const address = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)

export function createAgentSession(sessionId: string, now = Date.now()): AgentSession {
  if (!id(sessionId) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid Agent session')
  return Object.freeze({ version: 1, id: sessionId, stage: 'REQUESTED', updatedAt: now })
}

export function transitionAgentSession(current: AgentSession, event: AgentEvent): AgentTransition {
  if (!Number.isSafeInteger(event.now) || event.now < current.updatedAt) return { accepted: false, reason: 'Invalid observation time' }
  if (current.stage === 'REQUESTED' && event.type === 'plan-ready' && id(event.planId)) return { accepted: true, state: Object.freeze({ ...current, stage: 'PLAN_READY', planId: event.planId, updatedAt: event.now }) }
  if (current.stage === 'PLAN_READY' && event.type === 'review-ready' && address(event.account) && event.expiresAt > event.now) return { accepted: true, state: Object.freeze({ ...current, stage: 'REVIEW_READY', account: event.account.toLowerCase(), reviewExpiresAt: event.expiresAt, updatedAt: event.now }) }
  if (current.stage === 'REVIEW_READY' && event.type === 'handed-off' && current.account === event.account.toLowerCase() && current.reviewExpiresAt !== undefined && event.now <= current.reviewExpiresAt) return { accepted: true, state: Object.freeze({ ...current, stage: 'HANDED_OFF', updatedAt: event.now }) }
  if (['REQUESTED', 'PLAN_READY', 'REVIEW_READY'].includes(current.stage) && (event.type === 'blocked' || event.type === 'expired') && event.reason.trim()) return { accepted: true, state: Object.freeze({ ...current, stage: event.type === 'blocked' ? 'BLOCKED' : 'EXPIRED', reason: event.reason, updatedAt: event.now }) }
  return { accepted: false, reason: 'Illegal Agent transition or stale evidence' }
}

const prefix = 'mk.agent.session.v1'
const latest = (account: string) => `${prefix}:latest:${account.toLowerCase()}`
/** A restored state is descriptive history, never a live review or handoff. */
export function storeAgentSession(store: Pick<Storage, 'setItem'>, state: AgentSession, account: string): boolean {
  if (!address(account) || state.account && state.account !== account.toLowerCase()) return false
  try { store.setItem(`${prefix}:${account.toLowerCase()}:${state.id}`, JSON.stringify(state)); return true } catch { return false }
}
export function restoreAgentSession(store: Pick<Storage, 'getItem'>, sessionId: string, account: string): { status: 'HISTORICAL'; state: AgentSession } | { status: 'ABSENT' | 'INVALID' } {
  if (!id(sessionId) || !address(account)) return { status: 'INVALID' }
  try {
    const raw = store.getItem(`${prefix}:${account.toLowerCase()}:${sessionId}`)
    if (!raw) return { status: 'ABSENT' }
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'INVALID' }
    const state = value as AgentSession
    if (state.version !== 1 || state.id !== sessionId || !['REQUESTED', 'PLAN_READY', 'REVIEW_READY', 'HANDED_OFF', 'BLOCKED', 'EXPIRED'].includes(state.stage) || !Number.isSafeInteger(state.updatedAt) || state.account && state.account !== account.toLowerCase() || Object.keys(state).some((key) => !['version', 'id', 'stage', 'account', 'planId', 'reviewExpiresAt', 'updatedAt', 'reason'].includes(key))) return { status: 'INVALID' }
    return { status: 'HISTORICAL', state }
  } catch { return { status: 'INVALID' } }
}

/** The pointer and historical snapshot contain no signer, review object or handoff token. */
export function rememberAgentSession(store: Pick<Storage, 'getItem' | 'setItem'>, state: AgentSession, account: string): boolean {
  if (!storeAgentSession(store, state, account)) return false
  try { store.setItem(latest(account), state.id); return true } catch { return false }
}
export function recoverLatestAgentSession(store: Pick<Storage, 'getItem'>, account: string): { status: 'HISTORICAL'; state: AgentSession } | { status: 'ABSENT' | 'INVALID' } {
  if (!address(account)) return { status: 'INVALID' }
  try { const sessionId = store.getItem(latest(account)); return sessionId ? restoreAgentSession(store, sessionId, account) : { status: 'ABSENT' } } catch { return { status: 'INVALID' } }
}
