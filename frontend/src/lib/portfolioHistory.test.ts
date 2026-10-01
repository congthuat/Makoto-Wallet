import assert from 'node:assert/strict'
import test from 'node:test'
import { PORTFOLIO_ASSETS, valuePortfolio, type PortfolioAssetValue } from '../../../shared/portfolioValuation.mjs'
import { captureEligible, HISTORY_RANGES, historyAccessEnabled, historyDisplayState, historyPoints, historyQueryKey, historyScope, portfolioHistoryApi, type HistoryResponse, type HistorySnapshot } from './portfolioHistory.ts'
import { chartCoordinates, closestPointIndex } from './chartGeometry.ts'
import type { Prices, WalletApi } from './wallet.ts'

const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const otherAddress = '0x1111111111111111111111111111111111111111'
const chainId = 5042002
const now = Date.parse('2026-10-01T08:00:00.000Z')
const scope = { walletAddress: address, chainId }
const prices: Prices = Object.fromEntries(PORTFOLIO_ASSETS.map((asset, index) => [asset.priceKey, {
  price: [0.9998, 1.16, 63750][index], provider: 'CoinGecko', providerAssetId: asset.providerAssetId,
  source: asset.source, status: 'FRESH', observedAt: new Date(now - 10_000).toISOString(), history: [[1, 999999]],
}]))
const wallet: WalletApi = {
  address, chainId, observedAt: new Date(now).toISOString(), txCount: 0, activity: [],
  tokens: PORTFOLIO_ASSETS.map((asset, index) => ({ ...asset, name: asset.symbol, balance: [200.125, 80.875, 0.0004][index], verified: true })),
}
const valuation = valuePortfolio(wallet.tokens, prices)
const input = { scope, wallet, balanceFailed: false, complete: valuation.complete, totalUsd: valuation.totalUsd, assets: valuation.assets, now }
function snapshot(totalUsd = 368.24, capturedAt = new Date(now).toISOString(), walletAddress = address, selectedChain = chainId): HistorySnapshot {
  return { id: capturedAt, walletAddress, chainId: selectedChain, capturedAt, totalUsd, assets: valuation.assets, priceProvider: 'COINGECKO', priceStatus: 'FRESH', priceObservedAt: new Date(now - 10_000).toISOString(), balanceObservedAt: capturedAt }
}
function response(snapshots: HistorySnapshot[]): HistoryResponse {
  return { ...scope, range: '1d', snapshots, nextCaptureAt: null, totalSnapshots: snapshots.length }
}

test('history scopes a confirmed connected wallet by normalized address and known chain', () => {
  assert.deepEqual(historyScope({ mode: 'connected', address: address.toUpperCase().replace('0X', '0x'), chainId, accountConfirmed: true }), scope)
  assert.equal(historyScope({ mode: 'connected', address, chainId, accountConfirmed: false }), null)
  assert.equal(historyScope({ mode: 'connected', address: `0x${'0'.repeat(40)}`, chainId, accountConfirmed: true }), null)
})

test('history access requires both a valid scope and the current verified wallet session', () => {
  assert.equal(historyAccessEnabled(scope, true), true)
  assert.equal(historyAccessEnabled(scope, false), false)
  assert.equal(historyAccessEnabled(null, true), false)
  assert.equal(historyAccessEnabled(null, false), false)
})

test('demo, watch, disconnected and unknown-chain wallets cannot capture or expose history', () => {
  for (const mode of ['demo', 'watch', 'disconnected']) {
    const disconnected = historyScope({ mode, address, chainId, accountConfirmed: true })
    assert.equal(disconnected, null)
    assert.equal(captureEligible({ ...input, scope: disconnected }), false)
    assert.deepEqual(historyPoints(response([snapshot()]), disconnected), [])
  }
  for (const otherChain of [undefined, 1, 5042003]) assert.equal(historyScope({ mode: 'connected', address, chainId: otherChain, accountConfirmed: true }), null)
})

test('current CoinGecko total and history eligibility share the exact valuation rules', () => {
  const oldDisplayTotal = wallet.tokens.map((token) => {
    const meta = PORTFOLIO_ASSETS.find((asset) => asset.address === token.address)
    return token.balance * prices[meta!.priceKey]!.price!
  }).sort((a, b) => b - a).reduce((sum, value) => sum + value, 0)
  assert.equal(valuation.totalUsd, oldDisplayTotal)
  assert.equal(captureEligible(input), true)
})

test('incomplete, failed, missing or mismatched wallet observations cannot be recorded', () => {
  assert.equal(captureEligible({ ...input, complete: false }), false)
  assert.equal(captureEligible({ ...input, balanceFailed: true }), false)
  assert.equal(captureEligible({ ...input, wallet: undefined }), false)
  assert.equal(captureEligible({ ...input, wallet: { ...wallet, address: otherAddress } }), false)
  assert.equal(captureEligible({ ...input, wallet: { ...wallet, chainId: 1 } }), false)
})

test('a positive holding without a valid price never produces a complete snapshot', () => {
  const missing = valuePortfolio(wallet.tokens, { ...prices, EURC: undefined })
  assert.equal(missing.complete, false)
  assert.equal(missing.totalUsd, undefined)
  assert.equal(captureEligible({ ...input, ...missing, totalUsd: missing.totalUsd }), false)
})

test('STALE and UNAVAILABLE prices display separately but cannot be captured, including zeros', () => {
  for (const status of ['STALE', 'UNAVAILABLE'] as const) {
    const stale = valuePortfolio(wallet.tokens, { ...prices, EURC: { ...prices.EURC, status } })
    assert.equal(stale.complete, true)
    assert.equal(captureEligible({ ...input, assets: stale.assets }), false)
    const zeroTokens = wallet.tokens.map((token) => ({ ...token, balance: 0 }))
    const zero = valuePortfolio(zeroTokens, { ...prices, EURC: { ...prices.EURC, status } })
    assert.equal(captureEligible({ ...input, totalUsd: 0, assets: zero.assets }), false)
  }
})

test('non-finite totals, asset values and balances are rejected', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -1]) {
    assert.equal(captureEligible({ ...input, totalUsd: invalid }), false)
    assert.equal(captureEligible({ ...input, assets: [{ ...valuation.assets[0], balance: invalid }] }), false)
    assert.equal(captureEligible({ ...input, assets: [{ ...valuation.assets[0], usdValue: invalid }] }), false)
  }
})

test('old, missing and future observation timestamps cannot create new truth points', () => {
  assert.equal(captureEligible({ ...input, wallet: { ...wallet, observedAt: undefined } }), false)
  assert.equal(captureEligible({ ...input, wallet: { ...wallet, observedAt: new Date(now - 60_001).toISOString() } }), false)
  assert.equal(captureEligible({ ...input, wallet: { ...wallet, observedAt: new Date(now + 1001).toISOString() } }), false)
  const oldAssets: PortfolioAssetValue[] = valuation.assets.map((asset) => ({ ...asset, price: { ...asset.price, observedAt: new Date(now - 300_001).toISOString() } }))
  assert.equal(captureEligible({ ...input, assets: oldAssets }), false)
})

test('wallet switch immediately excludes another wallet dataset and uses another cache key', () => {
  const otherScope = { ...scope, walletAddress: otherAddress }
  assert.deepEqual(historyPoints(response([snapshot()]), otherScope), [])
  assert.notDeepEqual(historyQueryKey(scope, '1d'), historyQueryKey(otherScope, '1d'))
  assert.deepEqual(historyPoints(response([snapshot(), snapshot(1, new Date(now + 1000).toISOString(), otherAddress)]), scope), [[now / 1000, 368.24]])
})

test('chain switch never exposes Arc Testnet points as another chain', () => {
  const mainnetScope = { ...scope, chainId: 5042003 }
  assert.deepEqual(historyPoints(response([snapshot()]), mainnetScope), [])
  assert.notDeepEqual(historyQueryKey(scope, '1d'), historyQueryKey(mainnetScope, '1d'))
  assert.deepEqual(historyPoints(response([snapshot(1, new Date(now).toISOString(), address, 5042003)]), scope), [])
})

test('UTC snapshots are converted to real timestamps without invented historical points', () => {
  const one = historyPoints(response([snapshot()]), scope)
  assert.deepEqual(one, [[now / 1000, 368.24]])
  const two = historyPoints(response([snapshot(370, new Date(now + 300_000).toISOString()), snapshot()]), scope)
  assert.deepEqual(two, [[now / 1000, 368.24], [(now + 300_000) / 1000, 370]])
  assert.deepEqual(historyPoints(response([snapshot(Infinity), snapshot(2, 'invalid')]), scope), [])
})

test('zero, one and two points have truthful empty, starting and chart states', () => {
  assert.equal(historyDisplayState(0, false, false), 'empty')
  assert.equal(historyDisplayState(1, false, false), 'starting')
  assert.equal(historyDisplayState(2, false, false), 'chart')
  assert.equal(historyDisplayState(2, false, true), 'error')
  assert.equal(historyDisplayState(0, true, false), 'loading')
})

test('chart X coordinates and selection use elapsed capture time rather than array indexes', () => {
  const points: [number, number][] = [[0, 100], [300, 120], [7200, 110]]
  const coordinates = chartCoordinates(points, 800, 170)
  assert.equal(coordinates[0][0], 0)
  assert.ok(Math.abs(coordinates[1][0] - 800 * 300 / 7200) < 1e-10)
  assert.equal(coordinates[2][0], 800)
  assert.equal(closestPointIndex(points, 0.1), 1)
  assert.equal(closestPointIndex(points, 0.9), 2)
  assert.deepEqual(chartCoordinates([[10, 5], [20, 5]], 800, 80), [[0, 40], [800, 40]])
})

test('all five history ranges query backend persistence with scoped no-store requests', async () => {
  const original = globalThis.fetch
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(response([])), { status: 200 })
  }
  try {
    for (const range of HISTORY_RANGES) await portfolioHistoryApi.history(scope, range)
    assert.equal(calls.length, 5)
    calls.forEach(({ url, init }, index) => {
      assert.equal(new URL(url, 'http://localhost').searchParams.get('range'), HISTORY_RANGES[index])
      assert.equal(new URL(url, 'http://localhost').searchParams.get('walletAddress'), address)
      assert.equal(new URL(url, 'http://localhost').searchParams.get('chainId'), String(chainId))
      assert.equal(init?.credentials, 'same-origin')
      assert.equal(init?.cache, 'no-store')
      assert.equal((init?.headers as Record<string, string>)['X-Makoto-Request'], '1')
      assert.equal(init?.body, undefined)
    })
  } finally { globalThis.fetch = original }
})

test('snapshot submission contains only wallet and chain; backend owns the total and time', async () => {
  const original = globalThis.fetch
  let posted: unknown
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'SAVED', snapshot: snapshot(), nextCaptureAt: new Date(now + 300_000).toISOString() }), { status: 200 })
  }
  try {
    const saved = await portfolioHistoryApi.snapshot(scope)
    assert.deepEqual(posted, scope)
    assert.equal(saved.snapshot?.totalUsd, 368.24)
    assert.equal(saved.snapshot?.capturedAt, new Date(now).toISOString())
  } finally { globalThis.fetch = original }
})

test('backend failures remain explicit instead of fabricating empty successful history', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'PORTFOLIO_ACCESS_DENIED' }), { status: 403 })
  try { await assert.rejects(portfolioHistoryApi.history(scope, 'all'), /PORTFOLIO_ACCESS_DENIED/) }
  finally { globalThis.fetch = original }
})

test('real chart component renders only after two real points and masks accessible totals', async () => {
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, resolve: { dedupe: ['react', 'react-dom'] } })
  try {
    const { AreaChart } = await server.ssrLoadModule('/src/components/wallet/charts.tsx')
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const zero = renderToStaticMarkup(createElement(AreaChart, { points: [] }))
    const one = renderToStaticMarkup(createElement(AreaChart, { points: [[now / 1000, 368.24]] }))
    const two = renderToStaticMarkup(createElement(AreaChart, { points: [[now / 1000, 368.24], [(now + 300_000) / 1000, 370]], mask: () => 'HIDDEN' }))
    assert.doesNotMatch(zero, /<svg/)
    assert.doesNotMatch(one, /<svg/)
    assert.match(two, /<svg/)
    assert.match(two, /role="slider"/)
    assert.match(two, /aria-valuetext="[^"]*HIDDEN/)
    assert.doesNotMatch(two, /\$368\.24|\$370\.00/)
  } finally { await server.close() }
})
