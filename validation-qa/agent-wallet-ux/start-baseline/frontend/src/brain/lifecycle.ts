import type { BrainLifecycle, BrainLifecycleStage } from './types'

export const initialBrainLifecycle = (now = Date.now()): BrainLifecycle => Object.freeze({ stage: 'prepared', updatedAt: now, retrySafe: true })

const LEGAL: Record<BrainLifecycleStage, readonly BrainLifecycleStage[]> = {
  prepared: ['awaiting-wallet', 'failed'],
  'awaiting-wallet': ['submitted', 'failed'],
  submitted: ['confirming', 'confirmed', 'failed', 'unknown'],
  confirming: ['confirmed', 'failed', 'unknown'],
  confirmed: [],
  failed: ['prepared'],
  unknown: ['confirming', 'confirmed', 'failed'],
}

export function transitionBrainLifecycle(current: BrainLifecycle, next: BrainLifecycleStage, options: { hash?: string; message?: string; now?: number } = {}): BrainLifecycle {
  if (!LEGAL[current.stage].includes(next)) return current
  const retrySafe = next === 'prepared' || next === 'failed' && !current.hash
  return Object.freeze({ stage: next, ...(options.hash ?? current.hash ? { hash: options.hash ?? current.hash } : {}), ...(options.message ? { message: options.message } : {}), updatedAt: options.now ?? Date.now(), retrySafe })
}

export function classifyBrainWalletFailure(error: unknown, hashSubmitted = false): 'cancelled' | 'failed' | 'unknown' {
  const message = error instanceof Error ? error.message : String(error)
  if (/reject|denied|cancel|4001/i.test(message)) return 'cancelled'
  return hashSubmitted ? 'unknown' : 'failed'
}
