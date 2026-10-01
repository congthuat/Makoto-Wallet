const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const router = require('../routes/prices')

const originalFetch = globalThis.fetch
const originalNow = Date.now
const originalKey = process.env.COINGECKO_API_KEY
const originalMode = process.env.COINGECKO_API_MODE

async function withServer(handler) {
  const app = express()
  app.use('/api/prices', router)
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  try { return await handler(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise((resolve) => server.close(resolve)) }
}

function payload(overrides = {}) {
  return {
    'usd-coin': { usd: 1, usd_24h_change: 0.02, last_updated_at: 1_700_000_000 },
    'euro-coin': { usd: 1.08, usd_24h_change: -0.4, last_updated_at: 1_700_000_001 },
    'circle-wrapped-btc': { usd: 42_000, usd_24h_change: 1.5, last_updated_at: 1_700_000_002 },
    ...overrides,
  }
}

function response(body, status = 200) {
  return new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function setConfig(mode = 'demo') {
  process.env.COINGECKO_API_KEY = 'test-key'
  process.env.COINGECKO_API_MODE = mode
}

test.after(() => {
  globalThis.fetch = originalFetch
  Date.now = originalNow
  if (originalKey === undefined) delete process.env.COINGECKO_API_KEY
  else process.env.COINGECKO_API_KEY = originalKey
  if (originalMode === undefined) delete process.env.COINGECKO_API_MODE
  else process.env.COINGECKO_API_MODE = originalMode
})

test('uses one official combined request and normalizes direct USDC, EURC and cirBTC prices', async () => {
  router.resetForTests()
  setConfig('demo')
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return response(payload())
  }
  await withServer(async (base) => {
    const result = await (await originalFetch(`${base}/api/prices`)).json()
    assert.equal(calls.length, 1)
    const requestUrl = new URL(calls[0].url)
    assert.equal(requestUrl.origin, 'https://api.coingecko.com')
    assert.equal(requestUrl.pathname, '/api/v3/simple/price')
    assert.equal(requestUrl.searchParams.get('ids'), 'usd-coin,euro-coin,circle-wrapped-btc')
    assert.equal(requestUrl.searchParams.get('vs_currencies'), 'usd')
    assert.equal(requestUrl.searchParams.get('include_last_updated_at'), 'true')
    assert.equal(requestUrl.searchParams.get('include_24hr_change'), 'true')
    assert.equal(requestUrl.searchParams.has('x_cg_demo_api_key'), false)
    assert.equal(calls[0].init.headers['x-cg-demo-api-key'], 'test-key')
    assert.equal(result.USDC.price, 1)
    assert.equal(result.USDC.source, 'DIRECT_USDC')
    assert.equal(result.USDC.status, 'FRESH')
    assert.equal(result.EURC.price, 1.08)
    assert.equal(result.BTC.price, 42_000)
    assert.equal(result.BTC.providerAssetId, 'circle-wrapped-btc')
    assert.equal(result.BTC.source, 'DIRECT_CIRBTC')
    assert.equal(result.BTC.providerUpdatedAt, '2023-11-14T22:13:22.000Z')
    assert.deepEqual(result.BTC.history, [])
  })
})

test('shares concurrent requests and keeps fresh data for five minutes', async () => {
  router.resetForTests()
  setConfig()
  const original = Date.now
  let now = 10_000
  Date.now = () => now
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return response(payload())
  }
  try {
    await withServer(async (base) => {
      const url = `${base}/api/prices`
      const results = await Promise.all([originalFetch(url), originalFetch(url), originalFetch(url)].map(async (r) => (await r).json()))
      assert.equal(calls, 1)
      assert.equal(results[0].USDC.price, 1)
      now += router.constants.PRICE_TTL_MS - 1
      await originalFetch(url)
      assert.equal(calls, 1)
      now += 2
      await originalFetch(url)
      assert.equal(calls, 2)
    })
  } finally { Date.now = original }
})

test('serves last-known-good values as stale during provider failure and cools down retries', async () => {
  router.resetForTests()
  setConfig()
  const original = Date.now
  let now = 20_000
  Date.now = () => now
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls > 1) return response({ error: 'temporary' }, 503)
    return response(payload())
  }
  try {
    await withServer(async (base) => {
      const url = `${base}/api/prices`
      const fresh = await (await originalFetch(url)).json()
      assert.equal(fresh.BTC.status, 'FRESH')
      now += router.constants.PRICE_TTL_MS + 1
      const stale = await (await originalFetch(url)).json()
      assert.equal(calls, 2)
      assert.equal(stale.USDC.price, 1)
      assert.equal(stale.USDC.status, 'STALE')
      assert.equal(stale.USDC.staleReason, 'COINGECKO_UNAVAILABLE')
      await originalFetch(url)
      assert.equal(calls, 2)
    })
  } finally { Date.now = original }
})

test('returns semantic unavailable records when configuration is missing', async () => {
  router.resetForTests()
  delete process.env.COINGECKO_API_KEY
  delete process.env.COINGECKO_API_MODE
  globalThis.fetch = async () => { throw new Error('fetch must not run without config') }
  await withServer(async (base) => {
    const result = await (await originalFetch(`${base}/api/prices`)).json()
    for (const key of ['USDC', 'EURC', 'BTC']) {
      assert.equal(result[key].status, 'UNAVAILABLE')
      assert.equal(result[key].error, 'COINGECKO_CONFIG_REQUIRED')
      assert.equal('price' in result[key], false)
    }
  })
})

test('maps auth and rate-limit failures without fabricating zero prices', async () => {
  router.resetForTests()
  setConfig()
  globalThis.fetch = async () => response({ error: 'limited' }, 429)
  await withServer(async (base) => {
    const limited = await (await originalFetch(`${base}/api/prices`)).json()
    assert.equal(limited.USDC.error, 'COINGECKO_RATE_LIMITED')
  })

  router.resetForTests()
  globalThis.fetch = async () => response({ 'usd-coin': { usd: 0 }, 'euro-coin': { usd: 'NaN' }, 'circle-wrapped-btc': {} })
  await withServer(async (base) => {
    const invalid = await (await originalFetch(`${base}/api/prices`)).json()
    for (const key of ['USDC', 'EURC', 'BTC']) {
      assert.equal(invalid[key].status, 'UNAVAILABLE')
      assert.equal('price' in invalid[key], false)
    }
  })
})

test('uses the Pro base URL and header when explicitly configured', async () => {
  router.resetForTests()
  setConfig('pro')
  const calls = []
  globalThis.fetch = async (input, init) => { calls.push({ url: String(input), init }); return response(payload()) }
  await withServer(async (base) => { await originalFetch(`${base}/api/prices`) })
  assert.equal(new URL(calls[0].url).origin, 'https://pro-api.coingecko.com')
  assert.equal(calls[0].init.headers['x-cg-pro-api-key'], 'test-key')
  assert.equal(calls[0].init.headers['x-cg-demo-api-key'], undefined)
})
