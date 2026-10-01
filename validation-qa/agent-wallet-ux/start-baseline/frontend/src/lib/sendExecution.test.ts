import assert from 'node:assert/strict'
import test from 'node:test'
import { TOKENS } from './wallet.ts'
import { SendSubmissionGuard, assertFreshSend, checkSendReceipt, encodeTransfer, feeInUsdcUnits, formatSendAmount, isWalletRejection, parseSendAmount, prepareSend, requestSend, safeMax, type SendProvider } from './sendExecution.ts'

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const hash = `0x${'a'.repeat(64)}`
const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const word = (x: string) => `0x${x.slice(2).toLowerCase().padStart(64, '0')}`
const symbolHex = (s: string) => `0x${'20'.padStart(64, '0')}${s.length.toString(16).padStart(64, '0')}${Array.from(s).map((x) => x.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0')}`

function fixture(options: { tokenBalance?: bigint; usdcBalance?: bigint; nativeBalance?: bigint; chain?: string; account?: string; code?: string; reject?: boolean; receipt?: any } = {}) {
  let sends = 0
  const p: SendProvider = { request: async ({ method, params = [] }) => {
    if (method === 'eth_accounts') return [options.account ?? account]
    if (method === 'eth_chainId') return options.chain ?? '0x4cef52'
    if (method === 'eth_getCode') return params[0] === recipient ? options.code ?? '0x' : '0x6000'
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data
      if (data === '0x313ce567') return '0x6'
      if (data === '0x95d89b41') return symbolHex((params[0] as { to: string }).to.toLowerCase() === TOKENS[1].address.toLowerCase() ? 'EURC' : 'USDC')
      if (data.startsWith('0x70a08231')) return `0x${((params[0] as { to: string }).to.toLowerCase() === TOKENS[1].address.toLowerCase() ? options.tokenBalance ?? 5_000_000n : options.usdcBalance ?? 10_000_000n).toString(16)}`
    }
    if (method === 'eth_getBalance') return `0x${(options.nativeBalance ?? 10_000_000_000_000_000_000n).toString(16)}`
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x4a817c800'
    if (method === 'eth_sendTransaction') { sends++; if (options.reject) throw Object.assign(new Error('User rejected'), { code: 4001 }); return hash }
    if (method === 'eth_getTransactionReceipt') return options.receipt ?? null
    throw new Error(method)
  } }
  return { p, sends: () => sends }
}

test('decimal-aware ERC-20 calldata and safe MAX reserve live fee', () => {
  assert.equal(parseSendAmount('1.234567', 6), 1_234_567n)
  assert.throws(() => parseSendAmount('1.2345678', 6))
  assert.throws(() => parseSendAmount('0', 6))
  assert.equal(formatSendAmount(123_456_789n, 8), '1.23456789')
  assert.equal(encodeTransfer(recipient, 1n), `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`)
  assert.equal(feeInUsdcUnits(1_000_000_000_001n), 2n)
  assert.equal(safeMax(10_000_000n, 10_000_000n, 1_000_000_000_000_000n, 'USDC'), 9_999_000n)
  assert.equal(safeMax(5_000_000n, 0n, 1n, 'EURC'), undefined)
})

test('live preparation blocks invalid, contract, account, network, token and fee states', async () => {
  const input = { account, recipient, symbol: 'EURC', amount: '1.25' }
  await assert.rejects(prepareSend(fixture().p, { ...input, recipient: 'bad' }))
  await assert.rejects(prepareSend(fixture({ code: '0x6000' }).p, input), /Contract recipient/)
  await assert.rejects(prepareSend(fixture({ account: recipient }).p, input), /account changed/)
  await assert.rejects(prepareSend(fixture({ chain: '0x1' }).p, input), /Wrong network/)
  await assert.rejects(prepareSend(fixture({ tokenBalance: 100n }).p, input), /Insufficient EURC/)
  await assert.rejects(prepareSend(fixture({ nativeBalance: 1n }).p, input), /Insufficient USDC/)
  await assert.rejects(prepareSend(fixture({ usdcBalance: 0n }).p, input), /Insufficient USDC/)
})

test('review binds account, chain, recipient, token, amount, request and expiry', async () => {
  const reviewed = await prepareSend(fixture().p, { account, recipient, symbol: 'EURC', amount: '1.25' }, 1000)
  const current = await prepareSend(fixture().p, { account, recipient, symbol: 'EURC', amount: '1.25' }, 1200)
  assert.doesNotThrow(() => assertFreshSend(reviewed, current, 1200))
  for (const field of [{ recipient: account }, { account: recipient }, { chainId: 1 }, { units: 2n }, { token: TOKENS[0] }, { request: { ...reviewed.request, data: '0x' } }]) assert.throws(() => assertFreshSend(reviewed, { ...current, ...field }, 1200))
  assert.throws(() => assertFreshSend(reviewed, current, 61_001))
})

test('wallet rejection is cancellation; submission returns a hash', async () => {
  const rejected = fixture({ reject: true })
  const prepared = await prepareSend(rejected.p, { account, recipient, symbol: 'USDC', amount: '1' })
  await assert.rejects(requestSend(rejected.p, prepared), (error) => isWalletRejection(error))
  const accepted = fixture()
  assert.equal(await requestSend(accepted.p, prepared), hash)
  assert.equal(accepted.sends(), 1)
})

test('duplicate submit guard permits one wallet request at a time', async () => {
  const guard = new SendSubmissionGuard()
  let release!: () => void
  const pending = guard.run(() => new Promise<string>((resolve) => { release = () => resolve(hash) }))
  await assert.rejects(guard.run(async () => hash), /already in progress/)
  release()
  assert.equal(await pending, hash)
  assert.equal(await guard.run(async () => hash), hash)
})

test('receipt requires success and matching transfer evidence; missing receipt remains pending', async () => {
  const prepared = await prepareSend(fixture().p, { account, recipient, symbol: 'USDC', amount: '1' })
  const base = { transactionHash: hash, blockHash: hash, blockNumber: '0x1', status: '0x1', logs: [{ address: TOKENS[0].address, topics: [topic, word(account), word(recipient)], data: '0xf4240' }] }
  assert.equal(await checkSendReceipt(fixture({ receipt: base }).p, hash, prepared), 'confirmed')
  assert.equal(await checkSendReceipt(fixture({ receipt: { ...base, status: '0x0' } }).p, hash, prepared), 'failed')
  assert.equal(await checkSendReceipt(fixture({ receipt: { ...base, logs: [] } }).p, hash, prepared), 'unknown')
  assert.equal(await checkSendReceipt(fixture().p, hash, prepared), 'pending')
})
