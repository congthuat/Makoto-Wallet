/**
 * arcRpcBridgeProvider — EIP-1193 provider wrapper for Circle SDK calls.
 *
 * OKX Wallet (and similar injected providers) recognise eth_chainId and
 * eth_accounts but silently stall on read-only methods like eth_estimateGas,
 * eth_call, eth_gasPrice, eth_getBalance and eth_getCode when those methods
 * are forwarded internally by an SDK (e.g. Circle's viem adapter).
 *
 * This wrapper uses two explicit whitelists.  Every method must appear in
 * exactly one; anything else is rejected (fail-closed), never silently routed
 * to the injected provider.
 *
 *   WALLET_METHODS — forwarded to the injected provider (wallet-gated):
 *     eth_sendTransaction, eth_requestAccounts, personal_sign, eth_signTypedData,
 *     eth_accounts, eth_chainId, wallet_switchEthereumChain, wallet_addEthereumChain
 *
 *   ARC_RPC_BRIDGE_READ_METHODS — sent directly to Arc Testnet RPC (read-only):
 *     eth_call, eth_estimateGas, eth_gasPrice, eth_getBalance, eth_getCode,
 *     eth_getTransactionCount, eth_getTransactionReceipt, eth_getTransactionByHash,
 *     eth_blockNumber, eth_getLogs, eth_feeHistory, eth_getBlockByNumber,
 *     eth_maxPriorityFeePerGas, net_version, net_chainId
 *
 *   Unknown methods → throw (fail-closed).  The Circle SDK does not call any
 *   method outside these two sets; an unknown method reaching this wrapper means
 *   something unexpected is happening and must not silently reach the wallet.
 *
 * Security invariants preserved:
 *  - Chain ID and account are always read from the injected provider so wallet
 *    chain-verification guards remain authoritative.
 *  - eth_sendTransaction is never wrapped, timed out, or auto-submitted.
 *  - Only public Arc RPC data is read; no signing keys are involved.
 */

import { arcRpc } from './arcRpc.ts'
import type { SendProvider } from './sendExecution.ts'

/** Methods that must always go through the injected wallet provider. */
const WALLET_METHODS = new Set([
  'eth_sendTransaction',
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_watchAsset',
  'wallet_getPermissions',
  'wallet_requestPermissions',
])

/**
 * Read-only methods routed directly to Arc Testnet RPC, bypassing the injected
 * wallet provider entirely.  This set is the explicit whitelist: only methods
 * verified to be used by the Circle SDK viem adapter and Makoto's own
 * prepareCctpApproval / prepareCctpBurn / simulatePreparedCctpCall paths are
 * included.  Adding a new method here requires intentional review.
 */
const ARC_RPC_BRIDGE_READ_METHODS = new Set([
  // Core reads used by the Circle SDK viem adapter
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getCode',
  'eth_getTransactionCount',
  // Receipt + tx reads
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  // Chain state
  'eth_blockNumber',
  'eth_getLogs',
  'eth_feeHistory',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_maxPriorityFeePerGas',
  // Network info
  'net_version',
  'net_chainId',
])

/**
 * Wraps an EIP-1193 provider so that read-only RPC calls bypass the injected
 * wallet and go directly to Arc Testnet RPC.  Wallet-interactive calls are
 * forwarded to the original provider unchanged.  Unknown methods are rejected
 * (fail-closed) rather than silently forwarded to either destination.
 *
 * The returned object implements the minimal `SendProvider` interface used
 * throughout the Makoto codebase and is safe to pass to the Circle SDK adapter.
 */
export function makeArcRpcBridgeProvider(p: SendProvider): SendProvider {
  return {
    request: async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (WALLET_METHODS.has(method)) {
        // Wallet-interactive: always goes through the connected provider.
        return p.request({ method, params })
      }
      if (ARC_RPC_BRIDGE_READ_METHODS.has(method)) {
        // Read-only: call Arc RPC directly, never the injected provider.
        // arcRpc() uses _getRpcTimeoutMs() so tests can control the timeout.
        return arcRpc(method, params)
      }
      // Fail-closed: unknown method is rejected rather than silently routed.
      // If the Circle SDK introduces a new method, add it to one of the two
      // sets above after reviewing whether it belongs to wallet or read-only.
      throw new Error(
        `arcRpcBridgeProvider: unsupported method "${method}" — ` +
        `add it to WALLET_METHODS or ARC_RPC_BRIDGE_READ_METHODS after review`,
      )
    },
  }
}
