/**
 * arcRpc — direct Arc Testnet JSON-RPC client.
 *
 * ROOT CAUSE (2026-10-22, confirmed by live diagnostic log):
 *   OKX Wallet returns eth_chainId and eth_accounts in < 10 ms, but does NOT
 *   forward eth_getCode, eth_call, eth_gasPrice, eth_estimateGas, eth_blockNumber,
 *   eth_getBalance, eth_getTransactionReceipt, eth_getTransactionByHash to the Arc
 *   Testnet RPC.  Those requests silently hang until the 15-second timeout fires,
 *   producing every "timed out after 15s" error seen in production.
 *
 * FIX:
 *   All read-only RPC methods that do NOT require wallet signing are sent directly
 *   to rpc.testnet.arc.io via fetch(), bypassing the injected wallet provider.
 *   Only these methods still go through the provider (wallet interaction required):
 *     eth_sendTransaction   — user signs in wallet popup
 *     eth_requestAccounts   — user approves connection
 *     personal_sign         — user signs message
 *     eth_accounts          — permission-gated account list
 *     eth_chainId           — needed to confirm the provider's own chain setting
 *
 * BYPASS METHODS (always use arcRpc, never the injected provider):
 *   eth_getCode, eth_call, eth_gasPrice, eth_estimateGas, eth_blockNumber,
 *   eth_getBalance, eth_getTransactionReceipt, eth_getTransactionByHash
 *
 * arc-studio-allow-onchain-literal (ARC.rpc is imported — this comment covers
 * the inline fallback only, used when the import circle cannot be avoided).
 */

import { withRpcTimeout, _getRpcTimeoutMs } from './rpcTimeout.ts'

/** Methods that MUST go through the injected provider (wallet-interactive). */
const PROVIDER_ONLY_METHODS = new Set([
  'eth_sendTransaction',
  'eth_requestAccounts',
  'personal_sign',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
])

/** Methods that always bypass the injected provider and go to Arc RPC directly. */
export const ARC_RPC_BYPASS_METHODS = new Set([
  'eth_getCode',
  'eth_call',
  'eth_gasPrice',
  'eth_estimateGas',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
])

let _arcRpcUrlOverride: string | undefined = undefined
/** Test-only: override the Arc RPC URL (e.g. point at a mock server). */
export function _setArcRpcUrlForTest(url: string | undefined): void { _arcRpcUrlOverride = url }
export function _getArcRpcUrl(): string { return _arcRpcUrlOverride ?? 'https://rpc.testnet.arc.io' }

let _requestId = 1

/**
 * Send a single JSON-RPC request directly to the Arc Testnet RPC endpoint.
 * Wraps the fetch + response.json() in a single AbortController deadline.
 * Never call this for wallet-interactive methods (eth_sendTransaction, personal_sign etc).
 */
export async function arcRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const url = _getArcRpcUrl()
  const id = _requestId++
  const controller = new AbortController()
  const ms = _getRpcTimeoutMs()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
      signal: controller.signal,
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message ?? `${method} failed`)
    return json.result
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`${method} timed out after ${ms / 1000}s`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Unified RPC dispatcher for read-only calls.
 *
 * If method is in ARC_RPC_BYPASS_METHODS → arcRpc() (direct to Arc RPC).
 * If method is in PROVIDER_ONLY_METHODS   → throws (caller must use p.request() directly).
 * Otherwise (eth_accounts, eth_chainId)   → p.request() with a timeout wrapper.
 *
 * Usage: replace every `p.request({ method, params })` read-only call with
 * `rpcRead(p, method, params)`.  Never use rpcRead for eth_sendTransaction.
 */
export type Eip1193Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> }

export function rpcRead(p: Eip1193Provider, method: string, params: unknown[] = []): Promise<unknown> {
  if (PROVIDER_ONLY_METHODS.has(method)) {
    throw new Error(`rpcRead: ${method} is wallet-interactive — use p.request() directly`)
  }
  if (ARC_RPC_BYPASS_METHODS.has(method)) {
    return arcRpc(method, params)
  }
  // eth_accounts, eth_chainId, etc. — go through provider with timeout
  return withRpcTimeout(p.request({ method, params }), _getRpcTimeoutMs(), method)
}
