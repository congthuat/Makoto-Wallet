import type { BrainHandoff, BrainPreparation } from './types'

export const BRAIN_HANDOFF_TTL_MS = 5 * 60_000
const KEY = 'mk.brain.handoff.v1'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const validAddress = (value: string | undefined) => Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value))

export function createBrainHandoff(action: BrainPreparation, account: string, now = Date.now()): BrainHandoff | undefined {
  if (!validAddress(account) || !action.amount) return undefined
  return Object.freeze({
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    source: 'makoto-agent',
    action: action.kind,
    account,
    createdAt: now,
    expiresAt: now + BRAIN_HANDOFF_TTL_MS,
    amount: action.amount,
    asset: action.asset,
    outputAsset: action.outputAsset,
    recipient: action.recipient,
    sourceChain: action.sourceChain,
    destinationChain: action.destinationChain,
  })
}

export function storeBrainHandoff(store: Store, handoff: BrainHandoff) { store.setItem(KEY, JSON.stringify(handoff)) }

/** One-time, account-bound consume. Payload is removed before validation to fail closed on replay. */
export function consumeBrainHandoff(store: Store, account: string | undefined, now = Date.now()): BrainHandoff | undefined {
  const raw = store.getItem(KEY)
  store.removeItem(KEY)
  if (!raw || !validAddress(account)) return undefined
  try {
    const item = JSON.parse(raw) as BrainHandoff
    if (item.source !== 'makoto-agent' || !validAddress(item.account) || item.account.toLowerCase() !== account!.toLowerCase()) return undefined
    if (!Number.isFinite(item.createdAt) || !Number.isFinite(item.expiresAt) || now < item.createdAt || now > item.expiresAt) return undefined
    if (!['send', 'swap', 'bridge'].includes(item.action) || !item.amount || Number(item.amount) <= 0) return undefined
    return Object.freeze(item)
  } catch { return undefined }
}
