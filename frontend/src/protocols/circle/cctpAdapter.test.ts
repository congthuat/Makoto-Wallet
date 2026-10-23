import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import test from 'node:test'
import { CCTPV2BridgingProvider } from '@circle-fin/provider-cctp-v2'
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, erc20Abi, pad, zeroHash, type Address, type Hex } from 'viem'
import { TOKENS } from '../../lib/wallet.ts'
import type { SendProvider } from '../../lib/sendExecution.ts'
import { CCTP_FORWARDING_HOOK_DATA, CCTP_KIT_BRIDGE_TESTNET, CCTP_MESSAGE_TRANSMITTER_V2, CCTP_TOKEN_MESSENGER_V2 } from '../../migrated/cctp.ts'
import type { BridgeToolQuote, PreparedGasEstimate, PreparedToolAction } from '../../migrated/toolLayer.ts'
import { prepareCctpApproval, prepareCctpBurn, quoteBridge } from '../../migrated/toolLayer.ts'
import { requestReviewedCctpAction } from '../../migrated/protocolExecution.ts'
import { SendSubmissionGuard } from '../../lib/sendExecution.ts'
import { CIRCLE_CUSTOM_BURN_WITH_HOOK_ABI, cctpGasCeilingExceeded, cctpGasEstimateChanged, executePreparedCctpCall, getOfficialCctpQuote, getOfficialCctpStatus, prepareExactCctpApproval, prepareOfficialCctpBurn, sameCctpActionMaterial, simulatePreparedCctpCall } from './cctpAdapter.ts'
import { makeArcRpcBridgeProvider } from '../../lib/arcRpcBridgeProvider.ts'
import { _setArcRpcUrlForTest, _getArcRpcUrl } from '../../lib/arcRpc.ts'
import { _setRpcTimeoutMsForTest } from '../../lib/rpcTimeout.ts'

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
  return withMockArcRpc(() => getOfficialCctpQuote(f.p, { account, amount, transferSpeed: speed, now }, { createProvider: f.createProvider }),
    () => false, { allowance: f.state.allowance, balance: f.state.balance })
}

type MockArcRpcState = { allowance?: bigint; balance?: bigint }
async function withMockArcRpc<T>(run: () => Promise<T>, failEthCall: () => boolean = () => false, mockState?: MockArcRpcState): Promise<T> {
  const previous = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string; params?: unknown[] }
    const id = payload.id ?? 1
    if (payload.method === 'eth_call' && failEthCall()) {
      return Response.json({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } })
    }
    let result: unknown = '0x'
    if (payload.method === 'eth_chainId') result = '0x4cef52'
    else if (payload.method === 'eth_gasPrice') result = '0x3b9aca00'
    else if (payload.method === 'eth_estimateGas') result = '0x186a0'
    else if (payload.method === 'eth_getBalance') result = '0x1000000000000000'
    else if (payload.method === 'eth_getBlockByNumber') result = { baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380' }
    else if (payload.method === 'eth_getCode') result = '0x6000'
    else if (payload.method === 'eth_call') {
      // Decode calldata to return ABI-correct responses.
      // verifyToken calls decimals (0x313ce567), symbol (0x95d89b41).
      // readBalance calls balanceOf (0x70a08231).
      // readAllowance calls allowance (0xdd62ed3e).
      const callParams = payload.params as [{ to: string; data: string }, string] | undefined
      const { data = '', to = '' } = callParams?.[0] ?? {}
      if (data === '0x313ce567') result = '0x6' // decimals = 6
      else if (data === '0x95d89b41') result = encodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', result: 'USDC' })
      else if (data.startsWith('0x70a08231')) result = encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: mockState?.balance ?? 10_000_000n })
      else if (data.startsWith('0xdd62ed3e')) result = encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: mockState?.allowance ?? 2_000_000n })
      else result = to ? '0x' : '0x'
    }
    else if (payload.method === 'eth_getTransactionReceipt') result = null
    else if (payload.method === 'eth_getTransactionByHash') result = null
    return Response.json({ jsonrpc: '2.0', id, result })
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
  await withMockArcRpc(async () => {
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

test('CCTP gas review permits a fresh estimate at or below the reviewed total cost ceiling', () => {
  const reviewed: PreparedGasEstimate = { gasLimit: 100_000n, unitPrice: 10n, maximumFee: 1_000_000n }
  const acceptable: PreparedGasEstimate[] = [
    reviewed,
    { gasLimit: 90_000n, unitPrice: 10n, maximumFee: 900_000n },
    { gasLimit: 100_000n, unitPrice: 9n, maximumFee: 900_000n },
    { gasLimit: 200_000n, unitPrice: 5n, maximumFee: 1_000_000n },
    { gasLimit: 50_000n, unitPrice: 20n, maximumFee: 1_000_000n },
  ]
  for (const fresh of acceptable) assert.equal(cctpGasCeilingExceeded(reviewed, fresh), false)
  assert.equal(cctpGasCeilingExceeded(reviewed, { gasLimit: 100_001n, unitPrice: 10n, maximumFee: 1_000_010n }), true)
  assert.equal(cctpGasCeilingExceeded(reviewed, { gasLimit: 100_000n, unitPrice: 11n, maximumFee: 1_100_000n }), true)
})

test('CCTP gas review fails closed for absent, nonpositive, or inconsistent estimates', () => {
  const valid: PreparedGasEstimate = { gasLimit: 100_000n, unitPrice: 10n, maximumFee: 1_000_000n }
  const invalid: (PreparedGasEstimate | undefined)[] = [
    undefined,
    { ...valid, gasLimit: 0n },
    { ...valid, gasLimit: -1n },
    { ...valid, unitPrice: 0n },
    { ...valid, unitPrice: -1n },
    { ...valid, maximumFee: 0n },
    { ...valid, maximumFee: -1n },
    { ...valid, maximumFee: valid.maximumFee - 1n },
    { ...valid, maximumFee: valid.maximumFee + 1n },
  ]
  for (const estimate of invalid) {
    assert.equal(cctpGasCeilingExceeded(valid, estimate), true)
    assert.equal(cctpGasCeilingExceeded(estimate, valid), true)
  }
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
  // Flow A: sufficient.state.allowance = 2_000_000n (default) — no approval needed
  const sufficient = fixture(true)
  await withMockArcRpc(async () => {
    const depsA = { createProvider: sufficient.createProvider }
    const quoteA = await quoteBridge(sufficient.p, { account, amount: '1', asset: 'USDC', sourceChainId: 5042002, destinationChainId: 84532 }, Date.now(), depsA)
    assert.equal(quoteA.status, 'OK')
    const burn = await prepareCctpBurn(sufficient.p, quoteA.data!, Date.now(), depsA)
    assert.equal(burn.kind, 'cctp-burn')
    assert.equal(sufficient.state.burnPreparations, 1)
    assert.equal(sufficient.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0)
    assert.equal(sufficient.calls.some((call) => call.method === 'eth_call' && String((call.params[0] as { data?: string })?.data).startsWith('0x095ea7b3')), false)
  }, () => false, { allowance: sufficient.state.allowance, balance: sufficient.state.balance })

  // Flow B: insufficient.state.allowance = 0n — approval required
  const insufficient = fixture(true)
  insufficient.state.allowance = 0n
  await withMockArcRpc(async () => {
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
  }, () => false, { allowance: 0n, balance: insufficient.state.balance })
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

const statusInput = { account, burnHash: txHash, destinationDomain: 6, recipient: account, expectedReceive: amount - 100n, maxFee: 100n, finalityThreshold: 1000n }
const statusDestination = new CCTPV2BridgingProvider().supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === 84532)!
const statusDestinationMessenger = statusDestination.cctp!.contracts.v2!.type === 'split' ? statusDestination.cctp!.contracts.v2!.tokenMessenger : ''
const statusMessage = () => ({
  message: '0x01', eventNonce: '1', attestation: '0xab', cctpVersion: 2, status: 'complete',
  forwardState: 'CONFIRMED', forwardTxHash: txHash,
  decodedMessage: {
    sourceDomain: '26', destinationDomain: '6', sender: pad(CCTP_TOKEN_MESSENGER_V2, { size: 32 }),
    recipient: pad(statusDestinationMessenger as Address, { size: 32 }), minFinalityThreshold: '1000',
    decodedMessageBody: { burnToken: TOKENS[0]!.address, mintRecipient: account, amount: amount.toString(), messageSender: CCTP_KIT_BRIDGE_TESTNET, maxFee: '100', feeExecuted: '100' },
  },
})

type CapturedCircleMessage = Awaited<ReturnType<CCTPV2BridgingProvider['fetchAttestation']>>
type CapturedCircleResponse = { messages: CapturedCircleMessage[]; sourceTxHash: Hex }
const capturedStatusInput = {
  account: '0x16299b74c616994eaecb9b20e37d369d5d62586b' as Address,
  burnHash: '0x452e3fcc7a2112e4940b19e23e065cf62dadcd20ffb53d620361ab57d605dba4' as Hex,
  destinationDomain: 6,
  recipient: '0x16299b74c616994eaecb9b20e37d369d5d62586b' as Address,
  expectedReceive: 945_701n,
  maxFee: 54_299n,
  finalityThreshold: 1000n,
}
const capturedForwardHash = '0x5053ac4396a41769dd18e72f353de75533d458ecab3d5e8f7fd8c1d693e0fbe9'
const capturedCircleResponse = () => JSON.parse(readFileSync(new URL('../../../tests/fixtures/cctp-v2-completed-arc-base-sepolia.json', import.meta.url), 'utf8')) as CapturedCircleResponse

async function readCapturedCircleStatus(response: CapturedCircleResponse) {
  const f = fixture()
  const previous = globalThis.fetch
  let attempts = 0
  // Only the HTTP transport is mocked: the installed Circle SDK parses the
  // captured sandbox response and validates its completion status normally.
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), `https://iris-api-sandbox.circle.com/v2/messages/26?transactionHash=${capturedStatusInput.burnHash}`)
    assert.equal(init?.method ?? 'GET', 'GET')
    attempts++
    return Response.json(response)
  }) as typeof fetch
  try {
    const status = await getOfficialCctpStatus(f.p, capturedStatusInput)
    assert.equal(attempts, 1)
    assert.deepEqual(f.calls, [], 'status recovery must not request any wallet method')
    return status
  } finally { globalThis.fetch = previous }
}

test('actual Circle SDK accepts the captured completed Arc transfer with destination TokenMessenger and plain mintRecipient', async () => {
  const response = capturedCircleResponse()
  const message = response.messages[0]!
  assert.equal(response.sourceTxHash, capturedStatusInput.burnHash)
  assert.equal(message.status, 'complete')
  assert.equal(message.forwardState, 'COMPLETE')
  assert.equal(message.decodedMessage.recipient, '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa')
  assert.equal(message.decodedMessage.recipient.toLowerCase(), statusDestinationMessenger.toLowerCase())
  assert.equal(message.decodedMessage.decodedMessageBody.mintRecipient, capturedStatusInput.recipient)
  const status = await readCapturedCircleStatus(response)
  assert.equal(status.state, 'attestation-available')
  assert.equal(status.forwardTxHash, capturedForwardHash)
  assert.equal(status.actualReceive, 945_701n)
  assert.equal(status.eventNonce, message.eventNonce)
})

test('actual Circle SDK accepts equivalent padded TokenMessenger and mintRecipient representations', async () => {
  const response = capturedCircleResponse()
  const decoded = response.messages[0]!.decodedMessage
  decoded.recipient = pad(decoded.recipient as Address, { size: 32 })
  decoded.decodedMessageBody.mintRecipient = pad(capturedStatusInput.recipient, { size: 32 })
  const status = await readCapturedCircleStatus(response)
  assert.equal(status.state, 'attestation-available')
  assert.equal(status.forwardTxHash, capturedForwardHash)
  assert.equal(status.actualReceive, capturedStatusInput.expectedReceive)
})

const capturedInvalidBindings: [string, (message: CapturedCircleMessage) => void][] = [
  ['wrong destination TokenMessenger', (message) => { message.decodedMessage.recipient = account }],
  ['MessageTransmitter as message-header recipient', (message) => { message.decodedMessage.recipient = CCTP_MESSAGE_TRANSMITTER_V2 }],
  ['wrong plain mintRecipient', (message) => { message.decodedMessage.decodedMessageBody.mintRecipient = account }],
  ['wrong padded mintRecipient', (message) => { message.decodedMessage.decodedMessageBody.mintRecipient = pad(account, { size: 32 }) }],
  ['nonzero bytes32 prefix on mintRecipient', (message) => { message.decodedMessage.decodedMessageBody.mintRecipient = `0x${'01'.repeat(12)}${capturedStatusInput.recipient.slice(2)}` }],
  ['wrong destinationDomain', (message) => { message.decodedMessage.destinationDomain = '0' }],
  ['wrong maxFee', (message) => { message.decodedMessage.decodedMessageBody.maxFee = '54300' }],
  ['feeExecuted above the reviewed maximum', (message) => { message.decodedMessage.decodedMessageBody.feeExecuted = '54300' }],
  ['receive amount below the reviewed floor', (message) => { message.decodedMessage.decodedMessageBody.amount = '999999' }],
  ['wrong minimum finality threshold', (message) => { message.decodedMessage.minFinalityThreshold = '2000' }],
]
for (const [name, mutate] of capturedInvalidBindings) {
  test(`actual Circle SDK rejects captured recovery evidence with ${name}`, async () => {
    const response = capturedCircleResponse()
    mutate(response.messages[0]!)
    const status = await readCapturedCircleStatus(response)
    assert.equal(status.state, 'unavailable')
    assert.match(status.reason!, /do not match the reviewed burn route and receive floor/)
    assert.equal(status.forwardTxHash, undefined)
    assert.equal(status.actualReceive, undefined)
  })
}

for (const pending of ['empty', 'pending', '404'] as const) {
  test(`actual Circle SDK ${pending} response is attestation-pending after bounded read-only attempts`, async (t) => {
    const f = fixture()
    const previous = globalThis.fetch
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let attempts = 0
    let firstRequest!: () => void
    const started = new Promise<void>((resolve) => { firstRequest = resolve })
    globalThis.fetch = (async (url) => {
      assert.match(String(url), /iris-api-sandbox\.circle\.com\/v2\/messages\/26\?transactionHash=/)
      attempts++
      firstRequest()
      return pending === '404' ? new Response('{}', { status: 404, statusText: 'Not Found' })
        : Response.json({ messages: pending === 'empty' ? [] : [{ ...statusMessage(), status: 'pending', attestation: 'PENDING' }] })
    }) as typeof fetch
    try {
      const result = getOfficialCctpStatus(f.p, statusInput, { createProvider: f.createProvider })
      await started
      await new Promise(setImmediate)
      assert.equal(attempts, 1)
      t.mock.timers.tick(4_999)
      await new Promise(setImmediate)
      assert.equal(attempts, 1)
      t.mock.timers.tick(1)
      assert.deepEqual(await result, { state: 'attestation-pending' })
      assert.equal(attempts, 2)
      assert.equal(f.calls.length, 0)
    } finally { globalThis.fetch = previous; t.mock.timers.reset() }
  })
}

test('actual Circle SDK accepts a status response slower than the former 1.5-second cutoff', async (t) => {
  const f = fixture()
  const previous = globalThis.fetch
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let firstRequest!: () => void
  const started = new Promise<void>((resolve) => { firstRequest = resolve })
  let attempts = 0
  globalThis.fetch = (async (_url, init) => new Promise<Response>((resolve, reject) => {
    attempts++
    firstRequest()
    const timer = setTimeout(() => resolve(Response.json({ messages: [statusMessage()] })), 1_700)
    init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Request timed out', 'AbortError')) }, { once: true })
  })) as typeof fetch
  try {
    const result = getOfficialCctpStatus(f.p, statusInput, { createProvider: f.createProvider })
    await started
    t.mock.timers.tick(1_700)
    const status = await result
    assert.equal(status.state, 'attestation-available')
    assert.equal(status.forwardTxHash, txHash)
    assert.equal(status.actualReceive, statusInput.expectedReceive)
    assert.equal(attempts, 1)
    assert.equal(f.calls.length, 0)
  } finally { globalThis.fetch = previous; t.mock.timers.reset() }
})

test('actual Circle SDK status timeouts remain unavailable after two 10-second attempts', async (t) => {
  const f = fixture()
  const previous = globalThis.fetch
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let firstRequest!: () => void
  const started = new Promise<void>((resolve) => { firstRequest = resolve })
  let attempts = 0
  globalThis.fetch = (async (_url, init) => new Promise<Response>((_resolve, reject) => {
    attempts++
    firstRequest()
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Request timed out', 'AbortError')), { once: true })
  })) as typeof fetch
  try {
    const result = getOfficialCctpStatus(f.p, statusInput, { createProvider: f.createProvider })
    await started
    t.mock.timers.tick(9_999)
    await new Promise(setImmediate)
    assert.equal(attempts, 1)
    t.mock.timers.tick(1)
    await new Promise(setImmediate)
    t.mock.timers.tick(5_000)
    await new Promise(setImmediate)
    assert.equal(attempts, 2)
    t.mock.timers.tick(10_000)
    const status = await result
    assert.equal(status.state, 'unavailable')
    assert.match(status.reason!, /Request timed out/)
    assert.equal(attempts, 2)
    assert.equal(f.calls.length, 0)
  } finally { globalThis.fetch = previous; t.mock.timers.reset() }
})

// ---------------------------------------------------------------------------
// Regression: OKX-style hung provider — Bridge must not stall on read-only calls
// ---------------------------------------------------------------------------

test('arcRpcBridgeProvider routes read-only methods to Arc RPC, not the injected provider', async () => {
  // Simulate an OKX-style provider that answers eth_accounts/eth_chainId but
  // hangs forever on eth_estimateGas, eth_call, eth_gasPrice, eth_getBalance.
  const walletCalls: string[] = []
  const hungMethods = new Set(['eth_estimateGas', 'eth_call', 'eth_gasPrice', 'eth_getBalance', 'eth_getCode'])
  const okxProvider: SendProvider = { request: async ({ method }: { method: string }): Promise<unknown> => {
    walletCalls.push(method)
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    if (hungMethods.has(method)) return new Promise(() => { /* hang forever */ })
    throw new Error(`Unexpected OKX provider method: ${method}`)
  } }

  const arcRpcCalls: string[] = []
  const previousUrl = _getArcRpcUrl()
  // Spin up a minimal Arc RPC mock
  await new Promise<void>((resolve) => {
    const srv = createServer((_req, res) => {
      let body = ''
      _req.on('data', (c: Buffer) => { body += c.toString() })
      _req.on('end', () => {
        const { method, id } = JSON.parse(body) as { method: string; id: number }
        arcRpcCalls.push(method)
        let result: unknown = '0x0'
        if (method === 'eth_estimateGas') result = '0x186a0'
        if (method === 'eth_gasPrice') result = '0x3b9aca00'
        if (method === 'eth_getBalance') result = '0x1000000000000000'
        if (method === 'eth_call') result = '0x' + '0'.repeat(64)
        if (method === 'eth_getCode') result = '0x6000'
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
      })
    })
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      _setArcRpcUrlForTest(`http://127.0.0.1:${port}`)
      // Close after all tests in this block finish.
      setTimeout(() => srv.close(), 2000)
      resolve()
    })
  })
  _setRpcTimeoutMsForTest(5_000)

  try {
    const wrapped = makeArcRpcBridgeProvider(okxProvider)

    // Read-only methods must go via Arc RPC (fast), not the hung OKX provider.
    const gasPrice = await wrapped.request({ method: 'eth_gasPrice', params: [] })
    assert.equal(gasPrice, '0x3b9aca00', 'eth_gasPrice should come from Arc RPC')
    assert.ok(!walletCalls.includes('eth_gasPrice'), 'OKX provider must NOT receive eth_gasPrice')
    assert.ok(arcRpcCalls.includes('eth_gasPrice'), 'Arc RPC must receive eth_gasPrice')

    const estimate = await wrapped.request({ method: 'eth_estimateGas', params: [{}] })
    assert.equal(estimate, '0x186a0', 'eth_estimateGas should come from Arc RPC')
    assert.ok(!walletCalls.includes('eth_estimateGas'), 'OKX provider must NOT receive eth_estimateGas')

    const callResult = await wrapped.request({ method: 'eth_call', params: [{}] })
    assert.ok(typeof callResult === 'string', 'eth_call should return a hex string from Arc RPC')
    assert.ok(!walletCalls.includes('eth_call'), 'OKX provider must NOT receive eth_call')

    // Wallet-interactive methods must still go through the injected provider.
    const chainId = await wrapped.request({ method: 'eth_chainId', params: [] })
    assert.equal(chainId, '0x4cef52', 'eth_chainId should come from wallet provider')
    assert.ok(walletCalls.includes('eth_chainId'), 'OKX provider must receive eth_chainId')

    const accounts = await wrapped.request({ method: 'eth_accounts', params: [] })
    assert.deepEqual(accounts, [account], 'eth_accounts should come from wallet provider')
    assert.ok(walletCalls.includes('eth_accounts'), 'OKX provider must receive eth_accounts')

  } finally {
    _setArcRpcUrlForTest(previousUrl)
    _setRpcTimeoutMsForTest(undefined)
  }
})

test('arcRpcBridgeProvider: eth_sendTransaction always goes to injected provider, never Arc RPC', async () => {
  let sentToProvider = false
  const sendProvider: SendProvider = { request: async ({ method }: { method: string }): Promise<unknown> => {
    if (method === 'eth_sendTransaction') { sentToProvider = true; return `0x${'b'.repeat(64)}` }
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`Unexpected: ${method}`)
  } }

  const arcRpcCallsSend: string[] = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (_u, init) => {
    const { method, id } = JSON.parse(String((init as RequestInit).body ?? '{}')) as { method: string; id: number }
    arcRpcCallsSend.push(method)
    return Response.json({ jsonrpc: '2.0', id, result: '0x0' })
  }) as typeof fetch

  try {
    const wrapped = makeArcRpcBridgeProvider(sendProvider)
    const hash = await wrapped.request({ method: 'eth_sendTransaction', params: [{ from: account, to: account, value: '0x0' }] })
    assert.ok(sentToProvider, 'eth_sendTransaction must go through the injected provider')
    assert.ok(!arcRpcCallsSend.includes('eth_sendTransaction'), 'Arc RPC must never receive eth_sendTransaction')
    assert.ok(typeof hash === 'string' && hash.startsWith('0x'), 'should return a tx hash from provider')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('CCTP prepare+estimate uses Arc RPC for gas when OKX provider hangs eth_estimateGas', async () => {
  // This test proves the regression fix: before arcRpcBridgeProvider,
  // prepareCctpApproval would hang because the Circle SDK viem adapter called
  // eth_estimateGas through the OKX provider which never responds.
  const f = fixture()
  // Override the injected provider to hang on eth_estimateGas
  const originalRequest = f.p.request.bind(f.p)
  let estimateGasCalledOnProvider = false
  f.p.request = async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (method === 'eth_estimateGas') {
      estimateGasCalledOnProvider = true
      return new Promise(() => { /* hung forever — OKX behaviour */ })
    }
    return originalRequest({ method, params })
  }

  const q = await quote(f, 'FAST')
  // prepareCctpApproval must complete despite the hung provider because
  // arcRpcBridgeProvider redirects eth_estimateGas to Arc RPC.
  const approval = await withMockArcRpc(
    () => prepareCctpApproval(f.p, q, 0n),
    () => false,
    { allowance: 0n, balance: 10_000_000n },
  )
  assert.equal(approval.kind, 'approval', 'should prepare an approval action')
  assert.ok(approval.gasEstimate && approval.gasEstimate.gasLimit > 0n, 'gas estimate must be non-zero from Arc RPC')
  assert.equal(estimateGasCalledOnProvider, false,
    'eth_estimateGas must NOT reach the hung OKX provider — arcRpcBridgeProvider must intercept it')
})

test('Circle status retries preserve every reviewed message binding and cannot claim destination completion', async () => {
  const f = fixture()
  const circle = f.createProvider()
  let message = statusMessage()
  Object.defineProperty(circle, 'fetchAttestation', { value: async () => message })
  const read = () => getOfficialCctpStatus(f.p, statusInput, { createProvider: () => circle })
  assert.equal((await read()).state, 'attestation-available')
  const changes = [
    { decodedMessage: { ...message.decodedMessage, sourceDomain: '0' } },
    { decodedMessage: { ...message.decodedMessage, destinationDomain: '0' } },
    { decodedMessage: { ...message.decodedMessage, sender: pad(account, { size: 32 }) } },
    { decodedMessage: { ...message.decodedMessage, recipient: pad(account, { size: 32 }) } },
    { decodedMessage: { ...message.decodedMessage, minFinalityThreshold: '2000' } },
    ...Object.entries({ burnToken: account, mintRecipient: pad(CCTP_KIT_BRIDGE_TESTNET, { size: 32 }), messageSender: account, maxFee: '101', feeExecuted: '101', amount: '999999' }).map(([field, value]) => ({ decodedMessage: { ...message.decodedMessage, decodedMessageBody: { ...message.decodedMessage.decodedMessageBody, [field]: value } } })),
  ]
  for (const change of changes) {
    message = { ...statusMessage(), ...change }
    const status = await read()
    assert.equal(status.state, 'unavailable')
    assert.match(status.reason!, /do not match the reviewed burn route and receive floor/)
    assert.equal(status.forwardTxHash, undefined)
  }
  assert.equal(f.calls.length, 0)
})
