/**
 * Multi-step Agent plans (e.g. "swap 10 USDC to EURC then send 5 EURC to Lan").
 * A plan is only a checklist: every step is rebuilt as a canonical command,
 * re-parsed by the deterministic planner, reviewed and signed on its own, and a
 * step can start only after the previous step is confirmed on-chain.
 */
import { parseBrainRequest } from '../brain/parser.ts'
import type { BrainLocale } from '../brain/types.ts'
import { resolveContact, type ContactLike } from './agentMemory.ts'

export type PlanStep = Readonly<{
  kind: 'send' | 'swap' | 'bridge'
  asset: 'USDC' | 'EURC' | 'cirBTC'
  amount: string
  recipient?: string
  recipientContact?: string
  outputAsset?: 'USDC' | 'EURC'
}>
export type PlanStepStatus = 'waiting' | 'ready' | 'active' | 'done' | 'failed'

const AMOUNT = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ASSETS = ['USDC', 'EURC', 'cirBTC'] as const
export const MAX_PLAN_STEPS = 3

/** Shape-check one untrusted step (from the model or the local parser). */
export function parsePlanStep(value: unknown): PlanStep | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const asset = ASSETS.find((item) => item === v.asset)
  if (typeof v.amount !== 'string' || !AMOUNT.test(v.amount) || !(Number(v.amount) > 0) || !asset) return undefined
  if (v.kind === 'send') {
    if (typeof v.recipient === 'string' && ADDRESS.test(v.recipient)) return { kind: 'send', asset, amount: v.amount, recipient: v.recipient }
    const contact = typeof v.recipientContact === 'string' ? v.recipientContact.replace(/\s+/g, ' ').trim() : ''
    return contact && contact.length <= 40 ? { kind: 'send', asset, amount: v.amount, recipientContact: contact } : undefined
  }
  if (v.kind === 'swap') {
    if (asset === 'cirBTC' || (v.outputAsset !== 'USDC' && v.outputAsset !== 'EURC') || v.outputAsset === asset) return undefined
    return { kind: 'swap', asset, amount: v.amount, outputAsset: v.outputAsset }
  }
  if (v.kind === 'bridge' && asset === 'USDC') return { kind: 'bridge', asset, amount: v.amount }
  return undefined
}

export function parsePlan(value: unknown): PlanStep[] | undefined {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_PLAN_STEPS) return undefined
  const steps = value.map(parsePlanStep)
  return steps.every(Boolean) ? steps as PlanStep[] : undefined
}

/** Same sequential split the deterministic planner uses ("and then", "then", "sau đó", "rồi"). */
export function planStepsFromText(text: string, locale: BrainLocale): PlanStep[] | undefined {
  const parts = text.split(/\b(?:and then|then|sau đó|rồi)\b/i).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > MAX_PLAN_STEPS) return undefined
  const steps = parts.map((part) => {
    const prep = parseBrainRequest(part, locale).preparation
    if (!prep || prep.maxRequested) return undefined
    return parsePlanStep({ kind: prep.kind, asset: prep.asset ?? (prep.kind === 'bridge' ? 'USDC' : undefined), amount: prep.amount, recipient: prep.recipient, outputAsset: prep.outputAsset })
  })
  return steps.every(Boolean) ? steps as PlanStep[] : undefined
}

/** Canonical English command for planBrainRequest; contacts are resolved locally. */
export function stepCommand(step: PlanStep, contacts: readonly ContactLike[]): { ok: true; command: string; contactName?: string } | { ok: false; reason: 'contact-not-found' | 'contact-ambiguous'; name: string } {
  if (step.kind === 'swap') return { ok: true, command: `swap ${step.amount} ${step.asset} to ${step.outputAsset}` }
  if (step.kind === 'bridge') return { ok: true, command: `bridge ${step.amount} USDC from Arc Testnet to Base Sepolia` }
  if (step.recipient) return { ok: true, command: `send ${step.amount} ${step.asset} to ${step.recipient}` }
  const name = step.recipientContact ?? ''
  const resolved = resolveContact(name, contacts)
  if (!resolved.ok) return { ok: false, reason: resolved.reason === 'ambiguous' ? 'contact-ambiguous' : 'contact-not-found', name }
  return { ok: true, command: `send ${step.amount} ${step.asset} to ${resolved.contact.address}`, contactName: resolved.contact.name }
}

/** Status of each step: only the first not-done step can be started, and only when nothing is active. */
export function planStatuses(done: readonly boolean[], activeIndex: number | undefined, failedIndex: number | undefined): PlanStepStatus[] {
  const firstOpen = done.findIndex((value) => !value)
  return done.map((isDone, index) => {
    if (isDone) return 'done'
    if (index === activeIndex) return 'active'
    if (index === failedIndex) return 'failed'
    return index === firstOpen && activeIndex === undefined ? 'ready' : 'waiting'
  })
}

export function describeStep(step: PlanStep, vi: boolean): string {
  if (step.kind === 'swap') return vi ? `Đổi ${step.amount} ${step.asset} sang ${step.outputAsset}` : `Swap ${step.amount} ${step.asset} to ${step.outputAsset}`
  if (step.kind === 'bridge') return vi ? `Bridge ${step.amount} USDC sang Base Sepolia` : `Bridge ${step.amount} USDC to Base Sepolia`
  const who = step.recipientContact ?? (step.recipient ? `${step.recipient.slice(0, 6)}…${step.recipient.slice(-4)}` : '?')
  return vi ? `Gửi ${step.amount} ${step.asset} cho ${who}` : `Send ${step.amount} ${step.asset} to ${who}`
}
