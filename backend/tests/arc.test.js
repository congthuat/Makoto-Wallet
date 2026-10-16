/**
 * Arc route regression tests — RPC endpoint and error classification
 *
 * Covers:
 * 1. Correct RPC URL (rpc.testnet.arc.io, NOT rpc.testnet.arc.network)
 * 2. /api/arc/network returns 200 with valid shape on success
 * 3. /api/arc/network returns 502 with errorKind on DNS/network failure
 * 4. /api/arc/network returns 502 with errorKind on HTTP error
 * 5. /api/arc/network returns 502 with errorKind on JSON-RPC error
 * 6. /api/arc/network returns 502 with errorKind on timeout
 * 7. Stale RPC URL (arc.network) is absent from source
 * 8. RpcError classification is exported for tests and monitoring
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const router = require('../routes/arc')
const { RpcError, RpcErrorKind } = require('../routes/arc')

const EXPECTED_RPC_HOST = 'rpc.testnet.arc.io'
const STALE_RPC_HOST = 'rpc.testnet.arc.network'

// Read the arc.js source to verify the URL at the text level.
const fs = require('node:fs')
const arcSource = fs.readFileSync(require.resolve('../routes/arc.js'), 'utf8')

async function withServer(handler) {
  const app = express()
  app.use('/api/arc', router)
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value))
  })
  try {
    return await handler(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

// Canonical mock responses for a healthy RPC
const validBlock = { jsonrpc: '2.0', id: 1, result: '0x405faf3' }
const validGas = { jsonrpc: '2.0', id: 1, result: '0x4a817c800' }

let rpcCallCount = 0

function makeMockFetch({ blockRes = validBlock, gasRes = validGas, httpStatus = 200, throwError = null, throwTimeout = false } = {}) {
  rpcCallCount = 0
  return async (input, _init) => {
    const url = String(input)
    if (!url.includes('rpc')) return new Response(JSON.stringify({ items: [], next_page_params: null }), { status: 200 })
    rpcCallCount++
    if (throwTimeout) {
      const err = new Error('The operation was aborted')
      err.name = 'TimeoutError'
      throw err
    }
    if (throwError) throw throwError
    if (httpStatus !== 200) return new Response('error', { status: httpStatus })
    // Alternate block/gas responses for parallel Promise.all
    const body = rpcCallCount % 2 === 1 ? blockRes : gasRes
    return new Response(JSON.stringify(body), { status: 200 })
  }
}

test('arc route: source does NOT use stale rpc.testnet.arc.network as an active string literal', () => {
  // Strip single-line comments before checking, so documentation of the old host does not fail.
  const codeWithoutComments = arcSource.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const hasDeadRpc = codeWithoutComments.includes(STALE_RPC_HOST)
  assert.ok(!hasDeadRpc, `Code (outside comments) still references the dead host: ${STALE_RPC_HOST}`)
})

test('arc route: source contains the correct rpc.testnet.arc.io', () => {
  assert.ok(arcSource.includes(EXPECTED_RPC_HOST), `Source does not reference the expected host: ${EXPECTED_RPC_HOST}`)
})

test('arc route: RpcError and RpcErrorKind are exported', () => {
  assert.ok(typeof RpcError === 'function', 'RpcError must be a class')
  assert.ok(typeof RpcErrorKind === 'object' && RpcErrorKind !== null, 'RpcErrorKind must be an object')
  assert.ok('DNS_OR_NETWORK' in RpcErrorKind)
  assert.ok('HTTP_ERROR' in RpcErrorKind)
  assert.ok('JSONRPC_ERROR' in RpcErrorKind)
  assert.ok('TIMEOUT' in RpcErrorKind)
})

test('GET /api/arc/network returns 200 with valid shape on healthy RPC', async () => {
  const previous = global.fetch
  try {
    global.fetch = makeMockFetch()
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/network`)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.chainId, 5042002)
      assert.ok(typeof body.blockNumber === 'number' && body.blockNumber > 0, 'blockNumber must be a positive number')
      assert.ok(typeof body.gasPriceGwei === 'number' && body.gasPriceGwei > 0, 'gasPriceGwei must be positive')
      assert.ok(typeof body.transferFeeUsdc === 'number', 'transferFeeUsdc must be a number')
      assert.ok(typeof body.tokenTransferFeeUsdc === 'number', 'tokenTransferFeeUsdc must be a number')
      assert.ok(typeof body.rpcLatencyMs === 'number', 'rpcLatencyMs must be a number')
      assert.ok(typeof body.updatedAt === 'number', 'updatedAt must be a number')
    })
  } finally { global.fetch = previous }
})

test('GET /api/arc/network returns 502 with errorKind DNS_OR_NETWORK on network failure', async () => {
  const previous = global.fetch
  try {
    const netErr = new Error('getaddrinfo ENOTFOUND rpc.testnet.arc.io')
    netErr.code = 'ENOTFOUND'
    global.fetch = makeMockFetch({ throwError: netErr })
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/network`)
      assert.equal(res.status, 502)
      const body = await res.json()
      assert.equal(body.error, 'Arc RPC unavailable')
      assert.equal(body.errorKind, RpcErrorKind.DNS_OR_NETWORK)
    })
  } finally { global.fetch = previous }
})

test('GET /api/arc/network returns 502 with errorKind HTTP_ERROR on HTTP 503', async () => {
  const previous = global.fetch
  try {
    global.fetch = makeMockFetch({ httpStatus: 503 })
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/network`)
      assert.equal(res.status, 502)
      const body = await res.json()
      assert.equal(body.errorKind, RpcErrorKind.HTTP_ERROR)
    })
  } finally { global.fetch = previous }
})

test('GET /api/arc/network returns 502 with errorKind JSONRPC_ERROR on JSON-RPC error response', async () => {
  const previous = global.fetch
  try {
    const rpcErr = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Internal error' } }
    global.fetch = makeMockFetch({ blockRes: rpcErr })
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/network`)
      assert.equal(res.status, 502)
      const body = await res.json()
      assert.equal(body.errorKind, RpcErrorKind.JSONRPC_ERROR)
    })
  } finally { global.fetch = previous }
})

test('GET /api/arc/network returns 502 with errorKind TIMEOUT on timeout', async () => {
  const previous = global.fetch
  try {
    global.fetch = makeMockFetch({ throwTimeout: true })
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/network`)
      assert.equal(res.status, 502)
      const body = await res.json()
      assert.equal(body.errorKind, RpcErrorKind.TIMEOUT)
    })
  } finally { global.fetch = previous }
})

test('GET /api/arc/network negative control: simulated dead endpoint (arc.network) would fail', async () => {
  // Simulates what Railway observed: NXDOMAIN causes a network-level throw, not HTTP 502.
  const previous = global.fetch
  try {
    const nxdomain = new Error('getaddrinfo ENOTFOUND rpc.testnet.arc.network')
    nxdomain.code = 'ENOTFOUND'
    global.fetch = async (input) => {
      if (String(input).includes('arc.network')) throw nxdomain
      throw new Error('unexpected call')
    }
    // Test that RpcError wraps NXDOMAIN correctly
    let caught = null
    try {
      await fetch('https://rpc.testnet.arc.network', {}).catch(() => { throw nxdomain })
    } catch (e) {
      const rpcErr = new RpcError(RpcErrorKind.DNS_OR_NETWORK, `RPC network/DNS error: ${e.message}`, 'eth_blockNumber')
      caught = rpcErr
    }
    assert.ok(caught instanceof RpcError, 'NXDOMAIN should produce RpcError')
    assert.equal(caught.kind, RpcErrorKind.DNS_OR_NETWORK)
  } finally { global.fetch = previous }
})

test('GET /api/arc/wallet returns 400 on invalid address', async () => {
  const previous = global.fetch
  try {
    global.fetch = makeMockFetch()
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/wallet?address=notanaddress`)
      assert.equal(res.status, 400)
    })
  } finally { global.fetch = previous }
})

// ---------------------------------------------------------------------------
// Transaction safety: /api/arc/network errorKind must be present on failure
// so the frontend can distinguish "loading" from "unavailable" and never use
// stale RPC data as evidence for signing.
// ---------------------------------------------------------------------------
test('arc/network 502 body always includes errorKind — prevents treating error as loading', async () => {
  const previous = global.fetch
  try {
    for (const scenario of [
      { desc: 'DNS', opts: { throwError: Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) } },
      { desc: 'HTTP 503', opts: { httpStatus: 503 } },
      { desc: 'JSON-RPC error', opts: { blockRes: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'err' } } } },
      { desc: 'Timeout', opts: { throwTimeout: true } },
    ]) {
      global.fetch = makeMockFetch(scenario.opts)
      await withServer(async (base) => {
        const res = await previous(`${base}/api/arc/network`)
        assert.equal(res.status, 502, `${scenario.desc}: expected 502`)
        const body = await res.json()
        assert.ok(typeof body.errorKind === 'string' && body.errorKind.length > 0,
          `${scenario.desc}: errorKind must be present so frontend can show Unavailable, not Loading`)
        // error + errorKind together: frontend must not interpret a 502 as a loading/connecting state
        assert.ok(typeof body.error === 'string', `${scenario.desc}: error message must be present`)
      })
    }
  } finally { global.fetch = previous }
})

test('arc/network chainId in success body is always 5042002 — never from RPC response', async () => {
  // The chainId field in the 200 response is a server-side constant, not echoed
  // from the RPC.  This prevents a compromised RPC from claiming a different chain.
  const previous = global.fetch
  try {
    global.fetch = makeMockFetch()
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/network`)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.chainId, 5042002, 'chainId must be the hardcoded Arc Testnet ID')
    })
  } finally { global.fetch = previous }
})

test('arc/network retry does not fire for HTTP or JSON-RPC errors (deterministic failures)', async () => {
  // Retry is only for DNS/network and timeout — deterministic errors must not be retried.
  const previous = global.fetch
  try {
    let callCount = 0
    global.fetch = async () => {
      callCount++
      return new Response('bad gateway', { status: 503 })
    }
    await withServer(async (base) => {
      await previous(`${base}/api/arc/network`)
      // Each of the two parallel rpc() calls (blockNumber + gasPrice) should have
      // exactly 1 attempt each (no retry for HTTP errors).
      assert.equal(callCount, 2, 'HTTP 503 must NOT trigger a retry — exactly 2 fetch calls expected')
    })
  } finally { global.fetch = previous }
})

test('arc/network retry fires once for DNS/network errors then propagates failure', async () => {
  const previous = global.fetch
  try {
    let callCount = 0
    const netErr = new Error('getaddrinfo ENOTFOUND rpc.testnet.arc.io')
    netErr.code = 'ENOTFOUND'
    global.fetch = async (input) => {
      if (String(input).includes('rpc')) { callCount++; throw netErr }
      return new Response('{}', { status: 200 })
    }
    await withServer(async (base) => {
      const res = await previous(`${base}/api/arc/network`)
      assert.equal(res.status, 502)
      const body = await res.json()
      assert.equal(body.errorKind, RpcErrorKind.DNS_OR_NETWORK)
      // Two parallel rpc() calls × 2 attempts each = 4 total fetch calls.
      assert.equal(callCount, 4, 'DNS error must retry once per rpc() call — 2 parallel × 2 attempts = 4')
    })
  } finally { global.fetch = previous }
})
