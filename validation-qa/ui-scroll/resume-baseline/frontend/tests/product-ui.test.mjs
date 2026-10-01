import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createServer } from 'vite'

// Render the production components, replacing only their wallet context and
// language hook. Translation lookup, React rendering, and Agent persistence
// helpers remain the actual application modules. No provider or runtime DB is used.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const account = '0x1111111111111111111111111111111111111111'
const noOp = () => {}
const fixtureKey = '__makotoProductUiFixture'
let server
let App, PortfolioCard, PriceAttribution, translate, TOKENS, agentSession, agentPresentation
const storage = new Map()
const previousStorage = globalThis.localStorage
const previousFixture = globalThis[fixtureKey]

before(async () => {
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }
  server = await createServer({
    root: frontendRoot, configFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'product-ui-context-fixtures',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/lib/store')) return '\0product-ui-wallet'
        if (source.endsWith('/lib/i18n')) return '\0product-ui-language'
      },
      load(id) {
        if (id === '\0product-ui-wallet') return `
          export const useWallet = () => globalThis.${fixtureKey}.wallet;
          export const WalletProvider = ({ children }) => children;
        `
        if (id === '\0product-ui-language') return `
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
  App = (await server.ssrLoadModule('/src/App.tsx')).default
  PortfolioCard = (await server.ssrLoadModule('/src/pages/Dashboard.tsx')).PortfolioCard
  PriceAttribution = (await server.ssrLoadModule('/src/components/wallet/PriceAttribution.tsx')).PriceAttribution
  translate = (await server.ssrLoadModule('/src/lib/i18n.ts')).translate
  TOKENS = (await server.ssrLoadModule('/src/lib/wallet.ts')).TOKENS
  agentSession = await server.ssrLoadModule('/src/brain/agentSession.ts')
  agentPresentation = await server.ssrLoadModule('/src/lib/agentPresentation.ts')
})

after(async () => {
  await server?.close()
  if (previousStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = previousStorage
  if (previousFixture === undefined) delete globalThis[fixtureKey]
  else globalThis[fixtureKey] = previousFixture
})

function walletFixture(mode, overrides = {}) {
  return {
    page: 'home', mode, address: mode === 'connected' ? account : '', displayAddress: account, live: mode === 'connected',
    total: 368.24, pricesReady: true, loading: false, balanceError: null, walletError: null,
    holdings: TOKENS.map((token, index) => ({ ...token, symbol: token.sym, verified: true, balance: index ? 0 : 368.24, value: index ? 0 : 368.24, price: 1, change24h: 0 })),
    activity: [], tasks: [], contacts: [], taskNotifications: [], tasksLoading: false, tasksError: false, taskNotificationsError: false,
    network: { blockNumber: 123, rpcLatencyMs: 50, tokenTransferFeeUsdc: 0.001 }, networkError: false,
    settings: { hideSmall: false, hideSpam: true, txAlerts: true, vivid: true }, hidden: false,
    portfolioScope: null, portfolioHistoryReady: false, portfolioHistoryError: false, portfolioDayPoints: [],
    receiveOpen: false, txDetail: null, lockPreview: false, toast: null,
    mask: (value) => value, go: noOp, notify: noOp, connect: noOp, disconnect: noOp, watch: noOp,
    setHidden: noOp, setReceiveOpen: noOp, setTxDetail: noOp, setLockPreview: noOp,
    setAgentSeed: noOp, setAgentSeedMode: noOp, refreshTasks: noOp, refetchWallet: noOp, refetchBalance: noOp,
    ...overrides,
  }
}

function render(Component, { language = 'en', mode = 'connected', overrides = {} } = {}) {
  globalThis[fixtureKey] = { language, wallet: walletFixture(mode, overrides) }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  client.setQueryData(['arc-stats'], { transactionsToday: 42 })
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Component)))
  } finally { client.clear() }
}

function visibleText(html) {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function assertNoRemovedNoise(text, language) {
  for (const copy of [
    'Sample wallet data for design preview. Connect a wallet or watch a public address to see real Arc balances.',
    'You review every step before anything happens.',
    'Live data',
  ]) assert.ok(!text.includes(translate(copy, language)), `Removed product copy appeared: ${copy}`)
  assert.doesNotMatch(text, /(?:Made|Created|Built) (?:by|with) Surf|Surf|PLAN_READY|Previous state|Trạng Thái Trước/i)
}

function assertAttribution(html, language) {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
  const attribution = anchors.find((match) => visibleText(match[2]) === translate('Price data by CoinGecko', language))
  assert.ok(attribution, 'Localized CoinGecko attribution must remain visible')
  assert.match(attribution[1], /href="https:\/\/www\.coingecko\.com\/en\/api"/)
  assert.match(attribution[1], /target="_blank"/)
  assert.match(attribution[1], /rel="[^"]*noopener[^"]*noreferrer[^"]*"/)
  const lastAction = html.lastIndexOf(translate('Bridge', language))
  assert.ok(html.indexOf(attribution[0]) > lastAction, 'Attribution belongs below the portfolio actions')
  assert.doesNotMatch(visibleText(html), /Data provided by CoinGecko/)
}

for (const language of ['en', 'vi']) {
  for (const mode of ['demo', 'connected']) {
    test(`${language} ${mode} Home renders intact with concise product copy`, () => {
      const html = render(App, { language, mode })
      const text = visibleText(html)
      assertNoRemovedNoise(text, language)
      assert.ok(text.includes('$368.24'), 'Wallet total stays visible')
      assert.ok(text.includes(translate('Total balance', language)))
      assert.ok(text.includes(translate('Send', language)))
      assert.ok(text.includes(translate('Receive', language)))
      assert.ok(text.includes(translate('Swap', language)))
      assert.ok(text.includes(translate('Bridge', language)))
      assert.ok(html.includes('id="mk-main"'))
      if (mode === 'demo') {
        assert.ok(text.includes(translate('Connect wallet', language)))
        assert.ok(text.includes(translate('Sample data', language)), 'Disconnected example holdings retain their small truth indicator')
      } else assert.ok(!text.includes(translate('Sample data', language)))
      assertAttribution(html, language)
    })
  }
  test(`${language} Portfolio keeps totals and actions with footer attribution`, () => {
    const html = render(PortfolioCard, { language })
    const text = visibleText(html)
    assertNoRemovedNoise(text, language)
    assert.match(text, /\$368\s*\.24/)
    assert.ok(text.includes('24h'))
    assertAttribution(html, language)
  })
  test(`${language} attribution is a small muted linked source credit`, () => {
    const html = render(PriceAttribution, { language })
    assert.match(html, /text-\[11px\]/)
    assert.match(html, /text-\[(?:#83838E|var\(--fg-subtle\))\]/)
    assert.ok(visibleText(html).includes(translate('Price data by CoinGecko', language)))
    assert.match(html, /href="https:\/\/www\.coingecko\.com\/en\/api"/)
    if (language === 'vi') assert.ok(visibleText(html).includes('Dữ liệu giá: CoinGecko'))
  })
}

test('meaningful wallet failure remains visible with a retry action', () => {
  const text = visibleText(render(App, { overrides: { walletError: 'explorer unavailable', balanceError: 'Wallet data unavailable' } }))
  assert.ok(text.includes("Couldn't load wallet data."))
  assert.ok(text.includes('Wallet data unavailable'))
  assert.ok(text.includes('Retry'))
})

test('meaningful pricing failure remains visible with a localized retry action', () => {
  const text = visibleText(render(App, { language: 'vi', overrides: { pricesReady: false, balanceError: 'Pricing data is unavailable.' } }))
  assert.ok(text.includes(translate('Pricing data is unavailable.', 'vi')))
  assert.ok(text.includes(translate('Retry', 'vi')))
})

test('Agent recovery preserves stored PLAN_READY state and cannot grant a handoff without review', () => {
  const data = new Map()
  const isolatedStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  const requested = agentSession.createAgentSession('ui-cleanup-session', 1000)
  const planned = agentSession.transitionAgentSession(requested, { type: 'plan-ready', planId: 'ui-cleanup-plan', now: 1001 })
  assert.equal(planned.accepted, true)
  assert.equal(agentSession.rememberAgentSession(isolatedStorage, planned.state, account), true)
  const saved = [...data.entries()]
  const recovered = agentSession.recoverLatestAgentSession(isolatedStorage, account)
  assert.equal(recovered.status, 'HISTORICAL')
  assert.equal(recovered.state.stage, 'PLAN_READY')
  agentPresentation.agentStatusLabel(recovered.state.stage)
  assert.deepEqual([...data.entries()], saved)
  assert.deepEqual(agentSession.recoverLatestAgentSession(isolatedStorage, account), recovered)
  assert.equal(agentSession.transitionAgentSession(recovered.state, { type: 'handed-off', account, now: 1002 }).accepted, false)
})

for (const language of ['en', 'vi']) {
  test(`${language} Agent statuses communicate product states without changing evidence`, () => {
    const evidence = Object.freeze([
      Object.freeze({ status: 'READY_APPROVAL', amount: '1.25', goalId: 'private-goal' }),
      Object.freeze({ status: 'READY_ACTION', amount: '1.25' }),
      Object.freeze({ status: 'READY_HANDOFF' }),
      Object.freeze({ status: 'WAITING_RECEIPT', hash: `0x${'a'.repeat(64)}` }),
      Object.freeze({ status: 'BLOCKED' }),
      Object.freeze({ status: 'UNAVAILABLE' }),
      Object.freeze({ status: 'user_rejected' }),
      Object.freeze({ status: 'pending' }),
      Object.freeze({ status: 'completed' }),
    ])
    const before = JSON.stringify(evidence)
    for (const observation of evidence) {
      const key = agentPresentation.agentStatusLabel(observation.status)
      const label = translate(key, language)
      assert.doesNotMatch(label, /READY_|WAITING_|USER_REJECTED|private-goal/)
      assert.ok(label.length > 0)
      if (language === 'vi') assert.notEqual(label, key, `Status should have Vietnamese product copy: ${key}`)
    }
    assert.equal(JSON.stringify(evidence), before)
    assert.equal(agentPresentation.agentStatusLabel('FUTURE_INTERNAL_STAGE'), 'Status unknown')
  })

  test(`${language} missing Agent fields use localized product labels`, () => {
    for (const field of ['amount', 'asset', 'recipient', 'outputAsset', 'sourceChain', 'destinationChain']) {
      const key = agentPresentation.agentFieldLabel(field)
      const label = translate(key, language)
      assert.notEqual(label, field)
      assert.doesNotMatch(label, /outputAsset|sourceChain|destinationChain/)
      if (language === 'vi') assert.notEqual(label, key, `Field should have Vietnamese product copy: ${key}`)
    }
  })
}
