import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem'
import { ARC, TOKENS } from '../lib/wallet.ts'
import { evaluateToolPolicy, createReview, revalidateReview, verifyFiniteApproval } from './policy.ts'
import { XYLO_ROUTER, createXyloQuote } from './swap.ts'
import { CCTP_KIT_BRIDGE_TESTNET } from './cctp.ts'
import type { BridgeToolQuote, PreparedToolAction, SwapToolQuote } from './toolLayer.ts'

const account = '0x1111111111111111111111111111111111111111' as Address
const usdc = TOKENS.find((t) => t.sym === 'USDC')!
const eurc = TOKENS.find((t) => t.sym === 'EURC')!
const now = Date.now()
const quote: SwapToolQuote = {
  account, balance: 2_000_000n, allowance: 1_000_000n, minimumReceive: 970_000n,
  slippage: 0.03, expiresAt: now + 45_000, provider: 'XyloNet StableSwap',
  quote: createXyloQuote('usdc', 'eurc', 1_000_000n, 1_000_000n, now),
}
const action: PreparedToolAction = {
  kind: 'swap', account, chainId: ARC.chainId, request: { from: account, to: XYLO_ROUTER, data: '0x1234', value: '0x0', gas: '0x10000', gasPrice: '0x1' },
  preparedAt: now, expiresAt: now + 45_000, quoteId: '0x1234' as Hex, executionEnabled: false,
}

test('approval requires exact finite token, spender and amount', () => {
  const approval = { ...action, kind: 'approval' as const, request: { ...action.request, to: usdc.address as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [XYLO_ROUTER, 1_000_000n] }) } }
  assert.equal(verifyFiniteApproval(approval, { symbol: 'USDC', spender: XYLO_ROUTER, amount: 1_000_000n }), true)
  assert.equal(verifyFiniteApproval(approval, { symbol: 'EURC', spender: XYLO_ROUTER, amount: 1_000_000n }), false)
  assert.equal(verifyFiniteApproval(approval, { symbol: 'USDC', spender: account, amount: 1_000_000n }), false)
  assert.equal(verifyFiniteApproval(approval, { symbol: 'USDC', spender: XYLO_ROUTER, amount: 2_000_000n }), false)
  assert.equal(verifyFiniteApproval({ ...approval, request: { ...approval.request, to: eurc.address as Address } }, { symbol: 'USDC', spender: XYLO_ROUTER, amount: 1_000_000n }), false)
  assert.equal(evaluateToolPolicy({ action: approval, quote, account, chainId: ARC.chainId, simulation: 'passed', now }).mustStop, true)
})

test('policy blocks wrong chain, changed account, insufficient allowance and simulation failure', () => {
  const run = (change: Partial<Parameters<typeof evaluateToolPolicy>[0]>) => evaluateToolPolicy({ action, quote, account, chainId: ARC.chainId, simulation: 'passed', now, balance: quote.balance, allowance: quote.allowance, ...change })
  assert.equal(run({}).mustStop, false)
  assert.equal(run({ chainId: 1 }).mustStop, true)
  assert.equal(run({ account: '0x2222222222222222222222222222222222222222' }).mustStop, true)
  assert.equal(run({ allowance: 0n }).mustStop, true)
  assert.equal(run({ balance: 0n }).mustStop, true)
  assert.equal(run({ simulation: 'reverted' }).mustStop, true)
  assert.equal(run({ now: now + 46_000 }).mustStop, true)
})

test('review locks request and rejects stale or worse quote', () => {
  const base = { action, quote, account, chainId: ARC.chainId, simulation: 'passed' as const, now, balance: quote.balance, allowance: quote.allowance }
  const review = createReview(action, quote, evaluateToolPolicy(base), now)
  assert.equal(revalidateReview(review, { ...base, now: now + 1 }).status, 'OK')
  assert.equal(revalidateReview(review, { ...base, action: { ...action, request: { ...action.request, data: '0x9999' } }, now: now + 1 }).status, 'STALE')
  assert.equal(revalidateReview(review, { ...base, quote: { ...quote, quote: { ...quote.quote, amountOut: 960_000n } }, now: now + 1 }).status, 'STALE')
  assert.equal(revalidateReview(review, { ...base, now: now + 46_000 }).status, 'STALE')
})

test('CCTP policy binds the official USDC route, fee floor, exact approval and native gas ceiling', () => {
  const q: BridgeToolQuote = {
    account, sourceChainId: ARC.chainId, destinationChainId: 84532, destinationDomain: 6,
    recipient: account, spender: CCTP_KIT_BRIDGE_TESTNET, asset: 'USDC',
    amount: 1_000_000n, totalDebit: 1_000_000n, expectedReceive: 999_900n,
    providerFee: 80n, forwarderFee: 20n, maxFee: 100n, transferSpeed: 'FAST',
    quotedAt: now, expiresAt: now + 45_000, provider: 'Circle CCTP v2 official',
  }
  const semantics = { asset: 'USDC' as const, amount: q.amount, expectedReceive: q.expectedReceive, destinationChainId: q.destinationChainId, destinationDomain: q.destinationDomain, recipient: account, spender: q.spender as Address, providerFee: q.providerFee, forwarderFee: q.forwarderFee, maxFee: q.maxFee, transferSpeed: q.transferSpeed, finalityThreshold: 1000n }
  const gasEstimate = { gasLimit: 200_000n, unitPrice: 1_000_000_000n, maximumFee: 200_000_000_000_000n }
  const burn: PreparedToolAction = {
    kind: 'cctp-burn', account, chainId: ARC.chainId,
    request: { from: account, to: q.spender, data: '0x1234', value: '0x0', gas: '0x30d40', gasPrice: '0x3b9aca00' },
    preparedAt: now, expiresAt: now + 45_000, quoteId: '0x1234' as Hex, executionEnabled: false,
    cctp: semantics, gasEstimate,
  }
  const safe = { action: burn, quote: q, account, chainId: ARC.chainId, simulation: 'passed' as const, now, balance: 2_000_000n, allowance: 2_000_000n, gasBalance: 1_000_000_000_000_000n }
  assert.equal(evaluateToolPolicy(safe).mustStop, false)
  assert.equal(evaluateToolPolicy({ ...safe, gasBalance: gasEstimate.maximumFee - 1n }).mustStop, true)
  assert.equal(evaluateToolPolicy({ ...safe, quote: { ...q, maxFee: q.maxFee + 1n } }).mustStop, true)
  assert.equal(evaluateToolPolicy({ ...safe, action: { ...burn, request: { ...burn.request, to: XYLO_ROUTER } } }).mustStop, true)

  const review = createReview(burn, q, evaluateToolPolicy(safe), now)
  const gasUpdated: PreparedToolAction = { ...burn, request: { ...burn.request, gas: '0x40000' }, gasEstimate: { ...gasEstimate, gasLimit: 262_144n, maximumFee: 262_144_000_000_000n } }
  assert.equal(revalidateReview(review, { ...safe, action: gasUpdated, now: now + 1 }).status, 'OK')
  assert.equal(revalidateReview(review, { ...safe, action: { ...burn, request: { ...burn.request, data: '0x9999' } }, now: now + 1 }).status, 'STALE')
  assert.equal(revalidateReview(review, { ...safe, quote: { ...q, forwarderFee: q.forwarderFee + 1n, maxFee: q.maxFee + 1n, expectedReceive: q.expectedReceive - 1n }, now: now + 1 }).status, 'STALE')

  const approvalUnits = q.totalDebit
  const approval: PreparedToolAction = {
    ...burn, kind: 'approval', request: { ...burn.request, to: usdc.address as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [q.spender, approvalUnits] }) },
    cctp: { ...semantics, approvalAmount: approvalUnits },
  }
  const approvalPolicy = evaluateToolPolicy({ ...safe, action: approval, allowance: 0n, approval: { symbol: 'USDC', spender: q.spender, required: approvalUnits, allowance: 0n, requested: approvalUnits } })
  assert.equal(approvalPolicy.mustStop, false)
  assert.equal(evaluateToolPolicy({ ...safe, action: approval, allowance: 0n, gasBalance: 0n, approval: { symbol: 'USDC', spender: q.spender, required: approvalUnits, allowance: 0n, requested: approvalUnits } }).mustStop, true)
  assert.equal(evaluateToolPolicy({ ...safe, action: approval, allowance: approvalUnits, approval: { symbol: 'USDC', spender: q.spender, required: approvalUnits, allowance: approvalUnits, requested: approvalUnits } }).mustStop, true)
})
