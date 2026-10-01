import { decodeEventLog, erc20Abi, isHash, type Hex } from 'viem'
import type { SendProvider } from './sendExecution.ts'
import { TOKENS } from './wallet.ts'
import { api } from './api.ts'
import { getOfficialCctpStatus, hasOfficialCctpMessageEvent, type CctpAdapterDependencies } from '../protocols/circle/cctpAdapter.ts'

export type SwapRecord = Readonly<{ hash: string; account: string; target: string; calldata: string; fromSymbol: 'USDC' | 'EURC'; toSymbol: 'USDC' | 'EURC'; amount: string; minimumOutputUnits: string; timestamp: number; status: 'pending' | 'unknown' | 'completed' | 'failed' }>
export type BridgeRecord = Readonly<{ hash: string; account: string; target: string; calldata: string; amount: string; expectedReceiveUnits: string; destinationDomain?: number; maxFeeUnits?: string; finalityThreshold?: string; timestamp: number; status: 'source-pending' | 'source-unknown' | 'source-confirmed' | 'attesting' | 'destination-pending' | 'destination-confirmed' | 'forwarding-failed' | 'destination-failed' | 'failed'; destinationHash?: string }>

export function mergeBridgeRecord(old: BridgeRecord | undefined, next: BridgeRecord): BridgeRecord {
  if (old?.status === 'destination-confirmed' || old?.status === 'destination-failed' || old?.status === 'forwarding-failed' || old?.status === 'failed') return old
  if (old?.status === 'source-unknown' && next.status === 'source-pending') return old
  const rank: Record<BridgeRecord['status'], number> = { 'source-pending': 0, 'source-unknown': 0, 'source-confirmed': 1, attesting: 2, 'destination-pending': 3, 'destination-confirmed': 4, 'forwarding-failed': 4, 'destination-failed': 4, failed: 4 }
  if (old && rank[next.status] < rank[old.status]) return old
  return next
}

/** A Circle forward hash remains pending until Base receipt and USDC Transfer evidence match. */
export async function checkBridgeRecord(p: SendProvider, record: BridgeRecord, fetcher: typeof fetch = fetch, dependencies: CctpAdapterDependencies = {}): Promise<BridgeRecord> {
  if (!isHash(record.hash) || !/^0x[0-9a-f]{40}$/i.test(record.account) || !/^0x[0-9a-f]{40}$/i.test(record.target) || !/^0x[0-9a-f]*$/i.test(record.calldata) || !/^\d+$/.test(record.expectedReceiveUnits)) return { ...record, status: 'source-unknown' }
  try {
    const chainId = await p.request({ method: 'eth_chainId' })
    if (typeof chainId !== 'string' || BigInt(chainId) !== 5042002n) return { ...record, status: 'source-unknown' }
    const receipt = await p.request({ method: 'eth_getTransactionReceipt', params: [record.hash] })
    if (!receipt) return { ...record, status: record.status === 'source-pending' ? 'source-pending' : record.status === 'source-unknown' ? 'source-unknown' : record.status }
    if (receipt.transactionHash?.toLowerCase() !== record.hash.toLowerCase() || !receipt.blockHash || !receipt.blockNumber) return { ...record, status: 'source-unknown' }
    const tx = await p.request({ method: 'eth_getTransactionByHash', params: [record.hash] })
    if (!tx || tx.hash?.toLowerCase() !== record.hash.toLowerCase() || tx.from?.toLowerCase() !== record.account.toLowerCase() || tx.to?.toLowerCase() !== record.target.toLowerCase() || tx.input?.toLowerCase() !== record.calldata.toLowerCase()) return { ...record, status: 'source-unknown' }
    if (receipt.status === '0x0') return { ...record, status: 'failed' }
    if (receipt.status !== '0x1') return { ...record, status: 'source-unknown' }
    if (!hasOfficialCctpMessageEvent(record.account as `0x${string}`, receipt.logs ?? [])) return { ...record, status: 'source-unknown' }
    if (record.destinationDomain === undefined || !record.maxFeeUnits || !/^\d+$/.test(record.maxFeeUnits)) return { ...record, status: 'source-confirmed' }
    const official = await getOfficialCctpStatus(p, {
      account: record.account as `0x${string}`, burnHash: record.hash as Hex,
      destinationDomain: record.destinationDomain, recipient: record.account as `0x${string}`,
      expectedReceive: BigInt(record.expectedReceiveUnits), maxFee: BigInt(record.maxFeeUnits),
      ...(record.finalityThreshold && /^\d+$/.test(record.finalityThreshold) ? { finalityThreshold: BigInt(record.finalityThreshold) } : {}),
    }, dependencies)
    if (official.state === 'unavailable') return { ...record, status: 'source-confirmed' }
    if (official.state === 'forwarding-failed') return { ...record, status: 'forwarding-failed' }
    if (!official.forwardTxHash) return { ...record, status: 'attesting' }
    const destinationHash = official.forwardTxHash
    const destinationResponse = await fetcher(api(`cctp/destination?txHash=${destinationHash}&recipient=${record.account}&minimumUnits=${record.expectedReceiveUnits}`), { cache: 'no-store' })
    if (!destinationResponse.ok) return { ...record, destinationHash, status: 'destination-pending' }
    const destination: unknown = await destinationResponse.json()
    if (!destination || typeof destination !== 'object') return { ...record, destinationHash, status: 'destination-pending' }
    const destinationStatus = (destination as { status?: string }).status
    return { ...record, destinationHash, status: destinationStatus === 'confirmed' ? 'destination-confirmed' : destinationStatus === 'failed' ? 'destination-failed' : 'destination-pending' }
  } catch { return { ...record, status: record.status === 'source-pending' ? 'source-unknown' : record.status } }
}

export function mergeSwapRecord(old: SwapRecord | undefined, next: SwapRecord): SwapRecord {
  if (old && (old.status === 'completed' || old.status === 'failed')) return old
  return next
}

export async function checkSwapRecord(p: SendProvider, record: SwapRecord): Promise<'pending' | 'unknown' | 'completed' | 'failed'> {
  if (!isHash(record.hash) || !/^0x[0-9a-f]{40}$/i.test(record.account) || !/^0x[0-9a-f]{40}$/i.test(record.target) || !/^0x[0-9a-f]*$/i.test(record.calldata) || !/^\d+$/.test(record.minimumOutputUnits)) return 'unknown'
  const token = TOKENS.find((item) => item.sym === record.toSymbol)
  if (!token) return 'unknown'
  try {
    const receipt = await p.request({ method: 'eth_getTransactionReceipt', params: [record.hash] })
    if (!receipt) return record.status === 'unknown' ? 'unknown' : 'pending'
    if (receipt.transactionHash?.toLowerCase() !== record.hash.toLowerCase() || !receipt.blockHash || !receipt.blockNumber) return 'unknown'
    const tx = await p.request({ method: 'eth_getTransactionByHash', params: [record.hash] })
    if (!tx || tx.hash?.toLowerCase() !== record.hash.toLowerCase() || tx.from?.toLowerCase() !== record.account.toLowerCase() || tx.to?.toLowerCase() !== record.target.toLowerCase() || tx.input?.toLowerCase() !== record.calldata.toLowerCase()) return 'unknown'
    if (receipt.status === '0x0') return 'failed'
    if (receipt.status !== '0x1') return 'unknown'
    const output = (receipt.logs ?? []).some((log: { address?: string; topics?: Hex[]; data?: Hex }) => {
      if (log.address?.toLowerCase() !== token.address.toLowerCase() || !log.topics?.length || !log.data) return false
      try {
        const event = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', topics: log.topics as [Hex, ...Hex[]], data: log.data })
        return event.args.to.toLowerCase() === record.account.toLowerCase() && event.args.value >= BigInt(record.minimumOutputUnits)
      } catch { return false }
    })
    return output ? 'completed' : 'unknown'
  } catch { return 'unknown' }
}
