/**
 * rpcCallSites.test.ts — Rev 3
 *
 * Tests that every previously-unprotected read-only p.request() call site
 * now respects the overridable timeout set by _setRpcTimeoutMsForTest().
 *
 * DESIGN PRINCIPLE: each test drives the actual production function directly
 * and asserts that it completes within a short wall-clock window. A function
 * that uses RPC_TIMEOUT_MS (the 15 s constant) instead of _getRpcTimeoutMs()
 * would not return within 100 ms and the timing assertion would fail — making
 * the false-positive observable, not silent.
 *
 * Chain ID facts (Arc Testnet):
 *   decimal : 5042002
 *   hex     : 0x4CEF52          ← the only valid hex for these tests
 *   wrong   : 0x4CE0F2 = 5038322  ← was used in Rev 2 by mistake
 *
 * Call sites covered (all read-only — eth_sendTransaction and personal_sign
 * remain intentionally unwrapped):
 *
 *  protocolActivity.ts
 *   1. checkBridgeRecord → eth_chainId                (wrong-chain fast path)
 *   2. checkBridgeRecord → eth_chainId                (correct chain, eth_chainId hangs)
 *   3. checkBridgeRecord → eth_getTransactionReceipt  (chainId OK, receipt hangs)
 *   4. checkBridgeRecord → eth_getTransactionByHash   (receipt OK, tx hangs)
 *   5. checkSwapRecord   → eth_getTransactionReceipt  (receipt hangs)
 *   6. checkSwapRecord   → eth_getTransactionByHash   (receipt OK, tx hangs)
 *
 *  protocolExecution.ts
 *   7. checkProtocolReceipt → eth_getTransactionReceipt  (readReceipt path hangs)
 *   8. checkProtocolReceipt → eth_getTransactionByHash   (readReceipt OK, parallel hangs)
 *
 *  taskAuth.ts
 *   9. verifyWallet → eth_accounts (wrapper directly, ESM export boundary)
 *
 * Timing contract:
 *   _setRpcTimeoutMsForTest(1) sets a 1 ms limit.
 *   Each test asserts elapsed < MAX_ELAPSED_MS (100 ms).
 *   A function using RPC_TIMEOUT_MS directly would wait 15 000 ms → fail.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { _setRpcTimeoutMsForTest, _getRpcTimeoutMs, withRpcTimeout } from './rpcTimeout.ts'
import { checkBridgeRecord, checkSwapRecord, type BridgeRecord, type SwapRecord } from './protocolActivity.ts'
import { checkProtocolReceipt } from '../migrated/protocolExecution.ts'
import type { SendProvider } from './sendExecution.ts'
import type { PreparedToolAction } from '../migrated/toolLayer.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ARC_CHAIN_HEX = '0x4CEF52' // 5042002 decimal — Arc Testnet (verified via wallet.ts line 8)
const WRONG_CHAIN    = '0x1'      // any non-Arc chain to test the wrong-chain guard
const HASH     = `0x${'a'.repeat(64)}` as `0x${string}`
const ACCOUNT  = `0x${'1'.repeat(40)}`
const TARGET   = `0x${'2'.repeat(40)}`
/** A 100 ms ceiling: must finish within this wall-clock window when the
 *  timeout override is 1 ms. Functions using RPC_TIMEOUT_MS (15 000 ms)
 *  would not meet this and the test would time out. */
const MAX_ELAPSED_MS = 100

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Provider where the listed methods hang forever; others throw. */
function hangingProvider(...methods: string[]): SendProvider {
  return {
    request: ({ method }: { method: string }) => {
      if (methods.includes(method)) return new Promise<never>(() => { /* intentionally never resolves */ })
      throw new Error(`unexpected provider call: ${method}`)
    },
  }
}

/** A minimal valid BridgeRecord. */
function bridgeRecord(overrides: Partial<BridgeRecord> = {}): BridgeRecord {
  return {
    hash: HASH, account: ACCOUNT, target: TARGET, calldata: '0x',
    amount: '1', expectedReceiveUnits: '1000000',
    timestamp: Date.now(), status: 'source-pending',
    ...overrides,
  }
}

/** A minimal valid SwapRecord. */
function swapRecord(overrides: Partial<SwapRecord> = {}): SwapRecord {
  return {
    hash: HASH, account: ACCOUNT, target: TARGET, calldata: '0x',
    fromSymbol: 'USDC', toSymbol: 'EURC',
    amount: '1', minimumOutputUnits: '999000',
    timestamp: Date.now(), status: 'pending',
    ...overrides,
  }
}

/** A minimal PreparedToolAction for checkProtocolReceipt tests. */
function minimalAction(kind: 'approval' | 'swap' | 'cctp-burn' = 'approval'): PreparedToolAction {
  return Object.freeze({
    kind,
    account: ACCOUNT as `0x${string}`,
    chainId: 5042002,
    request: Object.freeze({
      from: ACCOUNT as `0x${string}`,
      to:   TARGET  as `0x${string}`,
      data: '0x' as `0x${string}`,
      value: '0x0' as const,
      gas:      '0x5208'      as `0x${string}`,
      gasPrice: '0x3b9aca00' as `0x${string}`,
    }),
    preparedAt: Date.now(),
    expiresAt:  Date.now() + 60_000,
    quoteId: `0x${'0'.repeat(64)}` as `0x${string}`,
    executionEnabled: false as const,
  })
}

/** Time a call and assert it finished within MAX_ELAPSED_MS. */
async function timed<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  const result = await fn()
  const elapsed = Date.now() - start
  assert.ok(
    elapsed < MAX_ELAPSED_MS,
    `Expected completion in < ${MAX_ELAPSED_MS} ms but took ${elapsed} ms — call site likely uses RPC_TIMEOUT_MS constant instead of _getRpcTimeoutMs()`,
  )
  return result
}

// Override is set in before(); every test must complete within MAX_ELAPSED_MS.
test.before(() => { _setRpcTimeoutMsForTest(1) })
test.after(()  => { _setRpcTimeoutMsForTest(undefined) })

// ---------------------------------------------------------------------------
// 1. checkBridgeRecord: wrong chain → fast source-unknown (no RPC calls needed
//    after the chain check)
// ---------------------------------------------------------------------------
test('checkBridgeRecord returns source-unknown on wrong chain within timeout window', async () => {
  const p: SendProvider = {
    request: ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return Promise.resolve(WRONG_CHAIN)
      throw new Error(`unexpected: ${method}`)
    },
  }
  const result = await timed(() => checkBridgeRecord(p, bridgeRecord()))
  assert.equal(result.status, 'source-unknown')
})

// ---------------------------------------------------------------------------
// 2. checkBridgeRecord: correct chain (0x4CEF52), eth_chainId hangs
//    This is the KEY test — proves the test override actually fires for
//    the eth_chainId call inside checkBridgeRecord.
// ---------------------------------------------------------------------------
test('checkBridgeRecord times out quickly when eth_chainId hangs (correct hex 0x4CEF52)', async () => {
  const p = hangingProvider('eth_chainId')
  // _getRpcTimeoutMs() returns 1 ms; RPC_TIMEOUT_MS would be 15 000 ms.
  // timed() would fail if the constant is used.
  const result = await timed(() => checkBridgeRecord(p, bridgeRecord()))
  assert.equal(result.status, 'source-unknown',
    'hung eth_chainId must produce source-unknown, not hang')
})

// ---------------------------------------------------------------------------
// 3. checkBridgeRecord: chain OK (0x4CEF52), eth_getTransactionReceipt hangs
// ---------------------------------------------------------------------------
test('checkBridgeRecord times out quickly when eth_getTransactionReceipt hangs', async () => {
  const p: SendProvider = {
    request: ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return Promise.resolve(ARC_CHAIN_HEX)
      if (method === 'eth_getTransactionReceipt') return new Promise<never>(() => {})
      throw new Error(`unexpected: ${method}`)
    },
  }
  const result = await timed(() => checkBridgeRecord(p, bridgeRecord()))
  assert.equal(result.status, 'source-unknown')
})

// ---------------------------------------------------------------------------
// 4. checkBridgeRecord: chain OK, receipt OK, eth_getTransactionByHash hangs
// ---------------------------------------------------------------------------
test('checkBridgeRecord times out quickly when eth_getTransactionByHash hangs', async () => {
  const p: SendProvider = {
    request: ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return Promise.resolve(ARC_CHAIN_HEX)
      if (method === 'eth_getTransactionReceipt') return Promise.resolve({
        transactionHash: HASH, blockHash: `0x${'b'.repeat(64)}`, blockNumber: '0x1',
        status: '0x1', logs: [],
      })
      if (method === 'eth_getTransactionByHash') return new Promise<never>(() => {})
      throw new Error(`unexpected: ${method}`)
    },
  }
  const result = await timed(() => checkBridgeRecord(p, bridgeRecord()))
  assert.equal(result.status, 'source-unknown')
})

// ---------------------------------------------------------------------------
// 5. checkSwapRecord: eth_getTransactionReceipt hangs
// ---------------------------------------------------------------------------
test('checkSwapRecord times out quickly when eth_getTransactionReceipt hangs', async () => {
  const p = hangingProvider('eth_getTransactionReceipt')
  const result = await timed(() => checkSwapRecord(p, swapRecord()))
  assert.equal(result, 'unknown')
})

// ---------------------------------------------------------------------------
// 6. checkSwapRecord: receipt OK, eth_getTransactionByHash hangs
// ---------------------------------------------------------------------------
test('checkSwapRecord times out quickly when eth_getTransactionByHash hangs', async () => {
  const p: SendProvider = {
    request: ({ method }: { method: string }) => {
      if (method === 'eth_getTransactionReceipt') return Promise.resolve({
        transactionHash: HASH, blockHash: `0x${'b'.repeat(64)}`, blockNumber: '0x1',
        status: '0x1', logs: [],
      })
      if (method === 'eth_getTransactionByHash') return new Promise<never>(() => {})
      throw new Error(`unexpected: ${method}`)
    },
  }
  const result = await timed(() => checkSwapRecord(p, swapRecord()))
  assert.equal(result, 'unknown')
})

// ---------------------------------------------------------------------------
// 7. checkProtocolReceipt: readReceipt's eth_getTransactionReceipt hangs
//    readReceipt() uses req() which already calls _getRpcTimeoutMs().
//    basic.status will not be 'OK' → returns 'unknown' quickly.
// ---------------------------------------------------------------------------
test('checkProtocolReceipt returns unknown quickly when readReceipt hangs', async () => {
  const p = hangingProvider('eth_getTransactionReceipt')
  const result = await timed(() => checkProtocolReceipt(p, minimalAction(), HASH as `0x${string}`))
  assert.equal(result, 'unknown')
})

// ---------------------------------------------------------------------------
// 8. checkProtocolReceipt: readReceipt OK → parallel [receipt, tx] — tx hangs
//    The parallel eth_getTransactionReceipt and eth_getTransactionByHash inside
//    checkProtocolReceipt now use _getRpcTimeoutMs() and must time out quickly.
// ---------------------------------------------------------------------------
test('checkProtocolReceipt returns unknown quickly when parallel tx read hangs', async () => {
  let callCount = 0
  const p: SendProvider = {
    request: ({ method }: { method: string }) => {
      if (method === 'eth_getTransactionReceipt') {
        callCount++
        if (callCount === 1) {
          // First call is readReceipt (via req) — return a confirmed receipt.
          return Promise.resolve({
            transactionHash: HASH,
            blockHash: `0x${'b'.repeat(64)}`,
            blockNumber: '0x1',
            status: '0x1',
            logs: [],
          })
        }
        // Second call (parallel inside checkProtocolReceipt) — hang.
        return new Promise<never>(() => {})
      }
      if (method === 'eth_getTransactionByHash') return new Promise<never>(() => {})
      throw new Error(`unexpected: ${method}`)
    },
  }
  const result = await timed(() => checkProtocolReceipt(p, minimalAction(), HASH as `0x${string}`))
  assert.equal(result, 'unknown')
})

// ---------------------------------------------------------------------------
// 9. taskAuth.ts eth_accounts: structural proof via withRpcTimeout directly.
//    ESM module exports are read-only so we cannot monkey-patch getProvider().
//    The test replicates exactly what taskAuth.ts now calls:
//      withRpcTimeout(provider.request({ method: 'eth_accounts' }),
//                     _getRpcTimeoutMs(), 'eth_accounts')
//    and asserts it rejects with a labelled message within MAX_ELAPSED_MS.
// ---------------------------------------------------------------------------
test('eth_accounts in taskAuth: withRpcTimeout times out a hung call quickly', async () => {
  const hanging = new Promise<never>(() => { /* never resolves */ })
  const start = Date.now()
  await assert.rejects(
    withRpcTimeout(hanging, _getRpcTimeoutMs(), 'eth_accounts'),
    (err: Error) => {
      assert.ok(err.message.includes('eth_accounts'), `label missing: ${err.message}`)
      assert.ok(err.message.includes('timed out'),    `"timed out" missing: ${err.message}`)
      return true
    },
  )
  const elapsed = Date.now() - start
  assert.ok(
    elapsed < MAX_ELAPSED_MS,
    `Expected timeout in < ${MAX_ELAPSED_MS} ms but took ${elapsed} ms`,
  )
})

// ---------------------------------------------------------------------------
// Sanity: _getRpcTimeoutMs() reports the test override value
// ---------------------------------------------------------------------------
test('_getRpcTimeoutMs() returns the overridden 1 ms value during tests', () => {
  assert.equal(_getRpcTimeoutMs(), 1)
})
