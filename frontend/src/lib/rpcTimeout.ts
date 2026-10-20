/**
 * Wraps a promise with a hard timeout.
 * If the promise does not resolve within `ms` milliseconds, it rejects
 * with a clear, user-surfaceable error. Stale resolutions after the timeout
 * are silently discarded — the caller already received the rejection.
 *
 * Use this for ALL read-only EIP-1193 provider calls (eth_call, eth_accounts,
 * eth_chainId, eth_getBalance, eth_estimateGas, eth_gasPrice, eth_getCode,
 * eth_getTransactionReceipt) and HTTP read calls (Circle attestation, CCTP
 * status, Xylo quote). Never apply to eth_sendTransaction — wallet signing
 * is user-interactive and must never be cancelled by a timer.
 */
export function withRpcTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let done = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        reject(new Error(`${label} timed out after ${ms / 1000}s`))
      }
    }, ms)
    promise.then(
      (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value) } },
      (err)   => { if (!done) { done = true; clearTimeout(timer); reject(err) } },
    )
  })
}

/** Default read-only RPC call timeout (15 seconds). */
export const RPC_TIMEOUT_MS = 15_000
/** Timeout for multi-step prepare sequences (prepareSend, quoteSwap, quoteBridge). */
export const PREPARE_TIMEOUT_MS = 20_000
/** Timeout for the Agent's read-only preflight (replanAgentFromEvidence). */
export const AGENT_EVIDENCE_TIMEOUT_MS = 12_000
/** Timeout for Circle CCTP status / attestation HTTP calls. */
export const CCTP_STATUS_TIMEOUT_MS = 15_000

/**
 * Test-only hook for RPC_TIMEOUT_MS.
 * Call setRpcTimeoutMsForTest(1) in before() to shrink timeouts for fast tests.
 * Call setRpcTimeoutMsForTest(undefined) in after() to restore production behaviour.
 * Never call this from production code.
 * @internal
 */
let _rpcTimeoutMsOverride: number | undefined = undefined
export function _getRpcTimeoutMs(): number { return _rpcTimeoutMsOverride ?? RPC_TIMEOUT_MS }
export function _setRpcTimeoutMsForTest(ms: number | undefined): void { _rpcTimeoutMsOverride = ms }
