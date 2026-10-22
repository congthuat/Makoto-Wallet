/**
 * Tests for arcRpc.ts — the direct Arc RPC bypass layer.
 *
 * Root cause being tested: OKX Wallet does not forward eth_getCode, eth_call,
 * eth_gasPrice, eth_estimateGas to Arc RPC.  arcRpc() bypasses the provider
 * entirely for these methods, fetching directly from rpc.testnet.arc.io.
 *
 * All tests use _setArcRpcUrlForTest() to point at a local mock server so no
 * real network requests are made.
 */
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  arcRpc,
  rpcRead,
  ARC_RPC_BYPASS_METHODS,
  _setArcRpcUrlForTest,
  _getArcRpcUrl,
  type Eip1193Provider,
} from './arcRpc.ts'
import { _setRpcTimeoutMsForTest } from './rpcTimeout.ts'

// ---------------------------------------------------------------------------
// Mock server — records what it receives, returns configurable responses
// ---------------------------------------------------------------------------
type MockConfig = {
  statusCode?: number
  body?: unknown
  delayMs?: number
}
let mockConfig: MockConfig = {}
let lastRequest: { method: string; params: unknown[] } | null = null

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = ''
  req.on('data', (chunk: Buffer) => { body += chunk.toString() })
  req.on('end', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, mockConfig.delayMs ?? 0))
    try { lastRequest = JSON.parse(body) } catch { lastRequest = null }
    const cfg = mockConfig
    res.writeHead(cfg.statusCode ?? 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(cfg.body ?? { jsonrpc: '2.0', id: 1, result: '0x1' }))
  })
})

let mockUrl = ''

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  mockUrl = `http://127.0.0.1:${addr.port}`
  _setArcRpcUrlForTest(mockUrl)
  _setRpcTimeoutMsForTest(200)
})

after(async () => {
  _setArcRpcUrlForTest(undefined)
  _setRpcTimeoutMsForTest(undefined)
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// ---------------------------------------------------------------------------
// Helper: a provider that records calls and optionally hangs
// ---------------------------------------------------------------------------
function makeProvider(hangMethods: string[] = [], responseMs = 0): Eip1193Provider & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    request({ method }: { method: string }) {
      calls.push(method)
      if (hangMethods.includes(method)) return new Promise(() => { /* never resolves */ })
      return new Promise((resolve) => setTimeout(() => resolve('0xprovider'), responseMs))
    },
  }
}

// ---------------------------------------------------------------------------
// Test 1: _getArcRpcUrl returns the override when set
// ---------------------------------------------------------------------------
describe('_getArcRpcUrl', () => {
  test('returns override when set', () => {
    assert.equal(_getArcRpcUrl(), mockUrl)
  })
})

// ---------------------------------------------------------------------------
// Test 2: ARC_RPC_BYPASS_METHODS contains exactly the expected set
// ---------------------------------------------------------------------------
describe('ARC_RPC_BYPASS_METHODS', () => {
  test('contains eth_getCode, eth_call, eth_gasPrice, eth_estimateGas, eth_blockNumber, eth_getBalance, eth_getTransactionReceipt, eth_getTransactionByHash', () => {
    const expected = [
      'eth_getCode', 'eth_call', 'eth_gasPrice', 'eth_estimateGas',
      'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_getTransactionByHash',
    ]
    for (const m of expected) assert.ok(ARC_RPC_BYPASS_METHODS.has(m), `missing: ${m}`)
    // eth_sendTransaction must NOT be in bypass set
    assert.ok(!ARC_RPC_BYPASS_METHODS.has('eth_sendTransaction'))
    assert.ok(!ARC_RPC_BYPASS_METHODS.has('eth_requestAccounts'))
    assert.ok(!ARC_RPC_BYPASS_METHODS.has('personal_sign'))
  })
})

// ---------------------------------------------------------------------------
// Test 3: arcRpc() sends to mock server and returns result
// ---------------------------------------------------------------------------
describe('arcRpc()', () => {
  test('sends request to Arc RPC URL and returns result', async () => {
    mockConfig = { body: { jsonrpc: '2.0', id: 1, result: '0x4cef52' } }
    const result = await arcRpc('eth_chainId', [])
    assert.equal(result, '0x4cef52')
    assert.equal(lastRequest?.method, 'eth_chainId')
  })

  test('throws on RPC error response', async () => {
    mockConfig = { body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'execution reverted' } } }
    await assert.rejects(() => arcRpc('eth_call', []), /execution reverted/)
  })

  test('times out when server does not respond within deadline', async () => {
    mockConfig = { delayMs: 500 } // longer than 200ms test timeout
    const t0 = Date.now()
    await assert.rejects(() => arcRpc('eth_getCode', []), /timed out/)
    assert.ok(Date.now() - t0 < 400, `should abort before 400ms, took ${Date.now() - t0}ms`)
  })
})

// ---------------------------------------------------------------------------
// Test 4: rpcRead() routes bypass methods to arcRpc (NOT to provider)
// ---------------------------------------------------------------------------
describe('rpcRead() bypass routing', () => {
  test('eth_getCode goes to Arc RPC, NOT provider', async () => {
    mockConfig = { body: { jsonrpc: '2.0', id: 1, result: '0x60806040' } }
    const provider = makeProvider([], 0)
    const result = await rpcRead(provider, 'eth_getCode', ['0x3600000000000000000000000000000000000000', 'latest'])
    assert.equal(result, '0x60806040')
    assert.equal(lastRequest?.method, 'eth_getCode')
    // Provider must NOT have been called
    assert.deepEqual(provider.calls, [], 'eth_getCode must bypass provider')
  })

  test('eth_call goes to Arc RPC, NOT provider', async () => {
    mockConfig = { body: { jsonrpc: '2.0', id: 1, result: '0xresult' } }
    const provider = makeProvider([], 0)
    await rpcRead(provider, 'eth_call', [{ to: '0x0', data: '0x' }, 'latest'])
    assert.deepEqual(provider.calls, [], 'eth_call must bypass provider')
  })

  test('eth_gasPrice goes to Arc RPC, NOT provider', async () => {
    mockConfig = { body: { jsonrpc: '2.0', id: 1, result: '0x5d21dba00' } }
    const provider = makeProvider([], 0)
    await rpcRead(provider, 'eth_gasPrice')
    assert.deepEqual(provider.calls, [], 'eth_gasPrice must bypass provider')
  })

  test('eth_estimateGas goes to Arc RPC, NOT provider', async () => {
    mockConfig = { body: { jsonrpc: '2.0', id: 1, result: '0x5208' } }
    const provider = makeProvider([], 0)
    await rpcRead(provider, 'eth_estimateGas', [{ from: '0x0', to: '0x0', data: '0x' }])
    assert.deepEqual(provider.calls, [], 'eth_estimateGas must bypass provider')
  })

  test('eth_getTransactionReceipt goes to Arc RPC, NOT provider', async () => {
    mockConfig = { body: { jsonrpc: '2.0', id: 1, result: null } }
    const provider = makeProvider([], 0)
    await rpcRead(provider, 'eth_getTransactionReceipt', ['0x' + 'a'.repeat(64)])
    assert.deepEqual(provider.calls, [], 'eth_getTransactionReceipt must bypass provider')
  })
})

// ---------------------------------------------------------------------------
// Test 5: rpcRead() keeps eth_accounts, eth_chainId on provider
// ---------------------------------------------------------------------------
describe('rpcRead() provider routing', () => {
  test('eth_accounts goes through provider (permission-gated)', async () => {
    const provider = makeProvider([], 0)
    const result = await rpcRead(provider, 'eth_accounts')
    assert.equal(result, '0xprovider')
    assert.deepEqual(provider.calls, ['eth_accounts'])
  })

  test('eth_chainId goes through provider', async () => {
    const provider = makeProvider([], 0)
    const result = await rpcRead(provider, 'eth_chainId')
    assert.equal(result, '0xprovider')
    assert.deepEqual(provider.calls, ['eth_chainId'])
  })
})

// ---------------------------------------------------------------------------
// Test 6: rpcRead() throws for wallet-interactive methods
// ---------------------------------------------------------------------------
describe('rpcRead() safety guard', () => {
  test('throws for eth_sendTransaction', () => {
    const provider = makeProvider([], 0)
    assert.throws(
      () => rpcRead(provider, 'eth_sendTransaction'),
      /wallet-interactive/,
    )
    assert.deepEqual(provider.calls, [], 'must not call provider for eth_sendTransaction')
  })

  test('throws for personal_sign', () => {
    const provider = makeProvider([], 0)
    assert.throws(() => rpcRead(provider, 'personal_sign'), /wallet-interactive/)
  })
})

// ---------------------------------------------------------------------------
// Test 7: OKX simulation — provider hangs on bypass methods, Arc RPC responds
// ---------------------------------------------------------------------------
describe('OKX simulation', () => {
  test('bypass methods succeed even when provider hangs (replicates production failure)', async () => {
    // This is the exact failure mode from the live diagnostic:
    // OKX hangs on eth_getCode / eth_call / eth_gasPrice / eth_estimateGas
    const okxSimulation = makeProvider(
      ['eth_getCode', 'eth_call', 'eth_gasPrice', 'eth_estimateGas'],
    )
    mockConfig = { body: { jsonrpc: '2.0', id: 1, result: '0x60806040' } }
    const t0 = Date.now()
    const result = await rpcRead(okxSimulation, 'eth_getCode', ['0x3600000000000000000000000000000000000000', 'latest'])
    const elapsed = Date.now() - t0
    assert.equal(result, '0x60806040', 'must return Arc RPC result despite provider hang')
    assert.ok(elapsed < 100, `must resolve fast via Arc RPC, got ${elapsed}ms`)
    // Provider was never called for this bypass method
    assert.deepEqual(okxSimulation.calls, [], 'OKX provider must not be invoked for eth_getCode')
  })
})
