import { ARC } from '../lib/wallet.ts'
import type { BrainCheck, BrainContext, BrainPreparation, BrainReviewSnapshot, BrainSafetyAssessment } from './types'

const ADDRESS = /^0x[a-fA-F0-9]{40}$/
const ZERO = '0x0000000000000000000000000000000000000000'
const REVIEW_TTL_MS = 60_000

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

/** Stable mutation detector. This is not used as a signing primitive. */
export function brainFingerprint(value: unknown) {
  const input = canonical(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `brain-${hash.toString(16).padStart(8, '0')}-${input.length}`
}

function check(code: string, status: BrainCheck['status'], message: string): BrainCheck { return Object.freeze({ code, status, message }) }

export function assessPreparation(action: BrainPreparation, context: BrainContext): BrainSafetyAssessment {
  const now = context.now ?? Date.now()
  const checks: BrainCheck[] = []

  checks.push(context.connected ? check('wallet-connected', 'pass', 'Wallet connected') : check('wallet-connected', 'unknown', 'Connect a wallet before requesting a signature'))
  if (context.connected) checks.push(context.chainId === ARC.chainId ? check('network-match', 'pass', `Arc Testnet · ${ARC.chainId}`) : check('network-match', 'blocked', 'Wrong network: Arc Testnet is required'))

  if (action.maxRequested) checks.push(check('agent-max', 'blocked', 'Agent MAX requests are blocked; use the manual flow'))
  if (!action.amount || !/^\d+(?:\.\d+)?$/.test(action.amount) || Number(action.amount) <= 0) checks.push(check('amount-valid', 'blocked', 'Enter a positive amount'))
  else checks.push(check('amount-valid', 'pass', 'Amount is valid'))

  if (action.kind === 'send') {
    if (!action.recipient || !ADDRESS.test(action.recipient) || action.recipient.toLowerCase() === ZERO) checks.push(check('recipient-valid', 'blocked', 'Recipient must be a valid non-zero address'))
    else if (context.account && action.recipient.toLowerCase() === context.account.toLowerCase()) checks.push(check('recipient-self', 'blocked', 'Self-send is blocked'))
    else {
      checks.push(check('recipient-valid', 'pass', 'Recipient is structurally valid'))
      const known = context.knownRecipients?.some((item) => item.toLowerCase() === action.recipient!.toLowerCase())
      checks.push(known ? check('recipient-known', 'pass', 'Recipient was seen before') : check('recipient-known', 'warning', 'First-time recipient — verify the address carefully'))
    }
  }

  if (action.kind === 'swap') {
    if (!action.asset || !action.outputAsset) checks.push(check('swap-assets', 'blocked', 'Choose both swap assets'))
    else if (action.asset === action.outputAsset) checks.push(check('swap-assets', 'blocked', 'Swap assets must differ'))
    else checks.push(check('swap-assets', 'pass', `${action.asset} → ${action.outputAsset}`))
    checks.push(check('quote-required', 'unknown', 'A fresh live quote and simulation are required before wallet confirmation'))
  }

  if (action.kind === 'bridge') {
    if (!action.sourceChain || !action.destinationChain || action.sourceChain === action.destinationChain) checks.push(check('bridge-route', 'blocked', 'Choose a valid source and destination'))
    else checks.push(check('bridge-route', 'pass', `${action.sourceChain} → ${action.destinationChain}`))
    checks.push(check('bridge-evidence', 'unknown', 'Destination completion requires destination evidence; source submission is not completion'))
  }

  if (action.asset && context.balances?.[action.asset] != null && action.amount && Number(action.amount) > Number(context.balances[action.asset])) checks.push(check('balance-sufficient', 'blocked', `Insufficient ${action.asset} balance`))

  const blockers = checks.filter((item) => item.status === 'blocked').map((item) => item.message)
  const warnings = checks.filter((item) => item.status === 'warning').map((item) => item.message)
  const unknown = checks.some((item) => item.status === 'unknown')
  const status: BrainSafetyAssessment['status'] = blockers.length ? 'blocked' : unknown ? 'unknown' : warnings.length ? 'review' : 'ready'
  return Object.freeze({ status, checks: Object.freeze(checks), blockers: Object.freeze(blockers), warnings: Object.freeze(warnings), fingerprint: brainFingerprint({ action, account: context.account, chainId: context.chainId }), assessedAt: now })
}

export function prepareBrainReview(action: BrainPreparation, context: BrainContext, ttlMs = REVIEW_TTL_MS): BrainReviewSnapshot {
  const preparedAt = context.now ?? Date.now()
  const assessment = assessPreparation(action, { ...context, now: preparedAt })
  return Object.freeze({ action: Object.freeze({ ...action }), contextAccount: context.account, contextChainId: context.chainId, fingerprint: brainFingerprint({ action, account: context.account, chainId: context.chainId }), preparedAt, expiresAt: preparedAt + ttlMs, assessment })
}

export function revalidateBrainReview(snapshot: BrainReviewSnapshot, action: BrainPreparation, context: BrainContext): { valid: true; assessment: BrainSafetyAssessment } | { valid: false; reason: 'expired' | 'changed' | 'blocked'; assessment: BrainSafetyAssessment } {
  const now = context.now ?? Date.now()
  const assessment = assessPreparation(action, { ...context, now })
  if (now > snapshot.expiresAt) return { valid: false, reason: 'expired', assessment }
  if (brainFingerprint({ action, account: context.account, chainId: context.chainId }) !== snapshot.fingerprint) return { valid: false, reason: 'changed', assessment }
  if (assessment.status === 'blocked') return { valid: false, reason: 'blocked', assessment }
  return { valid: true, assessment }
}
