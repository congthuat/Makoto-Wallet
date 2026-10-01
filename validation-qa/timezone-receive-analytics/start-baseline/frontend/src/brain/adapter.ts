import type { Lang } from '../lib/i18n'
import { parseBrainRequest } from './parser'
import { routeBrainIntent } from './orchestration'
import type { BrainContext, BrainPreparation } from './types'

export type BrainUiPlan = Readonly<{
  intent: ReturnType<typeof parseBrainRequest>
  decision: ReturnType<typeof routeBrainIntent>
  action?: BrainPreparation
}>

export function planBrainRequest(text: string, lang: Lang, _context?: BrainContext): BrainUiPlan {
  const locale = lang === 'vi' ? 'vi' : 'en'
  const intent = parseBrainRequest(text, locale)
  const decision = routeBrainIntent(intent)
  return Object.freeze({ intent, decision, ...(intent.preparation ? { action: intent.preparation } : {}) })
}

export const BRAIN_INVARIANTS = Object.freeze([
  'Makoto never stores or receives a seed phrase/private key.',
  'Agent output is prepare-only; the connected wallet remains the signing authority.',
  'Every write must pass review and revalidation immediately before a wallet request.',
  'MAX is never accepted from Agent preparation; use the manual flow.',
  'A quote, simulation, wallet request, source-chain bridge submission, and destination completion are different states.',
  'Unknown or stale evidence must never be displayed as success.',
])
