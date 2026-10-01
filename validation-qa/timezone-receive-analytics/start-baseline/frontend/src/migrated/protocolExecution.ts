import { decodeEventLog, erc20Abi, isHash, type Hex } from 'viem'
import type { SendProvider } from '../lib/sendExecution.ts'
import { isWalletRejection, SendSubmissionGuard } from '../lib/sendExecution.ts'
import { readAllowance, readReceipt, type PreparedToolAction, type SwapToolQuote } from './toolLayer.ts'
import { getAssetById } from './assets.ts'
import { executePreparedCctpCall, hasOfficialCctpMessageEvent } from '../protocols/circle/cctpAdapter.ts'

/** A prepared request may be submitted only by a user action after review and revalidation. */
export async function requestReviewedAction(p: SendProvider, action: PreparedToolAction, guard: SendSubmissionGuard): Promise<Hex> {
  return guard.run(async () => {
    const hash = await p.request({ method: 'eth_sendTransaction', params: [action.request] })
    if (!isHash(hash)) throw new Error('Wallet returned no transaction hash')
    return hash
  })
}

/** Circle's captured /next request is the sole write path for CCTP approval and burn. */
export async function requestReviewedCctpAction(action: PreparedToolAction, guard: SendSubmissionGuard): Promise<Hex> {
  if (action.kind !== 'approval' && action.kind !== 'cctp-burn') throw new Error('Unsupported Circle wallet request')
  return guard.run(() => executePreparedCctpCall(action))
}

export { isWalletRejection }
export type ProtocolReceiptState = 'pending' | 'confirmed' | 'failed' | 'unknown'

export async function checkProtocolReceipt(p: SendProvider, action: PreparedToolAction, hash: Hex, options: { swapQuote?: SwapToolQuote; approval?: { symbol: 'USDC' | 'EURC'; spender: string; minimum: bigint } } = {}): Promise<ProtocolReceiptState> {
  const basic = await readReceipt(p, hash)
  if (basic.status !== 'OK' || !basic.data) return 'unknown'
  if (basic.data.status !== 'confirmed') return basic.data.status
  try {
    const [receipt, transaction] = await Promise.all([
      p.request({ method: 'eth_getTransactionReceipt', params: [hash] }),
      p.request({ method: 'eth_getTransactionByHash', params: [hash] }),
    ])
    if (!receipt || !transaction || transaction.hash?.toLowerCase() !== hash.toLowerCase() || transaction.to?.toLowerCase() !== action.request.to.toLowerCase() || transaction.from?.toLowerCase() !== action.account.toLowerCase() || transaction.input?.toLowerCase() !== action.request.data.toLowerCase()) return 'unknown'
    if (action.kind === 'approval') {
      if (!options.approval) return 'unknown'
      const current = await readAllowance(p, options.approval.symbol, options.approval.spender, action.account)
      return current.status === 'OK' && current.data && current.data.units >= options.approval.minimum ? 'confirmed' : 'unknown'
    }
    if (action.kind === 'cctp-burn') return hasOfficialCctpMessageEvent(action.account, receipt.logs ?? []) ? 'confirmed' : 'unknown' // Source chain only. Destination completion needs separate evidence.
    if (!options.swapQuote) return 'unknown'
    const output = getAssetById(options.swapQuote.quote.toAssetId)
    if (!output) return 'unknown'
    const transfer = (receipt.logs ?? []).some((log: { address?: string; data?: Hex; topics?: Hex[] }) => {
      if (log.address?.toLowerCase() !== output.address.toLowerCase() || !log.data || !log.topics?.length) return false
      try {
        const event = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        return event.args.to.toLowerCase() === action.account.toLowerCase() && event.args.value >= options.swapQuote!.minimumReceive
      } catch { return false }
    })
    return transfer ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}

export async function pollProtocolReceipt(p: SendProvider, action: PreparedToolAction, hash: Hex, options: Parameters<typeof checkProtocolReceipt>[3], onPending?: () => void): Promise<Exclude<ProtocolReceiptState, 'pending'>> {
  for (let i = 0; i < 30; i++) {
    const state = await checkProtocolReceipt(p, action, hash, options)
    if (state !== 'pending') return state
    onPending?.()
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return 'unknown'
}
