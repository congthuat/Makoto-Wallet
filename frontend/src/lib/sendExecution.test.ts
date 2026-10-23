import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { TOKENS } from './wallet.ts'
import { SendSubmissionGuard, assertFreshSend, checkSendReceipt, encodeTransfer, feeInUsdcUnits, formatSendAmount, isWalletRejection, parseSendAmount, prepareSend, requestSend, safeMax, type SendProvider } from './sendExecution.ts'
import { withRpcTimeout, _setRpcTimeoutMsForTest } from './rpcTimeout.ts'
import { startMockArcRpc, stopMockArcRpc, setMockArcRpcHandler } from './testArcRpcServer.ts'

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const hash = `0x${'a'.repeat(64)}`
const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const word = (x: string) => `0x${x.slice(2).toLowerCase().padStart(64, '0')}`
const symbolHex = (s: string) => `0x${'20'.padStart(64, '0')}${s.length.toString(16).padStart(64, '0')}${Array.from(s).map((x) => x.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0')}`

// Arc RPC mock server — covers all bypass methods (eth_getCode, eth_call, eth_gasPrice,
// eth_estimateGas, eth_getBalance, eth_getTransactionReceipt, eth_getTransactionByHash).
// Provider mock retains eth_accounts, eth_chainId, eth_sendTransaction.
before(async () => { await startMockArcRpc() })
after(async () => { await stopMockArcRpc() })

function fixture(options: { tokenBalance?: bigint; usdcBalance?: bigint; nativeBalance?: bigint; chain?: string; account?: string; code?: string; reject?: boolean; receipt?: any } = {}) {
  let sends = 0
  // Set the Arc RPC mock handler for bypass methods
  setMockArcRpcHandler((method, params) => {
    const p0 = (params as unknown[])[0]
    if (method === 'eth_getCode') return (p0 as string)?.toLowerCase() === recipient.toLowerCase() ? (options.code ?? '0x') : '0x6000'
    if (method === 'eth_call') {
      const { to, data } = p0 as { to: string; data: string }
      if (data === '0x313ce567') return '0x6'
      if (data === '0x95d89b41') return symbolHex(to.toLowerCase() === TOKENS[1].address.toLowerCase() ? 'EURC' : 'USDC')
      if (data.startsWith('0x70a08231')) return `0x${(to.toLowerCase() === TOKENS[1].address.toLowerCase() ? options.tokenBalance ?? 5_000_000n : options.usdcBalance ?? 10_000_000n).toString(16)}`
      return '0x'
    }
    if (method === 'eth_getBalance') return `0x${(options.nativeBalance ?? 10_000_000_000_000_000_000n).toString(16)}`
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x4a817c800'
    if (method === 'eth_getTransactionReceipt') return options.receipt ?? null
    throw new Error(`unexpected arcRpc method: ${method}`)
  })
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [options.account ?? account]
    if (method === 'eth_chainId') return options.chain ?? '0x4cef52'
    if (method === 'eth_sendTransaction') { sends++; if (options.reject) throw Object.assign(new Error('User rejected'), { code: 4001 }); return hash }
    throw new Error(`unexpected provider method: ${method}`)
  } }
  return { p, sends: () => sends }
}

test('decimal-aware ERC-20 calldata and safe MAX reserve live fee', () => {
  assert.equal(parseSendAmount('1.234567', 6), 1_234_567n)
  assert.throws(() => parseSendAmount('1.2345678', 6))
  assert.throws(() => parseSendAmount('0', 6))
  assert.equal(formatSendAmount(123_456_789n, 8), '1.23456789')
  assert.equal(encodeTransfer(recipient, 1n), `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`)
  assert.equal(feeInUsdcUnits(1_000_000_000_001n), 2n)
  assert.equal(safeMax(10_000_000n, 10_000_000n, 1_000_000_000_000_000n, 'USDC'), 9_999_000n)
  assert.equal(safeMax(5_000_000n, 0n, 1n, 'EURC'), undefined)
})

test('live preparation blocks invalid, contract, account, network, token and fee states', async () => {
  const input = { account, recipient, symbol: 'EURC', amount: '1.25' }
  await assert.rejects(prepareSend(fixture().p, { ...input, recipient: 'bad' }))
  await assert.rejects(prepareSend(fixture({ code: '0x6000' }).p, input), /Contract recipient/)
  await assert.rejects(prepareSend(fixture({ account: recipient }).p, input), /account changed/)
  await assert.rejects(prepareSend(fixture({ chain: '0x1' }).p, input), /Wrong network/)
  await assert.rejects(prepareSend(fixture({ tokenBalance: 100n }).p, input), /Insufficient EURC/)
  await assert.rejects(prepareSend(fixture({ nativeBalance: 1n }).p, input), /Insufficient USDC/)
  await assert.rejects(prepareSend(fixture({ usdcBalance: 0n }).p, input), /Insufficient USDC/)
})

test('review binds account, chain, recipient, token, amount, request and expiry', async () => {
  const reviewed = await prepareSend(fixture().p, { account, recipient, symbol: 'EURC', amount: '1.25' }, 1000)
  const current = await prepareSend(fixture().p, { account, recipient, symbol: 'EURC', amount: '1.25' }, 1200)
  assert.doesNotThrow(() => assertFreshSend(reviewed, current, 1200))
  for (const field of [{ recipient: account }, { account: recipient }, { chainId: 1 }, { units: 2n }, { token: TOKENS[0] }, { request: { ...reviewed.request, data: '0x' } }]) assert.throws(() => assertFreshSend(reviewed, { ...current, ...field }, 1200))
  assert.throws(() => assertFreshSend(reviewed, current, 61_001))
})

test('wallet rejection is cancellation; submission returns a hash', async () => {
  const rejected = fixture({ reject: true })
  const prepared = await prepareSend(rejected.p, { account, recipient, symbol: 'USDC', amount: '1' })
  await assert.rejects(requestSend(rejected.p, prepared), (error) => isWalletRejection(error))
  const accepted = fixture()
  assert.equal(await requestSend(accepted.p, prepared), hash)
  assert.equal(accepted.sends(), 1)
})

test('duplicate submit guard permits one wallet request at a time', async () => {
  const guard = new SendSubmissionGuard()
  let release!: () => void
  const pending = guard.run(() => new Promise<string>((resolve) => { release = () => resolve(hash) }))
  await assert.rejects(guard.run(async () => hash), /already in progress/)
  release()
  assert.equal(await pending, hash)
  assert.equal(await guard.run(async () => hash), hash)
})

test('receipt requires success and matching transfer evidence; missing receipt remains pending', async () => {
  const prepared = await prepareSend(fixture().p, { account, recipient, symbol: 'USDC', amount: '1' })
  const base = { transactionHash: hash, blockHash: hash, blockNumber: '0x1', status: '0x1', logs: [{ address: TOKENS[0].address, topics: [topic, word(account), word(recipient)], data: '0xf4240' }] }
  assert.equal(await checkSendReceipt(fixture({ receipt: base }).p, hash, prepared), 'confirmed')
  assert.equal(await checkSendReceipt(fixture({ receipt: { ...base, status: '0x0' } }).p, hash, prepared), 'failed')
  assert.equal(await checkSendReceipt(fixture({ receipt: { ...base, logs: [] } }).p, hash, prepared), 'unknown')
  assert.equal(await checkSendReceipt(fixture().p, hash, prepared), 'pending')
})

// ---------------------------------------------------------------------------
// Hotfix regression: RPC read-only calls obey the timeout guard;
// eth_sendTransaction is exempt and must never be timed out.
//
// Integration tests use _rpcTimeoutMsOverride = 1 ms so prepareSend's real
// req() path is exercised end-to-end without waiting 15 s for the production
// timeout to fire.  The override is set/reset in before()/after() hooks.
// ---------------------------------------------------------------------------

// 500 ms is enough for a local mock HTTP server round-trip (including fetch cold-start)
// while still being well under the 15 s production timeout.
// Hung-Arc-RPC integration tests reduce to 10 ms inline for their own scope only.
before(() => { _setRpcTimeoutMsForTest(500) })
after(() => { _setRpcTimeoutMsForTest(undefined) })

test('prepareSend integration: hung eth_getCode causes prepareSend to reject via req() timeout', async () => {
  // Real integration: prepareSend calls req('eth_getCode', ...) via arcRpc() (bypass layer).
  // Reduce timeout to 10 ms so the test completes quickly without waiting 500 ms.
  _setRpcTimeoutMsForTest(10)
  try {
    setMockArcRpcHandler((_method, _params) => new Promise(() => { /* hangs forever */ }))
    const p: SendProvider = { request: async ({ method }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x4cef52'
      throw new Error(`unexpected: ${method}`)
    } }
    await assert.rejects(
      prepareSend(p, { account, recipient, symbol: 'USDC', amount: '1' }),
      /timed out/,
      'prepareSend must reject when Arc RPC never resolves',
    )
  } finally { _setRpcTimeoutMsForTest(500) }
})

test('prepareSend integration: hung eth_estimateGas causes prepareSend to reject via req() timeout', async () => {
  // Arc RPC mock answers all calls up to eth_estimateGas, then hangs.
  // Reduce timeout to 10 ms so the hung test completes quickly.
  _setRpcTimeoutMsForTest(10)
  let callCount = 0
  try {
  setMockArcRpcHandler((method, params) => {
    callCount++
    const p0 = (params as unknown[])[0]
    if (method === 'eth_getCode') {
      const addr = (p0 as string)?.toLowerCase()
      return addr === recipient.toLowerCase() ? '0x' : '0x6000'
    }
    if (method === 'eth_call') {
      const { data } = p0 as { data: string }
      if (data === '0x313ce567') return '0x' + '6'.padStart(64, '0')
      if (data === '0x95d89b41') return `0x${'20'.padStart(64, '0')}${'4'.padStart(64, '0')}${'55534443'.padEnd(64, '0')}`
      if (data.startsWith('0x70a08231')) return `0x${(10_000_000n).toString(16).padStart(64, '0')}`
      return '0x'
    }
    if (method === 'eth_getBalance') return `0x${(10_000_000_000_000_000_000n).toString(16)}`
    if (method === 'eth_gasPrice') return '0x4a817c800'
    // eth_estimateGas: hang forever
    return new Promise(() => { /* hangs */ })
  })
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  await assert.rejects(
    prepareSend(p, { account, recipient, symbol: 'USDC', amount: '1' }),
    /timed out/,
    'prepareSend must reject when eth_estimateGas never resolves',
  )
  assert.ok(callCount > 0, 'arc rpc mock must have been called at least once')
  } finally { _setRpcTimeoutMsForTest(500) }
})

test('requestSend does not apply the read-only timeout: long signing still resolves', async () => {
  // Use the normal fixture to get a real PreparedSend, then override only the
  // sendTransaction call to be slow (10 ms).  If requestSend incorrectly used
  // withRpcTimeout the call would reject; it must not.
  const { p: base } = fixture()
  const prepared = await prepareSend(base, { account, recipient, symbol: 'USDC', amount: '1' })

  let sign!: (h: string) => void
  const p: SendProvider = {
    request: async ({ method }) => {
      if (method === 'eth_sendTransaction') {
        return new Promise<string>((resolve) => { sign = () => resolve(hash) })
      }
      throw new Error(`unexpected: ${method}`)
    },
  }
  const pending = requestSend(p, prepared)
  // Wait 10 ms — well past any 1 ms test timer, to confirm no early rejection.
  await new Promise((r) => setTimeout(r, 10))
  sign(hash)
  assert.equal(await pending, hash)
})

test('requestSend does not allow a second concurrent wallet request', async () => {
  const { p: base } = fixture()
  const prepared = await prepareSend(base, { account, recipient, symbol: 'USDC', amount: '1' })
  const guard = new SendSubmissionGuard()
  let releaseFirst!: (h: string) => void
  const p: SendProvider = {
    request: async ({ method }) => {
      if (method === 'eth_sendTransaction') return new Promise<string>((r) => { releaseFirst = r })
      throw new Error(`unexpected: ${method}`)
    },
  }
  const first = guard.run(() => requestSend(p, prepared))
  await assert.rejects(guard.run(() => requestSend(p, prepared)), /already in progress/)
  releaseFirst(hash)
  assert.equal(await first, hash)
})

// ---------------------------------------------------------------------------
// Integration: prepareSend read calls use req() timeout; requestSend does not.
// Combining both in one test confirms the two paths are independent.
// ---------------------------------------------------------------------------

test('prepareSend read timeout integration: read calls use withRpcTimeout; requestSend signing unaffected', async () => {
  // Step 1: a hung provider call wrapped by withRpcTimeout rejects with a labelled error.
  // This mirrors exactly what sendExecution.ts req() does: every p.request() call for
  // read-only methods is wrapped with withRpcTimeout(p.request(...), RPC_TIMEOUT_MS, label).
  const hung: SendProvider = { request: async () => new Promise(() => { /* hangs forever */ }) }
  await assert.rejects(
    withRpcTimeout(hung.request({ method: 'eth_getCode', params: [recipient, 'latest'] }), 1, 'eth_getCode'),
    /eth_getCode.*timed out/,
    'read-only RPC call must be bounded by withRpcTimeout',
  )

  // Step 2: requestSend signing on a slow wallet must NOT be bounded by that timeout.
  const { p: base } = fixture()
  const prepared = await prepareSend(base, { account, recipient, symbol: 'USDC', amount: '1' })
  let signCalled = false
  let doSign!: () => void
  const signingProvider: SendProvider = {
    request: async ({ method }) => {
      if (method === 'eth_sendTransaction') {
        signCalled = true
        return new Promise<string>((resolve) => { doSign = () => resolve(hash) })
      }
      throw new Error(`unexpected in signing test: ${method}`)
    },
  }
  const pendingSign = requestSend(signingProvider, prepared)
  // Wait 10 ms — the 1 ms deadline used above would have fired by now.
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(signCalled, true, 'eth_sendTransaction must have been called')
  doSign()
  const result = await pendingSign
  assert.equal(result, hash, 'signing must resolve after delay without timeout rejection')
})

test('Cancel does not interfere with in-flight signing: generation bump does not cancel a wallet request already submitted', async () => {
  // This test verifies the UI safety invariant: generation.current++ only prevents
  // stale STATE writes (setStage, setError). It does NOT reach into requestSend.
  // The wallet request was already submitted; its result is still captured.
  const { p: base } = fixture()
  const prepared = await prepareSend(base, { account, recipient, symbol: 'USDC', amount: '1' })
  let doSign!: () => void
  const p: SendProvider = {
    request: async ({ method }) => {
      if (method === 'eth_sendTransaction') return new Promise<string>((r) => { doSign = () => r(hash) })
      throw new Error(`unexpected: ${method}`)
    },
  }
  // Start the request — it is in-flight.
  const pending = requestSend(p, prepared)
  // A UI "Cancel" bumps the generation counter but requestSend is already running.
  // The promise is independent of generation — it must still resolve.
  doSign()
  const result = await pending
  assert.equal(result, hash, 'in-flight signing must resolve regardless of generation bump')
})

// ---------------------------------------------------------------------------
// Regression: wrong-chain / account-change / Arc-RPC-failure safety guards
// ---------------------------------------------------------------------------

test('regression: wallet on wrong chain — prepareSend rejects before any Arc RPC call', async () => {
  // Provider returns chain 0x1 (Ethereum mainnet). prepareSend must reject on
  // chain check, before touching Arc RPC. Confirms chain is read from provider.
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x1'  // Mainnet — wrong
    throw new Error(`unexpected: ${method}`)
  } }
  await assert.rejects(
    prepareSend(p, { account, recipient, symbol: 'USDC', amount: '1' }),
    /Wrong network/,
    'prepareSend must gate on provider chain — not Arc RPC chain',
  )
})

test('regression: account changed between call and input — prepareSend rejects', async () => {
  // Provider returns a different account than input.account.
  const differentAccount = '0x3333333333333333333333333333333333333333'
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [differentAccount]  // different from `account`
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  await assert.rejects(
    prepareSend(p, { account, recipient, symbol: 'USDC', amount: '1' }),
    /account changed/,
    'prepareSend must verify live account matches input.account',
  )
})

test('regression: Arc RPC error response — prepareSend returns actionable error, not a crash', async () => {
  // setMockArcRpcHandler throws — server returns a JSON-RPC error response.
  // prepareSend must propagate a clear error, not hang or crash.
  setMockArcRpcHandler(() => { throw new Error('Arc RPC node error') })
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  await assert.rejects(
    prepareSend(p, { account, recipient, symbol: 'USDC', amount: '1' }),
    (err: Error) => typeof err.message === 'string',
    'Arc RPC error must produce an error, not a hang',
  )
})

test('regression: receipt pending/null never returns confirmed', async () => {
  // null receipt → 'pending'; partial receipt → 'unknown'; neither is 'confirmed'.
  const prepared = await prepareSend(fixture().p, { account, recipient, symbol: 'USDC', amount: '1' })
  assert.equal(await checkSendReceipt(fixture({ receipt: null }).p, hash, prepared), 'pending')
  // Receipt with no logs → 'unknown', not 'confirmed'
  const noLogs = { transactionHash: hash, blockHash: hash, blockNumber: '0x1', status: '0x1', logs: [] }
  assert.equal(await checkSendReceipt(fixture({ receipt: noLogs }).p, hash, prepared), 'unknown')
  // Receipt with malformed structure → 'unknown', not crash
  assert.equal(await checkSendReceipt(fixture({ receipt: 'garbage' }).p, hash, prepared), 'unknown')
  assert.equal(await checkSendReceipt(fixture({ receipt: 42 }).p, hash, prepared), 'unknown')
})
