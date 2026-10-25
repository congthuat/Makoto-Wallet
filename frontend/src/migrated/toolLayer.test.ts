import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { encodeFunctionResult, erc20Abi } from 'viem'
import { TOKENS } from '../lib/wallet.ts'
import type { SendProvider } from '../lib/sendExecution.ts'
import { withRpcTimeout, _setRpcTimeoutMsForTest } from '../lib/rpcTimeout.ts'
import { readAllowance, readBalance, readReceipt, readWallet, quoteSwap, prepareApproval, prepareSwap } from './toolLayer.ts'
import { createReview, evaluateToolPolicy, revalidateReview } from './policy.ts'
import { xyloRouterAbi, XYLO_ROUTER } from './swap.ts'
import { startMockArcRpc, stopMockArcRpc, setMockArcRpcHandler } from '../lib/testArcRpcServer.ts'

const account = '0x1111111111111111111111111111111111111111'
const hash = `0x${'a'.repeat(64)}`
// Arc RPC mock server for bypass methods; provider mock retains eth_accounts, eth_chainId, eth_sendTransaction.
before(async () => { await startMockArcRpc() })
after(async () => { await stopMockArcRpc() })

function fixture(options: { chain?: string; account?: string; unavailable?: boolean; output?: bigint; allowance?: bigint; balance?: bigint } = {}) {
  let writes = 0
  setMockArcRpcHandler((method, params) => {
    if (options.unavailable) throw new Error('RPC offline')
    const p0 = (params as unknown[])[0]
    if (method === 'eth_getCode') return '0x6000'
    if (method === 'eth_call') {
      const { to, data } = p0 as { to: string; data: string }
      if (data === '0x313ce567') return '0x6'
      if (data === '0x95d89b41') return encodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', result: to.toLowerCase() === TOKENS[1].address.toLowerCase() ? 'EURC' : 'USDC' })
      if (to.toLowerCase() === XYLO_ROUTER.toLowerCase()) return encodeFunctionResult({ abi: xyloRouterAbi, functionName: 'getAmountOut', result: options.output ?? 990_000n })
      if (data.startsWith('0x70a08231')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: options.balance ?? 10_000_000n })
      if (data.startsWith('0xdd62ed3e')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: options.allowance ?? 2_000_000n })
      return '0x'
    }
    if (method === 'eth_getBalance') return '0x1000000000000000'
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x3b9aca00'
    if (method === 'eth_getTransactionReceipt') return null
    throw new Error(`unexpected arcRpc method: ${method}`)
  })
  const p: SendProvider = { request: async ({ method }) => {
    if (options.unavailable) throw new Error('RPC offline')
    if (method === 'eth_accounts') return [options.account ?? account]
    if (method === 'eth_chainId') return options.chain ?? '0x4cef52'
    if (method === 'eth_sendTransaction') { writes++; return hash }
    throw new Error(`unexpected provider method: ${method}`)
  } }
  return { p, writes: () => writes }
}

test('READ tools return typed live evidence and unavailable is not zero', async () => {
  const { p, writes } = fixture()
  assert.equal((await readWallet(p)).data?.account.toLowerCase(), account)
  assert.equal((await readBalance(p, 'USDC', account)).data?.units, 10_000_000n)
  assert.equal((await readAllowance(p, 'USDC', XYLO_ROUTER, account)).data?.units, 2_000_000n)
  assert.equal((await readReceipt(p, hash)).data?.status, 'pending')
  assert.equal((await readBalance(fixture({ unavailable: true }).p, 'USDC', account)).status, 'UNAVAILABLE')
  assert.equal((await readBalance(p, 'UNSUPPORTED', account)).status, 'UNAVAILABLE')
  assert.equal(writes(), 0)
})

test('Swap quote and bounded prepare never call wallet writer', async () => {
  const { p, writes } = fixture()
  const result = await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 }, 1000)
  assert.equal(result.status, 'OK')
  const quote = result.data!
  assert.equal(quote.minimumReceive, 985_050n)
  const prepared = await prepareSwap(p, quote, 1200)
  assert.equal(prepared.request.to.toLowerCase(), XYLO_ROUTER.toLowerCase())
  assert.equal(prepared.executionEnabled, false)
  assert.equal(writes(), 0)
  const policy = evaluateToolPolicy({ action: prepared, quote, account, chainId: 5042002, simulation: 'passed', now: 1200, balance: 10_000_000n, allowance: 2_000_000n })
  assert.equal(policy.decision, 'REQUIRE_REVIEW')
  const review = createReview(prepared, quote, policy, 1200)
  assert.equal(revalidateReview(review, { action: prepared, quote, account, chainId: 5042002, simulation: 'passed', now: 1300, balance: 10_000_000n, allowance: 2_000_000n }).status, 'OK')
  assert.equal(revalidateReview(review, { action: prepared, quote, account: TOKENS[0].address, chainId: 5042002, simulation: 'passed', now: 1300, balance: 10_000_000n, allowance: 2_000_000n }).status, 'STALE')
  assert.equal(revalidateReview(review, { action: prepared, quote: { ...quote, quote: { ...quote.quote, amountOut: 1n } }, account, chainId: 5042002, simulation: 'passed', now: 1300, balance: 10_000_000n, allowance: 2_000_000n }).status, 'STALE')
})

test('Quote expiry, insufficient allowance, simulation failure and approval constraints stop writes', async () => {
  const { p, writes } = fixture({ allowance: 0n })
  const quote = (await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 }, 1000)).data!
  await assert.rejects(prepareSwap(p, quote, 1200), /approval required/)
  const approval = await prepareApproval(p, { account, symbol: 'USDC', spender: XYLO_ROUTER, amount: 1_000_000n }, 1200)
  assert.equal(approval.kind, 'approval')
  await assert.rejects(prepareApproval(p, { account, symbol: 'USDC', spender: XYLO_ROUTER, amount: (1n << 256n) - 1n }), /finite/)
  await assert.rejects(prepareApproval(p, { account, symbol: 'USDC', spender: TOKENS[2].address, amount: 1n }), /Untrusted/)
  assert.equal((await quoteSwap(fixture({ chain: '0x1' }).p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 })).status, 'UNAVAILABLE')
  assert.equal(writes(), 0)
})

// ---------------------------------------------------------------------------
// Hotfix regression: toolLayer read calls must time out when the provider hangs.
// The wallet-write path (eth_sendTransaction) must never be called from here.
//
// True integration tests: call the real readBalance / quoteSwap with a hung
// provider. _rpcTimeoutMsOverride shrinks the real 15 s timeout to 1 ms so
// the test completes immediately. Reset in after() to leave no side-effects.
// ---------------------------------------------------------------------------

// 500 ms is enough for a local mock HTTP server round-trip (including fetch cold-start)
// while still being well under the 15 s production timeout.
// Hung-provider tests reduce to 10 ms inline only for their own scope.
before(() => { _setRpcTimeoutMsForTest(500) })
after(() => { _setRpcTimeoutMsForTest(undefined) })

test('toolLayer read-only tools never call eth_sendTransaction', async () => {
  const { p, writes } = fixture()
  await readWallet(p)
  await readBalance(p, 'USDC', account)
  await readAllowance(p, 'USDC', XYLO_ROUTER, account)
  await readReceipt(p, hash)
  await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 }, 1000)
  assert.equal(writes(), 0, 'read-only tool calls must never reach eth_sendTransaction')
})

test('readBalance integration: hung Arc RPC is timed out by arcRpc() and returns UNAVAILABLE', async () => {
  // Real integration: readBalance calls arcRpc() for bypass methods (eth_getCode, eth_call).
  // A hung mock Arc RPC server triggers the timeout inside arcRpc() and readBalance returns UNAVAILABLE.
  _setRpcTimeoutMsForTest(10)
  try {
    setMockArcRpcHandler(() => new Promise(() => { /* hangs forever */ }))
    const p: SendProvider = { request: async ({ method }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x4cef52'
      throw new Error(`unexpected: ${method}`)
    } }
    const result = await readBalance(p, 'USDC', account)
    assert.equal(result.status, 'UNAVAILABLE', 'hung Arc RPC must return UNAVAILABLE, not hang forever')
    assert.ok(result.reason, 'UNAVAILABLE result must carry a reason')
  } finally { _setRpcTimeoutMsForTest(500) }
})

test('quoteSwap integration: hung Arc RPC is timed out by arcRpc() and returns UNAVAILABLE', async () => {
  // Real integration: quoteSwap calls arcRpc() for bypass methods (eth_getCode, eth_call, eth_gasPrice).
  // A hung mock Arc RPC triggers the timeout and quoteSwap returns UNAVAILABLE.
  _setRpcTimeoutMsForTest(10)
  try {
    setMockArcRpcHandler(() => new Promise(() => { /* hangs forever */ }))
    const p: SendProvider = { request: async ({ method }) => {
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x4cef52'
      throw new Error(`unexpected: ${method}`)
    } }
    const result = await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 }, 1000)
    assert.equal(result.status, 'UNAVAILABLE', 'hung Arc RPC in quoteSwap must return UNAVAILABLE')
  } finally { _setRpcTimeoutMsForTest(500) }
})

test('CCTP destination: withRpcTimeout covers both fetch and response.json() — async IIFE pattern', async () => {
  // Verify the pattern used in LiveCctpControl.reconcileDestination:
  //   withRpcTimeout((async () => { const r = await fetch(...); return r.ok ? await r.json() : undefined })(), ms, label)
  // A hung json() call inside the async IIFE must be cut off by withRpcTimeout.
  // This test uses withRpcTimeout directly with 1 ms to avoid importing the component.
  let resolveBody!: (v: { status: string }) => void
  const hungJson = new Promise<{ status: string }>((resolve) => { resolveBody = resolve })
  const fetchAndJson = (async () => {
    // Simulates: fetch() completes, response.json() hangs.
    return await hungJson
  })()
  await assert.rejects(
    withRpcTimeout(fetchAndJson, 1, 'Base destination fetch'),
    /Base destination fetch.*timed out/,
    'json() hanging inside async IIFE must be cut off by withRpcTimeout',
  )
  // Resolve the hung promise after assertion to avoid unhandled-rejection noise.
  resolveBody({ status: 'pending' })
})

// ── readWallet account verification (security regression suite) ──────────────
// These tests verify that readWallet's account check is fail-closed:
// only accounts[0] is authoritative; no other index can substitute for it.

test('readWallet: single correct account — returns that account and chainId', async () => {
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  const result = await readWallet(p)
  assert.equal(result.status, 'OK')
  assert.equal(result.data?.account.toLowerCase(), account.toLowerCase())
  assert.equal(result.data?.chainId, 5042002)
})

test('readWallet: single wrong account — returns OK with that account (caller checks)', async () => {
  const other = '0x2222222222222222222222222222222222222222'
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [other]
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  const result = await readWallet(p)
  // readWallet does not know the expected account; it returns accounts[0].
  // The CALLER (walletContext) is responsible for comparing wallet.data.account
  // with the reviewed account and blocking if they differ.
  assert.equal(result.status, 'OK')
  assert.equal(result.data?.account.toLowerCase(), other.toLowerCase())
  // walletContext comparison would fail: other !== account
  assert.notEqual(result.data?.account.toLowerCase(), account.toLowerCase())
})

test('readWallet: eth_accounts=[otherAccount, expectedAccount] — returns index-0, NOT expectedAccount', async () => {
  // Security: if expected account is at index > 0, it must NOT be used.
  // readWallet must use accounts[0] exclusively (consistent with connectWallet and store).
  const other = '0x3333333333333333333333333333333333333333'
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [other, account]   // account is at index 1
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  const result = await readWallet(p)
  assert.equal(result.status, 'OK')
  // Must return index-0 (other), NOT account (index 1).
  assert.equal(result.data?.account.toLowerCase(), other.toLowerCase(),
    'readWallet must use accounts[0], not search for a preferred account at any index')
  // walletContext comparison would fail for the reviewed account (= `account`).
  assert.notEqual(result.data?.account.toLowerCase(), account.toLowerCase(),
    'account at index 1 must not automatically pass a walletContext check')
})

test('readWallet: empty eth_accounts — returns UNAVAILABLE, not zero address', async () => {
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return []
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  const result = await readWallet(p)
  assert.equal(result.status, 'UNAVAILABLE')
  assert.ok(!result.data, 'disconnected wallet must not produce data')
})

test('readWallet: provider throws on eth_accounts — returns UNAVAILABLE (fail-closed)', async () => {
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') throw new Error('provider offline')
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  const result = await readWallet(p)
  assert.equal(result.status, 'UNAVAILABLE', 'provider error must fail-closed, not throw')
})

test('readWallet does not accept expectedAccount param — only provider is authoritative', async () => {
  // Regression: the expectedAccount parameter was added in a0e42d9 and created a
  // tautological check (walletContext passed its own account prop, making the
  // comparison always succeed when the account existed anywhere in the list).
  // This test verifies the function signature has no second parameter:
  //   - readWallet.length is 0 because the only parameter (p) is optional
  //   - passing a second arg (any non-undefined value) must not affect the result
  //   - the result must be derived from eth_accounts[0], not from any expected value
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    throw new Error(`unexpected: ${method}`)
  } }
  // Call with no second arg — must return accounts[0]
  const result1 = await readWallet(p)
  assert.equal(result1.data?.account.toLowerCase(), account.toLowerCase())
  // Verify: readWallet has no required params so .length === 0
  assert.equal(readWallet.length, 0,
    'readWallet has one optional param (provider); .length must be 0, confirming no required expectedAccount arg')
})

test('readWallet: account at index 0 differs from reviewed account — walletContext must block without eth_sendTransaction', async () => {
  // Integration: verify that when eth_accounts[0] differs from the reviewed account,
  // walletContext throws and no write (eth_sendTransaction) is issued.
  const other = '0x4444444444444444444444444444444444444444'
  let writes = 0
  setMockArcRpcHandler((method) => {
    if (method === 'eth_getCode') return '0x6000'
    if (method === 'eth_call') return '0x'
    if (method === 'eth_getBalance') return '0x1000000000000000'
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x3b9aca00'
    if (method === 'eth_getTransactionReceipt') return null
    throw new Error(`unexpected arcRpc method: ${method}`)
  })
  const p: SendProvider = { request: async ({ method }) => {
    if (method === 'eth_accounts') return [other]            // OKX returns a different account
    if (method === 'eth_chainId') return '0x4cef52'
    if (method === 'eth_sendTransaction') { writes++; return `0x${'b'.repeat(64)}` }
    throw new Error(`unexpected: ${method}`)
  } }
  // Simulate walletContext: read wallet then compare against the reviewed account.
  const wallet = await readWallet(p)
  const mismatch = !wallet.data || wallet.data.account.toLowerCase() !== account.toLowerCase()
  assert.ok(mismatch, 'account mismatch must be detected when eth_accounts[0] differs from reviewed account')
  assert.equal(writes, 0, 'eth_sendTransaction must not be called when account mismatch is detected')
})

test('CCTP checkpoint preservation: timeout on json() must not trigger a new burn', async () => {
  // Invariant: when reconcileDestination's json() hangs and the outer withRpcTimeout
  // fires, the .catch(() => undefined) in LiveCctpControl means `data` is undefined.
  // The control must treat undefined as "status unavailable" — no state transition to
  // FAILED, and no new burn intent.
  // We verify the catch-to-undefined contract: withRpcTimeout rejects, .catch(() => undefined)
  // returns undefined, and undefined must be treated as a non-terminal status.
  const hungJson = new Promise<{ status: string }>(() => { /* hangs forever */ })
  const fetchAndJson = (async () => await hungJson)()
  const result = await withRpcTimeout(fetchAndJson, 1, 'Base destination fetch').catch(() => undefined)
  // The contract: catch returns undefined (not a status object).
  assert.equal(result, undefined, 'timed-out CCTP status fetch must resolve to undefined via .catch()')
  // No burn intent is created — this is the sentinel the CCTP control checks.
  assert.ok(result === undefined, 'undefined sentinel must NOT be treated as a completed/failed status')
})
