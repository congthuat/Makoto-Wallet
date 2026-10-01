import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createServer } from 'vite'

// Actual production rendering and translation lookup. Only read-only context
// data is replaced; fixture values are test evidence, never app fallbacks.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureKey = '__makotoAnalyticsUiFixture'
const previousFixture = globalThis[fixtureKey]
const previousFetch = globalThis.fetch
const account = `0x${'1'.repeat(40)}`
const other = `0x${'2'.repeat(40)}`
let server, Insights, getJson, compact, translate
let fetchCalls = []

before(async () => {
  globalThis.fetch = async (...args) => { fetchCalls.push(args); throw new Error('Analytics SSR must not make a network request') }
  server = await createServer({
    root: frontendRoot, configFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'analytics-ui-context-fixtures', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/lib/store')) return '\0analytics-ui-wallet'
        if (source.endsWith('/lib/i18n')) return '\0analytics-ui-language'
      },
      load(id) {
        if (id === '\0analytics-ui-wallet') return `export const useWallet = () => globalThis.${fixtureKey}.wallet;`
        if (id === '\0analytics-ui-language') return `
          export * from '/src/lib/i18n.ts';
          import { translate } from '/src/lib/i18n.ts';
          export const useT = () => {
            const language = globalThis.${fixtureKey}.language;
            return [(value) => typeof value === 'string' ? translate(value, language) : value, language];
          };
        `
      },
    }],
  })
  const page = await server.ssrLoadModule('/src/pages/Insights.tsx')
  Insights = page.default; getJson = page.getJson; compact = page.compact
  translate = (await server.ssrLoadModule('/src/lib/i18n.ts')).translate
})

after(async () => {
  await server?.close()
  globalThis.fetch = previousFetch
  if (previousFixture === undefined) delete globalThis[fixtureKey]
  else globalThis[fixtureKey] = previousFixture
})

function fixtures() {
  const now = Date.now()
  const row = {
    hash: `0x${'a'.repeat(64)}`, logIndex: 3, block: 64937801, timestamp: new Date(now - 60000).toISOString(),
    from: account, to: other, fromName: 'ArcSwap', toName: null, fromContract: true, toContract: false,
    symbol: 'USDC', amount: 152.6, method: 'transfer',
  }
  return {
    wallet: {
      network: { chainId: 5042002, blockNumber: 64937824, updatedAt: now - 12000, tokenTransferFeeUsdc: 0.0013975, rpcLatencyMs: 336 },
      networkError: false,
      feed: { live: [row, { ...row, hash: `0x${'b'.repeat(64)}`, fromName: null, fromContract: false, symbol: 'EURC', amount: 0.903225 }], whales: [row], sampled: 200, sampledVolume: 987654321, updatedAt: now },
      feedError: false,
    },
    stats: { totalTransactions: 764522290, transactionsToday: 1108332, totalAddresses: 55175776, totalBlocks: 64928743, utilization: 4.775, gas: null },
    holders: { holdersCount: 4971250, totalSupply: 316454545629.24335, items: [{ address: account, name: 'ArcSwap', contract: true, balance: 247176458004.9963, share: 78.108 }] },
  }
}

function render(language, fixture, failed = false) {
  globalThis[fixtureKey] = { language, wallet: fixture.wallet }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, gcTime: 0 } } })
  if (fixture.stats !== undefined) client.setQueryData(['arc-stats'], fixture.stats)
  if (fixture.holders !== undefined) client.setQueryData(['holders'], fixture.holders)
  if (failed) for (const queryKey of [['arc-stats'], ['holders']]) {
    client.getQueryCache().find({ queryKey, exact: true })?.setState({ status: 'error', fetchStatus: 'idle', error: new Error('Explorer unavailable') })
  }
  fetchCalls = []
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Insights)))
    assert.deepEqual(fetchCalls, [], 'Read-only SSR cannot initiate network or transaction calls')
    assert.ok(!client.getQueryCache().find({ queryKey: ['sentiment'], exact: true }), 'Removed generic sentiment card must not create its query')
    return html
  } finally { client.clear() }
}

function visibleText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function localized(label, language) {
  const value = translate(label, language)
  if (language === 'vi') assert.notEqual(value, label, `Vietnamese translation is required: ${label}`)
  return value
}

function assertNoUnsupportedClaims(html, language) {
  const text = visibleText(html)
  assert.doesNotMatch(text, /Fear & Greed|Crypto market|Sentiment|Surf|987[.,]?654[.,]?321|78[.,]108|316[.,]?45|USD volume/i)
  for (const old of ['Experimental · read-only onchain data, not used for wallet actions. Market sentiment, large transfers and holders for Arc Testnet.', 'USDC supply', 'Largest wallets on Arc Testnet']) {
    assert.ok(!text.includes(translate(old, language)), `Unsupported old claim remained: ${old}`)
  }
  assert.doesNotMatch(html, /overflow-y-auto|max-h-\[392px\]/, 'Transfer lists must use natural page scrolling')
  assert.doesNotMatch(html, /<form\b/, 'Analytics never offers transaction execution forms')
  for (const button of html.matchAll(/<button\b([^>]*)>/g)) {
    assert.match(button[1], /data-analytics-disclosure/, 'Analytics buttons only disclose existing rows')
    assert.match(button[1], /type="button"/)
    assert.match(button[1], /aria-controls="analytics-[a-z-]+-list"/)
  }
  assert.match(html, /data-analytics-read-only/)
  assert.ok(text.includes(localized('Read-only · No transaction execution', language)))
}

for (const language of ['vi', 'en']) {
  test(`${language} dashboard lists disclose five truthful rows without truncating or reordering source arrays`, () => {
    const fixture = fixtures()
    const base = fixture.wallet.feed.live[0]
    const rows = Array.from({ length: 18 }, (_, i) => ({ ...base, logIndex: i, amount: 1800 - i }))
    fixture.wallet.feed.live = rows
    fixture.wallet.feed.whales = rows.slice(0, 12)
    fixture.holders.items = Array.from({ length: 10 }, (_, i) => ({
      ...fixture.holders.items[0], address: `0x${(i + 1).toString(16).padStart(40, '0')}`, balance: 10000 - i,
    }))
    const before = JSON.stringify(fixture)
    const html = render(language, fixture)
    assertNoUnsupportedClaims(html, language)
    for (const id of ['largest-transfers', 'recent-transfers', 'holders']) {
      const content = html.match(new RegExp(`<div id="analytics-${id}-list">([\\s\\S]*?)</div>\\s*<div class="px-2 pt-3`))?.[1]
      assert.ok(content, `List ${id} must expose its controlled region`)
      assert.equal([...content.matchAll(/data-analytics-(?:transfer|holder)=/g)].length, 5)
    }
    assert.equal([...html.matchAll(/aria-expanded="false"/g)].length, 3)
    assert.equal(visibleText(html).split(localized('View more', language)).length - 1, 3)
    assert.ok(!visibleText(html).includes(localized('Show less', language)))
    assert.equal(JSON.stringify(fixture), before)
  })

  test(`${language} verified production Analytics renders real fields, localized labels and read-only source links`, () => {
    const fixture = fixtures()
    const original = JSON.stringify(fixture)
    const html = render(language, fixture)
    const text = visibleText(html)
    assertNoUnsupportedClaims(html, language)
    for (const label of ['Insights', 'Explore Arc onchain data and network activity.', 'Arc Chain Pulse', 'Latest block', 'Transactions today', 'Total addresses', 'Utilization', 'Estimated token transfer fee', 'Network response time', 'Largest recent transfers', 'Ranked by token amount in the explorer sample', 'Recent Transfers', 'Recent USDC & EURC transfers on Arc', 'Top USDC holding addresses', 'Includes contract addresses', 'Contract', 'Contract transfer', 'Transfer', 'Source']) {
      assert.ok(text.includes(localized(label, language)), `Localized label missing: ${label}`)
      if (language === 'vi') {
        assert.ok(!text.includes(label), `English label leaked into VI: ${label}`)
      }
    }
    if (language === 'vi') {
      assert.equal(translate('Transfer', 'vi'), 'Chuyển token')
      assert.equal(translate('Contract transfer', 'vi'), 'Chuyển qua hợp đồng')
      assert.ok(text.includes('Chuyển token'), 'Plain transfer rows must use their Vietnamese kind label')
      assert.ok(text.includes('Chuyển qua hợp đồng'), 'Contract transfer rows must use their Vietnamese kind label')
      assert.equal(localized('RPC observed {age}', 'vi'), 'RPC ghi nhận {age}')
      assert.ok(text.includes('RPC ghi nhận '))
      assert.ok(!text.includes('RPC observed '))
      assert.doesNotMatch(text, /\bTransfer\b/)
    }
    assert.ok(text.includes('ArcSwap'), 'Protocol proper names must remain untouched')
    for (const id of ['block', 'transactions', 'addresses', 'fee', 'utilization', 'latency']) assert.match(html, new RegExp(`data-analytics-metric="${id}"`))
    assert.equal([...html.matchAll(/data-analytics-transfer=/g)].length, 3)
    assert.equal([...html.matchAll(/data-analytics-holder=/g)].length, 1)
    assert.doesNotMatch(html, /data-analytics-disclosure/, 'Short lists need no disclosure control')
    assert.match(html, /data-analytics-kind="Contract transfer"/)
    assert.match(html, /data-analytics-kind="Transfer"/)
    assert.match(html, /data-analytics-source="Arc RPC, Arc Explorer"/)
    assert.match(html, new RegExp(`data-analytics-observed="${fixture.wallet.network.updatedAt}"`))
    assert.match(html, new RegExp(`title="${account} → ${other}"`))
    assert.match(html, new RegExp(`title="${fixture.wallet.feed.live[0].timestamp}"`))
    for (const link of html.matchAll(/<a\b([^>]*)>/g)) {
      assert.match(link[1], /href="https:\/\/testnet\.arcscan\.app\/(?:tx|address)\/0x[0-9a-f]+"/)
      assert.match(link[1], /target="_blank"/)
      assert.match(link[1], /rel="noopener noreferrer"/)
    }
    assert.equal(JSON.stringify(fixture), original, 'Presentation cannot change source data')
  })

  test(`${language} failed RPC and explorer queries hide cached values and omit empty optional cards`, () => {
    const fixture = fixtures()
    fixture.wallet.networkError = true; fixture.wallet.feedError = true
    const html = render(language, fixture, true)
    const text = visibleText(html)
    assertNoUnsupportedClaims(html, language)
    assert.ok(text.includes(localized('Arc network data is unavailable right now.', language)))
    assert.ok(text.includes(localized('Arc explorer data is unavailable right now.', language)))
    assert.doesNotMatch(html, /data-analytics-(?:metric|transfer|holder|observed|source)=/)
    assert.equal([...html.matchAll(/data-analytics-section=/g)].length, 1, 'Only the concise network unavailable card remains')
    assert.doesNotMatch(html, /data-analytics-section="(?:large-transfers|recent-transfers|holders)"/)
  })

  test(`${language} malformed responses cannot fabricate zero statistics, transfers, balances or timestamps`, () => {
    const fixture = fixtures()
    fixture.wallet.network = { chainId: 1, blockNumber: 0, updatedAt: 0, tokenTransferFeeUsdc: 0, rpcLatencyMs: 0 }
    fixture.wallet.feed = { live: [{ ...fixture.wallet.feed.live[0], hash: 'missing', amount: 0 }], whales: [], sampledVolume: 9999, updatedAt: Date.now() }
    fixture.stats = { transactionsToday: 0, totalAddresses: 0, utilization: 0 }
    fixture.holders = { holdersCount: 0, totalSupply: 0, items: [{ address: 'bad', balance: 0, share: 0 }] }
    const html = render(language, fixture)
    assertNoUnsupportedClaims(html, language)
    assert.doesNotMatch(html, /data-analytics-(?:metric|transfer|holder|observed|source)=/)
    assert.match(html, /data-analytics-unavailable="pulse"/)
    assert.match(html, /data-analytics-unavailable="explorer"/)
  })
}

test('partial availability keeps valid explorer metrics while omitting stale RPC and unavailable list sections', () => {
  const fixture = fixtures()
  fixture.wallet.network.updatedAt = Date.now() - 61000
  fixture.wallet.feed = { ...fixture.wallet.feed, whales: [] }
  fixture.holders = { items: [] }
  fixture.stats = { transactionsToday: 42, totalAddresses: 0, utilization: 0 }
  const html = render('en', fixture)
  assert.match(html, /data-analytics-metric="transactions"/)
  assert.match(html, /data-analytics-source="Arc Explorer"/)
  assert.match(html, /data-analytics-section="recent-transfers"/)
  assert.doesNotMatch(html, /data-analytics-metric="(?:block|fee|latency|addresses|utilization)"|data-analytics-observed=|data-analytics-section="(?:large-transfers|holders)"/)
})

test('initial loading stays concise without empty list cards or persistent skeleton boxes', () => {
  const html = render('vi', { wallet: { network: undefined, networkError: false, feed: undefined, feedError: false } })
  const text = visibleText(html)
  assert.ok(text.includes(localized('Loading Arc network data…', 'vi')))
  assert.ok(text.includes(localized('Loading Arc explorer data…', 'vi')))
  assert.doesNotMatch(html, /animate-pulse|data-analytics-(?:metric|transfer|holder)=/)
  assert.equal([...html.matchAll(/data-analytics-section=/g)].length, 1)
})

test('shared Home getJson and compact exports preserve successful response behavior', async () => {
  const expected = { transactionsToday: 42 }
  const savedFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json(expected) }
  try {
    assert.deepEqual(await getJson('arc/stats'), expected)
    assert.deepEqual(requests, [{ url: '/api/arc/stats', options: undefined }])
    assert.equal(compact(12345), '12.35K')
  } finally { globalThis.fetch = savedFetch }
})

test('shared Home getJson still rejects provider errors without converting failures into zero values', async () => {
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ error: 'Explorer unavailable' }, { status: 502 })
  try { await assert.rejects(getJson('arc/stats'), /Explorer unavailable/) }
  finally { globalThis.fetch = savedFetch }
})
