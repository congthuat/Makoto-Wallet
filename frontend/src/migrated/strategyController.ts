import { isAddress, isHash } from 'viem'
import { ARC } from '../lib/wallet.ts'
import type { SendProvider } from '../lib/sendExecution.ts'
import { checkProtocolReceipt } from './protocolExecution.ts'
import { checkSwapRecord, type SwapRecord } from '../lib/protocolActivity.ts'

/** Runtime evidence gate for one protocol step. It never contains a signer or a live review. */
export type StrategyPhase = 'IDLE' | 'REVIEW_APPROVAL' | 'REVIEW_ACTION' | 'AWAITING_USER' | 'SUBMITTED' | 'PENDING' | 'UNKNOWN' | 'USER_REJECTED' | 'FAILED' | 'REVALIDATING' | 'REQUOTING' | 'SOURCE_CONFIRMED' | 'DESTINATION_PENDING' | 'FORWARDING_FAILED' | 'DESTINATION_FAILED' | 'COMPLETED' | 'EXPIRED' | 'BLOCKED' | 'RECOVERING'
export type StrategyStepKind = 'approval' | 'swap' | 'cctp-burn'
export type StrategyReceiptBinding = Readonly<{ from: string; to: string; data: string; symbol?: 'USDC' | 'EURC'; spender?: string; requiredUnits?: string; outputSymbol?: 'USDC' | 'EURC'; minimumOutputUnits?: string; amount?: string; expectedReceiveUnits?: string; recipient?: string; destinationDomain?: number; maxFeeUnits?: string; finalityThreshold?: string }>
export type StrategyRun = Readonly<{ version: 1; protocol: 'swap' | 'cctp'; account: string; chainId: typeof ARC.chainId; phase: StrategyPhase; step?: StrategyStepKind; hash?: string; binding?: StrategyReceiptBinding; updatedAt: number; reason?: string }>
export type StrategyEvent =
  | { type: 'review'; step: StrategyStepKind; account: string; chainId: number; expiresAt: number; quoteFresh: boolean; policyPassed: boolean; simulationPassed: boolean; now: number }
  | { type: 'wallet-request'; binding: StrategyReceiptBinding; now: number }
  | { type: 'hash'; hash: string; now: number }
  | { type: 'pending' | 'unknown' | 'failed' | 'confirmed' | 'user-rejected'; now: number }
  | { type: 'allowance-reread'; sufficient: boolean; account: string; chainId: number; now: number }
  | { type: 'destination-pending' | 'destination-confirmed' | 'destination-failed' | 'forwarding-failed'; now: number }
  | { type: 'invalidate'; reason: string; now: number }
export type StrategyTransition = { accepted: true; state: StrategyRun } | { accepted: false; reason: string }
const reject = (reason: string): StrategyTransition => ({ accepted: false, reason })
const changed = (run: StrategyRun, phase: StrategyPhase, now: number, extras: Partial<StrategyRun> = {}): StrategyTransition => ({ accepted: true, state: Object.freeze({ ...run, ...extras, phase, updatedAt: now }) })

export function createStrategyRun(protocol: StrategyRun['protocol'], account: string, now = Date.now()): StrategyRun {
  if (!isAddress(account) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid strategy identity')
  return Object.freeze({ version: 1, protocol, account: account.toLowerCase(), chainId: ARC.chainId, phase: 'IDLE', updatedAt: now })
}

/** Receipt, allowance and destination events must be supplied by verified reads, never an SDK callback. */
export function transitionStrategy(run: StrategyRun, event: StrategyEvent): StrategyTransition {
  if (!Number.isSafeInteger(event.now) || event.now < run.updatedAt) return reject('Invalid evidence time')
  if (event.type === 'invalidate' && event.reason.trim()) return changed(run, 'BLOCKED', event.now, { reason: event.reason })
  if (event.type === 'review') {
    if (event.account.toLowerCase() !== run.account || event.chainId !== run.chainId || event.expiresAt <= event.now || !event.quoteFresh || !event.policyPassed || !event.simulationPassed) return reject('Account, chain, quote, policy, simulation or review expiry changed')
    if (event.step === 'approval' && run.phase === 'IDLE') return changed(run, 'REVIEW_APPROVAL', event.now, { step: 'approval', hash: undefined, binding: undefined })
    if (event.step === (run.protocol === 'swap' ? 'swap' : 'cctp-burn') && (run.phase === 'IDLE' || run.phase === 'REQUOTING')) return changed(run, 'REVIEW_ACTION', event.now, { step: event.step, hash: undefined, binding: undefined })
    return reject('Dependent review requires fresh evidence')
  }
  if (event.type === 'wallet-request') {
    if (!['REVIEW_APPROVAL', 'REVIEW_ACTION'].includes(run.phase) || !run.step || event.binding.from.toLowerCase() !== run.account || !isAddress(event.binding.to) || !/^0x[0-9a-f]*$/i.test(event.binding.data)) return reject('No bounded reviewed step')
    return changed(run, 'AWAITING_USER', event.now, { binding: event.binding })
  }
  if (event.type === 'user-rejected' && run.phase === 'AWAITING_USER') return changed(run, 'USER_REJECTED', event.now)
  if (event.type === 'hash' && run.phase === 'AWAITING_USER' && isHash(event.hash)) return changed(run, 'SUBMITTED', event.now, { hash: event.hash })
  if (event.type === 'unknown' && ['AWAITING_USER', 'SUBMITTED', 'PENDING', 'RECOVERING'].includes(run.phase)) return changed(run, 'UNKNOWN', event.now)
  if (event.type === 'pending' && ['SUBMITTED', 'PENDING', 'RECOVERING'].includes(run.phase)) return changed(run, 'PENDING', event.now)
  if (event.type === 'failed' && ['SUBMITTED', 'PENDING', 'UNKNOWN', 'RECOVERING'].includes(run.phase) && run.hash) return changed(run, 'FAILED', event.now)
  if (event.type === 'confirmed' && ['SUBMITTED', 'PENDING', 'UNKNOWN', 'RECOVERING'].includes(run.phase) && run.hash) {
    if (run.step === 'approval') return changed(run, 'REVALIDATING', event.now)
    return changed(run, run.protocol === 'swap' ? 'COMPLETED' : 'SOURCE_CONFIRMED', event.now)
  }
  if (event.type === 'allowance-reread' && run.phase === 'REVALIDATING' && event.account.toLowerCase() === run.account && event.chainId === run.chainId) return event.sufficient ? changed(run, 'REQUOTING', event.now) : changed(run, 'BLOCKED', event.now, { reason: 'Approval receipt did not establish sufficient allowance' })
  if (event.type === 'destination-pending' && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.phase)) return changed(run, 'DESTINATION_PENDING', event.now)
  if (event.type === 'destination-confirmed' && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.phase)) return changed(run, 'COMPLETED', event.now)
  if (event.type === 'destination-failed' && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.phase)) return changed(run, 'DESTINATION_FAILED', event.now)
  if (event.type === 'forwarding-failed' && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.phase)) return changed(run, 'FORWARDING_FAILED', event.now)
  return reject('Illegal strategy transition or missing evidence')
}

const key = (protocol: StrategyRun['protocol'], account: string) => `mk.strategy.v1:${protocol}:${account.toLowerCase()}`
export function saveStrategyRun(storage: Pick<Storage, 'setItem'>, run: StrategyRun): boolean {
  try { storage.setItem(key(run.protocol, run.account), JSON.stringify(run)); return true } catch { return false }
}

/** Reviews and wallet requests never survive reload as executable authority. */
export function restoreStrategyRun(storage: Pick<Storage, 'getItem'>, protocol: StrategyRun['protocol'], account: string, now = Date.now()): StrategyRun | undefined {
  if (!isAddress(account)) return undefined
  try {
    const raw = storage.getItem(key(protocol, account)); if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const run = value as StrategyRun
    if (run.version !== 1 || run.protocol !== protocol || run.account !== account.toLowerCase() || run.chainId !== ARC.chainId || !Number.isSafeInteger(run.updatedAt) || !['IDLE','REVIEW_APPROVAL','REVIEW_ACTION','AWAITING_USER','SUBMITTED','PENDING','UNKNOWN','USER_REJECTED','FAILED','REVALIDATING','REQUOTING','SOURCE_CONFIRMED','DESTINATION_PENDING','FORWARDING_FAILED','DESTINATION_FAILED','COMPLETED','EXPIRED','BLOCKED','RECOVERING'].includes(run.phase)) return undefined
    if (run.hash && !isHash(run.hash) || run.binding && (!isAddress(run.binding.from) || run.binding.from.toLowerCase() !== run.account || !isAddress(run.binding.to) || !/^0x[0-9a-f]*$/i.test(run.binding.data))) return undefined
    if (['SUBMITTED','PENDING','REVALIDATING','SOURCE_CONFIRMED','DESTINATION_PENDING','FORWARDING_FAILED','DESTINATION_FAILED','COMPLETED','RECOVERING'].includes(run.phase) && (!run.hash || !run.binding || !run.step)) return undefined
    if (['REVIEW_APPROVAL', 'REVIEW_ACTION', 'REQUOTING'].includes(run.phase)) return Object.freeze({ ...run, phase: 'EXPIRED', binding: undefined, updatedAt: now })
    if (run.phase === 'AWAITING_USER' || run.phase === 'UNKNOWN' && !run.hash) return Object.freeze({ ...run, phase: 'UNKNOWN', updatedAt: now, reason: 'Wallet request outcome requires external reconciliation' })
    if (run.hash && ['SUBMITTED', 'PENDING'].includes(run.phase)) return Object.freeze({ ...run, phase: 'RECOVERING', updatedAt: now })
    return Object.freeze({ ...run, updatedAt: now })
  } catch { return undefined }
}

/** Read-only reload recovery. A stored binding can verify a receipt but can never submit a request. */
export async function recoverStrategyRun(p: SendProvider, run: StrategyRun, now = Date.now()): Promise<StrategyRun> {
  if (!run.hash || !run.binding || !run.step || !['RECOVERING', 'PENDING', 'UNKNOWN', 'SUBMITTED', 'SOURCE_CONFIRMED', 'DESTINATION_PENDING', 'FORWARDING_FAILED', 'DESTINATION_FAILED'].includes(run.phase)) return run
  try {
    if (run.step === 'approval') {
      const binding = run.binding
      if (!binding.symbol || !binding.spender || !binding.requiredUnits || !/^\d+$/.test(binding.requiredUnits)) return Object.freeze({ ...run, phase: 'UNKNOWN', updatedAt: now })
      const action = { kind: 'approval' as const, account: run.account as `0x${string}`, chainId: run.chainId, request: { from: binding.from as `0x${string}`, to: binding.to as `0x${string}`, data: binding.data as `0x${string}`, value: '0x0' as const, gas: '0x0' as const, gasPrice: '0x0' as const }, preparedAt: 0, expiresAt: 0, quoteId: '0x0' as `0x${string}`, executionEnabled: false as const }
      const result = await checkProtocolReceipt(p, action, run.hash as `0x${string}`, { approval: { symbol: binding.symbol, spender: binding.spender, minimum: BigInt(binding.requiredUnits) } })
      return Object.freeze({ ...run, phase: result === 'confirmed' ? 'REVALIDATING' : result === 'failed' ? 'FAILED' : result === 'pending' && run.phase !== 'UNKNOWN' ? 'PENDING' : 'UNKNOWN', updatedAt: now })
    }
    if (run.step === 'swap') {
      const binding = run.binding
      if (!binding.symbol || !binding.outputSymbol || !binding.minimumOutputUnits || !/^\d+$/.test(binding.minimumOutputUnits)) return Object.freeze({ ...run, phase: 'UNKNOWN', updatedAt: now })
      const record: SwapRecord = { hash: run.hash, account: run.account, target: binding.to, calldata: binding.data, fromSymbol: binding.symbol, toSymbol: binding.outputSymbol, amount: binding.amount ?? '0', minimumOutputUnits: binding.minimumOutputUnits, timestamp: run.updatedAt, status: run.phase === 'UNKNOWN' ? 'unknown' : 'pending' }
      const result = await checkSwapRecord(p, record)
      return Object.freeze({ ...run, phase: result === 'completed' ? 'COMPLETED' : result === 'failed' ? 'FAILED' : result === 'pending' ? 'PENDING' : 'UNKNOWN', updatedAt: now })
    }
    const binding = run.binding
    if (!binding.expectedReceiveUnits || !/^\d+$/.test(binding.expectedReceiveUnits) || !binding.recipient || !isAddress(binding.recipient) || binding.recipient.toLowerCase() !== run.account || !Number.isSafeInteger(binding.destinationDomain) || !binding.maxFeeUnits || !/^\d+$/.test(binding.maxFeeUnits) || !binding.finalityThreshold || !/^\d+$/.test(binding.finalityThreshold)) return Object.freeze({ ...run, phase: 'UNKNOWN', updatedAt: now })
    const action = { kind: 'cctp-burn' as const, account: run.account as `0x${string}`, chainId: run.chainId, request: { from: binding.from as `0x${string}`, to: binding.to as `0x${string}`, data: binding.data as `0x${string}`, value: '0x0' as const, gas: '0x0' as const, gasPrice: '0x0' as const }, preparedAt: 0, expiresAt: 0, quoteId: '0x0' as `0x${string}`, executionEnabled: false as const }
    const result = await checkProtocolReceipt(p, action, run.hash as `0x${string}`)
    const phase: StrategyPhase = result === 'confirmed' ? 'SOURCE_CONFIRMED' : result === 'failed' ? 'FAILED' : result === 'pending' ? 'PENDING' : 'UNKNOWN'
    return Object.freeze({ ...run, phase, updatedAt: now })
  } catch { return Object.freeze({ ...run, phase: 'UNKNOWN', updatedAt: now }) }
}
