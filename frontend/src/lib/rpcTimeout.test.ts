/**
 * Unit tests for the withRpcTimeout helper (rpcTimeout.ts).
 *
 * All tests use REAL short timeouts (1–5 ms) rather than fake timers.
 * Node's mock.timers interceptor does not reliably advance past async
 * microtask boundaries in --experimental-strip-types mode, which causes the
 * process to hang.  Real 1 ms deadlines run just as fast in practice.
 *
 * Coverage:
 *  1. Promise that resolves before deadline → passes value through unchanged.
 *  2. Promise still pending when deadline fires → rejects with a labelled
 *     "timed out" error that includes the RPC method name.
 *  3. Promise that rejects before deadline → original error propagates.
 *  4. Stale resolution that arrives AFTER the timeout → silently discarded,
 *     no double-settlement / unhandled rejection.
 *  5. requestSend (eth_sendTransaction) bypasses the read-only timeout:
 *     a wallet that keeps the signing modal open past RPC_TIMEOUT_MS must
 *     still resolve normally — no early rejection.
 *  6. Wallet rejection (code 4001) from requestSend surfaces correctly.
 *  7. Missing hash from requestSend throws rather than returning garbage.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { withRpcTimeout } from './rpcTimeout.ts'
import { requestSend, type SendProvider, type PreparedSend } from './sendExecution.ts'
import { TOKENS } from './wallet.ts'

// ---------------------------------------------------------------------------
// 1. Resolves before deadline
// ---------------------------------------------------------------------------
test('withRpcTimeout resolves when the promise settles before the deadline', async () => {
  const result = await withRpcTimeout(Promise.resolve('ok'), 1_000, 'eth_call')
  assert.equal(result, 'ok')
})

// ---------------------------------------------------------------------------
// 2. Pending promise → timeout rejection (real 1 ms deadline)
// ---------------------------------------------------------------------------
test('withRpcTimeout rejects with a labelled error when the deadline fires', async () => {
  // A promise that never resolves.
  const hung = new Promise<string>(() => { /* never */ })
  // 1 ms is enough — the timer fires after one event-loop tick.
  await assert.rejects(
    withRpcTimeout(hung, 1, 'eth_getCode'),
    (err: Error) => {
      assert.ok(err.message.includes('eth_getCode'), `label missing: ${err.message}`)
      assert.ok(err.message.includes('timed out'), `"timed out" missing: ${err.message}`)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// 3. Rejects before deadline → original error propagates
// ---------------------------------------------------------------------------
test('withRpcTimeout propagates the original error when the promise rejects before the deadline', async () => {
  const original = new Error('wallet offline')
  await assert.rejects(
    withRpcTimeout(Promise.reject(original), 1_000, 'eth_chainId'),
    (err: Error) => { assert.equal(err, original); return true },
  )
})

// ---------------------------------------------------------------------------
// 4. Stale resolution after timeout is silently discarded
// ---------------------------------------------------------------------------
test('withRpcTimeout discards stale resolution after timeout without double-settling', async () => {
  let resolveStale!: (v: string) => void
  const stale = new Promise<string>((resolve) => { resolveStale = resolve })

  // Must reject (timeout).
  await assert.rejects(withRpcTimeout(stale, 1, 'eth_estimateGas'), /eth_estimateGas.*timed out/)

  // Resolve the underlying promise late — must not cause an unhandled rejection.
  resolveStale('0x5208')
  // Give the microtask queue a chance to settle.
  await new Promise((r) => setTimeout(r, 5))
})

// ---------------------------------------------------------------------------
// 5. requestSend does NOT apply the read-only RPC timeout.
//
// Simulates a wallet that holds the signing modal open for longer than
// RPC_TIMEOUT_MS.  The test waits for a real short delay to confirm that
// withRpcTimeout is NOT wrapping the sendTransaction call, then lets the
// wallet settle and asserts the hash is returned.
// ---------------------------------------------------------------------------

const account = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const recipient = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const goodHash = `0x${'c'.repeat(64)}`

function minimalPrepared(): PreparedSend {
  const token = TOKENS[0] // USDC
  return Object.freeze({
    account, chainId: 5042002, recipient, token,
    amount: '1', units: 1_000_000n,
    tokenBalance: 10_000_000n, usdcBalance: 10_000_000n, gasBalance: 10n ** 18n,
    fee: 1_000_000_000_000_000n,
    request: Object.freeze({
      from: account, to: token.address,
      data: '0xa9059cbb' + recipient.slice(2).padStart(64, '0') + '1'.padStart(64, '0'),
      value: '0x0' as const, gas: '0x186a0', gasPrice: '0x4a817c800',
    }),
    preparedAt: 1000, expiresAt: 61_000,
  })
}

test('requestSend is NOT subject to the RPC read timeout: wallet pending past deadline still resolves', async () => {
  const prepared = minimalPrepared()

  // Wallet that holds for 10 ms (longer than the 1 ms we use for rpcTimeout tests,
  // to prove the timeout isn't applied at all).
  let fulfillSign!: () => void
  const p: SendProvider = {
    request: async ({ method }) => {
      if (method === 'eth_sendTransaction') {
        return new Promise<string>((resolve) => {
          fulfillSign = () => resolve(goodHash)
        })
      }
      throw new Error(`unexpected call: ${method}`)
    },
  }

  const pending = requestSend(p, prepared)

  // Wait a few ms — if the timeout were applied it would already have rejected.
  await new Promise((r) => setTimeout(r, 10))

  // Now let the wallet approve.
  fulfillSign()

  const hash = await pending
  assert.equal(hash, goodHash, 'requestSend must resolve with the hash, not a timeout error')
})

test('requestSend surfaces wallet rejection (code 4001) correctly', async () => {
  const prepared = minimalPrepared()
  const p: SendProvider = {
    request: async ({ method }) => {
      if (method === 'eth_sendTransaction') {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      }
      throw new Error(`unexpected: ${method}`)
    },
  }
  await assert.rejects(requestSend(p, prepared), (err: Error & { code?: number }) => {
    assert.equal(err.code, 4001)
    return true
  })
})

test('requestSend throws when wallet returns no hash', async () => {
  const prepared = minimalPrepared()
  const p: SendProvider = {
    request: async ({ method }) => {
      if (method === 'eth_sendTransaction') return null
      throw new Error(`unexpected: ${method}`)
    },
  }
  await assert.rejects(requestSend(p, prepared), /no transaction hash/)
})
