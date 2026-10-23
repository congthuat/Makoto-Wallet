/**
 * arcRpcBridgeProvider — EIP-1193 provider wrapper for Circle SDK calls.
 *
 * OKX Wallet (and similar injected providers) recognise eth_chainId and
 * eth_accounts but silently stall on read-only methods like eth_estimateGas,
 * eth_call, eth_gasPrice, eth_getBalance and eth_getCode when those methods
 * are forwarded internally by an SDK (e.g. Circle's viem adapter).
 *
 * This wrapper routes every read-only method directly to the official Arc
 * Testnet RPC endpoint so the Circle SDK never touches the injected provider
 * for blockchain reads.  Only wallet-interactive methods are forwarded to the
 * injected provider:
 *
 *   Injected provider only (wallet-gated):
 *     eth_sendTransaction, eth_requestAccounts, personal_sign, eth_signTypedData,
 *     eth_accounts, eth_chainId, wallet_switchEthereumChain, wallet_addEthereumChain
 *
 *   Arc RPC direct (read-only):
 *     eth_call, eth_estimateGas, eth_gasPrice, eth_getBalance, eth_getCode,
 *     eth_getTransactionCount, eth_getTransactionReceipt, eth_getTransactionByHash,
 *     eth_blockNumber, eth_getLogs, eth_feeHistory, net_version, and everything else.
 *
 * Security invariants preserved:
 *  - Chain ID and account are read from the injected provider so UI checks
 *    still use the wallet's own chain/account state.
 *  - eth_sendTransaction is never wrapped or timed out.
 *  - Only public Arc RPC data is read; no signing keys are involved.
 */

import { rpcRead } from './arcRpc.ts'
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
 * Wraps an EIP-1193 provider so that read-only RPC calls bypass the injected
 * wallet and go directly to Arc Testnet RPC.  Wallet-interactive calls are
 * forwarded to the original provider unchanged.
 *
 * The returned object implements the minimal `SendProvider` interface used
 * throughout the Makoto codebase and is safe to pass to the Circle SDK adapter.
 */
export function makeArcRpcBridgeProvider(p: SendProvider): SendProvider {
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (WALLET_METHODS.has(method)) {
        // Wallet-interactive: always goes through the connected provider.
        return p.request({ method, params })
      }
      // Read-only: bypass the injected provider and call Arc RPC directly.
      // rpcRead uses _getRpcTimeoutMs() so tests can override the timeout.
      return rpcRead(p, method, params)
    },
  }
}
