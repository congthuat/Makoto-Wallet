const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const express = require('express')
const { PortfolioHistory, CHAIN_ID, CAPTURE_INTERVAL_MS, RETENTION_MS, MAX_DISPLAY_POINTS, selectDisplayRows } = require('../lib/portfolioHistory')
const { createPortfolioRouter } = require('../routes/portfolio')

const A = `0x${'a'.repeat(40)}`
const B = `0x${'b'.repeat(40)}`
const OWNER = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const BASE = Date.parse('2026-10-01T12:00:00.000Z')
const DAY = 86_400_000
const assets = [
  { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6, rawDecimals: 18, rawBalance: '368240000000000000000', balance: 368.24, verified: true },
  { symbol: 'EURC', address: '0x89b50855aa3be2f677cd6303cec089b5f319d72a', decimals: 6, rawDecimals: 6, rawBalance: '0', balance: 0, verified: true },
  { symbol: 'cirBTC', address: '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf', decimals: 8, rawDecimals: 8, rawBalance: '0', balance: 0, verified: true },
]
function fixture(options = {}) {
  let clock = options.clock ?? BASE
  let walletChange = (wallet) => wallet
  let priceChange = (prices) => prices
  let walletCalls = 0
  const history = new PortfolioHistory({
    dbPath: options.dbPath || ':memory:', now: () => clock,
    readWallet: async (address) => {
      walletCalls++
      return walletChange({ address, chainId: CHAIN_ID, observedAt: new Date(clock).toISOString(), tokens: structuredClone(assets), activity: [], txCount: 0 })
    },
    getPrices: async () => priceChange(Object.fromEntries([
      ['USDC', 'usd-coin', 'DIRECT_USDC', 1], ['EURC', 'euro-coin', 'DIRECT_EURC', 1.15], ['BTC', 'circle-wrapped-btc', 'DIRECT_CIRBTC', 60_000],
    ].map(([key, id, source, price]) => [key, { price, provider: 'CoinGecko', providerAssetId: id, source, status: 'FRESH', observedAt: new Date(clock).toISOString(), providerUpdatedAt: new Date(clock - 10_000).toISOString(), history: [] }]))),
  })
  return { history, setTime: (value) => { clock = value }, wallet: (change) => { walletChange = change }, prices: (change) => { priceChange = change }, walletCalls: () => walletCalls }
}

test('first complete fresh real observation is saved with unrounded total and recomputable evidence', async () => {
  const { history } = fixture()
  try {
    const result = await history.capture(OWNER, A.toUpperCase().replace('0X', '0x'), CHAIN_ID)
    assert.equal(result.status, 'SAVED')
    assert.equal(result.snapshot.walletAddress, A)
    assert.equal(result.snapshot.totalUsd, 368.24)
    assert.equal(result.snapshot.priceProvider, 'COINGECKO')
    assert.equal(result.snapshot.priceStatus, 'FRESH')
    assert.equal(result.snapshot.assets.length, 3)
    assert.equal(result.snapshot.assets.reduce((sum, asset) => sum + asset.usdValue, 0), result.snapshot.totalUsd)
    for (const asset of result.snapshot.assets) {
      assert.equal(asset.usdValue, asset.balance * asset.usdPrice)
      assert.equal(asset.price.provider, 'CoinGecko')
      assert.equal(typeof asset.rawBalance, 'string')
    }
    assert.equal(history.history(OWNER, A, CHAIN_ID, 'all').snapshots.length, 1)
  } finally { history.close() }
})

for (const [name, alter] of [
  ['partial balances', (wallet) => ({ ...wallet, tokens: wallet.tokens.slice(0, 2) })],
  ['unknown verified holding', (wallet) => ({ ...wallet, tokens: [...wallet.tokens, { symbol: 'BAD', address: B, decimals: 18, balance: 1, verified: true }] })],
  ['nonfinite balance', (wallet) => ({ ...wallet, tokens: wallet.tokens.map((token, i) => i ? token : { ...token, balance: Infinity }) })],
  ['NaN balance', (wallet) => ({ ...wallet, tokens: wallet.tokens.map((token, i) => i ? token : { ...token, balance: NaN }) })],
  ['negative balance', (wallet) => ({ ...wallet, tokens: wallet.tokens.map((token, i) => i ? token : { ...token, balance: -1 }) })],
  ['duplicate verified token', (wallet) => ({ ...wallet, tokens: [...wallet.tokens, wallet.tokens[0]] })],
  ['wrong decimals', (wallet) => ({ ...wallet, tokens: wallet.tokens.map((token, i) => i ? token : { ...token, decimals: 18 }) })],
  ['raw balance mismatch', (wallet) => ({ ...wallet, tokens: wallet.tokens.map((token, i) => i ? token : { ...token, rawBalance: '1' }) })],
  ['wrong wallet response', (wallet) => ({ ...wallet, address: B })],
  ['wrong observed chain', (wallet) => ({ ...wallet, chainId: 1 })],
  ['stale balance read', (wallet) => ({ ...wallet, observedAt: new Date(BASE - 31_000).toISOString() })],
  ['localized timestamp', (wallet) => ({ ...wallet, observedAt: '2026-10-01 19:00:00' })],
]) {
  test(`${name} never creates a snapshot`, async () => {
    const f = fixture()
    f.wallet(alter)
    try { assert.equal((await f.history.capture(OWNER, A, CHAIN_ID)).status, 'SKIPPED'); assert.equal(f.history.history(OWNER, A, CHAIN_ID, 'all').totalSnapshots, 0) }
    finally { f.history.close() }
  })
}

for (const [name, change] of [
  ['missing positive holding price', (prices) => ({ ...prices, USDC: undefined })],
  ['unavailable positive price', (prices) => ({ ...prices, USDC: { ...prices.USDC, status: 'UNAVAILABLE' } })],
  ['stale last-known-good prices', (prices) => ({ ...prices, USDC: { ...prices.USDC, status: 'STALE' } })],
  ['zero price', (prices) => ({ ...prices, USDC: { ...prices.USDC, price: 0 } })],
  ['Infinity price', (prices) => ({ ...prices, USDC: { ...prices.USDC, price: Infinity } })],
  ['NaN price', (prices) => ({ ...prices, USDC: { ...prices.USDC, price: NaN } })],
  ['expired fresh flag', (prices) => ({ ...prices, USDC: { ...prices.USDC, observedAt: new Date(BASE - CAPTURE_INTERVAL_MS - 1).toISOString() } })],
  ['wrong provider asset', (prices) => ({ ...prices, BTC: { ...prices.BTC, providerAssetId: 'bitcoin' } })],
  ['wrong provider', (prices) => ({ ...prices, USDC: { ...prices.USDC, provider: 'Surf' } })],
  ['unavailable zero holding price', (prices) => ({ ...prices, EURC: { ...prices.EURC, status: 'UNAVAILABLE' } })],
]) {
  test(`${name} never creates a historical truth point`, async () => {
    const f = fixture()
    f.prices(change)
    try { assert.equal((await f.history.capture(OWNER, A, CHAIN_ID)).status, 'SKIPPED'); assert.equal(f.history.history(OWNER, A, CHAIN_ID, 'all').totalSnapshots, 0) }
    finally { f.history.close() }
  })
}

test('disconnected/missing wallet and unknown chain are rejected', async () => {
  const f = fixture()
  try {
    await assert.rejects(f.history.capture(OWNER, '', CHAIN_ID), { code: 'PORTFOLIO_INVALID_WALLET' })
    await assert.rejects(f.history.capture(OWNER, A, undefined), { code: 'PORTFOLIO_INVALID_CHAIN' })
    await assert.rejects(f.history.capture(OWNER, A, 1), { code: 'PORTFOLIO_UNSUPPORTED_CHAIN' })
    assert.equal(f.walletCalls(), 0)
  } finally { f.history.close() }
})

test('failed balance provider never saves a cached successful wallet observation', async () => {
  const f = fixture()
  try {
    await f.history.capture(OWNER, A, CHAIN_ID)
    f.setTime(BASE + CAPTURE_INTERVAL_MS)
    f.wallet(() => { throw new Error('provider failed') })
    await assert.rejects(f.history.capture(OWNER, A, CHAIN_ID), { code: 'PORTFOLIO_DATA_UNAVAILABLE' })
    assert.equal(f.history.history(OWNER, A, CHAIN_ID, 'all').snapshots.length, 1)
  } finally { f.history.close() }
})

test('duplicate and changed balances within five minutes are throttled without provider reads', async () => {
  const f = fixture()
  try {
    const first = await f.history.capture(OWNER, A, CHAIN_ID)
    f.setTime(BASE + 299_999)
    f.wallet((wallet) => ({ ...wallet, tokens: wallet.tokens.map((token, i) => i ? token : { ...token, balance: 100, rawBalance: '100000000000000000000' }) }))
    const second = await f.history.capture(OWNER, A, CHAIN_ID)
    assert.equal(second.status, 'THROTTLED')
    assert.equal(second.snapshot.id, first.snapshot.id)
    assert.equal(second.nextCaptureAt, new Date(BASE + CAPTURE_INTERVAL_MS).toISOString())
    assert.equal(f.walletCalls(), 1)
    assert.equal(f.history.history(OWNER, A, CHAIN_ID, 'all').snapshots.length, 1)
  } finally { f.history.close() }
})

test('an identical total after the exact interval is a second real time point', async () => {
  const f = fixture()
  try {
    await f.history.capture(OWNER, A, CHAIN_ID)
    f.setTime(BASE + CAPTURE_INTERVAL_MS)
    assert.equal((await f.history.capture(OWNER, A, CHAIN_ID)).status, 'SAVED')
    const points = f.history.history(OWNER, A, CHAIN_ID, 'all').snapshots
    assert.equal(points.length, 2)
    assert.notEqual(points[0].capturedAt, points[1].capturedAt)
    assert.equal(points[0].totalUsd, points[1].totalUsd)
  } finally { f.history.close() }
})

test('simultaneous captures share the authoritative read and save one point', async () => {
  const f = fixture()
  try {
    const results = await Promise.all([f.history.capture(OWNER, A, CHAIN_ID), f.history.capture(OWNER, A, CHAIN_ID)])
    assert.equal(results[0].snapshot.id, results[1].snapshot.id)
    assert.equal(f.walletCalls(), 1)
    assert.equal(f.history.history(OWNER, A, CHAIN_ID, 'all').totalSnapshots, 1)
  } finally { f.history.close() }
})

test('two services sharing SQLite atomically enforce capture cadence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'makoto-portfolio-race-'))
  const dbPath = path.join(directory, 'history.sqlite')
  const first = fixture({ dbPath }), second = fixture({ dbPath })
  try {
    const results = await Promise.all([first.history.capture(OWNER, A, CHAIN_ID), second.history.capture(OWNER, A, CHAIN_ID)])
    assert.equal(results.filter((result) => result.status === 'SAVED').length, 1)
    assert.equal(results.filter((result) => result.status === 'THROTTLED').length, 1)
    assert.equal(first.history.history(OWNER, A, CHAIN_ID, 'all').totalSnapshots, 1)
  } finally {
    first.history.close(); second.history.close()
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('makoto-portfolio-race-')) throw new Error('Unexpected fixture directory')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})

test('wallet, chain, and browser-owner history are isolated', async () => {
  const f = fixture()
  try {
    await f.history.capture(OWNER, A, CHAIN_ID)
    assert.equal(f.history.history(OWNER, B, CHAIN_ID, 'all').snapshots.length, 0)
    assert.equal(f.history.history(OWNER, A, 5042003, 'all').snapshots.length, 0)
    assert.equal(f.history.history(OTHER, A, CHAIN_ID, 'all').snapshots.length, 0)
    await f.history.capture(OWNER, B, CHAIN_ID)
    await f.history.capture(OTHER, A, CHAIN_ID)
    assert.equal(f.history.history(OWNER, A, CHAIN_ID, 'all').snapshots.length, 1)
    assert.equal(f.history.history(OWNER, B, CHAIN_ID, 'all').snapshots.length, 1)
    assert.equal(f.history.history(OTHER, A, CHAIN_ID, 'all').snapshots.length, 1)
  } finally { f.history.close() }
})

test('zero snapshots and one snapshot remain exact, with no copied backfill', async () => {
  const f = fixture()
  try {
    assert.deepEqual(f.history.history(OWNER, A, CHAIN_ID, '1d').snapshots, [])
    const saved = await f.history.capture(OWNER, A, CHAIN_ID)
    const result = f.history.history(OWNER, A, CHAIN_ID, '1d')
    assert.equal(result.snapshots.length, 1)
    assert.deepEqual(result.snapshots[0], saved.snapshot)
    assert.equal(result.snapshots[0].capturedAt, '2026-10-01T12:00:00.000Z')
  } finally { f.history.close() }
})

for (const [range, expected] of [['1d', 1], ['1w', 2], ['1m', 3], ['1y', 4], ['all', 5]]) {
  test(`${range} returns only actual captures in its UTC rolling range`, async () => {
    const f = fixture({ clock: BASE - 366 * DAY })
    try {
      for (const age of [366, 200, 20, 5, 0]) { f.setTime(BASE - age * DAY); await f.history.capture(OWNER, A, CHAIN_ID) }
      const response = f.history.history(OWNER, A, CHAIN_ID, range)
      assert.equal(response.snapshots.length, expected)
      assert.equal(response.totalSnapshots, 5)
      assert.equal(response.rangeSnapshots, expected)
      assert.equal(response.downsampled, false)
      for (const point of response.snapshots) assert.equal(new Date(point.capturedAt).toISOString(), point.capturedAt)
    } finally { f.history.close() }
  })
}

test('raw retention deletes data beyond366days across inactive browser datasets', async () => {
  const f = fixture({ clock: BASE - RETENTION_MS })
  try {
    await f.history.capture(OTHER, B, CHAIN_ID)
    f.setTime(BASE + 1)
    assert.equal(f.history.history(OWNER, A, CHAIN_ID, 'all').totalSnapshots, 0)
    assert.equal(f.history.db.prepare('SELECT COUNT(*) AS n FROM portfolio_history').get().n, 0)
  } finally { f.history.close() }
})

test('display sampling keeps only exact real rows, first/last and bucket extremes', () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index), captured_at_ms: index, total_usd: index === 3 ? 1_000_000 : index === 4 ? -100 : 10 }))
  const selected = selectDisplayRows(rows)
  assert.ok(selected.length <= MAX_DISPLAY_POINTS)
  assert.equal(selected[0], rows[0])
  assert.equal(selected.at(-1), rows.at(-1))
  assert.ok(selected.includes(rows[3]))
  assert.ok(selected.includes(rows[4]))
  assert.ok(selected.every((row) => rows.includes(row)))
})

test('capture response portfolio matches the shared canonical Home valuation exactly', async () => {
  const f = fixture()
  f.wallet((wallet) => ({ ...wallet, tokens: wallet.tokens.map((token, i) => i === 1 ? { ...token, balance: 1.123456, rawBalance: '1123456' } : i === 2 ? { ...token, balance: 0.00001234, rawBalance: '1234' } : token) }))
  try {
    const result = await f.history.capture(OWNER, A, CHAIN_ID)
    const { valuePortfolio } = await import('../../shared/portfolioValuation.mjs')
    assert.equal(valuePortfolio(result.wallet.tokens, result.prices).totalUsd, result.snapshot.totalUsd)
  } finally { f.history.close() }
})

test('capture timestamp is UTC time after provider reads finish', async () => {
  const f = fixture()
  f.wallet((wallet) => { f.setTime(BASE + 1000); return wallet })
  try {
    const result = await f.history.capture(OWNER, A, CHAIN_ID)
    assert.equal(result.snapshot.balanceObservedAt, '2026-10-01T12:00:00.000Z')
    assert.equal(result.snapshot.capturedAt, '2026-10-01T12:00:01.000Z')
  } finally { f.history.close() }
})

test('same Arc reader used by current balances preserves raw native and verified token evidence', async () => {
  const originalFetch = globalThis.fetch
  const { readWallet } = require('../routes/arc')
  globalThis.fetch = async (url) => {
    const value = String(url)
    const payload = value.endsWith('/token-balances') ? [
      { value: '1123456', token: { type: 'ERC-20', address_hash: assets[1].address, decimals: '6', symbol: 'EURC', name: 'Euro Coin' } },
      { value: '1234', token: { type: 'ERC-20', address_hash: assets[2].address, decimals: '8', symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin' } },
    ] : value.endsWith('/token-transfers') ? { items: [] } : { coin_balance: assets[0].rawBalance, transactions_count: '1' }
    return new Response(JSON.stringify(payload), { status: 200 })
  }
  try {
    const wallet = await readWallet(A)
    assert.equal(wallet.chainId, CHAIN_ID)
    assert.equal(new Date(wallet.observedAt).toISOString(), wallet.observedAt)
    assert.equal(wallet.tokens[0].balance, 368.24)
    assert.equal(wallet.tokens[0].rawDecimals, 18)
    assert.equal(wallet.tokens[1].balance, 1.123456)
    assert.equal(wallet.tokens[1].rawBalance, '1123456')
    assert.equal(wallet.tokens[2].balance, 0.00001234)
    assert.equal(wallet.tokens[2].rawBalance, '1234')
  } finally { globalThis.fetch = originalFetch }
})

test('SQLite captures survive close/reopen backend restart without fixtures in runtime database', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'makoto-portfolio-history-'))
  const dbPath = path.join(directory, 'history.sqlite')
  const first = fixture({ dbPath })
  try {
    const saved = await first.history.capture(OWNER, A, CHAIN_ID)
    first.history.close()
    const second = fixture({ dbPath })
    try { assert.deepEqual(second.history.history(OWNER, A, CHAIN_ID, 'all').snapshots, [saved.snapshot]); assert.equal((await second.history.capture(OWNER, A, CHAIN_ID)).status, 'THROTTLED') }
    finally { second.history.close() }
  } finally {
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('makoto-portfolio-history-')) throw new Error('Unexpected fixture directory')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})

async function harness(fixtureHistory, options = {}) {
  const app = express()
  app.use(express.json())
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)) })
  const url = `http://127.0.0.1:${server.address().port}`
  const origin = options.origin || url
  // Ownership middleware fixtures are isolated here; real SIWE is covered by the existing auth suite.
  const auth = { publicOrigin: origin, taskSession: (req, _res, next) => { if (req.get('X-Fixture-Session')) req.session = { address: req.get('X-Fixture-Session'), chainId: CHAIN_ID }; next() } }
  app.use('/api/portfolio', createPortfolioRouter(fixtureHistory, auth, { publicOrigin: origin, production: options.production || false }))
  async function request(pathname, { method = 'GET', cookie, body, requestOrigin = origin, customHeader = '1', session, referer = `${origin}/` } = {}) {
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (customHeader !== null) headers['X-Makoto-Request'] = customHeader
    if (requestOrigin !== null) headers.origin = requestOrigin
    if (referer !== null) headers.referer = referer
    if (session) headers['X-Fixture-Session'] = session
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(`${url}/api/portfolio/${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const setCookie = response.headers.get('set-cookie')
    return { status: response.status, data: await response.json(), cookie: setCookie?.split(';')[0], setCookie, cacheControl: response.headers.get('cache-control') }
  }
  return { request, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}
const query = (address = A, chain = CHAIN_ID, range = 'all') => `history?walletAddress=${address}&chainId=${chain}&range=${range}`

test('local browser capability is opaque HttpOnly strict and isolates arbitrary-wallet histories', async () => {
  const f = fixture()
  const h = await harness(f.history)
  try {
    const a = await h.request(query())
    const b = await h.request(query())
    assert.notEqual(a.cookie, b.cookie)
    assert.match(a.setCookie, /HttpOnly/)
    assert.match(a.setCookie, /SameSite=Strict/)
    assert.equal(a.cacheControl, 'no-store')
    assert.equal((await h.request('snapshot', { method: 'POST', cookie: a.cookie, body: { walletAddress: A, chainId: CHAIN_ID } })).data.status, 'SAVED')
    assert.equal((await h.request(query(), { cookie: a.cookie })).data.snapshots.length, 1)
    assert.equal((await h.request(query(), { cookie: b.cookie })).data.snapshots.length, 0)
    assert.equal((await h.request(query(B), { cookie: a.cookie })).data.snapshots.length, 0)
    assert.equal((await h.request(query(A, 5042003), { cookie: a.cookie })).data.snapshots.length, 0)
    // Task login/logout does not change the local history identity.
    assert.equal((await h.request(query(), { cookie: a.cookie, session: B })).data.snapshots.length, 1)
    assert.equal((await h.request(query(), { cookie: a.cookie })).data.snapshots.length, 1)
  } finally { await h.close(); f.history.close() }
})

test('missing/foreign origin and custom header fail closed; same-origin Referer supports browser GET', async () => {
  const f = fixture(), h = await harness(f.history)
  try {
    assert.equal((await h.request(query(), { requestOrigin: 'http://evil.example' })).status, 403)
    assert.equal((await h.request(query(), { customHeader: null })).status, 403)
    assert.equal((await h.request(query(), { requestOrigin: null, referer: null })).status, 403)
    assert.equal((await h.request(query(), { requestOrigin: null })).status, 200)
    assert.equal((await h.request('snapshot', { method: 'POST', requestOrigin: null, body: { walletAddress: A, chainId: CHAIN_ID } })).status, 403)
  } finally { await h.close(); f.history.close() }
})

test('public/production access needs an existing verified wallet session and matching address', async () => {
  const f = fixture(), h = await harness(f.history, { origin: 'https://makoto.example', production: true })
  try {
    assert.equal((await h.request(query())).status, 401)
    assert.equal((await h.request(query(B), { session: A })).status, 403)
    const capture = await h.request('snapshot', { method: 'POST', session: A, body: { walletAddress: A, chainId: CHAIN_ID } })
    assert.equal(capture.data.status, 'SAVED')
    assert.equal(capture.cookie, undefined)
    assert.equal((await h.request(query(), { session: A })).data.snapshots.length, 1)
    assert.equal((await h.request(query(B), { session: B })).data.snapshots.length, 0)
  } finally { await h.close(); f.history.close() }
})

test('forged total, assets, prices, timestamps and invalid scopes never reach the authoritative writer', async () => {
  const f = fixture(), h = await harness(f.history)
  try {
    for (const forged of [{ totalUsd: 1 }, { assets: [] }, { prices: {} }, { capturedAt: '2000-01-01T00:00:00.000Z' }, { ownerAddress: B }]) {
      assert.equal((await h.request('snapshot', { method: 'POST', body: { walletAddress: A, chainId: CHAIN_ID, ...forged } })).status, 400)
    }
    for (const body of [{}, { walletAddress: '', chainId: CHAIN_ID }, { walletAddress: A, chainId: 1 }, { walletAddress: A, chainId: '5042002' }]) assert.equal((await h.request('snapshot', { method: 'POST', body })).status, 400)
    assert.equal((await h.request(query(A, CHAIN_ID, 'fake'))).status, 400)
    assert.equal(f.walletCalls(), 0)
  } finally { await h.close(); f.history.close() }
})
