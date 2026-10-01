/* Natural document scrolling against live GET endpoints; no wallet/provider. */
const { chromium } = require('C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const origin = process.env.MAKOTO_QA_URL || 'http://localhost:5173'
const address = '0x16299b74c616994eaecb9b20e37d369d5d62586b'
const holdDurationMs = 17_200
const probe = process.argv.includes('--probe')
const configurations = probe ? [{ width: 1280, language: 'vi', theme: 'dark', pageName: 'analytics' }, { width: 1440, language: 'en', theme: 'dark', pageName: 'analytics' }] : [1440, 1280, 390].flatMap((width) => ['vi', 'en'].flatMap((language) => ['dark', 'light'].flatMap((theme) => ['analytics', 'settings'].map((pageName) => ({ width, language, theme, pageName })))))
const results = []
let pauseRequested = false
process.on('SIGINT', () => { pauseRequested = true; console.log('Pause requested: saving completed cases and closing this runner browser.') })
function saveResults(partial = true) {
  fs.writeFileSync(path.join(__dirname, probe ? 'scroll-browser-probe-results.json' : 'scroll-browser-results.json'), JSON.stringify({ origin, timestamp: new Date().toISOString(), holdDurationMs, partial, total: results.length, passed: results.filter((result) => result.pass).length, failed: results.filter((result) => !result.pass).length, cases: [...results].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2))
}

function initialize({ language, theme, address }) {
  localStorage.clear()
  localStorage.setItem('mk.lang', language)
  localStorage.setItem('mk.theme', theme)
  localStorage.setItem('mk.mode', JSON.stringify('watch'))
  localStorage.setItem('mk.address', JSON.stringify(address))
  delete window.ethereum
  delete window.okxwallet
  window.__makotoScrollDocument = crypto.randomUUID()
}
function state() {
  const scrolling = document.scrollingElement
  const main = document.querySelector('#mk-main')
  return {
    y: window.scrollY,
    scrollingY: scrolling.scrollTop,
    maxY: Math.max(0, scrolling.scrollHeight - innerHeight),
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    mainWidth: main.clientWidth,
    mainScrollWidth: main.scrollWidth,
    scrollingTag: scrolling.tagName,
    documentId: window.__makotoScrollDocument,
    timeOrigin: performance.timeOrigin,
    title: document.title,
    analyticsCards: [...main.querySelectorAll('[data-analytics-card]')].map((element) => ({ card: element.dataset.analyticsCard, documentTop: element.getBoundingClientRect().top + window.scrollY, height: element.getBoundingClientRect().height, rows: element.querySelectorAll('[data-analytics-transfer], [data-analytics-holder]').length })),
    nestedScrollers: [...main.querySelectorAll('*')].filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1).map((element) => ({ tag: element.tagName, className: element.className, height: element.clientHeight, scrollHeight: element.scrollHeight })),
  }
}
async function runCase(browser, configuration) {
  const { width, language, theme, pageName } = configuration
  const name = `${probe ? 'scroll-probe' : 'scroll'}-${pageName}-${width}-${language}-${theme}`
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: language === 'vi' ? 'vi-VN' : 'en-US', colorScheme: theme })
  await context.addInitScript(initialize, { language, theme, address })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const requests = [], blockedMutations = [], consoleErrors = [], pageErrors = [], navigations = [], responseReads = []
  const requestEntries = new WeakMap()
  const started = Date.now()
  const now = () => Date.now() - started
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ at: now(), message: message.text() }) })
  page.on('pageerror', (error) => pageErrors.push({ at: now(), message: error.message }))
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push({ at: now(), url: frame.url() }) })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.includes('/api/')) return
    const entry = { at: now(), path: url.pathname, method: request.method() }
    requestEntries.set(request, entry)
    requests.push(entry)
  })
  page.on('response', (response) => {
    const entry = requestEntries.get(response.request())
    if (!entry) return
    entry.status = response.status()
    entry.responseAt = now()
    if (['/api/arc/network', '/api/arc/feed', '/api/arc/stats'].includes(entry.path)) responseReads.push((async () => {
      const body = await response.json().catch(() => null)
      if (!body) return
      if (entry.path.endsWith('/network')) entry.observed = { blockNumber: body.blockNumber, rpcLatencyMs: body.rpcLatencyMs }
      if (entry.path.endsWith('/feed')) entry.observed = { sampled: body.sampled, liveCount: body.live?.length, whalesCount: body.whales?.length }
      if (entry.path.endsWith('/stats')) entry.observed = { totalTransactions: body.totalTransactions, transactionsToday: body.transactionsToday, totalBlocks: body.totalBlocks }
    })())
  })
  await context.route('**/*', async (route) => {
    const request = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue()
    const url = new URL(request.url())
    const knownSnapshot = url.pathname === '/api/portfolio/snapshot' && request.method() === 'POST'
    blockedMutations.push({ at: now(), path: url.pathname, method: request.method(), disposition: knownSnapshot ? 'SKIPPED fixture; not sent to backend' : 'DENIED; not sent to backend' })
    if (knownSnapshot) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'SKIPPED', reason: 'READ_ONLY_BROWSER_QA', snapshot: null, nextCaptureAt: new Date(Date.now() + 3_600_000).toISOString() }) })
    return route.abort('blockedbyclient')
  })
  let result, holdEvidence
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('#mk-main').waitFor({ state: 'visible' })
    if (pageName === 'settings') {
      let navigation = page.locator('aside')
      if (width === 390) {
        await page.locator('header').getByRole('button', { name: language === 'vi' ? 'Mở menu' : 'Open menu', exact: true }).click()
        navigation = page.locator('#mk-mobile-sidebar')
      }
      await navigation.locator('[data-nav-id="settings"]').click()
      await page.getByRole('heading', { name: language === 'vi' ? 'Cài đặt' : 'Settings', exact: true }).waitFor({ state: 'visible' })
    } else {
      // The existing footer button opens the canonical insights Page route;
      // its display label may be localized to Analytics in the current polish.
      const dataReady = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/arc/feed', { timeout: 25_000 })
      await page.locator('#mk-main footer nav button').nth(4).click()
      await dataReady
      await page.locator('[data-analytics-page]').waitFor({ state: 'visible' })
      await page.locator('#mk-main h1').waitFor({ state: 'visible' })
      // Home and Analytics share the real stats query. Its initial response may
      // already be in React Query's cache when navigation mounts Analytics.
      const statsWaitStarted = Date.now()
      while (!requests.some((entry) => entry.path === '/api/arc/stats' && entry.responseAt !== undefined) && Date.now() - statsWaitStarted < 25_000) await page.waitForTimeout(100)
      assert.ok(requests.some((entry) => entry.path === '/api/arc/stats' && entry.responseAt !== undefined), 'No real stats response observed')
      assert.equal(await page.locator('#mk-main h1').count(), 1)
      const initialWaitStarted = Date.now()
      while (!['/api/arc/network', '/api/arc/holders'].every((endpoint) => requests.some((entry) => entry.path === endpoint && entry.responseAt !== undefined)) && Date.now() - initialWaitStarted < 25_000) await page.waitForTimeout(100)
      assert.ok(['/api/arc/network', '/api/arc/holders'].every((endpoint) => requests.some((entry) => entry.path === endpoint && entry.responseAt !== undefined)), 'Initial real network/holder response did not settle')
    }
    await page.waitForTimeout(1500)
    const before = await page.evaluate(state)
    assert.ok(before.maxY > 0, `Natural page is not scrollable: ${JSON.stringify(before)}`)
    const targetY = Math.min(650, before.maxY)
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), targetY)
    await page.waitForTimeout(200)
    const held = await page.evaluate(state)
    assert.ok(held.y > 0)
    assert.ok(Math.abs(held.y - targetY) <= 2)
    assert.equal(held.y, held.scrollingY)
    assert.equal(held.scrollingTag, 'HTML')
    assert.deepEqual(held.nestedScrollers, [])
    const holdStarted = now()
    const navigationsBeforeHold = navigations.length
    const samples = [{ elapsed: 0, ...held }]
    holdEvidence = { before, targetY, held, holdStarted, samples, navigationsBeforeHold }
    const returnedFeed = () => requests.find((entry) => entry.path === '/api/arc/feed' && entry.at >= holdStarted && entry.status === 200 && entry.responseAt !== undefined && now() - entry.responseAt >= 750)
    // A real feed read can take several seconds after its 15s polling timer.
    // Retain the position through that response and its render, not just until
    // the request starts. Settings still uses the fixed 17.2-second minimum.
    while (!pauseRequested && now() - holdStarted < 35_000 && (now() - holdStarted < holdDurationMs || (pageName === 'analytics' && !returnedFeed()))) {
      await page.waitForTimeout(1000)
      samples.push({ elapsed: now() - holdStarted, ...await page.evaluate(state) })
    }
    const actualHoldDurationMs = now() - holdStarted
    for (const sample of samples) {
      assert.ok(sample.y > 0 && Math.abs(sample.y - held.y) <= 2, `Scroll moved during polling: ${JSON.stringify(sample)}`)
      assert.equal(sample.documentId, held.documentId)
      assert.equal(sample.timeOrigin, held.timeOrigin)
      assert.equal(sample.title, held.title)
      assert.equal(sample.y, sample.scrollingY)
      assert.ok(sample.documentWidth <= width + 1)
      assert.deepEqual(sample.nestedScrollers, [])
    }
    assert.ok(!pauseRequested, 'Runner paused before hold completed')
    assert.ok(actualHoldDurationMs > 16_000)
    assert.equal(navigations.length, navigationsBeforeHold)
    const duringHold = requests.filter((entry) => entry.at >= holdStarted)
    const endpointCounts = Object.fromEntries(['/api/arc/network', '/api/arc/feed', '/api/arc/stats'].map((endpoint) => [endpoint, { total: requests.filter((entry) => entry.path === endpoint).length, duringHold: duringHold.filter((entry) => entry.path === endpoint).length, responsesDuringHold: duringHold.filter((entry) => entry.path === endpoint && entry.status === 200 && entry.responseAt !== undefined && entry.responseAt <= holdStarted + actualHoldDurationMs).length }]))
    assert.ok(endpointCounts['/api/arc/network'].duringHold >= 1, 'No actual network polling happened during the hold')
    assert.ok(endpointCounts['/api/arc/network'].responsesDuringHold >= 1, 'No actual successful network poll returned during the hold')
    if (pageName === 'analytics') {
      assert.ok(endpointCounts['/api/arc/feed'].total >= 2 && endpointCounts['/api/arc/feed'].duringHold >= 1, 'No actual feed polling happened during the hold')
      assert.ok(returnedFeed(), 'No actual successful feed poll returned and settled during the hold')
      assert.ok(endpointCounts['/api/arc/stats'].total >= 1, 'No actual stats request happened')
    }
    assert.equal(blockedMutations.filter((entry) => entry.disposition.startsWith('DENIED')).length, 0)
    assert.deepEqual(consoleErrors, [])
    assert.deepEqual(pageErrors, [])
    const session = await page.evaluate(() => ({ mode: JSON.parse(localStorage.getItem('mk.mode')), address: JSON.parse(localStorage.getItem('mk.address')), providerPresent: !!window.ethereum || !!window.okxwallet, language: document.documentElement.lang, theme: document.documentElement.dataset.theme }))
    assert.equal(session.mode, 'watch')
    assert.equal(session.address, address)
    assert.equal(session.providerPresent, false)
    assert.equal(session.language, language)
    assert.equal(session.theme, theme)
    await page.screenshot({ path: path.join(__dirname, `${name}.png`), fullPage: false })
    result = { name, ...configuration, pass: true, targetY, heldY: held.y, holdStartedAt: holdStarted, returnedFeedAt: pageName === 'analytics' ? returnedFeed().responseAt : null, actualHoldDurationMs, endpointCounts, samples, session, navigations, blockedMutations }
    console.log(`PASS ${name}: y=${held.y}, ${actualHoldDurationMs}ms, network=${endpointCounts['/api/arc/network'].duringHold}, feed=${endpointCounts['/api/arc/feed'].duringHold}, stats=${endpointCounts['/api/arc/stats'].total}`)
  } catch (error) {
    await page.screenshot({ path: path.join(__dirname, `${name}-failure.png`), fullPage: false }).catch(() => {})
    result = { name, ...configuration, pass: false, error: String(error), stack: error.stack, currentState: await page.evaluate(state).catch(() => null), holdEvidence, navigations, blockedMutations }
    console.log(`FAIL ${name}: ${error.stack}`)
  } finally {
    await Promise.allSettled(responseReads)
    results.push({ ...result, requests, consoleErrors, pageErrors })
    saveResults()
    await context.close()
  }
}
async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (let offset = 0; !pauseRequested && offset < configurations.length; offset += 4) await Promise.all(configurations.slice(offset, offset + 4).map((configuration) => runCase(browser, configuration)))
  } finally {
    await browser.close()
    saveResults(pauseRequested)
  }
  if (results.some((result) => !result.pass)) process.exitCode = 1
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
