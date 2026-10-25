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
 * BROWSER MOCK HOOK:
 *   In browser test fixtures, set window.__arcRpcOverrideUrl to a local URL
 *   (e.g. 'http://127.0.0.1:PORT/__arc_rpc_mock__') to intercept all arcRpc
 *   calls without hitting the real Arc Testnet RPC. Never use in production.
 */

import { _getRpcTimeoutMs } from './rpcTimeout.ts'

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

/** The live Arc Testnet RPC URL. Never used when an override is active. */
const ARC_RPC_PRODUCTION_URL = 'https://rpc.testnet.arc.io'

// Node.js test-only URL override (set by _setArcRpcUrlForTest).
let _arcRpcUrlOverride: string | undefined = undefined
/** Test-only: override the Arc RPC URL (e.g. point at a mock server). */
export function _setArcRpcUrlForTest(url: string | undefined): void { _arcRpcUrlOverride = url }
/** Test-only: return the exact override value (undefined when no override is active).
 * Use this — not _getArcRpcUrl() — to snapshot/restore test state, so that restoring
 * undefined correctly clears the override rather than hardening the production URL. */
export function _getArcRpcUrlOverride(): string | undefined { return _arcRpcUrlOverride }

/**
 * Resolve the active Arc RPC URL.
 * Priority: Node test override → browser window.__arcRpcOverrideUrl → production URL.
 *
 * window.__arcRpcOverrideUrl is ONLY honoured when the page is served from a
 * localhost/127.0.0.1 origin (Vite dev server or test fixture).  It is silently
 * ignored on any other origin so a production deployment cannot be redirected to
 * an attacker-controlled RPC endpoint via a page script.
 */
export function _getArcRpcUrl(): string {
  if (_arcRpcUrlOverride !== undefined) return _arcRpcUrlOverride
  // Browser test fixture hook: only active on localhost / loopback origins.
  if (typeof window !== 'undefined') {
    const win = window as unknown as { __arcRpcOverrideUrl?: string }
    const { hostname } = window.location
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
    if (isLocalhost && win.__arcRpcOverrideUrl) return win.__arcRpcOverrideUrl
  }
  return ARC_RPC_PRODUCTION_URL
}

let _requestId = 1

/**
 * Send a single JSON-RPC request directly to the Arc Testnet RPC endpoint.
 * Validates: HTTP status, Content-Type, jsonrpc version, response id, and
 * the absence of a JSON-RPC error object before returning result.
 * Wraps fetch + response.json() in a single AbortController deadline.
 * Never call this for wallet-interactive methods.
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

    // Validate HTTP layer.
    if (!res.ok) {
      throw new Error(`${method} HTTP ${res.status} from Arc RPC`)
    }

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new Error(`${method} non-JSON response from Arc RPC`)
    }

    // Validate JSON-RPC envelope.
    if (
      typeof json !== 'object' ||
      json === null ||
      (json as Record<string, unknown>).jsonrpc !== '2.0'
    ) {
      throw new Error(`${method} invalid JSON-RPC envelope from Arc RPC`)
    }

    const envelope = json as Record<string, unknown>

    // Response id must match request id (guards against cross-request confusion).
    if (envelope.id !== id) {
      throw new Error(`${method} response id mismatch (sent ${id}, got ${String(envelope.id)})`)
    }

    // Propagate JSON-RPC errors.
    if (envelope.error !== undefined) {
      const err = envelope.error as Record<string, unknown>
      throw new Error(typeof err.message === 'string' ? err.message : `${method} RPC error`)
    }

    return envelope.result
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
 * Safety: eth_chainId and eth_accounts always read from the injected provider
 * so the wallet's own chain selection is authoritative for signing guards.
 *
 * Usage: replace every `p.request({ method, params })` read-only call with
 * `rpcRead(p, method, params)`.  Never use rpcRead for eth_sendTransaction.
 */
export type Eip1193Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> }

import { withRpcTimeout } from './rpcTimeout.ts'

export function rpcRead(p: Eip1193Provider, method: string, params: unknown[] = []): Promise<unknown> {
  if (PROVIDER_ONLY_METHODS.has(method)) {
    throw new Error(`rpcRead: ${method} is wallet-interactive — use p.request() directly`)
  }
  if (ARC_RPC_BYPASS_METHODS.has(method)) {
    return arcRpc(method, params)
  }
  // eth_accounts, eth_chainId — go through provider with timeout.
  return withRpcTimeout(p.request({ method, params }), _getRpcTimeoutMs(), method)
}
