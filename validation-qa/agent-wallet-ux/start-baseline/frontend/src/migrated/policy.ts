import { decodeFunctionData, erc20Abi, getAddress, keccak256, stringToHex, type Hex } from 'viem'
import { ARC, TOKENS } from '../lib/wallet.ts'
import type { PreparedToolAction, SwapToolQuote, BridgeToolQuote, ToolResult } from './toolLayer.ts'
import { BASE_SEPOLIA_CCTP_DOMAIN, CCTP_KIT_BRIDGE_TESTNET } from './cctp.ts'
import { XYLO_ROUTER } from './swap.ts'
import { sameCctpActionMaterial, sameCctpQuoteMaterial } from '../protocols/circle/cctpAdapter.ts'

/** Adapted from donor policyEngine precedence and transactionOrchestrator request binding. */
export type PolicyDecision = 'ALLOW' | 'WARN' | 'REQUIRE_REVIEW' | 'REVALIDATE' | 'REQUOTE' | 'BLOCK'
export type PolicyFinding = Readonly<{ code: string; decision: PolicyDecision }>
export type PolicyResult = Readonly<{ decision: PolicyDecision; findings: readonly PolicyFinding[]; mustStop: boolean }>
export type ActionQuote = SwapToolQuote | BridgeToolQuote
export type ReviewSnapshot = Readonly<{ action: PreparedToolAction; requestId: Hex; quoteId: Hex; account: string; chainId: number; reviewedAt: number; expiresAt: number; quote: ActionQuote; decision: PolicyResult }>
const precedence: PolicyDecision[] = ['ALLOW', 'WARN', 'REQUIRE_REVIEW', 'REVALIDATE', 'REQUOTE', 'BLOCK']
const same = (a: string, b: string) => getAddress(a) === getAddress(b)
/** Gas estimates are mutable; call intent and the attached protocol fingerprint are material. */
export const requestId = (value: PreparedToolAction): Hex => keccak256(stringToHex(JSON.stringify({
  chainId: value.chainId,
  account: value.account.toLowerCase(),
  from: value.request.from.toLowerCase(),
  to: value.request.to.toLowerCase(),
  data: value.request.data.toLowerCase(),
  value: value.request.value.toLowerCase(),
  protocol: value.quoteId.toLowerCase(),
})))

/** Bind approval calldata to a canonical token, allowed spender and exact finite amount. */
export function verifyFiniteApproval(action: PreparedToolAction, expected: { symbol: 'USDC' | 'EURC'; spender: string; amount: bigint }): boolean {
  if (action.kind !== 'approval' || action.chainId !== ARC.chainId || action.request.from.toLowerCase() !== action.account.toLowerCase() || action.request.value !== '0x0') return false
  const token = TOKENS.find((item) => item.sym === expected.symbol)
  if (!token || !same(action.request.to, token.address) || ![XYLO_ROUTER, CCTP_KIT_BRIDGE_TESTNET].some((spender) => same(spender, expected.spender))) return false
  if (expected.amount <= 0n || expected.amount >= (1n << 256n) - 1n) return false
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: action.request.data })
    return decoded.functionName === 'approve' && same(decoded.args[0], expected.spender) && decoded.args[1] === expected.amount
  } catch { return false }
}

export function evaluateToolPolicy(input: {
  action: PreparedToolAction
  quote: ActionQuote
  account?: string
  chainId?: number
  simulation: 'passed' | 'reverted' | 'unavailable'
  now: number
  balance?: bigint
  allowance?: bigint
  gasBalance?: bigint
  approval?: { symbol: 'USDC'; spender: string; required: bigint; allowance: bigint; requested: bigint }
}): PolicyResult {
  const findings: PolicyFinding[] = []
  const add = (code: string, decision: PolicyDecision) => findings.push({ code, decision })
  const { action, quote, now } = input
  if (!input.account || !same(input.account, action.account) || !same(quote.account, action.account)) add('ACCOUNT_MISMATCH', 'BLOCK')
  if (input.chainId !== ARC.chainId || action.chainId !== ARC.chainId || action.request.from.toLowerCase() !== action.account.toLowerCase()) add('CHAIN_MISMATCH', 'BLOCK')
  if (action.executionEnabled !== false || action.request.value !== '0x0') add('EXECUTION_AUTHORITY', 'BLOCK')
  if (now < action.preparedAt || now > action.expiresAt) add('REVIEW_EXPIRED', 'REVALIDATE')
  if (now > quote.expiresAt) add('QUOTE_EXPIRED', 'REQUOTE')
  if (action.kind === 'swap') {
    if (!('quote' in quote) || !same(action.request.to, XYLO_ROUTER)) add('UNTRUSTED_SWAP_ROUTE', 'BLOCK')
    else {
      if (quote.minimumReceive <= 0n || quote.minimumReceive > quote.quote.amountOut || ![0.005, 0.01, 0.03].includes(quote.slippage)) add('INVALID_SLIPPAGE', 'BLOCK')
      if (input.balance === undefined || input.balance < quote.quote.amountIn) add('INSUFFICIENT_BALANCE', 'REVALIDATE')
      if (input.allowance === undefined || input.allowance < quote.quote.amountIn) add('APPROVAL_REQUIRED', 'BLOCK')
    }
  } else if (action.kind === 'cctp-burn') {
    const semantics = action.cctp
    const validRoute = 'totalDebit' in quote && quote.asset === 'USDC' && quote.sourceChainId === ARC.chainId && quote.destinationChainId === 84532 && quote.destinationDomain === BASE_SEPOLIA_CCTP_DOMAIN &&
      same(action.request.to, CCTP_KIT_BRIDGE_TESTNET) && same(action.request.to, quote.spender) && !!semantics && semantics.asset === quote.asset &&
      semantics.amount === quote.amount && semantics.expectedReceive === quote.expectedReceive &&
      semantics.destinationChainId === quote.destinationChainId && semantics.destinationDomain === quote.destinationDomain &&
      same(semantics.recipient, quote.recipient) && same(semantics.spender, quote.spender) &&
      semantics.providerFee === quote.providerFee && semantics.forwarderFee === quote.forwarderFee &&
      semantics.maxFee === quote.maxFee && semantics.transferSpeed === quote.transferSpeed &&
      action.account.toLowerCase() === quote.account.toLowerCase()
    if (!validRoute) add('UNTRUSTED_CCTP_ROUTE', 'BLOCK')
    else {
      if (quote.totalDebit !== quote.amount || quote.amount <= 0n || quote.providerFee < 0n || quote.forwarderFee < 0n || quote.maxFee < 0n || quote.expectedReceive !== quote.amount - quote.maxFee || quote.maxFee !== quote.providerFee + quote.forwarderFee || quote.expectedReceive <= 0n || !['FAST', 'SLOW'].includes(quote.transferSpeed)) add('INVALID_CCTP_FEES', 'BLOCK')
      if (input.balance === undefined || input.balance < quote.totalDebit) add('INSUFFICIENT_BALANCE', 'REVALIDATE')
      if (input.allowance === undefined || input.allowance < quote.totalDebit) add('APPROVAL_REQUIRED', 'BLOCK')
      if (!action.gasEstimate || input.gasBalance === undefined || input.gasBalance < action.gasEstimate.maximumFee) add('INSUFFICIENT_GAS_BALANCE', 'REVALIDATE')
    }
  } else if (action.kind === 'approval') {
    const approval = input.approval
    const usdc = TOKENS.find((item) => item.sym === 'USDC')
    if (!approval || !action.cctp || !('totalDebit' in quote) || !usdc || !same(action.request.to, usdc.address) || !same(action.cctp.spender, approval.spender)) add('APPROVAL_NEEDS_EXACT_CONTEXT', 'BLOCK')
    else {
      if (!verifyFiniteApproval(action, { symbol: 'USDC', spender: approval.spender, amount: approval.required }) || approval.requested !== approval.required || action.cctp.approvalAmount !== approval.required || approval.required !== quote.totalDebit) add('UNBOUNDED_OR_UNTRUSTED_APPROVAL', 'BLOCK')
      if (approval.allowance >= approval.required || (input.allowance !== undefined && input.allowance >= approval.required)) add('APPROVAL_NOT_REQUIRED', 'BLOCK')
      if (input.balance === undefined || input.balance < approval.required) add('INSUFFICIENT_BALANCE', 'REVALIDATE')
      if (!action.gasEstimate || input.gasBalance === undefined || input.gasBalance < action.gasEstimate.maximumFee) add('INSUFFICIENT_GAS_BALANCE', 'REVALIDATE')
    }
  } else add('UNSUPPORTED_ACTION', 'BLOCK')
  if (input.simulation === 'reverted') add('SIMULATION_REVERTED', 'BLOCK')
  else if (input.simulation === 'unavailable') add('SIMULATION_UNAVAILABLE', 'REVALIDATE')
  if (!findings.length) add('EXPLICIT_WALLET_REVIEW', 'REQUIRE_REVIEW')
  const decision = precedence.reduce((best, item) => findings.some((f) => f.decision === item) ? item : best, 'ALLOW' as PolicyDecision)
  return Object.freeze({ decision, findings: Object.freeze(findings), mustStop: decision === 'BLOCK' || decision === 'REQUOTE' || decision === 'REVALIDATE' })
}

export function createReview(action: PreparedToolAction, quote: ActionQuote, policy: PolicyResult, now = Date.now()): ReviewSnapshot {
  if (policy.mustStop) throw new Error('Action is not ready for review')
  return Object.freeze({ action, requestId: requestId(action), quoteId: action.quoteId, account: action.account, chainId: action.chainId, reviewedAt: now, expiresAt: Math.min(action.expiresAt, quote.expiresAt), quote, decision: policy })
}

export function revalidateReview(snapshot: ReviewSnapshot, fresh: { action: PreparedToolAction; quote: ActionQuote; account: string; chainId: number; simulation: 'passed' | 'reverted' | 'unavailable'; now: number; balance?: bigint; allowance?: bigint; gasBalance?: bigint; approval?: { symbol: 'USDC'; spender: string; required: bigint; allowance: bigint; requested: bigint } }): ToolResult<PolicyResult> {
  if (fresh.now > snapshot.expiresAt) return { status: 'STALE', source: 'Makoto Policy', observedAt: fresh.now, reason: 'Review expired' }
  if (!same(fresh.account, snapshot.account) || fresh.chainId !== snapshot.chainId || requestId(fresh.action) !== snapshot.requestId || fresh.action.quoteId !== snapshot.quoteId) return { status: 'STALE', source: 'Makoto Policy', observedAt: fresh.now, reason: 'Reviewed request changed' }
  if (snapshot.action.kind === 'cctp-burn' || snapshot.action.kind === 'approval') {
    if (!('totalDebit' in snapshot.quote) || !('totalDebit' in fresh.quote) || !sameCctpQuoteMaterial(snapshot.quote, fresh.quote) || !sameCctpActionMaterial(snapshot.action, fresh.action)) return { status: 'STALE', source: 'Makoto Policy', observedAt: fresh.now, reason: 'CCTP request or fee semantics changed' }
  }
  if ('quote' in snapshot.quote && (!('quote' in fresh.quote) || fresh.quote.quote.amountIn !== snapshot.quote.quote.amountIn || fresh.quote.quote.fromAssetId !== snapshot.quote.quote.fromAssetId || fresh.quote.quote.toAssetId !== snapshot.quote.quote.toAssetId || fresh.quote.quote.amountOut < snapshot.quote.minimumReceive)) return { status: 'STALE', source: 'Makoto Policy', observedAt: fresh.now, reason: 'Fresh output below reviewed minimum or pair changed' }
  if ('totalDebit' in snapshot.quote && (!('totalDebit' in fresh.quote) || fresh.quote.totalDebit !== snapshot.quote.totalDebit || fresh.quote.expectedReceive < snapshot.quote.expectedReceive || fresh.quote.destinationChainId !== snapshot.quote.destinationChainId)) return { status: 'STALE', source: 'Makoto Policy', observedAt: fresh.now, reason: 'CCTP fee or route changed' }
  const result = evaluateToolPolicy({ ...fresh, action: fresh.action, quote: fresh.quote })
  return result.mustStop ? { status: 'UNAVAILABLE', source: 'Makoto Policy', observedAt: fresh.now, reason: result.findings.map((f) => f.code).join(', ') } : { status: 'OK', source: 'Makoto Policy', observedAt: fresh.now, data: result }
}
