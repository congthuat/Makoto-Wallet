import { ARC } from '../lib/wallet.ts'
import { parseBrainRequest } from '../brain/parser.ts'
import { routeBrainIntent } from '../brain/orchestration.ts'
import type { BrainLocale, BrainPreparation } from '../brain/types.ts'
import { validatePlannerIntent, type PlannerIntent } from './plannerIntent.ts'
import { validatePlannerPlan, type PlannerPlan, type PlannerGoalKind } from './plannerPlan.ts'
import { validateStrategy, type Strategy } from './strategyModel.ts'
import type { SendProvider } from '../lib/sendExecution.ts'
import { getAssetById, parseAssetAmount } from './assets.ts'
import { CCTP_KIT_BRIDGE_TESTNET } from './cctp.ts'
import { XYLO_ROUTER } from './swap.ts'
import { prepareApproval, prepareCctpApproval, prepareCctpBurn, prepareSwap, quoteBridge, quoteSwap, readAllowance, readBalance, readWallet, type PreparedToolAction } from './toolLayer.ts'

/** Adapted from donor Phase 11 validators. This is local structured planning, never execution authority. */
export type AgentPlanResult =
  | Readonly<{ status: 'INFORMATION'; topic: string }>
  | Readonly<{ status: 'NEEDS_CLARIFICATION' | 'UNSUPPORTED'; reasons: readonly string[] }>
  | Readonly<{ status: 'ACTION' | 'STRATEGY'; plan: PlannerPlan; intents: readonly PlannerIntent[]; strategy: Strategy; executionEnabled: false }>

function intentFor(preparation: BrainPreparation, id: string): unknown {
  const amount = preparation.amount
  if (preparation.kind === 'send') return { version: 1, id, kind: 'SEND', chainId: ARC.chainId, asset: preparation.asset?.toLowerCase(), amount, recipient: preparation.recipient }
  if (preparation.kind === 'swap') return { version: 1, id, kind: 'SWAP', chainId: ARC.chainId, fromAsset: preparation.asset?.toLowerCase(), toAsset: preparation.outputAsset?.toLowerCase(), amount }
  return { version: 1, id, kind: 'BRIDGE', sourceChainId: ARC.chainId, destinationChainId: 84532, asset: 'usdc', amount, recipient: preparation.recipient }
}

export function planAgentRequest(raw: string, locale: BrainLocale = 'en', now = Date.now()): AgentPlanResult {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) return { status: 'NEEDS_CLARIFICATION', reasons: ['Request must contain 1–2000 characters'] }
  // An output-derived amount has no fixed independent user authorization.
  if (/\b(max|all|half|what i receive|amount received|output|proceeds|remaining balance)\b/i.test(raw)) return { status: 'NEEDS_CLARIFICATION', reasons: ['Dynamic or MAX amount needs explicit manual review'] }
  // Deterministic reads must be classified before the Vietnamese sequential delimiter "rồi" is considered.
  const directRead = parseBrainRequest(raw, locale)
  if (directRead.kind === 'current-datetime') return { status: 'INFORMATION', topic: directRead.kind }
  const parts = raw.split(/\b(?:and then|then|sau đó|rồi)\b/i).map((item) => item.trim()).filter(Boolean)
  if (parts.length > 8) return { status: 'UNSUPPORTED', reasons: ['Too many sequential goals'] }
  const intents: PlannerIntent[] = []
  for (let index = 0; index < parts.length; index++) {
    const parsed = parseBrainRequest(parts[index], locale)
    if (parts.length === 1 && parsed.kind !== 'prepare-action') return parsed.kind === 'unknown' ? { status: 'UNSUPPORTED', reasons: ['Unsupported request'] } : { status: 'INFORMATION', topic: parsed.kind }
    if (parsed.kind !== 'prepare-action' || !parsed.preparation) return { status: 'NEEDS_CLARIFICATION', reasons: [`Goal ${index + 1} is not a complete action`] }
    const routed = routeBrainIntent(parsed)
    if (!routed.draftAllowed) return { status: 'NEEDS_CLARIFICATION', reasons: [...routed.missingFields, ...routed.blockers].map((reason) => `Goal ${index + 1}: ${reason}`) }
    const checked = validatePlannerIntent(intentFor(parsed.preparation, `goal-${index + 1}`))
    if (!checked.valid) return { status: 'NEEDS_CLARIFICATION', reasons: checked.errors.map((error) => `Goal ${index + 1}: ${error.path} ${error.message}`) }
    intents.push(checked.value)
  }
  const classification = intents.length === 1 ? 'ACTION' : 'STRATEGY'
  const plan: PlannerPlan = { version: 1, id: `plan-${now}`, classification, goals: intents.map((intent, index) => ({ id: intent.id, kind: intent.kind as PlannerGoalKind, dependsOn: index ? [intents[index - 1].id] : [] })) }
  if (!validatePlannerPlan(plan, classification).valid) return { status: 'UNSUPPORTED', reasons: ['Planner graph invalid'] }
  const steps: Strategy['steps'] = intents.flatMap((intent, index) => {
    const prior = index ? `revalidate-${index}` : undefined
    const action = { id: `action-${index + 1}`, kind: 'ACTION' as const, action: intent.kind, confirmation: 'EXPLICIT_USER_CONFIRMATION' as const, dependsOn: prior ? [prior] : [] }
    const receipt = { id: `receipt-${index + 1}`, kind: 'WAIT_RECEIPT' as const, receipt: { kind: 'RECEIPT' as const, actionStepId: action.id }, dependsOn: [action.id] }
    const refresh = { id: `revalidate-${index + 1}`, kind: 'REVALIDATE' as const, dependsOn: [receipt.id] }
    return index === intents.length - 1 ? [action, receipt] : [action, receipt, refresh]
  })
  const strategy: Strategy = { version: 1, id: `strategy-${now}`, createdAt: now, steps }
  if (!validateStrategy(strategy).valid) return { status: 'UNSUPPORTED', reasons: ['Strategy graph invalid'] }
  return { status: classification, plan, intents, strategy, executionEnabled: false }
}

export function classifyReplan(reason: 'changed-balance' | 'changed-chain' | 'changed-quote' | 'expired-quote' | 'failed-step' | 'user-rejected' | 'provider-unavailable' | 'confirmed-step' | 'unknown-submission') {
  if (reason === 'unknown-submission') return { status: 'RECOVERY_REQUIRED' as const, walletAllowed: false }
  if (reason === 'confirmed-step') return { status: 'REREAD_REQUOTE_REVIEW' as const, walletAllowed: false }
  return { status: 'REPLAN_REQUIRED' as const, walletAllowed: false }
}

/** Fresh, read-only Agent preflight. A dependent goal waits for a verified receipt in its product controller. */
export type AgentEvidence = Readonly<{ status: 'READY_APPROVAL' | 'READY_ACTION' | 'READY_HANDOFF' | 'WAITING_RECEIPT' | 'BLOCKED' | 'UNAVAILABLE'; reason: string; observedAt: number; quoteExpiresAt?: number; prepared?: PreparedToolAction; executionEnabled: false }>
const evidence = (status: AgentEvidence['status'], reason: string, prepared?: PreparedToolAction, quoteExpiresAt?: number): AgentEvidence => Object.freeze({ status, reason, observedAt: Date.now(), prepared, quoteExpiresAt, executionEnabled: false })

export async function replanAgentFromEvidence(plan: AgentPlanResult, provider: SendProvider | undefined, account: string): Promise<AgentEvidence> {
  if (plan.status !== 'ACTION' && plan.status !== 'STRATEGY') return evidence('BLOCKED', 'No actionable plan')
  if (!provider) return evidence('UNAVAILABLE', 'Wallet provider unavailable')
  const wallet = await readWallet(provider)
  if (wallet.status !== 'OK' || !wallet.data) return evidence('UNAVAILABLE', wallet.reason ?? 'Wallet context unavailable')
  if (wallet.data.account.toLowerCase() !== account.toLowerCase()) return evidence('BLOCKED', 'Account changed')
  if (wallet.data.chainId !== ARC.chainId) return evidence('BLOCKED', 'Chain changed')
  const first = plan.intents[0]
  if (!first) return evidence('BLOCKED', 'Plan has no goal')
  if (first.kind === 'SEND') {
    const asset = getAssetById(first.asset)!
    const amount = parseAssetAmount(first.amount, asset)
    const balance = await readBalance(provider, asset.symbol, account)
    if (balance.status !== 'OK' || !balance.data) return evidence('UNAVAILABLE', balance.reason ?? 'Balance unavailable')
    return amount !== undefined && balance.data.units >= amount ? evidence('READY_HANDOFF', 'Balance observed; Send performs its own review and revalidation') : evidence('BLOCKED', 'Balance changed or insufficient')
  }
  if (first.kind === 'SWAP') {
    const quoted = await quoteSwap(provider, { account, from: first.fromAsset.toUpperCase() as 'USDC' | 'EURC', to: first.toAsset.toUpperCase() as 'USDC' | 'EURC', amount: first.amount, slippage: 0.005 })
    if (quoted.status !== 'OK' || !quoted.data) return evidence(quoted.reason === 'Insufficient balance' ? 'BLOCKED' : 'UNAVAILABLE', quoted.reason ?? 'Swap quote unavailable')
    const q = quoted.data
    if (q.expiresAt <= Date.now()) return evidence('BLOCKED', 'Swap quote expired')
    try {
      const approval = q.allowance < q.quote.amountIn
      const prepared = approval ? await prepareApproval(provider, { account, symbol: first.fromAsset.toUpperCase() as 'USDC' | 'EURC', spender: XYLO_ROUTER, amount: q.quote.amountIn }) : await prepareSwap(provider, q)
      return evidence(approval ? 'READY_APPROVAL' : 'READY_ACTION', approval ? 'Finite approval needs a separate wallet review' : 'Swap needs policy check and user review', prepared, q.expiresAt)
    } catch (error) { return evidence('BLOCKED', error instanceof Error ? error.message : 'Swap preparation failed') }
  }
  if (first.recipient.toLowerCase() !== account.toLowerCase()) return evidence('BLOCKED', 'Direct CCTP currently supports the connected account as recipient')
  const quoted = await quoteBridge(provider, { account, amount: first.amount })
  if (quoted.status !== 'OK' || !quoted.data) return evidence(quoted.reason === 'Insufficient USDC or balance unavailable' ? 'BLOCKED' : 'UNAVAILABLE', quoted.reason ?? 'Bridge quote unavailable')
  const q = quoted.data
  if (q.expiresAt <= Date.now()) return evidence('BLOCKED', 'CCTP fee quote expired')
  try {
    const allowance = await readAllowance(provider, 'USDC', CCTP_KIT_BRIDGE_TESTNET, account)
    if (allowance.status !== 'OK' || !allowance.data) return evidence('UNAVAILABLE', allowance.reason ?? 'Allowance unavailable')
    const approval = allowance.data.units < q.totalDebit
    const prepared = approval ? await prepareCctpApproval(provider, q, allowance.data.units) : await prepareCctpBurn(provider, q)
    return evidence(approval ? 'READY_APPROVAL' : 'READY_ACTION', approval ? 'Finite CCTP approval needs a separate wallet review' : 'CCTP burn needs policy check and user review', prepared, q.expiresAt)
  } catch (error) { return evidence('BLOCKED', error instanceof Error ? error.message : 'CCTP preparation failed') }
}
