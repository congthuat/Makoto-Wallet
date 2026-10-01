/* Deliberately intercepted failure fixtures; not live chain evidence. */
const { chromium } = require('C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const account = '0x16299b74c616994eaecb9b20e37d369d5d62586b'
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  try {
    for (const kind of ['malformed', 'http-failure']) for (const lang of ['vi', 'en']) for (const theme of ['dark', 'light']) {
      const name = `analytics-fixture-${kind}-${lang}-${theme}`
      if (process.argv[2] && process.argv[2] !== name) continue
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'vi' ? 'vi-VN' : 'en-US', colorScheme: theme })
      await context.addInitScript(({ account, lang, theme }) => {
        localStorage.setItem('mk.mode', JSON.stringify('watch'))
        localStorage.setItem('mk.address', JSON.stringify(account))
        localStorage.setItem('mk.lang', lang)
        localStorage.setItem('mk.theme', theme)
      }, { account, lang, theme })
      const mutations = [], intercepted = [], consoleErrors = [], pageErrors = []
      await context.route('**/api/**', async (route) => {
        const req = route.request(), pathname = new URL(req.url()).pathname
        if (req.method() !== 'GET') {
          mutations.push({ method: req.method(), pathname })
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'SKIPPED', reason: 'READ_ONLY_QA' }) })
        }
        if (!['/api/arc/network', '/api/arc/stats', '/api/arc/feed', '/api/arc/holders'].includes(pathname)) return route.continue()
        intercepted.push(pathname)
        if (kind === 'http-failure') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'INTENTIONAL_QA_SOURCE_UNAVAILABLE' }) })
        const invalid = {
          '/api/arc/network': { chainId: 1, blockNumber: 0, updatedAt: Date.now(), tokenTransferFeeUsdc: -1, rpcLatencyMs: 0 },
          '/api/arc/stats': { transactionsToday: 0, totalAddresses: 0, utilization: 0 },
          '/api/arc/feed': { live: [{ hash: 'not-a-real-hash', amount: 500, symbol: 'USDC' }], whales: [{ hash: 'not-a-real-hash', amount: 500, symbol: 'USDC' }], sampled: 0, sampledVolume: 500, updatedAt: Date.now() },
          '/api/arc/holders': { holdersCount: 0, totalSupply: 0, items: [{ address: 'not-an-address', balance: 500, share: 100, contract: false }] },
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invalid[pathname]) })
      })
      const page = await context.newPage()
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
      page.on('pageerror', e => pageErrors.push(e.message))
      try {
        await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
        await page.locator('footer').getByRole('button', { name: lang === 'vi' ? 'Phân tích' : 'Insights', exact: true }).click()
        await page.locator('[data-analytics-section="network"]').waitFor()
        await page.waitForTimeout(kind === 'http-failure' ? 11_000 : 1600)
        const main = page.locator('#mk-main')
        const text = await main.innerText()
        const layout = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, mainWidth: document.querySelector('#mk-main').clientWidth, mainScrollWidth: document.querySelector('#mk-main').scrollWidth }))
        assert.ok(layout.documentWidth <= 391 && layout.mainScrollWidth <= layout.mainWidth + 1, JSON.stringify(layout))
        assert.ok(!/Fear & Greed|Experimental|prototype|preview|sampledVolume|not-a-real-hash|not-an-address/i.test(text))
        assert.ok(!/500|100%|\$500/.test(text))
        assert.equal(await main.locator('a[href*="/tx/"], a[href*="/address/"]').count(), 0)
        assert.ok(/unavailable|khả dụng/i.test(text), text)
        assert.deepEqual(pageErrors, [])
        if (kind === 'malformed') assert.deepEqual(consoleErrors, [])
        else assert.ok(consoleErrors.every(e => /502|Failed to load resource/.test(e)), JSON.stringify(consoleErrors))
        for (const pathname of ['/api/arc/network', '/api/arc/stats', '/api/arc/feed', '/api/arc/holders']) assert.ok(intercepted.includes(pathname), pathname)
        await page.screenshot({ path: path.join(__dirname, `${name}.png`), fullPage: true })
        results.push({ name, pass: true, fixture: true, kind, lang, theme, intercepted, mutationsBlocked: mutations, consoleErrors, pageErrors, layout, text })
        console.log(`${name}: PASS`)
      } catch (e) {
        results.push({ name, pass: false, error: e.stack, consoleErrors, pageErrors })
        await page.screenshot({ path: path.join(__dirname, `${name}-failure.png`), fullPage: true }).catch(() => {})
        console.log(`${name}: FAIL ${e.message}`)
      } finally { await context.close() }
    }
  } finally {
    await browser.close()
    fs.writeFileSync(path.join(__dirname, process.argv[2] ? 'analytics-unavailable-browser-recheck.json' : 'analytics-unavailable-browser.json'), JSON.stringify({ observedAt: new Date().toISOString(), fixturesOnly: true, results }, null, 2))
  }
  if (results.some(r => !r.pass)) process.exitCode = 1
}
main().catch(e => { console.error(e); process.exitCode = 1 })
