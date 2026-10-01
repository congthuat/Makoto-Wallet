import { ARC, TOKENS, getProvider, isAddress } from './wallet.ts'
import type { TokenMeta } from './wallet.ts'

export type SendProvider = NonNullable<ReturnType<typeof getProvider>>
export type SendRequest = Readonly<{ from: string; to: string; data: string; value: '0x0'; gas: string; gasPrice: string }>
export type PreparedSend = Readonly<{ account: string; chainId: number; recipient: string; token: TokenMeta; amount: string; units: bigint; tokenBalance: bigint; usdcBalance: bigint; gasBalance: bigint; fee: bigint; request: SendRequest; preparedAt: number; expiresAt: number }>
export type SendStatus = 'READY' | 'REQUESTING_WALLET' | 'USER_REJECTED' | 'SUBMITTED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN'
export type SendRecord = { hash: string; account: string; chainId: number; recipient: string; symbol: string; amount: string; timestamp: number; status: 'pending' | 'completed' | 'failed' | 'unknown' }
const ZERO = '0x0000000000000000000000000000000000000000'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function hex(n: bigint) { return `0x${n.toString(16)}` }
function word(n: bigint) { return n.toString(16).padStart(64, '0') }
function addressWord(a: string) { return a.slice(2).toLowerCase().padStart(64, '0') }
function asBigInt(value: unknown, label: string): bigint { if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error(`${label} unavailable`); return BigInt(value) }
function safeAddress(a: string) { if (!isAddress(a) || a.toLowerCase() === ZERO) throw new Error('Invalid recipient'); return a.trim() }
export function parseSendAmount(value: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) throw new Error('Invalid amount precision')
  const [whole, fraction = ''] = value.split('.')
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
  if (units <= 0n) throw new Error('Enter a positive amount')
  return units
}
export function formatSendAmount(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals)
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${value / base}${fraction ? `.${fraction}` : ''}`
}
export function feeInUsdcUnits(raw18: bigint) { return (raw18 + 999_999_999_999n) / 1_000_000_000_000n }
export function safeMax(balance: bigint, usdcBalance: bigint, fee18: bigint, symbol: string): bigint | undefined {
  const fee6 = feeInUsdcUnits(fee18)
  if (usdcBalance <= fee6) return undefined
  const result = symbol === 'USDC' ? balance - fee6 : balance
  return result > 0n ? result : undefined
}
export function encodeTransfer(recipient: string, units: bigint) { return `0xa9059cbb${addressWord(safeAddress(recipient))}${word(units)}` }
async function req(p: SendProvider, method: string, params: unknown[] = []) { return p.request({ method, params }) }
async function chainAndAccount(p: SendProvider) {
  const [accounts, chain] = await Promise.all([req(p, 'eth_accounts'), req(p, 'eth_chainId')])
  const account = Array.isArray(accounts) ? accounts[0] : undefined
  if (!account || !isAddress(account)) throw new Error('Wallet disconnected')
  if (Number(chain) !== ARC.chainId) throw new Error('Wrong network: Arc Testnet is required')
  return { account: account as string, chainId: Number(chain) }
}
async function call(p: SendProvider, to: string, data: string) { return req(p, 'eth_call', [{ to, data }, 'latest']) }
export async function readTokenBalance(p: SendProvider, token: TokenMeta, account: string) {
  return asBigInt(await call(p, token.address, `0x70a08231${addressWord(account)}`), `${token.sym} balance`)
}
async function verifyToken(p: SendProvider, token: TokenMeta) {
  const [code, decimals, symbolHex] = await Promise.all([req(p, 'eth_getCode', [token.address, 'latest']), call(p, token.address, '0x313ce567'), call(p, token.address, '0x95d89b41')])
  if (typeof code !== 'string' || code === '0x' || asBigInt(decimals, 'decimals') !== BigInt(token.decimals)) throw new Error(`${token.sym} metadata unavailable`)
  if (typeof symbolHex !== 'string' || !symbolHex.startsWith('0x')) throw new Error(`${token.sym} metadata unavailable`)
  const bytes = symbolHex.slice(2)
  const length = Number(BigInt(`0x${bytes.slice(64, 128)}`))
  const symbol = new TextDecoder().decode(Uint8Array.from((bytes.slice(128, 128 + length * 2).match(/../g) ?? []).map((x) => parseInt(x, 16))))
  if (symbol !== token.sym) throw new Error(`${token.sym} metadata mismatch`)
}
export async function prepareSend(p: SendProvider, input: { account: string; recipient: string; symbol: string; amount: string }, now = Date.now()): Promise<PreparedSend> {
  const { account, chainId } = await chainAndAccount(p)
  if (account.toLowerCase() !== input.account.toLowerCase()) throw new Error('Connected account changed')
  const recipient = safeAddress(input.recipient)
  if (recipient.toLowerCase() === account.toLowerCase()) throw new Error('Self-send is blocked')
  const token = TOKENS.find((x) => x.sym === input.symbol)
  if (!token) throw new Error('Unsupported asset')
  const units = parseSendAmount(input.amount, token.decimals)
  const code = await req(p, 'eth_getCode', [recipient, 'latest'])
  if (code !== '0x') throw new Error('Contract recipient is unavailable')
  await verifyToken(p, token)
  const usdc = TOKENS[0]
  const [tokenBalance, usdcBalance, gasBalance, estimate, gasPrice] = await Promise.all([
    readTokenBalance(p, token, account), readTokenBalance(p, usdc, account),
    req(p, 'eth_getBalance', [account, 'latest']).then((x) => asBigInt(x, 'gas balance')),
    req(p, 'eth_estimateGas', [{ from: account, to: token.address, data: encodeTransfer(recipient, units), value: '0x0' }]).then((x) => asBigInt(x, 'gas estimate')),
    req(p, 'eth_gasPrice').then((x) => asBigInt(x, 'gas price')),
  ])
  if (units > tokenBalance) throw new Error(`Insufficient ${token.sym} balance`)
  // Explicit upper bounds are shown in review and sent unchanged to the wallet.
  const gas = (estimate * 12n + 9n) / 10n
  const boundedPrice = gasPrice * 2n > 20_000_000_000n ? gasPrice * 2n : 20_000_000_000n
  if (gas <= 0n || boundedPrice <= 0n) throw new Error('Fee estimate unavailable')
  const fee = gas * boundedPrice
  if (gasBalance < fee || usdcBalance < feeInUsdcUnits(fee) + (token.sym === 'USDC' ? units : 0n)) throw new Error('Insufficient USDC for amount and fee')
  return Object.freeze({ account, chainId, recipient, token, amount: input.amount, units, tokenBalance, usdcBalance, gasBalance, fee, request: Object.freeze({ from: account, to: token.address, data: encodeTransfer(recipient, units), value: '0x0', gas: hex(gas), gasPrice: hex(boundedPrice) }), preparedAt: now, expiresAt: now + 60_000 })
}
export function samePrepared(a: PreparedSend, b: PreparedSend) {
  return a.account.toLowerCase() === b.account.toLowerCase() && a.chainId === b.chainId && a.recipient.toLowerCase() === b.recipient.toLowerCase() && a.token.address.toLowerCase() === b.token.address.toLowerCase() && a.units === b.units && JSON.stringify(a.request).toLowerCase() === JSON.stringify(b.request).toLowerCase()
}
export function assertFreshSend(reviewed: PreparedSend, current: PreparedSend, now = Date.now()) {
  if (now > reviewed.expiresAt || !samePrepared(reviewed, current)) throw new Error('Send review changed or expired. Review again.')
}
export function isWalletRejection(error: unknown) { const e = error as { code?: number; message?: string }; return e?.code === 4001 || /reject|denied|cancel/i.test(e?.message ?? '') }
export class SendSubmissionGuard {
  private active = false
  async run<T>(submit: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error('Send already in progress')
    this.active = true
    try { return await submit() } finally { this.active = false }
  }
}
export async function requestSend(p: SendProvider, prepared: PreparedSend): Promise<string> {
  const hash = await req(p, 'eth_sendTransaction', [prepared.request])
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash')
  return hash
}
export async function checkSendReceipt(p: SendProvider, hash: string, prepared: Pick<PreparedSend, 'token' | 'account' | 'recipient' | 'units'>): Promise<'pending' | 'confirmed' | 'failed' | 'unknown'> {
  const receipt = await req(p, 'eth_getTransactionReceipt', [hash])
  if (!receipt) return 'pending'
  if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !receipt.blockHash || !receipt.blockNumber) return 'unknown'
  if (receipt.status === '0x0') return 'failed'
  if (receipt.status !== '0x1') return 'unknown'
  const transfer = (receipt.logs ?? []).some((log: { address?: string; topics?: string[]; data?: string }) => log.address?.toLowerCase() === prepared.token.address.toLowerCase() && log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC && log.topics?.[1]?.toLowerCase() === `0x${addressWord(prepared.account)}` && log.topics?.[2]?.toLowerCase() === `0x${addressWord(prepared.recipient)}` && log.data && BigInt(log.data) === prepared.units)
  return transfer ? 'confirmed' : 'unknown'
}
export async function pollSendReceipt(p: SendProvider, hash: string, prepared: PreparedSend, onPending?: () => void): Promise<'confirmed' | 'failed' | 'unknown'> {
  for (let i = 0; i < 30; i++) {
    try { const result = await checkSendReceipt(p, hash, prepared); if (result !== 'pending') return result } catch { /* Retry until timeout, then report unknown. */ }
    onPending?.()
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return 'unknown'
}
