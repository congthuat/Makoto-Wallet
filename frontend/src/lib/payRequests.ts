/**
 * Makoto Pay Requests — client for contracts/src/MakotoPayRequests.sol on Arc Testnet.
 *
 * Safety model (same as the rest of Makoto):
 * - Reads go to Arc RPC directly; writes are prepared here, shown for review, and
 *   only then sent to the user's own wallet (eth_sendTransaction). Nothing is signed here.
 * - A write is "confirmed" only with a successful receipt AND the expected event
 *   emitted by the expected contract. A wallet request or a hash alone is not success.
 * - Approvals are exact (never unlimited) and are a separate review from the payment.
 */
import { decodeEventLog, decodeFunctionResult, encodeDeployData, encodeFunctionData, erc20Abi, getAddress, isAddress as viemIsAddress, type Address, type Hex } from 'viem'
import { arcRpc } from './arcRpc.ts'
import { ARC, TOKENS } from './wallet.ts'
import type { SendProvider } from './sendExecution.ts'
import { MAKOTO_PAY_REQUESTS_ABI, MAKOTO_PAY_REQUESTS_BYTECODE } from '../contracts/makotoPayRequests.ts'

/** Official deployment on Arc Testnet; set after the owner deploys and the source is verified. */
export const DEPLOYED_PAY_REQUESTS_ADDRESS: Address | null = null
const LOCAL_ADDRESS_KEY = 'mk.payRequests.address.v1'
const MINE_KEY = 'mk.payRequests.mine.v1'

export type PayToken = 'USDC' | 'EURC'
export type PayStatus = 'open' | 'completed' | 'cancelled' | 'expired'
export type PayRequest = Readonly<{
  id: bigint; payee: Address; token: PayToken; tokenAddress: Address; decimals: number; amount: bigint
  maxPayments: number; paidCount: number; allowedPayer: Address | null; expiresAt: number; cancelled: boolean; memo: string; status: PayStatus
}>
export type PreparedTx = Readonly<{ from: Address; to?: Address; data: Hex; value: '0x0'; gas: Hex; gasPrice: Hex; feeUsdc: number }>
export type TxOutcome = Readonly<{ status: 'confirmed' | 'failed' | 'unknown'; hash: Hex; receipt?: Record<string, unknown> }>

const USDC = TOKENS.find((t) => t.sym === 'USDC')!
const EURC = TOKENS.find((t) => t.sym === 'EURC')!
export const PAY_TOKENS: Record<PayToken, { address: Address; decimals: number }> = {
  USDC: { address: getAddress(USDC.address), decimals: USDC.decimals },
  EURC: { address: getAddress(EURC.address), decimals: EURC.decimals },
}
const STATUS: PayStatus[] = ['open', 'completed', 'cancelled', 'expired']
const hex = (value: bigint): Hex => `0x${value.toString(16)}`
const big = (value: unknown) => { if (typeof value !== 'string' || !/^0x[0-9a-f]*$/i.test(value)) throw new Error('Invalid RPC number'); return BigInt(value === '0x' ? 0 : value) }

// ---------------------------------------------------------------- address config
export function configuredPayAddress(store: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Address | null {
  if (DEPLOYED_PAY_REQUESTS_ADDRESS) return DEPLOYED_PAY_REQUESTS_ADDRESS
  try {
    const value = store?.getItem(LOCAL_ADDRESS_KEY)
    return value && viemIsAddress(value) ? getAddress(value) : null
  } catch { return null }
}
export function rememberPayAddress(address: Address) { try { localStorage.setItem(LOCAL_ADDRESS_KEY, getAddress(address)) } catch { /* storage blocked */ } }

// ---------------------------------------------------------------- reads
async function call(to: Address, data: Hex): Promise<Hex> {
  const result = await arcRpc('eth_call', [{ to, data }, 'latest'])
  if (typeof result !== 'string' || !result.startsWith('0x')) throw new Error('Invalid eth_call result')
  return result as Hex
}

/** Confirms a contract is a MakotoPayRequests bound to Arc USDC/EURC (checks code and immutables). */
export async function verifyPayContract(address: Address): Promise<boolean> {
  try {
    const code = await arcRpc('eth_getCode', [address, 'latest'])
    if (typeof code !== 'string' || code.length < 100) return false
    const read = async (functionName: 'tokenA' | 'tokenB' | 'MAX_PAYMENTS') => decodeFunctionResult({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName, data: await call(address, encodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName })) })
    const [a, b, max] = await Promise.all([read('tokenA'), read('tokenB'), read('MAX_PAYMENTS')])
    return getAddress(a as string) === PAY_TOKENS.USDC.address && getAddress(b as string) === PAY_TOKENS.EURC.address && max === 100n
  } catch { return false }
}

export async function readPayRequest(contract: Address, id: bigint): Promise<PayRequest | null> {
  let data: Hex
  try { data = await call(contract, encodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName: 'getRequest', args: [id] })) }
  catch { return null } // RequestNotFound reverts
  const [request, memo, status] = decodeFunctionResult({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName: 'getRequest', data }) as unknown as [
    { payee: Address; amount: bigint; token: Address; maxPayments: number; paidCount: number; allowedPayer: Address; expiresAt: bigint; cancelled: boolean }, string, number,
  ]
  const token: PayToken | null = getAddress(request.token) === PAY_TOKENS.USDC.address ? 'USDC' : getAddress(request.token) === PAY_TOKENS.EURC.address ? 'EURC' : null
  if (!token) return null
  return {
    id, payee: getAddress(request.payee), token, tokenAddress: PAY_TOKENS[token].address, decimals: PAY_TOKENS[token].decimals, amount: request.amount,
    maxPayments: Number(request.maxPayments), paidCount: Number(request.paidCount),
    allowedPayer: /^0x0{40}$/i.test(request.allowedPayer) ? null : getAddress(request.allowedPayer),
    expiresAt: Number(request.expiresAt), cancelled: request.cancelled, memo, status: STATUS[status] ?? 'open',
  }
}

export async function readHasPaid(contract: Address, id: bigint, account: Address): Promise<boolean> {
  const data = await call(contract, encodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName: 'hasPaid', args: [id, account] }))
  return decodeFunctionResult({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName: 'hasPaid', data }) as boolean
}

export async function readAllowanceUnits(token: PayToken, owner: Address, spender: Address): Promise<bigint> {
  const data = await call(PAY_TOKENS[token].address, encodeFunctionData({ abi: erc20Abi, functionName: 'allowance', args: [owner, spender] }))
  return decodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', data }) as bigint
}

export async function readTokenUnits(token: PayToken, owner: Address): Promise<bigint> {
  const data = await call(PAY_TOKENS[token].address, encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [owner] }))
  return decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data }) as bigint
}

// ---------------------------------------------------------------- calldata
export const deployData = (): Hex => encodeDeployData({ abi: MAKOTO_PAY_REQUESTS_ABI, bytecode: MAKOTO_PAY_REQUESTS_BYTECODE, args: [PAY_TOKENS.USDC.address, PAY_TOKENS.EURC.address] })
export const createData = (input: { token: PayToken; amount: bigint; maxPayments: number; allowedPayer: Address | null; expiresAt: number; memo: string }): Hex =>
  encodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName: 'createRequest', args: [PAY_TOKENS[input.token].address, input.amount, input.maxPayments, input.allowedPayer ?? '0x0000000000000000000000000000000000000000', BigInt(input.expiresAt), input.memo] })
export const payData = (id: bigint): Hex => encodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName: 'pay', args: [id] })
export const cancelData = (id: bigint): Hex => encodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, functionName: 'cancel', args: [id] })
export const approveData = (spender: Address, amount: bigint): Hex => encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })

/** Validates the create form; returns an error key or the normalized input. */
export function validateCreate(input: { amount: string; decimals: number; payers: string; allowedPayer: string; memo: string; account?: string }): { ok: true; amount: bigint; maxPayments: number; allowedPayer: Address | null; memo: string } | { ok: false; error: 'amount' | 'payers' | 'payer' | 'memo' } {
  const amountText = input.amount.trim()
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(amountText)) return { ok: false, error: 'amount' }
  const [whole, fraction = ''] = amountText.split('.')
  if (fraction.length > input.decimals) return { ok: false, error: 'amount' }
  const amount = BigInt(whole) * 10n ** BigInt(input.decimals) + BigInt((fraction + '0'.repeat(input.decimals)).slice(0, input.decimals) || '0')
  if (amount <= 0n || amount >= 2n ** 96n) return { ok: false, error: 'amount' }
  const payers = Number(input.payers)
  if (!Number.isInteger(payers) || payers < 1 || payers > 100) return { ok: false, error: 'payers' }
  const payer = input.allowedPayer.trim()
  if (payer && (payers !== 1 || !viemIsAddress(payer) || payer.toLowerCase() === input.account?.toLowerCase())) return { ok: false, error: 'payer' }
  const memo = input.memo.trim()
  if (new TextEncoder().encode(memo).length > 140) return { ok: false, error: 'memo' }
  return { ok: true, amount, maxPayments: payers, allowedPayer: payer ? getAddress(payer) : null, memo }
}

// ---------------------------------------------------------------- writes
/** Bounded gas and fee checks before any wallet request (mirrors Makoto's send path). */
export async function prepareTx(p: SendProvider, account: Address, to: Address | undefined, data: Hex): Promise<PreparedTx> {
  const [accounts, chain] = await Promise.all([p.request({ method: 'eth_accounts' }), p.request({ method: 'eth_chainId' })])
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== account.toLowerCase()) throw new Error('Connect the reviewed account in your wallet.')
  if (Number(chain) !== ARC.chainId) throw new Error('Switch your wallet to Arc Testnet.')
  const estimate = big(await arcRpc('eth_estimateGas', [{ from: account, ...(to ? { to } : {}), data, value: '0x0' }]))
  const price = big(await arcRpc('eth_gasPrice'))
  const gas = (estimate * 12n + 9n) / 10n
  const gasPrice = price * 2n > 20_000_000_000n ? price * 2n : 20_000_000_000n
  const balance = big(await arcRpc('eth_getBalance', [account, 'latest']))
  if (balance < gas * gasPrice) throw new Error('Not enough USDC on Arc to pay the network fee.')
  return { from: account, ...(to ? { to } : {}), data, value: '0x0', gas: hex(gas), gasPrice: hex(gasPrice), feeUsdc: Number(gas * gasPrice) / 1e18 }
}

export async function sendPrepared(p: SendProvider, tx: PreparedTx): Promise<Hex> {
  const { feeUsdc: _fee, ...request } = tx
  const hash = await p.request({ method: 'eth_sendTransaction', params: [request] })
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('The wallet returned no transaction hash.')
  return hash as Hex
}

export async function waitForReceipt(hash: Hex, timeoutMs = 120_000, intervalMs = 2_000): Promise<TxOutcome> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const receipt = await arcRpc('eth_getTransactionReceipt', [hash]).catch(() => null) as Record<string, unknown> | null
    if (receipt && typeof receipt.status === 'string') return { status: receipt.status === '0x1' ? 'confirmed' : 'failed', hash, receipt }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return { status: 'unknown', hash }
}

type Log = { address?: string; topics?: Hex[]; data?: Hex }
function eventsFrom(receipt: Record<string, unknown> | undefined, contract: Address) {
  const logs = Array.isArray(receipt?.logs) ? receipt.logs as Log[] : []
  return logs.flatMap((log) => {
    if (!log.address || getAddress(log.address) !== contract || !log.topics?.length) return []
    try { return [decodeEventLog({ abi: MAKOTO_PAY_REQUESTS_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data ?? '0x' })] } catch { return [] }
  })
}

/** Request id from a confirmed createRequest receipt (must be emitted by `contract` for `payee`). */
export function createdRequestId(receipt: Record<string, unknown> | undefined, contract: Address, payee: Address): bigint | null {
  const event = eventsFrom(receipt, contract).find((item) => item.eventName === 'RequestCreated' && getAddress((item.args as { payee: Address }).payee) === getAddress(payee))
  return event ? (event.args as { id: bigint }).id : null
}

export function paidEventMatches(receipt: Record<string, unknown> | undefined, contract: Address, id: bigint, payer: Address): boolean {
  return eventsFrom(receipt, contract).some((item) => item.eventName === 'Paid' && (item.args as { id: bigint }).id === id && getAddress((item.args as { payer: Address }).payer) === getAddress(payer))
}

export function cancelledEventMatches(receipt: Record<string, unknown> | undefined, contract: Address, id: bigint): boolean {
  return eventsFrom(receipt, contract).some((item) => item.eventName === 'Cancelled' && (item.args as { id: bigint }).id === id)
}

// ---------------------------------------------------------------- local list & links
export function myRequestIds(account: string | undefined): bigint[] {
  if (!account) return []
  try {
    const all = JSON.parse(localStorage.getItem(MINE_KEY) ?? '{}') as Record<string, string[]>
    return (all[account.toLowerCase()] ?? []).filter((id) => /^\d+$/.test(id)).map(BigInt)
  } catch { return [] }
}
export function rememberMyRequest(account: string, id: bigint) {
  try {
    const all = JSON.parse(localStorage.getItem(MINE_KEY) ?? '{}') as Record<string, string[]>
    const key = account.toLowerCase()
    all[key] = [...new Set([id.toString(), ...(all[key] ?? [])])].slice(0, 50)
    localStorage.setItem(MINE_KEY, JSON.stringify(all))
  } catch { /* storage blocked */ }
}
export function payLink(id: bigint): string {
  if (typeof window === 'undefined') return `#pay-${id}`
  return `${window.location.origin}${window.location.pathname}#pay-${id}`
}
export function requestIdFromHash(hash: string): bigint | null {
  const match = /^#?pay-(\d{1,20})$/.exec(hash)
  return match ? BigInt(match[1]) : null
}
export function formatUnitsText(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${(value / base).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`
}
