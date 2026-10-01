import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi } from 'viem'
import { CCTPV2BridgingProvider } from '@circle-fin/provider-cctp-v2'
import { TOKENS } from '../lib/wallet.ts'
import type { SendProvider } from '../lib/sendExecution.ts'
import { SendSubmissionGuard } from '../lib/sendExecution.ts'
import { checkProtocolReceipt, requestReviewedAction } from './protocolExecution.ts'
import { planAgentRequest, replanAgentFromEvidence } from './planner.ts'
import { createStrategyRun, restoreStrategyRun, saveStrategyRun, transitionStrategy } from './strategyController.ts'
import { prepareApproval, prepareSwap, quoteSwap } from './toolLayer.ts'
import { universalBridgeAvailability } from './universalBridge.ts'
import { xyloRouterAbi, XYLO_ROUTER } from './swap.ts'
import { CCTP_KIT_BRIDGE_TESTNET } from './cctp.ts'
import { CCTP_MESSAGE_SENT_ABI } from '../protocols/circle/cctpAdapter.ts'

const account = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
const hash = `0x${'a'.repeat(64)}` as `0x${string}`
function fixture() {
  const state = { allowance: 2_000_000n, balance: 10_000_000n, chain: '0x4cef52', account, receipt: 'pending', rejected: false, offline: false, writes: 0, cctpLogs: undefined as unknown[] | undefined, last: undefined as undefined | { from: string; to: string; data: string } }
  const p: SendProvider = { request: async ({ method, params = [] }) => {
    if (state.offline) throw new Error('RPC offline')
    if (method === 'eth_accounts') return [state.account]
    if (method === 'eth_chainId') return state.chain
    if (method === 'eth_getCode') return '0x6000'
    if (method === 'eth_getBalance') return '0x1000000000000000'
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x3b9aca00'
    if (method === 'eth_call') {
      const { to, data } = params[0] as { to: string; data: string }
      if (data === '0x313ce567') return '0x6'
      if (data === '0x95d89b41') return encodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', result: to.toLowerCase() === TOKENS[1].address.toLowerCase() ? 'EURC' : 'USDC' })
      if (data.startsWith('0x70a08231')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: state.balance })
      if (data.startsWith('0xdd62ed3e')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: state.allowance })
      if (to.toLowerCase() === XYLO_ROUTER.toLowerCase()) return encodeFunctionResult({ abi: xyloRouterAbi, functionName: 'getAmountOut', result: 990_000n })
      return '0x'
    }
    if (method === 'eth_sendTransaction') {
      if (state.rejected) throw Object.assign(new Error('User rejected'), { code: 4001 })
      state.writes++; state.last = params[0] as typeof state.last; return hash
    }
    if (method === 'eth_getTransactionByHash') return state.last && { hash, from: state.last.from, to: state.last.to, input: state.last.data }
    if (method === 'eth_getTransactionReceipt') {
      if (state.receipt === 'pending') return null
      const topics = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: other, to: account } })
      const logs = [{ address: TOKENS[1].address, topics, data: encodeAbiParameters([{ type: 'uint256' }], [990_000n]) }]
      return { transactionHash: hash, blockHash: hash, blockNumber: '0x1', status: state.receipt === 'failed' ? '0x0' : '0x1', logs: state.cctpLogs ?? logs }
    }
    throw new Error(method)
  } }
  return { state, p }
}
const review = (step: 'approval' | 'swap' | 'cctp-burn', now: number) => ({ type: 'review' as const, step, account, chainId: 5042002, expiresAt: now + 45000, quoteFresh: true, policyPassed: true, simulationPassed: true, now })

test('connected Swap paths require a distinct approval receipt, fresh review, and verified output', async () => {
  const { p, state } = fixture()
  const input = { account, from: 'USDC' as const, to: 'EURC' as const, amount: '1', slippage: 0.005 as const }
  const quoted = (await quoteSwap(p, input)).data!
  const direct = await prepareSwap(p, quoted)
  assert.equal(direct.kind, 'swap')
  assert.equal(state.writes, 0)
  state.allowance = 0n
  const changed = (await quoteSwap(p, input)).data!
  await assert.rejects(prepareSwap(p, changed), /approval required/)
  const approval = await prepareApproval(p, { account, symbol: 'USDC', spender: XYLO_ROUTER, amount: changed.quote.amountIn })
  let run = createStrategyRun('swap', account, 1)
  const next = (event: Parameters<typeof transitionStrategy>[1]) => { const result = transitionStrategy(run, event); assert.equal(result.accepted, true); if (result.accepted) run = result.state }
  next(review('approval', 2))
  next({ type: 'wallet-request', binding: { from: account, to: approval.request.to, data: approval.request.data, symbol: 'USDC', spender: XYLO_ROUTER, requiredUnits: changed.quote.amountIn.toString() }, now: 3 })
  const submitted = await requestReviewedAction(p, approval, new SendSubmissionGuard())
  assert.equal(state.writes, 1)
  next({ type: 'hash', hash: submitted, now: 4 })
  assert.equal(await checkProtocolReceipt(p, approval, submitted, { approval: { symbol: 'USDC', spender: XYLO_ROUTER, minimum: changed.quote.amountIn } }), 'pending')
  state.receipt = 'confirmed'
  assert.equal(await checkProtocolReceipt(p, approval, submitted, { approval: { symbol: 'USDC', spender: XYLO_ROUTER, minimum: changed.quote.amountIn } }), 'unknown')
  state.allowance = changed.quote.amountIn
  assert.equal(await checkProtocolReceipt(p, approval, submitted, { approval: { symbol: 'USDC', spender: XYLO_ROUTER, minimum: changed.quote.amountIn } }), 'confirmed')
  next({ type: 'confirmed', now: 5 })
  assert.equal(transitionStrategy(run, review('swap', 6)).accepted, false)
  next({ type: 'allowance-reread', sufficient: true, account, chainId: 5042002, now: 6 })
  const refreshed = (await quoteSwap(p, input)).data!
  const swap = await prepareSwap(p, refreshed)
  next(review('swap', 7))
  next({ type: 'wallet-request', binding: { from: account, to: swap.request.to, data: swap.request.data, symbol: 'USDC', outputSymbol: 'EURC', minimumOutputUnits: refreshed.minimumReceive.toString(), amount: '1' }, now: 8 })
  const swapHash = await requestReviewedAction(p, swap, new SendSubmissionGuard())
  next({ type: 'hash', hash: swapHash, now: 9 })
  assert.equal(await checkProtocolReceipt(p, swap, swapHash, { swapQuote: refreshed }), 'confirmed')
  next({ type: 'confirmed', now: 10 })
  assert.equal(run.phase, 'COMPLETED')
  assert.equal(state.writes, 2)
  state.receipt = 'failed'
  assert.equal(await checkProtocolReceipt(p, swap, swapHash, { swapQuote: refreshed }), 'failed')
})

test('connected Agent preflight replans from allowance, balance, account, chain, provider and fee evidence without signing', async () => {
  const { p, state } = fixture()
  const plan = planAgentRequest('Swap 1 USDC to EURC')
  assert.equal(plan.status, 'ACTION')
  assert.equal((await replanAgentFromEvidence(plan, p, account)).status, 'READY_ACTION')
  state.allowance = 0n
  assert.equal((await replanAgentFromEvidence(plan, p, account)).status, 'READY_APPROVAL')
  state.balance = 0n
  assert.equal((await replanAgentFromEvidence(plan, p, account)).status, 'BLOCKED')
  state.balance = 10_000_000n; state.account = other
  assert.equal((await replanAgentFromEvidence(plan, p, account)).reason, 'Account changed')
  state.account = account; state.chain = '0x1'
  assert.equal((await replanAgentFromEvidence(plan, p, account)).reason, 'Chain changed')
  state.chain = '0x4cef52'; state.offline = true
  assert.equal((await replanAgentFromEvidence(plan, p, account)).status, 'UNAVAILABLE')
  assert.equal((await replanAgentFromEvidence(plan, undefined, account)).status, 'UNAVAILABLE')
  assert.equal(state.writes, 0)
})

test('CCTP burn receipt requires success plus MessageSent from the official Arc transmitter', async () => {
  const { p, state } = fixture()
  const action = { kind: 'cctp-burn' as const, account: account as `0x${string}`, chainId: 5042002, request: { from: account as `0x${string}`, to: CCTP_KIT_BRIDGE_TESTNET, data: '0x1234' as `0x${string}`, value: '0x0' as const, gas: '0x186a0' as `0x${string}`, gasPrice: '0x3b9aca00' as `0x${string}` }, preparedAt: Date.now(), expiresAt: Date.now() + 10000, quoteId: hash, executionEnabled: false as const }
  state.last = { from: account, to: CCTP_KIT_BRIDGE_TESTNET, data: '0x1234' }
  assert.equal(await checkProtocolReceipt(p, action, hash), 'pending')
  state.receipt = 'confirmed'
  assert.equal(await checkProtocolReceipt(p, action, hash), 'unknown')
  const circle = new CCTPV2BridgingProvider()
  const source = circle.supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === 5042002)!
  const transmitter = source.cctp!.contracts.v2!.type === 'split' ? source.cctp!.contracts.v2!.messageTransmitter : ''
  const topics = encodeEventTopics({ abi: CCTP_MESSAGE_SENT_ABI, eventName: 'MessageSent' })
  state.cctpLogs = [{ address: transmitter, topics, data: encodeAbiParameters([{ type: 'bytes' }], ['0x01']) }]
  assert.equal(await checkProtocolReceipt(p, action, hash), 'confirmed')
  state.receipt = 'failed'
  assert.equal(await checkProtocolReceipt(p, action, hash), 'failed')
  assert.equal(state.writes, 0)
})

test('rejection, unknown submission and unavailable Universal Bridge never trigger a dependent write', async () => {
  const { p, state } = fixture()
  const q = (await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 })).data!
  const action = await prepareSwap(p, q)
  state.rejected = true
  await assert.rejects(requestReviewedAction(p, action, new SendSubmissionGuard()), /rejected/)
  assert.equal(state.writes, 0)
  assert.equal(universalBridgeAvailability().status, 'UNAVAILABLE')
  let run = createStrategyRun('swap', account, 1)
  for (const event of [review('swap', 2), { type: 'wallet-request' as const, binding: { from: account, to: action.request.to, data: action.request.data }, now: 3 }, { type: 'unknown' as const, now: 4 }]) { const result = transitionStrategy(run, event); assert.equal(result.accepted, true); if (result.accepted) run = result.state }
  assert.equal(transitionStrategy(run, review('swap', 5)).accepted, false)
})

test('one in-flight wallet request is guarded and forged persisted completion is ignored', async () => {
  const { p, state } = fixture()
  const q = (await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 })).data!
  const action = await prepareSwap(p, q)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const delayed: SendProvider = { request: async (args) => { if (args.method === 'eth_sendTransaction') await gate; return p.request(args) } }
  const guard = new SendSubmissionGuard()
  const first = requestReviewedAction(delayed, action, guard)
  await assert.rejects(requestReviewedAction(delayed, action, guard), /already in progress/)
  release()
  assert.equal(await first, hash)
  assert.equal(state.writes, 1)
  const storage = new Map<string, string>()
  const fake = { ...createStrategyRun('swap', account, 1), phase: 'COMPLETED' }
  saveStrategyRun({ setItem: (key, value) => storage.set(key, value) }, fake as ReturnType<typeof createStrategyRun>)
  assert.equal(restoreStrategyRun({ getItem: (key) => storage.get(key) ?? null }, 'swap', account, 2), undefined)
})
