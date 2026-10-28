const test = require('node:test')
const assert = require('node:assert/strict')
const market = require('../lib/marketData')

const { rsi, emaSeries, sma, atr, cache } = market._internal

test('indicator math is deterministic', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i)
  assert.equal(rsi(rising), 100)
  const falling = rising.slice().reverse()
  assert.equal(Math.round(rsi(falling)), 0)
  assert.equal(sma([1, 2, 3, 4], 2), 3.5)
  assert.equal(sma([1, 2], 3), null)
  const ema = emaSeries([1, 1, 1, 1, 1], 3)
  assert.deepEqual(ema, [1, 1, 1])
  const candles = Array.from({ length: 20 }, (_, i) => ({ h: 11 + i, l: 9 + i, c: 10 + i }))
  assert.equal(atr(candles), 2)
})

test('without Surf, data comes from free public sources and is labelled with the real source', async () => {
  const previousFetch = global.fetch
  const previousKey = process.env.SURF_API_KEY
  process.env.SURF_API_KEY = ''
  cache.clear()
  const seen = []
  global.fetch = async (url) => {
    seen.push(String(url))
    if (String(url).startsWith('https://api.alternative.me/fng/')) return Response.json({ data: [{ value: '51', value_classification: 'Neutral', timestamp: '1793145600' }, { value: '48', value_classification: 'Neutral', timestamp: '1793059200' }] })
    if (String(url).includes('/public/funding-rate?')) return Response.json({ code: '0', data: [{ fundingRate: '0.0001', fundingTime: '1793203200000' }] })
    if (String(url).includes('okx.com')) return Response.json({ code: '0', data: [] })
    return new Response('nope', { status: 500 })
  }
  try {
    const fg = await market.fearGreed(1)
    assert.equal(fg.source, 'alternative.me')
    assert.deepEqual(fg.rows.map((row) => row.value), [51, 48])
    const deriv = await market.derivatives('BTC')
    assert.equal(deriv.funding_rate_pct_per_8h, 0.01)
    assert.equal(deriv.funding_annualized_pct, 10.95)
    assert.equal(deriv.open_interest_usd, null)
    assert.match(deriv.note, /never describe this as whale activity/)
    await assert.rejects(market.news({ query: 'Circle', limit: 3 }), /News feeds unavailable/)
    assert.ok(!seen.some((url) => url.includes('asksurf')), 'Surf must be skipped when no key is configured')
  } finally {
    global.fetch = previousFetch
    process.env.SURF_API_KEY = previousKey
    cache.clear()
  }
})
