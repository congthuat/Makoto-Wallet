import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureKey = '__makotoReceiveNavigationFixture'
const previousFixture = globalThis[fixtureKey]
const previousStorage = globalThis.localStorage
let server, Sidebar, source

before(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  source = await readFile(path.join(root, 'src/App.tsx'), 'utf8')
  server = await createServer({
    root, configFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'receive-navigation-context-fixtures', enforce: 'pre',
      resolveId(id) {
        if (id.endsWith('/lib/store')) return '\0receive-navigation-wallet'
        if (id.endsWith('/lib/i18n')) return '\0receive-navigation-language'
      },
      load(id) {
        if (id === '\0receive-navigation-wallet') return `export const useWallet = () => globalThis.${fixtureKey}.wallet; export const WalletProvider = ({children}) => children;`
        if (id === '\0receive-navigation-language') return `
          export * from '/src/lib/i18n.ts';
          import { translate } from '/src/lib/i18n.ts';
          export const useT = () => { const language = globalThis.${fixtureKey}.language; return [(value) => typeof value === 'string' ? translate(value, language) : value, language]; };
        `
      },
      transform(code, id) {
        // Expose the real private component inside this test's Vite module only.
        // Production exports and navigation implementation remain unchanged.
        if (id.replaceAll('\\', '/').endsWith('/src/App.tsx')) return `${code}\nexport { Sidebar };`
      },
    }],
  })
  Sidebar = (await server.ssrLoadModule('/src/App.tsx')).Sidebar
})

after(async () => {
  await server?.close()
  if (previousFixture === undefined) delete globalThis[fixtureKey]
  else globalThis[fixtureKey] = previousFixture
  if (previousStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = previousStorage
})

function render(language, page = 'home', receiveOpen = false) {
  globalThis[fixtureKey] = { language, wallet: {
    page, receiveOpen, go: () => {}, setReceiveOpen: () => {},
    network: { blockNumber: 1 }, networkError: false, tasks: [], mode: 'watch', address: '0x1111111111111111111111111111111111111111',
  } }
  return renderToStaticMarkup(createElement(Sidebar, { onFeedback: () => {} }))
}
function row(html, id) {
  const match = html.match(new RegExp(`<button([^>]*data-nav-id="${id}"[^>]*)>([\\s\\S]*?)</button>`))
  assert.ok(match, `Missing navigation row ${id}`)
  return { attrs: match[1], body: match[2], text: match[2].replace(/<[^>]*>/g, '').trim() }
}

for (const language of ['vi', 'en']) {
  test(`${language}: transaction navigation includes Receive directly below Send`, () => {
    const html = render(language)
    const transactions = ['send', 'receive', 'swap', 'bridge', 'faucet']
    const positions = transactions.map((id) => html.indexOf(`data-nav-id="${id}"`))
    assert.deepEqual([...positions].sort((a, b) => a - b), positions)
    assert.equal(row(html, 'receive').text, language === 'vi' ? 'Nhận' : 'Receive')
    assert.equal(row(html, 'send').text, language === 'vi' ? 'Gửi' : 'Send')
    assert.equal(row(html, 'faucet').text, language === 'vi' ? 'Nhận token' : 'Get test tokens')
    assert.ok(html.includes(language === 'vi' ? 'GIAO DỊCH' : 'TRANSACTIONS'))
  })

  test(`${language}: Receive reflects the open modal and never highlights Faucet`, () => {
    const html = render(language, 'faucet', true)
    assert.match(row(html, 'receive').attrs, /aria-pressed="true"/)
    assert.match(row(html, 'receive').body, /mk-ind/)
    assert.doesNotMatch(row(html, 'receive').attrs, /aria-current="page"/)
    assert.doesNotMatch(row(html, 'faucet').attrs, /aria-current="page"/)
    assert.doesNotMatch(row(html, 'faucet').body, /mk-ind/)
  })

  test(`${language}: closing Receive restores the underlying page navigation state`, () => {
    const html = render(language, 'faucet', false)
    assert.match(row(html, 'receive').attrs, /aria-pressed="false"/)
    assert.doesNotMatch(row(html, 'receive').body, /mk-ind/)
    assert.match(row(html, 'faucet').attrs, /aria-current="page"/)
    assert.match(row(html, 'faucet').body, /mk-ind/)
  })
}

test('Receive uses the existing downward-arrow icon, spacing and keyboard focus treatment', () => {
  const receive = row(render('en'), 'receive')
  assert.match(receive.body, /lucide-arrow-down-left/)
  assert.match(receive.body, /width="17" height="17"/)
  assert.match(receive.attrs, /focus-visible:ring-2/)
  assert.match(receive.attrs, /gap-3 h-9 px-3/)
})

test('existing navigation destinations remain present with clear test-token copy', () => {
  const html = render('en')
  const existing = { home: 'Home', agent: 'Agent', tasks: 'Tasks', dashboard: 'Portfolio', assets: 'Assets', activity: 'Activity', send: 'Send', swap: 'Swap', bridge: 'Bridge', faucet: 'Get test tokens', settings: 'Settings' }
  for (const [id, label] of Object.entries(existing)) assert.equal(row(html, id).text, label)
})

test('Receive keeps the canonical modal boundary without adding a page or resetting scroll', async () => {
  const store = await readFile(path.join(root, 'src/lib/store.tsx'), 'utf8')
  const dashboard = await readFile(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8')
  assert.match(source, /if \(id === 'receive'\) setReceiveOpen\(true\); else go\(id\)/)
  assert.match(dashboard, /icon: ArrowDownLeft, t: 'Receive', on: \(\) => setReceiveOpen\(true\)/)
  assert.match(source, /<ReceiveModal \/>/)
  assert.doesNotMatch(store.match(/export type Page = [^\n]+/)[0], /'receive'/)
  assert.match(source, /useEffect\(\(\) => \{\s*window\.scrollTo\(\{ top: 0 \}\)\s*\}, \[w\.page\]\)/)
})

test('mobile drawer shares Sidebar and the existing five-tab model retains Receive under More actions', () => {
  assert.match(source, /id="mk-mobile-sidebar"[\s\S]*?<Sidebar onNavigate=/)
  assert.match(source, /icon: ArrowDownLeft, label: 'Receive', on: \(\) => setReceiveOpen\(true\)/)
  assert.match(source, /icon: Droplets, label: 'Get test tokens', on: \(\) => go\('faucet'\)/)
  const tabs = source.match(/grid grid-cols-5 h-\[60px\][\s\S]*?<\/nav>/)[0]
  for (const id of ['home', 'agent', 'dashboard', 'activity']) assert.match(tabs, new RegExp(`<Tab id="${id}"`))
  assert.match(tabs, /More actions/)
  assert.doesNotMatch(tabs, /<Tab id="receive"/)
})
