import assert from 'node:assert/strict'
import test from 'node:test'
import { CCTPV2BridgingProvider } from '@circle-fin/provider-cctp-v2'
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, erc20Abi, pad, zeroHash, type Address, type Hex } from 'viem'
import { TOKENS } from '../../lib/wallet.ts'
import type { SendProvider } from '../../lib/sendExecution.ts'
import { CCTP_FORWARDING_HOOK_DATA, CCTP_KIT_BRIDGE_TESTNET, CCTP_TOKEN_MESSENGER_V2 } from '../../migrated/cctp.ts'
import type { BridgeToolQuote, PreparedToolAction } from '../../migrated/toolLayer.ts'
import { prepareCctpApproval, prepareCctpBurn, quoteBridge } from '../../migrated/toolLayer.ts'
import { requestReviewedCctpAction } from '../../migrated/protocolExecution.ts'
import { SendSubmissionGuard } from '../../lib/sendExecution.ts'
import { CIRCLE_CUSTOM_BURN_WITH_HOOK_ABI, cctpGasEstimateChanged, executePreparedCctpCall, getOfficialCctpQuote, prepareExactCctpApproval, prepareOfficialCctpBurn, sameCctpActionMaterial, simulatePreparedCctpCall } from './cctpAdapter.ts'

const account = '0x1111111111111111111111111111111111111111' as Address
const txHash = `0x${'a'.repeat(64)}` as Hex
const amount = 1_000_000n

function fixture(burn = false) {
  const calls: { method: string; params: unknown[] }[] = []
  const state = { allowance: 2_000_000n, balance: 10_000_000n, burnPreparations: 0, rejectSend: false }
  const p: SendProvider = { request: async ({ method, params = [] }) => {
    calls.push({ method, params })
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    if (method === 'eth_getCode') return '0x6000'
    if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00'
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_getBalance') return '0x1000000000000000'
    if (method === 'eth_call') {
      const { data, to } = params[0] as { data: Hex; to: string }
      if (data === '0x313ce567') return `0x${'0'.repeat(63)}6`
      if (data === '0x95d89b41') return encodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', result: 'USDC' })
      if (data.startsWith('0x70a08231')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: state.balance })
      if (data.startsWith('0xdd62ed3e')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: state.allowance })
      return to.toLowerCase() === CCTP_KIT_BRIDGE_TESTNET.toLowerCase() ? '0x' : '0x'
    }
    if (method === 'eth_sendTransaction') {
      if (state.rejectSend) throw Object.assign(new Error('User rejected the request'), { code: 4001 })
      return txHash
    }
    if (method === 'eth_requestAccounts' || method === 'personal_sign' || method === 'eth_sign' || method === 'eth_sendRawTransaction') throw new Error(`Forbidden wallet method ${method}`)
    throw new Error(`Unexpected provider method ${method}`)
  } }
  const circle = new CCTPV2BridgingProvider()
  Object.defineProperty(circle, 'getMaxFee', { value: async (params: { amount: string; config: { transferSpeed: string } }) => {
    assert.equal(params.amount, amount.toString())
    return params.config.transferSpeed === 'FAST' ? { providerFee: 80n, forwarderFee: 20n } : { providerFee: 0n, forwarderFee: 20n }
  } })
  if (burn) Object.defineProperty(circle, 'burn', { value: async (params: { amount: string; config: { maxFee?: string } }) => {
    state.burnPreparations++
    const fee = BigInt(params.config.maxFee ?? '0')
    const data = encodeFunctionData({
      abi: CIRCLE_CUSTOM_BURN_WITH_HOOK_ABI, functionName: 'bridgeWithPreapprovalAndHook',
      args: [{ amount: BigInt(params.amount), maxFee: fee, fee: 0n, mintRecipient: pad(account, { size: 32 }), destinationCaller: zeroHash, burnToken: TOKENS[0].address as Address, feeRecipient: CCTP_KIT_BRIDGE_TESTNET, destinationDomain: 6, minFinalityThreshold: 1000 }, CCTP_FORWARDING_HOOK_DATA],
    })
    return { type: 'evm', getCallData: () => ({ to: CCTP_KIT_BRIDGE_TESTNET, data, value: 0n }) }
  } })
  return { p, calls, state, createProvider: () => circle }
}

async function quote(f: ReturnType<typeof fixture>, speed: 'FAST' | 'SLOW' = 'FAST', now = Date.now()): Promise<BridgeToolQuote> {
  return getOfficialCctpQuote(f.p, { account, amount, transferSpeed: speed, now }, { createProvider: f.createProvider })
}

async function withMockArcRpc<T>(run: () => Promise<T>, failEthCall: () => boolean = () => false): Promise<T> {
  const previous = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string }
    const result = payload.method === 'eth_chainId' ? '0x4cef52'
      : payload.method === 'eth_gasPrice' ? '0x3b9aca00'
        : payload.method === 'eth_estimateGas' ? '0x186a0'
          : payload.method === 'eth_getBalance' ? '0x1000000000000000'
            : payload.method === 'eth_call' ? (failEthCall() ? undefined : '0x')
              : payload.method === 'eth_getBlockByNumber' ? { baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380' }
                : '0x'
    return payload.method === 'eth_call' && failEthCall()
      ? Response.json({ jsonrpc: '2.0', id: payload.id ?? 1, error: { code: 3, message: 'execution reverted' } })
      : Response.json({ jsonrpc: '2.0', id: payload.id ?? 1, result })
  }) as typeof fetch
  try { return await run() } finally { globalThis.fetch = previous }
}

test('Circle SDK quote binds Arc to Base Sepolia USDC and uses amount-minus-maximum-fee as receive floor', async () => {
  const f = fixture()
  const fast = await quote(f, 'FAST')
  assert.equal(fast.asset, 'USDC')
  assert.equal(fast.sourceChainId, 5042002)
  assert.equal(fast.destinationChainId, 84532)
  assert.equal(fast.destinationDomain, 6)
  assert.equal(fast.spender, CCTP_KIT_BRIDGE_TESTNET)
  assert.equal(fast.totalDebit, amount)
  assert.equal(fast.providerFee, 80n)
  assert.equal(fast.forwarderFee, 20n)
  assert.equal(fast.maxFee, 100n)
  assert.equal(fast.expectedReceive, amount - 100n)
  assert.equal(fast.expiresAt, fast.quotedAt + 45_000)
  const slow = await quote(f, 'SLOW')
  assert.equal(slow.transferSpeed, 'SLOW')
  assert.equal(slow.maxFee, 20n)
})

test('CCTP fails closed for unsupported speed, asset, route, unavailable provider, changed wallet context, and expired quote', async () => {
  const f = fixture()
  const params = { account, amount: '1', asset: 'USDC', sourceChainId: 5042002, destinationChainId: 84532 }
  const deps = { createProvider: f.createProvider }
  assert.equal((await quoteBridge(f.p, { ...params, transferSpeed: 'TURBO' as never }, Date.now(), deps)).status, 'UNAVAILABLE')
  assert.equal((await quoteBridge(f.p, { ...params, asset: 'EURC' }, Date.now(), deps)).status, 'UNAVAILABLE')
  assert.equal((await quoteBridge(f.p, { ...params, destinationChainId: 84532 + 1 }, Date.now(), deps)).status, 'UNAVAILABLE')
  assert.equal((await quoteBridge(f.p, params, Date.now(), { createProvider: () => { throw new Error('Circle provider unavailable') } })).status, 'UNAVAILABLE')
  const wrongChain: SendProvider = { request: (args) => args.method === 'eth_chainId' ? Promise.resolve('0x1') : f.p.request(args) }
  assert.equal((await quoteBridge(wrongChain, params, Date.now(), deps)).status, 'UNAVAILABLE')
  const changedAccount: SendProvider = { request: (args) => args.method === 'eth_accounts' ? Promise.resolve(['0x2222222222222222222222222222222222222222']) : f.p.request(args) }
  assert.equal((await quoteBridge(changedAccount, params, Date.now(), deps)).status, 'UNAVAILABLE')
  const q = await quote(f)
  await assert.rejects(prepareOfficialCctpBurn(f.p, q, q.expiresAt + 1, deps), /expired/i)
})

test('CCTP approval uses one exact finite approve request and never submits a burn with it', async () => {
  await withMockArcRpc(async () => {
    const f = fixture(true)
    const q = await quote(f)
    const action = await prepareExactCctpApproval(f.p, q, 0n, Date.now(), { createProvider: f.createProvider })
    assert.equal(action.kind, 'approval')
    assert.equal(action.request.to, TOKENS[0].address)
    assert.equal(action.request.from, account)
    assert.equal(action.request.value, '0x0')
    assert.equal((await simulatePreparedCctpCall(action)).success, true)
    assert.equal(f.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0)
    assert.equal(await executePreparedCctpCall(action), txHash)
    const writes = f.calls.filter((call) => call.method === 'eth_sendTransaction')
    assert.equal(writes.length, 1)
    const transaction = writes[0]!.params[0] as { to: string; from: string; data: Hex; value: string }
    assert.equal(transaction.to, TOKENS[0].address)
    assert.equal(transaction.from, account)
    assert.equal(transaction.value, '0x0')
    assert.equal(transaction.data.slice(0, 10), '0x095ea7b3')
    assert.equal(f.calls.some((call) => call.method === 'eth_requestAccounts' || call.method === 'personal_sign' || call.method === 'eth_sign' || call.method === 'eth_sendRawTransaction'), false)
    await assert.rejects(executePreparedCctpCall(action), /already been used/)
    assert.equal(f.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1)
  })
})

test('Circle SDK burn calldata is preserved by the captured /next request through simulation and one mock wallet write', async () => {
  await withMockArcRpc(async () => {
    const f = fixture(false)
    const q = await quote(f)
    const action = await prepareOfficialCctpBurn(f.p, q)
    assert.equal(action.kind, 'cctp-burn')
    assert.equal(action.request.to, CCTP_KIT_BRIDGE_TESTNET)
    assert.equal(action.request.from, account)
    assert.equal(action.request.value, '0x0')
    assert.equal(action.cctp?.destinationDomain, 6)
    assert.equal(action.cctp?.amount, amount)
    assert.equal(action.cctp?.maxFee, q.maxFee)
    assert.equal(action.cctp?.expectedReceive, q.expectedReceive)
    assert.equal((await simulatePreparedCctpCall(action)).success, true)
    assert.equal(f.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0)
    assert.equal(await executePreparedCctpCall(action), txHash)
    const writes = f.calls.filter((call) => call.method === 'eth_sendTransaction')
    assert.equal(writes.length, 1)
    const transaction = writes[0]!.params[0] as { to: string; from: string; data: Hex; value: string }
    assert.equal(transaction.to, CCTP_KIT_BRIDGE_TESTNET)
    assert.equal(transaction.from, action.request.from)
    assert.equal(transaction.data, action.request.data)
    assert.equal(transaction.value, '0x0')
    assert.equal(f.calls.some((call) => call.method === 'eth_requestAccounts' || call.method === 'personal_sign' || call.method === 'eth_sign' || call.method === 'eth_sendRawTransaction'), false)
  })
})

test('fresh Circle preparations require structural material identity and ignore gas-only variation', async () => {
  await withMockArcRpc(async () => {
    const f = fixture()
    const q = await quote(f)
    const first = await prepareOfficialCctpBurn(f.p, q)
    const fresh = await prepareOfficialCctpBurn(f.p, q)
    assert.equal(sameCctpActionMaterial(first, fresh), true)
    assert.equal(cctpGasEstimateChanged(first.gasEstimate, fresh.gasEstimate), false)
    const gasChanged = { ...fresh, gasEstimate: { gasLimit: 999_999n, unitPrice: 9n, maximumFee: 8_999_991n } }
    assert.equal(sameCctpActionMaterial(first, gasChanged), true)
    assert.equal(cctpGasEstimateChanged(first.gasEstimate, gasChanged.gasEstimate), true)

    const invalid = (action: unknown) => action as PreparedToolAction
    const changed: PreparedToolAction[] = [
      invalid({ ...fresh, request: { ...fresh.request, to: CCTP_TOKEN_MESSENGER_V2 } }),
      invalid({ ...fresh, request: { ...fresh.request, data: `0x${'12'.repeat(4)}` as Hex } }),
      invalid({ ...fresh, request: { ...fresh.request, value: '0x1' } }),
      invalid({ ...fresh, account: '0x2222222222222222222222222222222222222222' as Address }),
      invalid({ ...fresh, chainId: 1 }),
      invalid({ ...fresh, cctp: { ...fresh.cctp!, amount: fresh.cctp!.amount + 1n } }),
      invalid({ ...fresh, cctp: { ...fresh.cctp!, recipient: '0x2222222222222222222222222222222222222222' as Address } }),
      invalid({ ...fresh, cctp: { ...fresh.cctp!, spender: CCTP_TOKEN_MESSENGER_V2 } }),
      invalid({ ...fresh, cctp: { ...fresh.cctp!, maxFee: fresh.cctp!.maxFee + 1n } }),
    ]
    for (const altered of changed) assert.equal(sameCctpActionMaterial(first, altered), false)
  })
})

test('CCTP simulation failure blocks before any wallet request', async () => {
  let fail = false
  await withMockArcRpc(async () => {
    const f = fixture()
    const q = await quote(f)
    const action = await prepareOfficialCctpBurn(f.p, q)
    fail = true
    const simulation = await simulatePreparedCctpCall(action)
    assert.equal(simulation.success, false)
    assert.match(simulation.error ?? '', /revert/i)
    assert.equal(f.calls.some((call) => call.method === 'eth_sendTransaction'), false)
  }, () => fail)
})

test('mock connected EIP-1193 Flow A uses no approval and Flow B submits only an exact approval', async () => {
  await withMockArcRpc(async () => {
    const sufficient = fixture(true)
    const depsA = { createProvider: sufficient.createProvider }
    const quoteA = await quoteBridge(sufficient.p, { account, amount: '1', asset: 'USDC', sourceChainId: 5042002, destinationChainId: 84532 }, Date.now(), depsA)
    assert.equal(quoteA.status, 'OK')
    const burn = await prepareCctpBurn(sufficient.p, quoteA.data!, Date.now(), depsA)
    assert.equal(burn.kind, 'cctp-burn')
    assert.equal(sufficient.state.burnPreparations, 1)
    assert.equal(sufficient.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0)
    assert.equal(sufficient.calls.some((call) => call.method === 'eth_call' && String((call.params[0] as { data?: string })?.data).startsWith('0x095ea7b3')), false)

    const insufficient = fixture(true)
    insufficient.state.allowance = 0n
    const depsB = { createProvider: insufficient.createProvider }
    const quoteB = await quoteBridge(insufficient.p, { account, amount: '1', asset: 'USDC', sourceChainId: 5042002, destinationChainId: 84532 }, Date.now(), depsB)
    assert.equal(quoteB.status, 'OK')
    const approval = await prepareCctpApproval(insufficient.p, quoteB.data!, 0n, Date.now(), depsB)
    assert.equal(approval.kind, 'approval')
    assert.equal((await simulatePreparedCctpCall(approval)).success, true)
    assert.equal(await requestReviewedCctpAction(approval, new SendSubmissionGuard()), txHash)
    const writes = insufficient.calls.filter((call) => call.method === 'eth_sendTransaction')
    assert.equal(writes.length, 1)
    const request = writes[0]!.params[0] as { to: string; from: string; data: Hex; value: string }
    assert.equal(request.to, TOKENS[0]!.address)
    assert.equal(request.from, account)
    assert.equal(request.value, '0x0')
    const approvalCall = decodeFunctionData({ abi: erc20Abi, data: request.data })
    assert.equal(approvalCall.functionName, 'approve')
    assert.equal(approvalCall.args[1], quoteB.data!.totalDebit)
    assert.equal(insufficient.state.burnPreparations, 0)
  })
})

test('CCTP approval rejection submits no transaction hash and cannot be retried from the same prepared request', async () => {
  await withMockArcRpc(async () => {
    const f = fixture()
    f.state.allowance = 0n
    const q = await quote(f)
    const action = await prepareExactCctpApproval(f.p, q, 0n, Date.now(), { createProvider: f.createProvider })
    f.state.rejectSend = true
    await assert.rejects(requestReviewedCctpAction(action, new SendSubmissionGuard()), /rejected/)
    assert.equal(f.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1)
    await assert.rejects(executePreparedCctpCall(action), /already been used/)
  })
})

test('CCTP burn rejection returns no hash and cannot retry the same reviewed request', async () => {
  await withMockArcRpc(async () => {
    const f = fixture(true)
    const q = await quote(f)
    const action = await prepareOfficialCctpBurn(f.p, q, Date.now(), { createProvider: f.createProvider })
    assert.equal((await simulatePreparedCctpCall(action)).success, true)
    f.state.rejectSend = true
    await assert.rejects(requestReviewedCctpAction(action, new SendSubmissionGuard()), /rejected/)
    assert.equal(f.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1)
    await assert.rejects(executePreparedCctpCall(action), /already been used/)
  })
})
