import assert from 'node:assert/strict'
import test from 'node:test'
import { analyticsAge, analyticsFeed, analyticsHolders, analyticsNetwork, analyticsStats, analyticsTransfers, analyticsTransferKind } from './analyticsPresentation.ts'

const NOW = Date.parse('2026-10-01T08:00:00.000Z')
const ACCOUNT = `0x${'1'.repeat(40)}`
const OTHER = `0x${'2'.repeat(40)}`
const network = { chainId: 5042002, blockNumber: 64937824, updatedAt: NOW - 12000, tokenTransferFeeUsdc: 0.0013975, rpcLatencyMs: 336 }
const transfer = {
  hash: `0x${'a'.repeat(64)}`, logIndex: 3, block: 64937801, timestamp: '2026-10-01T07:59:00.000Z',
  from: ACCOUNT, to: OTHER, fromName: 'ArcSwap', toName: null, fromContract: true, toContract: false,
  symbol: 'USDC', amount: 152.6, method: 'transfer',
}

test('fresh Arc RPC observation retains exact block, estimate, latency and observation time', () => {
  assert.deepEqual(analyticsNetwork(network, false, NOW), { blockNumber: network.blockNumber, updatedAt: network.updatedAt, fee: network.tokenTransferFeeUsdc, latency: 336 })
})

test('RPC errors, other chains, stale timestamps and invalid blocks cannot look live', () => {
  assert.equal(analyticsNetwork(network, true, NOW), null)
  for (const patch of [{ chainId: 1 }, { updatedAt: NOW - 61000 }, { updatedAt: NOW + 6000 }, { updatedAt: 0 }, { blockNumber: 0 }, { blockNumber: NaN }]) {
    assert.equal(analyticsNetwork({ ...network, ...patch }, false, NOW), null)
  }
  assert.equal(analyticsNetwork(null, false, NOW), null)
})

test('unsupported zero fee or latency is omitted without discarding the valid RPC block', () => {
  assert.deepEqual(analyticsNetwork({ ...network, tokenTransferFeeUsdc: 0, rpcLatencyMs: NaN }, false, NOW), { blockNumber: network.blockNumber, updatedAt: network.updatedAt })
})

test('positive explorer counts and utilization retain their source values', () => {
  assert.deepEqual(analyticsStats({ transactionsToday: 1108332, totalAddresses: 55175776, utilization: 4.775, totalTransactions: 764522290 }, false), { transactionsToday: 1108332, totalAddresses: 55175776, utilization: 4.775 })
})

test('ambiguous zero defaults, malformed counters and out of range utilization are omitted', () => {
  for (const value of [null, {}, { transactionsToday: 0, totalAddresses: 0, utilization: 0 }, { transactionsToday: -1, totalAddresses: '42', utilization: 101 }, { transactionsToday: NaN, totalAddresses: 1.5, utilization: Infinity }]) {
    assert.deepEqual(analyticsStats(value, false), {})
  }
  assert.deepEqual(analyticsStats({ transactionsToday: 42, totalAddresses: 87, utilization: 100 }, true), {})
  assert.deepEqual(analyticsStats({ utilization: 100 }, false), { utilization: 100 })
})

test('transfer evidence preserves real hash, timestamp, amount, asset and proper names without mutation', () => {
  const original = structuredClone(transfer)
  assert.deepEqual(analyticsTransfers([transfer]), [transfer])
  assert.deepEqual(transfer, original)
})

test('invalid transfer evidence is hidden and never receives a synthetic fallback', () => {
  for (const patch of [{ hash: 'missing' }, { logIndex: -1 }, { block: 0 }, { timestamp: '0' }, { timestamp: 'bad' }, { amount: 0 }, { amount: NaN }, { symbol: 'BTC' }, { symbol: { toString: () => 'USDC' } }, { from: 'bad' }, { from: null, to: null }, { fromContract: undefined }]) {
    assert.deepEqual(analyticsTransfers([{ ...transfer, ...patch }]), [])
  }
  assert.deepEqual(analyticsTransfers(null), [])
})

test('hash and log index deduplicate evidence while separate real events remain visible', () => {
  const next = { ...transfer, logIndex: 4, symbol: 'EURC', amount: 0.903225 }
  assert.deepEqual(analyticsTransfers([transfer, { ...transfer, hash: transfer.hash.toUpperCase() }, next]), [transfer, next])
})

test('feed preserves bounded ranking including transfers below 1000 without claiming mixed units as USD', () => {
  const value = { live: [transfer], whales: [transfer], sampled: 200, sampledVolume: 3708.09, updatedAt: NOW }
  const output = analyticsFeed(value, false)
  assert.deepEqual(output, { live: [transfer], whales: [transfer] })
  assert.deepEqual(Object.keys(output).sort(), ['live', 'whales'])
  assert.deepEqual(analyticsFeed(value, true), { live: [], whales: [] })
})

test('transfer kind follows contract evidence while named protocols remain proper names', () => {
  assert.equal(analyticsTransferKind(transfer), 'Contract transfer')
  assert.equal(analyticsTransferKind({ fromContract: false, toContract: false }), 'Transfer')
  assert.equal(analyticsTransferKind({ fromContract: false, toContract: true }), 'Contract transfer')
})

test('holding address balances omit denominator and ownership claims', () => {
  const holder = { address: ACCOUNT, name: 'ArcSwap', contract: true, balance: 247176458004.9963, share: 78.108 }
  const original = structuredClone(holder)
  const output = analyticsHolders({ holdersCount: 4971250, totalSupply: 316454545629.24335, items: [holder] }, false)
  assert.deepEqual(output, { holdersCount: 4971250, items: [{ address: ACCOUNT, name: 'ArcSwap', contract: true, balance: holder.balance }] })
  assert.deepEqual(holder, original)
  assert.ok(!JSON.stringify(output).includes('totalSupply'))
  assert.ok(!JSON.stringify(output).includes('share'))
})

test('unavailable, malformed or zero holder balances leave no empty holder card data', () => {
  const holder = { address: ACCOUNT, name: null, contract: false, balance: 100 }
  assert.equal(analyticsHolders({ items: [holder] }, true), null)
  for (const patch of [{ address: 'bad' }, { balance: 0 }, { balance: Infinity }, { contract: undefined }]) {
    assert.equal(analyticsHolders({ items: [{ ...holder, ...patch }] }, false), null)
  }
  assert.equal(analyticsHolders({ items: [] }, false), null)
  assert.deepEqual(analyticsHolders({ holdersCount: 0, items: [holder, holder] }, false), { items: [holder] })
})

test('actual timestamps format relative observation age in Vietnamese and English', () => {
  assert.equal(analyticsAge(NOW - 60000, 'en', NOW), '1 minute ago')
  assert.equal(analyticsAge('2026-10-01T07:59:00.000Z', 'vi', NOW), '1 phút trước')
  assert.equal(analyticsAge(NOW - 3600000, 'en', NOW), '1 hour ago')
})

test('missing or future observation timestamps never fabricate a current update label', () => {
  assert.equal(analyticsAge('bad', 'en', NOW), null)
  assert.equal(analyticsAge(NOW + 6000, 'vi', NOW), null)
})
