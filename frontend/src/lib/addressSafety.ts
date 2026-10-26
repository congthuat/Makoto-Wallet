/**
 * Address-poisoning guard. Scammers send dust from an address whose first and last
 * characters match one you use, hoping you copy it from history. We compare the
 * recipient with addresses the user already knows (contacts and past recipients).
 * Deterministic and local; no network or model involved.
 */
export type KnownAddress = Readonly<{ address: string; label?: string }>
export type RecipientCheck =
  | Readonly<{ kind: 'known'; label?: string }>
  | Readonly<{ kind: 'lookalike'; similarTo: KnownAddress }>
  | Readonly<{ kind: 'first-time' }>
  | Readonly<{ kind: 'invalid' }>

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const PREFIX = 4
const SUFFIX = 4

export function checkRecipient(recipient: string, known: readonly KnownAddress[]): RecipientCheck {
  const value = recipient.trim()
  if (!ADDRESS.test(value)) return { kind: 'invalid' }
  const lower = value.toLowerCase()
  const valid = known.filter((entry) => ADDRESS.test(entry.address))
  const exact = valid.find((entry) => entry.address.toLowerCase() === lower)
  if (exact) return { kind: 'known', label: exact.label }
  const head = lower.slice(2, 2 + PREFIX)
  const tail = lower.slice(-SUFFIX)
  const similar = valid.find((entry) => {
    const other = entry.address.toLowerCase()
    return other.slice(2, 2 + PREFIX) === head && other.slice(-SUFFIX) === tail
  })
  return similar ? { kind: 'lookalike', similarTo: similar } : { kind: 'first-time' }
}

/** Contacts first (they carry names), then distinct past outgoing counterparties. */
export function knownAddresses(contacts: readonly { name: string; address: string }[], activity: readonly { direction?: string; counterparty?: string; counterpartyName?: string | null }[]): KnownAddress[] {
  const seen = new Set<string>()
  const out: KnownAddress[] = []
  for (const contact of contacts) {
    const key = contact.address.toLowerCase()
    if (ADDRESS.test(contact.address) && !seen.has(key)) { seen.add(key); out.push({ address: contact.address, label: contact.name }) }
  }
  for (const item of activity) {
    const address = item.counterparty ?? ''
    const key = address.toLowerCase()
    if (item.direction === 'out' && ADDRESS.test(address) && !seen.has(key)) { seen.add(key); out.push({ address, label: item.counterpartyName ?? undefined }) }
  }
  return out
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
