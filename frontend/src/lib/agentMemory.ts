/**
 * Makoto Agent memory, stored only in this browser (localStorage).
 * - notes: short preferences the user explicitly asked the Agent to remember
 * - preferences: small structured choices learned from use (e.g. bridge speed)
 * Contacts live in the existing address book (mk.contacts). Only contact NAMES and
 * notes are sent to the Agent; addresses are resolved locally, never by the model.
 */
export type AgentNote = Readonly<{ id: string; text: string; createdAt: number }>
export type AgentPreferences = Readonly<{ bridgeSpeed?: 'FAST' | 'SLOW' }>
export type AgentMemory = Readonly<{ version: 1; notes: readonly AgentNote[]; preferences: AgentPreferences }>
export type ContactLike = Readonly<{ name: string; address: string }>

export const AGENT_MEMORY_KEY = 'mk.agent.memory.v1'
export const MAX_AGENT_NOTES = 10
const EMPTY: AgentMemory = Object.freeze({ version: 1, notes: Object.freeze([]), preferences: Object.freeze({}) })
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SECRET_HINT = /0x[0-9a-fA-F]{40}|seed|mnemonic|private key|khóa riêng|cụm từ khôi phục/i

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

export function loadAgentMemory(store: Pick<Storage, 'getItem'> | undefined): AgentMemory {
  try {
    const raw = store?.getItem(AGENT_MEMORY_KEY)
    if (!raw) return EMPTY
    const value = JSON.parse(raw) as Partial<AgentMemory>
    const notes = Array.isArray(value?.notes)
      ? value.notes.flatMap((note) => note && typeof note.id === 'string' && cleanText(note.text, 200) ? [{ id: note.id, text: cleanText(note.text, 200), createdAt: Number(note.createdAt) || 0 }] : []).slice(-MAX_AGENT_NOTES)
      : []
    const speed = value?.preferences?.bridgeSpeed
    return { version: 1, notes, preferences: speed === 'FAST' || speed === 'SLOW' ? { bridgeSpeed: speed } : {} }
  } catch { return EMPTY }
}

export function saveAgentMemory(store: Pick<Storage, 'setItem'> | undefined, memory: AgentMemory): boolean {
  try { store?.setItem(AGENT_MEMORY_KEY, JSON.stringify(memory)); return Boolean(store) } catch { return false }
}

/** Adds a note (deduplicated, newest kept, capped). Secrets and addresses are refused. */
export function addNote(memory: AgentMemory, text: string, now = Date.now(), id = `n${now}${Math.random().toString(36).slice(2, 7)}`): { memory: AgentMemory; note?: AgentNote } {
  const clean = cleanText(text, 200)
  if (!clean || SECRET_HINT.test(clean)) return { memory }
  const existing = memory.notes.find((note) => note.text.toLocaleLowerCase() === clean.toLocaleLowerCase())
  if (existing) return { memory, note: existing }
  const note: AgentNote = { id, text: clean, createdAt: now }
  return { memory: { ...memory, notes: [...memory.notes, note].slice(-MAX_AGENT_NOTES) }, note }
}

export const removeNote = (memory: AgentMemory, id: string): AgentMemory => ({ ...memory, notes: memory.notes.filter((note) => note.id !== id) })
export const setBridgeSpeed = (memory: AgentMemory, speed: 'FAST' | 'SLOW'): AgentMemory => ({ ...memory, preferences: { ...memory.preferences, bridgeSpeed: speed } })

const normalizeName = (value: string) => value.normalize('NFC').toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ').trim()

/** Exact (case/space-insensitive) name match; ambiguous names never resolve. */
export function resolveContact(name: string, contacts: readonly ContactLike[]): { ok: true; contact: ContactLike } | { ok: false; reason: 'not-found' | 'ambiguous' } {
  const wanted = normalizeName(name)
  const matches = contacts.filter((contact) => ADDRESS.test(contact.address) && normalizeName(contact.name) === wanted)
  if (matches.length === 1) return { ok: true, contact: matches[0] }
  const unique = new Set(matches.map((contact) => contact.address.toLowerCase()))
  if (matches.length > 1 && unique.size === 1) return { ok: true, contact: matches[0] }
  return { ok: false, reason: matches.length ? 'ambiguous' : 'not-found' }
}

/** What the Agent backend receives: notes, contact names (no addresses), preferences. */
export function memoryForRequest(memory: AgentMemory, contacts: readonly ContactLike[]) {
  const names = [...new Set(contacts.map((contact) => cleanText(contact.name, 40)).filter(Boolean))].slice(0, 50)
  const notes = memory.notes.map((note) => note.text)
  const preferences = memory.preferences.bridgeSpeed ? { bridgeSpeed: memory.preferences.bridgeSpeed } : {}
  if (!names.length && !notes.length && !preferences.bridgeSpeed) return undefined
  return { notes, contacts: names, preferences }
}

/** A contact save requested by the Agent; the user must confirm it in the UI. */
export function contactSaveCheck(name: string, address: string, contacts: readonly ContactLike[]): 'ok' | 'invalid' | 'duplicate-address' | 'duplicate-name' {
  if (!cleanText(name, 40) || !ADDRESS.test(address)) return 'invalid'
  if (contacts.some((contact) => contact.address.toLowerCase() === address.toLowerCase())) return 'duplicate-address'
  if (contacts.some((contact) => normalizeName(contact.name) === normalizeName(name))) return 'duplicate-name'
  return 'ok'
}

/**
 * Finds a saved contact named in a request such as "gửi 2 USDC cho Nam" / "send 2 USDC to Lan Anh".
 * The name must follow a recipient word and match exactly one contact (longest name wins).
 */
export function contactInText(text: string, contacts: readonly ContactLike[]): ContactLike | undefined {
  const normalized = ` ${normalizeName(text).replace(/[.,!?;:"“”()]/g, ' ')} `
  const candidates = contacts
    .filter((contact) => ADDRESS.test(contact.address) && normalizeName(contact.name))
    .filter((contact) => {
      const name = normalizeName(contact.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`\\s(?:cho|tới|đến|to|for)\\s+${name}(?:\\s|$)`, 'u').test(normalized)
    })
    .sort((a, b) => normalizeName(b.name).length - normalizeName(a.name).length)
  if (!candidates.length) return undefined
  const best = normalizeName(candidates[0].name)
  const same = candidates.filter((contact) => normalizeName(contact.name) === best)
  const unique = new Set(same.map((contact) => contact.address.toLowerCase()))
  return unique.size === 1 ? same[0] : undefined
}
