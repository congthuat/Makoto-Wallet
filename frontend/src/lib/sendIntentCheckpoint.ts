/**
 * Pending-intent checkpoint helpers for AgentSendCard.
 *
 * A checkpoint is written to sessionStorage BEFORE a wallet signing request is opened.
 * It is cleared only when the outcome is definitive (confirmed, failed, user-rejected).
 * On UNKNOWN (no receipt, or wallet errored without a hash) the checkpoint is left in
 * place so that a remounted card — or a card for a different intent — cannot overwrite
 * it and must block a second signing request until the user explicitly resolves it.
 *
 * Storage layout
 * ──────────────
 * Key:   'mk.send.intents.v1'
 * Value: JSON object — Record<intentKey, IntentCheckpoint>
 *
 * intentKey = `${account.lower()}:${chainId}:${recipient.lower()}:${symbol}:${amount}`
 *
 * Each unique (account × chainId × recipient × symbol × amount) combination has its
 * own slot in the map, so:
 *   - Intent B writing a checkpoint NEVER touches intent A's slot.
 *   - Clearing intent B NEVER affects intent A's unresolved checkpoint.
 *   - A remounted card for intent A always reads its own slot.
 *
 * writeIntent throws when:
 *   - sessionStorage is unavailable (SSR / private browsing / quota exceeded).
 *   - The same intent key already has an entry (overwrite guard — prevents a second
 *     wallet request for an already-uncertain intent from silently erasing the record).
 *     Callers MUST check readIntent and intentMatches BEFORE calling writeIntent, and
 *     MUST abort the wallet request if they get a non-null match.
 */

export const INTENTS_MAP_KEY = 'mk.send.intents.v1'

export type IntentCheckpoint = {
  account:   string
  chainId:   number
  recipient: string
  symbol:    string
  amount:    string
  savedAt:   number
}

type IntentsMap = Record<string, IntentCheckpoint>

/** Returns the storage key for an intent. Stable and case-normalised. */
export function intentKey(p: {
  account: string; chainId: number; recipient: string; symbol: string; amount: string
}): string {
  return `${p.account.toLowerCase()}:${p.chainId}:${p.recipient.toLowerCase()}:${p.symbol}:${p.amount}`
}

function readIntentsMap(storage: Storage | null): IntentsMap {
  try {
    if (!storage) return {}
    const raw = storage.getItem(INTENTS_MAP_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as IntentsMap
  } catch { return {} }
}

/** Read the checkpoint for a specific intent. Returns null if none exists. */
export function readIntent(
  storage: Storage | null,
  p: { account: string; chainId: number; recipient: string; symbol: string; amount: string },
): IntentCheckpoint | null {
  const map = readIntentsMap(storage)
  return map[intentKey(p)] ?? null
}

/**
 * Write a checkpoint for this intent.
 *
 * Throws when:
 *   - storage is null (unavailable).
 *   - An unresolved entry for the same key already exists (overwrite guard).
 *   - The underlying setItem call fails (quota exceeded, etc.).
 *
 * Callers MUST treat any throw as a hard abort and MUST NOT open the wallet.
 */
export function writeIntent(storage: Storage | null, cp: IntentCheckpoint): void {
  if (!storage) throw new Error('sessionStorage unavailable — cannot checkpoint intent')
  const key = intentKey(cp)
  const map = readIntentsMap(storage)
  if (map[key]) {
    throw new Error('Unresolved intent checkpoint exists — cannot overwrite')
  }
  map[key] = cp
  try { storage.setItem(INTENTS_MAP_KEY, JSON.stringify(map)) }
  catch { throw new Error('sessionStorage write failed — cannot checkpoint intent') }
}

/**
 * Clear the checkpoint for a specific intent (definitive outcome: confirmed, failed,
 * or user-rejected). Does NOT affect any other intent's checkpoint.
 * Best-effort — never throws.
 */
export function clearIntent(
  storage: Storage | null,
  p: { account: string; chainId: number; recipient: string; symbol: string; amount: string },
): void {
  try {
    if (!storage) return
    const map = readIntentsMap(storage)
    delete map[intentKey(p)]
    storage.setItem(INTENTS_MAP_KEY, JSON.stringify(map))
  } catch { /* best-effort */ }
}

/** Returns true if cp is non-null and describes the same intent as p. */
export function intentMatches(
  cp: IntentCheckpoint | null,
  p: { account: string; chainId: number; recipient: string; symbol: string; amount: string },
): boolean {
  if (!cp) return false
  return cp.account.toLowerCase() === p.account.toLowerCase()
    && cp.chainId === p.chainId
    && cp.recipient.toLowerCase() === p.recipient.toLowerCase()
    && cp.symbol === p.symbol
    && cp.amount === p.amount
}
